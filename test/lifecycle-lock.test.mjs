import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS, createLifecycleLock } from "../scripts/pota-lifecycle-lock.mjs";

// The legacy migration and the comment-checker fetch share this lock with the 1.x installer, so the file format, the
// dead-owner rules, and the timeout message are a contract across versions.
const TIMEOUT_MESSAGE = /^Timed out waiting for Pota lifecycle lock after \d+ms$/;

function record(overrides = {}) {
  return `${JSON.stringify({ schemaVersion: 1, pid: 99999999, hostname: hostname(), nonce: "n", acquiredAt: new Date().toISOString(), ...overrides })}\n`;
}

async function withLock(work) {
  const temp = await mkdtemp(join(tmpdir(), "pota-lifecycle-lock-"));
  const lockPath = join(temp, "install", "lifecycle.lock");
  try {
    await work({ lockPath, lock: createLifecycleLock({ lifecycleLockPath: lockPath }) });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function withEnv(name, value, work) {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("the lock is created with its parent, held during the operation, and removed with afterRelease after it", async () => {
  await withLock(async ({ lockPath, lock }) => {
    assert.ok(DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS >= 60_000);
    const events = [];
    const result = await lock.withLifecycleLock(async () => {
      events.push(`held:${(await stat(lockPath)).isFile()}`);
      return "done";
    }, { afterRelease: async () => events.push(`released:${await stat(lockPath).then(() => true, () => false)}`) });
    assert.equal(result, "done");
    assert.deepEqual(events, ["held:true", "released:false"]);
    assert.deepEqual(await readdir(dirname(lockPath)), []);

    let afterRelease = false;
    await assert.rejects(lock.withLifecycleLock(async () => { throw new Error("operation failed"); }, {
      afterRelease: () => { afterRelease = true; },
    }), /operation failed/);
    assert.equal(afterRelease, false, "afterRelease runs only after a successful operation");
    assert.deepEqual(await readdir(dirname(lockPath)), []);
  });
});

test("a dead owner on this host is reclaimed; a live owner times out with the shared message", async () => {
  await withLock(async ({ lockPath, lock }) => {
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, record({ nonce: "dead-owner" }));
    assert.equal(await lock.withLifecycleLock(async () => "reclaimed", { timeoutMs: 1_000, retryMs: 5 }), "reclaimed");
    assert.deepEqual(await readdir(dirname(lockPath)), []);

    await writeFile(lockPath, record({ pid: process.pid, nonce: "live-owner" }));
    let ran = false;
    await assert.rejects(lock.withLifecycleLock(async () => { ran = true; }, { timeoutMs: 100, retryMs: 5 }), { message: TIMEOUT_MESSAGE });
    // timeoutMs 0 (the migration runner) gives up at once instead of waiting.
    const started = Date.now();
    await assert.rejects(lock.withLifecycleLock(async () => { ran = true; }, { timeoutMs: 0 }), { message: TIMEOUT_MESSAGE });
    assert.ok(Date.now() - started < 1_000);
    assert.equal(ran, false);
    assert.deepEqual(await readdir(dirname(lockPath)), ["lifecycle.lock"], "a live owner's lock is never removed");
  });
});

test("a dead pid recorded by another host is not reclaimed", async () => {
  await withLock(async ({ lockPath, lock }) => {
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, record({ hostname: `${hostname()}-elsewhere`, nonce: "foreign" }));
    await assert.rejects(lock.withLifecycleLock(async () => {}, { timeoutMs: 50, retryMs: 5 }), { message: TIMEOUT_MESSAGE });
  });
});

test("a malformed lock is reclaimed only after it is older than malformedStaleMs", async () => {
  await withLock(async ({ lockPath, lock }) => {
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "{not a lock\n");
    await assert.rejects(lock.withLifecycleLock(async () => {}, { timeoutMs: 50, retryMs: 5 }), { message: TIMEOUT_MESSAGE });
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    assert.equal(await lock.withLifecycleLock(async () => "reclaimed", { timeoutMs: 1_000, retryMs: 5, malformedStaleMs: 30_000 }), "reclaimed");
  });
});

test("a lock replaced after acquisition is rejected as an ownership change", async () => {
  await withLock(async ({ lock }) => {
    await withEnv("POTA_TEST_REPLACE_LOCK_AFTER_ACQUIRE", "1", async () => {
      await assert.rejects(lock.withLifecycleLock(async () => {}), /ownership changed after acquisition/);
    });
  });
});

test("lock acquisition recreates a parent pruned before exclusive create", async () => {
  await withLock(async ({ lockPath, lock }) => {
    await withEnv("POTA_TEST_PRUNE_LOCK_PARENT_BEFORE_ACQUIRE", "1", async () => {
      assert.equal(await lock.withLifecycleLock(async () => "acquired", { timeoutMs: 1_000 }), "acquired");
    });
    await assert.rejects(stat(lockPath));
  });
});

test("a stale observer never displaces a confirmed live owner", { timeout: 5_000 }, async () => {
  await withLock(async ({ lockPath }) => {
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, record({ nonce: "original-stale" }));
    const staleObserved = deferred();
    const letStaleObserverContinue = deferred();
    const reclaimInterlocked = deferred();
    const letReclaimerContinue = deferred();
    const liveOwnerEntered = deferred();
    const letLiveOwnerExit = deferred();
    let staleObservationBlocked = false;

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

    assert.equal(outcome, "contended", "a contender must still observe the confirmed live owner's lock");
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled", "fulfilled"]);
  });
});
