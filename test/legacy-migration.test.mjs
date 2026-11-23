import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  migrationNoticeLine, planLegacyRemoval, runLegacyRemoval, sessionStartMigration,
} from "../scripts/pota-legacy-migration.mjs";
import {
  fixtureManifest, hostOfId, isolatedEnv, pathExists, readClaudeLog, snapshot, withLegacyInstall,
} from "./support/legacy-install.mjs";

const migrationScript = resolve("scripts/pota-legacy-migration.mjs");
const NOW = new Date("2026-11-23T00:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const pluginRoot = join("/Users", "someone", ".claude", "plugins", "cache", "pota-harness", "pota", "2.0.0");
const doctor = `node "${join(pluginRoot, "scripts", "pota.mjs")}" doctor`;
// Entries a run is expected to change even when it removes nothing.
const VOLATILE = ["home/.pota/migration", "home/.claude/fake-claude.log"];

function at(offsetMs) {
  return new Date(NOW.getTime() + offsetMs);
}

function fakeSpawn() {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { unref() {} };
  };
  return { calls, spawn };
}

function allTargetPaths(install) {
  return install.manifest.targets.filter((record) => record.type !== "config").map((record) => record.path);
}

async function reports(install) {
  return JSON.parse(await readFile(join(install.env.POTA_HOME, "migration", "report.json"), "utf8")).hosts;
}

function leftoverNames(tree) {
  return Object.keys(tree).filter((key) => /\.pota-(checking|removing)-/.test(key));
}

function canSymlink() {
  return process.platform !== "win32";
}

test("the manifest the real 1.4.0 installer wrote passes the ownership checks", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pota-legacy-fixture-"));
  try {
    const home = join(temp, "home");
    const env = isolatedEnv(temp, home);
    const manifest = await fixtureManifest(home);
    await mkdir(join(env.POTA_HOME, "install"), { recursive: true });
    await writeFile(join(env.POTA_HOME, "install", "lifecycle.json"), JSON.stringify(manifest, null, 2));
    const plan = await planLegacyRemoval({ env, host: "all" });
    assert.equal(plan.status, "ready", JSON.stringify(plan));
    assert.equal(plan.version, "1.4.0");
    assert.deepEqual(plan.manifestHosts, ["codex", "claude", "antigravity"]);
    assert.equal(plan.targets.length + plan.core.length, manifest.targets.length - 1);
    assert.ok([...plan.targets, ...plan.core].every((target) => target.state === "missing"));
    assert.deepEqual(plan.unregister.map((step) => step.action), ["codex-config", "claude-plugin"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("a run for every host removes every verified target, keeps user state, and removes the manifest last", async () => {
  await withLegacyInstall({ retained: [{ id: "runtime", version: "1.3.2" }, { id: "codex-runtime", version: "1.3.2" }] }, async (install) => {
    const steps = [];
    const result = await runLegacyRemoval({
      env: install.env, now: NOW, host: "all",
      testHooks: { afterStep: (step) => steps.push([step, pathExists(install.manifestPath)]) },
    });
    assert.equal(result.status, "completed");
    for (const path of allTargetPaths(install)) assert.equal(pathExists(path), false, path);
    for (const entry of install.manifest.retained) assert.equal(pathExists(entry.path), false, entry.path);
    assert.equal(pathExists(install.manifestPath), false);
    assert.deepEqual(steps.at(-1), ["manifest", false]);
    assert.ok(steps.slice(0, -1).every(([, present]) => present), "the manifest stays until the last step");
    assert.ok(steps.findIndex(([step]) => step === "update") > steps.findIndex(([step]) => step === "removed:runtime"));

    for (const [name, path] of Object.entries(install.keep)) assert.equal(await readFile(path, "utf8"), `keep ${name}\n`);
    for (const path of [install.update, join(install.env.POTA_HOME, "install"), join(install.env.CLAUDE_HOME, "pota"),
      join(install.env.CODEX_HOME, "plugins", "cache", "pota"), join(install.env.ANTIGRAVITY_HOME, "pota")]) {
      assert.equal(pathExists(path), false, path);
    }
    assert.equal(pathExists(join(install.env.CLAUDE_HOME, "commands")), true, "the user's commands directory itself stays");
    assert.equal(await readFile(install.env.CODEX_CONFIG_PATH, "utf8"), install.config.after);

    const log = await readClaudeLog(install);
    assert.ok(log.includes("plugin uninstall pota@pota --scope user"));
    assert.ok(log.includes("plugin marketplace remove pota"));
    const claudeState = JSON.parse(await readFile(install.claudeState, "utf8"));
    assert.deepEqual(claudeState.marketplaces.map((entry) => entry.name), ["pota-harness"]);
    assert.deepEqual(claudeState.plugins.map((entry) => entry.id), ["pota@pota-harness"]);

    const recorded = await reports(install);
    for (const host of ["codex", "claude", "antigravity"]) {
      assert.equal(recorded[host].status, "completed");
      assert.equal(recorded[host].legacyRemoved, true);
      assert.deepEqual(recorded[host].remainingHosts, []);
      assert.deepEqual(recorded[host].modified, []);
    }
  });
});

test("a host run removes only that host's part; the runtime and manifest go with the last host", async () => {
  await withLegacyInstall({}, async (install) => {
    const claude = await runLegacyRemoval({ env: install.env, now: NOW, host: "claude" });
    assert.equal(claude.status, "completed");
    for (const record of install.hostTargets("claude")) assert.equal(pathExists(record.path), false, record.path);
    for (const record of [...install.hostTargets("codex"), ...install.hostTargets("antigravity"), install.target("runtime")]) {
      assert.equal(pathExists(record.path), true, record.path);
    }
    assert.equal(pathExists(install.manifestPath), true);
    assert.equal(await readFile(install.env.CODEX_CONFIG_PATH, "utf8"), install.config.before);
    assert.deepEqual(claude.hosts.claude.remainingHosts, ["codex", "antigravity"]);

    assert.equal((await runLegacyRemoval({ env: install.env, now: NOW, host: "antigravity" })).status, "completed");
    assert.equal(pathExists(install.manifestPath), true);
    assert.equal(pathExists(install.target("runtime").path), true);

    const codex = await runLegacyRemoval({ env: install.env, now: NOW, host: "codex" });
    assert.equal(codex.status, "completed");
    assert.equal(codex.hosts.codex.legacyRemoved, true);
    assert.ok(codex.hosts.codex.removed.includes(install.target("runtime").path));
    assert.equal(pathExists(install.manifestPath), false);
    assert.equal(await readFile(install.env.CODEX_CONFIG_PATH, "utf8"), install.config.after);
    const recorded = await reports(install);
    assert.deepEqual(Object.keys(recorded).sort(), ["antigravity", "claude", "codex"]);
  });
});

test("modified targets stay and are reported; the runtime and manifest stay with them", async () => {
  await withLegacyInstall({}, async (install) => {
    const command = install.target("claude-command-plan").path;
    const skill = install.target("ide-skill-pota-plan").path;
    await writeFile(command, "edited by the user\n");
    await writeFile(join(skill, "notes.md"), "user notes\n");
    const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "all" });
    assert.equal(result.status, "completed");
    assert.equal(await readFile(command, "utf8"), "edited by the user\n");
    assert.equal(await readFile(join(skill, "notes.md"), "utf8"), "user notes\n");
    assert.deepEqual(result.hosts.claude.modified, [command]);
    assert.deepEqual(result.hosts.antigravity.modified, [skill]);
    assert.equal(pathExists(install.target("claude-command-work").path), false);
    assert.equal(pathExists(install.target("runtime").path), true);
    assert.equal(pathExists(install.manifestPath), true);
    assert.deepEqual(result.hosts.codex.remainingHosts, ["claude", "antigravity"]);
  });
});

test("a target outside the allowlist, an invalid manifest, or a pending transaction removes nothing", async (t) => {
  const cases = [
    ["a target path outside the allowlist", "target-outside-allowlist", async (install) => {
      const manifest = structuredClone(install.manifest);
      const outside = join(install.home, "Documents", "pota-plan.md");
      await mkdir(join(install.home, "Documents"), { recursive: true });
      await writeFile(outside, "user file\n");
      manifest.targets.find((record) => record.id === "claude-command-plan").path = outside;
      await install.writeManifest(manifest);
    }],
    ["a retained runtime at another path", "target-outside-allowlist", async (install) => {
      const manifest = structuredClone(install.manifest);
      manifest.retained = [{ id: "runtime", version: "1.3.2", path: join(install.home, "elsewhere"), installedDigest: `sha256:${"c".repeat(64)}`, retiredAt: NOW.toISOString() }];
      await install.writeManifest(manifest);
    }],
    ["schema 1", "manifest-unsupported-schema", (install) => install.writeManifest({ ...install.manifest, schemaVersion: 1 })],
    ["broken JSON", "manifest-invalid", (install) => writeFile(install.manifestPath, "{not json")],
    ["an unknown manifest key", "manifest-invalid", (install) => install.writeManifest({ ...install.manifest, extra: true })],
    ["a transactionId that is not a UUID v4", "manifest-invalid", (install) => install.writeManifest({ ...install.manifest, transactionId: "../../escape" })],
    ["a pending installer transaction", "transaction-pending", (install) => writeFile(join(install.env.POTA_HOME, "install", "transaction.json"), "{}\n")],
    ...(canSymlink() ? [["a symlinked manifest", "manifest-invalid", async (install) => {
      const real = join(install.temp, "real-lifecycle.json");
      await rename(install.manifestPath, real);
      await symlink(real, install.manifestPath);
    }]] : []),
  ];
  for (const [name, reason, mutate] of cases) {
    await t.test(name, () => withLegacyInstall({}, async (install) => {
      await mutate(install);
      const before = await snapshot(install.temp, VOLATILE);
      const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "all" });
      assert.equal(result.status, "blocked");
      for (const host of ["codex", "claude", "antigravity"]) assert.equal(result.hosts[host].reason, reason);
      assert.deepEqual(await snapshot(install.temp, VOLATILE), before);
      assert.deepEqual(await readClaudeLog(install), []);
    }));
  }
});

test("Claude Code: only Pota's own marketplace is unregistered, and a failed unregistration keeps the Claude files", async (t) => {
  await t.test("a foreign pota marketplace is left alone and the files are removed", () => withLegacyInstall({ claude: "foreign" }, async (install) => {
    const stateBefore = await readFile(install.claudeState, "utf8");
    const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "claude" });
    assert.equal(result.status, "completed");
    for (const record of install.hostTargets("claude")) assert.equal(pathExists(record.path), false, record.path);
    assert.deepEqual(await readClaudeLog(install), ["--version", "plugin marketplace list"]);
    assert.equal(await readFile(install.claudeState, "utf8"), stateBefore);
  }));
  await t.test("a missing claude CLI blocks the Claude part and reports the manual commands", () => withLegacyInstall({ env: { POTA_CLAUDE_CLI: "none" } }, async (install) => {
    const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "all" });
    assert.equal(result.status, "blocked");
    assert.equal(result.hosts.claude.reason, "host-unregister-failed");
    assert.deepEqual(result.hosts.claude.manual, ["claude plugin uninstall pota@pota --scope user", "claude plugin marketplace remove pota"]);
    for (const record of install.hostTargets("claude")) assert.equal(pathExists(record.path), true, record.path);
    for (const record of install.hostTargets("antigravity")) assert.equal(pathExists(record.path), false, record.path);
    assert.equal(pathExists(install.target("runtime").path), true);
    assert.equal(pathExists(install.manifestPath), true);
  }));
  await t.test("a failing claude command blocks, and the next run finishes", () => withLegacyInstall({ hosts: ["claude"] }, async (install) => {
    const failing = await runLegacyRemoval({ env: { ...install.env, FAKE_CLAUDE_FAIL: "plugin marketplace remove" }, now: NOW, host: "claude" });
    assert.equal(failing.hosts.claude.reason, "host-unregister-failed");
    assert.equal(pathExists(install.target("claude-plugin").path), true);
    const retried = await runLegacyRemoval({ env: install.env, now: NOW, host: "claude" });
    assert.equal(retried.status, "completed");
    assert.equal(pathExists(install.manifestPath), false);
    assert.equal((await readClaudeLog(install)).filter((line) => line.startsWith("plugin uninstall")).length, 1);
  }));
});

test("Codex config: only pota@pota sections owned by the legacy marketplace are removed", async (t) => {
  await t.test("a foreign [marketplaces.pota] keeps config.toml byte for byte", () => withLegacyInstall({ hosts: ["codex"], codexConfig: "foreign" }, async (install) => {
    const before = await readFile(install.env.CODEX_CONFIG_PATH, "utf8");
    const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "codex" });
    assert.equal(result.status, "completed");
    assert.equal(await readFile(install.env.CODEX_CONFIG_PATH, "utf8"), before);
    for (const record of install.hostTargets("codex")) assert.equal(pathExists(record.path), false, record.path);
  }));
  await t.test("a missing config.toml is nothing to unregister", () => withLegacyInstall({ hosts: ["codex"], codexConfig: "absent" }, async (install) => {
    const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "codex" });
    assert.equal(result.status, "completed");
    assert.equal(pathExists(install.env.CODEX_CONFIG_PATH), false);
    assert.equal(pathExists(install.manifestPath), false);
  }));
  if (canSymlink()) {
    await t.test("a symlinked config.toml blocks the Codex part", () => withLegacyInstall({ hosts: ["codex"] }, async (install) => {
      const real = join(install.temp, "real-config.toml");
      await rename(install.env.CODEX_CONFIG_PATH, real);
      await symlink(real, install.env.CODEX_CONFIG_PATH);
      const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "codex" });
      assert.equal(result.hosts.codex.reason, "host-unregister-failed");
      assert.equal(await readFile(real, "utf8"), install.config.before);
      for (const record of install.hostTargets("codex")) assert.equal(pathExists(record.path), true, record.path);
    }));
  }
});

test("a lifecycle lock held by a live process or a running auto-upgrade defers the run; a dead owner's lock is reclaimed", async (t) => {
  const record = (pid) => `${JSON.stringify({ schemaVersion: 1, pid, hostname: hostname(), nonce: "other-owner", acquiredAt: NOW.toISOString() })}\n`;
  await t.test("live lifecycle lock", () => withLegacyInstall({}, async (install) => {
    const lock = join(install.env.POTA_HOME, "install", "lifecycle.lock");
    await writeFile(lock, record(process.pid));
    const before = await snapshot(install.temp, VOLATILE);
    const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "claude" });
    assert.equal(result.status, "deferred");
    assert.equal(result.hosts.claude.reason, "lock-busy");
    assert.deepEqual(await snapshot(install.temp, VOLATILE), before);
  }));
  await t.test("live update.lock", () => withLegacyInstall({ hosts: ["antigravity"] }, async (install) => {
    await writeFile(join(install.update, "update.lock"), record(process.pid));
    const before = await snapshot(install.temp, VOLATILE);
    const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "antigravity" });
    assert.equal(result.hosts.antigravity.reason, "update-running");
    assert.deepEqual(await snapshot(install.temp, VOLATILE), before);
  }));
  await t.test("dead owner", () => withLegacyInstall({ hosts: ["antigravity"] }, async (install) => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeFile(join(install.env.POTA_HOME, "install", "lifecycle.lock"), record(deadPid));
    const result = await runLegacyRemoval({ env: install.env, now: NOW, host: "antigravity" });
    assert.equal(result.status, "completed");
    assert.equal(pathExists(install.manifestPath), false);
  }));
});

test("a run that dies after any step is finished by the next run, including renamed copies", async (t) => {
  const points = [
    ["unregister:claude", ["claude"]],
    ["checking:ide-skill-pota-plan", ["antigravity"]],
    ["removing:ide-skill-pota-plan", ["antigravity"]],
    ["removed:cli-skill-pota-work", ["antigravity"]],
    ["unregister:codex", ["codex"]],
    ["removing:codex-runtime", ["codex"]],
    ["checking:runtime", ["antigravity"]],
    ["removing:runtime", ["antigravity"]],
    ["update", ["antigravity"]],
  ];
  for (const [point, hosts] of points) {
    await t.test(point, () => withLegacyInstall({ hosts }, async (install) => {
      const crash = { afterStep: (step) => { if (step === point) throw new Error(`crash at ${step}`); } };
      await assert.rejects(runLegacyRemoval({ env: install.env, now: NOW, host: "all", testHooks: crash }), /crash at/);
      assert.equal(pathExists(install.manifestPath), true);
      const resumed = await runLegacyRemoval({ env: install.env, now: NOW, host: "all" });
      assert.equal(resumed.status, "completed", JSON.stringify(resumed));
      for (const path of allTargetPaths(install)) assert.equal(pathExists(path), false, path);
      assert.equal(pathExists(install.manifestPath), false);
      assert.deepEqual(leftoverNames(await snapshot(install.temp)), []);
      for (const [name, path] of Object.entries(install.keep)) assert.equal(await readFile(path, "utf8"), `keep ${name}\n`);
      if (hosts.includes("codex")) assert.equal(await readFile(install.env.CODEX_CONFIG_PATH, "utf8"), install.config.after);
    }));
  }
});

test("a tree changed after it was renamed aside is restored under its name and kept", async () => {
  await withLegacyInstall({ hosts: ["antigravity"] }, async (install) => {
    const skill = install.target("ide-skill-pota-plan").path;
    const result = await runLegacyRemoval({
      env: install.env, now: NOW, host: "antigravity",
      testHooks: { afterStep: async (step, detail) => { if (step === "checking:ide-skill-pota-plan") await writeFile(join(detail.path, "late.md"), "late\n"); } },
    });
    assert.deepEqual(result.hosts.antigravity.modified, [skill]);
    assert.equal(await readFile(join(skill, "late.md"), "utf8"), "late\n");
    assert.deepEqual(leftoverNames(await snapshot(install.temp)), []);
    assert.equal(pathExists(install.manifestPath), true);
  });
});

test("running twice gives the same result", async () => {
  await withLegacyInstall({}, async (install) => {
    const first = await runLegacyRemoval({ env: install.env, now: NOW, host: "claude" });
    const afterFirst = await snapshot(install.temp, ["home/.claude/fake-claude.log"]);
    const second = await runLegacyRemoval({ env: install.env, now: at(MINUTE), host: "claude" });
    assert.equal(second.status, "unchanged");
    assert.equal(second.hosts.claude.missing, first.hosts.claude.removed.length);
    assert.deepEqual(await snapshot(install.temp, ["home/.claude/fake-claude.log"]), afterFirst, "an unchanged run keeps the completed report");
    assert.equal((await reports(install)).claude.id, first.hosts.claude.id);

    await runLegacyRemoval({ env: install.env, now: NOW, host: "all" });
    const done = await snapshot(install.temp, ["home/.claude/fake-claude.log"]);
    assert.equal((await runLegacyRemoval({ env: install.env, now: NOW, host: "all" })).status, "none");
    assert.deepEqual(await snapshot(install.temp, ["home/.claude/fake-claude.log"]), done);
  });
});

test("the CLI: --dry-run writes nothing, run needs --host or --all, and run --host removes that host", async () => {
  await withLegacyInstall({}, async (install) => {
    const cli = (...args) => spawnSync(process.execPath, [migrationScript, ...args], { encoding: "utf8", env: install.env });
    const before = await snapshot(install.temp);
    const dryRun = cli("run", "--all", "--dry-run", "--json");
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const plan = JSON.parse(dryRun.stdout).plan;
    assert.equal(plan.status, "ready");
    assert.ok(plan.targets.every((target) => target.state === "verified"));
    assert.equal(plan.coreRemovedWhenDone, true);
    const status = cli("status", "--json");
    assert.equal(status.status, 0, status.stderr);
    for (const args of [["run"], ["run", "--host", "unknown"], ["run", "--host", "claude", "--all"], ["status", "--dry-run"], ["remove"]]) {
      const result = cli(...args);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, /^Pota migrate error: /);
    }
    assert.deepEqual(await snapshot(install.temp), before);

    const run = cli("run", "--host", "antigravity", "--json");
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).hosts.antigravity.status, "completed");
    for (const record of install.hostTargets("antigravity")) assert.equal(pathExists(record.path), false, record.path);
    assert.equal(pathExists(install.target("claude-plugin").path), true);
  });
});

test("SessionStart starts one detached runner per manifest, host, and environment and stays quiet otherwise", async (t) => {
  await t.test("no manifest, an unknown host, or POTA_LEGACY_MIGRATION=0 does nothing", async () => {
    const temp = await mkdtemp(join(tmpdir(), "pota-legacy-none-"));
    try {
      const env = isolatedEnv(temp, join(temp, "home"));
      const { calls, spawn } = fakeSpawn();
      assert.deepEqual(sessionStartMigration({ env, now: NOW, spawn, pluginRoot, host: "claude" }), { notice: null, spawned: false });
      assert.equal(calls.length, 0);
      assert.equal(pathExists(join(env.POTA_HOME, "migration")), false);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    await withLegacyInstall({}, async (install) => {
      const { calls, spawn } = fakeSpawn();
      for (const [env, host] of [[{ ...install.env, POTA_LEGACY_MIGRATION: "0" }, "claude"], [{ ...install.env, POTA_LEGACY_MIGRATION: " Off " }, "codex"], [install.env, "unknown"]]) {
        assert.deepEqual(sessionStartMigration({ env, now: NOW, spawn, pluginRoot, host }), { notice: null, spawned: false });
      }
      assert.equal(calls.length, 0);
      assert.equal(pathExists(join(install.env.POTA_HOME, "migration")), false);
    });
  });

  await t.test("first session spawns and says so; reruns are silent and spaced", () => withLegacyInstall({}, async (install) => {
    const { calls, spawn } = fakeSpawn();
    const detect = (now, host = "claude") => sessionStartMigration({ env: install.env, now, spawn, pluginRoot, host });
    const first = detect(NOW);
    assert.equal(first.spawned, true);
    assert.deepEqual(first.notice, { kind: "removing", doctor });
    assert.equal(migrationNoticeLine({ notice: first.notice }), "Pota: removing the legacy npm install in the background. Legacy Pota hooks and commands stop working in this session; restart it when convenient.");
    assert.deepEqual(calls[0], {
      command: process.execPath,
      args: [join(pluginRoot, "scripts", "pota-legacy-migration.mjs"), "run", "--host", "claude"],
      options: { detached: true, stdio: "ignore", windowsHide: true },
    });
    assert.deepEqual(detect(at(MINUTE)), { notice: null, spawned: false });
    assert.deepEqual(detect(at(9 * MINUTE)), { notice: null, spawned: false });
    assert.deepEqual(detect(at(10 * MINUTE)), { notice: null, spawned: true }, "no report 10 minutes after the spawn");
    const codex = detect(at(11 * MINUTE), "codex");
    assert.equal(codex.notice.kind, "removing", "another host has its own run");
    assert.equal(calls.length, 3);
  }));

  await t.test("a completed report is announced once in that host's session", () => withLegacyInstall({}, async (install) => {
    const { calls, spawn } = fakeSpawn();
    sessionStartMigration({ env: install.env, now: NOW, spawn, pluginRoot, host: "claude" });
    await runLegacyRemoval({ env: install.env, now: at(MINUTE), host: "claude" });
    const shown = sessionStartMigration({ env: install.env, now: at(2 * MINUTE), spawn, pluginRoot, host: "claude" });
    assert.equal(shown.spawned, false);
    assert.equal(migrationNoticeLine({ notice: shown.notice }), `Pota: removed the legacy npm install (1.4.0). Other hosts need the plugin: Codex, Antigravity. Details: ${doctor}`);
    assert.equal(sessionStartMigration({ env: install.env, now: at(3 * MINUTE), spawn, pluginRoot, host: "claude" }).notice, null);
    assert.equal(sessionStartMigration({ env: install.env, now: at(20 * MINUTE), spawn, pluginRoot, host: "claude" }).spawned, false);
    assert.equal(calls.length, 1);
  }));

  await t.test("a blocked report is announced at most every 7 days and retried after 24 hours", () => withLegacyInstall({ env: { POTA_CLAUDE_CLI: "none" } }, async (install) => {
    const { calls, spawn } = fakeSpawn();
    const detect = (now) => sessionStartMigration({ env: install.env, now, spawn, pluginRoot, host: "claude" });
    detect(NOW);
    await runLegacyRemoval({ env: install.env, now: at(MINUTE), host: "claude" });
    const blocked = detect(at(2 * MINUTE));
    assert.equal(migrationNoticeLine({ notice: blocked.notice }), `Pota: could not remove the legacy npm install (host-unregister-failed). Run npx @comento/pota-harness@1.5.0 uninstall, then restart. Details: ${doctor}`);
    assert.deepEqual(detect(at(HOUR)), { notice: null, spawned: false });
    assert.deepEqual(detect(at(DAY + 2 * MINUTE)), { notice: null, spawned: true }, "retried silently after 24 hours");
    assert.equal(detect(at(7 * DAY + 3 * MINUTE)).notice?.kind, "blocked");
    assert.equal(calls.length, 3);
  }));
});

test("notice lines stay within 240 characters in English and Korean", () => {
  const notices = [
    { kind: "removing", doctor },
    { kind: "removed", version: "1.4.0", kept: 12, hosts: ["Codex", "Antigravity"], doctor },
    { kind: "removed", version: "1.4.0", kept: 0, hosts: [], doctor },
    { kind: "blocked", reason: "manifest-unsupported-schema", doctor },
    { kind: "blocked", reason: "host-unregister-failed", doctor },
  ];
  for (const ko of [false, true]) {
    for (const notice of notices) {
      const line = migrationNoticeLine({ ko, notice });
      assert.ok(line.startsWith("Pota: "), line);
      assert.ok(line.length <= 240, `${line.length}: ${line}`);
    }
  }
  assert.equal(migrationNoticeLine({ notice: { kind: "removed", version: "1.4.0", kept: 2, hosts: ["Codex"], doctor } }),
    `Pota: removed the legacy npm install (1.4.0). Kept 2 modified items; other hosts need the plugin: Codex. Details: ${doctor}`);
  assert.equal(migrationNoticeLine({ notice: { kind: "removed", version: "1.4.0", kept: 0, hosts: [], doctor } }),
    `Pota: removed the legacy npm install (1.4.0). Details: ${doctor}`);
  assert.equal(migrationNoticeLine({ notice: null }), "");
});

test("hostOfId in the test support agrees with the fixture's phases", async () => {
  const manifest = await fixtureManifest(join(tmpdir(), "home"));
  for (const record of manifest.targets) assert.equal(record.phase === "config" ? "codex" : record.phase, hostOfId(record.id), record.id);
});
