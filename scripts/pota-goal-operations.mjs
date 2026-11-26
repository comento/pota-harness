import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { potaHome, worktreeId } from "./pota-paths.mjs";
import { assertNoSymlinkComponents } from "./pota-safe-fs.mjs";
import {
  goalStatePath, readGoalState, readGoalStateUnlocked, readMainModelRecord, withGoalStateLock, writeGoalStateUnlocked,
} from "./pota-goal-state.mjs";
import {
  MODEL_TIER_BY_HOST, classifyModel, effectiveModel, effectiveTier, isAtOrAboveTier, modelsAtOrAbove, validCeiling,
} from "./pota-model-tier.mjs";
import { recordGoalHistoryUnlocked } from "./pota-goal-history.mjs";
import {
  REPLAN_STEER_VALUES, prepareSteeringEntry, readPlanText, readSteeringEntries, steeringReason, removeSteeringUnlocked, requestBriefGateError, validSteerKind,
  writeSteeringEntriesUnlocked,
} from "./pota-goal-steering.mjs";
import {
  GOAL_STATE_VERSION, PLAN_ID_MAX_LENGTH, assertRecoveryReferenceBudget, boundedRequiredText,
  assertCanBeActive, assertEffortRecord, assertModelRecord, assertTaskGraph,
  defaultGoalEvidence, normalizeCriteria, normalizeTask, optionalText, requiredText,
  terminalGoalStatuses, timestamp, validEvidencePolicy, validGoalStatus, validModelHost, validTaskKind, validTaskRoute, validTaskStatus, validateState,
} from "./pota-goal-state-validation.mjs";
import {
  NO_READY_TASK_BLOCKER, advanceGoal, assertGoalMutable, ensureGoalCanComplete, ensureTaskCanComplete,
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
export async function transitionGoal({
  root = process.cwd(), status, blocker, onTerminal = () => {}, mainModelWaiver, sessionId = null, mainModelGate = true,
  modelCeiling = null,
} = {}) {
  const ceiling = validCeiling(modelCeiling);
  const nextStatus = validGoalStatus(status);
  const normalizedMainModelWaiver = optionalText(mainModelWaiver, "mainModelWaiver");
  if (normalizedMainModelWaiver !== null && nextStatus !== "completed") throw new Error("--allow-main-model applies only when completing a goal");
  if (terminalGoalStatuses.has(nextStatus)) {
    const { next, history } = await withGoalStateLock(root, async () => {
      const state = await readGoalStateUnlocked(root);
      if (!state) throw new Error("No Pota goal state exists; start a goal first");
      const next = applyGoalTransition(structuredClone(state), nextStatus, blocker, root);
      if (nextStatus === "completed") {
        await ensureMainModelReview(root, next, { sessionId, waiver: normalizedMainModelWaiver, enabled: mainModelGate, ceiling });
      }
      next.revision += 1;
      validateState(next);
      // Recorded before deletion; a retry after a crash replaces the record for the same goalId.
      const history = await recordGoalHistoryUnlocked(root, next, { recordedBy: "transition", reason: nextStatus === "cancelled" ? blocker : null });
      const path = goalStatePath(root);
      await assertNoSymlinkComponents(potaHome(), path, { allowMissing: false });
      await rm(path);
      await removeSteeringUnlocked(root);
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
  if (nextStatus === "active") advanceGoal(state, null, { block: false });
  return state;
}

export async function setTaskStatus(rootOrOptions = {}, maybeOptions) {
  const {
    root = process.cwd(), taskId, status, blocker, reason, approveGate = false, effortWaiver, designWaiver, mainModelWaiver,
    sessionId = null, mainModelGate = true, modelCeiling = null, requestBriefWaiver,
  } = normalizeRootOptions(rootOrOptions, maybeOptions);
  if (typeof approveGate !== "boolean") throw new Error("approveGate must be a boolean");
  const ceiling = validCeiling(modelCeiling);
  const nextStatus = validTaskStatus(status);
  if (approveGate === true && nextStatus !== "active") {
    throw new Error("--approve-gate can only be used when transitioning a task to active");
  }
  const normalizedTaskId = requiredText(taskId, "taskId");
  const resolvedBlocker = blocker !== undefined ? blocker : reason;
  const normalizedWaiver = optionalText(effortWaiver, "effortWaiver");
  if (normalizedWaiver !== null && nextStatus !== "completed") throw new Error("--allow-inherited-effort applies only when completing a task");
  const normalizedDesignWaiver = optionalText(designWaiver, "designWaiver");
  if (normalizedDesignWaiver !== null && nextStatus !== "completed") throw new Error("--allow-no-design-model applies only when completing a task");
  const normalizedMainModelWaiver = optionalText(mainModelWaiver, "mainModelWaiver");
  if (normalizedMainModelWaiver !== null && nextStatus !== "completed") throw new Error("--allow-main-model applies only when completing a task");
  const normalizedBriefWaiver = optionalText(requestBriefWaiver, "requestBriefWaiver");
  if (normalizedBriefWaiver !== null && nextStatus !== "completed") throw new Error("--allow-no-request-brief applies only when completing a task");
  return mutateGoal(root, async (state) => {
    assertGoalMutable(state);
    const task = taskById(state, normalizedTaskId);
    if (task.status === nextStatus) return state;
    if (!taskTransitions[task.status].has(nextStatus)) throw new Error(`Cannot transition task ${task.id} from ${task.status} to ${nextStatus}`);
    if (nextStatus === "active") {
      if (task.approvalGate === true && !approveGate) {
        throw new Error(`Task ${task.id} has a manual approval gate. Run 'pota goal gate --task ${task.id} --off' or pass --approve-gate.`);
      }
      assertCanBeActive(state.tasks, task, state.tasks.filter((item) => item.id !== task.id && item.status === "active"));
      if (approveGate === true) task.approvalGate = false;
    }
    if (nextStatus === "completed") {
      if (normalizedWaiver !== null) task.effortWaiver = normalizedWaiver;
      if (normalizedDesignWaiver !== null) task.designWaiver = normalizedDesignWaiver;
      ensureHeavyEffortApplied(task);
      ensureHeavyDesignRecorded(state, task, ceiling);
      if (normalizedBriefWaiver === null && task.requiredEvidence.includes("triageDecision")) {
        const message = requestBriefGateError(root, state.goal.planId, task.id);
        if (message) throw new Error(message);
      }
      ensureTaskCanComplete(state, task, root);
      await ensureMainModelPlanning(root, state, task, { sessionId, waiver: normalizedMainModelWaiver, enabled: mainModelGate, ceiling });
    }
    if (nextStatus === "blocked") task.blocker = requiredText(resolvedBlocker, "blocker");
    if (nextStatus === "active" || nextStatus === "pending") task.blocker = null;
    task.status = nextStatus;
    task.updatedAt = timestamp();
    if (nextStatus === "completed" || nextStatus === "blocked") advanceGoal(state, nextStatus === "blocked" ? task.blocker : null);
    state.goal.updatedAt = timestamp();
    return state;
  });
}

export async function replanGoal({ root = process.cwd(), tasks, steer, reason } = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("replan tasks must contain at least one incomplete task");
  const steerGiven = steer !== undefined && steer !== null;
  const reasonGiven = reason !== undefined && reason !== null;
  const normalizedSteer = steerGiven ? validSteerKind(steer, { allowNone: true, label: "--steer" }) : null;
  return mutateGoal(root, async (state) => {
    assertGoalMutable(state);
    if (state.goal.status !== "active") throw new Error("Only an active goal can be replanned");
    // A plan file needs both flags; an uninspectable plan accepts them but records only when both are given.
    const planInspectable = readPlanText(root, state.goal.planId) !== null;
    if ((planInspectable || steerGiven || reasonGiven) && !(steerGiven && reasonGiven)) {
      throw new Error(`goal replan on plan ${state.goal.planId} requires --steer <${REPLAN_STEER_VALUES.join("|")}> and --reason <text>; use correction, addition, or redirect for a user steering and none for a replan that is not one`);
    }
    const entries = steerGiven ? readSteeringEntries(root, state.goal.id) : [];
    const entry = steerGiven ? prepareSteeringEntry({ root, state, entries, kind: normalizedSteer, reason, replan: true }) : null;
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
    if (entry) {
      // Validate the next state first so a rejected write never leaves a steering entry behind.
      validateState(structuredClone({ ...state, revision: state.revision + 1 }));
      await writeSteeringEntriesUnlocked(root, state.goal.id, [...entries, entry]);
    }
    return state;
  });
}

// Records a steering that does not change the task roadmap; only an active goal can be steered.
export async function steerGoal({ root = process.cwd(), kind, reason } = {}) {
  const normalizedKind = validSteerKind(kind);
  const normalizedReason = steeringReason(reason);
  return withGoalStateLock(root, async () => {
    const state = await readGoalStateUnlocked(root);
    if (!state) throw new Error("No Pota goal state exists; start a goal first");
    if (state.goal.status !== "active") throw new Error(`Only an active goal can be steered (goal is ${state.goal.status})`);
    const entries = readSteeringEntries(root, state.goal.id);
    const entry = prepareSteeringEntry({ root, state, entries, kind: normalizedKind, reason: normalizedReason, replan: false });
    await writeSteeringEntriesUnlocked(root, state.goal.id, [...entries, entry]);
    return { goalId: state.goal.id, ...entry };
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

// A kind "design" task must record the strongest-tier model it was dispatched with (host-option); under a model
// ceiling the ceiling tier's model or any higher one passes. Any other assigned Heavy task needs a completed design task
// in the goal. A designWaiver reason bypasses both; Light and unassigned tasks are not checked.
function ensureHeavyDesignRecorded(state, task, ceiling = null) {
  if (task.designWaiver) return;
  if (task.kind === "design") {
    // The host is declared, never guessed; without it any supported host's value passes.
    const hosts = task.modelHost ? [task.modelHost] : Object.keys(MODEL_TIER_BY_HOST);
    const target = designTarget(hosts, ceiling);
    if (!(task.model && task.modelSource === "host-option")) {
      throw new Error(`Design task ${task.id} has no recorded design model (model ${task.model ?? "none"}, source ${task.modelSource ?? "none"}); dispatch it to ${target} and record goal assign ${task.id} --model <value> --model-source host-option, or complete with --allow-no-design-model <reason>`);
    }
    const floor = effectiveTier("strongest", ceiling);
    const expected = [...new Set(hosts.flatMap((host) => modelsAtOrAbove(host, floor)))];
    if (expected.includes(task.model)) return;
    if (hosts.includes("antigravity")) {
      const classified = classifyModel(task.model, "antigravity");
      if (classified && isAtOrAboveTier(classified.tier, floor)) return;
    }
    throw new Error(`Design task ${task.id} recorded model ${task.model}, expected ${expected.join(" | ")}${task.modelHost ? ` for host ${task.modelHost}` : ""}${ceilingNote(ceiling)}; dispatch it to ${target} and record goal assign ${task.id} --model <value> --model-source host-option, or complete with --allow-no-design-model <reason>${ceilingHint(ceiling === "stronger" ? "balanced" : "stronger|balanced", ceiling)}`);
  }
  if (task.route !== "heavy" || !task.assignedAgentId) return;
  if (state.tasks.some((item) => item.kind === "design" && item.status === "completed")) return;
  throw new Error(`Heavy task ${task.id} assigned to ${task.assignedAgentId} has no completed design task; add a kind "design" task with goal replan, complete it with goal assign <design-task> --model <value> --model-source host-option, or complete with --allow-no-design-model <reason>`);
}

const ceilingNote = (ceiling) => (ceiling ? ` (model ceiling ${ceiling})` : "");

// Under a ceiling the dispatch target is the ceiling tier's model, the first expected value for each host; without one
// the wording stays "the strongest tier".
function designTarget(hosts, ceiling) {
  if (!validCeiling(ceiling)) return "the strongest tier";
  return [...new Set(hosts.map((host) => effectiveModel(host, "strongest", ceiling)).filter(Boolean))].join(" | ");
}

// Gate errors point an account that cannot use the expected model to the user's ceiling setting; a balanced ceiling
// is already the lowest, so it gets no hint.
function ceilingHint(options, ceiling) {
  if (ceiling === "balanced") return "";
  return `. If this account cannot use that model, have the user set a model ceiling (POTA_MODEL_CEILING=${options}, or "modelCeiling" in ~/.pota/config.json); never set it yourself. See delegation.md "Model Ceiling"`;
}

// Passing evidence is a host-option dispatch classified at the floor tier (stronger, or the capped stronger tier) or
// above for its declared host. The agent id is not required: goal assign without --agent resets it to null.
const dispatchedAtOrAbove = (task, floor) => task.modelSource === "host-option"
  && isAtOrAboveTier(classifyModel(task.model, task.modelHost ?? null)?.tier, floor);

// The session key is the host session (CLAUDE_CODE_SESSION_ID) or else the goal owner; without one, or without a
// recorded below-floor main model for it, nothing is gated. The CLI passes enabled: false for POTA_MAIN_MODEL_GATE off.
async function mainModelRecordFor(root, state, sessionId, floor) {
  const key = sessionId ?? state.goal.ownerSessionId ?? null;
  return key ? readMainModelRecord(root, key, floor) : null;
}

function strongerExpectation(host, ceiling) {
  if (!Object.hasOwn(MODEL_TIER_BY_HOST, host ?? "")) return `the ${effectiveTier("stronger", ceiling)} tier or above`;
  return [...new Set([effectiveModel(host, "stronger", ceiling), effectiveModel(host, "strongest", ceiling)])].join(" or ");
}

const floorText = (floor, ceiling) => `at the ${floor} tier${ceilingNote(ceiling)}`;

// The main model gate applies only to goals that have a Heavy Path task; Quick and Light goals run on the session model.
const hasHeavyTask = (state) => state.tasks.some((task) => task.route === "heavy");

// A task that requires triageDecision evidence is planning work; a below-floor main session must have dispatched it.
async function ensureMainModelPlanning(root, state, task, { sessionId = null, waiver = null, enabled = true, ceiling = null } = {}) {
  const cap = validCeiling(ceiling);
  const floor = effectiveTier("stronger", cap);
  if (!enabled || waiver || !task.requiredEvidence.includes("triageDecision") || !hasHeavyTask(state) || dispatchedAtOrAbove(task, floor)) return;
  const record = await mainModelRecordFor(root, state, sessionId, floor);
  if (!record) return;
  throw new Error(`Planning task ${task.id} was not dispatched ${floorText(floor, cap)}: this session's main model is ${record.model} (${record.tier} tier). Dispatch planning and triage to ${strongerExpectation(record.host, cap)} and record goal assign ${task.id} --agent <id> --model <value> --model-source host-option, or complete with --allow-main-model <reason> (for example when the session model changed after session start)${ceilingHint("balanced", cap)}`);
}

// Goal completion under a below-floor main session needs one kind "review" task dispatched at the floor tier or above.
export async function ensureMainModelReview(root, state, { sessionId = null, waiver = null, enabled = true, ceiling = null } = {}) {
  const cap = validCeiling(ceiling);
  const floor = effectiveTier("stronger", cap);
  if (!enabled || waiver || !hasHeavyTask(state) || state.tasks.some((task) => task.kind === "review" && dispatchedAtOrAbove(task, floor))) return;
  const record = await mainModelRecordFor(root, state, sessionId, floor);
  if (!record) return;
  throw new Error(`Goal ${state.goal.id} has no review dispatched ${floorText(floor, cap)}: this session's main model is ${record.model} (${record.tier} tier). Dispatch the final review to ${strongerExpectation(record.host, cap)} and record goal assign <review-task> --kind review --agent <id> --model <value> --model-source host-option, or pass --allow-main-model <reason> to goal finish or goal complete (for example when the session model changed after session start)${ceilingHint("balanced", cap)}`);
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

// 위치 인자(root, options)와 단일 옵션 객체({ root, ... }) 호출 규약을 모두 수용한다.
function normalizeRootOptions(rootOrOptions = {}, maybeOptions) {
  if (typeof rootOrOptions === "string") {
    return { ...(maybeOptions ?? {}), root: rootOrOptions };
  }
  if (maybeOptions && typeof maybeOptions === "object") {
    return { ...maybeOptions, ...(rootOrOptions == null ? {} : { root: rootOrOptions }) };
  }
  return rootOrOptions ?? {};
}

// 명시적 락 기반 일시정지 전이를 수행한다.
export async function pauseGoal(rootOrOptions = {}, maybeOptions) {
  const { root = process.cwd(), reason = null, sessionId = null } = normalizeRootOptions(rootOrOptions, maybeOptions);
  optionalText(reason, "reason");
  optionalText(sessionId, "sessionId");
  return mutateGoal(root, (state) => applyGoalTransition(state, "paused", null, root));
}

// 명시적 락 기반 재개 전이를 수행하며 active 복귀 시 게이트가 없는 ready task만 활성화한다.
export async function resumeGoal(rootOrOptions = {}, maybeOptions) {
  const { root = process.cwd(), reason = null, sessionId = null } = normalizeRootOptions(rootOrOptions, maybeOptions);
  optionalText(reason, "reason");
  optionalText(sessionId, "sessionId");
  return mutateGoal(root, (state) => applyGoalTransition(state, "active", null, root));
}

// 단일 락 안에서 task의 수동 승인 게이트를 설정하거나 해제한다.
export async function setTaskApprovalGate(rootOrOptions = {}, maybeOptions) {
  const { root = process.cwd(), taskId, enabled, reason = null, sessionId = null } = normalizeRootOptions(rootOrOptions, maybeOptions);
  const normalizedTaskId = requiredText(taskId, "taskId");
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  optionalText(reason, "reason");
  optionalText(sessionId, "sessionId");
  return updateTaskApprovalGate(root, normalizedTaskId, () => enabled);
}

// 단일 락 안에서 blocked task를 pending으로 되돌리고 dispatch 기록과 그 task의 영수증을 비운다(완료하려면 검증을 다시 기록한다).
// goal이 그 task(또는 다른 blocked task)의 blocker나 기본 문구로 막혀 있었을 때만 active로 복귀시키며, `goal block`으로 직접 막은 goal은 유지한다.
// active goal은 advanceGoal로 준비된 첫 task를 활성화하고, 실행할 task가 없으면 남은 blocked task의 사유로 다시 blocked가 된다.
export async function retryTask(rootOrOptions = {}, maybeOptions) {
  const { root = process.cwd(), taskId } = normalizeRootOptions(rootOrOptions, maybeOptions);
  const normalizedTaskId = requiredText(taskId, "taskId");
  return mutateGoal(root, (state) => {
    assertGoalMutable(state);
    const task = taskById(state, normalizedTaskId);
    if (task.status !== "blocked") {
      throw new Error(`Task ${task.id} is ${task.status}; only a blocked task can be retried`);
    }
    const blockedByTasks = state.goal.blocker !== null && state.goal.blocker !== undefined
      && (state.goal.blocker === NO_READY_TASK_BLOCKER
        || state.tasks.some((item) => item.status === "blocked" && item.blocker === state.goal.blocker));
    task.status = "pending";
    task.blocker = null;
    for (const key of ["assignedAgentId", "effort", "effortSource", "model", "modelSource", "effectiveModel", "modelHost"]) {
      task[key] = null;
    }
    state.receipts = state.receipts.filter((receipt) => !(receipt.scope === "task" && receipt.taskId === task.id));
    task.updatedAt = timestamp();
    if (state.goal.status === "blocked" && blockedByTasks) {
      state.goal.status = "active";
      state.goal.blocker = null;
    }
    if (state.goal.status === "active") advanceGoal(state, null);
    state.goal.updatedAt = timestamp();
    return state;
  });
}

// 단일 락 안에서 task의 현재 approvalGate 값을 읽고 원자적으로 반전한다.
export async function toggleTaskApprovalGate(rootOrOptions = {}, maybeOptions) {
  const { root = process.cwd(), taskId, reason = null, sessionId = null } = normalizeRootOptions(rootOrOptions, maybeOptions);
  const normalizedTaskId = requiredText(taskId, "taskId");
  optionalText(reason, "reason");
  optionalText(sessionId, "sessionId");
  return updateTaskApprovalGate(root, normalizedTaskId, (task) => !task.approvalGate);
}

async function updateTaskApprovalGate(root, taskId, resolveNextEnabled) {
  return mutateGoal(root, (state) => {
    assertGoalMutable(state);
    const task = taskById(state, taskId);
    const nextEnabled = Boolean(resolveNextEnabled(task));
    if (task.status === "completed") {
      throw new Error(`Cannot change approval gate on completed task ${task.id}`);
    }
    if (task.status === "active" && nextEnabled) {
      throw new Error(`Cannot enable approval gate on active task ${task.id}`);
    }
    task.approvalGate = nextEnabled;
    task.updatedAt = timestamp();
    // paused 등 비-active 목표는 상태를 유지하고, active 목표에서만 게이트 해제 후 ready task를 진행한다.
    if (!nextEnabled && state.goal.status === "active") {
      advanceGoal(state, null, { block: false });
    }
    state.goal.updatedAt = timestamp();
    return state;
  });
}
