// Pure event policy of the DAG pane: which commands change the goal, how tool calls are summarized,
// how subagents are matched to tasks, how fetched states fold together, and when to open or refresh.
// TypeScript reads this module's types from dag-events.d.mts.

import { planKey } from "./dag-model.mjs";

export const MAIN_AGENT_ID = "main";
export const MAX_AGENTS = 16;
export const MUTATING_SUBS = new Set(["start", "replan", "task", "claim", "assign", "receipt", "verify", "finish", "pause", "resume", "block", "cancel", "complete"]);
const PLANNING_SUBS = new Set(["start", "replan"]);
const GOAL_COMMAND = /(?:^|[\s"'/\\;&|(])pota(?:\.mjs)?["']?\s+goal\s+([a-z]+)\b/g;
const ROOT_FLAG = /--root(?:=|\s+)("[^"]+"|'[^']+'|\S+)/;

/**
 * @param {string} command a Bash command line
 * @returns {{ subs: string[], mutates: boolean, planned: boolean, root: string | null } | null}
 */
export function parsePotaGoalCommand(command) {
  const text = String(command ?? "");
  const subs = [...text.matchAll(GOAL_COMMAND)].map((match) => match[1]);
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
 *   error: string | null, fetchedAt: number, root: string | null,
 *   timeline: Record<string, { activeAt?: number, completedAt?: number }>
 * }} DagState
 */

/** @returns {DagState} */
export function initialDagState() {
  return { seq: 0, snapshot: null, ended: null, error: null, fetchedAt: 0, root: null, timeline: {} };
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
