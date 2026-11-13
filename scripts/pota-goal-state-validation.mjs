import { normalizeVerificationArgv } from "./pota-goal-evidence.mjs";

export const GOAL_STATE_VERSION = 3;
export const MAX_ACTIVE_TASKS = 4;
export const GOAL_STATUSES = new Set(["active", "paused", "blocked", "cancelled", "completed"]);
export const TASK_STATUSES = new Set(["pending", "active", "blocked", "completed"]);
export const PLAN_ID_MAX_LENGTH = 128;
export const TASK_ID_MAX_LENGTH = 64;
export const RECOVERY_REFERENCE_MAX_LENGTH = 160;
export const GOAL_STATE_CONTRACT = Object.freeze({
  completionCriteria: Object.freeze({ behavior: "advisory", enforced: false }),
  terminal: Object.freeze({
    statuses: Object.freeze(["cancelled", "completed"]),
    persistence: "deleted",
    readAfterTransition: null,
    transitionResult: "terminal-snapshot",
  }),
});
export const terminalGoalStatuses = new Set(["cancelled", "completed"]);
export const defaultTaskEvidence = ["moduleAcceptance", "surfaceIntegration"];
export const defaultGoalEvidence = ["finalReview"];

const evidencePolicies = new Set(["declared", "tool-bound"]);
export const TASK_ROUTES = new Set(["light", "heavy"]);
export const CONCRETE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
export const TASK_EFFORTS = new Set([...CONCRETE_EFFORTS, "inherited"]);
export const EFFORT_SOURCES = new Set(["host-option", "inherited", "not-applied"]);
export const TASK_KINDS = new Set(["design"]);
// The host's strongest tier is the value passed at dispatch; mirrors the strongest column in skills/pota-plan/delegation.md.
export const STRONGEST_MODEL_BY_HOST = Object.freeze({ "claude-code": "fable", codex: "gpt-6-astra", antigravity: "pro" });

export function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pota goal state must be an object");
  if (value.schemaVersion !== GOAL_STATE_VERSION) throw new Error(`Unsupported Pota goal state schema version: ${value.schemaVersion}`);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error("Pota goal state revision must be a positive integer");
  if (!value.goal || typeof value.goal !== "object") throw new Error("Pota goal state is missing goal");
  const goal = value.goal;
  requiredText(goal.id, "goal.id");
  requiredText(goal.title, "goal.title");
  const planId = boundedRequiredText(goal.planId, "goal.planId", PLAN_ID_MAX_LENGTH);
  validGoalStatus(goal.status);
  validEvidencePolicy(goal.evidencePolicy);
  validTimestamp(goal.createdAt);
  validTimestamp(goal.updatedAt);
  if (!Array.isArray(goal.completionCriteria)) throw new Error("goal.completionCriteria must be an array");
  if (!Array.isArray(goal.requiredEvidence) || goal.requiredEvidence.length === 0) throw new Error("goal.requiredEvidence must be a non-empty array");
  goal.requiredEvidence.forEach((kind, index) => requiredText(kind, `goal.requiredEvidence[${index}]`));
  if (goal.ownerSessionId !== null && goal.ownerSessionId !== undefined) requiredText(goal.ownerSessionId, "goal.ownerSessionId");
  if (goal.worktreeId !== null && goal.worktreeId !== undefined) requiredText(goal.worktreeId, "goal.worktreeId");
  if (goal.blocker !== null && goal.blocker !== undefined) requiredText(goal.blocker, "goal.blocker");
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) throw new Error("Pota goal state must contain tasks");
  if (!Array.isArray(value.receipts)) throw new Error("Pota goal state evidence records (receipts) must be an array");
  const ids = new Set();
  for (const task of value.tasks) {
    if (!task || typeof task !== "object") throw new Error("Each task must be an object");
    const taskId = boundedRequiredText(task.id, "task.id", TASK_ID_MAX_LENGTH);
    assertRecoveryReferenceBudget(planId, taskId);
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    requiredText(task.title, "task.title");
    validTaskStatus(task.status);
    if (!Array.isArray(task.dependsOn)) throw new Error(`task ${task.id} dependsOn must be an array`);
    if (task.writeScope !== null && !Array.isArray(task.writeScope)) throw new Error(`task ${task.id} writeScope must be an array or null`);
    if (task.assignedAgentId !== null && task.assignedAgentId !== undefined) requiredText(task.assignedAgentId, "task.assignedAgentId");
    if (!Array.isArray(task.requiredEvidence) || task.requiredEvidence.length === 0) throw new Error(`task ${task.id} requiredEvidence must be a non-empty array`);
    task.requiredEvidence.forEach((kind, index) => requiredText(kind, `task ${task.id} requiredEvidence[${index}]`));
    if (task.blocker !== null && task.blocker !== undefined) requiredText(task.blocker, `task ${task.id} blocker`);
    // Optional since v3 states predate them; absent means unrecorded.
    if (task.route !== null && task.route !== undefined) validTaskRoute(task.route, `task ${task.id} route`);
    assertEffortRecord(task.effort ?? null, task.effortSource ?? null, `task ${task.id}`);
    if (task.effortWaiver !== null && task.effortWaiver !== undefined) requiredText(task.effortWaiver, `task ${task.id} effortWaiver`);
    if (task.kind !== null && task.kind !== undefined) validTaskKind(task.kind, `task ${task.id} kind`);
    assertModelRecord(task.model ?? null, task.modelSource ?? null, `task ${task.id}`);
    if (task.designWaiver !== null && task.designWaiver !== undefined) requiredText(task.designWaiver, `task ${task.id} designWaiver`);
    if (task.modelHost !== null && task.modelHost !== undefined) validModelHost(task.modelHost, `task ${task.id} modelHost`);
    if (task.effectiveModel !== null && task.effectiveModel !== undefined) requiredText(task.effectiveModel, `task ${task.id} effectiveModel`);
    validTimestamp(task.createdAt);
    validTimestamp(task.updatedAt);
  }
  assertTaskGraph(value.tasks);
  const active = value.tasks.filter((task) => task.status === "active");
  for (const task of active) assertCanRunAlongside(task, active.filter((other) => other !== task));
  for (const receipt of value.receipts) validateReceipt(receipt, value);
  return value;
}

function validateReceipt(receipt, state) {
  if (!receipt || typeof receipt !== "object") throw new Error("Each evidence record must be an object");
  requiredText(receipt.id, "evidence.id");
  const scope = validReceiptScope(receipt.scope);
  requiredText(receipt.kind, "evidence.kind");
  if (scope === "task") {
    requiredText(receipt.taskId, "evidence.taskId");
    if (!state.tasks.some((task) => task.id === receipt.taskId)) throw new Error(`Evidence record references unknown task: ${receipt.taskId}`);
  } else if (receipt.taskId !== undefined && receipt.taskId !== null) {
    throw new Error("goal-scope evidence record must not contain taskId");
  }
  if (receipt.goalId !== state.goal.id) throw new Error("evidence goalId does not match goal");
  if (receipt.planId !== state.goal.planId) throw new Error("evidence planId does not match goal");
  validReceiptCommand(receipt.command);
  if (receipt.exitCode !== 0) throw new Error("evidence exitCode must be 0");
  validTimestamp(receipt.timestamp);
  if (validReceiptSource(receipt.source) === "tool") {
    normalizeToolEvidence({ argv: receipt.argv, outputDigest: receipt.outputDigest, summary: receipt.summary, fingerprint: receipt.workspaceFingerprint, watchPaths: receipt.watchPaths });
  }
}

// dependsOn omitted means "after the previous task in list order" so existing sequential plans keep their order;
// an explicit [] means no dependency.
export function normalizeTask(task, index, defaultStatus, previousTaskId = null) {
  const source = typeof task === "string" ? { title: task } : task;
  if (!source || typeof source !== "object") throw new Error(`tasks[${index}] must be a string or object`);
  const id = source.id === undefined ? `task-${index + 1}` : boundedRequiredText(source.id, `tasks[${index}].id`, TASK_ID_MAX_LENGTH);
  const title = requiredText(source.title, `tasks[${index}].title`);
  return {
    id,
    title,
    status: source.status === undefined ? defaultStatus : validTaskStatus(source.status),
    assignedAgentId: source.assignedAgentId === undefined || source.assignedAgentId === null ? null : requiredText(source.assignedAgentId, `tasks[${index}].assignedAgentId`),
    requiredEvidence: normalizeCriteria(source.requiredEvidence ?? defaultTaskEvidence),
    dependsOn: source.dependsOn === undefined
      ? (previousTaskId === null ? [] : [previousTaskId])
      : normalizeDependsOn(source.dependsOn, `tasks[${index}].dependsOn`),
    writeScope: source.writeScope === undefined || source.writeScope === null
      ? null
      : normalizeWriteScope(source.writeScope, `tasks[${index}].writeScope`),
    route: source.route === undefined || source.route === null ? null : validTaskRoute(source.route, `tasks[${index}].route`),
    effort: null,
    effortSource: null,
    effortWaiver: null,
    kind: source.kind === undefined || source.kind === null ? null : validTaskKind(source.kind, `tasks[${index}].kind`),
    model: null,
    modelSource: null,
    designWaiver: null,
    modelHost: null,
    effectiveModel: null,
    blocker: null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
  };
}

export function validTaskRoute(value, label = "route") {
  if (!TASK_ROUTES.has(value)) throw new Error(`${label} must be one of: ${[...TASK_ROUTES].join(", ")}`);
  return value;
}

export function validModelHost(value, label = "modelHost") {
  if (!Object.hasOwn(STRONGEST_MODEL_BY_HOST, value)) throw new Error(`${label} must be one of: ${Object.keys(STRONGEST_MODEL_BY_HOST).join(", ")}`);
  return value;
}

export function validTaskKind(value, label = "kind") {
  if (!TASK_KINDS.has(value)) throw new Error(`${label} must be one of: ${[...TASK_KINDS].join(", ")}`);
  return value;
}

// A model is a non-empty host-specific string; source "host-option" needs a model, and a model needs a source.
export function assertModelRecord(model, source, label = "task") {
  if (model !== null) requiredText(model, `${label} model`);
  if (source !== null && !EFFORT_SOURCES.has(source)) throw new Error(`${label} modelSource must be one of: ${[...EFFORT_SOURCES].join(", ")}`);
  if (source === "host-option" && model === null) throw new Error(`${label} modelSource host-option requires a model`);
  if (source === "inherited" && model === null) throw new Error(`${label} modelSource inherited requires a model`);
  if (model !== null && source === null) throw new Error(`${label} model requires a modelSource`);
}

// effort "inherited" pairs only with source "inherited"; source "host-option" needs a concrete level; a source
// without an effort is only meaningful as "not-applied".
export function assertEffortRecord(effort, source, label = "task") {
  if (effort !== null && !TASK_EFFORTS.has(effort)) throw new Error(`${label} effort must be one of: ${[...TASK_EFFORTS].join(", ")}`);
  if (source !== null && !EFFORT_SOURCES.has(source)) throw new Error(`${label} effortSource must be one of: ${[...EFFORT_SOURCES].join(", ")}`);
  if (effort === "inherited" && source !== "inherited") throw new Error(`${label} effort inherited requires effortSource inherited`);
  if (source === "host-option" && !CONCRETE_EFFORTS.has(effort)) throw new Error(`${label} effortSource host-option requires a concrete effort (${[...CONCRETE_EFFORTS].join(", ")})`);
  if (source === "inherited" && effort === null) throw new Error(`${label} effortSource inherited requires an effort`);
  if (effort !== null && source === null) throw new Error(`${label} effort requires an effortSource`);
}

export function migrateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  let state = value;
  if (state.schemaVersion === 1) {
    state = {
      ...state,
      schemaVersion: 2,
      goal: { ...state.goal, evidencePolicy: state.goal?.evidencePolicy ?? "tool-bound" },
      receipts: Array.isArray(state.receipts) ? state.receipts.map((receipt) => ({ ...receipt, source: "declared" })) : state.receipts,
    };
  }
  if (state.schemaVersion === 2) {
    // v2 tasks ran strictly in list order; make that order explicit as previous-task dependencies.
    state = {
      ...state,
      schemaVersion: 3,
      tasks: Array.isArray(state.tasks)
        ? state.tasks.map((task, index) => ({
          ...task,
          dependsOn: index === 0 ? [] : [state.tasks[index - 1]?.id],
          writeScope: null,
        }))
        : state.tasks,
    };
  }
  return state;
}

export function normalizeDependsOn(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of task ids`);
  return [...new Set(value.map((item, index) => boundedRequiredText(item, `${label}[${index}]`, TASK_ID_MAX_LENGTH)))];
}

export function normalizeWriteScope(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} writeScope must be a non-empty array of repository paths`);
  return [...new Set(value.map((item, index) => {
    const path = requiredText(item, `${label}[${index}]`).replace(/\\/g, "/").replace(/\/{2,}/g, "/")
      .replace(/^(\.\/)+/, "").replace(/\/+$/, "");
    if (/[*?[\]{}]/.test(path)) throw new Error(`${label} writeScope must list literal paths, not globs: ${item}`);
    if (path === "" || path === "." || path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.split("/").includes("..")) {
      throw new Error(`${label} writeScope must stay inside the repository: ${item}`);
    }
    return path;
  }))];
}

// Segment-wise prefix match, case-insensitive so case-insensitive filesystems cannot hide an overlap.
export function writeScopesOverlap(left, right) {
  return left.some((a) => right.some((b) => pathContains(a, b) || pathContains(b, a)));
}

export function pathContains(scope, path) {
  const outer = scope.toLowerCase();
  const inner = path.toLowerCase();
  return inner === outer || inner.startsWith(`${outer}/`);
}

export function assertTaskGraph(tasks) {
  const byId = new Map();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    byId.set(task.id, task);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself`);
      if (!byId.has(dependency)) throw new Error(`Task ${task.id} depends on unknown task: ${dependency}`);
    }
  }
  const visiting = new Set();
  const done = new Set();
  const visit = (task, path) => {
    if (done.has(task.id)) return;
    if (visiting.has(task.id)) throw new Error(`Task dependency cycle: ${[...path, task.id].join(" -> ")}`);
    visiting.add(task.id);
    for (const dependency of task.dependsOn) visit(byId.get(dependency), [...path, task.id]);
    visiting.delete(task.id);
    done.add(task.id);
  };
  for (const task of tasks) visit(task, []);
}

// Throws unless task may be active next to otherActive: dependencies completed, under the cap, and disjoint
// writeScopes. A task without writeScope may only run alone.
export function assertCanBeActive(tasks, task, otherActive) {
  const waiting = task.dependsOn.filter((id) => tasks.find((item) => item.id === id)?.status !== "completed");
  if (waiting.length > 0) throw new Error(`Task ${task.id} is waiting for: ${waiting.join(", ")}`);
  assertCanRunAlongside(task, otherActive);
}

function assertCanRunAlongside(task, otherActive) {
  if (otherActive.length === 0) return;
  if (otherActive.length + 1 > MAX_ACTIVE_TASKS) throw new Error(`Only at most ${MAX_ACTIVE_TASKS} active tasks are allowed`);
  if (task.writeScope === null) throw new Error(`Task ${task.id} without writeScope cannot run alongside active task ${otherActive[0].id}`);
  for (const other of otherActive) {
    if (other.writeScope === null) throw new Error(`Task ${task.id} cannot run alongside active task ${other.id} without writeScope`);
    if (writeScopesOverlap(task.writeScope, other.writeScope)) throw new Error(`Task ${task.id} writeScope overlaps active task ${other.id}`);
  }
}

export function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

export function boundedRequiredText(value, label, maxLength) {
  const text = requiredText(value, label);
  if (value !== text) throw new Error(`${label} must not have leading or trailing whitespace`);
  if (text.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters`);
  return text;
}

export function assertRecoveryReferenceBudget(planId, taskId) {
  if (planId.length + taskId.length > RECOVERY_REFERENCE_MAX_LENGTH) throw new Error(`planId and taskId must total at most ${RECOVERY_REFERENCE_MAX_LENGTH} characters for exact recovery context`);
}

export function validGoalStatus(value) {
  if (!GOAL_STATUSES.has(value)) throw new Error(`Invalid goal status: ${value}`);
  return value;
}

export function validEvidencePolicy(value) {
  if (!evidencePolicies.has(value)) throw new Error(`Invalid evidence policy: ${value}`);
  return value;
}

export function validTaskStatus(value) {
  if (!TASK_STATUSES.has(value)) throw new Error(`Invalid task status: ${value}`);
  return value;
}

export function validReceiptScope(value) {
  if (value !== "task" && value !== "goal") throw new Error(`Invalid evidence scope: ${value} (allowed: task, goal)`);
  return value;
}

export function validReceiptSource(value) {
  if (value !== "declared" && value !== "tool") throw new Error(`Invalid evidence source: ${value}`);
  return value;
}

export function validReceiptCommand(value) {
  const command = requiredText(value, "evidence command");
  if (/\b(skip(?:ped)?|todo|tbd|n\/?a|not[ -]?run|not[ -]?applicable|placeholder)\b/i.test(command)) throw new Error("evidence command cannot be skipped, placeholder, or incomplete");
  return command;
}

export function validTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("timestamp must be an ISO-8601 date string");
  return value;
}

export function normalizeCriteria(criteria) {
  if (!Array.isArray(criteria)) throw new Error("completionCriteria must be an array");
  return criteria.map((item, index) => requiredText(item, `completionCriteria[${index}]`));
}

export function normalizeToolEvidence({ argv, outputDigest, summary, fingerprint, watchPaths }) {
  const normalizedArgv = normalizeVerificationArgv(argv);
  const normalizedOutputDigest = validSha256(outputDigest, "evidence outputDigest");
  const normalizedSummary = requiredText(summary, "evidence summary");
  const normalizedFingerprint = validSha256(fingerprint, "evidence workspaceFingerprint");
  if (!Array.isArray(watchPaths)) throw new Error("evidence watchPaths must be an array");
  return {
    argv: normalizedArgv,
    outputDigest: normalizedOutputDigest,
    summary: normalizedSummary,
    workspaceFingerprint: normalizedFingerprint,
    watchPaths: watchPaths.map((item, index) => requiredText(item, `evidence watchPaths[${index}]`)),
  };
}

function validSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a sha256 digest`);
  return value;
}

export function optionalText(value, label) {
  return value === undefined || value === null ? null : requiredText(value, label);
}

export function timestamp() {
  return new Date().toISOString();
}
