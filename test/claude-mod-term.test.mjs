import test from "node:test";
import assert from "node:assert/strict";
import { buildDagModel } from "../claude-mod/hooks/dag-model.mjs";
import { cellWidth, textRows, waveHeader } from "../claude-mod/hooks/dag-text.mjs";
import * as dagTerm from "../claude-mod/hooks/dag-term.mjs";
import { termBoxLayout, termGraph } from "../claude-mod/hooks/dag-term.mjs";

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

const ctxOf = (snap, extra = {}) => ({ locale: "en", minute: 0, timeline: {}, snapshot: snap, ...extra });
const titled = (id, dependsOn, status) => task(id, dependsOn, status, { title: id });

// triage done; api and ui running after it; docs pending after it; integrate waits on the three.
const demo = (titleOf = (id) => id) => snapshot([
  ["triage", [], "completed"],
  ["api", ["triage"], "active"],
  ["ui", ["triage"], "active"],
  ["docs", ["triage"], "pending"],
  ["integrate", ["api", "ui", "docs"], "pending"],
].map(([id, deps, status]) => task(id, deps, status, { title: titleOf(id) })));

const text = (row) => row.map((span) => span.text).join("");
const graph = (snap, view, extra = {}) => {
  const { columns = 56, ...ctx } = extra;
  return termGraph(buildDagModel(snap, view), ctxOf(snap, ctx), { columns });
};
// The rows of the box whose first content line names `id`, from its top border to its bottom border.
const boxOf = (rows, id) => {
  const index = rows.findIndex((row) => text(row).includes(`│ ${id} `));
  const bottom = rows.findIndex((row, at) => at > index && text(row).trimStart().startsWith("╰"));
  return rows.slice(index - 1, bottom + 1);
};
const spanAt = (row, needle) => row.find((span) => span.text.includes(needle));
// Left padding of `cells` spaces before a centered box line or connector.
const at = (cells, row) => " ".repeat(cells) + row;

test("1. termBoxLayout", () => {
  assert.deepEqual(termBoxLayout(56, 3), { per: 2, boxWidth: 27 });
  assert.deepEqual(termBoxLayout(56, 1), { per: 1, boxWidth: 40 });
  assert.deepEqual(termBoxLayout(58, 3), { per: 2, boxWidth: 28 });
  assert.deepEqual(termBoxLayout(80, 5), { per: 3, boxWidth: 25 });
  assert.deepEqual(termBoxLayout(50, 2), { per: 2, boxWidth: 24 });
  assert.deepEqual(termBoxLayout(49, 2), { per: 1, boxWidth: 40 });
  assert.deepEqual(termBoxLayout(24, 2), { per: 1, boxWidth: 24 });
  assert.deepEqual(termBoxLayout(200, 2), { per: 2, boxWidth: 40 });
  assert.equal(termBoxLayout(23, 1), null);
  assert.deepEqual(termBoxLayout(NaN, 1), { per: 1, boxWidth: 40 });
});

test("2. the demo goal in the All view at 56 columns", () => {
  const result = graph(demo(), "all");
  assert.equal(result.mode, "boxes");
  assert.deepEqual(result.rows.map(text), [
    "Wave 1 · 1/1 done",
    at(14, "╭─────────────────────────╮"),
    at(14, "│ triage                  │"),
    at(14, "│ ✓ done                  │"),
    at(14, "│                         │"),
    at(14, "╰─────────────────────────╯"),
    at(27, "┆"),
    at(27, "▼"),
    "Wave 2 · 0/3 done · 2 running",
    "╭─────────────────────────╮  ╭─────────────────────────╮",
    "│ api                     │  │ ui                      │",
    "│ ● running               │  │ ● running               │",
    "│ ← triage                │  │ ← triage                │",
    "╰─────────────────────────╯  ╰─────────────────────────╯",
    at(14, "╭─────────────────────────╮"),
    at(14, "│ docs                    │"),
    at(14, "│ ○ ready                 │"),
    at(14, "│ ← triage                │"),
    at(14, "╰─────────────────────────╯"),
    at(27, "┆"),
    at(27, "▽"),
    "Wave 3 · 0/1 done",
    at(14, "╭─────────────────────────╮"),
    at(14, "│ integrate               │"),
    at(14, "│ · waiting · 3 deps      │"),
    at(14, "│ ← api, ui, docs         │"),
    at(14, "╰─────────────────────────╯"),
  ]);
});

test("3. every row fits the columns with long wide titles", () => {
  const snap = demo((id) => `${id} 한글 제목 ${"가".repeat(30)}`);
  for (const columns of [24, 30, 56, 58, 80, 120]) {
    for (const view of ["previous", "current", "next", "all"]) {
      const result = graph(snap, view, { columns, locale: "ko" });
      assert.equal(result.mode, "boxes", `${view} at ${columns}`);
      for (const row of result.rows) assert.ok(cellWidth(text(row)) <= columns, `${text(row)} at ${columns}`);
      result.rows.forEach((row, index) => {
        if (!text(row).trimStart().startsWith("╭")) return;
        // Every title here needs more than two lines: id, two title lines, status, role.
        const widths = result.rows.slice(index, index + 7).map((one) => cellWidth(text(one)));
        assert.deepEqual(widths, Array(7).fill(widths[0]), `box rows of ${view} at ${columns}`);
        assert.ok(text(result.rows[index + 6]).trimStart().startsWith("╰"), `seven rows of ${view} at ${columns}`);
        assert.ok(!text(result.rows[index + 1]).includes("…"), `${text(result.rows[index + 1])} is not cut`);
        assert.ok(text(result.rows[index + 3]).includes("…"), `${text(result.rows[index + 3])} is cut`);
      });
    }
  }
});

test("4. a wave of five breaks into lines of boxes", () => {
  const snap = snapshot(["a", "b", "c", "d", "e"].map((id) => titled(id, [], "pending")));
  const boxRows = (columns) => graph(snap, "all", { columns }).rows.filter((row) => /^ *[╭│╰].*[╮│╯]$/.test(text(row))).length;
  assert.equal(boxRows(56), 15);
  assert.equal(boxRows(80), 10);
});

test("5. tones of borders, titles and parent lines", () => {
  const all = graph(demo(), "all").rows;
  const border = (id) => spanAt(boxOf(all, id)[0], "╭").tone;
  assert.equal(border("api"), "run");
  assert.equal(border("triage"), "ok");
  assert.equal(border("docs"), "ready");
  assert.equal(border("integrate"), "dim");
  const blocked = snapshot([titled("a", [], "completed"), titled("b", ["a"], "blocked")]);
  assert.equal(spanAt(boxOf(graph(blocked, "all").rows, "b")[0], "╭").tone, "bad");

  const api = boxOf(all, "api");
  assert.equal(spanAt(api[1], "api").bold, true);
  assert.equal(spanAt(api[3], "← triage").tone, "dim");

  const current = graph(demo(), "current").rows;
  for (const row of boxOf(current, "triage")) {
    // A centered line starts with one plain padding span; the box's own spans are all dim.
    assert.deepEqual(row[0], { text: " ".repeat(14), tone: "plain" });
    for (const span of row.slice(1)) {
      assert.equal(span.tone, "dim");
      assert.equal(span.bold, undefined);
    }
  }
});

test("6. wave connectors", () => {
  const connector = (rows, wave) => {
    const index = rows.findIndex((row) => text(row).includes(`Wave ${wave} `));
    return { stem: rows[index - 2], head: rows[index - 1], header: rows[index] };
  };
  const mark = (char, tone, cells = 27) => [{ text: " ".repeat(cells), tone: "plain" }, { text: char, tone }];
  const line = snapshot([titled("a", [], "completed"), titled("b", ["a"], "completed")]);
  const done = connector(graph(line, "all").rows, 2);
  assert.deepEqual(done.stem, mark("│", "ok", 19));
  assert.deepEqual(done.head, mark("▼", "ok", 19));

  const rows = graph(demo(), "all").rows;
  const second = connector(rows, 2);
  assert.deepEqual(second.stem, mark("┆", "run"));
  assert.deepEqual(second.head, mark("▼", "run"));
  assert.deepEqual(second.header, [{ text: "Wave 2 · 0/3 done · 2 running", tone: "dim", bold: true }]);
  const third = connector(rows, 3);
  assert.deepEqual(third.stem, mark("┆", "dim"));
  assert.deepEqual(third.head, mark("▽", "dim"));

  const stuck = snapshot([titled("a", [], "completed"), titled("b", ["a"], "blocked")]);
  assert.deepEqual(connector(graph(stuck, "all").rows, 2).stem, mark("┆", "bad", 19));
  assert.deepEqual(connector(graph(stuck, "all").rows, 2).head, mark("▽", "bad", 19));
  const mixed = snapshot([titled("a", [], "completed"), titled("b", ["a"], "blocked"), titled("c", ["a"], "active")]);
  assert.deepEqual(connector(graph(mixed, "all").rows, 2).head, mark("▼", "run"));

  // a → d skips wave 2; the wave 3 connector merges it with c → d.
  const skip = snapshot([titled("a", [], "completed"), titled("b", [], "completed"), titled("c", ["b"], "completed"), titled("d", ["a", "c"], "active")]);
  const skipRows = graph(skip, "all").rows;
  const skipped = connector(skipRows, 3);
  assert.deepEqual(skipped.stem, mark("┆", "run"));
  assert.deepEqual(skipped.head, mark("▼", "run"));

  // b is done but its parent x is not, so the Previous view shows wave 2 with no edge into it.
  const loose = snapshot([titled("a", [], "completed"), titled("x", [], "pending"), titled("b", ["x"], "completed")]);
  const previous = graph(loose, "previous").rows.map(text);
  const header = previous.findIndex((row) => row.includes("Wave 2"));
  assert.ok(previous[header].startsWith("Wave"));
  assert.equal(previous[header - 1], `╰${"─".repeat(38)}╯`);
});

test("7. wave headers count what is shown", () => {
  const ko = graph(demo(), "current", { locale: "ko" }).rows.map(text);
  assert.ok(ko.some((row) => row.includes("Wave 2 · 0/3 완료 · 2 실행 중 · 2개만 표시")));
  const en = graph(demo(), "current").rows.map(text);
  assert.ok(en.some((row) => row.includes("Wave 2 · 0/3 done · 2 running · showing 2")));
  for (const locale of ["ko", "en"]) {
    const all = graph(demo(), "all", { locale }).rows.map(text);
    assert.ok(!all.some((row) => row.includes("표시") || row.includes("showing")));
  }
  assert.equal(waveHeader({ index: 1, total: 3, completed: 0, active: 2, blocked: 0 }, "ko"), "Wave 2 · 0/3 완료 · 2 실행 중");
});

test("9. the list fallback below 24 columns", () => {
  const snap = demo();
  const model = buildDagModel(snap, "all");
  const result = termGraph(model, ctxOf(snap), { columns: 23 });
  const expected = textRows(model, ctxOf(snap), 23);
  assert.equal(result.mode, "list");
  assert.deepEqual(result.rows.map(text), expected.map((row) => row.text));
  result.rows.forEach((row, index) => {
    assert.equal(row.length, 1);
    assert.equal(row[0].tone, expected[index].tone);
    assert.equal(row[0].bold, expected[index].bold);
  });
});

test("10. empty views", () => {
  const fresh = snapshot([titled("a"), titled("b", ["a"])]);
  assert.deepEqual(graph(fresh, "previous", { locale: "ko" }).rows, [[{ text: "아직 완료된 task가 없습니다.", tone: "dim" }]]);
  const next = graph(demo(), "next", { locale: "ko" }).rows;
  assert.deepEqual(next.at(-1), [{ text: "+1개는 전체 보기에서", tone: "dim" }]);
});

test("12. span hygiene and determinism", () => {
  const snaps = [demo(), demo((id) => `${id} 한글 제목`), snapshot([titled("a", [], "completed"), titled("b", ["a"], "blocked")])];
  for (const snap of snaps) {
    for (const view of ["previous", "current", "next", "all"]) {
      for (const columns of [24, 56, 80]) {
        const first = graph(snap, view, { columns });
        assert.deepEqual(first, graph(snap, view, { columns }));
        for (const row of first.rows) {
          for (const span of row) assert.ok(span.text.length > 0, `empty span in ${view} at ${columns}`);
          for (let i = 1; i < row.length; i += 1) {
            const same = row[i].tone === row[i - 1].tone && (row[i].bold === true) === (row[i - 1].bold === true);
            assert.equal(same, false, `unmerged spans in ${text(row)}`);
          }
        }
      }
    }
  }
});

test("13. short box lines and connectors sit in the middle of the graph width", () => {
  // W = per * boxWidth + 2 * (per - 1); a line of k boxes is padded by floor((W - (k * boxWidth + 2 * (k - 1))) / 2).
  const lead = (row) => text(row).length - text(row).trimStart().length;
  const lineStarts = (rows) => rows.filter((row) => /^ *╭/.test(text(row))).map(lead);

  // A single box under per = 2: W = 56 at 56 columns (box 27), W = 58 at 58 columns (box 28).
  const single = graph(snapshot([titled("a", [], "completed"), titled("b", ["a"], "active"), titled("c", ["a"], "active")]), "all", { columns: 56 }).rows;
  assert.deepEqual(boxOf(single, "a")[0], [{ text: " ".repeat(14), tone: "plain" }, { text: `╭${"─".repeat(25)}╮`, tone: "ok" }]);
  assert.deepEqual(lineStarts(single), [14, 0]);
  assert.deepEqual(lineStarts(graph(demo(), "all", { columns: 58 }).rows), [15, 0, 15, 15]);
  // per = 3 at 80 columns (box 25): W = 79, one box pads 27.
  assert.deepEqual(lineStarts(graph(demo(), "all", { columns: 80 }).rows), [27, 0, 27]);

  // 2+2+1 at 56 columns centers the last line only; 3+2 at 80 columns (W = 79) pads the pair by 13.
  const five = snapshot(["a", "b", "c", "d", "e"].map((id) => titled(id, [], "pending")));
  assert.deepEqual(lineStarts(graph(five, "all", { columns: 56 }).rows), [0, 0, 14]);
  assert.deepEqual(lineStarts(graph(five, "all", { columns: 80 }).rows), [0, 13]);
  const lastLine = graph(five, "all", { columns: 56 }).rows.filter((row) => text(row).includes("│ e "));
  assert.equal(lastLine.length, 1);
  assert.deepEqual(lastLine[0][0], { text: " ".repeat(14), tone: "plain" });

  // Stem and head at floor((W - 1) / 2): 27 at 56, 28 at 58, 39 at 80, and 19 with per = 1 (W = 40).
  const connectorAt = (rows) => {
    const header = rows.findIndex((row) => text(row).startsWith("Wave 2 "));
    return [text(rows[header - 2]), text(rows[header - 1])];
  };
  assert.deepEqual(connectorAt(graph(demo(), "all", { columns: 56 }).rows), [at(27, "┆"), at(27, "▼")]);
  assert.deepEqual(connectorAt(graph(demo(), "all", { columns: 58 }).rows), [at(28, "┆"), at(28, "▼")]);
  assert.deepEqual(connectorAt(graph(demo(), "all", { columns: 80 }).rows), [at(39, "┆"), at(39, "▼")]);
  const chain = graph(snapshot([titled("a", [], "completed"), titled("b", ["a"], "active")]), "all", { columns: 56 }).rows;
  assert.deepEqual(connectorAt(chain), [at(19, "┆"), at(19, "▼")]);
  assert.deepEqual(lineStarts(chain), [0, 0]);

  // The header is its own row at column 0, after the head row.
  const ko = graph(demo(), "current", { locale: "ko" }).rows;
  const header = ko.findIndex((row) => text(row).includes("Wave 2 "));
  assert.deepEqual(ko[header], [{ text: "Wave 2 · 0/3 완료 · 2 실행 중 · 2개만 표시", tone: "dim", bold: true }]);
  assert.deepEqual(ko[header - 1], [{ text: " ".repeat(27), tone: "plain" }, { text: "▼", tone: "run" }]);
  assert.deepEqual(ko[header - 2], [{ text: " ".repeat(27), tone: "plain" }, { text: "┆", tone: "run" }]);
  assert.deepEqual(ko[header + 1][0], { text: `╭${"─".repeat(25)}╮`, tone: "run" });
});

const boxLine = (content, inner = 36) => `│ ${content}${" ".repeat(inner - cellWidth(content))} │`;
const lone = (title, status = "active") => graph(snapshot([task("a", [], status, { title })]), "all").rows;

test("14. the id and the title sit on lines of their own", () => {
  // Title equal to id: five rows, no title line.
  assert.deepEqual(boxOf(lone("a"), "a").map(text), [
    `╭${"─".repeat(38)}╮`, boxLine("a"), boxLine("● running"), boxLine("main"), `╰${"─".repeat(38)}╯`,
  ]);
  assert.deepEqual(boxOf(lone("Task a"), "a").map(text), [
    `╭${"─".repeat(38)}╮`, boxLine("a"), boxLine("Task a"), boxLine("● running"), boxLine("main"), `╰${"─".repeat(38)}╯`,
  ]);
  assert.deepEqual(boxOf(lone("Run planned triage and finalize the plan"), "a").map(text).slice(1, 4), [
    boxLine("a"), boxLine("Run planned triage and finalize the"), boxLine("plan"),
  ]);
  // More than two lines: the second ends in an ellipsis, with no space before it.
  const long = boxOf(lone("Run planned triage and finalize the plan, then verify every task twice over"), "a").map(text);
  assert.equal(long.length, 7);
  assert.deepEqual(long.slice(2, 4), [boxLine("Run planned triage and finalize the"), boxLine("plan, then verify every task twice…")]);
  assert.deepEqual(boxOf(lone("Run planned triage and finalize the plan, then verify all"), "a").map(text).slice(2, 4), [
    boxLine("Run planned triage and finalize the"), boxLine("plan, then verify all"),
  ]);
  assert.equal(boxOf(lone("Run planned triage and finalize the plan, then verify every task once"), "a").map(text)[3], boxLine("plan, then verify every task once"));
  assert.equal(boxOf(lone("Run planned triage and finalize the plan, then verify every task once more"), "a").map(text)[3], boxLine("plan, then verify every task once m…"));
  // A word wider than the box is cut by cells.
  assert.deepEqual(boxOf(lone("x".repeat(50)), "a").map(text).slice(2, 4), [boxLine("x".repeat(36)), boxLine("x".repeat(14))]);
  assert.deepEqual(boxOf(lone(`go ${"x".repeat(80)}`), "a").map(text).slice(2, 4), [boxLine("go"), boxLine(`${"x".repeat(35)}…`)]);
  // Hangul is two cells: 18 syllables fill a 36-cell line.
  const hangul = boxOf(lone("계획된 분류를 실행하고 계획을 확정한 뒤 결과를 검증합니다"), "a").map(text);
  assert.deepEqual(hangul.slice(2, 4), [boxLine("계획된 분류를 실행하고 계획을 확정한"), boxLine("뒤 결과를 검증합니다")]);
  for (const row of hangul) assert.equal(cellWidth(row), 40, row);
  const wide = boxOf(lone("가".repeat(36)), "a").map(text);
  assert.deepEqual(wide.slice(2, 4), [boxLine("가".repeat(18)), boxLine("가".repeat(18))]);
  assert.deepEqual(boxOf(lone("가".repeat(37)), "a").map(text)[3], boxLine(`${"가".repeat(17)}…`, 36));
  // Spaces around the title do not reach a line.
  assert.deepEqual(boxOf(lone("  Task   a  "), "a").map(text).slice(2, 3), [boxLine("Task a")]);
});

test("15. boxes side by side share the tallest height", () => {
  const snap = snapshot([
    task("x", [], "completed", { title: "x" }),
    task("a", ["x"], "active", { title: "Implement the finalized plan" }),
    task("b", ["x"], "pending", { title: "Task b" }),
  ]);
  const rows = graph(snap, "all").rows;
  const top = rows.findIndex((row) => text(row).startsWith("╭"));
  const pair = rows.slice(top, top + 7).map(text);
  const two = (left, right) => `${boxLine(left, 23)}  ${boxLine(right, 23)}`;
  assert.deepEqual(pair, [
    `╭${"─".repeat(25)}╮  ╭${"─".repeat(25)}╮`,
    two("a", "b"),
    two("Implement the finalized", "Task b"),
    two("plan", "○ ready"),
    two("● running", "← x"),
    two("← x", ""),
    `╰${"─".repeat(25)}╯  ╰${"─".repeat(25)}╯`,
  ]);
  for (const row of pair) {
    assert.equal(cellWidth(row), 56);
    assert.match(row[26], /[╮│╯]/);
  }
  assert.equal(rows.length, top + 7);
  // The blank line before b's bottom border is b's own: border tone, no bold.
  assert.deepEqual(rows[top + 5].at(-1), { text: boxLine("", 23), tone: "ready" });
  // The line above holds one box whose title is its id: five rows.
  assert.equal(boxOf(rows, "x").length, 5);
});

test("16. tones of the id and title lines", () => {
  const active = boxOf(lone("Task a"), "a");
  assert.deepEqual(active[1], [
    { text: "│ ", tone: "run" }, { text: boxLine("a").slice(2, -2), tone: "run", bold: true }, { text: " │", tone: "run" },
  ]);
  assert.deepEqual(active[2], [{ text: boxLine("Task a"), tone: "run" }]);
  const done = boxOf(lone("Task a", "completed"), "a");
  assert.deepEqual(done[2], [{ text: boxLine("Task a"), tone: "ok" }]);

  // A context node is dim throughout, its title line included.
  const current = graph(demo((id) => `Title of ${id}`), "current").rows;
  const triage = boxOf(current, "triage");
  assert.equal(triage.length, 6);
  assert.ok(text(triage[2]).includes("│ Title of triage "));
  for (const row of triage) {
    for (const span of row.slice(1)) {
      assert.equal(span.tone, "dim");
      assert.equal(span.bold, undefined);
    }
  }
});

test("17. the graph ends with the last wave's boxes or the hidden-after line", () => {
  assert.equal(Object.hasOwn(dagTerm, "hasFlowEdge"), false);
  assert.equal(Object.hasOwn(dagTerm, "EDGE_ROWS_MAX"), false);
  const fan = snapshot([titled("root", [], "completed"), ...Array.from({ length: 14 }, (_, i) => titled(`n${i}`, ["root"], "active"))]);
  for (const snap of [demo(), demo((id) => `Title of ${id}`), fan]) {
    for (const view of ["previous", "current", "next", "all"]) {
      for (const locale of ["ko", "en"]) {
        const model = buildDagModel(snap, view);
        const rows = graph(snap, view, { locale }).rows.map(text);
        const last = rows.at(-1);
        if (model.hiddenAfter > 0) assert.match(last, /\+\d/, `${view} ${locale}`);
        else if (model.nodes.length > 0) assert.ok(last.trimStart().startsWith("╰"), `${last} in ${view} ${locale}`);
        for (const row of rows) {
          assert.ok(!/[▶▷]/.test(row), `${row} in ${view} ${locale}`);
          assert.notEqual(row, "", `blank row in ${view} ${locale}`);
        }
      }
    }
  }
});
