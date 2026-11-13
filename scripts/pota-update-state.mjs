import { spawn as spawnProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { lstat, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { potaHome, installManifestPath, installRoot } from "./pota-paths.mjs";

// Auto-upgrade state shared by the SessionStart hook and the detached runner. The hook only reads small files here,
// claims a pending notice, and spawns the runner; it never touches the network, a lock, or the installation.
export const UPDATE_PACKAGE_NAME = "@comento/pota-harness";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const NOTICE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const NOTICE_KINDS = ["updated", "failed", "manual"];
// Exit codes of `pota-lifecycle.mjs upgrade --auto` besides 0 (done) and 1 (anything else). They are a contract
// between versions: the runner is the installed version and the lifecycle it starts is the new one.
// `manual`: the files are committed and only the Claude Code step (cache refresh, registration, a missing claude CLI)
// is left to the user.
export const AUTO_UPGRADE_EXIT = Object.freeze({ manual: 3 });
const UPDATE_SCHEMA_VERSION = 1;
const SMALL_FILE_LIMIT = 64 * 1024;
const MANIFEST_FILE_LIMIT = 1024 * 1024;
const OFF_VALUES = new Set(["0", "false", "off", "no"]);
const INSTALLED_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function updatePaths(env = process.env) {
  const home = potaHome(env);
  const root = join(home, "update");
  return {
    home,
    root,
    config: join(home, "config.json"),
    state: join(root, "state.json"),
    notice: join(root, "notice.json"),
    log: join(root, "last-run.log"),
    lock: join(root, "update.lock"),
    stage: join(root, "stage"),
    manifest: installManifestPath(env),
    runtimeParent: join(installRoot(env), "runtime"),
  };
}

// A regular file at most `limit` bytes, parsed as JSON. Symlinks, directories, oversized and malformed files are
// "invalid"; only a missing file is "missing".
export function readJsonFile(path, limit = SMALL_FILE_LIMIT) {
  let info;
  try { info = lstatSync(path); } catch (error) { return { status: error?.code === "ENOENT" ? "missing" : "invalid" }; }
  if (!info.isFile() || info.size > limit) return { status: "invalid" };
  try { return { status: "ok", value: JSON.parse(readFileSync(path, "utf8")) }; } catch { return { status: "invalid" }; }
}

export function writeJsonAtomic(path, value) {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

// On by default. POTA_AUTO_UPGRADE=0|false|off|no or config.json `autoUpgrade: false` turns it off, and so does a
// config.json that cannot be read or has the wrong shape: an unclear setting never starts an install.
export function autoUpgradeSetting(env = process.env, paths = updatePaths(env)) {
  const raw = env.POTA_AUTO_UPGRADE;
  if (typeof raw === "string" && OFF_VALUES.has(raw.trim().toLowerCase())) return { enabled: false, source: "env" };
  const config = readJsonFile(paths.config);
  if (config.status === "missing") return { enabled: true, source: "default" };
  if (config.status !== "ok" || !isPlainObject(config.value)) return { enabled: false, source: "invalid-config" };
  const value = config.value.autoUpgrade;
  if (value === undefined) return { enabled: true, source: "default" };
  if (typeof value !== "boolean") return { enabled: false, source: "invalid-config" };
  return { enabled: value, source: "config" };
}

export function readInstallManifest(paths) {
  const read = readJsonFile(paths.manifest, MANIFEST_FILE_LIMIT);
  const manifest = read.status === "ok" ? read.value : null;
  if (manifest?.schemaVersion !== 2 || manifest.plugin !== "pota" || typeof manifest.version !== "string"
      || !INSTALLED_VERSION.test(manifest.version) || !["checkout", "package"].includes(manifest.origin)) return null;
  return { version: manifest.version, installedAt: manifest.installedAt, origin: manifest.origin };
}

export function readUpdateState(paths) {
  const read = readJsonFile(paths.state);
  return read.status === "ok" && isPlainObject(read.value) && read.value.schemaVersion === UPDATE_SCHEMA_VERSION ? read.value : null;
}

export function readPendingNotice(paths) {
  const read = readJsonFile(paths.notice);
  return read.status === "ok" && validNotice(read.value) ? read.value : null;
}

export function emptyUpdateState() {
  return {
    schemaVersion: UPDATE_SCHEMA_VERSION, lastCheckedAt: null, latestSeen: null, consecutiveFailures: 0,
    nextAttemptAt: null, failedVersion: null, lastResult: null,
  };
}

export function noticeRecord(kind, from, to, at) {
  return { schemaVersion: UPDATE_SCHEMA_VERSION, kind, from, to, at };
}

// The hook runs from an installed runtime only when its own .pota-runtime.json points at <install>/runtime/<version>.
// A source checkout has no locator there, so it reads and writes nothing else.
export function runningInstall(pluginRoot, paths) {
  if (typeof pluginRoot !== "string") return null;
  const locator = readJsonFile(join(pluginRoot, ".pota-runtime.json"));
  if (locator.status !== "ok" || locator.value?.plugin !== "pota" || typeof locator.value.pluginRoot !== "string") return null;
  const version = childName(paths.runtimeParent, locator.value.pluginRoot);
  if (!version || !INSTALLED_VERSION.test(version)) return null;
  return { runtimeRoot: join(paths.runtimeParent, version), version };
}

// Due once a day after the later of the last check and the install; a recorded backoff can only push it further out.
export function checkDue({ state, manifest, now }) {
  const time = now.getTime();
  const next = Date.parse(state?.nextAttemptAt ?? "");
  if (Number.isFinite(next) && time < next) return false;
  const since = Math.max(...[state?.lastCheckedAt, manifest?.installedAt].map((value) => Date.parse(value ?? "")).filter(Number.isFinite));
  return !Number.isFinite(since) || time - since >= CHECK_INTERVAL_MS;
}

// SessionStart: claim at most one pending notice, then start the runner when a check is due. Returns the claimed
// notice or null. Callers swallow errors so the capsule and exit code never depend on this step.
export function sessionStartUpdate({ env = process.env, now = new Date(), spawn = spawnProcess, pluginRoot } = {}) {
  const paths = updatePaths(env);
  const running = runningInstall(pluginRoot, paths);
  if (!running) return null;
  let notice = null;
  try { notice = claimNotice(paths, { runningVersion: running.version, now }); } catch { notice = null; }
  try { startRunnerWhenDue({ env, now, spawn, paths, running }); } catch { /* the next session tries again */ }
  return notice;
}

function startRunnerWhenDue({ env, now, spawn, paths, running }) {
  if (!autoUpgradeSetting(env, paths).enabled) return;
  const manifest = readInstallManifest(paths);
  // Only the canonical runtime of the installed version starts a runner; a retained runtime or a checkout install never does.
  if (!manifest || manifest.origin !== "package" || manifest.version !== running.version) return;
  if (!checkDue({ state: readUpdateState(paths), manifest, now })) return;
  // stdio "ignore" keeps the hook's stdout pipe closed so the host does not wait for the runner; the error listener
  // keeps a failed spawn from becoming an uncaught exception in the hook.
  const child = spawn(process.execPath, [join(running.runtimeRoot, "scripts", "pota-auto-upgrade.mjs"), "run"], {
    cwd: paths.home, env, detached: true, stdio: "ignore", windowsHide: true,
  });
  child?.on?.("error", () => {});
  child?.unref?.();
}

// `updated` is shown only by a session that runs the new version; `failed` and `manual` by any installed version.
// The first session to rename the file shows it; notices older than 14 days are dropped silently.
export function claimNotice(paths, { runningVersion, now = new Date() }) {
  const read = readJsonFile(paths.notice);
  if (read.status === "missing") return null;
  if (read.status !== "ok" || !validNotice(read.value) || now.getTime() - Date.parse(read.value.at) > NOTICE_MAX_AGE_MS) {
    rmSync(paths.notice, { force: true });
    return null;
  }
  if (!noticeShownBy(read.value, runningVersion)) return null;
  const claimed = `${paths.notice}.${randomUUID()}.claimed`;
  try { renameSync(paths.notice, claimed); } catch { return null; }
  try {
    const value = readJsonFile(claimed).value;
    if (validNotice(value) && noticeShownBy(value, runningVersion)) return value;
    // A runner replaced the notice between the read and the rename; put the newer one back for its own session.
    try { lstatSync(paths.notice); } catch { renameSync(claimed, paths.notice); }
    return null;
  } finally {
    rmSync(claimed, { force: true });
  }
}

function noticeShownBy(notice, runningVersion) {
  return notice.kind !== "updated" || notice.to === runningVersion;
}

function validNotice(value) {
  return isPlainObject(value) && value.schemaVersion === UPDATE_SCHEMA_VERSION && NOTICE_KINDS.includes(value.kind)
    && typeof value.to === "string" && typeof value.from === "string" && Number.isFinite(Date.parse(value.at ?? ""));
}

// Called by uninstall after the lifecycle lock is released: the known update files and the runner's stage go, and the
// directory is removed when empty. config.json and projects/ stay. A running runner (its lock present) keeps its stage.
export async function removeUpdateState(env = process.env) {
  const paths = updatePaths(env);
  try {
    if (!(await lstat(paths.root)).isDirectory()) return;
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const path of [paths.state, paths.notice, paths.log]) await rm(path, { force: true });
  let locked = true;
  try { await lstat(paths.lock); } catch (error) { if (error?.code === "ENOENT") locked = false; else throw error; }
  if (!locked) await rm(paths.stage, { recursive: true, force: true });
  try { await rmdir(paths.root); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error; }
}

function childName(parent, child) {
  const direct = singleSegment(relative(resolve(parent), resolve(child)));
  if (direct) return direct;
  try { return singleSegment(relative(realpathSync(parent), realpathSync(child))); } catch { return null; }
}

function singleSegment(relation) {
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation) || relation.includes(sep)) return null;
  return relation;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
