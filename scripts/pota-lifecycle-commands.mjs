import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { hasSetting, readSharedConfigSnapshot, removePotaConfig, splitSections } from "./pota-lifecycle-config.mjs";
import {
  installedSkillLocatorPath, validRuntimeLocator, validateAntigravitySkills,
} from "./pota-lifecycle-mirror.mjs";
import { createClaudeRegistration } from "./pota-lifecycle-claude.mjs";
import { HOSTS, hostOfTarget, isHostSelection } from "./pota-lifecycle-hosts.mjs";
import {
  OWNERSHIP_SCHEMA_VERSION, RETAINED_RUNTIME_GRACE_MS, RETAINED_RUNTIME_IDS, RETAINED_RUNTIME_LIMIT,
  compareVersions,
} from "./pota-lifecycle-integrity.mjs";
import { AUTO_UPGRADE_EXIT } from "./pota-update-state.mjs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function createCommands(context) {
  const {
    antigravityCliHome, antigravityHome, claudeHome, claudeHomeOverridden, claudePluginMarketplaceRoot,
    claudeRuntimeLocatorPath, codexCacheRoot, codexHome, codexRuntimeRoot, marketplaceName, configPath,
    installRoot, installedPluginRoot, layout,
    marketplaceJsonPath, ownershipPath, phases, pluginName, pluginRoot,
    pruneUninstallScaffolds, releaseVersion, runtimeRoot, skillNames, t, transaction,
    staging, integrity,
  } = context;
  const {
    createTransaction, finishTransaction, recoverInterruptedTransaction,
    removeManagedTarget, replaceTarget, rollback,
  } = transaction;
  const { stageInstall } = staging;
  const claudeRegistration = createClaudeRegistration({
    claudeHome, claudeHomeOverridden, marketplaceRoot: claudePluginMarketplaceRoot,
    marketplaceName, pluginName, releaseVersion,
  });
  const {
    assertOwnershipDigests,
    assertTargetsReplaceable, ownershipDigestsValid, readOwnership, targetDigest,
    targetRecord, validateOwnershipShape, withoutMissingRetained,
  } = integrity;
// `selection` is the --hosts value or the prompt answer; without one an upgrade keeps the recorded hosts and a first
// install takes every host. `auto` is `upgrade --auto` from the auto-upgrade runner. `allowDowngrade` lets this CLI
// replace an installation of a newer version.
async function install(mode, { hosts: selection = null, auto = false, allowDowngrade = false } = {}) {
  if (isInsidePath(installRoot, pluginRoot) || isInsidePath(codexCacheRoot, pluginRoot)) {
    throw new Error("Run install or upgrade from the Pota package/global source, not from the installed cache.");
  }
  await recoverInterruptedTransaction();
  // Checked under the lifecycle lock: an automatic upgrade only moves an existing installation forward, so a runner
  // that started before an uninstall finished installs nothing.
  if (auto && (await readJson(ownershipPath).catch(() => null))?.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    throw new Error("auto-upgrade requires an existing installation");
  }
  // An older CLI (an old global install, an old npx cache) would otherwise move a newer installation back, and the
  // auto-upgrade runner would move it forward again.
  const installedVersion = await recordedVersion();
  if (!allowDowngrade && installedVersion && compareVersions(installedVersion, releaseVersion) > 0) {
    throw new Error(`Installed Pota ${installedVersion} is newer than this CLI ${releaseVersion}; run the newer CLI, or pass --allow-downgrade to install ${releaseVersion}`);
  }
  const transaction = await createTransaction();
  let unregisteredClaude = false;
  let hosts = [...HOSTS];
  let droppedHosts = false;
  try {
    let ownership = await readOwnership();
    if (ownership) validateOwnershipShape(ownership);
    // A retained runtime that is already gone needs no removal and is no longer recorded.
    if (ownership) ownership = await withoutMissingRetained(ownership);
    hosts = selection ?? (ownership ? ownership.hosts : hosts);
    droppedHosts = Boolean(ownership) && ownership.hosts.some((host) => !hosts.includes(host));
    const targets = await stageInstall(transaction.stageRoot, hosts);
    if (process.env.POTA_TEST_CRASH_AFTER_STAGE === "1") process.exit(87);
    let retained = [];
    if (ownership) {
      await assertOwnershipDigests(ownership);
      const retention = planRetention(ownership, new Date(), hosts);
      targets.push(...retention.removals);
      retained = retention.retained;
      targets.push(...await deselectedHostTargets(ownership, hosts, transaction));
    }
    await assertTargetsReplaceable(targets, ownership);
    // Like uninstall, a deselected Claude Code plugin is unregistered before its files are removed; a rollback
    // restores the files and then the registration.
    if (ownership?.hosts?.includes("claude") && !hosts.includes("claude")) {
      unregisteredClaude = claudeRegistration.unregister().unregistered;
    }
    for (const phase of phases) {
      for (const target of targets.filter((candidate) => candidate.phase === phase)) {
        if (target.operation === "remove") await removeManagedTarget(target, transaction);
        else await replaceTarget(target, transaction);
      }
      injectFailure(`after-${phase}`);
      if (process.env.POTA_TEST_CRASH_AFTER_PHASE === phase) process.exit(88);
    }
    const records = [];
    for (const target of targets.filter((candidate) => candidate.operation !== "remove" && !candidate.deselected)) records.push(await targetRecord(target));
    const nextOwnership = {
      schemaVersion: OWNERSHIP_SCHEMA_VERSION,
      plugin: pluginName,
      version: releaseVersion,
      transactionId: transaction.id,
      installedAt: new Date().toISOString(),
      origin: await exists(join(pluginRoot, ".git")) ? "checkout" : "package",
      hosts: [...hosts],
      targets: records,
      retained,
    };
    const ownershipStage = join(transaction.stageRoot, "lifecycle.json");
    await mkdir(dirname(ownershipStage), { recursive: true });
    await writeFile(ownershipStage, `${JSON.stringify(nextOwnership, null, 2)}\n`);
    await replaceTarget({ id: "ownership", phase: "manifest", path: ownershipPath, staged: ownershipStage, type: "file" }, transaction);
    await finishTransaction(transaction);
    console.log(t(mode === "upgrade" ? "upgradeComplete" : "installComplete"));
    console.log(`Pota runtime: ${runtimeRoot}`);
    if (nextOwnership.hosts.includes("codex")) {
      console.log(`Codex plugin source: ${installedPluginRoot}`);
      console.log(`Codex versioned runtime: ${codexRuntimeRoot}`);
    }
    console.log(`Ownership manifest: ${ownershipPath}`);
  } catch (error) {
    if (transaction.state !== "committed") {
      await rollback(transaction);
      if (unregisteredClaude) {
        try { claudeRegistration.register(); } catch (registrationError) { console.error(`Claude Code plugin re-registration failed: ${registrationError.message}`); }
      }
    }
    throw error;
  }
  if (hosts.includes("claude")) reportClaudeRegistration({ auto });
  // Removing a host can leave its empty scaffolds (Codex marketplace and cache directories); only empty ones go.
  if (droppedHosts) await pruneUninstallScaffolds();
  injectFailure("after-commit");
}

// The version the manifest records, or null when there is none or it is unreadable (the manifest checks that follow
// report that).
async function recordedVersion() {
  const version = (await readJson(ownershipPath).catch(() => null))?.version;
  return typeof version === "string" && VERSION_PATTERN.test(version) ? version : null;
}

// Records of hosts that are no longer selected are removed under their own ids, so assertTargetsReplaceable compares
// them with the manifest and refuses modified ones. The shared config keeps everything but Pota's sections, as in
// uninstall, and a Codex cache runtime from another version is removed through its journal-only id.
async function deselectedHostTargets(ownership, hosts, transaction) {
  const removals = [];
  for (const record of ownership.targets) {
    const host = hostOfTarget(record.id);
    if (host === "core" || hosts.includes(host)) continue;
    if (record.type === "config") {
      if (!(await exists(record.path))) continue;
      const snapshot = await readSharedConfigSnapshot(record.path);
      const staged = join(transaction.stageRoot, "deselected-config.toml");
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, removePotaConfig(snapshot.text));
      removals.push({ id: record.id, phase: record.phase, path: record.path, staged, type: record.type, configSourceDigest: snapshot.digest, deselected: true });
    } else if (record.id === "codex-runtime" && record.path !== codexRuntimeRoot) {
      removals.push({ id: "previous-codex-runtime", phase: "cleanup", path: record.path, type: record.type, operation: "remove", ownedBy: record.id });
    } else {
      removals.push({ id: record.id, phase: record.phase, path: record.path, type: record.type, operation: "remove" });
    }
  }
  return removals;
}

function hostsOf(ownership) {
  return isHostSelection(ownership?.hosts) ? ownership.hosts : [...HOSTS];
}

// A version change retains the previous runtimes for sessions that still run them, except a Codex cache copy that is
// not older than the release: Codex loads the highest cached version, so that copy would replace the release. Retained
// runtimes past the grace period, beyond the per-id limit (oldest first), or no longer older than a Codex release are
// removed in cleanup; the release's own retained runtime becomes the installed target again.
// Without Codex in the selection there is no codex-runtime record to retain, and Codex runtimes retained earlier are
// removed in this run.
function planRetention(ownership, now, hosts) {
  const removals = [];
  const candidates = [];
  const retiredAt = now.toISOString();
  const keepsCodex = hosts.includes("codex");
  if (ownership.version !== releaseVersion) {
    for (const id of RETAINED_RUNTIME_IDS) {
      const record = ownership.targets.find((candidate) => candidate.id === id);
      // A codex-runtime record of a deselected Codex is removed by deselectedHostTargets.
      if (!record || (id === "codex-runtime" && !keepsCodex)) continue;
      if (id === "codex-runtime" && compareVersions(ownership.version, releaseVersion) >= 0) {
        removals.push({ id: "previous-codex-runtime", phase: "cleanup", path: record.path, type: "tree", operation: "remove", ownedBy: id });
      } else {
        candidates.push({ entry: { id, version: ownership.version, path: record.path, installedDigest: record.installedDigest, retiredAt }, retiring: true });
      }
    }
  }
  for (const entry of ownership.retained) {
    if (entry.id === "codex-runtime" && !keepsCodex) {
      removals.push(retiredRuntimeTarget(entry, "cleanup"));
      continue;
    }
    if (entry.version === releaseVersion) continue;
    const expired = now.getTime() - Date.parse(entry.retiredAt) >= RETAINED_RUNTIME_GRACE_MS;
    const shadowsRelease = entry.id === "codex-runtime" && compareVersions(entry.version, releaseVersion) >= 0;
    if (expired || shadowsRelease) removals.push(retiredRuntimeTarget(entry, "cleanup"));
    else candidates.push({ entry, retiring: false });
  }
  const retained = [];
  for (const id of RETAINED_RUNTIME_IDS) {
    const newestFirst = candidates.filter(({ entry }) => entry.id === id).sort((left, right) => (right.retiring - left.retiring)
      || (Date.parse(right.entry.retiredAt) - Date.parse(left.entry.retiredAt)) || compareVersions(right.entry.version, left.entry.version));
    for (const [index, { entry, retiring }] of newestFirst.entries()) {
      if (index < RETAINED_RUNTIME_LIMIT) retained.push(entry);
      else if (!retiring) removals.push(retiredRuntimeTarget(entry, "cleanup"));
    }
  }
  return { removals, retained: retained.sort((left, right) => Date.parse(left.retiredAt) - Date.parse(right.retiredAt)) };
}

function retiredRuntimeTarget(entry, phase) {
  return { id: `retired-${entry.id}-${entry.version}`, phase, path: entry.path, type: "tree", operation: "remove", retained: entry };
}

// Files are committed first; registering with Claude Code is idempotent, and a failure leaves the files
// installed with a manual command to finish, instead of rolling back a working Codex/Antigravity install.
// A missing claude CLI is only advice (exit 0), except under `upgrade --auto`. Under `--auto` every Claude Code step
// left to the user exits AUTO_UPGRADE_EXIT.manual so the runner can tell it from other errors; a foreign `pota`
// marketplace is not Pota's to change and exits 0 as in a manual upgrade.
function reportClaudeRegistration({ auto = false } = {}) {
  const register = `claude plugin marketplace add ${JSON.stringify(claudePluginMarketplaceRoot)} && claude plugin install ${claudeRegistration.pluginId} --scope user`;
  const failedExit = auto ? AUTO_UPGRADE_EXIT.manual : 1;
  try {
    const result = claudeRegistration.register();
    if (result.registered) {
      console.log(`Claude Code plugin: ${claudeRegistration.pluginId} (${claudePluginMarketplaceRoot})`);
      if (result.cacheRefresh && !result.cacheRefresh.refreshed) {
        const refresh = `claude plugin marketplace update ${marketplaceName} && claude plugin update ${claudeRegistration.pluginId} --scope user`;
        console.log(`Claude Code plugin cache refresh failed: ${result.cacheRefresh.reason}. To finish: ${refresh}`);
        process.exitCode = failedExit;
      }
      return;
    }
    console.log(`Claude Code plugin not registered: ${result.reason}. To register: ${register}`);
    if (auto && result.cliMissing) process.exitCode = AUTO_UPGRADE_EXIT.manual;
  } catch (error) {
    console.log(`Claude Code plugin registration failed: ${error.message}. To register: ${register}`);
    process.exitCode = failedExit;
  }
}

async function uninstall() {
  await recoverInterruptedTransaction();
  const recorded = await readOwnership({ required: true });
  validateOwnershipShape(recorded, { required: true });
  // A retained runtime that is already gone is not a conflict and has nothing left to remove.
  const ownership = await withoutMissingRetained(recorded);
  const conflicts = [];
  const retiredRuntimes = (ownership.retained ?? []).map((entry) => retiredRuntimeTarget(entry, "core"));
  for (const record of [...ownership.targets, ...retiredRuntimes.map((target) => ({ ...target, installedDigest: target.retained.installedDigest }))]) {
    const current = await targetDigest(record.path, record.type);
    if (record.type !== "config" && current !== record.installedDigest) conflicts.push(record.path);
  }
  if (conflicts.length > 0) throw new Error(`Refusing to uninstall modified managed artifacts: ${conflicts.join(", ")}`);
  // Unregister before removing files so Claude Code never points at a deleted plugin; a failure aborts with nothing changed.
  // Without Claude Code in the selection the claude CLI is never run.
  const unregistered = hostsOf(ownership).includes("claude") ? claudeRegistration.unregister().unregistered : false;
  const transaction = await createTransaction();
  try {
    const configRecord = ownership.targets.find((record) => record.type === "config");
    if (configRecord && await exists(configRecord.path)) {
      const snapshot = await readSharedConfigSnapshot(configRecord.path);
      const staged = join(transaction.stageRoot, "uninstall-config.toml");
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, removePotaConfig(snapshot.text));
      await replaceTarget({ ...configRecord, staged, configSourceDigest: snapshot.digest }, transaction);
    }
    injectFailure("uninstall-after-config");
    for (const phase of ["antigravity", "claude"]) {
      for (const record of ownership.targets.filter((candidate) => candidate.phase === phase).reverse()) await removeManagedTarget(record, transaction);
    }
    injectFailure("uninstall-after-external");
    for (const phase of ["codex", "core"]) {
      for (const record of ownership.targets.filter((candidate) => candidate.phase === phase).reverse()) await removeManagedTarget(record, transaction);
    }
    for (const target of retiredRuntimes) await removeManagedTarget(target, transaction);
    injectFailure("uninstall-after-codex");
    await removeManagedTarget({ id: "ownership", phase: "manifest", path: ownershipPath, type: "file" }, transaction);
    injectFailure("uninstall-after-ownership");
    await finishTransaction(transaction);
    injectFailure("uninstall-after-commit");
  } catch (error) {
    if (transaction.state !== "committed") {
      await rollback(transaction);
      // The rollback restored the plugin files, so restore the Claude Code registration that preceded them.
      if (unregistered) {
        try { claudeRegistration.register(); } catch (registrationError) { console.error(`Claude Code plugin re-registration failed: ${registrationError.message}`); }
      }
    }
    throw error;
  }
  await pruneUninstallScaffolds();
  console.log(t("uninstallComplete"));
}

// Only the selected hosts are checked, and only their host CLIs are run; without a valid manifest every host is checked.
// Version-dependent paths follow the installed version, so a CLI of another version checks the installation as it is.
async function doctor() {
  const checks = [];
  const ownership = await readOwnership();
  const hosts = hostsOf(ownership);
  const selected = (host) => hosts.includes(host);
  console.log(`Hosts: ${hosts.join(",")}`);
  const installedVersion = typeof ownership?.version === "string" && VERSION_PATTERN.test(ownership.version) ? ownership.version : releaseVersion;
  if (installedVersion !== releaseVersion) console.log(`CLI version ${releaseVersion} differs from installed version ${installedVersion}`);
  const runtimeRoot = layout.runtimeRootFor(installedVersion);
  const codexRuntimeRoot = layout.codexRuntimeRootFor(installedVersion);
  const installedRuntimeLocatorPath = join(runtimeRoot, ".pota-runtime.json");
  checks.push(["source", await exists(join(pluginRoot, ".codex-plugin", "plugin.json"))]);
  checks.push(["ownership manifest", Boolean(ownership)]);
  checks.push(["ownership digests", await ownershipDigestsValid(ownership)]);
  if (selected("codex")) checks.push(["custom marketplace source", await exists(join(installedPluginRoot, ".codex-plugin", "plugin.json"))]);
  checks.push(["canonical runtime", await exists(join(runtimeRoot, ".codex-plugin", "plugin.json"))]);
  if (selected("codex")) {
    checks.push(["versioned runtime", await exists(join(codexRuntimeRoot, ".codex-plugin", "plugin.json"))]);
    checks.push(["marketplace", await exists(marketplaceJsonPath)]);
    checks.push(["installed hooks manifest field", (await readJson(join(codexRuntimeRoot, ".codex-plugin", "plugin.json")))?.hooks === "./hooks/hooks.json"]);
    checks.push(["hooks file", await exists(join(codexRuntimeRoot, "hooks", "hooks.json"))]);
  }
  checks.push(["installed runtime locator", await validRuntimeLocator(installedRuntimeLocatorPath, runtimeRoot)]);
  checks.push(["installed skill locators", (await Promise.all(skillNames().map((name) => validRuntimeLocator(installedSkillLocatorPath(runtimeRoot, name), runtimeRoot)))).every(Boolean)]);
  checks.push(["installed CLI script", await exists(join(runtimeRoot, "scripts", "pota.mjs"))]);
  checks.push(["installed plan template", await exists(join(runtimeRoot, "templates", "work-plan.md"))]);
  checks.push(["installed model guidance", await exists(join(runtimeRoot, "docs", "model-guidance", "codex.md"))]);
  if (selected("codex")) {
    const config = (await readSharedConfigSnapshot(configPath)).text;
    checks.push(["config marketplace", splitSections(config).some((section) => section.header === "marketplaces.pota")]);
    checks.push(["config plugin enabled", hasSetting(config, 'plugins."pota@pota"', "enabled", "true")]);
  }
  if (selected("claude")) {
    checks.push(["Claude runtime locator", await validRuntimeLocator(claudeRuntimeLocatorPath, runtimeRoot)]);
    const claudePluginManifest = await readJson(join(claudePluginMarketplaceRoot, pluginName, ".claude-plugin", "plugin.json"));
    checks.push(["Claude plugin files", claudePluginManifest?.version === installedVersion
      && await exists(join(claudePluginMarketplaceRoot, ".claude-plugin", "marketplace.json"))
      && await exists(join(claudePluginMarketplaceRoot, pluginName, "hooks", "hooks.json"))]);
    let claudeStatus = null;
    try { claudeStatus = claudeRegistration.status(); } catch { claudeStatus = null; }
    checks.push(["Claude plugin registered", Boolean(claudeStatus?.marketplace && claudeStatus.installed)]);
    checks.push(["Claude plugin enabled", Boolean(claudeStatus?.enabled)]);
    checks.push(["Claude plugin cache version", claudeStatus?.version === installedVersion]);
  }
  if (selected("antigravity")) {
    checks.push(["Antigravity IDE skills", await exists(join(antigravityHome, "skills", "pota-plan", "SKILL.md"))]);
    checks.push(["Antigravity CLI flat skills", await exists(join(antigravityCliHome, "skills", "pota-plan.md"))]);
  }

  if (selected("codex")) {
    const codexStatus = hostJson(["plugin", "list", "--json"], { CODEX_HOME: codexHome });
    const codexEntry = findPluginStatus(codexStatus, "pota@pota");
    checks.push(["Codex plugin installed", Boolean(codexEntry?.installed)]);
    checks.push(["Codex plugin enabled", Boolean(codexEntry?.enabled)]);
    checks.push(["Codex plugin version", codexEntry?.version === installedVersion]);

    const featureResult = spawnSync("codex", ["features", "list"], { encoding: "utf8", env: { ...process.env, CODEX_HOME: codexHome } });
    const featureStates = featureResult.status === 0 && !featureResult.error ? parseCodexFeatureList(featureResult.stdout) : null;
    checks.push(["Codex feature plugins", featureStates?.plugins === true]);
    checks.push(["Codex feature hooks", featureStates?.hooks === true]);
    checks.push(["Codex feature multi_agent", featureStates?.multi_agent === true]);
  }

  if (selected("antigravity")) {
    const agy = spawnSync("agy", ["--version"], { encoding: "utf8", env: process.env });
    checks.push(["Antigravity CLI readiness", !agy.error && agy.status === 0 && /^\d+\.\d+\.\d+/.test(agy.stdout.trim())]);
    checks.push(["Antigravity CLI skill validation", await validateAntigravitySkills(antigravityCliHome, skillNames(), runtimeRoot)]);
  }
  for (const [name, ok] of checks) console.log(`${ok ? "OK" : "FAIL"} ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}


  function injectFailure(point) {
    if (process.env.POTA_TEST_FAIL_PHASE === point) throw new Error(`Injected lifecycle failure: ${point}`);
  }

// The installed copies live under the install root or the Codex cache; comparing real paths keeps a symlinked
// temp or home directory from hiding that the CLI was started from one of them.
function isInsidePath(root, candidate) {
  const real = (path) => { try { return realpathSync(path); } catch { return resolve(path); } };
  const [base, path] = [real(root), real(candidate)];
  return path === base || path.startsWith(`${base}${sep}`);
}

function hostJson(args, extraEnv = {}) {
  const result = spawnSync("codex", args, { encoding: "utf8", env: { ...process.env, ...extraEnv } });
  if (result.error || result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function findPluginStatus(value, id) {
  const entries = Array.isArray(value) ? value : value?.installed ?? value?.plugins ?? value?.data ?? [];
  return entries.find((entry) => entry.pluginId === id || entry.id === id || entry.name === id || `${entry.name}@${entry.marketplaceName ?? entry.marketplace}` === id) ?? null;
}

function parseCodexFeatureList(output) {
  if (typeof output !== "string" || output.trim().length === 0) return null;
  const features = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z0-9_]+)\s+.+?\s+(true|false)$/);
    if (match) features[match[1]] = match[2] === "true";
  }
  return Object.keys(features).length > 0 ? features : null;
}

async function readJson(path) { if (!(await exists(path))) return null; return JSON.parse(await readFile(path, "utf8")); }

  return { doctor, install, uninstall };

  async function exists(path) {
    try { await lstat(path); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  }
}
