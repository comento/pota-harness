// Pota goal DAG pane: wiring only. The view model, layout, wording, SVG and event policy live in the
// pure dag-*.mjs modules beside this file.

import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { DagAgent, DagContext, DagState, DagTask, DagUi, GitDiffSummary, PlanOverview } from "../types";
import {
  VIEWS,
  buildDagModel,
  computeWaves,
  filterDiffByScope,
  isSensitiveRepoPath,
  normalizeRepoPath,
  parseGitStatusAndNumstat,
  parseGoalStatus,
  parsePlanOverview,
  planKey,
  summarize,
  taskState,
} from "./dag-model.mjs";
import { panelWidth } from "./dag-layout.mjs";
import { detailSections, formatElapsed, formatSummary, messages, pickLocale, runningTaskRows, taskDetail } from "./dag-text.mjs";
import { renderDagSvg } from "./dag-svg.mjs";
import { termGraph } from "./dag-term.mjs";
import {
  MAIN_AGENT_ID,
  ancestorPaths,
  describeToolCall,
  extractTaskMentions,
  goalCommandTarget,
  isAbsolutePath,
  joinPath,
  nextRefreshDelay,
  observeGoalCommand,
  parsePotaGoalCommand,
  pickRoot,
  rebaseDagState,
  reduceAgents,
  reduceDagState,
  resolveAgentTasks,
  rootLabel,
  samePath,
  shouldAutoOpen,
  shouldCheckHome,
} from "./dag-events.mjs";
import type { Observation } from "./dag-events.mjs";

type Engine = EngineInterface;
type View = DagUi["view"];
type Tab = DagUi["tab"];
type Locale = "ko" | "en";
type Reason = "goal" | "command" | "turn" | "poll" | "open";
type Timer = { cancel: () => void };
type Tone = "plain" | "dim" | "ok" | "run" | "ready" | "bad";
type PendingAgentEvent =
  | { type: "spawn"; id: string; name: string | null; description: string; model: string | null; parentId: string | null; text: string }
  | { type: "call"; id: string; activity: string }
  | { type: "done"; id: string };

const PANE = "pota-dag";
const TITLE = "Pota DAG";
// A request the surface may ignore: about 450px, room for two cards side by side. A width the person dragged wins.
const PANE_COLUMNS = 56;
const POLL_MS = 30_000;
const FLUSH_MS = 1_000;
const GIT_TIMEOUT_MS = 3_000;
const MAX_PLAN_BYTES = 65_536;
const PLAN_HEAD_BYTES = 40_960;
const PLAN_TAIL_BYTES = 24_576;
const DIFF_LIST_LIMIT = 60;
const RUNTIME_MISSING = "runtime-missing";
const ENDED_AGENT = new Set(["completed", "failed", "killed"]);
const TABS = ["dag", "diff", "plan", "stats"] as const;
const VIEW_ALIASES: Record<string, View> = {
  previous: "previous", current: "current", next: "next", all: "all",
  이전: "previous", 현재: "current", 다음: "next", 전체: "all",
};
const TAB_ALIASES: Record<string, Tab> = {
  dag: "dag", diff: "diff", plan: "plan", stats: "stats",
  통계: "stats",
};

// Change a tag when that value's fields change: it declines what an earlier version stored.
const dag = atom({ plugin: "pota", key: "dag" } as const, {
  seq: 0, snapshot: null, ended: null, error: null, fetchedAt: 0, root: null, home: null, timeline: {},
}, { shape: "dag-2" });
const dagUi = atom({ plugin: "pota", key: "dagUi" } as const, {
  view: "all",
  tab: "dag",
  epoch: 0,
  minute: 0,
  autoOpenedPlanKey: null,
  closedGoalId: null,
  expandedTaskId: null,
  selectedTaskId: null,
  actionError: null,
}, { shape: "ui-3" });
const dagAgents = atom({ plugin: "pota", key: "dagAgents" } as const, [], { shape: "agents-1" });
const dagContext = atom({ plugin: "pota", key: "dagContext" } as const, {
  diff: null, planOverview: null, gitCheckedAt: 0,
}, { shape: "ctx-1" });

// Scheduling state: a reload drops it with the old environment's timers, which is what it describes.
let cli: string | null = null;
let locale: Locale | null = null;
let refreshTimer: Timer | null = null;
let refreshDueAt = 0;
let refreshing = false;
let dirty: Reason | null = null;
let lastRunAt = 0;
let failures = 0;
let pending: Observation | null = null;
// Goal commands are observed after their answer is handed on, one after another so `pending` folds in order.
let observing: Promise<void> = Promise.resolve();
let pollTimer: Timer | null = null;
let flushTimer: Timer | null = null;
let pendingAgentEvents: PendingAgentEvent[] = [];
let svgMemo: { key: string; value: ReturnType<typeof renderDagSvg> } | null = null;

const minuteOf = (ms: number): number => Math.floor(ms / 60_000) * 60_000;
const firstLine = (text: string): string => (text.split(/\r?\n/).find(line => line.trim().length > 0) ?? "").trim().slice(0, 200);
const clipCommand = (text: string, max = 80): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const ignore = (): undefined => undefined;

async function localeOf($: Engine): Promise<Locale> {
  if (locale !== null) return locale;
  const values = [await $.env.get("LC_ALL"), await $.env.get("LC_MESSAGES"), await $.env.get("LANG")];
  if (!values.some(value => value !== undefined && value.length > 0)) {
    // A macOS app started from the Dock has no LANG, so the system locale answers there.
    try {
      const ran = await $.process.run(["defaults", "read", "-g", "AppleLocale"], { timeoutMs: 3_000 });
      if (ran.exitCode === 0) values.push(ran.stdout.trim());
    } catch {
      // Not macOS, or the command was refused: fall through to Intl.
    }
    if (typeof Intl !== "undefined") values.push(Intl.DateTimeFormat().resolvedOptions().locale);
  }
  locale = pickLocale(values);
  return locale;
}

/** The CLI of this plugin copy: the plugin root is the Pota runtime. */
async function findCli($: Engine): Promise<string | null> {
  if (cli !== null) return cli;
  const path = `${$.plugin.root}/scripts/pota.mjs`;
  try {
    if (await $.fs.exists(path)) cli = path;
  } catch {
    // Treated as not found.
  }
  return cli;
}

async function exists($: Engine, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path);
  } catch {
    return false;
  }
}

/** The root the CLI would resolve for a directory: the same order as scripts/pota-paths.mjs, without git. */
async function rootOf($: Engine, target: { dir: string; explicitRoot: string | null }): Promise<string> {
  if (target.explicitRoot !== null) return target.explicitRoot;
  let env: string | undefined;
  try {
    env = await $.env.get("HARNESS_REPO_ROOT");
  } catch {
    // Unknown: the .git lookup answers.
  }
  if (env !== undefined && env.length > 0) return joinPath(target.dir, env);
  for (const path of ancestorPaths(target.dir)) {
    if (await exists($, joinPath(path, ".git"))) return path;
  }
  return target.dir;
}

async function homeOf($: Engine): Promise<string> {
  return rootOf($, { dir: await $.session.root(), explicitRoot: null });
}

// The root is always passed, so the CLI does not guess again from the cwd (a root without .git included).
async function fetchStatus($: Engine, runtime: string, root: string): Promise<ReturnType<typeof parseGoalStatus>> {
  try {
    const ran = await $.process.run(["node", runtime, "goal", "status", "--root", root], { cwd: root, timeoutMs: 10_000 });
    if (ran.exitCode !== 0) return { snapshot: null, error: firstLine(ran.stderr) || `goal status exited ${ran.exitCode}` };
    return parseGoalStatus(ran.stdout);
  } catch (error) {
    return { snapshot: null, error: firstLine(error instanceof Error ? error.message : String(error)) || "goal status failed" };
  }
}

async function fetchRecent($: Engine, runtime: string, root: string): Promise<{ goalId?: string; status?: string; endedAt?: string | number | null }[]> {
  try {
    const ran = await $.process.run(["node", runtime, "goal", "stats", "--history", "--limit", "5", "--root", root], { cwd: root, timeoutMs: 10_000 });
    const parsed = JSON.parse(ran.stdout) as { recent?: unknown };
    return Array.isArray(parsed.recent) ? parsed.recent : [];
  } catch {
    return [];
  }
}

/** Git 저장소 작업 트리 상태와 staged/unstaged numstat을 읽기 전용으로 조회한다. */
async function fetchGitDiff($: Engine, root: string): Promise<GitDiffSummary> {
  // 새 디렉터리 안의 untracked 파일을 파일 단위로 받는다. 사용자가 `status.showUntrackedFiles=no`로 꺼 둔
  // 저장소(예: 홈 디렉터리 dotfiles)에서는 그 설정을 덮어쓰지 않는다.
  const untrackedMode = await $.process
    .run(["git", "-C", root, "config", "--get", "status.showUntrackedFiles"], { cwd: root, timeoutMs: GIT_TIMEOUT_MS })
    .then(res => (res.exitCode === 0 ? res.stdout.trim().toLowerCase() : ""))
    .catch(() => "");
  const statusArgs = untrackedMode === "no"
    ? ["status", "--porcelain=v1", "-z"]
    : ["status", "--porcelain=v1", "--untracked-files=all", "-z"];
  const [statusRes, unstagedRes, stagedRes] = await Promise.all([
    $.process.run(["git", "-C", root, ...statusArgs], { cwd: root, timeoutMs: GIT_TIMEOUT_MS }).catch(() => null),
    $.process.run(["git", "-C", root, "diff", "--numstat", "-z"], { cwd: root, timeoutMs: GIT_TIMEOUT_MS }).catch(() => null),
    $.process.run(["git", "-C", root, "diff", "--cached", "--numstat", "-z"], { cwd: root, timeoutMs: GIT_TIMEOUT_MS }).catch(() => null),
  ]);
  if (statusRes === null || statusRes.exitCode !== 0) {
    return { available: false, files: [], totals: { files: 0, added: 0, deleted: 0 }, truncated: false };
  }
  const parsed = parseGitStatusAndNumstat(
    statusRes.stdout,
    unstagedRes !== null && unstagedRes.exitCode === 0 ? unstagedRes.stdout : "",
    stagedRes !== null && stagedRes.exitCode === 0 ? stagedRes.stdout : "",
  );
  const truncated = Boolean(statusRes.isStdoutTruncated || unstagedRes?.isStdoutTruncated || stagedRes?.isStdoutTruncated);
  return truncated ? { ...parsed, truncated: true } : parsed;
}

function countFenceLines(text: string): number {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) count += 1;
  }
  return count;
}

function isStrictlyInsideRoot(realRoot: string, realPath: string): boolean {
  if (samePath(realRoot, realPath)) return false;
  const norm = (value: string) => {
    const slashed = joinPath(value, ".").replace(/\\/g, "/").replace(/\/+$/, "");
    return /^(?:[A-Za-z]:|\/\/)/.test(slashed) ? slashed.toLowerCase() : slashed;
  };
  const base = norm(realRoot);
  const target = norm(realPath);
  const prefix = base === "/" ? "/" : `${base}/`;
  return target.startsWith(prefix);
}

/** 활성 planId 마크다운 문서를 저장소 루트·민감 경로·심볼릭 링크·64 KiB 상한 검증 후 읽기 전용으로 요약한다. */
async function fetchPlanOverview($: Engine, root: string, planId: string | null | undefined): Promise<PlanOverview | null> {
  if (typeof planId !== "string" || planId.length === 0) return null;
  const normalized = normalizeRepoPath(planId);
  if (normalized === null || isSensitiveRepoPath(normalized) || !normalized.toLowerCase().endsWith(".md")) {
    return null;
  }
  const candidate = joinPath(root, normalized);
  const [rootStat, fileStat] = await Promise.all([
    $.fs.stat(root, { resolve: true }).catch(() => null),
    $.fs.stat(candidate, { resolve: true }).catch(() => null),
  ]);
  if (
    rootStat === null || rootStat.kind !== "dir" || typeof rootStat.realPath !== "string"
    || fileStat === null || fileStat.kind !== "file" || fileStat.isLink
    || typeof fileStat.realPath !== "string"
  ) {
    return null;
  }
  if (!isStrictlyInsideRoot(rootStat.realPath, fileStat.realPath) || !samePath(fileStat.realPath, joinPath(rootStat.realPath, normalized))) {
    return null;
  }

  let text: string | null = null;
  let truncated = false;
  if (fileStat.size <= MAX_PLAN_BYTES) {
    text = await $.fs.read(candidate, { as: "text", offset: 0, length: MAX_PLAN_BYTES }).catch(() => null);
  } else {
    truncated = true;
    const rawHead = await $.fs.read(candidate, { as: "text", offset: 0, length: PLAN_HEAD_BYTES }).catch(() => null);
    if (rawHead === null) return null;
    const lastNl = rawHead.lastIndexOf("\n");
    const headText = lastNl >= 0 ? rawHead.slice(0, lastNl + 1) : rawHead;
    const tailOffset = Math.max(PLAN_HEAD_BYTES, fileStat.size - PLAN_TAIL_BYTES);
    const tailLength = Math.max(0, fileStat.size - tailOffset);
    const rawTail = tailLength > 0
      ? await $.fs.read(candidate, { as: "text", offset: tailOffset, length: tailLength }).catch(() => null)
      : "";
    const firstNl = rawTail ? rawTail.indexOf("\n") : -1;
    const tailText = rawTail && firstNl >= 0 ? rawTail.slice(firstNl + 1) : "";
    if (tailText.length > 0) {
      const needsFenceBridge = ((countFenceLines(headText) ^ countFenceLines(tailText)) & 1) === 1;
      text = needsFenceBridge ? `${headText}\n\`\`\`\n${tailText}` : `${headText}\n${tailText}`;
    } else {
      text = headText;
    }
  }
  if (text === null) return null;
  return parsePlanOverview(text, { planId: normalized, truncated });
}

async function refreshContext($: Engine, {
  root,
  planId,
  loadDiff = false,
  loadPlan = false,
  reset = false,
}: {
  root: string | null;
  planId: string | null | undefined;
  loadDiff?: boolean;
  loadPlan?: boolean;
  reset?: boolean;
}): Promise<void> {
  const prev = await read($, dagContext);
  if (root === null) {
    if (reset || prev.diff !== null || prev.planOverview !== null || prev.gitCheckedAt !== 0) {
      await update($, dagContext, () => ({ diff: null, planOverview: null, gitCheckedAt: 0 }));
    }
    return;
  }
  const now = await $.clock.now();
  const [nextDiff, nextPlan] = await Promise.all([
    loadDiff ? fetchGitDiff($, root) : Promise.resolve(reset ? null : prev.diff),
    loadPlan ? fetchPlanOverview($, root, planId) : Promise.resolve(
      reset ? null : prev.planOverview && prev.planOverview.planId === planId ? prev.planOverview : null,
    ),
  ]);
  const nextCheckedAt = loadDiff ? now : (reset ? 0 : prev.gitCheckedAt);
  await update($, dagContext, () => ({
    diff: nextDiff,
    planOverview: nextPlan,
    gitCheckedAt: nextCheckedAt,
  }));
}

async function paneOf($: Engine) {
  return (await $.ui.panes()).find(pane => pane.id === PANE);
}

function startPoll($: Engine): void {
  if (pollTimer !== null) return;
  pollTimer = $.clock.every(POLL_MS, () => {
    void tick($).catch(ignore);
  });
}

function stopPoll(): void {
  pollTimer?.cancel();
  pollTimer = null;
}

async function tick($: Engine): Promise<void> {
  const pane = await paneOf($);
  if (pane === undefined) {
    stopPoll();
    return;
  }
  if (!pane.isPlaced) return;
  const now = await $.clock.now();
  const minute = minuteOf(now);
  if ((await read($, dagUi)).minute !== minute) await update($, dagUi, ui => ({ ...ui, minute, epoch: now }));
  const state = await read($, dag);
  // An ended goal is not polled, unless the session moved: the new home may hold a live one.
  if (state.ended === null || !samePath(state.home, await homeOf($))) await requestRefresh($, "poll");
}

async function openPane($: Engine) {
  // Always asked of the engine: an open id is only retitled, and the list can still call a pane placed
  // after the desktop app hid it, which left `/dag` answering "opened" with nothing shown.
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS });
  startPoll($);
  return opened;
}

/** One pending run at a time; a request during a run marks it dirty and the run goes again after. */
async function requestRefresh($: Engine, reason: Reason): Promise<void> {
  if (refreshing) {
    // A poll may back off; any other reason must not wait behind one.
    if (dirty === null || dirty === "poll") dirty = reason;
    return;
  }
  const now = await $.clock.now();
  const delay = nextRefreshDelay({ now, lastRunAt, failures, reason });
  if (refreshTimer !== null) {
    if (now + delay >= refreshDueAt) return;
    refreshTimer.cancel();
  }
  refreshDueAt = now + delay;
  refreshTimer = $.clock.after(delay, () => {
    refreshTimer = null;
    void runRefresh($).catch(ignore);
  });
}

async function refreshImmediate($: Engine): Promise<void> {
  if (refreshTimer !== null) {
    refreshTimer.cancel();
    refreshTimer = null;
  }
  if (refreshing) {
    dirty = "command";
    return;
  }
  await runRefresh($);
}

async function runRefresh($: Engine): Promise<void> {
  refreshing = true;
  const observation = pending;
  pending = null;
  try {
    const now = await $.clock.now();
    lastRunAt = now;
    const prev = await read($, dag);
    const runtime = await findCli($);
    let next: DagState;
    let root: string | null = null;
    if (runtime === null) {
      failures += 1;
      next = { ...prev, error: RUNTIME_MISSING, fetchedAt: now };
    } else {
      const home = await homeOf($);
      const observed = observation?.root ?? null;
      root = pickRoot({ observed, prev, home });
      // A followed worktree that was removed falls back to home instead of failing on every poll.
      if (!samePath(root, home) && !(await exists($, root))) root = home;
      let fetched: ReturnType<typeof parseGoalStatus> | null = null;
      if (shouldCheckHome({ observed, prev, root, home })) {
        const atHome = await fetchStatus($, runtime, home);
        if (atHome.snapshot !== null) {
          root = home;
          fetched = atHome;
        }
      }
      const base = rebaseDagState(prev, { root, home });
      // A new root starts without the old root's backoff.
      if (!samePath(prev.root, root)) failures = 0;
      fetched ??= await fetchStatus($, runtime, root);
      const needsEnding = fetched.snapshot === null && fetched.error === null && base.snapshot !== null && base.ended === null;
      const recent = needsEnding ? await fetchRecent($, runtime, root) : undefined;
      next = reduceDagState(base, { ...fetched, now, recent });
      failures = fetched.error === null ? 0 : failures + 1;
    }
    await update($, dag, () => next);
    const ui = await read($, dagUi);
    if (next.seq !== prev.seq) await update($, dagUi, current => ({ ...current, epoch: now, minute: minuteOf(now) }));
    const snapshot = next.snapshot;
    // 현재 활성 탭이나 인스펙터에서 필요한 경우에만 Git/Plan 컨텍스트를 지연 갱신한다.
    const rootChanged = !samePath(prev.root, root);
    const selectedTask = ui.selectedTaskId ? snapshot?.tasks.find(item => item.id === ui.selectedTaskId) : undefined;
    const loadDiff = root !== null && (ui.tab === "diff" || (selectedTask !== undefined && Array.isArray(selectedTask.writeScope) && selectedTask.writeScope.length > 0));
    const loadPlan = root !== null && ui.tab === "plan" && snapshot !== null;
    const prevCtx = await read($, dagContext);
    const stalePlan = prevCtx.planOverview !== null && prevCtx.planOverview.planId !== (snapshot?.planId ?? null);
    if (loadDiff || loadPlan || rootChanged || stalePlan) {
      await refreshContext($, {
        root,
        planId: snapshot?.planId,
        loadDiff,
        loadPlan,
        reset: rootChanged,
      });
    }
    // A plan seen at another root than the one read does not open this one's goal.
    if (observation?.planned === true && root !== null && (observation.root === null || samePath(observation.root, root)) && snapshot !== null) {
      const currentUi = await read($, dagUi);
      if (shouldAutoOpen({ planned: true, snapshot, ui: currentUi, paneOpen: (await paneOf($)) !== undefined })) {
        await update($, dagUi, current => ({ ...current, autoOpenedPlanKey: planKey(snapshot), epoch: now, minute: minuteOf(now) }));
        await openPane($);
      }
    }
    await syncAgents($);
  } catch (error) {
    // The next run gets the observation again, so a planned open is not lost.
    pending ??= observation;
    throw error;
  } finally {
    refreshing = false;
    if (dirty !== null) {
      const reason = dirty;
      dirty = null;
      void requestRefresh($, reason).catch(ignore);
    }
  }
}

/** Marks agents the engine lists as ended, for ends this module did not hear (a reload in between). */
async function syncAgents($: Engine): Promise<void> {
  try {
    const ended = new Set((await $.agent.list()).filter(agent => ENDED_AGENT.has(agent.status)).map(agent => agent.id));
    if (ended.size === 0) return;
    await update($, dagAgents, list => reduceAgents(list, { type: "sync", running: list.map(agent => agent.id).filter(id => !ended.has(id)) }));
  } catch {
    // The list is a refinement; turn.complete already marks ends.
  }
}

function scheduleFlush($: Engine): void {
  if (flushTimer !== null) return;
  flushTimer = $.clock.after(FLUSH_MS, () => {
    flushTimer = null;
    void flushAgents($).catch(ignore);
  });
}

/** Writes buffered agent activity once a second, so tool calls do not each redraw the pane. */
async function flushAgents($: Engine): Promise<void> {
  const events = pendingAgentEvents;
  pendingAgentEvents = [];
  if (events.length === 0) return;
  const now = await $.clock.now();
  const taskIds = (await read($, dag)).snapshot?.tasks.map(task => task.id) ?? [];
  await update($, dagAgents, list => events.reduce<DagAgent[]>((agents, event) => {
    if (event.type === "spawn") {
      const { text, ...spawn } = event;
      return reduceAgents(agents, { ...spawn, mentions: extractTaskMentions(text, taskIds), at: now });
    }
    if (event.type === "call") return reduceAgents(agents, { ...event, at: now });
    return reduceAgents(agents, { ...event, at: now });
  }, list));
}

async function setView($: Engine, view: View): Promise<void> {
  const now = await $.clock.now();
  await update($, dagUi, ui => ({ ...ui, view, epoch: now, minute: minuteOf(now) }));
}

async function setTab($: Engine, tab: Tab): Promise<void> {
  const now = await $.clock.now();
  await update($, dagUi, ui => ({ ...ui, tab, actionError: null, epoch: now, minute: minuteOf(now) }));
  if (tab === "diff" || tab === "plan") {
    const state = await read($, dag);
    const root = state.root ?? (await homeOf($));
    await refreshContext($, {
      root,
      planId: state.snapshot?.planId,
      loadDiff: tab === "diff",
      loadPlan: tab === "plan" && state.snapshot !== null,
    });
  }
}

/** 선택한 태스크의 인라인 인스펙터 열림 상태를 토글하고 writeScope가 있으면 Git Diff를 로드한다. */
async function toggleInspect($: Engine, taskId: string): Promise<void> {
  const current = await read($, dagUi);
  const nextId = current.selectedTaskId === taskId ? null : taskId;
  await update($, dagUi, ui => ({
    ...ui,
    selectedTaskId: nextId,
    expandedTaskId: nextId,
    actionError: null,
  }));
  if (nextId !== null) {
    const state = await read($, dag);
    const task = state.snapshot?.tasks.find(item => item.id === nextId);
    if (task && Array.isArray(task.writeScope) && task.writeScope.length > 0) {
      const ctx = await read($, dagContext);
      const now = await $.clock.now();
      if (ctx.diff === null || now - ctx.gitCheckedAt > POLL_MS) {
        const root = state.root ?? (await homeOf($));
        await refreshContext($, { root, planId: state.snapshot?.planId, loadDiff: true });
      }
    }
  }
}

/** HITL 제어(pause/resume/gate/retry) CLI를 실행한 뒤 즉시 상태를 재조회한다. */
async function runGoalControl($: Engine, buildArgs: (root: string) => string[]): Promise<void> {
  const lang = await localeOf($);
  const words = messages(lang);
  const runtime = await findCli($);
  const state = await read($, dag);
  const root = state.root ?? (await homeOf($));
  if (runtime === null) {
    await update($, dagUi, ui => ({ ...ui, actionError: words.noRuntime }));
    $.ui.toast(words.noRuntime);
    return;
  }
  await update($, dagUi, ui => ({ ...ui, actionError: null }));
  try {
    const ran = await $.process.run(["node", runtime, ...buildArgs(root)], { cwd: root, timeoutMs: 10_000 });
    if (ran.exitCode !== 0) {
      const detail = firstLine(ran.stderr) || firstLine(ran.stdout) || `pota goal exited ${ran.exitCode}`;
      await update($, dagUi, ui => ({ ...ui, actionError: detail }));
      $.ui.toast(detail);
      return;
    }
  } catch (error) {
    const detail = firstLine(error instanceof Error ? error.message : String(error)) || "goal action failed";
    await update($, dagUi, ui => ({ ...ui, actionError: detail }));
    $.ui.toast(detail);
    return;
  }
  await refreshImmediate($);
}

/**
 * Puts an agent's transcript in the main view, or the main one back for `{}`; a refusal is said, not dropped.
 * A surface with no main view to switch (the desktop app) refuses every card, so a refused card opens its detail
 * in the pane instead, with the reason on the detail rather than a toast per press.
 */
async function showView($: Engine, view: { agentId?: string }, words: ReturnType<typeof messages>, fallbackTaskId?: string): Promise<void> {
  let refusal: string | undefined;
  try {
    refusal = (await $.ui.view(view)).deny;
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  if (refusal === undefined) return;
  const said = `${words.viewDenied}${refusal}`;
  if (fallbackTaskId === undefined) {
    $.ui.toast(said);
    return;
  }
  await toggleInspect($, fallbackTaskId);
  await update($, dagUi, ui => (ui.selectedTaskId === fallbackTaskId ? { ...ui, actionError: said } : ui));
}

const toneProps = (tone: Tone): { color?: string; dimColor?: boolean } =>
  tone === "ok" ? { color: "success" }
    : tone === "run" ? { color: "suggestion" }
      : tone === "ready" ? { color: "warning" }
        : tone === "bad" ? { color: "error" }
          : tone === "dim" ? { dimColor: true }
            : {};

const STATE_GLYPH_MAP = {
  completed: "✓",
  active: "●",
  ready: "○",
  waiting: "·",
  blocked: "!",
} as const;

export const register: Register = on => {
  on("session.start", async ($, e, next) => {
    try {
      await $.command.register({
        name: "dag",
        description: "Show the Pota goal task graph in a pane",
        argumentHint: "[previous|current|next|all|dag|diff|plan|stats|refresh|close]",
        immediate: true,
      });
    } catch {
      // Another plugin holds the name; the pane still opens after planning.
    }
    try {
      if ((await paneOf($)) !== undefined) {
        startPoll($);
        await requestRefresh($, "open");
      }
    } catch {
      // A reload without a pane keeps quiet.
    }
    return next(e);
  });

  on("command.run", { command: "dag" }, async ($, e) => {
    const lang = await localeOf($);
    const words = messages(lang);
    const arg = e.args.trim().toLowerCase();
    if (arg === "close") {
      await $.ui.close({ id: PANE });
      return { text: words.closed };
    }
    if (arg === "refresh") {
      await requestRefresh($, "command");
      return { text: words.refreshing };
    }
    const view = VIEW_ALIASES[arg];
    const tab = TAB_ALIASES[arg];
    if (arg.length > 0 && view === undefined && tab === undefined) return { text: words.usage };
    const now = await $.clock.now();
    await update($, dagUi, ui => ({
      ...ui,
      closedGoalId: null,
      actionError: null,
      epoch: now,
      minute: minuteOf(now),
      ...(view === undefined ? {} : { view, tab: "dag" as const }),
      ...(tab === undefined ? {} : { tab }),
    }));
    await requestRefresh($, "command");
    const opened = await openPane($);
    if (opened.isPlaced) return { text: words.opened };
    const state = await read($, dag);
    const summary = state.snapshot === null
      ? words.noGoal
      : formatSummary(summarize(state.snapshot), { locale: lang, minute: minuteOf(now), timeline: state.timeline, snapshot: state.snapshot });
    return { text: `${words.notPlaced}${opened.reason}\n${summary}` };
  });

  on("tool.call", async ($, e, next) => {
    let goal: ReturnType<typeof parsePotaGoalCommand> = null;
    let command: string | null = null;
    let cwd: string | null = null;
    try {
      if (e.tool === "Bash" && typeof e.command === "string") {
        command = e.command;
        goal = parsePotaGoalCommand(command);
      }
      pendingAgentEvents.push({ type: "call", id: e.agentId ?? MAIN_AGENT_ID, activity: describeToolCall(e as unknown as Record<string, unknown>) });
    } catch {
      // Observation only: the call goes on untouched.
    }
    if (goal !== null && goal.mutates) {
      // Read in the hook: a subagent's own directory, which a later timer would read as the session's.
      try {
        const dir = await $.session.cwd();
        cwd = isAbsolutePath(dir) ? dir : null;
      } catch {
        // Unknown: the command's root stays unknown.
      }
    }
    const ran = await next(e);
    try {
      scheduleFlush($);
      const ok = ran.deny === undefined && ran.isError !== true;
      if (goal !== null && goal.mutates && ok && command !== null) {
        const planned = goal.planned;
        const isSubagent = e.agentId !== undefined;
        const at = command;
        // Detached: the file checks below must not hold up the tool's answer.
        observing = observing.then(async () => {
          const target = cwd === null ? null : goalCommandTarget(at, cwd);
          const root = target === null ? null : await rootOf($, target);
          const shown = (await read($, dag)).root ?? (await homeOf($));
          const observed = observeGoalCommand({ pending, shown, root, planned, isSubagent });
          if (observed !== null) {
            pending = observed;
            await requestRefresh($, "goal");
          }
        }).catch(ignore);
      } else if ((e.tool === "EnterWorktree" || e.tool === "ExitWorktree") && e.agentId === undefined && ok) {
        // The session's root moved; no engine event says so.
        void requestRefresh($, "goal").catch(ignore);
      }
    } catch {
      // Observation only.
    }
    return ran;
  }).catch(($, e, next) => next(e));

  on("agent.spawn", async ($, e, next) => {
    const ran = await next(e);
    try {
      if (ran.deny === undefined && typeof ran.agentId === "string") {
        pendingAgentEvents.push({
          type: "spawn",
          id: ran.agentId,
          name: e.name ?? null,
          description: e.description,
          model: ran.model,
          parentId: e.parentAgentId ?? null,
          text: `${e.prompt}\n${e.description}`,
        });
        scheduleFlush($);
      }
    } catch {
      // Observation only.
    }
    return ran;
  }).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    const ran = await next(e);
    try {
      if (e.agentId !== undefined) {
        pendingAgentEvents.push({ type: "done", id: e.agentId });
        scheduleFlush($);
      }
      if ((await paneOf($)) !== undefined) void requestRefresh($, "turn").catch(ignore);
    } catch {
      // Observation only.
    }
    return ran;
  }).catch(($, e, next) => next(e));

  on("ui.close", { id: PANE }, async ($, e, next) => {
    const ran = await next(e);
    try {
      stopPoll();
      if (e.origin.kind === "person") {
        const goalId = (await read($, dag)).snapshot?.goalId ?? null;
        await update($, dagUi, ui => ({ ...ui, closedGoalId: goalId }));
      }
    } catch {
      // The close itself already happened.
    }
    return ran;
  }).catch(($, e, next) => next(e));

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e);
    const { Box, Text, Button, Progress } = elements;
    const state = await read($, dag);
    const ui = await read($, dagUi);
    const agents = await read($, dagAgents);
    const context = await read($, dagContext);
    const lang = await localeOf($);
    const words = messages(lang);
    const snapshot = state.snapshot;
    const minute = state.ended?.endedAt ?? ui.minute;
    const ctx = { locale: lang, minute, timeline: state.timeline, snapshot };
    const summary = snapshot === null ? null : summarize(snapshot);
    const summaryText = summary === null ? null : formatSummary(summary, ctx);
    const failure = state.error !== null && state.error !== RUNTIME_MISSING ? `${words.refreshFailed}${state.error}` : null;
    // The transcript on screen beside the pane: an agent's while one is opened, absent for the main one.
    const viewed = e.props.view?.agentId;
    const back = viewed === undefined
      ? null
      : <Button key="back-main" label={words.backToMain} variant="primary" onPress={() => showView($, {}, words)} />;
    const otherRoot = state.root !== null && state.home !== null && !samePath(state.root, state.home)
      ? <Text color="warning" wrap="truncate-end">{words.otherRoot(rootLabel(state.root))}</Text>
      : null;

    if (e.props.placement === "widget") {
      return (
        <Box flexDirection="column">
          <Text bold>{snapshot?.title ?? TITLE}</Text>
          {summary === null
            ? <Text dimColor>{state.error === RUNTIME_MISSING ? words.noRuntime : words.noGoal}</Text>
            : <Progress label={summaryText ?? ""} value={summary.done} max={Math.max(1, summary.total)} />}
        </Box>
      );
    }

    const renderDiffTab = () => {
      const diff = context.diff;
      if (diff === null) return <Text dimColor>{words.loading}</Text>;
      if (!diff.available || diff.files.length === 0) return <Text dimColor>{words.noDiff}</Text>;
      const shown = diff.files.slice(0, DIFF_LIST_LIMIT);
      const hidden = diff.files.length - shown.length;
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text bold>{`${diff.totals.files} files · +${diff.totals.added} -${diff.totals.deleted}${diff.truncated ? " (…)" : ""}`}</Text>
          <Box flexDirection="column">
            {shown.map(file => {
              const delta = file.binary ? "binary" : `+${file.added} -${file.deleted}`;
              const label = `${file.status} ${file.path} (${delta})${file.sensitive ? ` 🔒 ${words.sensitiveFile}` : ""}`;
              return (
                <Text size="footnote" mono {...(file.sensitive ? { color: "warning" as const } : {})} wrap="truncate-end">
                  {label}
                </Text>
              );
            })}
            {hidden > 0 && <Text size="footnote" dimColor>{words.more(hidden)}</Text>}
          </Box>
        </Box>
      );
    };

    if (snapshot === null) {
      const line = state.error === RUNTIME_MISSING ? words.noRuntime : state.fetchedAt === 0 && failure === null ? words.loading : words.noGoal;
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{TITLE}</Text>
          {otherRoot}
          {ui.tab === "diff"
            ? renderDiffTab()
            : <Text dimColor>{line}</Text>}
          {ui.actionError !== null && <Text color="error" wrap="wrap">! {ui.actionError}</Text>}
          {failure !== null && <Text dimColor>{failure}</Text>}
          <Box flexDirection="row" columnGap={1}>
            {back}
            <Button key="refresh" label={words.refresh} onPress={() => void requestRefresh($, "command").catch(ignore)} />
          </Box>
        </Box>
      );
    }

    const drawsSvg = e.surface === "desktop" || e.surface === "mobile" || e.surface === "vscode";
    const columns = e.props.bodyColumns;
    const taskById = new Map(snapshot.tasks.map(item => [item.id, item]));
    const { waveOf } = computeWaves(snapshot.tasks);
    const agentTask = resolveAgentTasks(agents, snapshot.tasks);
    const all = detailSections(snapshot, agentTask, agents, ctx);
    const goalState = state.ended !== null
      ? words.ended[state.ended.status]
      : snapshot.status !== "active" ? words.goalStatus[snapshot.status] : null;
    const canPauseResume = state.ended === null && (snapshot.status === "active" || snapshot.status === "paused");
    const isPaused = snapshot.status === "paused";

    const selectedTask: DagTask | undefined = ui.selectedTaskId === null
      ? undefined
      : taskById.get(ui.selectedTaskId);

    const renderInspector = (task: DagTask) => {
      const st = taskState(task, taskById);
      const waveNum = (waveOf[task.id] ?? 0) + 1;
      const linkedAgent = agents.find(item => agentTask[item.id] === task.id);
      const agentLabel = linkedAgent
        ? linkedAgent.id === MAIN_AGENT_ID ? "main" : `@${linkedAgent.name ?? task.assignedAgentId ?? linkedAgent.id.slice(0, 8)}`
        : task.assignedAgentId ? `@${task.assignedAgentId}` : task.status === "active" ? "main" : words.none;
      const details = taskDetail(task, lang);
      const receipts = task.receipts ?? [];
      const canToggleGate = state.ended === null && (task.status === "pending" || task.status === "blocked");
      const scopedDiff = task.writeScope && task.writeScope.length > 0 && context.diff !== null && context.diff.available
        ? filterDiffByScope(context.diff, task.writeScope)
        : null;

      return (
        <Box key="dag-inspector" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} rowGap={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Box flexDirection="row" columnGap={1} flexWrap="wrap" flexShrink={1} minWidth={0}>
              <Text bold wrap="truncate-end">{`${words.inspector}: ${task.id} · ${task.title}`}</Text>
              {task.approvalGate === true && <Text color="warning">{`⏸ ${words.gateBadge}`}</Text>}
            </Box>
            <Button key="inspector-close" label="✕" plain onPress={() => void toggleInspect($, task.id).catch(ignore)} />
          </Box>
          <Text size="footnote" {...toneProps(st === "completed" ? "ok" : st === "active" ? "run" : st === "blocked" ? "bad" : st === "ready" ? "ready" : "dim")}>
            {`${words.state[st]} · Wave ${waveNum} · ${words.agent}: ${agentLabel}`}
          </Text>
          <Box flexDirection="column">
            {details.map(line => <Text size="footnote" dimColor wrap="wrap">{line}</Text>)}
          </Box>
          <Box flexDirection="column">
            <Text size="caption" weight="semibold" dimColor>{words.receipts}</Text>
            {receipts.length === 0
              ? <Text size="footnote" dimColor>{words.noReceipts}</Text>
              : receipts.map(receipt => {
                const mark = receipt.exitCode === 0 ? "✓" : receipt.exitCode === null ? "●" : "!";
                const freshText = receipt.fresh === true ? "fresh" : receipt.fresh === false ? "stale" : null;
                const exitText = receipt.exitCode !== null ? `exit ${receipt.exitCode}` : null;
                const headerLine = [`${mark} ${receipt.kind}`, exitText, freshText, receipt.verifiedAt].filter(Boolean).join(" · ");
                return (
                  <Box flexDirection="column">
                    <Text size="footnote" {...(receipt.fresh === false ? { color: "warning" as const } : receipt.exitCode === 0 ? { color: "success" as const } : {})}>
                      {headerLine}
                    </Text>
                    {receipt.command !== null && (
                      <Text size="footnote" mono dimColor wrap="truncate-end">{clipCommand(receipt.command, 80)}</Text>
                    )}
                  </Box>
                );
              })}
          </Box>
          {scopedDiff !== null && (
            <Box flexDirection="column">
              <Text size="caption" weight="semibold" dimColor>{words.writeScopeDiff}</Text>
              {scopedDiff.files.length === 0
                ? <Text size="footnote" dimColor>{words.noDiff}</Text>
                : (
                  <Box flexDirection="column">
                    <Text size="footnote">{`${scopedDiff.totals.files} files · +${scopedDiff.totals.added} -${scopedDiff.totals.deleted}`}</Text>
                    {scopedDiff.files.slice(0, 12).map(file => (
                      <Text size="footnote" mono dimColor wrap="truncate-end">
                        {`${file.status} ${file.path} (${file.binary ? "binary" : `+${file.added} -${file.deleted}`})${file.sensitive ? ` 🔒 ${words.sensitiveFile}` : ""}`}
                      </Text>
                    ))}
                  </Box>
                )}
            </Box>
          )}
          {state.ended === null && task.status === "blocked" && (
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={`retry-${task.id}`}
                label={words.retry}
                onPress={() => void runGoalControl($, root => [
                  "goal",
                  "retry",
                  "--task",
                  task.id,
                  "--root",
                  root,
                  "--quiet",
                ]).catch(ignore)}
              />
            </Box>
          )}
          {canToggleGate && (
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={`gate-${task.id}`}
                label={task.approvalGate === true ? words.gateOff : words.gateOn}
                onPress={() => void runGoalControl($, root => [
                  "goal",
                  "gate",
                  "--task",
                  task.id,
                  task.approvalGate === true ? "--off" : "--on",
                  "--root",
                  root,
                  "--quiet",
                ]).catch(ignore)}
              />
            </Box>
          )}
        </Box>
      );
    };

    const renderDagTab = () => {
      const model = buildDagModel(snapshot, ui.view);
      let graph;
      if (drawsSvg && "Svg" in elements && model.nodes.length > 0) {
        const { Svg } = elements;
        const width = panelWidth(columns);
        const key = `${state.seq}|${ui.view}|${width}|${minute}|${ui.epoch}|${lang}`;
        if (svgMemo === null || svgMemo.key !== key) svgMemo = { key, value: renderDagSvg(model, { width, epoch: ui.epoch, ctx }) };
        graph = <Svg source={svgMemo.value.source} alt={svgMemo.value.alt} />;
      } else {
        graph = (
          <Box flexDirection="column">
            {termGraph(model, ctx, { columns }).rows.map(row => (
              <Text wrap="truncate-end">
                {row.map(span => <Text bold={span.bold === true} {...toneProps(span.tone)}>{span.text}</Text>)}
              </Text>
            ))}
          </Box>
        );
      }

      const openTask = (task: (typeof all.running)[number]) => {
        const agentId = task.agentId;
        return agentId === null ? () => toggleInspect($, task.id).catch(ignore) : () => showView($, { agentId }, words, task.id).catch(ignore);
      };
      const isMarked = (task: (typeof all.running)[number]) =>
        ui.selectedTaskId === task.id || (task.agentId !== null && task.agentId === viewed);

      const shownIds = new Set<string>([
        ...all.running.map(t => t.id),
        ...all.blocked.map(t => t.id),
        ...all.next.map(t => t.id),
      ]);
      const otherTasks = snapshot.tasks.filter(item => !shownIds.has(item.id));
      const completedTasks = otherTasks.filter(item => item.status === "completed");
      const waitingTasks = otherTasks.filter(item => item.status !== "completed");

      const inspectButton = (taskId: string) => (
        <Button
          key={`inspect-${taskId}`}
          plain
          dimColor={ui.selectedTaskId !== taskId}
          label={ui.selectedTaskId === taskId ? "▾" : "▸"}
          onPress={() => void toggleInspect($, taskId).catch(ignore)}
        />
      );

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {VIEWS.map(view => (
              <Button
                key={`view-${view}`}
                label={words.views[view]}
                {...(ui.view === view ? { variant: "primary" as const } : {})}
                onPress={() => void setView($, view).catch(ignore)}
              />
            ))}
          </Box>
          {graph}
          {!drawsSvg && all.running.length > 0 && (
            <Box flexDirection="column">
              {all.running.map(task => {
                const [title, ...lines] = runningTaskRows(task, lang);
                const marked = isMarked(task);
                return (
                  <Box key={`run-${task.id}`} flexDirection="column">
                    <Box flexDirection="row" columnGap={1}>
                      <Button key={`task-${task.id}`} label={title?.text ?? task.title} {...(marked ? { variant: "primary" as const } : {})} onPress={openTask(task)} />
                      {inspectButton(task.id)}
                      {task.agentId !== null && task.agentId === viewed && <Text color="suggestion">{words.viewing}</Text>}
                    </Box>
                    {lines.map(row => <Text bold={row.bold === true} {...toneProps(row.tone)}>{row.text}</Text>)}
                  </Box>
                );
              })}
            </Box>
          )}
          {drawsSvg && all.running.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} rowGap={1}>
              <Text size="caption" weight="semibold" color="suggestion">{words.state.active}</Text>
              {all.running.map(task => (
                <Box key={`run-${task.id}`} flexDirection="column">
                  <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
                    <Box flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
                      <Button key={`task-${task.id}`} label={task.title} {...(isMarked(task) ? { variant: "primary" as const } : {})} onPress={openTask(task)}>
                        <Text weight="semibold" wrap="truncate-end">{task.title}</Text>
                      </Button>
                      {inspectButton(task.id)}
                    </Box>
                    <Text size="footnote" dimColor>{task.elapsed}</Text>
                  </Box>
                  <Text size="footnote" dimColor wrap="truncate-end">
                    {[task.who, task.calls > 0 ? words.calls(task.calls) : "", task.agentId !== null && task.agentId === viewed ? words.viewing : ""].filter(Boolean).join(" · ")}
                  </Text>
                  {task.activity.length > 0 && <Text size="footnote" mono wrap="truncate-end">{task.activity}</Text>}
                  {task.evidence.length > 0 && (
                    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                      {task.evidence.map(item => (
                        <Text size="caption" {...(item.done ? { color: "success" } : { dimColor: true })}>
                          {item.done ? "●" : "○"} {item.kind}
                        </Text>
                      ))}
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}
          {all.blocked.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
              <Text size="caption" weight="semibold" color="error">{words.state.blocked}</Text>
              {all.blocked.map(task => {
                const rawTask = taskById.get(task.id);
                return (
                  <Box key={`blocked-${task.id}`} flexDirection="column">
                    <Box flexDirection="row" columnGap={1} flexWrap="wrap">
                      <Button
                        key={`task-${task.id}`}
                        label={task.title}
                        {...(ui.selectedTaskId === task.id ? { variant: "primary" as const } : {})}
                        onPress={() => void toggleInspect($, task.id).catch(ignore)}
                      />
                      {inspectButton(task.id)}
                      {rawTask?.approvalGate === true && <Text size="footnote" color="warning">{`⏸ ${words.gateBadge}`}</Text>}
                    </Box>
                    {task.reason.length > 0 && <Text size="footnote" color="error">{task.reason}</Text>}
                  </Box>
                );
              })}
            </Box>
          )}
          {all.next.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text size="caption" weight="semibold" dimColor>{words.nextUp}</Text>
              {all.next.map(task => {
                const rawTask = taskById.get(task.id);
                return (
                  <Box key={`next-${task.id}`} flexDirection="row" columnGap={1} flexWrap="wrap">
                    <Text {...(task.waits.length > 0 ? { dimColor: true } : { color: "warning" })}>○</Text>
                    <Button
                      key={`task-${task.id}`}
                      label={task.title}
                      {...(ui.selectedTaskId === task.id ? { variant: "primary" as const } : {})}
                      onPress={() => void toggleInspect($, task.id).catch(ignore)}
                    />
                    {inspectButton(task.id)}
                    {rawTask?.approvalGate === true && <Text size="footnote" color="warning">{`⏸ ${words.gateBadge}`}</Text>}
                    {task.waits.length > 0 && <Text size="footnote" dimColor wrap="truncate-end">← {task.waits.join(", ")}</Text>}
                  </Box>
                );
              })}
              {all.more > 0 && <Text size="footnote" dimColor>{words.more(all.more)}</Text>}
            </Box>
          )}
          {waitingTasks.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text size="caption" weight="semibold" dimColor>{words.state.waiting}</Text>
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                {waitingTasks.map(item => (
                  <Box key={`wait-${item.id}`} flexDirection="row" columnGap={1}>
                    <Button
                      key={`task-${item.id}`}
                      label={`${STATE_GLYPH_MAP.waiting} ${item.title}`}
                      {...(ui.selectedTaskId === item.id ? { variant: "primary" as const } : { dimColor: true })}
                      onPress={() => void toggleInspect($, item.id).catch(ignore)}
                    />
                    {inspectButton(item.id)}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {completedTasks.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text size="caption" weight="semibold" color="success">{words.state.completed}</Text>
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                {completedTasks.map(item => (
                  <Box key={`done-${item.id}`} flexDirection="row" columnGap={1}>
                    <Button
                      key={`task-${item.id}`}
                      label={`${STATE_GLYPH_MAP.completed} ${item.title}`}
                      {...(ui.selectedTaskId === item.id ? { variant: "primary" as const } : { dimColor: true })}
                      onPress={() => void toggleInspect($, item.id).catch(ignore)}
                    />
                    {inspectButton(item.id)}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {all.strays.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text size="caption" weight="semibold" dimColor>{words.others}</Text>
              {all.strays.map(agent => (
                <Text size="footnote" dimColor wrap="truncate-end">{[agent.name, agent.activity].filter(Boolean).join(" · ")}</Text>
              ))}
            </Box>
          )}
          {selectedTask !== undefined && renderInspector(selectedTask)}
        </Box>
      );
    };

    const renderPlanTab = () => {
      const plan = context.planOverview;
      if (plan === null) {
        return (
          <Box flexDirection="column" rowGap={1}>
            <Text size="footnote" dimColor wrap="truncate-end">{snapshot.planId || words.none}</Text>
            <Text dimColor>{words.noPlan}</Text>
          </Box>
        );
      }
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text size="footnote" dimColor wrap="truncate-end">{plan.planId ?? snapshot.planId}</Text>
          {plan.title !== null && <Text bold wrap="wrap">{plan.title}{plan.truncated ? " (…)" : ""}</Text>}
          {plan.goalSummary !== null && <Text wrap="wrap">{plan.goalSummary}</Text>}
          {plan.currentRequest !== null && <Text size="footnote" dimColor wrap="wrap">{plan.currentRequest}</Text>}
          <Box flexDirection="column">
            <Text size="caption" weight="semibold">{`${plan.checklist.done}/${plan.checklist.total}`}</Text>
            {plan.checklist.items.map(item => (
              <Text size="footnote" {...(item.done ? { color: "success" as const } : { dimColor: true })} wrap="wrap">
                {`${item.done ? "[✓]" : "[ ]"} ${item.text}`}
              </Text>
            ))}
          </Box>
        </Box>
      );
    };

    const renderStatsTab = () => {
      const model = buildDagModel(snapshot, "all");
      const openWaves = model.waves.filter(wave => wave.completed < wave.total);
      const bottleneck = openWaves.length > 0
        ? openWaves.reduce((best, wave) => (wave.blocked > best.blocked ? wave : best), openWaves[0]!)
        : model.waves.at(-1);
      const distinctModels = [...new Set(
        snapshot.tasks
          .map(item => item.resolvedModel ?? item.effectiveModel ?? item.model)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      )];

      return (
        <Box flexDirection="column" rowGap={1}>
          {bottleneck !== undefined && (
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text size="caption" weight="semibold" dimColor>{words.bottleneck}</Text>
              <Text size="footnote">
                {`Wave ${bottleneck.index + 1} · ${bottleneck.completed}/${bottleneck.total} ${words.waveDone}`
                  + (bottleneck.active > 0 ? ` · ${bottleneck.active} ${words.waveRunning}` : "")
                  + (bottleneck.blocked > 0 ? ` · ${bottleneck.blocked} ${words.waveBlocked}` : "")}
              </Text>
              <Text size="footnote" dimColor>{`${words.model}: ${distinctModels.length > 0 ? distinctModels.join(", ") : words.none}`}</Text>
            </Box>
          )}
          <Box flexDirection="column" rowGap={1}>
            {snapshot.tasks.map(item => {
              const st = taskState(item, taskById);
              const matchedAgent = agents.find(agent => agentTask[agent.id] === item.id);
              const agentName = matchedAgent
                ? matchedAgent.id === MAIN_AGENT_ID ? "main" : `@${matchedAgent.name ?? item.assignedAgentId ?? matchedAgent.id.slice(0, 8)}`
                : item.assignedAgentId ? `@${item.assignedAgentId}` : item.status === "active" ? "main" : words.none;
              const models = [item.model, item.effectiveModel, item.resolvedModel]
                .filter((val, idx, arr): val is string => typeof val === "string" && val.length > 0 && arr.indexOf(val) === idx);
              const modelLabel = models.length > 0 ? models.join(" → ") : words.none;
              const effortLabel = item.resolvedEffort ?? item.effort ?? words.none;
              const times = state.timeline[item.id] ?? {};
              const elapsedMs = item.status === "active" && (times.activeAt ?? item.updatedAt) > 0 && minute > 0
                ? minute - (times.activeAt ?? item.updatedAt)
                : item.status === "completed" && times.activeAt !== undefined && times.completedAt !== undefined
                  ? times.completedAt - times.activeAt
                  : null;
              const elapsedLabel = elapsedMs !== null ? formatElapsed(elapsedMs, lang) : "-";
              const evDone = item.requiredEvidence.filter(kind => item.evidence.includes(kind)).length;
              const evTotal = item.requiredEvidence.length;
              const receiptCount = item.receipts?.length ?? item.evidence.length;
              return (
                <Box key={`stat-${item.id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                  <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
                    <Text bold wrap="truncate-end">{`${item.id} · ${item.title}`}</Text>
                    <Text size="footnote" {...toneProps(st === "completed" ? "ok" : st === "active" ? "run" : st === "blocked" ? "bad" : st === "ready" ? "ready" : "dim")}>
                      {`${words.state[st]} · W${(waveOf[item.id] ?? 0) + 1}`}
                    </Text>
                  </Box>
                  <Text size="footnote" dimColor wrap="wrap">
                    {`${words.agent}: ${agentName} · ${words.model}: ${modelLabel} · ${words.effort}: ${effortLabel}`}
                  </Text>
                  <Text size="footnote" dimColor wrap="wrap">
                    {`${words.elapsedCol}: ${elapsedLabel} · ${words.evidence}: ${evDone}/${evTotal} (${words.receipts}: ${receiptCount})`
                      + (matchedAgent && matchedAgent.calls > 0 ? ` · ${words.calls(matchedAgent.calls)}` : "")}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      );
    };

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" columnGap={1} flexWrap="wrap">
            <Box flexDirection="row" columnGap={1} flexWrap="wrap">
              <Text bold>{snapshot.title}</Text>
              {goalState !== null && <Text {...toneProps(state.ended?.status === "completed" ? "ok" : "dim")}>{goalState}</Text>}
            </Box>
            {canPauseResume && (
              <Button
                key={isPaused ? "goal-resume" : "goal-pause"}
                label={isPaused ? words.resume : words.pause}
                onPress={() => void runGoalControl($, root => [
                  "goal",
                  isPaused ? "resume" : "pause",
                  "--root",
                  root,
                  "--quiet",
                ]).catch(ignore)}
              />
            )}
          </Box>
          {otherRoot}
          {snapshot.blocker !== null && <Text color="error">! {snapshot.blocker}</Text>}
          <Text dimColor>{summaryText ?? ""}</Text>
        </Box>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {TABS.map(tab => (
            <Button
              key={`tab-${tab}`}
              label={words.tabs[tab]}
              {...(ui.tab === tab ? { variant: "primary" as const } : {})}
              onPress={() => void setTab($, tab).catch(ignore)}
            />
          ))}
          <Button key="refresh" label={words.refresh} onPress={() => void requestRefresh($, "command").catch(ignore)} />
          {back}
        </Box>
        {ui.actionError !== null && <Text color="error" wrap="wrap">! {ui.actionError}</Text>}
        {ui.tab === "dag" && renderDagTab()}
        {ui.tab === "diff" && renderDiffTab()}
        {ui.tab === "plan" && renderPlanTab()}
        {ui.tab === "stats" && renderStatsTab()}
        {failure !== null && <Text dimColor>{failure}</Text>}
      </Box>
    );
  });
};
