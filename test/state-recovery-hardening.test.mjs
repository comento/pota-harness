import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as goalModule from "../scripts/pota-goal.mjs";
import {
  goalStatePath,
  readGoalState,
  recordReceipt,
  setTaskStatus,
  startGoal,
  transitionGoal,
} from "../scripts/pota-goal.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";

for (const status of ["paused", "blocked"]) {
  test(`SessionStart restores exact owner context without auto-resuming when goal is ${status}`, async () => {
    await withTempRoot(async (root) => {
      // Given: an owner-bound goal that cannot currently proceed.
      await startGoal({
        root,
        goal: "Recover interrupted work",
        planId: "docs/plan/recovery-exact.md",
        ownerSessionId: "owner-session",
        tasks: [{ id: "recover-task", title: "Recover exact state" }],
      });
      if (status === "paused") {
        await transitionGoal({ root, status: "paused" });
      } else {
        await transitionGoal({ root, status: "blocked", blocker: "Waiting for dependency approval" });
      }

      // When: the owning session starts again.
      const result = await runStateResult("session-start", {
        root,
        locale: "en-US",
        payload: { cwd: root, session_id: "owner-session", turn_id: `${status}-turn` },
      });

      // Then: the capsule restores exact state and requires an explicit recovery action.
      const hook = result.hookOutput.hookSpecificOutput;
      const state = await readGoalState({ root });
      assert.equal(result.status, 0);
      assert.equal(hook.hookEventName, "SessionStart");
      assert.equal(state?.goal.status, status);
      assert.equal(state?.tasks[0]?.status, "active");
      assert.equal(state?.goal.planId, "docs/plan/recovery-exact.md");
      assert.equal(state?.goal.blocker, status === "blocked" ? "Waiting for dependency approval" : null);
      assert.ok(hook.additionalContext.length <= 620);
    });
  });
}

for (const status of ["paused", "blocked"]) {
  test(`${status} goals remain opaque to a foreign SessionStart`, async () => {
    await withTempRoot(async (root) => {
      // Given: an owner-bound interrupted goal containing private recovery details.
      await startGoal({
        root,
        goal: "Private interrupted goal",
        planId: "docs/plan/private-recovery.md",
        ownerSessionId: "owner-session",
        tasks: [{ id: "private-task", title: "Private recovery task" }],
      });
      await transitionGoal({
        root,
        status,
        ...(status === "blocked" ? { blocker: "Private blocker" } : {}),
      });

      // When: another session starts in the repository.
      const result = await runStateResult("session-start", {
        root,
        locale: "en-US",
        payload: { cwd: root, session_id: "foreign-session", turn_id: "foreign-turn" },
      });

      // Then: ownership is disclosed without exposing state details.
      const hook = result.hookOutput.hookSpecificOutput;
      assert.equal(result.status, 0);
      assert.equal(hook.hookEventName, "SessionStart");
      assert.ok(hook.additionalContext.length <= 620);
      assert.equal(hook.additionalContext.includes("Private interrupted goal"), false);
      assert.equal(hook.additionalContext.includes("docs/plan/private-recovery.md"), false);
      assert.equal(hook.additionalContext.includes("private-task"), false);
      assert.equal(hook.additionalContext.includes("Private recovery task"), false);
      assert.equal(hook.additionalContext.includes("Private blocker"), false);
    });
  });
}

test("synchronized concurrent legacy migration readers all observe the migrated state", async () => {
  await withTempRoot(async (root) => {
    // Given: only a legacy project-local state file exists.
    const started = await startGoal({
      root,
      goal: "Migrate concurrently",
      planId: "docs/plan/legacy-race.md",
      tasks: [{ id: "legacy-task", title: "Read legacy state" }],
    });
    const legacyPath = join(root, ".pota", "state.json");
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, await readFile(goalStatePath(root), "utf8"));
    await rm(goalStatePath(root));
    const ready = deferred();
    const release = deferred();
    let arrivals = 0;
    const readers = Array.from({ length: 12 }, async () => {
      arrivals += 1;
      if (arrivals === 12) ready.resolve();
      await release.promise;
      return readGoalState({ root });
    });

    // When: every waiting reader is released against the same legacy state.
    await ready.promise;
    release.resolve();
    const states = await Promise.all(readers);

    // Then: no reader observes a transient null or divergent state.
    assert.equal(states.every((state) => state !== null), true);
    assert.deepEqual(states.map((state) => state.goal.id), Array(12).fill(started.goal.id));
    assert.deepEqual(states.map((state) => state.revision), Array(12).fill(started.revision));
    await assert.rejects(readFile(legacyPath), /ENOENT/);
  });
});

test("goal contract reports advisory completion criteria and deleted terminal persistence truthfully", async () => {
  await withTempRoot(async (root) => {
    // Given: a goal whose advisory criterion is not machine-enforced but whose evidence gates pass.
    assert.deepEqual(goalModule.GOAL_STATE_CONTRACT?.completionCriteria, { behavior: "advisory", enforced: false });
    assert.deepEqual(goalModule.GOAL_STATE_CONTRACT?.terminal, {
      statuses: ["cancelled", "completed"],
      persistence: "deleted",
      readAfterTransition: null,
      transitionResult: "terminal-snapshot",
    });
    await startGoal({
      root,
      goal: "Truthful contract",
      planId: "docs/plan/truthful-contract.md",
      evidencePolicy: "declared",
      completionCriteria: ["A human confirms the release"],
      tasks: [{ id: "contract-task", title: "Exercise contract" }],
    });
    for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
      await recordReceipt({ root, taskId: "contract-task", kind, command: `verify ${kind}`, exitCode: 0 });
    }
    await setTaskStatus({ root, taskId: "contract-task", status: "completed" });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "verify final review", exitCode: 0 });

    // When: completion is explicitly requested.
    const terminal = await transitionGoal({ root, status: "completed" });

    // Then: criteria remain advisory, the terminal snapshot is returned, and persisted state is deleted.
    assert.equal(terminal.goal.status, "completed");
    assert.deepEqual(terminal.goal.completionCriteria, ["A human confirms the release"]);
    assert.equal(await readGoalState({ root }), null);
  });
});

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-state-recovery-"));
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
