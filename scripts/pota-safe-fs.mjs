import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const LOCK_SCHEMA_VERSION = 1;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_MS = 25;
const DEFAULT_MALFORMED_STALE_MS = 30_000;
const TRANSIENT_LOCK_ERROR_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

export function stateLockPath(root = process.cwd()) {
  return safePath(root, ".pota/state.lock");
}

export function safePath(root, relativePath) {
  const workspaceRoot = resolve(root);
  const target = resolve(workspaceRoot, relativePath);
  const relation = relative(workspaceRoot, target);
  if (relation === ".." || relation.startsWith(`..${sep}`)) {
    throw new Error(`Managed path must remain inside the workspace: ${relativePath}`);
  }
  return target;
}

export async function assertNoSymlinkComponents(root, target, { allowMissing = true } = {}) {
  const workspaceRoot = resolve(root);
  const absoluteTarget = resolve(target);
  const relation = relative(workspaceRoot, absoluteTarget);
  if (relation === ".." || relation.startsWith(`..${sep}`)) {
    throw new Error(`Managed path must remain inside the workspace: ${target}`);
  }
  const components = relation === "" ? [] : relation.split(sep);
  let current = workspaceRoot;
  await rejectSymlink(current);
  for (const component of components) {
    current = join(current, component);
    try {
      await rejectSymlink(current);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return;
      throw error;
    }
  }
}

export async function safeMkdir(root, relativePath) {
  const workspaceRoot = resolve(root);
  const target = safePath(workspaceRoot, relativePath);
  await assertNoSymlinkComponents(workspaceRoot, workspaceRoot, { allowMissing: false });
  const relation = relative(workspaceRoot, target);
  let current = workspaceRoot;
  for (const component of relation.split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw symlinkError(current);
      if (!stat.isDirectory()) throw new Error(`Managed directory component is not a directory: ${current}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") throw mkdirError;
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw symlinkError(current);
        if (!stat.isDirectory()) throw new Error(`Managed directory component is not a directory: ${current}`);
      }
    }
  }
  return target;
}

export async function safeWriteFile(root, target, data, options) {
  const absoluteTarget = safePath(root, relative(resolve(root), resolve(target)));
  await assertNoSymlinkComponents(root, dirname(absoluteTarget), { allowMissing: false });
  await assertNoSymlinkComponents(root, absoluteTarget);
  return writeFile(absoluteTarget, data, options);
}

export async function withStateLock(root, operation, {
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  retryMs = DEFAULT_RETRY_MS,
  malformedStaleMs = DEFAULT_MALFORMED_STALE_MS,
  testHooks = {},
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error("lock timeoutMs must be a non-negative number");
  const workspaceRoot = resolve(root);
  await safeMkdir(workspaceRoot, ".pota");
  const lockPath = stateLockPath(workspaceRoot);
  const owner = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    pid: process.pid,
    hostname: hostname(),
    nonce: randomUUID(),
    acquiredAt: new Date().toISOString(),
  };
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await safeWriteFile(workspaceRoot, lockPath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
      await testHooks.afterLockWritten?.({ lockPath, owner: structuredClone(owner) });
      if (await confirmsUnclaimedLockOwnership(workspaceRoot, lockPath, owner.nonce)) break;
    } catch (error) {
      if (isTransientLockError(error)) {
        // Windows can briefly deny a lock file that another process is closing.
        // Retry within the deadline; permission errors are not evidence of staleness.
      } else if (error?.code === "EEXIST") {
        try {
          await testHooks.beforeContendedLockConfirmation?.({ lockPath });
          if (await confirmsUnclaimedLockOwnership(workspaceRoot, lockPath, owner.nonce)) break;
          const reclaimed = await reclaimStaleLock(workspaceRoot, lockPath, owner, malformedStaleMs, testHooks);
          if (reclaimed) continue;
        } catch (inspectionError) {
          if (!isTransientLockError(inspectionError)) throw inspectionError;
        }
      } else {
        throw error;
      }
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for Pota state lock after ${timeoutMs}ms`);
    await delay(Math.min(retryMs, Math.max(1, deadline - Date.now())));
  }

  try {
    return await operation();
  } finally {
    await releaseOwnedLock(lockPath, owner.nonce);
  }
}

async function reclaimStaleLock(root, lockPath, owner, malformedStaleMs, testHooks) {
  let observed;
  let stat;
  try {
    [observed, stat] = await Promise.all([readFile(lockPath, "utf8"), lstat(lockPath)]);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (stat.isSymbolicLink()) throw symlinkError(lockPath);
  const record = parseLockRecord(observed);
  if (!isReclaimableLock(record, stat, malformedStaleMs)) return false;

  await testHooks.afterStaleObserved?.({ lockPath, observed, record: record ? structuredClone(record) : null });
  const claimPath = safePath(root, `.pota/state.lock.reclaim.${owner.nonce}`);
  await safeWriteFile(root, claimPath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await testHooks.afterReclaimInterlock?.({ lockPath });
    let claimed;
    let claimedStat;
    try {
      [claimed, claimedStat] = await Promise.all([readFile(lockPath, "utf8"), lstat(lockPath)]);
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
    if (claimedStat.isSymbolicLink()) throw symlinkError(lockPath);
    const claimedRecord = parseLockRecord(claimed);
    if (!isReclaimableLock(claimedRecord, claimedStat, malformedStaleMs)) return false;

    const quarantine = safePath(root, `.pota/state.lock.stale.${claimedRecord?.nonce ?? "malformed"}.${randomUUID()}`);
    try {
      await rename(lockPath, quarantine);
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
    const movedStat = await lstat(quarantine);
    await rm(quarantine, { force: true });
    return movedStat.dev === claimedStat.dev && movedStat.ino === claimedStat.ino;
  } finally {
    await releaseOwnedLock(claimPath, owner.nonce);
  }
}

function isReclaimableLock(record, stat, malformedStaleMs) {
  if (record) return lockOwnerIsDead(record);
  return Date.now() - stat.mtimeMs > malformedStaleMs;
}

// A lock owner is dead only when it ran on this host and its pid no longer exists.
export function lockOwnerIsDead(record) {
  return record.hostname === hostname() && !pidIsAlive(record.pid);
}

async function confirmsUnclaimedLockOwnership(root, lockPath, nonce) {
  if (await activeReclaimClaimExists(root)) return false;
  try {
    return parseLockRecord(await readFile(lockPath, "utf8"))?.nonce === nonce;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function activeReclaimClaimExists(root) {
  const claimNames = (await readdir(safePath(root, ".pota")))
    .filter((name) => name.startsWith("state.lock.reclaim."));
  for (const name of claimNames) {
    const claimPath = safePath(root, `.pota/${name}`);
    let stat;
    let record;
    try {
      [stat, record] = await Promise.all([lstat(claimPath), readFile(claimPath, "utf8").then(parseLockRecord)]);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw symlinkError(claimPath);
    if (record?.hostname === hostname() && !pidIsAlive(record.pid)) {
      await releaseOwnedLock(claimPath, record.nonce);
      continue;
    }
    return true;
  }
  return false;
}

async function releaseOwnedLock(lockPath, nonce) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const record = parseLockRecord(await readFile(lockPath, "utf8"));
      if (record?.nonce !== nonce) return;
      await rm(lockPath);
      return;
    } catch (error) {
      if (error?.code === "ENOENT") return;
      if (!isTransientLockError(error) || attempt === 7) throw error;
      await delay(10 * (attempt + 1));
    }
  }
}

function isTransientLockError(error) {
  return TRANSIENT_LOCK_ERROR_CODES.has(error?.code);
}

export function parseLockRecord(text) {
  try {
    const value = JSON.parse(text);
    if (value?.schemaVersion !== LOCK_SCHEMA_VERSION) return null;
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0) return null;
    if (typeof value.hostname !== "string" || value.hostname.length === 0) return null;
    if (typeof value.nonce !== "string" || value.nonce.length === 0) return null;
    if (typeof value.acquiredAt !== "string" || Number.isNaN(Date.parse(value.acquiredAt))) return null;
    return value;
  } catch {
    return null;
  }
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function rejectSymlink(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw symlinkError(path);
}

function symlinkError(path) {
  const error = new Error(`Managed path must not contain a symbolic link: ${path}`);
  error.code = "POTA_SYMLINK";
  return error;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
