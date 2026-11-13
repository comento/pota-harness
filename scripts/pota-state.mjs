#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { contextResult, foreignSessionContextResult, prependContext, updateNoticeLine } from "./pota-state-context.mjs";
import { continuationReason, stopAllowedMessage, stopHookOutput } from "./pota-state-hook.mjs";
import { initializeProject } from "./pota-state-init.mjs";
import { evaluateStop, isGoalOwnedBySession, reconcileWorktreeState } from "./pota-goal.mjs";
import { readHookGuard, readStopGuard, writeHookGuard, writeStopGuard } from "./pota-goal-state.mjs";
import { hookIndexSnapshot } from "./pota-index.mjs";
import { resolvePluginRoot, resolveRepoRoot } from "./pota-paths.mjs";
import { sessionStartUpdate } from "./pota-update-state.mjs";

const recoverableGoalStatuses = new Set(["active", "paused", "blocked"]);

if (isCliEntry()) {
  const event = process.argv[2] ?? "manual";
  const payload = await readHookInput();
  const result = isHookEvent(event)
    ? await runStateResult(event, { payload }).catch((error) => hookFailureResult(event, error))
    : await runStateResult(event, { payload });
  if (isHookEvent(event)) {
    console.log(JSON.stringify(result.hookOutput ?? {}));
  } else {
    console.log(result.message);
  }
  if (result.status !== 0) process.exitCode = result.status;
}

export async function runState(event = "manual", options = {}) {
  return (await runStateResult(event, options)).message;
}

export async function runStateResult(event = "manual", {
  root,
  locale = localeValue(),
  payload,
  update = {},
} = {}) {
  const resolvedRoot = resolveRoot(root, payload);
  const ko = locale.toLowerCase().startsWith("ko");

  if (event === "manual" || event === "init") {
    await initializeProject(resolvedRoot, ko);
    return {
      status: 0,
      message: ko
        ? "Pota이 MEMORY.md, PLAN.md, docs/memory, docs/plan을 초기화했습니다."
        : "Pota initialized MEMORY.md, PLAN.md, docs/memory, and docs/plan.",
    };
  }

  if (event === "session-start" || event === "user-prompt-submit") {
    const result = await promptContextResult(event, { ko, resolvedRoot, payload });
    return event === "session-start" ? withUpdateNotice(result, ko, update) : result;
  }

  if (event === "post-tool-use") {
    // Only remind while an owned goal is active: an unconditional reminder after every edit accumulates in the
    // conversation prefix, raising cached-read cost and bringing compaction (a full cache reset) sooner.
    const { state } = await reconcileWorktreeState({ root: resolvedRoot });
    if (state?.goal?.status !== "active" || !isGoalOwnedBySession(state, payload?.session_id)) {
      return { status: 0, message: "", hookOutput: {} };
    }
    // Remind once per goal, task, and session; repeating it after every edit only grows the cached prefix.
    const reminderKey = {
      goalId: state.goal.id,
      taskId: state.tasks.find((task) => task.status === "active")?.id ?? null,
      sessionId: payload?.session_id ?? null,
    };
    const previousReminder = await readHookGuard(resolvedRoot, "reminder");
    if (previousReminder?.goalId === reminderKey.goalId
      && previousReminder?.taskId === reminderKey.taskId
      && previousReminder?.sessionId === reminderKey.sessionId) {
      return { status: 0, message: "", hookOutput: {} };
    }
    await writeHookGuard(resolvedRoot, "reminder", reminderKey);
    const message = ko
      ? "Pota 점검: 외부 상태 변경에는 dry-run/check 증거 기록이 필요합니다. 활성 목표가 있다면 현재 task에 성공 증거를 기록하세요."
      : "Pota check: external-state changes need dry-run/check evidence. When a goal is active, record successful evidence for its current task.";
    return {
      status: 0,
      message,
      hookOutput: {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: message,
        },
      },
    };
  }

  if (event === "stop" || event === "subagent-stop") {
    const { state } = await reconcileWorktreeState({ root: resolvedRoot });
    if (!isGoalOwnedBySession(state, payload?.session_id)) return { status: 0, message: "", hookOutput: {} };
    const gate = evaluateStop(state, {
      subagent: event === "subagent-stop",
      agentId: payload?.agent_id,
    });
    const progressed = gate.block ? await recordStopProgress(resolvedRoot, state, event, payload) : false;
    const hookOutput = stopHookOutput(gate, payload, { progressed });
    return {
      status: 0,
      message: gate.block ? continuationReason(gate.reason, payload, { progressed }) : stopAllowedMessage({ ko, state, event }),
      hookOutput,
    };
  }

  return {
    status: 0,
    message: ko ? "Pota: 지원하지 않는 상태 이벤트를 건너뛰었습니다." : "Pota: skipped an unsupported state event.",
  };
}

async function promptContextResult(event, { ko, resolvedRoot, payload }) {
  const reconciled = await reconcileWorktreeState({ root: resolvedRoot });
  const state = reconciled.state;
  const recoverable = recoverableGoalStatuses.has(state?.goal?.status);
  const index = await readHookIndex(resolvedRoot, event, recoverable);
  if (recoverable && !isGoalOwnedBySession(state, payload?.session_id)) {
    return foreignSessionContextResult({ ko, event, sessionId: payload?.session_id, root: resolvedRoot, index });
  }
  const context = contextResult({ ko, state, event, index });
  // SessionStart (also after compaction) carries a literal CLI prefix so agents do not rebuild or store it in a
  // shell variable, which does not survive between tool calls.
  const result = event === "session-start" ? appendContext(context, cliPrefixLine()) : context;
  if (!reconciled.removed) return result;
  const notice = ko
    ? "Pota worktree 점검: 현재 worktree에 속하지 않는 stale Pota 상태를 제거했습니다."
    : "Pota worktree check: removed stale Pota state that did not belong to this worktree.";
  return prependContext(result, notice);
}

async function recordStopProgress(root, state, event, payload) {
  const scope = event === "subagent-stop" ? `subagent:${payload?.agent_id ?? ""}` : "turn";
  // Parallel workers share this guard: keep one entry per scope, and measure a worker's progress by its own task
  // so sibling writes (which bump the goal revision) do not look like progress.
  const assigned = event === "subagent-stop"
    ? state.tasks.find((task) => task.status === "active" && task.assignedAgentId === payload?.agent_id)
    : null;
  const marker = assigned ? `${assigned.id}:${assigned.status}:${assigned.updatedAt}` : state.revision;
  const previous = await readStopGuard(root);
  const scopes = previous?.goalId === state.goal.id && previous?.scopes && typeof previous.scopes === "object" ? previous.scopes : {};
  const progressed = scopes[scope] !== marker;
  if (progressed) {
    const entries = Object.entries({ ...scopes, [scope]: marker }).slice(-16);
    await writeStopGuard(root, { goalId: state.goal.id, scopes: Object.fromEntries(entries) });
  }
  return progressed;
}

// SessionStart lists repository notes (and the plan index while idle); an idle prompt only counts notes. Prompts during
// an active, paused, blocked, or foreign goal read nothing, since their capsule has no budget left.
async function readHookIndex(root, event, recoverable) {
  if (event === "session-start") return hookIndexSnapshot({ root, memory: "list", plans: !recoverable });
  if (!recoverable) return hookIndexSnapshot({ root, memory: "count", plans: false });
  return null;
}

// Only the CLI path: goal commands resolve the repository root themselves, and a second absolute path would let
// long install or checkout paths push the SessionStart capsule past its budget. An installed copy names the canonical
// runtime from its locator, since an upgrade can remove a host cache copy (Codex) while the session still runs.
function cliPrefixLine() {
  const cli = installedCanonicalCli() ?? fileURLToPath(new URL("./pota.mjs", import.meta.url));
  return `Pota CLI: node ${JSON.stringify(cli)} goal <command>`;
}

function installedCanonicalCli() {
  try {
    const locator = JSON.parse(readFileSync(new URL("../.pota-runtime.json", import.meta.url), "utf8"));
    return locator?.plugin === "pota" && typeof locator.entrypoints?.cli === "string" ? locator.entrypoints.cli : null;
  } catch {
    return null;
  }
}

function appendContext(result, line) {
  const specific = result.hookOutput?.hookSpecificOutput;
  return {
    ...result,
    message: `${result.message}\n${line}`,
    hookOutput: specific
      ? { ...result.hookOutput, hookSpecificOutput: { ...specific, additionalContext: `${specific.additionalContext}\n${line}` } }
      : result.hookOutput,
  };
}

// The auto-upgrade step runs after the capsule is built and every error in it is swallowed, so it never changes the
// capsule, the exit code, or the "could not read goal state" failure. A notice goes last (after the CLI line), keeping
// the kernel-first prefix, and is mirrored in systemMessage for the user.
function withUpdateNotice(result, ko, { env = process.env, now = new Date(), spawn, pluginRoot = resolvePluginRoot(import.meta.url) } = {}) {
  let line = null;
  try {
    const notice = sessionStartUpdate({ env, now, spawn, pluginRoot });
    line = notice ? updateNoticeLine({ ko, notice }) : null;
  } catch {
    line = null;
  }
  if (!line) return result;
  const appended = appendContext(result, line);
  return { ...appended, hookOutput: { ...appended.hookOutput, systemMessage: line } };
}

function hookFailureResult(event, error) {
  const detail = String(error?.message ?? error).split("\n")[0].slice(0, 300);
  const message = `Pota ${event} hook could not read goal state: ${detail}. Run pota goal status to inspect it; do not treat an active goal as finished.`;
  return { status: 0, message, hookOutput: { systemMessage: message } };
}

function resolveRoot(root, payload) {
  return resolveRepoRoot({
    explicitRoot: root ?? null,
    hookCwd: payload?.cwd ?? null,
  });
}

async function readHookInput() {
  if (process.stdin.isTTY) return undefined;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (input.trim().length === 0) return undefined;
  try {
    const value = JSON.parse(input);
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

function isHookEvent(event) {
  return ["session-start", "user-prompt-submit", "post-tool-use", "stop", "subagent-stop"].includes(event);
}

function localeValue() {
  return [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]
    .find((value) => typeof value === "string" && value.length > 0) ?? Intl.DateTimeFormat().resolvedOptions().locale;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}
