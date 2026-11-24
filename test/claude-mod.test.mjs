import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildDagModel,
  computeWaves,
  filterDiffByScope,
  focusIds,
  isSensitiveRepoPath,
  normalizeRepoPath,
  parseGitStatusAndNumstat,
  parseGoalStatus,
  parsePlanOverview,
  planKey,
  reduceEdges,
  summarize,
  taskState,
} from "../hooks/dag-model.mjs";
import { layoutDag, panelWidth, textWidth, truncateText } from "../hooks/dag-layout.mjs";
import { cardLines, cellWidth, detailSections, formatElapsed, formatSummary, messages, pickLocale, runningRows, taskDetail, textRows } from "../hooks/dag-text.mjs";
import { escapeXml, renderDagSvg } from "../hooks/dag-svg.mjs";
import {
  describeToolCall,
  extractTaskMentions,
  nextRefreshDelay,
  parsePotaGoalCommand,
  reduceAgents,
  reduceDagState,
  resolveAgentTasks,
  shouldAutoOpen,
} from "../hooks/dag-events.mjs";

const modRoot = resolve(".");
const pureModules = ["dag-model.mjs", "dag-layout.mjs", "dag-text.mjs", "dag-svg.mjs", "dag-events.mjs", "dag-term.mjs"];

const task = (id, dependsOn = [], status = "pending", extra = {}) => ({
  id,
  title: `Task ${id}`,
  status,
  dependsOn,
  assignedAgentId: null,
  route: null,
  kind: null,
  effort: null,
  model: null,
  effectiveModel: null,
  requiredEvidence: [],
  evidence: [],
  writeScope: null,
  blocker: null,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const snapshot = (tasks, extra = {}) => ({
  goalId: "goal-1",
  title: "Goal",
  planId: "docs/plan/x.md",
  status: "active",
  blocker: null,
  revision: 1,
  createdAt: 0,
  requiredEvidence: [],
  evidence: [],
  tasks,
  ...extra,
});

// The six tasks of docs/plan/claude-dag-panel.md.
const planTasks = (statuses = {}) => [
  task("triage-plan", [], statuses["triage-plan"]),
  task("heavy-design", ["triage-plan"], statuses["heavy-design"]),
  task("mod-panel", ["heavy-design"], statuses["mod-panel"]),
  task("install-wiring", ["mod-panel"], statuses["install-wiring"]),
  task("docs", ["mod-panel"], statuses.docs),
  task("verify", ["install-wiring", "docs"], statuses.verify),
];
const planIds = ["triage-plan", "heavy-design", "mod-panel", "install-wiring", "docs", "verify"];
const allStatus = (status) => Object.fromEntries(planIds.map((id) => [id, status]));
const inFlight = { "triage-plan": "completed", "heavy-design": "completed", "mod-panel": "active" };

// a done; b, c, e active after a; x done after a; d active after x; f waits on b and c; g on f.
const parallel = () => snapshot([
  task("a", [], "completed"),
  task("b", ["a"], "active"),
  task("c", ["a"], "active"),
  task("x", ["a"], "completed"),
  task("d", ["x"], "active"),
  task("e", ["a"], "active"),
  task("f", ["b", "c"]),
  task("g", ["f"]),
]);

const nodeRoles = (model) => model.nodes.map((node) => `${node.id}:${node.role}`).sort();
const roles = (focus, context = []) => [...focus.map((id) => `${id}:focus`), ...context.map((id) => `${id}:context`)].sort();
const ctxOf = (snap, extra = {}) => ({ locale: "en", minute: 0, timeline: {}, snapshot: snap, ...extra });

function assertWellFormed(source) {
  const stack = [];
  let match;
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let consumed = 0;
  while ((match = tag.exec(source))) {
    assert.doesNotMatch(source.slice(consumed, match.index), /[<>]/, "stray angle bracket outside a tag");
    consumed = match.index + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) assert.equal(stack.pop(), name, `unbalanced </${name}>`);
    else stack.push(name);
  }
  assert.equal(consumed, source.length, "trailing content after the root element");
  assert.deepEqual(stack, [], "unclosed tags");
  assert.doesNotMatch(source.replace(/&(?:amp|lt|gt|quot|apos);/g, ""), /&/, "bare ampersand");
}

const tags = (source) => source.match(/<[^>]*>/g) ?? [];
const pathEnds = (d) => {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return { x1: numbers[0], y1: numbers[1], x2: numbers.at(-2), y2: numbers.at(-1) };
};

test("1. manifest, hooks.json and the state contract", () => {
  const manifest = JSON.parse(readFileSync(join(modRoot, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.name, "pota");
  assert.equal(manifest.types, "./types/index.d.ts");
  assert.deepEqual(JSON.parse(readFileSync(join(modRoot, "hooks/hooks.json"), "utf8")).modules, ["./register.tsx"]);
  const register = readFileSync(join(modRoot, "hooks/register.tsx"), "utf8");
  assert.ok(register.includes("`${$.plugin.root}/scripts/pota.mjs`"), "the CLI is the plugin root's scripts/pota.mjs");
  assert.doesNotMatch(register, /pota-runtime\.json|\.\.\/scripts\/pota\.mjs/);
  const contract = readFileSync(join(modRoot, "types/index.d.ts"), "utf8");
  assert.match(contract, /interface PluginState/);
  assert.match(contract, /interface DagContext/);
  assert.match(contract, /tab:\s*'dag'\s*\|\s*'diff'\s*\|\s*'plan'\s*\|\s*'stats'/);
  assert.match(contract, /selectedTaskId:\s*string \| null/);
  assert.match(contract, /actionError:\s*string \| null/);
  assert.match(contract, /pota:\s*\{\s*dag:\s*Shaped<DagState>;\s*dagUi:\s*Shaped<DagUi>;\s*dagAgents:\s*Shaped<DagAgent\[\]>;\s*dagContext:\s*Shaped<DagContext>;?\s*\}/);
});

test("2. pure modules and register.tsx keep to the source constraints", () => {
  for (const name of pureModules) {
    const source = readFileSync(join(modRoot, "hooks", name), "utf8");
    for (const banned of ["node:", "process", "require(", "import(", "Date.now", "setTimeout", "Intl"]) {
      assert.equal(source.includes(banned), false, `${name} contains ${banned}`);
    }
    for (const [, specifier] of source.matchAll(/^import[^;]*?from\s+"([^"]+)"/gm)) {
      assert.match(specifier, /^\.\/dag-[a-z]+\.mjs$/, `${name} imports ${specifier}`);
      assert.ok(existsSync(join(modRoot, "hooks", specifier)));
    }
  }
  const register = readFileSync(join(modRoot, "hooks/register.tsx"), "utf8");
  assert.equal(register.includes("import("), false);
  const specifiers = [...register.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) {
    if (!specifier.startsWith(".")) {
      assert.equal(specifier, "claude-code");
      continue;
    }
    if (specifier === "../types") {
      assert.ok(existsSync(join(modRoot, "types/index.d.ts")));
      continue;
    }
    assert.match(specifier, /\.(?:ts|tsx|js|mjs)$/);
    const target = resolve(join(modRoot, "hooks"), specifier);
    assert.equal(dirname(target), join(modRoot, "hooks"));
    assert.ok(existsSync(target), `${specifier} exists`);
  }
});

test("3. computeWaves on a line, a diamond, independent roots and this plan", () => {
  assert.deepEqual(computeWaves([task("a"), task("b", ["a"]), task("c", ["b"])]).waves, [["a"], ["b"], ["c"]]);
  const diamond = computeWaves([task("a"), task("b", ["a"]), task("c", ["a"]), task("d", ["b", "c"])]);
  assert.deepEqual(diamond.waves, [["a"], ["b", "c"], ["d"]]);
  assert.deepEqual(diamond.waveOf, { a: 0, b: 1, c: 1, d: 2 });
  assert.deepEqual(computeWaves([task("a"), task("b"), task("c", ["b"])]).waves, [["a", "b"], ["c"]]);
  assert.deepEqual(computeWaves(planTasks()).waves, [["triage-plan"], ["heavy-design"], ["mod-panel"], ["install-wiring", "docs"], ["verify"]]);
});

test("4. computeWaves ends on cycles and missing ids", () => {
  const tasks = [task("a", ["c"]), task("b", ["a", "ghost"]), task("c", ["b"]), task("d", ["d"])];
  const { waveOf, waves } = computeWaves(tasks);
  assert.equal(Object.keys(waveOf).length, 4);
  assert.equal(waves.flat().length, 4);
  for (const edge of reduceEdges(tasks)) assert.ok(waveOf[edge.from] < waveOf[edge.to], `${edge.from}->${edge.to}`);
  const plan = computeWaves(planTasks());
  for (const edge of reduceEdges(planTasks())) assert.ok(plan.waveOf[edge.from] < plan.waveOf[edge.to]);
});

test("5. reduceEdges drops an edge another path already implies", () => {
  assert.deepEqual(reduceEdges([task("a"), task("b", ["a"]), task("c", ["b", "a"])]), [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ]);
  assert.equal(reduceEdges(planTasks()).length, 6);
});

test("6. taskState and focusIds", () => {
  const snap = snapshot(planTasks(inFlight));
  const byId = new Map(snap.tasks.map((one) => [one.id, one]));
  assert.equal(taskState(byId.get("mod-panel"), byId), "active");
  assert.equal(taskState(byId.get("install-wiring"), byId), "waiting");
  assert.equal(taskState(byId.get("triage-plan"), byId), "completed");
  const pending = snapshot(planTasks());
  const pendingById = new Map(pending.tasks.map((one) => [one.id, one]));
  assert.equal(taskState(pendingById.get("triage-plan"), pendingById), "ready");

  assert.deepEqual(focusIds(snap), ["mod-panel"]);
  assert.deepEqual(focusIds(pending), ["triage-plan"]);
  assert.deepEqual(focusIds(snapshot(planTasks(allStatus("completed")))), ["verify"]);
  const blockedReady = snapshot(planTasks({ "triage-plan": "completed", "heavy-design": "completed", "mod-panel": "blocked" }));
  assert.deepEqual(focusIds(blockedReady), ["mod-panel"]);
  const blockedWaiting = snapshot(planTasks({ "triage-plan": "completed", "mod-panel": "blocked" }));
  assert.deepEqual(focusIds(blockedWaiting), ["heavy-design"]);
  assert.equal(taskState(blockedWaiting.tasks[2], new Map(blockedWaiting.tasks.map((one) => [one.id, one]))), "blocked");
});

test("7. buildDagModel picks nodes for every view on every boundary", () => {
  const done = snapshot(planTasks(allStatus("completed")));
  assert.deepEqual(nodeRoles(buildDagModel(done, "previous")), roles(planIds));
  assert.deepEqual(nodeRoles(buildDagModel(done, "current")), roles(["verify"], ["install-wiring", "docs"]));
  const doneNext = buildDagModel(done, "next");
  assert.equal(doneNext.empty, "no-next");
  assert.deepEqual(doneNext.nodes, []);
  assert.deepEqual(nodeRoles(buildDagModel(done, "all")), roles(planIds));

  const fresh = snapshot(planTasks());
  const freshPrevious = buildDagModel(fresh, "previous");
  assert.equal(freshPrevious.empty, "no-completed");
  assert.deepEqual(freshPrevious.nodes, []);
  assert.deepEqual(nodeRoles(buildDagModel(fresh, "current")), roles(["triage-plan"]));
  const freshNext = buildDagModel(fresh, "next");
  assert.deepEqual(nodeRoles(freshNext), roles(["heavy-design"], ["triage-plan"]));
  assert.equal(freshNext.hiddenAfter, 4);
  assert.equal(buildDagModel(fresh, "all").nodes.length, 6);

  const blocked = snapshot(planTasks({ "triage-plan": "completed", "heavy-design": "completed", "mod-panel": "blocked" }));
  assert.deepEqual(nodeRoles(buildDagModel(blocked, "previous")), roles(["triage-plan", "heavy-design"]));
  assert.deepEqual(nodeRoles(buildDagModel(blocked, "current")), roles(["mod-panel"], ["heavy-design"]));
  const blockedNext = buildDagModel(blocked, "next");
  assert.deepEqual(nodeRoles(blockedNext), roles(["install-wiring", "docs"], ["mod-panel"]));
  assert.equal(blockedNext.hiddenAfter, 1);
  assert.equal(blockedNext.empty, null);

  const wide = parallel();
  assert.deepEqual(nodeRoles(buildDagModel(wide, "previous")), roles(["a", "x"]));
  const wideCurrent = buildDagModel(wide, "current");
  assert.deepEqual(nodeRoles(wideCurrent), roles(["b", "c", "d", "e"], ["a", "x"]));
  assert.deepEqual(wideCurrent.nodes.find((node) => node.id === "d").wave, 2);
  const wideNext = buildDagModel(wide, "next");
  assert.deepEqual(nodeRoles(wideNext), roles(["f"], ["b", "c"]));
  assert.equal(wideNext.hiddenAfter, 1);
  assert.equal(buildDagModel(wide, "all").nodes.length, 8);

  const single = snapshot([task("only")]);
  assert.equal(buildDagModel(single, "previous").empty, "no-completed");
  assert.deepEqual(nodeRoles(buildDagModel(single, "current")), roles(["only"]));
  assert.deepEqual(buildDagModel(single, "current").edges, []);
  assert.equal(buildDagModel(single, "next").empty, "no-next");
  const singleDone = snapshot([task("only", [], "completed")]);
  assert.deepEqual(nodeRoles(buildDagModel(singleDone, "previous")), roles(["only"]));
  assert.deepEqual(nodeRoles(buildDagModel(singleDone, "current")), roles(["only"]));

  const visible = buildDagModel(snapshot(planTasks(inFlight)), "current");
  assert.deepEqual(visible.waves.map((wave) => wave.index), [1, 2]);
  assert.deepEqual(visible.waves[1], { index: 2, total: 1, completed: 0, active: 1, blocked: 0 });
});

test("8. edge states", () => {
  const edges = (snap) => Object.fromEntries(buildDagModel(snap, "all").edges.map((edge) => [`${edge.from}>${edge.to}`, edge.state]));
  const running = edges(snapshot(planTasks(inFlight)));
  assert.equal(running["triage-plan>heavy-design"], "done");
  assert.equal(running["heavy-design>mod-panel"], "flow");
  assert.equal(running["mod-panel>install-wiring"], "wait");
  const blocked = edges(snapshot(planTasks({ "triage-plan": "completed", "heavy-design": "completed", "mod-panel": "blocked" })));
  assert.equal(blocked["heavy-design>mod-panel"], "blocked");
  for (const edge of buildDagModel(parallel(), "all").edges) {
    if (edge.state === "flow") assert.ok(["a", "x"].includes(edge.from));
  }
});

test("9. summarize and formatSummary", () => {
  const tasks = planTasks(inFlight).map((one, index) => ({ ...one, model: index % 2 ? "opus" : index === 0 ? null : "fable" }));
  const snap = snapshot(tasks, { createdAt: 1_000 });
  const summary = summarize(snap);
  assert.deepEqual(summary, { waveCurrent: 3, waveTotal: 5, done: 2, total: 6, running: 1, blocked: 0, ready: 0, models: ["opus", "fable"], allDone: false });
  assert.equal(formatSummary(summary, ctxOf(snap, { minute: 1_000 + 23 * 60_000 })), "wave 3/5 · 2/6 done · 1 running · 2 models · 23m");
  assert.equal(formatSummary(summary, ctxOf(snap, { locale: "ko", minute: 1_000 + 83 * 60_000 })), "wave 3/5 · 2/6 완료 · 1 실행 중 · 모델 2개 · 1시간 23분");

  const plain = summarize(snapshot(planTasks({ "triage-plan": "completed", "heavy-design": "blocked" })));
  assert.equal(formatSummary(plain, ctxOf(null)), "wave 2/5 · 1/6 done · 0 running · 1 blocked");
  assert.equal(formatSummary(plain, ctxOf(null, { locale: "ko" })), "wave 2/5 · 1/6 완료 · 0 실행 중 · 1 막힘");
  assert.match(formatSummary(summarize(snapshot([task("only", [], "pending", { model: "opus" })])), ctxOf(null, { locale: "ko" })), /모델 1개/);
  const fresh = summarize(snapshot(planTasks()));
  assert.equal(formatSummary(fresh, ctxOf(null)), "wave 1/5 · 0/6 done · 0 running");
  const done = summarize(snapshot(planTasks(allStatus("completed"))));
  assert.equal(done.allDone, true);
  assert.equal(done.waveCurrent, 5);
  assert.equal(formatSummary(done, ctxOf(null)), "wave 5/5 · 6/6 done · 0 running · awaiting goal finish");
  assert.equal(formatSummary(done, ctxOf(null, { locale: "ko" })), "wave 5/5 · 6/6 완료 · 0 실행 중 · goal finish 대기");
  assert.equal(summarize(snapshot([task("only")])).waveTotal, 1);
});

test("10. layoutDag switches between row and column and keeps boxes apart", () => {
  const snap = snapshot(planTasks(inFlight));
  const check = (model, width, orientation) => {
    const layout = layoutDag(model, { width, density: 0 });
    assert.equal(layout.orientation, orientation, `${model.view} at ${width}`);
    assert.equal(layout.width, width);
    for (const box of layout.boxes) {
      assert.ok(box.x >= 0 && box.x + box.w <= width, `${box.id} inside`);
      assert.ok(box.y >= 0 && box.y + box.h <= layout.height);
    }
    for (const [index, one] of layout.boxes.entries()) {
      for (const other of layout.boxes.slice(index + 1)) {
        const apart = one.x + one.w <= other.x || other.x + other.w <= one.x || one.y + one.h <= other.y || other.y + other.h <= one.y;
        assert.ok(apart, `${one.id} and ${other.id} overlap`);
      }
    }
    for (const path of layout.paths) {
      const { x1, y1, x2, y2 } = pathEnds(path.d);
      if (orientation === "row") assert.ok(x1 < x2, `${path.from}->${path.to}`);
      else assert.ok(y1 < y2, `${path.from}->${path.to}`);
    }
    return layout;
  };
  check(buildDagModel(snap, "all"), 380, "column");
  check(buildDagModel(snap, "all"), 240, "column");
  check(buildDagModel(snap, "all"), 900, "row");
  check(buildDagModel(snap, "current"), 380, "row");
  check(buildDagModel(snap, "next"), 240, "column");
  check(buildDagModel(parallel(), "all"), 900, "row");
  check(buildDagModel(parallel(), "all"), 380, "column");
  const many = snapshot(Array.from({ length: 30 }, (_, index) => task(`t${index}`, index >= 5 ? [`t${index - 5}`] : [])));
  check(buildDagModel(many, "all"), 900, "column");
  check(buildDagModel(many, "all"), 1100, "row");
  check(buildDagModel(many, "all"), 380, "column");
  assert.equal(panelWidth(48), 380);
  assert.equal(panelWidth(10), 240);
  assert.equal(panelWidth(1000), 1600);
});

test("11. textWidth and truncateText", () => {
  assert.equal(textWidth("가", 10), 10.5);
  assert.ok(Math.abs(textWidth("ab", 10) - 11.76) < 1e-9);
  assert.equal(truncateText("short", 200, 12), "short");
  const korean = "가".repeat(60);
  const cut = truncateText(korean, 100, 12);
  assert.ok(cut.endsWith("…"));
  assert.ok(textWidth(cut, 12) <= 100);
  const emoji = "😀".repeat(30);
  const emojiCut = truncateText(emoji, 60, 12);
  assert.ok(emojiCut.endsWith("…"));
  assert.ok(textWidth(emojiCut, 12) <= 60);
  for (const char of emojiCut.slice(0, -1)) assert.equal(char, "😀");
  assert.equal(truncateText("é", 100, 12), "é");
});

test("12. renderDagSvg draws solid done edges and flowing active edges", () => {
  const snap = snapshot(planTasks(inFlight));
  const { source, alt, density, omitted } = renderDagSvg(buildDagModel(snap, "all"), { width: 380, epoch: 0, ctx: ctxOf(snap) });
  assert.ok(source.startsWith("<svg"));
  assertWellFormed(source);
  assert.equal(density, 0);
  assert.equal(omitted, 0);
  assert.match(alt, /^Pota goal DAG\. wave 3\/5, 2\/6 done, 1 running\. Running: mod-panel/);
  assert.match(source, /\.flow\{[^}]*stroke-dasharray/);
  assert.doesNotMatch(source.match(/\.done\{[^}]*\}/)[0], /dasharray/);
  const flows = source.match(/class="e flow"/g) ?? [];
  assert.equal(flows.length, 1);
  assert.equal((source.match(/<animateMotion/g) ?? []).length, 1);
  assert.equal((source.match(/class="e done"/g) ?? []).length, 1);
  const done = snapshot(planTasks(allStatus("completed")));
  const finished = renderDagSvg(buildDagModel(done, "all"), { width: 900, epoch: 0, ctx: ctxOf(done) }).source;
  assertWellFormed(finished);
  assert.doesNotMatch(finished, /animateMotion|class="e flow"|class="pulse"/);
  assert.equal((finished.match(/class="e done"/g) ?? []).length, 6);
  const empty = renderDagSvg(buildDagModel(snapshot(planTasks()), "previous"), { width: 380, epoch: 0, ctx: ctxOf(null) });
  assertWellFormed(empty.source);
  assert.ok(empty.alt.length > 0);
});

test("13. escapeXml and no active content in the markup", () => {
  assert.equal(escapeXml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
  assert.equal(escapeXml("a\u0001b\u0008c\tok\uD800z￾"), "abc\tokz");
  assert.equal(escapeXml("😀"), "😀");
  const hostile = "</text><script>alert(1)</script> onload=x javascript:x https://evil.example";
  const snap = snapshot(planTasks(inFlight).map((one) => ({ ...one, title: hostile, blocker: hostile, assignedAgentId: hostile })), { title: hostile });
  for (const view of ["previous", "current", "next", "all"]) {
    const { source, alt } = renderDagSvg(buildDagModel(snap, view), { width: 380, epoch: 0, ctx: ctxOf(snap) });
    assertWellFormed(source);
    assert.doesNotMatch(source, /<script/i);
    assert.ok(alt.length > 0);
    for (const one of tags(source)) {
      assert.doesNotMatch(one, /\son[a-z]+\s*=/i);
      assert.doesNotMatch(one, /href\s*=/i);
      assert.doesNotMatch(one, /javascript:/i);
      assert.doesNotMatch(one.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, ""), /https?:/i);
    }
  }
});

test("14. renderDagSvg is deterministic and only the phase follows epoch", () => {
  const snap = snapshot(planTasks(inFlight));
  const model = buildDagModel(snap, "all");
  const first = renderDagSvg(model, { width: 380, epoch: 1234, ctx: ctxOf(snap) });
  const again = renderDagSvg(buildDagModel(snapshot(planTasks(inFlight)), "all"), { width: 380, epoch: 1234, ctx: ctxOf(snap) });
  assert.equal(first.source, again.source);
  // Agents never reach the SVG: two drawings that differ only in the agent list agree.
  const rowsA = runningRows(snap, {}, [], ctxOf(snap));
  const rowsB = runningRows(snap, { a1: "mod-panel" }, [{ id: "a1", name: "w", description: "", model: null, parentId: null, mentions: [], status: "running", activity: "Read x", activityAt: 0, calls: 1 }], ctxOf(snap));
  assert.notDeepEqual(rowsA, rowsB);
  assert.equal(renderDagSvg(model, { width: 380, epoch: 1234, ctx: ctxOf(snap) }).source, first.source);
  const later = renderDagSvg(model, { width: 380, epoch: 1834, ctx: ctxOf(snap) });
  assert.notEqual(later.source, first.source);
  const strip = (source) => source.replace(/(begin="|animation-delay:)-[\d.]+s/g, "$1PHASE");
  assert.equal(strip(later.source), strip(first.source));
});

test("15. renderDagSvg stays under the Svg limit", () => {
  const big = [];
  for (let wave = 0; wave < 20; wave += 1) {
    for (let lane = 0; lane < 20; lane += 1) {
      const id = `task-${wave}-${lane}`;
      const status = wave < 8 ? "completed" : wave === 8 && lane < 4 ? "active" : "pending";
      big.push(task(id, wave ? [`task-${wave - 1}-${lane}`, `task-${wave - 1}-${(lane + 1) % 20}`] : [], status, {
        title: `작업 ${wave}-${lane} 한글 제목이 꽤 길게 이어집니다`,
        requiredEvidence: ["moduleAcceptance", "surfaceIntegration"],
      }));
    }
  }
  const snap = snapshot(big);
  const result = renderDagSvg(buildDagModel(snap, "all"), { width: 900, epoch: 0, ctx: ctxOf(snap) });
  assert.ok(result.source.length <= 131072, `length ${result.source.length}`);
  assert.ok(result.density >= 1);
  assert.equal(typeof result.omitted, "number");
  if (result.omitted > 0) assert.match(result.source, new RegExp(`\\+${result.omitted} tasks omitted`));
  assert.ok(result.alt.length > 0);
  assertWellFormed(result.source);

  const thirty = snapshot(big.slice(0, 30));
  const small = renderDagSvg(buildDagModel(thirty, "all"), { width: 900, epoch: 0, ctx: ctxOf(thirty) });
  assert.equal(small.density, 0);
  assert.equal(small.omitted, 0);
});

test("16. textRows fit the columns and follow the view", () => {
  const snap = snapshot(planTasks(inFlight).map((one) => ({ ...one, title: `${one.id} 한글 제목 ${"x".repeat(40)}`, route: "heavy", model: "opus", effort: "high" })));
  for (const columns of [24, 40, 80]) {
    const rows = textRows(buildDagModel(snap, "all"), ctxOf(snap), columns);
    for (const row of rows) assert.ok(cellWidth(row.text) <= columns, `${row.text} at ${columns}`);
    assert.ok(rows.some((row) => row.text.startsWith("Wave 1")));
  }
  const previous = textRows(buildDagModel(snap, "previous"), ctxOf(snap), 120).filter((row) => row.text.startsWith("  "));
  assert.deepEqual(previous.map((row) => row.text.trim().split(/\s+/)[1]), ["triage-plan", "heavy-design"]);
  const current = textRows(buildDagModel(snap, "current"), ctxOf(snap), 120);
  assert.ok(current.some((row) => row.tone === "run" && row.text.includes("mod-panel")));
  const empty = textRows(buildDagModel(snapshot(planTasks()), "previous"), ctxOf(null, { locale: "ko" }), 80);
  assert.deepEqual(empty.map((row) => row.text), ["아직 완료된 task가 없습니다."]);
});

test("17. parsePotaGoalCommand", () => {
  assert.deepEqual(parsePotaGoalCommand('node "/x/scripts/pota.mjs" goal start --plan docs/plan/a.md'), { subs: ["start"], mutates: true, planned: true, root: null });
  assert.deepEqual(parsePotaGoalCommand("pota goal replan --root /repo/a"), { subs: ["replan"], mutates: true, planned: true, root: "/repo/a" });
  assert.deepEqual(parsePotaGoalCommand("cd x && node scripts/pota.mjs goal task --task a --status completed"), { subs: ["task"], mutates: true, planned: false, root: null });
  assert.deepEqual(parsePotaGoalCommand("/usr/bin/pota goal receipt --root='/r p' && pota goal status"), { subs: ["receipt", "status"], mutates: true, planned: false, root: "/r p" });
  assert.equal(parsePotaGoalCommand("git status"), null);
  assert.equal(parsePotaGoalCommand("pota memory check"), null);
  assert.equal(parsePotaGoalCommand("npm run goal"), null);
  for (const sub of ["status", "ready", "stats"]) assert.equal(parsePotaGoalCommand(`pota goal ${sub}`).mutates, false);
  assert.equal(parsePotaGoalCommand("pota goal finish").planned, false);
  assert.equal(parsePotaGoalCommand('pota goal assign --root "/a b/c"').root, "/a b/c");
  assert.equal(parsePotaGoalCommand("pota goal verify --root=/abs/x").root, "/abs/x");
  assert.deepEqual(parsePotaGoalCommand('P="/x/scripts/pota.mjs"; node "$P" goal start --plan a.md'), { subs: ["start"], mutates: true, planned: true, root: null });
  assert.deepEqual(parsePotaGoalCommand("POTA=/x/pota.mjs; node ${POTA} goal replan --quiet"), { subs: ["replan"], mutates: true, planned: true, root: null });
  assert.equal(parsePotaGoalCommand('X=1; node "$X" goal start'), null);
  assert.equal(parsePotaGoalCommand('P=/x/pota.mjs; node "$P" goal bogus'), null);
});

test("18. extractTaskMentions and resolveAgentTasks", () => {
  const ids = ["mod-panel", "docs", "verify"];
  assert.deepEqual(extractTaskMentions("Implement `mod-panel`; read `docs/plan/x.md`", ids), ["mod-panel"]);
  assert.deepEqual(extractTaskMentions('task "docs" and --task verify', ids), ["docs", "verify"]);
  assert.deepEqual(extractTaskMentions("docs verify mod-panel --task verify-later", ids), []);

  const agent = (id, extra = {}) => ({ id, name: null, description: "", model: null, parentId: null, mentions: [], status: "running", activity: "", activityAt: 0, calls: 0, ...extra });
  const tasks = [
    task("a", [], "active", { assignedAgentId: "worker-a" }),
    task("b", [], "active", { assignedAgentId: "worker-b" }),
    task("c", [], "active", { assignedAgentId: null }),
    task("d", [], "completed"),
  ];
  // 1. assignedAgentId equals the agent's id or name.
  assert.deepEqual(resolveAgentTasks([agent("worker-a"), agent("x1", { name: "worker-b" })], tasks), { "worker-a": "a", x1: "b" });
  // 2. a child follows its parent.
  assert.deepEqual(resolveAgentTasks([agent("p", { name: "worker-a" }), agent("kid", { parentId: "p" })], tasks), { p: "a", kid: "a" });
  // 3. one mention, or several of which one is active.
  assert.deepEqual(resolveAgentTasks([agent("m1", { mentions: ["b"] })], tasks), { m1: "b" });
  assert.deepEqual(resolveAgentTasks([agent("m2", { mentions: ["d", "b"] })], tasks), { m2: "b" });
  assert.deepEqual(resolveAgentTasks([agent("m3", { mentions: ["a", "b"] })], tasks), {});
  // 4. one unlinked assigned active task and one unlinked running root agent.
  const lone = [task("a", [], "active", { assignedAgentId: "alias" }), task("c", [], "active")];
  assert.deepEqual(resolveAgentTasks([agent("engine-1")], lone), { "engine-1": "a" });
  // 5. ambiguous: two candidates either way.
  assert.deepEqual(resolveAgentTasks([agent("engine-1"), agent("engine-2")], lone), {});
  assert.deepEqual(resolveAgentTasks([agent("engine-1")], tasks), {});
  // The main loop goes to the one active task nobody was assigned.
  assert.deepEqual(resolveAgentTasks([agent("main", { name: "main" })], tasks), { main: "c" });

  const spawned = reduceAgents([], { type: "spawn", id: "s1", name: "w", description: "d", model: "opus", parentId: null, mentions: ["a"], at: 5 });
  assert.equal(spawned[0].status, "running");
  const called = reduceAgents(spawned, { type: "call", id: "s1", activity: "Read a.md", at: 9 });
  assert.equal(called[0].calls, 1);
  assert.equal(called[0].activity, "Read a.md");
  assert.equal(reduceAgents(called, { type: "done", id: "s1", at: 10 })[0].status, "done");
  assert.equal(reduceAgents(called, { type: "sync", running: [] })[0].status, "done");
  let many = [];
  for (let index = 0; index < 20; index += 1) many = reduceAgents(many, { type: "spawn", id: `s${index}`, name: null, description: "", model: null, parentId: null, mentions: [], at: index });
  assert.equal(many.length, 16);
  assert.equal(many.at(-1).id, "s19");
});

test("19. describeToolCall stays short and drops arguments", () => {
  const secret = "curl -H Authorization:Bearer TOKEN123 https://x.example/api";
  for (const command of [secret, "API_KEY=abc cd /tmp && psql -U admin -W hunter2 db", 'node "/very/long/path/scripts/pota.mjs" goal receipt --task a --kind b -- npm test']) {
    const line = describeToolCall({ tool: "Bash", command });
    assert.ok(line.length <= 40, line);
    assert.doesNotMatch(line, /TOKEN123|hunter2|https|-W|x\.example/);
  }
  assert.equal(describeToolCall({ tool: "Bash", command: "API_KEY=abc cd /tmp && git status --short --branch" }), "$ git status --short");
  assert.equal(describeToolCall({ tool: "Bash", command: 'node "/x/scripts/pota.mjs" goal receipt --task a' }), "pota goal receipt");
  assert.equal(describeToolCall({ tool: "Bash", command: "node /a/b/c.mjs --flag" }), "$ node c.mjs --flag");
  assert.equal(describeToolCall({ tool: "Read", file_path: "/repo/hooks/register.tsx" }), "Read register.tsx");
  assert.equal(describeToolCall({ tool: "Grep", pattern: "renderDagSvg" }), "Grep renderDagSvg");
  assert.equal(describeToolCall({ tool: "Agent", description: "Implement the pane" }), "Agent: Implement the pane");
  assert.equal(describeToolCall({ tool: "mcp__serena__find_symbol", name_path: "x" }), "serena:find_symbol");
  assert.ok(describeToolCall({ tool: "Grep", pattern: "x".repeat(80) }).length <= 40);
});

test("20. parseGoalStatus", () => {
  assert.deepEqual(parseGoalStatus("null\n"), { snapshot: null, error: null });
  assert.ok(parseGoalStatus("{oops").error);
  assert.ok(parseGoalStatus('{"goal":{}}').error);
  assert.ok(parseGoalStatus("").error);
  const raw = {
    schemaVersion: 3,
    revision: 4,
    future: { anything: true },
    goal: { id: "goal-x", title: "G", planId: "p.md", status: "active", requiredEvidence: ["finalReview"], blocker: null, createdAt: "2026-11-18T03:34:32.539Z", extra: 1 },
    tasks: [
      { id: "a", title: "A", status: "completed", dependsOn: [], assignedAgentId: null, requiredEvidence: ["planArtifact"], route: "heavy", kind: "design", effort: "high", model: "fable", effectiveModel: "claude-fable-5-2", writeScope: ["x"], blocker: null, createdAt: "2026-11-18T03:34:32.539Z", updatedAt: "2026-11-18T03:36:47.184Z", unknown: 1 },
      { id: "b", title: "B", status: "weird", dependsOn: ["a", "ghost", "b"], requiredEvidence: ["moduleAcceptance", "surfaceIntegration"] },
    ],
    receipts: [
      { scope: "task", kind: "planArtifact", taskId: "a" },
      { scope: "task", kind: "moduleAcceptance", taskId: "b" },
      { scope: "task", kind: "moduleAcceptance", taskId: "b" },
      { scope: "goal", kind: "finalReview" },
    ],
  };
  const { snapshot: parsed, error } = parseGoalStatus(JSON.stringify(raw));
  assert.equal(error, null);
  assert.equal(parsed.goalId, "goal-x");
  assert.equal(parsed.revision, 4);
  assert.equal(parsed.createdAt, Date.parse("2026-11-18T03:34:32.539Z"));
  assert.deepEqual(parsed.evidence, ["finalReview"]);
  const [a, b] = parsed.tasks;
  assert.deepEqual(a.evidence, ["planArtifact"]);
  assert.equal(a.kind, "design");
  assert.equal(a.route, "heavy");
  assert.equal(a.updatedAt, Date.parse("2026-11-18T03:36:47.184Z"));
  assert.equal("unknown" in a, false);
  assert.equal(b.status, "pending");
  assert.deepEqual(b.dependsOn, ["a"]);
  assert.deepEqual(b.evidence, ["moduleAcceptance"]);
  assert.equal(b.route, null);
  assert.equal(b.writeScope, null);
});

test("21. reduceDagState keeps seq for equal content and records endings", () => {
  const one = snapshot(planTasks(inFlight).map((item) => ({ ...item, updatedAt: 100 })), { goalId: "goal-1" });
  let state = reduceDagState(null, { snapshot: one, error: null, now: 500 });
  assert.equal(state.seq, 1);
  assert.equal(state.timeline["mod-panel"].activeAt, 100);
  assert.equal(state.timeline["triage-plan"].completedAt, 100);
  state = reduceDagState(state, { snapshot: structuredClone(one), error: null, now: 600 });
  assert.equal(state.seq, 1);
  assert.equal(state.fetchedAt, 600);
  const failed = reduceDagState(state, { snapshot: null, error: "boom", now: 700 });
  assert.equal(failed.seq, 1);
  assert.equal(failed.error, "boom");
  assert.equal(failed.snapshot, state.snapshot);
  const moved = structuredClone(one);
  moved.tasks[2] = { ...moved.tasks[2], status: "completed", updatedAt: 900 };
  state = reduceDagState(failed, { snapshot: moved, error: null, now: 950 });
  assert.equal(state.seq, 2);
  assert.equal(state.error, null);
  assert.deepEqual(state.timeline["mod-panel"], { activeAt: 100, completedAt: 900 });

  const completed = reduceDagState(state, { snapshot: null, error: null, now: 2000, recent: [{ goalId: "goal-1", status: "completed", endedAt: "2026-11-18T05:00:00.000Z" }] });
  assert.equal(completed.seq, 3);
  assert.deepEqual(completed.ended, { status: "completed", endedAt: Date.parse("2026-11-18T05:00:00.000Z") });
  assert.ok(completed.snapshot.tasks.every((item) => item.status === "completed"));
  assert.equal(completed.snapshot.status, "completed");
  assert.equal(reduceDagState(completed, { snapshot: null, error: null, now: 3000, recent: [] }).seq, 3);

  const cancelled = reduceDagState(state, { snapshot: null, error: null, now: 2000, recent: [{ goalId: "goal-1", status: "cancelled", endedAt: "2026-11-18T05:00:00.000Z" }] });
  assert.equal(cancelled.ended.status, "cancelled");
  assert.equal(cancelled.snapshot.tasks[3].status, "pending");
  const unknown = reduceDagState(state, { snapshot: null, error: null, now: 2000, recent: [{ goalId: "other", status: "completed", endedAt: null }] });
  assert.deepEqual(unknown.ended, { status: "unknown", endedAt: null });
  const none = reduceDagState(null, { snapshot: null, error: null, now: 1 });
  assert.equal(none.snapshot, null);
  assert.equal(none.ended, null);
  const next = reduceDagState(completed, { snapshot: { ...one, goalId: "goal-2" }, error: null, now: 4000 });
  assert.equal(next.ended, null);
  assert.equal(next.seq, 4);
});

test("22. shouldAutoOpen", () => {
  const snap = snapshot(planTasks());
  const ui = { view: "current", epoch: 0, minute: 0, autoOpenedPlanKey: null, closedGoalId: null };
  assert.equal(shouldAutoOpen({ planned: true, snapshot: snap, ui, paneOpen: false }), true);
  assert.equal(shouldAutoOpen({ planned: false, snapshot: snap, ui, paneOpen: false }), false);
  assert.equal(shouldAutoOpen({ planned: true, snapshot: snap, ui, paneOpen: true }), false);
  const opened = { ...ui, autoOpenedPlanKey: planKey(snap) };
  assert.equal(shouldAutoOpen({ planned: true, snapshot: snap, ui: opened, paneOpen: false }), false);
  const replanned = snapshot([...planTasks(), task("extra", ["verify"])]);
  assert.equal(shouldAutoOpen({ planned: true, snapshot: replanned, ui: opened, paneOpen: false }), true);
  const closed = { ...opened, closedGoalId: "goal-1" };
  assert.equal(shouldAutoOpen({ planned: true, snapshot: replanned, ui: closed, paneOpen: false }), false);
  assert.equal(shouldAutoOpen({ planned: true, snapshot: { ...replanned, goalId: "goal-2" }, ui: closed, paneOpen: false }), true);
  assert.equal(shouldAutoOpen({ planned: true, snapshot: null, ui, paneOpen: false }), false);
});

test("23. nextRefreshDelay", () => {
  assert.equal(nextRefreshDelay({ now: 10_000, lastRunAt: 0, failures: 0, reason: "goal" }), 300);
  assert.equal(nextRefreshDelay({ now: 10_000, lastRunAt: 9_800, failures: 0, reason: "goal" }), 800);
  assert.equal(nextRefreshDelay({ now: 10_000, lastRunAt: 9_000, failures: 2, reason: "poll" }), 300);
  assert.equal(nextRefreshDelay({ now: 10_000, lastRunAt: 9_000, failures: 3, reason: "poll" }), 119_000);
  assert.equal(nextRefreshDelay({ now: 10_000, lastRunAt: 9_000, failures: 5, reason: "goal" }), 300);
  assert.equal(nextRefreshDelay({ now: 10_000, lastRunAt: 9_000, failures: 5, reason: "command" }), 300);
});

test("text helpers: locale, elapsed, card lines and running rows", () => {
  assert.equal(pickLocale([undefined, "", "ko_KR.UTF-8"]), "ko");
  assert.equal(pickLocale(["C.UTF-8", "ko_KR.UTF-8"]), "en");
  assert.equal(pickLocale([]), "en");
  assert.equal(formatElapsed(30_000, "ko"), "1분 미만");
  assert.equal(formatElapsed(12 * 60_000, "ko"), "12분");
  assert.equal(formatElapsed(72 * 60_000, "ko"), "1시간 12분");
  assert.equal(formatElapsed(72 * 60_000, "en"), "1h 12m");
  assert.equal(formatElapsed(-5, "en"), "<1m");

  const snap = snapshot(planTasks(inFlight).map((one) => one.id === "heavy-design"
    ? { ...one, kind: "design", route: "heavy", model: "fable", effort: "high", assignedAgentId: "design-fable", requiredEvidence: ["designRecord"], evidence: ["designRecord"] }
    : one.id === "mod-panel"
      ? { ...one, route: "heavy", model: "opus", effort: "high", assignedAgentId: "worker-mod-panel", requiredEvidence: ["moduleAcceptance", "surfaceIntegration"], evidence: ["moduleAcceptance"] }
      : one));
  const model = buildDagModel(snap, "all");
  const node = (id) => model.nodes.find((item) => item.id === id);
  const ctx = ctxOf(snap, { locale: "ko", minute: 13 * 60_000, timeline: { "mod-panel": { activeAt: 60_000 }, "heavy-design": { activeAt: 0, completedAt: 4 * 60_000 } } });
  const active = cardLines(node("mod-panel"), ctx);
  assert.equal(active.status, "실행 중 · 12분");
  assert.equal(active.meta, "heavy · opus · high · @worker-mod-panel");
  assert.equal(active.progress, "증거 ●○ 1/2");
  assert.match(active.tooltip, /mod-panel/);
  const design = cardLines(node("heavy-design"), ctx);
  assert.equal(design.status, "완료 · 4분");
  assert.equal(design.meta, "design · heavy · fable · high · @design-fable");
  assert.equal(cardLines(node("install-wiring"), ctx).status, "대기 · 선행 1개");
  assert.equal(cardLines(node("install-wiring"), { ...ctx, locale: "en" }).status, "waiting · 1 dep");

  const rows = runningRows(snap, { s1: "mod-panel" }, [
    { id: "s1", name: "worker", description: "", model: "opus", parentId: null, mentions: [], status: "running", activity: "Read register.tsx", activityAt: 0, calls: 7 },
    { id: "s2", name: "stray", description: "", model: null, parentId: null, mentions: [], status: "running", activity: "Grep x", activityAt: 0, calls: 1 },
  ], ctx);
  assert.ok(rows.some((row) => row.tone === "run" && row.text.includes("Task mod-panel")));
  assert.ok(rows.some((row) => row.text.includes("Read register.tsx") && row.text.includes("7")));
  assert.ok(rows.some((row) => row.text.includes("stray")));
  // The running task names the evidence it still lacks; what comes next names what it waits on.
  const lacking = snapshot([task("a", [], "active", { requiredEvidence: ["moduleAcceptance", "surfaceIntegration"], evidence: ["moduleAcceptance"] }), task("b", ["a"]), task("c", ["b"]), task("d")]);
  const texts = runningRows(lacking, {}, [], { ...ctx, snapshot: lacking, timeline: {} }).map((row) => row.text);
  assert.ok(texts.includes("  남은 증거: surfaceIntegration"));
  assert.ok(texts.includes("다음 차례"));
  assert.ok(texts.includes("○ Task b ← Task a"));
  assert.ok(texts.includes("○ Task d"));
  assert.ok(!texts.some((text) => text.includes("Task c")));
});

test("default view is all: an unset or unknown view builds the all model and register starts on all", () => {
  const snap = snapshot(planTasks(allStatus("completed")));
  const all = buildDagModel(snap, "all");
  assert.equal(all.view, "all");
  assert.deepEqual(buildDagModel(snap, undefined), all);
  assert.deepEqual(buildDagModel(snap, "bogus"), all);
  const register = readFileSync(join(modRoot, "hooks/register.tsx"), "utf8");
  const dagUi = register.slice(register.indexOf("const dagUi = atom("), register.indexOf("const dagAgents"));
  assert.match(dagUi, /view: "all"/);
  assert.match(dagUi, /tab: "dag"/);
  assert.match(dagUi, /expandedTaskId: null/);
  assert.match(dagUi, /selectedTaskId: null/);
  assert.match(dagUi, /actionError: null/);
  assert.match(dagUi, /\{ shape: "ui-3" \}/);
  const dagCtx = register.slice(register.indexOf("const dagContext = atom("));
  assert.match(dagCtx, /diff: null/);
  assert.match(dagCtx, /planOverview: null/);
  assert.match(dagCtx, /gitCheckedAt: 0/);
  assert.match(dagCtx, /\{ shape: "ctx-1" \}/);
});

test("a running task names the subagent's engine id to open, and none when main works on it", () => {
  const snap = snapshot([
    task("a", [], "completed"),
    task("sub", ["a"], "active", { assignedAgentId: "worker-sub" }),
    task("own", ["a"], "active"),
  ]);
  const agents = [
    { id: "agent-7f3", name: "worker-sub", description: "", model: "opus", parentId: null, mentions: [], status: "running", activity: "Read x", activityAt: 0, calls: 2 },
    { id: "main", name: "main", description: "", model: null, parentId: null, mentions: [], status: "running", activity: "Edit y", activityAt: 0, calls: 1 },
  ];
  const linked = resolveAgentTasks(agents, snap.tasks);
  assert.deepEqual(linked, { "agent-7f3": "sub", main: "own" });
  const running = detailSections(snap, linked, agents, { locale: "en", minute: 0, timeline: {}, snapshot: snap }).running;
  assert.deepEqual(running.map((item) => [item.id, item.agentId, item.who]), [["sub", "agent-7f3", "@worker-sub"], ["own", null, "main"]]);
  // A task assigned in the plan with no agent heard yet has nothing to open either.
  const quiet = detailSections(snap, {}, [], { locale: "en", minute: 0, timeline: {}, snapshot: snap }).running;
  assert.deepEqual(quiet.map((item) => item.agentId), [null, null]);
  // When main touched the task last, the subagent on it is still what opens.
  const both = detailSections(snap, { "agent-7f3": "sub", main: "sub" }, [agents[0], { ...agents[1], activityAt: 9 }], { locale: "en", minute: 0, timeline: {}, snapshot: snap }).running;
  assert.deepEqual([both[0].agentId, both[0].who], ["agent-7f3", "main"]);
  // The rows a text-only surface draws are unchanged by the id.
  assert.deepEqual(runningRows(snap, linked, agents, { locale: "en", minute: 0, timeline: {}, snapshot: snap }).slice(0, 2).map((row) => row.text), ["● Task sub", "  @worker-sub · Read x · 2 calls"]);
});

test("a main-run task's detail lists scope, models, effort, dependencies, evidence and blocker in both languages", () => {
  const one = task("own", ["a", "b"], "active", {
    writeScope: ["hooks/register.tsx", "tests/pane.test.tsx"], model: "opus", effectiveModel: "claude-opus", effort: "medium",
    requiredEvidence: ["moduleAcceptance", "surfaceIntegration"], evidence: ["moduleAcceptance"], blocker: "waiting on review",
  });
  assert.deepEqual(taskDetail(one, "en"), [
    "scope: hooks/register.tsx, tests/pane.test.tsx",
    "model: opus · effective: claude-opus · effort: medium",
    "after: a, b",
    "evidence required: moduleAcceptance, surfaceIntegration",
    "evidence recorded: moduleAcceptance",
    "blocker: waiting on review",
  ]);
  assert.deepEqual(taskDetail(task("bare", [], "active"), "ko"), [
    "범위: 없음",
    "모델: 없음 · 적용 모델: 없음 · effort: 없음",
    "선행: 없음",
    "증거 필요: 없음",
    "증거 기록: 없음",
  ]);
  for (const locale of ["en", "ko"]) {
    const words = messages(locale);
    for (const key of ["backToMain", "viewing", "viewDenied", "effectiveModel", "effort", "required", "recorded", "blocker", "none"]) {
      assert.equal(typeof words[key], "string", `${locale}.${key}`);
      assert.ok(words[key].length > 0, `${locale}.${key}`);
    }
  }
  assert.equal(messages("en").backToMain, "Back to main");
  assert.equal(messages("ko").backToMain, "메인으로");
  assert.equal(messages("en").viewDenied, "Could not open the agent: ");
  assert.equal(messages("ko").viewDenied, "에이전트 대화를 열지 못했습니다: ");
});

test("parseGoalStatus normalizes approvalGate, receipts, and transcript enrichment fields", () => {
  const raw = {
    schemaVersion: 3,
    revision: 2,
    goal: { id: "goal-s2", title: "S2 Goal", planId: "docs/plan/s2.md", status: "paused", requiredEvidence: ["finalReview"], createdAt: 1000 },
    tasks: [
      {
        id: "t1",
        title: "Task 1",
        status: "completed",
        dependsOn: [],
        requiredEvidence: ["moduleAcceptance"],
        resolvedModel: "claude-opus-4-6",
        resolvedEffort: "high",
        resolvedTier: "strongest",
        transcript: {
          turns: 4,
          tokens: { input: 1200, cacheRead: 900, output: 300, cacheHitRate: 0.75, truncated: true },
          updatedAt: "2026-11-24T01:00:00Z",
        },
      },
      {
        id: "t2",
        title: "Task 2",
        status: "pending",
        dependsOn: ["t1"],
        approvalGate: true,
        requiredEvidence: ["surfaceIntegration"],
        receipts: [
          {
            kind: "surfaceIntegration",
            command: "node --test test/pane.test.mjs",
            exitCode: 0,
            verifiedAt: "2026-11-24T01:05:00Z",
            fresh: false,
            outputDigest: "sha256:abc",
            workspaceFingerprint: "fp-1",
          },
        ],
      },
    ],
    receipts: [
      {
        scope: "task",
        taskId: "t1",
        kind: "moduleAcceptance",
        command: "npm test",
        exitCode: 0,
        timestamp: 2000,
        fresh: true,
        outputDigest: "sha256:123",
        watchFingerprint: "fp-0",
      },
    ],
  };

  const { snapshot: parsed, error } = parseGoalStatus(JSON.stringify(raw));
  assert.equal(error, null);
  assert.equal(parsed.status, "paused");
  const [t1, t2] = parsed.tasks;
  assert.equal(t1.resolvedModel, "claude-opus-4-6");
  assert.equal(t1.resolvedEffort, "high");
  assert.equal(t1.resolvedTier, "strongest");
  assert.deepEqual(t1.transcript, {
    turns: 4,
    tokens: { input: 1200, cacheRead: 900, output: 300, cacheHitRate: 0.75, truncated: true },
    updatedAt: "2026-11-24T01:00:00Z",
  });
  assert.equal(t1.receipts.length, 1);
  assert.equal(t1.receipts[0].fresh, true);
  assert.equal(t1.receipts[0].watchFingerprint, "fp-0");
  assert.equal(t2.approvalGate, true);
  assert.equal(t2.receipts.length, 1);
  assert.equal(t2.receipts[0].fresh, false);
  assert.equal(t2.receipts[0].watchFingerprint, "fp-1");
});

test("pure Git/Plan helpers validate paths, parse porcelain/numstat, filter scope, and summarize plans", () => {
  for (const sensitive of [".env", ".env.local", "config/.env.prod", "certs/server.pem", "id_rsa", "auth/credentials.json", "my-secret.txt", "oauth-token.json", ".npmrc", ".envrc", ".env-local", ".env_prod", "service-account.json", "config/.envrc", "app/.env-local", "deploy/.env_prod", "keys/service-account-prod.json"]) {
    assert.equal(isSensitiveRepoPath(sensitive), true, sensitive);
  }
  for (const safe of ["hooks/register.tsx", "docs/plan/x.md", "src/tokenizer.ts", "environment.ts", "src/env.ts", "src/environment/config.ts", "service-account.ts"]) {
    assert.equal(isSensitiveRepoPath(safe), false, safe);
  }
  assert.equal(normalizeRepoPath("./hooks//register.tsx"), "hooks/register.tsx");
  for (const bad of ["", "/abs/path.md", "C:\\win\\a.md", "../escape.md", "a/../b/../../c.md", "-rf", "hooks/*.tsx", "a\0b"]) {
    assert.equal(normalizeRepoPath(bad), null, bad);
  }

  const statusZ = " M hooks/register.tsx\0?? .env.local\0R  hooks/new.tsx\0hooks/old.tsx\0";
  const unstagedZ = "10\t2\thooks/register.tsx\0-\t-\tassets/logo.png\0";
  const stagedZ = "5\t1\t\0hooks/old.tsx\0hooks/new.tsx\0";
  const diff = parseGitStatusAndNumstat(statusZ, unstagedZ, stagedZ);
  assert.equal(diff.available, true);
  assert.equal(diff.totals.files, 4);
  assert.equal(diff.totals.added, 15);
  assert.equal(diff.totals.deleted, 3);
  assert.equal(diff.files.find((f) => f.path === ".env.local")?.sensitive, true);
  assert.equal(diff.files.find((f) => f.path === "assets/logo.png")?.binary, true);
  assert.equal(diff.files.find((f) => f.path === "hooks/new.tsx")?.added, 5);

  const scoped = filterDiffByScope(diff, ["hooks", "../outside.ts"]);
  assert.equal(scoped.available, true);
  assert.deepEqual(scoped.files.map((f) => f.path), ["hooks/register.tsx", "hooks/new.tsx"]);
  assert.deepEqual(scoped.totals, { files: 2, added: 15, deleted: 3 });

  const planMd = [
    "# Plan: S2 Dashboard",
    "",
    "## Goal",
    "",
    "Implement the 4-tab DAG dashboard across all hosts.",
    "Preserve existing subagent navigation.",
    "",
    "- Current request (as of S2): Add 4 tabs and inspector.",
    "",
    "```md",
    "- [ ] ignored inside fence",
    "```",
    "",
    "## Status",
    "- [x] Design approved",
    "- [ ] Tests written",
  ].join("\n");
  const overview = parsePlanOverview(planMd, { planId: "docs/plan/s2.md", truncated: true });
  assert.equal(overview.planId, "docs/plan/s2.md");
  assert.equal(overview.truncated, true);
  assert.equal(overview.title, "Plan: S2 Dashboard");
  assert.equal(overview.goalSummary, "Implement the 4-tab DAG dashboard across all hosts. Preserve existing subagent navigation.");
  assert.equal(overview.currentRequest, "Add 4 tabs and inspector.");
  assert.deepEqual(overview.checklist, {
    done: 1,
    pending: 1,
    total: 2,
    items: [
      { done: true, text: "Design approved" },
      { done: false, text: "Tests written" },
    ],
  });
});

test("renderDagSvg wraps each card in <g class=\"card\" data-task-id> and draws approvalGate badge", () => {
  const snap = snapshot([
    task("a", [], "completed"),
    task("b", ["a"], "pending", { approvalGate: true }),
  ]);
  const { source } = renderDagSvg(buildDagModel(snap, "all"), { width: 500, epoch: 0, ctx: ctxOf(snap) });
  assertWellFormed(source);
  assert.match(source, /<g class="card" data-task-id="a">/);
  assert.match(source, /<g class="card" data-task-id="b">/);
  assert.match(source, /⏸ Gate/);
});
