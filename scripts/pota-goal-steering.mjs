import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { potaHome, goalStateDirectory } from "./pota-paths.mjs";
import { assertNoSymlinkComponents, safeWriteFile } from "./pota-safe-fs.mjs";

export const STEERING_SCHEMA_VERSION = 1;
export const STEER_KINDS = ["correction", "addition", "redirect"];
export const REPLAN_STEER_VALUES = [...STEER_KINDS, "none"];
export const REASON_MAX_LENGTH = 500;
export const REQUEST_BRIEF_LABELS = ["Original request", "Interpreted outcome", "End state", "Prior records", "Assumptions", "Implicit requirements"];
const PLAN_FILE_MAX_BYTES = 512 * 1024;

export function steeringPath(root = process.cwd()) {
  return join(goalStateDirectory(root), "steering.json");
}

// Reads the plan text when the plan id is a regular repository file of at most 512 KiB without symlink components
// (the same rule as memoryPromotionStatus); otherwise null, meaning the plan cannot be inspected. Never throws.
export function readPlanText(root, planId) {
  try {
    const workspaceRoot = resolve(root);
    const target = resolve(workspaceRoot, String(planId));
    const relation = relative(workspaceRoot, target);
    if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) return null;
    let current = workspaceRoot;
    for (const component of relation.split(sep)) {
      current = join(current, component);
      if (lstatSync(current).isSymbolicLink()) return null;
    }
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size > PLAN_FILE_MAX_BYTES) return null;
    return readFileSync(target, "utf8");
  } catch {
    return null;
  }
}

// Lines of the "## Request Brief" section (up to the next "## " heading), ignoring everything inside code fences.
function requestBriefLines(text) {
  const lines = [];
  let inFence = false;
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^##\s/.test(line)) {
      if (inSection) break;
      inSection = /^##\s+Request Brief\s*$/.test(line);
      continue;
    }
    if (inSection) lines.push(line);
  }
  return lines;
}

const indentOf = (line) => line.length - line.trimStart().length;

// A value is a placeholder when it is empty or only "<...>", optionally behind an item prefix like "A1 (inferred):".
function isPlaceholder(value) {
  const rest = value.trim().replace(/^[A-Za-z]\d+\s*(?:\([^)]*\))?\s*:\s*/, "");
  return rest.length === 0 || /^<.*>$/.test(rest);
}

// A label is filled by a same-line value, or by deeper-indented list items of which at least one is not a placeholder.
function labelFilled(lines, labelPattern) {
  const index = lines.findIndex((line) => labelPattern.test(line));
  if (index === -1) return false;
  const match = lines[index].match(labelPattern);
  if (!isPlaceholder(match[1] ?? "")) return true;
  const indent = indentOf(lines[index]);
  for (const line of lines.slice(index + 1)) {
    if (line.trim().length === 0) continue;
    if (indentOf(line) <= indent) break;
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item && !isPlaceholder(item[1])) return true;
  }
  return false;
}

const labelPattern = (label) => new RegExp(`^\\s*[-*]\\s*${label}\\s*:\\s*(.*)$`);

export function missingRequestBriefLabels(text) {
  const lines = requestBriefLines(text);
  return REQUEST_BRIEF_LABELS.filter((label) => !labelFilled(lines, labelPattern(label)));
}

// Gate 1: null when the plan cannot be inspected or the brief is complete, else the missing labels.
export function requestBriefGateError(root, planId, taskId) {
  const text = readPlanText(root, planId);
  if (text === null) return null;
  const missing = missingRequestBriefLabels(text);
  if (missing.length === 0) return null;
  return `Task ${taskId} requires a filled "## Request Brief" in ${planId}; missing or placeholder: ${missing.join(", ")}. Fill them in the plan (write "none: <reason>" when there is nothing to add), or complete with --allow-no-request-brief <reason> for a plan that predates the Request Brief`;
}

// Gate 4: the n-th steering needs an S<n> entry in the Steering log, and a Current request line for n >= 2 or redirect.
export function steeringBriefError(root, planId, seq, kind) {
  const text = readPlanText(root, planId);
  if (text === null) return null;
  const lines = requestBriefLines(text);
  const entry = new RegExp(`^\\s*[-*]\\s+S${seq}\\s*\\(${kind}\\)\\s*:\\s*(.*)$`);
  const hasEntry = lines.some((line) => {
    const match = line.match(entry);
    return match !== null && !isPlaceholder(match[1]);
  });
  if (!hasEntry) {
    return `Plan ${planId} has no S${seq} entry in the Request Brief Steering log; add "- S${seq} (${kind}): <the user's words> -> <changed assumption or task>" under "Steering log:", then retry`;
  }
  if (seq >= 2 || kind === "redirect") {
    if (!labelFilled(lines, new RegExp(`^\\s*[-*]\\s*Current request \\(as of S${seq}\\)\\s*:\\s*(.*)$`))) {
      return `Plan ${planId} has no "Current request (as of S${seq})" line in the Request Brief; rewrite the current request in one paragraph as "- Current request (as of S${seq}): <current request>" and show it to the user, then retry`;
    }
  }
  return null;
}

export function validSteerKind(value, { allowNone = false, label = "--kind" } = {}) {
  const allowed = allowNone ? REPLAN_STEER_VALUES : STEER_KINDS;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join("|")}`);
  }
  return value;
}

// User text is stored as one line without control characters, at most 500 characters (extra characters are dropped).
export function steeringReason(value) {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
  if (text.length === 0) throw new Error("--reason must be a non-empty string");
  return Array.from(text).slice(0, REASON_MAX_LENGTH).join("");
}

function isEntry(value) {
  return Boolean(value) && typeof value === "object"
    && (value.seq === null || Number.isInteger(value.seq))
    && (value.kind === "none" || STEER_KINDS.includes(value.kind));
}

// An entry list for this goal; another goal's file, a symlink, or unreadable content reads as empty. Never throws.
export function readSteeringEntries(root, goalId) {
  try {
    const path = steeringPath(root);
    let current = potaHome();
    for (const component of relative(current, path).split(sep)) {
      current = join(current, component);
      if (lstatSync(current).isSymbolicLink()) return [];
    }
    if (!lstatSync(path).isFile()) return [];
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value?.schemaVersion !== STEERING_SCHEMA_VERSION || value.goalId !== goalId || !Array.isArray(value.entries)) return [];
    return value.entries.filter(isEntry);
  } catch {
    return [];
  }
}

export function steeringCounts(entries) {
  const counts = { total: 0, correction: 0, addition: 0, redirect: 0 };
  for (const entry of entries) {
    if (entry.seq === null || !STEER_KINDS.includes(entry.kind)) continue;
    counts.total += 1;
    counts[entry.kind] += 1;
  }
  return counts;
}

export const nextSteeringSeq = (entries) => entries.filter((entry) => entry.seq !== null).length + 1;

// Callers hold the state lock. Temporary file + rename keeps readers on a whole file.
export async function writeSteeringEntriesUnlocked(root, goalId, entries) {
  const path = steeringPath(root);
  await assertNoSymlinkComponents(potaHome(), dirname(path));
  // A symlinked steering.json reads as empty; replace the link itself, never its target.
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) await rm(path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const body = `${JSON.stringify({ schemaVersion: STEERING_SCHEMA_VERSION, goalId, entries })}\n`;
  try {
    await safeWriteFile(potaHome(), temporaryPath, body, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function removeSteeringUnlocked(root) {
  const path = steeringPath(root);
  try {
    await assertNoSymlinkComponents(potaHome(), path);
    await rm(path, { force: true });
  } catch {
    // The file is a goal-scoped note; a goalId mismatch already makes a leftover harmless.
  }
}

// Validates a steering against the plan and returns the entry to store (not yet written). Throws before any write.
export function prepareSteeringEntry({ root, state, entries, kind, reason, replan }) {
  const text = steeringReason(reason);
  const seq = kind === "none" ? null : nextSteeringSeq(entries);
  if (seq !== null) {
    const message = steeringBriefError(root, state.goal.planId, seq, kind);
    if (message) throw new Error(message);
  }
  return { seq, kind, reason: text, at: new Date().toISOString(), replan };
}

const PLAN_STEERING_DEFAULT_LIMIT = 20;
const PLAN_STEERING_TEXT_MAX = 200;

export function validPlanSteeringLimit(value) {
  if (value === undefined || value === null) return PLAN_STEERING_DEFAULT_LIMIT;
  const text = String(value);
  const result = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(result) || result < 1 || result > 200) throw new Error("--limit must be an integer between 1 and 200");
  return result;
}

// Read-only summary of the steering entries recorded in docs/plan/*.md Request Briefs, newest plan first.
// Unreadable files are skipped; nothing is written.
export function planSteeringReport(root, { limit } = {}) {
  const max = validPlanSteeringLimit(limit);
  const directory = join(resolve(root), "docs", "plan");
  let names = [];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".md"));
  } catch {
    names = [];
  }
  const found = [];
  for (const name of names) {
    const plan = `docs/plan/${name}`;
    const text = readPlanText(root, plan);
    if (text === null) continue;
    const entries = [];
    for (const line of requestBriefLines(text)) {
      const match = line.match(/^\s*[-*]\s+S(\d+)\s*\((correction|addition|redirect)\)\s*:\s*(.*)$/);
      if (!match || isPlaceholder(match[3])) continue;
      const value = match[3].replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
      entries.push({ seq: Number(match[1]), kind: match[2], text: Array.from(value).slice(0, PLAN_STEERING_TEXT_MAX).join("") });
    }
    if (entries.length === 0) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = lstatSync(join(directory, name)).mtimeMs;
    } catch {
      // keep 0
    }
    found.push({ plan, entries, mtimeMs });
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs || a.plan.localeCompare(b.plan));
  const plans = found.slice(0, max).map(({ plan, entries }) => ({ plan, entries }));
  const byKind = { correction: 0, addition: 0, redirect: 0 };
  let total = 0;
  for (const plan of plans) {
    for (const entry of plan.entries) {
      byKind[entry.kind] += 1;
      total += 1;
    }
  }
  return { schemaVersion: 1, plans, total, byKind };
}
