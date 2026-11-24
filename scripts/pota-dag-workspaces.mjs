// Antigravity와 Codex MCP App이 공용으로 읽고 쓰는 최근 활성 워크스페이스 레지스트리 리프 모듈.
// 순환 의존을 막기 위해 경로·안전 파일 시스템 유틸리티만 참조한다.

import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { potaHome, resolveRepoRoot } from "./pota-paths.mjs";
import { assertNoSymlinkComponents, safeMkdir, safeWriteFile } from "./pota-safe-fs.mjs";

export const WORKSPACE_REGISTRY_SCHEMA_VERSION = 1;
export const WORKSPACE_MAX_ENTRIES = 16;
export const WORKSPACE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const WORKSPACE_REGISTRY_MAX_BYTES = 64 * 1024;
const WORKSPACE_DEDUPE_MS = 30_000;

// Antigravity 세션 파일 수 검사와 분리하기 위해 hosts/antigravity/ 바깥 경로에 보관한다.
export function workspaceRegistryPath(env = process.env) {
  return join(potaHome(env), "hosts", "antigravity-dag", "workspaces.json");
}

/**
 * 최근 활성 워크스페이스 레지스트리를 읽고 만료·중복·심볼릭 링크를 걸러 반환한다.
 * @param {{ env?: NodeJS.ProcessEnv, now?: Date | string | number }} [options]
 */
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

/**
 * 활성 워크스페이스 루트를 30초 스로틀·원자적 쓰기로 레지스트리에 기록한다.
 * @param {{ workspacePath?: string, conversationId?: string | null, env?: NodeJS.ProcessEnv, now?: Date | string | number }} [options]
 */
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

/**
 * 심볼릭 링크를 거부하면서 POTA_HOME 하위 JSON 파일을 원자적으로 기록한다.
 * @param {string} home
 * @param {string} path
 * @param {unknown} payload
 * @param {string} label
 */
export async function writeDagJsonFile(home, path, payload, label) {
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

/**
 * POTA_HOME의 실존 상위 디렉터리부터 심볼릭 링크 없이 대상 디렉터리를 생성한다.
 * @param {string} home
 * @param {string} directory
 */
export async function ensureDirectory(home, directory) {
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
