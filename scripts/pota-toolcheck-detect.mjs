import { lstat, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { commandOk } from "./pota-toolcheck-runtime.mjs";

export async function collectEntries(base) {
  const output = [];
  async function walk(dir) {
    for (const entry of await readdir(dir)) {
      if ([".git", ".pota", "node_modules", "vendor", "target", ".venv", "__pycache__"].includes(entry)) continue;
      const path = join(dir, entry);
      const relativePath = normalizePath(relative(base, path));
      if (relativePath === "test/fixtures" || relativePath.startsWith("test/fixtures/")) continue;
      const info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) await walk(path);
      else output.push(relativePath);
    }
  }
  await walk(base);
  return output;
}

export function detectStacks(paths) {
  const stacks = new Set();
  if (hasBasename(paths, "package.json")) stacks.add("javascript");
  if (hasBasename(paths, "tsconfig.json") || paths.some((path) => path.endsWith(".ts") || path.endsWith(".tsx"))) stacks.add("typescript");
  if (hasBasename(paths, "pyproject.toml") || paths.some((path) => path.endsWith(".py"))) stacks.add("python");
  if (hasBasename(paths, "composer.json") || paths.some((path) => path.endsWith(".php"))) stacks.add("php");
  if (hasBasename(paths, "pom.xml", "build.gradle", "build.gradle.kts") || paths.some((path) => path.endsWith(".java"))) stacks.add("java");
  if (paths.some((path) => path.endsWith(".kt") || path.endsWith(".kts"))) stacks.add("kotlin");
  if (hasBasename(paths, "Package.swift") || paths.some((path) => hasPathSegmentWithSuffix(path, ".xcodeproj", ".xcworkspace") || path.endsWith(".swift"))) stacks.add("swift");
  if (hasBasename(paths, "go.mod") || paths.some((path) => path.endsWith(".go"))) stacks.add("go");
  if (hasBasename(paths, "Cargo.toml") || paths.some((path) => path.endsWith(".rs"))) stacks.add("rust");
  return [...stacks];
}

export function buildRequirements(stacks, entries = [], _commandAvailable = commandOk, platform = process.platform) {
  const requirements = [];
  if (stacks.includes("javascript")) {
    requirements.push(unsafeReq("node", ["--version"], "JavaScript runtime for package scripts and CLI checks", "automatic runtime installation is unavailable"));
    const manager = packageManager(entries);
    requirements.push(unsafeReq(manager, ["--version"], `JavaScript package manager selected from ${packageManagerSource(entries)}`, "automatic package-manager installation is unavailable"));
  }
  if (stacks.includes("typescript")) {
    requirements.push(unsafeReq("typescript-language-server", ["--version"], "TypeScript LSP server", "automatic package installation is disabled without pinned package versions"));
    requirements.push(unsafeReq("tsc", ["--version"], "TypeScript compiler verification", "automatic package installation is disabled without pinned package versions"));
  }
  if (stacks.includes("python")) {
    requirements.push(unsafeReq("basedpyright", ["--version"], "Python LSP/type checker", "automatic Python package installation is disabled without pinned package versions"));
    requirements.push(unsafeReq("ruff", ["--version"], "Python lint and format checker", "automatic Python package installation is disabled without pinned package versions"));
  }
  if (stacks.includes("php")) {
    const composerProject = hasBasename(entries, "composer.json");
    requirements.push(req("php", ["--version"], "PHP runtime for Composer scripts and CLI checks"));
    if (composerProject) requirements.push(req("composer", ["--version"], "PHP package manager for project-local tool installation"));
    requirements.push(unsafeReq("phpactor", ["--version"], "PHP LSP server", "automatic Composer package installation is disabled without pinned package versions"));
    requirements.push(unsafeReq("phpstan", ["--version"], "PHP static analysis verification", "automatic Composer package installation is disabled without pinned package versions"));
    requirements.push(unsafeReq("php-cs-fixer", ["--version"], "PHP formatting verification", "automatic Composer package installation is disabled without pinned package versions"));
  }
  if (stacks.includes("java")) {
    addJvmRequirements(requirements);
    requirements.push(unsafeReq("jdtls", ["--version"], "Java LSP server", "checksum-free JDTLS latest downloads are disabled"));
    addJvmBuildToolRequirements(requirements, entries);
  }
  if (stacks.includes("kotlin")) {
    addJvmRequirements(requirements);
    requirements.push(req("kotlin-lsp.sh", ["--help"], "Kotlin LSP server"));
    requirements.push(req("kotlinc", ["-version"], "Kotlin compiler verification"));
    addJvmBuildToolRequirements(requirements, entries);
  }
  if (stacks.includes("swift")) {
    requirements.push(req("swift", ["--version"], "Swift toolchain for build and test commands"));
    requirements.push(req("sourcekit-lsp", ["--version"], "Swift LSP server"));
    if (entries.some((path) => hasPathSegmentWithSuffix(path, ".xcodeproj", ".xcworkspace"))) {
      requirements.push(req("xcodebuild", ["-version"], "Xcode build verification"));
    }
  }
  if (stacks.includes("go")) {
    requirements.push(unsafeReq("gopls", ["version"], "Go LSP server", "unpinned go install targets are disabled"));
    requirements.push(unsafeReq("golangci-lint", ["--version"], "Go lint verification", "unpinned go install targets are disabled"));
  }
  if (stacks.includes("rust")) {
    requirements.push(unsafeReq("rust-analyzer", ["--version"], "Rust LSP server", "automatic rustup changes are disabled without a pinned toolchain manifest"));
    requirements.push(unsafeReq("cargo", ["clippy", "--version"], "Rust clippy verification", "automatic rustup changes are disabled without a pinned toolchain manifest"));
  }
  return requirements;
}

export function addJvmRequirements(requirements) {
  if (!requirements.some((requirement) => requirement.name === "java")) {
    requirements.push(req("java", ["--version"], "JVM runtime for build and test commands"));
  }
  if (!requirements.some((requirement) => requirement.name === "javac")) {
    requirements.push(req("javac", ["--version"], "JVM compiler verification"));
  }
}

export function addJvmBuildToolRequirements(requirements, entries = []) {
  const gradleWindows = findBasename(entries, "gradlew.bat");
  const gradleUnix = findBasename(entries, "gradlew");
  if (gradleWindows) pushUnique(requirements, req(repositoryCommand(gradleWindows), ["--version"], "Gradle wrapper availability", null, { localOnly: true }));
  else if (gradleUnix) pushUnique(requirements, req(repositoryCommand(gradleUnix), ["--version"], "Gradle wrapper availability", null, { localOnly: true }));
  else if (hasBasename(entries, "build.gradle", "build.gradle.kts")) pushUnique(requirements, req("gradle", ["--version"], "Gradle availability"));
  const mavenWindows = findBasename(entries, "mvnw.cmd", "mvnw.bat");
  const mavenUnix = findBasename(entries, "mvnw");
  if (mavenWindows) pushUnique(requirements, req(repositoryCommand(mavenWindows), ["--version"], "Maven wrapper availability", null, { localOnly: true }));
  else if (mavenUnix) pushUnique(requirements, req(repositoryCommand(mavenUnix), ["--version"], "Maven wrapper availability", null, { localOnly: true }));
  else if (hasBasename(entries, "pom.xml")) pushUnique(requirements, req("mvn", ["--version"], "Maven availability"));
}

export function pushUnique(requirements, requirement) {
  if (!requirements.some((candidate) => candidate.name === requirement.name)) requirements.push(requirement);
}

// Kept for API compatibility. Callers may show these commands, but buildRequirements
// no longer attaches an unpinned command to an automatically executable requirement.
export function composerInstall(packages) {
  return { command: "composer", args: ["require", "--dev", ...packages] };
}

export function pythonInstall(uv, project, tool, platform = process.platform) {
  if (uv && project) return { command: "uv", args: ["add", "--dev", tool] };
  if (uv) return { command: "uv", args: ["tool", "install", tool] };
  if (platform === "win32") return { command: "py", args: ["-3", "-m", "pip", "install", "--user", tool] };
  return { command: "python3", args: ["-m", "pip", "install", "--user", tool] };
}

export function jdtlsInstall(_platform = process.platform) {
  return null;
}

export function req(command, args, reason, installCommand = null, options = {}) {
  return {
    name: command,
    command,
    args,
    reason,
    install: installCommand,
    installUnavailableReason: options.installUnavailableReason ?? null,
    localOnly: options.localOnly ?? false,
  };
}

export function unsafeReq(command, args, reason, installUnavailableReason) {
  return req(command, args, reason, null, { installUnavailableReason });
}

export function packageManager(entries = []) {
  return selectPackageManager(entries).manager;
}

export function packageManagerSource(entries = []) {
  const selected = selectPackageManager(entries);
  return selected.path ?? "the npm default (no lockfile found)";
}

export function installDev(pm, packages) {
  if (pm === "bun") return { command: "bun", args: ["add", "-d", ...packages] };
  if (pm === "pnpm") return { command: "pnpm", args: ["add", "-D", ...packages] };
  if (pm === "yarn") return { command: "yarn", args: ["add", "-D", ...packages] };
  return { command: "npm", args: ["install", "--save-dev", ...packages] };
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function pathBasename(path) {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function hasBasename(paths, ...names) {
  const expected = new Set(names);
  return paths.some((path) => expected.has(pathBasename(path)));
}

function findBasename(paths, ...names) {
  const expected = new Set(names);
  return [...paths]
    .filter((path) => expected.has(pathBasename(path)))
    .sort(compareRepositoryPaths)[0] ?? null;
}

function hasPathSegmentWithSuffix(path, ...suffixes) {
  return normalizePath(path)
    .split("/")
    .some((segment) => suffixes.some((suffix) => segment.endsWith(suffix)));
}

function repositoryCommand(path) {
  const normalized = normalizePath(path);
  return normalized.startsWith("./") ? normalized : `./${normalized}`;
}

function selectPackageManager(entries) {
  const lockfiles = [
    { manager: "bun", names: new Set(["bun.lock", "bun.lockb"]), priority: 0 },
    { manager: "pnpm", names: new Set(["pnpm-lock.yaml"]), priority: 1 },
    { manager: "yarn", names: new Set(["yarn.lock"]), priority: 2 },
    { manager: "npm", names: new Set(["package-lock.json", "npm-shrinkwrap.json"]), priority: 3 },
  ];
  const candidates = [];

  for (const path of entries) {
    const normalized = normalizePath(path);
    const name = pathBasename(normalized);
    const match = lockfiles.find(({ names }) => names.has(name));
    if (!match) continue;
    candidates.push({
      manager: match.manager,
      path: normalized,
      depth: normalized.split("/").length - 1,
      priority: match.priority,
    });
  }

  candidates.sort((left, right) => left.depth - right.depth
    || left.priority - right.priority
    || left.path.localeCompare(right.path));
  return candidates[0] ?? { manager: "npm", path: null };
}

function compareRepositoryPaths(left, right) {
  const leftPath = normalizePath(left);
  const rightPath = normalizePath(right);
  const depth = leftPath.split("/").length - rightPath.split("/").length;
  return depth || leftPath.localeCompare(rightPath);
}
