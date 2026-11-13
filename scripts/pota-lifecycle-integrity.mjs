import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { potaConfigProjection, readSharedConfigSnapshot } from "./pota-lifecycle-config.mjs";
import { HOSTS, hostOfTarget, isHostSelection } from "./pota-lifecycle-hosts.mjs";
import { antigravityRuntimeLocatorPath } from "./pota-lifecycle-mirror.mjs";

export const OWNERSHIP_SCHEMA_VERSION = 2;
export const OWNERSHIP_ORIGINS = ["checkout", "package"];
// Runtimes a version change leaves behind stay for open sessions: at most this many per id, for this long.
export const RETAINED_RUNTIME_IDS = ["runtime", "codex-runtime"];
export const RETAINED_RUNTIME_LIMIT = 3;
export const RETAINED_RUNTIME_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// Orders release versions by major.minor.patch; a prerelease suffix compares equal to its release.
export function compareVersions(left, right) {
  const parse = (value) => String(value).split("-")[0].split(".").map(Number);
  const [a, b] = [parse(left), parse(right)];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function createIntegrity(context) {
  const {
    antigravityCliHome, antigravityHome, claudeHome, claudePluginMarketplaceRoot, claudeRuntimeLocatorPath,
    commandNames, configPath, installedPluginRoot, layout,
    marketplaceJsonPath, ownershipPath, phases, pluginName,
    releaseVersion, skillNames,
  } = context;
// A journal-only removal (previous runtime) names the record it removes with `ownedBy` and must match
// that record's path, type, and digest. A record claimed that way moves away from its id, so the new target with the
// same id at a different path starts unowned. A retired-runtime removal carries its `retained` entry instead.
async function assertTargetsReplaceable(targets, ownership) {
  const records = new Map((ownership?.targets ?? []).map((record) => [record.id, record]));
  const moved = new Set(targets.filter((target) => target.ownedBy).map((target) => target.ownedBy));
  for (const target of targets) {
    if (!(await exists(target.path))) {
      target.preflightDigest = "missing";
      continue;
    }
    const current = await targetDigest(target.path, target.type);
    target.preflightDigest = current;
    if (target.ownedBy || target.retained) {
      const owner = target.retained ? { ...target.retained, type: "tree" } : records.get(target.ownedBy);
      if (!owner || owner.path !== target.path || owner.type !== target.type) throw new Error(`Removal target does not match ownership manifest: ${target.id}`);
      if (target.type !== "config" && current !== owner.installedDigest) throw new Error(`Managed artifact was modified: ${target.path}`);
      continue;
    }
    const claimed = records.get(target.id);
    const record = claimed && !(moved.has(target.id) && claimed.path !== target.path) ? claimed : undefined;
    const versionedRuntime = target.id === "runtime" || target.id === "codex-runtime";
    // After a version change the release's runtime is owned only when an earlier upgrade retained it. A removal
    // (a deselected host's record) is checked against its own record below.
    if (versionedRuntime && target.operation !== "remove" && ownership && ownership.version !== releaseVersion) {
      const retained = (ownership.retained ?? []).find((entry) => entry.id === target.id && entry.version === releaseVersion);
      if (!retained || retained.path !== target.path || target.type !== "tree") {
        throw new Error(`Refusing to overwrite unmanaged current-version runtime: ${target.path}`);
      }
      if (current !== retained.installedDigest) throw new Error(`Managed artifact was modified: ${target.path}`);
      continue;
    }
    if (!record) {
      if (target.type === "config" && potaConfigProjection((await readSharedConfigSnapshot(target.path)).text).length === 0) continue;
      if (claimed && versionedRuntime) throw new Error(`Refusing to overwrite unmanaged current-version runtime: ${target.path}`);
      throw new Error(`Refusing to overwrite unmanaged artifact: ${target.path}`);
    }
    if (record.path !== target.path || record.type !== target.type) throw new Error(`Ownership manifest target mismatch: ${target.id}`);
    if (target.type !== "config" && current !== record.installedDigest) throw new Error(`Managed artifact was modified: ${target.path}`);
  }
}

async function assertOwnershipDigests(ownership) {
  for (const record of [...ownership.targets, ...(ownership.retained ?? []).map((entry) => ({ ...entry, type: "tree" }))]) {
    const current = await targetDigest(record.path, record.type);
    if (record.type !== "config" && current !== record.installedDigest) {
      throw new Error(`Managed artifact was modified: ${record.path}`);
    }
  }
}

// A retained runtime that no longer exists was removed outside Pota (by Codex or the user) and counts as already
// gone: install, upgrade, and uninstall drop it from the manifest instead of removing or recording it, and doctor does
// not report it. One that exists with other content is still a modified managed artifact.
async function withoutMissingRetained(ownership) {
  if (!Array.isArray(ownership?.retained)) return ownership;
  const retained = [];
  for (const entry of ownership.retained) if (await exists(entry.path)) retained.push(entry);
  return { ...ownership, retained };
}

async function targetRecord(target) {
  return { id: target.id, phase: target.phase, path: target.path, type: target.type, installedDigest: await targetDigest(target.path, target.type), previous: null };
}

async function readOwnership({ required = false } = {}) {
  if (!(await exists(ownershipPath))) {
    if (required) throw new Error(`Ownership manifest is missing: ${ownershipPath}`);
    return null;
  }
  try {
    return JSON.parse(await readFile(ownershipPath, "utf8"));
  } catch {
    throw new Error(`Ownership manifest is invalid: ${ownershipPath}`);
  }
}

function validateOwnershipShape(ownership, { required = false } = {}) {
  if (!ownership) {
    if (required) throw new Error("Ownership manifest is required.");
    return;
  }
  if (!sameKeys(ownership, ["schemaVersion", "plugin", "version", "transactionId", "installedAt", "origin", "hosts", "targets", "retained"])
      || ownership.schemaVersion !== OWNERSHIP_SCHEMA_VERSION || ownership.plugin !== pluginName
      || typeof ownership.version !== "string" || !VERSION_PATTERN.test(ownership.version)
      || typeof ownership.transactionId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(ownership.transactionId)
      || typeof ownership.installedAt !== "string" || Number.isNaN(Date.parse(ownership.installedAt))
      || !OWNERSHIP_ORIGINS.includes(ownership.origin)
      || !isHostSelection(ownership.hosts)
      || !Array.isArray(ownership.targets) || !Array.isArray(ownership.retained)) {
    throw new Error("Ownership manifest schema or plugin identity is invalid.");
  }
  const retainedKeys = new Set();
  for (const record of ownership.retained ?? []) {
    if (!record || !sameKeys(record, ["id", "version", "path", "installedDigest", "retiredAt"])
        || !RETAINED_RUNTIME_IDS.includes(record.id) || typeof record.version !== "string" || !VERSION_PATTERN.test(record.version)
        || record.version === ownership.version || retainedKeys.has(`${record.id}\0${record.version}`)
        || record.path !== retainedRuntimePath(record.id, record.version)
        || typeof record.installedDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.installedDigest)
        || typeof record.retiredAt !== "string" || Number.isNaN(Date.parse(record.retiredAt))
        || ownership.retained.filter((entry) => entry?.id === record.id).length > RETAINED_RUNTIME_LIMIT
        || (record.id === "codex-runtime" && !ownership.hosts.includes("codex"))) {
      throw new Error("Ownership manifest contains an invalid retained runtime.");
    }
    retainedKeys.add(`${record.id}\0${record.version}`);
  }
  const ids = new Set();
  const paths = new Set();
  for (const record of ownership.targets) {
    if (!record || !sameKeys(record, ["id", "phase", "path", "type", "installedDigest", "previous"])
        || typeof record.id !== "string" || record.id.length === 0 || ids.has(record.id)
        || typeof record.path !== "string" || record.path.length === 0 || paths.has(record.path)
        || typeof record.phase !== "string" || !phases.includes(record.phase)
        || typeof record.type !== "string" || !["file", "tree", "config"].includes(record.type)
        || typeof record.installedDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.installedDigest)
        || record.previous !== null) {
      throw new Error("Ownership manifest contains an invalid or duplicate target.");
    }
    const expected = expectedManagedTarget(record.id, ownership.version);
    if (!expected || expected.path !== record.path || expected.phase !== record.phase || expected.type !== record.type) {
      throw new Error(`Ownership manifest target is outside the Pota allowlist: ${record.id}`);
    }
    ids.add(record.id);
    paths.add(record.path);
  }
  const hosts = ownership.hosts;
  const unselected = [...ids].find((id) => !hosts.includes(hostOfTarget(id)) && hostOfTarget(id) !== "core");
  if (unselected) throw new Error(`Ownership manifest schema is inconsistent: ${unselected} belongs to a host that is not selected.`);
  const requiredTargets = requiredOwnershipTargets(ownership.version, hosts);
  if ([...ids].some((id) => !requiredTargets.has(id)) || [...requiredTargets.keys()].some((id) => !ids.has(id))) {
    throw new Error("Ownership manifest does not contain the complete managed target set.");
  }
}

function retainedRuntimePath(id, version) {
  return id === "runtime" ? layout.runtimeRootFor(version) : layout.codexRuntimeRootFor(version);
}

// The core runtime is always required; every other required target belongs to one selected host.
function requiredOwnershipTargets(version = releaseVersion, hosts = HOSTS) {
  const ids = ["runtime", "codex-source", "codex-runtime", "marketplace", "claude-runtime", "claude-plugin", "ide-runtime", "cli-runtime", "codex-config"];
  for (const name of commandNames()) ids.push(`claude-command-${name}`, `ide-workflow-${name}`, `cli-workflow-${name}`);
  for (const name of ["explorer", "worker"]) ids.push(`claude-agent-${name}`);
  for (const name of skillNames()) ids.push(`ide-skill-${name}`, `cli-skill-${name}`);
  const selected = ids.filter((id) => hostOfTarget(id) === "core" || hosts.includes(hostOfTarget(id)));
  return new Map(selected.map((id) => [id, expectedManagedTarget(id, version)]));
}

function expectedManagedTarget(id, version = releaseVersion) {
  const exact = {
    runtime: { phase: "core", path: layout.runtimeRootFor(version), type: "tree" },
    "codex-source": { phase: "codex", path: installedPluginRoot, type: "tree" },
    "codex-runtime": { phase: "codex", path: layout.codexRuntimeRootFor(version), type: "tree" },
    marketplace: { phase: "codex", path: marketplaceJsonPath, type: "file" },
    "claude-runtime": { phase: "claude", path: claudeRuntimeLocatorPath, type: "file" },
    "claude-plugin": { phase: "claude", path: claudePluginMarketplaceRoot, type: "tree" },
    "ide-runtime": { phase: "antigravity", path: antigravityRuntimeLocatorPath(antigravityHome), type: "file" },
    "cli-runtime": { phase: "antigravity", path: antigravityRuntimeLocatorPath(antigravityCliHome), type: "file" },
    "codex-config": { phase: "config", path: configPath, type: "config" },
  };
  if (exact[id]) return exact[id];
  for (const name of commandNames()) {
    if (id === `claude-command-${name}`) return { phase: "claude", path: join(claudeHome, "commands", `pota-${name}.md`), type: "file" };
    if (id === `ide-workflow-${name}`) return { phase: "antigravity", path: join(antigravityHome, "workflows", `pota-${name}.md`), type: "file" };
    if (id === `cli-workflow-${name}`) return { phase: "antigravity", path: join(antigravityCliHome, "workflows", `pota-${name}.md`), type: "file" };
  }
  for (const name of ["explorer", "worker"]) if (id === `claude-agent-${name}`) return { phase: "claude", path: join(claudeHome, "agents", `pota-${name}.md`), type: "file" };
  for (const name of skillNames()) {
    if (id === `ide-skill-${name}`) return { phase: "antigravity", path: join(antigravityHome, "skills", name), type: "tree" };
    if (id === `cli-skill-${name}`) return { phase: "antigravity", path: join(antigravityCliHome, "skills", `${name}.md`), type: "file" };
  }
  return null;
}

async function targetDigest(path, type) {
  if (!(await exists(path))) return "missing";
  if (type === "config") return sha(potaConfigProjection((await readSharedConfigSnapshot(path)).text));
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error(`Managed artifact is not a regular file/tree: ${path}`);
  if (info.isFile()) return sha(await readFile(path));
  const files = await regularFiles(path);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file).update("\0").update(await readFile(join(path, file))).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function regularFiles(root) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error(`Symlink or special file is not allowed in managed tree: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else output.push(relative(root, path).split(sep).join("/"));
    }
  }
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${root}`);
  if (info.isFile()) return [basename(root)];
  await walk(root);
  return output.sort();
}

async function assertRegularTree(path) {
  await regularFiles(path);
}

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

  async function ownershipDigestsValid(ownership) {
    try {
      validateOwnershipShape(ownership, { required: true });
      for (const record of ownership.targets) if (await targetDigest(record.path, record.type) !== record.installedDigest) return false;
      for (const record of ownership.retained ?? []) {
        const digest = await targetDigest(record.path, "tree");
        if (digest !== "missing" && digest !== record.installedDigest) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    assertOwnershipDigests, assertRegularTree,
    assertTargetsReplaceable, expectedManagedTarget, ownershipDigestsValid, readOwnership,
    targetDigest, targetRecord, validateOwnershipShape, withoutMissingRetained,
  };

  function sameKeys(value, expected) {
    return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
  }

  async function exists(path) {
    try { await lstat(path); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  }
}
