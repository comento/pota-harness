import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function potaHome(env = process.env) {
  const userHome = env.HOME ?? env.USERPROFILE ?? homedir();
  return resolve(env.POTA_HOME ?? join(userHome, ".pota"));
}

// The legacy npm (1.x) installer kept its files (ownership manifest, lock, runtime, marketplaces) under <potaHome>/install;
// the migration that removes them and `pota doctor` still read these paths.
export function installRoot(env = process.env) {
  return join(potaHome(env), "install");
}

export function installManifestPath(env = process.env) {
  return join(installRoot(env), "lifecycle.json");
}

export function repositoryId(root = process.cwd()) {
  return `project-${hashPath(gitLayout(root).commonDir)}`;
}

export function worktreeId(root = process.cwd()) {
  return `worktree-${hashPath(gitLayout(root).gitDir)}`;
}

export function goalStateDirectory(root = process.cwd(), env = process.env) {
  return join(potaHome(env), "projects", repositoryId(root), "worktrees", worktreeId(root));
}

function gitLayout(root) {
  const workspaceRoot = realpathSync(resolve(root));
  const gitEntry = join(workspaceRoot, ".git");
  try {
    const stat = lstatSync(gitEntry);
    const gitDir = stat.isDirectory() ? realpathSync(gitEntry) : resolveGitFile(workspaceRoot, gitEntry);
    const commonFile = join(gitDir, "commondir");
    const commonDir = existsSync(commonFile)
      ? realpathSync(resolve(gitDir, readFileSync(commonFile, "utf8").trim()))
      : gitDir;
    return { gitDir, commonDir };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { gitDir: workspaceRoot, commonDir: workspaceRoot };
  }
}

function resolveGitFile(workspaceRoot, gitEntry) {
  const match = readFileSync(gitEntry, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
  if (!match) throw new Error(`Invalid Git worktree file: ${gitEntry}`);
  return realpathSync(resolve(workspaceRoot, match[1]));
}

function hashPath(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function resolvePluginRoot(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), "..");
}

export function parseRootArgs(args = [], options = {}) {
  const remaining = [];
  let explicitRoot = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--root") {
      if (explicitRoot !== null) throw new Error("--root may only be provided once");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--root requires a path");
      explicitRoot = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--root=")) {
      if (explicitRoot !== null) throw new Error("--root may only be provided once");
      const value = argument.slice("--root=".length);
      if (!value) throw new Error("--root requires a path");
      explicitRoot = value;
      continue;
    }
    remaining.push(argument);
  }

  return {
    args: remaining,
    explicitRoot,
    repoRoot: resolveRepoRoot({ ...options, explicitRoot }),
  };
}

export function resolveRepoRoot({
  explicitRoot = null,
  hookCwd = null,
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  if (explicitRoot) return resolve(cwd, explicitRoot);
  if (hookCwd) {
    const hookStart = resolve(hookCwd);
    return discoverRepositoryRoot(hookStart) ?? hookStart;
  }
  if (env.HARNESS_REPO_ROOT) return resolve(env.HARNESS_REPO_ROOT);
  const start = resolve(cwd);
  return discoverRepositoryRoot(start) ?? start;
}

export function discoverRepositoryRoot(start = process.cwd()) {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
