import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { cleanupProjectPota } from "../scripts/pota-cleanup.mjs";

const cleanupScript = resolve("scripts/pota-cleanup.mjs");
const ownedStaleLock = "state.lock.stale.owner.123e4567-e89b-42d3-a456-426614174000";
const malformedStaleLock = "state.lock.stale.malformed.123e4567-e89b-42d3-a456-426614174001";
const cleanupUsage = "Usage: pota cleanup [--root PATH] [--check | --yes]";
const { version: packageVersion } = JSON.parse(await readFile("package.json", "utf8"));

function lockRecord({ pid = 99999999, hostname: host = hostname(), nonce, acquiredAt = "2026-01-01T00:00:00.000Z" }) {
  return `${JSON.stringify({ schemaVersion: 1, pid, hostname: host, nonce, acquiredAt })}\n`;
}

async function withTempRoot(operation) {
  const root = await mkdtemp(join(tmpdir(), "pota-cleanup-hardening-"));
  try {
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function snapshotTree(root) {
  const snapshot = {};
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = join(prefix, entry.name);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        snapshot[`${relativePath}/`] = "directory";
        await visit(path, relativePath);
      } else {
        snapshot[relativePath] = (await readFile(path)).toString("base64");
      }
    }
  }
  await visit(root);
  return snapshot;
}

function runCleanup(root, apply) {
  return spawnSync(process.execPath, [cleanupScript, "--root", root, ...(apply ? ["--yes"] : [])], {
    encoding: "utf8",
  });
}

function runCleanupArgs(args) {
  return spawnSync(process.execPath, [cleanupScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "en_US.UTF-8" },
    timeout: 5_000,
  });
}

function assertExit(result, expected) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, expected.status, result.stderr);
  assert.equal(result.stdout, expected.stdout);
  assert.equal(result.stderr, expected.stderr);
}

for (const [label, apply] of [["dry-run", false], ["--yes", true]]) {
  test(`cleanup rejects a symlinked .pota root before traversal in ${label}`, async () => {
    await withTempRoot(async (sandbox) => {
      // Given
      const root = join(sandbox, "repo");
      const outside = join(sandbox, "outside");
      await mkdir(join(outside, "tools"), { recursive: true });
      await mkdir(root);
      await writeFile(join(outside, "state.lock"), Buffer.from([0, 1, 2, 255]));
      await writeFile(join(outside, "tools", "binary"), Buffer.from([255, 2, 1, 0]));
      await symlink(outside, join(root, ".pota"));
      const before = await snapshotTree(outside);

      // When
      const result = runCleanup(root, apply);

      // Then
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /symbolic link/i);
      assert.deepEqual(await snapshotTree(outside), before);
    });
  });

  test(`cleanup rejects a dangling .pota root in ${label}`, async () => {
    await withTempRoot(async (root) => {
      // Given
      await symlink(join(root, "missing-outside"), join(root, ".pota"));

      // When
      const result = runCleanup(root, apply);

      // Then
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /symbolic link/i);
      assert.equal((await lstat(join(root, ".pota"))).isSymbolicLink(), true);
    });
  });

  test(`cleanup rejects a non-directory .pota root in ${label}`, async () => {
    await withTempRoot(async (root) => {
      // Given
      await writeFile(join(root, ".pota"), "unrelated bytes\n");

      // When
      const result = runCleanup(root, apply);

      // Then
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /Legacy Pota root is not a directory/);
      assert.equal(await readFile(join(root, ".pota"), "utf8"), "unrelated bytes\n");
    });
  });

  test(`cleanup rejects a socket .pota root before traversal in ${label}`, { skip: process.platform === "win32" }, async () => {
    await withTempRoot(async (root) => {
      // Given
      const socketPath = join(root, ".pota");
      const server = createServer();
      server.listen(socketPath);
      await once(server, "listening");
      try {
        // When
        const result = runCleanup(root, apply);

        // Then
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, /Legacy Pota root is not a directory/);
        assert.equal((await lstat(socketPath)).isSocket(), true);
      } finally {
        const closed = once(server, "close");
        server.close();
        await closed;
      }
    });
  });
}

test("cleanup preserves unrelated stale-prefix files, directories, and symlinks", async () => {
  await withTempRoot(async (sandbox) => {
    // Given
    const root = join(sandbox, "repo");
    const outside = join(sandbox, "outside.txt");
    const unrelatedDirectory = "state.lock.stale.user-directory.123e4567-e89b-42d3-a456-426614174002";
    const unrelatedSymlink = "state.lock.stale.link.123e4567-e89b-42d3-a456-426614174003";
    await mkdir(join(root, ".pota", unrelatedDirectory), { recursive: true });
    await writeFile(join(root, ".pota", "state.lock.stale.notes"), "keep file\n");
    await writeFile(join(root, ".pota", unrelatedDirectory, "keep.txt"), "keep directory\n");
    await writeFile(outside, "keep target\n");
    await symlink(outside, join(root, ".pota", unrelatedSymlink));

    // When
    const result = await cleanupProjectPota({ root, apply: true });

    // Then
    assert.deepEqual(result.known, []);
    assert.deepEqual(result.unknown, [unrelatedSymlink, "state.lock.stale.notes", unrelatedDirectory].sort());
    assert.equal(await readFile(join(root, ".pota", "state.lock.stale.notes"), "utf8"), "keep file\n");
    assert.equal(await readFile(join(root, ".pota", unrelatedDirectory, "keep.txt"), "utf8"), "keep directory\n");
    assert.equal((await lstat(join(root, ".pota", unrelatedSymlink))).isSymbolicLink(), true);
    assert.equal(await readFile(outside, "utf8"), "keep target\n");
  });
});

test("cleanup preserves reserved names whose filesystem types are not Pota-owned", async () => {
  await withTempRoot(async (root) => {
    // Given
    await mkdir(join(root, ".pota", "state.json"), { recursive: true });
    await mkdir(join(root, ".pota", "state.lock"));
    await writeFile(join(root, ".pota", "tools"), "user file\n");

    // When
    const result = await cleanupProjectPota({ root, apply: true });

    // Then
    assert.deepEqual(result.known, []);
    assert.deepEqual(result.unknown, ["state.json", "state.lock", "tools"]);
    assert.equal((await lstat(join(root, ".pota", "state.json"))).isDirectory(), true);
    assert.equal((await lstat(join(root, ".pota", "state.lock"))).isDirectory(), true);
    assert.equal(await readFile(join(root, ".pota", "tools"), "utf8"), "user file\n");
  });
});

test("cleanup removes known legacy entries with their owned filesystem types", async () => {
  await withTempRoot(async (root) => {
    // Given
    await mkdir(join(root, ".pota", "tools", "bin"), { recursive: true });
    await writeFile(join(root, ".pota", "state.lock"), lockRecord({ nonce: "legacy" }));
    await writeFile(join(root, ".pota", "tools", "bin", "tool"), "legacy tool\n");
    await writeFile(join(root, ".pota", ownedStaleLock), lockRecord({ nonce: "owner" }));

    // When
    const result = await cleanupProjectPota({ root, apply: true });

    // Then
    assert.deepEqual(result.removed, ["state.lock", ownedStaleLock, "tools"].sort());
    assert.deepEqual(result.preservedReasons, {});
    assert.equal(result.projectDirectoryRemoved, true);
    await assert.rejects(lstat(join(root, ".pota")), { code: "ENOENT" });
  });
});

test("cleanup preserves lock files whose content is not a valid lock record", async () => {
  await withTempRoot(async (root) => {
    // Given
    const oversized = "state.lock.stale.big.123e4567-e89b-42d3-a456-426614174004";
    await mkdir(join(root, ".pota"));
    await writeFile(join(root, ".pota", "state.lock"), "legacy lock\n");
    await writeFile(join(root, ".pota", ownedStaleLock), "stale lock\n");
    await writeFile(join(root, ".pota", malformedStaleLock), "malformed stale lock\n");
    await writeFile(join(root, ".pota", oversized), `${lockRecord({ nonce: "big" }).trimEnd()}${" ".repeat(4096)}\n`);
    await writeFile(join(root, ".pota", "state.lock.stale.notes"), lockRecord({ nonce: "notes" }));
    const before = await snapshotTree(root);
    const preserved = ["state.lock", ownedStaleLock, malformedStaleLock, oversized, "state.lock.stale.notes"].sort();
    const expectedReasons = Object.fromEntries(preserved.map((name) => [name, "invalid-lock-record"]));

    // When
    const inspected = await cleanupProjectPota({ root });
    const applied = await cleanupProjectPota({ root, apply: true });

    // Then
    for (const result of [inspected, applied]) {
      assert.deepEqual(result.known, []);
      assert.deepEqual(result.unknown, preserved);
      assert.deepEqual(result.removed, []);
      assert.deepEqual(result.preservedReasons, expectedReasons);
      assert.equal(result.projectDirectoryRemoved, false);
    }
    assert.deepEqual(await snapshotTree(root), before);
  });
});

test("cleanup preserves a state.lock held by a live owner in dry-run and --yes", async () => {
  await withTempRoot(async (root) => {
    // Given
    await mkdir(join(root, ".pota"));
    await writeFile(join(root, ".pota", "state.lock"), lockRecord({ pid: process.pid, nonce: "live" }));
    const before = await snapshotTree(root);

    for (const apply of [false, true]) {
      // When
      const result = runCleanup(root, apply);

      // Then
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report.known, []);
      assert.deepEqual(report.unknown, ["state.lock"]);
      assert.deepEqual(report.removed, []);
      assert.deepEqual(report.preservedReasons, { "state.lock": "live-lock-owner" });
      assert.deepEqual(await snapshotTree(root), before);
    }
  });
});

test("cleanup preserves a foreign-host lock and reports preservedReasons", async () => {
  await withTempRoot(async (root) => {
    // Given
    await mkdir(join(root, ".pota"));
    await writeFile(join(root, ".pota", "state.lock"), lockRecord({ hostname: `${hostname()}-elsewhere`, nonce: "foreign" }));
    const before = await snapshotTree(root);

    // When
    const inspected = runCleanup(root, false);
    const applied = runCleanup(root, true);

    // Then
    for (const result of [inspected, applied]) {
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report.unknown, ["state.lock"]);
      assert.deepEqual(report.removed, []);
      assert.deepEqual(report.preservedReasons, { "state.lock": "foreign-host-lock" });
    }
    assert.deepEqual(await snapshotTree(root), before);
  });
});

test("cleanup removes a quarantined lock only when its name nonce matches the record", async () => {
  await withTempRoot(async (root) => {
    // Given
    const matching = "state.lock.stale.alpha.123e4567-e89b-42d3-a456-426614174005";
    const mismatched = "state.lock.stale.beta.123e4567-e89b-42d3-a456-426614174006";
    await mkdir(join(root, ".pota"));
    await writeFile(join(root, ".pota", matching), lockRecord({ nonce: "alpha" }));
    await writeFile(join(root, ".pota", mismatched), lockRecord({ nonce: "gamma" }));

    // When
    const inspected = await cleanupProjectPota({ root });
    const applied = await cleanupProjectPota({ root, apply: true });

    // Then
    assert.deepEqual(inspected.known, [matching]);
    assert.deepEqual(inspected.unknown, [mismatched]);
    assert.deepEqual(inspected.preservedReasons, { [mismatched]: "invalid-lock-record" });
    assert.deepEqual(applied.removed, [matching]);
    assert.deepEqual(applied.preservedReasons, { [mismatched]: "invalid-lock-record" });
    await assert.rejects(lstat(join(root, ".pota", matching)), { code: "ENOENT" });
    assert.equal(await readFile(join(root, ".pota", mismatched), "utf8"), lockRecord({ nonce: "gamma" }));
  });
});

test("cleanup --help and --version exit 0 without inspecting the repository", async () => {
  await withTempRoot(async (sandbox) => {
    // Given: a symlinked .pota root fails any inspection.
    const root = join(sandbox, "repo");
    const outside = join(sandbox, "outside");
    await mkdir(outside);
    await mkdir(root);
    await writeFile(join(outside, "state.lock"), "outside\n");
    await symlink(outside, join(root, ".pota"));
    const before = await snapshotTree(outside);

    // When
    const help = runCleanupArgs(["--help", "--root", root]);
    const version = runCleanupArgs(["--root", root, "--version"]);

    // Then
    assertExit(help, { status: 0, stdout: `${cleanupUsage}\n`, stderr: "" });
    assertExit(version, { status: 0, stdout: `pota ${packageVersion}\n`, stderr: "" });
    assert.deepEqual(await snapshotTree(outside), before);
  });
});

test("cleanup usage errors exit 2 and runtime errors exit 1 as one-line messages without stack traces", async () => {
  await withTempRoot(async (sandbox) => {
    // Given
    const root = join(sandbox, "repo");
    const fileRoot = join(sandbox, "file-repo");
    await mkdir(root);
    await mkdir(fileRoot);
    await symlink(join(sandbox, "missing"), join(root, ".pota"));
    await writeFile(join(fileRoot, ".pota"), "not a directory\n");

    // When / Then: usage errors
    for (const [args, message] of [
      [["--bogus"], "unknown option: --bogus"],
      [["unexpected"], "unknown option: unexpected"],
      [["--root"], "--root requires a path"],
      [["--root", root, "--root", root], "--root may only be provided once"],
      [["--yes", "--yes", "--root", root], "--yes may only be provided once"],
      [["--check", "--yes", "--root", root], "--check and --yes cannot be used together"],
      [["--help", "--version"], "--help and --version cannot be used together"],
    ]) {
      assertExit(runCleanupArgs(args), { status: 2, stdout: "", stderr: `Pota cleanup error: ${message}\n` });
    }

    // When / Then: runtime errors
    for (const [args, pattern] of [
      [["--root", root], /^Pota cleanup error: Legacy Pota root must not be a symbolic link: .+\n$/],
      [["--root", root, "--yes"], /^Pota cleanup error: Legacy Pota root must not be a symbolic link: .+\n$/],
      [["--root", fileRoot, "--check"], /^Pota cleanup error: Legacy Pota root is not a directory: .+\n$/],
    ]) {
      const result = runCleanupArgs(args);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, pattern);
      assert.doesNotMatch(result.stderr, /\n\s+at |file:\/\/|Node\.js v/);
    }
    assert.equal(await readFile(join(fileRoot, ".pota"), "utf8"), "not a directory\n");
  });
});
