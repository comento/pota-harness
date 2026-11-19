import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { targetDigest } from "../scripts/pota-lifecycle.mjs";
import {
  root,
  lifecycleScript,
  releaseVersion,
  withHome,
  run,
  rewriteOwnedVersion,
  retainVersion,
  readOwnership,
  setRetiredAt,
} from "./support/lifecycle-transaction.mjs";

test("the next upgrade recovers a crash immediately after shared config capture", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const publicSuffix = '\n# captured before crash\n[profiles.recovered]\nmodel = "custom"\n';
    const crashed = run("upgrade", {
      ...env,
      POTA_TEST_APPEND_CONFIG_BEFORE_REPLACE: publicSuffix,
      POTA_TEST_CRASH_AFTER_CONFIG_CAPTURE: "1",
    });
    assert.equal(crashed.status, 86, crashed.stderr);
    await assert.rejects(stat(env.CODEX_CONFIG_PATH));
    await stat(paths.transaction);

    const recovered = run("upgrade", env);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(await readFile(env.CODEX_CONFIG_PATH, "utf8"), /# captured before crash\n\[profiles\.recovered\]\nmodel = "custom"/);
    await assert.rejects(stat(paths.transaction));
  });
});

test("the next upgrade recovers when shared config disappears immediately before capture", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const crashed = run("upgrade", {
      ...env,
      POTA_TEST_REMOVE_CONFIG_BEFORE_REPLACE: "1",
      POTA_TEST_CRASH_AFTER_CONFIG_CAPTURE: "1",
    });
    assert.equal(crashed.status, 86, crashed.stderr);
    await assert.rejects(stat(env.CODEX_CONFIG_PATH));
    const journal = JSON.parse(await readFile(paths.transaction, "utf8"));
    const configEntry = journal.entries.find((entry) => entry.type === "config");
    await assert.rejects(stat(configEntry.backup));

    const recovered = run("upgrade", env);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(await readFile(env.CODEX_CONFIG_PATH, "utf8"), /\[marketplaces\.pota\]/);
    await assert.rejects(stat(paths.transaction));
  });
});

test("upgrade failure restores the previous runtime and manifest", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const beforeRuntime = await readFile(join(paths.runtime, "package.json"), "utf8");
    const beforeCodexRuntime = await readFile(join(paths.versioned, "package.json"), "utf8");
    const beforeManifest = await readFile(paths.ownership, "utf8");
    const result = run("upgrade", { ...env, POTA_TEST_FAIL_PHASE: "after-config" });
    assert.equal(result.status, 1);
    assert.equal(await readFile(join(paths.runtime, "package.json"), "utf8"), beforeRuntime);
    assert.equal(await readFile(join(paths.versioned, "package.json"), "utf8"), beforeCodexRuntime);
    assert.equal(await readFile(paths.ownership, "utf8"), beforeManifest);
  });
});

// Contract change (runtime-retention): the previous runtimes are retained for open sessions instead of removed.
test("an owned 0.2.2 installation upgrades to the current version and retains only the previous runtimes", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const oldRuntimes = await rewriteOwnedVersion(paths, "0.2.2");
    const result = run("upgrade", env);
    assert.equal(result.status, 0, result.stderr);
    for (const oldRuntime of oldRuntimes) await stat(oldRuntime);
    await stat(paths.runtime);
    await stat(paths.versioned);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    assert.equal(ownership.version, releaseVersion);
    assert.equal(ownership.targets.find((record) => record.id === "runtime").path, paths.runtime);
    assert.equal(ownership.targets.find((record) => record.id === "codex-runtime").path, paths.versioned);
    assert.equal(ownership.targets.some((record) => record.id.startsWith("previous-") || record.id.startsWith("retired-")), false);
    assert.deepEqual(ownership.retained.map(({ id, version, path }) => ({ id, version, path })), [
      { id: "runtime", version: "0.2.2", path: oldRuntimes[0] },
      { id: "codex-runtime", version: "0.2.2", path: oldRuntimes[1] },
    ]);
    assert.deepEqual((await readdir(join(paths.install, "runtime"))).sort(), ["0.2.2", releaseVersion].sort());
  });
});

test("cross-version cleanup failure restores the complete 0.2.2 installation", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const oldRuntimes = await rewriteOwnedVersion(paths, "0.2.2");
    const beforeOwnership = await readFile(paths.ownership, "utf8");
    const result = run("upgrade", { ...env, POTA_TEST_FAIL_PHASE: "after-cleanup" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Injected lifecycle failure: after-cleanup/);
    for (const oldRuntime of oldRuntimes) await stat(oldRuntime);
    await assert.rejects(stat(paths.runtime));
    await assert.rejects(stat(paths.versioned));
    assert.equal(await readFile(paths.ownership, "utf8"), beforeOwnership);
    assert.equal(run("upgrade", env).status, 0);
  });
});

test("a cross-version upgrade keeps the previous canonical runtime and records it as retained", async () => {
  await withHome(async ({ env, paths, temp }) => {
    assert.equal(run("install", env).status, 0);
    const [oldRuntime] = await retainVersion(env, paths, "0.2.2");
    const ownership = await readOwnership(paths);
    const retained = ownership.retained.find((entry) => entry.id === "runtime");
    assert.deepEqual(Object.keys(retained).sort(), ["id", "installedDigest", "path", "retiredAt", "version"]);
    assert.equal(retained.version, "0.2.2");
    assert.equal(retained.path, oldRuntime);
    assert.equal(retained.installedDigest, await targetDigest(oldRuntime, "tree"));
    assert.ok(Date.now() - Date.parse(retained.retiredAt) < 10 * 60_000, retained.retiredAt);

    // A session that started before the upgrade still runs its hooks from the retained runtime.
    const project = join(temp, "project");
    await mkdir(project, { recursive: true });
    const hook = spawnSync(process.execPath, [join(oldRuntime, "scripts", "pota-state.mjs"), "session-start"], {
      cwd: project, env, encoding: "utf8", input: JSON.stringify({ cwd: project, session_id: "open-session" }),
    });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(JSON.parse(hook.stdout).hookSpecificOutput.hookEventName, "SessionStart");
  });
});

test("a retained runtime past the grace period is removed by the next upgrade", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const oldRuntimes = await retainVersion(env, paths, "0.2.2");
    // The grace period is three days: an entry just inside it stays, one past it is removed.
    await setRetiredAt(paths, 2.9);
    assert.equal(run("upgrade", env).status, 0);
    for (const oldRuntime of oldRuntimes) await stat(oldRuntime);
    assert.equal((await readOwnership(paths)).retained.length, 2);

    await setRetiredAt(paths, 4);
    const result = run("install", env);
    assert.equal(result.status, 0, result.stderr);
    for (const oldRuntime of oldRuntimes) await assert.rejects(stat(oldRuntime));
    assert.deepEqual((await readOwnership(paths)).retained, []);
    await stat(paths.runtime);
    await stat(paths.versioned);
  });
});

test("retained runtimes are capped at three", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const retired = {};
    for (const version of ["0.2.2", "0.2.3", "0.2.4", "0.2.5"]) retired[version] = await retainVersion(env, paths, version);
    const ownership = await readOwnership(paths);
    for (const id of ["runtime", "codex-runtime"]) {
      assert.deepEqual(ownership.retained.filter((entry) => entry.id === id).map((entry) => entry.version).sort(), ["0.2.3", "0.2.4", "0.2.5"]);
    }
    for (const oldRuntime of retired["0.2.2"]) await assert.rejects(stat(oldRuntime));
    for (const version of ["0.2.3", "0.2.4", "0.2.5"]) for (const oldRuntime of retired[version]) await stat(oldRuntime);
  });
});

test("a cross-version upgrade that deselects Codex removes its cache runtimes and keeps retaining the canonical runtime", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const [retainedRuntime, retainedCodexRuntime] = await retainVersion(env, paths, "0.2.2");
    const [previousRuntime, previousCodexRuntime] = await rewriteOwnedVersion(paths, "0.2.3");
    const ownershipBefore = await readFile(paths.ownership, "utf8");
    const upgrade = (extraEnv = {}) => spawnSync(process.execPath, [lifecycleScript, "upgrade", "--hosts", "claude,antigravity"], {
      cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8",
    });

    // A cleanup failure restores the Codex runtimes and the manifest.
    const failed = upgrade({ POTA_TEST_FAIL_PHASE: "after-cleanup" });
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.equal(await readFile(paths.ownership, "utf8"), ownershipBefore);
    for (const path of [retainedCodexRuntime, previousCodexRuntime, paths.source]) await stat(path);

    // A crash after cleanup leaves a journal with the journal-only Codex removals that the next run recovers.
    const crashed = upgrade({ POTA_TEST_CRASH_AFTER_PHASE: "cleanup" });
    assert.equal(crashed.status, 88, crashed.stdout + crashed.stderr);
    const journal = JSON.parse(await readFile(paths.transaction, "utf8"));
    assert.ok(journal.entries.some((entry) => entry.id === "previous-codex-runtime" && entry.path === previousCodexRuntime), JSON.stringify(journal.entries.map((entry) => entry.id)));
    assert.ok(journal.entries.some((entry) => entry.id === "retired-codex-runtime-0.2.2"), JSON.stringify(journal.entries.map((entry) => entry.id)));

    const result = upgrade();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await assert.rejects(stat(paths.transaction));
    const ownership = await readOwnership(paths);
    assert.deepEqual(ownership.hosts, ["claude", "antigravity"]);
    assert.deepEqual(ownership.retained.map((entry) => [entry.id, entry.version]).sort(), [["runtime", "0.2.2"], ["runtime", "0.2.3"]]);
    for (const path of [retainedRuntime, previousRuntime, paths.runtime]) await stat(path);
    for (const path of [retainedCodexRuntime, previousCodexRuntime, paths.versioned, paths.codexCache, paths.marketplace]) await assert.rejects(stat(path), path);
    assert.doesNotMatch(await readFile(env.CODEX_CONFIG_PATH, "utf8").catch(() => ""), /pota/);
  });
});
