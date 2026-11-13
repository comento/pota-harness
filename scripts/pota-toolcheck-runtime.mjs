import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join, posix, resolve, win32 } from "node:path";

export const DEFAULT_TIMEOUT_MS = 10_000;

export function inspectCommand(requirement, {
  root = process.cwd(),
  runner = run,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  localChecker = localExecutableAvailable,
  platform = process.platform,
} = {}) {
  const candidates = commandCandidates(requirement.command, root, platform);
  const localOnly = requirement.localOnly || isRepositoryCommand(requirement.command, root);

  if (!localOnly) {
    let diagnostic = null;
    for (const candidate of systemCommandCandidates(requirement.command, platform)) {
      diagnostic = execute(candidate, requirement.args, { root, runner, timeoutMs });
      if (diagnostic.status === 0) {
        return {
          ok: true,
          availability: "verified",
          source: "system",
          candidate,
          diagnostic,
        };
      }
    }

    for (const candidate of candidates.slice(1)) {
      if (localChecker(candidate)) {
        return {
          ok: true,
          availability: "discovered",
          source: "repository",
          candidate,
          diagnostic,
        };
      }
    }

    return {
      ok: false,
      availability: diagnostic?.timedOut ? "timeout" : "missing",
      source: null,
      candidate: null,
      diagnostic,
    };
  }

  for (const candidate of repositoryCandidates(requirement.command, root)) {
    if (localChecker(candidate)) {
      return {
        ok: true,
        availability: "discovered",
        source: "repository",
        candidate,
        diagnostic: null,
      };
    }
  }

  return {
    ok: false,
    availability: "missing",
    source: null,
    candidate: null,
    diagnostic: null,
  };
}

export function commandOk(command, args, root = process.cwd(), runner = run) {
  return inspectCommand({ name: command, command, args, reason: "tool availability" }, { root, runner }).ok;
}

export function commandCandidates(command, root = process.cwd(), platform = process.platform) {
  const candidates = isRepositoryCommand(command, root)
    ? repositoryCandidates(command, root)
    : [
        command,
        join(root, "node_modules", ".bin", command),
        join(root, "vendor", "bin", command),
        join(root, ".pota", "tools", "bin", command),
      ];
  if (platform !== "win32") return [...new Set(candidates)];
  const extensions = [".cmd", ".bat", ".exe"];
  return [...new Set(candidates.flatMap((candidate) => hasWindowsExecutableExtension(candidate) ? [candidate] : [candidate, ...extensions.map((extension) => `${candidate}${extension}`)]))];
}

export function systemCommandCandidates(command, platform = process.platform) {
  if (platform !== "win32" || hasWindowsExecutableExtension(command) || isAbsolute(command)) return [command];
  return [command, `${command}.cmd`, `${command}.bat`, `${command}.exe`];
}

export function localExecutableAvailable(command, platform = process.platform) {
  try {
    const info = statSync(command);
    if (!info.isFile()) return false;
    accessSync(command, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function run(command, args, { cwd = process.cwd(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    stdio: "ignore",
    encoding: "utf8",
    shell: shouldUseShell(command),
    timeout: timeoutMs,
    env: safeEnvironment(cwd),
  });
  return { ...result, durationMs: Date.now() - startedAt };
}

export function shouldUseShell(command, platform = process.platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

export function execute(command, args, { root, runner, timeoutMs }) {
  const startedAt = Date.now();
  try {
    const result = runner(command, args, { cwd: root, timeoutMs });
    return {
      status: Number.isInteger(result?.status) ? result.status : null,
      signal: result?.signal ?? null,
      errorCode: result?.error?.code ?? null,
      timedOut: result?.error?.code === "ETIMEDOUT",
      durationMs: Number.isFinite(result?.durationMs) ? result.durationMs : Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: null,
      signal: null,
      errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : "RUNNER_ERROR",
      timedOut: false,
      durationMs: Date.now() - startedAt,
    };
  }
}

function repositoryCandidates(command, root) {
  const normalizedCommand = command.replace(/^\.\//, "");
  const direct = isAbsolute(command) ? command : resolve(root, normalizedCommand);
  return [...new Set([direct])];
}

function isRepositoryCommand(command, root) {
  if (/^(?:\.\.?[\\/])/.test(command)) return true;
  if (/^(?:gradlew|gradlew\.bat|mvnw|mvnw\.cmd|mvnw\.bat)$/i.test(command)) return true;
  return isAbsolute(command) && isWithin(root, command);
}

export function isWithin(root, candidate, platform = process.platform) {
  const pathApi = platform === "win32" ? win32 : posix;
  const path = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return path === "" || (!pathApi.isAbsolute(path) && !path.startsWith(`..${pathApi.sep}`) && path !== "..");
}

function safeEnvironment(root) {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const safePath = (process.env[pathKey] ?? "")
    .split(delimiter)
    .filter(Boolean)
    .filter((entry) => isAbsolute(entry) && !isWithin(root, entry))
    .join(delimiter);
  return { ...process.env, [pathKey]: safePath };
}


function hasWindowsExecutableExtension(command) {
  return /\.(cmd|bat|exe)$/i.test(command);
}
