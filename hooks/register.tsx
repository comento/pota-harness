// Pota goal DAG pane: wiring only. The view model, layout, wording, SVG and event policy live in the
// pure dag-*.mjs modules beside this file.

import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { DagAgent, DagState, DagUi } from "../types";
import { VIEWS, buildDagModel, parseGoalStatus, planKey, summarize } from "./dag-model.mjs";
import { panelWidth } from "./dag-layout.mjs";
import { detailSections, formatSummary, messages, pickLocale, runningRows } from "./dag-text.mjs";
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
const RUNTIME_MISSING = "runtime-missing";
const ENDED_AGENT = new Set(["completed", "failed", "killed"]);
const VIEW_ALIASES: Record<string, View> = {
  previous: "previous", current: "current", next: "next", all: "all",
  이전: "previous", 현재: "current", 다음: "next", 전체: "all",
};

// Change a tag when that value's fields change: it declines what an earlier version stored.
const dag = atom({ plugin: "pota", key: "dag" } as const, {
  seq: 0, snapshot: null, ended: null, error: null, fetchedAt: 0, root: null, home: null, timeline: {},
}, { shape: "dag-2" });
const dagUi = atom({ plugin: "pota", key: "dagUi" } as const, {
  view: "all", epoch: 0, minute: 0, autoOpenedPlanKey: null, closedGoalId: null,
}, { shape: "ui-2" });
const dagAgents = atom({ plugin: "pota", key: "dagAgents" } as const, [], { shape: "agents-1" });

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
    if (next.seq !== prev.seq) await update($, dagUi, ui => ({ ...ui, epoch: now, minute: minuteOf(now) }));
    const snapshot = next.snapshot;
    // A plan seen at another root than the one read does not open this one's goal.
    if (observation?.planned === true && root !== null && (observation.root === null || samePath(observation.root, root)) && snapshot !== null) {
      const ui = await read($, dagUi);
      if (shouldAutoOpen({ planned: true, snapshot, ui, paneOpen: (await paneOf($)) !== undefined })) {
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

const toneProps = (tone: Tone): { color?: string; dimColor?: boolean } =>
  tone === "ok" ? { color: "success" }
    : tone === "run" ? { color: "suggestion" }
      : tone === "ready" ? { color: "warning" }
        : tone === "bad" ? { color: "error" }
          : tone === "dim" ? { dimColor: true }
            : {};

export const register: Register = on => {
  on("session.start", async ($, e, next) => {
    try {
      await $.command.register({
        name: "dag",
        description: "Show the Pota goal task graph in a pane",
        argumentHint: "[previous|current|next|all|refresh|close]",
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
    if (arg.length > 0 && view === undefined) return { text: words.usage };
    const now = await $.clock.now();
    await update($, dagUi, ui => ({ ...ui, closedGoalId: null, epoch: now, minute: minuteOf(now), ...(view === undefined ? {} : { view }) }));
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
    const lang = await localeOf($);
    const words = messages(lang);
    const snapshot = state.snapshot;
    const minute = state.ended?.endedAt ?? ui.minute;
    const ctx = { locale: lang, minute, timeline: state.timeline, snapshot };
    const summary = snapshot === null ? null : summarize(snapshot);
    const summaryText = summary === null ? null : formatSummary(summary, ctx);
    const failure = state.error !== null && state.error !== RUNTIME_MISSING ? `${words.refreshFailed}${state.error}` : null;
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

    if (snapshot === null) {
      const line = state.error === RUNTIME_MISSING ? words.noRuntime : state.fetchedAt === 0 && failure === null ? words.loading : words.noGoal;
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{TITLE}</Text>
          {otherRoot}
          <Text dimColor>{line}</Text>
          {failure !== null && <Text dimColor>{failure}</Text>}
          <Box flexDirection="row">
            <Button key="refresh" label={words.refresh} onPress={() => void requestRefresh($, "command").catch(ignore)} />
          </Box>
        </Box>
      );
    }

    const model = buildDagModel(snapshot, ui.view);
    const columns = e.props.bodyColumns;
    let graph;
    // The terminal's table may still carry an `Svg` key it draws as nothing, so the surface decides.
    const drawsSvg = e.surface === "desktop" || e.surface === "mobile" || e.surface === "vscode";
    if (drawsSvg && "Svg" in elements && model.nodes.length > 0) {
      const { Svg } = elements;
      const width = panelWidth(columns);
      const key = `${state.seq}|${ui.view}|${width}|${minute}|${ui.epoch}|${lang}`;
      if (svgMemo === null || svgMemo.key !== key) svgMemo = { key, value: renderDagSvg(model, { width, epoch: ui.epoch, ctx }) };
      // Drawn as an image: Claude Code Desktop 2.1.326 showed an empty box for every `isInteractive` Svg,
      // while the image form draws the cards and runs the SMIL and CSS animation.
      graph = <Svg source={svgMemo.value.source} alt={svgMemo.value.alt} />;
    } else {
      // One measured line per row: the gaps between boxes survive, and a width Ink counts otherwise ends in "…".
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
    const agentTask = resolveAgentTasks(agents, snapshot.tasks);
    // Where sizes and borders draw, the sections are framed; a text-only surface gets the same as rows.
    const sections = drawsSvg ? detailSections(snapshot, agentTask, agents, ctx) : null;
    const rows = sections === null ? runningRows(snapshot, agentTask, agents, ctx) : [];
    const goalState = state.ended !== null
      ? words.ended[state.ended.status]
      : snapshot.status !== "active" ? words.goalStatus[snapshot.status] : null;

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            <Text bold>{snapshot.title}</Text>
            {goalState !== null && <Text {...toneProps(state.ended?.status === "completed" ? "ok" : "dim")}>{goalState}</Text>}
          </Box>
          {otherRoot}
          {snapshot.blocker !== null && <Text color="error">! {snapshot.blocker}</Text>}
          <Text dimColor>{summaryText ?? ""}</Text>
        </Box>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {VIEWS.map(view => (
            <Button
              key={`view-${view}`}
              label={words.views[view]}
              {...(ui.view === view ? { variant: "primary" as const } : {})}
              onPress={() => void setView($, view).catch(ignore)}
            />
          ))}
          <Button key="refresh" label={words.refresh} onPress={() => void requestRefresh($, "command").catch(ignore)} />
        </Box>
        {graph}
        {rows.length > 0 && (
          <Box flexDirection="column">
            {rows.map(row => <Text bold={row.bold === true} {...toneProps(row.tone)}>{row.text}</Text>)}
          </Box>
        )}
        {sections !== null && sections.running.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} rowGap={1}>
            <Text size="caption" weight="semibold" color="suggestion">{words.state.active}</Text>
            {sections.running.map(task => (
              <Box key={`run-${task.id}`} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
                  <Text weight="semibold" wrap="truncate-end">{task.title}</Text>
                  <Text size="footnote" dimColor>{task.elapsed}</Text>
                </Box>
                <Text size="footnote" dimColor wrap="truncate-end">
                  {[task.who, task.calls > 0 ? words.calls(task.calls) : ""].filter(Boolean).join(" · ")}
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
        {sections !== null && sections.blocked.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
            <Text size="caption" weight="semibold" color="error">{words.state.blocked}</Text>
            {sections.blocked.map(task => (
              <Box key={`blocked-${task.id}`} flexDirection="column">
                <Text weight="semibold" wrap="truncate-end">{task.title}</Text>
                {task.reason.length > 0 && <Text size="footnote" color="error">{task.reason}</Text>}
              </Box>
            ))}
          </Box>
        )}
        {sections !== null && sections.next.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Text size="caption" weight="semibold" dimColor>{words.nextUp}</Text>
            {sections.next.map(task => (
              <Box key={`next-${task.id}`} flexDirection="row" columnGap={1}>
                <Text {...(task.waits.length > 0 ? { dimColor: true } : { color: "warning" })}>○</Text>
                <Text wrap="truncate-end">{task.title}</Text>
                {task.waits.length > 0 && <Text size="footnote" dimColor wrap="truncate-end">← {task.waits.join(", ")}</Text>}
              </Box>
            ))}
            {sections.more > 0 && <Text size="footnote" dimColor>{words.more(sections.more)}</Text>}
          </Box>
        )}
        {sections !== null && sections.strays.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Text size="caption" weight="semibold" dimColor>{words.others}</Text>
            {sections.strays.map(agent => (
              <Text size="footnote" dimColor wrap="truncate-end">{[agent.name, agent.activity].filter(Boolean).join(" · ")}</Text>
            ))}
          </Box>
        )}
        {failure !== null && <Text dimColor>{failure}</Text>}
      </Box>
    );
  });
};
