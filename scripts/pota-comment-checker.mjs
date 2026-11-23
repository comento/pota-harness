#!/usr/bin/env node
import { spawn as spawnProcess, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLifecycleLock } from "./pota-lifecycle-lock.mjs";
import { potaHome, resolvePluginRoot } from "./pota-paths.mjs";
import { readJsonFile, writeJsonAtomic } from "./pota-safe-fs.mjs";

// comment-checker (github.com/code-yeongyu/go-claude-code-comment-checker, MIT) flags needless comments in code an
// edit tool just wrote. Pota pins one release and its SHA256 values instead of an npm dependency: a SessionStart (or a
// PostToolUse that finds no binary) of a host hook starts a detached `fetch` from this plugin copy, and later edits are
// checked.
// The binary reads a Claude Code PostToolUse payload on stdin and exits 0 (clean) or 2 (findings on stderr).
export const COMMENT_CHECKER_VERSION = "0.8.2";
const RELEASE_BASE_URL = `https://github.com/code-yeongyu/go-claude-code-comment-checker/releases/download/v${COMMENT_CHECKER_VERSION}`;
const RELEASE_ASSETS = Object.freeze({
  "darwin-x64": { name: "comment-checker_v0.8.2_darwin_amd64.tar.gz", sha256: "b3a32a90be5cd2712caffb045b89fbc09d65c264297b607957f83302f1c7c1f5" },
  "darwin-arm64": { name: "comment-checker_v0.8.2_darwin_arm64.tar.gz", sha256: "57e0eea96b74a02bd6ed40f7078fda71c8807419ed039d33bc6a4b6db8d4d13c" },
  "linux-x64": { name: "comment-checker_v0.8.2_linux_amd64.tar.gz", sha256: "62493f1561de3d53e0bb447b16166c8d88be6f86ae6ef5c5fc0016ed2435b8f6" },
  "linux-arm64": { name: "comment-checker_v0.8.2_linux_arm64.tar.gz", sha256: "022d4092794034303d021cd33f1b42a8c57d04c963ba66065ff3f844bfedd8e8" },
  "win32-x64": { name: "comment-checker_v0.8.2_windows_amd64.zip", sha256: "26ac648ceb8bfbc6f9039fd59fc8bf1671939a223fbaf1aac646e98f80cb9d20" },
});
const STATE_SCHEMA_VERSION = 1;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
// A fetch is bounded by the download timeout plus extraction; an older lock is abandoned.
const LOCK_MAX_AGE_MS = 10 * 60 * 1000;
const LOCK_BUSY = "Timed out waiting for Pota lifecycle lock";
// The PostToolUse hook has 10 seconds; the goal reminder and process start-up need the rest.
const CHECK_BUDGET_MS = 7_000;
const MAX_REASON_CHARS = 4_000;
const BACKOFF_BASE_MS = 60 * 60 * 1000;
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
const OFF_VALUES = new Set(["0", "false", "off", "no"]);
const EDIT_TOOLS = new Set(["write", "edit", "multiedit", "multi_edit", "apply_patch"]);

if (isCliEntry()) {
  const command = process.argv[2];
  if (command === "fetch") {
    const result = await fetchCommentChecker();
    console.log(JSON.stringify(result));
    if (result.status === "failed") process.exitCode = 1;
  } else {
    console.error("Usage: pota-comment-checker.mjs fetch");
    process.exitCode = 2;
  }
}

export function commentCheckerPaths(env = process.env, platform = process.platform) {
  const root = join(potaHome(env), "tools", "comment-checker");
  const directory = join(root, `v${COMMENT_CHECKER_VERSION}`);
  return {
    root,
    directory,
    binary: join(directory, binaryName(platform)),
    state: join(root, "state.json"),
    lock: join(root, "fetch.lock"),
  };
}

export function releaseAsset(platform = process.platform, arch = process.arch) {
  const asset = RELEASE_ASSETS[`${platform}-${arch}`];
  return asset ? { ...asset, url: `${RELEASE_BASE_URL}/${asset.name}`, zip: asset.name.endsWith(".zip") } : null;
}

// On by default. POTA_COMMENT_CHECKER=0|false|off|no or config.json `commentChecker: false` turns both the check and
// the download off. An unreadable config.json keeps it on: the check only reads the edited text.
export function commentCheckerEnabled(env = process.env) {
  const raw = env.POTA_COMMENT_CHECKER;
  if (typeof raw === "string" && OFF_VALUES.has(raw.trim().toLowerCase())) return false;
  const config = readJsonFile(join(potaHome(env), "config.json"));
  return !(config.status === "ok" && config.value?.commentChecker === false);
}

export function binaryReady(paths) {
  try { return lstatSync(paths.binary).isFile(); } catch { return false; }
}

// PostToolUse: returns `{ reason }` when the checker reported findings, otherwise null. A missing binary starts the
// detached download (only when the hook entry point passed `autoFetch`) and lets this edit pass; checker errors and
// timeouts also pass.
export async function checkPostToolUse(payload, {
  env = process.env, spawn = spawnProcess, pluginRoot = resolvePluginRoot(import.meta.url), now = new Date(),
  platform = process.platform, arch = process.arch, budgetMs = CHECK_BUDGET_MS, autoFetch = false,
} = {}) {
  if (!commentCheckerEnabled(env)) return null;
  const requests = extractCheckRequests(payload);
  if (requests.length === 0 || !releaseAsset(platform, arch)) return null;
  const paths = commentCheckerPaths(env, platform);
  if (!binaryReady(paths)) {
    startFetchWhenNeeded({ env, spawn, pluginRoot, now, platform, arch, autoFetch });
    return null;
  }
  const deadline = Date.now() + budgetMs;
  const findings = [];
  for (const request of requests) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const result = await runChecker(paths.binary, {
      session_id: String(payload?.session_id ?? ""),
      tool_name: request.toolName,
      transcript_path: typeof payload?.transcript_path === "string" ? payload.transcript_path : "",
      cwd: typeof payload?.cwd === "string" ? payload.cwd : process.cwd(),
      hook_event_name: "PostToolUse",
      tool_input: request.toolInput,
    }, { timeoutMs: remaining, spawn });
    if (result.status === "comments" && result.message) findings.push(`comment-checker found issues in ${request.filePath}:\n${result.message}`);
  }
  if (findings.length === 0) return null;
  const reason = findings.join("\n\n");
  return { reason: reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS - 40).trimEnd()}\n[comment-checker output truncated]` : reason };
}

// Maps Claude Code (Write, Edit, MultiEdit) and Codex (write, edit, multi_edit, multiedit, apply_patch) payloads to the
// checker's Claude Code tool inputs. Failed tool calls and deletions yield nothing.
export function extractCheckRequests(payload) {
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  const lower = toolName.toLowerCase();
  const input = isRecord(payload?.tool_input) ? payload.tool_input : null;
  if (!EDIT_TOOLS.has(lower) || !input || failedResponse(payload?.tool_response)) return [];
  const cwd = typeof payload?.cwd === "string" ? payload.cwd : process.cwd();
  const absolute = (path) => (isAbsolute(path) ? path : resolve(cwd, path));
  if (lower === "apply_patch") {
    const patch = firstString(input, ["command", "input", "patch"]);
    if (patch === undefined) return [];
    return parseApplyPatch(patch).map((edit) => {
      const filePath = absolute(edit.filePath);
      return edit.before.length === 0
        ? { toolName: "Write", filePath, toolInput: { file_path: filePath, content: edit.after } }
        : { toolName: "Edit", filePath, toolInput: { file_path: filePath, old_string: edit.before, new_string: edit.after } };
    });
  }
  const path = firstString(input, ["file_path", "filePath", "path"]);
  if (!path) return [];
  const filePath = absolute(path);
  if (lower === "write") {
    const content = firstString(input, ["content"]);
    return content === undefined ? [] : [{ toolName: "Write", filePath, toolInput: { file_path: filePath, content } }];
  }
  if (lower === "edit") {
    const oldString = firstString(input, ["old_string", "oldString"]);
    const newString = firstString(input, ["new_string", "newString"]);
    if (oldString === undefined || newString === undefined) return [];
    return [{ toolName: "Edit", filePath, toolInput: { file_path: filePath, old_string: oldString, new_string: newString } }];
  }
  const edits = (Array.isArray(input.edits) ? input.edits : []).flatMap((edit) => {
    if (!isRecord(edit)) return [];
    const oldString = firstString(edit, ["old_string", "oldString"]);
    const newString = firstString(edit, ["new_string", "newString"]);
    return oldString === undefined || newString === undefined ? [] : [{ old_string: oldString, new_string: newString }];
  });
  return edits.length === 0 ? [] : [{ toolName: "MultiEdit", filePath, toolInput: { file_path: filePath, edits } }];
}

// The apply_patch envelope: `*** Add File:` (+ lines), `*** Update File:` with optional `*** Move to:` and hunks of
// context (space), removed (-), and added (+) lines, and `*** Delete File:`, which cannot add a comment.
export function parseApplyPatch(patch) {
  const edits = [];
  let current = null;
  const flush = () => {
    if (current && current.operation !== "delete") {
      const after = current.newLines.join("\n");
      if (after.length > 0) {
        edits.push({
          filePath: current.movePath ?? current.filePath,
          before: current.operation === "add" ? "" : current.oldLines.join("\n"),
          after,
        });
      }
    }
    current = null;
  };
  const headers = [["*** Add File: ", "add"], ["*** Update File: ", "update"], ["*** Delete File: ", "delete"]];
  for (const line of patch.split(/\r?\n/)) {
    const header = headers.find(([prefix]) => line.startsWith(prefix));
    if (header) {
      flush();
      current = { operation: header[1], filePath: line.slice(header[0].length).trim(), movePath: null, oldLines: [], newLines: [] };
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      if (current?.operation === "update") current.movePath = line.slice("*** Move to: ".length).trim();
      continue;
    }
    if (!current || line.startsWith("***") || line.startsWith("@@")) continue;
    if (current.operation === "add") {
      if (line.startsWith("+")) current.newLines.push(line.slice(1));
    } else if (current.operation === "update") {
      if (line.startsWith("+")) current.newLines.push(line.slice(1));
      else if (line.startsWith("-")) current.oldLines.push(line.slice(1));
      else if (line.startsWith(" ")) {
        current.oldLines.push(line.slice(1));
        current.newLines.push(line.slice(1));
      }
    }
  }
  flush();
  return edits;
}

// Exit 0 is clean and 2 carries findings on stderr; anything else (a crash, a spawn error, a timeout) is an error that
// the hook ignores so a broken checker never blocks an edit.
export function runChecker(binary, hookInput, { timeoutMs = CHECK_BUDGET_MS, spawn = spawnProcess } = {}) {
  return new Promise((resolveResult) => {
    let settled = false;
    let stderr = "";
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    const timer = setTimeout(() => {
      try { child?.kill("SIGKILL"); } catch { /* already gone */ }
      // A grandchild that keeps stderr open would otherwise hold the hook process past its own timeout.
      child?.stderr?.destroy();
      child?.stdin?.destroy();
      finish({ status: "error", message: "timeout" });
    }, timeoutMs);
    try {
      child = spawn(binary, ["check"], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    } catch (error) {
      finish({ status: "error", message: String(error?.message ?? error) });
      return;
    }
    child.on("error", (error) => finish({ status: "error", message: String(error?.message ?? error) }));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) finish({ status: "pass", message: "" });
      else if (code === 2) finish({ status: "comments", message: stderr.replace(/\r\n?/g, "\n").trim() });
      else finish({ status: "error", message: stderr.trim().slice(0, 500) });
    });
    // A checker that exits without reading stdin must not crash the hook with EPIPE.
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify(hookInput));
  });
}

// Starts the detached download from this plugin copy only when the hook entry point passed `autoFetch` (the library
// default never downloads, so in-process callers and tests stay off the network), the checker is enabled, the platform
// has a pinned asset, the binary is missing, no backoff is pending, and no live fetch holds the lock. Never throws.
export function startFetchWhenNeeded({
  env = process.env, spawn = spawnProcess, pluginRoot = resolvePluginRoot(import.meta.url), now = new Date(),
  platform = process.platform, arch = process.arch, autoFetch = false,
} = {}) {
  try {
    if (autoFetch !== true) return false;
    if (!commentCheckerEnabled(env) || !releaseAsset(platform, arch)) return false;
    const paths = commentCheckerPaths(env, platform);
    if (binaryReady(paths)) return false;
    const next = Date.parse(readState(paths)?.nextAttemptAt ?? "");
    if (Number.isFinite(next) && now.getTime() < next) return false;
    if (lockHolder(paths) !== null) return false;
    // stdio "ignore" keeps the hook's stdout closed so the host does not wait for the download.
    const child = spawn(process.execPath, [join(pluginRoot, "scripts", "pota-comment-checker.mjs"), "fetch"], {
      cwd: potaHome(env), env, detached: true, stdio: "ignore", windowsHide: true,
    });
    child?.on?.("error", () => {});
    child?.unref?.();
    return true;
  } catch {
    return false;
  }
}

// Downloads the pinned asset, verifies its SHA256, extracts it with the OS tar (which also reads zip on Windows), and
// moves the binary into place with one rename. A held fetch.lock means another fetch is working: exit without waiting
// (a dead process's lock is reclaimed by the lifecycle lock rules). Any failure records a backoff (1 hour, doubling, at
// most 24 hours), so a broken setup does not start a download after every edit.
export async function fetchCommentChecker({
  env = process.env, now = new Date(), fetchImpl = globalThis.fetch, platform = process.platform, arch = process.arch,
  asset = releaseAsset(platform, arch), tar = systemTar(platform, env),
} = {}) {
  if (!commentCheckerEnabled(env)) return { status: "disabled" };
  if (!asset) return { status: "unsupported", platform: `${platform}-${arch}` };
  const paths = commentCheckerPaths(env, platform);
  if (binaryReady(paths)) return { status: "present", binary: paths.binary };
  try {
    mkdirSync(paths.root, { recursive: true });
    removeAgedLock(paths);
    return await createLifecycleLock({ lifecycleLockPath: paths.lock })
      .withLifecycleLock(() => installLocked({ paths, asset, fetchImpl, tar, platform, now }), { timeoutMs: 1, retryMs: 1 });
  } catch (error) {
    if (String(error?.message).startsWith(LOCK_BUSY)) return { status: "locked" };
    return recordFailure(paths, now, error);
  }
}

async function installLocked({ paths, asset, fetchImpl, tar, platform, now }) {
  if (binaryReady(paths)) return { status: "present", binary: paths.binary };
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node.js");
  const archive = await download(fetchImpl, asset.url);
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== asset.sha256) throw new Error(`SHA256 mismatch for ${asset.name}: expected ${asset.sha256}, got ${digest}`);
  const stage = mkdtempSync(join(paths.root, ".stage-"));
  try {
    const archivePath = join(stage, asset.name);
    const extracted = join(stage, "extracted");
    const output = join(stage, "out");
    mkdirSync(extracted);
    mkdirSync(output);
    writeFileSync(archivePath, archive);
    const result = spawnSync(tar, [asset.zip ? "-xf" : "-xzf", archivePath, "-C", extracted], { encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`tar failed: ${String(result.error?.message ?? result.stderr ?? "").trim().slice(0, 200)}`);
    const name = binaryName(platform);
    if (!lstatSync(join(extracted, name), { throwIfNoEntry: false })?.isFile()) throw new Error(`${asset.name} has no regular file ${name}`);
    renameSync(join(extracted, name), join(output, name));
    chmodSync(join(output, name), 0o755);
    rmSync(paths.directory, { recursive: true, force: true });
    renameSync(output, paths.directory);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  writeJsonAtomic(paths.state, {
    schemaVersion: STATE_SCHEMA_VERSION, version: COMMENT_CHECKER_VERSION, installedAt: now.toISOString(),
    consecutiveFailures: 0, nextAttemptAt: null, lastError: null,
  });
  return { status: "installed", binary: paths.binary };
}

function recordFailure(paths, now, error) {
  const message = String(error?.message ?? error).split("\n")[0].slice(0, 300);
  try {
    const failures = (Number(readState(paths)?.consecutiveFailures) || 0) + 1;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
    writeJsonAtomic(paths.state, {
      schemaVersion: STATE_SCHEMA_VERSION, version: COMMENT_CHECKER_VERSION, installedAt: null,
      consecutiveFailures: failures, nextAttemptAt: new Date(now.getTime() + delay).toISOString(), lastError: message,
    });
  } catch { /* the result still reports the failure */ }
  return { status: "failed", error: message };
}

// Git Bash and MSYS put GNU tar first on PATH; it reads `C:` as a remote host and cannot read zip. The bsdtar that
// ships with Windows 10 and later reads both.
function systemTar(platform, env) {
  return platform === "win32" ? join(env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

function removeAgedLock(paths) {
  try {
    if (Date.now() - lstatSync(paths.lock).mtimeMs > LOCK_MAX_AGE_MS) rmSync(paths.lock, { force: true });
  } catch { /* no lock */ }
}

// One informational status line.
export function commentCheckerStatusLine(env = process.env, platform = process.platform, arch = process.arch) {
  if (!commentCheckerEnabled(env)) return "comment-checker: disabled";
  if (!releaseAsset(platform, arch)) return `comment-checker: unsupported platform ${platform}-${arch}`;
  const paths = commentCheckerPaths(env, platform);
  if (binaryReady(paths)) return `comment-checker: ready ${COMMENT_CHECKER_VERSION}`;
  const lastError = readState(paths)?.lastError;
  return lastError
    ? `comment-checker: not downloaded (last attempt failed: ${lastError})`
    : "comment-checker: not downloaded yet (fetched in the background at the next session start)";
}

async function download(fetchImpl, url) {
  const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response?.ok) throw new Error(`download failed: HTTP ${response?.status}`);
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) throw new Error(`download is larger than ${MAX_ARCHIVE_BYTES} bytes`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error(`download is larger than ${MAX_ARCHIVE_BYTES} bytes`);
  return buffer;
}

// Read-only view of fetch.lock for the hook: a live pid holds it unless the lock is older than any fetch can run (a pid
// reused after a reboot or kill -9 would otherwise stop downloads for good).
function lockHolder(paths) {
  let info;
  try { info = lstatSync(paths.lock); } catch { return null; }
  if (Date.now() - info.mtimeMs > LOCK_MAX_AGE_MS) return null;
  const read = readJsonFile(paths.lock);
  const pid = read.status === "ok" ? read.value?.pid : null;
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return error?.code === "EPERM" ? pid : null;
  }
}

function readState(paths) {
  const read = readJsonFile(paths.state);
  return read.status === "ok" && read.value?.schemaVersion === STATE_SCHEMA_VERSION ? read.value : null;
}

function failedResponse(response) {
  return isRecord(response) && (response.is_error === true || response.success === false);
}

function firstString(record, keys) {
  for (const key of keys) if (typeof record[key] === "string") return record[key];
  return undefined;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function binaryName(platform) {
  return platform === "win32" ? "comment-checker.exe" : "comment-checker";
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
