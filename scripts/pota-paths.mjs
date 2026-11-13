import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_LOCATOR_SCHEMA_VERSION = 1;

export function potaHome(env = process.env) {
  const userHome = env.HOME ?? env.USERPROFILE ?? homedir();
  return resolve(env.POTA_HOME ?? join(userHome, ".pota"));
}

// Lifecycle-managed files (ownership manifest, journal, lock, canonical runtime, marketplaces) live under
// <potaHome>/install so they stay separate from goal state under <potaHome>/projects.
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

export function createRuntimeLocator(pluginRoot) {
  const root = resolve(pluginRoot);
  return {
    schemaVersion: RUNTIME_LOCATOR_SCHEMA_VERSION,
    plugin: "pota",
    pluginRoot: root,
    entrypoints: {
      cli: join(root, "scripts", "pota.mjs"),
      lifecycle: join(root, "scripts", "pota-lifecycle.mjs"),
      state: join(root, "scripts", "pota-state.mjs"),
      toolcheck: join(root, "scripts", "pota-toolcheck.mjs"),
    },
    resources: {
      agents: join(root, "agents"),
      commands: join(root, "commands"),
      modelGuidance: join(root, "docs", "model-guidance"),
      skills: join(root, "skills"),
      templates: join(root, "templates"),
    },
  };
}

const runtimeEntryRelativePaths = [
  join("scripts", "pota.mjs"),
  join("scripts", "pota-lifecycle.mjs"),
  join("scripts", "pota-state.mjs"),
  join("scripts", "pota-toolcheck.mjs"),
  join("scripts", "pota-goal.mjs"),
  join("scripts", "pota-cleanup.mjs"),
  // Spawned by path from the SessionStart hook, so it is an entrypoint of its own.
  join("scripts", "pota-auto-upgrade.mjs"),
];
const localModuleSpecifier = /^(?:import|export)\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|[\w$]+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?\s+from\s+)?["'](\.[^"']+)["']/gm;

export function runtimeRequiredRelativePaths(pluginRoot) {
  const root = resolve(pluginRoot);
  const pending = runtimeEntryRelativePaths.map((path) => join(root, path));
  const closure = new Set();

  while (pending.length > 0) {
    const path = pending.pop();
    if (closure.has(path)) continue;
    closure.add(path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(localModuleSpecifier)) pending.push(resolve(dirname(path), match[1]));
  }

  return [...closure].map((path) => relative(root, path)).sort();
}

export function runtimeRequiredPaths(locator) {
  if (!locator || locator.schemaVersion !== RUNTIME_LOCATOR_SCHEMA_VERSION || locator.plugin !== "pota"
      || typeof locator.pluginRoot !== "string") return [];
  const root = locator.pluginRoot;
  return [
    join(root, "package.json"),
    join(root, ".codex-plugin", "plugin.json"),
    join(root, "hooks", "hooks.json"),
    ...runtimeRequiredRelativePaths(root).map((path) => join(root, path)),
    locator.resources?.commands,
    locator.resources?.agents,
    locator.resources?.skills,
    join(locator.resources?.templates ?? "", "work-plan.md"),
    join(locator.resources?.modelGuidance ?? "", "README.md"),
    join(locator.resources?.modelGuidance ?? "", "codex.md"),
  ].filter(Boolean);
}
