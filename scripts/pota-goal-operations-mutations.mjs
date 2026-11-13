import { workspaceFingerprint } from "./pota-goal-evidence.mjs";
import { readGoalStateUnlocked, withGoalStateLock, writeGoalStateUnlocked } from "./pota-goal-state.mjs";
import { terminalGoalStatuses } from "./pota-goal-state-validation.mjs";

export async function mutateGoal(root, mutate) {
  return withGoalStateLock(root, async () => {
    const state = await readGoalStateUnlocked(root);
    if (!state) throw new Error("No Pota goal state exists; start a goal first");
    const next = await mutate(structuredClone(state));
    next.revision += 1;
    await writeGoalStateUnlocked({ root, state: next });
    return next;
  });
}

export function ensureTaskCanComplete(state, task, root) {
  for (const kind of task.requiredEvidence) ensureCurrentEvidence({ state, root, scope: "task", task, kind });
}

export function ensureGoalCanComplete(state, root) {
  const incomplete = state.tasks.filter((task) => task.status !== "completed");
  if (incomplete.length > 0) throw new Error(`Goal cannot be completed while tasks remain: ${incomplete.map((task) => task.id).join(", ")}`);
  const goalReceipts = state.goal.requiredEvidence.map((kind) => ensureCurrentEvidence({ state, root, scope: "goal", kind }));
  // Task freshness was enforced when each task completed. Fresh goal-level evidence recorded after every task
  // receipt supersedes it, so later edits do not force reruns of every earlier task's checks.
  const lastTaskReceipt = state.receipts.findLastIndex((receipt) => receipt.scope === "task");
  const superseded = goalReceipts.length > 0
    && goalReceipts.every((receipt) => state.receipts.indexOf(receipt) > lastTaskReceipt);
  if (superseded) {
    for (const task of state.tasks) ensureTaskEvidenceExists(state, task);
    return;
  }
  for (const task of state.tasks) ensureTaskCanComplete(state, task, root);
}

function ensureTaskEvidenceExists(state, task) {
  for (const kind of task.requiredEvidence) {
    const recorded = state.receipts.some((receipt) => (
      receipt.scope === "task" && receipt.taskId === task.id && receipt.kind === kind
      && (state.goal.evidencePolicy === "declared" || receipt.source === "tool")
    ));
    if (!recorded) throw new Error(`Task ${task.id} cannot be completed without tool-bound evidence record: ${kind}`);
  }
}

function ensureCurrentEvidence({ state, root, scope, task, kind }) {
  const candidates = state.receipts.filter((receipt) => (
    receipt.scope === scope && receipt.kind === kind && (scope === "goal" || receipt.taskId === task.id)
  ));
  const subject = scope === "goal" ? "Goal" : `Task ${task.id}`;
  if (state.goal.evidencePolicy === "declared") {
    if (candidates.length === 0) throw new Error(`${subject} cannot be completed without successful, bound evidence record: ${kind}`);
    return candidates.at(-1);
  }
  const toolEvidence = candidates.filter((receipt) => receipt.source === "tool");
  if (toolEvidence.length === 0) throw new Error(`${subject} cannot be completed without tool-bound evidence record: ${kind}`);
  for (const receipt of [...toolEvidence].reverse()) {
    if (isReceiptFresh(root, receipt)) return receipt;
  }
  throw new Error(`${subject} has stale evidence record: ${kind}`);
}

export function isReceiptFresh(root, receipt) {
  return receipt.source === "tool" && workspaceFingerprint(root, receipt.watchPaths) === receipt.workspaceFingerprint;
}

export function readyTasks(state) {
  if (!state) return [];
  const completed = new Set(state.tasks.filter((task) => task.status === "completed").map((task) => task.id));
  return state.tasks.filter((task) => task.status === "pending" && task.dependsOn.every((id) => completed.has(id)));
}

// Keeps the goal moving after a task leaves "active": when nothing is active, activate the first ready task in
// list order (the sequential behavior); when nothing is active or ready while work remains, block the goal.
export function advanceGoal(state, preferredBlocker = null, { block = true } = {}) {
  if (state.tasks.some((task) => task.status === "active")) return;
  const next = readyTasks(state)[0];
  if (next) {
    next.status = "active";
    next.updatedAt = new Date().toISOString();
    return;
  }
  if (!block || state.tasks.every((task) => task.status === "completed")) return;
  state.goal.status = "blocked";
  state.goal.blocker = preferredBlocker ?? state.tasks.find((task) => task.status === "blocked")?.blocker
    ?? "No task is ready: remaining tasks wait on unfinished dependencies";
}

export function assertGoalMutable(state) {
  if (terminalGoalStatuses.has(state.goal.status)) throw new Error(`Cannot change a ${state.goal.status} goal`);
}

export function taskById(state, taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  return task;
}
