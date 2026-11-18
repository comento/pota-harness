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

/** The engine beneath the plugin: a runtime locator, `goal status` answering `status()`, panes kept in memory. */
function engine(on: On, status: () => string) {
  const world = { opens: 0, isOpen: false, runs: 0 };
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { LANG: "en_US.UTF-8" });
  on("fs.read", () => ({ value: JSON.stringify({ entrypoints: { cli: "/pota/scripts/pota.mjs" } }) }));
  on("fs.exists", () => ({ value: true }));
  on("session.root", () => ({ value: "/repo" }));
  on("agent.list", () => ({ value: [] }));
  on("process.run", (_, e) => {
    world.runs += 1;
    const stdout = e.argv.includes("stats") ? '{"recent":[]}' : status();
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

test("the pane draws an Svg on desktop and text rows on the terminal", async ($, on) => {
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
  expect(await terminal.find({ type: "Text", text: /^Wave 2 · 0\/1 done · 1 running/ })).toBeDefined();
  expect(await terminal.find({ type: "Text", text: /● b/ })).toBeDefined();
  await terminal.unmount();
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
