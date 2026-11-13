import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readGoalState, startGoal } from "../scripts/pota-goal.mjs";
import { stateLockPath, withStateLock } from "../scripts/pota-safe-fs.mjs";

const cliScript = resolve("scripts/pota.mjs");
const stateScript = resolve("scripts/pota-state.mjs");

test("parallel receipts are serialized without lost updates", async () => {
  await withTempRoot(async (root) => {
    await startSingleGoal(root);
    const children = Array.from({ length: 20 }, (_, index) => spawnAsync([
      cliScript, "goal", "receipt", "--quiet", "--root", root,
      "--task", "only", "--kind", `parallel-${index}`, "--command", `check-${index}`, "--exit-code", "0",
    ]));
    const results = await Promise.all(children);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const state = await readGoalState({ root });
    assert.equal(state.receipts.length, 20);
    assert.equal(new Set(state.receipts.map((item) => item.kind)).size, 20);
    assert.equal(state.revision, 21);
  });
});

test("parallel goal starts permit exactly one active goal", async () => {
  await withTempRoot(async (root) => {
    const starts = Array.from({ length: 8 }, (_, index) => spawnAsync([
      cliScript, "goal", "start", "--quiet", "--root", root,
      "--goal", `goal-${index}`, "--plan", `plan-${index}`, "--tasks", "Only task",
    ]));
    const results = await Promise.all(starts);
    assert.equal(results.filter((result) => result.code === 0).length, 1);
    assert.equal(results.filter((result) => result.code !== 0).length, 7);
    assert.ok(await readGoalState({ root }));
  });
});

test("state lock recovers only eligible stale owners and releases after exceptions", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, ".pota"));
    const lockPath = stateLockPath(root);
    const base = { schemaVersion: 1, hostname: hostname(), nonce: randomUUID(), acquiredAt: new Date().toISOString() };

    await writeFile(lockPath, JSON.stringify({ ...base, pid: 99999999 }));
    await withStateLock(root, async () => {}, { timeoutMs: 200, retryMs: 10 });

    await writeFile(lockPath, JSON.stringify({ ...base, nonce: randomUUID(), pid: process.pid }));
    await assert.rejects(withStateLock(root, async () => {}, { timeoutMs: 60, retryMs: 10 }), /timed out.*lock/i);
    await rm(lockPath);

    await writeFile(lockPath, JSON.stringify({ ...base, nonce: randomUUID(), hostname: "foreign-host", pid: 99999999 }));
    await assert.rejects(withStateLock(root, async () => {}, { timeoutMs: 60, retryMs: 10 }), /timed out.*lock/i);
    await rm(lockPath);

    await writeFile(lockPath, "not-json");
    await assert.rejects(withStateLock(root, async () => {}, { timeoutMs: 60, retryMs: 10, malformedStaleMs: 30_000 }), /timed out.*lock/i);
    await rm(lockPath);

    await writeFile(lockPath, "not-json");
    const old = new Date(Date.now() - 60_000);
    const { utimes } = await import("node:fs/promises");
    await utimes(lockPath, old, old);
    await withStateLock(root, async () => {}, { timeoutMs: 200, retryMs: 10, malformedStaleMs: 30_000 });

    await assert.rejects(withStateLock(root, async () => { throw new Error("boom"); }), /boom/);
    await withStateLock(root, async () => {}, { timeoutMs: 60, retryMs: 10 });
  });
});

test("state lock retries transient errors during contended confirmation and stale reclaim", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, ".pota"));
    const lockPath = stateLockPath(root);
    const record = { schemaVersion: 1, hostname: hostname(), nonce: randomUUID(), acquiredAt: new Date().toISOString() };

    await writeFile(lockPath, JSON.stringify({ ...record, pid: process.pid }));
    let confirmationFailures = 0;
    await withStateLock(root, async () => {}, {
      timeoutMs: 500,
      retryMs: 5,
      testHooks: {
        async beforeContendedLockConfirmation() {
          if (confirmationFailures > 0) return;
          confirmationFailures += 1;
          await rm(lockPath);
          throw transientError("EPERM");
        },
      },
    });
    assert.equal(confirmationFailures, 1);

    await writeFile(lockPath, JSON.stringify({ ...record, nonce: randomUUID(), pid: 99999999 }));
    let reclaimFailures = 0;
    await withStateLock(root, async () => {}, {
      timeoutMs: 500,
      retryMs: 5,
      testHooks: {
        afterStaleObserved() {
          if (reclaimFailures > 0) return;
          reclaimFailures += 1;
          throw transientError("EACCES");
        },
      },
    });
    assert.equal(reclaimFailures, 1);
  });
});

test("a stale observer revalidates a newly acquired lock before its owner enters the critical section", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, ".pota"));
    const lockPath = stateLockPath(root);
    await writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      hostname: hostname(),
      nonce: "original-stale",
      acquiredAt: new Date().toISOString(),
      pid: 99999999,
    }));

    const staleObserved = deferred();
    const letStaleObserverRename = deferred();
    const newLockWritten = deferred();
    const letNewOwnerConfirm = deferred();
    const reclaimInterlocked = deferred();
    let blockedStaleObserver = false;
    let newOwnerNonce;
    const entrants = [];

    const staleObserver = withStateLock(root, async () => {
      entrants.push("stale-observer");
    }, {
      timeoutMs: 1_000,
      retryMs: 5,
      testHooks: {
        async afterStaleObserved() {
          if (blockedStaleObserver) return;
          blockedStaleObserver = true;
          staleObserved.resolve();
          await letStaleObserverRename.promise;
        },
        afterReclaimInterlock() {
          reclaimInterlocked.resolve();
        },
      },
    });

    await staleObserved.promise;
    const newOwner = withStateLock(root, async () => {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      assert.equal(current.nonce, newOwnerNonce, "confirmed owner must still hold lock on critical-section entry");
      entrants.push("new-owner");
    }, {
      timeoutMs: 1_000,
      retryMs: 5,
      testHooks: {
        async afterLockWritten({ owner }) {
          newOwnerNonce = owner.nonce;
          newLockWritten.resolve();
          await letNewOwnerConfirm.promise;
        },
      },
    });

    await newLockWritten.promise;
    letStaleObserverRename.resolve();
    await reclaimInterlocked.promise;
    letNewOwnerConfirm.resolve();
    await Promise.all([staleObserver, newOwner]);
    assert.deepEqual(entrants, ["new-owner", "stale-observer"]);
  });
});

test("a stale observer never displaces a confirmed live owner", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, ".pota"));
    const lockPath = stateLockPath(root);
    await writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      hostname: hostname(),
      nonce: "original-stale",
      acquiredAt: new Date().toISOString(),
      pid: 99999999,
    }));

    const staleObserved = deferred();
    const letStaleObserverContinue = deferred();
    const reclaimInterlocked = deferred();
    const letReclaimerContinue = deferred();
    const liveOwnerEntered = deferred();
    const letLiveOwnerExit = deferred();
    let staleObservationBlocked = false;

    const staleObserver = withStateLock(root, async () => {}, {
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
    const liveOwner = withStateLock(root, async () => {
      liveOwnerEntered.resolve();
      await letLiveOwnerExit.promise;
    }, { timeoutMs: 1_000, retryMs: 5 });
    await liveOwnerEntered.promise;

    letStaleObserverContinue.resolve();
    await reclaimInterlocked.promise;
    const contenderOutcome = deferred();
    const contender = withStateLock(root, async () => {}, {
      timeoutMs: 1_000,
      retryMs: 5,
      testHooks: {
        afterLockWritten() {
          contenderOutcome.resolve("wrote-lock");
        },
        beforeContendedLockConfirmation() {
          contenderOutcome.resolve("contended");
        },
      },
    });
    const outcome = await contenderOutcome.promise;

    letReclaimerContinue.resolve();
    letLiveOwnerExit.resolve();
    await Promise.all([staleObserver, liveOwner, contender]);
    assert.equal(outcome, "contended", "a contender must still observe the confirmed live owner's lock");
  });
});

test("verify binds evidence to the starting goal and watched snapshot", async () => {
  await withTempRoot(async (root) => {
    const watched = join(root, "watched.txt");
    await writeFile(watched, "before\n");
    await startSingleGoal(root);

    const mutation = runCli([
      "goal", "verify", "--quiet", "--root", root, "--task", "only", "--kind", "mutation", "--watch", watched,
      "--", process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(watched)}, 'after\\n')`,
    ]);
    assert.notEqual(mutation.status, 0);
    assert.match(mutation.stderr, /changed during verification/i);
    assert.equal((await readGoalState({ root })).receipts.length, 0);

    const crossGoalCode = `
      const { spawnSync } = require('node:child_process');
      const cli = ${JSON.stringify(cliScript)};
      const root = ${JSON.stringify(root)};
      for (const args of [
        ['goal','cancel','--quiet','--root',root],
        ['goal','start','--quiet','--root',root,'--goal','replacement','--plan','replacement','--tasks','Only task']
      ]) { const r = spawnSync(process.execPath, [cli, ...args]); if (r.status !== 0) process.exit(r.status || 1); }
    `;
    const crossGoal = runCli([
      "goal", "verify", "--quiet", "--root", root, "--task", "only", "--kind", "cross-goal", "--watch", watched,
      "--", process.execPath, "-e", crossGoalCode,
    ]);
    assert.notEqual(crossGoal.status, 0);
    assert.match(crossGoal.stderr, /goal.*changed during verification/i);
    assert.equal((await readGoalState({ root })).receipts.length, 0);
  });
});

test("task-scoped verify rejects evidence when the starting task is completed during execution", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "task transition",
      planId: "task-transition-plan",
      evidencePolicy: "declared",
      tasks: [{ id: "first", title: "First" }, { id: "second", title: "Second" }],
    });
    const transitionCode = `
      const { spawnSync } = require('node:child_process');
      const cli = ${JSON.stringify(cliScript)};
      const root = ${JSON.stringify(root)};
      const commands = [
        ['goal','receipt','--quiet','--root',root,'--task','first','--kind','moduleAcceptance','--command','module','--exit-code','0'],
        ['goal','receipt','--quiet','--root',root,'--task','first','--kind','surfaceIntegration','--command','surface','--exit-code','0'],
        ['goal','task','--quiet','--root',root,'--task','first','--status','completed']
      ];
      for (const args of commands) { const r = spawnSync(process.execPath, [cli, ...args]); if (r.status !== 0) process.exit(r.status || 1); }
    `;
    const result = runCli([
      "goal", "verify", "--quiet", "--root", root, "--task", "first", "--kind", "late-evidence",
      "--", process.execPath, "-e", transitionCode,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /task.*changed during verification|no longer active/i);
    const state = await readGoalState({ root });
    assert.equal(state.tasks.find((task) => task.id === "first").status, "completed");
    assert.equal(state.tasks.find((task) => task.id === "second").status, "active");
    assert.equal(state.receipts.some((receipt) => receipt.kind === "late-evidence"), false);
  });
});

test("verify enforces a bounded timeout and records no evidence", async () => {
  await withTempRoot(async (root) => {
    await startSingleGoal(root);
    const result = runCli([
      "goal", "verify", "--quiet", "--root", root, "--task", "only", "--kind", "timeout", "--timeout-ms", "50",
      "--", process.execPath, "-e", "setTimeout(() => {}, 10000)",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /timed out.*50ms/i);
    assert.equal((await readGoalState({ root })).receipts.length, 0);

    for (const value of ["0", "-1", "not-a-number", "3600001"]) {
      const invalid = runCli([
        "goal", "verify", "--quiet", "--root", root, "--task", "only", "--kind", "invalid-timeout",
        "--timeout-ms", value, "--", process.execPath, "-e", "process.exit(0)",
      ]);
      assert.notEqual(invalid.status, 0, `timeout ${value} unexpectedly passed`);
      assert.match(invalid.stderr, /timeout-ms.*between 1 and 3600000/i);
    }
  });
});

test("init and state writes refuse symlinked managed paths and dangling managed files", async () => {
  await withTempRoot(async (root) => {
    const outside = await mkdtemp(join(tmpdir(), "pota-outside-"));
    try {
      await symlink(outside, join(root, "docs"));
      const docsResult = runCli(["init", "--root", root]);
      assert.notEqual(docsResult.status, 0);
      await assert.rejects(readFile(join(outside, "memory", "anything")));
      await rm(join(root, "docs"));

      await symlink(join(outside, "missing-memory"), join(root, "MEMORY.md"));
      const fileResult = runCli(["init", "--root", root]);
      assert.notEqual(fileResult.status, 0);
      assert.match(fileResult.stderr, /symbolic link/i);
      await rm(join(root, "MEMORY.md"));

      await symlink(outside, join(root, ".pota"));
      const stateResult = runCli([
        "goal", "start", "--quiet", "--root", root,
        "--goal", "unsafe", "--plan", "unsafe", "--tasks", "Only task",
      ]);
      assert.notEqual(stateResult.status, 0);
      assert.match(stateResult.stderr, /symbolic link/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("goal CLI fails closed for missing, duplicate, and unknown options", async () => {
  await withTempRoot(async (root) => {
    for (const args of [
      ["goal", "status", "--root"],
      ["goal", "status", "--root", root, "--root", root],
      ["goal", "status", "--root", root, "--unknown", "value"],
    ]) {
      const result = runCli(args);
      assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly passed`);
    }
    await assert.rejects(readFile(join(root, ".pota", "state.json")));
  });
});

test("goal CLI rejects semantically duplicate option aliases", async () => {
  await withTempRoot(async (root) => {
    for (const aliases of [
      ["--evidencePolicy", "declared", "--evidence-policy", "tool-bound"],
    ]) {
      const result = runCli([
        "goal", "start", "--quiet", "--root", root, "--goal", "duplicate", "--plan", "duplicate", "--tasks", "Only task", ...aliases,
      ]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /may only be provided once/i);
    }

    await startSingleGoal(root);
    for (const aliases of [
      ["--exitCode", "0", "--exit-code", "0"],
      ["--exit-code", "0", "--exit", "0"],
      ["--goalId", "one", "--goal-id", "two"],
    ]) {
      const result = runCli([
        "goal", "receipt", "--quiet", "--root", root, "--task", "only", "--kind", "duplicate", "--command", "check", ...aliases,
      ]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /may only be provided once/i);
    }
    assert.equal((await readGoalState({ root })).receipts.length, 0);
  });
});

test("PostToolUse emits pure Codex hook JSON with additionalContext", async () => {
  await withTempRoot(async (root) => {
    const idle = spawnSync(process.execPath, [stateScript, "post-tool-use"], {
      cwd: root,
      input: JSON.stringify({ cwd: root, tool_name: "exec_command" }),
      encoding: "utf8",
    });
    assert.equal(idle.status, 0, idle.stderr);
    assert.deepEqual(JSON.parse(idle.stdout), {}, "PostToolUse must not add context without an active goal");

    await startSingleGoal(root);
    const result = spawnSync(process.execPath, [stateScript, "post-tool-use"], {
      cwd: root,
      input: JSON.stringify({ cwd: root, tool_name: "exec_command" }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
    assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(output.hookSpecificOutput.additionalContext, /dry-run\/check evidence/i);
  });
});

async function startSingleGoal(root) {
  return startGoal({ root, goal: "contract", planId: "contract-plan", evidencePolicy: "declared", tasks: [{ id: "only", title: "Only task" }] });
}

function runCli(args) {
  return spawnSync(process.execPath, [cliScript, ...args], { encoding: "utf8" });
}

function spawnAsync(args) {
  return new Promise((resolvePromise) => {
    const processHandle = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    processHandle.stdout.on("data", (chunk) => { stdout += chunk; });
    processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
    processHandle.on("error", (error) => resolvePromise({ code: 1, stdout, stderr: error.message }));
    processHandle.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-verification-contract-"));
  const stateHome = `${root}-home`;
  const previousPotaHome = process.env.POTA_HOME;
  process.env.POTA_HOME = stateHome;
  try {
    await work(root);
  } finally {
    if (previousPotaHome === undefined) delete process.env.POTA_HOME;
    else process.env.POTA_HOME = previousPotaHome;
    await rm(root, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function transientError(code) {
  const error = new Error(`simulated ${code}`);
  error.code = code;
  return error;
}
