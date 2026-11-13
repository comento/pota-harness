import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";

export const DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS = 60_000;

export function createLifecycleLock({ lifecycleLockPath }) {
async function withLifecycleLock(operation, {
  timeoutMs = DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS,
  retryMs = 25,
  malformedStaleMs = 30_000,
  afterRelease,
  testHooks = {},
} = {}) {
  await mkdir(dirname(lifecycleLockPath), { recursive: true });
  if (process.env.POTA_TEST_PRUNE_LOCK_PARENT_BEFORE_ACQUIRE === "1") await rmdir(dirname(lifecycleLockPath));
  const owner = { schemaVersion: 1, pid: process.pid, hostname: hostname(), nonce: randomUUID(), acquiredAt: new Date().toISOString() };
  const deadline = Date.now() + timeoutMs;
  let waitReported = false;
  while (true) {
    let acquired = false;
    try {
      await writeFile(lifecycleLockPath, `${JSON.stringify(owner)}\n`, { flag: "wx" });
      await testHooks.afterLockWritten?.({ owner: structuredClone(owner) });
      if (process.env.POTA_TEST_REPLACE_LOCK_AFTER_ACQUIRE === "1") {
        await writeFile(lifecycleLockPath, `${JSON.stringify({ ...owner, nonce: randomUUID() })}\n`);
      }
      const written = parseLifecycleLock(await readFile(lifecycleLockPath, "utf8"));
      if (written?.nonce !== owner.nonce) throw new Error("Pota lifecycle lock ownership changed after acquisition");
      acquired = !(await activeReclaimClaimExists());
    } catch (error) {
      if (error?.code === "ENOENT") {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for Pota lifecycle lock after ${timeoutMs}ms`);
        await mkdir(dirname(lifecycleLockPath), { recursive: true });
        continue;
      }
      if (error?.code !== "EEXIST") throw error;
      if (!waitReported && process.env.POTA_TEST_REPORT_LOCK_WAIT === "1") {
        console.log("POTA_TEST_LOCK_WAIT");
        waitReported = true;
      }
      await testHooks.beforeContendedLockConfirmation?.();
      acquired = await confirmsUnclaimedLifecycleLockOwnership(owner.nonce);
      if (!acquired && await reclaimLifecycleLock(owner, malformedStaleMs, testHooks)) continue;
    }
    if (acquired) {
      if (process.env.POTA_TEST_HOLD_LOCK_STDIN === "1") {
        console.log("POTA_TEST_LOCK_ACQUIRED");
        await new Promise((resolvePromise) => process.stdin.once("data", resolvePromise));
      }
      break;
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for Pota lifecycle lock after ${timeoutMs}ms`);
    await delay(Math.min(retryMs, Math.max(1, deadline - Date.now())));
  }
  let operationSucceeded = false;
  try {
    const result = await operation();
    operationSucceeded = true;
    return result;
  } finally {
    if (process.env.POTA_TEST_REPLACE_LOCK_BEFORE_RELEASE === "1") {
      await writeFile(lifecycleLockPath, `${JSON.stringify({ ...owner, nonce: randomUUID() })}\n`);
    }
    const released = await releaseOwnedLock(lifecycleLockPath, owner);
    if (operationSucceeded && released && afterRelease) await afterRelease();
  }
}

async function releaseOwnedLock(path, owner) {
  let current;
  try {
    current = parseLifecycleLock(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (current?.nonce !== owner.nonce) return false;
  const releasedPath = `${path}.released.${owner.nonce}`;
  try {
    await rename(path, releasedPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const released = parseLifecycleLock(await readFile(releasedPath, "utf8"));
  if (released?.nonce !== owner.nonce) {
    if (!(await exists(path))) await rename(releasedPath, path);
    return false;
  }
  await rm(releasedPath, { force: true });
  return true;
}

async function reclaimLifecycleLock(owner, malformedStaleMs, testHooks) {
  let observed;
  let info;
  try {
    [observed, info] = await Promise.all([readFile(lifecycleLockPath, "utf8"), lstat(lifecycleLockPath)]);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error(`Lifecycle lock must not be a symlink: ${lifecycleLockPath}`);
  const record = parseLifecycleLock(observed);
  if (!isReclaimableLifecycleLock(record, info, malformedStaleMs)) return false;
  await testHooks.afterStaleObserved?.();

  const claimPath = `${lifecycleLockPath}.reclaim.${owner.nonce}`;
  await writeFile(claimPath, `${JSON.stringify(owner)}\n`, { flag: "wx" });
  try {
    await testHooks.afterReclaimInterlock?.();
    let claimed;
    let claimedInfo;
    try {
      [claimed, claimedInfo] = await Promise.all([readFile(lifecycleLockPath, "utf8"), lstat(lifecycleLockPath)]);
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
    if (claimedInfo.isSymbolicLink()) throw new Error(`Lifecycle lock must not be a symlink: ${lifecycleLockPath}`);
    const claimedRecord = parseLifecycleLock(claimed);
    if (!isReclaimableLifecycleLock(claimedRecord, claimedInfo, malformedStaleMs)) return false;

    const quarantine = `${lifecycleLockPath}.stale.${claimedRecord?.nonce ?? "malformed"}.${randomUUID()}`;
    try {
      await rename(lifecycleLockPath, quarantine);
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
    if (await readFile(quarantine, "utf8") !== claimed) {
      if (!(await exists(lifecycleLockPath))) await rename(quarantine, lifecycleLockPath);
      throw new Error("Pota lifecycle lock ownership changed during stale recovery");
    }
    await rm(quarantine, { force: true });
    return true;
  } finally {
    await releaseOwnedLock(claimPath, owner);
  }
}

function isReclaimableLifecycleLock(record, info, malformedStaleMs) {
  if (record) return record.hostname === hostname() && !pidIsAlive(record.pid);
  return Date.now() - info.mtimeMs > malformedStaleMs;
}

async function confirmsUnclaimedLifecycleLockOwnership(nonce) {
  if (await activeReclaimClaimExists()) return false;
  try {
    return parseLifecycleLock(await readFile(lifecycleLockPath, "utf8"))?.nonce === nonce;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function activeReclaimClaimExists() {
  const claimNames = (await readdir(dirname(lifecycleLockPath)))
    .filter((name) => name.startsWith(`${basename(lifecycleLockPath)}.reclaim.`));
  for (const name of claimNames) {
    const claimPath = join(dirname(lifecycleLockPath), name);
    let info;
    let record;
    try {
      [info, record] = await Promise.all([lstat(claimPath), readFile(claimPath, "utf8").then(parseLifecycleLock)]);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Lifecycle reclaim claim must not be a symlink: ${claimPath}`);
    if (record?.hostname === hostname() && !pidIsAlive(record.pid)) {
      await releaseOwnedLock(claimPath, record);
      continue;
    }
    return true;
  }
  return false;
}

function parseLifecycleLock(text) {
  try {
    const value = JSON.parse(text);
    if (value?.schemaVersion !== 1 || !Number.isSafeInteger(value.pid) || value.pid <= 0
        || typeof value.hostname !== "string" || value.hostname.length === 0 || typeof value.nonce !== "string" || value.nonce.length === 0
        || typeof value.acquiredAt !== "string" || Number.isNaN(Date.parse(value.acquiredAt))) return null;
    return value;
  } catch { return null; }
}

function pidIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code !== "ESRCH"; }
}

function delay(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }


  return { withLifecycleLock };

  async function exists(path) {
    try { await lstat(path); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  }
}
