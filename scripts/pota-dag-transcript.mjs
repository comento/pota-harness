// Antigravity 트랜스크립트(transcript.jsonl)를 읽기 전용으로 조회해 실제 모델·effort·토큰 통계를 추출하는 리프 모듈.
// 상태 파일(state.json)을 변경하지 않으며, 비-Antigravity 호스트나 파일 부재 시 예외 없이 null을 반환한다.

import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { classifyModel } from "./pota-model-tier.mjs";
import { assertNoSymlinkComponents } from "./pota-safe-fs.mjs";

export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
export const MAX_CACHE_ENTRIES = 64;

const AGENT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL_EFFORT_PATTERN = /-(low|medium|high|xhigh)$/i;
const READ_OPEN_FLAGS = typeof constants.O_NOFOLLOW === "number"
  ? constants.O_RDONLY | constants.O_NOFOLLOW
  : "r";

const defaultTranscriptCache = new Map();

function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes("\0")) return null;
  return trimmed;
}

function pickNonNegativeInt(entry, keys) {
  for (const key of keys) {
    const value = entry[key];
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return 0;
}

function computeCacheHitRate(inputTokens, cacheReadTokens) {
  const denom = cacheReadTokens > inputTokens ? inputTokens + cacheReadTokens : inputTokens;
  return denom > 0 ? Math.round((cacheReadTokens / denom) * 1000) / 1000 : 0;
}

function cloneTranscriptResult(result) {
  return {
    resolvedModel: result.resolvedModel,
    resolvedEffort: result.resolvedEffort,
    resolvedTier: result.resolvedTier,
    turns: result.turns,
    tokens: { ...result.tokens },
    ...(result.updatedAt !== undefined ? { updatedAt: result.updatedAt } : {}),
  };
}

function readCachedTranscript(cache, key, mtimeMs, size, maxBytes) {
  if (!cache) return null;
  const entry = cache.get(key);
  if (!entry || entry.mtimeMs !== mtimeMs || entry.size !== size || entry.maxBytes !== maxBytes) {
    return null;
  }
  // 최근 조회 항목을 Map 끝(MRU)으로 이동한다.
  cache.delete(key);
  cache.set(key, entry);
  return cloneTranscriptResult(entry.value);
}

function writeCachedTranscript(cache, key, mtimeMs, size, maxBytes, value) {
  if (!cache) return;
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, {
    mtimeMs,
    size,
    maxBytes,
    value: cloneTranscriptResult(value),
  });
}

async function readBoundedTail(handle, size, maxBytes) {
  const offset = Math.max(0, size - maxBytes);
  const readLen = size - offset;
  if (readLen <= 0) return null;

  const buffer = Buffer.allocUnsafe(readLen);
  let totalRead = 0;
  while (totalRead < readLen) {
    const { bytesRead } = await handle.read(buffer, totalRead, readLen - totalRead, offset + totalRead);
    if (bytesRead === 0) break;
    totalRead += bytesRead;
  }
  if (totalRead <= 0) return null;

  return {
    text: buffer.toString("utf8", 0, totalRead),
    truncated: offset > 0,
  };
}

async function readTranscriptCandidate(realDir, candidate, cache, maxBytes) {
  try {
    await assertNoSymlinkComponents(realDir, candidate, { allowMissing: false });
  } catch (error) {
    if (error?.code === "POTA_SYMLINK") return { status: "symlink", value: null };
    return { status: "missing", value: null };
  }

  let handle = null;
  try {
    handle = await open(candidate, READ_OPEN_FLAGS);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) return { status: "missing", value: null };

    const cached = readCachedTranscript(cache, candidate, stat.mtimeMs, stat.size, maxBytes);
    if (cached) return { status: "ok", value: cached };

    const tail = await readBoundedTail(handle, stat.size, maxBytes);
    if (!tail) return { status: "missing", value: null };

    const parsed = parseTranscriptLines(tail.text, { truncated: tail.truncated });
    if (!parsed) return { status: "missing", value: null };

    const result = {
      ...parsed,
      updatedAt: stat.mtime.toISOString(),
    };
    writeCachedTranscript(cache, candidate, stat.mtimeMs, stat.size, maxBytes, result);
    return { status: "ok", value: cloneTranscriptResult(result) };
  } catch {
    return { status: "missing", value: null };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * 엄격한 소문자 UUID 형식의 에이전트 식별자인지 검사한다.
 * @param {unknown} agentId
 * @returns {boolean}
 */
export function isValidAgentUuid(agentId) {
  return typeof agentId === "string" && AGENT_UUID_PATTERN.test(agentId);
}

/**
 * 모델 식별자 접미사(`-low`, `-medium`, `-high`, `-xhigh`)에서 소문자 effort를 추출한다.
 * @param {unknown} model
 * @returns {string | null}
 */
export function deriveEffortFromModel(model) {
  if (typeof model !== "string") return null;
  const match = model.trim().match(MODEL_EFFORT_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Antigravity brain 루트 후보 디렉터리를 우선순위대로 중복 제거해 반환한다.
 * @param {{ brainDir?: string, env?: NodeJS.ProcessEnv, homeDir?: string }} [options]
 * @returns {string[]}
 */
export function resolveAntigravityBrainDirs(options = {}) {
  const { brainDir, env = process.env, homeDir } = options && typeof options === "object" ? options : {};
  const envObj = env && typeof env === "object" ? env : {};
  const effectiveHome = homeDir === undefined
    ? (nonEmptyString(envObj.HOME) ?? nonEmptyString(envObj.USERPROFILE) ?? homedir())
    : nonEmptyString(homeDir);

  const candidates = [];
  const explicitDir = nonEmptyString(brainDir);
  if (explicitDir) candidates.push(resolve(explicitDir));

  const envBrainDir = nonEmptyString(envObj.ANTIGRAVITY_BRAIN_DIR);
  if (envBrainDir) candidates.push(resolve(envBrainDir));

  const appDataDir = nonEmptyString(envObj.ANTIGRAVITY_APP_DATA_DIR);
  if (appDataDir) candidates.push(resolve(join(appDataDir, "brain")));

  const antigravityHome = nonEmptyString(envObj.ANTIGRAVITY_HOME);
  if (antigravityHome) candidates.push(resolve(join(antigravityHome, "brain")));

  if (effectiveHome) {
    candidates.push(resolve(join(effectiveHome, ".gemini", "antigravity", "brain")));
  }

  return [...new Set(candidates)];
}

/**
 * NDJSON 트랜스크립트 문자열에서 `PLANNER_RESPONSE` 턴의 모델·effort·티어·토큰을 집계한다.
 * 스트리밍 중인 마지막 불완전 JSON 줄과 `truncated` 선두 잘린 줄은 예외 없이 안전하게 건너뛴다.
 * @param {string} text
 * @param {{ truncated?: boolean }} [options]
 */
export function parseTranscriptLines(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) return null;
  const truncated = Boolean(options?.truncated);

  let content = text;
  if (truncated) {
    const firstNewline = content.indexOf("\n");
    if (firstNewline === -1) return null;
    content = content.slice(firstNewline + 1);
  }

  let resolvedModel = null;
  let turns = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (!entry || typeof entry !== "object" || entry.type !== "PLANNER_RESPONSE") continue;

    turns += 1;
    const model = nonEmptyString(entry.model);
    if (model) resolvedModel = model;

    inputTokens += pickNonNegativeInt(entry, ["input_tokens", "inputTokens"]);
    cacheReadTokens += pickNonNegativeInt(entry, ["cache_read_tokens", "cacheReadTokens"]);
    outputTokens += pickNonNegativeInt(entry, ["output_tokens", "outputTokens"]);
  }

  if (turns === 0) return null;

  const resolvedEffort = deriveEffortFromModel(resolvedModel);
  const resolvedTier = resolvedModel ? classifyModel(resolvedModel, "antigravity")?.tier ?? null : null;
  const cacheHitRate = computeCacheHitRate(inputTokens, cacheReadTokens);

  return {
    resolvedModel,
    resolvedEffort,
    resolvedTier,
    turns,
    tokens: {
      input: inputTokens,
      cacheRead: cacheReadTokens,
      output: outputTokens,
      cacheHitRate,
      truncated,
    },
  };
}

/**
 * 결정적 테스트 실행을 위해 트랜스크립트 LRU 캐시를 비운다.
 * @param {Map<string, unknown>} [cache]
 */
export function clearTranscriptCache(cache = defaultTranscriptCache) {
  if (cache instanceof Map) cache.clear();
}

/**
 * 에이전트 UUID에 대응하는 Antigravity `transcript.jsonl`을 안전하게 읽어 요약 결과를 반환한다.
 * UUID 불일치, 디렉터리·파일 부재, 심볼릭 링크 탐지, 손상 JSON 등 모든 실패에서 예외 없이 `null`을 반환한다.
 * @param {string} agentId
 * @param {{ brainDir?: string, env?: NodeJS.ProcessEnv, homeDir?: string, cache?: Map<string, unknown> | null, maxBytes?: number }} [options]
 */
export async function readAntigravityTranscript(agentId, options = {}) {
  if (!isValidAgentUuid(agentId)) return null;

  const opts = options && typeof options === "object" ? options : {};
  const activeCache = opts.cache instanceof Map
    ? opts.cache
    : opts.cache === undefined
      ? defaultTranscriptCache
      : null;
  const effectiveMaxBytes = Number.isSafeInteger(opts.maxBytes) && opts.maxBytes > 0
    ? opts.maxBytes
    : MAX_TRANSCRIPT_BYTES;

  const brainDirs = resolveAntigravityBrainDirs(opts);
  for (const dir of brainDirs) {
    const realDir = await realpath(dir).catch(() => null);
    if (!realDir) continue;

    const candidates = [
      join(realDir, agentId, ".system_generated", "logs", "transcript.jsonl"),
      join(realDir, agentId, "transcript.jsonl"),
    ];

    for (const candidate of candidates) {
      const outcome = await readTranscriptCandidate(realDir, candidate, activeCache, effectiveMaxBytes);
      if (outcome.status === "ok") return outcome.value;
      if (outcome.status === "symlink") break;
    }
  }

  return null;
}

/**
 * 태스크 목록을 변경하지 않고 `assignedAgentId`별 트랜스크립트 요약과 Goal 단위 토큰 롤업을 반환한다.
 * 동일한 `assignedAgentId`를 공유하는 태스크가 여럿 있어도 `agentStats` 집계는 에이전트당 1회만 합산한다.
 * @param {Array<{ id?: string, assignedAgentId?: string | null }>} tasks
 * @param {{ brainDir?: string, env?: NodeJS.ProcessEnv, homeDir?: string, cache?: Map<string, unknown> | null, maxBytes?: number }} [options]
 */
export async function enrichTasksWithTranscripts(tasks, options = {}) {
  const enrichedByTaskId = {};
  const agentStats = {
    enrichedAgents: 0,
    totalTurns: 0,
    totalInputTokens: 0,
    totalCacheReadTokens: 0,
    totalOutputTokens: 0,
  };

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { enrichedByTaskId, agentStats };
  }

  const validAgentIds = [];
  const seenAgentIds = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    if (typeof task.id !== "string" || task.id.length === 0) continue;
    if (!isValidAgentUuid(task.assignedAgentId)) continue;
    if (!seenAgentIds.has(task.assignedAgentId)) {
      seenAgentIds.add(task.assignedAgentId);
      validAgentIds.push(task.assignedAgentId);
    }
  }

  const resolvedEntries = await Promise.all(
    validAgentIds.map(async (agentId) => [agentId, await readAntigravityTranscript(agentId, options)]),
  );

  const transcriptByAgentId = new Map();
  for (const [agentId, result] of resolvedEntries) {
    if (!result) continue;
    transcriptByAgentId.set(agentId, result);
    agentStats.enrichedAgents += 1;
    agentStats.totalTurns += result.turns;
    agentStats.totalInputTokens += result.tokens.input;
    agentStats.totalCacheReadTokens += result.tokens.cacheRead;
    agentStats.totalOutputTokens += result.tokens.output;
  }

  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    if (typeof task.id !== "string" || task.id.length === 0) continue;
    const transcript = transcriptByAgentId.get(task.assignedAgentId);
    if (!transcript) continue;
    Object.defineProperty(enrichedByTaskId, task.id, {
      value: cloneTranscriptResult(transcript),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return { enrichedByTaskId, agentStats };
}
