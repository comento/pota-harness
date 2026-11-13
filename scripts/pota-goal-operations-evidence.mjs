import { randomUUID } from "node:crypto";
import { normalizeVerificationArgv, normalizeWatchPaths, runVerificationEvidence, workspaceFingerprint } from "./pota-goal-evidence.mjs";
import { readGoalState } from "./pota-goal-state.mjs";
import {
  normalizeToolEvidence, pathContains, requiredText, timestamp, validReceiptCommand, validReceiptScope,
  validReceiptSource, validTimestamp,
} from "./pota-goal-state-validation.mjs";
import { assertGoalMutable, isReceiptFresh, mutateGoal, taskById } from "./pota-goal-operations-mutations.mjs";
import { setTaskStatus, transitionGoal } from "./pota-goal-operations.mjs";

export async function recordReceipt(options = {}) {
  if (options.source !== undefined && options.source !== "declared") throw new Error("Only goal verify can create tool evidence");
  return recordEvidence({ ...options, source: "declared" });
}

async function recordEvidence({
  root = process.cwd(), taskId, kind, scope = "task", command, exitCode,
  timestamp: receiptTimestamp, goalId, planId, source, argv, outputDigest,
  summary, workspaceFingerprint: fingerprint, watchPaths = [], expectedIdentity,
  expectedFingerprint,
} = {}) {
  const normalizedScope = validReceiptScope(scope);
  const normalizedTaskId = normalizedScope === "task" ? requiredText(taskId, "taskId") : undefined;
  const normalizedKind = requiredText(kind, "evidence kind");
  const normalizedCommand = validReceiptCommand(command);
  const normalizedSource = validReceiptSource(source);
  if (exitCode !== 0) throw new Error("evidence exitCode must be 0");
  const normalizedTimestamp = validTimestamp(receiptTimestamp ?? timestamp());
  const toolFields = normalizedSource === "tool" ? normalizeToolEvidence({ argv, outputDigest, summary, fingerprint, watchPaths }) : {};
  return mutateGoal(root, (state) => {
    assertGoalMutable(state);
    const task = normalizedScope === "task" ? taskById(state, normalizedTaskId) : null;
    if (expectedIdentity && (state.goal.id !== expectedIdentity.goalId || state.goal.planId !== expectedIdentity.planId)) {
      throw new Error("Goal identity changed during verification; evidence was not recorded");
    }
    if (expectedIdentity && normalizedScope === "task" && (
      task?.id !== expectedIdentity.taskId
      || task?.status !== expectedIdentity.taskStatus
      || task?.assignedAgentId !== expectedIdentity.taskAgentId
    )) throw new Error("Verification task changed during verification; evidence was not recorded");
    if (expectedFingerprint && workspaceFingerprint(root, watchPaths) !== expectedFingerprint) {
      throw new Error("Watched workspace changed during verification; evidence was not recorded");
    }
    if (goalId !== undefined && goalId !== state.goal.id) throw new Error("evidence goalId does not match the active goal");
    if (planId !== undefined && planId !== state.goal.planId) throw new Error("evidence planId does not match the active goal");
    const receipt = {
      id: `receipt-${randomUUID()}`,
      scope: normalizedScope,
      kind: normalizedKind,
      ...(task ? { taskId: task.id } : {}),
      goalId: state.goal.id,
      planId: state.goal.planId,
      command: normalizedCommand,
      exitCode: 0,
      timestamp: normalizedTimestamp,
      source: normalizedSource,
      ...toolFields,
    };
    state.receipts.push(receipt);
    if (task) task.updatedAt = timestamp();
    state.goal.updatedAt = timestamp();
    return state;
  });
}

export async function verifyAndRecord({
  root = process.cwd(), taskId, kind, scope = "task", argv, watchPaths = [],
  runner, timeoutMs = 600_000,
} = {}) {
  const normalizedArgv = normalizeVerificationArgv(argv);
  const normalizedWatchPaths = normalizeWatchPaths(root, watchPaths);
  const normalizedScope = validReceiptScope(scope);
  const normalizedKinds = normalizeKinds(kind);
  const initialState = await readGoalState({ root });
  if (!initialState) throw new Error("No Pota goal state exists; start a goal first");
  assertGoalMutable(initialState);
  const normalizedTaskId = normalizedScope === "task" ? requiredText(taskId, "taskId") : undefined;
  const initialTask = normalizedScope === "task" ? taskById(initialState, normalizedTaskId) : null;
  if (initialTask && !["active", "completed"].includes(initialTask.status)) {
    throw new Error(`Verification task must be active or completed: ${initialTask.id}`);
  }
  assertParallelWatch(initialState, initialTask, normalizedWatchPaths);
  const identity = {
    goalId: initialState.goal.id,
    planId: initialState.goal.planId,
    taskId: normalizedTaskId,
    taskStatus: initialTask?.status,
    taskAgentId: initialTask?.assignedAgentId,
  };
  const evidence = runVerificationEvidence({
    root,
    argv: normalizedArgv,
    watchPaths: normalizedWatchPaths,
    runner,
    timeoutMs,
  });
  const postState = await readGoalState({ root });
  if (!postState || postState.goal.id !== identity.goalId || postState.goal.planId !== identity.planId) {
    throw new Error("Goal identity changed during verification; evidence was not recorded");
  }
  if (normalizedScope === "task") {
    const postTask = taskById(postState, normalizedTaskId);
    if (postTask.status !== identity.taskStatus || postTask.assignedAgentId !== identity.taskAgentId) {
      throw new Error("Verification task changed during verification; evidence was not recorded");
    }
  }
  // One verification run may prove several evidence kinds; record one receipt per kind without rerunning it.
  const receipts = [];
  let state;
  for (const normalizedKind of normalizedKinds) {
    state = await recordEvidence({
      root,
      taskId: normalizedTaskId,
      kind: normalizedKind,
      scope: normalizedScope,
      command: evidence.command,
      exitCode: 0,
      source: "tool",
      argv: evidence.argv,
      outputDigest: evidence.outputDigest,
      summary: evidence.summary,
      workspaceFingerprint: evidence.workspaceFingerprint,
      watchPaths: evidence.watchPaths,
      goalId: identity.goalId,
      planId: identity.planId,
      expectedIdentity: identity,
      expectedFingerprint: evidence.workspaceFingerprint,
    });
    receipts.push(state.receipts.at(-1));
  }
  return { state, evidence: receipts.at(-1), receipts };
}

// Completes the active task, proves every goal-level evidence kind with one run, and completes the goal.
export async function finishGoal({
  root = process.cwd(), argv = [], watchPaths = [], runner, timeoutMs = 600_000, onTerminal,
} = {}) {
  const initialState = await readGoalState({ root });
  if (!initialState) throw new Error("No Pota goal state exists; start a goal first");
  assertGoalMutable(initialState);
  const active = initialState.tasks.find((task) => task.status === "active");
  const unfinished = initialState.tasks.filter((task) => task.status !== "completed" && task !== active);
  if (unfinished.length > 0) {
    throw new Error(`Goal cannot be finished while other tasks remain: ${unfinished.map((task) => task.id).join(", ")}`);
  }
  const goalKinds = initialState.goal.requiredEvidence;
  if (goalKinds.length > 0) normalizeVerificationArgv(argv);
  if (active) await setTaskStatus({ root, taskId: active.id, status: "completed" });
  if (goalKinds.length > 0) {
    await verifyAndRecord({ root, scope: "goal", kind: goalKinds, argv, watchPaths, runner, timeoutMs });
  }
  return transitionGoal({ root, status: "completed", onTerminal });
}

// Overhead measurement: how many verifications ran, how many were reruns, and which latest receipts are stale.
export function goalStats(state, root = process.cwd()) {
  if (!state) return null;
  const byKind = {};
  const latest = new Map();
  let reruns = 0;
  for (const receipt of state.receipts) {
    byKind[receipt.kind] = (byKind[receipt.kind] ?? 0) + 1;
    const key = `${receipt.scope}\0${receipt.taskId ?? ""}\0${receipt.kind}`;
    if (latest.has(key)) reruns += 1;
    latest.set(key, receipt);
  }
  const stale = [...latest.values()]
    .filter((receipt) => receipt.source === "tool" && !isReceiptFresh(root, receipt))
    .map((receipt) => ({ scope: receipt.scope, ...(receipt.taskId ? { taskId: receipt.taskId } : {}), kind: receipt.kind }));
  return {
    goalId: state.goal.id,
    status: state.goal.status,
    receipts: state.receipts.length,
    toolReceipts: state.receipts.filter((receipt) => receipt.source === "tool").length,
    byKind,
    reruns,
    stale,
    tasks: state.tasks.map((task) => ({
      id: task.id,
      status: task.status,
      route: task.route ?? null,
      effort: task.effort ?? null,
      effortSource: task.effortSource ?? null,
      ...(task.effortWaiver ? { effortWaiver: task.effortWaiver } : {}),
      ...(task.kind ? { kind: task.kind } : {}),
      ...(task.model ? { model: task.model } : {}),
      ...(task.modelSource ? { modelSource: task.modelSource } : {}),
      ...(task.designWaiver ? { designWaiver: task.designWaiver } : {}),
      ...(task.modelHost ? { modelHost: task.modelHost } : {}),
      ...(task.effectiveModel ? { effectiveModel: task.effectiveModel } : {}),
    })),
  };
}

// While other tasks run in parallel, an unscoped fingerprint would include their edits. Require a watch set,
// and keep it inside the task's declared writeScope so sibling edits cannot stale or fail this evidence.
function assertParallelWatch(state, task, watchPaths) {
  const othersActive = state.tasks.filter((item) => item.status === "active" && item.id !== task?.id);
  if (task ? othersActive.length === 0 : othersActive.length < 2) return;
  if (watchPaths.length === 0) {
    throw new Error(`Other tasks are active (${othersActive.map((item) => item.id).join(", ")}); pass --watch with this task's write scope`);
  }
  if (task?.writeScope) {
    const outside = watchPaths.filter((path) => !task.writeScope.some((scope) => pathContains(scope, path)));
    if (outside.length > 0) throw new Error(`--watch must stay inside task ${task.id} writeScope while other tasks are active: ${outside.join(", ")}`);
  }
}

function normalizeKinds(kind) {
  const kinds = (Array.isArray(kind) ? kind : [kind]).map((item) => requiredText(item, "evidence kind"));
  if (kinds.length === 0) throw new Error("evidence kind is required");
  return [...new Set(kinds)];
}
