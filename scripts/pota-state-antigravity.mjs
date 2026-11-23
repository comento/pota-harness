#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveModelCeiling } from "./pota-model-ceiling.mjs";
import { potaHome } from "./pota-paths.mjs";
import { assertNoSymlinkComponents, safeMkdir, safeWriteFile } from "./pota-safe-fs.mjs";
import { runStateResult } from "./pota-state.mjs";

export const SESSION_SCHEMA_VERSION = 1;
export const PENDING_MAX = 8;
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_FILE_NAME = /^[0-9a-f]{16}\.json$/;
const ADAPTER_EVENTS = new Set(["session-start", "pre-invocation", "post-tool-use", "stop"]);

if (isCliEntry()) {
  let output = {};
  try {
    output = await runAntigravityHook(process.argv[2], await readStdin());
  } catch {
    output = {};
  }
  console.log(JSON.stringify(output ?? {}));
}

// Antigravity logs and ignores a non-zero exit, so every failure becomes an empty object instead.
export async function runAntigravityHook(event, input, { env = process.env, now = new Date(), run = runStateResult } = {}) {
  try {
    if (!ADAPTER_EVENTS.has(event) || !isRecord(input)) return {};
    const payload = statePayload(input);
    // Hooks run with the plugin folder as cwd, so without a workspace path there is no user repository to read.
    if (!payload.cwd) return {};
    const session = sessionStore(input.conversationId, { env, now });
    if (event === "session-start") {
      // The legacy-migration notice arrives in the result like any other SessionStart notice and is folded into the
      // injected text by contextText.
      const result = await run("session-start", {
        payload,
        host: "antigravity",
        migration: { env, now },
        commentChecker: { autoFetch: true },
        modelCeiling: resolveModelCeiling({ env, home: potaHome(env) }),
      });
      return injectStepsOutput(contextText(result));
    }
    if (event === "pre-invocation") return await preInvocation(input, payload, session, run, env);
    if (event === "post-tool-use") {
      const toolPayload = postToolUsePayload(payload, input.toolCall);
      if (!toolPayload) return {};
      const message = pendingMessage(await run("post-tool-use", { payload: toolPayload }));
      if (message) await session.update((record) => ({ ...record, pending: [...record.pending, message].slice(-PENDING_MAX) }));
      return {};
    }
    return await stop(input, payload, session, run);
  } catch {
    return {};
  }
}

async function preInvocation(input, payload, session, run, env) {
  let capsule = "";
  if (input.invocationNum === 0) {
    const options = payload.model !== undefined ? { payload, modelCeiling: resolveModelCeiling({ env, home: potaHome(env) }) } : { payload };
    capsule = contextText(await run("user-prompt-submit", options));
  }
  // A new turn is never the continuation of an earlier blocked Stop, even with the same prompt text.
  const newTurn = input.invocationNum === 0;
  const record = await session.read();
  if (record.pending.length > 0 || (newTurn && record.stopBlockedFor !== null)) {
    await session.update((current) => ({ ...current, pending: [], stopBlockedFor: newTurn ? null : current.stopBlockedFor }));
  }
  return injectStepsOutput(joinText(capsule, ...record.pending));
}

async function stop(input, payload, session, run) {
  if (input.terminationReason !== "model_stop") return {};
  const inputHash = sha256(typeof input.lastUserInput === "string" ? input.lastUserInput : "");
  const continuation = typeof input.continuation_active === "boolean" ? input.continuation_active : null;
  const recorded = (await session.read()).stopBlockedFor;
  const stopHookActive = continuation ?? (recorded === inputHash);
  const result = await run("stop", { payload: { ...payload, stop_hook_active: stopHookActive } });
  const output = stopOutput(result);
  if (output.decision === "continue") await session.update((record) => ({ ...record, stopBlockedFor: inputHash }));
  else if (recorded !== null) await session.update((record) => ({ ...record, stopBlockedFor: null }));
  return output;
}

export function statePayload(input) {
  const payload = {};
  if (typeof input?.conversationId === "string" && input.conversationId.length > 0) payload.session_id = input.conversationId;
  const cwd = Array.isArray(input?.workspacePaths) ? input.workspacePaths[0] : undefined;
  if (typeof cwd === "string" && cwd.length > 0) payload.cwd = cwd;
  if (typeof input?.modelName === "string" && input.modelName.length > 0) payload.model = input.modelName;
  if (typeof input?.transcriptPath === "string") payload.transcript_path = input.transcriptPath;
  if (typeof input?.lastUserInput === "string") payload.prompt = input.lastUserInput;
  return payload;
}

// Maps Antigravity's edit tools to the Claude Code tool shapes the comment checker and reminder already accept.
export function claudeToolCall(toolCall) {
  if (!isRecord(toolCall) || typeof toolCall.name !== "string") return null;
  const args = toolArgs(toolCall.args);
  if (!args || typeof args.TargetFile !== "string" || args.TargetFile.length === 0) return null;
  const file_path = args.TargetFile;
  if (toolCall.name === "write_to_file") {
    return { tool_name: "Write", tool_input: { file_path, content: stringValue(args.CodeContent) } };
  }
  if (toolCall.name === "replace_file_content") {
    return {
      tool_name: "Edit",
      tool_input: { file_path, old_string: stringValue(args.TargetContent), new_string: stringValue(args.ReplacementContent) },
    };
  }
  if (toolCall.name === "multi_replace_file_content") {
    const chunks = Array.isArray(args.ReplacementChunks) ? args.ReplacementChunks.filter(isRecord) : [];
    const edits = chunks.map((chunk) => ({ old_string: stringValue(chunk.TargetContent), new_string: stringValue(chunk.ReplacementContent) }));
    return { tool_name: "MultiEdit", tool_input: { file_path, edits } };
  }
  return null;
}

export function postToolUsePayload(payload, toolCall) {
  const converted = claudeToolCall(toolCall);
  return converted ? { ...payload, ...converted } : null;
}

// The capsule plus any user-facing systemMessage line it does not already contain; no separate user channel is confirmed.
export function contextText(result) {
  const output = result?.hookOutput;
  const context = stringValue(output?.hookSpecificOutput?.additionalContext);
  const notices = stringValue(output?.systemMessage).split("\n").filter((line) => line.length > 0 && !context.split("\n").includes(line));
  return joinText(context, ...notices);
}

export function pendingMessage(result) {
  const output = result?.hookOutput;
  return joinText(stringValue(output?.reason), stringValue(output?.hookSpecificOutput?.additionalContext));
}

export function injectStepsOutput(text) {
  return text ? { injectSteps: [{ systemMessage: { systemMessage: text } }] } : {};
}

export function stopOutput(result) {
  const output = result?.hookOutput;
  return output?.decision === "block" && typeof output.reason === "string"
    ? { decision: "continue", reason: output.reason }
    : {};
}

export function sessionFileName(conversationId) {
  return `${sha256(conversationId).slice(0, 16)}.json`;
}

export function sessionDirectory(env = process.env) {
  return join(potaHome(env), "hosts", "antigravity");
}

// Without a conversation id there is nothing to key on: reads are empty and writes are dropped.
function sessionStore(conversationId, { env, now }) {
  const valid = typeof conversationId === "string" && conversationId.length > 0;
  const home = potaHome(env);
  const directory = sessionDirectory(env);
  const path = valid ? join(directory, sessionFileName(conversationId)) : null;
  const read = async () => (path ? readSessionRecord(home, path) : emptyRecord());
  return {
    read,
    async update(change) {
      if (!path) return;
      const next = normalizeRecord(change(await read()));
      if (next.pending.length === 0 && next.stopBlockedFor === null) {
        await rm(path, { force: true });
        return;
      }
      await ensureDirectory(home, directory);
      const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await safeWriteFile(home, temporary, `${JSON.stringify(next)}\n`, "utf8");
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      await pruneSessionFiles(directory, path, now);
    },
  };
}

async function readSessionRecord(home, path) {
  try {
    await assertNoSymlinkComponents(home, path);
    if (!(await lstat(path)).isFile()) return emptyRecord();
    return normalizeRecord(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return emptyRecord();
  }
}

function normalizeRecord(value) {
  const pending = Array.isArray(value?.pending) ? value.pending.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
  const stopBlockedFor = typeof value?.stopBlockedFor === "string" ? value.stopBlockedFor : null;
  return { schemaVersion: SESSION_SCHEMA_VERSION, pending: pending.slice(-PENDING_MAX), stopBlockedFor };
}

function emptyRecord() {
  return { schemaVersion: SESSION_SCHEMA_VERSION, pending: [], stopBlockedFor: null };
}

async function pruneSessionFiles(directory, keepPath, now) {
  const names = await readdir(directory).catch(() => []);
  for (const name of names) {
    if (!SESSION_FILE_NAME.test(name)) continue;
    const path = join(directory, name);
    if (path === keepPath) continue;
    const stat = await lstat(path).catch(() => null);
    if (stat?.isFile() && now.getTime() - stat.mtimeMs > SESSION_MAX_AGE_MS) await rm(path, { force: true }).catch(() => {});
  }
}

async function ensureDirectory(home, directory) {
  let existingAncestor = home;
  while (true) {
    try {
      const stat = await lstat(existingAncestor);
      if (!stat.isDirectory()) throw new Error(`Pota home ancestor is not a directory: ${existingAncestor}`);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      existingAncestor = parent;
    }
  }
  await safeMkdir(existingAncestor, relative(existingAncestor, directory));
}

function toolArgs(args) {
  if (isRecord(args)) return args;
  if (typeof args !== "string") return null;
  try {
    const parsed = JSON.parse(args);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function joinText(...parts) {
  return parts.filter((part) => typeof part === "string" && part.length > 0).join("\n");
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readStdin() {
  if (process.stdin.isTTY) return undefined;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}
