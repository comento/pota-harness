import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { trustedHookStates } from "../scripts/pota-lifecycle-config.mjs";
import { createLifecycleLock } from "../scripts/pota-lifecycle-lock.mjs";
import { DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS, removePotaConfig, splitSections, updateConfig } from "../scripts/pota-lifecycle.mjs";
import {
  root,
  releaseVersion,
  withHome,
  deferred,
  run,
  runAsync,
  hostToolsAvailable,
} from "./support/lifecycle-transaction.mjs";

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
      join(paths.claudeMarketplace, "pota", "pota-runtime.json"),
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
