// 읽기 전용 Git diff·Plan 개요 조회 리프 모듈.
// 셸을 전혀 실행하지 않고 경로·심볼릭 링크·민감 파일·바이트 상한을 검증해 안전하게 요약 정보만 반환한다.

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { assertNoSymlinkComponents } from "./pota-safe-fs.mjs";
import {
  filterDiffByScope,
  isSensitiveRepoPath,
  normalizeRepoPath,
  parseGitStatusAndNumstat,
  parsePlanOverview,
} from "../hooks/dag-model.mjs";

export {
  filterDiffByScope,
  isSensitiveRepoPath,
  normalizeRepoPath,
  parseGitStatusAndNumstat,
  parsePlanOverview,
};

export const GIT_TIMEOUT_MS = 3000;
export const GIT_MAX_BUFFER = 1024 * 1024;
export const MAX_PLAN_BYTES = 64 * 1024;

const PLAN_HEAD_RATIO = 0.625;
const READ_OPEN_FLAGS = typeof constants.O_NOFOLLOW === "number"
  ? constants.O_RDONLY | constants.O_NOFOLLOW
  : "r";

async function resolveExistingDir(root) {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0")) return null;
  try {
    const realRoot = await realpath(root);
    const rootStat = await stat(realRoot);
    return rootStat.isDirectory() ? realRoot : null;
  } catch {
    return null;
  }
}

async function validateAgainstRealRoot(realRoot, relPath) {
  const normalized = normalizeRepoPath(relPath);
  if (normalized === null) {
    return { ok: false, reason: "invalid-path" };
  }

  const candidate = join(realRoot, normalized);
  const rel = relative(realRoot, candidate);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { ok: false, reason: "outside-root" };
  }

  try {
    await assertNoSymlinkComponents(realRoot, candidate, { allowMissing: true });
  } catch (error) {
    if (error?.code === "POTA_SYMLINK") {
      return { ok: false, reason: "symlink" };
    }
    return { ok: false, reason: error?.code ? String(error.code) : "invalid-path" };
  }

  return {
    ok: true,
    path: normalized,
    absolutePath: candidate,
    sensitive: isSensitiveRepoPath(normalized),
  };
}

function emptyRepoDiff(reason) {
  return {
    available: false,
    reason,
    files: [],
    totals: { files: 0, added: 0, deleted: 0 },
    truncated: false,
  };
}

function classifyGitFailure(error) {
  if (!error) return "git-error";
  if (error.killed || error.code === "ETIMEDOUT") return "git-timeout";
  if (error.code === "ENOENT") return "git-unavailable";
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "git-output-too-large";
  const stderr = typeof error.stderr === "string" ? error.stderr.toLowerCase() : "";
  if (stderr.includes("not a git repository")) return "not-a-git-repo";
  return "git-error";
}

function sanitizeDiffFile(file) {
  const path = typeof file?.path === "string" ? file.path : "";
  return {
    path,
    status: typeof file?.status === "string" && file.status.length > 0 ? file.status : "M",
    added: typeof file?.added === "number" && Number.isFinite(file.added) ? file.added : 0,
    deleted: typeof file?.deleted === "number" && Number.isFinite(file.deleted) ? file.deleted : 0,
    binary: Boolean(file?.binary),
    sensitive: Boolean(file?.sensitive) || isSensitiveRepoPath(path),
  };
}

function countFenceLines(text) {
  let count = 0;
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) count += 1;
  }
  return count;
}

async function readFileSlice(handle, offset, length) {
  if (length <= 0) return Buffer.alloc(0);
  const buffer = Buffer.allocUnsafe(length);
  let totalRead = 0;
  while (totalRead < length) {
    const { bytesRead } = await handle.read(buffer, totalRead, length - totalRead, offset + totalRead);
    if (bytesRead === 0) break;
    totalRead += bytesRead;
  }
  return totalRead === length ? buffer : buffer.subarray(0, totalRead);
}

/**
 * 저장소 루트 내 상대 경로를 정규화하고 경로 탈출·옵션 인젝션·글롭·심볼릭 링크를 차단한다.
 * @param {string} root
 * @param {string} relPath
 * @returns {Promise<{ ok: true, path: string, absolutePath: string, sensitive: boolean } | { ok: false, reason: string }>}
 */
export async function validateRepoRelativePath(root, relPath) {
  const normalized = normalizeRepoPath(relPath);
  if (normalized === null) {
    return { ok: false, reason: "invalid-path" };
  }

  const realRoot = await resolveExistingDir(root);
  if (!realRoot) {
    return { ok: false, reason: "invalid-root" };
  }

  return validateAgainstRealRoot(realRoot, normalized);
}

/**
 * 셸 없이 `git -C <root>` 읽기 전용 서브프로세스를 실행해 stdout 문자열을 반환한다.
 * @param {string} root
 * @param {readonly string[]} args
 * @param {{ timeoutMs?: number, maxBuffer?: number }} [options]
 * @returns {Promise<string>}
 */
export function runGitReadOnly(root, args, { timeoutMs = GIT_TIMEOUT_MS, maxBuffer = GIT_MAX_BUFFER } = {}) {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0")) {
    return Promise.reject(new Error("Invalid git root"));
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    return Promise.reject(new Error("Invalid git arguments"));
  }

  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : GIT_TIMEOUT_MS;
  const effectiveMaxBuffer = Number.isFinite(maxBuffer) && maxBuffer > 0 ? maxBuffer : GIT_MAX_BUFFER;

  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      ["-C", root, ...args],
      {
        shell: false,
        timeout: effectiveTimeout,
        maxBuffer: effectiveMaxBuffer,
        windowsHide: true,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          LC_ALL: "C",
        },
      },
      (error, stdout) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise(typeof stdout === "string" ? stdout : "");
      },
    );
  });
}

/**
 * 저장소 전체의 Git 변경 파일 목록과 줄 수 통계를 읽기 전용으로 수집한다.
 * 비-Git 디렉터리, unborn HEAD, 명령 실패 시에도 예외를 던지지 않고 구조화된 결과를 반환한다.
 * @param {string} root
 * @param {{ timeoutMs?: number }} [options]
 */
export async function readRepoGitDiff(root, { timeoutMs = GIT_TIMEOUT_MS } = {}) {
  const realRoot = await resolveExistingDir(root);
  if (!realRoot) {
    return emptyRepoDiff("invalid-root");
  }

  // 사용자가 status.showUntrackedFiles=no 로 둔 저장소($HOME dotfiles 등)는 전체 순회를 피해야 하므로 존중한다.
  const showUntracked = await runGitReadOnly(realRoot, ["config", "--get", "status.showUntrackedFiles"], { timeoutMs })
    .then((value) => value.trim().toLowerCase())
    .catch(() => "");
  const untrackedArgs = showUntracked === "no" ? [] : ["--untracked-files=all"];

  let statusOut;
  try {
    statusOut = await runGitReadOnly(realRoot, ["status", "--porcelain=v1", "-z", ...untrackedArgs], { timeoutMs });
  } catch (error) {
    return emptyRepoDiff(classifyGitFailure(error));
  }

  const [unstagedOut, stagedOut] = await Promise.all([
    runGitReadOnly(realRoot, ["diff", "--numstat", "-z"], { timeoutMs }).catch(() => ""),
    runGitReadOnly(realRoot, ["diff", "--cached", "--numstat", "-z"], { timeoutMs }).catch(() => ""),
  ]);

  return parseGitStatusAndNumstat(statusOut, unstagedOut, stagedOut);
}

/**
 * `writeScopePaths`를 검증해 안전하지 않은 경로를 제거한 뒤 해당 범위의 Git diff 통계만 반환한다.
 * 파일 본문은 절대 노출하지 않으며, 이미 계산된 `repoDiff`가 있으면 서브프로세스를 재실행하지 않는다.
 * @param {string} root
 * @param {readonly string[] | null | undefined} writeScopePaths
 * @param {{ repoDiff?: { available?: boolean, files?: readonly unknown[] } | null, timeoutMs?: number }} [options]
 */
export async function readScopedGitDiff(root, writeScopePaths, { repoDiff = null, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  const realRoot = await resolveExistingDir(root);
  if (!realRoot) {
    return { available: false, files: [], totals: { files: 0, added: 0, deleted: 0 } };
  }

  const scopeList = Array.isArray(writeScopePaths) ? writeScopePaths : [];
  const validPaths = [];
  const seen = new Set();

  if (scopeList.length > 0) {
    const validatedList = await Promise.all(
      scopeList.map((entry) => validateAgainstRealRoot(realRoot, entry)),
    );
    for (const validated of validatedList) {
      if (!validated.ok || seen.has(validated.path)) continue;
      seen.add(validated.path);
      validPaths.push(validated.path);
    }
  }

  if (validPaths.length === 0) {
    return { available: true, files: [], totals: { files: 0, added: 0, deleted: 0 } };
  }

  const effectiveRepoDiff = repoDiff && typeof repoDiff === "object" && typeof repoDiff.available === "boolean"
    ? repoDiff
    : await readRepoGitDiff(realRoot, { timeoutMs });

  const filtered = filterDiffByScope(effectiveRepoDiff, validPaths);
  return {
    available: filtered.available,
    files: filtered.files.map(sanitizeDiffFile),
    totals: filtered.totals,
  };
}

/**
 * Plan 마크다운 파일을 바운드된 크기로 안전하게 읽어 개요(제목·Goal·최신 요청·체크리스트)를 반환한다.
 * 민감 경로, 비-`.md` 파일, 심볼릭 링크, 부재 파일 및 모든 I/O 오류에서는 예외 없이 `null`을 반환한다.
 * @param {string} root
 * @param {string} planId
 * @param {{ maxBytes?: number }} [options]
 */
export async function readPlanOverview(root, planId, { maxBytes = MAX_PLAN_BYTES } = {}) {
  const realRoot = await resolveExistingDir(root);
  if (!realRoot) return null;

  const validated = await validateAgainstRealRoot(realRoot, planId);
  if (!validated.ok || validated.sensitive || !validated.path.toLowerCase().endsWith(".md")) {
    return null;
  }

  const effectiveMaxBytes = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : MAX_PLAN_BYTES;

  let handle = null;
  try {
    await assertNoSymlinkComponents(realRoot, validated.absolutePath, { allowMissing: false });
    handle = await open(validated.absolutePath, READ_OPEN_FLAGS);
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) return null;

    let text;
    let truncated = false;
    if (fileStat.size <= effectiveMaxBytes) {
      const buf = await readFileSlice(handle, 0, fileStat.size);
      text = buf.toString("utf8");
    } else {
      truncated = true;
      const headBytes = Math.max(1, Math.floor(effectiveMaxBytes * PLAN_HEAD_RATIO));
      const tailBytes = Math.max(0, effectiveMaxBytes - headBytes);

      const headBuf = await readFileSlice(handle, 0, Math.min(headBytes, fileStat.size));
      // 멀티바이트 UTF-8 경계에서 잘린 trailing 불완전 바이트와 미완성 마지막 줄을 안전하게 제거한다.
      const headDecoder = new StringDecoder("utf8");
      const rawHead = headDecoder.write(headBuf);
      const lastNewline = rawHead.lastIndexOf("\n");
      const headText = lastNewline >= 0 ? rawHead.slice(0, lastNewline + 1) : rawHead;

      let tailText = "";
      if (tailBytes > 0) {
        const tailOffset = Math.max(headBytes, fileStat.size - tailBytes);
        const tailLen = fileStat.size - tailOffset;
        const tailBuf = await readFileSlice(handle, tailOffset, tailLen);
        const rawTail = tailBuf.toString("utf8");
        const firstNewline = rawTail.indexOf("\n");
        tailText = firstNewline >= 0 ? rawTail.slice(firstNewline + 1) : "";
      }

      if (tailText.length > 0) {
        // 생략된 중간 구간에서 코드 펜스 짝이 어긋나 하단 체크리스트가 무시되지 않도록 경계를 보정한다.
        const needsFenceBridge = ((countFenceLines(headText) ^ countFenceLines(tailText)) & 1) === 1;
        text = needsFenceBridge ? `${headText}\n\`\`\`\n${tailText}` : `${headText}\n${tailText}`;
      } else {
        text = headText;
      }
    }

    return parsePlanOverview(text, { planId: validated.path, truncated });
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}
