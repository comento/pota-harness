// Pure wording of the DAG pane in Korean and English: summary, card lines, bottom rows and the
// text-only fallback for surfaces without Svg. Times and locale arrive as arguments.
// TypeScript reads this module's types from dag-text.d.mts.

import { isWide } from "./dag-layout.mjs";

/**
 * @typedef {"ko" | "en"} Locale
 * @typedef {{ text: string, tone: "plain" | "dim" | "ok" | "run" | "ready" | "bad", bold?: boolean }} Row
 * @typedef {{
 *   locale: Locale, minute: number,
 *   timeline: Record<string, { activeAt?: number, completedAt?: number }>,
 *   snapshot: DagSnapshot | null
 * }} TextContext
 * @typedef {{
 *   id: string, name: string | null, description: string, model: string | null, parentId: string | null,
 *   mentions: string[], status: "running" | "done", activity: string, activityAt: number, calls: number
 * }} DagAgent
 */

const MESSAGES = {
  ko: {
    noGoal: "활성 Pota goal이 없습니다. `pota-plan`으로 계획을 세우면 여기에 DAG가 표시됩니다.",
    noRuntime: "Pota runtime을 찾지 못했습니다. `pota doctor`를 실행하세요.",
    refreshFailed: "상태 갱신 실패: ",
    loading: "Pota goal 상태를 읽는 중…",
    ended: { completed: "종료됨 · 완료", cancelled: "종료됨 · 취소", unknown: "종료됨" },
    goalStatus: { active: "진행 중", paused: "일시 중지", blocked: "막힘", cancelled: "취소됨", completed: "완료" },
    empty: { "no-completed": "아직 완료된 task가 없습니다.", "no-next": "다음 task가 없습니다." },
    views: { previous: "이전", current: "현재", next: "다음", all: "전체" },
    refresh: "↻",
    state: { completed: "완료", active: "실행 중", ready: "준비됨", waiting: "대기", blocked: "막힘" },
    deps: (count) => `선행 ${count}개`,
    after: "선행",
    evidence: "증거",
    writeScope: "범위",
    model: "모델",
    calls: (count) => `${count}회`,
    readyList: "준비됨: ",
    awaitingFinish: "goal finish 대기",
    hiddenAfter: (count) => `+${count}개는 전체 보기에서`,
    omitted: (count) => `+${count}개 task 생략`,
    waveDone: "완료",
    waveRunning: "실행 중",
    waveBlocked: "막힘",
    altCounts: (summary) => `${summary.done}/${summary.total} 완료, ${summary.running} 실행 중`,
    altRunning: "실행 중: ",
    elapsed: { under: "1분 미만", minutes: (m) => `${m}분`, hours: (h, m) => (m ? `${h}시간 ${m}분` : `${h}시간`) },
    opened: "Pota DAG 패널을 열었습니다.",
    notPlaced: "패널이 아직 놓이지 않았습니다: ",
    closed: "Pota DAG 패널을 닫았습니다.",
    refreshing: "Pota DAG를 다시 읽습니다.",
    usage: "사용법: /dag [previous|current|next|all|refresh|close]",
  },
  en: {
    noGoal: "No active Pota goal. Plan one with `pota-plan` and its DAG appears here.",
    noRuntime: "Pota runtime not found. Run `pota doctor`.",
    refreshFailed: "Refresh failed: ",
    loading: "Reading the Pota goal…",
    ended: { completed: "ended · completed", cancelled: "ended · cancelled", unknown: "ended" },
    goalStatus: { active: "active", paused: "paused", blocked: "blocked", cancelled: "cancelled", completed: "completed" },
    empty: { "no-completed": "No task has completed yet.", "no-next": "No next task." },
    views: { previous: "Previous", current: "Current", next: "Next", all: "All" },
    refresh: "↻",
    state: { completed: "done", active: "running", ready: "ready", waiting: "waiting", blocked: "blocked" },
    deps: (count) => `${count} ${count === 1 ? "dep" : "deps"}`,
    after: "after",
    evidence: "evidence",
    writeScope: "scope",
    model: "model",
    calls: (count) => `${count} ${count === 1 ? "call" : "calls"}`,
    readyList: "Ready: ",
    awaitingFinish: "awaiting goal finish",
    hiddenAfter: (count) => `+${count} more in All`,
    omitted: (count) => `+${count} tasks omitted`,
    waveDone: "done",
    waveRunning: "running",
    waveBlocked: "blocked",
    altCounts: (summary) => `${summary.done}/${summary.total} done, ${summary.running} running`,
    altRunning: "Running: ",
    elapsed: { under: "<1m", minutes: (m) => `${m}m`, hours: (h, m) => (m ? `${h}h ${m}m` : `${h}h`) },
    opened: "Opened the Pota DAG pane.",
    notPlaced: "The pane is not placed yet: ",
    closed: "Closed the Pota DAG pane.",
    refreshing: "Reading the Pota DAG again.",
    usage: "Usage: /dag [previous|current|next|all|refresh|close]",
  },
};

/** @param {Locale} locale */
export function messages(locale) {
  return locale === "ko" ? MESSAGES.ko : MESSAGES.en;
}

/**
 * The first set value decides, as the CLI reads LC_ALL, LC_MESSAGES, LANG.
 * @param {(string | undefined)[]} values
 * @returns {Locale}
 */
export function pickLocale(values) {
  const value = values.find((item) => typeof item === "string" && item.length > 0);
  return value !== undefined && value.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** @param {number} ms @param {Locale} locale */
export function formatElapsed(ms, locale) {
  const words = messages(locale).elapsed;
  const minutes = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 60_000);
  if (minutes < 1) return words.under;
  if (minutes < 60) return words.minutes(minutes);
  return words.hours(Math.floor(minutes / 60), minutes % 60);
}

/**
 * `wave n/m · x/y done · z running [· b blocked] [· k models] [· elapsed] [· awaiting goal finish]`
 * @param {DagSummary} summary
 * @param {TextContext} ctx
 */
export function formatSummary(summary, ctx) {
  const words = messages(ctx.locale);
  const parts = [`wave ${summary.waveCurrent}/${summary.waveTotal}`, `${summary.done}/${summary.total} done`, `${summary.running} running`];
  if (summary.blocked > 0) parts.push(`${summary.blocked} blocked`);
  if (summary.models.length > 0) parts.push(`${summary.models.length} ${summary.models.length === 1 ? "model" : "models"}`);
  const started = ctx.snapshot?.createdAt ?? 0;
  if (started > 0 && ctx.minute > 0) parts.push(formatElapsed(ctx.minute - started, ctx.locale));
  if (summary.allDone && ctx.snapshot?.status !== "completed") parts.push(words.awaitingFinish);
  return parts.join(" · ");
}

/** @param {DagWave} wave @param {Locale} locale */
export function waveHeader(wave, locale) {
  const words = messages(locale);
  const parts = [`Wave ${wave.index + 1}`, `${wave.completed}/${wave.total} ${words.waveDone}`];
  if (wave.active > 0) parts.push(`${wave.active} ${words.waveRunning}`);
  if (wave.blocked > 0) parts.push(`${wave.blocked} ${words.waveBlocked}`);
  return parts.join(" · ");
}

const openDeps = (task, snapshot) => {
  const byId = new Map((snapshot?.tasks ?? []).map((item) => [item.id, item]));
  return task.dependsOn.filter((dep) => byId.get(dep)?.status !== "completed").length;
};

/** @param {DagTask} task @param {string} separator */
export function roleLine(task, separator) {
  const agent = task.assignedAgentId ? `@${task.assignedAgentId}` : task.status === "active" ? "main" : null;
  return [task.kind === "design" ? "design" : null, task.route, task.model, task.effort, agent]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(separator);
}

/**
 * The card's four lines before truncation, and its full hover text.
 * @param {DagNode} node
 * @param {TextContext} ctx
 */
export function cardLines(node, ctx) {
  const words = messages(ctx.locale);
  const task = node.task;
  const times = ctx.timeline?.[task.id] ?? {};
  let status = words.state[node.state];
  if (node.state === "active") {
    const since = times.activeAt ?? (task.updatedAt > 0 ? task.updatedAt : undefined);
    if (since !== undefined && ctx.minute > 0) status += ` · ${formatElapsed(ctx.minute - since, ctx.locale)}`;
  } else if (node.state === "completed" && times.activeAt !== undefined && times.completedAt !== undefined) {
    status += ` · ${formatElapsed(times.completedAt - times.activeAt, ctx.locale)}`;
  } else if (node.state === "waiting") {
    const count = openDeps(task, ctx.snapshot);
    if (count > 0) status += ` · ${words.deps(count)}`;
  }
  const required = task.requiredEvidence;
  const collected = required.filter((kind) => task.evidence.includes(kind));
  let progress = "";
  if (node.state === "blocked") progress = task.blocker ?? words.state.blocked;
  else if (required.length > 0) {
    const dots = required.map((kind) => (task.evidence.includes(kind) ? "●" : "○")).join("");
    progress = `${words.evidence} ${dots} ${collected.length}/${required.length}`;
  }
  const tooltip = [
    `${task.id} · ${task.title}`,
    `${words.state[node.state]}${task.blocker ? ` — ${task.blocker}` : ""}`,
    task.dependsOn.length > 0 ? `${words.after}: ${task.dependsOn.join(", ")}` : null,
    required.length > 0 ? `${words.evidence}: ${required.map((kind) => `${kind} ${task.evidence.includes(kind) ? "●" : "○"}`).join(", ")}` : null,
    task.writeScope && task.writeScope.length > 0
      ? `${words.writeScope}: ${task.writeScope.slice(0, 3).join(", ")}${task.writeScope.length > 3 ? ` +${task.writeScope.length - 3}` : ""}`
      : null,
    task.effectiveModel ? `${words.model}: ${task.effectiveModel}` : null,
  ].filter((line) => line !== null).join("\n");
  return { title: task.title, status, meta: roleLine(task, " · "), progress, tooltip };
}

/**
 * Rows under the graph: running tasks with their agent's latest call, blocked and ready tasks,
 * and running agents no task could be matched to.
 * @param {DagSnapshot} snapshot
 * @param {Record<string, string>} agentTask
 * @param {DagAgent[]} agents
 * @param {TextContext} ctx
 * @returns {Row[]}
 */
export function runningRows(snapshot, agentTask, agents, ctx) {
  const words = messages(ctx.locale);
  /** @type {Row[]} */
  const rows = [];
  const byRecent = (a, b) => (a.status === b.status ? b.activityAt - a.activityAt : a.status === "running" ? -1 : 1);
  for (const task of snapshot.tasks.filter((item) => item.status === "active")) {
    rows.push({ text: `● ${task.title}`, tone: "run", bold: true });
    const since = ctx.timeline?.[task.id]?.activeAt ?? (task.updatedAt > 0 ? task.updatedAt : undefined);
    const elapsed = since !== undefined && ctx.minute > 0 ? formatElapsed(ctx.minute - since, ctx.locale) : null;
    const agent = agents.filter((item) => agentTask[item.id] === task.id).sort(byRecent)[0];
    const label = agent
      ? agent.id === "main" ? "main" : `@${agent.name ?? task.assignedAgentId ?? agent.id.slice(0, 8)}`
      : task.assignedAgentId ? `@${task.assignedAgentId}` : "main";
    const parts = [label];
    if (agent?.activity) parts.push(agent.activity);
    if (agent && agent.calls > 0) parts.push(words.calls(agent.calls));
    if (elapsed) parts.push(elapsed);
    rows.push({ text: `  ${parts.join(" · ")}`, tone: "dim" });
  }
  for (const task of snapshot.tasks.filter((item) => item.status === "blocked")) {
    rows.push({ text: `! ${task.title} — ${task.blocker ?? words.state.blocked}`, tone: "bad" });
  }
  const byId = new Map(snapshot.tasks.map((item) => [item.id, item]));
  const ready = snapshot.tasks.filter((item) => item.status === "pending" && item.dependsOn.every((dep) => !byId.has(dep) || byId.get(dep).status === "completed"));
  if (ready.length > 0) rows.push({ text: `○ ${words.readyList}${ready.map((item) => item.id).join(", ")}`, tone: "ready" });
  for (const agent of agents.filter((item) => item.status === "running" && item.id !== "main" && agentTask[item.id] === undefined)) {
    const name = agent.name ?? (agent.description || agent.id.slice(0, 8));
    rows.push({ text: `◦ ${[name, agent.activity].filter(Boolean).join(" · ")}`, tone: "dim" });
  }
  return rows;
}

/**
 * Terminal cells a string takes: wide characters two, combining marks none.
 * @param {string} text
 */
export function cellWidth(text) {
  let cells = 0;
  for (const char of String(text)) {
    const cp = char.codePointAt(0) ?? 0;
    if ((cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    cells += cp > 0xffff || isWide(cp) ? 2 : 1;
  }
  return cells;
}

/** @param {string} text @param {number} columns */
export function truncateCells(text, columns) {
  if (cellWidth(text) <= columns) return text;
  if (columns < 1) return "";
  let kept = "";
  let used = 0;
  for (const char of String(text)) {
    const width = cellWidth(char);
    if (used + width > columns - 1) break;
    used += width;
    kept += char;
  }
  return `${kept}…`;
}

const GLYPH = { completed: "✓", active: "●", ready: "○", waiting: "·", blocked: "!" };
const TONE = { completed: "ok", active: "run", ready: "ready", waiting: "dim", blocked: "bad" };

/**
 * The graph as text rows, for surfaces that draw no Svg.
 * @param {DagModel} model
 * @param {TextContext} ctx
 * @param {number} columns
 * @returns {Row[]}
 */
export function textRows(model, ctx, columns) {
  const words = messages(ctx.locale);
  const width = Math.max(1, Math.floor(Number.isFinite(columns) ? columns : 80));
  /** @type {Row[]} */
  const rows = [];
  if (model.empty) rows.push({ text: words.empty[model.empty], tone: "dim" });
  const parentsOf = new Map();
  for (const edge of model.edges) parentsOf.set(edge.to, [...(parentsOf.get(edge.to) ?? []), edge.from]);
  for (const wave of model.waves) {
    rows.push({ text: waveHeader(wave, ctx.locale), tone: "dim", bold: true });
    for (const node of model.nodes.filter((item) => item.wave === wave.index)) {
      const parts = [`  ${GLYPH[node.state]} ${node.id}`, node.task.title];
      const role = roleLine(node.task, "·");
      if (role) parts.push(role);
      const parents = parentsOf.get(node.id);
      if (parents) parts.push(`← ${parents.join(", ")}`);
      rows.push({ text: parts.join("  "), tone: node.role === "context" ? "dim" : TONE[node.state] });
    }
  }
  if (model.hiddenAfter > 0) rows.push({ text: words.hiddenAfter(model.hiddenAfter), tone: "dim" });
  return rows.map((row) => ({ ...row, text: truncateCells(row.text, width) }));
}
