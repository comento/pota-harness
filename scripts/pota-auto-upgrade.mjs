#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLifecycleLock } from "./pota-lifecycle-lock.mjs";
import { assertNoSymlinkComponents } from "./pota-safe-fs.mjs";
import {
  AUTO_UPGRADE_EXIT, UPDATE_PACKAGE_NAME, autoUpgradeSetting, emptyUpdateState, noticeRecord, readInstallManifest,
  readJsonFile, readPendingNotice, readUpdateState, removeUpdateState, updatePaths, writeFileAtomic, writeJsonAtomic,
} from "./pota-update-state.mjs";

// The detached auto-upgrade runner (`run`, started by the SessionStart hook) and the `pota auto-upgrade` CLI.
// The runner is the old version and the package it installs is the new one. Only three things are fixed between
// versions: the `pota-lifecycle.mjs upgrade --auto` call, `version` in POTA_HOME/install/lifecycle.json, and the
// meaning of the lifecycle exit code (0 done, AUTO_UPGRADE_EXIT.manual a Claude Code step left to the user, anything
// else not confirmed).
export const AUTO_UPGRADE_USAGE = "Usage: pota auto-upgrade status|on|off|run";
const VIEW_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 120_000;
const LIFECYCLE_TIMEOUT_MS = 300_000;
const LOG_LIMIT_BYTES = 64 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REGISTRY_VERSION = /^\d+\.\d+\.\d+$/;
const REGISTRY_VERSION_MAX_LENGTH = 32;
const LOCK_BUSY = "Timed out waiting for Pota lifecycle lock";

class UsageError extends Error {}

if (isCliEntry()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`Pota auto-upgrade error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

// Exit codes follow the root CLI: 0 success or help, 1 an execution error or a failed run, 2 a usage error.
export async function main(args, env = process.env) {
  const [command, ...rest] = args;
  if (command === undefined || command === "help" || command === "--help") {
    console.log(AUTO_UPGRADE_USAGE);
    return 0;
  }
  if (!["status", "on", "off", "run"].includes(command)) throw new UsageError(`unknown command: ${command}`);
  if (rest.length > 0) throw new UsageError(`auto-upgrade ${command} does not accept arguments: ${rest.join(" ")}`);
  if (command === "on" || command === "off") setAutoUpgrade(env, command === "on");
  if (command !== "run") {
    printJson(statusReport(env));
    return 0;
  }
  const report = await runAutoUpgrade(env);
  printJson(report);
  return ["failed", "check-failed", "manual"].includes(report.result?.kind) ? 1 : 0;
}

export function statusReport(env = process.env) {
  const paths = updatePaths(env);
  const setting = autoUpgradeSetting(env, paths);
  const manifest = readInstallManifest(paths);
  const state = readUpdateState(paths);
  return {
    enabled: setting.enabled,
    source: setting.source,
    installed: manifest,
    lastCheckedAt: state?.lastCheckedAt ?? null,
    latestSeen: state?.latestSeen ?? null,
    nextAttemptAt: state?.nextAttemptAt ?? null,
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    failedVersion: state?.failedVersion ?? null,
    lastResult: state?.lastResult ?? null,
    pendingNotice: readPendingNotice(paths),
    config: paths.config,
    statePath: paths.state,
    log: paths.log,
  };
}

// Other config.json keys are kept. A config.json that is not a readable JSON object is left as it is.
function setAutoUpgrade(env, enabled) {
  const paths = updatePaths(env);
  const read = readJsonFile(paths.config);
  const object = read.status === "ok" && read.value && typeof read.value === "object" && !Array.isArray(read.value);
  if (read.status !== "missing" && !object) throw new Error(`${paths.config} is not a readable JSON object; fix or remove it`);
  writeJsonAtomic(paths.config, { ...(object ? read.value : {}), autoUpgrade: enabled });
}

export async function runAutoUpgrade(env = process.env) {
  const paths = updatePaths(env);
  if (!autoUpgradeSetting(env, paths).enabled) return { ran: false, reason: "disabled" };
  if (!readInstallManifest(paths)) return { ran: false, reason: "not-installed" };
  await assertNoSymlinkComponents(paths.home, paths.stage);
  await mkdir(paths.root, { recursive: true });
  // A held update.lock means another runner is working: exit without waiting. A lock left by a dead process is
  // reclaimed by the lifecycle lock rules.
  let report;
  try {
    report = await createLifecycleLock({ lifecycleLockPath: paths.lock })
      .withLifecycleLock(() => runLocked(env, paths), { timeoutMs: 1, retryMs: 1 });
  } catch (error) {
    if (String(error?.message).startsWith(LOCK_BUSY)) return { ran: false, reason: "locked" };
    throw error;
  }
  // An uninstall finished while this runner worked: its update state goes too, as uninstall would have removed it.
  if (report.reason === "not-installed" && readJsonFile(paths.manifest).status === "missing") await removeUpdateState(env);
  return report;
}

async function runLocked(env, paths) {
  // Read again under the lock: a lifecycle command or another runner may have changed the installation.
  if (!autoUpgradeSetting(env, paths).enabled) return { ran: false, reason: "disabled" };
  const manifest = readInstallManifest(paths);
  if (!manifest) return { ran: false, reason: "not-installed" };
  const now = new Date();
  const previous = { ...emptyUpdateState(), ...(readUpdateState(paths) ?? {}) };
  if (manifest.origin === "checkout") {
    const state = { ...previous, lastCheckedAt: now.toISOString(), lastResult: result("skipped", now, manifest.version, null, "checkout-origin installation") };
    writeJsonAtomic(paths.state, state);
    return { ran: false, reason: "checkout", result: state.lastResult };
  }
  const log = [];
  let state;
  try {
    const lookup = runNpm(["view", `${UPDATE_PACKAGE_NAME}@latest`, "version", "--json"], { cwd: paths.root, env, timeout: VIEW_TIMEOUT_MS });
    log.push(logEntry("npm view", lookup));
    const latest = registryVersion(lookup);
    state = latest.error
      ? checkFailure(previous, { now, from: manifest.version, to: null, detail: latest.error })
      : isNewer(latest.version, manifest.version)
        ? await upgradeTo(latest.version, { env, paths, manifest, previous, now, log })
        : settled(previous, { now, kind: "current", from: manifest.version, to: latest.version });
  } catch (error) {
    // An unexpected error (a file system failure around the stage) is recorded like a lookup failure: no notice, and
    // a backoff so the next sessions do not retry it at once.
    const detail = `unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    log.push(detail);
    state = checkFailure(previous, { now, from: manifest.version, to: null, detail });
  }
  if (state.uninstalled) return { ran: false, reason: "not-installed" };
  try {
    writeJsonAtomic(paths.state, state);
    return { ran: true, result: state.lastResult };
  } finally {
    writeLog(paths.log, now, log);
  }
}

async function upgradeTo(target, { env, paths, manifest, previous, now, log }) {
  const from = manifest.version;
  await rm(paths.stage, { recursive: true, force: true });
  await assertNoSymlinkComponents(paths.home, paths.stage);
  await mkdir(paths.stage, { recursive: true });
  // npm installs into the nearest package.json; without this one it would climb to POTA_HOME or the home directory.
  await writeFile(join(paths.stage, "package.json"), `${JSON.stringify({ name: "pota-auto-upgrade-stage", private: true }, null, 2)}\n`);
  try {
    // The stage is the cwd, so no path is passed to npm (npm.cmd splits paths with spaces on Windows).
    const install = runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", `${UPDATE_PACKAGE_NAME}@${target}`], {
      cwd: paths.stage, env, timeout: INSTALL_TIMEOUT_MS,
    });
    log.push(logEntry("npm install", install));
    if (install.error || install.status !== 0) {
      return checkFailure(previous, { now, from, to: target, detail: `npm install failed: ${lastLine(install)}` });
    }
    const problem = await verifyStagedPackage(paths.stage, target);
    if (problem) return upgradeFailure(previous, { paths, now, from, to: target, detail: `verification failed: ${problem}` });
    const lifecycle = spawnSync(process.execPath, [join(paths.stage, "node_modules", ...UPDATE_PACKAGE_NAME.split("/"), "scripts", "pota-lifecycle.mjs"), "upgrade", "--auto"], {
      cwd: paths.root, env, encoding: "utf8", timeout: LIFECYCLE_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    });
    log.push(logEntry("pota-lifecycle upgrade --auto", lifecycle));
    // An uninstall finished while the package was staged (`upgrade --auto` then installs nothing): there is nothing
    // left to upgrade or to report.
    if (readJsonFile(paths.manifest).status === "missing") return { uninstalled: true };
    const installed = readInstallManifest(paths);
    // The manifest decides: the files moved to the target version or they did not.
    if (installed?.version !== target) {
      return upgradeFailure(previous, { paths, now, from, to: target, detail: `upgrade exited ${lifecycle.status ?? lifecycle.error?.code}: ${lastLine(lifecycle)}` });
    }
    if (lifecycle.status === 0 || lifecycle.status === AUTO_UPGRADE_EXIT.manual) {
      const kind = lifecycle.status === 0 ? "updated" : "manual";
      writeJsonAtomic(paths.notice, noticeRecord(kind, from, target, now.toISOString()));
      return settled(previous, { now, kind, from, to: target, detail: kind === "manual" ? lastLine(lifecycle) : null });
    }
    // The files moved but the run failed after its commit: reported once like a failed upgrade. The next check finds
    // the target version installed, so the upgrade is not retried.
    return upgradeFailure(previous, { paths, now, from, to: target, detail: `upgrade exited ${lifecycle.status ?? lifecycle.error?.code} after its commit: ${lastLine(lifecycle)}` });
  } finally {
    // A stage that cannot be removed (a held file, a changed permission) must not hide the result; the next run
    // removes it before staging again.
    try { await rm(paths.stage, { recursive: true, force: true }); } catch (error) { log.push(`stage removal failed: ${error.message}`); }
  }
}

function settled(previous, { now, kind, from, to, detail = null }) {
  return {
    ...previous, lastCheckedAt: now.toISOString(), latestSeen: to, consecutiveFailures: 0, nextAttemptAt: null,
    failedVersion: null, lastResult: result(kind, now, from, to, detail),
  };
}

// Lookup and install failures (offline, no npm, a registry error) back off 1h, 2h, … up to 24h without a notice.
function checkFailure(previous, { now, from, to, detail }) {
  const failures = previous.lastResult?.kind === "check-failed" ? failureCount(previous) + 1 : 1;
  return {
    ...previous, latestSeen: to ?? previous.latestSeen, consecutiveFailures: failures,
    nextAttemptAt: new Date(now.getTime() + Math.min(HOUR_MS * 2 ** (failures - 1), DAY_MS)).toISOString(),
    lastResult: result("check-failed", now, from, to, detail),
  };
}

// A version that failed verification or the upgrade backs off 24h, 48h, … up to 7 days, with one notice per version.
// A newer release starts over.
function upgradeFailure(previous, { paths, now, from, to, detail }) {
  const sameVersion = previous.failedVersion === to;
  const failures = sameVersion && previous.lastResult?.kind === "failed" ? failureCount(previous) + 1 : 1;
  if (!sameVersion) writeJsonAtomic(paths.notice, noticeRecord("failed", from, to, now.toISOString()));
  return {
    ...previous, lastCheckedAt: now.toISOString(), latestSeen: to, consecutiveFailures: failures, failedVersion: to,
    nextAttemptAt: new Date(now.getTime() + Math.min(DAY_MS * 2 ** (failures - 1), 7 * DAY_MS)).toISOString(),
    lastResult: result("failed", now, from, to, detail),
  };
}

function failureCount(state) {
  return Number.isSafeInteger(state.consecutiveFailures) && state.consecutiveFailures > 0 ? state.consecutiveFailures : 0;
}

function result(kind, now, from, to, detail) {
  return { kind, at: now.toISOString(), from, to, detail };
}

// Only an exact x.y.z release of at most 32 characters is accepted; npm 12 may wrap it in an object.
function registryVersion(lookup) {
  if (lookup.error || lookup.status !== 0) return { error: `npm view failed: ${lastLine(lookup)}` };
  let value;
  try { value = JSON.parse(lookup.stdout); } catch { return { error: "npm view did not return JSON" }; }
  if (value && typeof value === "object" && !Array.isArray(value)) value = value.version;
  if (typeof value !== "string" || value.length > REGISTRY_VERSION_MAX_LENGTH || !REGISTRY_VERSION.test(value)) {
    return { error: `npm view returned an invalid version: ${String(JSON.stringify(value)).slice(0, 80)}` };
  }
  return { version: value };
}

// Strictly newer by major.minor.patch, or the same core release of an installed prerelease. Never a downgrade.
function isNewer(latest, installed) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(installed);
  if (!match) return false;
  const next = latest.split(".").map(BigInt);
  const current = match.slice(1, 4).map(BigInt);
  for (let index = 0; index < 3; index += 1) if (next[index] !== current[index]) return next[index] > current[index];
  return Boolean(match[4]);
}

// The staged package must be exactly @comento/pota-harness@<target> with no dependencies, symlinks, or special files.
async function verifyStagedPackage(stage, target) {
  const modules = join(stage, "node_modules");
  // A scoped name occupies two levels (node_modules/@scope/name); each level may hold only its own segment.
  const segments = UPDATE_PACKAGE_NAME.split("/");
  const packageRoot = join(modules, ...segments);
  try {
    let level = modules;
    for (const segment of segments) {
      if (!(await lstat(level)).isDirectory()) return `not a directory: ${relative(stage, level)}`;
      for (const entry of (await readdir(level)).sort()) {
        const hidden = level === modules && entry.startsWith(".");
        if (!hidden && entry !== segment) return `unexpected package in node_modules: ${relative(modules, join(level, entry))}`;
      }
      level = join(level, segment);
    }
    const special = await firstSpecialEntry(packageRoot);
    if (special) return `not a regular file or directory: ${relative(stage, special)}`;
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (manifest?.name !== UPDATE_PACKAGE_NAME || manifest.version !== target) {
      return `package.json names ${manifest?.name}@${manifest?.version}, expected ${UPDATE_PACKAGE_NAME}@${target}`;
    }
    const plugin = JSON.parse(await readFile(join(packageRoot, ".codex-plugin", "plugin.json"), "utf8"));
    if (plugin?.name !== "pota" || plugin.version !== target) {
      return `.codex-plugin/plugin.json names ${plugin?.name}@${plugin?.version}, expected pota@${target}`;
    }
    if (!(await lstat(join(packageRoot, "scripts", "pota-lifecycle.mjs"))).isFile()) return "scripts/pota-lifecycle.mjs is not a regular file";
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function firstSpecialEntry(path) {
  const info = await lstat(path);
  if (info.isFile()) return null;
  if (!info.isDirectory()) return path;
  for (const entry of (await readdir(path)).sort()) {
    const found = await firstSpecialEntry(join(path, entry));
    if (found) return found;
  }
  return null;
}

// POTA_NPM_CLI follows the POTA_CLAUDE_CLI rule: a .mjs/.js stand-in runs through this Node binary, anything else
// is run directly (through the shell on Windows for npm.cmd).
function runNpm(args, { cwd, env, timeout }) {
  const cli = env.POTA_NPM_CLI ?? "npm";
  const options = { cwd, env, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
  if (/\.m?js$/.test(cli)) return spawnSync(process.execPath, [cli, ...args], options);
  return spawnSync(cli, args, { ...options, shell: process.platform === "win32" });
}

function logEntry(label, run) {
  return `$ ${label} (exit ${run.status ?? run.error?.code ?? run.signal ?? "unknown"})\n${run.stdout ?? ""}${run.stderr ?? ""}`;
}

// The last run's npm and lifecycle output, keeping the end when it exceeds 64 KiB.
function writeLog(path, now, entries) {
  try {
    let text = `${now.toISOString()}\n${entries.join("\n")}\n`;
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length > LOG_LIMIT_BYTES) text = bytes.subarray(bytes.length - LOG_LIMIT_BYTES).toString("utf8");
    while (Buffer.byteLength(text, "utf8") > LOG_LIMIT_BYTES) text = text.slice(1);
    writeFileAtomic(path, text);
  } catch {
    // The log is diagnostic only.
  }
}

function lastLine(run) {
  const text = [run.stderr, run.stdout].map((value) => String(value ?? "").trim()).find(Boolean) ?? run.error?.message ?? `exit ${run.status}`;
  return text.split("\n").filter((line) => line.trim()).at(-1)?.trim().slice(0, 300) ?? "";
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}
