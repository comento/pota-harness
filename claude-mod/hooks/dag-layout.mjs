// Pure layout of a DAG view model: text width estimates, truncation and card coordinates.
// Waves run left to right (`row`) when the panel is wide enough, else top to bottom (`column`).
// TypeScript reads this module's types from dag-layout.d.mts.

export const PAD = 12;
export const CARD_MIN_W = 140;
export const CARD_MAX_W = 260;
const CARD_COLUMN_MAX_W = 440;
export const GAP_MAIN = 40;
export const GAP_MAIN_MAX = 96;
export const GAP_CROSS = 10;
export const HEADER_H = 22;
export const CARD_H = [78, 46, 28];

const ELLIPSIS = "…";
const NARROW = new Set([..."iIl.,:;'|! "]);
const WIDE_ASCII = new Set([..."MW@%"]);

/** East Asian wide code points: Hangul, kana, CJK and full-width forms. @param {number} cp */
export function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x11ff)
    || (cp >= 0x2e80 && cp <= 0x303f)
    || (cp >= 0x3040 && cp <= 0x30ff)
    || (cp >= 0x3130 && cp <= 0x318f)
    || (cp >= 0x3400 && cp <= 0x4dbf)
    || (cp >= 0x4e00 && cp <= 0x9fff)
    || (cp >= 0xa960 && cp <= 0xa97f)
    || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xd7b0 && cp <= 0xd7ff)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe4f)
    || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6);
}

/** @param {string} char one code point */
function charFactor(char) {
  const cp = char.codePointAt(0) ?? 0;
  if (cp > 0xffff) return 1.1;
  if (isWide(cp)) return 1;
  if (cp < 0x80) {
    if (NARROW.has(char)) return 0.3;
    if ((cp >= 0x41 && cp <= 0x5a) || WIDE_ASCII.has(char)) return 0.7;
    return 0.56;
  }
  return 0.6;
}

/**
 * Estimated rendered width in px; there is no DOM to measure with.
 * @param {string} text
 * @param {number} fontSize
 */
export function textWidth(text, fontSize) {
  let units = 0;
  for (const char of String(text)) units += charFactor(char);
  return units * fontSize * 1.05;
}

/**
 * Cuts `text` to fit `maxWidth`, ending in an ellipsis; never splits a surrogate pair.
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} fontSize
 */
export function truncateText(text, maxWidth, fontSize) {
  const value = String(text ?? "").normalize("NFC");
  if (textWidth(value, fontSize) <= maxWidth) return value;
  const room = maxWidth - textWidth(ELLIPSIS, fontSize);
  if (room < 0) return "";
  let used = 0;
  let kept = "";
  for (const char of Array.from(value)) {
    const width = charFactor(char) * fontSize * 1.05;
    if (used + width > room) break;
    used += width;
    kept += char;
  }
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/**
 * Pane body cells to SVG px: about 8 px a cell, in 20 px steps.
 * @param {number} bodyColumns
 */
export function panelWidth(bodyColumns) {
  const columns = Number.isFinite(bodyColumns) ? bodyColumns : 0;
  return Math.max(240, Math.min(1600, Math.floor((columns * 8) / 20) * 20));
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;

/**
 * Orders one wave's nodes by the mean position of their already placed predecessors.
 * @param {{ id: string }[]} members
 * @param {Map<string, string[]>} parentsOf
 * @param {Map<string, number>} placed
 */
function orderByParents(members, parentsOf, placed) {
  return members
    .map((node, index) => {
      const known = (parentsOf.get(node.id) ?? []).filter((id) => placed.has(id)).map((id) => placed.get(id));
      return { node, index, key: known.length > 0 ? mean(known) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? -1 : 1))
    .map((entry) => entry.node);
}

/**
 * @param {DagModel} model
 * @param {{ width: number, density: 0 | 1 | 2 }} options
 */
export function layoutDag(model, { width, density }) {
  const cardH = CARD_H[density] ?? CARD_H[0];
  const columns = model.waves.map((wave) => wave.index);
  const cols = columns.length;
  const orientation = cols > 0 && cols * CARD_MIN_W + (cols - 1) * GAP_MAIN + PAD * 2 <= width ? "row" : "column";
  /** @type {Map<string, string[]>} */
  const parentsOf = new Map();
  for (const edge of model.edges) parentsOf.set(edge.to, [...(parentsOf.get(edge.to) ?? []), edge.from]);
  const membersOf = (index) => model.nodes.filter((node) => node.wave === index);
  const headers = [];
  const boxes = [];
  /** @type {Map<string, { x: number, y: number, w: number, h: number }>} */
  const boxOf = new Map();
  /** @type {Map<string, number>} */
  const placed = new Map();
  let height = PAD * 2;
  let cardW;

  if (orientation === "row") {
    cardW = clamp(Math.floor((width - PAD * 2 - (cols - 1) * GAP_MAIN) / cols), CARD_MIN_W, CARD_MAX_W);
    // Cards stop at CARD_MAX_W; the width left over goes to the edges' room, up to GAP_MAIN_MAX.
    const gap = cols > 1 ? clamp(Math.floor((width - PAD * 2 - cols * cardW) / (cols - 1)), GAP_MAIN, GAP_MAIN_MAX) : GAP_MAIN;
    const tallest = Math.max(1, ...columns.map((index) => membersOf(index).length));
    const stackH = tallest * cardH + (tallest - 1) * GAP_CROSS;
    columns.forEach((index, column) => {
      const x = PAD + column * (cardW + gap);
      headers.push({ wave: index, x, y: PAD, w: cardW });
      const members = orderByParents(membersOf(index), parentsOf, placed);
      const ownH = members.length * cardH + (members.length - 1) * GAP_CROSS;
      let y = PAD + HEADER_H + Math.round((stackH - ownH) / 2);
      for (const node of members) {
        const box = { id: node.id, x, y, w: cardW, h: cardH };
        boxes.push(box);
        boxOf.set(node.id, box);
        placed.set(node.id, y);
        y += cardH + GAP_CROSS;
      }
    });
    height = PAD + HEADER_H + stackH + PAD;
  } else {
    const inner = Math.max(1, width - PAD * 2);
    const perRow = Math.max(1, Math.floor((inner + GAP_CROSS) / (CARD_MIN_W + GAP_CROSS)));
    cardW = Math.min(inner, clamp(Math.floor((inner - (perRow - 1) * GAP_CROSS) / perRow), CARD_MIN_W, CARD_MAX_W));
    let top = PAD;
    columns.forEach((index, band) => {
      if (band > 0) top += GAP_MAIN;
      headers.push({ wave: index, x: PAD, y: top, w: inner });
      const members = orderByParents(membersOf(index), parentsOf, placed);
      members.forEach((node, slot) => {
        // A line of cards shares the whole band, so a wave of one card has room for its full title.
        const line = Math.floor(slot / perRow);
        const inLine = Math.min(perRow, members.length - line * perRow);
        const w = Math.min(CARD_COLUMN_MAX_W, Math.floor((inner - (inLine - 1) * GAP_CROSS) / inLine));
        const x = PAD + (slot % perRow) * (w + GAP_CROSS);
        const y = top + HEADER_H + line * (cardH + GAP_CROSS);
        const box = { id: node.id, x, y, w, h: cardH };
        boxes.push(box);
        boxOf.set(node.id, box);
        placed.set(node.id, x);
      });
      const rows = Math.max(1, Math.ceil(members.length / perRow));
      top += HEADER_H + rows * cardH + (rows - 1) * GAP_CROSS;
    });
    height = top + PAD;
  }

  const paths = [];
  for (const edge of model.edges) {
    const from = boxOf.get(edge.from);
    const to = boxOf.get(edge.to);
    if (!from || !to) continue;
    let x1, y1, x2, y2, d;
    if (orientation === "row") {
      x1 = from.x + from.w;
      y1 = from.y + from.h / 2;
      x2 = to.x;
      y2 = to.y + to.h / 2;
      const k = Math.round(Math.max(18, (x2 - x1) / 2));
      d = `M${x1} ${y1} C${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`;
    } else {
      x1 = from.x + Math.round(from.w / 2);
      y1 = from.y + from.h;
      x2 = to.x + Math.round(to.w / 2);
      y2 = to.y;
      const k = Math.round(Math.max(16, (y2 - y1) / 2));
      d = `M${x1} ${y1} C${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}`;
    }
    paths.push({ from: edge.from, to: edge.to, state: edge.state, d, x1, y1, x2, y2 });
  }
  return { orientation, width, height, card: { w: cardW, h: cardH }, headers, boxes, paths };
}
