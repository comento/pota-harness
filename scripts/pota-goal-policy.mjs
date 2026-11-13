import { readyTasks } from "./pota-goal-operations-mutations.mjs";

export function currentTask(state) {
  if (!state) return null;
  return state.tasks.find((task) => task.status === "active")
    ?? readyTasks(state)[0]
    ?? state.tasks.find((task) => task.status === "pending")
    ?? state.tasks.find((task) => task.status === "blocked")
    ?? null;
}

export function isGoalOwnedBySession(state, sessionId) {
  if (!state?.goal?.ownerSessionId) return true;
  // A payload without a session id cannot prove another owner; treating it as foreign would silently halt the goal.
  if (typeof sessionId !== "string" || sessionId.length === 0) return true;
  return state.goal.ownerSessionId === sessionId;
}

export function evaluateStop(state, { subagent = false, agentId } = {}) {
  if (!state || state.goal.status !== "active") return { block: false };
  const task = currentTask(state);
  if (!task) {
    return {
      block: true,
      reason: `Pota goal "${state.goal.title}" has no incomplete task, but is still active. Verify completion criteria and explicitly mark the goal complete.`,
    };
  }
  if (subagent) {
    // Parallel workers each own a task; gate on the stopping agent's own unfinished task, not the first active one.
    const assigned = !agentId ? null
      : state.tasks.find((item) => item.status === "active" && item.assignedAgentId === agentId)
        ?? (task.assignedAgentId === agentId ? task : null);
    if (!assigned) return { block: false };
    return {
      block: true,
      reason: `Pota task ${assigned.id} (${assigned.title}) is assigned to this subagent and is ${assigned.status}. Continue only this assigned task, record a successful evidence record, then hand off.${effortWarning([assigned])}`,
    };
  }
  const active = state.tasks.filter((item) => item.status === "active");
  if (active.length > 1) {
    const list = active.map((item) => `${item.id} (${clip(item.title, 40)})`).join(", ");
    return {
      block: true,
      reason: `Pota goal "${state.goal.title}" is active with parallel tasks ${list}. Collect or continue each one; record successful evidence before marking a task complete.${effortWarning(active)}`,
    };
  }
  return {
    block: true,
    reason: `Pota goal "${state.goal.title}" is active. Continue current task ${task.id} (${task.title}); its status is ${task.status}. Record a successful evidence record before marking it complete.${effortWarning(active)}`,
  };
}

// Delegated work must record the effort the host applied; flag assigned tasks whose effort source is still empty.
function effortWarning(tasks) {
  const ids = tasks.filter((item) => item.assignedAgentId && !item.effortSource).map((item) => item.id);
  return ids.length === 0 ? "" : ` Effort unrecorded for assigned task ${ids.join(", ")}: record goal assign --effort/--effort-source.`;
}

function clip(value, maxLength) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
