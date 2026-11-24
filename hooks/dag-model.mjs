// Pure view model of a Pota goal: snapshot parsing, waves, reduced edges and the four views.
// Runs in the Claude Code hooks environment and under Node 18: no host APIs, no clock.
// TypeScript reads this module's types from dag-model.d.mts.

/**
 * @typedef {"pending" | "active" | "blocked" | "completed"} TaskStatus
 * @typedef {"completed" | "active" | "blocked" | "ready" | "waiting"} TaskState
 * @typedef {"previous" | "current" | "next" | "all"} ViewId
 * @typedef {{
 *   kind: string, command: string | null, exitCode: number | null, verifiedAt: string | null,
 *   fresh: boolean | null, outputDigest: string | null, watchFingerprint: string | null
 * }} DagTaskReceipt
 * @typedef {{
 *   turns: number,
 *   tokens: { input: number, cacheRead: number, output: number, cacheHitRate: number | null, truncated: boolean },
 *   updatedAt: string | null
 * }} DagTaskTranscript
 * @typedef {{
 *   id: string, title: string, status: TaskStatus, dependsOn: string[], assignedAgentId: string | null,
 *   route: "light" | "heavy" | null, kind: "design" | null, effort: string | null, model: string | null,
 *   effectiveModel: string | null, requiredEvidence: string[], evidence: string[], writeScope: string[] | null,
 *   blocker: string | null, createdAt: number, updatedAt: number,
 *   approvalGate?: boolean, receipts?: DagTaskReceipt[],
 *   resolvedModel?: string, resolvedEffort?: string, resolvedTier?: string, transcript?: DagTaskTranscript
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
 * @typedef {{ path: string, status: string, added: number, deleted: number, binary: boolean, sensitive: boolean }} GitDiffFile
 * @typedef {{ available: boolean, files: GitDiffFile[], totals: { files: number, added: number, deleted: number }, truncated?: boolean }} GitDiffSummary
 * @typedef {{
 *   planId: string | null, truncated: boolean, title: string | null, goalSummary: string | null,
 *   currentRequest: string | null, checklist: { done: number, pending: number, total: number, items: { done: boolean, text: string }[] }
 * }} PlanOverview
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

/** @param {unknown} value @returns {string | null} */
function toIsoOrNull(value) {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return null;
}

/** @param {Record<string, unknown>} receipt @returns {DagTaskReceipt} */
function normalizeReceipt(receipt) {
  return {
    kind: /** @type {string} */ (receipt.kind),
    command: textOrNull(receipt.command),
    exitCode: typeof receipt.exitCode === "number" && Number.isFinite(receipt.exitCode) ? receipt.exitCode : null,
    verifiedAt: toIsoOrNull(receipt.verifiedAt) ?? toIsoOrNull(receipt.timestamp),
    fresh: typeof receipt.fresh === "boolean" ? receipt.fresh : null,
    outputDigest: textOrNull(receipt.outputDigest),
    watchFingerprint: textOrNull(receipt.watchFingerprint) ?? textOrNull(receipt.workspaceFingerprint),
  };
}

/** @param {unknown} value @returns {DagTaskTranscript | null} */
function normalizeTranscript(value) {
  if (!isRecord(value)) return null;
  const rawTokens = isRecord(value.tokens) ? value.tokens : {};
  const countOrZero = (num) => (typeof num === "number" && Number.isFinite(num) && num >= 0 ? num : 0);
  return {
    turns: countOrZero(value.turns),
    tokens: {
      input: countOrZero(rawTokens.input),
      cacheRead: countOrZero(rawTokens.cacheRead),
      output: countOrZero(rawTokens.output),
      cacheHitRate: typeof rawTokens.cacheHitRate === "number" && Number.isFinite(rawTokens.cacheHitRate) ? rawTokens.cacheHitRate : null,
      truncated: rawTokens.truncated === true,
    },
    updatedAt: toIsoOrNull(value.updatedAt),
  };
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
  const receiptsOf = (item) => {
    const fromRoot = receipts.filter(
      (receipt) => typeof receipt.kind === "string" && receipt.kind.length > 0 && receipt.taskId === item.id && receipt.scope !== "goal",
    );
    const source = fromRoot.length > 0
      ? fromRoot
      : Array.isArray(item.receipts)
        ? item.receipts.filter(
          (receipt) => isRecord(receipt) && typeof receipt.kind === "string" && receipt.kind.length > 0 && receipt.scope !== "goal"
            && (receipt.taskId === undefined || receipt.taskId === item.id),
        )
        : [];
    return source.map(normalizeReceipt);
  };

  const seen = new Set();
  const raw = parsed.tasks.filter((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0 || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  /** @type {DagTask[]} */
  const tasks = raw.map((item) => {
    const taskReceipts = receiptsOf(item);
    const resolvedModel = textOrNull(item.resolvedModel);
    const resolvedEffort = textOrNull(item.resolvedEffort);
    const resolvedTier = textOrNull(item.resolvedTier);
    const transcript = normalizeTranscript(item.transcript);
    return {
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
      ...(item.approvalGate === true ? { approvalGate: true } : {}),
      ...(taskReceipts.length > 0 ? { receipts: taskReceipts } : {}),
      ...(resolvedModel !== null ? { resolvedModel } : {}),
      ...(resolvedEffort !== null ? { resolvedEffort } : {}),
      ...(resolvedTier !== null ? { resolvedTier } : {}),
      ...(transcript !== null ? { transcript } : {}),
    };
  });
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

const SENSITIVE_EXACT = new Set([".env", ".npmrc", ".pypirc", ".netrc"]);
const SENSITIVE_EXTS = [".pem", ".key", ".p12", ".pfx", ".jks"];

/**
 * 민감 파일/경로 패턴(.env*, service-account*.json, 키/인증서, credentials/secret/token JSON, 패키지 rc) 여부를 판정한다.
 * @param {string} relPath
 * @returns {boolean}
 */
export function isSensitiveRepoPath(relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) return false;
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  for (const raw of segments) {
    const seg = raw.toLowerCase();
    if (SENSITIVE_EXACT.has(seg) || seg.startsWith(".env")) return true;
    if (/^service-account.*\.json$/.test(seg)) return true;
    if (SENSITIVE_EXTS.some((ext) => seg.endsWith(ext))) return true;
    if (seg.includes("id_rsa") || seg.includes("id_ed25519")) return true;
    if (seg.includes("credentials") || seg.includes("secret")) return true;
    if (seg.includes("token") && seg.endsWith(".json")) return true;
  }
  return false;
}

/**
 * 저장소 상대 경로를 정규화하고 위험/탈출/글롭 경로는 null로 거부한다.
 * @param {string} relPath
 * @returns {string | null}
 */
export function normalizeRepoPath(relPath) {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.includes("\0")) return null;
  const slashed = relPath.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed) || slashed.startsWith("-")) return null;
  if (/[*?[\]]/.test(slashed)) return null;
  const segments = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  const normalized = segments.join("/");
  if (normalized.startsWith("-")) return null;
  return normalized;
}

/**
 * NUL 구분 `git diff --numstat -z` 출력을 경로별 added/deleted/binary 맵에 누적한다.
 * @param {string} nulText
 * @param {Map<string, { added: number, deleted: number, binary: boolean }>} statsByPath
 */
function accumulateNumstat(nulText, statsByPath) {
  const tokens = String(nulText ?? "").split("\0");
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const firstTab = token.indexOf("\t");
    const secondTab = firstTab >= 0 ? token.indexOf("\t", firstTab + 1) : -1;
    if (firstTab < 0 || secondTab < 0) continue;
    const addedStr = token.slice(0, firstTab);
    const deletedStr = token.slice(firstTab + 1, secondTab);
    let rawPath = token.slice(secondTab + 1);
    // `-z` rename/copy 형식: `<added>\t<deleted>\t\0<oldPath>\0<newPath>\0`
    if (rawPath === "") {
      const newPath = tokens[i + 2];
      i += 2;
      if (typeof newPath !== "string" || newPath.length === 0) continue;
      rawPath = newPath;
    }
    const path = normalizeRepoPath(rawPath);
    if (path === null) continue;
    const binary = addedStr === "-" || deletedStr === "-";
    const parsedAdded = binary ? 0 : Number.parseInt(addedStr, 10);
    const parsedDeleted = binary ? 0 : Number.parseInt(deletedStr, 10);
    const added = Number.isFinite(parsedAdded) && parsedAdded >= 0 ? parsedAdded : 0;
    const deleted = Number.isFinite(parsedDeleted) && parsedDeleted >= 0 ? parsedDeleted : 0;
    const prev = statsByPath.get(path);
    if (prev) {
      prev.added += added;
      prev.deleted += deleted;
      prev.binary = prev.binary || binary;
    } else {
      statsByPath.set(path, { added, deleted, binary });
    }
  }
}

/**
 * NUL 구분 `git status --porcelain=v1 -z` 및 unstaged/staged `--numstat -z` 결과를 병합한다.
 * @param {string} statusNulText
 * @param {string} unstagedNumstatNulText
 * @param {string} stagedNumstatNulText
 * @returns {GitDiffSummary & { available: true, truncated: false }}
 */
export function parseGitStatusAndNumstat(statusNulText, unstagedNumstatNulText, stagedNumstatNulText) {
  /** @type {Map<string, { added: number, deleted: number, binary: boolean }>} */
  const statsByPath = new Map();
  accumulateNumstat(unstagedNumstatNulText, statsByPath);
  accumulateNumstat(stagedNumstatNulText, statsByPath);

  /** @type {Map<string, GitDiffFile>} */
  const byPath = new Map();
  const tokens = String(statusNulText ?? "").split("\0");
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (!entry || entry.length < 4 || entry[2] !== " ") continue;
    const xy = entry.slice(0, 2);
    const rawPath = entry.slice(3);
    // rename/copy 항목은 뒤이어 원본 경로 NUL 토큰이 하나 더 따라온다.
    if (xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C") {
      i += 1;
    }
    const path = normalizeRepoPath(rawPath);
    if (path === null || byPath.has(path)) continue;
    const stat = statsByPath.get(path);
    byPath.set(path, {
      path,
      status: xy.trim() || "M",
      added: stat?.added ?? 0,
      deleted: stat?.deleted ?? 0,
      binary: stat?.binary ?? false,
      sensitive: isSensitiveRepoPath(path),
    });
  }

  for (const [path, stat] of statsByPath) {
    if (byPath.has(path)) continue;
    byPath.set(path, {
      path,
      status: "M",
      added: stat.added,
      deleted: stat.deleted,
      binary: stat.binary,
      sensitive: isSensitiveRepoPath(path),
    });
  }

  const files = [...byPath.values()];
  let added = 0;
  let deleted = 0;
  for (const file of files) {
    added += file.added;
    deleted += file.deleted;
  }
  return {
    available: true,
    files,
    totals: { files: files.length, added, deleted },
    truncated: false,
  };
}

/**
 * Git diff 요약을 검증된 `scopePaths`(파일 정확 일치 또는 디렉터리 접두사 일치)로 거른다.
 * @param {GitDiffSummary | null | undefined} diffSummary
 * @param {readonly string[] | null | undefined} scopePaths
 * @returns {{ available: boolean, files: GitDiffFile[], totals: { files: number, added: number, deleted: number } }}
 */
export function filterDiffByScope(diffSummary, scopePaths) {
  const available = diffSummary?.available === true;
  const scopes = Array.isArray(scopePaths)
    ? scopePaths.map(normalizeRepoPath).filter((item) => item !== null)
    : [];
  const sourceFiles = Array.isArray(diffSummary?.files) ? diffSummary.files : [];
  const files = scopes.length === 0
    ? []
    : sourceFiles.filter((file) => {
      const normalized = normalizeRepoPath(file?.path);
      if (normalized === null) return false;
      return scopes.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
    });
  let added = 0;
  let deleted = 0;
  for (const file of files) {
    added += typeof file.added === "number" && Number.isFinite(file.added) ? file.added : 0;
    deleted += typeof file.deleted === "number" && Number.isFinite(file.deleted) ? file.deleted : 0;
  }
  return {
    available,
    files,
    totals: { files: files.length, added, deleted },
  };
}

const PLAN_CHECKLIST_LIMIT = 40;

/**
 * Plan 마크다운에서 제목, Goal 요약, 최신 요청(Current request), 체크리스트(최대 40개)를 추출한다.
 * @param {string} text
 * @param {{ planId?: string | null, truncated?: boolean }} [options]
 * @returns {PlanOverview}
 */
export function parsePlanOverview(text, { planId = null, truncated = false } = {}) {
  const lines = String(text ?? "").split(/\r?\n/);
  /** @type {string | null} */
  let title = null;
  /** @type {string | null} */
  let goalSummary = null;
  /** @type {string | null} */
  let currentRequest = null;
  /** @type {{ done: boolean, text: string }[]} */
  const items = [];
  let done = 0;
  let pending = 0;

  let inFence = false;
  let inGoal = false;
  let goalDone = false;
  /** @type {string[]} */
  const goalParagraph = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      if (inGoal && goalParagraph.length > 0) goalDone = true;
      continue;
    }
    if (inFence) continue;

    if (title === null) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) {
        const heading = h1[1].trim();
        if (heading.length > 0) title = heading;
      }
    }

    if (inGoal && !goalDone) {
      if (/^#{1,6}\s/.test(line)) {
        goalDone = true;
      } else if (trimmed.length === 0) {
        if (goalParagraph.length > 0) goalDone = true;
      } else if (/^(?:[-*]|\d+\.)\s/.test(trimmed)) {
        goalDone = true;
      } else {
        goalParagraph.push(trimmed);
      }
    } else if (!inGoal && !goalDone && /^##\s+Goal\s*$/i.test(trimmed)) {
      inGoal = true;
    }

    const reqMatch = line.match(/^\s*-\s+Current request(?:\s*\([^)]*\))?:\s*(.+)$/i);
    if (reqMatch) {
      const reqText = reqMatch[1].trim();
      if (reqText.length > 0) currentRequest = reqText;
    }

    const checkMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (checkMatch) {
      const itemText = checkMatch[2].trim();
      if (itemText.length > 0) {
        const isDone = checkMatch[1].toLowerCase() === "x";
        if (isDone) done += 1;
        else pending += 1;
        if (items.length < PLAN_CHECKLIST_LIMIT) {
          items.push({ done: isDone, text: itemText });
        }
      }
    }
  }

  if (goalParagraph.length > 0) {
    goalSummary = goalParagraph.join(" ");
  }

  return {
    planId: textOrNull(planId),
    truncated: truncated === true,
    title,
    goalSummary,
    currentRequest,
    checklist: {
      done,
      pending,
      total: done + pending,
      items,
    },
  };
}
