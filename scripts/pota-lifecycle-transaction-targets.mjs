import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { potaConfigProjection, readSharedConfigSnapshot, removePotaConfig } from "./pota-lifecycle-config.mjs";

export function createTransactionTargets(context) {
  const { targetDigest, writeTransactionJournal } = context;
async function replaceTarget(target, transaction) {
  let configProjection = null;
  if (target.type === "config") {
    const snapshot = await readSharedConfigSnapshot(target.path);
    configProjection = potaConfigProjection((await readSharedConfigSnapshot(target.staged)).text);
    if (snapshot.digest !== target.configSourceDigest) {
      await writeFile(target.staged, `${removePotaConfig(snapshot.text)}${configProjection}`);
      target.configSourceDigest = snapshot.digest;
    }
  }
  const existed = await exists(target.path);
  const backup = join(transaction.backupRoot, String(transaction.entries.length));
  await mkdir(dirname(backup), { recursive: true });
  const entry = {
    id: target.id,
    phase: target.phase,
    path: target.path,
    type: target.type,
    backup,
    existed,
    previousDigest: existed ? await targetDigest(target.path, target.type) : "missing",
    expectedNewDigest: await targetDigest(target.staged, target.type),
    operation: "replace",
    status: "prepared",
  };
  transaction.entries.push(entry);
  await writeTransactionJournal(transaction);
  if (process.env.POTA_TEST_MUTATE_AFTER_PREFLIGHT_ID === target.id) {
    await writeFile(target.path, process.env.POTA_TEST_MUTATION_CONTENT ?? "concurrent mutation\n");
  }
  if (target.type !== "config" && target.preflightDigest !== undefined
      && await targetDigest(target.path, target.type) !== target.preflightDigest) {
    throw new Error(`Managed artifact changed after lifecycle preflight: ${target.path}`);
  }
  if (target.type === "config" && process.env.POTA_TEST_APPEND_CONFIG_BEFORE_REPLACE) {
    const snapshot = await readSharedConfigSnapshot(target.path);
    await writeFile(target.path, `${snapshot.text}${process.env.POTA_TEST_APPEND_CONFIG_BEFORE_REPLACE}`);
  }
  if (target.type === "config" && process.env.POTA_TEST_REMOVE_CONFIG_BEFORE_REPLACE === "1") {
    await rm(target.path, { force: true });
  }
  if (target.type === "config") {
    let capturedExists = true;
    try {
      await renameLifecycleTarget(target.path, backup, target.id);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      capturedExists = false;
    }
    if (process.env.POTA_TEST_CRASH_AFTER_CONFIG_CAPTURE === "1") process.exit(86);
    const captured = await readSharedConfigSnapshot(backup);
    if (capturedExists) await writeFile(target.staged, `${removePotaConfig(captured.text)}${configProjection}`);
    else await writeFile(target.staged, configProjection);
    entry.existed = capturedExists;
    entry.previousDigest = capturedExists ? await targetDigest(backup, target.type) : "missing";
    entry.expectedNewDigest = await targetDigest(target.staged, target.type);
    await writeTransactionJournal(transaction);
  } else if (existed) await renameLifecycleTarget(target.path, backup, target.id);
  await mkdir(dirname(target.path), { recursive: true });
  await renameStagedLifecycleTarget(target.staged, target.path, target.id);
  entry.status = "applied";
  await writeTransactionJournal(transaction);
}

async function renameStagedLifecycleTarget(source, destination, targetId) {
  if (process.env.POTA_TEST_FORCE_EXDEV_ID === targetId) {
    throw new Error(`Cross-device replacement is not supported safely for lifecycle target: ${targetId}`);
  }
  await renameLifecycleTarget(source, destination, targetId);
}

async function renameLifecycleTarget(source, destination, targetId) {
  try {
    await rename(source, destination);
  } catch (error) {
    if (error?.code === "EXDEV") {
      throw new Error(`Cross-device replacement is not supported safely for lifecycle target: ${targetId}`);
    }
    throw error;
  }
}

async function removeManagedTarget(target, transaction) {
  if (!(await exists(target.path))) throw new Error(`Managed uninstall target is missing: ${target.path}`);
  const backup = join(transaction.backupRoot, String(transaction.entries.length));
  await mkdir(dirname(backup), { recursive: true });
  const entry = {
    id: target.id,
    phase: target.phase,
    path: target.path,
    type: target.type,
    backup,
    existed: true,
    previousDigest: await targetDigest(target.path, target.type),
    expectedNewDigest: "missing",
    operation: "remove",
    status: "prepared",
  };
  transaction.entries.push(entry);
  await writeTransactionJournal(transaction);
  await renameLifecycleTarget(target.path, backup, target.id);
  entry.status = "applied";
  await writeTransactionJournal(transaction);
}


  return { removeManagedTarget, replaceTarget };

  async function exists(path) {
    try { await lstat(path); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  }
}
