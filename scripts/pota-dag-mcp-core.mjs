// Antigravity Pota DAG MCP App 서버의 순수 프로토콜 라우터 및 상태 코어.
// stdout 오염이나 셸 실행 없이 기존 hooks/dag-*.mjs와 scripts/pota-*.mjs를 재사용한다.

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { VIEWS, buildDagModel, parseGoalStatus, summarize } from "../hooks/dag-model.mjs";
import { detailSections, formatSummary, messages, pickLocale, taskDetail } from "../hooks/dag-text.mjs";
import { renderDagSvg } from "../hooks/dag-svg.mjs";
import { rebaseDagState, reduceDagState, rootLabel, samePath } from "../hooks/dag-events.mjs";
import { goalHistoryStats, readGoalState } from "./pota-goal.mjs";
import { potaHome, resolvePluginRoot, resolveRepoRoot } from "./pota-paths.mjs";
import { readWorkspaceRegistry, workspaceRegistryPath } from "./pota-state-antigravity.mjs";
import { DAG_APP_MIME_TYPE, DAG_APP_RESOURCE_URI, renderDagAppHtml } from "./pota-dag-app-html.mjs";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_SERVER_VERSION = "2.2.1";
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 240;
const MAX_WIDTH = 1600;
const STRUCTURED_CONTENT_LIMIT_BYTES = 921_600;
const TERMINAL_GOAL_STATUSES = new Set(["completed", "cancelled"]);
const GLOB_CHAR_PATTERN = /[*?[\]{}]/;

export const OPEN_POTA_DAG_TOOL = Object.freeze({
  name: "open_pota_dag",
  title: "Pota DAG",
  description: "Open the interactive Pota goal task DAG panel for the active or specified repository workspace.",
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
  },
});

export const DAG_RESOURCE_DESCRIPTOR = Object.freeze({
  uri: DAG_APP_RESOURCE_URI,
  name: "Pota DAG App",
  description: "Self-contained interactive HTML UI for the Pota goal DAG panel.",
  mimeType: DAG_APP_MIME_TYPE,
  _meta: {
    ui: {
      prefersBorder: false,
    },
  },
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
    if (!workspaces.some((item) => samePath(item.root, resolvedExplicit))) {
      const probed = await readGoalSafely(resolvedExplicit, { env, readGoal });
      prefetched.set(pathKey(resolvedExplicit), probed);
      workspaces.unshift({
        root: resolvedExplicit,
        label: rootLabel(resolvedExplicit),
        hasGoal: isLiveGoalState(probed.state),
        lastSeenAt: null,
      });
    }
    return { root: resolvedExplicit, source: "explicit", error: null, workspaces, prefetched };
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
  if (typeof current.error === "string") current.error = clipText(current.error, 500);
  if (byteSize(current) <= limit) return current;

  current.workspaces = [];
  current.goal = null;
  current.summary = null;
  return current;
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
  if (toolName === "pota_dag_state") {
    if (args.width !== undefined && args.width !== null && (typeof args.width !== "number" || !Number.isFinite(args.width))) {
      return { ok: false, message: "Invalid params: width must be a finite number" };
    }
    if (args.forceEpoch !== undefined && args.forceEpoch !== null && typeof args.forceEpoch !== "boolean") {
      return { ok: false, message: "Invalid params: forceEpoch must be a boolean" };
    }
  }
  return { ok: true, value: args };
}

export function createDagMcpServer({
  env = process.env,
  now = () => Date.now(),
  pluginRoot = resolvePluginRoot(import.meta.url),
  readGoalState: readGoalOverride,
  goalHistoryStats: goalHistoryOverride,
  readWorkspaceRegistry: readRegistryOverride = readWorkspaceRegistry,
  renderHtml = renderDagAppHtml,
} = {}) {
  const statesByRoot = new Map();
  const svgMemoByRoot = new Map();

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

    if (resolved.error === "invalid-root") {
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
        error: "invalid-root",
        messages: serializeMessages(locale),
      });
      return {
        content: [{ type: "text", text: `${words.refreshFailed}invalid-root` }],
        structuredContent: structured,
      };
    }

    if (resolved.root === null) {
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

    let epoch = nowMsValue;
    let svg = null;
    let summary = null;
    let empty = null;
    let hiddenAfter = 0;
    let sections = { running: [], blocked: [], next: [], more: 0 };
    let goalInfo = null;

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

      const rawSections = detailSections(snapshot, {}, [], ctx);
      const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
      sections = {
        running: rawSections.running.map((item) => {
          const task = taskById.get(item.id);
          const files = [];
          if (Array.isArray(task?.writeScope)) {
            for (const candidate of task.writeScope) {
              const uri = resolveSafeRepoFileUri(activeRoot, candidate);
              if (uri) files.push({ path: candidate, uri });
            }
          }
          return {
            ...item,
            detailLines: task ? taskDetail(task, locale) : [],
            files,
          };
        }),
        blocked: rawSections.blocked,
        next: rawSections.next,
        more: rawSections.more,
        strays: rawSections.strays,
      };

      goalInfo = {
        id: snapshot.goalId,
        title: snapshot.title,
        planId: snapshot.planId,
        planFileUri: resolveSafeRepoFileUri(activeRoot, snapshot.planId),
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
      error: nextState.error,
      messages: serializeMessages(locale, {
        moreCount: sections.more,
        hiddenAfterCount: hiddenAfter,
      }),
    });

    let text;
    if (nextState.error !== null) {
      text = `${words.refreshFailed}${nextState.error}`;
    } else if (goalInfo === null) {
      text = `${words.noGoal} (${rootLabel(activeRoot)})`;
    } else {
      const stateLabel = nextState.ended !== null
        ? (words.ended[nextState.ended.status] ?? words.ended.unknown)
        : (words.goalStatus[goalInfo.status] ?? goalInfo.status);
      text = `${goalInfo.title} [${stateLabel}] — ${summary.text}`;
    }

    return {
      content: [{ type: "text", text }],
      structuredContent: structured,
    };
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
          tools: [OPEN_POTA_DAG_TOOL, POTA_DAG_STATE_TOOL],
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
              _meta: {
                ui: {
                  prefersBorder: false,
                },
              },
            },
          ],
        });
      }

      case "tools/call": {
        if (!isRecord(message.params) || typeof message.params.name !== "string") {
          return jsonRpcError(id, -32602, "Invalid params: tool name is required");
        }
        const toolName = message.params.name;
        if (toolName !== OPEN_POTA_DAG_TOOL.name && toolName !== POTA_DAG_STATE_TOOL.name) {
          return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
        }
        const validated = validateToolArguments(toolName, message.params.arguments);
        if (!validated.ok) {
          return jsonRpcError(id, -32602, validated.message);
        }
        const result = await runDagTool(toolName, validated.value);
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
