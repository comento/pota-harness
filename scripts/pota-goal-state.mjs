import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { potaHome, goalStateDirectory } from "./pota-paths.mjs";
import { assertNoSymlinkComponents, safeMkdir, safeWriteFile, withStateLock } from "./pota-safe-fs.mjs";
import { migrateState, validateState } from "./pota-goal-state-validation.mjs";
import { classifyModel, isBelowTier } from "./pota-model-tier.mjs";

export function goalStatePath(root = process.cwd()) {
  return join(goalStateDirectory(root), "state.json");
}

export async function readGoalState({ root = process.cwd() } = {}) {
  const state = await readCurrentGoalState(root);
  if (state) return state;
  // Read-only callers (hooks) must not create user-home state directories when there is nothing to migrate.
  if (!(await legacyGoalStateExists(root))) return null;
  return withGoalStateLock(root, () => readGoalStateUnlocked(root));
}

export function stopGuardPath(root = process.cwd()) {
  return hookGuardPath(root, "stop");
}

export function hookGuardPath(root = process.cwd(), name) {
  return join(goalStateDirectory(root), `${name}-guard.json`);
}

export async function readStopGuard(root = process.cwd()) {
  return readHookGuard(root, "stop");
}

export async function writeStopGuard(root = process.cwd(), value) {
  return writeHookGuard(root, "stop", value);
}

export async function readHookGuard(root = process.cwd(), name) {
  try {
    const path = hookGuardPath(root, name);
    await assertNoSymlinkComponents(potaHome(), path);
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export async function writeHookGuard(root = process.cwd(), name, value) {
  try {
    await safeWriteFile(potaHome(), hookGuardPath(root, name), `${JSON.stringify(value)}\n`, "utf8");
  } catch {
    // Guards only deduplicate hook output; failing to persist one must not break the hook.
  }
}

const MAIN_MODEL_RECORDS_MAX = 8;
const MAIN_MODEL_RECORD_NAME = /^main-model-[0-9a-f]{16}\.json$/;
const OFF_VALUES = new Set(["0", "false", "off", "no"]);

// The CLI's session key on Claude Code; other hosts leave it unset and fall back to the goal owner.
export function hostSessionId(env = process.env) {
  const value = typeof env?.CLAUDE_CODE_SESSION_ID === "string" ? env.CLAUDE_CODE_SESSION_ID.trim() : "";
  return value.length >= 1 && value.length <= 128 ? value : null;
}

// On by default. POTA_MAIN_MODEL_GATE=0|false|off|no turns off the hook's model observation and both CLI gates.
export function mainModelGateEnabled(env = process.env) {
  const raw = env?.POTA_MAIN_MODEL_GATE;
  return !(typeof raw === "string" && OFF_VALUES.has(raw.trim().toLowerCase()));
}

// One file per session, so a session never reads and rewrites another session's record.
export function mainModelRecordPath(root, sessionKey) {
  const digest = createHash("sha256").update(sessionKey, "utf8").digest("hex").slice(0, 16);
  return join(goalStateDirectory(root), `main-model-${digest}.json`);
}

// A symlink, directory, or other non-regular file, unreadable JSON, or a record keyed to another session reads as none.
async function readMainModelFile(root, sessionKey) {
  try {
    const path = mainModelRecordPath(root, sessionKey);
    await assertNoSymlinkComponents(potaHome(), path);
    if (!(await lstat(path)).isFile()) return null;
    const value = JSON.parse(await readFile(path, "utf8"));
    return value?.schemaVersion === 1 && value.sessionKey === sessionKey ? value : null;
  } catch {
    return null;
  }
}

// Only a record below the floor (stronger, or the capped stronger tier under a model ceiling) gates; the stored tier is
// re-derived so an edited or stale file never widens the gate.
export async function readMainModelRecord(root, sessionKey, floor = "stronger") {
  if (typeof sessionKey !== "string" || sessionKey.length === 0) return null;
  const model = (await readMainModelFile(root, sessionKey))?.model;
  const classified = classifyModel(model);
  return classified && isBelowTier(classified.tier, floor) ? { model, tier: classified.tier, host: classified.host } : null;
}

// Records a below-stronger session (entry) or clears it (null). Only recording creates the worktree state directory;
// write and delete errors are swallowed like the other hook guards.
export async function syncMainModelRecord(root, sessionKey, entry, { now = new Date() } = {}) {
  const current = await readMainModelFile(root, sessionKey);
  const path = mainModelRecordPath(root, sessionKey);
  if (entry) {
    if (current?.model === entry.model) return "unchanged";
    const record = { schemaVersion: 1, sessionKey, model: entry.model, tier: entry.tier, host: entry.host, at: now.toISOString() };
    try {
      await ensureGoalStateDirectory(root);
      await safeWriteFile(potaHome(), path, `${JSON.stringify(record)}\n`, "utf8");
      await pruneMainModelRecords(root, path);
    } catch {
      // A missing record only means no gate for this session.
    }
    return "recorded";
  }
  if (!current) return "unchanged";
  await rm(path).catch(() => {});
  return "cleared";
}

// Keeps at most MAIN_MODEL_RECORDS_MAX session records, removing the oldest by mtime but never the one just written.
async function pruneMainModelRecords(root, keepPath) {
  const directory = goalStateDirectory(root);
  const names = (await readdir(directory)).filter((name) => MAIN_MODEL_RECORD_NAME.test(name));
  if (names.length <= MAIN_MODEL_RECORDS_MAX) return;
  const records = [];
  for (const name of names) {
    const path = join(directory, name);
    const stat = await lstat(path).catch(() => null);
    if (stat?.isFile()) records.push({ path, name, mtimeMs: stat.mtimeMs });
  }
  const removable = records
    .filter((record) => record.path !== keepPath)
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
  for (const { path } of removable.slice(0, Math.max(0, records.length - MAIN_MODEL_RECORDS_MAX))) {
    await rm(path).catch(() => {});
  }
}

async function legacyGoalStateExists(root) {
  try {
    await lstat(join(resolve(root), ".pota", "state.json"));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

export async function writeGoalState({ root = process.cwd(), state } = {}) {
  return withGoalStateLock(root, () => writeGoalStateUnlocked({ root, state }));
}

export async function writeGoalStateUnlocked({ root = process.cwd(), state } = {}) {
  const validated = validateState(state);
  const path = goalStatePath(root);
  await ensureGoalStateDirectory(root);
  await assertNoSymlinkComponents(potaHome(), path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await safeWriteFile(potaHome(), temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readGoalStateUnlocked(root) {
  return await readCurrentGoalState(root) ?? migrateLegacyGoalState(root);
}

async function readCurrentGoalState(root) {
  try {
    const path = goalStatePath(root);
    await assertNoSymlinkComponents(potaHome(), path);
    return validateState(migrateState(JSON.parse(await readFile(path, "utf8"))));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error(`Pota goal state is invalid JSON: ${error.message}`);
    throw error;
  }
}

async function migrateLegacyGoalState(root) {
  const legacyPath = join(resolve(root), ".pota", "state.json");
  try {
    await assertNoSymlinkComponents(root, legacyPath, { allowMissing: false });
    const state = validateState(migrateState(JSON.parse(await readFile(legacyPath, "utf8"))));
    await writeGoalStateUnlocked({ root, state });
    await rm(legacyPath);
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error(`Pota goal state is invalid JSON: ${error.message}`);
    throw error;
  }
}

export async function withGoalStateLock(root, operation) {
  await ensureGoalStateDirectory(root);
  return withStateLock(goalStateDirectory(root), operation);
}

async function ensureGoalStateDirectory(root) {
  const home = potaHome();
  let existingAncestor = home;
  while (true) {
    try {
      const stat = await lstat(existingAncestor);
      if (!stat.isDirectory()) throw new Error(`Pota home ancestor is not a directory: ${existingAncestor}`);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      existingAncestor = parent;
    }
  }
  await safeMkdir(existingAncestor, relative(existingAncestor, goalStateDirectory(root)));
}
