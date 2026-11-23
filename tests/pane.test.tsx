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
  test(`${surface}: a running card with a subagent opens its transcript, and a refusal is said`, async ($, on) => {
    const { seen } = await startRunning($, on);
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ key: "back-main" })).toBeUndefined();
    await ui.press({ key: "task-sub" });
    expect(seen.views).toEqual([{ agentId: "agent-sub-1" }]);
    expect(seen.toasts).toEqual([]);

    seen.answer = { deny: "no agent holds the id" };
    await ui.press({ key: "task-sub" });
    expect(seen.views.at(-1)).toEqual({ agentId: "agent-sub-1" });
    expect(seen.toasts).toEqual(["Could not open the agent: no agent holds the id"]);
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
