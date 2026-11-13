import test from "node:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  goalStatePath,
  goalStats,
  readGoalState,
  reconcileWorktreeState,
  recordReceipt,
  setTaskStatus,
  startGoal,
  transitionGoal,
} from "../scripts/pota-goal.mjs";
import { withGoalStateLock } from "../scripts/pota-goal-state.mjs";
import {
  GOAL_HISTORY_MAX_RECORDS,
  goalHistoryPath,
  memoryPromotionStatus,
} from "../scripts/pota-goal-history.mjs";

const goalScript = resolve("scripts/pota-goal.mjs");
const passArgv = [process.execPath, "-e", "process.exit(0)"];
const recordKeys = [
  "createdAt", "durationMs", "efforts", "endedAt", "evidencePolicy", "goalId", "memoryPromotion", "models", "planId",
  "receipts", "recordedBy", "revision", "schemaVersion", "status", "tasks", "title", "waivers", "worktreeId",
];
const reminder = (planId) => `Pota memory: plan ${planId} has no "Memory promotion:" line. If this goal produced reusable repository knowledge, write it to docs/memory/<domain>.md and run pota memory index; otherwise record "Memory promotion: none: <reason>" in the plan.`;

test("completing a goal appends one history record inside the state lock before state deletion", async () => {
  await withTempRoot(async (root) => {
    await startSimpleGoal(root, { goal: "x".repeat(130), planId: "docs/plan/lock.md" });
    const ready = await prepareCompletion(root);
    let pending;
    await withGoalStateLock(root, async () => {
      pending = transitionGoal({ root, status: "completed" });
      await delay(150);
      await assert.rejects(access(goalHistoryPath(root)), "history must wait for the state lock");
      await access(goalStatePath(root));
    });
    const completed = await pending;
    assert.equal(await readGoalState({ root }), null);

    const records = await readHistoryRecords(root);
    assert.equal(records.length, 1);
    const [record] = records;
    assert.deepEqual(Object.keys(record).sort(), recordKeys);
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.goalId, ready.goal.id);
    assert.equal(record.planId, "docs/plan/lock.md");
    assert.equal(record.title, "x".repeat(120));
    assert.equal(record.status, "completed");
    assert.equal(record.worktreeId, ready.goal.worktreeId);
    assert.equal(record.createdAt, ready.goal.createdAt);
    assert.equal(record.endedAt, completed.goal.updatedAt);
    assert.equal(record.durationMs, Date.parse(record.endedAt) - Date.parse(record.createdAt));
    assert.equal(record.revision, completed.revision);
    assert.equal(record.evidencePolicy, "declared");
    assert.deepEqual(record.tasks, { total: 1, completed: 1, heavy: 0, light: 0, delegated: 0, design: 0 });
    assert.deepEqual(record.receipts, { total: 2, tool: 0, reruns: 0, byKind: { moduleAcceptance: 1, finalReview: 1 } });
    assert.deepEqual(record.waivers, { effort: 0, design: 0 });
    assert.equal(record.memoryPromotion, "unknown");
    assert.equal(record.recordedBy, "transition");
    const text = await readFile(goalHistoryPath(root), "utf8");
    assert.ok(text.endsWith("\n"));
    assert.ok(!text.includes(root), "history must not contain absolute paths");
    const leftovers = await readdir(dirname(goalHistoryPath(root)));
    assert.deepEqual(leftovers.filter((name) => name.endsWith(".tmp")), []);
  });
});

test("cancelling a goal records status cancelled", async () => {
  await withTempRoot(async (root) => {
    const state = await startSimpleGoal(root, {
      planId: "docs/plan/cancel.md",
      tasks: [
        { id: "design", title: "Design", requiredEvidence: ["moduleAcceptance"], kind: "design", route: "heavy" },
        { id: "build", title: "Build", requiredEvidence: ["moduleAcceptance"], route: "light" },
      ],
    });
    const cancelled = await transitionGoal({ root, status: "cancelled" });
    const [record] = await readHistoryRecords(root);
    assert.equal(record.goalId, state.goal.id);
    assert.equal(record.status, "cancelled");
    assert.equal(record.endedAt, cancelled.goal.updatedAt);
    assert.deepEqual(record.tasks, { total: 2, completed: 0, heavy: 1, light: 1, delegated: 0, design: 1 });
    assert.equal(record.recordedBy, "transition");
  });
});

test("starting over a persisted legacy terminal state records it once with recordedBy start", async () => {
  await withTempRoot(async (root) => {
    const legacy = await startSimpleGoal(root, { planId: "docs/plan/legacy.md" });
    await prepareCompletion(root);
    const persisted = JSON.parse(await readFile(goalStatePath(root), "utf8"));
    persisted.goal.status = "completed";
    persisted.goal.updatedAt = "2026-01-02T03:04:05.000Z";
    await writeFile(goalStatePath(root), `${JSON.stringify(persisted, null, 2)}\n`);

    const next = await startSimpleGoal(root, { planId: "docs/plan/next.md" });
    let records = await readHistoryRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0].goalId, legacy.goal.id);
    assert.equal(records[0].status, "completed");
    assert.equal(records[0].recordedBy, "start");
    assert.equal(records[0].endedAt, "2026-01-02T03:04:05.000Z");

    await transitionGoal({ root, status: "cancelled" });
    records = await readHistoryRecords(root);
    assert.deepEqual(records.map((record) => [record.goalId, record.recordedBy]), [
      [legacy.goal.id, "start"],
      [next.goal.id, "transition"],
    ]);
  });
});

test("a retried terminal transition replaces the record for the same goalId", async () => {
  await withTempRoot(async (root) => {
    const state = await startSimpleGoal(root, { planId: "docs/plan/retry.md" });
    await prepareCompletion(root);
    const beforeDeletion = await readFile(goalStatePath(root), "utf8");
    await transitionGoal({ root, status: "completed" });
    // Simulate a process that recorded history and died before removing the state file.
    await writeFile(goalStatePath(root), beforeDeletion);
    const retried = await transitionGoal({ root, status: "completed" });
    const records = await readHistoryRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0].goalId, state.goal.id);
    assert.equal(records[0].endedAt, retried.goal.updatedAt);
    assert.equal(await readGoalState({ root }), null);
  });
});

test("history keeps the newest 200 records", async () => {
  assert.equal(GOAL_HISTORY_MAX_RECORDS, 200);
  await withTempRoot(async (root) => {
    const seeded = Array.from({ length: 200 }, (_, index) => syntheticRecord(index));
    await seedHistory(root, seeded.map((record) => JSON.stringify(record)));
    const state = await startSimpleGoal(root, { planId: "docs/plan/newest.md" });
    await transitionGoal({ root, status: "cancelled" });
    const records = await readHistoryRecords(root);
    assert.equal(records.length, 200);
    assert.equal(records[0].goalId, seeded[1].goalId);
    assert.equal(records.at(-1).goalId, state.goal.id);
  });
});

test("invalid history lines are skipped and counted, never fatal", async () => {
  await withTempRoot(async (root) => {
    await seedHistory(root, [
      JSON.stringify(syntheticRecord(1)),
      "not json",
      "[]",
      JSON.stringify({ ...syntheticRecord(2), schemaVersion: 2 }),
      JSON.stringify({ schemaVersion: 1 }),
      "",
    ]);
    const before = runGoal(["stats", "--history", "--root", root]);
    assert.equal(before.status, 0, before.stderr);
    const beforeStats = JSON.parse(before.stdout);
    assert.equal(beforeStats.goals, 1);
    assert.equal(beforeStats.skippedLines, 4);

    await startSimpleGoal(root, { planId: "docs/plan/invalid.md" });
    await transitionGoal({ root, status: "cancelled" });
    const lines = (await readFile(goalHistoryPath(root), "utf8")).split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    for (const line of lines) assert.equal(JSON.parse(line).schemaVersion, 1);
    const after = JSON.parse(runGoal(["stats", "--history", "--root", root]).stdout);
    assert.equal(after.goals, 2);
    assert.equal(after.skippedLines, 0);
  });
});

test("a history write failure does not block completion and surfaces a warning on stderr", async () => {
  await withTempRoot(async (root) => {
    const state = await startSimpleGoal(root, { planId: "docs/plan/failure.md" });
    await prepareCompletion(root);
    await mkdir(goalHistoryPath(root), { recursive: true });
    const result = runGoal(["complete", "--root", root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).goal.status, "completed");
    assert.match(result.stderr, /^Pota warning: goal history was not recorded: \S.*$/m);
    assert.equal(result.stderr.split("\n").filter((line) => line.startsWith("Pota warning:")).length, 1);
    assert.equal(await readGoalState({ root }), null);

    await startSimpleGoal(root, { planId: "docs/plan/failure-api.md" });
    const calls = [];
    const cancelled = await transitionGoal({
      root,
      status: "cancelled",
      onTerminal: (record, details) => calls.push({ record, details }),
    });
    assert.equal(cancelled.goal.status, "cancelled");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].record.status, "cancelled");
    assert.notEqual(calls[0].record.goalId, state.goal.id);
    assert.ok(calls[0].details.historyError instanceof Error);
    assert.equal(await readGoalState({ root }), null);
  });
});

test("goal stats without --history is unchanged and prints null when no goal exists", async () => {
  await withTempRoot(async (root) => {
    const empty = runGoal(["stats", "--root", root]);
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(empty.stdout, "null\n");

    await seedHistory(root, [JSON.stringify(syntheticRecord(1))]);
    await startSimpleGoal(root, { planId: "docs/plan/stats.md" });
    const active = runGoal(["stats", "--root", root]);
    assert.equal(active.status, 0, active.stderr);
    assert.deepEqual(JSON.parse(active.stdout), goalStats(await readGoalState({ root }), root));
    assert.equal(active.stderr, "");
  });
});

test("goal stats --history aggregates across worktree directories of the same repository", async () => {
  await withTempRoot(async (root) => {
    const git = (...args) => {
      const result = spawnSync("git", ["-c", "user.name=Pota Test", "-c", "user.email=pota@example.invalid", ...args], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    };
    // Git records the worktree gitdir as a long path; resolve the temp root the same way so a Windows 8.3 short
    // temp path (RUNNER~1) does not make the two checkouts hash to different repository ids.
    const base = realpathSync.native(root);
    const repo = join(base, "repo");
    const second = join(base, "second");
    await mkdir(repo);
    git("init", "-q", repo);
    git("-C", repo, "commit", "-q", "--allow-empty", "-m", "init");
    git("-C", repo, "worktree", "add", "-q", "--detach", second);

    const first = await startSimpleGoal(repo, { planId: "docs/plan/first.md" });
    await transitionGoal({ root: repo, status: "cancelled" });
    const other = await startSimpleGoal(second, { planId: "docs/plan/second.md" });
    await prepareCompletion(second);
    await transitionGoal({ root: second, status: "completed" });
    assert.notEqual(goalHistoryPath(repo), goalHistoryPath(second));

    for (const target of [repo, second]) {
      const result = runGoal(["stats", "--history", "--root", target]);
      assert.equal(result.status, 0, result.stderr);
      const stats = JSON.parse(result.stdout);
      assert.equal(stats.scope, "repository");
      assert.equal(stats.goals, 2);
      assert.equal(stats.completed, 1);
      assert.equal(stats.cancelled, 1);
      assert.deepEqual(stats.recent.map((item) => item.goalId).sort(), [first.goal.id, other.goal.id].sort());
    }
  });
});

test("goal stats --history reports medians, rerunRate, memoryPromotion counts, and trend only from four completed goals", async () => {
  await withTempRoot(async (root) => {
    const records = [
      syntheticRecord(1, { durationMs: 1000, taskTotal: 2, receipts: 4, reruns: 1, memoryPromotion: "note", effortWaivers: 1 }),
      syntheticRecord(2, { durationMs: 3000, taskTotal: 4, receipts: 6, reruns: 0, memoryPromotion: "none" }),
      syntheticRecord(3, { status: "cancelled", durationMs: 99_999, taskTotal: 9, receipts: 50, reruns: 25, memoryPromotion: "missing", designWaivers: 1 }),
      syntheticRecord(4, { durationMs: 2000, taskTotal: 3, receipts: 10, reruns: 3, memoryPromotion: "missing" }),
    ];
    await seedHistory(root, records.map((record) => JSON.stringify(record)));
    const three = JSON.parse(runGoal(["stats", "--history", "--root", root]).stdout);
    assert.deepEqual(three, {
      schemaVersion: 1,
      scope: "repository",
      goals: 4,
      completed: 3,
      cancelled: 1,
      skippedLines: 0,
      window: { from: records[0].endedAt, to: records[3].endedAt },
      durationMs: { median: 2000, p90: 3000 },
      tasks: { total: 9, median: 3, heavy: 3, light: 6, delegated: 3 },
      receipts: { total: 20, tool: 20, reruns: 4, rerunRate: 0.2, median: 6 },
      waivers: { effort: 1, design: 1 },
      memoryPromotion: { note: 1, none: 1, missing: 2, unknown: 0 },
      trend: null,
      recent: [4, 3, 2, 1].map((index) => recentEntry(records[index - 1])),
    });

    records.push(
      syntheticRecord(5, { durationMs: 5000, taskTotal: 1, receipts: 2, reruns: 0, memoryPromotion: "unknown" }),
      syntheticRecord(6, { durationMs: 4000, taskTotal: 2, receipts: 3, reruns: 1, memoryPromotion: "note" }),
    );
    await seedHistory(root, records.map((record) => JSON.stringify(record)));
    const five = JSON.parse(runGoal(["stats", "--history", "--root", root]).stdout);
    assert.equal(five.completed, 5);
    assert.deepEqual(five.durationMs, { median: 3000, p90: 5000 });
    assert.equal(five.receipts.rerunRate, 0.2);
    assert.deepEqual(five.memoryPromotion, { note: 2, none: 1, missing: 2, unknown: 1 });
    assert.deepEqual(five.trend, {
      older: { goals: 2, durationMsMedian: 2000, receiptsMedian: 5, rerunRate: 0.1 },
      newer: { goals: 3, durationMsMedian: 4000, receiptsMedian: 3, rerunRate: 0.267 },
    });
    assert.deepEqual(five.recent.map((item) => item.goalId), [6, 5, 4, 3, 2].map((index) => records[index - 1].goalId));

    await seedHistory(root, records.filter((record) => record.goalId !== records[5].goalId).map((record) => JSON.stringify(record)));
    const four = JSON.parse(runGoal(["stats", "--history", "--root", root]).stdout);
    assert.deepEqual(four.durationMs, { median: 2500, p90: 5000 });
    assert.deepEqual(four.trend, {
      older: { goals: 2, durationMsMedian: 2000, receiptsMedian: 5, rerunRate: 0.1 },
      newer: { goals: 2, durationMsMedian: 3500, receiptsMedian: 6, rerunRate: 0.25 },
    });
  });
});

test("goal stats --history with no history prints goals 0 and creates no state directory", async () => {
  await withTempRoot(async (root) => {
    const result = runGoal(["stats", "--history", "--root", root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${JSON.stringify({ schemaVersion: 1, scope: "repository", goals: 0 })}\n`);
    await assert.rejects(access(process.env.POTA_HOME), "stats --history must not create user-home state");
  });
});

test("--limit accepts 1..200 and rejects 0, 201, and non-integers", async () => {
  await withTempRoot(async (root) => {
    await seedHistory(root, [1, 2, 3].map((index) => JSON.stringify(syntheticRecord(index))));
    const one = runGoal(["stats", "--history", "--limit", "1", "--root", root]);
    assert.equal(one.status, 0, one.stderr);
    const limited = JSON.parse(one.stdout);
    assert.equal(limited.goals, 1);
    assert.deepEqual(limited.recent.map((item) => item.goalId), [syntheticRecord(3).goalId]);
    const max = runGoal(["stats", "--history", "--limit=200", "--root", root]);
    assert.equal(max.status, 0, max.stderr);
    assert.equal(JSON.parse(max.stdout).goals, 3);
    for (const value of ["0", "201", "1.5", "abc", "-1", "1e2"]) {
      const rejected = runGoal(["stats", "--history", `--limit=${value}`, "--root", root]);
      assert.notEqual(rejected.status, 0, `--limit=${value} must be rejected`);
      assert.match(rejected.stderr, /--limit must be an integer between 1 and 200/);
      assert.equal(rejected.stdout, "");
    }
    const withoutHistory = runGoal(["stats", "--limit", "5", "--root", root]);
    assert.notEqual(withoutHistory.status, 0);
    assert.match(withoutHistory.stderr, /--limit requires --history/);
  });
});

test("goal finish prints the memory promotion reminder only when the plan file lacks a filled Memory promotion line", async () => {
  await withTempRoot(async (root) => {
    const plans = {
      "docs/plan/missing.md": ["# Plan", "", "## Evidence", "- Tests pass"],
      "docs/plan/placeholder.md": ["## Evidence", "- Memory promotion: <docs/memory/<domain>.md | none: reason>"],
      "docs/plan/empty.md": ["Memory promotion:"],
      "docs/plan/none.md": ["## Evidence", "- Memory promotion: none: nothing reusable"],
      "docs/plan/korean.md": ["* Memory promotion: 없음: 재사용할 지식 없음"],
      "docs/plan/note.md": ["- Memory promotion: <docs/memory/<domain>.md | none: reason>", "  - memory promotion: docs/memory/goal.md"],
    };
    const expected = {
      "docs/plan/missing.md": "missing",
      "docs/plan/placeholder.md": "missing",
      "docs/plan/empty.md": "missing",
      "docs/plan/none.md": "none",
      "docs/plan/korean.md": "none",
      "docs/plan/note.md": "note",
    };
    for (const [planId, lines] of Object.entries(plans)) {
      await mkdir(dirname(join(root, planId)), { recursive: true });
      await writeFile(join(root, planId), `${lines.join("\n")}\n`);
    }
    for (const planId of Object.keys(plans)) {
      await startSimpleGoal(root, { planId });
      await recordReceipt({ root, taskId: "only", kind: "moduleAcceptance", command: "verify only", exitCode: 0 });
      const result = runGoal(["finish", "--root", root, "--", ...passArgv]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).status, "completed");
      if (expected[planId] === "missing") assert.equal(result.stderr, `${reminder(planId)}\n`, planId);
      else assert.equal(result.stderr, "", planId);
      assert.equal(memoryPromotionStatus(root, planId), expected[planId]);
    }
    const records = await readHistoryRecords(root);
    assert.deepEqual(records.map((record) => [record.planId, record.memoryPromotion]), Object.entries(expected));

    await startSimpleGoal(root, { planId: "docs/plan/missing.md" });
    await prepareCompletion(root);
    const complete = runGoal(["complete", "--quiet", "--root", root]);
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(complete.stdout, "");
    assert.equal(complete.stderr, `${reminder("docs/plan/missing.md")}\n`);

    await startSimpleGoal(root, { planId: "docs/plan/missing.md" });
    const cancel = runGoal(["cancel", "--root", root]);
    assert.equal(cancel.status, 0, cancel.stderr);
    assert.equal(cancel.stderr, "");
  });
});

test("memoryPromotion is unknown and silent when planId is not a repository file", async () => {
  await withTempRoot(async (root) => {
    const outside = `${root}-outside.md`;
    await writeFile(outside, "# Outside\n");
    await mkdir(join(root, "docs/plan/folder.md"), { recursive: true });
    await writeFile(join(root, "docs/plan/real.md"), "# Real\n");
    await symlink(join(root, "docs/plan/real.md"), join(root, "docs/plan/link.md"));
    await writeFile(join(root, "docs/plan/huge.md"), `${"a".repeat(512 * 1024)}\n`);
    try {
      for (const planId of ["plan-status", "docs/plan/absent.md", "docs/plan/folder.md", "docs/plan/link.md", "docs/plan/huge.md", `../${outside.split("/").at(-1)}`, outside]) {
        assert.equal(memoryPromotionStatus(root, planId), "unknown", planId);
      }
      assert.equal(memoryPromotionStatus(root, "docs/plan/real.md"), "missing");

      await startSimpleGoal(root, { planId: "plan-status" });
      await recordReceipt({ root, taskId: "only", kind: "moduleAcceptance", command: "verify only", exitCode: 0 });
      const result = runGoal(["finish", "--root", root, "--", ...passArgv]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const [record] = await readHistoryRecords(root);
      assert.equal(record.memoryPromotion, "unknown");
    } finally {
      await rm(outside, { force: true });
    }
  });
});

test("stale-worktree state removal records no history", async () => {
  await withTempRoot(async (root) => {
    await startSimpleGoal(root, { planId: "docs/plan/stale.md" });
    await rewriteState(root, (state) => { state.goal.worktreeId = "worktree-foreign"; });
    const reconciled = await reconcileWorktreeState({ root });
    assert.equal(reconciled.removed, true);
    await assert.rejects(access(goalHistoryPath(root)));

    await startSimpleGoal(root, { planId: "docs/plan/stale-terminal.md" });
    await rewriteState(root, (state) => {
      state.goal.worktreeId = "worktree-foreign";
      state.goal.status = "cancelled";
    });
    const next = await startSimpleGoal(root, { planId: "docs/plan/after.md" });
    await assert.rejects(access(goalHistoryPath(root)));
    assert.equal((await readGoalState({ root })).goal.id, next.goal.id);
  });
});

function runGoal(args) {
  return spawnSync(process.execPath, [goalScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "en_US.UTF-8" },
  });
}

function startSimpleGoal(root, { goal = "History goal", planId, tasks } = {}) {
  return startGoal({
    root,
    goal,
    planId,
    evidencePolicy: "declared",
    requiredEvidence: ["finalReview"],
    tasks: tasks ?? [{ id: "only", title: "Only", requiredEvidence: ["moduleAcceptance"] }],
  });
}

// Completes the only task and records goal evidence so the goal is ready for a terminal transition.
async function prepareCompletion(root) {
  await recordReceipt({ root, taskId: "only", kind: "moduleAcceptance", command: "verify only", exitCode: 0 });
  await setTaskStatus({ root, taskId: "only", status: "completed" });
  return recordReceipt({ root, scope: "goal", kind: "finalReview", command: "review", exitCode: 0 });
}

async function rewriteState(root, change) {
  const state = JSON.parse(await readFile(goalStatePath(root), "utf8"));
  change(state);
  await writeFile(goalStatePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

async function readHistoryRecords(root) {
  const text = await readFile(goalHistoryPath(root), "utf8");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function seedHistory(root, lines) {
  await mkdir(dirname(goalHistoryPath(root)), { recursive: true });
  await writeFile(goalHistoryPath(root), `${lines.join("\n")}\n`);
}

function syntheticRecord(index, {
  status = "completed", durationMs = 1000, taskTotal = 2, receipts = 2, reruns = 0, memoryPromotion = "unknown",
  effortWaivers = 0, designWaivers = 0,
} = {}) {
  const endedAt = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString();
  return {
    schemaVersion: 1,
    goalId: `goal-seed-${String(index).padStart(3, "0")}`,
    planId: `docs/plan/seed-${index}.md`,
    title: `Seed ${index}`,
    status,
    worktreeId: "worktree-seed",
    createdAt: new Date(Date.parse(endedAt) - durationMs).toISOString(),
    endedAt,
    durationMs,
    revision: 3,
    evidencePolicy: "tool-bound",
    tasks: { total: taskTotal, completed: taskTotal, heavy: 1, light: taskTotal - 1, delegated: 1, design: 0 },
    receipts: { total: receipts, tool: receipts, reruns, byKind: { moduleAcceptance: receipts } },
    waivers: { effort: effortWaivers, design: designWaivers },
    models: {},
    efforts: {},
    memoryPromotion,
    recordedBy: "transition",
  };
}

function recentEntry(record) {
  return {
    goalId: record.goalId,
    planId: record.planId,
    status: record.status,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    tasks: record.tasks.total,
    receipts: record.receipts.total,
    reruns: record.receipts.reruns,
    memoryPromotion: record.memoryPromotion,
  };
}

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-goal-history-"));
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
