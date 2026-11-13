import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assignTask,
  evaluateStop,
  goalStatePath,
  readGoalState,
  readyTasks,
  replanGoal,
  setTaskStatus,
  startGoal,
  transitionGoal,
  verifyAndRecord,
} from "../scripts/pota-goal.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";

const cliScript = resolve("scripts/pota.mjs");
const passArgv = [process.execPath, "-e", "process.exit(0)"];
const statuses = (state) => Object.fromEntries(state.tasks.map((task) => [task.id, task.status]));

// A and B are independent; C waits for both. D depends only on A.
const diamond = [
  { id: "A", title: "Branch A", dependsOn: [], writeScope: ["src/a"] },
  { id: "B", title: "Branch B", dependsOn: [], writeScope: ["src/b"] },
  { id: "C", title: "Join", dependsOn: ["A", "B"], writeScope: ["src/c"] },
];

async function verifyTask(root, taskId, watch) {
  await verifyAndRecord({ root, taskId, kind: ["moduleAcceptance", "surfaceIntegration"], watchPaths: [watch], argv: passArgv });
}

async function seedFiles(root) {
  for (const dir of ["src/a", "src/b", "src/c"]) {
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, dir, "file.txt"), "v1\n");
  }
}

test("goals without dependsOn keep sequential order and implicit previous-task dependencies", async () => {
  await withTempRoot(async (root) => {
    const state = await startGoal({
      root,
      goal: "Sequential",
      planId: "docs/plan/seq.md",
      tasks: [{ id: "triage-plan", title: "Triage" }, { id: "implement", title: "Implement" }, { id: "verify", title: "Verify" }],
    });
    assert.equal(state.schemaVersion, 3);
    assert.deepEqual(state.tasks.map((task) => task.dependsOn), [[], ["triage-plan"], ["implement"]]);
    assert.deepEqual(state.tasks.map((task) => task.writeScope), [null, null, null]);
    assert.deepEqual(statuses(state), { "triage-plan": "active", implement: "pending", verify: "pending" });
    assert.deepEqual(readyTasks(state).map((task) => task.id), []);
    await assert.rejects(setTaskStatus({ root, taskId: "verify", status: "active" }), /waiting for: implement/);
  });
});

test("v2 state migrates to v3 with explicit previous-task dependencies", async () => {
  await withTempRoot(async (root) => {
    const now = new Date().toISOString();
    const task = (id, status) => ({ id, title: id, status, assignedAgentId: null, requiredEvidence: ["moduleAcceptance"], blocker: null, createdAt: now, updatedAt: now });
    await startGoal({ root, goal: "Placeholder", planId: "docs/plan/v2.md", tasks: [{ id: "x", title: "x" }] });
    const current = await readGoalState({ root });
    await writeFile(goalStatePath(root), `${JSON.stringify({
      ...current,
      schemaVersion: 2,
      tasks: [task("one", "completed"), task("two", "active"), task("three", "pending")],
      receipts: [],
    })}\n`);
    const migrated = await readGoalState({ root });
    assert.equal(migrated.schemaVersion, 3);
    assert.deepEqual(migrated.tasks.map((item) => item.dependsOn), [[], ["one"], ["two"]]);
    assert.deepEqual(migrated.tasks.map((item) => item.writeScope), [null, null, null]);
  });
});

test("independent tasks run concurrently and the join becomes ready only after both complete", async () => {
  await withTempRoot(async (root) => {
    await seedFiles(root);
    const started = await startGoal({ root, goal: "Diamond", planId: "docs/plan/diamond.md", tasks: diamond });
    assert.deepEqual(statuses(started), { A: "active", B: "pending", C: "pending" });
    assert.deepEqual(readyTasks(started).map((task) => task.id), ["B"]);
    await setTaskStatus({ root, taskId: "B", status: "active" });
    await assert.rejects(setTaskStatus({ root, taskId: "C", status: "active" }), /waiting for: A, B/);

    await verifyTask(root, "A", "src/a");
    await setTaskStatus({ root, taskId: "A", status: "completed" });
    let state = await readGoalState({ root });
    assert.deepEqual(statuses(state), { A: "completed", B: "active", C: "pending" });
    assert.deepEqual(readyTasks(state).map((task) => task.id), []);

    await verifyTask(root, "B", "src/b");
    await setTaskStatus({ root, taskId: "B", status: "completed" });
    state = await readGoalState({ root });
    assert.deepEqual(statuses(state), { A: "completed", B: "completed", C: "active" });

    const ready = spawnSync(process.execPath, [cliScript, "goal", "ready", "--root", root], { encoding: "utf8" });
    assert.equal(ready.status, 0, ready.stderr);
    assert.deepEqual(JSON.parse(ready.stdout), { active: ["C"], ready: [], blocked: [] });
  });
});

test("cycles, unknown ids, self references, duplicates, overlapping scopes, and the active cap are rejected", async () => {
  await withTempRoot(async (root) => {
    const start = (tasks) => startGoal({ root, goal: "Invalid", planId: "docs/plan/invalid.md", tasks });
    await assert.rejects(start([{ id: "a", title: "a", dependsOn: ["b"] }, { id: "b", title: "b", dependsOn: ["a"] }]), /cycle/i);
    await assert.rejects(start([{ id: "a", title: "a", dependsOn: ["missing"] }]), /unknown task: missing/i);
    await assert.rejects(start([{ id: "a", title: "a", dependsOn: ["a"] }]), /itself/i);
    await assert.rejects(start([{ id: "a", title: "a" }, { id: "a", title: "again" }]), /duplicate task id/i);
    await assert.rejects(start([{ id: "a", title: "a", dependsOn: [], writeScope: ["../outside"] }]), /writeScope/);

    await start([
      { id: "a", title: "a", dependsOn: [], writeScope: ["src"] },
      { id: "b", title: "b", dependsOn: [], writeScope: ["src/nested"] },
      { id: "c", title: "c", dependsOn: [] },
      { id: "d", title: "d", dependsOn: [], writeScope: ["d"] },
      { id: "e", title: "e", dependsOn: [], writeScope: ["e"] },
      { id: "f", title: "f", dependsOn: [], writeScope: ["f"] },
      { id: "g", title: "g", dependsOn: [], writeScope: ["g"] },
    ]);
    await assert.rejects(setTaskStatus({ root, taskId: "b", status: "active" }), /writeScope overlaps active task a/);
    await assert.rejects(setTaskStatus({ root, taskId: "c", status: "active" }), /without writeScope/);
    for (const id of ["d", "e", "f"]) await setTaskStatus({ root, taskId: id, status: "active" });
    await assert.rejects(setTaskStatus({ root, taskId: "g", status: "active" }), /at most 4 active tasks/);

    await assert.rejects(
      replanGoal({ root, tasks: [{ id: "x", title: "x", dependsOn: ["y"] }, { id: "y", title: "y", dependsOn: ["x"] }] }),
      /cycle/i,
    );
  });
});

test("a blocked branch keeps its dependents pending while an unrelated branch continues", async () => {
  await withTempRoot(async (root) => {
    await seedFiles(root);
    await startGoal({
      root,
      goal: "Blocked branch",
      planId: "docs/plan/blocked.md",
      tasks: [
        { id: "A", title: "A", dependsOn: [], writeScope: ["src/a"] },
        { id: "A2", title: "After A", dependsOn: ["A"], writeScope: ["src/a"] },
        { id: "B", title: "B", dependsOn: [], writeScope: ["src/b"] },
      ],
    });
    await setTaskStatus({ root, taskId: "A", status: "blocked", blocker: "Waiting for an API key" });
    let state = await readGoalState({ root });
    assert.equal(state.goal.status, "active");
    assert.deepEqual(statuses(state), { A: "blocked", A2: "pending", B: "active" });

    await verifyTask(root, "B", "src/b");
    await setTaskStatus({ root, taskId: "B", status: "completed" });
    state = await readGoalState({ root });
    assert.equal(state.goal.status, "blocked");
    assert.equal(state.goal.blocker, "Waiting for an API key");
    assert.deepEqual(statuses(state), { A: "blocked", A2: "pending", B: "completed" });
  });
});

test("a parallel worker's edits do not stale another task's watch-scoped evidence; unscoped verify is refused", async () => {
  await withTempRoot(async (root) => {
    await seedFiles(root);
    await startGoal({ root, goal: "Isolation", planId: "docs/plan/isolation.md", tasks: diamond });
    await setTaskStatus({ root, taskId: "B", status: "active" });
    await verifyTask(root, "A", "src/a");
    await writeFile(join(root, "src/b/file.txt"), "worker B edit\n");

    let ran = false;
    const runner = () => { ran = true; return { status: 0, stdout: "", stderr: "" }; };
    await assert.rejects(
      verifyAndRecord({ root, taskId: "B", kind: "moduleAcceptance", argv: ["unused"], runner }),
      /pass --watch/,
    );
    await assert.rejects(
      verifyAndRecord({ root, taskId: "B", kind: "moduleAcceptance", watchPaths: ["src"], argv: ["unused"], runner }),
      /inside task B writeScope/,
    );
    assert.equal(ran, false);
    await setTaskStatus({ root, taskId: "A", status: "completed" });
  });
});

test("main Stop covers every active task and SubagentStop gates each assigned worker", async () => {
  await withTempRoot(async (root) => {
    await seedFiles(root);
    await startGoal({ root, goal: "Stops", planId: "docs/plan/stops.md", tasks: diamond });
    await setTaskStatus({ root, taskId: "B", status: "active" });
    await assignTask({ root, taskId: "A", agentId: "worker-a" });
    await assignTask({ root, taskId: "B", agentId: "worker-b" });
    const state = await readGoalState({ root });

    const main = evaluateStop(state);
    assert.equal(main.block, true);
    assert.match(main.reason, /A \(Branch A\)/);
    assert.match(main.reason, /B \(Branch B\)/);
    for (const [agentId, taskId] of [["worker-a", "A"], ["worker-b", "B"]]) {
      const gate = evaluateStop(state, { subagent: true, agentId });
      assert.equal(gate.block, true);
      assert.match(gate.reason, new RegExp(`Pota task ${taskId} `));
    }
    assert.equal(evaluateStop(state, { subagent: true, agentId: "worker-x" }).block, false);

    await verifyTask(root, "A", "src/a");
    await setTaskStatus({ root, taskId: "A", status: "completed" });
    const afterA = await readGoalState({ root });
    assert.equal(evaluateStop(afterA, { subagent: true, agentId: "worker-a" }).block, false);
    assert.equal(evaluateStop(afterA, { subagent: true, agentId: "worker-b" }).block, true);
  });
});

test("pause, resume, and a new session keep active tasks, assignments, and evidence", async () => {
  await withTempRoot(async (root) => {
    await seedFiles(root);
    await startGoal({ root, goal: "Persist", planId: "docs/plan/persist.md", tasks: diamond, ownerSessionId: "s1" });
    await setTaskStatus({ root, taskId: "B", status: "active" });
    await assignTask({ root, taskId: "A", agentId: "worker-a" });
    await verifyTask(root, "A", "src/a");
    const before = await readGoalState({ root });
    await transitionGoal({ root, status: "paused" });
    await transitionGoal({ root, status: "active" });
    await runStateResult("session-start", { root, locale: "en_US", payload: { cwd: root, session_id: "s1" } });
    const after = await readGoalState({ root });
    assert.deepEqual(statuses(after), statuses(before));
    assert.equal(after.tasks.find((task) => task.id === "A").assignedAgentId, "worker-a");
    assert.deepEqual(after.receipts.map((receipt) => receipt.id), before.receipts.map((receipt) => receipt.id));
    await setTaskStatus({ root, taskId: "A", status: "completed" });
  });
});

test("hook output is unchanged for a single active task and bounded for parallel tasks", async () => {
  await withTempRoot(async (root) => {
    await seedFiles(root);
    const payload = { cwd: root, session_id: "s1" };
    const sequential = [{ id: "one", title: "One" }, { id: "two", title: "Two" }];
    await startGoal({ root, goal: "Hook", planId: "docs/plan/hook.md", tasks: sequential, ownerSessionId: "s1" });
    const single = (await runStateResult("user-prompt-submit", { root, locale: "en_US", payload })).message;
    assert.ok(!single.includes("Parallel"));
    await transitionGoal({ root, status: "cancelled" });

    const longTitle = "A very long parallel task title that must be clipped in hook context";
    await startGoal({
      root,
      goal: "Hook",
      planId: "docs/plan/hook.md",
      ownerSessionId: "s1",
      tasks: diamond.map((task) => ({ ...task, title: `${task.id} ${longTitle}` })),
    });
    await setTaskStatus({ root, taskId: "B", status: "active" });
    const parallel = (await runStateResult("user-prompt-submit", { root, locale: "en_US", payload })).message;
    const line = parallel.split("\n").find((item) => item.startsWith("Parallel active:"));
    assert.ok(line, parallel);
    assert.match(line, /B \(B A very long/);
    assert.ok(!parallel.includes(longTitle));
    assert.ok(line.length <= 160, `parallel line is ${line.length} characters`);
    assert.ok(parallel.length <= 820, `parallel hook is ${parallel.length} characters`);
  });
});

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-goal-dag-"));
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
