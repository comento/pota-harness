#!/usr/bin/env node
import { constants, readFileSync } from "node:fs";
import { lstat, open, readdir, rm, rmdir } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reconcileWorktreeState } from "./pota-goal.mjs";
import { resolvePluginRoot, resolveRepoRoot } from "./pota-paths.mjs";
import { lockOwnerIsDead, parseLockRecord } from "./pota-safe-fs.mjs";

const staleLockPrefix = "state.lock.stale.";
const staleLockName = /^state\.lock\.stale\.(.+)\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_LOCK_RECORD_BYTES = 4096;
const usage = "Usage: pota cleanup [--root PATH] [--check | --yes]";

export async function cleanupProjectPota({ root = process.cwd(), apply = false } = {}) {
  const repoRoot = resolve(root);
  const legacyRoot = join(repoRoot, ".pota");
  let rootStat;
  try {
    rootStat = await lstat(legacyRoot);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { root: repoRoot, apply, known: [], unknown: [], removed: [], projectDirectoryRemoved: false, preservedReasons: {} };
    }
    throw error;
  }
  if (rootStat.isSymbolicLink()) throw new Error(`Legacy Pota root must not be a symbolic link: ${legacyRoot}`);
  if (!rootStat.isDirectory()) throw new Error(`Legacy Pota root is not a directory: ${legacyRoot}`);

  const entries = await readdir(legacyRoot, { withFileTypes: true });
  const known = [];
  const unknown = [];
  const preservedReasons = {};
  for (const entry of entries) {
    if (entry.isFile() && isLockFileName(entry.name)) {
      // Lock files are Pota-owned only when their content is a lock record that may be removed.
      const reason = await lockFileReason(join(legacyRoot, entry.name), entry.name);
      if (reason === null) known.push(entry.name);
      else {
        unknown.push(entry.name);
        preservedReasons[entry.name] = reason;
      }
      continue;
    }
    const isKnownFile = entry.isFile() && entry.name === "state.json";
    const isKnownDirectory = entry.isDirectory() && entry.name === "tools";
    (isKnownFile || isKnownDirectory ? known : unknown).push(entry.name);
  }
  if (!apply) return cleanupResult({ repoRoot, apply, known, unknown, removed: [], projectDirectoryRemoved: false, preservedReasons });

  if (known.includes("state.json")) await reconcileWorktreeState({ root: repoRoot });
  const removed = [];
  for (const name of [...known]) {
    const path = join(legacyRoot, name);
    try {
      const stat = await lstat(path);
      const expectedType = name === "tools" ? stat.isDirectory() : stat.isFile();
      if (!expectedType) continue;
      if (isLockFileName(name)) {
        // Judge the lock again right before removal; a lock that changed owner is preserved.
        const reason = await lockFileReason(path, name);
        if (reason !== null) {
          known.splice(known.indexOf(name), 1);
          unknown.push(name);
          preservedReasons[name] = reason;
          continue;
        }
      }
      await rm(path, { recursive: name === "tools", force: true });
      removed.push(name);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  let projectDirectoryRemoved = false;
  try {
    await rmdir(legacyRoot);
    projectDirectoryRemoved = true;
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
  }
  return cleanupResult({ repoRoot, apply, known, unknown, removed, projectDirectoryRemoved, preservedReasons });
}

function cleanupResult({ repoRoot, apply, known, unknown, removed, projectDirectoryRemoved, preservedReasons }) {
  return {
    root: repoRoot,
    apply,
    known: known.sort(),
    unknown: unknown.sort(),
    removed: removed.sort(),
    projectDirectoryRemoved,
    preservedReasons: Object.fromEntries(Object.keys(preservedReasons).sort().map((name) => [name, preservedReasons[name]])),
  };
}

function isLockFileName(name) {
  return name === "state.lock" || name.startsWith(staleLockPrefix);
}

// Returns null when the lock file may be removed, otherwise the reason it is preserved.
async function lockFileReason(path, name) {
  let nonce = null;
  if (name !== "state.lock") {
    const match = staleLockName.exec(name);
    if (!match) return "invalid-lock-record";
    nonce = match[1];
  }
  const record = await readLockRecord(path);
  if (!record) return "invalid-lock-record";
  if (nonce !== null) return record.nonce === nonce ? null : "invalid-lock-record";
  if (lockOwnerIsDead(record)) return null;
  return record.hostname === hostname() ? "live-lock-owner" : "foreign-host-lock";
}

async function readLockRecord(path) {
  let handle;
  try {
    // Never follow a link or block on a special file that replaced the inspected entry.
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_LOCK_RECORD_BYTES) return null;
    const buffer = Buffer.alloc(MAX_LOCK_RECORD_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_LOCK_RECORD_BYTES) return null;
    return parseLockRecord(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

class CleanupUsageError extends Error {}

function parseCleanupArgs(args) {
  const provided = new Set();
  let explicitRoot = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--help", "--version", "--check", "--yes"].includes(argument)) {
      if (provided.has(argument)) throw new CleanupUsageError(`${argument} may only be provided once`);
      provided.add(argument);
    } else if (argument === "--root" || argument.startsWith("--root=")) {
      if (explicitRoot !== null) throw new CleanupUsageError("--root may only be provided once");
      const value = argument === "--root" ? args[index + 1] : argument.slice("--root=".length);
      if (!value || value.startsWith("--")) throw new CleanupUsageError("--root requires a path");
      explicitRoot = value;
      if (argument === "--root") index += 1;
    } else {
      throw new CleanupUsageError(`unknown option: ${argument}`);
    }
  }
  if (provided.has("--help") && provided.has("--version")) throw new CleanupUsageError("--help and --version cannot be used together");
  if (provided.has("--check") && provided.has("--yes")) throw new CleanupUsageError("--check and --yes cannot be used together");
  const action = provided.has("--help") ? "help" : provided.has("--version") ? "version" : "cleanup";
  return { action, explicitRoot, apply: provided.has("--yes") };
}

async function main(args) {
  let options;
  try {
    options = parseCleanupArgs(args);
  } catch (error) {
    console.error(`Pota cleanup error: ${firstLine(error)}`);
    process.exitCode = 2;
    return;
  }
  if (options.action === "help") {
    console.log(usage);
    return;
  }
  if (options.action === "version") {
    const { version } = JSON.parse(readFileSync(join(resolvePluginRoot(import.meta.url), "package.json"), "utf8"));
    console.log(`pota ${version}`);
    return;
  }
  try {
    const repoRoot = resolveRepoRoot({ explicitRoot: options.explicitRoot });
    console.log(JSON.stringify(await cleanupProjectPota({ root: repoRoot, apply: options.apply }), null, 2));
  } catch (error) {
    console.error(`Pota cleanup error: ${firstLine(error)}`);
    process.exitCode = 1;
  }
}

function firstLine(error) {
  return String(error instanceof Error ? error.message : error).split(/\r?\n/)[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
