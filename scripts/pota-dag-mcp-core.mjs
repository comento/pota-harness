// Antigravity Pota DAG MCP App 서버의 순수 프로토콜 라우터 및 상태 코어.
// stdout 오염이나 셸 실행 없이 기존 hooks/dag-*.mjs와 scripts/pota-*.mjs를 재사용한다.

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { VIEWS, buildDagModel, computeWaves, parseGoalStatus, summarize, taskState } from "../hooks/dag-model.mjs";
import { detailSections, formatElapsed, formatSummary, messages, pickLocale, taskDetail } from "../hooks/dag-text.mjs";
import { renderDagSvg } from "../hooks/dag-svg.mjs";
import { rebaseDagState, reduceDagState, rootLabel, samePath } from "../hooks/dag-events.mjs";
import { goalHistoryStats, pauseGoal, readGoalState, resumeGoal, retryTask, setTaskApprovalGate, workspaceFingerprint } from "./pota-goal.mjs";
import { potaHome, resolvePluginRoot, resolveRepoRoot } from "./pota-paths.mjs";
import { readWorkspaceRegistry, workspaceRegistryPath } from "./pota-dag-workspaces.mjs";
import { enrichTasksWithTranscripts } from "./pota-dag-transcript.mjs";
import { isSensitiveRepoPath, readPlanOverview, readRepoGitDiff, readScopedGitDiff } from "./pota-dag-git.mjs";
import { DAG_APP_MIME_TYPE, DAG_APP_RESOURCE_URI, renderDagAppHtml } from "./pota-dag-app-html.mjs";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_SERVER_VERSION = "2.3.0";
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 240;
const MAX_WIDTH = 1600;
const STRUCTURED_CONTENT_LIMIT_BYTES = 921_600;
const TERMINAL_GOAL_STATUSES = new Set(["completed", "cancelled"]);
const GLOB_CHAR_PATTERN = /[*?[\]{}]/;
const OPEN_RESULT_KIND = "pota-dag-open";
const OPEN_TITLE_MAX_CHARS = 200;
const FRESHNESS_TTL_MS = 30_000;
const FRESHNESS_CACHE_MAX_ENTRIES = 64;
const WIDGET_DESCRIPTION = "Interactive Pota goal task DAG panel showing wave layout, task status, details, blockers, and workspace selector.";

export const DAG_RESOURCE_META = Object.freeze({
  ui: {
    prefersBorder: false,
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
  "openai/ui": {
    availableDisplayModes: ["inline", "fullscreen"],
  },
  "openai/widgetPrefersBorder": false,
  "openai/widgetDescription": WIDGET_DESCRIPTION,
  "openai/widgetCSP": {
    connect_domains: [],
    resource_domains: [],
  },
});

export const OPEN_POTA_DAG_TOOL = Object.freeze({
  name: "open_pota_dag",
  title: "Pota DAG",
  description: "Open the interactive Pota goal task DAG panel for the active or specified repository workspace. Returns a short summary (goal, status, task counts, workspace); the panel loads the full DAG itself.",
  inputSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Optional absolute path to a repository workspace." },
      view: { type: "string", enum: [...VIEWS], description: "Optional DAG view filter (defaults to all)." },
      locale: { type: "string", enum: ["ko", "en"], description: "Optional UI locale override (ko or en)." },
    },
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  _meta: {
    ui: {
      resourceUri: DAG_APP_RESOURCE_URI,
      visibility: ["model", "app"],
    },
    "com.google.antigravity/ui": {
      entrypoints: [
        { type: "aux_pane", title: "Pota DAG" },
        { type: "global", title: "Pota DAG" },
      ],
    },
    "openai/outputTemplate": DAG_APP_RESOURCE_URI,
    "openai/resultCanProduceWidget": true,
    "openai/widgetAccessible": true,
    "openai/visibility": "public",
    "openai/ui": {
      availableDisplayModes: ["inline", "fullscreen"],
    },
    "openai/widgetPrefersBorder": false,
    "openai/widgetDescription": WIDGET_DESCRIPTION,
  },
});

export const POTA_DAG_STATE_TOOL = Object.freeze({
  name: "pota_dag_state",
  title: "Pota DAG State",
  description: "Fetch the latest Pota goal DAG snapshot, rendered SVG, and workspace list for the Pota DAG UI.",
  inputSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Optional absolute path to a repository workspace." },
      view: { type: "string", enum: [...VIEWS], description: "Optional DAG view filter (defaults to all)." },
      width: { type: "number", minimum: MIN_WIDTH, maximum: MAX_WIDTH, description: "Target SVG container width in pixels (240..1600)." },
      locale: { type: "string", enum: ["ko", "en"], description: "Optional UI locale override (ko or en)." },
      forceEpoch: { type: "boolean", description: "Force regenerating the SVG animation phase epoch." },
    },
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  _meta: {
    ui: {
      visibility: ["app"],
    },
    "openai/visibility": "private",
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": false,
  },
});

const ALLOWED_HITL_ACTIONS = new Set(["pause", "resume", "toggle_gate", "retry_task"]);
const ALLOWED_ACTION_ARG_KEYS = new Set(["action", "taskId", "enabled", "root", "view", "width", "locale"]);

export const POTA_DAG_ACTION_TOOL = Object.freeze({
  name: "pota_dag_action",
  title: "Pota DAG Action",
  description: "Execute an allowlisted human-in-the-loop control action (pause, resume, toggle_gate, or retry_task) on the active Pota goal of a registered workspace. toggle_gate sets the task's approval gate to the explicit enabled value (true keeps or turns the gate on, false releases it); a toggle_gate call without a boolean enabled is rejected without changing state. retry_task returns the blocked task taskId to pending, clears its dispatch record and receipts, and reactivates a goal that task blocking had blocked (a goal blocked by hand stays blocked); any other task status is rejected. A root that is not a registered workspace or HARNESS_REPO_ROOT is rejected with \"Invalid workspace root\".",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["pause", "resume", "toggle_gate", "retry_task"],
        description: "Allowlisted HITL action (pause, resume, toggle_gate, or retry_task).",
      },
      taskId: {
        type: "string",
        description: "Target task ID (required when action is toggle_gate or retry_task).",
      },
      enabled: {
        type: "boolean",
        description: "Desired approval gate value (required when action is toggle_gate; not accepted for other actions).",
      },
      root: { type: "string", description: "Optional absolute path to a registered repository workspace." },
      view: { type: "string", enum: [...VIEWS], description: "Optional DAG view filter (defaults to all)." },
      width: { type: "number", minimum: MIN_WIDTH, maximum: MAX_WIDTH, description: "Target SVG container width in pixels (240..1600)." },
      locale: { type: "string", enum: ["ko", "en"], description: "Optional UI locale override (ko or en)." },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  _meta: {
    ui: {
      resourceUri: DAG_APP_RESOURCE_URI,
      visibility: ["app"],
    },
    "openai/outputTemplate": DAG_APP_RESOURCE_URI,
    "openai/visibility": "private",
    "openai/widgetAccessible": true,
  },
});

export const DAG_RESOURCE_DESCRIPTOR = Object.freeze({
  uri: DAG_APP_RESOURCE_URI,
  name: "Pota DAG App",
  description: "Self-contained interactive HTML UI for the Pota goal DAG panel.",
  mimeType: DAG_APP_MIME_TYPE,
  _meta: DAG_RESOURCE_META,
});

// 전역 process.env.POTA_HOME 임시 치환 시 동시 호출 간 경합을 막기 위한 직렬화 큐.
let envScopeQueue = Promise.resolve();

async function withScopedPotaHome(env, fn) {
  const targetHome = potaHome(env);
  if (env === process.env || targetHome === potaHome(process.env)) {
    return fn();
  }
  const run = async () => {
    const hadOwn = Object.prototype.hasOwnProperty.call(process.env, "POTA_HOME");
    const previous = process.env.POTA_HOME;
    process.env.POTA_HOME = targetHome;
    try {
      return await fn();
    } finally {
      if (hadOwn) process.env.POTA_HOME = previous;
      else delete process.env.POTA_HOME;
    }
  };
  const next = envScopeQueue.then(run, run);
  envScopeQueue = next.catch(() => {});
  return next;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidRpcId(id) {
  return id === null || typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
}

function isValidDirectory(dirPath) {
  try {
    return lstatSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function pathKey(dirPath) {
  const resolved = resolve(dirPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function minuteOf(ms) {
  return Math.floor(ms / 60_000) * 60_000;
}

function firstLine(text) {
  return String(text ?? "").split(/\r?\n/).find((line) => line.trim().length > 0)?.trim().slice(0, 200) ?? "";
}

function readServerVersion(pluginRoot) {
  try {
    const parsed = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
    return typeof parsed?.version === "string" && parsed.version.length > 0 ? parsed.version : DEFAULT_SERVER_VERSION;
  } catch {
    return DEFAULT_SERVER_VERSION;
  }
}

// 저장소 루트 내부의 안전한 일반 파일만 file:// URI로 변환한다(상대 경로·심볼릭 링크 미허용·경로 탈출 차단).
export function resolveSafeRepoFileUri(root, candidatePath) {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0")) return null;
  if (typeof candidatePath !== "string" || candidatePath.length === 0 || candidatePath.includes("\0")) return null;
  if (GLOB_CHAR_PATTERN.test(candidatePath)) return null;
  if (isAbsolute(candidatePath) || candidatePath.startsWith("/") || candidatePath.startsWith("\\") || /^[A-Za-z]:/.test(candidatePath)) {
    return null;
  }

  let workspaceRoot;
  try {
    const resolvedRoot = resolve(root);
    if (!lstatSync(resolvedRoot).isDirectory()) return null;
    workspaceRoot = realpathSync(resolvedRoot);
  } catch {
    return null;
  }

  const normalizedCandidate = candidatePath.replace(/\\/g, "/");
  const target = resolve(workspaceRoot, normalizedCandidate);
  const rel = relative(workspaceRoot, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;

  const segments = rel.split(sep).filter(Boolean);
  let current = workspaceRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let info;
    try {
      info = lstatSync(current);
    } catch {
      return null;
    }
    if (info.isSymbolicLink()) return null;
    if (index < segments.length - 1 && !info.isDirectory()) return null;
  }

  try {
    if (!lstatSync(target).isFile()) return null;
    const realTarget = realpathSync(target);
    const realRel = relative(workspaceRoot, realTarget);
    if (realRel === "" || realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) return null;
    return pathToFileURL(realTarget).href;
  } catch {
    return null;
  }
}

async function readGoalSafely(targetRoot, { env, readGoal }) {
  try {
    if (typeof readGoal === "function") {
      return { state: await readGoal({ root: targetRoot }), error: null };
    }
    const state = await withScopedPotaHome(env, () => readGoalState({ root: targetRoot }));
    return { state, error: null };
  } catch (error) {
    return { state: null, error: firstLine(error?.message ?? String(error)) || "Failed to read goal state" };
  }
}

async function readRecentSafely(targetRoot, { env, readHistory }) {
  try {
    const stats = typeof readHistory === "function"
      ? await readHistory({ root: targetRoot, limit: 5 })
      : await withScopedPotaHome(env, () => goalHistoryStats({ root: targetRoot, limit: 5 }));
    return Array.isArray(stats?.recent) ? stats.recent : [];
  } catch {
    return [];
  }
}

function isLiveGoalState(state) {
  return Boolean(state && isRecord(state.goal) && !TERMINAL_GOAL_STATUSES.has(state.goal.status));
}

async function collectRegistryWorkspaces(registryEntries, { env, readGoal, prefetched, probeGoals }) {
  const workspaces = [];
  let firstLiveRegistry = null;
  let firstValidRegistry = null;

  for (const entry of registryEntries) {
    if (!isRecord(entry) || typeof entry.root !== "string" || entry.root.length === 0 || entry.root.includes("\0")) continue;
    if (!isAbsolute(entry.root)) continue;
    const candidate = resolve(entry.root);
    if (!isValidDirectory(candidate) || workspaces.some((item) => samePath(item.root, candidate))) continue;

    let hasGoal = false;
    if (probeGoals) {
      const probed = await readGoalSafely(candidate, { env, readGoal });
      prefetched.set(pathKey(candidate), probed);
      hasGoal = isLiveGoalState(probed.state);
    }
    const item = {
      root: candidate,
      label: rootLabel(candidate),
      hasGoal,
      lastSeenAt: typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : null,
    };
    workspaces.push(item);
    if (!firstValidRegistry) firstValidRegistry = item;
    if (hasGoal && !firstLiveRegistry) firstLiveRegistry = item;
  }

  return { workspaces, firstLiveRegistry, firstValidRegistry };
}

async function resolveWorkspaceInternal({
  root = null,
  requestedRoot = null,
  env = process.env,
  now = new Date(),
  readRegistry = readWorkspaceRegistry,
  readGoal,
} = {}) {
  const explicit = requestedRoot ?? root ?? null;
  const nowDate = now instanceof Date ? now : new Date(now);
  const registryPath = workspaceRegistryPath(env);
  const prefetched = new Map();

  let registryEntries = [];
  if (registryPath) {
    try {
      const registry = await readRegistry({ env, now: nowDate });
      if (Array.isArray(registry?.workspaces)) registryEntries = registry.workspaces;
    } catch {
      registryEntries = [];
    }
  }

  const hasExplicit = typeof explicit === "string" && explicit.length > 0;
  const explicitValid = hasExplicit && !explicit.includes("\0") && isAbsolute(explicit) && isValidDirectory(resolve(explicit));
  if (hasExplicit && !explicitValid) {
    const { workspaces } = await collectRegistryWorkspaces(registryEntries, { env, readGoal, prefetched, probeGoals: false });
    return { root: null, source: "explicit", error: "invalid-root", workspaces, prefetched };
  }

  const { workspaces, firstLiveRegistry, firstValidRegistry } = await collectRegistryWorkspaces(registryEntries, {
    env,
    readGoal,
    prefetched,
    probeGoals: true,
  });

  let envCandidate = null;
  const rawEnvRoot = env?.HARNESS_REPO_ROOT;
  if (typeof rawEnvRoot === "string" && rawEnvRoot.length > 0 && !rawEnvRoot.includes("\0") && isAbsolute(rawEnvRoot)) {
    const resolvedEnvRoot = resolveRepoRoot({ explicitRoot: rawEnvRoot, env });
    if (isValidDirectory(resolvedEnvRoot)) {
      envCandidate = resolvedEnvRoot;
      if (!workspaces.some((item) => samePath(item.root, resolvedEnvRoot))) {
        const probed = await readGoalSafely(resolvedEnvRoot, { env, readGoal });
        prefetched.set(pathKey(resolvedEnvRoot), probed);
        workspaces.push({
          root: resolvedEnvRoot,
          label: rootLabel(resolvedEnvRoot),
          hasGoal: isLiveGoalState(probed.state),
          lastSeenAt: null,
        });
      }
    }
  }

  if (hasExplicit) {
    const resolvedExplicit = resolve(explicit);
    // 명시 root를 목록에 넣기 전에 레지스트리·HARNESS_REPO_ROOT 후보와 일치하는지 기록한다(상태 변경 허용 판단용).
    const explicitRegistered = workspaces.some((item) => samePath(item.root, resolvedExplicit));
    if (!explicitRegistered) {
      const probed = await readGoalSafely(resolvedExplicit, { env, readGoal });
      prefetched.set(pathKey(resolvedExplicit), probed);
      workspaces.unshift({
        root: resolvedExplicit,
        label: rootLabel(resolvedExplicit),
        hasGoal: isLiveGoalState(probed.state),
        lastSeenAt: null,
      });
    }
    return { root: resolvedExplicit, source: "explicit", error: null, workspaces, prefetched, explicitRegistered };
  }

  if (firstLiveRegistry) {
    return { root: firstLiveRegistry.root, source: "registry", error: null, workspaces, prefetched };
  }
  if (firstValidRegistry) {
    return { root: firstValidRegistry.root, source: "registry", error: null, workspaces, prefetched };
  }
  if (envCandidate) {
    return { root: envCandidate, source: "env", error: null, workspaces, prefetched };
  }

  return { root: null, source: "none", error: null, workspaces, prefetched };
}

// 명시 root -> 최근 활성 워크스페이스 레지스트리 -> HARNESS_REPO_ROOT -> null 순으로 안전하게 워크스페이스를 선택한다.
export async function resolveWorkspace(options = {}) {
  const resolved = await resolveWorkspaceInternal(options);
  return {
    root: resolved.root,
    source: resolved.source,
    error: resolved.error,
    workspaces: resolved.workspaces,
  };
}

function stripFunctions(value) {
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) return value.map(stripFunctions).filter((item) => item !== undefined);
  if (!isRecord(value)) return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const cleaned = stripFunctions(entry);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function serializeMessages(locale, { moreCount = 0, hiddenAfterCount = 0 } = {}) {
  const words = messages(locale);
  const out = stripFunctions(words) ?? {};
  out.more = moreCount > 0 ? words.more(moreCount) : "";
  out.moreText = out.more;
  out.hiddenAfterText = hiddenAfterCount > 0 ? words.hiddenAfter(hiddenAfterCount) : "";
  return out;
}

function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function clipText(text, maxChars) {
  if (typeof text !== "string") return "";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

// trajectory 1 MiB 한도를 넘지 않도록 structuredContent를 900 KiB(921,600B) 이하로 단계적 축소한다.
function fitStructuredContentCap(payload, limit = STRUCTURED_CONTENT_LIMIT_BYTES) {
  if (byteSize(payload) <= limit) return payload;
  let current = structuredClone(payload);

  // ① gitDiff.files 상한(30개) 적용
  if (current.gitDiff && Array.isArray(current.gitDiff.files) && current.gitDiff.files.length > 30) {
    current.gitDiff = {
      ...current.gitDiff,
      files: current.gitDiff.files.slice(0, 30),
      truncated: true,
    };
  }
  if (byteSize(current) <= limit) return current;

  // ② planOverview.checklist.items 제거(진행률 카운트는 유지)
  if (current.planOverview?.checklist && Array.isArray(current.planOverview.checklist.items) && current.planOverview.checklist.items.length > 0) {
    current.planOverview = {
      ...current.planOverview,
      truncated: true,
      checklist: {
        ...current.planOverview.checklist,
        items: [],
      },
    };
  }
  if (byteSize(current) <= limit) return current;

  // ③ planOverview.goalSummary / currentRequest 제거
  if (current.planOverview && (current.planOverview.goalSummary !== null || current.planOverview.currentRequest !== null)) {
    current.planOverview = {
      ...current.planOverview,
      truncated: true,
      goalSummary: null,
      currentRequest: null,
    };
  }
  if (byteSize(current) <= limit) return current;

  // ④ 태스크별 writeScopeDiff 제거
  if (Array.isArray(current.tasks) && current.tasks.some((task) => task?.writeScopeDiff != null)) {
    current.tasks = current.tasks.map((task) => ({
      ...task,
      writeScopeDiff: null,
    }));
  }
  if (byteSize(current) <= limit) return current;

  // ⑤ receipts[].command 절단
  if (Array.isArray(current.tasks)) {
    let touchedReceipt = false;
    current.tasks = current.tasks.map((task) => {
      if (!Array.isArray(task.receipts) || task.receipts.length === 0) return task;
      return {
        ...task,
        receipts: task.receipts.map((receipt) => {
          if (typeof receipt?.command !== "string" || receipt.command.length <= 80) return receipt;
          touchedReceipt = true;
          return { ...receipt, command: clipText(receipt.command, 80) };
        }),
      };
    });
    if (touchedReceipt && byteSize(current) <= limit) return current;
  }

  // ⑥ 기존 SVG compact 및 sections/tasks 단계적 축소
  if (current.sections) {
    current.sections.running = current.sections.running.map((item) => ({
      ...item,
      title: clipText(item.title, 200),
      detailLines: item.detailLines.slice(0, 8).map((line) => clipText(line, 160)),
      files: item.files.slice(0, 12),
    }));
    current.sections.blocked = current.sections.blocked.map((item) => ({
      ...item,
      title: clipText(item.title, 200),
      reason: clipText(item.reason, 200),
    }));
    current.sections.next = current.sections.next.map((item) => ({
      ...item,
      title: clipText(item.title, 200),
      waits: item.waits.slice(0, 6).map((w) => clipText(w, 120)),
    }));
  }
  if (byteSize(current) <= limit) return current;

  if (current.sections) {
    current.sections.running = current.sections.running.slice(0, 8);
    current.sections.blocked = current.sections.blocked.slice(0, 12);
    current.sections.next = current.sections.next.slice(0, 5);
  }
  current.workspaces = current.workspaces.slice(0, 16);
  if (Array.isArray(current.tasks)) {
    current.tasks = current.tasks.map((task) => ({
      ...task,
      title: clipText(task.title, 200),
      blocker: task.blocker ? clipText(task.blocker, 200) : null,
      files: Array.isArray(task.files) ? task.files.slice(0, 12) : [],
      writeScope: Array.isArray(task.writeScope) ? task.writeScope.slice(0, 12) : task.writeScope,
    }));
  }
  if (byteSize(current) <= limit) return current;

  if (current.sections) {
    current.sections.running = current.sections.running.map((item) => ({
      ...item,
      detailLines: [],
      files: [],
    }));
  }
  if (current.goal) {
    current.goal = {
      ...current.goal,
      title: clipText(current.goal.title, 200),
      blocker: current.goal.blocker ? clipText(current.goal.blocker, 200) : null,
    };
  }
  if (byteSize(current) <= limit) return current;

  current.svg = null;
  if (byteSize(current) <= limit) return current;

  current.sections = { running: [], blocked: [], next: [], more: 0 };
  current.workspaces = current.workspaces.slice(0, 4);
  if (current.gitDiff) current.gitDiff = { ...current.gitDiff, files: [], truncated: true };
  current.planOverview = null;
  if (Array.isArray(current.tasks)) {
    current.tasks = current.tasks.map((task) => ({
      ...task,
      receipts: [],
      files: [],
      writeScope: null,
      transcript: null,
    }));
  }
  if (typeof current.error === "string") current.error = clipText(current.error, 500);
  if (byteSize(current) <= limit) return current;

  current.tasks = [];
  if (byteSize(current) <= limit) return current;

  current.workspaces = [];
  current.goal = null;
  current.summary = null;
  current.agentStats = null;
  return current;
}

// open_pota_dag의 모델 노출 structuredContent: 무엇이 열렸는지 확인할 요약과 위젯이 수화할 root만 담는다.
function buildOpenSummary({ root, view, locale, snapshot, ended, error }) {
  let goal = null;
  let summary = null;
  if (snapshot) {
    const raw = summarize(snapshot);
    goal = { id: snapshot.goalId, title: clipText(snapshot.title, OPEN_TITLE_MAX_CHARS), status: snapshot.status };
    summary = {
      total: raw.total,
      done: raw.done,
      running: raw.running,
      blocked: raw.blocked,
      ready: raw.ready,
      waveCurrent: raw.waveCurrent,
      waveTotal: raw.waveTotal,
    };
  }
  return {
    schemaVersion: 1,
    kind: OPEN_RESULT_KIND,
    root,
    rootLabel: root ? rootLabel(root) : null,
    view,
    locale,
    goal,
    ended: ended ? { status: ended.status } : null,
    summary,
    error: typeof error === "string" && error.length > 0 ? clipText(error, OPEN_TITLE_MAX_CHARS) : null,
  };
}

function resultText(words, nextState, goal, summaryText, activeRoot) {
  if (nextState.error !== null) return `${words.refreshFailed}${nextState.error}`;
  if (goal === null) return `${words.noGoal} (${rootLabel(activeRoot)})`;
  const stateLabel = nextState.ended !== null
    ? (words.ended[nextState.ended.status] ?? words.ended.unknown)
    : (words.goalStatus[goal.status] ?? goal.status);
  return `${goal.title} [${stateLabel}] — ${summaryText}`;
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function normalizeLocale(requestedLocale, env) {
  return pickLocale([
    requestedLocale,
    env?.LC_ALL,
    env?.LC_MESSAGES,
    env?.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ]);
}

function normalizeView(requestedView) {
  return VIEWS.includes(requestedView) ? requestedView : "all";
}

function normalizeWidth(requestedWidth) {
  if (requestedWidth === undefined || requestedWidth === null) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(requestedWidth)));
}

function validateToolArguments(toolName, args) {
  if (args === undefined || args === null) return { ok: true, value: {} };
  if (!isRecord(args)) return { ok: false, message: "Invalid params: arguments must be an object" };
  if (args.root !== undefined && args.root !== null && typeof args.root !== "string") {
    return { ok: false, message: "Invalid params: root must be a string" };
  }
  if (args.view !== undefined && args.view !== null && typeof args.view !== "string") {
    return { ok: false, message: "Invalid params: view must be a string" };
  }
  if (args.locale !== undefined && args.locale !== null && typeof args.locale !== "string") {
    return { ok: false, message: "Invalid params: locale must be a string" };
  }
  if (toolName === "pota_dag_state" || toolName === "pota_dag_action") {
    if (args.width !== undefined && args.width !== null && (typeof args.width !== "number" || !Number.isFinite(args.width))) {
      return { ok: false, message: "Invalid params: width must be a finite number" };
    }
  }
  if (toolName === "pota_dag_state") {
    if (args.forceEpoch !== undefined && args.forceEpoch !== null && typeof args.forceEpoch !== "boolean") {
      return { ok: false, message: "Invalid params: forceEpoch must be a boolean" };
    }
  }
  return { ok: true, value: args };
}

function emptyDiffFallback(reason = "git-error") {
  return {
    available: false,
    reason,
    files: [],
    totals: { files: 0, added: 0, deleted: 0 },
    truncated: false,
  };
}

function emptyTranscriptResult() {
  return {
    enrichedByTaskId: {},
    agentStats: {
      enrichedAgents: 0,
      totalTurns: 0,
      totalInputTokens: 0,
      totalCacheReadTokens: 0,
      totalOutputTokens: 0,
    },
  };
}

// Git diff 요약 파일에 안전한 file:// URI만 부착하고 민감 경로는 uri: null로 차단한다.
function sanitizeDiffWithUris(diffSummary, activeRoot) {
  if (!isRecord(diffSummary)) return emptyDiffFallback("git-error");
  const rawFiles = Array.isArray(diffSummary.files) ? diffSummary.files : [];
  const files = rawFiles.map((file) => {
    const path = typeof file?.path === "string" ? file.path : "";
    const sensitive = Boolean(file?.sensitive) || isSensitiveRepoPath(path);
    return {
      path,
      status: typeof file?.status === "string" && file.status.length > 0 ? file.status : "M",
      added: typeof file?.added === "number" && Number.isFinite(file.added) ? file.added : 0,
      deleted: typeof file?.deleted === "number" && Number.isFinite(file.deleted) ? file.deleted : 0,
      binary: Boolean(file?.binary),
      sensitive,
      uri: sensitive ? null : resolveSafeRepoFileUri(activeRoot, path),
    };
  });
  const totals = isRecord(diffSummary.totals)
    ? {
        files: Number.isFinite(diffSummary.totals.files) ? diffSummary.totals.files : files.length,
        added: Number.isFinite(diffSummary.totals.added) ? diffSummary.totals.added : 0,
        deleted: Number.isFinite(diffSummary.totals.deleted) ? diffSummary.totals.deleted : 0,
      }
    : { files: files.length, added: 0, deleted: 0 };
  return {
    ...diffSummary,
    available: diffSummary.available === true,
    files,
    totals,
    truncated: Boolean(diffSummary.truncated),
  };
}

function formatTaskElapsed(task, timeline, minute, locale) {
  if (!(minute > 0)) return "";
  const times = timeline?.[task.id] ?? {};
  if (task.status === "active") {
    const since = times.activeAt ?? (task.updatedAt > 0 ? task.updatedAt : undefined);
    return since !== undefined ? formatElapsed(minute - since, locale) : "";
  }
  if (task.status === "completed" && times.activeAt !== undefined && times.completedAt !== undefined) {
    return formatElapsed(times.completedAt - times.activeAt, locale);
  }
  return "";
}

function buildTaskReceipts(task, rawReceipts, checkReceiptFresh) {
  const snapshotReceipts = Array.isArray(task.receipts) ? task.receipts : [];
  if (snapshotReceipts.length === 0) return [];
  const rawTaskReceipts = Array.isArray(rawReceipts)
    ? rawReceipts.filter(
        (r) => isRecord(r) && typeof r.kind === "string" && r.kind.length > 0 && r.taskId === task.id && r.scope !== "goal",
      )
    : [];
  return snapshotReceipts.map((receipt, idx) => {
    const raw = rawTaskReceipts[idx];
    const matchedRaw = raw && raw.kind === receipt.kind ? raw : null;
    let fresh = typeof receipt.fresh === "boolean" ? receipt.fresh : null;
    if (matchedRaw && matchedRaw.source === "tool" && typeof matchedRaw.workspaceFingerprint === "string") {
      // 감시 경로 없는 영수증은 저장소 전체 해시가 필요하므로 폴링 경로에서는 계산하지 않고 unknown(null)으로 둔다.
      const watchPaths = Array.isArray(matchedRaw.watchPaths) ? matchedRaw.watchPaths : [];
      fresh = watchPaths.length > 0 ? checkReceiptFresh(matchedRaw, watchPaths) : null;
    }
    return {
      kind: receipt.kind,
      source: typeof matchedRaw?.source === "string" ? matchedRaw.source : null,
      command: receipt.command ?? null,
      exitCode: receipt.exitCode ?? null,
      verifiedAt: receipt.verifiedAt ?? null,
      fresh,
      outputDigest: receipt.outputDigest ?? null,
      watchFingerprint: receipt.watchFingerprint ?? null,
    };
  });
}

function buildAgentStats(tasks, waves, waveOf, transcriptStats) {
  const modelCounts = {};
  for (const task of tasks) {
    const modelName = task.resolvedModel ?? task.effectiveModel ?? task.model ?? null;
    if (typeof modelName === "string" && modelName.length > 0) {
      modelCounts[modelName] = (modelCounts[modelName] ?? 0) + 1;
    }
  }

  // 완료되지 않은 wave 중 막힘이 있는 wave(없으면 가장 이른 미완료 wave)를 병목으로 계산한다.
  const waveSummaries = waves.map((_, index) => {
    const members = tasks.filter((item) => waveOf[item.id] === index);
    const completed = members.filter((item) => item.status === "completed").length;
    const active = members.filter((item) => item.status === "active").length;
    const blocked = members.filter((item) => item.status === "blocked").length;
    return {
      wave: index,
      waveNumber: index + 1,
      total: members.length,
      completed,
      active,
      blocked,
      remaining: members.length - completed,
    };
  });
  const incompleteWaves = waveSummaries.filter((w) => w.remaining > 0);
  const waveBottleneck = incompleteWaves.find((w) => w.blocked > 0) ?? incompleteWaves[0] ?? null;

  return {
    totalTasks: tasks.length,
    doneTasks: tasks.filter((item) => item.status === "completed").length,
    modelCounts,
    waveBottleneck,
    enrichedAgents: typeof transcriptStats?.enrichedAgents === "number" ? transcriptStats.enrichedAgents : 0,
    totalTurns: typeof transcriptStats?.totalTurns === "number" ? transcriptStats.totalTurns : 0,
    totalInputTokens: typeof transcriptStats?.totalInputTokens === "number" ? transcriptStats.totalInputTokens : 0,
    totalCacheReadTokens: typeof transcriptStats?.totalCacheReadTokens === "number" ? transcriptStats.totalCacheReadTokens : 0,
    totalOutputTokens: typeof transcriptStats?.totalOutputTokens === "number" ? transcriptStats.totalOutputTokens : 0,
  };
}

export function createDagMcpServer({
  env = process.env,
  now = () => Date.now(),
  pluginRoot = resolvePluginRoot(import.meta.url),
  readGoalState: readGoalOverride,
  goalHistoryStats: goalHistoryOverride,
  readWorkspaceRegistry: readRegistryOverride = readWorkspaceRegistry,
  renderHtml = renderDagAppHtml,
  brainDir,
  gitDiffReader = readRepoGitDiff,
  planOverviewReader = readPlanOverview,
  transcriptEnricher = enrichTasksWithTranscripts,
  workspaceFingerprint: fingerprintWorkspace = workspaceFingerprint,
} = {}) {
  const statesByRoot = new Map();
  const svgMemoByRoot = new Map();
  // 감시 경로 영수증의 지문을 root·state revision·watchPaths 키와 짧은 TTL로 캐시해 같은 폴링이 다시 해시하지 않게 한다.
  const freshnessCache = new Map();

  function cachedWorkspaceFingerprint(activeRoot, revision, watchPaths, nowMsValue) {
    const cacheKey = `${pathKey(activeRoot)}\0${revision}\0${JSON.stringify(watchPaths)}`;
    const cached = freshnessCache.get(cacheKey);
    if (cached && nowMsValue - cached.at >= 0 && nowMsValue - cached.at < FRESHNESS_TTL_MS) return cached.value;
    let value;
    try {
      value = fingerprintWorkspace(activeRoot, watchPaths);
    } catch {
      value = null;
    }
    freshnessCache.delete(cacheKey);
    if (freshnessCache.size >= FRESHNESS_CACHE_MAX_ENTRIES) {
      const oldestKey = freshnessCache.keys().next().value;
      if (oldestKey !== undefined) freshnessCache.delete(oldestKey);
    }
    freshnessCache.set(cacheKey, { at: nowMsValue, value });
    return value;
  }

  const currentMs = () => {
    const value = typeof now === "function" ? now() : now;
    return value instanceof Date ? value.getTime() : Number(value);
  };

  async function runDagTool(toolName, args) {
    const nowMsValue = currentMs();
    const nowDate = new Date(nowMsValue);
    const locale = normalizeLocale(args.locale, env);
    const view = normalizeView(args.view);
    const width = toolName === "pota_dag_state" ? normalizeWidth(args.width) : DEFAULT_WIDTH;
    const forceEpoch = toolName === "pota_dag_state" && args.forceEpoch === true;
    const words = messages(locale);

    const resolved = await resolveWorkspaceInternal({
      requestedRoot: args.root ?? null,
      env,
      now: nowDate,
      readRegistry: readRegistryOverride,
      readGoal: readGoalOverride,
    });

    const isOpen = toolName === OPEN_POTA_DAG_TOOL.name;

    if (resolved.error === "invalid-root") {
      if (isOpen) {
        return {
          content: [{ type: "text", text: `${words.refreshFailed}invalid-root` }],
          structuredContent: buildOpenSummary({ root: null, view, locale, snapshot: null, ended: null, error: "invalid-root" }),
        };
      }
      const structured = fitStructuredContentCap({
        schemaVersion: 1,
        seq: 0,
        fetchedAt: nowMsValue,
        minute: minuteOf(nowMsValue),
        epoch: nowMsValue,
        locale,
        view,
        width,
        root: null,
        rootLabel: null,
        workspaces: resolved.workspaces,
        goal: null,
        ended: null,
        summary: null,
        svg: null,
        empty: null,
        hiddenAfter: 0,
        sections: { running: [], blocked: [], next: [], more: 0 },
        tasks: [],
        gitDiff: null,
        planOverview: null,
        agentStats: null,
        error: "invalid-root",
        messages: serializeMessages(locale),
      });
      return {
        content: [{ type: "text", text: `${words.refreshFailed}invalid-root` }],
        structuredContent: structured,
      };
    }

    if (resolved.root === null) {
      if (isOpen) {
        return {
          content: [{ type: "text", text: words.noGoal }],
          structuredContent: buildOpenSummary({ root: null, view, locale, snapshot: null, ended: null, error: null }),
        };
      }
      const structured = fitStructuredContentCap({
        schemaVersion: 1,
        seq: 0,
        fetchedAt: nowMsValue,
        minute: minuteOf(nowMsValue),
        epoch: nowMsValue,
        locale,
        view,
        width,
        root: null,
        rootLabel: null,
        workspaces: resolved.workspaces,
        goal: null,
        ended: null,
        summary: null,
        svg: null,
        empty: null,
        hiddenAfter: 0,
        sections: { running: [], blocked: [], next: [], more: 0 },
        tasks: [],
        gitDiff: null,
        planOverview: null,
        agentStats: null,
        error: null,
        messages: serializeMessages(locale),
      });
      return {
        content: [{ type: "text", text: words.noGoal }],
        structuredContent: structured,
      };
    }

    const activeRoot = resolved.root;
    const activeRootKey = pathKey(activeRoot);
    const probed = resolved.prefetched.get(activeRootKey) ?? (await readGoalSafely(activeRoot, { env, readGoal: readGoalOverride }));

    const fetched = probed.error !== null
      ? { snapshot: null, error: probed.error }
      : probed.state == null
        ? { snapshot: null, error: null }
        : parseGoalStatus(JSON.stringify(probed.state));

    const prevState = statesByRoot.get(activeRootKey) ?? null;
    const baseState = rebaseDagState(prevState, { root: activeRoot, home: activeRoot });
    const needsEnding = fetched.snapshot === null && fetched.error === null && baseState.snapshot !== null && baseState.ended === null;
    const recent = needsEnding ? await readRecentSafely(activeRoot, { env, readHistory: goalHistoryOverride }) : undefined;
    const nextState = reduceDagState(baseState, { ...fetched, now: nowMsValue, recent });
    statesByRoot.set(activeRootKey, nextState);

    const snapshot = nextState.snapshot;
    const prevMemo = svgMemoByRoot.get(activeRootKey) ?? null;
    let minute = minuteOf(nowMsValue);
    if (nextState.ended !== null) {
      minute = nextState.ended.endedAt !== null
        ? minuteOf(nextState.ended.endedAt)
        : (prevMemo?.minute ?? minuteOf(nowMsValue));
    }

    // open_pota_dag 결과는 모델에 보이므로 요약만 돌려주고, SVG·task·diff·Plan 등 무거운 UI 상태는
    // 위젯이 앱 전용 pota_dag_state로 직접 수화한다(Codex/ChatGPT·Antigravity 공통).
    if (isOpen) {
      if (snapshot === null) svgMemoByRoot.delete(activeRootKey);
      const openGoal = snapshot !== null ? { title: snapshot.title, status: snapshot.status } : null;
      const summaryText = snapshot !== null
        ? formatSummary(summarize(snapshot), { locale, minute, timeline: nextState.timeline, snapshot })
        : "";
      return {
        content: [{ type: "text", text: resultText(words, nextState, openGoal, summaryText, activeRoot) }],
        structuredContent: buildOpenSummary({
          root: activeRoot,
          view,
          locale,
          snapshot,
          ended: nextState.ended,
          error: nextState.error,
        }),
      };
    }

    let epoch = nowMsValue;
    let svg = null;
    let summary = null;
    let empty = null;
    let hiddenAfter = 0;
    let sections = { running: [], blocked: [], next: [], more: 0 };
    let goalInfo = null;
    let tasks = [];
    let gitDiff = null;
    let planOverview = null;
    let agentStats = null;

    if (snapshot !== null) {
      const ctx = { locale, minute, timeline: nextState.timeline, snapshot };
      const model = buildDagModel(snapshot, view);
      empty = model.empty;
      hiddenAfter = model.hiddenAfter;

      const memoKey = `${nextState.seq}|${view}|${width}|${minute}|${locale}`;
      if (!forceEpoch && prevMemo && prevMemo.key === memoKey) {
        epoch = prevMemo.epoch;
        svg = prevMemo.svg;
      } else {
        epoch = nowMsValue;
        const rendered = renderDagSvg(model, { width, epoch, ctx });
        svg = {
          source: rendered.source,
          alt: rendered.alt,
          density: rendered.density,
          omitted: rendered.omitted,
        };
        svgMemoByRoot.set(activeRootKey, { key: memoKey, epoch, minute, svg });
      }

      const rawSummary = summarize(snapshot);
      summary = {
        ...rawSummary,
        text: formatSummary(rawSummary, ctx),
      };

      const [transcriptRes, rawRepoDiff, rawPlanOverview] = await Promise.all([
        Promise.resolve()
          .then(() => transcriptEnricher(snapshot.tasks, { brainDir, env }))
          .catch(() => emptyTranscriptResult()),
        Promise.resolve()
          .then(() => gitDiffReader(activeRoot))
          .catch(() => emptyDiffFallback("git-error")),
        Promise.resolve()
          .then(() => (snapshot.planId ? planOverviewReader(activeRoot, snapshot.planId) : null))
          .catch(() => null),
      ]);

      const enrichedByTaskId = isRecord(transcriptRes?.enrichedByTaskId) ? transcriptRes.enrichedByTaskId : {};
      const transcriptStats = isRecord(transcriptRes?.agentStats) ? transcriptRes.agentStats : emptyTranscriptResult().agentStats;
      gitDiff = sanitizeDiffWithUris(rawRepoDiff, activeRoot);
      planOverview = rawPlanOverview && isRecord(rawPlanOverview) ? rawPlanOverview : null;

      const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
      const rawTaskById = new Map(
        Array.isArray(probed.state?.tasks) ? probed.state.tasks.map((task) => [task.id, task]) : [],
      );
      const rawReceipts = Array.isArray(probed.state?.receipts) ? probed.state.receipts : [];
      const { waveOf, waves } = computeWaves(snapshot.tasks);

      const revision = Number.isSafeInteger(probed.state?.revision) ? probed.state.revision : "none";
      const checkReceiptFresh = (rawReceipt, watchPaths) => {
        const currentFp = cachedWorkspaceFingerprint(activeRoot, revision, watchPaths, nowMsValue);
        return currentFp === null ? null : currentFp === rawReceipt.workspaceFingerprint;
      };

      const enrichedTaskMap = new Map();
      const scopedDiffs = await Promise.all(
        snapshot.tasks.map((task) => (
          Array.isArray(task.writeScope) && task.writeScope.length > 0
            ? readScopedGitDiff(activeRoot, task.writeScope, { repoDiff: gitDiff })
              .then((scoped) => sanitizeDiffWithUris(scoped, activeRoot))
              .catch(() => ({ available: false, files: [], totals: { files: 0, added: 0, deleted: 0 } }))
            : Promise.resolve({ available: gitDiff.available, files: [], totals: { files: 0, added: 0, deleted: 0 } })
        )),
      );

      tasks = snapshot.tasks.map((task, idx) => {
        const tr = isRecord(enrichedByTaskId[task.id]) ? enrichedByTaskId[task.id] : null;
        const resolvedModel = tr?.resolvedModel ?? task.resolvedModel ?? null;
        const resolvedEffort = tr?.resolvedEffort ?? task.resolvedEffort ?? null;
        const resolvedTier = tr?.resolvedTier ?? task.resolvedTier ?? null;
        const transcript = tr
          ? {
              turns: tr.turns,
              tokens: { ...tr.tokens },
              updatedAt: tr.updatedAt ?? null,
            }
          : (task.transcript ?? null);
        const rawTask = rawTaskById.get(task.id);
        const files = Array.isArray(task.writeScope)
          ? task.writeScope.map((candidate) => {
              const sensitive = isSensitiveRepoPath(candidate);
              return {
                path: candidate,
                uri: sensitive ? null : resolveSafeRepoFileUri(activeRoot, candidate),
                sensitive,
              };
            })
          : [];
        const enrichedForDetail = {
          ...task,
          ...(resolvedModel !== null ? { resolvedModel } : {}),
          ...(resolvedEffort !== null ? { resolvedEffort } : {}),
          ...(resolvedTier !== null ? { resolvedTier } : {}),
          ...(transcript !== null ? { transcript } : {}),
        };
        enrichedTaskMap.set(task.id, enrichedForDetail);

        return {
          id: task.id,
          title: task.title,
          status: task.status,
          state: taskState(task, taskById),
          wave: waveOf[task.id] ?? 0,
          dependsOn: task.dependsOn,
          assignedAgentId: task.assignedAgentId,
          route: task.route,
          kind: task.kind,
          model: task.model,
          effectiveModel: task.effectiveModel,
          effort: task.effort,
          effortSource: typeof rawTask?.effortSource === "string" ? rawTask.effortSource : null,
          approvalGate: Boolean(task.approvalGate),
          blocker: task.blocker,
          writeScope: task.writeScope,
          elapsed: formatTaskElapsed(task, nextState.timeline, minute, locale),
          resolvedModel,
          resolvedEffort,
          resolvedTier,
          transcript,
          receipts: buildTaskReceipts(task, rawReceipts, checkReceiptFresh),
          files,
          writeScopeDiff: scopedDiffs[idx],
        };
      });

      agentStats = buildAgentStats(tasks, waves, waveOf, transcriptStats);

      const rawSections = detailSections(snapshot, {}, [], ctx);
      sections = {
        running: rawSections.running.map((item) => {
          const task = taskById.get(item.id);
          const enrichedTask = enrichedTaskMap.get(item.id) ?? task;
          const files = [];
          if (Array.isArray(task?.writeScope)) {
            for (const candidate of task.writeScope) {
              const sensitive = isSensitiveRepoPath(candidate);
              if (sensitive) {
                files.push({ path: candidate, uri: null, sensitive: true });
              } else {
                const uri = resolveSafeRepoFileUri(activeRoot, candidate);
                if (uri) files.push({ path: candidate, uri, sensitive: false });
              }
            }
          }
          return {
            ...item,
            detailLines: enrichedTask ? taskDetail(enrichedTask, locale) : [],
            files,
          };
        }),
        blocked: rawSections.blocked,
        next: rawSections.next,
        more: rawSections.more,
        strays: rawSections.strays,
      };

      const planSensitive = isSensitiveRepoPath(snapshot.planId);
      goalInfo = {
        id: snapshot.goalId,
        title: snapshot.title,
        planId: snapshot.planId,
        planFileUri: planSensitive ? null : resolveSafeRepoFileUri(activeRoot, snapshot.planId),
        status: snapshot.status,
        blocker: snapshot.blocker,
        createdAt: snapshot.createdAt,
        requiredEvidence: snapshot.requiredEvidence,
        evidence: snapshot.evidence,
      };
    } else {
      svgMemoByRoot.delete(activeRootKey);
    }

    const structured = fitStructuredContentCap({
      schemaVersion: 1,
      seq: nextState.seq,
      fetchedAt: nextState.fetchedAt,
      minute,
      epoch,
      locale,
      view,
      width,
      root: activeRoot,
      rootLabel: rootLabel(activeRoot),
      workspaces: resolved.workspaces,
      goal: goalInfo,
      ended: nextState.ended,
      summary,
      svg,
      empty,
      hiddenAfter,
      sections,
      tasks,
      gitDiff,
      planOverview,
      agentStats,
      error: nextState.error,
      messages: serializeMessages(locale, {
        moreCount: sections.more,
        hiddenAfterCount: hiddenAfter,
      }),
    });

    return {
      content: [{ type: "text", text: resultText(words, nextState, goalInfo, summary?.text ?? "", activeRoot) }],
      structuredContent: structured,
    };
  }

  async function runDagAction(args) {
    for (const key of Object.keys(args)) {
      if (!ALLOWED_ACTION_ARG_KEYS.has(key)) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid params: unexpected property ${key}` }],
        };
      }
    }
    const action = args.action;
    if (typeof action !== "string" || !ALLOWED_HITL_ACTIONS.has(action)) {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid action: expected pause, resume, toggle_gate, or retry_task" }],
      };
    }
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
    if ((action === "toggle_gate" || action === "retry_task") && taskId.length === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid params: taskId is required when action is toggle_gate or retry_task" }],
      };
    }
    // 맹목 반전은 폴링 사이에 바뀐 게이트를 풀어 실행을 승인할 수 있으므로 원하는 값을 명시해야 한다.
    if (action === "toggle_gate" && typeof args.enabled !== "boolean") {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid params: enabled (boolean) is required when action is toggle_gate" }],
      };
    }
    if (action !== "toggle_gate" && args.enabled !== undefined) {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid params: enabled is only accepted when action is toggle_gate" }],
      };
    }

    const resolved = await resolveWorkspaceInternal({
      requestedRoot: args.root ?? null,
      env,
      now: new Date(currentMs()),
      readRegistry: readRegistryOverride,
      readGoal: readGoalOverride,
    });
    // 상태 변경은 레지스트리·HARNESS_REPO_ROOT로 이미 알려진 워크스페이스에만 허용한다(명시 root만으로는 불가).
    const unregisteredExplicit = resolved.source === "explicit" && resolved.explicitRegistered !== true;
    if (resolved.error === "invalid-root" || unregisteredExplicit || resolved.root === null) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: resolved.error === "invalid-root" || unregisteredExplicit ? "Invalid workspace root" : "No active repository workspace resolved",
        }],
      };
    }

    const activeRoot = resolved.root;
    try {
      await withScopedPotaHome(env, async () => {
        if (action === "pause") {
          await pauseGoal(activeRoot);
        } else if (action === "resume") {
          await resumeGoal(activeRoot);
        } else if (action === "retry_task") {
          await retryTask(activeRoot, { taskId });
        } else {
          await setTaskApprovalGate(activeRoot, { taskId, enabled: args.enabled });
        }
      });
    } catch (err) {
      const msgText = err instanceof Error && err.message ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: msgText }],
      };
    }

    return runDagTool("pota_dag_state", {
      root: activeRoot,
      view: args.view,
      width: args.width,
      locale: args.locale,
    });
  }

  async function handleMessage(message) {
    if (!isRecord(message)) {
      return jsonRpcError(null, -32600, "Invalid Request");
    }
    const hasId = Object.hasOwn(message, "id") && message.id !== undefined;
    if (hasId && !isValidRpcId(message.id)) {
      return jsonRpcError(null, -32600, "Invalid Request");
    }
    const id = hasId ? message.id : null;

    if ((message.jsonrpc !== undefined && message.jsonrpc !== "2.0") || typeof message.method !== "string" || message.method.length === 0) {
      return hasId ? jsonRpcError(id, -32600, "Invalid Request") : jsonRpcError(null, -32600, "Invalid Request");
    }

    if (message.method === "notifications/initialized" || (!hasId && message.method.startsWith("notifications/"))) {
      return null;
    }
    if (!hasId) {
      return null;
    }

    switch (message.method) {
      case "initialize": {
        if (message.params !== undefined && !isRecord(message.params)) {
          return jsonRpcError(id, -32602, "Invalid params");
        }
        const requestedVersion = message.params?.protocolVersion;
        const protocolVersion = typeof requestedVersion === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
          ? requestedVersion
          : DEFAULT_PROTOCOL_VERSION;
        return jsonRpcResult(id, {
          protocolVersion,
          capabilities: {
            tools: {},
            resources: {},
          },
          serverInfo: {
            name: "pota-dag",
            version: readServerVersion(pluginRoot),
          },
        });
      }

      case "ping":
        return jsonRpcResult(id, {});

      case "tools/list":
        return jsonRpcResult(id, {
          tools: [OPEN_POTA_DAG_TOOL, POTA_DAG_STATE_TOOL, POTA_DAG_ACTION_TOOL],
        });

      case "resources/list":
        return jsonRpcResult(id, {
          resources: [DAG_RESOURCE_DESCRIPTOR],
        });

      case "resources/templates/list":
        return jsonRpcResult(id, {
          resourceTemplates: [],
        });

      case "resources/read": {
        if (!isRecord(message.params) || typeof message.params.uri !== "string" || message.params.uri.length === 0) {
          return jsonRpcError(id, -32602, "Invalid params: uri is required");
        }
        if (message.params.uri !== DAG_APP_RESOURCE_URI) {
          return jsonRpcError(id, -32002, `Resource not found: ${message.params.uri}`);
        }
        const version = readServerVersion(pluginRoot);
        const text = renderHtml({ title: "Pota DAG", version });
        return jsonRpcResult(id, {
          contents: [
            {
              uri: DAG_APP_RESOURCE_URI,
              mimeType: DAG_APP_MIME_TYPE,
              text,
              _meta: DAG_RESOURCE_META,
            },
          ],
        });
      }

      case "tools/call": {
        if (!isRecord(message.params) || typeof message.params.name !== "string") {
          return jsonRpcError(id, -32602, "Invalid params: tool name is required");
        }
        const toolName = message.params.name;
        if (
          toolName !== OPEN_POTA_DAG_TOOL.name
          && toolName !== POTA_DAG_STATE_TOOL.name
          && toolName !== POTA_DAG_ACTION_TOOL.name
        ) {
          return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
        }
        const validated = validateToolArguments(toolName, message.params.arguments);
        if (!validated.ok) {
          return jsonRpcError(id, -32602, validated.message);
        }
        const result = toolName === POTA_DAG_ACTION_TOOL.name
          ? await runDagAction(validated.value)
          : await runDagTool(toolName, validated.value);
        return jsonRpcResult(id, result);
      }

      default:
        return jsonRpcError(id, -32601, `Method not found: ${message.method}`);
    }
  }

  return {
    handleMessage,
  };
}
