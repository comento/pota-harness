#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { lstat, readFile, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePluginRoot } from "./pota-paths.mjs";
import {
  canonical, ensureSetting, hasSetting, hookHash, removePotaConfig, splitSections,
  updateConfig as projectConfig,
} from "./pota-lifecycle-config.mjs";
import { createCommands } from "./pota-lifecycle-commands.mjs";
import { createIntegrity } from "./pota-lifecycle-integrity.mjs";
import { HOSTS, isHostSelection, parseHostsOption, promptHosts } from "./pota-lifecycle-hosts.mjs";
import { createLayout } from "./pota-lifecycle-layout.mjs";
import { removeUpdateState } from "./pota-update-state.mjs";
import {
  antigravityRuntimeLocatorPath, quoteShellArg, renderInstalledMirror as projectMirror,
} from "./pota-lifecycle-mirror.mjs";
import {
  pathHasSegment, shouldCopyPluginPath as projectShouldCopyPluginPath,
} from "./pota-lifecycle-staging.mjs";
import { createStaging } from "./pota-lifecycle-staging.mjs";
import {
  createTransactionManager, DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS,
} from "./pota-lifecycle-transaction.mjs";

export {
  canonical, DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS, ensureSetting, hasSetting, hookHash,
  pathHasSegment, quoteShellArg, removePotaConfig, splitSections,
};

const pluginRoot = resolvePluginRoot(import.meta.url);
const homeRoot = process.env.HOME ?? process.env.USERPROFILE ?? homedir() ?? ".";
const claudeHomeOverridden = typeof process.env.CLAUDE_HOME === "string" && process.env.CLAUDE_HOME.length > 0;
const claudeHome = resolve(process.env.CLAUDE_HOME ?? join(homeRoot, ".claude"));
const antigravityHome = resolve(process.env.ANTIGRAVITY_HOME ?? join(homeRoot, ".gemini", "config"));
const antigravityCliHome = resolve(process.env.ANTIGRAVITY_CLI_HOME ?? join(homeRoot, ".gemini", "antigravity-cli"));
const marketplaceName = "pota";
const pluginName = "pota";
const claudeRuntimeLocatorPath = join(claudeHome, "pota", "runtime.json");
const sourceManifest = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const releaseVersion = sourceManifest.version;
const layout = createLayout({ env: process.env, releaseVersion, marketplaceName, pluginName });
const {
  potaHomeRoot, claudePluginMarketplaceRoot, codexCacheRoot, codexHome, codexRuntimeRoot, installRoot,
  installedPluginRoot, lifecycleLockPath, marketplaceJsonPath, marketplaceRoot, ownershipPath, runtimeRoot,
  transactionPath, transactionRoot,
} = layout;
const configPath = resolve(process.env.CODEX_CONFIG_PATH ?? join(codexHome, "config.toml"));
const installedRuntimeLocatorPath = join(runtimeRoot, ".pota-runtime.json");
const phases = ["core", "codex", "claude", "antigravity", "config", "cleanup"];
const MAX_LIFECYCLE_LOCK_TIMEOUT_MS = 2_147_483_647;

const lifecycleContext = {
  agentNames, antigravityCliHome, antigravityHome, claudeHome, claudeHomeOverridden,
  claudePluginMarketplaceRoot, claudeRuntimeLocatorPath, codexCacheRoot, codexRuntimeRoot,
  codexHome, commandNames, configPath, installRoot, installedPluginRoot, installedRuntimeLocatorPath,
  layout, lifecycleLockPath, marketplaceJsonPath, marketplaceName,
  marketplaceRoot, ownershipPath, phases, pluginName, pluginRoot, releaseVersion, runtimeRoot,
  samePath, skillNames, transactionPath, transactionRoot, updateConfig,
};
const integrity = createIntegrity(lifecycleContext);
const transaction = createTransactionManager({ ...lifecycleContext, ...integrity });
const staging = createStaging({ ...lifecycleContext, assertRegularTree: integrity.assertRegularTree });
const commands = createCommands({
  ...lifecycleContext, integrity,
  pruneUninstallScaffolds: () => pruneUninstallScaffolds(layout), staging, t, transaction,
});

if (isCliEntry()) {
  try {
    const { command, hosts: requestedHosts, auto, allowDowngrade } = parseLifecycleInvocation(process.argv.slice(2));
    if (command === "install" || command === "upgrade") {
      // The prompt runs before any lock is taken so a waiting answer never blocks another lifecycle run.
      const hosts = requestedHosts ?? (command === "install" && await shouldPromptHosts() ? await promptHosts({ input: process.stdin, output: process.stdout, ko: localeFamily() === "ko" }) : null);
      await assertLifecycleMutationPaths(hosts);
      await withLifecycleLocks(() => commands.install(command, { hosts, auto, allowDowngrade }), { afterRelease: pruneUninstallRoots });
    } else if (command === "doctor") {
      await assertNoSymlinkAncestor(potaHomeRoot, lifecycleLockPath);
      await transaction.withLifecycleLock(commands.doctor, { timeoutMs: lifecycleLockTimeout(), afterRelease: pruneUninstallRoots });
    } else if (command === "uninstall") {
      await assertLifecycleMutationPaths(null);
      // Auto-upgrade state goes with the installation; config.json and goal state stay.
      await withLifecycleLocks(commands.uninstall, { afterRelease: async () => { await pruneUninstallRoots(); await removeUpdateState(process.env); } });
    } else help();
  } catch (error) {
    console.error(`Pota lifecycle error: ${error.message}`);
    process.exitCode = 1;
  }
}

// Only install and upgrade take options: `--hosts <list>` or `--hosts=<list>`, and `--allow-downgrade` (replace an
// installation of a newer version). upgrade also takes `--auto` (the auto-upgrade runner's call, which keeps the
// recorded hosts and never downgrades); every other trailing argument (including --help) is rejected before any lock
// or stage, as before.
function parseLifecycleInvocation(args) {
  if (args.length === 0) return { command: "help", hosts: null, auto: false, allowDowngrade: false };
  const [command, ...trailing] = args;
  if (!["install", "upgrade", "doctor", "uninstall", "help"].includes(command)) throw new Error(`Unknown lifecycle command: ${command}`);
  const unexpected = [];
  let hostsValue;
  let hostsGiven = false;
  let auto = false;
  let allowDowngrade = false;
  for (let index = 0; index < trailing.length; index += 1) {
    const arg = trailing[index];
    if (command === "upgrade" && arg === "--auto" && !auto) { auto = true; continue; }
    if ((command === "install" || command === "upgrade") && arg === "--allow-downgrade" && !allowDowngrade) { allowDowngrade = true; continue; }
    const hostsArg = command === "install" || command === "upgrade" ? arg === "--hosts" || arg.startsWith("--hosts=") : false;
    if (!hostsArg) { unexpected.push(arg); continue; }
    if (hostsGiven) throw new Error("Invalid --hosts value: --hosts may only be provided once");
    hostsGiven = true;
    if (arg === "--hosts") { hostsValue = trailing[index + 1]; index += 1; } else hostsValue = arg.slice("--hosts=".length);
  }
  if (unexpected.length > 0) {
    // doctor, uninstall, and help keep the original message listing every trailing argument.
    const listed = command === "install" || command === "upgrade" ? unexpected : trailing;
    throw new Error(`Lifecycle command ${command} does not accept arguments: ${listed.join(" ")}`);
  }
  if (auto && hostsGiven) throw new Error("--auto cannot be combined with --hosts");
  if (auto && allowDowngrade) throw new Error("--auto cannot be combined with --allow-downgrade");
  return { command, hosts: hostsGiven ? parseHostsOption(hostsValue) : null, auto, allowDowngrade };
}

// install asks only when nothing is installed yet (no ownership manifest), a person is at a terminal, and
// CI is not set. POTA_TEST_HOSTS_PROMPT_TTY stands in for the terminal check so tests can answer through a pipe.
async function shouldPromptHosts() {
  if (process.env.CI) return false;
  const terminal = process.env.POTA_TEST_HOSTS_PROMPT_TTY === "1" || (process.stdin.isTTY && process.stdout.isTTY);
  if (!terminal) return false;
  return !(await pathExists(ownershipPath));
}

// The hosts whose paths an install, upgrade, or uninstall may touch: the requested selection plus whatever the
// current manifest records. Without a readable selection every host is checked.
async function hostsInScope(requested) {
  let recorded = null;
  try { recorded = JSON.parse(await readFile(ownershipPath, "utf8")).hosts; } catch { recorded = null; }
  if (!isHostSelection(recorded)) recorded = (await pathExists(ownershipPath)) ? [...HOSTS] : null;
  const scope = new Set([...(requested ?? []), ...(recorded ?? [])]);
  if (!requested && !recorded) for (const host of HOSTS) scope.add(host);
  return scope;
}

function lifecycleLockTimeout() {
  const raw = process.env.POTA_LIFECYCLE_LOCK_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`POTA_LIFECYCLE_LOCK_TIMEOUT_MS must be an integer between 1 and ${MAX_LIFECYCLE_LOCK_TIMEOUT_MS}`);
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_LIFECYCLE_LOCK_TIMEOUT_MS) throw new Error(`POTA_LIFECYCLE_LOCK_TIMEOUT_MS must be an integer between 1 and ${MAX_LIFECYCLE_LOCK_TIMEOUT_MS}`);
  return timeoutMs;
}

async function withLifecycleLocks(operation, { afterRelease } = {}) {
  return transaction.withLifecycleLock(operation, { timeoutMs: lifecycleLockTimeout(), afterRelease });
}

// Symlinked ancestors are checked only for the hosts in scope, so a symlinked home of a host the user did not select
// never blocks the others.
async function assertLifecycleMutationPaths(requestedHosts) {
  const hosts = await hostsInScope(requestedHosts);
  const roots = [
    [potaHomeRoot, lifecycleLockPath], [potaHomeRoot, transactionRoot], [potaHomeRoot, runtimeRoot],
    ...(hosts.has("codex") ? [
      [potaHomeRoot, installedPluginRoot], [potaHomeRoot, marketplaceJsonPath],
      [codexHome, codexRuntimeRoot], [isInside(codexHome, configPath) ? codexHome : dirname(configPath), configPath],
    ] : []),
    ...(hosts.has("claude") ? [
      [potaHomeRoot, claudePluginMarketplaceRoot],
      [claudeHome, join(claudeHome, "commands")], [claudeHome, join(claudeHome, "agents")], [claudeHome, claudeRuntimeLocatorPath],
    ] : []),
    ...(hosts.has("antigravity") ? [
      [antigravityHome, join(antigravityHome, "skills")],
      ...skillNames().map((name) => [antigravityHome, join(antigravityHome, "skills", name)]),
      [antigravityHome, join(antigravityHome, "workflows")], [antigravityHome, antigravityRuntimeLocatorPath(antigravityHome)],
      [antigravityCliHome, join(antigravityCliHome, "skills")], [antigravityCliHome, join(antigravityCliHome, "workflows")],
      [antigravityCliHome, antigravityRuntimeLocatorPath(antigravityCliHome)],
    ] : []),
  ];
  for (const [root, destination] of roots) await assertNoSymlinkAncestor(root, destination);
}

async function assertNoSymlinkAncestor(root, destination) {
  const relation = relative(root, destination);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) return;
  const paths = [resolve(root)];
  let current = resolve(root);
  for (const segment of relation.split(sep).filter(Boolean)) { current = join(current, segment); paths.push(current); }
  for (const path of paths) {
    let info;
    try { info = await lstat(path); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    if (info.isSymbolicLink()) {
      if (path === configPath) throw new Error(`Managed config is not a regular file: ${path}`);
      throw new Error(`Lifecycle path ancestor must not be a symlink: ${path}`);
    }
  }
}

async function pruneUninstallScaffolds(paths) {
  for (const path of [
    join(paths.marketplaceRoot, "plugins"), join(paths.marketplaceRoot, ".agents", "plugins"), join(paths.marketplaceRoot, ".agents"),
    paths.marketplaceRoot, paths.runtimeParent, paths.transactionRoot, paths.codexRuntimeParent,
  ]) await removeEmptyDirectory(path);
}

// Only empty managed roots are removed; POTA_HOME itself also holds goal state and is left in place.
async function pruneUninstallRoots() {
  await removeEmptyDirectory(installRoot);
  await removeEmptyDirectory(codexCacheRoot);
}

async function pathExists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function removeEmptyDirectory(path) {
  try { await rmdir(path); }
  // ENOTDIR: a symlinked scaffold of a host that was never selected is not Pota's to prune.
  catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST", "ENOTDIR"].includes(error?.code)) throw error; }
}

function isInside(root, candidate) {
  const path = resolve(candidate);
  return path === root || path.startsWith(`${root}${sep}`);
}

export async function targetDigest(path, type) { return integrity.targetDigest(path, type); }
export function updateConfig(config, hookStates, options = {}) { return projectConfig(config, hookStates, { marketplacePath: options.marketplacePath ?? marketplaceRoot }); }
export function shouldCopyPluginPath(source) { return projectShouldCopyPluginPath(source, pluginRoot); }
export function samePath(left, right) { try { return realpathSync(left) === realpathSync(right); } catch { return resolve(left) === resolve(right); } }
export function commandNames() { return ["install", "upgrade", "doctor", "uninstall", "memory", "plan", "work", "review", "toolcheck"]; }
export function agentNames() { return ["explorer", "worker"]; }
export function skillNames() { return ["pota-memory", "pota-plan", "pota-work", "pota-review"]; }
export function renderInstalledMirror(content, options = {}) { return projectMirror(content, { runtimeRoot: options.runtimeRoot ?? runtimeRoot, locatorPath: options.locatorPath ?? installedRuntimeLocatorPath, platform: options.platform ?? process.platform }); }
export function findPluginStatus(value, id) { const entries = Array.isArray(value) ? value : value?.installed ?? value?.plugins ?? value?.data ?? []; return entries.find((entry) => entry.pluginId === id || entry.id === id || entry.name === id || `${entry.name}@${entry.marketplaceName ?? entry.marketplace}` === id) ?? null; }
export function parseCodexFeatureList(output) { if (typeof output !== "string" || output.trim().length === 0) return null; const features = {}; for (const line of output.split(/\r?\n/)) { const match = line.trim().match(/^([A-Za-z0-9_]+)\s+.+?\s+(true|false)$/); if (match) features[match[1]] = match[2] === "true"; } return Object.keys(features).length > 0 ? features : null; }
export function localeFamily() { const locale = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG].find((value) => typeof value === "string" && value.length > 0) ?? Intl.DateTimeFormat().resolvedOptions().locale; return locale.toLowerCase().startsWith("ko") ? "ko" : "en"; }

function help() { console.log(t("usage")); }
function t(key) { const messages = { en: { installComplete: "Pota install complete", upgradeComplete: "Pota upgrade complete", uninstallComplete: "Pota uninstall complete", usage: "Usage: pota install|upgrade [--hosts all|codex,claude,antigravity] [--allow-downgrade] | doctor | uninstall | toolcheck" }, ko: { installComplete: "Pota 설치 완료", upgradeComplete: "Pota 업그레이드 완료", uninstallComplete: "Pota 언인스톨 완료", usage: "사용법: pota install|upgrade [--hosts all|codex,claude,antigravity] [--allow-downgrade] | doctor | uninstall | toolcheck" } }; return messages[localeFamily()]?.[key] ?? messages.en[key]; }
function isCliEntry() { if (!process.argv[1]) return false; try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return import.meta.url === pathToFileURL(process.argv[1]).href; } }
