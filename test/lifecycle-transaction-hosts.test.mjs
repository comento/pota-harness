import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { targetDigest } from "../scripts/pota-lifecycle.mjs";
import {
  root,
  releaseVersion,
  newerVersion,
  withHome,
  newerCli,
  installationSnapshot,
  claudeLog,
  claudeState,
  run,
  runLifecycle,
  runArgs,
  hostToolsAvailable,
  pluginList,
  retainVersion,
  readOwnership,
  copyRuntimeAsVersion,
} from "./support/lifecycle-transaction.mjs";

// G2: with two Codex cache versions, Codex reports the semantically highest one (0.10.0, not the lexically larger
// 0.9.0), so the previous Codex cache copy can be retained without Codex loading it for new sessions.
test("Codex cache retention gate: Codex reports the highest cached version", async (context) => {
  if (spawnSync("codex", ["--version"], { encoding: "utf8" }).error) return context.skip("Codex CLI unavailable");
  await withHome(async ({ env, paths, temp }) => {
    assert.equal(run("install", env).status, 0);
    const cached = join(paths.codexCache, "pota");
    for (const version of ["0.10.0", "0.9.0"]) await copyRuntimeAsVersion(paths.versioned, join(cached, version), version);
    await rename(paths.versioned, join(temp, "hidden-current"));
    assert.deepEqual((await readdir(cached)).sort(), ["0.10.0", "0.9.0"]);
    const installed = pluginList(env).installed.find((entry) => entry.pluginId === "pota@pota");
    assert.equal(installed?.installed, true);
    assert.equal(installed?.version, "0.10.0");
  });
});

test("upgrade keeps the previous Codex cache version and Codex still reports the current version", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const [, oldCodexRuntime] = await retainVersion(env, paths, "0.2.2");
    await stat(oldCodexRuntime);
    const retained = (await readOwnership(paths)).retained.find((entry) => entry.id === "codex-runtime");
    assert.equal(retained.path, oldCodexRuntime);
    assert.equal(retained.installedDigest, await targetDigest(oldCodexRuntime, "tree"));
    assert.deepEqual((await readdir(join(paths.codexCache, "pota"))).sort(), ["0.2.2", releaseVersion].sort());
    if (!spawnSync("codex", ["--version"], { encoding: "utf8" }).error) {
      assert.equal(pluginList(env).installed.find((entry) => entry.pluginId === "pota@pota")?.version, releaseVersion);
    }
  });
});

test("invalid ownership manifest fails closed", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    await writeFile(paths.ownership, "{not json\n");
    const result = run("upgrade", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Ownership manifest is invalid/);
    await stat(paths.source);
  });
});

test("empty ownership targets fail closed before upgrade changes any artifact", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const protectedFile = join(paths.source, "package.json");
    const before = await readFile(protectedFile, "utf8");
    await writeFile(paths.ownership, `${JSON.stringify({ schemaVersion: 2, plugin: "pota", targets: [] })}\n`);
    const result = run("upgrade", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Ownership manifest schema/);
    assert.equal(await readFile(protectedFile, "utf8"), before);
  });
});

test("a missing required ownership record blocks upgrade without mutations", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    ownership.targets = ownership.targets.filter((record) => record.id !== "claude-command-plan");
    await writeFile(paths.ownership, `${JSON.stringify(ownership, null, 2)}\n`);
    const mirror = join(env.CLAUDE_HOME, "commands", "pota-plan.md");
    const before = await readFile(mirror, "utf8");
    const result = run("upgrade", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /complete managed target set/);
    assert.equal(await readFile(mirror, "utf8"), before);
  });
});

test("an unknown ownership record field blocks uninstall without mutations", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    ownership.targets[0].unknownField = true;
    await writeFile(paths.ownership, `${JSON.stringify(ownership, null, 2)}\n`);
    const protectedFile = ownership.targets[0].path;
    const before = await targetDigest(protectedFile, ownership.targets[0].type);
    const result = run("uninstall", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid or duplicate target/);
    assert.equal(await targetDigest(protectedFile, ownership.targets[0].type), before);
  });
});

test("ownership manifest cannot redirect a managed target outside its allowlist", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    ownership.targets[0].path = join(paths.source, "..", "user-data");
    await writeFile(paths.ownership, `${JSON.stringify(ownership, null, 2)}\n`);
    const result = run("upgrade", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the Pota allowlist/);
    await stat(paths.source);
  });
});

test("schema 2 ownership fields fail closed when hosts, origin, retained, or the schema version are invalid", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const installed = await readFile(paths.ownership, "utf8");
    const protectedFile = join(paths.runtime, "package.json");
    const before = await readFile(protectedFile, "utf8");
    const retained = { id: "runtime", version: "0.1.0", path: join(paths.install, "elsewhere"), installedDigest: `sha256:${"0".repeat(64)}`, retiredAt: new Date().toISOString() };
    for (const [change, expected] of [
      [(ownership) => { ownership.hosts = ["codex"]; }, /Ownership manifest schema/],
      [(ownership) => { ownership.hosts = ["codex", "claude", "antigravity", "codex"]; }, /Ownership manifest schema/],
      [(ownership) => { ownership.origin = "copy"; }, /Ownership manifest schema/],
      [(ownership) => { delete ownership.retained; }, /Ownership manifest schema/],
      [(ownership) => { ownership.schemaVersion = 1; }, /Ownership manifest schema/],
      [(ownership) => { ownership.retained = [retained]; }, /invalid retained runtime/],
    ]) {
      const ownership = JSON.parse(installed);
      change(ownership);
      await writeFile(paths.ownership, `${JSON.stringify(ownership, null, 2)}\n`);
      for (const command of ["upgrade", "uninstall"]) {
        const result = run(command, env);
        assert.equal(result.status, 1, `${command}: ${result.stderr}`);
        assert.match(result.stderr, expected);
      }
      assert.equal(await readFile(protectedFile, "utf8"), before);
    }
  });
});

// A CLI of another release than the installation: journals, rollbacks, and recovery must not depend on the CLI version.
test("an older CLI's failed uninstall of a newer installation rolls back", async () => {
  await withHome(async ({ env, paths }) => {
    const installed = runLifecycle(await newerCli(), "install", env);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const before = await installationSnapshot(paths);

    const failed = run("uninstall", { ...env, POTA_TEST_FAIL_PHASE: "uninstall-after-codex" });
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.equal(failed.stderr, "Pota lifecycle error: Injected lifecycle failure: uninstall-after-codex\n");
    assert.deepEqual(await installationSnapshot(paths), before);
    await assert.rejects(stat(paths.transaction));
    assert.deepEqual((await claudeState(env)).marketplaces.map((entry) => [entry.name, entry.path]), [["pota", paths.claudeMarketplace]]);

    const removed = run("uninstall", env);
    assert.equal(removed.status, 0, removed.stdout + removed.stderr);
    await assert.rejects(stat(paths.install));
  });
});

test("an older CLI refuses to replace a newer installation unless --allow-downgrade is given", async () => {
  await withHome(async ({ env, paths }) => {
    const installed = runLifecycle(await newerCli(), "install", env);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const before = await installationSnapshot(paths);
    const claudeCalls = (await claudeLog(env)).length;
    const refusal = `Pota lifecycle error: Installed Pota ${newerVersion} is newer than this CLI ${releaseVersion}; run the newer CLI, or pass --allow-downgrade to install ${releaseVersion}\n`;
    for (const args of [["install"], ["upgrade"], ["upgrade", "--hosts", "codex"]]) {
      const refused = runArgs(args, env);
      assert.equal(refused.status, 1, `${args.join(" ")}: ${refused.stdout}${refused.stderr}`);
      assert.equal(refused.stderr, refusal);
    }
    const auto = runArgs(["upgrade", "--auto", "--allow-downgrade"], env);
    assert.equal(auto.status, 1);
    assert.equal(auto.stderr, "Pota lifecycle error: --auto cannot be combined with --allow-downgrade\n");
    for (const command of ["doctor", "uninstall"]) {
      const rejected = runArgs([command, "--allow-downgrade"], env);
      assert.equal(rejected.status, 1);
      assert.equal(rejected.stderr, `Pota lifecycle error: Lifecycle command ${command} does not accept arguments: --allow-downgrade\n`);
    }
    assert.deepEqual(await installationSnapshot(paths), before);
    assert.equal((await claudeLog(env)).length, claudeCalls);
    await assert.rejects(stat(paths.transaction));

    const allowed = runArgs(["upgrade", "--allow-downgrade"], env);
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
    const ownership = await readOwnership(paths);
    assert.equal(ownership.version, releaseVersion);
    assert.equal(ownership.targets.find((record) => record.id === "runtime").path, paths.runtime);
    const doctor = run("doctor", env);
    assert.doesNotMatch(doctor.stdout, /differs from installed version/);
  });
});

test("doctor from a CLI of another version checks the installed version and reports the difference", async () => {
  await withHome(async ({ env }) => {
    const newer = await newerCli();
    const installed = runLifecycle(newer, "install", env);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const doctor = run("doctor", env);
    const lines = doctor.stdout.split("\n");
    assert.equal(lines[0], "Hosts: codex,claude,antigravity");
    assert.equal(lines[1], `CLI version ${releaseVersion} differs from installed version ${newerVersion}`);
    for (const name of [
      "ownership manifest", "ownership digests", "canonical runtime", "versioned runtime", "installed hooks manifest field",
      "hooks file", "installed runtime locator", "installed skill locators", "installed CLI script", "Claude runtime locator",
      "Claude plugin files", "Claude plugin registered", "Claude plugin cache version", "Antigravity CLI skill validation",
    ]) assert.ok(lines.includes(`OK ${name}`), `${name}\n${doctor.stdout}`);
    assert.doesNotMatch(runLifecycle(newer, "doctor", env).stdout, /differs from installed version/);
  });
});

test("uninstall preserves modified artifacts and returns conflict", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const mirror = join(env.ANTIGRAVITY_CLI_HOME, "skills", "pota-plan.md");
    await writeFile(mirror, "user content\n");
    const result = run("uninstall", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to uninstall modified managed artifacts/);
    assert.equal(await readFile(mirror, "utf8"), "user content\n");
    await stat(paths.source);
  });
});

test("managed-only uninstall prunes the install root and Codex cache scaffolds and can reinstall", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const uninstall = run("uninstall", env);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    await assert.rejects(stat(paths.install));
    await assert.rejects(stat(paths.codexCache));

    const reinstall = run("install", env);
    assert.equal(reinstall.status, 0, reinstall.stderr);
    await stat(paths.ownership);
    assert.equal(run("doctor", env).status, hostToolsAvailable() ? 0 : 1);
  });
});

test("uninstall preserves unmanaged children at every scaffold", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    await stat(paths.ownership);
    const unmanaged = [
      join(paths.marketplace, "plugins", "keep.txt"),
      join(paths.marketplace, ".agents", "plugins", "keep.txt"),
      join(paths.marketplace, ".agents", "keep.txt"),
      join(paths.marketplace, "keep.txt"),
      join(paths.install, "runtime", "keep.txt"),
      join(paths.install, "keep.txt"),
      join(paths.codexCache, "pota", "keep.txt"),
      join(paths.codexCache, "keep.txt"),
    ];
    for (const path of unmanaged) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `keep ${path}\n`);
    }

    const uninstall = run("uninstall", env);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    for (const path of unmanaged) assert.match(await readFile(path, "utf8"), /^keep /);
    await assert.rejects(stat(paths.ownership));
    await assert.rejects(stat(paths.runtime));
    await assert.rejects(stat(paths.versioned));
    await stat(paths.install);
    await stat(paths.codexCache);
  });
});

test("post-commit failure never rolls back removed artifacts", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const failed = run("uninstall", { ...env, POTA_TEST_FAIL_PHASE: "uninstall-after-commit" });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Injected lifecycle failure/);
    await assert.rejects(stat(paths.ownership));
    await assert.rejects(stat(paths.source));
    await assert.rejects(stat(paths.runtime));
    await stat(paths.install);

    const reinstall = run("install", env);
    assert.equal(reinstall.status, 0, reinstall.stderr);
    await stat(paths.ownership);
  });
});
