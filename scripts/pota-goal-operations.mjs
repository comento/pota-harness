import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { potaHome, worktreeId } from "./pota-paths.mjs";
import { assertNoSymlinkComponents } from "./pota-safe-fs.mjs";
import { goalStatePath, readGoalState, readGoalStateUnlocked, withGoalStateLock, writeGoalStateUnlocked } from "./pota-goal-state.mjs";
import { recordGoalHistoryUnlocked } from "./pota-goal-history.mjs";
import {
  GOAL_STATE_VERSION, PLAN_ID_MAX_LENGTH, STRONGEST_MODEL_BY_HOST, assertRecoveryReferenceBudget, boundedRequiredText,
  assertCanBeActive, assertEffortRecord, assertModelRecord, assertTaskGraph,
  defaultGoalEvidence, normalizeCriteria, normalizeTask, optionalText, requiredText,
  terminalGoalStatuses, timestamp, validEvidencePolicy, validGoalStatus, validModelHost, validTaskKind, validTaskRoute, validTaskStatus, validateState,
} from "./pota-goal-state-validation.mjs";
import {
  advanceGoal, assertGoalMutable, ensureGoalCanComplete, ensureTaskCanComplete,
  mutateGoal, taskById,
} from "./pota-goal-operations-mutations.mjs";

const goalTransitions = {
  active: new Set(["paused", "blocked", "cancelled", "completed"]),
  paused: new Set(["active", "blocked", "cancelled"]),
  blocked: new Set(["active", "paused", "cancelled"]),
  cancelled: new Set(),
  completed: new Set(),
};
const taskTransitions = {
  pending: new Set(["active", "blocked"]),
  active: new Set(["pending", "blocked", "completed"]),
  blocked: new Set(["pending", "active"]),
  completed: new Set(),
};

export async function startGoal({ root = process.cwd(), goal, planId, tasks, completionCriteria = [], requiredEvidence = defaultGoalEvidence, ownerSessionId = null, evidencePolicy = "tool-bound" } = {}) {
  const normalizedGoal = requiredText(goal, "goal");
  const normalizedPlanId = boundedRequiredText(planId, "planId", PLAN_ID_MAX_LENGTH);
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("tasks must contain at least one task");
  return withGoalStateLock(root, async () => {
    let existing = await readGoalStateUnlocked(root);
    const currentWorktreeId = worktreeId(root);
    if (existing && existing.goal.worktreeId !== currentWorktreeId) {
      const path = goalStatePath(root);
      await assertNoSymlinkComponents(potaHome(), path, { allowMissing: false });
      await rm(path);
      existing = null;
    }
    if (existing && !terminalGoalStatuses.has(existing.goal.status)) {
      throw new Error(`An unfinished Pota goal already exists (${existing.goal.id}, ${existing.goal.status}); add the new work to it with goal replan (resume it first if paused or blocked), or cancel or complete it before starting another goal`);
    }
    // A terminal state persisted by an older version is about to be overwritten; history failure never blocks start.
    if (existing) await recordGoalHistoryUnlocked(root, existing, { recordedBy: "start", endedAt: existing.goal.updatedAt });
    const now = timestamp();
    const normalizedTasks = normalizeTaskList(tasks, []);
    assertTaskGraph(normalizedTasks);
    for (const task of normalizedTasks) assertRecoveryReferenceBudget(normalizedPlanId, task.id);
    const state = {
      schemaVersion: GOAL_STATE_VERSION,
      revision: 1,
      goal: {
        id: `goal-${randomUUID()}`,
        title: normalizedGoal,
        planId: normalizedPlanId,
        status: "active",
        completionCriteria: normalizeCriteria(completionCriteria),
        requiredEvidence: normalizeCriteria(requiredEvidence),
        evidencePolicy: validEvidencePolicy(evidencePolicy),
        worktreeId: currentWorktreeId,
        ownerSessionId: optionalText(ownerSessionId, "ownerSessionId"),
        blocker: null,
        createdAt: now,
        updatedAt: now,
      },
      tasks: normalizedTasks,
      receipts: [],
    };
    advanceGoal(state);
    await writeGoalStateUnlocked({ root, state });
    return state;
  });
}

export async function reconcileWorktreeState({ root = process.cwd() } = {}) {
  const initial = await readGoalState({ root });
  if (!initial || initial.goal.worktreeId === worktreeId(root)) return { state: initial, removed: false };
  return withGoalStateLock(root, async () => {
    const state = await readGoalStateUnlocked(root);
    if (!state || state.goal.worktreeId === worktreeId(root)) return { state, removed: false };
    const staleWorktreeId = state.goal.worktreeId;
    const path = goalStatePath(root);
    await assertNoSymlinkComponents(potaHome(), path, { allowMissing: false });
    await rm(path);
    return { state: null, removed: true, staleWorktreeId };
  });
}

// onTerminal(record, { historyError }) runs after a terminal transition succeeds; a history failure never blocks it.
export async function transitionGoal({ root = process.cwd(), status, blocker, onTerminal = () => {} } = {}) {
  const nextStatus = validGoalStatus(status);
  if (terminalGoalStatuses.has(nextStatus)) {
    const { next, history } = await withGoalStateLock(root, async () => {
      const state = await readGoalStateUnlocked(root);
      if (!state) throw new Error("No Pota goal state exists; start a goal first");
      const next = applyGoalTransition(structuredClone(state), nextStatus, blocker, root);
      next.revision += 1;
      validateState(next);
      // Recorded before deletion; a retry after a crash replaces the record for the same goalId.
      const history = await recordGoalHistoryUnlocked(root, next, { recordedBy: "transition" });
      const path = goalStatePath(root);
      await assertNoSymlinkComponents(potaHome(), path, { allowMissing: false });
      await rm(path);
      return { next, history };
    });
    await onTerminal(history.record, { historyError: history.error });
    return next;
  }
  return mutateGoal(root, (state) => applyGoalTransition(state, nextStatus, blocker, root));
}

function applyGoalTransition(state, nextStatus, blocker, root) {
  const currentStatus = state.goal.status;
  if (currentStatus === nextStatus) return state;
  if (!goalTransitions[currentStatus].has(nextStatus)) throw new Error(`Cannot transition goal from ${currentStatus} to ${nextStatus}`);
  if (nextStatus === "completed") ensureGoalCanComplete(state, root);
  if (nextStatus === "blocked") state.goal.blocker = requiredText(blocker, "blocker");
  if (nextStatus === "active") state.goal.blocker = null;
  state.goal.status = nextStatus;
  state.goal.updatedAt = timestamp();
  if (nextStatus === "active" && currentStatus === "blocked") advanceGoal(state, null, { block: false });
  return state;
}

export async function setTaskStatus({ root = process.cwd(), taskId, status, blocker, effortWaiver, designWaiver } = {}) {
  const nextStatus = validTaskStatus(status);
  const normalizedTaskId = requiredText(taskId, "taskId");
  const normalizedWaiver = optionalText(effortWaiver, "effortWaiver");
  if (normalizedWaiver !== null && nextStatus !== "completed") throw new Error("--allow-inherited-effort applies only when completing a task");
  const normalizedDesignWaiver = optionalText(designWaiver, "designWaiver");
  if (normalizedDesignWaiver !== null && nextStatus !== "completed") throw new Error("--allow-no-design-model applies only when completing a task");
  return mutateGoal(root, (state) => {
    assertGoalMutable(state);
    const task = taskById(state, normalizedTaskId);
    if (task.status === nextStatus) return state;
    if (!taskTransitions[task.status].has(nextStatus)) throw new Error(`Cannot transition task ${task.id} from ${task.status} to ${nextStatus}`);
    if (nextStatus === "active") {
      assertCanBeActive(state.tasks, task, state.tasks.filter((item) => item.id !== task.id && item.status === "active"));
    }
    if (nextStatus === "completed") {
      if (normalizedWaiver !== null) task.effortWaiver = normalizedWaiver;
      if (normalizedDesignWaiver !== null) task.designWaiver = normalizedDesignWaiver;
      ensureHeavyEffortApplied(task);
      ensureHeavyDesignRecorded(state, task);
      ensureTaskCanComplete(state, task, root);
    }
    if (nextStatus === "blocked") task.blocker = requiredText(blocker, "blocker");
    if (nextStatus === "active" || nextStatus === "pending") task.blocker = null;
    task.status = nextStatus;
    task.updatedAt = timestamp();
    if (nextStatus === "completed" || nextStatus === "blocked") advanceGoal(state, nextStatus === "blocked" ? task.blocker : null);
    state.goal.updatedAt = timestamp();
    return state;
  });
}

export async function replanGoal({ root = process.cwd(), tasks } = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("replan tasks must contain at least one incomplete task");
  return mutateGoal(root, (state) => {
    assertGoalMutable(state);
    if (state.goal.status !== "active") throw new Error("Only an active goal can be replanned");
    const completedTasks = state.tasks.filter((task) => task.status === "completed");
    const completedIds = new Set(completedTasks.map((task) => task.id));
    const replacementTasks = normalizeTaskList(
      tasks.map((task) => (typeof task === "string" ? task : { ...task, status: undefined, blocker: undefined })),
      completedTasks,
    );
    for (const task of replacementTasks) {
      if (completedIds.has(task.id)) throw new Error(`Replanned task conflicts with completed task id: ${task.id}`);
    }
    state.tasks = [...completedTasks, ...replacementTasks];
    assertTaskGraph(state.tasks);
    state.receipts = state.receipts.filter((receipt) => receipt.scope === "task" && completedIds.has(receipt.taskId));
    state.goal.blocker = null;
    state.goal.updatedAt = timestamp();
    advanceGoal(state);
    return state;
  });
}

// Normalizes tasks as pending; an omitted dependsOn follows the previous task across completed + new tasks.
function normalizeTaskList(tasks, precedingTasks) {
  let previousId = precedingTasks.at(-1)?.id ?? null;
  const normalized = tasks.map((task, index) => {
    const result = normalizeTask(task, index, "pending", previousId);
    previousId = result.id;
    return result;
  });
  return normalized;
}

export async function claimGoal({ root = process.cwd(), sessionId } = {}) {
  const normalizedSessionId = requiredText(sessionId, "sessionId");
  return mutateGoal(root, (state) => {
    assertGoalMutable(state);
    state.goal.ownerSessionId = optionalText(normalizedSessionId, "ownerSessionId");
    state.goal.updatedAt = timestamp();
    return state;
  });
}

// A Heavy task delegated to a worker must record the effort the host actually applied; a missing, not-applied, or
// inherited effort needs an explicit waiver reason. Unassigned (main-agent) and Light tasks are not checked.
function ensureHeavyEffortApplied(task) {
  if (task.route !== "heavy" || !task.assignedAgentId || task.effortWaiver) return;
  const source = task.effortSource ?? null;
  if (task.effort && source !== "not-applied" && source !== "inherited") return;
  throw new Error(`Heavy task ${task.id} assigned to ${task.assignedAgentId} has no applied effort (effort ${task.effort ?? "none"}, source ${source ?? "none"}); record goal assign ${task.id} --effort <low|medium|high|xhigh|max> --effort-source host-option, or complete with --allow-inherited-effort <reason>`);
}

// A kind "design" task must record the strongest-tier model it was dispatched with (host-option). Any other assigned
// Heavy task needs a completed design task in the goal. A designWaiver reason bypasses both; Light and unassigned
// tasks are not checked.
function ensureHeavyDesignRecorded(state, task) {
  if (task.designWaiver) return;
  if (task.kind === "design") {
    if (!(task.model && task.modelSource === "host-option")) {
      throw new Error(`Design task ${task.id} has no recorded design model (model ${task.model ?? "none"}, source ${task.modelSource ?? "none"}); dispatch it to the strongest tier and record goal assign ${task.id} --model <value> --model-source host-option, or complete with --allow-no-design-model <reason>`);
    }
    // The host is declared, never guessed; without it any supported host's strongest value passes.
    const expected = task.modelHost ? [STRONGEST_MODEL_BY_HOST[task.modelHost]] : Object.values(STRONGEST_MODEL_BY_HOST);
    if (expected.includes(task.model)) return;
    throw new Error(`Design task ${task.id} recorded model ${task.model}, expected ${expected.join(" | ")}${task.modelHost ? ` for host ${task.modelHost}` : ""}; dispatch it to the strongest tier and record goal assign ${task.id} --model <value> --model-source host-option, or complete with --allow-no-design-model <reason>`);
  }
  if (task.route !== "heavy" || !task.assignedAgentId) return;
  if (state.tasks.some((item) => item.kind === "design" && item.status === "completed")) return;
  throw new Error(`Heavy task ${task.id} assigned to ${task.assignedAgentId} has no completed design task; add a kind "design" task with goal replan, complete it with goal assign <design-task> --model <value> --model-source host-option, or complete with --allow-no-design-model <reason>`);
}

// Omitted effort/route/waiver options keep stored values, so a reassignment can change only the agent. When effort
// or effortSource is given, both are replaced together; an omitted source is inferred from the effort.
export async function assignTask({
  root = process.cwd(), taskId, agentId = null, effort, effortSource, route, effortWaiver, kind, model, modelSource, designWaiver, effectiveModel, modelHost,
} = {}) {
  const normalizedTaskId = requiredText(taskId, "taskId");
  const normalizedAgentId = agentId === null ? null : requiredText(agentId, "agentId");
  const effortGiven = effort !== undefined || effortSource !== undefined;
  const normalizedEffort = effort ?? null;
  const normalizedSource = effortSource ?? (normalizedEffort === null ? null : normalizedEffort === "inherited" ? "inherited" : "host-option");
  if (effortGiven) {
    if (normalizedEffort === null && normalizedSource !== "not-applied") throw new Error("--effort-source requires --effort unless it is not-applied");
    assertEffortRecord(normalizedEffort, normalizedSource, "assign");
  }
  const modelGiven = model !== undefined || modelSource !== undefined;
  const normalizedModel = model === undefined || model === null ? null : requiredText(model, "model");
  const normalizedModelSource = modelSource ?? (normalizedModel === null ? null : normalizedModel === "inherited" ? "inherited" : "host-option");
  if (modelGiven) assertModelRecord(normalizedModel, normalizedModelSource, "assign");
  const normalizedKind = kind === undefined ? undefined : validTaskKind(kind);
  const normalizedDesignWaiver = designWaiver === undefined ? undefined : requiredText(designWaiver, "designWaiver");
  const normalizedEffectiveModel = effectiveModel === undefined ? undefined : requiredText(effectiveModel, "effectiveModel");
  const normalizedModelHost = modelHost === undefined ? undefined : validModelHost(modelHost);
  const normalizedRoute = route === undefined ? undefined : validTaskRoute(route);
  const normalizedWaiver = effortWaiver === undefined ? undefined : requiredText(effortWaiver, "effortWaiver");
  return mutateGoal(root, (state) => {
    assertGoalMutable(state);
    const task = taskById(state, normalizedTaskId);
    task.assignedAgentId = normalizedAgentId;
    if (effortGiven) {
      task.effort = normalizedEffort;
      task.effortSource = normalizedSource;
    }
    if (modelGiven) {
      task.model = normalizedModel;
      task.modelSource = normalizedModelSource;
    }
    if (normalizedKind !== undefined) task.kind = normalizedKind;
    if (normalizedDesignWaiver !== undefined) task.designWaiver = normalizedDesignWaiver;
    if (normalizedEffectiveModel !== undefined) task.effectiveModel = normalizedEffectiveModel;
    if (normalizedModelHost !== undefined) task.modelHost = normalizedModelHost;
    if (normalizedRoute !== undefined) task.route = normalizedRoute;
    if (normalizedWaiver !== undefined) task.effortWaiver = normalizedWaiver;
    task.updatedAt = timestamp();
    state.goal.updatedAt = timestamp();
    return state;
  });
}
