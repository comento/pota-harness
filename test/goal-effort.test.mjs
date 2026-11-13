import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assignTask,
  evaluateStop,
  finishGoal,
  goalStatePath,
  goalStats,
  handleGoalCli,
  readGoalState,
  recordReceipt,
  replanGoal,
  setTaskStatus,
  startGoal,
} from "../scripts/pota-goal.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import { STRONGEST_MODEL_BY_HOST } from "../scripts/pota-goal-state-validation.mjs";

const cliScript = resolve("scripts/pota.mjs");

test("goal assign stores effort, source, and route and infers the source from the effort", async () => {
  await withTempRoot(async (root) => {
    const started = await startHeavyGoal(root);
    assert.deepEqual(pickEffort(started.tasks[0]), { route: "heavy", effort: null, effortSource: null, effortWaiver: null });
    assert.equal(started.tasks[1].route, null);

    let state = await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "high" });
    assert.deepEqual(pickEffort(task(state, "heavy")), { route: "heavy", effort: "high", effortSource: "host-option", effortWaiver: null });

    state = await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "inherited" });
    assert.equal(task(state, "heavy").effortSource, "inherited");

    state = await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "xhigh", effortSource: "not-applied" });
    assert.deepEqual(pickEffort(task(state, "heavy")), { route: "heavy", effort: "xhigh", effortSource: "not-applied", effortWaiver: null });

    state = await assignTask({ root, taskId: "heavy", agentId: "worker-1", effortSource: "not-applied" });
    assert.equal(task(state, "heavy").effort, null);
    assert.equal(task(state, "heavy").effortSource, "not-applied");

    state = await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "max", effortSource: "host-option" });
    // Reassigning only the agent keeps the recorded effort and route.
    state = await assignTask({ root, taskId: "heavy", agentId: "worker-2" });
    assert.equal(task(state, "heavy").assignedAgentId, "worker-2");
    assert.deepEqual(pickEffort(task(state, "heavy")), { route: "heavy", effort: "max", effortSource: "host-option", effortWaiver: null });

    state = await assignTask({ root, taskId: "light", agentId: "worker-3", route: "light", effortWaiver: "host has no effort option" });
    assert.deepEqual(pickEffort(task(state, "light")), { route: "light", effort: null, effortSource: null, effortWaiver: "host has no effort option" });
  });
});

test("goal assign rejects invalid effort, source, and route combinations without changing state", async () => {
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    const rejected = [
      [{ effort: "inherited", effortSource: "host-option" }, /effort inherited requires effortSource inherited/],
      [{ effort: "inherited", effortSource: "not-applied" }, /effort inherited requires effortSource inherited/],
      [{ effortSource: "host-option" }, /--effort-source requires --effort unless it is not-applied/],
      [{ effortSource: "inherited" }, /--effort-source requires --effort unless it is not-applied/],
      [{ effort: "extreme" }, /effort must be one of/],
      [{ effort: "high", effortSource: "guessed" }, /effortSource must be one of/],
      [{ route: "medium" }, /route must be one of: light, heavy/],
      [{ effortWaiver: "  " }, /effortWaiver must be a non-empty string/],
    ];
    for (const [options, pattern] of rejected) {
      await assert.rejects(assignTask({ root, taskId: "heavy", agentId: "worker-1", ...options }), pattern);
    }
    const state = await readGoalState({ root });
    assert.equal(task(state, "heavy").assignedAgentId, null);
    assert.deepEqual(pickEffort(task(state, "heavy")), { route: "heavy", effort: null, effortSource: null, effortWaiver: null });
  });
});

test("an assigned Heavy task cannot complete without an applied effort unless a waiver reason is recorded", async () => {
  for (const [label, options] of [
    ["missing", {}],
    ["not-applied", { effort: "high", effortSource: "not-applied" }],
    ["inherited", { effort: "inherited" }],
  ]) {
    await withTempRoot(async (root) => {
      await startHeavyGoal(root);
      await assignTask({ root, taskId: "heavy", agentId: "worker-1", designWaiver: "design gate covered elsewhere", ...options });
      await recordTaskEvidence(root, "heavy");
      await assert.rejects(
        setTaskStatus({ root, taskId: "heavy", status: "completed" }),
        /Heavy task heavy assigned to worker-1 has no applied effort.*goal assign heavy --effort .* --effort-source host-option.*--allow-inherited-effort <reason>/,
        label,
      );
      assert.equal(task(await readGoalState({ root }), "heavy").status, "active", label);
      await assert.rejects(setTaskStatus({ root, taskId: "heavy", status: "blocked", blocker: "x", effortWaiver: "reason" }), /applies only when completing/);
      const completed = await setTaskStatus({ root, taskId: "heavy", status: "completed", effortWaiver: "host exposes no per-agent effort" });
      assert.equal(task(completed, "heavy").status, "completed", label);
      assert.equal(task(completed, "heavy").effortWaiver, "host exposes no per-agent effort", label);
    });
  }
});

test("Heavy completion passes with host-option effort or an assign waiver and ignores Light and unassigned tasks", async () => {
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "xhigh", effortSource: "host-option", designWaiver: "design gate covered elsewhere" });
    await recordTaskEvidence(root, "heavy");
    await setTaskStatus({ root, taskId: "heavy", status: "completed" });
    // Light task assigned without effort completes as before.
    await assignTask({ root, taskId: "light", agentId: "worker-2" });
    await recordTaskEvidence(root, "light");
    const state = await setTaskStatus({ root, taskId: "light", status: "completed" });
    assert.equal(task(state, "light").status, "completed");
  });
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "inherited", effortWaiver: "Codex worker inherits session effort", designWaiver: "design gate covered elsewhere" });
    await recordTaskEvidence(root, "heavy");
    await setTaskStatus({ root, taskId: "heavy", status: "completed" });
  });
  await withTempRoot(async (root) => {
    // The main agent performs an unassigned Heavy task directly.
    await startHeavyGoal(root);
    await recordTaskEvidence(root, "heavy");
    await setTaskStatus({ root, taskId: "heavy", status: "completed" });
  });
});

test("goal finish applies the Heavy effort check when it completes the active task", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Finish a Heavy task",
      planId: "docs/plan/effort-finish.md",
      evidencePolicy: "declared",
      tasks: [{ id: "heavy", title: "Heavy task", route: "heavy" }],
    });
    await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "high", effortSource: "not-applied" });
    await recordTaskEvidence(root, "heavy");
    await assert.rejects(finishGoal({ root, argv: [process.execPath, "-e", "process.exit(0)"] }), /Heavy task heavy .* no applied effort/);
    assert.equal(task(await readGoalState({ root }), "heavy").status, "active");
  });
});

test("goal stats lists task route and effort records", async () => {
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "inherited", effortWaiver: "no host option" });
    const stats = goalStats(await readGoalState({ root }), root);
    assert.deepEqual(stats.tasks, [
      { id: "heavy", status: "active", route: "heavy", effort: "inherited", effortSource: "inherited", effortWaiver: "no host option" },
      { id: "light", status: "pending", route: null, effort: null, effortSource: null },
    ]);
  });
});

test("Stop and SubagentStop warn when an assigned active task has no recorded effort source", async () => {
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    let state = await readGoalState({ root });
    assert.doesNotMatch(evaluateStop(state).reason, /Effort unrecorded/);

    await assignTask({ root, taskId: "heavy", agentId: "worker-1" });
    state = await readGoalState({ root });
    assert.match(evaluateStop(state).reason, / Effort unrecorded for assigned task heavy: record goal assign --effort\/--effort-source\.$/);
    assert.match(evaluateStop(state, { subagent: true, agentId: "worker-1" }).reason, /Effort unrecorded for assigned task heavy/);
    const hook = await runStateResult("subagent-stop", { root, locale: "en-US", payload: { cwd: root, agent_id: "worker-1", turn_id: "t1" } });
    assert.match(hook.hookOutput.reason, /Effort unrecorded for assigned task heavy/);

    await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "high" });
    state = await readGoalState({ root });
    assert.doesNotMatch(evaluateStop(state).reason, /Effort unrecorded/);
    assert.doesNotMatch(evaluateStop(state, { subagent: true, agentId: "worker-1" }).reason, /Effort unrecorded/);
  });
});

test("goal state without effort fields stays valid and keeps completing tasks", async () => {
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    const path = goalStatePath(root);
    const legacy = JSON.parse(await readFile(path, "utf8"));
    for (const item of legacy.tasks) {
      delete item.route;
      delete item.effort;
      delete item.effortSource;
      delete item.effortWaiver;
    }
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`);
    const loaded = await readGoalState({ root });
    assert.equal("effort" in task(loaded, "heavy"), false);
    assert.deepEqual(goalStats(loaded, root).tasks[0], { id: "heavy", status: "active", route: null, effort: null, effortSource: null });
    await assignTask({ root, taskId: "heavy", agentId: "worker-1", designWaiver: "design gate covered elsewhere" });
    await recordTaskEvidence(root, "heavy");
    const completed = await setTaskStatus({ root, taskId: "heavy", status: "completed" });
    assert.equal(task(completed, "heavy").status, "completed");

    const invalid = JSON.parse(await readFile(path, "utf8"));
    invalid.tasks[1].effort = "inherited";
    invalid.tasks[1].effortSource = "host-option";
    await writeFile(path, `${JSON.stringify(invalid, null, 2)}\n`);
    await assert.rejects(readGoalState({ root }), /effort inherited requires effortSource inherited/);
  });
});

test("goal replan accepts a task route and resets effort records", async () => {
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    await assert.rejects(replanGoal({ root, tasks: [{ id: "next", title: "Next", route: "huge" }] }), /route must be one of/);
    const state = await replanGoal({ root, tasks: [{ id: "next", title: "Next", route: "heavy", effort: "high", effortSource: "host-option" }] });
    assert.deepEqual(pickEffort(task(state, "next")), { route: "heavy", effort: null, effortSource: null, effortWaiver: null });
  });
});

test("goal CLI parses effort options, warns on stderr for Heavy tasks, and keeps stdout JSON", async () => {
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    const out = [];
    const err = [];
    const io = { stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
    await handleGoalCli(["goal", "assign", "heavy", "worker-1", "--root", root, "--effort", "high"], io);
    assert.deepEqual(pickEffort(task(JSON.parse(out.at(-1)), "heavy")), { route: "heavy", effort: "high", effortSource: "host-option", effortWaiver: null });
    assert.deepEqual(err, []);

    await handleGoalCli(["goal", "assign", "--task", "heavy", "--agent", "worker-1", "--root", root, "--effort=xhigh", "--effort-source", "not-applied"], io);
    assert.equal(err.length, 1);
    assert.match(err[0], /^Pota warning: Heavy task heavy is assigned without an applied effort \(effort xhigh, source not-applied\)/);

    await handleGoalCli(["goal", "assign", "light", "worker-2", "--root", root, "--route", "light"], io);
    assert.equal(err.length, 1, "Light tasks do not warn");
    await assert.rejects(handleGoalCli(["goal", "assign", "heavy", "--root", root, "--effort-source", "host-option"], io), /requires --effort/);

    await recordTaskEvidence(root, "heavy");
    await assert.rejects(handleGoalCli(["goal", "task", "complete", "heavy", "--root", root], io), /no applied effort/);
    await handleGoalCli(["goal", "task", "complete", "heavy", "--root", root, "--allow-inherited-effort", "host rejected the effort option", "--allow-no-design-model", "design gate covered elsewhere"], io);
    assert.equal(task(JSON.parse(out.at(-1)), "heavy").effortWaiver, "host rejected the effort option");

    const stats = spawnSync(process.execPath, [cliScript, "goal", "stats", "--root", root], { encoding: "utf8", env: process.env });
    assert.equal(stats.status, 0, stats.stderr);
    assert.equal(JSON.parse(stats.stdout).tasks[0].effortWaiver, "host rejected the effort option");
  });
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    const assigned = spawnSync(process.execPath, [cliScript, "goal", "assign", "heavy", "worker-1", "--root", root], { encoding: "utf8", env: process.env });
    assert.equal(assigned.status, 0, assigned.stderr);
    assert.equal(task(JSON.parse(assigned.stdout), "heavy").assignedAgentId, "worker-1");
    assert.match(assigned.stderr, /Pota warning: Heavy task heavy is assigned without an applied effort \(effort none, source none\)/);
  });
});

test("a design task cannot complete without a host-option model unless a waiver reason is recorded", async () => {
  for (const [label, options] of [
    ["missing", {}],
    ["not-applied", { modelSource: "not-applied" }],
    ["inherited", { model: "inherited" }],
  ]) {
    await withTempRoot(async (root) => {
      await startDesignGoal(root);
      await assignTask({ root, taskId: "design", kind: "design", ...options });
      await recordTaskEvidence(root, "design");
      await assert.rejects(
        setTaskStatus({ root, taskId: "design", status: "completed" }),
        /Design task design has no recorded design model.*goal assign design --model <value> --model-source host-option.*--allow-no-design-model <reason>/,
        label,
      );
      assert.equal(task(await readGoalState({ root }), "design").status, "active", label);
      await assert.rejects(setTaskStatus({ root, taskId: "design", status: "blocked", blocker: "x", designWaiver: "reason" }), /applies only when completing/);
      const completed = await setTaskStatus({ root, taskId: "design", status: "completed", designWaiver: "host has no strongest tier" });
      assert.equal(task(completed, "design").designWaiver, "host has no strongest tier", label);
    });
  }
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    await assignTask({ root, taskId: "design", kind: "design", model: "fable" });
    assert.deepEqual(pickModel(task(await readGoalState({ root }), "design")), { kind: "design", model: "fable", modelSource: "host-option", designWaiver: null });
    await recordTaskEvidence(root, "design");
    const completed = await setTaskStatus({ root, taskId: "design", status: "completed" });
    assert.equal(task(completed, "design").status, "completed");
  });
});

test("an assigned Heavy task needs a completed design task or a waiver; Light and unassigned tasks are unaffected", async () => {
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "high" });
    await recordTaskEvidence(root, "heavy");
    await assert.rejects(setTaskStatus({ root, taskId: "heavy", status: "completed" }), /Heavy task heavy assigned to worker-1 has no completed design task/);
    assert.equal(task(await readGoalState({ root }), "heavy").status, "active");
    const waived = await setTaskStatus({ root, taskId: "heavy", status: "completed", designWaiver: "trivial Heavy change" });
    assert.equal(task(waived, "heavy").designWaiver, "trivial Heavy change");
  });
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    await assignTask({ root, taskId: "design", kind: "design", model: "fable" });
    await recordTaskEvidence(root, "design");
    await setTaskStatus({ root, taskId: "design", status: "completed" });
    await assignTask({ root, taskId: "heavy", agentId: "worker-1", effort: "high" });
    await recordTaskEvidence(root, "heavy");
    assert.equal(task(await setTaskStatus({ root, taskId: "heavy", status: "completed" }), "heavy").status, "completed");
  });
  await withTempRoot(async (root) => {
    await startHeavyGoal(root);
    await recordTaskEvidence(root, "heavy");
    await setTaskStatus({ root, taskId: "heavy", status: "completed" });
    await assignTask({ root, taskId: "light", agentId: "worker-2", route: "light" });
    await recordTaskEvidence(root, "light");
    assert.equal(task(await setTaskStatus({ root, taskId: "light", status: "completed" }), "light").status, "completed");
  });
  await withTempRoot(async (root) => {
    await startGoal({ root, goal: "Unassigned Heavy", planId: "docs/plan/design.md", evidencePolicy: "declared", tasks: [{ id: "heavy", title: "Heavy", route: "heavy" }] });
    await recordTaskEvidence(root, "heavy");
    assert.equal(task(await setTaskStatus({ root, taskId: "heavy", status: "completed" }), "heavy").status, "completed");
  });
});

test("goal assign and task input reject invalid kind and model records without changing state", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    const rejected = [
      [{ kind: "build" }, /kind must be one of: design/],
      [{ modelSource: "guessed" }, /modelSource must be one of/],
      [{ modelSource: "host-option" }, /modelSource host-option requires a model/],
      [{ modelSource: "inherited" }, /modelSource inherited requires a model/],
      [{ model: "fable", modelSource: "guessed" }, /modelSource must be one of/],
      [{ model: "  " }, /model must be a non-empty string/],
      [{ designWaiver: "  " }, /designWaiver must be a non-empty string/],
    ];
    for (const [options, pattern] of rejected) {
      await assert.rejects(assignTask({ root, taskId: "design", agentId: "worker-1", ...options }), pattern);
    }
    const state = await readGoalState({ root });
    assert.equal(task(state, "design").assignedAgentId, null);
    assert.deepEqual(pickModel(task(state, "design")), { kind: "design", model: null, modelSource: null, designWaiver: null });
    await assert.rejects(replanGoal({ root, tasks: [{ id: "next", title: "Next", kind: "build" }] }), /kind must be one of: design/);
  });
  await withTempRoot(async (root) => {
    await assert.rejects(startGoal({ root, goal: "x", planId: "docs/plan/x.md", tasks: [{ title: "x", kind: "build" }] }), /kind must be one of: design/);
  });
});

test("goal state without design fields stays valid and invalid stored model records are rejected", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    const path = goalStatePath(root);
    const legacy = JSON.parse(await readFile(path, "utf8"));
    for (const item of legacy.tasks) {
      delete item.kind;
      delete item.model;
      delete item.modelSource;
      delete item.designWaiver;
    }
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`);
    const loaded = await readGoalState({ root });
    assert.equal("kind" in task(loaded, "design"), false);
    assert.deepEqual(goalStats(loaded, root).tasks[0], { id: "design", status: "active", route: "heavy", effort: null, effortSource: null });
    legacy.tasks[0].modelSource = "host-option";
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`);
    await assert.rejects(readGoalState({ root }), /modelSource host-option requires a model/);
  });
});

test("goal replan resets model fields on replanned tasks and accepts kind design", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    const state = await replanGoal({ root, tasks: [{ id: "next", title: "Next", kind: "design", route: "heavy", model: "fable", modelSource: "host-option", designWaiver: "x" }] });
    assert.deepEqual(pickModel(task(state, "next")), { kind: "design", model: null, modelSource: null, designWaiver: null });
  });
});

test("goal CLI passes design flags to state and stats show them only when set", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    const out = [];
    const io = { stdout: (line) => out.push(line), stderr: () => {} };
    await handleGoalCli(["goal", "assign", "design", "--root", root, "--kind", "design", "--model", "fable", "--model-source", "host-option"], io);
    assert.deepEqual(pickModel(task(JSON.parse(out.at(-1)), "design")), { kind: "design", model: "fable", modelSource: "host-option", designWaiver: null });
    await handleGoalCli(["goal", "assign", "heavy", "worker-1", "--root", root, "--allow-no-design-model", "reason"], io);
    assert.equal(task(JSON.parse(out.at(-1)), "heavy").designWaiver, "reason");
    await assert.rejects(handleGoalCli(["goal", "task", "design", "--root", root, "--status", "active", "--allow-no-design-model", "r"], io), /applies only when completing/);
    const stats = goalStats(await readGoalState({ root }), root);
    assert.deepEqual(stats.tasks, [
      { id: "design", status: "active", route: "heavy", effort: null, effortSource: null, kind: "design", model: "fable", modelSource: "host-option" },
      { id: "heavy", status: "pending", route: "heavy", effort: null, effortSource: null, designWaiver: "reason" },
      { id: "light", status: "pending", route: null, effort: null, effortSource: null },
    ]);
  });
});

async function startDesignGoal(root) {
  return startGoal({
    root,
    goal: "Route Heavy design",
    planId: "docs/plan/design.md",
    evidencePolicy: "declared",
    tasks: [
      { id: "design", title: "Heavy design", route: "heavy", kind: "design" },
      { id: "heavy", title: "Heavy task", route: "heavy" },
      { id: "light", title: "Light task" },
    ],
  });
}

function pickModel(item) {
  return { kind: item.kind, model: item.model, modelSource: item.modelSource, designWaiver: item.designWaiver };
}

async function startHeavyGoal(root) {
  return startGoal({
    root,
    goal: "Enforce dispatch effort",
    planId: "docs/plan/effort.md",
    evidencePolicy: "declared",
    tasks: [{ id: "heavy", title: "Heavy task", route: "heavy" }, { id: "light", title: "Light task" }],
  });
}

async function recordTaskEvidence(root, taskId) {
  for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
    await recordReceipt({ root, taskId, kind, command: `verify ${taskId} ${kind}`, exitCode: 0 });
  }
}

function task(state, id) {
  return state.tasks.find((item) => item.id === id);
}

function pickEffort(item) {
  return { route: item.route, effort: item.effort, effortSource: item.effortSource, effortWaiver: item.effortWaiver };
}

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-goal-effort-"));
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

const designGateError = /Design task design recorded model .* expected .*fable.*gpt-6-astra.*pro.*--allow-no-design-model <reason>/;

async function completeDesign(root) {
  await recordTaskEvidence(root, "design");
  return setTaskStatus({ root, taskId: "design", status: "completed" });
}

test("a design task without a declared host must use one of the strongest values", async () => {
  for (const model of ["fable", "gpt-6-astra", "pro"]) {
    await withTempRoot(async (root) => {
      await startDesignGoal(root);
      await assignTask({ root, taskId: "design", kind: "design", model });
      assert.equal(task(await completeDesign(root), "design").status, "completed", model);
    });
  }
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    await assignTask({ root, taskId: "design", kind: "design", model: "opus" });
    await recordTaskEvidence(root, "design");
    await assert.rejects(setTaskStatus({ root, taskId: "design", status: "completed" }), designGateError);
    assert.equal(task(await readGoalState({ root }), "design").status, "active");
    const waived = await setTaskStatus({ root, taskId: "design", status: "completed", designWaiver: "host has no strongest tier" });
    assert.equal(task(waived, "design").status, "completed");
  });
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    await assignTask({ root, taskId: "design", kind: "design", model: "opus", designWaiver: "assign-time waiver" });
    assert.equal(task(await completeDesign(root), "design").status, "completed");
  });
});

test("a design task with a declared host must use that host's strongest value", async () => {
  for (const [modelHost, model, ok] of [
    ["claude-code", "fable", true], ["claude-code", "pro", false], ["claude-code", "opus", false],
    ["codex", "gpt-6-astra", true], ["codex", "fable", false],
    ["antigravity", "pro", true],
  ]) {
    await withTempRoot(async (root) => {
      await startDesignGoal(root);
      await assignTask({ root, taskId: "design", kind: "design", model, modelHost });
      if (ok) assert.equal(task(await completeDesign(root), "design").status, "completed", `${modelHost} ${model}`);
      else {
        await recordTaskEvidence(root, "design");
        await assert.rejects(
          setTaskStatus({ root, taskId: "design", status: "completed" }),
          new RegExp(`Design task design recorded model ${model}, expected ${STRONGEST_MODEL_BY_HOST[modelHost]} for host ${modelHost}.*--allow-no-design-model <reason>`),
          `${modelHost} ${model}`,
        );
      }
    });
  }
});

test("modelHost and effectiveModel are validated, kept on omission, and reset by replan", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    await assert.rejects(assignTask({ root, taskId: "design", modelHost: "gemini" }), /modelHost must be one of/);
    await assert.rejects(assignTask({ root, taskId: "design", effectiveModel: "   " }), /effectiveModel/);
    assert.equal(task(await readGoalState({ root }), "design").modelHost, null);
    let state = await assignTask({ root, taskId: "design", model: "fable", modelHost: "claude-code", effectiveModel: "claude-fable-5-1" });
    assert.equal(task(state, "design").modelHost, "claude-code");
    assert.equal(task(state, "design").effectiveModel, "claude-fable-5-1");
    state = await assignTask({ root, taskId: "design", agentId: "worker-1" });
    assert.equal(task(state, "design").modelHost, "claude-code");
    assert.equal(task(state, "design").effectiveModel, "claude-fable-5-1");
    state = await assignTask({ root, taskId: "design", effectiveModel: "unreported" });
    assert.equal(task(state, "design").effectiveModel, "unreported");
    state = await replanGoal({ root, tasks: [{ id: "design", title: "Heavy design", route: "heavy", kind: "design" }] });
    assert.equal(task(state, "design").modelHost, null);
    assert.equal(task(state, "design").effectiveModel, null);
  });
});

test("stored state with an invalid modelHost or blank effectiveModel is rejected on load; absent fields load", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    const path = goalStatePath(root);
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const field of ["modelHost", "effectiveModel"]) assert.equal(field in original.tasks[0], true);
    const legacy = structuredClone(original);
    for (const item of legacy.tasks) { delete item.modelHost; delete item.effectiveModel; }
    await writeFile(path, JSON.stringify(legacy));
    const loaded = await readGoalState({ root });
    assert.equal(loaded.tasks.length, 3);
    assert.deepEqual(Object.keys(goalStats(loaded).tasks[0]).filter((key) => key === "modelHost" || key === "effectiveModel"), []);

    for (const [field, value, pattern] of [["modelHost", "gemini", /modelHost/], ["effectiveModel", "  ", /effectiveModel/]]) {
      const broken = structuredClone(original);
      broken.tasks[0][field] = value;
      await writeFile(path, JSON.stringify(broken));
      await assert.rejects(readGoalState({ root }), pattern, field);
    }
  });
});

test("goal CLI passes --host and --effective-model, stats exposes them only when set, and a mismatch warns on stderr", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    const out = [];
    const err = [];
    const io = { stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
    await handleGoalCli(["goal", "assign", "design", "--root", root, "--kind", "design", "--model", "fable", "--host", "claude-code", "--effective-model", "claude-fable-5-1"], io);
    assert.deepEqual(err, []);
    const assigned = task(JSON.parse(out.at(-1)), "design");
    assert.equal(assigned.modelHost, "claude-code");
    assert.equal(assigned.effectiveModel, "claude-fable-5-1");

    await handleGoalCli(["goal", "assign", "design", "--root", root, "--effective-model", "unreported"], io);
    assert.deepEqual(err, [], "unreported never warns");
    await handleGoalCli(["goal", "assign", "design", "--root", root, "--effective-model", "claude-opus-4-7"], io);
    assert.equal(err.length, 1);
    assert.match(err[0], /^Pota warning: Task design effective model claude-opus-4-7 does not match the passed model fable/);
    assert.equal(task(JSON.parse(out.at(-1)), "design").effectiveModel, "claude-opus-4-7", "stdout JSON is unchanged and the assign is not blocked");
    await assert.rejects(handleGoalCli(["goal", "assign", "design", "--root", root, "--host", "gemini"], io), /modelHost must be one of/);
    assert.equal(task(await readGoalState({ root }), "design").modelHost, "claude-code");

    const stats = goalStats(await readGoalState({ root }));
    const design = stats.tasks.find((item) => item.id === "design");
    assert.equal(design.modelHost, "claude-code");
    assert.equal(design.effectiveModel, "claude-opus-4-7");
    const light = stats.tasks.find((item) => item.id === "light");
    assert.equal("modelHost" in light, false);
    assert.equal("effectiveModel" in light, false);
  });
});

test("the code strongest table matches the strongest values documented in skills/pota-plan/delegation.md", async () => {
  const doc = await readFile(resolve("skills/pota-plan/delegation.md"), "utf8");
  assert.deepEqual({ ...STRONGEST_MODEL_BY_HOST }, { "claude-code": "fable", codex: "gpt-6-astra", antigravity: "pro" });
  for (const value of Object.values(STRONGEST_MODEL_BY_HOST)) assert.ok(doc.includes(`\`${value}\``), value);
});
