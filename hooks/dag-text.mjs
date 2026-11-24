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
    noRuntime: "Pota runtime을 찾지 못했습니다. Pota 플러그인을 다시 설치하세요.",
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
    remaining: "남은 증거: ",
    nextUp: "다음 차례",
    others: "기타 에이전트",
    more: (count) => `+${count}개`,
    awaitingFinish: "goal finish 대기",
    hiddenAfter: (count) => `+${count}개는 전체 보기에서`,
    omitted: (count) => `+${count}개 task 생략`,
    waveDone: "완료",
    waveRunning: "실행 중",
    waveBlocked: "막힘",
    summaryModels: (count) => `모델 ${count}개`,
    waveShown: (count) => `${count}개만 표시`,
    otherRoot: (label) => `다른 root를 보는 중: ${label}`,
    altCounts: (summary) => `${summary.done}/${summary.total} 완료, ${summary.running} 실행 중`,
    altRunning: "실행 중: ",
    elapsed: { under: "1분 미만", minutes: (m) => `${m}분`, hours: (h, m) => (m ? `${h}시간 ${m}분` : `${h}시간`) },
    opened: "Pota DAG 패널을 열었습니다.",
    notPlaced: "패널이 아직 놓이지 않았습니다: ",
    closed: "Pota DAG 패널을 닫았습니다.",
    refreshing: "Pota DAG를 다시 읽습니다.",
    usage: "사용법: /dag [previous|current|next|all|refresh|close]",
    backToMain: "메인으로",
    viewing: "보는 중",
    viewDenied: "에이전트 대화를 열지 못했습니다: ",
    effectiveModel: "적용 모델",
    effort: "effort",
    required: "필요",
    recorded: "기록",
    blocker: "막힘 사유",
    none: "없음",
    tabs: { dag: "DAG", diff: "Diff", plan: "Plan", stats: "에이전트·통계" },
    pause: "일시정지",
    resume: "재개",
    gateOn: "게이트 설정",
    gateOff: "게이트 해제",
    gateBadge: "게이트",
    inspector: "태스크 상세",
    receipts: "증거 영수증",
    writeScopeDiff: "범위 내 변경 (Diff)",
    followUp: "후속 요청 보내기",
    resolvedModel: "실제 모델",
    tokens: "토큰",
    cacheHit: "캐시 적중률",
    noDiff: "작업 트리에 변경 사항이 없습니다.",
    noPlan: "Plan 문서를 찾지 못했습니다.",
    noReceipts: "기록된 증거 영수증이 없습니다.",
    sensitiveFile: "민감 파일 (미리보기 차단)",
    agent: "에이전트",
    elapsedCol: "소요 시간",
    passes: "횟수",
    bottleneck: "병목",
  },
  en: {
    noGoal: "No active Pota goal. Plan one with `pota-plan` and its DAG appears here.",
    noRuntime: "Pota runtime not found. Reinstall the Pota plugin.",
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
    remaining: "Evidence left: ",
    nextUp: "Next up",
    others: "Other agents",
    more: (count) => `+${count} more`,
    awaitingFinish: "awaiting goal finish",
    hiddenAfter: (count) => `+${count} more in All`,
    omitted: (count) => `+${count} tasks omitted`,
    waveDone: "done",
    waveRunning: "running",
    waveBlocked: "blocked",
    summaryModels: (count) => `${count} ${count === 1 ? "model" : "models"}`,
    waveShown: (count) => `showing ${count}`,
    otherRoot: (label) => `Reading another root: ${label}`,
    altCounts: (summary) => `${summary.done}/${summary.total} done, ${summary.running} running`,
    altRunning: "Running: ",
    elapsed: { under: "<1m", minutes: (m) => `${m}m`, hours: (h, m) => (m ? `${h}h ${m}m` : `${h}h`) },
    opened: "Opened the Pota DAG pane.",
    notPlaced: "The pane is not placed yet: ",
    closed: "Closed the Pota DAG pane.",
    refreshing: "Reading the Pota DAG again.",
    usage: "Usage: /dag [previous|current|next|all|refresh|close]",
    backToMain: "Back to main",
    viewing: "viewing",
    viewDenied: "Could not open the agent: ",
    effectiveModel: "effective",
    effort: "effort",
    required: "required",
    recorded: "recorded",
    blocker: "blocker",
    none: "none",
    tabs: { dag: "DAG", diff: "Diff", plan: "Plan", stats: "Agents & Stats" },
    pause: "Pause",
    resume: "Resume",
    gateOn: "Enable gate",
    gateOff: "Disable gate",
    gateBadge: "Gate",
    inspector: "Task Inspector",
    receipts: "Receipts",
    writeScopeDiff: "Scoped Diff",
    followUp: "Send follow-up",
    resolvedModel: "Resolved model",
    tokens: "Tokens",
    cacheHit: "Cache hit",
    noDiff: "No working-tree changes.",
    noPlan: "Plan document not found.",
    noReceipts: "No receipts recorded.",
    sensitiveFile: "Sensitive file (preview blocked)",
    agent: "Agent",
    elapsedCol: "Elapsed",
    passes: "Passes",
    bottleneck: "Bottleneck",
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
  const parts = [`wave ${summary.waveCurrent}/${summary.waveTotal}`, `${summary.done}/${summary.total} ${words.waveDone}`, `${summary.running} ${words.waveRunning}`];
  if (summary.blocked > 0) parts.push(`${summary.blocked} ${words.waveBlocked}`);
  if (summary.models.length > 0) parts.push(words.summaryModels(summary.models.length));
  const started = ctx.snapshot?.createdAt ?? 0;
  if (started > 0 && ctx.minute > 0) parts.push(formatElapsed(ctx.minute - started, ctx.locale));
  if (summary.allDone && ctx.snapshot?.status !== "completed") parts.push(words.awaitingFinish);
  return parts.join(" · ");
}

/**
 * Counts are the whole wave's; `shown`, when fewer than the wave has, says how many nodes are drawn.
 * @param {DagWave} wave @param {Locale} locale @param {number} [shown]
 */
export function waveHeader(wave, locale, shown) {
  const words = messages(locale);
  const parts = [`Wave ${wave.index + 1}`, `${wave.completed}/${wave.total} ${words.waveDone}`];
  if (wave.active > 0) parts.push(`${wave.active} ${words.waveRunning}`);
  if (wave.blocked > 0) parts.push(`${wave.blocked} ${words.waveBlocked}`);
  if (shown !== undefined && shown < wave.total) parts.push(words.waveShown(shown));
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
    task.approvalGate === true ? `⏸ ${words.gateBadge}` : null,
    task.dependsOn.length > 0 ? `${words.after}: ${task.dependsOn.join(", ")}` : null,
    required.length > 0 ? `${words.evidence}: ${required.map((kind) => `${kind} ${task.evidence.includes(kind) ? "●" : "○"}`).join(", ")}` : null,
    task.writeScope && task.writeScope.length > 0
      ? `${words.writeScope}: ${task.writeScope.slice(0, 3).join(", ")}${task.writeScope.length > 3 ? ` +${task.writeScope.length - 3}` : ""}`
      : null,
    task.effectiveModel ? `${words.model}: ${task.effectiveModel}` : null,
  ].filter((line) => line !== null).join("\n");
  return { title: task.title, status, meta: roleLine(task, " · "), progress, tooltip };
}

const NEXT_UP_LIMIT = 5;

/**
 * What sits under the graph, as data: running tasks with their agent's latest call and each evidence kind,
 * blocked tasks, what is next with what it waits on, and running agents no task could be matched to.
 * @param {DagSnapshot} snapshot
 * @param {Record<string, string>} agentTask
 * @param {DagAgent[]} agents
 * @param {TextContext} ctx
 */
export function detailSections(snapshot, agentTask, agents, ctx) {
  const byRecent = (a, b) => (a.status === b.status ? b.activityAt - a.activityAt : a.status === "running" ? -1 : 1);
  const running = snapshot.tasks.filter((item) => item.status === "active").map((task) => {
    const since = ctx.timeline?.[task.id]?.activeAt ?? (task.updatedAt > 0 ? task.updatedAt : undefined);
    const linked = agents.filter((item) => agentTask[item.id] === task.id).sort(byRecent);
    const agent = linked[0];
    // A subagent stays the open target while main also touches the task, so the button does not flip.
    const subagent = linked.find((item) => item.id !== "main");
    const who = agent
      ? agent.id === "main" ? "main" : `@${agent.name ?? task.assignedAgentId ?? agent.id.slice(0, 8)}`
      : task.assignedAgentId ? `@${task.assignedAgentId}` : "main";
    return {
      id: task.id,
      title: task.title,
      // The engine's id of the subagent on it, which `$.ui.view` opens; null when main works on it.
      agentId: subagent ? subagent.id : null,
      who,
      activity: agent?.activity ?? "",
      calls: agent?.calls ?? 0,
      elapsed: since !== undefined && ctx.minute > 0 ? formatElapsed(ctx.minute - since, ctx.locale) : "",
      evidence: task.requiredEvidence.map((kind) => ({ kind, done: task.evidence.includes(kind) })),
    };
  });
  const blocked = snapshot.tasks.filter((item) => item.status === "blocked")
    .map((task) => ({ id: task.id, title: task.title, reason: task.blocker ?? "" }));
  const byId = new Map(snapshot.tasks.map((item) => [item.id, item]));
  // Next up: pending tasks whose dependencies are all done or running, with what each one waits on.
  const settled = (dep) => !byId.has(dep) || byId.get(dep).status === "completed";
  const upcoming = snapshot.tasks.filter((item) => item.status === "pending"
    && item.dependsOn.every((dep) => settled(dep) || byId.get(dep).status === "active"));
  const next = upcoming.slice(0, NEXT_UP_LIMIT).map((task) => ({
    id: task.id,
    title: task.title,
    waits: task.dependsOn.filter((dep) => !settled(dep)).map((dep) => byId.get(dep).title),
  }));
  const strays = agents.filter((item) => item.status === "running" && item.id !== "main" && agentTask[item.id] === undefined)
    .map((agent) => ({ id: agent.id, name: agent.name ?? (agent.description || agent.id.slice(0, 8)), activity: agent.activity }));
  return { running, blocked, next, more: Math.max(0, upcoming.length - NEXT_UP_LIMIT), strays };
}

/**
 * A running task's rows: its title, who works on it, and the evidence it still lacks.
 * @param {DetailSections["running"][number]} task
 * @param {Locale} locale
 * @returns {Row[]}
 */
export function runningTaskRows(task, locale) {
  const words = messages(locale);
  /** @type {Row[]} */
  const rows = [{ text: `● ${task.title}`, tone: "run", bold: true }];
  const parts = [task.who, task.activity, task.calls > 0 ? words.calls(task.calls) : "", task.elapsed].filter(Boolean);
  rows.push({ text: `  ${parts.join(" · ")}`, tone: "dim" });
  const left = task.evidence.filter((item) => !item.done).map((item) => item.kind);
  if (left.length > 0) rows.push({ text: `  ${words.remaining}${left.join(", ")}`, tone: "dim" });
  return rows;
}

/**
 * The rows after the running tasks: blocked, next up, and agents no task was matched to.
 * @param {DetailSections} sections
 * @param {Locale} locale
 * @returns {Row[]}
 */
export function restRows(sections, locale) {
  const words = messages(locale);
  /** @type {Row[]} */
  const rows = [];
  for (const task of sections.blocked) rows.push({ text: `! ${task.title} — ${task.reason || words.state.blocked}`, tone: "bad" });
  if (sections.next.length > 0) rows.push({ text: words.nextUp, tone: "dim", bold: true });
  for (const task of sections.next) {
    rows.push({ text: `○ ${task.title}${task.waits.length > 0 ? ` ← ${task.waits.join(", ")}` : ""}`, tone: task.waits.length > 0 ? "plain" : "ready" });
  }
  if (sections.more > 0) rows.push({ text: `  ${words.more(sections.more)}`, tone: "dim" });
  for (const agent of sections.strays) rows.push({ text: `◦ ${[agent.name, agent.activity].filter(Boolean).join(" · ")}`, tone: "dim" });
  return rows;
}

/**
 * The same sections as plain rows, for a surface that draws only text.
 * @param {DagSnapshot} snapshot
 * @param {Record<string, string>} agentTask
 * @param {DagAgent[]} agents
 * @param {TextContext} ctx
 * @returns {Row[]}
 */
export function runningRows(snapshot, agentTask, agents, ctx) {
  const sections = detailSections(snapshot, agentTask, agents, ctx);
  return [...sections.running.flatMap((task) => runningTaskRows(task, ctx.locale)), ...restRows(sections, ctx.locale)];
}

/** @param {number} count */
function compactTokens(count) {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(count));
}

/**
 * What a task the main agent works on shows when opened in the pane: write scope, model and effort,
 * what it depends on, required and recorded evidence, and its blocker.
 * @param {DagTask} task
 * @param {Locale} locale
 * @returns {string[]}
 */
export function taskDetail(task, locale) {
  const words = messages(locale);
  const list = (items) => (items && items.length > 0 ? items.join(", ") : words.none);
  const lines = [
    `${words.writeScope}: ${list(task.writeScope)}`,
    `${words.model}: ${task.model ?? words.none} · ${words.effectiveModel}: ${task.effectiveModel ?? words.none} · ${words.effort}: ${task.effort ?? words.none}`,
    `${words.after}: ${list(task.dependsOn)}`,
    `${words.evidence} ${words.required}: ${list(task.requiredEvidence)}`,
    `${words.evidence} ${words.recorded}: ${list(task.evidence)}`,
  ];
  if (task.blocker) lines.push(`${words.blocker}: ${task.blocker}`);
  if (task.approvalGate === true) lines.push(`⏸ ${words.gateBadge}`);
  if (task.resolvedModel || task.resolvedEffort || task.resolvedTier) {
    const resolved = [];
    if (task.resolvedModel) resolved.push(`${words.resolvedModel}: ${task.resolvedModel}`);
    if (task.resolvedTier) resolved.push(task.resolvedTier);
    if (task.resolvedEffort) resolved.push(`${words.effort}: ${task.resolvedEffort}`);
    lines.push(resolved.join(" · "));
  }
  if (task.transcript && typeof task.transcript === "object") {
    const t = task.transcript;
    const tok = t.tokens && typeof t.tokens === "object" ? t.tokens : {};
    const parts = [];
    if (typeof t.turns === "number" && Number.isFinite(t.turns)) {
      parts.push(locale === "ko" ? `${t.turns}턴` : `${t.turns} ${t.turns === 1 ? "turn" : "turns"}`);
    }
    const inTok = typeof tok.input === "number" && Number.isFinite(tok.input) ? tok.input : 0;
    const cacheTok = typeof tok.cacheRead === "number" && Number.isFinite(tok.cacheRead) ? tok.cacheRead : 0;
    const outTok = typeof tok.output === "number" && Number.isFinite(tok.output) ? tok.output : 0;
    parts.push(locale === "ko"
      ? `입력 ${compactTokens(inTok)}${cacheTok > 0 ? ` / 캐시 ${compactTokens(cacheTok)}` : ""} / 출력 ${compactTokens(outTok)}`
      : `in ${compactTokens(inTok)}${cacheTok > 0 ? ` / cache ${compactTokens(cacheTok)}` : ""} / out ${compactTokens(outTok)}`);
    if (typeof tok.cacheHitRate === "number" && Number.isFinite(tok.cacheHitRate)) {
      const pct = Math.round(tok.cacheHitRate <= 1 ? tok.cacheHitRate * 100 : tok.cacheHitRate);
      parts.push(`${words.cacheHit}: ${pct}%`);
    }
    lines.push(`${words.tokens}: ${parts.join(" · ")}${tok.truncated === true ? " (…)" : ""}`);
  }
  return lines;
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

export const STATE_GLYPH = { completed: "✓", active: "●", ready: "○", waiting: "·", blocked: "!" };
export const STATE_TONE = { completed: "ok", active: "run", ready: "ready", waiting: "dim", blocked: "bad" };

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
    const shown = model.nodes.filter((item) => item.wave === wave.index);
    rows.push({ text: waveHeader(wave, ctx.locale, shown.length), tone: "dim", bold: true });
    for (const node of shown) {
      const parts = [`  ${STATE_GLYPH[node.state]} ${node.id}`, node.task.title];
      const role = roleLine(node.task, "·");
      if (role) parts.push(role);
      const parents = parentsOf.get(node.id);
      if (parents) parts.push(`← ${parents.join(", ")}`);
      rows.push({ text: parts.join("  "), tone: node.role === "context" ? "dim" : STATE_TONE[node.state] });
    }
  }
  if (model.hiddenAfter > 0) rows.push({ text: words.hiddenAfter(model.hiddenAfter), tone: "dim" });
  return rows.map((row) => ({ ...row, text: truncateCells(row.text, width) }));
}
