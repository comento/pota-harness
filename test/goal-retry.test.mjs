import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  pauseGoal,
  resumeGoal,
  readGoalState,
  transitionGoal,
  setTaskApprovalGate,
  setTaskStatus,
  startGoal,
  assignTask,
  verifyAndRecord,
} from "../scripts/pota-goal.mjs";
import { retryTask } from "../scripts/pota-goal-operations.mjs";

const cliScript = resolve("scripts/pota.mjs");

async function startBlocked(root, tasks) {
  await startGoal({ root, goal: "Retry blocked work", planId: "docs/plan/retry.md", tasks });
  return setTaskStatus({ root, taskId: "a", status: "blocked", blocker: "needs input" });
}

const chain = [{ id: "a", title: "A" }, { id: "b", title: "B", dependsOn: ["a"] }];

test("retryTask returns a blocked task to pending, clears dispatch fields, and reactivates the goal", async () => {
  await withTempRoot(async (root) => {
    const blocked = await startBlocked(root, chain);
    assert.equal(blocked.goal.status, "blocked");
    const state = await retryTask(root, { taskId: "a" });
    const task = state.tasks.find((item) => item.id === "a");
    assert.equal(state.goal.status, "active");
    assert.equal(state.goal.blocker, null);
    // 재시도된 task는 의존성이 없으므로 advance로 곧바로 active가 된다.
    assert.equal(task.status, "active");
    assert.equal(task.blocker, null);
    for (const key of ["assignedAgentId", "effort", "effortSource", "model", "modelSource", "effectiveModel", "modelHost"]) {
      assert.equal(task[key], null, key);
    }
    assert.deepEqual(await readGoalState({ root }), state);
  });
});

test("retryTask leaves other completed tasks and their receipts untouched", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Retry blocked work",
      planId: "docs/plan/retry.md",
      tasks: [{ id: "done", title: "Done" }, { id: "a", title: "A", dependsOn: ["done"] }],
    });
    await assignTask({ root, taskId: "done", agentId: "worker-1" });
    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      await verifyAndRecord({ root, taskId: "done", kind, argv: [process.execPath, "-e", "process.exit(0)"] });
    }
    await setTaskStatus({ root, taskId: "done", status: "completed" });
    await setTaskStatus({ root, taskId: "a", status: "blocked", blocker: "stuck" });
    const prior = await readGoalState({ root });
    const before = prior.tasks.find((task) => task.id === "done");
    const state = await retryTask({ root, taskId: "a" });
    assert.ok(prior.receipts.length > 0);
    assert.deepEqual(state.receipts, prior.receipts);
    assert.deepEqual(state.tasks.find((task) => task.id === "done"), before);
    assert.equal(state.tasks.find((task) => task.id === "a").status, "active");
  });
});

test("retryTask clears all seven assignment fields and receipts of the retried task but keeps route, kind, evidence, and gate", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "g",
      planId: "docs/plan/retry.md",
      tasks: [{ id: "done", title: "Done" }, { id: "a", title: "A", dependsOn: ["done"] }],
    });
    await assignTask({ root, taskId: "done", agentId: "worker-1" });
    await assignTask({
      root, taskId: "a", agentId: "worker-2", effort: "high", effortSource: "host-option", route: "heavy", kind: "design",
      model: "opus", modelSource: "host-option", effectiveModel: "opus-x", modelHost: "claude-code",
    });
    for (const taskId of ["done", "a"]) {
      for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
        await verifyAndRecord({ root, taskId, kind, argv: [process.execPath, "-e", "process.exit(0)"] });
      }
      if (taskId === "done") await setTaskStatus({ root, taskId, status: "completed" });
    }
    await setTaskStatus({ root, taskId: "a", status: "blocked", blocker: "stuck" });
    const before = await readGoalState({ root });
    const beforeTask = before.tasks.find((task) => task.id === "a");
    assert.ok(before.receipts.some((receipt) => receipt.taskId === "a"));
    const state = await retryTask({ root, taskId: "a" });
    const task = state.tasks.find((item) => item.id === "a");
    for (const key of ["assignedAgentId", "effort", "effortSource", "model", "modelSource", "effectiveModel", "modelHost"]) {
      assert.equal(task[key], null, key);
    }
    for (const key of ["route", "kind", "requiredEvidence", "approvalGate"]) {
      assert.deepEqual(task[key], beforeTask[key], key);
    }
    assert.equal(task.route, "heavy");
    assert.equal(task.kind, "design");
    assert.equal(state.receipts.some((receipt) => receipt.scope === "task" && receipt.taskId === "a"), false);
    assert.ok(state.receipts.some((receipt) => receipt.scope === "task" && receipt.taskId === "done"));
  });
});

test("retryTask activates the retried task while another blocked task remains", async () => {
  await withTempRoot(async (root) => {
    await startGoal({ root, goal: "g", planId: "docs/plan/retry.md", tasks: [{ id: "a", title: "A" }, { id: "c", title: "C" }] });
    await setTaskStatus({ root, taskId: "a", status: "blocked", blocker: "needs input" });
    await setTaskStatus({ root, taskId: "c", status: "blocked", blocker: "other" });
    assert.equal((await readGoalState({ root })).goal.status, "blocked");
    const state = await retryTask({ root, taskId: "a" });
    assert.equal(state.goal.status, "active");
    assert.equal(state.goal.blocker, null);
    assert.equal(state.tasks.find((task) => task.id === "a").status, "active");
    assert.equal(state.tasks.find((task) => task.id === "c").status, "blocked");
  });
});

test("retryTask keeps a goal blocked by a human blocked while the task returns to pending", async () => {
  await withTempRoot(async (root) => {
    await startGoal({ root, goal: "g", planId: "docs/plan/retry.md", tasks: [{ id: "a", title: "A" }, { id: "c", title: "C" }] });
    await setTaskStatus({ root, taskId: "a", status: "blocked", blocker: "needs input" });
    await resumeGoal(root);
    await transitionGoal({ root, status: "blocked", blocker: "waiting for the customer" });
    const state = await retryTask({ root, taskId: "a" });
    assert.equal(state.goal.status, "blocked");
    assert.equal(state.goal.blocker, "waiting for the customer");
    assert.equal(state.tasks.find((task) => task.id === "a").status, "pending");
  });
});

test("retryTask re-blocks the goal with the remaining blocked task's reason when a dependency is blocked", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "g",
      planId: "docs/plan/retry.md",
      tasks: [{ id: "a", title: "A" }, { id: "b", title: "B", dependsOn: ["a"] }, { id: "c", title: "C" }],
    });
    await setTaskStatus({ root, taskId: "c", status: "blocked", blocker: "c broke" });
    await setTaskStatus({ root, taskId: "a", status: "blocked", blocker: "a broke" });
    const state = await retryTask({ root, taskId: "b" }).catch((error) => error);
    assert.ok(state instanceof Error);
    // b는 pending이므로 재시도할 수 없다. 의존성이 blocked인 task를 blocked로 만든 뒤 재시도한다.
    await setTaskStatus({ root, taskId: "b", status: "blocked", blocker: "b broke" });
    const retried = await retryTask({ root, taskId: "b" });
    assert.equal(retried.tasks.find((task) => task.id === "b").status, "pending");
    assert.equal(retried.goal.status, "blocked");
    assert.ok(["a broke", "c broke"].includes(retried.goal.blocker));
  });
});

test("retryTask rejects a task that is not blocked", async () => {
  await withTempRoot(async (root) => {
    await startGoal({ root, goal: "g", planId: "docs/plan/retry.md", tasks: chain });
    await assert.rejects(retryTask(root, { taskId: "a" }), /Task a is active; only a blocked task can be retried/);
    await assert.rejects(retryTask(root, { taskId: "b" }), /Task b is pending; only a blocked task can be retried/);
  });
});

test("retryTask keeps a paused goal paused while the task returns to pending", async () => {
  await withTempRoot(async (root) => {
    await startBlocked(root, chain);
    await pauseGoal(root);
    const state = await retryTask(root, { taskId: "a" });
    assert.equal(state.goal.status, "paused");
    assert.equal(state.tasks.find((task) => task.id === "a").status, "pending");
  });
});

test("retryTask leaves a gated task pending while the goal turns active", async () => {
  await withTempRoot(async (root) => {
    await startGoal({ root, goal: "g", planId: "docs/plan/retry.md", tasks: [{ id: "a", title: "A" }] });
    await setTaskStatus({ root, taskId: "a", status: "blocked", blocker: "stuck" });
    await setTaskApprovalGate({ root, taskId: "a", enabled: true });
    const state = await retryTask(root, { taskId: "a" });
    assert.equal(state.goal.status, "active");
    assert.equal(state.tasks[0].status, "pending");
    assert.equal(state.tasks[0].approvalGate, true);
  });
});

test("retryTask fails without a goal or for an unknown task", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(retryTask(root, { taskId: "a" }));
    await startBlocked(root, chain);
    await assert.rejects(retryTask(root, { taskId: "missing" }), /Unknown task: missing/);
  });
});

test("goal retry CLI retries a blocked task", async () => {
  await withTempRoot(async (root) => {
    await startBlocked(root, chain);
    const run = spawnSync(process.execPath, [cliScript, "goal", "retry", "--task", "a", "--root", root], {
      encoding: "utf8",
      env: { ...process.env, POTA_HOME: process.env.POTA_HOME },
    });
    assert.equal(run.status, 0, run.stderr);
    const state = JSON.parse(run.stdout);
    assert.equal(state.goal.status, "active");
    assert.equal(state.tasks.find((task) => task.id === "a").status, "active");
    assert.equal(spawnSync(process.execPath, [cliScript, "goal", "retry", "--task", "a", "--root", root], { encoding: "utf8" }).status === 0, false);
  });
});

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-goal-retry-"));
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
