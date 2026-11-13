import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export function normalizeVerificationArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error("verification command must follow -- as argv");
  return argv.map((item, index) => {
    if (typeof item !== "string") throw new Error(`verification argv[${index}] must be a string`);
    if (index === 0 && item.trim().length === 0) throw new Error("verification executable must be a non-empty string");
    return item;
  });
}

export function normalizeWatchPaths(root, watchPaths) {
  if (!Array.isArray(watchPaths)) throw new Error("watchPaths must be an array");
  const workspaceRoot = resolve(root);
  return [...new Set(watchPaths.map((item, index) => {
    const source = requiredText(item, `watchPaths[${index}]`);
    const absolutePath = resolve(workspaceRoot, source);
    const relativePath = relative(workspaceRoot, absolutePath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      throw new Error(`watch path must remain inside the workspace: ${source}`);
    }
    const normalizedPath = relativePath === "" ? "." : relativePath.split(sep).join("/");
    if (isInternalStatePath(normalizedPath)) throw new Error(`watch path cannot target internal Pota or Git state: ${source}`);
    return normalizedPath;
  }))];
}

export function workspaceFingerprint(root = process.cwd(), watchPaths = []) {
  const workspaceRoot = resolve(root);
  const normalizedWatchPaths = normalizeWatchPaths(workspaceRoot, watchPaths);
  const gitPaths = normalizedWatchPaths.length === 0 ? listGitWorkspacePaths(workspaceRoot) : null;
  const paths = normalizedWatchPaths.length > 0
    ? listFilesystemPaths(workspaceRoot, normalizedWatchPaths)
    : (gitPaths ?? listFilesystemPaths(workspaceRoot, normalizedWatchPaths));
  const hash = createHash("sha256");
  for (const path of [...new Set(paths)].sort()) hashWorkspacePath(hash, workspaceRoot, path);
  return `sha256:${hash.digest("hex")}`;
}

export function runVerificationEvidence({
  root,
  argv,
  watchPaths,
  runner = spawnSync,
  timeoutMs,
}) {
  const initialFingerprint = workspaceFingerprint(root, watchPaths);
  const result = runner(argv[0], argv.slice(1), {
    cwd: resolve(root),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    timeout: validTimeout(timeoutMs),
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error(`Verification timed out after ${timeoutMs}ms`);
  if (result.error) throw new Error(`Verification could not start: ${result.error.message}`);
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const output = combinedOutput(result.stdout, result.stderr);
  if (exitCode !== 0) {
    const detail = boundedText(output, 2000);
    throw new Error(`Verification failed with exit ${exitCode}${detail ? `:\n${detail}` : ""}`);
  }

  const fingerprint = workspaceFingerprint(root, watchPaths);
  if (fingerprint !== initialFingerprint) throw new Error("Watched workspace changed during verification; evidence was not recorded");
  return {
    argv,
    command: argv.map((value) => JSON.stringify(value)).join(" "),
    outputDigest: sha256(output),
    summary: successSummary(output),
    workspaceFingerprint: fingerprint,
    watchPaths,
  };
}

function listGitWorkspacePaths(root) {
  const result = spawnSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.split("\0").filter(Boolean)
    .filter((path) => !isInternalStatePath(path) && !isPotaRecordPath(path));
}

// Pota records evidence in these artifacts after verification; including them in the default fingerprint would
// make every recorded receipt stale. Pass --watch explicitly when a claim is about these files.
function isPotaRecordPath(path) {
  return path === "PLAN.md" || path === "MEMORY.md" || path.startsWith("docs/plan/") || path.startsWith("docs/memory/");
}

function listFilesystemPaths(root, watchPaths) {
  const paths = [];
  const visit = (relativePath) => {
    if (isInternalStatePath(relativePath)) return;
    const absolutePath = relativePath === "." ? root : join(root, ...relativePath.split("/"));
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        paths.push(relativePath);
        return;
      }
      throw error;
    }
    if (!stat.isDirectory()) {
      paths.push(relativePath);
      return;
    }
    const entries = readdirSync(absolutePath).sort();
    if (entries.length === 0) paths.push(relativePath);
    for (const entry of entries) {
      const child = relativePath === "." ? entry : `${relativePath}/${entry}`;
      visit(child);
    }
  };
  for (const path of watchPaths.length > 0 ? watchPaths : ["."]) visit(path);
  return paths;
}

function hashWorkspacePath(hash, root, relativePath) {
  const absolutePath = relativePath === "." ? root : join(root, ...relativePath.split("/"));
  hash.update(`${relativePath}\0`);
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      hash.update("missing\0");
      return;
    }
    throw error;
  }
  hash.update(`${stat.mode}\0`);
  if (stat.isSymbolicLink()) {
    hash.update(`symlink\0${readlinkSync(absolutePath)}\0`);
  } else if (stat.isFile()) {
    hash.update("file\0");
    hash.update(readFileSync(absolutePath));
    hash.update("\0");
  } else if (stat.isDirectory()) {
    hash.update("directory\0");
  } else {
    hash.update("other\0");
  }
}

function isInternalStatePath(path) {
  const firstSegment = path.split("/")[0];
  return firstSegment === ".git" || firstSegment === ".pota";
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function combinedOutput(stdout, stderr) {
  return [stdout, stderr].filter((value) => typeof value === "string" && value.length > 0).join("\n").trim();
}

function boundedText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) return text;
  return `…${text.slice(-(maxLength - 1))}`;
}

function successSummary(output) {
  const text = String(output ?? "");
  const outputBytes = Buffer.byteLength(text);
  const outputLines = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  return `verification passed; outputBytes=${outputBytes}; outputLines=${outputLines}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validTimeout(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("timeoutMs must be a positive integer");
  return value;
}
