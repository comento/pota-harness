#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveModelCeiling } from "./pota-model-ceiling.mjs";
import { potaHome, resolveRepoRoot } from "./pota-paths.mjs";
import { assertNoSymlinkComponents, safeMkdir, safeWriteFile } from "./pota-safe-fs.mjs";
import { runStateResult } from "./pota-state.mjs";

export const SESSION_SCHEMA_VERSION = 1;
export const PENDING_MAX = 8;
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const WORKSPACE_REGISTRY_SCHEMA_VERSION = 1;
export const WORKSPACE_MAX_ENTRIES = 16;
export const WORKSPACE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DAG_MCP_SERVER_STATE_SCHEMA_VERSION = 1;
export const DAG_MCP_REFRESH_THROTTLE_MS = 30_000;
export const DAG_MCP_REFRESH_TIMEOUT_MS = 1_500;
export const DAG_MCP_SERVER_NAME = "pota_pota-dag";
const WORKSPACE_REGISTRY_MAX_BYTES = 64 * 1024;
const DAG_MCP_SERVER_STATE_MAX_BYTES = 64 * 1024;
const WORKSPACE_DEDUPE_MS = 30_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
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
    if (event === "session-start" || (event === "pre-invocation" && input.invocationNum === 0)) {
      await recordActiveWorkspace({ workspacePath: payload.cwd, conversationId: input.conversationId, env, now }).catch(() => {});
      await ensureAntigravityDagMcp({ env, now }).catch(() => {});
    }
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

// Antigravity 세션 파일 수 검사와 분리하기 위해 hosts/antigravity/ 바깥 경로에 보관한다.
export function workspaceRegistryPath(env = process.env) {
  return join(potaHome(env), "hosts", "antigravity-dag", "workspaces.json");
}

export async function readWorkspaceRegistry({ env = process.env, now = new Date() } = {}) {
  const empty = { schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION, workspaces: [] };
  try {
    const home = potaHome(env);
    const path = workspaceRegistryPath(env);
    await assertNoSymlinkComponents(home, path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > WORKSPACE_REGISTRY_MAX_BYTES) return empty;
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== WORKSPACE_REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.workspaces)) {
      return empty;
    }
    const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
    const candidates = [];
    for (const entry of parsed.workspaces) {
      if (!isRecord(entry)) continue;
      if (typeof entry.root !== "string" || entry.root.length === 0 || !isAbsolute(entry.root) || entry.root.includes("\0")) continue;
      if (entry.conversationId !== undefined && entry.conversationId !== null && typeof entry.conversationId !== "string") continue;
      if (typeof entry.lastSeenAt !== "string") continue;
      const seenMs = Date.parse(entry.lastSeenAt);
      if (!Number.isFinite(seenMs)) continue;
      if (Number.isFinite(nowMs) && nowMs - seenMs > WORKSPACE_MAX_AGE_MS) continue;
      candidates.push({
        root: entry.root,
        conversationId: typeof entry.conversationId === "string" && entry.conversationId.length > 0 ? entry.conversationId : null,
        lastSeenAt: entry.lastSeenAt,
        seenMs,
      });
    }
    candidates.sort((left, right) => right.seenMs - left.seenMs);
    const seenRoots = new Set();
    const workspaces = [];
    for (const item of candidates) {
      if (seenRoots.has(item.root)) continue;
      seenRoots.add(item.root);
      workspaces.push({
        root: item.root,
        conversationId: item.conversationId,
        lastSeenAt: item.lastSeenAt,
      });
      if (workspaces.length >= WORKSPACE_MAX_ENTRIES) break;
    }
    return { schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION, workspaces };
  } catch {
    return empty;
  }
}

export async function recordActiveWorkspace({ workspacePath, conversationId = null, env = process.env, now = new Date() } = {}) {
  if (typeof workspacePath !== "string" || workspacePath.trim().length === 0 || workspacePath.includes("\0")) {
    return { recorded: false, reason: "invalid-path" };
  }
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) return { recorded: false, reason: "invalid-time" };

  const resolvedRoot = resolveRepoRoot({ hookCwd: workspacePath });
  const rootStat = await lstat(resolvedRoot).catch(() => null);
  if (!rootStat?.isDirectory()) return { recorded: false, reason: "not-a-directory" };

  const normConversationId = typeof conversationId === "string" && conversationId.length > 0 ? conversationId : null;
  const current = await readWorkspaceRegistry({ env, now: nowDate });
  const head = current.workspaces[0];
  if (head && head.root === resolvedRoot && head.conversationId === normConversationId) {
    const ageMs = nowMs - Date.parse(head.lastSeenAt);
    if (ageMs >= 0 && ageMs < WORKSPACE_DEDUPE_MS) {
      return { recorded: false, reason: "throttled", root: resolvedRoot };
    }
  }

  const home = potaHome(env);
  const path = workspaceRegistryPath(env);
  const nextEntry = {
    root: resolvedRoot,
    conversationId: normConversationId,
    lastSeenAt: nowDate.toISOString(),
  };
  const workspaces = [
    nextEntry,
    ...current.workspaces.filter((entry) => entry.root !== resolvedRoot),
  ].slice(0, WORKSPACE_MAX_ENTRIES);
  const nextPayload = { schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION, workspaces };

  await writeDagJsonFile(home, path, nextPayload, "Workspace registry path");
  return { recorded: true, root: resolvedRoot, path };
}

export function dagMcpServerStatePath(env = process.env) {
  return join(potaHome(env), "hosts", "antigravity-dag", "server.json");
}

export async function readDagMcpServerState({ env = process.env } = {}) {
  const empty = {
    schemaVersion: DAG_MCP_SERVER_STATE_SCHEMA_VERSION,
    pid: null,
    startedAt: null,
    lastRefreshAt: null,
  };
  try {
    const home = potaHome(env);
    const path = dagMcpServerStatePath(env);
    await assertNoSymlinkComponents(home, path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > DAG_MCP_SERVER_STATE_MAX_BYTES) return empty;
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== DAG_MCP_SERVER_STATE_SCHEMA_VERSION) {
      return empty;
    }
    return {
      schemaVersion: DAG_MCP_SERVER_STATE_SCHEMA_VERSION,
      pid: Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : null,
      startedAt: typeof parsed.startedAt === "string" && Number.isFinite(Date.parse(parsed.startedAt)) ? parsed.startedAt : null,
      lastRefreshAt: typeof parsed.lastRefreshAt === "string" && Number.isFinite(Date.parse(parsed.lastRefreshAt)) ? parsed.lastRefreshAt : null,
    };
  } catch {
    return empty;
  }
}

export async function recordDagMcpServerPid({ pid = process.pid, env = process.env, now = new Date() } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return { recorded: false, reason: "invalid-pid" };
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(nowDate.getTime())) return { recorded: false, reason: "invalid-time" };

  const current = await readDagMcpServerState({ env });
  const path = dagMcpServerStatePath(env);
  await writeDagJsonFile(
    potaHome(env),
    path,
    {
      schemaVersion: DAG_MCP_SERVER_STATE_SCHEMA_VERSION,
      pid,
      startedAt: nowDate.toISOString(),
      lastRefreshAt: current.lastRefreshAt,
    },
    "DAG MCP server state path",
  );
  return { recorded: true, pid, path };
}

export async function clearDagMcpServerPid({ pid = process.pid, env = process.env } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return { cleared: false, reason: "invalid-pid" };
  const current = await readDagMcpServerState({ env });
  if (current.pid !== pid) {
    return { cleared: false, reason: current.pid === null ? "not-owned" : "pid-mismatch" };
  }
  const path = dagMcpServerStatePath(env);
  await writeDagJsonFile(
    potaHome(env),
    path,
    {
      schemaVersion: DAG_MCP_SERVER_STATE_SCHEMA_VERSION,
      pid: null,
      startedAt: current.startedAt,
      lastRefreshAt: current.lastRefreshAt,
    },
    "DAG MCP server state path",
  );
  return { cleared: true, pid, path };
}

// Antigravity의 pota_pota-dag MCP 서버 생존 여부를 확인하고, 죽었을 때만 loopback RefreshMcpServers로 복구한다.
export async function ensureAntigravityDagMcp({
  env = process.env,
  now = new Date(),
  force = false,
  fetchImpl = globalThis.fetch,
  isPidAlive = defaultIsPidAlive,
  timeoutMs = DAG_MCP_REFRESH_TIMEOUT_MS,
} = {}) {
  try {
    if (typeof env?.POTA_ANTIGRAVITY_DAG_REFRESH === "string" && /^(0|false|off|no)$/i.test(env.POTA_ANTIGRAVITY_DAG_REFRESH.trim())) {
      return { status: "skipped", reason: "disabled" };
    }
    const token = typeof env?.ANTIGRAVITY_CSRF_TOKEN === "string" ? env.ANTIGRAVITY_CSRF_TOKEN.trim() : "";
    if (!token) {
      return { status: "skipped", reason: "no-csrf-token" };
    }

    const state = await readDagMcpServerState({ env });
    if (Number.isInteger(state.pid) && state.pid > 0) {
      let alive = false;
      try {
        alive = Boolean(isPidAlive(state.pid));
      } catch {
        alive = false;
      }
      if (alive) return { status: "alive", pid: state.pid };
    }

    const nowDate = now instanceof Date ? now : new Date(now);
    const nowMs = nowDate.getTime();
    if (!Number.isFinite(nowMs)) return { status: "failed", reason: "invalid-time" };
    if (!force && state.lastRefreshAt) {
      const lastMs = Date.parse(state.lastRefreshAt);
      if (Number.isFinite(lastMs)) {
        const ageMs = nowMs - lastMs;
        if (ageMs >= 0 && ageMs < DAG_MCP_REFRESH_THROTTLE_MS) {
          return { status: "throttled" };
        }
      }
    }

    const rawAddr = typeof env?.ANTIGRAVITY_LS_ADDRESS === "string" && env.ANTIGRAVITY_LS_ADDRESS.trim().length > 0
      ? env.ANTIGRAVITY_LS_ADDRESS.trim()
      : "localhost:5387";
    const url = parseLoopbackAddress(rawAddr);
    if (!url) {
      return { status: "skipped", reason: "non-loopback-address" };
    }

    await writeDagJsonFile(
      potaHome(env),
      dagMcpServerStatePath(env),
      {
        schemaVersion: DAG_MCP_SERVER_STATE_SCHEMA_VERSION,
        pid: null,
        startedAt: state.startedAt,
        lastRefreshAt: nowDate.toISOString(),
      },
      "DAG MCP server state path",
    ).catch(() => {});

    if (typeof fetchImpl !== "function") {
      return { status: "failed", reason: "no-fetch" };
    }

    const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DAG_MCP_REFRESH_TIMEOUT_MS;
    const response = await fetchImpl(
      `${url.origin}/exa.language_server_pb.LanguageServerService/RefreshMcpServers`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-codeium-csrf-token": token,
        },
        body: JSON.stringify({ serverName: DAG_MCP_SERVER_NAME }),
        signal: AbortSignal.timeout(effectiveTimeoutMs),
      },
    );
    return response?.ok
      ? { status: "refreshed" }
      : { status: "failed", statusCode: response?.status ?? null };
  } catch {
    return { status: "failed", reason: "request-error" };
  }
}

async function writeDagJsonFile(home, path, payload, label) {
  const directory = dirname(path);
  await ensureDirectory(home, directory);
  await assertNoSymlinkComponents(home, path);
  const existing = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing && !existing.isFile()) {
    throw new Error(`${label} is not a regular file: ${path}`);
  }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await safeWriteFile(home, temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function defaultIsPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function parseLoopbackAddress(addr) {
  if (typeof addr !== "string" || addr.length === 0 || addr.endsWith(":")) return null;
  if (/[\s/?#@\\]|[\x00-\x1f\x7f]|^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(addr)) return null;
  let url;
  try {
    url = new URL(`http://${addr}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.port !== "") {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  }
  return url;
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
