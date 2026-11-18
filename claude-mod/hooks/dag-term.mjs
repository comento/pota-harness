// Pure box-drawing graph of the DAG for the terminal: rows of toned spans in a cell grid.
// Wave connectors join wave blocks.
// TypeScript reads this module's types from dag-term.d.mts.

import { STATE_GLYPH, STATE_TONE, cardLines, cellWidth, messages, roleLine, textRows, truncateCells, waveHeader } from "./dag-text.mjs";

/**
 * @typedef {{ text: string, tone: "plain" | "dim" | "ok" | "run" | "ready" | "bad", bold?: boolean }} TermSpan
 * @typedef {TermSpan[]} TermRow
 * @typedef {{ mode: "boxes" | "list", rows: TermRow[] }} TermGraph
 */

export const BOX_MIN_W = 24;
export const BOX_MAX_W = 40;
export const BOX_GAP = 2;

const columnsOf = (columns) => Math.floor(Number.isFinite(columns) ? columns : 80);

/**
 * Boxes per line and their width, or null when not even one box of the minimum width fits.
 * @param {number} columns
 * @param {number} widestWave
 */
export function termBoxLayout(columns, widestWave) {
  const width = columnsOf(columns);
  if (width < BOX_MIN_W) return null;
  const perMax = Math.max(1, Math.floor((width + BOX_GAP) / (BOX_MIN_W + BOX_GAP)));
  // An empty model has no wave; one box per line keeps the width finite.
  const per = Math.max(1, Math.min(perMax, widestWave));
  return { per, boxWidth: Math.min(BOX_MAX_W, Math.floor((width - BOX_GAP * (per - 1)) / per)) };
}

/** Appends a span, merging it into the last one when tone and bold match; empty text is dropped. */
function push(row, text, tone, bold = false) {
  if (text.length === 0) return;
  const last = row.at(-1);
  if (last && last.tone === tone && (last.bold === true) === bold) {
    last.text += text;
    return;
  }
  row.push(bold ? { text, tone, bold: true } : { text, tone });
}

const pad = (text, cells) => text + " ".repeat(Math.max(0, cells - cellWidth(text)));

// Wave connector by the merged state of the edges into a wave, first match wins.
const CONNECTOR = [
  ["flow", "┆", "▼", "run"],
  ["blocked", "┆", "▽", "bad"],
  ["wait", "┆", "▽", "dim"],
  ["done", "│", "▼", "ok"],
];

/**
 * A title in at most two lines of `cells` cells, broken at spaces; a word wider than a line is cut by cells.
 * @param {string} title
 * @param {number} cells
 */
function titleLines(title, cells) {
  // Each line remembers whether a space separated it from the next, so the cut tail can be rejoined.
  const lines = [];
  let current = "";
  const close = (spaced) => {
    lines.push({ text: current, spaced });
    current = "";
  };
  for (const word of String(title).split(/\s+/).filter((one) => one.length > 0)) {
    if (current.length > 0 && cellWidth(`${current} ${word}`) <= cells) {
      current += ` ${word}`;
      continue;
    }
    if (current.length > 0) close(true);
    for (const char of word) {
      if (cellWidth(current + char) > cells) close(false);
      current += char;
    }
  }
  if (current.length > 0) close(true);
  if (lines.length <= 2) return lines.map((line) => line.text);
  const rest = lines.slice(1).map((line, index, all) => line.text + (index < all.length - 1 && line.spaced ? " " : "")).join("");
  return [lines[0].text, truncateCells(rest, cells).replace(/\s+…$/, "…")];
}

/**
 * The rows of one box, `height` rows tall: blank content lines fill it above the bottom border.
 * @param {DagNode} node
 * @param {string[] | undefined} parents
 * @param {TextContext} ctx
 * @param {number} boxWidth
 * @param {number} height
 * @returns {TermSpan[][]}
 */
function boxRows(node, parents, ctx, boxWidth, height) {
  const inner = boxWidth - 4;
  const context = node.role === "context";
  const tone = context ? "dim" : STATE_TONE[node.state];
  const titles = node.task.title === node.id ? [] : titleLines(node.task.title, inner);
  const last = parents ? `← ${parents.join(", ")}` : roleLine(node.task, "·");
  const line = (text, contentTone, bold) => {
    const row = [];
    push(row, "│ ", tone);
    push(row, pad(truncateCells(text, inner), inner), contentTone, bold);
    push(row, " │", tone);
    return row;
  };
  const edge = (left, right) => {
    const row = [];
    push(row, `${left}${"─".repeat(boxWidth - 2)}${right}`, tone);
    return row;
  };
  const rows = [
    edge("╭", "╮"),
    line(node.id, tone, !context),
    ...titles.map((title) => line(title, tone, false)),
    line(`${STATE_GLYPH[node.state]} ${cardLines(node, ctx).status}`, tone, false),
    line(last, "dim", false),
  ];
  while (rows.length < height - 1) rows.push(line("", tone, false));
  rows.push(edge("╰", "╯"));
  return rows;
}

/**
 * The graph as terminal rows: boxes per wave when one box fits, else the text rows of `textRows`.
 * @param {DagModel} model
 * @param {TextContext} ctx
 * @param {{ columns: number }} options
 * @returns {TermGraph}
 */
export function termGraph(model, ctx, options) {
  const columns = columnsOf(options.columns);
  const words = messages(ctx.locale);
  const nodesOf = (wave) => model.nodes.filter((node) => node.wave === wave.index);
  const layout = termBoxLayout(columns, Math.max(0, ...model.waves.map((wave) => nodesOf(wave).length)));
  if (layout === null) {
    return { mode: "list", rows: textRows(model, ctx, columns).map((row) => [{ ...row }]) };
  }
  /** @type {TermRow[]} */
  const rows = [];
  const line = (text, tone, bold = false) => {
    const row = [];
    push(row, truncateCells(text, columns), tone, bold);
    rows.push(row);
  };
  if (model.empty) line(words.empty[model.empty], "dim");

  const waveOf = new Map(model.nodes.map((node) => [node.id, node.wave]));
  const parentsOf = new Map();
  for (const edge of model.edges) parentsOf.set(edge.to, [...(parentsOf.get(edge.to) ?? []), edge.from]);
  // Short box lines and the connector sit in the middle of the widest line of boxes.
  const spanOf = (count) => count * layout.boxWidth + BOX_GAP * (count - 1);
  const graphWidth = spanOf(layout.per);

  model.waves.forEach((wave, order) => {
    const nodes = nodesOf(wave);
    const header = waveHeader(wave, ctx.locale, nodes.length);
    const incoming = new Set(model.edges.filter((edge) => waveOf.get(edge.to) === wave.index).map((edge) => edge.state));
    const connector = CONNECTOR.find(([state]) => incoming.has(state));
    if (order > 0 && connector !== undefined) {
      const [, stem, head, tone] = connector;
      for (const mark of [stem, head]) {
        const row = [];
        push(row, " ".repeat(Math.floor((graphWidth - 1) / 2)), "plain");
        push(row, mark, tone);
        rows.push(row);
      }
    }
    line(header, "dim", true);
    for (let start = 0; start < nodes.length; start += layout.per) {
      const group = nodes.slice(start, start + layout.per);
      const titled = group.filter((node) => node.task.title !== node.id);
      const height = 5 + Math.max(0, ...titled.map((node) => titleLines(node.task.title, layout.boxWidth - 4).length));
      const boxes = group.map((node) => boxRows(node, parentsOf.get(node.id), ctx, layout.boxWidth, height));
      for (let index = 0; index < height; index += 1) {
        const row = [];
        push(row, " ".repeat(Math.floor((graphWidth - spanOf(boxes.length)) / 2)), "plain");
        boxes.forEach((box, column) => {
          if (column > 0) push(row, " ".repeat(BOX_GAP), "plain");
          for (const span of box[index]) push(row, span.text, span.tone, span.bold === true);
        });
        rows.push(row);
      }
    }
  });
  if (model.hiddenAfter > 0) line(words.hiddenAfter(model.hiddenAfter), "dim");
  return { mode: "boxes", rows };
}
