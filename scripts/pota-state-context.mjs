const contextLimits = {
  goalTitle: 64,
  roadmapTaskId: 24,
  taskTitle: 40,
  roadmapWindow: 3,
  parallelTitle: 16,
  memoryBlock: 640,
  planBlock: 320,
  memoryLines: 8,
  memoryLine: 84,
  indexName: 32,
  planNames: 3,
  mainModel: 40,
  modelCeilingValue: 40,
  activePromptCapsule: 700,
};

export function prependContext(result, notice) {
  const specific = result.hookOutput?.hookSpecificOutput;
  if (!specific) return { ...result, message: `${notice}\n${result.message}` };
  return {
    ...result,
    message: `${notice}\n${result.message}`,
    hookOutput: {
      ...result.hookOutput,
      hookSpecificOutput: {
        ...specific,
        additionalContext: `${notice}\n${specific.additionalContext}`,
      },
    },
  };
}

import { readyTasks } from "./pota-goal-operations-mutations.mjs";
import { currentTask } from "./pota-goal-policy.mjs";
import { MODEL_TIER_BY_HOST } from "./pota-model-tier.mjs";

export function contextResult({ ko, state, event, index = null }) {
  const base = kernelBase(ko);
  const memory = event === "session-start" ? memoryBlock(ko, index?.memory) : "";
  const idlePolicy = event === "user-prompt-submit"
    ? (ko
      ? " 비단순 구현이나 계획된 작업 재개는 pota-plan과 plan/task를 복원·생성하세요. 대상이 확정된 Git/GitHub 상태·fetch·checkout·merge·push·PR 작업은 코드 수정·충돌 해결·파괴적 복구·릴리스/배포·설계가 필요하지 않으면 plan/goal 없이 실행하세요. 상담·설명·계획 전용도 goal 없이 처리하세요."
      : " For non-trivial implementation or planned-work continuation, load pota-plan and restore/create its plan and task. Known-target Git/GitHub operations stay plan/goal-free unless they require code edits, conflict resolution, destructive recovery, release/deploy, or design. Consultation, explanation, and plan-only requests are also goal-free.")
    : (ko
      ? " 중요 작업 전에 pota-plan을 로드하고 active plan과 current task를 복원하세요."
      : " Before non-trivial work, load pota-plan and restore the active plan and current task.");
  const failClosed = ko
    ? " active state와 그 skill·plan·required task reference가 없거나 읽을 수 없거나 일치하지 않을 때만 중단하세요."
    : " Stop only if active state and its skill, plan, or required task ref is missing, unreadable, or inconsistent.";
  if (state && (state.goal.status === "paused" || state.goal.status === "blocked")) {
    return interruptedContextResult(event, ko, state, memory);
  }
  if (!state || state.goal.status !== "active") {
    // Plan names only reach idle sessions: an active capsule already names its exact plan.
    const plans = event === "session-start" ? planBlock(ko, index?.plans) : "";
    return contextHookResult({ event, message: withBlocks(`${base}${memoryCountSentence(ko, event, index?.memory)}${idlePolicy}${failClosed}`, memory, plans) });
  }
  const task = currentTask(state);
  const planId = state.goal.planId;
  const phase = task ? "pota-work" : "pota-review";
  // Only gated ready tasks remain and nothing is active: none of them is work to continue until the user approves.
  const hasActive = state.tasks.some((item) => item.status === "active");
  const ready = !hasActive ? readyTasks(state) : [];
  const gatedReady = ready.length > 0 && ready.every((item) => item.approvalGate === true) ? ready : [];
  const showTask = Boolean(task) && gatedReady.length === 0;
  const activeHeader = ko
    ? `${base} ${phase}를 로드하고 정확한 plan ${planId}${showTask ? "과 아래 current task" : task ? "" : "의 완료 기준"}를 복원하세요. 압축·재시작·handoff 뒤 다시 읽으세요.${failClosed}`
    : `${base} Load ${phase}; restore exact plan ${planId}${showTask ? " and the current task below" : task ? "" : " completion criteria"}. Re-read after compaction/restart/handoff.${failClosed}`;
  if (!task) {
    return contextHookResult({
      event,
      message: withBlocks([activeHeader, taskRoadmap(ko, state), activeGoalCompletionMessage(ko, state)].join("\n"), memory),
    });
  }
  const taskId = task.id;
  const taskTitle = clipText(task.title, contextLimits.taskTitle);
  const continuation = taskId.length > 48
    ? (ko
      ? `정확한 current task: ${taskId}. 바인딩된 증거 뒤에만 완료하세요.`
      : `Exact task: ${taskId}. Complete after bound evidence.`)
    : (ko
      ? `현재: ${taskId} (${taskTitle}). 바인딩된 증거 뒤에만 완료하세요.`
      : `Current: ${taskId} (${taskTitle}). Complete only after bound evidence.`);
  const resume = event === "user-prompt-submit"
    ? (taskId.length > 48
      ? (ko
        ? "곁가지 질문·조향 뒤 위의 정확한 task를 재개하고 최종 검토까지 진행하세요(일시정지·중단·전환 요청 제외)."
        : "After side questions or steers, resume that exact task; advance to final review unless paused, stopped, or switched.")
      : (ko
        ? `곁가지 질문·조향 뒤 ${taskId}를 재개하고 남은 task를 최종 검토까지 진행하세요(일시정지·중단·전환 요청 제외).`
        : `After a side question or steer, resume ${taskId}, then advance remaining tasks to final review unless asked to pause, stop, or switch.`))
    : "";
  const baseMessage = [
    activeHeader,
    taskRoadmap(ko, state),
    showTask ? continuation : "",
    parallelLine(ko, state),
    showTask ? resume : "",
  ].filter(Boolean).join("\n");
  const gateNote = approvalGateLine(ko, gatedReady, baseMessage.length);
  const message = gateNote ? `${baseMessage}\n${gateNote}` : baseMessage;
  return contextHookResult({ event, message: withBlocks(message, memory) });
}

// 활성 task 없이 ready task들이 approvalGate 대기 중일 때 700자 캡슐 예산 안에서 대기 task ID와 사용자 승인 규칙을 안내한다.
// 해제 명령은 싣지 않는다: 게이트는 사용자가 DAG 패널에서 승인하거나 에이전트에게 요청할 때만 풀린다.
function approvalGateLine(ko, gatedTasks, usedLength) {
  if (gatedTasks.length === 0) return "";
  const budget = Math.max(0, contextLimits.activePromptCapsule - usedLength - 1);
  if (budget === 0) return "";
  const head = ko ? "사용자 승인 대기: " : "Awaiting user approval: ";
  const tails = ko
    ? [". 게이트를 직접 해제하지 말고 사용자가 DAG 패널에서 승인하거나 요청할 때까지 기다리세요.", ". 게이트를 직접 해제하지 말고 사용자를 기다리세요."]
    : [". Do not release the gate yourself; wait until the user approves in the DAG panel or asks you to.", ". Do not release the gate yourself; wait for the user."];
  const ids = gatedTasks.map((task) => plainText(task.id));
  const moreText = (remaining) => (remaining > 0 ? (ko ? ` 외 ${remaining}개` : ` +${remaining} more`) : "");
  for (const tail of tails) {
    let shown = "";
    let count = 0;
    for (const id of ids) {
      const candidate = count === 0 ? id : `${shown}, ${id}`;
      if (head.length + candidate.length + moreText(ids.length - count - 1).length + tail.length > budget) break;
      shown = candidate;
      count += 1;
    }
    if (count > 0) return `${head}${shown}${moreText(ids.length - count)}${tail}`;
  }
  const tail = tails.at(-1);
  const avail = Math.max(1, budget - head.length - tail.length);
  return clipText(`${head}${clipText(ids[0], avail)}${tail}`, budget);
}

// Only when several tasks run at once: their ids and clipped titles, never the dependency graph.
function parallelLine(ko, state) {
  const active = state.tasks.filter((task) => task.status === "active");
  if (active.length < 2) return "";
  const list = active.map((task) => `${clipText(task.id, contextLimits.roadmapTaskId)} (${clipText(task.title, contextLimits.parallelTitle)})`).join(", ");
  return `${ko ? "병렬 active" : "Parallel active"}: ${list}`;
}

function kernelBase(ko) {
  return ko ? "Pota kernel: 루트 MEMORY.md는 선택 사항이며, 있으면 읽으세요." : "Pota kernel: root MEMORY.md is optional; read it when present.";
}

function interruptedContextResult(event, ko, state, memory) {
  const task = state.tasks.find((item) => item.status === "active")
    ?? state.tasks.find((item) => item.status === "pending")
    ?? state.tasks.find((item) => item.status === "blocked");
  const taskContext = task
    ? (ko
      ? `현재 task: ${task.id} (${clipText(task.title, contextLimits.taskTitle)}), 상태 ${task.status}.`
      : `Current task: ${task.id} (${clipText(task.title, contextLimits.taskTitle)}), status ${task.status}.`)
    : (ko ? "현재 task: 없음." : "Current task: none.");
  const blocker = state.goal.blocker ?? task?.blocker ?? (ko ? "없음" : "none");
  const recovery = ko
    ? "goal 상태를 자동으로 바꾸지 마세요. 정확한 context를 복원하고 원인을 처리한 뒤 goal resume을 명시적으로 실행하고 현재 task를 이어가세요."
    : "Do not change goal status automatically. Restore this exact context, address the interruption, then run goal resume explicitly and continue the current task.";
  const message = ko
    ? `${kernelBase(ko)} 정확한 plan: ${state.goal.planId}. ${taskContext} Goal 상태: ${state.goal.status}. Blocker: ${blocker}. ${recovery}`
    : `${kernelBase(ko)} Exact plan: ${state.goal.planId}. ${taskContext} Goal status: ${state.goal.status}. Blocker: ${blocker}. ${recovery}`;
  return contextHookResult({ event, message: withBlocks(message, memory) });
}

export function foreignSessionContextResult({ ko, event, sessionId, index = null }) {
  const claim = typeof sessionId === "string" && sessionId.length > 0
    ? (ko
      ? ` 이 session이 같은 작업을 이어받는 경우(재개·압축·handoff·fork)에만 pota goal claim --session ${JSON.stringify(sessionId)} --root <repoRoot>로 소유권을 넘겨받고 이어가세요.`
      : ` Only if this session continues that same work (resume, compaction, handoff, fork), take ownership with pota goal claim --session ${JSON.stringify(sessionId)} --root <repoRoot>, then continue.`)
    : "";
  const message = ko
    ? `Pota kernel: 루트 MEMORY.md는 선택 사항이며, 있으면 읽으세요. 저장소 goal을 다른 session이 소유합니다. pota goal status로 상태를 확인하고 소유권이 해결될 때까지 Pota 작업을 시작·수정·위임·완료하지 마세요.${claim} 이 capsule은 goal, plan, task 상세를 노출하지 않습니다.`
    : `Pota kernel: root MEMORY.md is optional; read it when present. A repository goal is owned by another session. Inspect pota goal status; until ownership is resolved, do not start, edit, delegate, or complete Pota work.${claim} This capsule does not expose goal, plan, or task details.`;
  // Repository notes are shared knowledge; plan names would reveal the owner's work, so they never appear here.
  const memory = event === "session-start" ? memoryBlock(ko, index?.memory) : "";
  return contextHookResult({ event, message: withBlocks(message, memory) });
}

// A conditional SessionStart line outside the standing budgets (340 characters); the prefix stays English in both
// locales because delegation.md names the line by it. threshold is the capped stronger tier under a model ceiling.
export function mainModelLine({ ko, model, tier, host, threshold = "stronger" }) {
  const name = clipText(plainText(model), contextLimits.mainModel);
  const stronger = strongerModel(host, threshold);
  return ko
    ? `Pota main model: ${name} (${tier} tier, ${threshold} 미만). 계획·트리아지와 최종 리뷰를 ${stronger} 이상 subagent에 위임하고 goal assign --model로 기록하세요. 기록이 없으면 triage-plan 완료와 goal finish가 거부됩니다(우회: --allow-main-model <reason>). 상세: delegation.md "Main Model Gate".`
    : `Pota main model: ${name} (${tier} tier, below ${threshold}). Dispatch planning/triage and the final review to a subagent on ${stronger} or higher and record goal assign --model, or triage-plan completion and goal finish fail (bypass: --allow-main-model <reason>). See delegation.md "Main Model Gate".`;
}

// The user-facing systemMessage (240 characters), shown when the record is written or the model changes.
export function mainModelNotice({ ko, model, host, threshold = "stronger" }) {
  const name = clipText(plainText(model), contextLimits.mainModel);
  const stronger = strongerModel(host, threshold);
  return ko
    ? `Pota: 이 세션의 main 모델(${name})은 ${threshold} tier 미만입니다. 계획·트리아지·리뷰는 ${stronger} 이상 subagent에 위임됩니다. 모델을 바꾸면 늦어도 다음 세션 시작 때 반영됩니다.`
    : `Pota: this session runs on ${name}, below the ${threshold} tier. Planning, triage, and review go to subagents on ${stronger} or higher. A model switch is picked up by the next session start at the latest.`;
}

function strongerModel(host, threshold = "stronger") {
  return Object.hasOwn(MODEL_TIER_BY_HOST, host ?? "") ? MODEL_TIER_BY_HOST[host][threshold] : `the ${threshold} tier`;
}

// A conditional SessionStart line (380 characters) while a model ceiling is set. The hook does not know the host, so
// the line names all three hosts' values; the prefix stays English in both locales.
export function modelCeilingLine({ ko, ceiling }) {
  if (!Object.hasOwn(MODEL_CEILING_WORK, ceiling ?? "")) return null;
  const [cc, cx, ag] = ["claude-code", "codex", "antigravity"].map((host) => MODEL_TIER_BY_HOST[host][ceiling]);
  const head = `Pota model ceiling: ${ceiling} (Claude Code ${cc}, Codex ${cx}, Antigravity ${ag}).`;
  const work = MODEL_CEILING_WORK[ceiling][ko ? "ko" : "en"];
  return ko
    ? `${head} 이보다 높은 모델로 dispatch하지 마세요. ${work}도 이 모델로 실행하고, 넘긴 값을 goal assign --model로 기록하면 게이트를 통과합니다. skill 문구의 tier 값보다 이 줄이 우선합니다. 상세: delegation.md "Model Ceiling".`
    : `${head} Never dispatch above it: ${work} runs on that model; pass and record that value (goal assign --model) and the gates accept it. This overrides tier values in skill text. See delegation.md "Model Ceiling".`;
}

const MODEL_CEILING_WORK = {
  stronger: { en: "strongest-tier work (Heavy design)", ko: "strongest tier 작업(Heavy 설계)" },
  balanced: {
    en: "stronger- and strongest-tier work (planning, triage, review, Heavy work)",
    ko: "stronger·strongest tier 작업(계획·트리아지·리뷰·Heavy 작업)",
  },
};

// The user-facing systemMessage (240 characters) on every SessionStart while the setting is invalid.
export function modelCeilingInvalidNotice({ ko, source, value }) {
  // An unpaired surrogate becomes U+FFFD so JSON.stringify cannot expand it to a six-character escape.
  const shown = JSON.stringify(clipText(plainText(value).replace(LONE_SURROGATE, "\uFFFD"), contextLimits.modelCeilingValue));
  const where = source === "config" ? "config.json \"modelCeiling\"" : "POTA_MODEL_CEILING";
  return ko
    ? `Pota: 모델 상한 값 ${shown}(${where})이 올바르지 않습니다. balanced 또는 stronger(또는 sonnet·opus 같은 모델 이름)를 쓰세요. 상한은 적용되지 않습니다.`
    : `Pota: model ceiling ${shown} (${where}) is not valid; use balanced or stronger (or a model name such as sonnet or opus). No ceiling is applied.`;
}

// Appends a context line and joins a user message onto any systemMessage already present, so several notices keep
// their order instead of replacing each other.
export function appendNotice(result, line, userMessage = null) {
  let next = result;
  if (line) {
    const specific = result.hookOutput?.hookSpecificOutput;
    next = {
      ...result,
      message: `${result.message}\n${line}`,
      hookOutput: specific
        ? { ...result.hookOutput, hookSpecificOutput: { ...specific, additionalContext: `${specific.additionalContext}\n${line}` } }
        : result.hookOutput,
    };
  }
  if (userMessage) {
    const systemMessage = [next.hookOutput?.systemMessage, userMessage].filter(Boolean).join("\n");
    next = { ...next, hookOutput: { ...next.hookOutput, systemMessage } };
  }
  return next;
}

function withBlocks(message, ...blocks) {
  return [message, ...blocks].filter(Boolean).join("\n");
}

// Idle prompts only learn that notes exist; the list itself stays in SessionStart to keep the per-prompt budget.
function memoryCountSentence(ko, event, memory) {
  if (event !== "user-prompt-submit" || !(memory?.count > 0)) return "";
  return ko
    ? ` docs/memory에 노트 ${memory.count}개가 있습니다(색인: MEMORY.md). 작업에 필요한 것만 읽으세요.`
    : ` docs/memory has ${memory.count} notes (index: MEMORY.md); read only those this task needs.`;
}

// Lists repository notes as "- name: summary" while they fit; past the line or character limit it falls back to
// one names-only line so every note stays discoverable, counting whatever does not fit.
function memoryBlock(ko, memory) {
  if (!(memory?.count > 0)) return "";
  const entries = Array.isArray(memory.entries) ? memory.entries : [];
  const header = ko
    ? "저장소 메모리 — docs/memory/<name>.md (색인: MEMORY.md), 작업에 필요한 것만 읽으세요:"
    : "Repo memory — docs/memory/<name>.md (index: MEMORY.md); read only what the task needs:";
  const drift = memory.drift ? (ko ? "(색인이 오래됨: pota memory index 실행)" : "(index out of date: run pota memory index)") : "";
  const name = (entry) => clipText(plainText(entry.name), contextLimits.indexName);
  if (entries.length >= memory.count && entries.length <= contextLimits.memoryLines) {
    const lines = entries.map((entry) => clipText(entry.summary ? `- ${name(entry)}: ${plainText(entry.summary)}` : `- ${name(entry)}`, contextLimits.memoryLine));
    const block = withBlocks(header, ...lines, drift);
    if (block.length <= contextLimits.memoryBlock) return block;
  }
  const more = (count) => (count > 0 ? (ko ? ` 외 ${count}개(MEMORY.md 참조)` : ` +${count} more in MEMORY.md`) : "");
  const budget = contextLimits.memoryBlock - header.length - 1 - (drift ? drift.length + 1 : 0);
  let names = "";
  let shown = 0;
  for (const entry of entries) {
    const candidate = shown === 0 ? name(entry) : `${names}, ${name(entry)}`;
    if (candidate.length + more(memory.count - shown - 1).length > budget) break;
    names = candidate;
    shown += 1;
  }
  return withBlocks(header, `${names}${more(memory.count - shown)}`.trim(), drift);
}

// One line for idle sessions. Over budget it drops latest names from the end, then reduces active names to a count.
function planBlock(ko, plans) {
  if (!plans) return "";
  const archive = plans.archive ? (ko ? ", 이전 항목: docs/plan/ARCHIVE.md" : ", older: docs/plan/ARCHIVE.md") : "";
  const head = ko
    ? `계획 — docs/plan/<name>.md (색인: PLAN.md${archive}): 파일 ${plans.files}개`
    : `Plans — docs/plan/<name>.md (index: PLAN.md${archive}): ${plans.files} files`;
  const close = ko ? " 비슷한 작업을 계획하기 전에 관련 계획을 확인하세요." : " Check related plans before planning similar work.";
  const names = (list) => (Array.isArray(list) ? list : []).slice(0, contextLimits.planNames).map((item) => clipText(plainText(item), contextLimits.indexName));
  const active = names(plans.active);
  const latest = names(plans.latest);
  const activeLabel = ko ? "진행 중" : "active";
  const latestLabel = ko ? "최근 완료" : "latest completed";
  const render = (activePart, latestNames) => {
    const parts = [head, activePart, latestNames.length > 0 ? `${latestLabel}: ${latestNames.join(", ")}` : ""];
    return `${parts.filter(Boolean).join("; ")}.${close}`;
  };
  const activeNames = active.length > 0 ? `${activeLabel}: ${active.join(", ")}` : "";
  const activeCount = active.length > 0 ? `${activeLabel}: ${plans.active.length}` : "";
  const candidates = [
    ...Array.from({ length: latest.length + 1 }, (_, dropped) => render(activeNames, latest.slice(0, latest.length - dropped))),
    render(activeCount, []),
  ];
  return candidates.find((line) => line.length <= contextLimits.planBlock) ?? render("", []);
}

function taskRoadmap(ko, state) {
  const formatTask = (task, index) => `${index + 1}. ${clipText(task.id, contextLimits.roadmapTaskId)} [${task.status}] ${clipText(task.title, contextLimits.taskTitle)}`;
  if (state.tasks.length <= contextLimits.roadmapWindow) {
    return `${ko ? "작업 단계" : "Work steps"}:\n${state.tasks.map(formatTask).join("\n")}`;
  }

  const currentIndex = Math.max(0, state.tasks.findIndex((task) => task.status === "active" || task.status === "pending"));
  const counts = Object.fromEntries([...TASK_STATUS_NAMES].map((status) => [status, state.tasks.filter((task) => task.status === status).length]));
  const countSummary = Object.entries(counts).filter(([, count]) => count > 0).map(([status, count]) => `${status} ${count}`).join(", ");
  const omitted = state.tasks.length - 1;
  const header = ko
    ? `작업 단계 (${state.tasks.length}개; ${countSummary})`
    : `Work steps (${state.tasks.length}; ${countSummary})`;
  const omission = ko ? `… ${omitted}개 단계 생략` : `… ${omitted} steps omitted`;
  const currentPosition = currentIndex + 1;
  const upcoming = state.tasks.slice(currentIndex + 1).filter((task) => task.status === "pending").slice(0, 2)
    .map((task) => clipText(task.id, contextLimits.roadmapTaskId));
  const next = upcoming.length > 0 ? `; ${ko ? "다음" : "next"} ${upcoming.join(", ")}` : "";
  return `${header}. ${ko ? `현재 위치 ${currentPosition}` : `Current position ${currentPosition}`}; ${omission}${next}`;
}

function contextHookResult({ event, message }) {
  return {
    status: 0,
    message,
    hookOutput: {
      hookSpecificOutput: {
        hookEventName: event === "session-start" ? "SessionStart" : "UserPromptSubmit",
        additionalContext: message,
      },
    },
  };
}

function activeGoalCompletionMessage(ko, state) {
  const goalTitle = clipText(state.goal.title, contextLimits.goalTitle);
  return ko
    ? `활성 목표 "${goalTitle}"의 모든 task가 완료되었습니다. 완료 기준을 확인하고 명시적으로 complete 상태로 전이하세요.`
    : `All tasks for active goal "${goalTitle}" are complete. Verify criteria and explicitly transition the goal to completed.`;
}

const TASK_STATUS_NAMES = ["active", "pending", "blocked", "completed"];

// Clips by UTF-16 length, the unit of the character budgets, without splitting a surrogate pair.
function clipText(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  let end = maxLength - 1;
  if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end -= 1;
  return `${text.slice(0, end)}…`;
}

// Note names, summaries, and plan names are repository text: control characters and line separators become spaces
// so they cannot start a new line in the capsule or hide text from the reader.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/gu;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function plainText(value) {
  return String(value ?? "").replace(UNSAFE_TEXT, " ");
}
