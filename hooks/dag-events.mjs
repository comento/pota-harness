// Pure event policy of the DAG pane: which commands change the goal, how tool calls are summarized,
// how subagents are matched to tasks, how fetched states fold together, and when to open or refresh.
// TypeScript reads this module's types from dag-events.d.mts.

import { planKey } from "./dag-model.mjs";

export const MAIN_AGENT_ID = "main";
export const MAX_AGENTS = 16;
export const MUTATING_SUBS = new Set(["start", "replan", "task", "claim", "assign", "receipt", "verify", "finish", "pause", "resume", "block", "cancel", "complete", "gate"]);
const PLANNING_SUBS = new Set(["start", "replan"]);
const GOAL_COMMAND = /(?:^|[\s"'/\\;&|(])pota(?:\.mjs)?["']?\s+goal\s+([a-z]+)\b/g;
const ROOT_FLAG = /--root(?:=|\s+)("[^"]+"|'[^']+'|\S+)/;

const READ_ONLY_SUBS = new Set(["status", "ready", "stats"]);
const VARIABLE_GOAL_COMMAND = /(?:^|[\s;&|(])["']?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?["']?\s+goal\s+([a-z]+)\b/g;

/**
 * @param {string} command a Bash command line
 * @returns {{ subs: string[], mutates: boolean, planned: boolean, root: string | null } | null}
 */
export function parsePotaGoalCommand(command) {
  const text = String(command ?? "");
  let subs = [...text.matchAll(GOAL_COMMAND)].map((match) => match[1]);
  // `P=/…/pota.mjs; node "$P" goal start`: the CLI path sits in a shell variable, so the goal call names no pota.
  if (subs.length === 0 && /\bpota\b/.test(text)) {
    subs = [...text.matchAll(VARIABLE_GOAL_COMMAND)].map((match) => match[1]).filter((sub) => MUTATING_SUBS.has(sub) || READ_ONLY_SUBS.has(sub));
  }
  if (subs.length === 0) return null;
  const flag = text.match(ROOT_FLAG);
  let root = flag ? flag[1] : null;
  if (root && /^(["']).*\1$/.test(root)) root = root.slice(1, -1);
  return {
    subs,
    mutates: subs.some((sub) => MUTATING_SUBS.has(sub)),
    planned: subs.some((sub) => PLANNING_SUBS.has(sub)),
    root,
  };
}

// Paths are plain strings here: both separators, and drive or UNC prefixes, since the pane runs on Windows too.
const PATH_PREFIX = /^(?:\\\\|[A-Za-z]:[\\/]|\/)/;
// A UNC path's prefix runs to the share: `..` never climbs to the server.
const UNC_PREFIX = /^\\\\[^\\/]+(?:[\\/]+[^\\/]+)?/;

/** @param {string} path */
export function isAbsolutePath(path) {
  return PATH_PREFIX.test(String(path ?? ""));
}

/** @param {string} path */
function splitPath(path) {
  const text = String(path ?? "");
  const prefix = text.match(UNC_PREFIX)?.[0] ?? text.match(PATH_PREFIX)?.[0] ?? "";
  const sep = text.includes("\\") && !text.includes("/") ? "\\" : "/";
  return { prefix, sep, parts: text.slice(prefix.length).split(/[\\/]+/).filter(Boolean) };
}

/** `..` never climbs above the prefix. */
function formatPath({ prefix, sep, parts }) {
  /** @type {string[]} */
  const kept = [];
  for (const part of parts) {
    if (part === "..") kept.pop();
    else if (part !== ".") kept.push(part);
  }
  if (prefix.length > 2 && prefix.startsWith("\\\\")) return kept.length === 0 ? prefix : `${prefix}${sep}${kept.join(sep)}`;
  const head = /^[A-Za-z]:/.test(prefix) ? `${prefix.slice(0, 2)}${sep}` : prefix;
  return `${head}${kept.join(sep)}` || ".";
}

/**
 * `path` resolved against `base`; an absolute `path` wins. No trailing separator.
 * @param {string} base
 * @param {string} path
 */
export function joinPath(base, path) {
  if (isAbsolutePath(path)) return formatPath(splitPath(path));
  const at = splitPath(base);
  return formatPath({ ...at, parts: [...at.parts, ...splitPath(path).parts] });
}

/**
 * Same place after normalizing; drive and UNC paths compare without case. Null on either side is never the same.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function samePath(a, b) {
  if (a == null || b == null) return false;
  const key = (path) => {
    const value = joinPath(path, ".").replace(/\\/g, "/");
    return /^(?:[A-Za-z]:|\/\/)/.test(value) ? value.toLowerCase() : value;
  };
  return key(a) === key(b);
}

/**
 * The path, then each parent up to the root.
 * @param {string} path
 */
export function ancestorPaths(path) {
  const at = splitPath(joinPath(path, "."));
  const list = [];
  for (let count = at.parts.length; count >= 0; count -= 1) {
    if (count === 0 && at.prefix === "") break;
    list.push(formatPath({ ...at, parts: at.parts.slice(0, count) }));
  }
  return list;
}

/**
 * The last two segments with `/` separators, or the whole path when it has two or fewer.
 * @param {string} root
 */
export function rootLabel(root) {
  const at = splitPath(joinPath(root, "."));
  if (at.parts.length <= 2) return formatPath({ ...at, sep: "/" });
  return `…/${at.parts.slice(-2).join("/")}`;
}

const SHELL_VALUE = String.raw`("[^"]*"|'[^']*'|[^\s;&|()]+)`;
const CHANGE_DIR = new RegExp(String.raw`(?:^|&&|;|\(|\n)\s*(?:cd|pushd)(?=[\s;&|)]|$)[^\S\n]*${SHELL_VALUE}?`, "g");
const ROOT_IN_CALL = new RegExp(String.raw`(?:^|\s)--root(?:=|\s+)${SHELL_VALUE}`, "g");
const ROOT_IN_ENV = new RegExp(String.raw`(?:^|[\s;&|(])HARNESS_REPO_ROOT=${SHELL_VALUE}`, "g");
const ROOT_EXPORTED = new RegExp(String.raw`(?:^|[\s;&|(])export\s+HARNESS_REPO_ROOT=${SHELL_VALUE}`, "g");
const CALL_END = /&&|\|\||;|\||\n/g;
const SEGMENT_START = /&&|\|\||;|\||\(|\n/g;

/**
 * Whether `index` sits inside a quoted string of `text`, read from the start of the line.
 * @param {string} text
 * @param {number} index
 */
function inQuotes(text, index) {
  let quote = "";
  for (let at = 0; at < index; at += 1) {
    const char = text[at];
    if (quote === "'") {
      if (char === "'") quote = "";
    } else if (char === "\\") {
      at += 1;
    } else if (char === quote) {
      quote = "";
    } else if (quote === "" && (char === '"' || char === "'")) {
      quote = char;
    }
  }
  return quote !== "";
}

/**
 * Where the first goal-changing call runs: the directory after the `cd`/`pushd` steps before it, and
 * its `--root` or `HARNESS_REPO_ROOT` resolved there. Null when any of these cannot be read statically:
 * a wrong root is worse than none.
 * @param {string} command
 * @param {string} cwd
 * @returns {{ dir: string, explicitRoot: string | null } | null}
 */
export function goalCommandTarget(command, cwd) {
  const text = String(command ?? "");
  if (!isAbsolutePath(cwd)) return null;
  const mutating = (pattern) => [...text.matchAll(pattern)].find((match) => MUTATING_SUBS.has(match[1]));
  // Same fallback as parsePotaGoalCommand: a CLI path held in a shell variable.
  const call = mutating(GOAL_COMMAND) ?? (/\bpota\b/.test(text) ? mutating(VARIABLE_GOAL_COMMAND) : undefined);
  if (!call) return null;
  const value = (token) => {
    if (token === undefined) return null;
    const quoted = /^(["']).*\1$/s.test(token);
    const plain = quoted ? token.slice(1, -1) : token;
    if (/[$`*?"']/.test(plain) || plain.startsWith("~") || plain === "-") return null;
    if (!quoted && cwd.startsWith("/") && plain.includes("\\")) return null;
    return plain;
  };
  const outside = (pattern, from, to) => [...text.matchAll(pattern)]
    .filter((match) => match.index >= from && match.index < to && !inQuotes(text, match.index));
  let dir = cwd;
  for (const match of outside(CHANGE_DIR, 0, call.index)) {
    const step = value(match[1]);
    // `cd -P wt`: an option, and what follows it is not read.
    if (step === null || step.startsWith("-")) return null;
    dir = joinPath(dir, step);
  }
  const callEnd = outside(CALL_END, call.index + call[0].length, text.length)[0]?.index ?? text.length;
  // HARNESS_REPO_ROOT reaches the call only as a prefix in its own segment, or exported before it.
  const segment = /^[;&|(\n]/.test(call[0]) ? call.index : (outside(SEGMENT_START, 0, call.index).at(-1)?.index ?? 0);
  const flag = outside(ROOT_IN_CALL, call.index, callEnd)[0]
    ?? outside(ROOT_IN_ENV, segment, call.index).at(-1)
    ?? outside(ROOT_EXPORTED, 0, call.index).at(-1);
  if (!flag) return { dir, explicitRoot: null };
  const root = value(flag[1]);
  return root === null ? null : { dir, explicitRoot: joinPath(dir, root) };
}

/**
 * `root` is null when the command's directory could not be read.
 * @typedef {{ root: string | null, planned: boolean }} Observation
 */

/**
 * What one goal command tells the pane, against the root it is about to read. Subagents never move
 * the pane: parallel worktree agents would pull it back and forth. Null: ignore the command.
 * @param {{ pending: Observation | null, shown: string, root: string | null, planned: boolean, isSubagent: boolean }} input
 * @returns {Observation | null}
 */
export function observeGoalCommand({ pending, shown, root, planned, isSubagent }) {
  const current = pending?.root ?? shown;
  /** @type {Observation} */
  let seen;
  // An unknown directory says nothing about the root: taking `current` would pin the pane where the session left.
  if (root === null) seen = { root: pending?.root ?? null, planned: isSubagent ? false : planned };
  else if (!isSubagent || samePath(root, current)) seen = { root, planned };
  else return null;
  if (pending && seen.root !== null && samePath(pending.root, seen.root)) seen.planned = seen.planned || pending.planned;
  return seen;
}

/**
 * The root to read: an observed one, else the root followed so far while the session stays put and
 * it still shows a goal (live or ended; see shouldCheckHome), else the session's own root.
 * @param {{ observed: string | null, prev: { root: string | null, home?: string | null, snapshot: DagSnapshot | null, ended: DagState["ended"] } | null, home: string }} input
 */
export function pickRoot({ observed, prev, home }) {
  if (observed) return observed;
  if (prev?.root && samePath(prev.home, home) && (samePath(prev.root, home) || prev.snapshot !== null)) return prev.root;
  return home;
}

/**
 * Whether to read home before `root`: the goal at the followed root has ended and nothing newer was
 * observed. A live goal at home then takes over; otherwise the ended goal stays shown, as it does at home.
 * @param {{ observed: string | null, prev: { root: string | null, snapshot: DagSnapshot | null, ended: DagState["ended"] } | null, root: string, home: string }} input
 */
export function shouldCheckHome({ observed, prev, root, home }) {
  return !observed && prev !== null && !samePath(root, home) && samePath(prev.root, root) && prev.snapshot !== null && prev.ended !== null;
}

/**
 * The state to fold the next fetch into. Another root drops what was read from the old one and moves
 * `seq` so the pane redraws.
 * @param {DagState | null} prev
 * @param {{ root: string, home: string }} at
 * @returns {DagState}
 */
export function rebaseDagState(prev, { root, home }) {
  if (!prev || prev.root === null || samePath(prev.root, root)) return { ...(prev ?? initialDagState()), root, home };
  return { ...initialDagState(), seq: prev.seq + 1, root, home };
}

const LIMIT = 40;

/** @param {string} text */
function clip(text) {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= LIMIT ? chars.join("") : `${chars.slice(0, LIMIT - 1).join("")}…`;
}

/** @param {string} value */
function baseName(value) {
  const parts = value.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || value;
}

const unquote = (token) => token.replace(/^["']|["']$/g, "");

/** @param {string} command */
function describeCommand(command) {
  const goal = parsePotaGoalCommand(command);
  if (goal) return `pota goal ${goal.subs[0]}`;
  let tokens = command.trim().split(/\s+/).filter(Boolean);
  for (;;) {
    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens = tokens.slice(1);
    if (tokens[0] !== "cd") break;
    const end = tokens.findIndex((token) => token === "&&" || token === ";" || token.endsWith(";"));
    if (end < 0) break;
    tokens = tokens.slice(end + 1);
  }
  const shown = tokens.slice(0, 3).map((token) => {
    const value = unquote(token);
    return value.includes("/") || value.includes("\\") ? baseName(value) : value;
  });
  return `$ ${shown.join(" ")}`;
}

/**
 * One short line for a tool call, at most 40 characters, carrying no argument values beyond
 * a command's first three words: command lines can hold tokens or passwords.
 * @param {Record<string, unknown>} e a `tool.call` input: `tool` and the tool's arguments
 */
export function describeToolCall(e) {
  const tool = String(e?.tool ?? "");
  const text = (key) => (typeof e[key] === "string" ? e[key] : "");
  if (tool === "Bash") return clip(describeCommand(text("command")));
  if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const path = text("file_path") || text("notebook_path") || text("path");
    return clip(path ? `${tool} ${baseName(path)}` : tool);
  }
  if (tool === "Grep" || tool === "Glob") return clip(text("pattern") ? `${tool} ${text("pattern")}` : tool);
  if (tool === "Agent" || tool === "Task") return clip(`Agent: ${text("description")}`);
  if (tool.startsWith("mcp__")) {
    const [, server = "", ...rest] = tool.split("__");
    return clip(`${server}:${rest.join("__")}`);
  }
  return clip(tool);
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Task ids named in a prompt: in backticks or quotes as a whole, or right after `--task`.
 * @param {string} text
 * @param {string[]} taskIds
 */
export function extractTaskMentions(text, taskIds) {
  const source = String(text ?? "");
  return taskIds.filter((id) => {
    const value = escapeRegExp(id);
    return new RegExp(`\`${value}\`|"${value}"|'${value}'|--task(?:=|\\s+)${value}(?![\\w.-])`).test(source);
  });
}

/**
 * @typedef {{ type: "spawn", id: string, name: string | null, description: string, model: string | null, parentId: string | null, mentions: string[], at: number }
 *   | { type: "call", id: string, activity: string, at: number }
 *   | { type: "done", id: string, at?: number }
 *   | { type: "sync", running: string[] }} AgentEvent
 */

/**
 * @param {DagAgent[]} prev
 * @param {AgentEvent} event
 * @returns {DagAgent[]}
 */
export function reduceAgents(prev, event) {
  let list = Array.isArray(prev) ? [...prev] : [];
  const fresh = (id, at) => ({
    id, name: id === MAIN_AGENT_ID ? MAIN_AGENT_ID : null, description: "", model: null, parentId: null,
    mentions: [], status: "running", activity: "", activityAt: at, calls: 0,
  });
  if (event.type === "spawn") {
    list = list.filter((agent) => agent.id !== event.id);
    list.push({
      id: event.id, name: event.name, description: event.description, model: event.model, parentId: event.parentId,
      mentions: [...event.mentions], status: "running", activity: "", activityAt: event.at, calls: 0,
    });
  } else if (event.type === "call") {
    if (!list.some((agent) => agent.id === event.id)) list.push(fresh(event.id, event.at));
    list = list.map((agent) => (agent.id === event.id
      ? { ...agent, status: "running", activity: event.activity, activityAt: event.at, calls: agent.calls + 1 }
      : agent));
  } else if (event.type === "done") {
    list = list.map((agent) => (agent.id === event.id ? { ...agent, status: "done" } : agent));
  } else if (event.type === "sync") {
    const running = new Set(event.running);
    list = list.map((agent) => (agent.id !== MAIN_AGENT_ID && agent.status === "running" && !running.has(agent.id)
      ? { ...agent, status: "done" }
      : agent));
  }
  while (list.length > MAX_AGENTS) {
    const index = list.findIndex((agent) => agent.status === "done");
    list.splice(index >= 0 ? index : 0, 1);
  }
  return list;
}

/**
 * Which task each agent works on. Rules, in order: the task's assignedAgentId names the agent; the
 * agent's parent is matched; the agent's prompt named one task (or one active task among several);
 * one unmatched assigned active task and one unmatched running root agent pair up. Else unmatched.
 * The main loop is matched to the one active task nobody is assigned to.
 * @param {DagAgent[]} agents
 * @param {DagTask[]} tasks
 * @returns {Record<string, string>}
 */
export function resolveAgentTasks(agents, tasks) {
  /** @type {Record<string, string>} */
  const linked = {};
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const active = tasks.filter((item) => item.status === "active");
  const assigned = (agent) => {
    const matches = tasks.filter((item) => item.assignedAgentId !== null && (item.assignedAgentId === agent.id || item.assignedAgentId === agent.name));
    return (matches.find((item) => item.status === "active") ?? matches[0])?.id;
  };
  const mentioned = (agent) => {
    const known = agent.mentions.filter((id) => byId.has(id));
    if (known.length === 1) return known[0];
    const running = known.filter((id) => byId.get(id).status === "active");
    return running.length === 1 ? running[0] : undefined;
  };
  const unassignedActive = active.filter((item) => item.assignedAgentId === null);
  for (const agent of agents) {
    if (agent.id === MAIN_AGENT_ID) {
      if (unassignedActive.length === 1) linked[agent.id] = unassignedActive[0].id;
      continue;
    }
    const taskId = assigned(agent)
      ?? (agent.parentId !== null ? linked[agent.parentId] : undefined)
      ?? mentioned(agent);
    if (taskId !== undefined) linked[agent.id] = taskId;
  }
  const taken = new Set(Object.entries(linked).filter(([id]) => id !== MAIN_AGENT_ID).map(([, taskId]) => taskId));
  const orphanTasks = active.filter((item) => item.assignedAgentId !== null && !taken.has(item.id));
  const orphanAgents = agents.filter((agent) => agent.id !== MAIN_AGENT_ID && agent.status === "running" && agent.parentId === null && linked[agent.id] === undefined);
  if (orphanTasks.length === 1 && orphanAgents.length === 1) {
    linked[orphanAgents[0].id] = orphanTasks[0].id;
    for (const agent of agents) {
      if (linked[agent.id] === undefined && agent.parentId !== null && linked[agent.parentId] !== undefined) linked[agent.id] = linked[agent.parentId];
    }
  }
  return linked;
}

/**
 * @typedef {{
 *   seq: number, snapshot: DagSnapshot | null,
 *   ended: { status: "completed" | "cancelled" | "unknown", endedAt: number | null } | null,
 *   error: string | null, fetchedAt: number, root: string | null, home: string | null,
 *   timeline: Record<string, { activeAt?: number, completedAt?: number }>
 * }} DagState
 */

/** @returns {DagState} */
export function initialDagState() {
  return { seq: 0, snapshot: null, ended: null, error: null, fetchedAt: 0, root: null, home: null, timeline: {} };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function nextTimeline(prevTimeline, prevSnapshot, snapshot, now) {
  const carry = prevSnapshot && prevSnapshot.goalId === snapshot.goalId ? prevTimeline : {};
  /** @type {DagState["timeline"]} */
  const timeline = {};
  for (const item of snapshot.tasks) {
    const entry = { ...(carry[item.id] ?? {}) };
    const at = item.updatedAt > 0 ? item.updatedAt : now;
    if (item.status === "active" && entry.activeAt === undefined) entry.activeAt = at;
    if (item.status === "completed" && entry.completedAt === undefined) entry.completedAt = at;
    if (item.status !== "completed") delete entry.completedAt;
    if (Object.keys(entry).length > 0) timeline[item.id] = entry;
  }
  return timeline;
}

/**
 * Folds one fetch into the state. `seq` moves only when what is drawn changes.
 * @param {DagState | null} prev
 * @param {{ snapshot: DagSnapshot | null, error: string | null, now: number,
 *   recent?: { goalId?: string, status?: string, endedAt?: string | number | null }[] }} input
 * @returns {DagState}
 */
export function reduceDagState(prev, { snapshot, error, now, recent }) {
  const base = prev ?? initialDagState();
  if (error) return { ...base, error, fetchedAt: now };
  if (snapshot) {
    const changed = !sameJson(base.snapshot, snapshot) || base.ended !== null;
    return {
      ...base,
      seq: changed ? base.seq + 1 : base.seq,
      snapshot: changed ? snapshot : base.snapshot,
      ended: null,
      error: null,
      fetchedAt: now,
      timeline: nextTimeline(base.timeline, base.snapshot, snapshot, now),
    };
  }
  if (!base.snapshot || base.ended) return { ...base, error: null, fetchedAt: now };
  const goalId = base.snapshot.goalId;
  const found = (recent ?? []).find((entry) => entry && entry.goalId === goalId);
  const endedAt = found ? (typeof found.endedAt === "number" ? found.endedAt : Number.isFinite(Date.parse(String(found.endedAt))) ? Date.parse(String(found.endedAt)) : null) : null;
  let ended;
  let last = base.snapshot;
  if (found?.status === "completed") {
    ended = { status: "completed", endedAt };
    last = { ...last, status: "completed", tasks: last.tasks.map((item) => ({ ...item, status: "completed" })) };
  } else if (found?.status === "cancelled") {
    ended = { status: "cancelled", endedAt };
    last = { ...last, status: "cancelled" };
  } else {
    ended = { status: "unknown", endedAt: null };
  }
  return { ...base, seq: base.seq + 1, snapshot: last, ended, error: null, fetchedAt: now };
}

/**
 * Open unasked only right after a plan was made, once per plan, never over a person's close of that goal.
 * @param {{ planned: boolean, snapshot: DagSnapshot | null,
 *   ui: { autoOpenedPlanKey: string | null, closedGoalId: string | null }, paneOpen: boolean }} input
 */
export function shouldAutoOpen({ planned, snapshot, ui, paneOpen }) {
  if (!planned || !snapshot || paneOpen) return false;
  return planKey(snapshot) !== ui.autoOpenedPlanKey && ui.closedGoalId !== snapshot.goalId;
}

export const DEBOUNCE_MS = 300;
export const MIN_GAP_MS = 1000;
export const BACKOFF_MS = 120_000;
export const BACKOFF_AFTER = 3;

/**
 * Delay before the next `goal status` run: a 300 ms debounce, 1 s between runs, and after three
 * failures in a row 120 s between polls. Goal commands and /dag do not back off.
 * @param {{ now: number, lastRunAt: number, failures: number, reason: string }} input
 */
export function nextRefreshDelay({ now, lastRunAt, failures, reason }) {
  const gap = Math.max(DEBOUNCE_MS, lastRunAt + MIN_GAP_MS - now);
  if (reason === "poll" && failures >= BACKOFF_AFTER) return Math.max(gap, lastRunAt + BACKOFF_MS - now);
  return gap;
}
