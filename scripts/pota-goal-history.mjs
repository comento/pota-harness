import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { potaHome, goalStateDirectory, repositoryId } from "./pota-paths.mjs";
import { assertNoSymlinkComponents, safeWriteFile } from "./pota-safe-fs.mjs";

export const GOAL_HISTORY_SCHEMA_VERSION = 1;
export const GOAL_HISTORY_MAX_RECORDS = 200;
export const GOAL_HISTORY_LIMIT_MAX = 200;
const TITLE_MAX_LENGTH = 120;
const PLAN_FILE_MAX_BYTES = 512 * 1024;
const RECENT_MAX = 5;
const TREND_MIN_COMPLETED = 4;
const historyStatuses = new Set(["completed", "cancelled"]);
const memoryPromotionValues = ["note", "none", "missing", "unknown"];
const memoryPromotionLine = /^\s*(?:[-*]\s*)?Memory promotion\s*:\s*(.*)$/gim;

export function goalHistoryPath(root = process.cwd()) {
  return join(goalStateDirectory(root), "history.jsonl");
}

export function memoryPromotionReminder(planId) {
  return `Pota memory: plan ${planId} has no "Memory promotion:" line. If this goal produced reusable repository knowledge, write it to docs/memory/<domain>.md and run pota memory index; otherwise record "Memory promotion: none: <reason>" in the plan.`;
}

// Classifies the plan's memory promotion decision. Anything that is not a regular repository file of at most
// 512 KiB (an id such as plan-status, a symlink, a directory, a path outside root) is "unknown"; never throws.
export function memoryPromotionStatus(root, planId) {
  try {
    const workspaceRoot = resolve(root);
    const target = resolve(workspaceRoot, String(planId));
    const relation = relative(workspaceRoot, target);
    if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) return "unknown";
    let current = workspaceRoot;
    for (const component of relation.split(sep)) {
      current = join(current, component);
      if (lstatSync(current).isSymbolicLink()) return "unknown";
    }
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size > PLAN_FILE_MAX_BYTES) return "unknown";
    const text = readFileSync(target, "utf8");
    for (const match of text.matchAll(memoryPromotionLine)) {
      const value = match[1].trim();
      if (value.length === 0 || /^<.*>$/.test(value)) continue;
      return /^(?:none|없음)/i.test(value) ? "none" : "note";
    }
    return "missing";
  } catch {
    return "unknown";
  }
}

// Builds the schemaVersion 1 summary of a terminal goal. It carries ids and counts only, never absolute paths.
export function buildGoalHistoryRecord(state, { root = process.cwd(), recordedBy, endedAt = state.goal.updatedAt } = {}) {
  const { goal, tasks, receipts } = state;
  const createdMs = Date.parse(goal.createdAt);
  const endedMs = Date.parse(endedAt);
  const durationMs = Number.isFinite(createdMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - createdMs) : 0;
  const byKind = {};
  const latest = new Set();
  let reruns = 0;
  // Same rerun definition as goalStats: a later receipt for an already-seen scope, task, and kind.
  for (const receipt of receipts) {
    byKind[receipt.kind] = (byKind[receipt.kind] ?? 0) + 1;
    const key = `${receipt.scope}\0${receipt.taskId ?? ""}\0${receipt.kind}`;
    if (latest.has(key)) reruns += 1;
    latest.add(key);
  }
  const models = {};
  const efforts = {};
  for (const task of tasks) {
    if (task.model) models[task.model] = (models[task.model] ?? 0) + 1;
    if (task.effort) efforts[task.effort] = (efforts[task.effort] ?? 0) + 1;
  }
  return {
    schemaVersion: GOAL_HISTORY_SCHEMA_VERSION,
    goalId: goal.id,
    planId: goal.planId,
    title: Array.from(goal.title).slice(0, TITLE_MAX_LENGTH).join(""),
    status: goal.status,
    worktreeId: goal.worktreeId ?? null,
    createdAt: goal.createdAt,
    endedAt,
    durationMs,
    revision: state.revision,
    evidencePolicy: goal.evidencePolicy,
    tasks: {
      total: tasks.length,
      completed: tasks.filter((task) => task.status === "completed").length,
      heavy: tasks.filter((task) => task.route === "heavy").length,
      light: tasks.filter((task) => task.route === "light").length,
      delegated: tasks.filter((task) => task.assignedAgentId).length,
      design: tasks.filter((task) => task.kind === "design").length,
    },
    receipts: {
      total: receipts.length,
      tool: receipts.filter((receipt) => receipt.source === "tool").length,
      reruns,
      byKind,
    },
    waivers: {
      effort: tasks.filter((task) => task.effortWaiver).length,
      design: tasks.filter((task) => task.designWaiver).length,
    },
    models,
    efforts,
    memoryPromotion: memoryPromotionStatus(root, goal.planId),
    recordedBy,
  };
}

// Records a terminal goal while the caller holds the goal state lock. History is best effort: it never throws, and
// the caller reports a returned error instead of blocking the transition.
export async function recordGoalHistoryUnlocked(root, state, options) {
  let record = null;
  try {
    record = buildGoalHistoryRecord(state, { ...options, root });
    await writeGoalHistoryRecordUnlocked(root, record);
    return { record, error: null };
  } catch (error) {
    return { record, error };
  }
}

// Keeps valid lines only, replaces a record with the same goalId, appends, and keeps the newest 200 records.
// The state lock serializes writers per worktree; temporary file + rename keeps readers on a whole file.
export async function writeGoalHistoryRecordUnlocked(root, record) {
  const path = goalHistoryPath(root);
  await assertNoSymlinkComponents(potaHome(), path);
  const { records } = await readHistoryFile(path);
  const kept = records.filter((item) => item.goalId !== record.goalId);
  kept.push(record);
  const text = kept.slice(-GOAL_HISTORY_MAX_RECORDS).map((item) => JSON.stringify(item)).join("\n");
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await safeWriteFile(potaHome(), temporaryPath, `${text}\n`, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readHistoryFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], skippedLines: 0 };
    throw error;
  }
  const records = [];
  let skippedLines = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      value = null;
    }
    if (isHistoryRecord(value)) records.push(value);
    else skippedLines += 1;
  }
  return { records, skippedLines };
}

function isHistoryRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && value.schemaVersion === GOAL_HISTORY_SCHEMA_VERSION
    && typeof value.goalId === "string" && value.goalId.length > 0
    && historyStatuses.has(value.status)
    && typeof value.endedAt === "string" && Number.isFinite(Date.parse(value.endedAt));
}

// Reads every worktree history of this repository without taking locks or creating directories.
async function readRepositoryHistory(root) {
  const worktreesDirectory = join(potaHome(), "projects", repositoryId(root), "worktrees");
  let entries;
  try {
    await assertNoSymlinkComponents(potaHome(), worktreesDirectory);
    entries = await readdir(worktreesDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { records: [], skippedLines: 0 };
    throw error;
  }
  const byGoal = new Map();
  let skippedLines = 0;
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(worktreesDirectory, entry.name, "history.jsonl");
    try {
      if (!(await lstat(path)).isFile()) continue;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const file = await readHistoryFile(path);
    skippedLines += file.skippedLines;
    for (const record of file.records) {
      const existing = byGoal.get(record.goalId);
      if (!existing || Date.parse(record.endedAt) > Date.parse(existing.endedAt)) byGoal.set(record.goalId, record);
    }
  }
  return { records: [...byGoal.values()], skippedLines };
}

export function validHistoryLimit(value) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  const result = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(result) || result < 1 || result > GOAL_HISTORY_LIMIT_MAX) {
    throw new Error(`--limit must be an integer between 1 and ${GOAL_HISTORY_LIMIT_MAX}`);
  }
  return result;
}

// Repository-wide summary across goals. Medians, p90, rates, and trend use completed goals only; limit keeps the
// newest N records by endedAt.
export async function goalHistoryStats({ root = process.cwd(), limit } = {}) {
  const normalizedLimit = validHistoryLimit(limit);
  const history = await readRepositoryHistory(root);
  const ordered = history.records.sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt) || a.goalId.localeCompare(b.goalId));
  const records = normalizedLimit === null ? ordered : ordered.slice(-normalizedLimit);
  if (records.length === 0) {
    return {
      schemaVersion: GOAL_HISTORY_SCHEMA_VERSION,
      scope: "repository",
      goals: 0,
      ...(history.skippedLines > 0 ? { skippedLines: history.skippedLines } : {}),
    };
  }
  const completed = records.filter((record) => record.status === "completed");
  const memoryPromotion = Object.fromEntries(memoryPromotionValues.map((value) => [value, 0]));
  for (const record of records) {
    const value = memoryPromotionValues.includes(record.memoryPromotion) ? record.memoryPromotion : "unknown";
    memoryPromotion[value] += 1;
  }
  const durations = completed.map((record) => count(record.durationMs)).sort((a, b) => a - b);
  const receiptTotals = completed.map((record) => count(record.receipts?.total));
  return {
    schemaVersion: GOAL_HISTORY_SCHEMA_VERSION,
    scope: "repository",
    goals: records.length,
    completed: completed.length,
    cancelled: records.length - completed.length,
    skippedLines: history.skippedLines,
    window: { from: records[0].endedAt, to: records.at(-1).endedAt },
    durationMs: { median: median(durations), p90: durations.length === 0 ? 0 : durations[Math.ceil(0.9 * durations.length) - 1] },
    tasks: {
      total: sum(completed, (record) => record.tasks?.total),
      median: median(completed.map((record) => count(record.tasks?.total))),
      heavy: sum(completed, (record) => record.tasks?.heavy),
      light: sum(completed, (record) => record.tasks?.light),
      delegated: sum(completed, (record) => record.tasks?.delegated),
    },
    receipts: {
      total: sum(completed, (record) => record.receipts?.total),
      tool: sum(completed, (record) => record.receipts?.tool),
      reruns: sum(completed, (record) => record.receipts?.reruns),
      rerunRate: rerunRate(completed),
      median: median(receiptTotals),
    },
    waivers: {
      effort: sum(records, (record) => record.waivers?.effort),
      design: sum(records, (record) => record.waivers?.design),
    },
    memoryPromotion,
    trend: trend(completed),
    recent: records.slice(-RECENT_MAX).reverse().map((record) => ({
      goalId: record.goalId,
      planId: record.planId,
      status: record.status,
      endedAt: record.endedAt,
      durationMs: count(record.durationMs),
      tasks: count(record.tasks?.total),
      receipts: count(record.receipts?.total),
      reruns: count(record.receipts?.reruns),
      memoryPromotion: record.memoryPromotion,
    })),
  };
}

// Completed goals in endedAt order split in half; an odd count gives newer the extra goal.
function trend(completed) {
  if (completed.length < TREND_MIN_COMPLETED) return null;
  const middle = Math.floor(completed.length / 2);
  const summarize = (records) => ({
    goals: records.length,
    durationMsMedian: median(records.map((record) => count(record.durationMs))),
    receiptsMedian: median(records.map((record) => count(record.receipts?.total))),
    rerunRate: rerunRate(records),
  });
  return { older: summarize(completed.slice(0, middle)), newer: summarize(completed.slice(middle)) };
}

function rerunRate(records) {
  const total = sum(records, (record) => record.receipts?.total);
  const reruns = sum(records, (record) => record.receipts?.reruns);
  return Number((reruns / Math.max(1, total)).toFixed(3));
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function sum(records, pick) {
  return records.reduce((total, record) => total + count(pick(record)), 0);
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
