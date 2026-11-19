// Pure view model of a Pota goal: snapshot parsing, waves, reduced edges and the four views.
// Runs in the Claude Code hooks environment and under Node 18: no host APIs, no clock.
// TypeScript reads this module's types from dag-model.d.mts.

/**
 * @typedef {"pending" | "active" | "blocked" | "completed"} TaskStatus
 * @typedef {"completed" | "active" | "blocked" | "ready" | "waiting"} TaskState
 * @typedef {"previous" | "current" | "next" | "all"} ViewId
 * @typedef {{
 *   id: string, title: string, status: TaskStatus, dependsOn: string[], assignedAgentId: string | null,
 *   route: "light" | "heavy" | null, kind: "design" | null, effort: string | null, model: string | null,
 *   effectiveModel: string | null, requiredEvidence: string[], evidence: string[], writeScope: string[] | null,
 *   blocker: string | null, createdAt: number, updatedAt: number
 * }} DagTask
 * @typedef {{
 *   goalId: string, title: string, planId: string,
 *   status: "active" | "paused" | "blocked" | "cancelled" | "completed", blocker: string | null,
 *   revision: number, createdAt: number, requiredEvidence: string[], evidence: string[], tasks: DagTask[]
 * }} DagSnapshot
 * @typedef {{ id: string, wave: number, role: "focus" | "context", state: TaskState, task: DagTask }} DagNode
 * @typedef {{ from: string, to: string, state: "done" | "flow" | "wait" | "blocked" }} DagEdge
 * @typedef {{ index: number, total: number, completed: number, active: number, blocked: number }} DagWave
 * @typedef {{
 *   view: ViewId, nodes: DagNode[], edges: DagEdge[], waves: DagWave[],
 *   empty: null | "no-completed" | "no-next", hiddenAfter: number
 * }} DagModel
 * @typedef {{
 *   waveCurrent: number, waveTotal: number, done: number, total: number, running: number,
 *   blocked: number, ready: number, models: string[], allDone: boolean
 * }} DagSummary
 */

export const VIEWS = /** @type {const} */ (["previous", "current", "next", "all"]);

const TASK_STATUSES = new Set(["pending", "active", "blocked", "completed"]);
const GOAL_STATUSES = new Set(["active", "paused", "blocked", "cancelled", "completed"]);

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const textOr = (value, fallback) => (typeof value === "string" ? value : fallback);
const textOrNull = (value) => (typeof value === "string" && value.length > 0 ? value : null);
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
const unique = (list) => [...new Set(list)];

/** @param {unknown} value @returns {number} epoch milliseconds, 0 when unknown */
function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Parses `pota goal status` output (schema v3 state, or `null`).
 * @param {string} stdout
 * @returns {{ snapshot: DagSnapshot | null, error: string | null }}
 */
export function parseGoalStatus(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ""));
  } catch {
    return { snapshot: null, error: "goal status did not print JSON" };
  }
  if (parsed === null) return { snapshot: null, error: null };
  if (!isRecord(parsed) || !isRecord(parsed.goal) || typeof parsed.goal.id !== "string" || !Array.isArray(parsed.tasks)) {
    return { snapshot: null, error: "goal status printed no goal" };
  }
  const goal = parsed.goal;
  const receipts = Array.isArray(parsed.receipts) ? parsed.receipts.filter(isRecord) : [];
  const evidenceOf = (taskId) => unique(receipts
    .filter((receipt) => typeof receipt.kind === "string" && (taskId === null
      ? receipt.scope === "goal" || (receipt.scope === undefined && typeof receipt.taskId !== "string")
      : receipt.taskId === taskId && receipt.scope !== "goal"))
    .map((receipt) => receipt.kind));

  const seen = new Set();
  const raw = parsed.tasks.filter((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0 || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  /** @type {DagTask[]} */
  const tasks = raw.map((item) => ({
    id: item.id,
    title: textOr(item.title, item.id),
    status: TASK_STATUSES.has(item.status) ? item.status : "pending",
    dependsOn: unique(strings(item.dependsOn).filter((dep) => dep !== item.id && seen.has(dep))),
    assignedAgentId: textOrNull(item.assignedAgentId),
    route: item.route === "light" || item.route === "heavy" ? item.route : null,
    kind: item.kind === "design" ? "design" : null,
    effort: textOrNull(item.effort),
    model: textOrNull(item.model),
    effectiveModel: textOrNull(item.effectiveModel),
    requiredEvidence: unique(strings(item.requiredEvidence)),
    evidence: evidenceOf(item.id),
    writeScope: Array.isArray(item.writeScope) ? strings(item.writeScope) : null,
    blocker: textOrNull(item.blocker),
    createdAt: toMs(item.createdAt),
    updatedAt: toMs(item.updatedAt),
  }));
  return {
    snapshot: {
      goalId: goal.id,
      title: textOr(goal.title, goal.id),
      planId: textOr(goal.planId, ""),
      status: GOAL_STATUSES.has(goal.status) ? goal.status : "active",
      blocker: textOrNull(goal.blocker),
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
      createdAt: toMs(goal.createdAt),
      requiredEvidence: unique(strings(goal.requiredEvidence)),
      evidence: evidenceOf(null),
      tasks,
    },
    error: null,
  };
}

/**
 * Wave of a task: 0 without dependencies, else one past its deepest dependency.
 * An edge back into a task still being visited (a cycle) or to an unknown id is ignored.
 * @param {{ id: string, dependsOn: string[] }[]} tasks
 * @returns {{ waveOf: Record<string, number>, waves: string[][] }}
 */
export function computeWaves(tasks) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  /** @type {Record<string, number>} */
  const waveOf = {};
  const visiting = new Set();
  const visit = (id) => {
    if (waveOf[id] !== undefined) return waveOf[id];
    visiting.add(id);
    let wave = 0;
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep) || visiting.has(dep)) continue;
      wave = Math.max(wave, visit(dep) + 1);
    }
    visiting.delete(id);
    waveOf[id] = wave;
    return wave;
  };
  for (const item of tasks) visit(item.id);
  /** @type {string[][]} */
  const waves = [];
  for (const item of tasks) {
    const wave = waveOf[item.id];
    while (waves.length <= wave) waves.push([]);
    if (!waves[wave].includes(item.id)) waves[wave].push(item.id);
  }
  return { waveOf, waves };
}

/**
 * Dependency edges after transitive reduction: `u -> v` is dropped when another path reaches `v` from `u`.
 * Edges that do not go forward in waves (cycles) are dropped too.
 * @param {{ id: string, dependsOn: string[] }[]} tasks
 * @returns {{ from: string, to: string }[]}
 */
export function reduceEdges(tasks) {
  const { waveOf } = computeWaves(tasks);
  /** @type {Map<string, string[]>} */
  const parents = new Map();
  for (const item of tasks) {
    if (parents.has(item.id)) continue;
    parents.set(item.id, unique(item.dependsOn).filter((dep) => waveOf[dep] !== undefined && waveOf[dep] < waveOf[item.id]));
  }
  /** @type {Map<string, Set<string>>} */
  const ancestors = new Map();
  const ancestorsOf = (id) => {
    const known = ancestors.get(id);
    if (known) return known;
    const found = new Set();
    for (const dep of parents.get(id) ?? []) {
      found.add(dep);
      for (const higher of ancestorsOf(dep)) found.add(higher);
    }
    ancestors.set(id, found);
    return found;
  };
  const edges = [];
  for (const [id, deps] of parents) {
    for (const dep of deps) {
      const implied = deps.some((other) => other !== dep && ancestorsOf(other).has(dep));
      if (!implied) edges.push({ from: dep, to: id });
    }
  }
  return edges;
}

/**
 * @param {DagTask} task
 * @param {Map<string, DagTask>} byId
 * @returns {TaskState}
 */
export function taskState(task, byId) {
  if (task.status === "completed" || task.status === "active" || task.status === "blocked") return task.status;
  const depsDone = task.dependsOn.every((dep) => !byId.has(dep) || byId.get(dep).status === "completed");
  return depsDone ? "ready" : "waiting";
}

const depsDone = (task, byId) => task.dependsOn.every((dep) => !byId.has(dep) || byId.get(dep).status === "completed");

/**
 * The focus set F: running and blocked-but-unblocked tasks, else ready tasks, else the last wave.
 * @param {DagSnapshot} snapshot
 * @returns {string[]}
 */
export function focusIds(snapshot) {
  const tasks = snapshot.tasks;
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const working = tasks.filter((item) => item.status === "active" || (item.status === "blocked" && depsDone(item, byId)));
  if (working.length > 0) return working.map((item) => item.id);
  const ready = tasks.filter((item) => taskState(item, byId) === "ready");
  if (ready.length > 0) return ready.map((item) => item.id);
  const { waves } = computeWaves(tasks);
  return waves.length > 0 ? [...waves[waves.length - 1]] : [];
}

const EDGE_STATE = { completed: "done", active: "flow", blocked: "blocked" };

/**
 * @param {DagSnapshot} snapshot
 * @param {ViewId} requested
 * @returns {DagModel}
 */
export function buildDagModel(snapshot, requested) {
  const view = VIEWS.includes(requested) ? requested : "all";
  const tasks = snapshot.tasks;
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const { waveOf } = computeWaves(tasks);
  const reduced = reduceEdges(tasks);
  const focus = new Set(focusIds(snapshot));
  const incomplete = tasks.filter((item) => item.status !== "completed");
  /** @type {Map<string, "focus" | "context">} */
  const roles = new Map();
  /** @type {DagModel["empty"]} */
  let empty = null;
  let hiddenAfter = 0;

  if (view === "previous") {
    for (const item of tasks) if (item.status === "completed") roles.set(item.id, "focus");
    if (roles.size === 0) empty = "no-completed";
  } else if (view === "next") {
    const after = incomplete.filter((item) => !focus.has(item.id)
      && item.dependsOn.every((dep) => focus.has(dep) || byId.get(dep)?.status === "completed"));
    const afterIds = new Set(after.map((item) => item.id));
    for (const item of after) roles.set(item.id, "focus");
    for (const edge of reduced) if (afterIds.has(edge.to) && focus.has(edge.from)) roles.set(edge.from, "context");
    if (after.length === 0) {
      empty = "no-next";
      roles.clear();
    }
    hiddenAfter = incomplete.filter((item) => !focus.has(item.id) && !afterIds.has(item.id)).length;
  } else if (view === "current") {
    for (const id of focus) roles.set(id, "focus");
    for (const edge of reduced) if (focus.has(edge.to) && !focus.has(edge.from)) roles.set(edge.from, "context");
  } else {
    for (const item of tasks) roles.set(item.id, "focus");
  }

  /** @type {DagNode[]} */
  const nodes = tasks.filter((item) => roles.has(item.id)).map((item) => ({
    id: item.id,
    wave: waveOf[item.id],
    role: roles.get(item.id),
    state: taskState(item, byId),
    task: item,
  }));
  /** @type {DagEdge[]} */
  const edges = reduced
    .filter((edge) => roles.has(edge.from) && roles.has(edge.to))
    .map((edge) => ({ ...edge, state: EDGE_STATE[byId.get(edge.to).status] ?? "wait" }));
  const visible = unique(nodes.map((node) => node.wave)).sort((a, b) => a - b);
  const waves = visible.map((index) => {
    const members = tasks.filter((item) => waveOf[item.id] === index);
    return {
      index,
      total: members.length,
      completed: members.filter((item) => item.status === "completed").length,
      active: members.filter((item) => item.status === "active").length,
      blocked: members.filter((item) => item.status === "blocked").length,
    };
  });
  return { view, nodes, edges, waves, empty, hiddenAfter };
}

/**
 * @param {DagSnapshot} snapshot
 * @returns {DagSummary}
 */
export function summarize(snapshot) {
  const tasks = snapshot.tasks;
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const { waveOf, waves } = computeWaves(tasks);
  const open = tasks.filter((item) => item.status !== "completed").map((item) => waveOf[item.id]);
  const done = tasks.length - open.length;
  return {
    waveCurrent: open.length > 0 ? Math.min(...open) + 1 : waves.length,
    waveTotal: waves.length,
    done,
    total: tasks.length,
    running: tasks.filter((item) => item.status === "active").length,
    blocked: tasks.filter((item) => item.status === "blocked").length,
    ready: tasks.filter((item) => taskState(item, byId) === "ready").length,
    models: unique(tasks.map((item) => item.model).filter((model) => typeof model === "string")),
    allDone: tasks.length > 0 && done === tasks.length,
  };
}

/**
 * The plan's identity: the goal and its task graph. A replan that changes the graph changes it.
 * @param {DagSnapshot} snapshot
 */
export function planKey(snapshot) {
  return `${snapshot.goalId}|${snapshot.tasks.map((item) => `${item.id}<${item.dependsOn.join(",")}`).join(";")}`;
}
