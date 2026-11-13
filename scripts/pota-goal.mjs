#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runGoalCli } from "./pota-goal-cli.mjs";
import { assignTask, claimGoal, replanGoal, setTaskStatus, startGoal, transitionGoal } from "./pota-goal-operations.mjs";
import { finishGoal, goalStats, recordReceipt, verifyAndRecord } from "./pota-goal-operations-evidence.mjs";
import { readGoalState } from "./pota-goal-state.mjs";
import { goalHistoryStats } from "./pota-goal-history.mjs";
import { readyTasks } from "./pota-goal-operations-mutations.mjs";
import { defaultGoalEvidence } from "./pota-goal-state-validation.mjs";

export { workspaceFingerprint } from "./pota-goal-evidence.mjs";
export { worktreeId } from "./pota-paths.mjs";
export {
  GOAL_STATE_CONTRACT,
  GOAL_STATE_VERSION,
  GOAL_STATUSES,
  PLAN_ID_MAX_LENGTH,
  RECOVERY_REFERENCE_MAX_LENGTH,
  TASK_ID_MAX_LENGTH,
  TASK_STATUSES,
} from "./pota-goal-state-validation.mjs";
export { goalStatePath, readGoalState, writeGoalState } from "./pota-goal-state.mjs";
export { GOAL_HISTORY_MAX_RECORDS, goalHistoryPath, goalHistoryStats, memoryPromotionStatus } from "./pota-goal-history.mjs";
export { assignTask, claimGoal, reconcileWorktreeState, replanGoal, setTaskStatus, startGoal, transitionGoal } from "./pota-goal-operations.mjs";
export { finishGoal, goalStats, recordReceipt, verifyAndRecord } from "./pota-goal-operations-evidence.mjs";
export { currentTask, evaluateStop, isGoalOwnedBySession } from "./pota-goal-policy.mjs";
export { readyTasks } from "./pota-goal-operations-mutations.mjs";

export async function handleGoalCli(args = process.argv.slice(2), { stdout = console.log, stderr = console.error } = {}) {
  return runGoalCli(args, {
    stdout,
    stderr,
    defaultGoalEvidence,
    operations: {
      assignTask,
      claimGoal,
      finishGoal,
      goalHistoryStats,
      goalStats,
      readGoalState,
      readyTasks,
      recordReceipt,
      replanGoal,
      setTaskStatus,
      startGoal,
      transitionGoal,
      verifyAndRecord,
    },
  });
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isCliEntry()) {
  try {
    await handleGoalCli();
  } catch (error) {
    console.error(`Pota goal error: ${error.message}`);
    process.exitCode = 1;
  }
}
