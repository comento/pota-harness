import { expect, mock, test } from "claude-code/testing";
import type { Engine, MockClock } from "claude-code/testing";
import type { On } from "claude-code";

const PANE = {
  plugin: "pota",
  component: "Pane",
  requestId: "pota-dag",
  props: {
    title: "Pota DAG",
    isFocused: false,
    bodyColumns: 60,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

const NOW = 1_763_440_000_000;
const task = (id: string, dependsOn: string[], status: string) => ({
  id,
  title: `Task ${id}`,
  status,
  dependsOn,
  assignedAgentId: null,
  requiredEvidence: ["moduleAcceptance"],
  createdAt: new Date(NOW - 600_000).toISOString(),
  updatedAt: new Date(NOW - 300_000).toISOString(),
});
const goal = (tasks: ReturnType<typeof task>[]) => JSON.stringify({
  schemaVersion: 3,
  revision: 1,
  goal: { id: "goal-test", title: "DAG pane test", planId: "docs/plan/x.md", status: "active", requiredEvidence: [], createdAt: new Date(NOW - 600_000).toISOString() },
  tasks,
  receipts: [],
});
const PLAN = goal([task("a", [], "completed"), task("b", ["a"], "active"), task("c", ["b"], "pending")]);
const REPLAN = goal([task("a", [], "completed"), task("b", ["a"], "active"), task("c", ["b"], "pending"), task("d", ["c"], "pending")]);
/** Another goal of the same shape, as a second worktree holds it. */
const retitle = (json: string, id: string, title: string): string => {
  const value = JSON.parse(json) as { goal: { id: string; title: string } };
  return JSON.stringify({ ...value, goal: { ...value.goal, id, title } });
};

type EngineOptions = {
  /** The session's project root, asked at each call. */
  root?: () => string;
  /** What `$.session.cwd()` answers; unanswered when absent. */
  cwd?: () => string;
  /** Whether a path exists; a `goal status` whose cwd does not exist fails. */
  exists?: (path: string) => boolean;
  /** What `goal stats --history` prints for a root. */
  stats?: (root: string) => string;
  /** Held before each `fs.exists` answer. */
  wait?: () => Promise<void>;
};

/** The engine beneath the plugin: `goal status` answering `status(root)`, panes kept in memory. */
function engine(on: On, status: (root: string) => string, options: EngineOptions = {}) {
  const world = { opens: 0, isOpen: false, runs: 0, calls: [] as { argv: readonly string[]; cwd: string | undefined }[] };
  const clock = mock.clock(on, { now: NOW });
  const exists = options.exists ?? (() => true);
  mock.env(on, { LANG: "en_US.UTF-8" });
  on("fs.exists", async (_, e) => {
    await options.wait?.();
    return { value: exists(e.path) };
  });
  on("session.root", () => ({ value: options.root?.() ?? "/repo" }));
  if (options.cwd !== undefined) {
    const cwd = options.cwd;
    on("session.cwd", () => ({ value: cwd() }));
  }
  on("agent.list", () => ({ value: [] }));
  on("process.run", (_, e) => {
    world.runs += 1;
    const cwd = e.init?.cwd;
    world.calls.push({ argv: e.argv, cwd });
    const at = e.argv.indexOf("--root");
    const root = (at >= 0 ? e.argv[at + 1] : undefined) ?? cwd ?? "/repo";
    if (cwd !== undefined && !exists(cwd)) {
      return { value: { exitCode: 1, stdout: "", stderr: `no such directory: ${cwd}`, isStdoutTruncated: false, isStderrTruncated: false } };
    }
    const stdout = e.argv.includes("stats") ? options.stats?.(root) ?? '{"recent":[]}' : status(root);
    return { value: { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on("command.register", () => ({ value: { command: "dag" } }));
  on("ui.open", () => {
    world.opens += 1;
    world.isOpen = true;
    return { value: { isPlaced: true } };
  });
  on("ui.panes", () => ({
    value: world.isOpen ? [{ id: "pota-dag", title: "Pota DAG", isShown: true, isFocused: false, isPlaced: true }] : [],
  }));
  on("ui.close", () => {
    world.isOpen = false;
    return { value: undefined };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("tool.call", () => ({ result: { stdout: "ok" }, text: "ok" }));
  return { world, clock };
}

/** `/dag` typed at the prompt of a wide fullscreen terminal. */
const dagCommand = (args: string) => ({ command: "dag", args, origin: { kind: "composer" as const }, presentation: { isFullscreen: true, columns: 200 } });

async function runGoal($: Engine, clock: MockClock, sub: string) {
  await $.tool.call({ tool: "Bash", command: `node /pota/scripts/pota.mjs goal ${sub} --plan docs/plan/x.md` });
  await clock.settle();
  await clock.advance(1_500);
  await clock.settle();
}

/** A Bash call as the main loop, or as subagent `agentId`, and the refresh it may ask for. */
async function bash($: Engine, clock: MockClock, command: string, agentId?: string) {
  await $.tool.call({ tool: "Bash", command, ...(agentId === undefined ? {} : { agentId }) });
  await clock.settle();
  await clock.advance(1_500);
  await clock.settle();
}

/** One 30-second poll and the refresh it schedules. */
async function poll(clock: MockClock) {
  await clock.advance(30_000);
  await clock.advance(1_500);
  await clock.settle();
}

const statusRoots = (calls: { argv: readonly string[]; cwd: string | undefined }[]) =>
  calls.filter(call => call.argv.includes("status")).map(call => call.argv[call.argv.indexOf("--root") + 1]);

test("the pane draws an Svg on desktop and a box graph on the terminal", async ($, on) => {
  const { clock } = engine(on, () => PLAN);
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "start");

  const desktop = await $.ui.mount({ ...PANE, surface: "desktop" });
  const svg = await desktop.find({ type: "Svg" });
  expect(svg).toBeDefined();
  expect(String(svg?.props.source)).toStartWith("<svg");
  expect(String(svg?.props.alt)).toMatch(/wave 2\/3/);
  expect(await desktop.find({ type: "Text", text: /wave 2\/3 · 1\/3 done · 1 running/ })).toBeDefined();
  await desktop.unmount();

  const terminal = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await terminal.find({ type: "Svg" })).toBeUndefined();
  await terminal.drawn();
  for (const text of [/╭─+╮/, /Wave 2 · 0\/1 done · 1 running/, /^b +$/, /^│ Task b +│$/, /● running/]) {
    expect(await terminal.find({ type: "Text", text })).toBeDefined();
  }
  await terminal.unmount();

  // Too narrow for a box: the text rows as before.
  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 20 }, surface: "terminal" });
  // The list cuts its rows to the width, so only the header's start is left at 20 columns.
  expect(await narrow.find({ type: "Text", text: /^Wave 2 · 0\/1 done/ })).toBeDefined();
  expect(await narrow.find({ type: "Text", text: /● b/ })).toBeDefined();
  await narrow.unmount();
});

test("goal start opens the pane once; the same plan again does not, a replan does", async ($, on) => {
  let current = PLAN;
  const { world, clock } = engine(on, () => current);
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "start");
  expect(world.opens).toBe(1);
  expect(world.runs).toBeGreaterThan(0);

  // The engine's record says the pane is gone; the same plan does not bring it back.
  world.isOpen = false;
  await runGoal($, clock, "start");
  expect(world.opens).toBe(1);

  current = REPLAN;
  await runGoal($, clock, "replan");
  expect(world.opens).toBe(2);
});

test("a read-only goal command neither refreshes nor opens", async ($, on) => {
  const { world, clock } = engine(on, () => PLAN);
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "status");
  expect(world.runs).toBe(0);
  expect(world.opens).toBe(0);
});

// The kit's `$` raises no `ui.close` (its `ui` noun is render, resolve, scroll and focus), so a person's
// close is not driven here; the policy after one is covered by shouldAutoOpen in test/claude-mod.test.mjs.
test("/dag close is the plugin's own close: a replan still opens, and /dag answers", async ($, on) => {
  let current = PLAN;
  const { world, clock } = engine(on, () => current);
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "start");
  expect(world.opens).toBe(1);

  expect((await $.command.run(dagCommand("close"))).text).toBe("Closed the Pota DAG pane.");
  expect(world.isOpen).toBe(false);
  current = REPLAN;
  await runGoal($, clock, "replan");
  expect(world.opens).toBe(2);

  expect((await $.command.run(dagCommand("all"))).text).toBe("Opened the Pota DAG pane.");
  // `/dag` asks the engine every time (an open id is only retitled), so a pane the app hid comes back.
  expect(world.opens).toBe(3);
  await clock.advance(1_500);
  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
  expect((await ui.find({ key: "view-all" }))?.props.variant).toBe("primary");
  await ui.press({ key: "view-next" });
  expect((await ui.find({ key: "view-next" }))?.props.variant).toBe("primary");
  await ui.unmount();
});

test("observing hooks hand on what the engine answered", async ($, on) => {
  engine(on, () => PLAN);
  on("turn.complete", (_, e) => ({ text: `engine: ${e.answer}` }));
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  const ran = await $.tool.call({ tool: "Bash", command: "git status" });
  expect(ran.result).toEqual({ stdout: "ok" });
  const done = await $.turn.complete({ answer: "hi", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" });
  expect(done.text).toBe("engine: hi");
});

test("goal status is read with --root and that root as cwd", async ($, on) => {
  const { world, clock } = engine(on, () => PLAN);
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "start");
  const status = world.calls.find(call => call.argv.includes("status"));
  expect(status?.argv).toContain("--root");
  expect(status?.argv[status.argv.indexOf("--root") + 1]).toBe("/repo");
  expect(status?.cwd).toBe("/repo");
});

test("a session moved into a worktree reads that worktree's goal at the next poll (W1)", async ($, on) => {
  let root = "/repo";
  const { clock } = engine(on, at => at === "/repo" ? retitle(PLAN, "goal-main", "Main goal") : retitle(PLAN, "goal-wt", "Worktree goal"), { root: () => root });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await runGoal($, clock, "start");
  const terminal = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await terminal.find({ type: "Text", text: "Main goal" })).toBeDefined();

  root = "/repo/.claude/worktrees/x";
  await poll(clock);
  expect(await terminal.find({ type: "Text", text: "Worktree goal" })).toBeDefined();
  expect(await terminal.find({ type: "Text", text: "Main goal" })).toBeUndefined();
  expect(await terminal.find({ type: "Text", text: /ended/ })).toBeUndefined();
  await terminal.unmount();
});

test("a main-loop goal command follows its directory's root and comes back without one (W2, W4, W7)", async ($, on) => {
  const { world, clock } = engine(on, () => PLAN, { cwd: () => "/repo" });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await bash($, clock, "cd /wt/b && node /pota/scripts/pota.mjs goal start --plan p");
  expect(statusRoots(world.calls).at(-1)).toBe("/wt/b");
  expect(world.calls.at(-1)?.cwd).toBe("/wt/b");
  expect(world.opens).toBe(1);
  const terminal = await $.ui.mount({ ...PANE, surface: "terminal" });
  // rootLabel keeps a path of two segments whole.
  expect(await terminal.find({ type: "Text", text: /Reading another root: \/wt\/b$/ })).toBeDefined();

  await bash($, clock, "node /pota/scripts/pota.mjs goal task --task b --status active");
  expect(statusRoots(world.calls).at(-1)).toBe("/repo");
  expect(await terminal.find({ type: "Text", text: /Reading another root/ })).toBeUndefined();
  await terminal.unmount();
});

test("a relative --root resolves against the hook's cwd (W4)", async ($, on) => {
  const { world, clock } = engine(on, () => PLAN, { cwd: () => "/repo/main" });
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await bash($, clock, "node /pota/scripts/pota.mjs goal task --root ../other --task a --status completed");
  expect(statusRoots(world.calls).at(-1)).toBe("/repo/other");
});

test("a subagent's goal command at another root neither moves nor opens the pane; at the shown root it opens (W5)", async ($, on) => {
  let cwd = "/wt/agent";
  const { world, clock } = engine(on, () => PLAN, { cwd: () => cwd });
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await bash($, clock, "node /pota/scripts/pota.mjs goal start --plan p", "a1");
  expect(world.opens).toBe(0);
  expect(world.calls.some(call => call.cwd === "/wt/agent" || call.argv.includes("/wt/agent"))).toBe(false);

  cwd = "/repo";
  await bash($, clock, "node /pota/scripts/pota.mjs goal start --plan p", "a1");
  expect(world.opens).toBe(1);
});

test("a followed worktree that was removed falls back to home (W3)", async ($, on) => {
  let removed = false;
  const { world, clock } = engine(on, () => PLAN, { cwd: () => "/repo", exists: path => !(removed && path.startsWith("/wt/b")) });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await bash($, clock, "cd /wt/b && node /pota/scripts/pota.mjs goal start --plan p");
  expect(statusRoots(world.calls).at(-1)).toBe("/wt/b");

  removed = true;
  await $.command.run(dagCommand("refresh"));
  await clock.advance(1_500);
  await clock.settle();
  expect(statusRoots(world.calls).at(-1)).toBe("/repo");
  const terminal = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await terminal.find({ type: "Text", text: /Refresh failed/ })).toBeUndefined();
  await terminal.unmount();
});

test("a new root without a goal shows no goal, not the old one ended (W6)", async ($, on) => {
  let root = "/repo";
  const { clock } = engine(on, at => at === "/repo" ? PLAN : "null", { root: () => root });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await runGoal($, clock, "start");

  root = "/empty";
  await poll(clock);
  const terminal = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await terminal.find({ type: "Text", text: /No active Pota goal/ })).toBeDefined();
  expect(await terminal.find({ type: "Text", text: /ended/ })).toBeUndefined();
  await terminal.unmount();
});

test("an ended goal's pane still follows the session to a root with a live goal (W8)", async ($, on) => {
  let root = "/repo";
  let main = PLAN;
  const { clock } = engine(on, at => at === "/repo" ? main : retitle(PLAN, "goal-next", "Next goal"), {
    root: () => root,
    stats: () => JSON.stringify({ recent: [{ goalId: "goal-test", status: "completed", endedAt: NOW }] }),
  });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await runGoal($, clock, "start");
  main = "null";
  await $.command.run(dagCommand("refresh"));
  await clock.advance(1_500);
  await clock.settle();
  const terminal = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await terminal.find({ type: "Text", text: /ended · completed/ })).toBeDefined();

  root = "/repo2";
  await poll(clock);
  expect(await terminal.find({ type: "Text", text: "Next goal" })).toBeDefined();
  expect(await terminal.find({ type: "Text", text: /ended/ })).toBeUndefined();
  await terminal.unmount();
});

test("a goal command whose directory is unknown does not hold the pane where the session left (R1)", async ($, on) => {
  let root = "/repo";
  const { world, clock } = engine(on, () => PLAN, { root: () => root, cwd: () => "/repo" });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await bash($, clock, "cd /wt/b && node /pota/scripts/pota.mjs goal start --plan p");
  expect(statusRoots(world.calls).at(-1)).toBe("/wt/b");

  root = "/repo2";
  await bash($, clock, 'cd "$WT" && node /pota/scripts/pota.mjs goal task --task b --status active');
  expect(statusRoots(world.calls).at(-1)).toBe("/repo2");
});

test("a followed root's ended goal stays shown until home holds a live goal (R7)", async ($, on) => {
  let atWt = PLAN;
  let atHome = "null";
  const { world, clock } = engine(on, at => at === "/wt/b" ? atWt : atHome, {
    cwd: () => "/repo",
    stats: () => JSON.stringify({ recent: [{ goalId: "goal-test", status: "completed", endedAt: NOW }] }),
  });
  const refresh = async () => {
    await $.command.run(dagCommand("refresh"));
    await clock.advance(1_500);
    await clock.settle();
  };
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await bash($, clock, "cd /wt/b && node /pota/scripts/pota.mjs goal start --plan p");
  atWt = "null";
  await refresh();
  const terminal = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await terminal.find({ type: "Text", text: /ended · completed/ })).toBeDefined();

  await refresh();
  expect(statusRoots(world.calls).slice(-2)).toEqual(["/repo", "/wt/b"]);
  expect(await terminal.find({ type: "Text", text: /ended · completed/ })).toBeDefined();
  expect(await terminal.find({ type: "Text", text: /Reading another root: \/wt\/b$/ })).toBeDefined();

  atHome = retitle(PLAN, "goal-home", "Home goal");
  await refresh();
  expect(statusRoots(world.calls).at(-1)).toBe("/repo");
  expect(await terminal.find({ type: "Text", text: "Home goal" })).toBeDefined();
  expect(await terminal.find({ type: "Text", text: /ended/ })).toBeUndefined();
  expect(await terminal.find({ type: "Text", text: /Reading another root/ })).toBeUndefined();
  await terminal.unmount();
});

test("a goal command's answer is handed on unchanged, before its root is looked up (R8)", async ($, on) => {
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const { world, clock } = engine(on, () => PLAN, { cwd: () => "/repo", wait: () => held });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  let answered = false;
  const call = $.tool.call({ tool: "Bash", command: "node /pota/scripts/pota.mjs goal task --task b --status active" }).then(ran => {
    answered = true;
    return ran;
  });
  await clock.settle();
  expect(answered).toBe(true);
  release();
  const ran = await call;
  expect(ran.result).toEqual({ stdout: "ok" });
  expect(ran.text).toBe("ok");
  await clock.settle();
  await clock.advance(1_500);
  await clock.settle();
  expect(statusRoots(world.calls).at(-1)).toBe("/repo");
});

/** A goal with one task a subagent works on and one main works on, as `goal status` prints it. */
const RUNNING = JSON.stringify({
  schemaVersion: 3,
  revision: 1,
  goal: { id: "goal-run", title: "Running goal", planId: "docs/plan/x.md", status: "active", requiredEvidence: [], createdAt: new Date(NOW - 600_000).toISOString() },
  tasks: [
    task("a", [], "completed"),
    { ...task("sub", ["a"], "active"), assignedAgentId: "worker-sub" },
    { ...task("own", ["a"], "active"), writeScope: ["hooks/register.tsx"], model: "opus", effectiveModel: "claude-opus", effort: "medium" },
  ],
  receipts: [],
});

/** The engine's `$.ui.view` and `$.ui.toast`: what each was asked, and the next view answer. */
function viewEngine(on: On) {
  const seen = { views: [] as { agentId?: string }[], toasts: [] as string[], answer: {} as { deny?: string } };
  on("ui.view", (_, e) => {
    seen.views.push({ ...e });
    return { value: seen.answer };
  });
  on("ui.toast", (_, e) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on("agent.spawn", () => ({ model: "claude-opus", agentId: "agent-sub-1" }));
  return seen;
}

async function startRunning($: Engine, on: On) {
  const { clock } = engine(on, () => RUNNING);
  const seen = viewEngine(on);
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "start");
  await $.agent.spawn({
    tool_use_id: "toolu_sub",
    prompt: "Work on the sub task",
    description: "sub",
    subagentType: "worker",
    provider: { plugin: "engine", tier: "builtin" },
    parentModel: "claude-opus",
    background: false,
    fork: false,
    name: "worker-sub",
  });
  await clock.advance(1_500);
  await clock.settle();
  return { clock, seen };
}

for (const surface of ["desktop", "terminal"] as const) {
  test(`${surface}: a running card with a subagent opens its transcript, and a refused one opens its detail with the reason`, async ($, on) => {
    const { seen } = await startRunning($, on);
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ key: "back-main" })).toBeUndefined();
    await ui.press({ key: "task-sub" });
    expect(seen.views).toEqual([{ agentId: "agent-sub-1" }]);
    expect(seen.toasts).toEqual([]);

    seen.answer = { deny: "no agent holds the id" };
    await ui.press({ key: "task-sub" });
    expect(seen.views.at(-1)).toEqual({ agentId: "agent-sub-1" });
    expect(seen.toasts).toEqual([]);
    expect(await ui.find({ type: "Text", text: /Could not open the agent: no agent holds the id/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /evidence recorded: none/ })).toBeDefined();
    expect((await ui.find({ key: "task-sub" }))?.props.variant).toBe("primary");

    seen.answer = { deny: "no main view here" };
    await ui.press({ key: "task-sub" });
    expect(seen.toasts).toEqual([]);
    expect(await ui.find({ type: "Text", text: /Could not open the agent/ })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /evidence recorded: none/ })).toBeUndefined();
    await ui.unmount();
  });

  test(`${surface}: while an agent is viewed its card is marked and the back button returns to main`, async ($, on) => {
    const { seen } = await startRunning($, on);
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, view: { agentId: "agent-sub-1" } }, surface });
    expect((await ui.find({ key: "task-sub" }))?.props.variant).toBe("primary");
    expect((await ui.find({ key: "task-own" }))?.props.variant).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /viewing/ })).toBeDefined();
    await ui.press({ key: "back-main" });
    expect(seen.views).toEqual([{}]);
    await ui.unmount();
  });

  test(`${surface}: a running card main works on opens and closes its detail in the pane`, async ($, on) => {
    const { seen } = await startRunning($, on);
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Text", text: /scope: hooks\/register\.tsx/ })).toBeUndefined();
    await ui.press({ key: "task-own" });
    expect(seen.views).toEqual([]);
    expect((await ui.find({ key: "task-own" }))?.props.variant).toBe("primary");
    for (const text of [/scope: hooks\/register\.tsx/, /model: opus · effective: claude-opus · effort: medium/, /after: a/, /evidence required: moduleAcceptance/, /evidence recorded: none/]) {
      expect(await ui.find({ type: "Text", text })).toBeDefined();
    }
    await ui.press({ key: "task-own" });
    expect(await ui.find({ type: "Text", text: /scope: hooks\/register\.tsx/ })).toBeUndefined();
    await ui.unmount();
  });
}

type S2MockOptions = {
  /** What `git config --get status.showUntrackedFiles` prints; unset (exit 1) when omitted. */
  gitShowUntracked?: string;
  initialStatus?: "active" | "paused";
  planId?: string;
  planStat?: { kind: "file" | "dir" | "other"; size: number; isLink: boolean; realPath?: string } | null;
  planContent?: string;
  gitStatus?: string;
  gitUnstaged?: string;
  gitStaged?: string;
  failControlExit?: number;
};

/** S2 대시보드 기능을 검증하기 위한 확장 mock 엔진(Git diff, Plan stat/read, Pause/Resume/Gate 상태 전이 지원). */
function s2Engine(on: On, options: S2MockOptions = {}) {
  const state = {
    goalStatus: options.initialStatus ?? "active",
    planId: options.planId ?? "docs/plan/s2.md",
    gates: new Map<string, boolean>([["wait", true]]),
    processCalls: [] as (readonly string[])[],
    readPaths: [] as string[],
    readLengths: [] as (number | undefined)[],
  };
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { LANG: "en_US.UTF-8" });
  on("fs.exists", () => ({ value: true }));
  on("fs.stat", (_, e) => {
    if (e.path === "/repo") {
      return { value: { kind: "dir", size: 0, mtimeMs: NOW, isLink: false, realPath: "/repo" } };
    }
    if (options.planStat === null) {
      throw new Error("ENOENT");
    }
    const stat = options.planStat ?? {
      kind: "file",
      size: new TextEncoder().encode(options.planContent ?? "").byteLength,
      mtimeMs: NOW,
      isLink: false,
      realPath: `/repo/${state.planId}`,
    };
    return { value: { ...stat, mtimeMs: NOW } };
  });
  on("fs.read", (_, e) => {
    state.readPaths.push(e.path);
    state.readLengths.push(e.length);
    return { value: options.planContent ?? "" };
  });
  on("session.root", () => ({ value: "/repo" }));
  on("agent.list", () => ({ value: [] }));
  on("command.register", () => ({ value: { command: "dag" } }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("ui.panes", () => ({
    value: [{ id: "pota-dag", title: "Pota DAG", isShown: true, isFocused: false, isPlaced: true }],
  }));
  on("ui.close", () => ({ value: undefined }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("tool.call", () => ({ result: { stdout: "ok" }, text: "ok" }));
  on("process.run", (_, e) => {
    state.processCalls.push(e.argv);
    if (e.argv[0] === "git") {
      if (e.argv.includes("config")) {
        const set = options.gitShowUntracked !== undefined;
        return {
          value: { exitCode: set ? 0 : 1, stdout: set ? `${options.gitShowUntracked}\n` : "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
        };
      }
      if (e.argv.includes("status")) {
        return {
          value: {
            exitCode: 0,
            stdout: options.gitStatus ?? " M hooks/register.tsx\0?? .env.local\0 M README.md\0",
            stderr: "",
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        };
      }
      if (e.argv.includes("--cached")) {
        return {
          value: {
            exitCode: 0,
            stdout: options.gitStaged ?? "",
            stderr: "",
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        };
      }
      return {
        value: {
          exitCode: 0,
          stdout: options.gitUnstaged ?? "12\t3\thooks/register.tsx\x004\t1\tREADME.md\x00",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }

    if (e.argv.includes("goal") && e.argv.includes("pause")) {
      if (options.failControlExit) {
        return { value: { exitCode: options.failControlExit, stdout: "", stderr: "pause denied", isStdoutTruncated: false, isStderrTruncated: false } };
      }
      state.goalStatus = "paused";
      return { value: { exitCode: 0, stdout: "{}", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    }
    if (e.argv.includes("goal") && e.argv.includes("resume")) {
      state.goalStatus = "active";
      return { value: { exitCode: 0, stdout: "{}", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    }
    if (e.argv.includes("goal") && e.argv.includes("gate")) {
      const taskIdx = e.argv.indexOf("--task");
      const taskId = taskIdx >= 0 ? e.argv[taskIdx + 1] : "";
      if (taskId) {
        state.gates.set(taskId, e.argv.includes("--on"));
      }
      return { value: { exitCode: 0, stdout: "{}", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    }
    if (e.argv.includes("goal") && e.argv.includes("retry")) {
      return { value: { exitCode: 0, stdout: "{}", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    }
    if (e.argv.includes("stats")) {
      return { value: { exitCode: 0, stdout: '{"recent":[]}', stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
    }

    const longCmd = `node --test ${"a".repeat(100)}`;
    const snapshotJson = JSON.stringify({
      schemaVersion: 3,
      revision: 3,
      goal: {
        id: "goal-s2",
        title: "S2 Dashboard",
        planId: state.planId,
        status: state.goalStatus,
        requiredEvidence: ["finalReview"],
        createdAt: new Date(NOW - 1_200_000).toISOString(),
      },
      tasks: [
        {
          ...task("a", [], "completed"),
          model: "sonnet",
          effectiveModel: "claude-sonnet",
          resolvedModel: "claude-opus-4-6",
          resolvedEffort: "high",
          resolvedTier: "strongest",
          effort: "medium",
          evidence: ["moduleAcceptance"],
        },
        {
          ...task("sub", ["a"], "active"),
          assignedAgentId: "worker-sub",
          model: "opus",
          effectiveModel: "claude-opus",
          effort: "high",
        },
        {
          ...task("blk", ["a"], "blocked"),
          blocker: "waiting for approval",
          approvalGate: state.gates.get("blk") === true,
        },
        {
          ...task("rdy", ["a"], "pending"),
          writeScope: ["hooks/register.tsx"],
          approvalGate: state.gates.get("rdy") === true,
        },
        {
          ...task("wait", ["rdy"], "pending"),
          approvalGate: state.gates.get("wait") === true,
        },
      ],
      receipts: [
        {
          scope: "task",
          taskId: "a",
          kind: "moduleAcceptance",
          command: longCmd,
          exitCode: 0,
          verifiedAt: "2026-11-24T01:00:00Z",
          fresh: true,
        },
      ],
    });
    return { value: { exitCode: 0, stdout: snapshotJson, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  return { clock, state };
}

test("4 multi-view tabs (DAG, Diff, Plan, Agents & Stats) and /dag tab aliases work safely", async ($, on) => {
  const planContent = [
    "# Plan: S2 Dashboard",
    "",
    "## Goal",
    "",
    "Build 4 tabs and inline inspector.",
    "",
    "- Current request (as of S2): Verify Claude Code mod.",
    "",
    "## Status",
    "- [x] Design approved",
    "- [ ] Verify pane",
  ].join("\n");
  const { clock, state } = s2Engine(on, { planContent });
  const seen = viewEngine(on);
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "start");
  await $.agent.spawn({
    tool_use_id: "toolu_s2",
    prompt: "Work on sub",
    description: "sub",
    subagentType: "worker",
    provider: { plugin: "engine", tier: "builtin" },
    parentModel: "claude-opus",
    background: false,
    fork: false,
    name: "worker-sub",
  });
  await clock.advance(1_500);
  await clock.settle();

  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
  expect((await ui.find({ key: "tab-dag" }))?.props.variant).toBe("primary");
  expect(await ui.find({ type: "Svg" })).toBeDefined();

  // Diff tab: shows totals, file stats, marks .env.local as sensitive, and never reads .env.local.
  await ui.press({ key: "tab-diff" });
  expect((await ui.find({ key: "tab-diff" }))?.props.variant).toBe("primary");
  expect(await ui.find({ type: "Svg" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /3 files · \+16 -4/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /M hooks\/register\.tsx \(\+12 -3\)/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /\?\? \.env\.local.*Sensitive file \(preview blocked\)/ })).toBeDefined();
  expect(state.readPaths.some(p => p.includes(".env"))).toBe(false);
  // Untracked files inside new directories are asked for per file when the user has not turned them off.
  expect(state.processCalls.find(argv => argv[0] === "git" && argv.includes("status"))).toContain("--untracked-files=all");

  // Plan tab: validates path inside root and renders title, goal summary, request, and checklist.
  await ui.press({ key: "tab-plan" });
  expect((await ui.find({ key: "tab-plan" }))?.props.variant).toBe("primary");
  expect(await ui.find({ type: "Text", text: "Plan: S2 Dashboard" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "Build 4 tabs and inline inspector." })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Verify Claude Code mod\./ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "1/2" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "[✓] Design approved" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "[ ] Verify pane" })).toBeDefined();

  // Stats tab: renders bottleneck summary and per-task agent/model/effort/evidence rows.
  await ui.press({ key: "tab-stats" });
  expect((await ui.find({ key: "tab-stats" }))?.props.variant).toBe("primary");
  expect(await ui.find({ type: "Text", text: /Bottleneck/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Wave 2 · 0\/3 done · 1 running · 1 blocked/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /sonnet → claude-sonnet → claude-opus-4-6/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /Agent: @worker-sub · model: opus → claude-opus · effort: high/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: /evidence: 1\/1 \(Receipts: 1\)/ })).toBeDefined();

  // Command aliases /dag diff|plan|stats|dag switch tabs directly.
  await $.command.run(dagCommand("diff"));
  expect((await ui.find({ key: "tab-diff" }))?.props.variant).toBe("primary");
  await $.command.run(dagCommand("dag"));
  expect((await ui.find({ key: "tab-dag" }))?.props.variant).toBe("primary");
  expect(seen.views).toEqual([]);
  await ui.unmount();
});

test("Diff tab leaves untracked listing to git when the user set status.showUntrackedFiles=no", async ($, on) => {
  const { clock, state } = s2Engine(on, { gitShowUntracked: "no" });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await runGoal($, clock, "start");
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-diff" });
  const status = state.processCalls.find(argv => argv[0] === "git" && argv.includes("status"));
  expect(status).toBeDefined();
  expect(status).not.toContain("--untracked-files=all");
  await ui.unmount();
});

test("Plan tab blocks symlink, path-escape, and sensitive planId paths without calling fs.read", async ($, on) => {
  const { clock, state } = s2Engine(on, {
    planId: "../secret.md",
    planStat: { kind: "file", size: 100, isLink: true, realPath: "/etc/passwd" },
  });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await runGoal($, clock, "start");
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "tab-plan" });
  expect(await ui.find({ type: "Text", text: "Plan document not found." })).toBeDefined();
  expect(state.readPaths).toEqual([]);

  // Sensitive filename (.env) or symlink inside repo is also rejected before fs.read.
  state.planId = "docs/plan/credentials.md";
  await ui.press({ key: "tab-dag" });
  await ui.press({ key: "tab-plan" });
  expect(await ui.find({ type: "Text", text: "Plan document not found." })).toBeDefined();
  expect(state.readPaths).toEqual([]);
  await ui.unmount();
});

test("Plan tab reads large plans in bounded head+tail slices (<= 64 KiB)", async ($, on) => {
  const largePlan = [
    "# Plan: Bounded Huge",
    "",
    "## Goal",
    "",
    "Bounded summary.",
    "",
    "x".repeat(75_000),
    "",
    "- [x] Tail item",
  ].join("\n");
  const { clock, state } = s2Engine(on, {
    planId: "docs/plan/huge.md",
    planContent: largePlan,
    planStat: { kind: "file", size: new TextEncoder().encode(largePlan).byteLength, isLink: false, realPath: "/repo/docs/plan/huge.md" },
  });
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "start");
  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });
  await ui.press({ key: "tab-plan" });
  expect(await ui.find({ type: "Text", text: /Plan: Bounded Huge \(…\)/ })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "Bounded summary." })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "[✓] Tail item" })).toBeDefined();
  const totalRequested = state.readLengths.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  expect(totalRequested).toBeLessThanOrEqual(65_536);
  await ui.unmount();
});

test("Pause/Resume header buttons invoke goal pause/resume and refresh immediately", async ($, on) => {
  const { clock, state } = s2Engine(on);
  await $.session.start({ cwd: "/repo", surface: "desktop", isInteractive: true });
  await runGoal($, clock, "start");
  const ui = await $.ui.mount({ ...PANE, surface: "desktop" });

  expect(await ui.find({ key: "goal-pause" })).toBeDefined();
  expect(await ui.find({ key: "goal-resume" })).toBeUndefined();
  await ui.press({ key: "goal-pause" });
  const pauseCall = state.processCalls.find(argv => argv.includes("pause"));
  expect(pauseCall?.slice(2)).toEqual(["goal", "pause", "--root", "/repo", "--quiet"]);
  expect(await ui.find({ key: "goal-resume" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "paused" })).toBeDefined();

  await ui.press({ key: "goal-resume" });
  const resumeCall = state.processCalls.find(argv => argv.includes("resume"));
  expect(resumeCall?.slice(2)).toEqual(["goal", "resume", "--root", "/repo", "--quiet"]);
  expect(await ui.find({ key: "goal-pause" })).toBeDefined();
  await ui.unmount();
});

test("Pause failure surfaces actionError cleanly", async ($, on) => {
  const { clock } = s2Engine(on, { failControlExit: 1 });
  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
  await runGoal($, clock, "start");
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  await ui.press({ key: "goal-pause" });
  expect(await ui.find({ type: "Text", text: /pause denied/ })).toBeDefined();
  expect(await ui.find({ key: "goal-pause" })).toBeDefined();
  await ui.unmount();
});

for (const surface of ["desktop", "terminal"] as const) {
  test(`${surface}: all-node inline inspector renders receipts, scoped diff, and toggles approvalGate while preserving subagent view`, async ($, on) => {
    const { clock, state } = s2Engine(on);
    const seen = viewEngine(on);
    await $.session.start({ cwd: "/repo", surface, isInteractive: true });
    await runGoal($, clock, "start");
    await $.agent.spawn({
      tool_use_id: "toolu_s2",
      prompt: "Work on sub",
      description: "sub",
      subagentType: "worker",
      provider: { plugin: "engine", tier: "builtin" },
      parentModel: "claude-opus",
      background: false,
      fork: false,
      name: "worker-sub",
    });
    await clock.advance(1_500);
    await clock.settle();

    const ui = await $.ui.mount({ ...PANE, surface });

    // 1. Clicking task-sub STILL opens subagent view; clicking inspect-sub opens inline inspector without switching view.
    await ui.press({ key: "task-sub" });
    expect(seen.views).toEqual([{ agentId: "agent-sub-1" }]);
    await ui.press({ key: "inspect-sub" });
    expect(seen.views).toEqual([{ agentId: "agent-sub-1" }]);
    expect(await ui.find({ type: "Text", text: /Task Inspector: sub · Task sub/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /running · Wave 2 · Agent: @worker-sub/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "No receipts recorded." })).toBeDefined();

    // 2. Clicking completed task 'a' shows resolved model, receipts with truncated command, and no gate button.
    await ui.press({ key: "task-a" });
    expect(await ui.find({ type: "Text", text: /Task Inspector: a · Task a/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /done · Wave 1/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Resolved model: claude-opus-4-6 · strongest · effort: high/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /✓ moduleAcceptance · exit 0 · fresh · 2026-11-24T01:00:00Z/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^node --test a+…$/ })).toBeDefined();
    expect(await ui.find({ key: "gate-a" })).toBeUndefined();

    // 3. Clicking ready task 'rdy' shows scoped diff filtered via filterDiffByScope and toggles gate --on.
    await ui.press({ key: "task-rdy" });
    expect(await ui.find({ type: "Text", text: /ready · Wave 2/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Scoped Diff" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "1 files · +12 -3" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /M hooks\/register\.tsx \(\+12 -3\)/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /README\.md/ })).toBeUndefined();
    expect((await ui.find({ key: "gate-rdy" }))?.props.label).toBe("Enable gate");
    await ui.press({ key: "gate-rdy" });
    const gateOnCall = state.processCalls.find(argv => argv.includes("gate") && argv.includes("rdy") && argv.includes("--on"));
    expect(gateOnCall?.slice(2)).toEqual(["goal", "gate", "--task", "rdy", "--on", "--root", "/repo", "--quiet"]);
    expect((await ui.find({ key: "gate-rdy" }))?.props.label).toBe("Disable gate");

    // 4. Clicking blocked task 'blk' toggles gate --on, and waiting task 'wait' toggles gate --off.
    await ui.press({ key: "task-blk" });
    expect(await ui.find({ type: "Text", text: /blocked · Wave 2/ })).toBeDefined();
    await ui.press({ key: "gate-blk" });
    expect((await ui.find({ key: "gate-blk" }))?.props.label).toBe("Disable gate");
    expect((await ui.find({ key: "retry-blk" }))?.props.label).toBe("Retry");
    await ui.press({ key: "retry-blk" });
    const retryCall = state.processCalls.find(argv => argv.includes("retry") && argv.includes("blk"));
    expect(retryCall?.slice(2)).toEqual(["goal", "retry", "--task", "blk", "--root", "/repo", "--quiet"]);

    await ui.press({ key: "task-wait" });
    expect(await ui.find({ type: "Text", text: /waiting · Wave 3/ })).toBeDefined();
    expect(await ui.find({ key: "retry-wait" })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /⏸ Gate/ })).toBeDefined();
    expect((await ui.find({ key: "gate-wait" }))?.props.label).toBe("Disable gate");
    await ui.press({ key: "gate-wait" });
    const gateOffCall = state.processCalls.find(argv => argv.includes("gate") && argv.includes("wait") && argv.includes("--off"));
    expect(gateOffCall?.slice(2)).toEqual(["goal", "gate", "--task", "wait", "--off", "--root", "/repo", "--quiet"]);
    expect((await ui.find({ key: "gate-wait" }))?.props.label).toBe("Enable gate");

    await ui.press({ key: "inspector-close" });
    expect(await ui.find({ type: "Text", text: /Task Inspector:/ })).toBeUndefined();
    await ui.unmount();
  });
}
