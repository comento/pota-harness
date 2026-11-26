const CLAIM_PATTERNS = [
  /\b(?:all\s+)?tests?\s+(?:now\s+)?pass(?:ed|es)?\b/i,
  /\b(?:is|are)\s+(?:now\s+)?(?:complete|completed|done|finished)\b/i,
  /\b(?:fully\s+implemented|successfully\s+(?:completed|implemented|verified)|all\s+done|implementation\s+(?:is\s+)?complete)\b/i,
  /완료했습니다|완료됐습니다|완료되었습니다|완료입니다|작업 완료|모두 완료|모두 통과|통과했습니다|검증을 마쳤습니다|구현을 마쳤습니다/,
];
const CLAIM_EXCLUSIONS = [
  /\b(?:not|no longer|yet|will|pending|remaining|todo|to be|once|after|if|next|moving on|starting|unverified)\b|\bnow\s+[a-z]+ing\b|n't/i,
  /아직|않|못|미완|남았|남아|예정|하겠|되면|필요|이제|다음|중입니다/,
];

// Heuristic only: it feeds an advisory sentence and never changes a stop decision.
export function detectCompletionClaim(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const visible = text.slice(-4000)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^\s*>.*$/gm, " ");
  for (const raw of visible.split(/[.!?。\n]+/)) {
    const sentence = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    if (!sentence || !CLAIM_PATTERNS.some((pattern) => pattern.test(sentence))) continue;
    if (CLAIM_EXCLUSIONS.some((pattern) => pattern.test(sentence))) continue;
    return Array.from(sentence).slice(0, 60).join("").trim();
  }
  return null;
}

function claimSentence(claim) {
  return typeof claim === "string" && claim.length > 0
    ? ` Your last message claims completion ("${claim}"), but Pota has no record of it: correct that statement for the user or record the evidence.`
    : "";
}

export function continuationReason(reason, payload, { progressed = false, claim = null } = {}) {
  const receipt = claimSentence(claim);
  if (!payload?.stop_hook_active || progressed) return `${reason}${receipt}`;
  return `${reason}${receipt} This turn was already continued without new Pota state progress, so the loop guard allows this stop. The goal is still active and incomplete: resume the current task on the next prompt; do not treat it as finished or deferred.`;
}

// stop_hook_active alone would allow every second stop. Block again whenever the goal state advanced
// since the previous continuation, so a steered turn keeps driving the goal; allow only a no-progress repeat.
export function stopHookOutput(gate, payload, { progressed = false, claim = null } = {}) {
  if (!gate.block) return { continue: true };
  const reason = continuationReason(gate.reason, payload, { progressed, claim });
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
