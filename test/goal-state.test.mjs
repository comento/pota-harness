import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assignTask,
  claimGoal,
  evaluateStop,
  goalStatePath,
  readGoalState,
  recordReceipt,
  replanGoal,
  setTaskStatus,
  startGoal,
  transitionGoal,
  verifyAndRecord,
  finishGoal,
  goalStats,
  worktreeId,
} from "../scripts/pota-goal.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import { cleanupProjectPota } from "../scripts/pota-cleanup.mjs";

const stateScript = resolve("scripts/pota-state.mjs");
const cliScript = resolve("scripts/pota.mjs");

test("goal start persists a versioned, bound state atomically", async () => {
  await withTempRoot(async (root) => {
    const state = await startGoal({
      root,
      goal: "Ship the runtime fix",
      planId: "docs/plan/runtime.md",
      tasks: [{ id: "runtime", title: "Implement runtime" }, { id: "verify", title: "Run verification" }],
      completionCriteria: ["All tasks have successful receipts"],
    });

    assert.equal(state.schemaVersion, 3);
    assert.equal(state.goal.evidencePolicy, "tool-bound");
    assert.equal(state.goal.worktreeId, worktreeId(root));
    assert.equal(state.goal.status, "active");
    assert.equal(state.tasks[0].status, "active");
    assert.equal(state.tasks[1].status, "pending");
    const text = await readFile(goalStatePath(root), "utf8");
    assert.deepEqual(JSON.parse(text), state);
    const leftovers = await readdir(dirname(goalStatePath(root)));
    assert.equal(leftovers.filter((name) => name.endsWith(".tmp")).length, 0);
  });
});

test("goal replan preserves completed work and replaces the incomplete roadmap", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Reclassify the route",
      planId: "docs/plan/reclassify.md",
      evidencePolicy: "declared",
      tasks: [
        { id: "triage", title: "Triage" },
        { id: "light-implement", title: "Light implementation" },
        { id: "verify", title: "Verify" },
      ],
    });
    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      await recordReceipt({ root, taskId: "triage", kind, command: `verify triage ${kind}`, exitCode: 0 });
    }
    await setTaskStatus({ root, taskId: "triage", status: "completed" });
    await recordReceipt({ root, taskId: "light-implement", kind: "moduleAcceptance", command: "old light evidence", exitCode: 0 });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "old goal evidence", exitCode: 0 });

    const replanned = await replanGoal({
      root,
      tasks: [
        { id: "heavy-review", title: "Review the Heavy plan", requiredEvidence: ["planReview"] },
        { id: "heavy-implement", title: "Implement the Heavy plan" },
        { id: "verify", title: "Verify the Heavy plan" },
      ],
    });

    assert.deepEqual(replanned.tasks.map(({ id, status }) => ({ id, status })), [
      { id: "triage", status: "completed" },
      { id: "heavy-review", status: "active" },
      { id: "heavy-implement", status: "pending" },
      { id: "verify", status: "pending" },
    ]);
    assert.deepEqual(replanned.tasks[1].requiredEvidence, ["planReview"]);
    assert.ok(replanned.receipts.every((receipt) => receipt.taskId === "triage"));
    await assert.rejects(replanGoal({ root, tasks: [] }), /at least one incomplete task/i);
    await assert.rejects(replanGoal({ root, tasks: [{ id: "triage", title: "Duplicate completed task" }] }), /completed task id/i);
  });
});

test("goal replan CLI replaces the incomplete roadmap", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "CLI replan",
      planId: "docs/plan/cli-replan.md",
      tasks: [{ id: "light", title: "Light task" }],
    });

    const cli = spawnSync(process.execPath, [
      cliScript,
      "goal", "replan",
      "--root", root,
      "--tasks", JSON.stringify([
        { id: "review", title: "Heavy review", requiredEvidence: ["planReview"] },
        { id: "implement", title: "Heavy implementation" },
      ]),
    ], { encoding: "utf8" });

    assert.equal(cli.status, 0, cli.stderr);
    const state = JSON.parse(cli.stdout);
    assert.deepEqual(state.tasks.map((task) => task.id), ["review", "implement"]);
    assert.equal(state.tasks[0].status, "active");
  });
});

test("schema v1 state migrates to tool-bound schema v2 without losing declared evidence", async () => {
  await withTempRoot(async (root) => {
    const now = new Date().toISOString();
    await mkdir(dirname(goalStatePath(root)), { recursive: true });
    await writeFile(goalStatePath(root), `${JSON.stringify({
      schemaVersion: 1,
      revision: 3,
      goal: {
        id: "goal-v1",
        title: "Migrate old state",
        planId: "docs/plan/v1.md",
        status: "active",
        completionCriteria: [],
        requiredEvidence: ["finalReview"],
        ownerSessionId: null,
        blocker: null,
        createdAt: now,
        updatedAt: now,
      },
      tasks: [{
        id: "legacy",
        title: "Legacy task",
        status: "active",
        assignedAgentId: null,
        requiredEvidence: ["moduleAcceptance", "surfaceIntegration"],
        blocker: null,
        createdAt: now,
        updatedAt: now,
      }],
      receipts: [{
        id: "receipt-v1",
        scope: "task",
        kind: "moduleAcceptance",
        taskId: "legacy",
        goalId: "goal-v1",
        planId: "docs/plan/v1.md",
        command: "node --test",
        exitCode: 0,
        timestamp: now,
        source: "tool",
      }],
    }, null, 2)}\n`);

    const migrated = await readGoalState({ root });
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.goal.evidencePolicy, "tool-bound");
    assert.equal(migrated.receipts[0].source, "declared");
    assert.deepEqual(migrated.tasks[0].dependsOn, []);
    assert.equal(migrated.tasks[0].writeScope, null);
  });
});

test("main CLI forwards the goal namespace to the installed runtime command", async () => {
  await withTempRoot(async (root) => {
    const cli = spawnSync(process.execPath, [
      cliScript,
      "goal",
      "start",
      "--root", root,
      "--goal", "CLI goal",
      "--plan", "docs/plan/cli.md",
      "--tasks", "CLI task",
      "--session", "cli-session",
    ], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    const state = await readGoalState({ root });
    assert.equal(state.goal.title, "CLI goal");
    assert.equal(state.goal.ownerSessionId, "cli-session");
  });
});

test("goal CLI preserves inline option values while parsing quiet as boolean", async () => {
  await withTempRoot(async (root) => {
    const cli = spawnSync(process.execPath, [
      cliScript,
      "goal", "start",
      `--root=${root}`,
      "--goal=Inline CLI goal=a=b",
      "--plan=docs/plan/inline.md",
      "--tasks=Inline task",
      "--session=inline-session",
      "--quiet=false",
    ], { encoding: "utf8" });

    assert.equal(cli.status, 0, cli.stderr);
    const state = JSON.parse(cli.stdout);
    assert.equal(state.goal.title, "Inline CLI goal=a=b");
    assert.equal(state.goal.planId, "docs/plan/inline.md");
    assert.equal(state.goal.ownerSessionId, "inline-session");
  });
});

test("top-level task CLI accepts action and task id shorthand", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Task shorthand",
      planId: "docs/plan/task-shorthand.md",
      evidencePolicy: "declared",
      tasks: [{ id: "only", title: "Only task" }],
    });
    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      await recordReceipt({ root, taskId: "only", kind, command: `verify ${kind}`, exitCode: 0 });
    }

    const cli = spawnSync(process.execPath, [cliScript, "task", "complete", "only", "--root", root], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    const state = await readGoalState({ root });
    assert.equal(state.tasks[0].status, "completed");
  });
});

test("receipt CLI accepts the kebab-case exit-code option", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Receipt CLI",
      planId: "docs/plan/receipt-cli.md",
      evidencePolicy: "declared",
      tasks: [{ id: "receipt", title: "Record receipt" }],
    });

    const cli = spawnSync(process.execPath, [
      cliScript,
      "goal", "receipt",
      "--root", root,
      "--task", "receipt",
      "--kind", "moduleAcceptance",
      "--command", "npm test",
      "--exit-code", "0",
    ], { encoding: "utf8" });

    assert.equal(cli.status, 0, cli.stderr);
    const state = await readGoalState({ root });
    assert.equal(state.receipts[0].exitCode, 0);
    assert.equal(state.receipts[0].kind, "moduleAcceptance");
  });
});

test("tool-bound goals execute verification, reject declared and stale evidence, and keep failures unrecorded", async () => {
  await withTempRoot(async (root) => {
    const watched = join(root, "watched.txt");
    await writeFile(watched, "v1\n");
    const started = spawnSync(process.execPath, [
      cliScript,
      "goal", "start",
      "--quiet",
      "--root", root,
      "--goal", "Tool-bound evidence",
      "--plan", "docs/plan/tool-bound.md",
      "--tasks", JSON.stringify([{
        id: "verify",
        title: "Verify with the tool",
        requiredEvidence: ["moduleAcceptance", "surfaceIntegration"],
      }]),
    ], { encoding: "utf8" });
    assert.equal(started.status, 0, started.stderr);

    await assert.rejects(
      recordReceipt({
        root,
        taskId: "verify",
        kind: "moduleAcceptance",
        command: "fabricated tool evidence",
        exitCode: 0,
        source: "tool",
      }),
      /only goal verify/i,
    );

    const preflightMarker = join(root, "must-not-run.txt");
    const invalidTarget = spawnSync(process.execPath, [
      cliScript,
      "goal", "verify",
      "--quiet",
      "--root", root,
      "--task", "missing-task",
      "--kind", "moduleAcceptance",
      "--watch", watched,
      "--",
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(preflightMarker)}, "ran")`,
    ], { encoding: "utf8" });
    assert.notEqual(invalidTarget.status, 0);
    assert.match(invalidTarget.stderr, /unknown task/i);
    await assert.rejects(access(preflightMarker));

    const declared = spawnSync(process.execPath, [
      cliScript,
      "goal", "receipt",
      "--quiet",
      "--root", root,
      "--task", "verify",
      "--kind", "moduleAcceptance",
      "--command", "node --test (never executed)",
      "--exit-code", "0",
    ], { encoding: "utf8" });
    assert.equal(declared.status, 0, declared.stderr);
    const declaredCompletion = spawnSync(process.execPath, [
      cliScript, "goal", "task", "--root", root, "--task", "verify", "--status", "completed",
    ], { encoding: "utf8" });
    assert.notEqual(declaredCompletion.status, 0);
    assert.match(declaredCompletion.stderr, /tool-bound evidence/i);

    const failed = runVerify(root, "moduleAcceptance", watched, "process.exit(7)");
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /verification failed.*exit 7/is);
    assert.equal((await readGoalState({ root })).receipts.filter((item) => item.source === "tool").length, 0);

    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      const verified = runVerify(root, kind, watched, "console.log('verified')");
      assert.equal(verified.status, 0, verified.stderr);
      assert.equal(verified.stdout, "");
    }
    const verifiedState = await readGoalState({ root });
    const toolEvidence = verifiedState.receipts.filter((item) => item.source === "tool");
    assert.equal(toolEvidence.length, 2);
    assert.deepEqual(toolEvidence[0].argv.slice(0, 2), [process.execPath, "-e"]);
    assert.match(toolEvidence[0].outputDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(toolEvidence[0].workspaceFingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.match(toolEvidence[0].summary, /verification passed.*outputBytes/i);
    assert.ok(toolEvidence[0].summary.length < 120);

    const exactArgv = spawnSync(process.execPath, [
      cliScript,
      "goal", "verify",
      "--quiet",
      "--root", root,
      "--task", "verify",
      "--kind", "surfaceIntegration",
      "--watch", watched,
      "--",
      process.execPath,
      "-e",
      "process.exit(0)",
      "",
      "  spaced  ",
    ], { encoding: "utf8" });
    assert.equal(exactArgv.status, 0, exactArgv.stderr);
    assert.deepEqual((await readGoalState({ root })).receipts.at(-1).argv.slice(-2), ["", "  spaced  "]);

    await writeFile(watched, "v2\n");
    const staleCompletion = spawnSync(process.execPath, [
      cliScript, "goal", "task", "--root", root, "--task", "verify", "--status", "completed",
    ], { encoding: "utf8" });
    assert.notEqual(staleCompletion.status, 0);
    assert.match(staleCompletion.stderr, /stale evidence/i);

    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      const refreshed = runVerify(root, kind, watched, "console.log('refreshed')");
      assert.equal(refreshed.status, 0, refreshed.stderr);
    }
    const completed = spawnSync(process.execPath, [
      cliScript, "goal", "task", "--quiet", "--root", root, "--task", "verify", "--status", "completed",
    ], { encoding: "utf8" });
    assert.equal(completed.status, 0, completed.stderr);

    await writeFile(watched, "v3\n");
    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      const refreshedAfterCompletion = runVerify(root, kind, watched, "console.log('refreshed after completion')");
      assert.equal(refreshedAfterCompletion.status, 0, refreshedAfterCompletion.stderr);
    }
    const refreshedCompletedState = await readGoalState({ root });
    assert.equal(refreshedCompletedState.tasks[0].status, "completed");
    assert.equal(refreshedCompletedState.receipts.filter((item) => item.source === "tool").length, 7);
  });
});

test("completed tasks can refresh stale tool evidence without reopening status or assignment", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({
      root,
      goal: "Refresh completed evidence",
      planId: "docs/plan/refresh.md",
      tasks: [{ id: "refresh", title: "Refresh evidence" }],
    });
    await assignTask({ root, taskId: "refresh", agentId: "worker-1" });
    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      await verifyAndRecord({ root, taskId: "refresh", kind, watchPaths: ["watched.txt"], argv: [process.execPath, "-e", "process.exit(0)"] });
    }
    await setTaskStatus({ root, taskId: "refresh", status: "completed" });
    await writeFile(join(root, "watched.txt"), "v2\n");

    const refreshed = await verifyAndRecord({
      root,
      taskId: "refresh",
      kind: "moduleAcceptance",
      watchPaths: ["watched.txt"],
      argv: [process.execPath, "-e", "console.log('refreshed')"],
    });
    const task = refreshed.state.tasks.find((item) => item.id === "refresh");
    assert.equal(task.status, "completed");
    assert.equal(task.assignedAgentId, "worker-1");
    assert.equal(refreshed.evidence.kind, "moduleAcceptance");
    await assert.rejects(setTaskStatus({ root, taskId: "refresh", status: "active" }), /Cannot transition task/);
  });
});

test("verification rejects pending, blocked, and terminal targets before running tools", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Reject invalid verification targets",
      planId: "docs/plan/reject.md",
      evidencePolicy: "declared",
      tasks: [{ id: "active", title: "Active" }, { id: "pending", title: "Pending" }],
    });
    let ran = false;
    const runner = () => { ran = true; return { status: 0, stdout: "", stderr: "" }; };
    await assert.rejects(
      verifyAndRecord({ root, taskId: "pending", kind: "moduleAcceptance", argv: ["unused"], runner }),
      /must be active or completed/,
    );
    await setTaskStatus({ root, taskId: "active", status: "blocked", blocker: "waiting" });
    await assert.rejects(
      verifyAndRecord({ root, taskId: "active", kind: "moduleAcceptance", argv: ["unused"], runner }),
      /must be active or completed/,
    );
    assert.equal(ran, false);
  });

  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Terminal verification",
      planId: "docs/plan/terminal.md",
      evidencePolicy: "declared",
      tasks: [{ id: "only", title: "Only" }],
    });
    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      await recordReceipt({ root, taskId: "only", kind, command: `verify ${kind}`, exitCode: 0 });
    }
    await setTaskStatus({ root, taskId: "only", status: "completed" });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "review", exitCode: 0 });
    await transitionGoal({ root, status: "completed" });
    assert.equal(await readGoalState({ root }), null);
    await assert.rejects(
      verifyAndRecord({ root, taskId: "only", kind: "moduleAcceptance", argv: [process.execPath, "-e", "process.exit(0)"] }),
      /No Pota goal state exists/,
    );
  });
});

test("verification fails closed when goal, task, assignment, or watched files race", async () => {
  const cases = [
    ["goal identity", (state) => { state.goal.id = "goal-replaced-during-verification"; }],
    ["plan identity", (state) => { state.goal.planId = "docs/plan/replaced.md"; }],
    ["task status", (state) => { state.tasks[0].status = "blocked"; state.tasks[0].blocker = "raced"; }],
    ["task assignment", (state) => { state.tasks[0].assignedAgentId = "raced-agent"; }],
  ];
  for (const [name, mutate] of cases) {
    await withTempRoot(async (root) => {
      await startGoal({ root, goal: `Race ${name}`, planId: "docs/plan/race.md", tasks: [{ id: "race", title: "Race" }] });
      const runner = () => {
        const path = goalStatePath(root);
        const state = JSON.parse(readFileSync(path, "utf8"));
        mutate(state);
        writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
        return { status: 0, stdout: "ok", stderr: "" };
      };
      await assert.rejects(
        verifyAndRecord({ root, taskId: "race", kind: "moduleAcceptance", argv: ["race"], runner }),
        /changed during verification/,
        name,
      );
      assert.equal((await readGoalState({ root })).receipts.length, 0);
    });
  }

  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({ root, goal: "Watch race", planId: "docs/plan/watch.md", tasks: [{ id: "race", title: "Race" }] });
    const runner = () => {
      writeFileSync(join(root, "watched.txt"), "v2\n");
      return { status: 0, stdout: "ok", stderr: "" };
    };
    await assert.rejects(
      verifyAndRecord({ root, taskId: "race", kind: "moduleAcceptance", watchPaths: ["watched.txt"], argv: ["race"], runner }),
      /Watched workspace changed/,
    );
    assert.equal((await readGoalState({ root })).receipts.length, 0);
  });
});

test("receipts fail closed and task completion advances only after successful bound evidence", async () => {
  await withTempRoot(async (root) => {
    const initial = await createTwoTaskGoal(root);
    await assert.rejects(
      setTaskStatus({ root, taskId: "first", status: "completed" }),
      /successful, bound evidence record/,
    );
    await assert.rejects(
      recordReceipt({ root, taskId: "first", kind: "moduleAcceptance", command: "npm test", exitCode: 1 }),
      /exitCode must be 0/,
    );
    await assert.rejects(
      recordReceipt({ root, taskId: "first", kind: "moduleAcceptance", command: "tests skipped", exitCode: 0 }),
      /cannot be skipped/,
    );
    await assert.rejects(
      recordReceipt({ root, taskId: "first", kind: "moduleAcceptance", command: "npm test", exitCode: 0, goalId: "wrong" }),
      /goalId does not match/,
    );

    await recordReceipt({ root, taskId: "first", kind: "moduleAcceptance", command: "npm test", exitCode: 0, goalId: initial.goal.id, planId: initial.goal.planId });
    await recordReceipt({ root, taskId: "first", kind: "surfaceIntegration", command: "npm pack --dry-run", exitCode: 0 });
    const afterFirst = await setTaskStatus({ root, taskId: "first", status: "completed" });
    assert.equal(afterFirst.tasks.find((task) => task.id === "second").status, "active");
    await assert.rejects(
      setTaskStatus({ root, taskId: "first", status: "pending" }),
      /Cannot transition task first from completed to pending/,
    );

    await recordReceipt({ root, taskId: "second", kind: "moduleAcceptance", command: "npm test", exitCode: 0 });
    await recordReceipt({ root, taskId: "second", kind: "surfaceIntegration", command: "npm run check", exitCode: 0 });
    await setTaskStatus({ root, taskId: "second", status: "completed" });
    await assert.rejects(
      transitionGoal({ root, status: "completed" }),
      /finalReview/,
    );
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "npm run check", exitCode: 0 });
    const completed = await transitionGoal({ root, status: "completed" });
    assert.equal(completed.goal.status, "completed");
    assert.equal(await readGoalState({ root }), null);
  });
});

test("automatic context hooks do not initialize an uninitialized repository", async () => {
  await withTempRoot(async (root) => {
    const session = await runStateResult("session-start", { root, locale: "en-US", payload: { cwd: root, session_id: "s1", turn_id: "t1" } });
    const prompt = await runStateResult("user-prompt-submit", { root, locale: "en-US", payload: { cwd: root, session_id: "s1", turn_id: "t1", prompt: "Implement the requested fix" } });
    assert.match(session.message, /root MEMORY\.md is optional.*read it when present/i);
    assert.match(prompt.message, /root MEMORY\.md is optional.*read it when present/i);
    assert.equal(session.hookOutput.hookSpecificOutput.hookEventName, "SessionStart");
    assert.equal(prompt.hookOutput.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(prompt.hookOutput.hookSpecificOutput.additionalContext, /non-trivial implementation.*planned-work continuation.*load pota-plan/i);
    assert.match(prompt.hookOutput.hookSpecificOutput.additionalContext, /known-target Git\/GitHub operations stay plan\/goal-free/i);
    assert.match(prompt.hookOutput.hookSpecificOutput.additionalContext, /code edits.*conflict resolution.*destructive recovery.*release\/deploy.*design/i);
    assert.match(prompt.hookOutput.hookSpecificOutput.additionalContext, /consultation, explanation, and plan-only requests are also goal-free/i);
    assert.match(prompt.hookOutput.hookSpecificOutput.additionalContext, /stop only if active state.*missing, unreadable, or inconsistent/i);
    const promptKo = await runStateResult("user-prompt-submit", { root, locale: "ko-KR", payload: { cwd: root, session_id: "s1", turn_id: "t2", prompt: "요청한 수정을 구현해줘" } });
    assert.match(promptKo.hookOutput.hookSpecificOutput.additionalContext, /비단순 구현이나 계획된 작업 재개는 pota-plan/);
    assert.match(promptKo.hookOutput.hookSpecificOutput.additionalContext, /Git\/GitHub 상태·fetch·checkout·merge·push·PR 작업.*plan\/goal 없이/);
    assert.match(promptKo.hookOutput.hookSpecificOutput.additionalContext, /코드 수정·충돌 해결·파괴적 복구·릴리스\/배포·설계/);
    assert.match(promptKo.hookOutput.hookSpecificOutput.additionalContext, /상담·설명·계획 전용도 goal 없이/);
    assert.match(promptKo.hookOutput.hookSpecificOutput.additionalContext, /active state.*없거나 읽을 수 없거나 일치하지 않을 때만 중단/);
    await assert.rejects(access(join(root, "MEMORY.md")));
    await assert.rejects(access(join(root, ".pota")));
  });
});

test("worktree-bound state removes an identical copy from another worktree", async () => {
  const first = await mkdtemp(join(tmpdir(), "pota-worktree-first-"));
  const second = await mkdtemp(join(tmpdir(), "pota-worktree-second-"));
  const previousPotaHome = process.env.POTA_HOME;
  process.env.POTA_HOME = join(first, ".user-pota");
  try {
    await startGoal({
      root: first,
      goal: "Original worktree goal",
      planId: "docs/plan/worktree.md",
      ownerSessionId: "first-session",
      tasks: [{ id: "work", title: "Work" }],
    });
    await mkdir(dirname(goalStatePath(second)), { recursive: true });
    await writeFile(goalStatePath(second), await readFile(goalStatePath(first), "utf8"));

    const result = await runStateResult("user-prompt-submit", {
      root: second,
      locale: "en-US",
      payload: { cwd: second, session_id: "second-session", prompt: "Continue" },
    });
    assert.equal(await readGoalState({ root: second }), null);
    assert.equal((await readGoalState({ root: first })).goal.status, "active");
    assert.match(result.hookOutput.hookSpecificOutput.additionalContext, /removed stale Pota state.*did not belong to this worktree/i);
  } finally {
    if (previousPotaHome === undefined) delete process.env.POTA_HOME;
    else process.env.POTA_HOME = previousPotaHome;
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("worktree reconciliation removes legacy state without a worktree id", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Legacy unbound goal",
      planId: "docs/plan/legacy.md",
      tasks: [{ id: "legacy", title: "Legacy" }],
    });
    const legacy = JSON.parse(await readFile(goalStatePath(root), "utf8"));
    delete legacy.goal.worktreeId;
    await writeFile(goalStatePath(root), `${JSON.stringify(legacy, null, 2)}\n`);

    const result = await runStateResult("user-prompt-submit", {
      root,
      locale: "en-US",
      payload: { cwd: root, session_id: "new-session", prompt: "Start current work" },
    });
    assert.equal(await readGoalState({ root }), null);
    assert.match(result.hookOutput.hookSpecificOutput.additionalContext, /removed stale Pota state/i);
  });
});

test("legacy project cleanup inspects by default and preserves unknown entries", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, ".pota", "tools"), { recursive: true });
    await writeFile(join(root, ".pota", "state.lock"), `${JSON.stringify({
      schemaVersion: 1,
      pid: 99999999,
      hostname: hostname(),
      nonce: "dead-owner",
      acquiredAt: new Date().toISOString(),
    })}\n`);
    await writeFile(join(root, ".pota", "keep.txt"), "user data\n");

    const inspected = await cleanupProjectPota({ root });
    assert.deepEqual(inspected.known, ["state.lock", "tools"]);
    assert.deepEqual(inspected.unknown, ["keep.txt"]);
    await access(join(root, ".pota", "state.lock"));

    const applied = await cleanupProjectPota({ root, apply: true });
    assert.deepEqual(applied.removed, ["state.lock", "tools"]);
    assert.equal(applied.projectDirectoryRemoved, false);
    assert.equal(await readFile(join(root, ".pota", "keep.txt"), "utf8"), "user data\n");
  });
});

test("session-owned goals are isolated from other hook sessions", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Session isolated goal",
      planId: "docs/plan/session.md",
      ownerSessionId: "session-owner",
      tasks: [{ id: "secret-task-id", title: "Secret task title" }],
    });
    const owner = await runStateResult("session-start", { root, locale: "en-US", payload: { cwd: root, session_id: "session-owner", turn_id: "t1" } });
    assert.equal(owner.hookOutput.hookSpecificOutput.hookEventName, "SessionStart");
    const cli = spawnSync(process.execPath, [stateScript, "session-start"], {
      cwd: root,
      input: JSON.stringify({ cwd: root, session_id: "session-owner", turn_id: "t1" }),
      encoding: "utf8",
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).hookSpecificOutput.hookEventName, "SessionStart");

    for (const event of ["session-start", "user-prompt-submit"]) {
      const foreign = await runStateResult(event, { root, locale: "en-US", payload: { cwd: root, session_id: "session-foreign", turn_id: "t2" } });
      const context = foreign.hookOutput.hookSpecificOutput.additionalContext;
      assert.match(context, /owned by another session/i);
      assert.match(context, /do not start, edit, delegate, or complete/i);
      assert.doesNotMatch(context, /Session isolated goal|docs\/plan\/session\.md|secret-task-id|Secret task title/);
    }
    for (const event of ["stop", "subagent-stop"]) {
      const foreign = await runStateResult(event, { root, locale: "en-US", payload: { cwd: root, session_id: "session-foreign", turn_id: "t2" } });
      assert.deepEqual(foreign.hookOutput, {}, `${event} must not block an owner-bound goal`);
    }
  });
});

test("active goal context includes the ordered task roadmap and side-question return point", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Roadmap goal",
      planId: "docs/plan/roadmap.md",
      ownerSessionId: "roadmap-session",
      tasks: [
        { id: "inspect", title: "Inspect the issue" },
        { id: "implement", title: "Implement the fix" },
        { id: "verify", title: "Verify the result" },
      ],
    });

    const prompt = await runStateResult("user-prompt-submit", {
      root,
      locale: "en-US",
      payload: { cwd: root, session_id: "roadmap-session", turn_id: "t1", prompt: "What is the status?" },
    });
    const context = prompt.hookOutput.hookSpecificOutput.additionalContext;
    assert.match(context, /Work steps:\n1\. inspect \[active\] Inspect the issue/);
    assert.match(context, /2\. implement \[pending\] Implement the fix/);
    assert.match(context, /3\. verify \[pending\] Verify the result/);
    assert.match(context, /After a side question or steer, resume inspect, then advance remaining tasks to final review/);

    const promptKo = await runStateResult("user-prompt-submit", {
      root,
      locale: "ko-KR",
      payload: { cwd: root, session_id: "roadmap-session", turn_id: "t2", prompt: "잠깐 상태를 알려줘" },
    });
    const contextKo = promptKo.hookOutput.hookSpecificOutput.additionalContext;
    assert.match(contextKo, /작업 단계:\n1\. inspect \[active\] Inspect the issue/);
    assert.match(contextKo, /곁가지 질문·조향 뒤 inspect를 재개하고 남은 task를 최종 검토까지 진행/);
  });
});

test("hook cwd resolves a nested directory to the repository goal root", async () => {
  await withTempRoot(async (root) => {
    const nested = join(root, "packages", "app");
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await startGoal({
      root,
      goal: "Nested hook goal",
      planId: "docs/plan/nested.md",
      ownerSessionId: "nested-session",
      tasks: [{ id: "nested", title: "Nested task" }],
    });

    const stop = await runStateResult("stop", {
      locale: "en-US",
      payload: { cwd: nested, session_id: "nested-session", turn_id: "nested-turn" },
    });
    assert.equal(stop.hookOutput.decision, "block");
    assert.match(stop.hookOutput.reason, /Nested task/);
    await assert.rejects(access(join(nested, ".pota")));
  });
});

test("blocked transitions require a reason and state revisions advance", async () => {
  await withTempRoot(async (root) => {
    const started = await createTwoTaskGoal(root);
    await assert.rejects(transitionGoal({ root, status: "blocked" }), /blocker must be a non-empty string/);
    const blocked = await transitionGoal({ root, status: "blocked", blocker: "Waiting for user approval" });
    assert.equal(blocked.goal.blocker, "Waiting for user approval");
    assert.equal(blocked.revision, started.revision + 1);
    await assert.rejects(
      setTaskStatus({ root, taskId: "first", status: "blocked" }),
      /blocker must be a non-empty string/,
    );
  });
});

test("active context resumes a blocked task instead of reporting all tasks complete", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Resume blocked work",
      planId: "docs/plan/blocked-context.md",
      tasks: [{ id: "blocked-task", title: "Resolve the blocker" }],
    });
    await setTaskStatus({ root, taskId: "blocked-task", status: "blocked", blocker: "Waiting on a dependency" });
    await transitionGoal({ root, status: "active" });

    const prompt = await runStateResult("user-prompt-submit", {
      root,
      locale: "en-US",
      payload: { cwd: root, prompt: "Continue" },
    });
    const context = prompt.hookOutput.hookSpecificOutput.additionalContext;
    assert.match(context, /Current: blocked-task.*Resolve the blocker/);
    assert.doesNotMatch(context, /All tasks.*complete/i);
  });
});

test("Stop returns the Codex continuation JSON only for an active current task", async () => {
  await withTempRoot(async (root) => {
    const active = await createTwoTaskGoal(root);
    const blocked = await runStateResult("stop", { root, locale: "en-US", payload: { cwd: root, session_id: "s1", turn_id: "t1" } });
    assert.equal(blocked.status, 0);
    assert.equal(blocked.hookOutput.decision, "block");
    assert.match(blocked.hookOutput.reason, /first/);
    assert.match(blocked.hookOutput.reason, /evidence record/i);
    assert.doesNotMatch(blocked.hookOutput.reason, /receipt/i);

    const cli = spawnSync(process.execPath, [stateScript, "stop"], {
      cwd: root,
      input: JSON.stringify({ cwd: root, session_id: "s1", turn_id: "t1", stop_hook_active: true }),
      encoding: "utf8",
    });
    assert.equal(cli.status, 0, cli.stderr);
    const output = JSON.parse(cli.stdout);
    assert.deepEqual(Object.keys(output).sort(), ["continue", "systemMessage"]);
    assert.equal(output.continue, true);
    assert.match(output.systemMessage, /already continued/);

    await transitionGoal({ root, status: "paused" });
    const paused = await runStateResult("stop", { root, locale: "en-US", payload: { cwd: root } });
    assert.deepEqual(paused.hookOutput, { continue: true });
    assert.equal(active.goal.status, "active");
  });
});

test("Stop keeps blocking continued turns while the goal makes progress", async () => {
  await withTempRoot(async (root) => {
    await createTwoTaskGoal(root);
    const payload = { cwd: root, session_id: "s1", turn_id: "t1" };
    const first = await runStateResult("stop", { root, locale: "en-US", payload });
    assert.equal(first.hookOutput.decision, "block");

    const idleRepeat = await runStateResult("stop", { root, locale: "en-US", payload: { ...payload, stop_hook_active: true } });
    assert.equal(idleRepeat.hookOutput.continue, true);
    assert.match(idleRepeat.hookOutput.systemMessage, /still active and incomplete/);
    assert.doesNotMatch(idleRepeat.hookOutput.systemMessage, /next session/);

    await recordReceipt({ root, taskId: "first", kind: "moduleAcceptance", command: "check first", exitCode: 0 });
    const progressed = await runStateResult("stop", { root, locale: "en-US", payload: { ...payload, stop_hook_active: true } });
    assert.equal(progressed.hookOutput.decision, "block", "progress since the last continuation must keep driving the goal");

    const repeat = await runStateResult("stop", { root, locale: "en-US", payload: { ...payload, stop_hook_active: true } });
    assert.equal(repeat.hookOutput.continue, true, "a no-progress repeat must not loop forever");
  });
});

test("hooks without a session id still drive a session-owned goal, and claim transfers ownership", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Owned goal",
      planId: "docs/plan/owned.md",
      ownerSessionId: "owner",
      evidencePolicy: "declared",
      tasks: [{ id: "only", title: "Only task" }],
    });
    const anonymous = await runStateResult("user-prompt-submit", { root, locale: "en-US", payload: { cwd: root, prompt: "go" } });
    assert.match(anonymous.hookOutput.hookSpecificOutput.additionalContext, /Current: only/);
    const anonymousStop = await runStateResult("stop", { root, locale: "en-US", payload: { cwd: root } });
    assert.equal(anonymousStop.hookOutput.decision, "block");

    const foreign = await runStateResult("session-start", { root, locale: "en-US", payload: { cwd: root, session_id: "next-session" } });
    assert.match(foreign.hookOutput.hookSpecificOutput.additionalContext, /pota goal claim --session "next-session"/);

    const cli = spawnSync(process.execPath, [cliScript, "goal", "claim", "--quiet", "--root", root, "--session", "next-session"], { encoding: "utf8", env: process.env });
    assert.equal(cli.status, 0, cli.stderr);
    const claimed = await runStateResult("user-prompt-submit", { root, locale: "en-US", payload: { cwd: root, session_id: "next-session", prompt: "continue" } });
    assert.match(claimed.hookOutput.hookSpecificOutput.additionalContext, /Current: only/);
    await claimGoal({ root, sessionId: "owner" });
    assert.equal((await readGoalState({ root })).goal.ownerSessionId, "owner");
  });
});

test("starting a goal over an unfinished goal points to replan instead of a false pause hint", async () => {
  await withTempRoot(async (root) => {
    await createTwoTaskGoal(root);
    await transitionGoal({ root, status: "paused" });
    await assert.rejects(
      startGoal({ root, goal: "Drift", planId: "docs/plan/drift.md", tasks: ["x"] }),
      /unfinished Pota goal .*paused.*goal replan/,
    );
  });
});

test("hook failures emit JSON and read-only hooks create no user-home state", async () => {
  await withTempRoot(async (root) => {
    const idle = spawnSync(process.execPath, [stateScript, "stop"], { cwd: root, input: JSON.stringify({ cwd: root }), encoding: "utf8", env: process.env });
    assert.equal(idle.status, 0, idle.stderr);
    await assert.rejects(access(join(process.env.POTA_HOME, "projects")), "an idle hook must not create state directories");

    await createTwoTaskGoal(root);
    await writeFile(goalStatePath(root), "{not json");
    const broken = spawnSync(process.execPath, [stateScript, "stop"], { cwd: root, input: JSON.stringify({ cwd: root }), encoding: "utf8", env: process.env });
    assert.equal(broken.status, 0, broken.stderr);
    assert.match(JSON.parse(broken.stdout).systemMessage, /could not read goal state.*do not treat an active goal as finished/);
  });
});

test("default evidence fingerprint ignores Pota plan and memory records", async () => {
  await withTempRoot(async (root) => {
    spawnSync("git", ["init", "-q", root]);
    await writeFile(join(root, "app.txt"), "v1\n");
    await startGoal({ root, goal: "Record evidence", planId: "docs/plan/record.md", tasks: [{ id: "only", title: "Only", requiredEvidence: ["moduleAcceptance"] }] });
    await verifyAndRecord({ root, taskId: "only", kind: "moduleAcceptance", argv: [process.execPath, "-e", "process.exit(0)"] });
    await mkdir(join(root, "docs", "plan"), { recursive: true });
    await writeFile(join(root, "docs", "plan", "record.md"), "Evidence: recorded\n");
    await writeFile(join(root, "PLAN.md"), "- record: done\n");
    await setTaskStatus({ root, taskId: "only", status: "completed" });
  });
});

test("SubagentStop only blocks the current task assigned to the stopping agent", async () => {
  await withTempRoot(async (root) => {
    await createTwoTaskGoal(root);
    await assignTask({ root, taskId: "first", agentId: "agent-current" });
    await assignTask({ root, taskId: "second", agentId: "agent-other" });

    const unrelated = await runStateResult("subagent-stop", { root, locale: "en-US", payload: { cwd: root, agent_id: "agent-other", turn_id: "t1" } });
    assert.deepEqual(unrelated.hookOutput, { continue: true });

    const assigned = await runStateResult("subagent-stop", { root, locale: "en-US", payload: { cwd: root, agent_id: "agent-current", turn_id: "t1", stop_hook_active: false } });
    assert.equal(assigned.hookOutput.decision, "block");
    assert.match(assigned.hookOutput.reason, /only this assigned task/);
    assert.match(assigned.hookOutput.reason, /evidence record/i);
    assert.doesNotMatch(assigned.hookOutput.reason, /receipt/i);

    const continued = await runStateResult("subagent-stop", { root, locale: "en-US", payload: { cwd: root, agent_id: "agent-current", turn_id: "t1", stop_hook_active: true } });
    assert.equal(continued.hookOutput.continue, true);
    assert.match(continued.hookOutput.systemMessage, /already continued/);

    const state = await readGoalState({ root });
    const current = state.tasks.find((task) => task.id === "first");
    assert.equal(evaluateStop(state, { subagent: true, agentId: "agent-current" }).block, true);
    assert.equal(current.assignedAgentId, "agent-current");
  });
});

async function createTwoTaskGoal(root) {
  return startGoal({
    root,
    goal: "Complete goal state coverage",
    planId: "docs/plan/goal-state.md",
    evidencePolicy: "declared",
    tasks: [{ id: "first", title: "First task" }, { id: "second", title: "Second task" }],
  });
}

const passArgv = [process.execPath, "-e", "process.exit(0)"];

async function verifyTask(root, taskId, watchPaths = ["watched.txt"]) {
  await verifyAndRecord({ root, taskId, kind: ["moduleAcceptance", "surfaceIntegration"], watchPaths, argv: passArgv });
}

test("fresh goal evidence recorded after every task receipt supersedes stale earlier task evidence", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({
      root,
      goal: "Supersede task freshness",
      planId: "docs/plan/supersede.md",
      tasks: [{ id: "first", title: "First" }, { id: "second", title: "Second" }],
    });
    await verifyTask(root, "first");
    await setTaskStatus({ root, taskId: "first", status: "completed" });
    await writeFile(join(root, "watched.txt"), "v2\n");
    await verifyTask(root, "second");
    await setTaskStatus({ root, taskId: "second", status: "completed" });

    await assert.rejects(transitionGoal({ root, status: "completed" }), /without tool-bound evidence record: finalReview/);
    await verifyAndRecord({ root, scope: "goal", kind: "finalReview", argv: passArgv });
    const completed = await transitionGoal({ root, status: "completed" });
    assert.equal(completed.goal.status, "completed");
  });
});

test("goal evidence recorded before a later task receipt does not waive task freshness", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({
      root,
      goal: "Ordering matters",
      planId: "docs/plan/ordering.md",
      tasks: [{ id: "only", title: "Only" }],
    });
    await verifyAndRecord({ root, scope: "goal", kind: "finalReview", watchPaths: ["other.txt"], argv: passArgv });
    await verifyTask(root, "only");
    await setTaskStatus({ root, taskId: "only", status: "completed" });
    await writeFile(join(root, "watched.txt"), "v2\n");
    await assert.rejects(transitionGoal({ root, status: "completed" }), /Task only has stale evidence record/);
  });
});

test("goal verify records one receipt per kind from a single run", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({ root, goal: "Multi kind", planId: "docs/plan/multi.md", tasks: [{ id: "verify", title: "Verify" }] });
    const counter = join(root, "runs.log");
    const result = spawnSync(process.execPath, [
      cliScript, "goal", "verify", "--root", root, "--task", "verify",
      "--kind", "moduleAcceptance|surfaceIntegration", "--watch", "watched.txt", "--",
      process.execPath, "-e", `require("node:fs").appendFileSync(${JSON.stringify(counter)}, "x")`,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).map((item) => item.kind), ["moduleAcceptance", "surfaceIntegration"]);
    assert.equal(await readFile(counter, "utf8"), "x");
    const state = await readGoalState({ root });
    assert.equal(state.receipts.length, 2);
    assert.equal(state.receipts[0].workspaceFingerprint, state.receipts[1].workspaceFingerprint);
    await setTaskStatus({ root, taskId: "verify", status: "completed" });
  });
});

test("goal finish completes the active task, records goal evidence once, and completes the goal", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({
      root,
      goal: "Finish",
      planId: "docs/plan/finish.md",
      tasks: [{ id: "build", title: "Build" }, { id: "check", title: "Check" }],
    });
    await verifyTask(root, "build");
    const marker = join(root, "must-not-run.txt");
    await assert.rejects(
      finishGoal({ root, argv: [process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`] }),
      /other tasks remain: check/,
    );
    await assert.rejects(access(marker));
    assert.equal((await readGoalState({ root })).tasks[0].status, "active");

    await setTaskStatus({ root, taskId: "build", status: "completed" });
    await writeFile(join(root, "watched.txt"), "v2\n");
    await verifyTask(root, "check");
    const finished = spawnSync(process.execPath, [
      cliScript, "goal", "finish", "--root", root, "--", ...passArgv,
    ], { encoding: "utf8" });
    assert.equal(finished.status, 0, finished.stderr);
    assert.equal(JSON.parse(finished.stdout).status, "completed");
    assert.equal(await readGoalState({ root }), null);
  });
});

test("goal finish refuses to complete an active task whose evidence is stale", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({ root, goal: "Stale finish", planId: "docs/plan/stale-finish.md", tasks: [{ id: "only", title: "Only" }] });
    await verifyTask(root, "only");
    await writeFile(join(root, "watched.txt"), "v2\n");
    await assert.rejects(finishGoal({ root, argv: passArgv }), /stale evidence record/);
    assert.equal((await readGoalState({ root })).goal.status, "active");
  });
});

test("goal stats counts reruns and reports stale latest receipts", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({ root, goal: "Stats", planId: "docs/plan/stats.md", tasks: [{ id: "only", title: "Only" }] });
    await verifyTask(root, "only");
    await verifyAndRecord({ root, taskId: "only", kind: "moduleAcceptance", watchPaths: ["watched.txt"], argv: passArgv });
    await writeFile(join(root, "watched.txt"), "v2\n");
    const stats = goalStats(await readGoalState({ root }), root);
    assert.equal(stats.receipts, 3);
    assert.deepEqual(stats.byKind, { moduleAcceptance: 2, surfaceIntegration: 1 });
    assert.equal(stats.reruns, 1);
    assert.deepEqual(stats.stale.map((item) => item.kind).sort(), ["moduleAcceptance", "surfaceIntegration"]);
    const cli = spawnSync(process.execPath, [cliScript, "goal", "stats", "--root", root], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).reruns, 1);
  });
});

test("goal CLI resolves the repository root from a subdirectory and lists allowed evidence scopes", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "nested", "deeper"), { recursive: true });
    await startGoal({ root, goal: "Root", planId: "docs/plan/root.md", tasks: [{ id: "only", title: "Only" }] });
    const env = { ...process.env };
    delete env.HARNESS_REPO_ROOT;
    const status = spawnSync(process.execPath, [cliScript, "goal", "task", "status"], {
      cwd: join(root, "nested", "deeper"), encoding: "utf8", env,
    });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).id, "only");
    const badScope = spawnSync(process.execPath, [
      cliScript, "goal", "verify", "--root", root, "--scope", "plan", "--kind", "x", "--", ...passArgv,
    ], { encoding: "utf8" });
    assert.notEqual(badScope.status, 0);
    assert.match(badScope.stderr, /Invalid evidence scope: plan \(allowed: task, goal\)/);
  });
});

test("post-tool-use reminds once per task and session-start carries a literal CLI prefix", async () => {
  await withTempRoot(async (root) => {
    await writeFile(join(root, "watched.txt"), "v1\n");
    await startGoal({
      root,
      goal: "Hooks",
      planId: "docs/plan/hooks.md",
      ownerSessionId: "hook-session",
      tasks: [{ id: "first", title: "First" }, { id: "second", title: "Second" }],
    });
    const payload = { cwd: root, session_id: "hook-session" };
    const reminder = async () => (await runStateResult("post-tool-use", { root, payload, locale: "en_US" })).message;
    assert.match(await reminder(), /Pota check/);
    assert.equal(await reminder(), "");
    await verifyTask(root, "first");
    await setTaskStatus({ root, taskId: "first", status: "completed" });
    assert.match(await reminder(), /Pota check/);
    assert.equal(await reminder(), "");

    const started = await runStateResult("session-start", { root, payload, locale: "en_US" });
    const context = started.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(context.includes(`Pota CLI: node ${JSON.stringify(cliScript)} goal <command>`), context);
    assert.ok(!context.includes(root), "the capsule must not repeat the repository path");
    const prompt = await runStateResult("user-prompt-submit", { root, payload, locale: "en_US" });
    assert.ok(!prompt.message.includes("Pota CLI:"));
  });
});

function runVerify(root, kind, watched, source) {
  return spawnSync(process.execPath, [
    cliScript,
    "goal", "verify",
    "--quiet",
    "--root", root,
    "--task", "verify",
    "--kind", kind,
    "--watch", watched,
    "--",
    process.execPath,
    "-e",
    source,
  ], { encoding: "utf8" });
}

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-goal-state-"));
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
