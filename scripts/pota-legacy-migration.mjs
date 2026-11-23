#!/usr/bin/env node
import { spawn as spawnProcess, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chmod, lstat, open, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLifecycleLock } from "./pota-lifecycle-lock.mjs";
import { installManifestPath, installRoot, potaHome, resolvePluginRoot } from "./pota-paths.mjs";
import { assertNoSymlinkComponents } from "./pota-safe-fs.mjs";

// Removes the npm (1.x) installation that `pota install` recorded in <POTA_HOME>/install/lifecycle.json, one host at a
// time. The ownership rules (schema 2 shape, target allowlist, digests, Codex config sections) are ported from the
// 1.4.0 lifecycle so this file never imports it. Only targets whose digest still matches the manifest are removed.
export const LEGACY_HOSTS = ["codex", "claude", "antigravity"];
export const MIGRATION_USAGE = "Usage: pota migrate run|status [--host claude|codex|antigravity] [--all] [--dry-run] [--json]";
const HOST_LABELS = { codex: "Codex", claude: "Claude Code", antigravity: "Antigravity" };
const MIGRATION_SCHEMA_VERSION = 1;
const MANIFEST_LIMIT = 1024 * 1024;
const SMALL_FILE_LIMIT = 256 * 1024;
const RERUN_AFTER_MS = 10 * 60 * 1000;
const BLOCKED_RETRY_MS = 24 * 60 * 60 * 1000;
const BLOCKED_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_KEEP_MS = 10 * 60 * 1000;
const RUN_LIMIT_MS = 120_000;
const CLAUDE_CALL_TIMEOUT_MS = 30_000;
const OFF_VALUES = new Set(["0", "false", "off", "no"]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MANIFEST_KEYS = ["schemaVersion", "plugin", "version", "transactionId", "installedAt", "origin", "hosts", "targets", "retained"];
const TARGET_KEYS = ["id", "phase", "path", "type", "installedDigest", "previous"];
const RETAINED_KEYS = ["id", "version", "path", "installedDigest", "retiredAt"];
const PHASES = ["core", "codex", "claude", "antigravity", "config", "cleanup"];
const RETAINED_IDS = ["runtime", "codex-runtime"];
const RETAINED_LIMIT = 3;
const COMMAND_NAMES = ["install", "upgrade", "doctor", "uninstall", "memory", "plan", "work", "review", "toolcheck"];
const AGENT_NAMES = ["explorer", "worker"];
const SKILL_NAMES = ["pota-memory", "pota-plan", "pota-work", "pota-review"];
const UPDATE_FILES = ["state.json", "notice.json", "last-run.log", "plugin-notice.json"];
const PATH_ENV = ["HOME", "USERPROFILE", "POTA_HOME", "CODEX_HOME", "CODEX_CONFIG_PATH", "CLAUDE_HOME", "CLAUDE_CONFIG_DIR", "ANTIGRAVITY_HOME", "ANTIGRAVITY_CLI_HOME"];
const CLAUDE_MANUAL = ["claude plugin uninstall pota@pota --scope user", "claude plugin marketplace remove pota"];
const LOCK_TIMEOUT_MESSAGE = "Timed out waiting for Pota lifecycle lock";
const TOML_KEY = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
const TOML_DOTTED_KEY = String.raw`\s*${TOML_KEY}(?:\s*\.\s*${TOML_KEY})*\s*`;
const TOML_HEADER = new RegExp(String.raw`^\s*(?:\[\[(${TOML_DOTTED_KEY})\]\]|\[(${TOML_DOTTED_KEY})\])\s*(?:#.*)?$`);
// Deliberately looser than the exact Pota section names: a line it matches must be a recognised Pota header.
const POTA_HEADER_HINT = /^\s*\[\s*(?:marketplaces\s*\.\s*["']?pota["']?\s*\]|plugins\s*\.\s*["']pota@pota["']\s*\]|hooks\s*\.\s*state\s*\.\s*["']pota@pota:)/;

const MESSAGES = {
  en: {
    removing: () => "Pota: removing the legacy npm install in the background. Legacy Pota hooks and commands stop working in this session; restart it when convenient.",
    removed: ({ version, kept, hosts, doctor }) => {
      const parts = [];
      if (kept > 0) parts.push(`Kept ${kept} modified items`);
      if (hosts.length > 0) parts.push(`other hosts need the plugin: ${hosts.join(", ")}`);
      const clause = parts.length > 0 ? ` ${capitalize(parts.join("; "))}.` : "";
      return `Pota: removed the legacy npm install (${version}).${clause} Details: ${doctor}`;
    },
    blocked: ({ reason, doctor }) => `Pota: could not remove the legacy npm install (${reason}). Run npx @comento/pota-harness@1.5.0 uninstall, then restart. Details: ${doctor}`,
    symlinked: ({ doctor }) => `Pota: left this host's legacy npm install untouched (a symlinked directory). Remove what doctor lists by hand, then restart. Details: ${doctor}`,
  },
  ko: {
    removing: () => "Pota: 기존 npm 설치본을 백그라운드에서 제거하는 중입니다. 이 세션에서는 기존 Pota hook과 명령이 더 이상 동작하지 않으니 편할 때 세션을 다시 시작하세요.",
    removed: ({ version, kept, hosts, doctor }) => {
      const parts = [];
      if (kept > 0) parts.push(`수정된 항목 ${kept}개는 남겼습니다.`);
      if (hosts.length > 0) parts.push(`다른 호스트에는 플러그인 설치가 필요합니다: ${hosts.join(", ")}.`);
      const clause = parts.length > 0 ? ` ${parts.join(" ")}` : "";
      return `Pota: 기존 npm 설치본(${version})을 제거했습니다.${clause} 자세히: ${doctor}`;
    },
    blocked: ({ reason, doctor }) => `Pota: 기존 npm 설치본을 제거하지 못했습니다(${reason}). npx @comento/pota-harness@1.5.0 uninstall을 실행한 뒤 다시 시작하세요. 자세히: ${doctor}`,
    symlinked: ({ doctor }) => `Pota: 경로의 디렉터리가 symlink라서 이 호스트의 기존 npm 설치본을 아무것도 지우지 않고 남겼습니다. doctor가 보여 주는 항목을 직접 정리한 뒤 다시 시작하세요. 자세히: ${doctor}`,
  },
};

if (isCliEntry()) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`Pota migrate error: ${error.message}`);
    process.exitCode = error.usage ? 2 : 1;
  }
}

// Every path the 1.4.0 installer derived from the environment, resolved the same way it did.
export function legacyLayout(env = process.env) {
  const homeRoot = env.HOME ?? env.USERPROFILE ?? homedir() ?? ".";
  const home = potaHome(env);
  const install = installRoot(env);
  const codexHome = resolve(env.CODEX_HOME ?? join(homeRoot, ".codex"));
  const codexMarketplaceRoot = join(install, "codex");
  const codexCacheRoot = join(codexHome, "plugins", "cache", "pota");
  const migrationRoot = join(home, "migration");
  return {
    potaHome: home,
    installRoot: install,
    manifestPath: installManifestPath(env),
    lockPath: join(install, "lifecycle.lock"),
    transactionPath: join(install, "transaction.json"),
    transactionsRoot: join(install, "transactions"),
    runtimeParent: join(install, "runtime"),
    codexMarketplaceRoot,
    codexSourceRoot: join(codexMarketplaceRoot, "plugins", "pota"),
    marketplaceJsonPath: join(codexMarketplaceRoot, ".agents", "plugins", "marketplace.json"),
    claudeMarketplaceRoot: join(install, "claude"),
    codexHome,
    codexCacheRoot,
    codexRuntimeParent: join(codexCacheRoot, "pota"),
    configPath: resolve(env.CODEX_CONFIG_PATH ?? join(codexHome, "config.toml")),
    claudeHome: resolve(env.CLAUDE_HOME ?? join(homeRoot, ".claude")),
    claudeHomeOverridden: typeof env.CLAUDE_HOME === "string" && env.CLAUDE_HOME.length > 0,
    antigravityHome: resolve(env.ANTIGRAVITY_HOME ?? join(homeRoot, ".gemini", "config")),
    antigravityCliHome: resolve(env.ANTIGRAVITY_CLI_HOME ?? join(homeRoot, ".gemini", "antigravity-cli")),
    updateRoot: join(home, "update"),
    migrationRoot,
    reportPath: join(migrationRoot, "report.json"),
    statePath: join(migrationRoot, "state.json"),
  };
}

// SessionStart detection: synchronous, a few small reads, never throws. Returns the notice to show (or null) and
// whether a detached runner was started.
export function sessionStartMigration({
  env = process.env, now = new Date(), spawn = spawnProcess, pluginRoot = resolvePluginRoot(import.meta.url), host,
} = {}) {
  try {
    const raw = env.POTA_LEGACY_MIGRATION;
    if (typeof raw === "string" && OFF_VALUES.has(raw.trim().toLowerCase())) return { notice: null, spawned: false };
    if (!LEGACY_HOSTS.includes(host)) return { notice: null, spawned: false };
    const layout = legacyLayout(env);
    const doctor = doctorCommand(pluginRoot);
    const report = readReportsSync(layout)[host] ?? null;
    let manifestInfo = null;
    try { manifestInfo = lstatSync(layout.manifestPath); } catch { manifestInfo = null; }
    let spawned = false;
    if (manifestInfo) {
      const key = runKey(manifestInfo, host, env);
      const states = readStatesSync(layout);
      const decision = runDecision(states[host], key, report?.key === key ? report : null, now);
      if (decision.run) {
        const child = spawn(process.execPath, [join(pluginRoot, "scripts", "pota-legacy-migration.mjs"), "run", "--host", host], {
          detached: true, stdio: "ignore", windowsHide: true, env,
        });
        // A failed start is reported asynchronously; without a listener it would crash the hook process.
        child.on("error", () => {});
        child.unref();
        spawned = true;
        writeJsonSync(layout, layout.statePath, {
          schemaVersion: MIGRATION_SCHEMA_VERSION,
          hosts: { ...states, [host]: { key, spawnedAt: now.toISOString() } },
        });
        if (decision.first) return { notice: { kind: "removing", doctor }, spawned };
      }
    }
    return { notice: claimReportNotice(layout, host, report, now, doctor, Boolean(manifestInfo)), spawned };
  } catch {
    return { notice: null, spawned: false };
  }
}

export function migrationNoticeLine({ ko = false, notice } = {}) {
  if (!notice || !MESSAGES.en[notice.kind]) return "";
  return (ko ? MESSAGES.ko : MESSAGES.en)[notice.kind](notice);
}

// Read-only: the manifest's identity and validity, without digests. Used by `pota doctor`.
export async function inspectLegacyManifest({ env = process.env } = {}) {
  const layout = legacyLayout(env);
  const read = await readLegacyManifest(layout);
  if (read.status === "none") return { status: "none" };
  if (read.status === "blocked") return { status: "blocked", reason: read.reason, version: read.version ?? null };
  if (await pathExists(layout.transactionPath)) return { status: "blocked", reason: "transaction-pending", version: read.manifest.version };
  return { status: "present", version: read.manifest.version, hosts: read.manifest.hosts };
}

export function readMigrationReports({ env = process.env } = {}) {
  return readReportsSync(legacyLayout(env));
}

// Read-only plan: what a run for `host` ("all" or one host id) would do. Writes nothing and runs no host CLI.
export async function planLegacyRemoval({ env = process.env, host = "all" } = {}) {
  const hosts = requestedHosts(host);
  const layout = legacyLayout(env);
  const read = await readLegacyManifest(layout);
  if (read.status === "none") return { status: "none", requestedHosts: hosts };
  if (read.status === "blocked") return { status: "blocked", reason: read.reason, version: read.version ?? null, requestedHosts: hosts };
  const { manifest } = read;
  if (await pathExists(layout.transactionPath)) return { status: "blocked", reason: "transaction-pending", version: manifest.version, requestedHosts: hosts };
  const unregister = [];
  const targets = [];
  for (const name of hosts.filter((candidate) => manifest.hosts.includes(candidate))) {
    if (name === "claude" && manifest.targets.some((record) => record.id === "claude-plugin")) unregister.push({ host: name, action: "claude-plugin" });
    if (name === "codex" && manifest.targets.some((record) => record.id === "codex-config")) {
      unregister.push({ host: name, action: "codex-config", state: await codexConfigState(layout) });
    }
    for (const record of hostRecords(name, manifest, layout)) {
      targets.push({ host: name, id: record.id, path: record.path, type: record.type, state: await assessRecord(record, manifest.transactionId, layout) });
    }
  }
  const core = [];
  for (const record of coreRecords(manifest, layout)) {
    core.push({ id: record.id, path: record.path, type: record.type, state: await assessRecord(record, manifest.transactionId, layout) });
  }
  const otherHostsGone = await hostTargetsGone(manifest, layout, (name) => !hosts.includes(name));
  const requestedClear = targets.every((target) => target.state === "missing" || target.state === "verified" || target.state === "leftover");
  return {
    status: "ready",
    version: manifest.version,
    manifestHosts: manifest.hosts,
    requestedHosts: hosts,
    unregister,
    targets,
    core,
    coreRemovedWhenDone: otherHostsGone && requestedClear,
  };
}

// Removes this host's part of the legacy installation under the lifecycle lock and records the report. Returns
// `{ status, hosts: { <host>: report } }`; `none` (no manifest) records nothing.
export async function runLegacyRemoval({
  env = process.env, now = new Date(), host, timeLimitMs = RUN_LIMIT_MS, testHooks = {},
} = {}) {
  const hosts = requestedHosts(host);
  const layout = legacyLayout(env);
  let manifestInfo;
  try { manifestInfo = await lstat(layout.manifestPath); } catch (error) {
    if (error?.code === "ENOENT") return { status: "none", hosts: {} };
    throw error;
  }
  const context = {
    env, layout, hosts, at: now.toISOString(), deadline: Date.now() + timeLimitMs,
    keys: Object.fromEntries(hosts.map((name) => [name, runKey(manifestInfo, name, env)])),
    hook: async (step, detail) => { await testHooks.afterStep?.(step, detail); },
  };
  let outcome;
  try {
    // Reports are written inside the lock so a run that starts right after this one sees them.
    outcome = await createLifecycleLock({ lifecycleLockPath: layout.lockPath }).withLifecycleLock(async () => {
      const result = await removeUnderLock(context);
      if (result.status !== "none") result.reports = recordReports(context, result);
      return result;
    }, { timeoutMs: 0, afterRelease: async () => { if (context.changed) await pruneEmptyDirectories(layout); } });
  } catch (error) {
    if (typeof error?.message === "string" && error.message.startsWith(LOCK_TIMEOUT_MESSAGE)) {
      outcome = { status: "deferred", reason: "lock-busy", results: {} };
      outcome.reports = recordReports(context, outcome);
    } else {
      recordReports(context, { status: "deferred", reason: "error", error: error?.message ?? String(error), results: {} });
      throw error;
    }
  }
  if (outcome.status === "none") return { status: "none", hosts: {} };
  return { status: outcome.status, hosts: outcome.reports };
}

async function removeUnderLock(context) {
  const { layout, hosts, hook } = context;
  const read = await readLegacyManifest(layout);
  if (read.status === "none") return { status: "none" };
  if (read.status === "blocked") return { status: "blocked", reason: read.reason, version: read.version ?? null, results: {} };
  const { manifest } = read;
  if (await pathExists(layout.transactionPath)) return { status: "blocked", reason: "transaction-pending", version: manifest.version, results: {} };
  if (await updateRunnerActive(layout)) return { status: "deferred", reason: "update-running", version: manifest.version, results: {} };
  const results = {};
  let stopped = false;
  for (const name of hosts) {
    const result = { status: "unchanged", removed: [], modified: [], missing: 0, manual: [] };
    results[name] = result;
    if (!manifest.hosts.includes(name)) continue;
    if (stopped || Date.now() > context.deadline) {
      stopped = true;
      Object.assign(result, { status: "deferred", reason: "time-limit" });
      continue;
    }
    // A host whose target sits below a symlinked directory is left entirely alone, unregistration included, so it is
    // never half removed.
    const symlinked = await symlinkedTargets(name, manifest, layout);
    if (symlinked.length > 0) {
      Object.assign(result, { status: "blocked", reason: "symlinked-path" });
      result.manual.push(...unregisterManual(name, manifest, layout), ...symlinked.map((path) => `Remove by hand (below a symlinked directory): ${path}`));
      continue;
    }
    const unregistered = await unregisterHost(name, manifest, context);
    if (unregistered.status === "failed") {
      Object.assign(result, { status: "blocked", reason: "host-unregister-failed", error: unregistered.reason });
      result.manual.push(...unregisterManual(name, manifest, layout));
      continue;
    }
    if (unregistered.status === "changed") {
      Object.assign(result, { status: "deferred", reason: "config-changed" });
      continue;
    }
    result.unregistered = unregistered.status === "done";
    for (const record of hostRecords(name, manifest, layout)) {
      if (Date.now() > context.deadline) {
        stopped = true;
        Object.assign(result, { status: "deferred", reason: "time-limit" });
        break;
      }
      tally(result, record, await removeOwned(record, manifest.transactionId, context));
    }
    if (result.status === "unchanged" && (result.removed.length > 0 || result.unregistered)) result.status = "completed";
  }
  const shared = { removed: [], modified: [], missing: 0 };
  let legacyRemoved = false;
  if (!stopped && await hostTargetsGone(manifest, layout, () => true)) {
    for (const record of coreRecords(manifest, layout)) tally(shared, record, await removeOwned(record, manifest.transactionId, context));
    if (shared.modified.length === 0) {
      shared.removed.push(...await removeUpdateFiles(layout));
      await hook("update");
      if (await readFile(layout.manifestPath, "utf8") === read.text) {
        await unlink(layout.manifestPath);
        shared.removed.push(layout.manifestPath);
        legacyRemoved = true;
        await hook("manifest");
      }
    }
  }
  for (const result of Object.values(results)) {
    if (result.status === "blocked" || result.status === "deferred") continue;
    result.removed.push(...shared.removed);
    result.modified.push(...shared.modified);
    result.missing += shared.missing;
    if (result.status === "unchanged" && shared.removed.length > 0) result.status = "completed";
  }
  const remainingHosts = [];
  for (const name of manifest.hosts) if (!(await hostTargetsGone(manifest, layout, (candidate) => candidate === name))) remainingHosts.push(name);
  const statuses = Object.values(results).map((result) => result.status);
  const status = statuses.includes("blocked") ? "blocked"
    : statuses.includes("deferred") ? "deferred"
      : statuses.includes("completed") ? "completed" : "unchanged";
  context.changed = statuses.includes("completed") || shared.removed.length > 0;
  return { status, version: manifest.version, results, remainingHosts, legacyRemoved };
}

function unregisterManual(host, manifest, layout) {
  if (host === "claude" && manifest.targets.some((record) => record.id === "claude-plugin")) return CLAUDE_MANUAL;
  if (host === "codex" && manifest.targets.some((record) => record.id === "codex-config")) {
    return [`Remove the [marketplaces.pota], [plugins."pota@pota"], and [hooks.state."pota@pota:…"] sections from ${layout.configPath}`];
  }
  return [];
}

// `outcome` is "removed", "modified", "missing", or `{ kept: path }` for an interrupted removal copy that was kept.
function tally(result, record, outcome) {
  if (isPlainObject(outcome)) result.modified.push(outcome.kept);
  else if (outcome === "removed") result.removed.push(record.path);
  else if (outcome === "modified") result.modified.push(record.path);
  else result.missing += 1;
}

// An `unchanged` run, a lock-busy deferral, or an unexpected error never replaces a completed or blocked report of the
// same manifest, host, and environment, so a concurrent runner cannot erase the notice of the run that did the work.
function recordReports(context, outcome) {
  const current = readReportsSync(context.layout);
  const reports = {};
  const persisted = {};
  for (const name of context.hosts) {
    const result = outcome.results?.[name] ?? { status: outcome.status, reason: outcome.reason, removed: [], modified: [], missing: 0, manual: [] };
    reports[name] = {
      id: randomUUID(),
      host: name,
      key: context.keys[name],
      status: result.status,
      reason: result.reason ?? outcome.reason ?? null,
      ...(result.error || outcome.error ? { error: result.error ?? outcome.error } : {}),
      version: outcome.version ?? null,
      at: context.at,
      removed: result.removed ?? [],
      modified: result.modified ?? [],
      missing: result.missing ?? 0,
      manual: result.manual ?? [],
      remainingHosts: outcome.remainingHosts ?? [],
      legacyRemoved: Boolean(outcome.legacyRemoved),
    };
    const weak = reports[name].status === "unchanged" || (reports[name].status === "deferred" && ["lock-busy", "error"].includes(reports[name].reason));
    const kept = current[name]?.key === context.keys[name] && ["completed", "blocked"].includes(current[name]?.status);
    if (!(weak && kept)) persisted[name] = reports[name];
  }
  if (Object.keys(persisted).length > 0) {
    writeJsonSync(context.layout, context.layout.reportPath, { schemaVersion: MIGRATION_SCHEMA_VERSION, hosts: { ...current, ...persisted } });
  }
  return reports;
}

function requestedHosts(host) {
  if (host === "all") return [...LEGACY_HOSTS];
  if (LEGACY_HOSTS.includes(host)) return [host];
  const error = new Error(`Invalid host: ${host ?? "missing"} (use ${LEGACY_HOSTS.join("|")} or --all)`);
  error.usage = true;
  throw error;
}

// ---- manifest ----

async function readLegacyManifest(layout) {
  try {
    await assertNoSymlinkComponents(layout.potaHome, layout.manifestPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "none" };
    if (error?.code === "POTA_SYMLINK") return { status: "blocked", reason: "manifest-invalid" };
    throw error;
  }
  let info;
  try { info = await lstat(layout.manifestPath); } catch (error) {
    if (error?.code === "ENOENT") return { status: "none" };
    throw error;
  }
  if (!info.isFile() || info.size > MANIFEST_LIMIT) return { status: "blocked", reason: "manifest-invalid" };
  let text;
  try { text = await readRegularFile(layout.manifestPath); } catch { return { status: "blocked", reason: "manifest-invalid" }; }
  let manifest;
  try { manifest = JSON.parse(text); } catch { return { status: "blocked", reason: "manifest-invalid" }; }
  const reason = validateManifest(manifest, layout);
  const version = typeof manifest?.version === "string" && VERSION_PATTERN.test(manifest.version) ? manifest.version : null;
  if (reason) return { status: "blocked", reason, version };
  return { status: "ok", manifest, text };
}

// The schema 2 ownership shape of the 1.4.0 lifecycle. Unlike the installer, an incomplete target set is accepted so a
// 1.3.x manifest or an interrupted removal can still be finished.
function validateManifest(manifest, layout) {
  if (!isPlainObject(manifest)) return "manifest-invalid";
  if (manifest.schemaVersion !== 2) return Number.isInteger(manifest.schemaVersion) ? "manifest-unsupported-schema" : "manifest-invalid";
  if (!sameKeys(manifest, MANIFEST_KEYS) || manifest.plugin !== "pota"
      || !isVersion(manifest.version)
      || typeof manifest.transactionId !== "string" || !UUID_V4.test(manifest.transactionId)
      || !isDate(manifest.installedAt) || !["checkout", "package"].includes(manifest.origin)
      || !isHostSelection(manifest.hosts) || !Array.isArray(manifest.targets) || !Array.isArray(manifest.retained)) {
    return "manifest-invalid";
  }
  const ids = new Set();
  const paths = new Set();
  for (const record of manifest.targets) {
    if (!isPlainObject(record) || !sameKeys(record, TARGET_KEYS)
        || typeof record.id !== "string" || record.id.length === 0 || ids.has(record.id)
        || typeof record.path !== "string" || record.path.length === 0 || paths.has(record.path)
        || !PHASES.includes(record.phase) || !["file", "tree", "config"].includes(record.type)
        || !isDigest(record.installedDigest) || record.previous !== null) {
      return "manifest-invalid";
    }
    const expected = expectedTarget(record.id, manifest.version, layout);
    if (!expected || expected.path !== record.path || expected.phase !== record.phase || expected.type !== record.type) return "target-outside-allowlist";
    const owner = hostOfTarget(record.id);
    if (owner !== "core" && !manifest.hosts.includes(owner)) return "manifest-invalid";
    ids.add(record.id);
    paths.add(record.path);
  }
  const retainedKeys = new Set();
  for (const entry of manifest.retained) {
    if (!isPlainObject(entry) || !sameKeys(entry, RETAINED_KEYS) || !RETAINED_IDS.includes(entry.id)
        || !isVersion(entry.version) || entry.version === manifest.version || retainedKeys.has(`${entry.id}\0${entry.version}`)
        || !isDigest(entry.installedDigest) || !isDate(entry.retiredAt)
        || manifest.retained.filter((candidate) => candidate?.id === entry.id).length > RETAINED_LIMIT
        || (entry.id === "codex-runtime" && !manifest.hosts.includes("codex"))) {
      return "manifest-invalid";
    }
    if (entry.path !== retainedPath(entry.id, entry.version, layout)) return "target-outside-allowlist";
    retainedKeys.add(`${entry.id}\0${entry.version}`);
  }
  return null;
}

function expectedTarget(id, version, layout) {
  const exact = {
    runtime: ["core", join(layout.runtimeParent, version), "tree"],
    "codex-source": ["codex", layout.codexSourceRoot, "tree"],
    "codex-runtime": ["codex", join(layout.codexRuntimeParent, version), "tree"],
    marketplace: ["codex", layout.marketplaceJsonPath, "file"],
    "claude-runtime": ["claude", join(layout.claudeHome, "pota", "runtime.json"), "file"],
    "claude-plugin": ["claude", layout.claudeMarketplaceRoot, "tree"],
    "ide-runtime": ["antigravity", join(layout.antigravityHome, "pota", "runtime.json"), "file"],
    "cli-runtime": ["antigravity", join(layout.antigravityCliHome, "pota", "runtime.json"), "file"],
    "codex-config": ["config", layout.configPath, "config"],
  };
  for (const name of COMMAND_NAMES) {
    exact[`claude-command-${name}`] = ["claude", join(layout.claudeHome, "commands", `pota-${name}.md`), "file"];
    exact[`ide-workflow-${name}`] = ["antigravity", join(layout.antigravityHome, "workflows", `pota-${name}.md`), "file"];
    exact[`cli-workflow-${name}`] = ["antigravity", join(layout.antigravityCliHome, "workflows", `pota-${name}.md`), "file"];
  }
  for (const name of AGENT_NAMES) exact[`claude-agent-${name}`] = ["claude", join(layout.claudeHome, "agents", `pota-${name}.md`), "file"];
  for (const name of SKILL_NAMES) {
    exact[`ide-skill-${name}`] = ["antigravity", join(layout.antigravityHome, "skills", name), "tree"];
    exact[`cli-skill-${name}`] = ["antigravity", join(layout.antigravityCliHome, "skills", `${name}.md`), "file"];
  }
  if (!Object.hasOwn(exact, id)) return null;
  const [phase, path, type] = exact[id];
  return { phase, path, type };
}

function retainedPath(id, version, layout) {
  return id === "runtime" ? join(layout.runtimeParent, version) : join(layout.codexRuntimeParent, version);
}

function hostOfTarget(id) {
  if (id === "runtime") return "core";
  if (["codex-source", "marketplace", "codex-runtime", "codex-config"].includes(id)) return "codex";
  if (id.startsWith("claude-")) return "claude";
  if (/^(?:ide|cli)-/.test(id)) return "antigravity";
  return null;
}

// The file and tree records a host removal handles, in reverse manifest order (the installer's removal order). The
// Codex config section is handled by unregistration, and retained Codex runtimes belong to the Codex part.
function hostRecords(host, manifest, layout) {
  const records = manifest.targets.filter((record) => record.type !== "config" && hostOfTarget(record.id) === host).reverse();
  if (host === "codex") {
    for (const entry of manifest.retained.filter((candidate) => candidate.id === "codex-runtime")) {
      records.push({ id: `retained-codex-runtime-${entry.version}`, path: retainedPath(entry.id, entry.version, layout), type: "tree", installedDigest: entry.installedDigest });
    }
  }
  return records;
}

function coreRecords(manifest, layout) {
  const records = manifest.targets.filter((record) => hostOfTarget(record.id) === "core");
  for (const entry of manifest.retained.filter((candidate) => candidate.id === "runtime")) {
    records.push({ id: `retained-runtime-${entry.version}`, path: retainedPath(entry.id, entry.version, layout), type: "tree", installedDigest: entry.installedDigest });
  }
  return records;
}

// True when every host selected by `include` has nothing of its legacy part left: no file or tree (nor an interrupted
// removal of one) and no Pota-owned Codex config section.
async function hostTargetsGone(manifest, layout, include) {
  for (const name of manifest.hosts.filter(include)) {
    for (const record of hostRecords(name, manifest, layout)) {
      for (const path of [record.path, checkingPath(record.path, manifest.transactionId), removingPath(record.path, manifest.transactionId)]) {
        if (await pathExists(path)) return false;
      }
    }
    // A config that could not be read or parsed safely may still hold Pota sections.
    if (name === "codex" && manifest.targets.some((record) => record.id === "codex-config")
        && ["owned", "invalid"].includes(await codexConfigState(layout))) return false;
  }
  return true;
}

// ---- digests and removal ----

function checkingPath(path, transactionId) { return `${path}.pota-checking-${transactionId}`; }
function removingPath(path, transactionId) { return `${path}.pota-removing-${transactionId}`; }

async function assessRecord(record, transactionId, layout) {
  if (!(await ancestorsSafe(record.path, layout))) return await anyRecordPathExists(record, transactionId) ? "symlinked" : "missing";
  if (await pathExists(removingPath(record.path, transactionId)) || await pathExists(checkingPath(record.path, transactionId))) return "leftover";
  const digest = await targetDigest(record.path, record.type);
  if (digest === "missing") return "missing";
  return digest === record.installedDigest ? "verified" : "modified";
}

async function anyRecordPathExists(record, transactionId) {
  for (const path of [record.path, checkingPath(record.path, transactionId), removingPath(record.path, transactionId)]) {
    if (await pathExists(path)) return true;
  }
  return false;
}

// The paths of this host's records (or interrupted removals of them) that exist below a symlinked directory.
async function symlinkedTargets(host, manifest, layout) {
  const found = [];
  for (const record of hostRecords(host, manifest, layout)) {
    if (await ancestorsSafe(record.path, layout)) continue;
    for (const path of [record.path, checkingPath(record.path, manifest.transactionId), removingPath(record.path, manifest.transactionId)]) {
      if (await pathExists(path)) found.push(path);
    }
  }
  return found;
}

// A target is renamed aside first and its digest is computed again on the renamed copy, so a change made between the
// check and the rename is caught. `.pota-checking-*` is an unverified copy (restored on the next run), and
// `.pota-removing-*` a verified one (deleted on the next run once its digest still matches; otherwise kept).
async function removeOwned(record, transactionId, context) {
  const { layout, hook } = context;
  const checking = checkingPath(record.path, transactionId);
  const removing = removingPath(record.path, transactionId);
  if (!(await ancestorsSafe(record.path, layout))) return await anyRecordPathExists(record, transactionId) ? "modified" : "missing";
  let resumed = false;
  if (await pathExists(removing)) {
    if (await targetDigest(removing, record.type) !== record.installedDigest) return { kept: removing };
    await rm(removing, { recursive: true, force: true });
    resumed = true;
  }
  if (await pathExists(checking)) {
    if (await pathExists(record.path)) {
      // Something reappeared at the original name: an unchanged copy is finished like a removing one, and the new
      // entry is then judged on its own digest.
      if (await targetDigest(checking, record.type) !== record.installedDigest) return { kept: checking };
      await rename(checking, removing);
      if (await targetDigest(removing, record.type) !== record.installedDigest) return { kept: removing };
      await rm(removing, { recursive: true, force: true });
    } else await rename(checking, record.path);
  }
  const before = await targetDigest(record.path, record.type);
  if (before === "missing") return resumed ? "removed" : "missing";
  if (before !== record.installedDigest) return "modified";
  await rename(record.path, checking);
  await hook(`checking:${record.id}`, { path: checking });
  if (await targetDigest(checking, record.type) !== record.installedDigest) {
    if (!(await pathExists(record.path))) await rename(checking, record.path);
    return "modified";
  }
  await rename(checking, removing);
  await hook(`removing:${record.id}`, { path: removing });
  await rm(removing, { recursive: true, force: true });
  await hook(`removed:${record.id}`, { path: record.path });
  return "removed";
}

// Same algorithm as the 1.4.0 `targetDigest`: a file hashes its bytes; a tree hashes its sorted regular files as
// `<posix relative path>\0<bytes>\0`. Symlinks and special files never match.
async function targetDigest(path, type) {
  let info;
  try { info = await lstat(path); } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
  if (info.isSymbolicLink()) return "special";
  if (type === "file") return info.isFile() ? sha(await readFile(path)) : "special";
  if (!info.isDirectory()) return "special";
  const files = await regularFiles(path);
  if (!files) return "special";
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update("\0").update(await readFile(join(path, file))).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

async function regularFiles(root) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) return false;
      if (entry.isDirectory()) {
        if (!(await walk(path))) return false;
      } else output.push(relative(root, path).split(sep).join("/"));
    }
    return true;
  }
  if (!(await walk(root))) return null;
  return output.sort();
}

// Ancestors between the target's home root and the target must not be symlinks; otherwise the target is left alone.
async function ancestorsSafe(path, layout) {
  const roots = [layout.potaHome, layout.codexHome, layout.claudeHome, layout.antigravityHome, layout.antigravityCliHome]
    .filter((root) => isInside(root, path)).sort((left, right) => right.length - left.length);
  if (roots.length === 0) return false;
  try {
    await assertNoSymlinkComponents(roots[0], dirname(path));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    if (error?.code === "POTA_SYMLINK") return false;
    throw error;
  }
}

async function removeUpdateFiles(layout) {
  try {
    await assertNoSymlinkComponents(layout.potaHome, layout.updateRoot, { allowMissing: false });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "POTA_SYMLINK") return [];
    throw error;
  }
  if (!(await lstat(layout.updateRoot)).isDirectory()) return [];
  const removed = [];
  for (const name of UPDATE_FILES) {
    const path = join(layout.updateRoot, name);
    const info = await lstatOrNull(path);
    if (info?.isFile()) {
      await unlink(path);
      removed.push(path);
    }
  }
  const stage = join(layout.updateRoot, "stage");
  const stageInfo = await lstatOrNull(stage);
  if (stageInfo) {
    await rm(stage, { recursive: stageInfo.isDirectory(), force: true });
    removed.push(stage);
  }
  return removed;
}

// A live auto-upgrade runner holds <POTA_HOME>/update/update.lock (same record format as the lifecycle lock).
async function updateRunnerActive(layout) {
  const path = join(layout.updateRoot, "update.lock");
  const info = await lstatOrNull(path);
  if (!info) return false;
  let record = null;
  try { record = JSON.parse(await readFile(path, "utf8")); } catch { record = null; }
  const valid = isPlainObject(record) && Number.isSafeInteger(record.pid) && record.pid > 0 && typeof record.hostname === "string";
  if (!valid) return Date.now() - info.mtimeMs < RERUN_AFTER_MS;
  return record.hostname !== hostname() || pidIsAlive(record.pid);
}

async function pruneEmptyDirectories(layout) {
  for (const path of [
    layout.transactionsRoot,
    join(layout.codexMarketplaceRoot, "plugins"),
    join(layout.codexMarketplaceRoot, ".agents", "plugins"),
    join(layout.codexMarketplaceRoot, ".agents"),
    layout.codexMarketplaceRoot,
    layout.runtimeParent,
    layout.installRoot,
    layout.updateRoot,
    join(layout.claudeHome, "pota"),
    join(layout.antigravityHome, "pota"),
    join(layout.antigravityCliHome, "pota"),
    layout.codexRuntimeParent,
    layout.codexCacheRoot,
  ]) {
    try { await rmdir(path); } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST", "ENOTDIR"].includes(error?.code)) throw error;
    }
  }
}

export function legacyDirectories(env = process.env) {
  const layout = legacyLayout(env);
  return [layout.installRoot, layout.updateRoot, join(layout.claudeHome, "pota"), join(layout.antigravityHome, "pota"),
    join(layout.antigravityCliHome, "pota"), layout.codexCacheRoot];
}

// ---- host unregistration ----

async function unregisterHost(host, manifest, context) {
  if (host === "claude" && manifest.targets.some((record) => record.id === "claude-plugin")) {
    const result = unregisterClaude(context.layout, context.env);
    if (result.status === "done") await context.hook("unregister:claude");
    return result;
  }
  if (host === "codex" && manifest.targets.some((record) => record.id === "codex-config")) {
    const result = await unregisterCodex(context.layout);
    if (result.status === "done") await context.hook("unregister:codex");
    return result;
  }
  return { status: "none" };
}

// Only a `pota` marketplace whose path is <POTA_HOME>/install/claude is Pota's own (the 1.4.0 ownership test). A
// marketplace of the same name elsewhere is foreign and left alone, which counts as nothing to unregister.
function unregisterClaude(layout, env) {
  const cli = env.POTA_CLAUDE_CLI ?? "claude";
  if (cli === "none") return { status: "failed", reason: "claude CLI not found" };
  const childEnv = layout.claudeHomeOverridden ? { ...env, CLAUDE_CONFIG_DIR: layout.claudeHome } : env;
  const options = { encoding: "utf8", env: childEnv, timeout: CLAUDE_CALL_TIMEOUT_MS, windowsHide: true };
  const run = (args) => (/\.m?js$/.test(cli)
    ? spawnSync(process.execPath, [cli, ...args], options)
    : spawnSync(cli, args, { ...options, shell: process.platform === "win32" }));
  const version = run(["--version"]);
  if (version.error || version.status !== 0) return { status: "failed", reason: "claude CLI not found" };
  const json = (args) => {
    const result = run([...args, "--json"]);
    if (result.error || result.status !== 0) {
      throw new Error(`claude ${args.join(" ")} failed: ${(result.stderr || result.stdout || result.error?.message || "").trim().split("\n").at(-1)}`);
    }
    const text = result.stdout.trim();
    try { return JSON.parse(text); } catch { return JSON.parse(text.split("\n").filter(Boolean).at(-1)); }
  };
  try {
    const marketplaces = json(["plugin", "marketplace", "list"]);
    const marketplace = (Array.isArray(marketplaces) ? marketplaces : []).find((entry) => entry?.name === "pota");
    if (!marketplace || typeof marketplace.path !== "string" || resolve(marketplace.path) !== resolve(layout.claudeMarketplaceRoot)) {
      return { status: "none" };
    }
    const plugins = json(["plugin", "list"]);
    if ((Array.isArray(plugins) ? plugins : []).some((entry) => entry?.id === "pota@pota" && entry.scope === "user")) {
      json(["plugin", "uninstall", "pota@pota", "--scope", "user"]);
    }
    json(["plugin", "marketplace", "remove", "pota"]);
    return { status: "done" };
  } catch (error) {
    return { status: "failed", reason: error.message };
  }
}

// Ownership of the shared Codex config is the exact section names plus `[marketplaces.pota]` pointing at
// <POTA_HOME>/install/codex; its digest is not checked. The rewrite keeps every other byte and gives up when the file
// changed after it was read.
async function unregisterCodex(layout) {
  let snapshot;
  try {
    snapshot = await readConfigSnapshot(layout);
  } catch (error) {
    return { status: "failed", reason: error.message };
  }
  if (!snapshot.exists) return { status: "none" };
  const ownership = configOwnership(snapshot.text, layout);
  if (ownership === "invalid") return { status: "failed", reason: `Pota sections in ${layout.configPath} could not be identified safely` };
  if (ownership !== "owned") return { status: "none" };
  const rewritten = removePotaConfig(snapshot.text);
  if (!otherHeadersKept(snapshot.text, rewritten)) return { status: "failed", reason: `Removing the Pota sections would change other sections of ${layout.configPath}` };
  const temporary = join(dirname(layout.configPath), `.${basename(layout.configPath)}.pota-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, rewritten, { flag: "wx", mode: snapshot.mode });
    await chmod(temporary, snapshot.mode);
    const current = await readConfigSnapshot(layout);
    if (!current.exists || current.text !== snapshot.text) return { status: "changed" };
    await rename(temporary, layout.configPath);
  } catch (error) {
    return { status: "failed", reason: error.message };
  } finally {
    await rm(temporary, { force: true });
  }
  return { status: "done" };
}

async function codexConfigState(layout) {
  try {
    const snapshot = await readConfigSnapshot(layout);
    return snapshot.exists ? configOwnership(snapshot.text, layout) : "none";
  } catch {
    return "invalid";
  }
}

async function readConfigSnapshot(layout) {
  const path = layout.configPath;
  const root = isInside(layout.codexHome, path) ? layout.codexHome : dirname(path);
  try {
    await assertNoSymlinkComponents(root, path);
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    if (error?.code === "POTA_SYMLINK") throw new Error(`Codex config is not a regular file: ${path}`);
    throw error;
  }
  const info = await lstatOrNull(path);
  if (!info) return { exists: false };
  if (!info.isFile()) throw new Error(`Codex config is not a regular file: ${path}`);
  return { exists: true, text: await readRegularFile(path), mode: (info.mode & 0o777) || 0o600 };
}

// "owned", "foreign", "none", or "invalid" (fail-closed): a line that looks like a Pota header but is not the header of
// a recognised Pota section, or a `[marketplaces.pota]` whose `source` cannot be read.
function configOwnership(text, layout) {
  const sections = splitSections(text);
  const potaLines = new Set(sections.filter(isPotaConfigSection).map((section) => section.line));
  if (text.split("\n").some((line, index) => POTA_HEADER_HINT.test(line) && !potaLines.has(index))) return "invalid";
  let foreign = false;
  for (const marketplace of sections.filter((section) => section.header === "marketplaces.pota")) {
    const source = tomlStringValue(marketplace.text, "source");
    if (source === null) return "invalid";
    if (resolve(source) !== resolve(layout.codexMarketplaceRoot)) foreign = true;
  }
  if (foreign) return "foreign";
  return potaLines.size > 0 ? "owned" : "none";
}

function tomlStringValue(text, key) {
  for (const line of text.split("\n")) {
    const match = line.replace(/\r$/, "").match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')\\s*(?:#.*)?$`));
    if (!match) continue;
    if (match[1].startsWith("'")) return match[1].slice(1, -1);
    try { return JSON.parse(match[1]); } catch { return null; }
  }
  return null;
}

// Drops the Pota sections and keeps every other byte, including line endings; a file without a final newline keeps
// none.
function removePotaConfig(config) {
  const output = splitSections(config).map((section) => (isPotaConfigSection(section)
    ? splitTrailingTomlTrivia(section.text).trivia
    : section.text)).join("");
  return config.endsWith("\n") ? output : output.replace(/[\r\n]+$/, "");
}

// Post-condition of the rewrite: every line of the original that opens a section, other than a Pota header, is still
// there and in the same order, and nothing else that opens a section is.
function otherHeadersKept(original, rewritten) {
  const potaLines = new Set(splitSections(original).filter(isPotaConfigSection).map((section) => section.line));
  const headerLines = (text, skip) => text.split("\n").map((line) => line.replace(/\r$/, ""))
    .filter((line, index) => /^\s*\[/.test(line) && !skip.has(index));
  const before = headerLines(original, potaLines);
  const after = headerLines(rewritten, new Set());
  return before.length === after.length && before.every((line, index) => line === after[index]);
}

function isPotaConfigSection(section) {
  return section.header === "marketplaces.pota"
    || section.header === 'plugins."pota@pota"'
    || /^hooks\.state\.(["'])pota@pota:/.test(section.header ?? "");
}

function splitTrailingTomlTrivia(text) {
  const lines = text.split(/(?<=\n)/);
  let boundary = lines.length;
  while (boundary > 0) {
    const line = lines[boundary - 1];
    if (line.length === 0 || line.trim().length === 0 || line.trimStart().startsWith("#")) boundary -= 1;
    else break;
  }
  return { body: lines.slice(0, boundary).join(""), trivia: lines.slice(boundary).join("") };
}

// Sections in order; `line` is the index of the header line (-1 for the text before the first header). A header is
// only recognised outside a multiline string, and its keys may be quoted (so `[` and `]` may appear inside them).
function splitSections(config) {
  const result = [];
  let current = { header: null, text: "", line: -1 };
  let multiline = null;
  config.split(/(?<=\n)/).forEach((line, index) => {
    const content = line.replace(/\r?\n$/, "");
    const match = multiline ? null : content.match(TOML_HEADER);
    if (match) {
      if (current.text.length > 0) result.push(current);
      current = { header: match[1] !== undefined ? `[${match[1].trim()}]` : match[2].trim(), text: line, line: index };
      return;
    }
    current.text += line;
    multiline = openMultiline(content, multiline);
  });
  if (current.text.length > 0) result.push(current);
  return result;
}

// Scans one line (without its line break) and returns the multiline string delimiter still open at its end, if any.
// Comments and single-line strings are skipped, so a `"""` inside them opens nothing.
function openMultiline(line, open) {
  let state = open;
  let index = 0;
  while (index < line.length) {
    if (state) {
      if (state === '"""' && line[index] === "\\") index += 2;
      else if (line.startsWith(state, index)) {
        index += 3;
        while (line[index] === state[0]) index += 1;
        state = null;
      } else index += 1;
      continue;
    }
    const char = line[index];
    if (char === "#") break;
    if (line.startsWith('"""', index) || line.startsWith("'''", index)) {
      state = line.slice(index, index + 3);
      index += 3;
    } else if (char === '"') {
      index += 1;
      while (index < line.length && line[index] !== '"') index += line[index] === "\\" ? 2 : 1;
      index += 1;
    } else if (char === "'") {
      const end = line.indexOf("'", index + 1);
      index = end === -1 ? line.length : end + 1;
    } else index += 1;
  }
  return state;
}

// ---- SessionStart state, reports, and notices ----

function runKey(info, host, env) {
  const fingerprint = JSON.stringify([`${info.mtimeMs}:${info.size}`, host, PATH_ENV.map((name) => env[name] ?? null)]);
  return createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);
}

// First run for this manifest, host, and environment; a rerun 10 minutes after the last spawn when it left no report
// (or a deferred one); a rerun 24 hours after a blocked report and the last spawn. `report` has the same key.
function runDecision(entry, key, report, now) {
  if (!isPlainObject(entry) || entry.key !== key) return { run: true, first: true };
  const spawnedAt = Date.parse(entry.spawnedAt ?? "");
  const lastSpawn = Number.isFinite(spawnedAt) ? spawnedAt : -Infinity;
  if (!report || report.status === "deferred") return { run: now.getTime() - lastSpawn >= RERUN_AFTER_MS, first: false };
  if (report.status === "blocked") {
    const reportAt = Date.parse(report.at ?? "");
    return { run: now.getTime() - Math.max(lastSpawn, Number.isFinite(reportAt) ? reportAt : -Infinity) >= BLOCKED_RETRY_MS, first: false };
  }
  return { run: false, first: false };
}

// A completed report is shown once; a blocked one at most every 7 days and only while the manifest remains. The claim
// is an exclusive create named after the notice file content it replaces, so only one session wins each change.
function claimReportNotice(layout, host, report, now, doctor, manifestPresent) {
  if (!report || !["completed", "blocked"].includes(report.status)) return null;
  if (report.status === "blocked" && !manifestPresent) return null;
  const path = join(layout.migrationRoot, `notice-${host}.json`);
  const previous = readJsonSync(path);
  const previousText = previous.status === "ok" ? previous.text : "";
  const value = previous.status === "ok" && isPlainObject(previous.value) ? previous.value : {};
  if (report.status === "completed" && value.reportId === report.id) return null;
  if (report.status === "blocked") {
    const shownAt = Date.parse(value.blockedShownAt ?? "");
    if (Number.isFinite(shownAt) && now.getTime() - shownAt < BLOCKED_NOTICE_MS) return null;
  }
  ensureMigrationRoot(layout);
  const claimPrefix = `notice-${host}.claim.`;
  const claim = join(layout.migrationRoot, `${claimPrefix}${createHash("sha256").update(previousText).digest("hex").slice(0, 16)}`);
  try {
    writeFileSync(claim, `${now.toISOString()}\n`, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }
  writeJsonSync(layout, path, {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    reportId: report.id,
    blockedShownAt: report.status === "blocked" ? now.toISOString() : value.blockedShownAt ?? null,
  });
  for (const name of readdirSync(layout.migrationRoot)) {
    const old = join(layout.migrationRoot, name);
    if (!name.startsWith(claimPrefix) || old === claim) continue;
    try { if (now.getTime() - lstatSync(old).mtimeMs > CLAIM_KEEP_MS) rmSync(old, { force: true }); } catch { /* already gone */ }
  }
  if (report.status === "blocked" && report.reason === "symlinked-path") return { kind: "symlinked", doctor };
  if (report.status === "blocked") return { kind: "blocked", reason: report.reason ?? "unknown", doctor };
  return {
    kind: "removed",
    version: report.version ?? "unknown",
    kept: Array.isArray(report.modified) ? report.modified.length : 0,
    hosts: (Array.isArray(report.remainingHosts) ? report.remainingHosts : []).filter((name) => name !== host).map((name) => HOST_LABELS[name] ?? name),
    doctor,
  };
}

function doctorCommand(pluginRoot) {
  return `node "${join(pluginRoot, "scripts", "pota.mjs")}" doctor`;
}

function readReportsSync(layout) {
  const read = readJsonSync(layout.reportPath);
  if (read.status !== "ok" || read.value?.schemaVersion !== MIGRATION_SCHEMA_VERSION || !isPlainObject(read.value.hosts)) return {};
  return Object.fromEntries(Object.entries(read.value.hosts).filter(([name, report]) => LEGACY_HOSTS.includes(name) && isPlainObject(report)));
}

function readStatesSync(layout) {
  const read = readJsonSync(layout.statePath);
  if (read.status !== "ok" || read.value?.schemaVersion !== MIGRATION_SCHEMA_VERSION || !isPlainObject(read.value.hosts)) return {};
  return Object.fromEntries(Object.entries(read.value.hosts).filter(([name]) => LEGACY_HOSTS.includes(name)));
}

function readJsonSync(path, limit = SMALL_FILE_LIMIT) {
  let info;
  try { info = lstatSync(path); } catch (error) { return { status: error?.code === "ENOENT" ? "missing" : "invalid" }; }
  if (!info.isFile() || info.size > limit) return { status: "invalid" };
  try {
    const text = readFileSync(path, "utf8");
    return { status: "ok", text, value: JSON.parse(text) };
  } catch {
    return { status: "invalid" };
  }
}

function ensureMigrationRoot(layout) {
  mkdirSync(layout.migrationRoot, { recursive: true });
  const info = lstatSync(layout.migrationRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Pota migration directory is not a directory: ${layout.migrationRoot}`);
}

function writeJsonSync(layout, path, value) {
  ensureMigrationRoot(layout);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// ---- CLI ----

async function runCli(args) {
  const options = parseCliArgs(args);
  if (options.command === "help") {
    console.log(MIGRATION_USAGE);
    return 0;
  }
  const env = process.env;
  if (options.command === "status") {
    const plan = await planLegacyRemoval({ env, host: options.host ?? "all" });
    const reports = readMigrationReports({ env });
    if (options.json) console.log(JSON.stringify({ plan, reports }, null, 2));
    else {
      printPlan(plan);
      for (const report of Object.values(reports)) printReport(report);
    }
    return 0;
  }
  if (options.dryRun) {
    const plan = await planLegacyRemoval({ env, host: options.host });
    if (options.json) console.log(JSON.stringify({ dryRun: true, plan }, null, 2));
    else printPlan(plan);
    return plan.status === "blocked" ? 1 : 0;
  }
  const result = await runLegacyRemoval({ env, host: options.host });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.status === "none") console.log("Legacy npm install: none");
  else for (const report of Object.values(result.hosts)) printReport(report);
  return result.status === "blocked" ? 1 : 0;
}

function parseCliArgs(args) {
  const usageError = (message) => {
    const error = new Error(`${message}\n${MIGRATION_USAGE}`);
    error.usage = true;
    return error;
  };
  const [command, ...rest] = args;
  if (command === undefined || command === "help" || command === "--help") return { command: "help" };
  if (!["run", "status"].includes(command)) throw usageError(`Unknown migrate command: ${command}`);
  const options = { command, host: undefined, all: false, dryRun: false, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--json" && !options.json) options.json = true;
    else if (arg === "--all" && !options.all) options.all = true;
    else if (arg === "--dry-run" && command === "run" && !options.dryRun) options.dryRun = true;
    else if ((arg === "--host" || arg.startsWith("--host=")) && options.host === undefined) {
      options.host = arg === "--host" ? rest[(index += 1)] : arg.slice("--host=".length);
      if (!LEGACY_HOSTS.includes(options.host)) throw usageError(`Invalid --host value: ${options.host ?? "missing"}`);
    } else throw usageError(`Unexpected argument: ${arg}`);
  }
  if (options.all && options.host !== undefined) throw usageError("--host and --all cannot be combined");
  if (command === "run" && !options.all && options.host === undefined) throw usageError("run requires --host <host> or --all");
  if (options.all) options.host = "all";
  return options;
}

function printPlan(plan) {
  if (plan.status === "none") return console.log("Legacy npm install: none");
  if (plan.status === "blocked") return console.log(`Legacy npm install: blocked ${plan.reason}`);
  console.log(`Legacy npm install: present ${plan.version} (hosts: ${plan.manifestHosts.join(",")})`);
  for (const step of plan.unregister) console.log(`unregister ${step.host}: ${step.action}${step.state ? ` (${step.state})` : ""}`);
  for (const target of [...plan.targets, ...plan.core]) console.log(`${target.state} ${target.path}`);
  console.log(`core removed when done: ${plan.coreRemovedWhenDone ? "yes" : "no"}`);
}

function printReport(report) {
  const reason = report.reason ? ` (${report.reason})` : "";
  console.log(`${report.host}: ${report.status}${reason}, removed ${report.removed.length}, kept ${report.modified.length}, missing ${report.missing}`);
  for (const path of report.modified) console.log(`  kept: ${path}`);
  for (const command of report.manual) console.log(`  manual: ${command}`);
}

// ---- helpers ----

async function readRegularFile(path) {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`Not a regular file: ${path}`);
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function pathExists(path) {
  return (await lstatOrNull(path)) !== null;
}

async function lstatOrNull(path) {
  try { return await lstat(path); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isHostSelection(hosts) {
  return Array.isArray(hosts) && hosts.length > 0 && hosts.length <= LEGACY_HOSTS.length
    && hosts.every((host, index) => LEGACY_HOSTS.includes(host) && (index === 0 || LEGACY_HOSTS.indexOf(hosts[index - 1]) < LEGACY_HOSTS.indexOf(host)));
}

function isInside(root, candidate) {
  const path = resolve(candidate);
  const base = resolve(root);
  return path === base || path.startsWith(`${base}${sep}`);
}

function isVersion(value) { return typeof value === "string" && VERSION_PATTERN.test(value); }
function isDigest(value) { return typeof value === "string" && DIGEST_PATTERN.test(value); }
function isDate(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function sameKeys(value, expected) { return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0"); }
function sha(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

function pidIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code !== "ESRCH"; }
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}
