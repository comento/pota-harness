import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { trustedHookStates } from "../scripts/pota-lifecycle-config.mjs";
import { createLifecycleLock } from "../scripts/pota-lifecycle-lock.mjs";
import {
  DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS,
  parseCodexFeatureList,
  removePotaConfig,
  splitSections,
  targetDigest,
  updateConfig,
} from "../scripts/pota-lifecycle.mjs";

const fakeClaudeCli = resolve("test/fixtures/fake-claude.mjs");
const root = resolve(".");
const lifecycleScript = join(root, "scripts", "pota-lifecycle.mjs");
const releaseVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
// A later release than this checkout, played by a copy of the working tree (see newerCli).
const newerVersion = (() => {
  const [major, minor] = releaseVersion.split(/[.-]/).map(Number);
  return `${major}.${minor + 1}.0`;
})();
let newerTree;

after(async () => {
  if (newerTree) await rm(await newerTree, { recursive: true, force: true });
});

test("Pota config editing preserves public settings, comments, arrays, and multiline strings", () => {
  const input = [
    "# exact user bytes",
    "[features]",
    "plugins = false # user choice",
    "plugin_hooks = false",
    "multi_agent = false",
    "",
    "[agents]",
    "max_depth = 7",
    "models = [\"a\", \"b\"]",
    "prompt = \"\"\"",
    "[this.is.not.a.section]",
    "still prompt",
    "\"\"\"",
    "",
  ].join("\n");
  const output = updateConfig(input, []);
  assert.match(output, /plugins = false # user choice/);
  assert.match(output, /plugin_hooks = false/);
  assert.match(output, /multi_agent = false/);
  assert.match(output, /max_depth = 7/);
  assert.match(output, /prompt = \"\"\"\n\[this\.is\.not\.a\.section\]/);
  assert.equal(splitSections(output).some((section) => section.header === "this.is.not.a.section"), false);
  assert.equal(removePotaConfig(output), input);
});

test("install creates custom source, versioned runtime, ownership, and current Antigravity paths", async () => {
  await withHome(async ({ env, paths }) => {
    const result = run("install", env);
    assert.equal(result.status, 0, result.stderr);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    assert.equal(ownership.schemaVersion, 2);
    assert.equal(ownership.version, releaseVersion);
    assert.ok(ownership.targets.length > 20);
    await stat(paths.source);
    await stat(paths.runtime);
    await stat(paths.versioned);
    await stat(join(env.ANTIGRAVITY_HOME, "skills", "pota-plan", "SKILL.md"));
    await stat(join(env.ANTIGRAVITY_CLI_HOME, "skills", "pota-plan.md"));
    const locator = JSON.parse(await readFile(join(paths.source, ".pota-runtime.json"), "utf8"));
    assert.equal(locator.pluginRoot, paths.runtime);
  });
});

test("install places the manifest, canonical runtime, Codex marketplace source, and Claude marketplace under POTA_HOME/install", async () => {
  await withHome(async ({ env, paths }) => {
    const result = run("install", env);
    assert.equal(result.status, 0, result.stderr);

    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    assert.deepEqual(Object.keys(ownership).sort(), ["hosts", "installedAt", "origin", "plugin", "retained", "schemaVersion", "targets", "transactionId", "version"]);
    assert.equal(ownership.schemaVersion, 2);
    assert.equal(ownership.version, releaseVersion);
    assert.equal(ownership.origin, "checkout", "the repository checkout has .git");
    assert.deepEqual(ownership.hosts, ["codex", "claude", "antigravity"]);
    assert.deepEqual(ownership.retained, []);
    const records = new Map(ownership.targets.map((record) => [record.id, record]));
    assert.deepEqual({ ...records.get("runtime"), installedDigest: undefined }, { id: "runtime", phase: "core", path: paths.runtime, type: "tree", installedDigest: undefined, previous: null });
    assert.equal(records.get("codex-source").path, paths.source);
    assert.equal(records.get("marketplace").path, paths.marketplaceJson);
    assert.equal(records.get("codex-runtime").path, paths.versioned);
    assert.equal(records.get("claude-plugin").path, paths.claudeMarketplace);

    await stat(join(paths.runtime, ".codex-plugin", "plugin.json"));
    await stat(join(paths.runtime, "scripts", "pota.mjs"));
    await stat(join(paths.source, ".codex-plugin", "plugin.json"));
    const marketplace = JSON.parse(await readFile(paths.marketplaceJson, "utf8"));
    assert.deepEqual(marketplace.plugins.map((plugin) => [plugin.name, plugin.source]), [["pota", { source: "local", path: "./plugins/pota" }]]);
    await stat(join(paths.claudeMarketplace, ".claude-plugin", "marketplace.json"));
    await stat(join(paths.claudeMarketplace, "pota", "hooks", "hooks.json"));
    await assert.rejects(stat(paths.lock));
    await assert.rejects(stat(paths.transaction));

    // Only Codex's own plugin cache stays under CODEX_HOME.
    assert.deepEqual(await readdir(paths.codexCache), ["pota"]);
    assert.deepEqual(await readdir(join(paths.codexCache, "pota")), [releaseVersion]);
    await stat(join(paths.versioned, "hooks", "hooks.json"));
  });
});

test("every runtime locator and Claude hook points at the canonical runtime", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const skills = ["pota-memory", "pota-plan", "pota-work", "pota-review"];
    const locators = [
      join(paths.runtime, ".pota-runtime.json"),
      join(paths.versioned, ".pota-runtime.json"),
      join(paths.source, ".pota-runtime.json"),
      join(env.CLAUDE_HOME, "pota", "runtime.json"),
      join(env.ANTIGRAVITY_HOME, "pota", "runtime.json"),
      join(env.ANTIGRAVITY_CLI_HOME, "pota", "runtime.json"),
      ...skills.flatMap((skill) => [
        join(paths.runtime, "skills", skill, "references", "pota-runtime.json"),
        join(paths.versioned, "skills", skill, "references", "pota-runtime.json"),
        join(paths.source, "skills", skill, "references", "pota-runtime.json"),
        join(paths.claudeMarketplace, "pota", "skills", skill, "references", "pota-runtime.json"),
        join(env.ANTIGRAVITY_HOME, "skills", skill, "references", "pota-runtime.json"),
      ]),
    ];
    for (const path of locators) {
      const locator = JSON.parse(await readFile(path, "utf8"));
      assert.equal(locator.pluginRoot, paths.runtime, path);
      assert.equal(locator.entrypoints.cli, join(paths.runtime, "scripts", "pota.mjs"), path);
    }

    const hooks = JSON.parse(await readFile(join(paths.claudeMarketplace, "pota", "hooks", "hooks.json"), "utf8")).hooks;
    const commands = Object.values(hooks).flat().flatMap((group) => group.hooks.map((handler) => handler.command));
    assert.ok(commands.length > 0);
    for (const command of commands) assert.ok(command.includes(join(paths.runtime, "scripts", "pota-state.mjs")), command);
    const claudeCommand = await readFile(join(env.CLAUDE_HOME, "commands", "pota-plan.md"), "utf8");
    assert.doesNotMatch(claudeCommand, /plugins[\\/]cache[\\/]pota/);
  });
});

test("config projection points marketplaces.pota at the Codex marketplace root and keeps hook trust hashes", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const config = await readFile(env.CODEX_CONFIG_PATH, "utf8");
    const marketplace = splitSections(config).find((section) => section.header === "marketplaces.pota");
    assert.match(marketplace.text, /^source_type = "local"$/m);
    assert.equal(marketplace.text.match(/^source = (.+)$/m)?.[1], JSON.stringify(paths.marketplace));

    const expected = await trustedHookStates(root);
    const trusted = splitSections(config)
      .filter((section) => section.header?.startsWith("hooks.state.") && section.header.includes("pota@pota:"))
      .map((section) => ({ key: JSON.parse(section.header.slice("hooks.state.".length)), trustedHash: JSON.parse(section.text.match(/^trusted_hash = (.+)$/m)[1]) }));
    assert.deepEqual(trusted.sort((a, b) => a.key.localeCompare(b.key)), [...expected].sort((a, b) => a.key.localeCompare(b.key)));
  });
});

test("four parallel installs serialize safely and leave a healthy installation", async () => {
  assert.ok(DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS >= 60_000, "default lock wait must cover serialized Windows lifecycle operations");
  await withHome(async ({ env, paths }) => {
    const results = await Promise.all(Array.from({ length: 4 }, () => runAsync("install", env)));
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    const doctor = run("doctor", env);
    assert.equal(doctor.status, hostToolsAvailable() ? 0 : 1, doctor.stdout + doctor.stderr);
    await assert.rejects(stat(paths.lock));
  });
});

test("install and upgrade do not require host CLIs while doctor fails closed", async () => {
  await withHome(async ({ temp, env, paths }) => {
    const emptyBin = join(temp, "empty-bin");
    await mkdir(emptyBin);
    const restrictedEnv = { ...env, PATH: emptyBin };

    const install = run("install", restrictedEnv);
    assert.equal(install.status, 0, install.stderr);
    const upgrade = run("upgrade", restrictedEnv);
    assert.equal(upgrade.status, 0, upgrade.stderr);
    await stat(paths.ownership);
    await stat(paths.runtime);
    await stat(paths.versioned);

    const doctor = run("doctor", restrictedEnv);
    assert.equal(doctor.status, 1, doctor.stdout + doctor.stderr);
    assert.match(doctor.stdout, /^FAIL Codex plugin installed$/m);
    assert.match(doctor.stdout, /^FAIL Codex feature plugins$/m);
    assert.match(doctor.stdout, /^FAIL Antigravity CLI readiness$/m);
  });
});

test("lifecycle lock recovers a dead owner and rejects a live owner or nonce replacement", async () => {
  await withHome(async ({ env, paths }) => {
    const lock = paths.lock;
    await mkdir(dirname(lock), { recursive: true });
    await writeFile(lock, `${JSON.stringify({ schemaVersion: 1, pid: 99999999, hostname: hostname(), nonce: "dead-owner", acquiredAt: new Date().toISOString() })}\n`);
    assert.equal(run("install", env).status, 0);

    await writeFile(lock, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, hostname: hostname(), nonce: "live-owner", acquiredAt: new Date().toISOString() })}\n`);
    const blocked = run("upgrade", { ...env, POTA_LIFECYCLE_LOCK_TIMEOUT_MS: "100" });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Timed out waiting for Pota lifecycle lock/);
    await rm(lock);

    const raced = run("upgrade", { ...env, POTA_TEST_REPLACE_LOCK_AFTER_ACQUIRE: "1" });
    assert.equal(raced.status, 1);
    assert.match(raced.stderr, /ownership changed after acquisition/);
  });
});

test("a stale lifecycle observer never displaces a confirmed live lifecycle owner", { timeout: 5_000 }, async () => {
  await withHome(async ({ paths }) => {
    // Given
    const lockPath = paths.lock;
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: 1,
      pid: 99999999,
      hostname: hostname(),
      nonce: "original-stale",
      acquiredAt: new Date().toISOString(),
    })}\n`);
    const staleObserved = deferred();
    const letStaleObserverContinue = deferred();
    const reclaimInterlocked = deferred();
    const letReclaimerContinue = deferred();
    const liveOwnerEntered = deferred();
    const letLiveOwnerExit = deferred();
    let staleObservationBlocked = false;

    // When
    const staleObserver = createLifecycleLock({ lifecycleLockPath: lockPath }).withLifecycleLock(async () => {}, {
      timeoutMs: 1_000,
      retryMs: 5,
      testHooks: {
        async afterStaleObserved() {
          if (staleObservationBlocked) return;
          staleObservationBlocked = true;
          staleObserved.resolve();
          await letStaleObserverContinue.promise;
        },
        async afterReclaimInterlock() {
          reclaimInterlocked.resolve();
          await letReclaimerContinue.promise;
        },
      },
    });
    await staleObserved.promise;
    const liveOwner = createLifecycleLock({ lifecycleLockPath: lockPath }).withLifecycleLock(async () => {
      liveOwnerEntered.resolve();
      await letLiveOwnerExit.promise;
    }, { timeoutMs: 1_000, retryMs: 5 });
    await liveOwnerEntered.promise;
    letStaleObserverContinue.resolve();
    await reclaimInterlocked.promise;

    const contenderOutcome = deferred();
    const contender = createLifecycleLock({ lifecycleLockPath: lockPath }).withLifecycleLock(async () => {}, {
      timeoutMs: 1_000,
      retryMs: 5,
      testHooks: {
        afterLockWritten() { contenderOutcome.resolve("wrote-lock"); },
        beforeContendedLockConfirmation() { contenderOutcome.resolve("contended"); },
      },
    });
    const outcome = await contenderOutcome.promise;
    letReclaimerContinue.resolve();
    letLiveOwnerExit.resolve();
    const results = await Promise.allSettled([staleObserver, liveOwner, contender]);

    // Then
    assert.equal(outcome, "contended", "a contender must still observe the confirmed live lifecycle owner's lock");
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled", "fulfilled"]);
  });
});

test("lock acquisition recreates a parent pruned before exclusive create", async () => {
  await withHome(async ({ env, paths }) => {
    const result = run("install", { ...env, POTA_TEST_PRUNE_LOCK_PARENT_BEFORE_ACQUIRE: "1" });
    assert.equal(result.status, 0, result.stderr);
    await stat(paths.ownership);
    await assert.rejects(stat(paths.lock));
  });
});

for (const phase of ["after-core", "after-codex", "after-claude", "after-antigravity", "after-config"]) {
  test(`failure injection ${phase} rolls back every committed phase`, async () => {
    await withHome(async ({ env, paths }) => {
      const original = "# keep exactly\n[profiles.default]\nmodel = \"gpt-5\"\n";
      await mkdir(env.CODEX_HOME, { recursive: true });
      await writeFile(env.CODEX_CONFIG_PATH, original);
      const result = run("install", { ...env, POTA_TEST_FAIL_PHASE: phase });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Injected lifecycle failure/);
      assert.equal(await readFile(env.CODEX_CONFIG_PATH, "utf8"), original);
      await assert.rejects(stat(paths.runtime));
      await assert.rejects(stat(paths.versioned));
      await assert.rejects(stat(paths.source));
      await assert.rejects(stat(paths.ownership));
      await assert.rejects(stat(join(env.CLAUDE_HOME, "commands", "pota-plan.md")));
      await assert.rejects(stat(join(env.ANTIGRAVITY_HOME, "skills", "pota-plan")));
    });
  });
}

test("upgrade refuses a modified owned mirror and preserves it", async () => {
  await withHome(async ({ env }) => {
    assert.equal(run("install", env).status, 0);
    const mirror = join(env.CLAUDE_HOME, "commands", "pota-plan.md");
    await writeFile(mirror, "user modification\n");
    const result = run("upgrade", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Managed artifact was modified/);
    assert.equal(await readFile(mirror, "utf8"), "user modification\n");
  });
});

test("upgrade preserves boundary trivia and an appended non-Pota config section", async () => {
  await withHome(async ({ env }) => {
    assert.equal(run("install", env).status, 0);
    const userConfig = '\n# user profile stays public\n[profiles.user]\nmodel = "custom"\n';
    await writeFile(env.CODEX_CONFIG_PATH, `${await readFile(env.CODEX_CONFIG_PATH, "utf8")}${userConfig}`);

    const result = run("upgrade", env);
    assert.equal(result.status, 0, result.stderr);
    const upgraded = await readFile(env.CODEX_CONFIG_PATH, "utf8");
    assert.match(upgraded, /\n# user profile stays public\n\[profiles\.user\]\nmodel = "custom"\n/);
  });
});

test("uninstall preserves boundary trivia and an appended non-Pota config section", async () => {
  await withHome(async ({ env }) => {
    assert.equal(run("install", env).status, 0);
    const userConfig = '\n# user profile stays public\n[profiles.user]\nmodel = "custom"\n';
    await writeFile(env.CODEX_CONFIG_PATH, `${await readFile(env.CODEX_CONFIG_PATH, "utf8")}${userConfig}`);

    const result = run("uninstall", env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(env.CODEX_CONFIG_PATH, "utf8"), userConfig);
  });
});

test("upgrade reconciles a modified Pota-owned value in the mutable shared config", async () => {
  await withHome(async ({ env }) => {
    assert.equal(run("install", env).status, 0);
    const config = await readFile(env.CODEX_CONFIG_PATH, "utf8");
    await writeFile(env.CODEX_CONFIG_PATH, config.replace("enabled = true", "enabled = false"));

    const result = run("upgrade", env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(env.CODEX_CONFIG_PATH, "utf8"), /enabled = true/);
  });
});

test("upgrade rejects a shared config symlink even though config content is mutable", async () => {
  await withHome(async ({ env, temp }) => {
    assert.equal(run("install", env).status, 0);
    const redirected = join(temp, "redirected-config.toml");
    await writeFile(redirected, await readFile(env.CODEX_CONFIG_PATH, "utf8"));
    await rm(env.CODEX_CONFIG_PATH);
    await symlink(redirected, env.CODEX_CONFIG_PATH);

    const result = run("upgrade", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a regular file/);
  });
});

test("upgrade merges a public config edit captured immediately before replacement", async () => {
  await withHome(async ({ env }) => {
    assert.equal(run("install", env).status, 0);
    const publicSuffix = '\n# concurrent public edit\n[profiles.concurrent]\nmodel = "custom"\n';

    const result = run("upgrade", { ...env, POTA_TEST_APPEND_CONFIG_BEFORE_REPLACE: publicSuffix });
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(env.CODEX_CONFIG_PATH, "utf8"), /# concurrent public edit\n\[profiles\.concurrent\]\nmodel = "custom"/);
  });
});

test("uninstall merges a public config edit captured immediately before replacement", async () => {
  await withHome(async ({ env }) => {
    assert.equal(run("install", env).status, 0);
    const publicSuffix = '\n# concurrent uninstall edit\n[profiles.concurrent]\nmodel = "custom"\n';

    const result = run("uninstall", { ...env, POTA_TEST_APPEND_CONFIG_BEFORE_REPLACE: publicSuffix });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(env.CODEX_CONFIG_PATH, "utf8"), publicSuffix);
  });
});

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

test("a modified retained runtime blocks upgrade and uninstall", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const [oldRuntime] = await retainVersion(env, paths, "0.2.2");
    const userFile = join(oldRuntime, "user-notes.txt");
    await writeFile(userFile, "user content\n");
    const manifest = await readFile(paths.ownership, "utf8");
    const upgrade = run("upgrade", env);
    assert.equal(upgrade.status, 1);
    assert.match(upgrade.stderr, /Managed artifact was modified/);
    const uninstall = run("uninstall", env);
    assert.equal(uninstall.status, 1);
    assert.match(uninstall.stderr, /Refusing to uninstall modified managed artifacts/);
    assert.equal(await readFile(userFile, "utf8"), "user content\n");
    assert.equal(await readFile(paths.ownership, "utf8"), manifest);
    await stat(paths.runtime);
  });
});

test("a retained runtime removed outside Pota is dropped by doctor, upgrade, and uninstall", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const [oldRuntime, oldCodexRuntime] = await retainVersion(env, paths, "0.2.2");
    await rm(oldCodexRuntime, { recursive: true, force: true });
    const doctor = run("doctor", env);
    assert.match(doctor.stdout, /^OK ownership digests$/m);

    const upgrade = run("upgrade", env);
    assert.equal(upgrade.status, 0, upgrade.stdout + upgrade.stderr);
    assert.deepEqual((await readOwnership(paths)).retained.map(({ id, version }) => [id, version]), [["runtime", "0.2.2"]]);
    await stat(oldRuntime);

    await rm(oldRuntime, { recursive: true, force: true });
    const uninstall = run("uninstall", env);
    assert.equal(uninstall.status, 0, uninstall.stdout + uninstall.stderr);
    await assert.rejects(stat(paths.install));
    await assert.rejects(stat(paths.codexCache));
  });
});

test("uninstall removes retained runtimes", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const oldRuntimes = await retainVersion(env, paths, "0.2.2");
    const result = run("uninstall", env);
    assert.equal(result.status, 0, result.stderr);
    for (const oldRuntime of oldRuntimes) await assert.rejects(stat(oldRuntime));
    await assert.rejects(stat(paths.install));
    await assert.rejects(stat(paths.codexCache));
  });
});

test("a cleanup failure restores retained runtimes and the manifest", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const oldRuntimes = await retainVersion(env, paths, "0.2.2");
    await setRetiredAt(paths, 4);
    const manifest = await readFile(paths.ownership, "utf8");
    const digests = await Promise.all(oldRuntimes.map((path) => targetDigest(path, "tree")));
    const failed = run("upgrade", { ...env, POTA_TEST_FAIL_PHASE: "after-cleanup" });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Injected lifecycle failure: after-cleanup/);
    assert.deepEqual(await Promise.all(oldRuntimes.map((path) => targetDigest(path, "tree"))), digests);
    assert.equal(await readFile(paths.ownership, "utf8"), manifest);
    await assert.rejects(stat(paths.transaction));

    const retried = run("upgrade", env);
    assert.equal(retried.status, 0, retried.stderr);
    for (const oldRuntime of oldRuntimes) await assert.rejects(stat(oldRuntime));
  });
});

test("the next upgrade recovers a crash after retired runtimes were removed", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const oldRuntimes = await retainVersion(env, paths, "0.2.2");
    await setRetiredAt(paths, 4);
    const manifest = await readFile(paths.ownership, "utf8");
    const crashed = run("upgrade", { ...env, POTA_TEST_CRASH_AFTER_PHASE: "cleanup" });
    assert.equal(crashed.status, 88, crashed.stderr);
    await stat(paths.transaction);
    for (const oldRuntime of oldRuntimes) await assert.rejects(stat(oldRuntime));
    assert.equal(await readFile(paths.ownership, "utf8"), manifest);

    const recovered = run("upgrade", env);
    assert.equal(recovered.status, 0, recovered.stderr);
    await assert.rejects(stat(paths.transaction));
    for (const oldRuntime of oldRuntimes) await assert.rejects(stat(oldRuntime));
    assert.deepEqual((await readOwnership(paths)).retained, []);
  });
});

test("doctor reports a modified retained runtime", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const [oldRuntime] = await retainVersion(env, paths, "0.2.2");
    assert.match(run("doctor", env).stdout, /^OK ownership digests$/m);
    await writeFile(join(oldRuntime, "package.json"), "{}\n");
    const doctor = run("doctor", env);
    assert.equal(doctor.status, 1);
    assert.match(doctor.stdout, /^FAIL ownership digests$/m);
  });
});

test("reinstalling a retained version adopts it and drops the retained entry", async () => {
  await withHome(async ({ env, paths, temp }) => {
    assert.equal(run("install", env).status, 0);
    // Build a newer owned installation (99.0.0) that retains the current release, as after a later upgrade.
    const keep = { runtime: join(temp, "keep-runtime"), codex: join(temp, "keep-codex") };
    await cp(paths.runtime, keep.runtime, { recursive: true });
    await cp(paths.versioned, keep.codex, { recursive: true });
    const [newerRuntime, newerCodexRuntime] = await rewriteOwnedVersion(paths, "99.0.0");
    await rename(keep.runtime, paths.runtime);
    await rename(keep.codex, paths.versioned);
    const ownership = await readOwnership(paths);
    const retiredAt = new Date().toISOString();
    ownership.retained = [
      { id: "runtime", version: releaseVersion, path: paths.runtime, installedDigest: await targetDigest(paths.runtime, "tree"), retiredAt },
      { id: "codex-runtime", version: releaseVersion, path: paths.versioned, installedDigest: await targetDigest(paths.versioned, "tree"), retiredAt },
    ];
    await writeOwnership(paths, ownership);

    // Moving from 99.0.0 back to the release is a deliberate downgrade.
    const result = runArgs(["upgrade", "--allow-downgrade"], env);
    assert.equal(result.status, 0, result.stderr);
    const upgraded = await readOwnership(paths);
    assert.equal(upgraded.version, releaseVersion);
    assert.equal(upgraded.targets.find((record) => record.id === "runtime").installedDigest, await targetDigest(paths.runtime, "tree"));
    assert.deepEqual(upgraded.retained.map(({ id, version }) => ({ id, version })), [{ id: "runtime", version: "99.0.0" }]);
    await stat(newerRuntime);
    // Codex loads the highest cached version, so a newer Codex cache copy is never retained.
    await assert.rejects(stat(newerCodexRuntime));
    assert.deepEqual(await readdir(join(paths.codexCache, "pota")), [releaseVersion]);

    // A retained copy of the release that was modified is not adopted.
    await rewriteOwnedVersion(paths, "98.0.0");
    const modified = await readOwnership(paths);
    await cp(join(paths.install, "runtime", "98.0.0"), paths.runtime, { recursive: true });
    modified.retained.push({ id: "runtime", version: releaseVersion, path: paths.runtime, installedDigest: await targetDigest(paths.runtime, "tree"), retiredAt });
    await writeOwnership(paths, modified);
    await writeFile(join(paths.runtime, "user-notes.txt"), "user content\n");
    const refused = runArgs(["upgrade", "--allow-downgrade"], env);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Managed artifact was modified/);
  });
});

test("an invalid retained entry fails closed", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const [oldRuntime, oldCodexRuntime] = await retainVersion(env, paths, "0.2.2");
    const installed = await readFile(paths.ownership, "utf8");
    const digests = await Promise.all([oldRuntime, oldCodexRuntime, paths.runtime].map((path) => targetDigest(path, "tree")));
    for (const change of [
      (ownership) => { ownership.retained[1].path = oldRuntime; },
      (ownership) => { ownership.retained[0].path = join(paths.install, "runtime", "0.2.1"); },
      (ownership) => { ownership.retained[0].version = releaseVersion; ownership.retained[0].path = paths.runtime; },
      (ownership) => { ownership.retained[0].note = "unknown"; },
      (ownership) => { ownership.retained[0].id = "claude-plugin"; },
      (ownership) => { ownership.retained.push({ ...ownership.retained[0] }); },
      (ownership) => { ownership.retained[0].retiredAt = "yesterday"; },
    ]) {
      const ownership = JSON.parse(installed);
      change(ownership);
      await writeOwnership(paths, ownership);
      for (const command of ["upgrade", "uninstall"]) {
        const result = run(command, env);
        assert.equal(result.status, 1, `${command}: ${result.stderr}`);
        assert.match(result.stderr, /invalid retained runtime/);
      }
    }
    assert.deepEqual(await Promise.all([oldRuntime, oldCodexRuntime, paths.runtime].map((path) => targetDigest(path, "tree"))), digests);
  });
});

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

test("nonce replacement before release prevents post-release root pruning", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const uninstall = run("uninstall", { ...env, POTA_TEST_REPLACE_LOCK_BEFORE_RELEASE: "1" });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    await assert.rejects(stat(paths.ownership));
    await stat(paths.lock);
    await stat(paths.install);
  });
});

for (const phase of ["uninstall-after-config", "uninstall-after-external", "uninstall-after-codex", "uninstall-after-ownership"]) {
  test(`${phase} rolls back and a retry preserves unmanaged marketplace children`, async () => {
    await withHome(async ({ env, paths }) => {
      assert.equal(run("install", env).status, 0);
      const unmanaged = join(paths.install, "user-owned", "keep.txt");
      await mkdir(dirname(unmanaged), { recursive: true });
      await writeFile(unmanaged, "keep\n");
      const failed = run("uninstall", { ...env, POTA_TEST_FAIL_PHASE: phase });
      assert.equal(failed.status, 1);
      await stat(paths.ownership);
      assert.equal(run("doctor", env).status, hostToolsAvailable() ? 0 : 1);
      const retry = run("uninstall", env);
      assert.equal(retry.status, 0, retry.stderr);
      assert.equal(await readFile(unmanaged, "utf8"), "keep\n");
      await assert.rejects(stat(paths.ownership));
    });
  });
}

test("uninstall recovers an interrupted remove entry before continuing", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    const record = ownership.targets.find((target) => target.id === "claude-command-plan");
    const transactionId = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
    const backup = join(paths.transactions, transactionId, "backup", "0");
    await mkdir(dirname(backup), { recursive: true });
    await rename(record.path, backup);
    await writeJournal(paths, {
      schemaVersion: 1,
      id: transactionId,
      state: "active",
      entries: [{ ...journalEntry(record, backup), expectedNewDigest: "missing", operation: "remove", status: "applied" }],
    });
    const result = run("uninstall", env);
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(stat(paths.ownership));
  });
});

test("journal schema rejects non-boolean existed and duplicate id/path entries", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    const record = ownership.targets.find((target) => target.id === "claude-command-plan");
    const transactionId = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
    const backup = join(paths.transactions, transactionId, "backup", "0");
    const entry = { ...journalEntry(record, backup), existed: "yes", expectedNewDigest: record.installedDigest, operation: "replace", status: "prepared" };
    await writeJournal(paths, { schemaVersion: 1, id: transactionId, state: "active", entries: [entry] });
    let result = run("upgrade", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsafe entry/);

    entry.existed = true;
    await writeJournal(paths, { schemaVersion: 1, id: transactionId, state: "active", entries: [entry, { ...entry }] });
    result = run("upgrade", env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /duplicate targets/);
    await stat(paths.ownership);
  });
});

test("journal schema rejects entries outside the current allowlist", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    const record = ownership.targets.find((target) => target.id === "codex-source");
    const transactionId = "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc";
    const backup = join(paths.transactions, transactionId, "backup", "0");
    const foreignSource = join(paths.codexCache, "plugins", "pota");
    const entry = { ...journalEntry(record, backup), expectedNewDigest: record.installedDigest, operation: "replace", status: "applied" };
    for (const unsafe of [
      { ...entry, path: foreignSource },
      { ...entry, id: "previous-runtime", phase: "cleanup", path: paths.runtime, type: "tree", operation: "remove", expectedNewDigest: "missing" },
      { ...entry, id: "previous-codex-runtime", phase: "cleanup", path: join(paths.install, "runtime", "0.2.2"), type: "tree", operation: "remove", expectedNewDigest: "missing" },
      { ...entry, id: "runtime", phase: "codex", path: paths.runtime },
      // A versioned runtime of any release is allowed only as a direct `<version>` child of its own parent.
      { ...entry, id: "runtime", phase: "core", path: join(paths.install, "0.2.2") },
      { ...entry, id: "runtime", phase: "core", path: join(paths.codexCache, "pota", "0.2.2") },
      { ...entry, id: "runtime", phase: "core", path: join(paths.install, "runtime", "latest") },
      { ...entry, id: "runtime", phase: "core", path: join(paths.install, "runtime", "0.2") },
      { ...entry, id: "runtime", phase: "core", path: join(paths.install, "runtime", "0.2.2", "scripts") },
      { ...entry, id: "runtime", phase: "core", path: [paths.install, "runtime", "..", "runtime", "0.2.2"].join(sep) },
      { ...entry, id: "runtime", phase: "core", path: join(paths.install, "runtime", "0.2.2"), type: "file" },
      { ...entry, id: "codex-runtime", phase: "codex", path: join(paths.install, "runtime", "0.2.2") },
      { ...entry, id: "codex-runtime", phase: "codex", path: join(paths.codexCache, "pota", "v0.2.2") },
      { ...entry, id: "codex-runtime", phase: "core", path: join(paths.codexCache, "pota", "0.2.2") },
      { ...entry, id: "codex-runtime", phase: "codex", path: join(paths.codexCache, "pota", "0.2.2"), type: "config" },
      // Retired runtime removals name their version, and the path must be that version's runtime.
      { ...entry, id: "retired-runtime-0.2.2", phase: "cleanup", path: paths.runtime, type: "tree", operation: "remove", expectedNewDigest: "missing" },
      { ...entry, id: "retired-codex-runtime-0.2.2", phase: "cleanup", path: join(paths.install, "runtime", "0.2.2"), type: "tree", operation: "remove", expectedNewDigest: "missing" },
      { ...entry, id: "retired-runtime-0.2.2", phase: "cleanup", path: join(paths.install, "runtime", "0.2.2"), type: "tree", operation: "replace" },
      { ...entry, id: "retired-runtime-0.2.2", phase: "config", path: join(paths.install, "runtime", "0.2.2"), type: "tree", operation: "remove", expectedNewDigest: "missing" },
      { ...entry, id: "retired-runtime-../0.2.2", phase: "cleanup", path: join(paths.install, "0.2.2"), type: "tree", operation: "remove", expectedNewDigest: "missing" },
    ]) {
      await writeJournal(paths, { schemaVersion: 1, id: transactionId, state: "active", entries: [unsafe] });
      const result = run("upgrade", env);
      assert.equal(result.status, 1, `${unsafe.id}: ${result.stderr}`);
      assert.match(result.stderr, /unsafe entry/);
    }
    await stat(paths.ownership);
    await stat(paths.source);
  });
});

test("Codex A/B gate proves the versioned custom cache is required", async (context) => {
  if (spawnSync("codex", ["--version"], { encoding: "utf8" }).error) return context.skip("Codex CLI unavailable");
  await withHome(async ({ env, paths, temp }) => {
    assert.equal(run("install", env).status, 0);
    const hidden = join(temp, "hidden-version");
    await rename(paths.versioned, hidden);
    const withoutVersion = pluginList(env);
    assert.equal(withoutVersion.installed.some((entry) => entry.pluginId === "pota@pota"), false);
    await rename(hidden, paths.versioned);
    const withVersion = pluginList(env);
    const installed = withVersion.installed.find((entry) => entry.pluginId === "pota@pota");
    assert.equal(installed?.installed, true);
    assert.equal(installed?.enabled, true);
    assert.equal(installed?.version, releaseVersion);
    // G1: Codex reads the local marketplace under POTA_HOME, outside CODEX_HOME.
    assert.equal(await realpath(installed.source.path), await realpath(paths.source));
  });
});

test("the next lifecycle run recovers a crash journal from durable backup", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    const record = ownership.targets.find((target) => target.id === "claude-command-plan");
    const transactionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const backup = join(paths.transactions, transactionId, "backup", "0");
    await mkdir(dirname(backup), { recursive: true });
    await rename(record.path, backup);
    await writeFile(record.path, "partial crashed install\n");
    const journal = {
      schemaVersion: 1,
      id: transactionId,
      state: "active",
      entries: [{
        id: record.id,
        phase: record.phase,
        path: record.path,
        type: record.type,
        backup,
        existed: true,
        previousDigest: record.installedDigest,
        expectedNewDigest: await targetDigest(record.path, record.type),
        operation: "replace",
        status: "applied",
      }],
    };
    const journalPath = paths.transaction;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    const result = run("upgrade", env);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(await readFile(record.path, "utf8"), /partial crashed install/);
    await assert.rejects(stat(journalPath));
    await assert.rejects(stat(join(paths.transactions, transactionId)));
  });
});

test("config crash recovery preserves unrelated edits made after the crash", async () => {
  await withHome(async ({ env, paths }) => {
    assert.equal(run("install", env).status, 0);
    const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
    const record = ownership.targets.find((target) => target.id === "codex-config");
    const transactionId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const backup = join(paths.transactions, transactionId, "backup", "0");
    await mkdir(dirname(backup), { recursive: true });
    await rename(record.path, backup);
    const installedConfig = await readFile(backup, "utf8");
    await writeFile(record.path, `# edit after crash\n[profiles.user]\nmodel = \"custom\"\n${installedConfig}`);
    const journalPath = paths.transaction;
    await writeFile(journalPath, `${JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: "active",
      entries: [{
        id: record.id,
        phase: record.phase,
        path: record.path,
        type: record.type,
        backup,
        existed: true,
        previousDigest: record.installedDigest,
        expectedNewDigest: await targetDigest(record.path, record.type),
        operation: "replace",
        status: "applied",
      }],
    }, null, 2)}\n`);

    const result = run("upgrade", env);
    assert.equal(result.status, 0, result.stderr);
    const recovered = await readFile(env.CODEX_CONFIG_PATH, "utf8");
    assert.match(recovered, /# edit after crash/);
    assert.match(recovered, /\[profiles\.user\]\nmodel = "custom"/);
  });
});

test("doctor parser requires semantic Codex feature output", () => {
  const features = parseCodexFeatureList("plugins stable true\nhooks stable true\nmulti_agent stable true\n");
  assert.deepEqual({ plugins: features.plugins, hooks: features.hooks, multi_agent: features.multi_agent }, { plugins: true, hooks: true, multi_agent: true });
  assert.equal(parseCodexFeatureList("not a feature table"), null);
});

test("doctor reports an effective Codex feature disabled by user config", async (context) => {
  if (!hostToolsAvailable()) context.skip("Codex and Antigravity CLIs are required for this doctor integration test");
  await withHome(async ({ env }) => {
    assert.equal(run("install", env).status, 0);
    const config = await readFile(env.CODEX_CONFIG_PATH, "utf8");
    await writeFile(env.CODEX_CONFIG_PATH, `[features]\nplugins = false\n${config}`);
    const doctor = run("doctor", env);
    assert.equal(doctor.status, 1);
    assert.match(doctor.stdout, /^FAIL Codex feature plugins$/m);
    assert.doesNotMatch(doctor.stdout, /plugin_hooks/);
  });
});

test("doctor reports a modified Pota hook digest even though upgrade can reconcile shared config", async () => {
  await withHome(async ({ env }) => {
    assert.equal(run("install", env).status, 0);
    const config = await readFile(env.CODEX_CONFIG_PATH, "utf8");
    await writeFile(env.CODEX_CONFIG_PATH, config.replace(/trusted_hash = "sha256:[a-f0-9]+"/, 'trusted_hash = "sha256:modified"'));

    const doctor = run("doctor", env);
    assert.equal(doctor.status, 1);
    assert.match(doctor.stdout, /^FAIL ownership digests$/m);
  });
});

async function withHome(fn) {
  const temp = await mkdtemp(join(tmpdir(), "pota-transaction-"));
  const env = {
    ...process.env,
    HOME: join(temp, "home"),
    POTA_HOME: join(temp, "pota-home"),
    CODEX_HOME: join(temp, "codex"),
    CLAUDE_HOME: join(temp, "claude"),
    POTA_CLAUDE_CLI: fakeClaudeCli,
    ANTIGRAVITY_HOME: join(temp, "gemini", "config"),
    ANTIGRAVITY_CLI_HOME: join(temp, "gemini", "antigravity-cli"),
    CODEX_CONFIG_PATH: join(temp, "codex", "config.toml"),
  };
  const install = join(env.POTA_HOME, "install");
  const marketplace = join(install, "codex");
  const codexCache = join(env.CODEX_HOME, "plugins", "cache", "pota");
  const paths = {
    install,
    codexCache,
    marketplace,
    source: join(marketplace, "plugins", "pota"),
    marketplaceJson: join(marketplace, ".agents", "plugins", "marketplace.json"),
    claudeMarketplace: join(install, "claude"),
    runtime: join(install, "runtime", releaseVersion),
    versioned: join(codexCache, "pota", releaseVersion),
    ownership: join(install, "lifecycle.json"),
    lock: join(install, "lifecycle.lock"),
    transaction: join(install, "transaction.json"),
    transactions: join(install, "transactions"),
  };
  try { await fn({ temp, env, paths }); } finally { await rm(temp, { recursive: true, force: true }); }
}

// The lifecycle script of a copy of this working tree (without .git, node_modules, and .omo) whose package.json and
// .codex-plugin/plugin.json name `newerVersion`, so a run can come from another release than the installation.
async function newerCli() {
  newerTree ??= (async () => {
    const tree = await mkdtemp(join(tmpdir(), "pota-newer-cli-"));
    const excluded = new Set([".git", "node_modules", ".omo"]);
    await cp(root, tree, { recursive: true, filter: (source) => !excluded.has(relative(root, source)) });
    for (const manifestPath of [join(tree, "package.json"), join(tree, ".codex-plugin", "plugin.json")]) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.version = newerVersion;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return tree;
  })();
  return join(await newerTree, "scripts", "pota-lifecycle.mjs");
}

// The current manifest bytes plus the current digest of every artifact it owns.
async function installationSnapshot(paths) {
  const manifest = await readFile(paths.ownership, "utf8");
  const digests = {};
  const ownership = JSON.parse(manifest);
  for (const record of [...ownership.targets, ...ownership.retained.map((entry) => ({ ...entry, type: "tree" }))]) {
    digests[`${record.id}@${record.path}`] = await targetDigest(record.path, record.type);
  }
  return { manifest, digests };
}

function claudeLog(env) {
  return readFile(join(env.CLAUDE_HOME, "fake-claude.log"), "utf8").then((text) => text.trim().split("\n"));
}

function claudeState(env) {
  return readFile(join(env.CLAUDE_HOME, "fake-claude-state.json"), "utf8").then(JSON.parse);
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function run(command, env) {
  return runLifecycle(lifecycleScript, command, env);
}

function runLifecycle(script, command, env) {
  return spawnSync(process.execPath, [script, command], { cwd: root, env, encoding: "utf8" });
}

function runArgs(args, env) {
  return spawnSync(process.execPath, [lifecycleScript, ...args], { cwd: root, env, encoding: "utf8" });
}

function runAsync(command, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [lifecycleScript, command], { cwd: root, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

function hostToolsAvailable() {
  return commandAvailable("codex") && commandAvailable("agy");
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return result.error === undefined && result.status === 0;
}

function pluginList(env) {
  const result = spawnSync("codex", ["plugin", "list", "--json"], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function journalEntry(record, backup) {
  return {
    id: record.id,
    phase: record.phase,
    path: record.path,
    type: record.type,
    backup,
    existed: true,
    previousDigest: record.installedDigest,
  };
}

async function writeJournal(paths, journal) {
  await writeFile(paths.transaction, `${JSON.stringify(journal, null, 2)}\n`);
}

// Rewrites a current installation into an owned installation of `version`: both the canonical runtime and the
// Codex cache runtime move to that version and every locator follows the canonical runtime.
async function rewriteOwnedVersion(paths, version) {
  const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
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
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  ownership.version = version;
  for (const record of ownership.targets) record.installedDigest = await targetDigest(record.path, record.type);
  await writeFile(paths.ownership, `${JSON.stringify(ownership, null, 2)}\n`);
  return [oldRuntime, oldCodexRuntime];
}

// Turns the current installation into an owned `version` installation and upgrades it to the release, which leaves
// both `version` runtimes retained.
async function retainVersion(env, paths, version) {
  const oldRuntimes = await rewriteOwnedVersion(paths, version);
  const result = run("upgrade", env);
  assert.equal(result.status, 0, result.stderr);
  for (const oldRuntime of oldRuntimes) await stat(oldRuntime);
  const retained = (await readOwnership(paths)).retained.filter((entry) => entry.version === version);
  assert.deepEqual(retained.map((entry) => entry.path).sort(), [...oldRuntimes].sort());
  return oldRuntimes;
}

async function readOwnership(paths) {
  return JSON.parse(await readFile(paths.ownership, "utf8"));
}

async function writeOwnership(paths, ownership) {
  await writeFile(paths.ownership, `${JSON.stringify(ownership, null, 2)}\n`);
}

// retiredAt is not part of any digest, so moving it into the past simulates the grace period passing.
async function setRetiredAt(paths, daysAgo) {
  const ownership = await readOwnership(paths);
  const retiredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  for (const entry of ownership.retained) entry.retiredAt = retiredAt;
  await writeOwnership(paths, ownership);
}

async function copyRuntimeAsVersion(source, destination, version) {
  await cp(source, destination, { recursive: true });
  for (const manifestPath of [join(destination, ".codex-plugin", "plugin.json"), join(destination, "package.json")]) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

async function replaceTextInManagedTarget(path, from, to) {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of await readdir(path, { withFileTypes: true })) await replaceTextInManagedTarget(join(path, entry.name), from, to);
    return;
  }
  const content = await readFile(path, "utf8");
  if (content.includes(from)) await writeFile(path, content.replaceAll(from, to));
}

