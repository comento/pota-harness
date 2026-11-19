import test from "node:test";
import assert from "node:assert/strict";
import {
  cp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { targetDigest } from "../scripts/pota-lifecycle.mjs";
import {
  releaseVersion,
  withHome,
  run,
  runArgs,
  rewriteOwnedVersion,
  retainVersion,
  readOwnership,
  writeOwnership,
  setRetiredAt,
} from "./support/lifecycle-transaction.mjs";

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
