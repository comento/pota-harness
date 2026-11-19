import { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { targetDigest } from "../../scripts/pota-lifecycle.mjs";

// node --test also loads files under test/; without tests this module only registers a no-op cleanup there.
export const fakeClaudeCli = resolve("test/fixtures/fake-claude.mjs");
export const root = resolve(".");
export const lifecycleScript = join(root, "scripts", "pota-lifecycle.mjs");
export const releaseVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
// A later release than this checkout, played by a copy of the working tree (see newerCli).
export const newerVersion = (() => {
  const [major, minor] = releaseVersion.split(/[.-]/).map(Number);
  return `${major}.${minor + 1}.0`;
})();
let newerTree;

after(async () => {
  if (newerTree) await rm(await newerTree, { recursive: true, force: true });
});

export async function withHome(fn) {
  const temp = await mkdtemp(join(tmpdir(), "pota-transaction-"));
  const env = {
    ...process.env,
    HOME: join(temp, "home"),
    POTA_HOME: join(temp, "pota-home"),
    // Hooks run from an installed runtime would otherwise start a real comment-checker download.
    POTA_COMMENT_CHECKER: "0",
    CODEX_HOME: join(temp, "codex"),
    CLAUDE_HOME: join(temp, "claude"),
    POTA_CLAUDE_CLI: fakeClaudeCli,
    ANTIGRAVITY_HOME: join(temp, "gemini", "config"),
    ANTIGRAVITY_CLI_HOME: join(temp, "gemini", "antigravity-cli"),
    CODEX_CONFIG_PATH: join(temp, "codex", "config.toml"),
  };
  const install = join(env.POTA_HOME, "install");
  const marketplace = join(install, "codex");
  const codexCache = join(env.CODEX_HOME, "plugins", "cache", "pota");
  const paths = {
    install,
    codexCache,
    marketplace,
    source: join(marketplace, "plugins", "pota"),
    marketplaceJson: join(marketplace, ".agents", "plugins", "marketplace.json"),
    claudeMarketplace: join(install, "claude"),
    runtime: join(install, "runtime", releaseVersion),
    versioned: join(codexCache, "pota", releaseVersion),
    ownership: join(install, "lifecycle.json"),
    lock: join(install, "lifecycle.lock"),
    transaction: join(install, "transaction.json"),
    transactions: join(install, "transactions"),
  };
  try { await fn({ temp, env, paths }); } finally { await rm(temp, { recursive: true, force: true }); }
}

// The lifecycle script of a copy of this working tree (without .git, node_modules, and .omo) whose package.json and
// .codex-plugin/plugin.json name `newerVersion`, so a run can come from another release than the installation.
export async function newerCli() {
  newerTree ??= (async () => {
    const tree = await mkdtemp(join(tmpdir(), "pota-newer-cli-"));
    const excluded = new Set([".git", "node_modules", ".omo"]);
    await cp(root, tree, { recursive: true, filter: (source) => !excluded.has(relative(root, source)) });
    for (const manifestPath of [join(tree, "package.json"), join(tree, ".codex-plugin", "plugin.json")]) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.version = newerVersion;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return tree;
  })();
  return join(await newerTree, "scripts", "pota-lifecycle.mjs");
}

// The current manifest bytes plus the current digest of every artifact it owns.
export async function installationSnapshot(paths) {
  const manifest = await readFile(paths.ownership, "utf8");
  const digests = {};
  const ownership = JSON.parse(manifest);
  for (const record of [...ownership.targets, ...ownership.retained.map((entry) => ({ ...entry, type: "tree" }))]) {
    digests[`${record.id}@${record.path}`] = await targetDigest(record.path, record.type);
  }
  return { manifest, digests };
}

export function claudeLog(env) {
  return readFile(join(env.CLAUDE_HOME, "fake-claude.log"), "utf8").then((text) => text.trim().split("\n"));
}

export function claudeState(env) {
  return readFile(join(env.CLAUDE_HOME, "fake-claude-state.json"), "utf8").then(JSON.parse);
}

export function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

export function run(command, env) {
  return runLifecycle(lifecycleScript, command, env);
}

export function runLifecycle(script, command, env) {
  return spawnSync(process.execPath, [script, command], { cwd: root, env, encoding: "utf8" });
}

export function runArgs(args, env) {
  return spawnSync(process.execPath, [lifecycleScript, ...args], { cwd: root, env, encoding: "utf8" });
}

export function runAsync(command, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [lifecycleScript, command], { cwd: root, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

export function hostToolsAvailable() {
  return commandAvailable("codex") && commandAvailable("agy");
}

export function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return result.error === undefined && result.status === 0;
}

export function pluginList(env) {
  const result = spawnSync("codex", ["plugin", "list", "--json"], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export function journalEntry(record, backup) {
  return {
    id: record.id,
    phase: record.phase,
    path: record.path,
    type: record.type,
    backup,
    existed: true,
    previousDigest: record.installedDigest,
  };
}

export async function writeJournal(paths, journal) {
  await writeFile(paths.transaction, `${JSON.stringify(journal, null, 2)}\n`);
}

// Rewrites a current installation into an owned installation of `version`: both the canonical runtime and the
// Codex cache runtime move to that version and every locator follows the canonical runtime.
export async function rewriteOwnedVersion(paths, version) {
  const ownership = JSON.parse(await readFile(paths.ownership, "utf8"));
  const oldRuntime = join(paths.install, "runtime", version);
  const oldCodexRuntime = join(paths.codexCache, "pota", version);
  await rename(paths.runtime, oldRuntime);
  await rename(paths.versioned, oldCodexRuntime);
  for (const record of ownership.targets) {
    if (record.id === "runtime") record.path = oldRuntime;
    if (record.id === "codex-runtime") record.path = oldCodexRuntime;
    await replaceTextInManagedTarget(record.path, paths.runtime, oldRuntime);
    await replaceTextInManagedTarget(record.path, paths.versioned, oldCodexRuntime);
  }
  for (const manifestPath of [
    join(paths.source, ".codex-plugin", "plugin.json"),
    join(paths.source, "package.json"),
    join(oldRuntime, ".codex-plugin", "plugin.json"),
    join(oldRuntime, "package.json"),
    join(oldCodexRuntime, ".codex-plugin", "plugin.json"),
    join(oldCodexRuntime, "package.json"),
  ]) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  ownership.version = version;
  for (const record of ownership.targets) record.installedDigest = await targetDigest(record.path, record.type);
  await writeFile(paths.ownership, `${JSON.stringify(ownership, null, 2)}\n`);
  return [oldRuntime, oldCodexRuntime];
}

// Turns the current installation into an owned `version` installation and upgrades it to the release, which leaves
// both `version` runtimes retained.
export async function retainVersion(env, paths, version) {
  const oldRuntimes = await rewriteOwnedVersion(paths, version);
  const result = run("upgrade", env);
  assert.equal(result.status, 0, result.stderr);
  for (const oldRuntime of oldRuntimes) await stat(oldRuntime);
  const retained = (await readOwnership(paths)).retained.filter((entry) => entry.version === version);
  assert.deepEqual(retained.map((entry) => entry.path).sort(), [...oldRuntimes].sort());
  return oldRuntimes;
}

export async function readOwnership(paths) {
  return JSON.parse(await readFile(paths.ownership, "utf8"));
}

export async function writeOwnership(paths, ownership) {
  await writeFile(paths.ownership, `${JSON.stringify(ownership, null, 2)}\n`);
}

// retiredAt is not part of any digest, so moving it into the past simulates the grace period passing.
export async function setRetiredAt(paths, daysAgo) {
  const ownership = await readOwnership(paths);
  const retiredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  for (const entry of ownership.retained) entry.retiredAt = retiredAt;
  await writeOwnership(paths, ownership);
}

export async function copyRuntimeAsVersion(source, destination, version) {
  await cp(source, destination, { recursive: true });
  for (const manifestPath of [join(destination, ".codex-plugin", "plugin.json"), join(destination, "package.json")]) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

export async function replaceTextInManagedTarget(path, from, to) {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of await readdir(path, { withFileTypes: true })) await replaceTextInManagedTarget(join(path, entry.name), from, to);
    return;
  }
  const content = await readFile(path, "utf8");
  if (content.includes(from)) await writeFile(path, content.replaceAll(from, to));
}
