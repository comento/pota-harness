// Antigravity MCP App(ui://pota-dag/app.html)용 단일 자체 완결 HTML/CSS/JS 생성기.
// 기본 CSP(default-src 'none') 준수를 위해 외부 리소스·fetch·WebSocket 없이 인라인 코드만 사용한다.

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
.dag-views { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
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
.dag-toast { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); max-width: calc(100vw - 24px); padding: 7px 12px; border-radius: 8px; background: var(--bg-inv); color: var(--fg-inv); font-size: 12px; font-weight: 500; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22); z-index: 100; cursor: pointer; }
`;

const APP_SCRIPT = `(() => {
  "use strict";

  const VIEW_IDS = ["previous", "current", "next", "all"];
  const ACTIVE_POLL_MS = 5000;
  const IDLE_POLL_MS = 30000;
  const BACKOFF_AFTER = 3;
  const MAX_BACKOFF_MS = 120000;
  const RPC_TIMEOUT_MS = 15000;
  const MAX_IN_FLIGHT_TOOLS = 4;
  const RESIZE_DEBOUNCE_MS = 150;
  const TOAST_MS = 4000;
  const SAFE_VAR_RE = /^--(?:color|font)-[a-z0-9-]+$/i;
  const UNSAFE_CSS_VAL_RE = /[;{}<>\\\\]|url\\(|expression\\(/i;
  const BLOCKED_SVG_TAGS = new Set([
    "script", "foreignobject", "iframe", "object", "embed",
    "frame", "frameset", "applet", "base", "link", "meta",
  ]);
  const FALLBACK_MESSAGES = {
    ko: {
      noGoal: "활성 Pota goal이 없습니다. \`pota-plan\`으로 계획을 세우면 여기에 DAG가 표시됩니다.",
      noWorkspace: "열린 Pota 워크스페이스를 찾지 못했습니다. 작업을 시작하거나 워크스페이스를 선택한 뒤 새로고침하세요.",
      loading: "Pota goal 상태를 읽는 중…",
      refreshFailed: "상태 갱신 실패: ",
      openFileFailed: "보조 패널에서 파일을 열지 못했습니다.",
      refresh: "↻",
      refreshLabel: "새로고침",
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
    },
    en: {
      noGoal: "No active Pota goal. Plan one with \`pota-plan\` and its DAG appears here.",
      noWorkspace: "No Pota workspace found yet. Start work or choose a workspace, then refresh.",
      loading: "Reading the Pota goal…",
      refreshFailed: "Refresh failed: ",
      openFileFailed: "Could not open file in side pane.",
      refresh: "↻",
      refreshLabel: "Refresh",
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
    },
  };

  const appEl = document.getElementById("app");
  const headerEl = document.getElementById("dag-header");
  const toolbarEl = document.getElementById("dag-toolbar");
  const svgWrapEl = document.getElementById("dag-svg-wrap");
  const sectionsEl = document.getElementById("dag-sections");
  const footerEl = document.getElementById("dag-footer");
  const toastEl = document.getElementById("dag-toast");

  const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const isValidView = (v) => VIEW_IDS.includes(v);
  const quantizeWidth = (w) => Math.max(240, Math.min(1600, Math.floor(w / 20) * 20));
  const normalizeLocale = (val) => {
    if (typeof val !== "string" || val.length === 0) return null;
    const low = val.toLowerCase();
    return low.startsWith("ko") ? "ko" : low.startsWith("en") ? "en" : null;
  };
  const isVerifiedFileUri = (uri) => typeof uri === "string" && uri.startsWith("file://") && uri.length > 7;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  const state = {
    initialized: false,
    hostCapabilities: {},
    hostContext: {},
    payload: null,
    view: "all",
    root: null,
    locale: null,
    width: 420,
    lastServerWidth: null,
    expandedTaskId: null,
    loading: true,
    refreshing: false,
    rpcError: null,
    consecutiveFailures: 0,
    lastMountedSvgSource: null,
    lastHeaderSig: "",
    lastSectionsSig: "",
    lastReportedHeight: null,
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
  let refreshBtn = null;

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

  function postToHost(payload) {
    if (window.parent && typeof window.parent.postMessage === "function") {
      window.parent.postMessage(payload, "*");
    }
  }

  function sendNotification(method, params) {
    postToHost({ jsonrpc: "2.0", method, params: params ?? {} });
  }

  function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = state.nextRpcId++;
      const timer = window.setTimeout(() => {
        if (!pendingRequests.has(id)) return;
        pendingRequests.delete(id);
        reject(new Error("Request timed out (" + method + ")"));
      }, RPC_TIMEOUT_MS);
      pendingRequests.set(id, { resolve, reject, timer });
      postToHost({ jsonrpc: "2.0", id, method, params: params ?? {} });
    });
  }

  function dispatchToolCall(entry) {
    state.inFlightTools += 1;
    sendRequest("tools/call", { name: entry.name, arguments: entry.args })
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
      sendNotification("ui/notifications/size-changed", { height: nextHeight });
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
    if (!isVerifiedFileUri(uri)) {
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
    if (!state.initialized || document.hidden) return;
    if (state.payload && state.payload.ended !== null && state.payload.ended !== undefined) return;
    state.pollTimer = window.setTimeout(() => {
      state.pollTimer = null;
      if (!document.hidden && state.payload?.ended == null) void refreshState("poll");
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
      state.consecutiveFailures = 0;
      void refreshState("workspace");
    });
    wsWrap.appendChild(select);
    return wsWrap;
  }

  function renderHeader() {
    const p = state.payload;
    const sig = JSON.stringify({
      title: p?.goal?.title ?? null,
      status: p?.goal?.status ?? null,
      ended: p?.ended ?? null,
      planId: p?.goal?.planId ?? null,
      planFileUri: p?.goal?.planFileUri ?? null,
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
      if (isVerifiedFileUri(p.goal.planFileUri)) {
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
    for (const viewId of VIEW_IDS) {
      const btn = el("button", "dag-btn");
      btn.type = "button";
      btn.dataset.view = viewId;
      btn.addEventListener("click", () => selectView(viewId));
      viewButtons.set(viewId, btn);
      viewsBox.appendChild(btn);
    }
    refreshBtn = el("button", "dag-btn dag-refresh-btn");
    refreshBtn.type = "button";
    refreshBtn.addEventListener("click", () => {
      state.consecutiveFailures = 0;
      state.rpcError = null;
      void refreshState("manual", { forceEpoch: true });
    });
    toolbarEl.replaceChildren(viewsBox, refreshBtn);
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
      const filesRow = el("div", "dag-files-row");
      for (const file of files) {
        const label = typeof file === "string" ? file : (file.label || file.path || file.uri || "");
        if (!label) continue;
        const uri = typeof file === "object" ? file.uri : null;
        const chip = el(isVerifiedFileUri(uri) ? "button" : "span", "dag-file-chip", label);
        chip.title = (typeof file === "object" && file.path) ? file.path : label;
        if (isVerifiedFileUri(uri)) {
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

  function render() {
    renderHeader();
    updateToolbar();
    renderSvg();
    renderSections();
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
        const args = isObj(params.arguments) ? params.arguments : {};
        if (typeof args.root === "string" && args.root.length > 0) state.root = args.root;
        if (isValidView(args.view)) state.view = args.view;
        const loc = normalizeLocale(args.locale);
        if (loc) state.locale = loc;
        if (!state.payload) {
          state.loading = true;
          render();
        }
      } else if (data.method === "ui/notifications/tool-result") {
        state.loading = false;
        state.hasUserNavigated = false;
        const sc = params.structuredContent;
        if (isObj(sc) && Object.keys(sc).length > 0) applyPayload(sc, "tool-result");
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
    if (state.initialized && state.payload?.ended == null) void refreshState("visibility");
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
        if (!state.initialized || !state.payload || !state.payload.goal) return;
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

  initToolbar();
  render();

  // 핸드셰이크 메시지를 놓치지 않도록 ui/initialize 송신 전에 message 리스너를 등록한다.
  window.addEventListener("message", onHostMessage);

  sendRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: APP_TITLE, version: APP_VERSION },
    appCapabilities: {},
  }).then((res) => {
    state.initialized = true;
    state.hostCapabilities = isObj(res?.hostCapabilities) ? res.hostCapabilities : {};
    state.hostContext = isObj(res?.hostContext) ? res.hostContext : {};
    applyHostContext(state.hostContext);
    sendNotification("ui/notifications/initialized", {});
    render();
    scheduleSizeReport();
  }).catch((err) => {
    state.loading = false;
    state.rpcError = err instanceof Error ? err.message : String(err);
    render();
  });
})();`;

/**
 * Antigravity MCP App용 단일 자체 완결 HTML 문서를 생성한다.
 * @param {{ title?: string, version?: string }} [options]
 * @returns {string}
 */
export function renderDagAppHtml({ title = "Pota DAG", version = "2.2.0" } = {}) {
  const appTitle = typeof title === "string" && title.length > 0 ? title : "Pota DAG";
  const appVersion = typeof version === "string" && version.length > 0 ? version : "2.2.0";
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
    '  <nav id="dag-toolbar" class="dag-toolbar" aria-label="DAG controls"></nav>',
    '  <section id="dag-svg-wrap" class="dag-svg-wrap" hidden></section>',
    '  <section id="dag-sections" class="dag-sections"></section>',
    '  <footer id="dag-footer"></footer>',
    "</main>",
    '<div id="dag-toast" class="dag-toast" role="status" aria-live="polite" hidden></div>',
    `<script>${scriptBody}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
