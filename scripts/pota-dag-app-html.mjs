// Antigravity(SEP-1865) 및 ChatGPT Desktop/Codex(window.openai) 듀얼 호스트용 단일 자체 완결 HTML/CSS/JS 생성기.
// 기본 CSP(default-src 'none') 준수를 위해 외부 리소스·네트워크 호출·WebSocket 없이 인라인 코드만 사용한다.

export const DAG_APP_RESOURCE_URI = "ui://pota-dag/app.html";
export const DAG_APP_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * HTML 본문 및 속성 삽입용 문자열 이스케이프.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 인라인 <script> 내부 JSON 문자열 리터럴을 안전하게 직렬화한다.
 * @param {unknown} value
 * @returns {string}
 */
function escapeJsonForScript(value) {
  return JSON.stringify(String(value ?? ""))
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

const APP_CSS = `
:root {
  color-scheme: light;
  --fg: var(--color-text-primary, #1f2328);
  --mut: var(--color-text-secondary, #6e7781);
  --idle: var(--color-text-tertiary, #8c959f);
  --card: var(--color-background-secondary, #f6f8fa);
  --line: var(--color-border-primary, #d0d7de);
  --ok: var(--color-text-success, #1a7f37);
  --run: var(--color-text-info, #0969da);
  --rdy: var(--color-text-warning, #9a6700);
  --bad: var(--color-text-danger, #cf222e);
  --bg-page: var(--color-background-primary, #ffffff);
  --bg-subtle: var(--color-background-tertiary, #eff2f5);
  --bg-info: var(--color-background-info, #eef6ff);
  --bg-danger: var(--color-background-danger, #fff1f0);
  --bg-warn: var(--color-background-warning, #fff8db);
  --bg-ok: var(--color-background-success, #ecfdf3);
  --bg-inv: var(--color-background-inverse, #1f2328);
  --fg-inv: var(--color-text-inverse, #ffffff);
  --line-subtle: var(--color-border-secondary, #e5e9ef);
  --line-info: var(--color-border-info, #80bdff);
  --line-danger: var(--color-border-danger, #f3a6a6);
  --line-ok: var(--color-border-success, #8fd19e);
  --ring: var(--color-ring-info, var(--color-ring-primary, #0969da));
  --font-ui: var(--font-sans, system-ui, -apple-system, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif);
  --font-code: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
/* hooks/dag-svg.mjs의 :root 변수보다 높은 명시도(0,2,0)로 테마를 동기화한다. */
:root[data-theme="light"] {
  color-scheme: light;
  --fg: var(--color-text-primary, #1f2328);
  --mut: var(--color-text-secondary, #6e7781);
  --idle: var(--color-text-tertiary, #8c959f);
  --card: var(--color-background-secondary, #f6f8fa);
  --line: var(--color-border-primary, #d0d7de);
  --ok: var(--color-text-success, #1a7f37);
  --run: var(--color-text-info, #0969da);
  --rdy: var(--color-text-warning, #9a6700);
  --bad: var(--color-text-danger, #cf222e);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --fg: var(--color-text-primary, #e6edf3);
  --mut: var(--color-text-secondary, #8b949e);
  --idle: var(--color-text-tertiary, #6e7681);
  --card: var(--color-background-secondary, #22272e);
  --line: var(--color-border-primary, #444c56);
  --ok: var(--color-text-success, #3fb950);
  --run: var(--color-text-info, #58a6ff);
  --rdy: var(--color-text-warning, #d29922);
  --bad: var(--color-text-danger, #f85149);
  --bg-page: var(--color-background-primary, #161b22);
  --bg-subtle: var(--color-background-tertiary, #2d333b);
  --bg-info: var(--color-background-info, rgba(56, 139, 253, 0.14));
  --bg-danger: var(--color-background-danger, rgba(248, 81, 73, 0.14));
  --bg-warn: var(--color-background-warning, rgba(210, 153, 34, 0.14));
  --bg-ok: var(--color-background-success, rgba(63, 185, 80, 0.14));
  --bg-inv: var(--color-background-inverse, #e6edf3);
  --fg-inv: var(--color-text-inverse, #161b22);
  --line-subtle: var(--color-border-secondary, #373e47);
  --line-info: var(--color-border-info, rgba(88, 166, 255, 0.45));
  --line-danger: var(--color-border-danger, rgba(248, 81, 73, 0.45));
  --line-ok: var(--color-border-success, rgba(63, 185, 80, 0.45));
  --ring: var(--color-ring-info, var(--color-ring-primary, #58a6ff));
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; padding: 0; background: var(--bg-page); color: var(--fg); font-family: var(--font-ui); font-size: 13px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
button, select { font: inherit; color: inherit; }
button:focus-visible, select:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.dag-app { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 14px; min-width: 0; }
.dag-header, .dag-sections { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dag-header { gap: 6px; }
.dag-title-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 8px; min-width: 0; }
.dag-title-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.dag-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--fg); overflow-wrap: anywhere; }
.dag-badge { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; border: 1px solid var(--line); background: var(--card); color: var(--mut); white-space: nowrap; }
.dag-badge.is-ok { color: var(--ok); background: var(--bg-ok); border-color: var(--line-ok); }
.dag-badge.is-info { color: var(--run); background: var(--bg-info); border-color: var(--line-info); }
.dag-badge.is-warn { color: var(--rdy); background: var(--bg-warn); border-color: var(--line); }
.dag-badge.is-bad { color: var(--bad); background: var(--bg-danger); border-color: var(--line-danger); }
.dag-plan-btn, .dag-plan-static { display: inline-flex; align-items: center; max-width: 100%; padding: 1px 7px; border-radius: 6px; border: 1px solid var(--line-subtle); background: var(--card); color: var(--mut); font-size: 11px; font-family: var(--font-code); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dag-plan-btn { border-color: var(--line); color: var(--run); cursor: pointer; }
.dag-plan-btn:hover { border-color: var(--line-info); background: var(--bg-info); }
.dag-ws-wrap { display: flex; align-items: center; gap: 6px; max-width: 100%; }
.dag-ws-select { max-width: 240px; min-width: 110px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--fg); font-size: 12px; cursor: pointer; }
.dag-root-label { font-size: 11px; color: var(--mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dag-blocker { padding: 6px 10px; border-radius: 7px; border: 1px solid var(--line-danger); background: var(--bg-danger); color: var(--bad); font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.dag-summary { color: var(--mut); font-size: 12px; overflow-wrap: anywhere; }
.dag-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
.dag-views, .dag-toolbar-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.dag-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 9px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--fg); font-size: 12px; font-weight: 500; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease; }
.dag-btn:hover:not(:disabled) { background: var(--bg-subtle); }
.dag-btn:disabled { opacity: 0.55; cursor: default; }
.dag-btn.is-active { border-color: var(--line-info); background: var(--bg-info); color: var(--run); font-weight: 600; }
.dag-refresh-btn.is-busy { opacity: 0.7; }
.dag-svg-wrap { width: 100%; min-height: 36px; border-radius: 8px; border: 1px solid var(--line-subtle); background: var(--bg-page); padding: 4px; overflow-x: auto; overflow-y: hidden; }
.dag-svg-wrap svg { display: block; max-width: 100%; height: auto; }
.dag-empty-box { padding: 12px 10px; border-radius: 8px; border: 1px dashed var(--line); background: var(--card); color: var(--mut); font-size: 12px; overflow-wrap: anywhere; }
.dag-group { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); min-width: 0; }
.dag-group.is-running { border-color: var(--line-info); background: var(--bg-info); }
.dag-group.is-blocked { border-color: var(--line-danger); background: var(--bg-danger); }
.dag-group-title { font-size: 11px; font-weight: 700; letter-spacing: 0.01em; color: var(--mut); }
.dag-group.is-running .dag-group-title { color: var(--run); }
.dag-group.is-blocked .dag-group-title { color: var(--bad); }
.dag-task-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dag-task-item + .dag-task-item { padding-top: 7px; border-top: 1px solid var(--line-subtle); }
.dag-task-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.dag-task-toggle { flex: 1 1 auto; min-width: 0; text-align: left; padding: 2px 6px; margin: -2px -6px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--fg); font-weight: 600; font-size: 13px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dag-task-toggle:hover { background: var(--bg-subtle); }
.dag-task-toggle.is-open { border-color: var(--line-info); background: var(--bg-page); color: var(--run); }
.dag-elapsed { flex: 0 0 auto; font-size: 11px; color: var(--mut); white-space: nowrap; }
.dag-task-meta, .dag-task-activity { font-size: 11px; color: var(--mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dag-task-activity { font-family: var(--font-code); color: var(--fg); }
.dag-evidence-row { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 1px; }
.dag-ev { font-size: 11px; color: var(--mut); }
.dag-ev.is-done { color: var(--ok); }
.dag-detail-box { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; padding: 6px 8px; border-left: 2px solid var(--line-info); border-radius: 0 6px 6px 0; background: var(--bg-page); min-width: 0; }
.dag-detail-line { font-size: 11px; color: var(--mut); overflow-wrap: anywhere; }
.dag-files-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; }
.dag-file-chip { display: inline-flex; align-items: center; max-width: 100%; padding: 2px 7px; border-radius: 5px; border: 1px solid var(--line); background: var(--card); color: var(--mut); font-size: 11px; font-family: var(--font-code); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.dag-file-chip { color: var(--run); border-color: var(--line-info); cursor: pointer; }
button.dag-file-chip:hover { background: var(--bg-info); }
.dag-blocked-title { font-weight: 600; color: var(--fg); overflow-wrap: anywhere; }
.dag-blocked-reason { font-size: 11px; color: var(--bad); overflow-wrap: anywhere; }
.dag-next-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px; font-size: 12px; min-width: 0; }
.dag-next-dot { color: var(--mut); flex: 0 0 auto; }
.dag-next-dot.is-ready { color: var(--rdy); }
.dag-next-title { color: var(--fg); overflow-wrap: anywhere; }
.dag-next-waits, .dag-more { font-size: 11px; color: var(--mut); overflow-wrap: anywhere; }
.dag-footer-error { font-size: 11px; color: var(--bad); overflow-wrap: anywhere; padding: 2px 2px 0; }
.dag-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; border-bottom: 1px solid var(--line-subtle); padding-bottom: 6px; }
.dag-tab-btn { padding: 4px 10px; border-radius: 6px; font-size: 12px; }
.dag-header-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dag-pause-btn.is-paused { border-color: var(--line-ok); background: var(--bg-ok); color: var(--ok); }
.dag-task-select { max-width: 190px; min-width: 96px; padding: 3px 7px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--fg); font-size: 12px; cursor: pointer; }
.dag-svg-wrap g.card { cursor: pointer; }
.dag-svg-wrap g.card.is-selected .c { stroke: var(--run); stroke-width: 2.25px; }
.dag-inspector, .dag-tab-panel { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dag-inspector-card { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; border: 1px solid var(--line-info); background: var(--card); min-width: 0; }
.dag-inspector-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; min-width: 0; }
.dag-inspector-title-wrap { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.dag-inspector-kicker { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--run); }
.dag-inspector-title { font-size: 13px; font-weight: 700; color: var(--fg); overflow-wrap: anywhere; }
.dag-inspector-close { flex: 0 0 auto; padding: 2px 7px; font-size: 12px; line-height: 1.2; }
.dag-badges-row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.dag-kv-grid { display: flex; flex-direction: column; gap: 3px; padding: 7px 8px; border-radius: 6px; border: 1px solid var(--line-subtle); background: var(--bg-page); min-width: 0; }
.dag-kv-row { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: 11px; min-width: 0; }
.dag-kv-key { color: var(--mut); font-weight: 600; flex: 0 0 auto; }
.dag-kv-val { color: var(--fg); overflow-wrap: anywhere; font-family: var(--font-code); }
.dag-inspector-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dag-inspector-sub { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dag-inspector-sub-title { font-size: 11px; font-weight: 700; color: var(--mut); }
.dag-receipt-row { display: flex; flex-direction: column; gap: 2px; padding: 5px 7px; border-radius: 6px; border: 1px solid var(--line-subtle); background: var(--bg-page); font-size: 11px; min-width: 0; }
.dag-receipt-top { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.dag-receipt-cmd { font-family: var(--font-code); font-size: 11px; color: var(--mut); overflow-wrap: anywhere; }
.dag-file-chip.is-sensitive { color: var(--rdy); border-color: var(--line); background: var(--bg-warn); cursor: default; }
.dag-diff-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--line-subtle); background: var(--bg-page); min-width: 0; }
.dag-diff-left { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.dag-diff-stat { font-family: var(--font-code); font-size: 11px; white-space: nowrap; }
.dag-diff-add { color: var(--ok); }
.dag-diff-del { color: var(--bad); }
.dag-plan-list { display: flex; flex-direction: column; gap: 4px; }
.dag-plan-item { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; overflow-wrap: anywhere; }
.dag-plan-check { flex: 0 0 auto; font-weight: 700; color: var(--mut); }
.dag-plan-check.is-done { color: var(--ok); }
.dag-stats-table-wrap { width: 100%; overflow-x: auto; border-radius: 6px; border: 1px solid var(--line-subtle); background: var(--bg-page); }
.dag-stats-table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
.dag-stats-table th, .dag-stats-table td { padding: 5px 7px; border-bottom: 1px solid var(--line-subtle); vertical-align: middle; }
.dag-stats-table th { font-weight: 700; color: var(--mut); background: var(--card); white-space: nowrap; }
.dag-stats-table tr.is-selected td { background: var(--bg-info); }
.dag-stats-task-btn { padding: 2px 5px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--run); font-weight: 600; font-size: 11px; text-align: left; cursor: pointer; }
.dag-stats-task-btn:hover { background: var(--bg-subtle); border-color: var(--line-info); }
.dag-toast { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); max-width: calc(100vw - 24px); padding: 7px 12px; border-radius: 8px; background: var(--bg-inv); color: var(--fg-inv); font-size: 12px; font-weight: 500; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22); z-index: 100; cursor: pointer; }
`;

const APP_SCRIPT = `(() => {
  "use strict";

  const VIEW_IDS = ["previous", "current", "next", "all"];
  const TAB_IDS = ["dag", "diff", "plan", "stats"];
  const ACTIVE_POLL_MS = 5000;
  const IDLE_POLL_MS = 30000;
  const BACKOFF_AFTER = 3;
  const MAX_BACKOFF_MS = 120000;
  const RPC_TIMEOUT_MS = 15000;
  const OPENAI_PROBE_TIMEOUT_MS = 2000;
  const HYDRATION_DELAY_MS = 150;
  const OPEN_RESULT_KIND = "pota-dag-open";
  const MAX_IN_FLIGHT_TOOLS = 4;
  const RESIZE_DEBOUNCE_MS = 150;
  const TOAST_MS = 4000;
  const VALID_DISPLAY_MODES = new Set(["inline", "pip", "fullscreen"]);
  const SAFE_VAR_RE = /^--(?:color|font)-[a-z0-9-]+$/i;
  const UNSAFE_CSS_VAL_RE = /[;{}<>\\\\]|url\\(|expression\\(/i;
  const BLOCKED_SVG_TAGS = new Set([
    "script", "foreignobject", "iframe", "object", "embed",
    "frame", "frameset", "applet", "base", "link", "meta",
  ]);
  const ALLOWED_SVG_ATTRS = new Set([
    "xmlns", "width", "height", "viewbox", "role", "font-family",
    "x", "y", "cx", "cy", "r", "rx", "ry", "d", "path",
    "class", "text-anchor", "dur", "begin", "repeatcount",
    "attributename", "values", "fill", "stroke", "stroke-width",
    "opacity", "aria-label", "data-task-id",
  ]);
  const FALLBACK_MESSAGES = {
    ko: {
      noGoal: "활성 Pota goal이 없습니다. \`pota-plan\`으로 계획을 세우면 여기에 DAG가 표시됩니다.",
      noWorkspace: "열린 Pota 워크스페이스를 찾지 못했습니다. 작업을 시작하거나 워크스페이스를 선택한 뒤 새로고침하세요.",
      loading: "Pota goal 상태를 읽는 중…",
      refreshFailed: "상태 갱신 실패: ",
      openFileFailed: "보조 패널에서 파일을 열지 못했습니다.",
      displayModeFailed: "화면 모드를 전환하지 못했습니다.",
      refresh: "↻",
      refreshLabel: "새로고침",
      fullscreen: "전체 화면",
      exitFullscreen: "인라인 보기",
      tabs: { dag: "DAG", diff: "Diff", plan: "Plan", stats: "에이전트·통계" },
      views: { previous: "이전", current: "현재", next: "다음", all: "전체" },
      state: { completed: "완료", active: "실행 중", ready: "준비됨", waiting: "대기", blocked: "막힘" },
      goalStatus: { active: "진행 중", paused: "일시 중지", blocked: "막힘", cancelled: "취소됨", completed: "완료" },
      ended: { completed: "종료됨 · 완료", cancelled: "종료됨 · 취소", unknown: "종료됨" },
      empty: { "no-completed": "아직 완료된 task가 없습니다.", "no-next": "다음 task가 없습니다." },
      nextUp: "다음 차례",
      others: "기타 에이전트",
      workspace: "워크스페이스",
      calls: (n) => n + "회",
      more: (n) => "+" + n + "개",
      waveDone: "완료",
      waveRunning: "실행 중",
      waveBlocked: "막힘",
      summaryModels: (n) => "모델 " + n + "개",
      awaitingFinish: "goal finish 대기",
      pause: "일시정지",
      resume: "재개",
      gateOn: "승인 게이트 켜기",
      gateOff: "승인 해제",
      retry: "재시도",
      retryHint: "막힌 task를 다시 배정 대기로 되돌립니다",
      gateBadge: "게이트",
      inspector: "태스크 상세",
      close: "닫기",
      selectTask: "태스크 상세 보기",
      status: "상태",
      wave: "Wave",
      agent: "에이전트",
      route: "경로",
      model: "요청 모델",
      effectiveModel: "적용 모델",
      resolvedModel: "실제 모델",
      effort: "effort",
      tokens: "토큰",
      cacheHit: "캐시 적중률",
      truncated: "일부 잘림",
      turnsUnit: "턴",
      receipts: "증거 영수증",
      noReceipts: "기록된 증거 영수증이 없습니다.",
      fresh: "신선",
      stale: "오래됨",
      freshUnknown: "미확인",
      declared: "선언",
      writeScopeDiff: "범위 내 변경 (Diff)",
      noScopedChanges: "범위 내 변경 사항이 없습니다.",
      sensitiveFile: "민감 파일 (미리보기 차단)",
      followUp: "재검증/검토 요청",
      followUpSent: "후속 요청을 보냈습니다.",
      followUpFailed: "후속 요청을 보내지 못했습니다.",
      actionFailed: "작업을 실행하지 못했습니다.",
      noDiff: "작업 트리에 변경 사항이 없습니다.",
      diffUnavailable: "Git diff를 사용할 수 없습니다.",
      noPlan: "Plan 문서를 찾지 못했습니다.",
      goalSummaryLabel: "목표 요약",
      currentRequestLabel: "현재 요청",
      checklistLabel: "체크리스트",
      statsSummary: "전체 통계",
      tasksCol: "태스크",
      modelCol: "모델",
      effortCol: "effort",
      elapsedCol: "소요 시간",
      receiptsCol: "영수증",
      gateCol: "게이트",
      bottleneck: "병목",
      none: "없음",
      blocker: "막힘 사유",
      filesLabel: "파일",
    },
    en: {
      noGoal: "No active Pota goal. Plan one with \`pota-plan\` and its DAG appears here.",
      noWorkspace: "No Pota workspace found yet. Start work or choose a workspace, then refresh.",
      loading: "Reading the Pota goal…",
      refreshFailed: "Refresh failed: ",
      openFileFailed: "Could not open file in side pane.",
      displayModeFailed: "Could not change display mode.",
      refresh: "↻",
      refreshLabel: "Refresh",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit fullscreen",
      tabs: { dag: "DAG", diff: "Diff", plan: "Plan", stats: "Agents & Stats" },
      views: { previous: "Previous", current: "Current", next: "Next", all: "All" },
      state: { completed: "done", active: "running", ready: "ready", waiting: "waiting", blocked: "blocked" },
      goalStatus: { active: "active", paused: "paused", blocked: "blocked", cancelled: "cancelled", completed: "completed" },
      ended: { completed: "ended · completed", cancelled: "ended · cancelled", unknown: "ended" },
      empty: { "no-completed": "No task has completed yet.", "no-next": "No next task." },
      nextUp: "Next up",
      others: "Other agents",
      workspace: "Workspace",
      calls: (n) => n + (n === 1 ? " call" : " calls"),
      more: (n) => "+" + n + " more",
      waveDone: "done",
      waveRunning: "running",
      waveBlocked: "blocked",
      summaryModels: (n) => n + (n === 1 ? " model" : " models"),
      awaitingFinish: "awaiting goal finish",
      pause: "Pause",
      resume: "Resume",
      gateOn: "Enable gate",
      gateOff: "Disable gate",
      retry: "Retry",
      retryHint: "Return this blocked task to the queue for a fresh dispatch",
      gateBadge: "Gate",
      inspector: "Task Inspector",
      close: "Close",
      selectTask: "Inspect task",
      status: "Status",
      wave: "Wave",
      agent: "Agent",
      route: "Route",
      model: "Model",
      effectiveModel: "Effective model",
      resolvedModel: "Resolved model",
      effort: "Effort",
      tokens: "Tokens",
      cacheHit: "Cache hit",
      truncated: "truncated",
      turnsUnit: "turns",
      receipts: "Receipts",
      noReceipts: "No receipts recorded.",
      fresh: "fresh",
      stale: "stale",
      freshUnknown: "unknown",
      declared: "declared",
      writeScopeDiff: "Scoped Diff",
      noScopedChanges: "No changes in write scope.",
      sensitiveFile: "Sensitive file (preview blocked)",
      followUp: "Ask to review",
      followUpSent: "Follow-up message sent.",
      followUpFailed: "Could not send follow-up message.",
      actionFailed: "Could not execute action.",
      noDiff: "No working-tree changes.",
      diffUnavailable: "Git diff unavailable.",
      noPlan: "Plan document not found.",
      goalSummaryLabel: "Goal",
      currentRequestLabel: "Current request",
      checklistLabel: "Checklist",
      statsSummary: "Rollup",
      tasksCol: "Task",
      modelCol: "Model",
      effortCol: "Effort",
      elapsedCol: "Elapsed",
      receiptsCol: "Receipts",
      gateCol: "Gate",
      bottleneck: "Bottleneck",
      none: "none",
      blocker: "Blocker",
      filesLabel: "Files",
    },
  };

  const appEl = document.getElementById("app");
  const headerEl = document.getElementById("dag-header");
  const toolbarEl = document.getElementById("dag-toolbar");
  const svgWrapEl = document.getElementById("dag-svg-wrap");
  const sectionsEl = document.getElementById("dag-sections");
  const footerEl = document.getElementById("dag-footer");
  const toastEl = document.getElementById("dag-toast");

  function ensureSectionEl(id, tag, className, beforeNode) {
    const existing = document.getElementById(id);
    if (existing) return existing;
    const node = document.createElement(tag);
    node.id = id;
    if (className) node.className = className;
    node.hidden = true;
    if (beforeNode && beforeNode.parentNode === appEl) appEl.insertBefore(node, beforeNode);
    else appEl.appendChild(node);
    return node;
  }

  const tabsEl = ensureSectionEl("dag-tabs", "nav", "dag-tabs", toolbarEl);
  const inspectorEl = ensureSectionEl("dag-inspector", "section", "dag-inspector", sectionsEl);
  const tabPanelEl = ensureSectionEl("dag-tab-panel", "section", "dag-tab-panel", footerEl);

  const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const isValidView = (v) => VIEW_IDS.includes(v);
  const quantizeWidth = (w) => Math.max(240, Math.min(1600, Math.floor(w / 20) * 20));
  const normalizeLocale = (val) => {
    if (typeof val !== "string" || val.length === 0) return null;
    const low = val.trim().toLowerCase();
    return low.startsWith("ko") ? "ko" : low.startsWith("en") ? "en" : null;
  };
  const isVerifiedFileUri = (uri) => typeof uri === "string" && uri.startsWith("file://") && uri.length > 7;
  const hasOpenAiBridge = () => isObj(window.openai);

  function parseJsonIfString(val) {
    if (typeof val !== "string") return val;
    const trimmed = val.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  function extractToolInput(raw) {
    let obj = parseJsonIfString(raw);
    if (!isObj(obj)) return null;
    if (Object.prototype.hasOwnProperty.call(obj, "arguments")) {
      const inner = parseJsonIfString(obj.arguments);
      if (isObj(inner)) obj = inner;
    }
    const out = {};
    if (typeof obj.root === "string" && obj.root.length > 0) out.root = obj.root;
    if (isValidView(obj.view)) out.view = obj.view;
    const loc = normalizeLocale(obj.locale);
    if (loc) out.locale = loc;
    return Object.keys(out).length > 0 ? out : null;
  }

  function isDagPayload(obj) {
    if (!isObj(obj)) return false;
    if (typeof obj.schemaVersion === "number") return true;
    if (Array.isArray(obj.workspaces) && Object.prototype.hasOwnProperty.call(obj, "root")) return true;
    if (isObj(obj.sections) && isObj(obj.messages)) return true;
    return false;
  }

  function extractStructuredContent(raw, depth = 0) {
    if (depth > 4) return null;
    const val = parseJsonIfString(raw);
    if (!isObj(val)) return null;
    if (isObj(val.structuredContent) || typeof val.structuredContent === "string") {
      const sc = parseJsonIfString(val.structuredContent);
      if (isObj(sc) && Object.keys(sc).length > 0) return sc;
    }
    if (val.result !== undefined && val.result !== null) {
      const fromResult = extractStructuredContent(val.result, depth + 1);
      if (fromResult) return fromResult;
    }
    if (val.toolOutput !== undefined && val.toolOutput !== null) {
      const fromToolOutput = extractStructuredContent(val.toolOutput, depth + 1);
      if (fromToolOutput) return fromToolOutput;
    }
    if (isDagPayload(val)) return val;
    return null;
  }

  function normalizeToolResult(raw) {
    if (raw && raw.__coalesced) return raw;
    const val = parseJsonIfString(raw);
    if (val === null && typeof raw === "string") {
      return {
        isError: false,
        content: raw.length > 0 ? [{ type: "text", text: raw }] : [],
        structuredContent: null,
      };
    }
    if (!isObj(val)) {
      return { isError: false, content: [], structuredContent: null };
    }
    const inner = isObj(val.result)
      ? val.result
      : (typeof val.result === "string" ? parseJsonIfString(val.result) : null);
    const base = isObj(inner) ? inner : val;
    const isError = val.isError === true || base.isError === true;
    const content = Array.isArray(base.content)
      ? base.content
      : (Array.isArray(val.content)
        ? val.content
        : (typeof val.result === "string" && val.result.length > 0 ? [{ type: "text", text: val.result }] : []));
    const structuredContent = extractStructuredContent(base) ?? extractStructuredContent(val);
    return { isError, content, structuredContent };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  const state = {
    initialized: false,
    bridgeMode: null,
    sep1865Ready: false,
    hostCapabilities: {},
    hostContext: {},
    payload: null,
    tab: "dag",
    view: "all",
    root: null,
    locale: null,
    width: 420,
    lastServerWidth: null,
    expandedTaskId: null,
    selectedTaskId: null,
    busyAction: null,
    loading: true,
    refreshing: false,
    rpcError: null,
    consecutiveFailures: 0,
    lastMountedSvgSource: null,
    lastHeaderSig: "",
    lastTabsSig: "",
    lastInspectorSig: "",
    lastSectionsSig: "",
    lastTabPanelSig: "",
    lastReportedHeight: null,
    lastSyncedToolInputSig: null,
    lastSyncedToolOutputSig: null,
    hydrationScheduled: false,
    pendingOpenHydration: false,
    hasUserNavigated: false,
    inFlightTools: 0,
    queuedToolCall: null,
    nextRpcId: 1,
    latestStateReqToken: 0,
    latestAppliedReqToken: 0,
    pollTimer: null,
    resizeTimer: null,
    sizeReportScheduled: false,
    toastTimer: null,
  };

  const pendingRequests = new Map();
  const viewButtons = new Map();
  const tabButtons = new Map();
  let viewsBoxEl = null;
  let taskSelectEl = null;
  let refreshBtn = null;
  let fullscreenBtn = null;

  const canOpenAuxPane = () => state.sep1865Ready || (!hasOpenAiBridge() && state.bridgeMode !== "openai");
  const canCallTools = () => typeof window.openai?.callTool === "function" || state.sep1865Ready || state.bridgeMode !== "openai";
  const canToggleFullscreen = () => typeof window.openai?.requestDisplayMode === "function"
    || (Array.isArray(state.hostContext?.availableDisplayModes) && state.hostContext.availableDisplayModes.includes("fullscreen"));
  // ChatGPT는 window.openai.sendFollowUpMessage, Antigravity(순수 SEP-1865)는 ui/message 요청으로 후속 요청을 보낸다.
  const canSendFollowUp = () => typeof window.openai?.sendFollowUpMessage === "function"
    || (state.sep1865Ready && (Boolean(state.hostCapabilities?.message) || state.bridgeMode === "sep1865"));

  function effectiveLocale() {
    return state.payload?.locale === "ko" || state.payload?.locale === "en"
      ? state.payload.locale
      : state.locale ?? normalizeLocale(state.hostContext?.locale) ?? normalizeLocale(navigator.language) ?? "en";
  }

  function dict() {
    return FALLBACK_MESSAGES[effectiveLocale()] || FALLBACK_MESSAGES.en;
  }

  function msg(key, fallbackVal) {
    const m = state.payload?.messages;
    return isObj(m) && typeof m[key] === "string" && m[key].length > 0 ? m[key] : fallbackVal;
  }

  function msgMap(group, key, fallbackVal) {
    const m = state.payload?.messages;
    return isObj(m) && isObj(m[group]) && typeof m[group][key] === "string" && m[group][key].length > 0
      ? m[group][key]
      : fallbackVal;
  }

  function t(key) {
    const local = dict()[key];
    const fallbackVal = typeof local === "string" ? local : FALLBACK_MESSAGES.en[key];
    return msg(key, typeof fallbackVal === "string" ? fallbackVal : key);
  }

  function payloadTasks() {
    const tasks = state.payload?.tasks;
    return Array.isArray(tasks) ? tasks.filter((task) => isObj(task) && typeof task.id === "string" && task.id.length > 0) : [];
  }

  function findTask(taskId) {
    if (typeof taskId !== "string" || taskId.length === 0) return null;
    return payloadTasks().find((task) => task.id === taskId) ?? null;
  }

  function activeTab() {
    return state.payload?.goal && TAB_IDS.includes(state.tab) ? state.tab : "dag";
  }

  function toolErrorText(result) {
    return Array.isArray(result?.content)
      ? result.content.map((c) => (typeof c?.text === "string" ? c.text : "")).filter(Boolean).join(" ")
      : "";
  }

  function formatCount(value) {
    const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
    if (n >= 1000000) return (Math.round(n / 100000) / 10) + "M";
    if (n >= 1000) return (Math.round(n / 100) / 10) + "k";
    return String(n);
  }

  function formatTokens(tokens) {
    if (!isObj(tokens)) return "";
    return "in " + formatCount(tokens.input) + " · cache " + formatCount(tokens.cacheRead) + " · out " + formatCount(tokens.output);
  }

  function postToHost(payload) {
    if (window.parent && typeof window.parent.postMessage === "function") {
      window.parent.postMessage(payload, "*");
    }
  }

  function sendNotification(method, params) {
    postToHost({ jsonrpc: "2.0", method, params: params ?? {} });
  }

  function sendRequest(method, params, timeoutMs = RPC_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = state.nextRpcId++;
      const timer = window.setTimeout(() => {
        if (!pendingRequests.has(id)) return;
        pendingRequests.delete(id);
        reject(new Error("Request timed out (" + method + ")"));
      }, timeoutMs);
      pendingRequests.set(id, { resolve, reject, timer });
      postToHost({ jsonrpc: "2.0", id, method, params: params ?? {} });
    });
  }

  function dispatchToolCall(entry) {
    state.inFlightTools += 1;
    const callPromise = typeof window.openai?.callTool === "function"
      ? Promise.resolve().then(() => window.openai.callTool(entry.name, entry.args)).then(normalizeToolResult)
      : sendRequest("tools/call", { name: entry.name, arguments: entry.args }).then(normalizeToolResult);
    callPromise
      .then(entry.resolve, entry.reject)
      .finally(() => {
        state.inFlightTools = Math.max(0, state.inFlightTools - 1);
        if (state.queuedToolCall && state.inFlightTools < MAX_IN_FLIGHT_TOOLS) {
          const next = state.queuedToolCall;
          state.queuedToolCall = null;
          dispatchToolCall(next);
        }
      });
  }

  // 호스트 제약(앱당 최대 4개 in-flight) 초과 시 단일 큐 슬롯에 최신 요청만 유지한다.
  function callTool(name, args) {
    return new Promise((resolve, reject) => {
      const entry = { name, args, resolve, reject };
      if (state.inFlightTools >= MAX_IN_FLIGHT_TOOLS) {
        // 대기 중인 상태 변경(pota_dag_action) 요청은 상태 조회 폴링으로 덮어쓰지 않는다.
        if (state.queuedToolCall && state.queuedToolCall.name !== "pota_dag_state" && name === "pota_dag_state") {
          resolve({ __coalesced: true });
          return;
        }
        if (state.queuedToolCall) state.queuedToolCall.resolve({ __coalesced: true });
        state.queuedToolCall = entry;
        return;
      }
      dispatchToolCall(entry);
    });
  }

  function mergeHostContext(prev, patch) {
    if (!isObj(patch)) return prev;
    const next = { ...prev, ...patch };
    if (isObj(prev.styles) || isObj(patch.styles)) {
      const ps = isObj(prev.styles) ? prev.styles : {};
      const qs = isObj(patch.styles) ? patch.styles : {};
      next.styles = { ...ps, ...qs };
      if (isObj(ps.variables) || isObj(qs.variables)) {
        next.styles.variables = {
          ...(isObj(ps.variables) ? ps.variables : {}),
          ...(isObj(qs.variables) ? qs.variables : {}),
        };
      }
    }
    if (isObj(prev.containerDimensions) || isObj(patch.containerDimensions)) {
      next.containerDimensions = {
        ...(isObj(prev.containerDimensions) ? prev.containerDimensions : {}),
        ...(isObj(patch.containerDimensions) ? patch.containerDimensions : {}),
      };
    }
    return next;
  }

  function applyHostContext(ctx) {
    if (!isObj(ctx)) return;
    if (ctx.theme === "light" || ctx.theme === "dark") {
      document.documentElement.dataset.theme = ctx.theme;
      document.documentElement.style.colorScheme = ctx.theme;
    }
    const vars = ctx.styles?.variables;
    if (isObj(vars)) {
      for (const [key, val] of Object.entries(vars)) {
        if (!SAFE_VAR_RE.test(key)) continue;
        if (val === null || val === undefined) {
          document.documentElement.style.removeProperty(key);
        } else if (typeof val === "string" && val.length > 0 && val.length <= 256 && !UNSAFE_CSS_VAL_RE.test(val)) {
          document.documentElement.style.setProperty(key, val);
        }
      }
    }
    const loc = normalizeLocale(ctx.locale);
    if (loc) document.documentElement.lang = loc;
  }

  function isInlineResizeActive() {
    const ctx = state.hostContext;
    if (hasOpenAiBridge() || state.bridgeMode === "openai") {
      const mode = isObj(ctx) ? ctx.displayMode : undefined;
      if (mode === "fullscreen" || mode === "pip") return false;
      const dims = isObj(ctx) ? ctx.containerDimensions : undefined;
      return !isObj(dims) || dims.maxHeight !== undefined || dims.height === undefined;
    }
    if (!isObj(ctx) || ctx.displayMode !== "inline") return false;
    const dims = ctx.containerDimensions;
    return !isObj(dims) || dims.maxHeight !== undefined || dims.height === undefined;
  }

  function emitSizeIfChanged() {
    state.sizeReportScheduled = false;
    if (!state.initialized || !isInlineResizeActive()) return;
    const maxH = state.hostContext?.containerDimensions?.maxHeight;
    const cap = typeof maxH === "number" && Number.isFinite(maxH) && maxH > 0 ? Math.min(800, maxH) : 800;
    const measured = Math.ceil(appEl.getBoundingClientRect().height || appEl.scrollHeight || 0);
    if (measured <= 0) return;
    const nextHeight = Math.min(cap, Math.max(1, measured));
    if (nextHeight !== state.lastReportedHeight) {
      state.lastReportedHeight = nextHeight;
      if (typeof window.openai?.notifyIntrinsicHeight === "function") {
        try {
          window.openai.notifyIntrinsicHeight(nextHeight);
        } catch {
          // 호스트 알림 실패는 UI 동작을 차단하지 않는다.
        }
      }
      if (state.sep1865Ready || (!hasOpenAiBridge() && state.bridgeMode !== "openai")) {
        sendNotification("ui/notifications/size-changed", { height: nextHeight });
      }
    }
  }

  function scheduleSizeReport() {
    if (!state.initialized || !isInlineResizeActive() || state.sizeReportScheduled) return;
    state.sizeReportScheduled = true;
    window.requestAnimationFrame(emitSizeIfChanged);
  }

  function showToast(text) {
    if (!text) return;
    toastEl.textContent = String(text);
    toastEl.hidden = false;
    if (state.toastTimer !== null) window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
      state.toastTimer = null;
    }, TOAST_MS);
  }

  toastEl.addEventListener("click", () => {
    toastEl.hidden = true;
    if (state.toastTimer !== null) {
      window.clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
  });

  async function openAuxPaneFile(uri) {
    if (!canOpenAuxPane() || !isVerifiedFileUri(uri)) {
      showToast(msg("openFileFailed", dict().openFileFailed));
      return;
    }
    try {
      const result = await sendRequest("com.google.antigravity/toggle-aux-pane", { tabType: "fileView", uri });
      if (result?.isError === true) showToast(msg("openFileFailed", dict().openFileFailed));
    } catch {
      showToast(msg("openFileFailed", dict().openFileFailed));
    }
  }

  async function toggleDisplayMode() {
    const current = state.hostContext?.displayMode;
    const nextMode = current === "fullscreen" ? "inline" : "fullscreen";
    try {
      const res = typeof window.openai?.requestDisplayMode === "function"
        ? await window.openai.requestDisplayMode({ mode: nextMode })
        : await sendRequest("ui/request-display-mode", { mode: nextMode });
      if (res?.isError === true) {
        showToast(msg("displayModeFailed", dict().displayModeFailed));
        return;
      }
      const grantedMode = isObj(res) && typeof res.mode === "string" && VALID_DISPLAY_MODES.has(res.mode)
        ? res.mode
        : nextMode;
      state.hostContext = mergeHostContext(state.hostContext, { displayMode: grantedMode });
      state.lastReportedHeight = null;
      updateToolbar();
      scheduleSizeReport();
    } catch {
      showToast(msg("displayModeFailed", dict().displayModeFailed));
    }
  }

  function scheduleInitialHydration() {
    if (state.hydrationScheduled || state.payload || typeof window.openai?.callTool !== "function") return;
    state.hydrationScheduled = true;
    window.setTimeout(() => {
      if (!state.payload && state.initialized && !state.refreshing) void refreshState("init");
    }, HYDRATION_DELAY_MS);
  }

  function syncOpenAiGlobals(globals) {
    if (!isObj(globals)) return;
    const prevDisplayMode = state.hostContext?.displayMode;
    const patch = {};
    if (globals.theme === "light" || globals.theme === "dark") patch.theme = globals.theme;
    const loc = normalizeLocale(globals.locale);
    if (loc) patch.locale = loc;
    if (typeof globals.displayMode === "string" && VALID_DISPLAY_MODES.has(globals.displayMode)) {
      patch.displayMode = globals.displayMode;
    }
    if (typeof globals.maxHeight === "number" && Number.isFinite(globals.maxHeight) && globals.maxHeight > 0) {
      patch.containerDimensions = { maxHeight: globals.maxHeight };
    }
    if (Array.isArray(globals.availableDisplayModes)) {
      patch.availableDisplayModes = globals.availableDisplayModes.filter(
        (m) => typeof m === "string" && VALID_DISPLAY_MODES.has(m),
      );
    }
    if (Object.keys(patch).length > 0) {
      state.hostContext = mergeHostContext(state.hostContext, patch);
      if (prevDisplayMode !== state.hostContext?.displayMode) state.lastReportedHeight = null;
      applyHostContext(state.hostContext);
    }

    const ti = extractToolInput(globals.toolInput);
    if (ti) {
      const tiSig = JSON.stringify(ti);
      if (tiSig !== state.lastSyncedToolInputSig) {
        state.lastSyncedToolInputSig = tiSig;
        if (ti.root) state.root = ti.root;
        if (ti.view) state.view = ti.view;
        if (ti.locale) state.locale = ti.locale;
        if (!state.payload) state.loading = true;
      }
    }

    const sc = extractStructuredContent(globals.toolOutput);
    if (sc && Object.keys(sc).length > 0) {
      const scSig = JSON.stringify(sc);
      if (scSig !== state.lastSyncedToolOutputSig) {
        state.lastSyncedToolOutputSig = scSig;
        if (isOpenSummary(sc)) {
          hydrateFromOpenSummary(sc);
        } else {
          state.loading = false;
          state.hasUserNavigated = false;
          applyPayload(sc, "tool-result");
        }
      }
    }
  }

  // open_pota_dag 결과는 모델에도 보이는 슬림 요약이므로 대상 root·보기·언어만 받아들이고,
  // 전체 DAG 상태는 앱 전용 pota_dag_state로 수화한다(브리지 초기화 전이면 초기화 직후로 미룬다).
  function isOpenSummary(sc) {
    return isObj(sc) && sc.kind === OPEN_RESULT_KIND;
  }

  function hydrateFromOpenSummary(sc) {
    if (typeof sc.root === "string" && sc.root.length > 0) state.root = sc.root;
    if (isValidView(sc.view)) state.view = sc.view;
    if (sc.locale === "ko" || sc.locale === "en") state.locale = sc.locale;
    state.hasUserNavigated = false;
    if (!state.payload) state.loading = true;
    state.pendingOpenHydration = true;
    flushPendingOpenHydration();
    render();
  }

  function flushPendingOpenHydration() {
    if (!state.pendingOpenHydration || !state.initialized || !canCallTools()) return;
    state.pendingOpenHydration = false;
    void refreshState("open");
  }

  function measureWrapWidth() {
    const cr = svgWrapEl.clientWidth || svgWrapEl.getBoundingClientRect().width;
    const raw = cr > 0 ? Math.max(0, cr - 10) : Math.max(0, (appEl.clientWidth || 0) - 34);
    return Number.isFinite(raw) && raw > 0 ? quantizeWidth(raw) : null;
  }

  function clearPollTimer() {
    if (state.pollTimer !== null) {
      window.clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function nextPollDelayMs() {
    const base = state.payload?.goal?.status === "active" ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    if (state.consecutiveFailures >= BACKOFF_AFTER) {
      const shift = Math.min(10, state.consecutiveFailures - BACKOFF_AFTER + 1);
      return Math.min(MAX_BACKOFF_MS, base * Math.pow(2, shift));
    }
    return base;
  }

  function schedulePoll() {
    clearPollTimer();
    if (!state.initialized || !canCallTools() || document.hidden) return;
    if (state.payload && state.payload.ended !== null && state.payload.ended !== undefined) return;
    state.pollTimer = window.setTimeout(() => {
      state.pollTimer = null;
      if (!document.hidden && canCallTools() && state.payload?.ended == null) void refreshState("poll");
    }, nextPollDelayMs());
  }

  function markFetchFailure(message) {
    state.consecutiveFailures += 1;
    state.rpcError = message;
    state.refreshing = false;
    state.loading = false;
    renderFooter();
    updateToolbar();
    schedulePoll();
    scheduleSizeReport();
  }

  async function refreshState(reason, extraArgs) {
    if (!state.initialized) return;
    const measured = measureWrapWidth();
    if (measured !== null) state.width = measured;
    const args = { view: state.view, width: state.width };
    if (typeof state.root === "string" && state.root.length > 0) args.root = state.root;
    const loc = state.locale ?? normalizeLocale(state.hostContext?.locale);
    if (loc) args.locale = loc;
    if (extraArgs?.forceEpoch) args.forceEpoch = true;

    const reqToken = ++state.latestStateReqToken;
    const reqView = state.view;
    const reqRoot = state.root;
    state.refreshing = true;
    updateToolbar();

    try {
      const result = await callTool("pota_dag_state", args);
      if (result?.__coalesced) return;
      if (reqToken < state.latestAppliedReqToken) return;
      if ((reqView !== state.view || reqRoot !== state.root) && reqToken < state.latestStateReqToken) return;

      if (result?.isError === true) {
        const text = Array.isArray(result.content)
          ? result.content.map((c) => (typeof c?.text === "string" ? c.text : "")).filter(Boolean).join(" ")
          : "";
        markFetchFailure(text || "Tool error");
        return;
      }

      const sc = result?.structuredContent;
      if (!isObj(sc) || Object.keys(sc).length === 0) {
        markFetchFailure("Empty structuredContent");
        return;
      }

      state.refreshing = false;
      state.loading = false;
      state.latestAppliedReqToken = reqToken;
      state.rpcError = null;
      applyPayload(sc, reason);
    } catch (err) {
      if (reqToken < state.latestAppliedReqToken) return;
      markFetchFailure(err instanceof Error ? err.message : String(err));
    }
  }

  function applyPayload(sc, reason) {
    const hasErr = typeof sc.error === "string" && sc.error.length > 0;
    if (hasErr) {
      state.consecutiveFailures += 1;
    } else {
      state.consecutiveFailures = 0;
      state.rpcError = null;
    }

    // 서버 error 응답 시 이전 정상 스냅샷/SVG가 비어 오면 기존 화면을 유지한다.
    const sameRoot = sc.root === state.payload?.root;
    if (hasErr && !sc.goal && !sc.empty && sameRoot && state.payload?.goal) {
      state.payload = {
        ...state.payload,
        error: sc.error,
        fetchedAt: sc.fetchedAt ?? state.payload.fetchedAt,
        messages: isObj(sc.messages) ? sc.messages : state.payload.messages,
      };
    } else {
      state.payload = sc;
      if (isValidView(sc.view) && (!state.hasUserNavigated || reason !== "tool-result")) {
        state.view = sc.view;
      }
      if (typeof sc.root === "string" && sc.root.length > 0) state.root = sc.root;
      else if (sc.root === null) state.root = null;
      if (sc.locale === "ko" || sc.locale === "en") state.locale = sc.locale;
      if (typeof sc.width === "number" && Number.isFinite(sc.width)) state.lastServerWidth = sc.width;
    }
    if (state.selectedTaskId !== null && !findTask(state.selectedTaskId)) state.selectedTaskId = null;

    render();
    schedulePoll();
    scheduleSizeReport();
  }

  // DOMParser로 파싱하고 위험 태그·이벤트 속성·외부/스크립트 참조를 차단한 뒤 importNode한다.
  function sanitizeAndBuildSvg(source) {
    if (typeof source !== "string" || source.trim().length === 0) return null;
    let doc;
    try {
      doc = new DOMParser().parseFromString(source, "image/svg+xml");
    } catch {
      return null;
    }
    const root = doc?.documentElement;
    if (!root || root.localName.toLowerCase() !== "svg") return null;
    if (doc.getElementsByTagName("parsererror").length > 0) return null;

    const queue = [root];
    while (queue.length > 0) {
      const node = queue.pop();
      const tag = (node.localName || node.tagName || "").toLowerCase();
      if (BLOCKED_SVG_TAGS.has(tag)) return null;
      if (tag === "style" && /@import|javascript\\s*:|expression\\s*\\(/i.test(node.textContent || "")) return null;
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const local = (attr.localName || attr.name).toLowerCase();
        const val = String(attr.value || "");
        if (name.startsWith("on") || local.startsWith("on")) return null;
        if (name === "href" || local === "href" || name === "xlink:href" || name.endsWith(":href")) return null;
        if (local === "attributename") {
          const targetAttr = val.trim().toLowerCase();
          if (targetAttr === "href" || targetAttr.endsWith(":href") || targetAttr.startsWith("on")) return null;
        }
        if (/javascript\\s*:|vbscript\\s*:|data\\s*:\\s*text\\/html/i.test(val)) return null;
      }
      for (let i = 0; i < node.children.length; i += 1) queue.push(node.children[i]);
    }
    return document.importNode(root, true);
  }

  function formatSummaryText(payload) {
    if (typeof payload.summary === "string") return payload.summary;
    if (isObj(payload.summary) && typeof payload.summary.text === "string") return payload.summary.text;
    const s = payload.summary;
    if (!isObj(s)) return "";
    const words = dict();
    const parts = [
      "wave " + (s.waveCurrent ?? 0) + "/" + (s.waveTotal ?? 0),
      (s.done ?? 0) + "/" + (s.total ?? 0) + " " + words.waveDone,
      (s.running ?? 0) + " " + words.waveRunning,
    ];
    if ((s.blocked ?? 0) > 0) parts.push(s.blocked + " " + words.waveBlocked);
    if (Array.isArray(s.models) && s.models.length > 0) parts.push(words.summaryModels(s.models.length));
    if (s.allDone && payload.goal?.status !== "completed") parts.push(words.awaitingFinish);
    return parts.join(" · ");
  }

  function badgeInfo(payload) {
    if (!payload) return null;
    if (payload.ended && typeof payload.ended.status === "string") {
      const st = payload.ended.status;
      return {
        label: payload.ended.label || msgMap("ended", st, dict().ended[st] || dict().ended.unknown),
        tone: st === "completed" ? "is-ok" : "",
      };
    }
    if (payload.goal && typeof payload.goal.status === "string") {
      const st = payload.goal.status;
      const toneMap = { completed: "is-ok", active: "is-info", paused: "is-warn", blocked: "is-bad" };
      return {
        label: payload.goal.statusLabel || msgMap("goalStatus", st, dict().goalStatus[st] || st),
        tone: toneMap[st] || "",
      };
    }
    return null;
  }

  function buildWorkspaceControl(p) {
    const workspaces = Array.isArray(p?.workspaces) ? p.workspaces : [];
    if (workspaces.length === 0) {
      if (typeof p?.rootLabel === "string" && p.rootLabel.length > 0) {
        const rootTag = el("span", "dag-root-label", p.rootLabel);
        if (typeof p.root === "string") rootTag.title = p.root;
        return rootTag;
      }
      return null;
    }
    const wsWrap = el("div", "dag-ws-wrap");
    const select = el("select", "dag-ws-select");
    select.setAttribute("aria-label", msg("workspace", dict().workspace));
    let matched = false;
    for (const item of workspaces) {
      const wsRoot = typeof item === "string" ? item : item?.root;
      if (typeof wsRoot !== "string" || wsRoot.length === 0) continue;
      const opt = el("option", null, (typeof item === "object" && item?.label) ? item.label : wsRoot);
      opt.value = wsRoot;
      opt.title = wsRoot;
      if (wsRoot === p?.root) {
        opt.selected = true;
        matched = true;
      }
      select.appendChild(opt);
    }
    if (!matched && typeof p?.root === "string" && p.root.length > 0) {
      const opt = el("option", null, p.rootLabel || p.root);
      opt.value = p.root;
      opt.title = p.root;
      opt.selected = true;
      select.insertBefore(opt, select.firstChild);
    }
    select.addEventListener("change", () => {
      state.hasUserNavigated = true;
      state.root = select.value || null;
      state.expandedTaskId = null;
      state.selectedTaskId = null;
      state.consecutiveFailures = 0;
      void refreshState("workspace");
    });
    wsWrap.appendChild(select);
    return wsWrap;
  }

  function renderHeader() {
    const p = state.payload;
    const allowAux = canOpenAuxPane();
    const goalStatus = p?.goal?.status;
    const canControlGoal = Boolean(p?.goal) && !p?.ended && (goalStatus === "active" || goalStatus === "paused") && canCallTools();
    const sig = JSON.stringify({
      canControlGoal,
      busyAction: state.busyAction,
      title: p?.goal?.title ?? null,
      status: p?.goal?.status ?? null,
      ended: p?.ended ?? null,
      planId: p?.goal?.planId ?? null,
      planFileUri: p?.goal?.planFileUri ?? null,
      allowAux,
      blocker: p?.goal?.blocker ?? null,
      summary: p?.summary ?? null,
      root: p?.root ?? null,
      rootLabel: p?.rootLabel ?? null,
      workspaces: p?.workspaces ?? null,
      empty: p?.empty ?? null,
      loading: state.loading,
      locale: effectiveLocale(),
      messages: p?.messages ?? null,
    });
    if (sig === state.lastHeaderSig) return;
    state.lastHeaderSig = sig;

    const nodes = [];
    const titleRow = el("div", "dag-title-row");
    const titleGroup = el("div", "dag-title-group");
    titleGroup.appendChild(el("h1", "dag-title", p?.goal?.title || APP_TITLE));

    const badge = badgeInfo(p);
    if (badge) titleGroup.appendChild(el("span", "dag-badge" + (badge.tone ? " " + badge.tone : ""), badge.label));

    if (p?.goal?.planId) {
      if (allowAux && isVerifiedFileUri(p.goal.planFileUri)) {
        const planBtn = el("button", "dag-plan-btn", p.goal.planId);
        planBtn.type = "button";
        planBtn.title = p.goal.planId;
        const uri = p.goal.planFileUri;
        planBtn.addEventListener("click", () => void openAuxPaneFile(uri));
        titleGroup.appendChild(planBtn);
      } else {
        const planTag = el("span", "dag-plan-static", p.goal.planId);
        planTag.title = p.goal.planId;
        titleGroup.appendChild(planTag);
      }
    }

    titleRow.appendChild(titleGroup);
    const wsControl = buildWorkspaceControl(p);
    if (wsControl) titleRow.appendChild(wsControl);
    if (canControlGoal) {
      // active goal은 [일시정지], paused goal은 [재개]를 노출하고 pota_dag_action으로 전이한다.
      const isPaused = goalStatus === "paused";
      const goalAction = isPaused ? "resume" : "pause";
      const actionsBox = el("div", "dag-header-actions");
      const pauseBtn = el("button", "dag-btn dag-pause-btn" + (isPaused ? " is-paused" : ""), t(goalAction));
      pauseBtn.type = "button";
      pauseBtn.dataset.action = goalAction;
      pauseBtn.disabled = state.busyAction !== null;
      pauseBtn.addEventListener("click", () => void runDagAction(goalAction));
      actionsBox.appendChild(pauseBtn);
      titleRow.appendChild(actionsBox);
    }
    nodes.push(titleRow);

    if (p?.goal?.blocker) {
      const blk = el("div", "dag-blocker", "! " + p.goal.blocker);
      blk.setAttribute("role", "alert");
      nodes.push(blk);
    }

    if (p?.goal) {
      const summaryLine = formatSummaryText(p);
      if (summaryLine) nodes.push(el("div", "dag-summary", summaryLine));
    } else if (state.loading && !p) {
      nodes.push(el("div", "dag-empty-box", dict().loading));
    } else {
      const isNoWs = p && (p.root === null || p.empty === "no-workspace");
      nodes.push(el("div", "dag-empty-box", isNoWs ? msg("noWorkspace", dict().noWorkspace) : msg("noGoal", dict().noGoal)));
    }

    headerEl.replaceChildren(...nodes);
  }

  function initToolbar() {
    const viewsBox = el("div", "dag-views");
    viewsBoxEl = viewsBox;
    for (const viewId of VIEW_IDS) {
      const btn = el("button", "dag-btn");
      btn.type = "button";
      btn.dataset.view = viewId;
      btn.addEventListener("click", () => selectView(viewId));
      viewButtons.set(viewId, btn);
      viewsBox.appendChild(btn);
    }
    const actionsBox = el("div", "dag-toolbar-actions");
    fullscreenBtn = el("button", "dag-btn dag-fullscreen-btn");
    fullscreenBtn.type = "button";
    fullscreenBtn.hidden = true;
    fullscreenBtn.addEventListener("click", () => void toggleDisplayMode());
    refreshBtn = el("button", "dag-btn dag-refresh-btn");
    refreshBtn.type = "button";
    refreshBtn.addEventListener("click", () => {
      state.consecutiveFailures = 0;
      state.rpcError = null;
      void refreshState("manual", { forceEpoch: true });
    });
    actionsBox.append(fullscreenBtn, refreshBtn);
    toolbarEl.replaceChildren(viewsBox, actionsBox);
    updateToolbar();
  }

  function updateToolbar() {
    const words = dict();
    for (const viewId of VIEW_IDS) {
      const btn = viewButtons.get(viewId);
      if (!btn) continue;
      btn.textContent = msgMap("views", viewId, words.views[viewId]);
      const active = state.view === viewId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (fullscreenBtn) {
      const showFs = canToggleFullscreen();
      const isFs = state.hostContext?.displayMode === "fullscreen";
      const fsLabel = isFs
        ? msg("exitFullscreen", words.exitFullscreen)
        : msg("fullscreen", words.fullscreen);
      fullscreenBtn.hidden = !showFs;
      fullscreenBtn.textContent = fsLabel;
      fullscreenBtn.setAttribute("aria-label", fsLabel);
      fullscreenBtn.title = fsLabel;
      fullscreenBtn.setAttribute("aria-pressed", isFs ? "true" : "false");
      fullscreenBtn.classList.toggle("is-active", isFs);
    }
    if (refreshBtn) {
      refreshBtn.textContent = msg("refresh", words.refresh);
      refreshBtn.setAttribute("aria-label", words.refreshLabel);
      refreshBtn.title = words.refreshLabel;
      refreshBtn.classList.toggle("is-busy", state.refreshing);
    }
  }

  function selectView(viewId) {
    if (!isValidView(viewId)) return;
    state.hasUserNavigated = true;
    state.view = viewId;
    updateToolbar();
    void refreshState("view");
  }

  function renderSvg() {
    const p = state.payload;
    if (!p || !p.goal) {
      svgWrapEl.hidden = true;
      if (state.lastMountedSvgSource !== null) {
        svgWrapEl.replaceChildren();
        state.lastMountedSvgSource = null;
      }
      return;
    }

    const src = p.svg?.source;
    if (typeof src === "string" && src.length > 0) {
      svgWrapEl.hidden = false;
      // SVG 마크업이 바이트 단위로 동일하면 DOM을 교체하지 않아 SMIL/CSS 애니메이션을 보존한다.
      if (src === state.lastMountedSvgSource) return;
      const svgNode = sanitizeAndBuildSvg(src);
      if (svgNode) {
        if (typeof p.svg.alt === "string" && p.svg.alt.length > 0) svgNode.setAttribute("aria-label", p.svg.alt);
        if (!svgNode.getAttribute("role")) svgNode.setAttribute("role", "img");
        svgWrapEl.replaceChildren(svgNode);
        state.lastMountedSvgSource = src;
      } else {
        svgWrapEl.replaceChildren(el("div", "dag-empty-box", p.svg?.alt || dict().empty[p.empty] || ""));
        state.lastMountedSvgSource = null;
      }
      return;
    }

    if (typeof p.empty === "string" && p.empty.length > 0) {
      svgWrapEl.hidden = false;
      svgWrapEl.replaceChildren(el("div", "dag-empty-box", msgMap("empty", p.empty, dict().empty[p.empty] || p.empty)));
      state.lastMountedSvgSource = null;
      return;
    }

    svgWrapEl.hidden = true;
    svgWrapEl.replaceChildren();
    state.lastMountedSvgSource = null;
  }

  function buildTaskDetail(task) {
    const details = Array.isArray(task.detailLines) ? task.detailLines.filter((l) => typeof l === "string" && l.length > 0) : [];
    const files = Array.isArray(task.files) ? task.files.filter((f) => isObj(f) || typeof f === "string") : [];
    if (details.length === 0 && files.length === 0) return null;

    const detailBox = el("div", "dag-detail-box");
    for (const line of details) detailBox.appendChild(el("div", "dag-detail-line", line));
    if (files.length > 0) {
      const allowAux = canOpenAuxPane();
      const filesRow = el("div", "dag-files-row");
      for (const file of files) {
        const label = typeof file === "string" ? file : (file.label || file.path || file.uri || "");
        if (!label) continue;
        const uri = typeof file === "object" ? file.uri : null;
        const clickable = allowAux && isVerifiedFileUri(uri);
        const chip = el(clickable ? "button" : "span", "dag-file-chip", label);
        chip.title = (typeof file === "object" && file.path) ? file.path : label;
        if (clickable) {
          chip.type = "button";
          chip.addEventListener("click", () => void openAuxPaneFile(uri));
        }
        filesRow.appendChild(chip);
      }
      if (filesRow.childNodes.length > 0) detailBox.appendChild(filesRow);
    }
    return detailBox;
  }

  function buildRunningGroup(items, words) {
    const box = el("section", "dag-group is-running");
    box.appendChild(el("div", "dag-group-title", msgMap("state", "active", words.state.active)));
    for (const task of items) {
      if (!isObj(task)) continue;
      const item = el("div", "dag-task-item");
      const head = el("div", "dag-task-head");
      const isOpen = state.expandedTaskId === task.id;
      const toggle = el("button", "dag-task-toggle" + (isOpen ? " is-open" : ""), task.title || task.id || "");
      toggle.type = "button";
      toggle.title = task.title || task.id || "";
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      toggle.addEventListener("click", () => {
        state.expandedTaskId = state.expandedTaskId === task.id ? null : task.id;
        renderSections();
        scheduleSizeReport();
      });
      head.appendChild(toggle);
      if (typeof task.elapsed === "string" && task.elapsed.length > 0) head.appendChild(el("span", "dag-elapsed", task.elapsed));
      item.appendChild(head);

      const metaParts = [
        typeof task.who === "string" ? task.who : "",
        typeof task.calls === "number" && task.calls > 0 ? words.calls(task.calls) : "",
      ].filter(Boolean);
      if (metaParts.length > 0) item.appendChild(el("div", "dag-task-meta", metaParts.join(" · ")));
      if (typeof task.activity === "string" && task.activity.length > 0) item.appendChild(el("div", "dag-task-activity", task.activity));

      if (Array.isArray(task.evidence) && task.evidence.length > 0) {
        const evRow = el("div", "dag-evidence-row");
        for (const ev of task.evidence) {
          if (!isObj(ev) || typeof ev.kind !== "string") continue;
          evRow.appendChild(el("span", "dag-ev" + (ev.done ? " is-done" : ""), (ev.done ? "● " : "○ ") + ev.kind));
        }
        if (evRow.childNodes.length > 0) item.appendChild(evRow);
      }

      if (isOpen) {
        const detailBox = buildTaskDetail(task);
        if (detailBox) item.appendChild(detailBox);
      }
      box.appendChild(item);
    }
    return box;
  }

  function buildBlockedGroup(items, words) {
    const box = el("section", "dag-group is-blocked");
    box.appendChild(el("div", "dag-group-title", msgMap("state", "blocked", words.state.blocked)));
    for (const task of items) {
      if (!isObj(task)) continue;
      const item = el("div", "dag-task-item");
      item.appendChild(el("div", "dag-blocked-title", task.title || task.id || ""));
      if (typeof task.reason === "string" && task.reason.length > 0) item.appendChild(el("div", "dag-blocked-reason", task.reason));
      box.appendChild(item);
    }
    return box;
  }

  function buildNextGroup(items, sec, p, words) {
    const box = el("section", "dag-group");
    box.appendChild(el("div", "dag-group-title", msg("nextUp", words.nextUp)));
    for (const task of items) {
      if (!isObj(task)) continue;
      const waits = Array.isArray(task.waits) ? task.waits.filter((w) => typeof w === "string" && w.length > 0) : [];
      const row = el("div", "dag-next-row");
      row.append(
        el("span", "dag-next-dot" + (waits.length === 0 ? " is-ready" : ""), "○"),
        el("span", "dag-next-title", task.title || task.id || ""),
      );
      if (waits.length > 0) row.appendChild(el("span", "dag-next-waits", "← " + waits.join(", ")));
      box.appendChild(row);
    }
    const moreText = typeof p?.messages?.more === "string" && p.messages.more.length > 0
      ? p.messages.more
      : typeof sec.more === "number" && sec.more > 0 ? words.more(sec.more) : "";
    if (moreText) box.appendChild(el("div", "dag-more", moreText));
    return box;
  }

  function buildStraysGroup(items, words) {
    const box = el("section", "dag-group");
    box.appendChild(el("div", "dag-group-title", msg("others", words.others)));
    for (const agent of items) {
      if (!isObj(agent)) continue;
      const line = [agent.name, agent.activity].filter((x) => typeof x === "string" && x.length > 0).join(" · ");
      if (line) box.appendChild(el("div", "dag-detail-line", "◦ " + line));
    }
    return box;
  }

  function renderSections() {
    const p = state.payload;
    const sec = p?.sections;
    const sig = JSON.stringify({
      hasGoal: Boolean(p?.goal),
      sec: sec ?? null,
      expandedTaskId: state.expandedTaskId,
      allowAux: canOpenAuxPane(),
      locale: effectiveLocale(),
      messages: p?.messages ?? null,
    });
    if (sig === state.lastSectionsSig) return;
    state.lastSectionsSig = sig;

    if (!p?.goal || !isObj(sec)) {
      sectionsEl.replaceChildren();
      return;
    }

    const words = dict();
    const groups = [];
    if (Array.isArray(sec.running) && sec.running.length > 0) groups.push(buildRunningGroup(sec.running, words));
    if (Array.isArray(sec.blocked) && sec.blocked.length > 0) groups.push(buildBlockedGroup(sec.blocked, words));
    if (Array.isArray(sec.next) && sec.next.length > 0) groups.push(buildNextGroup(sec.next, sec, p, words));
    if (Array.isArray(sec.strays) && sec.strays.length > 0) groups.push(buildStraysGroup(sec.strays, words));
    sectionsEl.replaceChildren(...groups);
  }

  function renderFooter() {
    const serverErr = typeof state.payload?.error === "string" && state.payload.error.length > 0 ? state.payload.error : null;
    const errText = serverErr ?? state.rpcError;
    if (!errText) {
      footerEl.replaceChildren();
      return;
    }
    const prefix = msg("refreshFailed", dict().refreshFailed);
    footerEl.replaceChildren(el("div", "dag-footer-error", errText.startsWith(prefix) ? errText : prefix + errText));
  }

  // 승인된 HITL 동작(pause/resume/toggle_gate/retry_task)만 pota_dag_action으로 보내고 응답 상태로 즉시 다시 그린다.
  // toggle_gate는 화면에 보인 버튼 의미대로 원하는 게이트 값(enabled)을 명시해 오래된 상태로 게이트를 풀지 않는다.
  async function runDagAction(action, taskId, enabled) {
    if (state.busyAction !== null || !canCallTools()) return;
    const args = { action, view: state.view, width: state.width };
    if (typeof taskId === "string" && taskId.length > 0) args.taskId = taskId;
    if (typeof enabled === "boolean") args.enabled = enabled;
    if (typeof state.root === "string" && state.root.length > 0) args.root = state.root;
    const loc = state.locale ?? normalizeLocale(state.hostContext?.locale);
    if (loc) args.locale = loc;

    state.busyAction = args.taskId ? action + ":" + args.taskId : action;
    render();
    const reqToken = ++state.latestStateReqToken;
    try {
      const result = await callTool("pota_dag_action", args);
      if (result?.__coalesced) {
        showToast(t("actionFailed"));
        return;
      }
      if (result?.isError === true) {
        const detail = toolErrorText(result);
        showToast(t("actionFailed") + (detail ? " " + detail : ""));
        return;
      }
      const sc = result?.structuredContent;
      if (isObj(sc) && Object.keys(sc).length > 0) {
        if (reqToken >= state.latestAppliedReqToken) {
          state.latestAppliedReqToken = reqToken;
          state.loading = false;
          applyPayload(sc, "action");
        }
      } else {
        void refreshState("action");
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      showToast(t("actionFailed") + (detail ? " " + detail : ""));
    } finally {
      state.busyAction = null;
      render();
      scheduleSizeReport();
    }
  }

  function followUpPrompt(task) {
    const goalTitle = typeof state.payload?.goal?.title === "string" ? state.payload.goal.title : "";
    const title = task.title || task.id;
    if (effectiveLocale() === "ko") {
      return "Pota goal" + (goalTitle ? ' "' + goalTitle + '"' : "") + "의 task " + task.id + " (" + title + ")"
        + "를 재검증하고 검토해 주세요. 증거 영수증과 writeScope 변경 사항을 확인한 뒤 결과를 알려 주세요.";
    }
    return "Please re-verify and review Pota task " + task.id + " (" + title + ")"
      + (goalTitle ? ' in goal "' + goalTitle + '"' : "")
      + ". Check its evidence receipts and writeScope changes, then report the result.";
  }

  // 후속 요청 듀얼 브리지: ChatGPT sendFollowUpMessage 우선, Antigravity는 SEP-1865 ui/message 요청을 쓴다.
  async function sendFollowUp(task) {
    const prompt = followUpPrompt(task);
    try {
      if (typeof window.openai?.sendFollowUpMessage === "function") {
        await window.openai.sendFollowUpMessage({ prompt });
      } else if (canSendFollowUp()) {
        const res = await sendRequest("ui/message", { role: "user", content: [{ type: "text", text: prompt }] });
        if (res?.isError === true) {
          showToast(t("followUpFailed"));
          return;
        }
      } else {
        showToast(t("followUpFailed"));
        return;
      }
      showToast(t("followUpSent"));
    } catch {
      showToast(t("followUpFailed"));
    }
  }

  function selectTab(tabId) {
    if (!TAB_IDS.includes(tabId)) return;
    state.tab = tabId;
    render();
    scheduleSizeReport();
  }

  function renderSelection() {
    updateTabs();
    syncSelectedCard();
    renderInspector();
    renderTabPanel();
    scheduleSizeReport();
  }

  function selectTask(taskId, { toggle = false } = {}) {
    if (!findTask(taskId)) return;
    state.selectedTaskId = toggle && state.selectedTaskId === taskId ? null : taskId;
    renderSelection();
  }

  function closeInspector() {
    state.selectedTaskId = null;
    renderSelection();
  }

  // 카드 하위 노드에서 parentNode를 따라 올라가 <g class="card" data-task-id>를 찾는다(MockElement 호환).
  function taskIdFromTarget(target) {
    let node = target;
    for (let depth = 0; node && node !== svgWrapEl && depth < 64; depth += 1) {
      if (typeof node.getAttribute === "function") {
        const id = node.getAttribute("data-task-id");
        if (typeof id === "string" && id.length > 0) return id;
      }
      node = node.parentNode;
    }
    return null;
  }

  function syncSelectedCard() {
    const svgRoot = svgWrapEl.children[0];
    if (!svgRoot) return;
    const stack = [svgRoot];
    while (stack.length > 0) {
      const node = stack.pop();
      const id = typeof node.getAttribute === "function" ? node.getAttribute("data-task-id") : null;
      if (id) {
        node.classList.toggle("is-selected", id === state.selectedTaskId);
        continue;
      }
      const kids = node.children || [];
      for (let i = 0; i < kids.length; i += 1) stack.push(kids[i]);
    }
  }

  function initTabs() {
    const tabsBox = el("div", "dag-views");
    tabsBox.setAttribute("role", "tablist");
    for (const tabId of TAB_IDS) {
      const btn = el("button", "dag-btn dag-tab-btn");
      btn.type = "button";
      btn.dataset.tab = tabId;
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => selectTab(tabId));
      tabButtons.set(tabId, btn);
      tabsBox.appendChild(btn);
    }
    taskSelectEl = el("select", "dag-task-select");
    taskSelectEl.addEventListener("change", () => {
      const id = taskSelectEl.value;
      if (id) selectTask(id);
      else closeInspector();
    });
    tabsEl.replaceChildren(tabsBox, taskSelectEl);
  }

  function updateTabs() {
    const hasGoal = Boolean(state.payload?.goal);
    tabsEl.hidden = !hasGoal;
    const current = activeTab();
    const words = dict();
    for (const tabId of TAB_IDS) {
      const btn = tabButtons.get(tabId);
      if (!btn) continue;
      btn.textContent = msgMap("tabs", tabId, words.tabs[tabId]);
      const active = current === tabId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (!taskSelectEl) return;
    const tasks = payloadTasks();
    const placeholderText = t("selectTask");
    const sig = JSON.stringify({ placeholderText, tasks: tasks.map((task) => [task.id, task.title ?? null]) });
    if (sig !== state.lastTabsSig) {
      state.lastTabsSig = sig;
      const placeholder = el("option", null, placeholderText);
      placeholder.value = "";
      const options = [placeholder];
      for (const task of tasks) {
        const opt = el("option", null, task.title || task.id);
        opt.value = task.id;
        opt.title = task.id;
        options.push(opt);
      }
      taskSelectEl.replaceChildren(...options);
    }
    taskSelectEl.hidden = tasks.length === 0;
    taskSelectEl.setAttribute("aria-label", placeholderText);
    taskSelectEl.value = state.selectedTaskId ?? "";
  }

  function buildFileChip(file, allowAux) {
    const path = typeof file?.path === "string" ? file.path : "";
    const sensitive = file?.sensitive === true;
    const uri = sensitive ? null : file?.uri;
    const clickable = allowAux && !sensitive && isVerifiedFileUri(uri);
    const chip = el(clickable ? "button" : "span", "dag-file-chip" + (sensitive ? " is-sensitive" : ""), path);
    chip.title = sensitive ? path + " · " + t("sensitiveFile") : path;
    if (clickable) {
      chip.type = "button";
      chip.addEventListener("click", () => void openAuxPaneFile(uri));
    }
    return chip;
  }

  function buildDiffRow(file, allowAux) {
    const row = el("div", "dag-diff-row");
    const left = el("div", "dag-diff-left");
    left.append(el("span", "dag-badge", typeof file.status === "string" && file.status.length > 0 ? file.status : "M"), buildFileChip(file, allowAux));
    const stat = el("span", "dag-diff-stat");
    if (file.binary === true) {
      stat.append(el("span", null, "bin"));
    } else {
      stat.append(el("span", "dag-diff-add", "+" + formatCount(file.added)), " ", el("span", "dag-diff-del", "-" + formatCount(file.deleted)));
    }
    row.append(left, stat);
    return row;
  }

  function diffTotalsText(totals, fileCount, truncated) {
    const tot = isObj(totals) ? totals : {};
    const files = typeof tot.files === "number" ? tot.files : fileCount;
    return files + " " + t("filesLabel") + " · +" + formatCount(tot.added) + " -" + formatCount(tot.deleted)
      + (truncated ? " · " + t("truncated") : "");
  }

  function addKv(grid, key, value) {
    if (value === undefined || value === null) return;
    const text = String(value);
    if (text.length === 0) return;
    const row = el("div", "dag-kv-row");
    row.append(el("span", "dag-kv-key", key), el("span", "dag-kv-val", text));
    grid.appendChild(row);
  }

  function stateTone(stateKey) {
    return { completed: "is-ok", active: "is-info", ready: "is-warn", blocked: "is-bad" }[stateKey] || "";
  }

  function buildInspectorCard(task, opts) {
    const words = dict();
    const card = el("div", "dag-inspector-card");
    card.dataset.taskId = task.id;

    const head = el("div", "dag-inspector-head");
    const titleWrap = el("div", "dag-inspector-title-wrap");
    titleWrap.append(el("div", "dag-inspector-kicker", t("inspector")), el("div", "dag-inspector-title", task.title || task.id));
    const closeBtn = el("button", "dag-btn dag-inspector-close", "×");
    closeBtn.type = "button";
    closeBtn.title = t("close");
    closeBtn.setAttribute("aria-label", t("close"));
    closeBtn.addEventListener("click", () => closeInspector());
    head.append(titleWrap, closeBtn);
    card.appendChild(head);

    const badges = el("div", "dag-badges-row");
    const stateKey = typeof task.state === "string" ? task.state : task.status;
    if (typeof stateKey === "string") {
      badges.appendChild(el("span", "dag-badge " + stateTone(stateKey), msgMap("state", stateKey, words.state[stateKey] || stateKey)));
    }
    if (typeof task.wave === "number") badges.appendChild(el("span", "dag-badge", t("wave") + " " + (task.wave + 1)));
    if (task.approvalGate === true) badges.appendChild(el("span", "dag-badge is-warn dag-gate-badge", "⏸ " + t("gateBadge")));
    card.appendChild(badges);

    const grid = el("div", "dag-kv-grid");
    addKv(grid, "ID", task.id);
    addKv(grid, t("status"), task.status);
    addKv(grid, t("agent"), task.assignedAgentId);
    addKv(grid, t("route"), [task.route, task.kind].filter((x) => typeof x === "string" && x.length > 0).join(" · "));
    addKv(grid, t("model"), task.model);
    addKv(grid, t("effectiveModel"), task.effectiveModel);
    addKv(grid, t("resolvedModel"), [task.resolvedModel, task.resolvedTier].filter((x) => typeof x === "string" && x.length > 0).join(" · "));
    const effortParts = [];
    if (typeof task.effort === "string" && task.effort.length > 0) effortParts.push(task.effort);
    if (typeof task.resolvedEffort === "string" && task.resolvedEffort.length > 0 && task.resolvedEffort !== task.effort) {
      effortParts.push("→ " + task.resolvedEffort);
    }
    if (typeof task.effortSource === "string" && task.effortSource.length > 0) effortParts.push("(" + task.effortSource + ")");
    addKv(grid, t("effort"), effortParts.join(" "));
    addKv(grid, t("elapsedCol"), task.elapsed);
    const transcript = isObj(task.transcript) ? task.transcript : null;
    if (transcript && isObj(transcript.tokens)) {
      const turns = typeof transcript.turns === "number" ? " · " + transcript.turns + " " + t("turnsUnit") : "";
      addKv(grid, t("tokens"), formatTokens(transcript.tokens) + turns + (transcript.tokens.truncated ? " · " + t("truncated") : ""));
      if (typeof transcript.tokens.cacheHitRate === "number") {
        addKv(grid, t("cacheHit"), Math.round(transcript.tokens.cacheHitRate * 1000) / 10 + "%");
      }
    }
    addKv(grid, t("blocker"), task.blocker);
    card.appendChild(grid);

    const actions = el("div", "dag-inspector-actions");
    const gated = task.approvalGate === true;
    // 완료 task와 실행 중 task의 게이트 설정은 서버가 거부하므로 토글을 노출하지 않는다.
    if (opts.canAct && task.status !== "completed" && (gated || task.status !== "active")) {
      const gateBtn = el("button", "dag-btn dag-gate-btn" + (gated ? " is-active" : ""), gated ? t("gateOff") : t("gateOn"));
      gateBtn.type = "button";
      gateBtn.dataset.action = "toggle_gate";
      gateBtn.setAttribute("aria-pressed", gated ? "true" : "false");
      gateBtn.disabled = state.busyAction !== null;
      gateBtn.addEventListener("click", () => void runDagAction("toggle_gate", task.id, !gated));
      actions.appendChild(gateBtn);
    }
    // 막힌 task만 재시도할 수 있다. retry_task는 enabled 없이 taskId만 보낸다.
    if (opts.canAct && task.status === "blocked") {
      const retryBtn = el("button", "dag-btn dag-retry-btn", t("retry"));
      retryBtn.type = "button";
      retryBtn.dataset.action = "retry_task";
      retryBtn.dataset.taskId = task.id;
      retryBtn.title = t("retryHint");
      retryBtn.setAttribute("aria-label", t("retry") + ": " + t("retryHint"));
      retryBtn.disabled = state.busyAction !== null;
      retryBtn.addEventListener("click", () => void runDagAction("retry_task", task.id));
      actions.appendChild(retryBtn);
    }
    if (opts.canFollow) {
      const followBtn = el("button", "dag-btn dag-followup-btn", t("followUp"));
      followBtn.type = "button";
      followBtn.addEventListener("click", () => void sendFollowUp(task));
      actions.appendChild(followBtn);
    }
    if (actions.childNodes.length > 0) card.appendChild(actions);

    const receiptsBox = el("div", "dag-inspector-sub dag-receipts");
    receiptsBox.appendChild(el("div", "dag-inspector-sub-title", t("receipts")));
    const receipts = Array.isArray(task.receipts) ? task.receipts.filter(isObj) : [];
    if (receipts.length === 0) receiptsBox.appendChild(el("div", "dag-detail-line", t("noReceipts")));
    for (const receipt of receipts) {
      const row = el("div", "dag-receipt-row");
      const top = el("div", "dag-receipt-top");
      const exitOk = receipt.exitCode === 0;
      const exitTone = typeof receipt.exitCode === "number" ? (exitOk ? " is-ok" : " is-bad") : "";
      top.appendChild(el("span", "dag-badge" + exitTone, typeof receipt.kind === "string" ? receipt.kind : "?"));
      if (typeof receipt.exitCode === "number") top.appendChild(el("span", "dag-ev", "exit " + receipt.exitCode));
      // fresh: null인 tool 영수증은 폴링 경로에서 계산하지 않은 상태이므로 fresh/stale 대신 unknown으로 표시한다.
      const freshness = receipt.fresh === true
        ? t("fresh")
        : receipt.fresh === false
          ? t("stale")
          : receipt.source === "tool" ? t("freshUnknown") : t("declared");
      top.appendChild(el("span", "dag-ev" + (receipt.fresh === true ? " is-done" : ""), freshness));
      if (typeof receipt.verifiedAt === "string" && receipt.verifiedAt.length > 0) top.appendChild(el("span", "dag-ev", receipt.verifiedAt));
      row.appendChild(top);
      if (typeof receipt.command === "string" && receipt.command.length > 0) row.appendChild(el("div", "dag-receipt-cmd", receipt.command));
      receiptsBox.appendChild(row);
    }
    card.appendChild(receiptsBox);

    if (Array.isArray(task.writeScope) && task.writeScope.length > 0) {
      const diffBox = el("div", "dag-inspector-sub dag-scoped-diff");
      diffBox.appendChild(el("div", "dag-inspector-sub-title", t("writeScopeDiff")));
      const scoped = isObj(task.writeScopeDiff) ? task.writeScopeDiff : null;
      const files = scoped && Array.isArray(scoped.files) ? scoped.files.filter(isObj) : [];
      if (files.length === 0) {
        diffBox.appendChild(el("div", "dag-detail-line", t("noScopedChanges")));
      } else {
        diffBox.appendChild(el("div", "dag-detail-line", diffTotalsText(scoped.totals, files.length, false)));
        for (const file of files) diffBox.appendChild(buildDiffRow(file, opts.allowAux));
      }
      const scopeFiles = Array.isArray(task.files) ? task.files.filter(isObj) : [];
      if (scopeFiles.length > 0) {
        const filesRow = el("div", "dag-files-row");
        for (const file of scopeFiles) filesRow.appendChild(buildFileChip(file, opts.allowAux));
        diffBox.appendChild(filesRow);
      }
      card.appendChild(diffBox);
    }
    return card;
  }

  function renderInspector() {
    const p = state.payload;
    const task = p?.goal && state.selectedTaskId !== null ? findTask(state.selectedTaskId) : null;
    const opts = {
      allowAux: canOpenAuxPane(),
      canAct: canCallTools() && !p?.ended,
      canFollow: canSendFollowUp(),
    };
    const sig = JSON.stringify({
      task,
      opts,
      busy: state.busyAction,
      goalTitle: p?.goal?.title ?? null,
      locale: effectiveLocale(),
      messages: task ? (p?.messages ?? null) : null,
    });
    if (sig === state.lastInspectorSig) return;
    state.lastInspectorSig = sig;
    if (!task) {
      inspectorEl.hidden = true;
      inspectorEl.replaceChildren();
      return;
    }
    inspectorEl.hidden = false;
    inspectorEl.replaceChildren(buildInspectorCard(task, opts));
  }

  function buildDiffPanel(p, allowAux) {
    const diff = isObj(p.gitDiff) ? p.gitDiff : null;
    if (!diff || diff.available !== true) return [el("div", "dag-empty-box", t("diffUnavailable"))];
    const files = Array.isArray(diff.files) ? diff.files.filter(isObj) : [];
    if (files.length === 0) return [el("div", "dag-empty-box", t("noDiff"))];
    const box = el("section", "dag-group dag-diff-list");
    box.appendChild(el("div", "dag-group-title", diffTotalsText(diff.totals, files.length, diff.truncated === true)));
    for (const file of files) box.appendChild(buildDiffRow(file, allowAux));
    return [box];
  }

  function buildPlanPanel(p) {
    const plan = isObj(p.planOverview) ? p.planOverview : null;
    if (!plan) return [el("div", "dag-empty-box", t("noPlan"))];
    const box = el("section", "dag-group dag-plan-overview");
    box.appendChild(el("div", "dag-inspector-title", plan.title || p.goal?.planId || p.goal?.title || ""));
    const planId = typeof plan.planId === "string" && plan.planId.length > 0 ? plan.planId : p.goal?.planId;
    if (typeof planId === "string" && planId.length > 0) box.appendChild(el("div", "dag-root-label", planId));
    const grid = el("div", "dag-kv-grid");
    addKv(grid, t("goalSummaryLabel"), plan.goalSummary);
    addKv(grid, t("currentRequestLabel"), plan.currentRequest);
    if (grid.childNodes.length > 0) box.appendChild(grid);
    const checklist = isObj(plan.checklist) ? plan.checklist : null;
    if (checklist) {
      const done = typeof checklist.done === "number" ? checklist.done : 0;
      const total = typeof checklist.total === "number" ? checklist.total : done + (typeof checklist.pending === "number" ? checklist.pending : 0);
      box.appendChild(el("div", "dag-inspector-sub-title", t("checklistLabel") + " " + done + "/" + total));
      const items = Array.isArray(checklist.items) ? checklist.items.filter(isObj) : [];
      if (items.length > 0) {
        const list = el("div", "dag-plan-list");
        for (const item of items) {
          const row = el("div", "dag-plan-item");
          row.append(el("span", "dag-plan-check" + (item.done ? " is-done" : ""), item.done ? "✓" : "○"), el("span", null, item.text ?? ""));
          list.appendChild(row);
        }
        box.appendChild(list);
      }
    }
    if (plan.truncated === true) box.appendChild(el("div", "dag-more", t("truncated")));
    return [box];
  }

  function buildStatsPanel(p) {
    const stats = isObj(p.agentStats) ? p.agentStats : {};
    const tasks = payloadTasks();
    const nodes = [];

    const rollup = el("section", "dag-group dag-stats-rollup");
    rollup.appendChild(el("div", "dag-group-title", t("statsSummary")));
    const grid = el("div", "dag-kv-grid");
    const doneTasks = typeof stats.doneTasks === "number" ? stats.doneTasks : tasks.filter((task) => task.status === "completed").length;
    const totalTasks = typeof stats.totalTasks === "number" ? stats.totalTasks : tasks.length;
    addKv(grid, t("tasksCol"), doneTasks + "/" + totalTasks);
    const bottleneck = isObj(stats.waveBottleneck) ? stats.waveBottleneck : null;
    addKv(grid, t("bottleneck"), bottleneck
      ? t("wave") + " " + bottleneck.waveNumber + " (" + bottleneck.completed + "/" + bottleneck.total + ")"
      : t("none"));
    const modelCounts = isObj(stats.modelCounts) ? Object.entries(stats.modelCounts) : [];
    addKv(grid, t("modelCol"), modelCounts.length > 0 ? modelCounts.map(([name, count]) => name + " ×" + count).join(", ") : t("none"));
    // 트랜스크립트가 없는 호스트(ChatGPT/Codex·Claude Code)에서는 토큰 롤업을 생략한다.
    if (typeof stats.enrichedAgents === "number" && stats.enrichedAgents > 0) {
      addKv(grid, t("agent"), stats.enrichedAgents);
      addKv(grid, t("tokens"), formatTokens({
        input: stats.totalInputTokens,
        cacheRead: stats.totalCacheReadTokens,
        output: stats.totalOutputTokens,
      }) + " · " + formatCount(stats.totalTurns) + " " + t("turnsUnit"));
    }
    rollup.appendChild(grid);
    nodes.push(rollup);

    if (tasks.length > 0) {
      const wrap = el("div", "dag-stats-table-wrap");
      const table = el("table", "dag-stats-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const key of ["tasksCol", "agent", "modelCol", "effortCol", "tokens", "elapsedCol", "gateCol", "receiptsCol"]) {
        headRow.appendChild(el("th", null, t(key)));
      }
      thead.appendChild(headRow);
      const tbody = el("tbody");
      for (const task of tasks) {
        const row = el("tr", "dag-stats-row" + (state.selectedTaskId === task.id ? " is-selected" : ""));
        row.dataset.taskId = task.id;
        const nameCell = el("td");
        const nameBtn = el("button", "dag-stats-task-btn", task.title || task.id);
        nameBtn.type = "button";
        nameBtn.title = task.id;
        nameBtn.addEventListener("click", () => selectTask(task.id));
        nameCell.appendChild(nameBtn);
        const agentId = typeof task.assignedAgentId === "string" ? task.assignedAgentId : "";
        const agentCell = el("td", null, agentId.length > 12 ? agentId.slice(0, 8) + "…" : (agentId || "-"));
        if (agentId) agentCell.title = agentId;
        const modelName = task.resolvedModel || task.effectiveModel || task.model || "-";
        const effortName = task.resolvedEffort || task.effort || "-";
        const tokensText = isObj(task.transcript) && isObj(task.transcript.tokens) ? formatTokens(task.transcript.tokens) : "-";
        row.append(
          nameCell,
          agentCell,
          el("td", null, modelName),
          el("td", null, effortName),
          el("td", null, tokensText),
          el("td", null, task.elapsed || "-"),
          el("td", null, task.approvalGate === true ? "⏸" : ""),
          el("td", null, Array.isArray(task.receipts) ? task.receipts.length : 0),
        );
        row.addEventListener("click", () => selectTask(task.id));
        tbody.appendChild(row);
      }
      table.append(thead, tbody);
      wrap.appendChild(table);
      nodes.push(wrap);
    }
    return nodes;
  }

  function renderTabPanel() {
    const p = state.payload;
    const tab = activeTab();
    if (tab === "dag" || !p?.goal) {
      tabPanelEl.hidden = true;
      if (state.lastTabPanelSig !== "") {
        state.lastTabPanelSig = "";
        tabPanelEl.replaceChildren();
      }
      return;
    }
    const allowAux = canOpenAuxPane();
    const sig = JSON.stringify({
      tab,
      data: tab === "diff" ? p.gitDiff ?? null : tab === "plan" ? [p.planOverview ?? null, p.goal.planId ?? null] : [p.agentStats ?? null, p.tasks ?? null],
      selected: tab === "stats" ? state.selectedTaskId : null,
      allowAux,
      locale: effectiveLocale(),
      messages: p.messages ?? null,
    });
    tabPanelEl.hidden = false;
    if (sig === state.lastTabPanelSig) return;
    state.lastTabPanelSig = sig;
    tabPanelEl.dataset.tab = tab;
    const nodes = tab === "diff" ? buildDiffPanel(p, allowAux) : tab === "plan" ? buildPlanPanel(p) : buildStatsPanel(p);
    tabPanelEl.replaceChildren(...nodes);
  }

  function render() {
    renderHeader();
    updateTabs();
    updateToolbar();
    renderSvg();
    const tab = activeTab();
    // DAG 탭 외에는 SVG·섹션·보기 버튼을 숨기고 읽기 전용 탭 패널을 노출한다.
    if (tab !== "dag") svgWrapEl.hidden = true;
    sectionsEl.hidden = tab !== "dag";
    if (viewsBoxEl) viewsBoxEl.hidden = tab !== "dag";
    syncSelectedCard();
    renderInspector();
    renderSections();
    renderTabPanel();
    renderFooter();
  }

  function onHostMessage(event) {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!isObj(data) || data.jsonrpc !== "2.0") return;

    const hasMethod = typeof data.method === "string";
    const hasId = "id" in data && data.id !== undefined && data.id !== null;

    if (!hasMethod && hasId) {
      const pending = pendingRequests.get(data.id);
      if (!pending) return;
      pendingRequests.delete(data.id);
      window.clearTimeout(pending.timer);
      if (data.error) {
        const err = new Error(data.error.message || "JSON-RPC error");
        err.code = data.error.code;
        pending.reject(err);
      } else {
        pending.resolve(data.result);
      }
      return;
    }

    if (hasMethod && hasId) {
      postToHost(data.method === "ping"
        ? { jsonrpc: "2.0", id: data.id, result: {} }
        : { jsonrpc: "2.0", id: data.id, error: { code: -32601, message: "Method not found: " + data.method } });
      return;
    }

    if (hasMethod && !hasId) {
      const params = isObj(data.params) ? data.params : {};
      if (data.method === "ui/notifications/tool-input") {
        const ti = extractToolInput(params);
        if (ti) {
          if (ti.root) state.root = ti.root;
          if (ti.view) state.view = ti.view;
          if (ti.locale) state.locale = ti.locale;
        }
        if (!state.payload) {
          state.loading = true;
          render();
        }
      } else if (data.method === "ui/notifications/tool-result") {
        state.loading = false;
        state.hasUserNavigated = false;
        const sc = extractStructuredContent(params) ?? params.structuredContent;
        if (isOpenSummary(sc)) hydrateFromOpenSummary(sc);
        else if (isObj(sc) && Object.keys(sc).length > 0) applyPayload(sc, "tool-result");
        else void refreshState("recover");
      } else if (data.method === "ui/notifications/tool-cancelled") {
        state.loading = false;
        render();
      } else if (data.method === "ui/notifications/host-context-changed") {
        state.hostContext = mergeHostContext(state.hostContext, params);
        applyHostContext(state.hostContext);
        render();
        scheduleSizeReport();
      }
    }
  }

  function onOpenAiSetGlobals(event) {
    const globals = isObj(event?.detail?.globals)
      ? event.detail.globals
      : (isObj(window.openai) ? window.openai : null);
    state.bridgeMode = "openai";
    state.initialized = true;
    state.rpcError = null;
    syncOpenAiGlobals(globals);
    flushPendingOpenHydration();
    scheduleInitialHydration();
    render();
    scheduleSizeReport();
  }

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
    const target = event.target;
    const tag = target && typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "select" || tag === "textarea" || target?.isContentEditable) return;
    const idx = Number(event.key) - 1;
    if (idx >= 0 && idx < VIEW_IDS.length) {
      event.preventDefault();
      selectView(VIEW_IDS[idx]);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearPollTimer();
      return;
    }
    if (state.initialized && canCallTools() && state.payload?.ended == null) void refreshState("visibility");
  });

  if (typeof ResizeObserver === "function") {
    const svgObserver = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? svgWrapEl.clientWidth;
      if (!Number.isFinite(w) || w <= 0) return;
      const qW = quantizeWidth(w);
      state.width = qW;
      if (state.resizeTimer !== null) window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(() => {
        state.resizeTimer = null;
        if (!state.initialized || !canCallTools() || !state.payload || !state.payload.goal) return;
        const renderedW = state.lastServerWidth ?? state.payload.width ?? qW;
        if (Math.abs(qW - renderedW) >= 20) void refreshState("resize");
      }, RESIZE_DEBOUNCE_MS);
    });
    svgObserver.observe(svgWrapEl);
    new ResizeObserver(() => scheduleSizeReport()).observe(appEl);
  }

  // 호스트 응답 전 초기 테마 깜빡임을 막기 위해 시스템 선호 테마로 먼저 맞춘다.
  if (!document.documentElement.dataset.theme) {
    const dark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  initTabs();
  initToolbar();

  // 모든 카드(<g class="card" data-task-id>) 클릭을 SVG 래퍼에서 위임 처리해 인스펙터를 연다.
  svgWrapEl.addEventListener("click", (event) => {
    const taskId = taskIdFromTarget(event?.target);
    if (taskId) selectTask(taskId, { toggle: true });
  });

  // 핸드셰이크 메시지를 놓치지 않도록 초기화 송신 전에 두 호스트 리스너를 모두 등록한다.
  window.addEventListener("message", onHostMessage);
  window.addEventListener("openai:set_globals", onOpenAiSetGlobals);

  if (hasOpenAiBridge()) {
    state.bridgeMode = "openai";
    state.initialized = true;
    syncOpenAiGlobals(window.openai);
    render();
    scheduleSizeReport();
    scheduleInitialHydration();

    if (window.parent && window.parent !== window) {
      sendRequest("ui/initialize", {
        protocolVersion: "2026-01-26",
        appInfo: { name: APP_TITLE, version: APP_VERSION },
        appCapabilities: {},
      }, OPENAI_PROBE_TIMEOUT_MS).then((res) => {
        state.sep1865Ready = true;
        state.lastReportedHeight = null;
        if (isObj(res?.hostCapabilities)) {
          state.hostCapabilities = { ...state.hostCapabilities, ...res.hostCapabilities };
        }
        state.hostContext = mergeHostContext(state.hostContext, isObj(res?.hostContext) ? res.hostContext : {});
        applyHostContext(state.hostContext);
        sendNotification("ui/notifications/initialized", {});
        render();
        schedulePoll();
        scheduleSizeReport();
      }).catch(() => {
        // 순수 window.openai 호스트에서는 SEP-1865 프로브 실패를 오류로 노출하지 않는다.
        if (state.bridgeMode === "openai") return;
      });
    }
  } else {
    state.bridgeMode = "sep1865";
    render();
    sendRequest("ui/initialize", {
      protocolVersion: "2026-01-26",
      appInfo: { name: APP_TITLE, version: APP_VERSION },
      appCapabilities: {},
    }).then((res) => {
      state.initialized = true;
      state.sep1865Ready = true;
      state.hostCapabilities = isObj(res?.hostCapabilities) ? res.hostCapabilities : {};
      state.hostContext = mergeHostContext(state.hostContext, isObj(res?.hostContext) ? res.hostContext : {});
      applyHostContext(state.hostContext);
      sendNotification("ui/notifications/initialized", {});
      flushPendingOpenHydration();
      render();
      scheduleSizeReport();
    }).catch((err) => {
      if (state.bridgeMode === "openai") return;
      state.loading = false;
      state.rpcError = err instanceof Error ? err.message : String(err);
      render();
    });
  }
})();`;

/**
 * Antigravity(SEP-1865) 및 ChatGPT Desktop/Codex(window.openai)용 단일 자체 완결 HTML 문서를 생성한다.
 * @param {{ title?: string, version?: string }} [options]
 * @returns {string}
 */
export function renderDagAppHtml({ title = "Pota DAG", version = "2.2.1" } = {}) {
  const appTitle = typeof title === "string" && title.length > 0 ? title : "Pota DAG";
  const appVersion = typeof version === "string" && version.length > 0 ? version : "2.2.1";
  const scriptConstants = `const APP_TITLE = ${escapeJsonForScript(appTitle)};\n  const APP_VERSION = ${escapeJsonForScript(appVersion)};\n`;
  const scriptBody = APP_SCRIPT.replace("(() => {\n", `(() => {\n  ${scriptConstants}`);

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(appTitle)}</title>`,
    `<style>${APP_CSS}</style>`,
    "</head>",
    "<body>",
    '<main id="app" class="dag-app">',
    '  <header id="dag-header" class="dag-header"></header>',
    '  <nav id="dag-tabs" class="dag-tabs" aria-label="DAG tabs" hidden></nav>',
    '  <nav id="dag-toolbar" class="dag-toolbar" aria-label="DAG controls"></nav>',
    '  <section id="dag-svg-wrap" class="dag-svg-wrap" hidden></section>',
    '  <section id="dag-inspector" class="dag-inspector" aria-live="polite" hidden></section>',
    '  <section id="dag-sections" class="dag-sections"></section>',
    '  <section id="dag-tab-panel" class="dag-tab-panel" hidden></section>',
    '  <footer id="dag-footer"></footer>',
    "</main>",
    '<div id="dag-toast" class="dag-toast" role="status" aria-live="polite" hidden></div>',
    `<script>${scriptBody}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
