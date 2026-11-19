import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { parseCodexFeatureList, targetDigest } from "../scripts/pota-lifecycle.mjs";
import {
  root,
  releaseVersion,
  withHome,
  run,
  hostToolsAvailable,
  pluginList,
  journalEntry,
  writeJournal,
} from "./support/lifecycle-transaction.mjs";

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
