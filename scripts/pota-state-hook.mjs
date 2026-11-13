export function continuationReason(reason, payload, { progressed = false } = {}) {
  if (!payload?.stop_hook_active || progressed) return reason;
  return `${reason} This turn was already continued without new Pota state progress, so the loop guard allows this stop. The goal is still active and incomplete: resume the current task on the next prompt; do not treat it as finished or deferred.`;
}

// stop_hook_active alone would allow every second stop. Block again whenever the goal state advanced
// since the previous continuation, so a steered turn keeps driving the goal; allow only a no-progress repeat.
export function stopHookOutput(gate, payload, { progressed = false } = {}) {
  if (!gate.block) return { continue: true };
  const reason = continuationReason(gate.reason, payload, { progressed });
  if (payload?.stop_hook_active && !progressed) {
    return { continue: true, systemMessage: reason };
  }
  return { decision: "block", reason };
}

export function stopAllowedMessage({ ko, state, event }) {
  if (state?.goal?.status) {
    return ko
      ? `Pota 종료 게이트: 목표 상태가 ${state.goal.status}이므로 종료를 허용합니다.`
      : `Pota stop gate: goal status is ${state.goal.status}; allowing stop.`;
  }
  return ko
    ? `${event === "subagent-stop" ? "서브에이전트" : "작업"} 종료 게이트: 활성 Pota 목표가 없어 종료를 허용합니다.`
    : `${event === "subagent-stop" ? "Subagent" : "Turn"} stop gate: no active Pota goal; allowing stop.`;
}
