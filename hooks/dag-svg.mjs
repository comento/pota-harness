// Pure SVG drawing of a DAG view model. The markup is a function of its arguments alone, so equal
// inputs give byte-equal documents and the pane's frame is not reloaded for nothing.
// TypeScript reads this module's types from dag-svg.d.mts.

import { summarize } from "./dag-model.mjs";
import { PAD, layoutDag, textWidth, truncateText } from "./dag-layout.mjs";
import { cardLines, messages, waveHeader } from "./dag-text.mjs";

export const SVG_LIMIT = 131072;
const TARGET = 120000;
const FONT = "system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";
const STATE_CLASS = { completed: "s-done", active: "s-run", ready: "s-rdy", waiting: "s-wait", blocked: "s-blk" };
const EDGE_CLASS = { done: "done", flow: "flow", wait: "wait", blocked: "blk" };
const TEXT_X = 26;
const TEXT_RIGHT = 10;

/**
 * Escapes markup characters and drops what XML 1.0 cannot hold (control characters, lone surrogates).
 * @param {unknown} text
 */
export function escapeXml(text) {
  let out = "";
  for (const char of String(text ?? "")) {
    const cp = char.codePointAt(0) ?? 0;
    const allowed = cp === 0x9 || cp === 0xa || cp === 0xd
      || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
    if (!allowed) continue;
    if (char === "&") out += "&amp;";
    else if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === '"') out += "&quot;";
    else if (char === "'") out += "&apos;";
    else out += char;
  }
  return out;
}

/** Seconds into a period of `period` ms at `epoch`, written as a negative delay keeps phase across reloads. */
function phase(epoch, period) {
  const value = Number.isFinite(epoch) ? ((epoch % period) + period) % period : 0;
  return (value / 1000).toFixed(3).replace(/\.?0+$/, "") || "0";
}

function style(hasFlow, epoch) {
  return [
    ":root{--fg:#1f2328;--mut:#6e7781;--card:#f6f8fa;--line:#d0d7de;--ok:#1a7f37;--run:#0969da;--rdy:#9a6700;--bad:#cf222e;--idle:#8c959f}",
    "@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--mut:#8b949e;--card:#22272e;--line:#444c56;--ok:#3fb950;--run:#58a6ff;--rdy:#d29922;--bad:#f85149;--idle:#6e7681}}",
    "text{font-size:11px;fill:var(--mut)}",
    ".t{font-size:12px;font-weight:600;fill:var(--fg)}",
    ".h{fill:#8b949e}.hw{font-weight:700}",
    ".hb{fill:var(--card);stroke:var(--line);stroke-width:.75}",
    ".c{fill:var(--card);stroke:var(--line)}",
    ".d{fill:var(--idle)}",
    ".s-done .c{stroke:var(--ok)}.s-done .d{fill:var(--ok)}.s-done .st{fill:var(--ok)}",
    ".s-run .c{stroke:var(--run);stroke-width:1.5}.s-run .d{fill:var(--run)}.s-run .st{fill:var(--run)}",
    ".s-rdy .c{stroke:var(--rdy)}.s-rdy .d{fill:none;stroke:var(--rdy);stroke-width:1.5}.s-rdy .st{fill:var(--rdy)}",
    ".s-wait .c{stroke-dasharray:3 3}.s-wait .d{fill:none;stroke:var(--idle);stroke-width:1.5}.s-wait .t{fill:var(--mut)}",
    ".s-blk .c{stroke:var(--bad)}.s-blk .d{fill:var(--bad)}.s-blk .st,.s-blk .pr{fill:var(--bad)}",
    ".on{fill:var(--ok)}.off{fill:var(--idle)}",
    ".card{cursor:pointer}",
    ".gate{font-size:10px;font-weight:700;fill:var(--rdy)}",
    ".n:hover .c{stroke:var(--run)}",
    ".ctx{opacity:.55}",
    ".e{fill:none;stroke-width:1.5;stroke-linecap:round}",
    ".done{stroke:var(--ok)}",
    hasFlow
      ? `.flow{stroke:var(--run);stroke-dasharray:6 5;animation:m .8s linear infinite;animation-delay:-${phase(epoch, 800)}s}`
      : ".flow{stroke:var(--run);stroke-dasharray:6 5}",
    ".wait{stroke:var(--idle);stroke-dasharray:1 5;opacity:.7}",
    ".blk{stroke:var(--bad);stroke-dasharray:4 4}",
    ".dot,.pulse{fill:var(--run)}",
    "@keyframes m{to{stroke-dashoffset:-11}}",
    "@media (prefers-reduced-motion:reduce){.flow{animation:none}.dot,.pulse{display:none}}",
  ].join("");
}

const PULSE = (cx, cy, begin) => `<circle class="pulse" cx="${cx}" cy="${cy}" r="4">`
  + `<animate attributeName="r" values="4;9" dur="1.6s" begin="-${begin}s" repeatCount="indefinite"/>`
  + `<animate attributeName="opacity" values=".5;0" dur="1.6s" begin="-${begin}s" repeatCount="indefinite"/></circle>`;

function progressText(node, lines, words, maxWidth, y) {
  const task = node.task;
  if (!lines.progress) return "";
  if (node.state === "blocked" || task.requiredEvidence.length === 0 || textWidth(lines.progress, 11) > maxWidth) {
    return `<text class="pr" x="${TEXT_X}" y="${y}">${escapeXml(truncateText(lines.progress, maxWidth, 11))}</text>`;
  }
  const dots = task.requiredEvidence.map((kind) => (task.evidence.includes(kind) ? '<tspan class="on">●</tspan>' : '<tspan class="off">○</tspan>')).join("");
  const count = task.requiredEvidence.filter((kind) => task.evidence.includes(kind)).length;
  return `<text class="pr" x="${TEXT_X}" y="${y}">${escapeXml(words.evidence)} ${dots} ${count}/${task.requiredEvidence.length}</text>`;
}

function card(node, box, density, ctx, begin) {
  const words = messages(ctx.locale);
  const lines = cardLines(node, ctx);
  const isGated = node.task.approvalGate === true;
  const maxWidth = box.w - TEXT_X - TEXT_RIGHT;
  const gateText = isGated ? (density === 2 ? "⏸" : `⏸ ${words.gateBadge}`) : "";
  const gateWidth = isGated ? textWidth(gateText, 10) + 4 : 0;
  const titleMaxWidth = Math.max(24, maxWidth - gateWidth);
  const cy = density === 2 ? 14 : 16;
  const classes = `n ${STATE_CLASS[node.state]}${node.role === "context" ? " ctx" : ""}`;
  const parts = [
    `<g class="card" data-task-id="${escapeXml(node.id)}">`,
    `<svg x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" class="${classes}">`,
  ];
  if (density < 2) parts.push(`<title>${escapeXml(lines.tooltip)}</title>`);
  parts.push(`<rect class="c" x=".75" y=".75" width="${box.w - 1.5}" height="${box.h - 1.5}" rx="8"/>`);
  if (node.state === "active" && density < 2) parts.push(PULSE(13, cy, begin));
  parts.push(`<circle class="d" cx="13" cy="${cy}" r="4"/>`);
  parts.push(`<text class="t" x="${TEXT_X}" y="${cy + 4}">${escapeXml(truncateText(lines.title, titleMaxWidth, 12))}</text>`);
  if (isGated) {
    parts.push(`<text class="gate" x="${box.w - 8}" y="${cy + 4}" text-anchor="end">${escapeXml(gateText)}</text>`);
  }
  if (density < 2) parts.push(`<text class="st" x="${TEXT_X}" y="${cy + 21}">${escapeXml(truncateText(lines.status, maxWidth, 11))}</text>`);
  if (density === 0) {
    if (lines.meta) parts.push(`<text x="${TEXT_X}" y="${cy + 37}">${escapeXml(truncateText(lines.meta, maxWidth, 11))}</text>`);
    parts.push(progressText(node, lines, words, maxWidth, cy + 53));
  }
  parts.push("</svg></g>");
  return parts.join("");
}

function header(head, wave, locale) {
  const full = waveHeader(wave, locale);
  const label = `Wave ${wave.index + 1}`;
  const room = head.w - 16;
  const fits = textWidth(full, 11) <= room;
  const shown = fits ? full : truncateText(full, room, 11);
  const chip = Math.round(Math.min(head.w, textWidth(shown, 11) + 16));
  const body = fits
    ? `<tspan class="hw">${escapeXml(label)}</tspan>${escapeXml(full.slice(label.length))}`
    : escapeXml(shown);
  return `<g><title>${escapeXml(full)}</title><rect class="hb" x="${head.x}" y="${head.y}" width="${chip}" height="18" rx="9"/>`
    + `<text class="h" x="${head.x + 8}" y="${head.y + 13}">${body}</text></g>`;
}

function altText(model, ctx) {
  const words = messages(ctx.locale);
  const snapshot = ctx.snapshot ?? { tasks: model.nodes.map((node) => node.task) };
  const summary = summarize(snapshot);
  const running = snapshot.tasks.filter((item) => item.status === "active").map((item) => item.id);
  const parts = [`Pota goal DAG. wave ${summary.waveCurrent}/${summary.waveTotal}, ${words.altCounts(summary)}.`];
  if (running.length > 0) parts.push(`${words.altRunning}${running.join(", ")}.`);
  if (model.empty) parts.push(words.empty[model.empty]);
  return parts.join(" ");
}

function drawDocument(model, layout, { density, epoch, ctx, alt, footers }) {
  const begin = phase(epoch, 1600);
  const hasFlow = model.edges.some((edge) => edge.state === "flow");
  const height = layout.height + footers.length * 16 + (footers.length > 0 ? 4 : 0);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${height}" viewBox="0 0 ${layout.width} ${height}" role="img" font-family="${FONT}">`,
    `<title>${escapeXml(alt)}</title>`,
    `<style>${style(hasFlow, epoch)}</style>`,
    "<g>",
  ];
  for (const path of layout.paths) {
    out.push(`<path class="e ${EDGE_CLASS[path.state]}" d="${path.d}"/>`);
    if (path.state === "flow") {
      out.push(`<circle class="dot" r="3"><animateMotion dur="1.6s" begin="-${begin}s" repeatCount="indefinite" path="${path.d}"/></circle>`);
    }
  }
  out.push("</g><g>");
  const waveOf = new Map(model.waves.map((wave) => [wave.index, wave]));
  for (const head of layout.headers) out.push(header(head, waveOf.get(head.wave), ctx.locale));
  out.push("</g>");
  const nodeOf = new Map(model.nodes.map((node) => [node.id, node]));
  for (const box of layout.boxes) out.push(card(nodeOf.get(box.id), box, density, ctx, begin));
  footers.forEach((line, index) => {
    out.push(`<text x="${PAD}" y="${layout.height + 2 + index * 16}">${escapeXml(truncateText(line, layout.width - PAD * 2, 11))}</text>`);
  });
  out.push("</svg>");
  return out.join("");
}

function emptyDocument(line, width, alt) {
  const height = PAD * 2 + 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" font-family="${FONT}">`
    + `<title>${escapeXml(alt)}</title><style>${style(false, 0)}</style>`
    + `<text x="${PAD}" y="${PAD + 13}">${escapeXml(truncateText(line, width - PAD * 2, 11))}</text></svg>`;
}

const RANK = { active: 0, blocked: 1, ready: 2, waiting: 3, completed: 4 };

/** Which nodes stay when not all fit: running, blocked, ready, waiting (low waves first), completed (high waves first). */
function ranked(model) {
  return model.nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const byState = RANK[a.node.state] - RANK[b.node.state];
      if (byState !== 0) return byState;
      const byWave = a.node.state === "completed" ? b.node.wave - a.node.wave : a.node.wave - b.node.wave;
      return byWave !== 0 ? byWave : a.index - b.index;
    })
    .map((entry) => entry.node.id);
}

function subset(model, keep) {
  const nodes = model.nodes.filter((node) => keep.has(node.id));
  const waves = new Set(nodes.map((node) => node.wave));
  return {
    ...model,
    nodes,
    edges: model.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
    waves: model.waves.filter((wave) => waves.has(wave.index)),
  };
}

/**
 * @param {DagModel} model
 * @param {{ width: number, epoch: number, ctx: TextContext }} options
 * @returns {{ source: string, alt: string, density: 0 | 1 | 2, omitted: number }}
 */
export function renderDagSvg(model, { width, epoch, ctx }) {
  const words = messages(ctx.locale);
  const alt = altText(model, ctx);
  const size = Math.max(1, Math.round(Number.isFinite(width) ? width : 380));
  if (model.nodes.length === 0) {
    return { source: emptyDocument(model.empty ? words.empty[model.empty] : "", size, alt), alt, density: 0, omitted: 0 };
  }
  const hidden = model.hiddenAfter > 0 ? [words.hiddenAfter(model.hiddenAfter)] : [];
  for (const density of /** @type {const} */ ([0, 1, 2])) {
    const source = drawDocument(model, layoutDag(model, { width: size, density }), { density, epoch, ctx, alt, footers: hidden });
    if (source.length <= TARGET) return { source, alt, density, omitted: 0 };
  }
  const order = ranked(model);
  for (let keep = Math.floor(order.length / 2); keep >= 1; keep = Math.floor(keep / 2)) {
    const part = subset(model, new Set(order.slice(0, keep)));
    const omitted = order.length - keep;
    const source = drawDocument(part, layoutDag(part, { width: size, density: 2 }), {
      density: 2, epoch, ctx, alt, footers: [...hidden, words.omitted(omitted)],
    });
    if (source.length <= TARGET) return { source, alt, density: 2, omitted };
  }
  return { source: emptyDocument(words.omitted(order.length), size, alt), alt, density: 2, omitted: order.length };
}
