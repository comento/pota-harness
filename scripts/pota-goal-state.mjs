import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { potaHome, goalStateDirectory } from "./pota-paths.mjs";
import { assertNoSymlinkComponents, safeMkdir, safeWriteFile, withStateLock } from "./pota-safe-fs.mjs";
import { migrateState, validateState } from "./pota-goal-state-validation.mjs";

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
