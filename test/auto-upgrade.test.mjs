import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { startGoal } from "../scripts/pota-goal.mjs";
import { targetDigest } from "../scripts/pota-lifecycle.mjs";
import { createRuntimeLocator } from "../scripts/pota-paths.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import { AUTO_UPGRADE_EXIT, checkDue, readInstallManifest, updatePaths } from "../scripts/pota-update-state.mjs";

const root = resolve(".");
const fakeClaudeCli = join(root, "test", "fixtures", "fake-claude.mjs");
const fakeNpmCli = join(root, "test", "fixtures", "fake-npm.mjs");
const lifecycleScript = join(root, "scripts", "pota-lifecycle.mjs");
const runnerScript = join(root, "scripts", "pota-auto-upgrade.mjs");
const stateScript = join(root, "scripts", "pota-state.mjs");
const rootCli = join(root, "scripts", "pota.mjs");
const releaseVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const olderVersion = "0.0.1";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const sessionId = "auto-upgrade-session";

// In-process hooks keep goal state in a private POTA_HOME; the update step receives each test's env explicitly.
const goalStateHome = await mkdtemp(join(tmpdir(), "pota-auto-upgrade-goals-"));
const previousPotaHome = process.env.POTA_HOME;
process.env.POTA_HOME = goalStateHome;
after(async () => {
  if (previousPotaHome === undefined) delete process.env.POTA_HOME;
  else process.env.POTA_HOME = previousPotaHome;
  await rm(goalStateHome, { recursive: true, force: true });
});

test("SessionStart from a source checkout never reads or writes update state", async () => {
  await withEnv(async ({ temp, env, paths }) => {
    const spawn = spawnRecorder();
    const baseline = await hookAt(env, paths, root, { spawn });
    await synthesizeInstall(env, { installedAt: daysAgo(3) });
    await writeJson(paths.state, updateState({ lastCheckedAt: daysAgo(3) }));
    await writeJson(paths.notice, notice("failed", olderVersion, releaseVersion));
    const before = await treeSnapshot(paths.update);

    assert.deepEqual(await hookAt(env, paths, root, { spawn }), baseline);
    assert.equal(spawn.calls.length, 0);
    assert.deepEqual(await treeSnapshot(paths.update), before);

    // The repository's own hook script, run as a host would run it.
    const input = JSON.stringify({ cwd: paths.project, session_id: sessionId });
    const withUpdate = spawnSync(process.execPath, [stateScript, "session-start"], { cwd: paths.project, env, input, encoding: "utf8" });
    const emptyHome = { ...env, POTA_HOME: join(temp, "empty-pota-home") };
    const withoutUpdate = spawnSync(process.execPath, [stateScript, "session-start"], { cwd: paths.project, env: emptyHome, input, encoding: "utf8" });
    assert.equal(withUpdate.status, 0, withUpdate.stderr);
    assert.equal(withUpdate.stdout, withoutUpdate.stdout);
    assert.deepEqual(await treeSnapshot(paths.update), before);
  });
});

test("SessionStart from an installed runtime spawns a detached runner only when a check is due", async () => {
  await withEnv(async ({ env, paths }) => {
    const runtime = await synthesizeInstall(env, { installedAt: daysAgo(2) });
    const due = spawnRecorder();
    await hookAt(env, paths, runtime, { spawn: due });
    assert.equal(due.calls.length, 1);
    const [command, args, options] = due.calls[0];
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [join(runtime, "scripts", "pota-auto-upgrade.mjs"), "run"]);
    assert.equal(options.detached, true);
    assert.equal(options.stdio, "ignore");
    assert.equal(options.windowsHide, true);
    assert.equal(options.cwd, env.POTA_HOME);
    assert.equal(due.children[0].unrefCalled, true);
    assert.equal(due.children[0].listenerCount("error"), 1);

    const notDue = async (label) => {
      const spawn = spawnRecorder();
      await hookAt(env, paths, runtime, { spawn });
      assert.equal(spawn.calls.length, 0, label);
    };
    await synthesizeInstall(env, { installedAt: new Date().toISOString() });
    await notDue("a fresh installation waits 24 hours");
    await synthesizeInstall(env, { installedAt: daysAgo(2) });
    await writeJson(paths.state, updateState({ lastCheckedAt: new Date(Date.now() - HOUR).toISOString() }));
    await notDue("a recent check");
    await writeJson(paths.state, updateState({ lastCheckedAt: daysAgo(2), nextAttemptAt: new Date(Date.now() + HOUR).toISOString() }));
    await notDue("a future nextAttemptAt");
    await writeJson(paths.state, updateState({ lastCheckedAt: daysAgo(2) }));
    const control = spawnRecorder();
    await hookAt(env, paths, runtime, { spawn: control });
    assert.equal(control.calls.length, 1, "an old check is due again");
    const disabled = spawnRecorder();
    await hookAt({ ...env, POTA_AUTO_UPGRADE: "0" }, paths, runtime, { spawn: disabled });
    assert.equal(disabled.calls.length, 0, "turned off");
    await synthesizeInstall(env, { installedAt: daysAgo(2), origin: "checkout" });
    await notDue("a checkout-origin installation");
    // A retained runtime of another version never starts a runner.
    await synthesizeInstall(env, { installedAt: daysAgo(2) });
    const retained = await synthesizeRuntime(env, olderVersion);
    const fromRetained = spawnRecorder();
    await hookAt(env, paths, retained, { spawn: fromRetained });
    assert.equal(fromRetained.calls.length, 0);
  });
});

test("auto-upgrade is off for POTA_AUTO_UPGRADE=0, for config autoUpgrade false, and for an unreadable config", async () => {
  await withEnv(async ({ env, paths }) => {
    const runtime = await synthesizeInstall(env, { installedAt: daysAgo(2) });
    const spawned = async (hookEnv) => {
      const spawn = spawnRecorder();
      await hookAt(hookEnv, paths, runtime, { spawn });
      return spawn.calls.length;
    };
    assert.equal(await spawned(env), 1);
    for (const value of ["0", "false", "off", "no", "OFF"]) assert.equal(await spawned({ ...env, POTA_AUTO_UPGRADE: value }), 0, value);
    for (const [label, content, expected] of [
      ["autoUpgrade false", '{ "autoUpgrade": false }\n', 0],
      ["not JSON", "{ autoUpgrade: ", 0],
      ["not an object", "[]\n", 0],
      ["not a boolean", '{ "autoUpgrade": "no" }\n', 0],
      ["autoUpgrade true", '{ "autoUpgrade": true }\n', 1],
      ["other settings only", '{ "theme": "dark" }\n', 1],
    ]) {
      await writeFile(paths.config, content);
      assert.equal(await spawned(env), expected, label);
    }
    await rm(paths.config, { force: true });
    await mkdir(paths.config);
    assert.equal(await spawned(env), 0, "an unreadable config");
    await rm(paths.config, { recursive: true, force: true });

    // The runner checks the setting again before it calls npm.
    const result = runRunner({ ...env, POTA_AUTO_UPGRADE: "off" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).reason, "disabled");
    assert.deepEqual(await npmCalls(env), []);
  });
});

test("the runner upgrades an older installation and writes one updated notice", async () => {
  await withEnv(async ({ env, paths }) => {
    await installOlderPackage(env, paths, olderVersion);
    const result = runRunner(env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal((await readJson(paths.ownership)).version, releaseVersion);
    assert.equal((await readJson(paths.ownership)).origin, "package", "a staged registry package is never a checkout");
    const calls = await npmCalls(env);
    assert.deepEqual(calls.map((call) => call.args), [
      ["view", "@comento/pota-harness@latest", "version", "--json"],
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", `@comento/pota-harness@${releaseVersion}`],
    ]);
    // The scoped package spec is the only argument that may contain a slash.
    for (const call of calls) for (const arg of call.args) assert.doesNotMatch(arg.replace(/^@comento\/pota-harness@/, ""), /[\\/]/, "npm arguments never carry paths");
    // The stage is gone by now; compare its parent through realpath so a Windows 8.3 short temp path still matches.
    assert.equal(basename(calls[1].cwd), "stage");
    assert.equal(await realpath(dirname(calls[1].cwd)), await realpath(paths.update));
    const written = await readJson(paths.notice);
    assert.equal(written.kind, "updated");
    assert.equal(written.from, olderVersion);
    assert.equal(written.to, releaseVersion);
    const state = await readJson(paths.state);
    assert.equal(state.lastResult.kind, "updated");
    assert.equal(state.latestSeen, releaseVersion);
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(state.nextAttemptAt, null);
    await assert.rejects(lstat(paths.stage), { code: "ENOENT" });
    await stat(join(paths.runtime, "scripts", "pota-auto-upgrade.mjs"));
    assert.ok((await stat(paths.log)).size <= 64 * 1024);
  });
});

test("the runner does nothing when the installed version is equal or higher and never downgrades", async () => {
  await withEnv(async ({ env, paths }) => {
    for (const installed of [releaseVersion, "99.0.0"]) {
      await synthesizeInstall(env, { version: installed, installedAt: daysAgo(2) });
      await rm(paths.update, { recursive: true, force: true });
      await rm(env.FAKE_NPM_LOG, { force: true });
      const manifest = await readFile(paths.ownership, "utf8");
      const result = runRunner(env);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual((await npmCalls(env)).map((call) => call.args[0]), ["view"], installed);
      assert.equal(await readFile(paths.ownership, "utf8"), manifest);
      const state = await readJson(paths.state);
      assert.equal(state.lastResult.kind, "current");
      assert.equal(state.latestSeen, releaseVersion);
      assert.ok(Date.parse(state.lastCheckedAt) > Date.now() - HOUR);
      await assert.rejects(lstat(paths.notice), { code: "ENOENT" });
    }
  });
});

test("the runner upgrades a prerelease install to the same core release", async () => {
  await withEnv(async ({ env, paths }) => {
    await installOlderPackage(env, paths, `${releaseVersion}-rc.1`);
    const result = runRunner(env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal((await readJson(paths.ownership)).version, releaseVersion);
    const written = await readJson(paths.notice);
    assert.equal(written.kind, "updated");
    assert.equal(written.from, `${releaseVersion}-rc.1`);
  });
});

test("the runner rejects an invalid registry answer", async () => {
  await withEnv(async ({ env, paths }) => {
    await synthesizeInstall(env, { version: olderVersion, installedAt: daysAgo(2) });
    for (const [label, extra] of [
      ["prerelease", { FAKE_NPM_LATEST: `${releaseVersion}-beta.1` }],
      ["build metadata", { FAKE_NPM_LATEST: `${releaseVersion}+build.1` }],
      ["not semver", { FAKE_NPM_LATEST: "latest" }],
      ["two parts", { FAKE_NPM_LATEST: "1.2" }],
      ["too long", { FAKE_NPM_LATEST: `${"1".repeat(30)}.0.0` }],
      ["not JSON", { FAKE_NPM_LATEST: "1.2.3", FAKE_NPM_VIEW_RAW: "1" }],
      ["empty", { FAKE_NPM_LATEST: "", FAKE_NPM_VIEW_RAW: "1" }],
      ["array", { FAKE_NPM_LATEST: '["1.2.3"]', FAKE_NPM_VIEW_RAW: "1" }],
    ]) {
      await rm(paths.update, { recursive: true, force: true });
      await rm(env.FAKE_NPM_LOG, { force: true });
      const result = runRunner({ ...env, ...extra });
      assert.equal(result.status, 1, `${label}\n${result.stdout}${result.stderr}`);
      assert.deepEqual((await npmCalls(env)).map((call) => call.args[0]), ["view"], label);
      assert.equal((await readJson(paths.state)).lastResult.kind, "check-failed", label);
      await assert.rejects(lstat(paths.notice), { code: "ENOENT" }, label);
    }
    // npm 12 may answer with an object; its version field is read.
    await synthesizeInstall(env, { version: releaseVersion, installedAt: daysAgo(2) });
    await rm(paths.update, { recursive: true, force: true });
    const objectAnswer = runRunner({ ...env, FAKE_NPM_LATEST: JSON.stringify({ version: releaseVersion }), FAKE_NPM_VIEW_RAW: "1" });
    assert.equal(objectAnswer.status, 0, objectAnswer.stdout + objectAnswer.stderr);
    assert.equal((await readJson(paths.state)).lastResult.kind, "current");
  });
});

test("the runner refuses a staged package that fails verification", async () => {
  await withEnv(async ({ env, paths }) => {
    await synthesizeInstall(env, { version: olderVersion, installedAt: daysAgo(2) });
    const manifest = await readFile(paths.ownership, "utf8");
    for (const tamper of ["name", "version", "symlink", "extra-package"]) {
      await rm(paths.update, { recursive: true, force: true });
      await rm(env.FAKE_NPM_LOG, { force: true });
      const result = runRunner({ ...env, FAKE_NPM_TAMPER: tamper });
      assert.equal(result.status, 1, `${tamper}\n${result.stdout}${result.stderr}`);
      assert.deepEqual((await npmCalls(env)).map((call) => call.args[0]), ["view", "install"], tamper);
      assert.equal(await readFile(paths.ownership, "utf8"), manifest, `${tamper}: lifecycle never ran`);
      await assert.rejects(lstat(paths.runtime), { code: "ENOENT" });
      const state = await readJson(paths.state);
      assert.equal(state.lastResult.kind, "failed", tamper);
      assert.match(state.lastResult.detail, /verification/, tamper);
      assert.equal(state.failedVersion, releaseVersion);
      assert.equal((await readJson(paths.notice)).kind, "failed", tamper);
      await assert.rejects(lstat(paths.stage), { code: "ENOENT" });
    }
  });
});

test("registry and install failures back off silently", async () => {
  await withEnv(async ({ env, paths }) => {
    await synthesizeInstall(env, { version: olderVersion, installedAt: daysAgo(2) });
    const viewFails = { ...env, FAKE_NPM_FAIL: "view" };
    const expectBackoff = async (failures, delay) => {
      const state = await readJson(paths.state);
      assert.equal(state.lastResult.kind, "check-failed");
      assert.equal(state.consecutiveFailures, failures);
      assert.equal(Date.parse(state.nextAttemptAt) - Date.parse(state.lastResult.at), delay);
      assert.equal(state.lastCheckedAt, null);
      await assert.rejects(lstat(paths.notice), { code: "ENOENT" });
    };
    assert.equal(runRunner(viewFails).status, 1);
    await expectBackoff(1, HOUR);
    assert.equal(runRunner(viewFails).status, 1);
    await expectBackoff(2, 2 * HOUR);
    await writeJson(paths.state, { ...(await readJson(paths.state)), consecutiveFailures: 12 });
    assert.equal(runRunner(viewFails).status, 1);
    await expectBackoff(13, DAY);

    await rm(paths.update, { recursive: true, force: true });
    await rm(env.FAKE_NPM_LOG, { force: true });
    assert.equal(runRunner({ ...env, FAKE_NPM_FAIL: "install" }).status, 1);
    assert.deepEqual((await npmCalls(env)).map((call) => call.args[0]), ["view", "install"]);
    await expectBackoff(1, HOUR);
    await assert.rejects(lstat(paths.stage), { code: "ENOENT" });
  });
});

test("a failed lifecycle upgrade writes one failed notice per version and backs off", async () => {
  await withEnv(async ({ env, paths }) => {
    const [oldRuntime] = await installOlderPackage(env, paths, olderVersion);
    await writeFile(join(oldRuntime, "README.md"), "locally modified\n");
    assert.equal(runRunner(env).status, 1);
    assert.equal((await readJson(paths.ownership)).version, olderVersion);
    const first = await readJson(paths.notice);
    assert.equal(first.kind, "failed");
    assert.equal(first.to, releaseVersion);
    let state = await readJson(paths.state);
    assert.equal(state.lastResult.kind, "failed");
    assert.equal(state.failedVersion, releaseVersion);
    assert.equal(state.consecutiveFailures, 1);
    assert.equal(Date.parse(state.nextAttemptAt) - Date.parse(state.lastResult.at), DAY);
    assert.match(await readFile(paths.log, "utf8"), /Managed artifact was modified/);

    await rm(paths.notice);
    assert.equal(runRunner(env).status, 1);
    await assert.rejects(lstat(paths.notice), { code: "ENOENT" }, "one failed notice per version");
    state = await readJson(paths.state);
    assert.equal(state.consecutiveFailures, 2);
    assert.equal(Date.parse(state.nextAttemptAt) - Date.parse(state.lastResult.at), 2 * DAY);

    await writeJson(paths.state, { ...state, consecutiveFailures: 9 });
    assert.equal(runRunner(env).status, 1);
    state = await readJson(paths.state);
    assert.equal(Date.parse(state.nextAttemptAt) - Date.parse(state.lastResult.at), 7 * DAY);
    await assert.rejects(lstat(paths.notice), { code: "ENOENT" });
  });
});

test("an upgrade whose Claude cache refresh fails writes a manual notice", async () => {
  await withEnv(async ({ env, paths }) => {
    await installOlderPackage(env, paths, olderVersion);
    const claudeState = join(env.CLAUDE_HOME, "fake-claude-state.json");
    const registered = await readJson(claudeState);
    for (const plugin of registered.plugins) plugin.version = olderVersion;
    await writeJson(claudeState, registered);

    const result = runRunner({ ...env, FAKE_CLAUDE_FAIL: "plugin update" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal((await readJson(paths.ownership)).version, releaseVersion);
    const written = await readJson(paths.notice);
    assert.equal(written.kind, "manual");
    assert.equal(written.to, releaseVersion);
    assert.equal((await readJson(paths.state)).lastResult.kind, "manual");
    assert.match(await readFile(paths.log, "utf8"), /Claude Code plugin cache refresh failed/);
  });
});

test("upgrade --auto exits with the manual code when Claude Code is selected but the claude CLI is missing", async () => {
  await withEnv(async ({ env }) => {
    assert.equal(runLifecycle(["install"], env).status, 0);
    const noClaude = { ...env, POTA_CLAUDE_CLI: "none" };
    const manual = runLifecycle(["upgrade"], noClaude);
    assert.equal(manual.status, 0, manual.stdout + manual.stderr);
    assert.match(manual.stdout, /Claude Code plugin not registered: claude CLI not found/);
    const auto = runLifecycle(["upgrade", "--auto"], noClaude);
    assert.equal(auto.status, AUTO_UPGRADE_EXIT.manual, auto.stdout + auto.stderr);
    assert.match(auto.stdout, /Claude Code plugin not registered: claude CLI not found/);

    const codexOnly = runLifecycle(["upgrade", "--hosts", "codex"], env);
    assert.equal(codexOnly.status, 0, codexOnly.stdout + codexOnly.stderr);
    assert.equal(runLifecycle(["upgrade", "--auto"], noClaude).status, 0, "Claude Code is not selected");
  });
});

test("upgrade --auto exits with the manual code for a failed Claude cache refresh and 0 for a foreign pota marketplace", async () => {
  await withEnv(async ({ env, paths, temp }) => {
    await installOlderPackage(env, paths, olderVersion);
    const claudeState = join(env.CLAUDE_HOME, "fake-claude-state.json");
    const registered = await readJson(claudeState);
    for (const plugin of registered.plugins) plugin.version = olderVersion;
    await writeJson(claudeState, registered);
    const refresh = runLifecycle(["upgrade", "--auto"], { ...env, FAKE_CLAUDE_FAIL: "plugin update" });
    assert.equal(refresh.status, AUTO_UPGRADE_EXIT.manual, refresh.stdout + refresh.stderr);
    assert.match(refresh.stdout, /Claude Code plugin cache refresh failed/);
    // Without --auto the same failure keeps exit 1.
    const plain = runLifecycle(["upgrade"], { ...env, FAKE_CLAUDE_FAIL: "plugin update" });
    assert.equal(plain.status, 1, plain.stdout + plain.stderr);

    const foreign = { marketplaces: [{ name: "pota", source: "directory", path: join(temp, "someone-else") }], plugins: [] };
    await writeJson(claudeState, foreign);
    const auto = runLifecycle(["upgrade", "--auto"], env);
    assert.equal(auto.status, 0, auto.stdout + auto.stderr);
    assert.match(auto.stdout, /Claude Code plugin not registered: a different Claude Code marketplace named "pota" already exists/);
    assert.deepEqual(await readJson(claudeState), foreign);
  });
});

test("the runner writes a manual notice when the claude CLI is missing", async () => {
  await withEnv(async ({ env, paths }) => {
    await installOlderPackage(env, paths, olderVersion);
    const result = runRunner({ ...env, POTA_CLAUDE_CLI: "none" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal((await readJson(paths.ownership)).version, releaseVersion);
    assert.equal((await readJson(paths.notice)).kind, "manual");
    const state = await readJson(paths.state);
    assert.equal(state.lastResult.kind, "manual");
    assert.match(state.lastResult.detail, /claude CLI not found/);
  });
});

test("the runner counts a foreign pota Claude Code marketplace as a completed upgrade", async () => {
  await withEnv(async ({ env, paths, temp }) => {
    await installOlderPackage(env, paths, olderVersion);
    const foreign = { marketplaces: [{ name: "pota", source: "directory", path: join(temp, "someone-else") }], plugins: [] };
    await writeJson(join(env.CLAUDE_HOME, "fake-claude-state.json"), foreign);
    const result = runRunner(env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal((await readJson(paths.ownership)).version, releaseVersion);
    assert.equal((await readJson(paths.notice)).kind, "updated");
    assert.equal((await readJson(paths.state)).lastResult.kind, "updated");
    assert.deepEqual(await readJson(join(env.CLAUDE_HOME, "fake-claude-state.json")), foreign);
  });
});

test("an error after the upgrade commits writes one failed notice and is not retried", async () => {
  await withEnv(async ({ env, paths }) => {
    await installOlderPackage(env, paths, olderVersion);
    const failed = runRunner({ ...env, POTA_TEST_FAIL_PHASE: "after-commit" });
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.equal((await readJson(paths.ownership)).version, releaseVersion);
    assert.equal((await readJson(paths.notice)).kind, "failed");
    const state = await readJson(paths.state);
    assert.equal(state.lastResult.kind, "failed");
    assert.match(state.lastResult.detail, /after its commit: .*Injected lifecycle failure: after-commit/);
    assert.equal(Date.parse(state.nextAttemptAt) - Date.parse(state.lastResult.at), DAY);

    await rm(paths.notice);
    await rm(env.FAKE_NPM_LOG, { force: true });
    const next = runRunner(env);
    assert.equal(next.status, 0, next.stdout + next.stderr);
    assert.deepEqual((await npmCalls(env)).map((call) => call.args[0]), ["view"], next.stdout + next.stderr);
    assert.equal((await readJson(paths.state)).lastResult.kind, "current");
    await assert.rejects(lstat(paths.notice), { code: "ENOENT" });
  });
});

test("a runner whose installation was uninstalled meanwhile writes no state or notice and removes update state", async () => {
  await withEnv(async ({ env, paths }) => {
    await installOlderPackage(env, paths, olderVersion);
    await writeJson(paths.state, updateState({ lastCheckedAt: daysAgo(2) }));
    const result = runRunner({ ...env, FAKE_NPM_UNINSTALL_FIRST: lifecycleScript });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ran: false, reason: "not-installed" });
    assert.deepEqual((await npmCalls(env)).map((call) => call.args[0]), ["view", "install"]);
    // The refused lifecycle run installed nothing (its lock may leave an empty install directory, as any refused run does).
    assert.deepEqual(await filesUnder(paths.install), []);
    await assert.rejects(lstat(paths.update), { code: "ENOENT" });
  });
});

test("a stage that cannot be removed still records the result with a backoff", async (context) => {
  if (process.platform === "win32" || process.getuid?.() === 0) return context.skip("needs POSIX permissions that bind the current user");
  await withEnv(async ({ env, paths }) => {
    const [oldRuntime] = await installOlderPackage(env, paths, olderVersion);
    await writeFile(join(oldRuntime, "README.md"), "locally modified\n");
    const locked = { ...env, FAKE_NPM_LOCK_STAGE: "1" };
    const lockedScripts = join(paths.stage, "node_modules", "@comento", "pota-harness", "scripts");
    try {
      const first = runRunner(locked);
      assert.equal(first.status, 1, first.stdout + first.stderr);
      assert.equal(first.stderr, "");
      let state = await readJson(paths.state);
      assert.equal(state.lastResult.kind, "failed");
      assert.equal(Date.parse(state.nextAttemptAt) - Date.parse(state.lastResult.at), DAY);
      assert.equal((await readJson(paths.notice)).kind, "failed");
      assert.match(await readFile(paths.log, "utf8"), /stage removal failed/);
      await stat(lockedScripts);
      // The SessionStart hook does not start another runner during the backoff.
      assert.equal(checkDue({ state, manifest: readInstallManifest(updatePaths(env)), now: new Date() }), false);

      // The stage still cannot be removed: the next run records that with a backoff, without npm install or a notice.
      await rm(paths.notice);
      await rm(env.FAKE_NPM_LOG, { force: true });
      const second = runRunner(locked);
      assert.equal(second.status, 1, second.stdout + second.stderr);
      assert.equal(second.stderr, "");
      assert.deepEqual((await npmCalls(env)).map((call) => call.args[0]), ["view"]);
      state = await readJson(paths.state);
      assert.equal(state.lastResult.kind, "check-failed");
      assert.match(state.lastResult.detail, /unexpected error/);
      assert.ok(Date.parse(state.nextAttemptAt) > Date.now(), state.nextAttemptAt);
      await assert.rejects(lstat(paths.notice), { code: "ENOENT" });

      // Once the stage can be removed again, the same version fails without a second notice.
      await chmod(lockedScripts, 0o755);
      const third = runRunner(env);
      assert.equal(third.status, 1, third.stdout + third.stderr);
      assert.equal((await readJson(paths.state)).lastResult.kind, "failed");
      await assert.rejects(lstat(paths.notice), { code: "ENOENT" }, "one failed notice per version");
      await assert.rejects(lstat(paths.stage), { code: "ENOENT" });
    } finally {
      await chmod(lockedScripts, 0o755).catch(() => {});
    }
  });
});

test("a second runner exits while update.lock is held, and a stale update.lock from a dead pid is reclaimed", async () => {
  await withEnv(async ({ env, paths }) => {
    await synthesizeInstall(env, { installedAt: daysAgo(2) });
    await mkdir(paths.update, { recursive: true });
    const held = `${JSON.stringify(lockRecord(process.pid))}\n`;
    await writeFile(paths.lock, held);
    const blocked = runRunner(env, { expectLocked: true });
    assert.equal(blocked.status, 0, blocked.stdout + blocked.stderr);
    assert.equal(JSON.parse(blocked.stdout).reason, "locked");
    assert.deepEqual(await npmCalls(env), []);
    assert.equal(await readFile(paths.lock, "utf8"), held);

    const exited = spawnSync(process.execPath, ["-e", ""]);
    await writeFile(paths.lock, `${JSON.stringify(lockRecord(exited.pid))}\n`);
    const reclaimed = runRunner(env);
    assert.equal(reclaimed.status, 0, reclaimed.stdout + reclaimed.stderr);
    assert.deepEqual((await npmCalls(env)).map((call) => call.args[0]), ["view"]);
    await assert.rejects(lstat(paths.lock), { code: "ENOENT" });
  });
});

test("the runner skips a checkout-origin installation", async () => {
  await withEnv(async ({ env }) => {
    await synthesizeInstall(env, { version: olderVersion, installedAt: daysAgo(2), origin: "checkout" });
    const result = runRunner(env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).reason, "checkout");
    assert.deepEqual(await npmCalls(env), []);
  });
});

test("install from a git checkout records origin checkout", async () => {
  await withEnv(async ({ env, paths }) => {
    const result = runLifecycle(["install"], env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await readJson(paths.ownership)).origin, "checkout");
  });
});

test("upgrade --auto without an existing schema 2 manifest is refused and installs nothing", async () => {
  await withEnv(async ({ env }) => {
    const refused = runLifecycle(["upgrade", "--auto"], env);
    assert.equal(refused.status, 1);
    assert.equal(refused.stderr, "Pota lifecycle error: auto-upgrade requires an existing installation\n");
    assert.deepEqual(await filesUnder(env.POTA_HOME), []);
    assert.deepEqual(await filesUnder(env.CODEX_HOME), []);
    assert.deepEqual(await filesUnder(env.CLAUDE_HOME), []);
    for (const [args, message] of [
      [["install", "--auto"], "Lifecycle command install does not accept arguments: --auto"],
      [["upgrade", "--auto", "--auto"], "Lifecycle command upgrade does not accept arguments: --auto"],
      [["upgrade", "--auto", "--hosts", "all"], "--auto cannot be combined with --hosts"],
    ]) {
      const result = runLifecycle(args, env);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, `Pota lifecycle error: ${message}\n`);
    }
  });
});

test("the next SessionStart shows the notice once and only on the upgraded version", async () => {
  await withEnv(async ({ env, paths }) => {
    const current = await synthesizeInstall(env, { installedAt: new Date().toISOString() });
    const previous = await synthesizeRuntime(env, olderVersion);
    const shown = async (pluginRoot) => noticeOf(await hookAt(env, paths, pluginRoot));

    await writeJson(paths.notice, notice("updated", olderVersion, releaseVersion));
    assert.equal(await shown(previous), null, "a retained runtime does not consume updated");
    await stat(paths.notice);
    assert.match(await shown(current), new RegExp(`auto-upgraded ${escape(olderVersion)} → ${escape(releaseVersion)}`));
    await assert.rejects(lstat(paths.notice), { code: "ENOENT" });
    assert.equal(await shown(current), null, "only once");

    for (const kind of ["failed", "manual"]) {
      for (const pluginRoot of [previous, current]) {
        await writeJson(paths.notice, notice(kind, olderVersion, releaseVersion));
        assert.ok(await shown(pluginRoot), `${kind} on ${pluginRoot}`);
        assert.equal(await shown(pluginRoot), null, `${kind} only once`);
      }
    }

    await writeJson(paths.notice, notice("failed", olderVersion, releaseVersion, daysAgo(15)));
    assert.equal(await shown(current), null, "a notice older than 14 days is not shown");
    await assert.rejects(lstat(paths.notice), { code: "ENOENT" });
  });
});

test("the notice is appended after the Pota CLI line and mirrored in systemMessage", async () => {
  await withEnv(async ({ env, paths }) => {
    const runtime = await synthesizeInstall(env, { installedAt: new Date().toISOString() });
    for (const [locale, pattern] of [["en-US", /^Pota update: auto-upgraded /], ["ko-KR", /^Pota 업데이트: .* 자동 업그레이드되었습니다\./]]) {
      await writeJson(paths.notice, notice("updated", olderVersion, releaseVersion));
      const result = await hookAt(env, paths, runtime, { locale });
      const lines = result.hookOutput.hookSpecificOutput.additionalContext.split("\n");
      assert.match(lines.at(-1), pattern);
      assert.match(lines.at(-2), /^Pota CLI: node /);
      assert.equal(result.hookOutput.systemMessage, lines.at(-1));
      assert.equal(result.message.split("\n").at(-1), lines.at(-1));
      assert.equal(result.status, 0);
    }

    // A foreign capsule carries the notice too: it is installation information, not the owner's work.
    await startGoal({
      root: paths.project, goal: "Owned elsewhere", planId: "docs/plan/foreign.md", ownerSessionId: "another-session",
      tasks: [{ id: "only", title: "Only task" }],
    });
    await writeJson(paths.notice, notice("manual", olderVersion, releaseVersion));
    const foreign = await hookAt(env, paths, runtime);
    const context = foreign.hookOutput.hookSpecificOutput.additionalContext;
    assert.match(context, /owned by another session/);
    assert.match(context.split("\n").at(-1), /^Pota update: .* plugin cache was not refreshed/);
    assert.equal(foreign.hookOutput.systemMessage, context.split("\n").at(-1));
  });
});

test("capsules without a notice are unchanged", async () => {
  await withEnv(async ({ env, paths }) => {
    const runtime = await synthesizeInstall(env, { installedAt: new Date().toISOString() });
    for (const locale of ["en-US", "ko-KR"]) {
      const installed = await hookAt(env, paths, runtime, { locale });
      const checkout = await hookAt(env, paths, root, { locale });
      assert.deepEqual(installed, checkout, locale);
      assert.equal(installed.hookOutput.systemMessage, undefined);
    }
  });
});

test("an auto-upgrade hook error never changes the capsule or the exit code", async () => {
  await withEnv(async ({ env, paths }) => {
    const runtime = await synthesizeInstall(env, { installedAt: daysAgo(2) });
    const baseline = await hookAt(env, paths, root);
    await mkdir(paths.update, { recursive: true });

    await writeFile(paths.state, "{ corrupted");
    await writeFile(paths.notice, "not json");
    assert.deepEqual(await hookAt(env, paths, runtime), baseline, "corrupted state and notice");

    await writeFile(paths.notice, '{ "schemaVersion": 1, "kind": "unknown" }\n');
    const throwing = () => { throw new Error("spawn failed"); };
    assert.deepEqual(await hookAt(env, paths, runtime, { spawn: throwing }), baseline, "spawn throws");

    const failing = spawnRecorder();
    assert.deepEqual(await hookAt(env, paths, runtime, { spawn: failing }), baseline, "spawn emits error");
    assert.equal(failing.calls.length, 1);
    assert.doesNotThrow(() => failing.children[0].emit("error", new Error("ENOENT")));

    await rm(paths.update, { recursive: true, force: true });
    await mkdir(paths.notice, { recursive: true });
    assert.deepEqual(await hookAt(env, paths, runtime, { spawn: spawnRecorder() }), baseline, "notice is a directory");

    // An installed hook script with corrupted update files still exits 0 with the plain capsule.
    await cp(join(root, "scripts"), join(runtime, "scripts"), { recursive: true });
    await cp(join(root, "package.json"), join(runtime, "package.json"));
    await rm(paths.update, { recursive: true, force: true });
    await mkdir(paths.update, { recursive: true });
    await writeFile(paths.state, "{ corrupted");
    await writeFile(paths.notice, "not json");
    const input = JSON.stringify({ cwd: paths.project, session_id: sessionId });
    const hook = spawnSync(process.execPath, [join(runtime, "scripts", "pota-state.mjs"), "session-start"], {
      cwd: paths.project, env: { ...env, POTA_AUTO_UPGRADE: "0" }, input, encoding: "utf8",
    });
    assert.equal(hook.status, 0, hook.stderr);
    const output = JSON.parse(hook.stdout);
    assert.ok(output.hookSpecificOutput.additionalContext.startsWith("Pota kernel:"));
    assert.equal(output.systemMessage, undefined);
  });
});

test("pota auto-upgrade status|on|off reports JSON, writes config.json atomically, and rejects bad usage", async () => {
  await withEnv(async ({ env, paths }) => {
    const cli = (...args) => spawnSync(process.execPath, [rootCli, "auto-upgrade", ...args], { cwd: root, env, encoding: "utf8" });
    const status = cli("status");
    assert.equal(status.status, 0, status.stderr);
    const report = JSON.parse(status.stdout);
    assert.equal(report.enabled, true);
    assert.equal(report.source, "default");
    assert.equal(report.config, paths.config);
    await assert.rejects(lstat(paths.config), { code: "ENOENT" }, "status writes nothing");

    await writeJson(paths.config, { theme: "dark" });
    const off = cli("off");
    assert.equal(off.status, 0, off.stderr);
    assert.equal(JSON.parse(off.stdout).enabled, false);
    assert.deepEqual(await readJson(paths.config), { theme: "dark", autoUpgrade: false });
    assert.equal(JSON.parse(cli("status").stdout).enabled, false);
    const on = cli("on");
    assert.equal(on.status, 0, on.stderr);
    assert.deepEqual(await readJson(paths.config), { theme: "dark", autoUpgrade: true });
    assert.deepEqual((await readdir(env.POTA_HOME)).filter((name) => name.startsWith("config.json")), ["config.json"]);

    const envOff = spawnSync(process.execPath, [rootCli, "auto-upgrade", "status"], { cwd: root, env: { ...env, POTA_AUTO_UPGRADE: "no" }, encoding: "utf8" });
    assert.deepEqual([JSON.parse(envOff.stdout).enabled, JSON.parse(envOff.stdout).source], [false, "env"]);

    await writeFile(paths.config, "{ broken");
    assert.equal(JSON.parse(cli("status").stdout).source, "invalid-config");
    const unreadable = cli("on");
    assert.equal(unreadable.status, 1);
    assert.match(unreadable.stderr, /^Pota auto-upgrade error: .*config\.json/);
    assert.equal(await readFile(paths.config, "utf8"), "{ broken");

    const usage = "Usage: pota auto-upgrade status|on|off|run\n";
    for (const args of [[], ["--help"], ["help"]]) {
      const help = cli(...args);
      assert.deepEqual([help.status, help.stdout, help.stderr], [0, usage, ""], args.join(" "));
    }
    for (const [args, message] of [
      [["bogus"], "unknown command: bogus"],
      [["status", "extra"], "auto-upgrade status does not accept arguments: extra"],
      [["on", "--force"], "auto-upgrade on does not accept arguments: --force"],
    ]) {
      const result = cli(...args);
      assert.deepEqual([result.status, result.stdout, result.stderr], [2, "", `Pota auto-upgrade error: ${message}\n`], args.join(" "));
    }
  });
});

test("uninstall removes update state and keeps config.json and projects", async () => {
  await withEnv(async ({ env, paths }) => {
    assert.equal(runLifecycle(["install"], env).status, 0);
    await writeJson(paths.state, updateState({ lastCheckedAt: daysAgo(1) }));
    await writeJson(paths.notice, notice("failed", olderVersion, releaseVersion));
    await writeFile(paths.log, "previous run\n");
    await mkdir(join(paths.stage, "node_modules"), { recursive: true });
    await writeJson(paths.config, { autoUpgrade: false });
    const projectMarker = join(env.POTA_HOME, "projects", "marker.json");
    await writeJson(projectMarker, { kept: true });

    const result = runLifecycle(["uninstall"], env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await assert.rejects(lstat(paths.update), { code: "ENOENT" });
    assert.deepEqual(await readJson(paths.config), { autoUpgrade: false });
    assert.deepEqual(await readJson(projectMarker), { kept: true });
  });
});

test("an installed runtime's SessionStart starts the runner and the next SessionStart reports the upgrade", async () => {
  await withEnv(async ({ env, paths }) => {
    const [oldRuntime] = await installOlderPackage(env, paths, olderVersion);
    const input = JSON.stringify({ cwd: paths.project, session_id: sessionId });
    const hookEnv = { ...env, LANG: "en_US.UTF-8", LC_ALL: "", LC_MESSAGES: "" };
    const first = spawnSync(process.execPath, [join(oldRuntime, "scripts", "pota-state.mjs"), "session-start"], {
      cwd: paths.project, env: hookEnv, input, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(first.status, 0, first.stderr);
    assert.doesNotMatch(first.stdout, /Pota update:/);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !(await exists(paths.notice) && !(await exists(paths.lock)))) await delay(200);
    assert.equal(await exists(paths.notice), true, `no notice within 30 seconds: ${await readFile(paths.log, "utf8").catch(() => "")}`);
    assert.equal((await readJson(paths.notice)).kind, "updated");
    assert.equal((await readJson(paths.ownership)).version, releaseVersion);

    const next = spawnSync(process.execPath, [join(paths.runtime, "scripts", "pota-state.mjs"), "session-start"], {
      cwd: paths.project, env: hookEnv, input, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(next.status, 0, next.stderr);
    const output = JSON.parse(next.stdout);
    const lastLine = output.hookSpecificOutput.additionalContext.split("\n").at(-1);
    assert.equal(lastLine, `Pota update: auto-upgraded ${olderVersion} → ${releaseVersion}; this session runs ${releaseVersion}. Mention it to the user once.`);
    assert.equal(output.systemMessage, lastLine);
    await assert.rejects(lstat(paths.notice), { code: "ENOENT" });
  });
});

async function withEnv(fn) {
  const temp = await mkdtemp(join(tmpdir(), "pota-auto-upgrade-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("POTA_") || key.startsWith("FAKE_") || key === "CLAUDE_CONFIG_DIR") delete env[key];
  }
  Object.assign(env, {
    HOME: join(temp, "home"),
    POTA_HOME: join(temp, "pota-home"),
    CODEX_HOME: join(temp, "codex"),
    CLAUDE_HOME: join(temp, "claude"),
    POTA_CLAUDE_CLI: fakeClaudeCli,
    POTA_NPM_CLI: fakeNpmCli,
    FAKE_NPM_LOG: join(temp, "npm.log"),
    FAKE_NPM_LATEST: releaseVersion,
    ANTIGRAVITY_HOME: join(temp, "gemini", "config"),
    ANTIGRAVITY_CLI_HOME: join(temp, "gemini", "antigravity-cli"),
    CODEX_CONFIG_PATH: join(temp, "codex", "config.toml"),
  });
  const install = join(env.POTA_HOME, "install");
  const update = join(env.POTA_HOME, "update");
  const codexCache = join(env.CODEX_HOME, "plugins", "cache", "pota");
  const paths = {
    install,
    update,
    codexCache,
    ownership: join(install, "lifecycle.json"),
    runtime: join(install, "runtime", releaseVersion),
    versioned: join(codexCache, "pota", releaseVersion),
    source: join(install, "codex", "plugins", "pota"),
    state: join(update, "state.json"),
    notice: join(update, "notice.json"),
    log: join(update, "last-run.log"),
    lock: join(update, "update.lock"),
    stage: join(update, "stage"),
    config: join(env.POTA_HOME, "config.json"),
    project: join(temp, "project"),
  };
  await mkdir(paths.project, { recursive: true });
  try { await fn({ temp, env, paths }); } finally { await rm(temp, { recursive: true, force: true }); }
}

function hookAt(env, paths, pluginRoot, { spawn = spawnRecorder(), now = new Date(), locale = "en-US" } = {}) {
  return runStateResult("session-start", {
    root: paths.project,
    locale,
    payload: { cwd: paths.project, session_id: sessionId },
    update: { env, now, spawn, pluginRoot },
  });
}

function spawnRecorder() {
  const calls = [];
  const children = [];
  const spawn = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.unrefCalled = false;
    child.unref = () => { child.unrefCalled = true; };
    children.push(child);
    return child;
  };
  spawn.calls = calls;
  spawn.children = children;
  return spawn;
}

function noticeOf(result) {
  const line = result.hookOutput.hookSpecificOutput.additionalContext.split("\n").at(-1);
  return line.startsWith("Pota update:") ? line : null;
}

// A manifest and canonical runtime locator are all the hook reads; no lifecycle run is needed for the hook tests.
async function synthesizeInstall(env, { version = releaseVersion, installedAt, origin = "package" } = {}) {
  const runtime = await synthesizeRuntime(env, version);
  await writeJson(join(env.POTA_HOME, "install", "lifecycle.json"), {
    schemaVersion: 2, plugin: "pota", version, transactionId: randomUUID(), installedAt: installedAt ?? new Date().toISOString(),
    origin, hosts: ["codex", "claude", "antigravity"], targets: [], retained: [],
  });
  return runtime;
}

async function synthesizeRuntime(env, version) {
  const runtime = join(env.POTA_HOME, "install", "runtime", version);
  await writeJson(join(runtime, ".pota-runtime.json"), createRuntimeLocator(runtime));
  return runtime;
}

// Installs this checkout, rewrites it into an owned `version` installation (as the lifecycle tests do), and makes it
// a package install whose daily check is due.
async function installOlderPackage(env, paths, version) {
  const result = runLifecycle(["install"], env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const oldRuntimes = await rewriteOwnedVersion(paths, version);
  const ownership = await readJson(paths.ownership);
  ownership.origin = "package";
  ownership.installedAt = daysAgo(2);
  await writeJson(paths.ownership, ownership);
  return oldRuntimes;
}

async function rewriteOwnedVersion(paths, version) {
  const ownership = await readJson(paths.ownership);
  const oldRuntime = join(paths.install, "runtime", version);
  const oldCodexRuntime = join(paths.codexCache, "pota", version);
  await rename(paths.runtime, oldRuntime);
  await rename(paths.versioned, oldCodexRuntime);
  for (const record of ownership.targets) {
    if (record.id === "runtime") record.path = oldRuntime;
    if (record.id === "codex-runtime") record.path = oldCodexRuntime;
    await replaceTextInManagedTarget(record.path, paths.runtime, oldRuntime);
    await replaceTextInManagedTarget(record.path, paths.versioned, oldCodexRuntime);
  }
  for (const manifestPath of [
    join(paths.source, ".codex-plugin", "plugin.json"),
    join(paths.source, "package.json"),
    join(oldRuntime, ".codex-plugin", "plugin.json"),
    join(oldRuntime, "package.json"),
    join(oldCodexRuntime, ".codex-plugin", "plugin.json"),
    join(oldCodexRuntime, "package.json"),
  ]) {
    const manifest = await readJson(manifestPath);
    manifest.version = version;
    await writeJson(manifestPath, manifest);
  }
  ownership.version = version;
  for (const record of ownership.targets) record.installedDigest = await targetDigest(record.path, record.type);
  await writeJson(paths.ownership, ownership);
  return [oldRuntime, oldCodexRuntime];
}

async function replaceTextInManagedTarget(path, from, to) {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of await readdir(path, { withFileTypes: true })) await replaceTextInManagedTarget(join(path, entry.name), from, to);
    return;
  }
  const content = await readFile(path, "utf8");
  // JSON files hold Windows paths with escaped backslashes, so the escaped form is replaced as well.
  const escaped = (value) => JSON.stringify(value).slice(1, -1);
  const replaced = content.replaceAll(from, to).replaceAll(escaped(from), escaped(to));
  if (replaced !== content) await writeFile(path, replaced);
}

function runLifecycle(args, env) {
  return spawnSync(process.execPath, [lifecycleScript, ...args], { cwd: root, env, encoding: "utf8" });
}

// On Windows the update.lock a finished runner released can linger for a moment, so a "locked" answer is retried
// briefly unless the test holds the lock on purpose.
function runRunner(env, { expectLocked = false } = {}) {
  const run = () => spawnSync(process.execPath, [runnerScript, "run"], { cwd: root, env, encoding: "utf8", timeout: 120_000 });
  let result = run();
  for (let attempt = 0; !expectLocked && attempt < 20 && lockedAnswer(result); attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    result = run();
  }
  return result;
}

function lockedAnswer(result) {
  try { return JSON.parse(result.stdout).reason === "locked"; } catch { return false; }
}

async function npmCalls(env) {
  try {
    return (await readFile(env.FAKE_NPM_LOG, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function updateState(fields) {
  return {
    schemaVersion: 1, lastCheckedAt: null, latestSeen: null, consecutiveFailures: 0, nextAttemptAt: null,
    failedVersion: null, lastResult: null, ...fields,
  };
}

function notice(kind, from, to, at = new Date().toISOString()) {
  return { schemaVersion: 1, kind, from, to, at };
}

function lockRecord(pid) {
  return { schemaVersion: 1, pid, hostname: hostname(), nonce: randomUUID(), acquiredAt: new Date().toISOString() };
}

function daysAgo(days) {
  return new Date(Date.now() - days * DAY).toISOString();
}

async function treeSnapshot(directory) {
  const entries = {};
  async function walk(current) {
    let names;
    try { names = await readdir(current, { withFileTypes: true }); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
    for (const entry of names) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else entries[path] = await readFile(path, "utf8");
    }
  }
  await walk(directory);
  return entries;
}

async function filesUnder(directory) {
  return Object.keys(await treeSnapshot(directory));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path) {
  try { await lstat(path); return true; } catch { return false; }
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
