import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  assignTask,
  finishGoal,
  goalStats,
  handleGoalCli,
  readGoalState,
  recordReceipt,
  replanGoal,
  setTaskStatus,
  startGoal,
  transitionGoal,
} from "../scripts/pota-goal.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import { appendNotice, mainModelLine, mainModelNotice } from "../scripts/pota-state-context.mjs";
import {
  mainModelGateEnabled, mainModelRecordPath, readMainModelRecord, syncMainModelRecord,
} from "../scripts/pota-goal-state.mjs";
import { STRONGEST_MODEL_BY_HOST as VALIDATION_STRONGEST } from "../scripts/pota-goal-state-validation.mjs";
import {
  MODEL_TIERS,
  MODEL_TIER_BY_HOST,
  STRONGEST_MODEL_BY_HOST,
  classifyModel,
  isBelowStronger,
  isStrongerOrAbove,
} from "../scripts/pota-model-tier.mjs";

const HAIKU = "claude-haiku-4-5-20251001";
const passArgv = [process.execPath, "-e", "process.exit(0)"];
const planningGateError = new RegExp(
  `Planning task triage-plan was not dispatched at the stronger tier: this session's main model is ${HAIKU} \\(fast tier\\)\\. `
  + "Dispatch planning and triage to opus or fable.*--allow-main-model <reason>",
);
const reviewGateError = new RegExp(
  `Goal goal-[0-9a-f-]+ has no review dispatched at the stronger tier: this session's main model is ${HAIKU} \\(fast tier\\)\\. `
  + "Dispatch the final review to opus or fable.*--kind review.*--allow-main-model <reason> to goal finish or goal complete",
);

test("model tiers classify aliases, full IDs, and unknown values per host", () => {
  assert.deepEqual([...MODEL_TIERS], ["fast", "balanced", "stronger", "strongest"]);
  const expected = [
    ["haiku", "fast", "claude-code"],
    [HAIKU, "fast", "claude-code"],
    ["sonnet", "balanced", "claude-code"],
    ["Sonnet[1m]", "balanced", "claude-code"],
    ["claude-sonnet-5-5[1m]", "balanced", "claude-code"],
    ["opus", "stronger", "claude-code"],
    ["claude-opus-5-5", "stronger", "claude-code"],
    ["us.anthropic.claude-opus-4-7-v1:0", "stronger", "claude-code"],
    ["Claude Opus 5.5", "stronger", "claude-code"],
    ["fable", "strongest", "claude-code"],
    ["claude-fable-5-2", "strongest", "claude-code"],
    ["gpt-6-luna", "fast", "codex"],
    ["gpt-6.1-terra", "balanced", "codex"],
    ["gpt-6-sol", "stronger", "codex"],
    ["gpt-6-sol-2026-10-01", "stronger", "codex"],
    ["openai/gpt-6-luna", "fast", "codex"],
    ["gpt-6-astra", "strongest", "codex"],
    ["flash_lite", "fast", "antigravity"],
    ["flash", "balanced", "antigravity"],
    ["pro", "strongest", "antigravity"],
    ["gemini-3.5-flash-lite", "fast", "antigravity"],
    ["gemini-3.8-flash-medium", "balanced", "antigravity"],
    ["gpt-oss-120b-medium", "balanced", "antigravity"],
    ["gemini-4-hydrogen-tiered-xhigh", "stronger", "antigravity"],
    ["gemini-4-neon-high", "stronger", "antigravity"],
    ["gemini-pro-orchestrator-neon", "stronger", "antigravity"],
    ["gemini-4-argon-high", "strongest", "antigravity"],
  ];
  for (const [value, tier, host] of expected) {
    assert.deepEqual(classifyModel(value), { tier, host }, value);
    assert.deepEqual(classifyModel(value, host), { tier, host }, `${value} on ${host}`);
  }
  assert.deepEqual(classifyModel("claude-sonnet-5-5-medium", "antigravity"), { tier: "balanced", host: "antigravity" });
  assert.deepEqual(classifyModel("claude-opus-5-5-high", "antigravity"), { tier: "stronger", host: "antigravity" });
  assert.deepEqual(classifyModel("claude-sonnet-5-5-medium"), { tier: "balanced", host: "claude-code" });
  assert.deepEqual(classifyModel("claude-opus-5-5-high"), { tier: "stronger", host: "claude-code" });
  for (const value of ["opus", "haiku", "fable", "claude-haiku-4-5", "claude-fable-5-2", "gemini-3-pro", "gpt-6-sol"]) {
    assert.equal(classifyModel(value, "antigravity"), null, `${value} on antigravity`);
  }
  for (const value of ["opusplan", "default", "haiku-opus", "gpt-6-solar", "gpt-6-sol.5", "gpt-5", "gemini-3-pro"]) {
    assert.equal(classifyModel(value), null, value);
  }
  assert.equal(classifyModel("pro", "claude-code"), null);
  assert.equal(classifyModel("opus", "codex"), null);
  for (const value of [42, null, undefined, {}, ["opus"], "", "   ", `haiku-${"x".repeat(123)}`]) {
    assert.equal(classifyModel(value), null, String(value));
  }
  assert.deepEqual(classifyModel(`haiku-${"x".repeat(122)}`), { tier: "fast", host: "claude-code" }, "128 characters");

  assert.equal(isBelowStronger("fast"), true);
  assert.equal(isBelowStronger("balanced"), true);
  assert.equal(isBelowStronger("stronger"), false);
  assert.equal(isBelowStronger(undefined), false);
  assert.equal(isStrongerOrAbove("stronger"), true);
  assert.equal(isStrongerOrAbove("strongest"), true);
  assert.equal(isStrongerOrAbove("balanced"), false);
  assert.equal(isStrongerOrAbove(undefined), false);
});

test("the code tier table matches both delegation.md routing sections", async () => {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const claude = MODEL_TIER_BY_HOST["claude-code"];
  const claudeSentence = new RegExp([
    `fast = [^;]*\\(Claude Code \`${escape(claude.fast)}\`\\)`,
    `balanced = [^;]*\\(\`${escape(claude.balanced)}\`\\)`,
    `stronger = [^;]*\\(\`${escape(claude.stronger)}\`\\)`,
    `strongest = [^;]*\\(\`${escape(claude.strongest)}\`\\)`,
  ].join("; "));
  for (const path of ["skills/pota-plan/delegation.md", "skills/pota-work/delegation.md"]) {
    const doc = await readFile(resolve(path), "utf8");
    assert.match(doc, claudeSentence, `${path} Claude Code tiers`);
    for (const host of ["codex", "antigravity"]) {
      for (const tier of MODEL_TIERS) {
        const phrase = `${tier} \`${MODEL_TIER_BY_HOST[host][tier]}\``;
        assert.ok(doc.includes(phrase), `${path} ${host}: ${phrase}`);
      }
    }
  }
  const strongestColumn = Object.fromEntries(Object.entries(MODEL_TIER_BY_HOST).map(([host, row]) => [host, row.strongest]));
  assert.deepEqual({ ...STRONGEST_MODEL_BY_HOST }, strongestColumn);
  assert.equal(VALIDATION_STRONGEST, STRONGEST_MODEL_BY_HOST, "the validation module re-exports the tier table's column");
});

test("SessionStart with a below-stronger model adds the main-model line after the Pota CLI line, mirrors a notice, and records the session", async () => {
  for (const [locale, ko] of [["en-US", false], ["ko-KR", true]]) {
    await withTempRoot(async (root) => {
      const result = await hook(root, "session-start", { session_id: "s1", model: HAIKU }, { locale });
      const lines = result.hookOutput.hookSpecificOutput.additionalContext.split("\n");
      assert.match(lines.at(-1), /^Pota main model: /);
      assert.match(lines.at(-2), /^Pota CLI: node /);
      assert.equal(result.message.split("\n").at(-1), lines.at(-1));
      assert.equal(lines.at(-1), mainModelLine({ ko, model: HAIKU, tier: "fast", host: "claude-code" }));
      assert.equal(result.hookOutput.systemMessage, mainModelNotice({ ko, model: HAIKU, host: "claude-code" }));
      assert.equal(result.status, 0);
      const record = await readRecordFile(root, "s1");
      assert.deepEqual(Object.keys(record), ["schemaVersion", "sessionKey", "model", "tier", "host", "at"]);
      const { at, ...stored } = record;
      assert.deepEqual(stored, { schemaVersion: 1, sessionKey: "s1", model: HAIKU, tier: "fast", host: "claude-code" });
      assert.equal(typeof at, "string");
    });
  }
  assert.equal(
    mainModelLine({ ko: false, model: HAIKU, tier: "fast", host: "claude-code" }),
    `Pota main model: ${HAIKU} (fast tier, below stronger). Heavy Path only: dispatch planning/triage and final review to a subagent on opus+ and record goal assign --model, or triage-plan/goal finish fail (bypass: --allow-main-model <reason>). Quick/Light run here. See delegation.md "Main Model Gate".`,
  );
  assert.equal(
    mainModelNotice({ ko: true, model: HAIKU, host: "claude-code" }),
    `Pota: 이 세션의 main 모델(${HAIKU})은 stronger tier 미만입니다. Heavy Path의 계획·트리아지·리뷰는 opus 이상 subagent에 위임됩니다. 모델을 바꾸면 늦어도 다음 세션 시작 때 반영됩니다.`,
  );
});

test("SessionStart with a stronger, strongest, unknown, or absent model is byte-identical and creates no Pota home", async () => {
  await withTempRoot(async (root, stateHome) => {
    for (const locale of ["en-US", "ko-KR"]) {
      const baseline = await hook(root, "session-start", { session_id: "s1" }, { locale });
      for (const model of ["opus", "claude-fable-5-2", "gpt-6-sol", "opusplan", "default", undefined, 42, { id: "claude-opus-5-5" }]) {
        const result = await hook(root, "session-start", { session_id: "s1", ...(model === undefined ? {} : { model }) }, { locale });
        assert.equal(JSON.stringify(result.hookOutput), JSON.stringify(baseline.hookOutput), `${locale} ${JSON.stringify(model)}`);
        assert.equal(result.message, baseline.message, `${locale} ${JSON.stringify(model)}`);
      }
    }
    await assert.rejects(lstat(stateHome), { code: "ENOENT" });
  });
});

test("a repeated SessionStart keeps the line but notifies once; a later stronger model clears the record", async () => {
  await withTempRoot(async (root) => {
    const first = await hook(root, "session-start", { session_id: "s1", model: "sonnet" });
    assert.match(lastLine(first), /^Pota main model: sonnet \(balanced tier, below stronger\)/);
    assert.equal(first.hookOutput.systemMessage, mainModelNotice({ ko: false, model: "sonnet", host: "claude-code" }));

    const second = await hook(root, "session-start", { session_id: "s1", model: "sonnet" });
    assert.equal(lastLine(second), lastLine(first));
    assert.equal(second.hookOutput.systemMessage, undefined);

    const switched = await hook(root, "session-start", { session_id: "s1", model: "haiku" });
    assert.match(lastLine(switched), /^Pota main model: haiku \(fast tier/);
    assert.equal(switched.hookOutput.systemMessage, mainModelNotice({ ko: false, model: "haiku", host: "claude-code" }), "a model change notifies again");

    const stronger = await hook(root, "session-start", { session_id: "s1", model: "opus" });
    assert.doesNotMatch(stronger.hookOutput.hookSpecificOutput.additionalContext, /Pota main model:/);
    assert.equal(stronger.hookOutput.systemMessage, undefined);
    await assert.rejects(lstat(mainModelRecordPath(root, "s1")), { code: "ENOENT" });
  });
});

test("UserPromptSubmit never adds main-model context and syncs the record from a Codex model field", async () => {
  await withTempRoot(async (root) => {
    const baseline = await hook(root, "user-prompt-submit", { session_id: "s1" });
    const low = await hook(root, "user-prompt-submit", { session_id: "s1", model: "gpt-6-luna" });
    assert.equal(low.hookOutput.hookSpecificOutput.additionalContext, baseline.hookOutput.hookSpecificOutput.additionalContext);
    assert.equal(low.message, baseline.message);
    assert.equal(low.hookOutput.systemMessage, mainModelNotice({ ko: false, model: "gpt-6-luna", host: "codex" }));
    assert.match(low.hookOutput.systemMessage, /subagents on gpt-6-sol or higher/);
    const { model, tier, host } = await readRecordFile(root, "s1");
    assert.deepEqual({ model, tier, host }, { model: "gpt-6-luna", tier: "fast", host: "codex" });

    const repeated = await hook(root, "user-prompt-submit", { session_id: "s1", model: "gpt-6-luna" });
    assert.equal(JSON.stringify(repeated.hookOutput), JSON.stringify(baseline.hookOutput), "notified once");

    const stronger = await hook(root, "user-prompt-submit", { session_id: "s1", model: "gpt-6-sol" });
    assert.equal(JSON.stringify(stronger.hookOutput), JSON.stringify(baseline.hookOutput));
    await assert.rejects(lstat(mainModelRecordPath(root, "s1")), { code: "ENOENT" });
  });
});

test("subagent payloads and payloads without a session id never record", async () => {
  await withTempRoot(async (root, stateHome) => {
    const baseline = await hook(root, "session-start", { session_id: "s1" });
    const subagent = await hook(root, "session-start", { session_id: "s1", agent_id: "worker-1", model: HAIKU });
    assert.equal(JSON.stringify(subagent.hookOutput), JSON.stringify(baseline.hookOutput));
    await assert.rejects(lstat(stateHome), { code: "ENOENT" });

    for (let run = 0; run < 2; run += 1) {
      const anonymous = await hook(root, "session-start", { model: HAIKU });
      assert.match(lastLine(anonymous), /^Pota main model: claude-haiku/);
      assert.equal(anonymous.hookOutput.systemMessage, mainModelNotice({ ko: false, model: HAIKU, host: "claude-code" }), `run ${run}: no key notifies every time`);
    }
    await assert.rejects(lstat(stateHome), { code: "ENOENT" });
  });
});

test("only a below-stronger payload creates the worktree state directory, holding only per-session main-model files", async () => {
  await withTempRoot(async (root, stateHome) => {
    await hook(root, "session-start", { session_id: "s0", model: "opus" });
    await assert.rejects(lstat(stateHome), { code: "ENOENT" });

    for (let index = 1; index <= 9; index += 1) {
      await hook(root, "session-start", { session_id: `s${index}`, model: "haiku" });
      // Distinct mtimes keep the oldest-first cap deterministic on coarse-timestamp file systems.
      const seconds = Date.parse("2026-11-19T00:00:00.000Z") / 1000 + index;
      await utimes(mainModelRecordPath(root, `s${index}`), seconds, seconds);
    }
    const kept = ["s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];
    assert.deepEqual(await listFiles(stateHome), kept.map((key) => relative(stateHome, mainModelRecordPath(root, key))).sort());
    for (const key of kept) assert.equal(basename(mainModelRecordPath(root, key)), recordFileName(key));
    for (const key of kept) assert.equal((await readRecordFile(root, key)).sessionKey, key);
  });
});

test("main-model lines stay within 340 and 240 characters and stay on one line", () => {
  const longId = `claude-haiku-${"9".repeat(187)}`;
  assert.equal(longId.length, 200);
  for (const ko of [false, true]) {
    for (const tier of ["fast", "balanced"]) {
      for (const host of Object.keys(MODEL_TIER_BY_HOST)) {
        for (const model of [MODEL_TIER_BY_HOST[host][tier], longId]) {
          const line = mainModelLine({ ko, model, tier, host });
          const notice = mainModelNotice({ ko, model, host });
          const label = `${ko ? "ko" : "en"} ${tier} ${host} ${model.length}`;
          assert.ok(line.length <= 340, `${label} line is ${line.length} characters; budget is 340`);
          assert.ok(notice.length <= 240, `${label} notice is ${notice.length} characters; budget is 240`);
          assert.doesNotMatch(line, /\n/, label);
          assert.doesNotMatch(notice, /\n/, label);
          assert.match(line, /^Pota main model: /, label);
          assert.ok(line.includes(MODEL_TIER_BY_HOST[host].stronger), label);
        }
      }
    }
  }
});

test("appendNotice keeps the context order and joins systemMessage", () => {
  const base = {
    status: 0,
    message: "kernel",
    hookOutput: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "kernel" } },
  };
  const once = appendNotice(base, "line a", "a");
  const twice = appendNotice(once, "line b", "b");
  assert.equal(twice.message, "kernel\nline a\nline b");
  assert.equal(twice.hookOutput.hookSpecificOutput.additionalContext, "kernel\nline a\nline b");
  assert.equal(twice.hookOutput.systemMessage, "a\nb");
  assert.equal(twice.hookOutput.hookSpecificOutput.hookEventName, "SessionStart");

  const noticeOnly = appendNotice(base, null, "only");
  assert.equal(noticeOnly.message, base.message);
  assert.deepEqual(noticeOnly.hookOutput.hookSpecificOutput, base.hookOutput.hookSpecificOutput);
  assert.equal(noticeOnly.hookOutput.systemMessage, "only");
  assert.deepEqual(appendNotice(base, null, null), base);
});

test("planning and goal completion pass without a record, with an unrelated session, or with no session key", async () => {
  const lowRecord = { schemaVersion: 1, sessionKey: "s1", model: HAIKU, tier: "fast", host: "claude-code", at: "2026-11-19T00:00:00.000Z" };
  const cases = [
    ["no record", null, { sessionId: "s1" }],
    ["unrelated session", lowRecord, { sessionId: "s2" }],
    ["no session key and no owner", lowRecord, { sessionId: null }],
    ["corrupt JSON", "{not json", { sessionId: "s1" }],
    ["record is an array", [lowRecord], { sessionId: "s1" }],
    ["unknown schema", { ...lowRecord, schemaVersion: 2 }, { sessionId: "s1" }],
    ["stored stronger tier", { ...lowRecord, model: "claude-opus-5-5", tier: "stronger" }, { sessionId: "s1" }],
    ["stored tier is not trusted", { ...lowRecord, model: "opus", tier: "fast" }, { sessionId: "s1" }],
    ["__proto__ key", lowRecord, { sessionId: "__proto__" }],
    ["directory at the record path", DIRECTORY, { sessionId: "s1" }],
  ];
  for (const [label, content, { sessionId }] of cases) {
    await withTempRoot(async (root) => {
      await startPlanningGoal(root, { tasks: [triageTask()] });
      if (content) await writeRecordFile(root, "s1", content);
      await recordTriageEvidence(root);
      const planned = await setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId });
      assert.equal(task(planned, "triage-plan").status, "completed", label);
      const finished = await finishGoal({ root, argv: passArgv, sessionId });
      assert.equal(finished.goal.status, "completed", label);
    });
  }
});

test("a below-stronger main model blocks completing a triageDecision task until a stronger dispatch or a waiver", async () => {
  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [triageTask(), { id: "implement", title: "Implement" }] });
    await recordLowSession(root, "s1");
    await recordTriageEvidence(root);
    await assert.rejects(setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1" }), planningGateError);
    assert.equal(task(await readGoalState({ root }), "triage-plan").status, "active");

    await assignTask({ root, taskId: "triage-plan", agentId: "planner", model: "sonnet", modelHost: "claude-code" });
    await assert.rejects(setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1" }), planningGateError);

    await assert.rejects(
      setTaskStatus({ root, taskId: "triage-plan", status: "blocked", blocker: "waiting", mainModelWaiver: "user accepted", sessionId: "s1" }),
      /--allow-main-model applies only when completing a task/,
    );

    await assignTask({ root, taskId: "triage-plan", agentId: "planner", model: "opus", modelHost: "claude-code" });
    const planned = await setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1" });
    assert.equal(task(planned, "triage-plan").status, "completed");

    // A task without triageDecision evidence is not a planning task.
    await recordTaskEvidence(root, "implement");
    const implemented = await setTaskStatus({ root, taskId: "implement", status: "completed", sessionId: "s1" });
    assert.equal(task(implemented, "implement").status, "completed");
  });

  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [triageTask()] });
    await recordLowSession(root, "s1");
    await recordTriageEvidence(root);
    const waived = await setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1", mainModelWaiver: "switched to claude-opus-5-5" });
    assert.equal(task(waived, "triage-plan").status, "completed");
    assert.equal("mainModelWaiver" in task(waived, "triage-plan"), false, "the waiver is not stored");
  });
});

test("a Light goal below the stronger tier completes triage-plan and goal finish without a stronger dispatch record", async () => {
  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [triageTask(), { id: "build", title: "Build", route: "light" }], heavy: false });
    await recordLowSession(root, "s1");
    await recordTriageEvidence(root);
    const planned = await setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1" });
    assert.equal(task(planned, "triage-plan").status, "completed");
    await recordTaskEvidence(root, "build");
    const finished = await finishGoal({ root, argv: passArgv, sessionId: "s1" });
    assert.equal(finished.goal.status, "completed");
  });
});

test("goal finish refuses before running verification, and goal complete refuses, without a stronger review dispatch", async () => {
  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [{ id: "build", title: "Build" }, { id: "review", title: "Review" }] });
    await recordLowSession(root, "s1");
    await recordTaskEvidence(root, "build");
    const marker = join(root, "must-not-run.txt");
    const markerArgv = [process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`];
    await assert.rejects(finishGoal({ root, argv: markerArgv, sessionId: "s1" }), /other tasks remain: review/, "tasks remain is reported first");

    await setTaskStatus({ root, taskId: "build", status: "completed", sessionId: "s1" });
    await recordTaskEvidence(root, "review");
    await assert.rejects(finishGoal({ root, argv: markerArgv, sessionId: "s1" }), reviewGateError);
    await assert.rejects(access(marker), { code: "ENOENT" });
    assert.equal(task(await readGoalState({ root }), "review").status, "active");

    await assignTask({ root, taskId: "review", kind: "review", agentId: "reviewer", model: "opus", modelHost: "claude-code" });
    const finished = await finishGoal({ root, argv: passArgv, sessionId: "s1" });
    assert.equal(finished.goal.status, "completed");
  });

  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [{ id: "build", title: "Build" }] });
    await recordLowSession(root, "s1");
    await recordTaskEvidence(root, "build");
    const finished = await finishGoal({ root, argv: passArgv, sessionId: "s1", mainModelWaiver: "user accepted the session model" });
    assert.equal(finished.goal.status, "completed");
  });

  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [{ id: "build", title: "Build" }] });
    await recordLowSession(root, "s1");
    await assert.rejects(transitionGoal({ root, status: "completed", sessionId: "s1" }), /Goal cannot be completed while tasks remain: build/);
    await recordTaskEvidence(root, "build");
    await setTaskStatus({ root, taskId: "build", status: "completed", sessionId: "s1" });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "final review", exitCode: 0 });
    await assert.rejects(transitionGoal({ root, status: "completed", sessionId: "s1" }), reviewGateError);
    assert.equal((await readGoalState({ root })).goal.status, "active");
    await assert.rejects(
      transitionGoal({ root, status: "paused", sessionId: "s1", mainModelWaiver: "reason" }),
      /--allow-main-model applies only when completing a goal/,
    );
    const completed = await transitionGoal({ root, status: "completed", sessionId: "s1", mainModelWaiver: "user accepted the session model" });
    assert.equal(completed.goal.status, "completed");
  });
});

test("Antigravity balanced main model triggers SessionStart notice, planning gate, and review gate", async () => {
  await withTempRoot(async (root) => {
    const start = await hook(root, "session-start", { session_id: "agy-1", model: "gemini-3.8-flash-medium" });
    assert.equal(
      lastLine(start),
      mainModelLine({ ko: false, model: "gemini-3.8-flash-medium", tier: "balanced", host: "antigravity" }),
    );
    assert.equal(
      start.hookOutput.systemMessage,
      mainModelNotice({ ko: false, model: "gemini-3.8-flash-medium", host: "antigravity" }),
    );
    const { model, tier, host } = await readRecordFile(root, "agy-1");
    assert.deepEqual({ model, tier, host }, { model: "gemini-3.8-flash-medium", tier: "balanced", host: "antigravity" });

    await startPlanningGoal(root, { tasks: [triageTask(), { id: "review", title: "Review" }] });
    await recordTriageEvidence(root);
    await assert.rejects(
      setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "agy-1" }),
      /Planning task triage-plan was not dispatched at the stronger tier: this session's main model is gemini-3\.8-flash-medium \(balanced tier\)\. Dispatch planning and triage to pro/,
    );
    await assignTask({ root, taskId: "triage-plan", agentId: "planner", model: "gpt-oss-120b-medium", modelHost: "antigravity" });
    await assert.rejects(
      setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "agy-1" }),
      /Planning task triage-plan was not dispatched at the stronger tier/,
    );
    await assignTask({ root, taskId: "triage-plan", agentId: "planner", model: "gemini-4-neon-high", modelHost: "antigravity" });
    assert.equal(task(await setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "agy-1" }), "triage-plan").status, "completed");

    await recordTaskEvidence(root, "review");
    await assert.rejects(
      finishGoal({ root, argv: passArgv, sessionId: "agy-1" }),
      /Goal goal-[0-9a-f-]+ has no review dispatched at the stronger tier: this session's main model is gemini-3\.8-flash-medium \(balanced tier\)/,
    );
    await assignTask({ root, taskId: "review", kind: "review", agentId: "reviewer", effort: "high", designWaiver: "review only", model: "claude-opus-5-5-high", modelHost: "antigravity" });
    const finished = await finishGoal({ root, argv: passArgv, sessionId: "agy-1" });
    assert.equal(finished.goal.status, "completed");
  });
});

test("review dispatch tier is judged per host and unknown or non-host-option models do not pass", async () => {
  const passing = [
    { model: "opus", modelHost: "claude-code" },
    { model: "fable", modelHost: "claude-code" },
    { model: "claude-opus-5-5", modelHost: "claude-code" },
    { model: "gpt-6-sol", modelHost: "codex" },
    { model: "gpt-6-astra", modelHost: "codex" },
    { model: "pro", modelHost: "antigravity" },
    { model: "pro" },
    { model: "gemini-4-neon-high", modelHost: "antigravity" },
    { model: "gemini-4-argon-high", modelHost: "antigravity" },
    { model: "claude-opus-5-5-high", modelHost: "antigravity" },
  ];
  const refused = [
    { kind: "review", model: "sonnet", modelHost: "claude-code" },
    { kind: "review", model: "gpt-6.1-terra", modelHost: "codex" },
    { kind: "review", model: "flash", modelHost: "antigravity" },
    { kind: "review", model: "gemini-3.8-flash-medium", modelHost: "antigravity" },
    { kind: "review", model: "claude-sonnet-5-5-medium", modelHost: "antigravity" },
    { kind: "review", model: "opus", modelSource: "inherited", modelHost: "claude-code" },
    { kind: "review", model: "pro", modelHost: "claude-code" },
    { kind: "review", model: "opusplan" },
    { model: "opus", modelHost: "claude-code" },
  ];
  for (const [ok, records] of [[true, passing.map((record) => ({ kind: "review", ...record }))], [false, refused]]) {
    for (const record of records) {
      await withTempRoot(async (root) => {
        await startPlanningGoal(root, { tasks: [{ id: "review", title: "Review" }] });
        await recordLowSession(root, "s1");
        await assignTask({ root, taskId: "review", agentId: "reviewer", effort: "high", designWaiver: "review-only goal", ...record });
        await recordTaskEvidence(root, "review");
        const label = JSON.stringify(record);
        if (ok) assert.equal((await finishGoal({ root, argv: passArgv, sessionId: "s1" })).goal.status, "completed", label);
        else await assert.rejects(finishGoal({ root, argv: passArgv, sessionId: "s1" }), reviewGateError, label);
      });
    }
  }
});

test("the gate keys on CLAUDE_CODE_SESSION_ID, then the goal owner, else nothing", async () => {
  const cases = [
    ["env names another session", { CLAUDE_CODE_SESSION_ID: "s2" }, null, true],
    ["env names the recorded session", { CLAUDE_CODE_SESSION_ID: "s1" }, null, false],
    ["env takes precedence over the owner", { CLAUDE_CODE_SESSION_ID: "s2" }, "s1", true],
    ["no env, owner is the recorded session", {}, "s1", false],
    ["no env, no owner", {}, null, true],
  ];
  for (const [label, env, ownerSessionId, passes] of cases) {
    await withTempRoot(async (root) => {
      await startPlanningGoal(root, { tasks: [triageTask()], ownerSessionId });
      await recordLowSession(root, "s1");
      await recordTriageEvidence(root);
      const io = { stdout: () => {}, stderr: () => {}, env };
      const run = handleGoalCli(["goal", "task", "triage-plan", "--status", "completed", "--root", root], io);
      if (passes) await run;
      else await assert.rejects(run, planningGateError, label);
      assert.equal(task(await readGoalState({ root }), "triage-plan").status, passes ? "completed" : "active", label);
    });
  }
});

test("goal CLI accepts --allow-main-model on task, finish, and complete, rejects it elsewhere, and reports the bypass on stderr", async () => {
  const env = { CLAUDE_CODE_SESSION_ID: "s1" };
  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [triageTask(), { id: "build", title: "Build" }] });
    await recordLowSession(root, "s1");
    await recordTriageEvidence(root);
    const out = [];
    const err = [];
    const io = { stdout: (line) => out.push(line), stderr: (line) => err.push(line), env };
    await assert.rejects(
      handleGoalCli(["goal", "task", "triage-plan", "--status", "blocked", "--reason", "wait", "--allow-main-model", "x", "--root", root], io),
      /--allow-main-model applies only when completing a task/,
    );
    await assert.rejects(handleGoalCli(["goal", "pause", "--allow-main-model", "x", "--root", root], io), /Unknown option for pause: --allow-main-model/);
    await assert.rejects(handleGoalCli(["goal", "assign", "triage-plan", "--allow-main-model", "x", "--root", root], io), /Unknown option for assign: --allow-main-model/);
    assert.deepEqual(err, []);

    await handleGoalCli(["goal", "task", "triage-plan", "--status", "completed", "--allow-main-model", "user accepted the session model", "--root", root], io);
    assert.deepEqual(JSON.parse(out.at(-1)), await readGoalState({ root }), "stdout JSON is the state");
    assert.deepEqual(err, ["Pota warning: main-model gate bypassed for goal task: user accepted the session model"]);

    err.length = 0;
    await recordTaskEvidence(root, "build");
    await handleGoalCli(["goal", "finish", "--allow-main-model", "no subagent tools", "--root", root, "--", ...passArgv], io);
    assert.equal(err.length, 1);
    assert.match(err[0], /^Pota warning: main-model gate bypassed for goal finish: no subagent tools$/);
    assert.deepEqual(Object.keys(JSON.parse(out.at(-1))), ["id", "status"]);
    assert.equal(JSON.parse(out.at(-1)).status, "completed");
  });

  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [{ id: "build", title: "Build" }] });
    await recordLowSession(root, "s1");
    await recordTaskEvidence(root, "build");
    await setTaskStatus({ root, taskId: "build", status: "completed", sessionId: "s1" });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "final review", exitCode: 0 });
    const out = [];
    const err = [];
    const io = { stdout: (line) => out.push(line), stderr: (line) => err.push(line), env };
    await assert.rejects(handleGoalCli(["goal", "complete", "--root", root], io), reviewGateError);
    assert.deepEqual(err, []);
    await handleGoalCli(["goal", "complete", "--allow-main-model", "switched to claude-opus-5-5", "--root", root], io);
    assert.equal(JSON.parse(out.at(-1)).goal.status, "completed");
    assert.deepEqual(err, ["Pota warning: main-model gate bypassed for goal complete: switched to claude-opus-5-5"]);
  });
});

test("kind review is accepted by start, replan, and assign, and stats show it", async () => {
  await withTempRoot(async (root) => {
    let state = await startGoal({
      root,
      goal: "Review kinds",
      planId: "docs/plan/review-kind.md",
      evidencePolicy: "declared",
      tasks: [{ id: "build", title: "Build" }, { id: "review", title: "Review", kind: "review" }],
    });
    assert.equal(task(state, "review").kind, "review");
    assert.equal(goalStats(state, root).tasks[1].kind, "review");

    state = await replanGoal({ root, tasks: [{ id: "build", title: "Build" }, { id: "final", title: "Final review", kind: "review" }] });
    assert.equal(task(state, "final").kind, "review");

    state = await assignTask({ root, taskId: "build", kind: "review" });
    assert.equal(task(state, "build").kind, "review");
    assert.equal(goalStats(await readGoalState({ root }), root).tasks[0].kind, "review");

    await assert.rejects(assignTask({ root, taskId: "build", kind: "build" }), /kind must be one of: design, review/);
    await assert.rejects(
      replanGoal({ root, tasks: [{ id: "x", title: "X", kind: "build" }] }),
      /kind must be one of: design, review/,
    );
  });
});

test("a concurrent clear and record for different sessions never resurrects the cleared record", async () => {
  const low = (model) => ({ model, ...classifyModel(model) });
  await withTempRoot(async (root) => {
    for (let run = 0; run < 50; run += 1) {
      await syncMainModelRecord(root, "a", low(HAIKU));
      assert.equal((await readMainModelRecord(root, "a"))?.model, HAIKU, `run ${run}: a is recorded first`);
      const model = run % 2 === 0 ? "sonnet" : "haiku";
      await Promise.all([syncMainModelRecord(root, "a", null), syncMainModelRecord(root, "b", low(model))]);
      assert.equal(await readMainModelRecord(root, "a"), null, `run ${run}: a stays cleared`);
      assert.equal((await readMainModelRecord(root, "b"))?.model, model, `run ${run}: b keeps its record`);
    }
  });
});

test("a session whose stored key is __proto__ records, reads, and clears its own file", async () => {
  await withTempRoot(async (root) => {
    const entry = { model: HAIKU, ...classifyModel(HAIKU) };
    assert.equal(await syncMainModelRecord(root, "__proto__", entry), "recorded");
    assert.equal(basename(mainModelRecordPath(root, "__proto__")), recordFileName("__proto__"));
    assert.equal((await readRecordFile(root, "__proto__")).sessionKey, "__proto__");
    assert.deepEqual(await readMainModelRecord(root, "__proto__"), { model: HAIKU, tier: "fast", host: "claude-code" });
    assert.equal(await readMainModelRecord(root, "constructor"), null);
    assert.equal(await syncMainModelRecord(root, "__proto__", entry), "unchanged");
    assert.equal(await syncMainModelRecord(root, "__proto__", null), "cleared");
    await assert.rejects(lstat(mainModelRecordPath(root, "__proto__")), { code: "ENOENT" });
    assert.equal(await readMainModelRecord(root, "__proto__"), null);
    assert.equal(await syncMainModelRecord(root, "__proto__", null), "unchanged");
  });
});

test("a record file whose stored sessionKey differs from the lookup key is not accepted", async () => {
  await withTempRoot(async (root) => {
    const stored = { schemaVersion: 1, sessionKey: "s2", model: HAIKU, tier: "fast", host: "claude-code", at: "2026-11-19T00:00:00.000Z" };
    await writeRecordFile(root, "s1", stored);
    assert.equal(await readMainModelRecord(root, "s1"), null);
    assert.equal(await readMainModelRecord(root, "s2"), null, "s2 looks only at its own file");
    await writeRecordFile(root, "s1", { ...stored, sessionKey: undefined });
    assert.equal(await readMainModelRecord(root, "s1"), null, "a record without a key");

    await rm(mainModelRecordPath(root, "s1"));
    const target = join(root, "elsewhere.json");
    await writeFile(target, JSON.stringify({ ...stored, sessionKey: "s1" }));
    let linked = true;
    try {
      await symlink(target, mainModelRecordPath(root, "s1"));
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
      linked = false;
    }
    if (linked) assert.equal(await readMainModelRecord(root, "s1"), null, "a symlinked record");
  });
});

test("recording a ninth session removes the oldest session file by mtime", async () => {
  await withTempRoot(async (root) => {
    const entry = { model: "sonnet", ...classifyModel("sonnet") };
    const start = Date.parse("2026-11-19T00:00:00.000Z") / 1000;
    for (let index = 1; index <= 8; index += 1) {
      assert.equal(await syncMainModelRecord(root, `s${index}`, entry), "recorded");
      // s3 is the oldest, so removal follows mtime rather than session order.
      const seconds = start + (index === 3 ? 0 : index * 10);
      await utimes(mainModelRecordPath(root, `s${index}`), seconds, seconds);
    }
    assert.equal((await mainModelFiles(root)).length, 8);
    assert.equal(await syncMainModelRecord(root, "s9", entry), "recorded");
    const kept = ["s1", "s2", "s4", "s5", "s6", "s7", "s8", "s9"];
    assert.deepEqual(await mainModelFiles(root), kept.map(recordFileName).sort());
    await assert.rejects(lstat(mainModelRecordPath(root, "s3")), { code: "ENOENT" });
    for (const key of kept) assert.equal((await readMainModelRecord(root, key))?.model, "sonnet", key);
  });
});

test("POTA_MAIN_MODEL_GATE off makes a below-stronger hook payload identical to one without a model and writes nothing", async () => {
  for (const value of ["0", "false", " OFF ", "No"]) assert.equal(mainModelGateEnabled({ POTA_MAIN_MODEL_GATE: value }), false, value);
  for (const value of [undefined, "", "1", "on", "true", "yes", "disabled"]) {
    assert.equal(mainModelGateEnabled(value === undefined ? {} : { POTA_MAIN_MODEL_GATE: value }), true, String(value));
  }
  await withTempRoot(async (root, stateHome) => {
    for (const locale of ["en-US", "ko-KR"]) {
      for (const [event, model] of [["session-start", HAIKU], ["user-prompt-submit", "gpt-6-luna"]]) {
        const baseline = await hook(root, event, { session_id: "s1" }, { locale });
        for (const value of ["0", "off"]) {
          const result = await hook(root, event, { session_id: "s1", model }, { locale, env: { POTA_MAIN_MODEL_GATE: value } });
          const label = `${locale} ${event} ${value}`;
          assert.equal(JSON.stringify(result.hookOutput), JSON.stringify(baseline.hookOutput), label);
          assert.equal(result.message, baseline.message, label);
        }
      }
    }
    await assert.rejects(lstat(stateHome), { code: "ENOENT" });
    const on = await hook(root, "session-start", { session_id: "s1", model: HAIKU }, { env: { POTA_MAIN_MODEL_GATE: "1" } });
    assert.match(lastLine(on), /^Pota main model: /, "any other value keeps the gate");
  });
});

test("POTA_MAIN_MODEL_GATE off lets triage completion, goal finish, and goal complete pass despite a below-stronger record", async () => {
  const off = { CLAUDE_CODE_SESSION_ID: "s1", POTA_MAIN_MODEL_GATE: "off" };
  const io = (env, err = []) => ({ stdout: () => {}, stderr: (line) => err.push(line), env });
  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [triageTask(), { id: "build", title: "Build" }] });
    await recordLowSession(root, "s1");
    await recordTriageEvidence(root);
    const command = ["goal", "task", "triage-plan", "--status", "completed", "--root", root];
    await assert.rejects(handleGoalCli(command, io({ CLAUDE_CODE_SESSION_ID: "s1" })), planningGateError, "the record gates when on");
    const err = [];
    await handleGoalCli(command, io(off, err));
    assert.equal(task(await readGoalState({ root }), "triage-plan").status, "completed");
    await recordTaskEvidence(root, "build");
    await handleGoalCli(["goal", "finish", "--root", root, "--", ...passArgv], io(off, err));
    assert.deepEqual(err, []);
    assert.equal(await readGoalState({ root }), null, "the completed goal is closed");
  });

  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [{ id: "build", title: "Build" }] });
    await recordLowSession(root, "s1");
    await recordTaskEvidence(root, "build");
    await setTaskStatus({ root, taskId: "build", status: "completed", sessionId: "s1" });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "final review", exitCode: 0 });
    await assert.rejects(handleGoalCli(["goal", "complete", "--root", root], io({ CLAUDE_CODE_SESSION_ID: "s1" })), reviewGateError);
    const out = [];
    await handleGoalCli(["goal", "complete", "--root", root], { stdout: (line) => out.push(line), stderr: () => {}, env: off });
    assert.equal(JSON.parse(out.at(-1)).goal.status, "completed");
  });
});

// env is explicit so the host's POTA_MAIN_MODEL_GATE never leaks in.
async function hook(root, event, payload, { locale = "en-US", now, env = {} } = {}) {
  return runStateResult(event, {
    root,
    locale,
    payload: { cwd: root, ...payload },
    mainModel: { env, ...(now ? { now } : {}) },
  });
}

function lastLine(result) {
  return result.hookOutput.hookSpecificOutput.additionalContext.split("\n").at(-1);
}

const DIRECTORY = Symbol("directory");

function recordFileName(sessionKey) {
  return `main-model-${createHash("sha256").update(sessionKey, "utf8").digest("hex").slice(0, 16)}.json`;
}

async function readRecordFile(root, sessionKey) {
  return JSON.parse(await readFile(mainModelRecordPath(root, sessionKey), "utf8"));
}

async function writeRecordFile(root, sessionKey, content) {
  const path = mainModelRecordPath(root, sessionKey);
  await mkdir(dirname(path), { recursive: true });
  if (content === DIRECTORY) await mkdir(path);
  else await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
}

async function mainModelFiles(root) {
  return (await readdir(dirname(mainModelRecordPath(root, "s1")))).filter((name) => name.startsWith("main-model-")).sort();
}

async function recordLowSession(root, sessionId) {
  await hook(root, "session-start", { session_id: sessionId, model: HAIKU });
  assert.equal((await readRecordFile(root, sessionId)).model, HAIKU);
}

function triageTask() {
  return { id: "triage-plan", title: "Run planned triage and finalize the plan", requiredEvidence: ["planArtifact", "triageDecision"] };
}

// The gate applies only to goals with a Heavy Path task, so one task is marked heavy unless heavy is false: the first
// task that is neither triage nor review, else the first review task, else the first task. A goal whose only heavy task
// is also assigned needs effort and a design waiver in the test (see the review-tier test).
async function startPlanningGoal(root, { tasks, ownerSessionId = null, heavy = true }) {
  const isReview = (item) => item.kind === "review" || ["review", "final"].includes(item.id);
  const target = !heavy ? -1 : [
    tasks.findIndex((item) => item.id !== "triage-plan" && !isReview(item)),
    tasks.findIndex(isReview),
    0,
  ].find((index) => index !== -1);
  if (target !== undefined && target !== -1) tasks = tasks.map((item, index) => (index === target ? { ...item, route: "heavy" } : item));
  return startGoal({
    root,
    goal: "Gate the main model",
    planId: "docs/plan/main-model.md",
    evidencePolicy: "declared",
    ownerSessionId,
    tasks,
  });
}

async function recordTriageEvidence(root) {
  for (const kind of ["planArtifact", "triageDecision"]) {
    await recordReceipt({ root, taskId: "triage-plan", kind, command: `record ${kind}`, exitCode: 0 });
  }
}

async function recordTaskEvidence(root, taskId) {
  for (const kind of ["moduleAcceptance", "surfaceIntegration"]) {
    await recordReceipt({ root, taskId, kind, command: `verify ${taskId} ${kind}`, exitCode: 0 });
  }
}

function task(state, id) {
  return state.tasks.find((item) => item.id === id);
}

async function listFiles(directory) {
  const files = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(relative(directory, path));
    }
  };
  await visit(directory);
  return files.sort();
}

// Library calls pass sessionId explicitly and CLI calls inject env, so the host's CLAUDE_CODE_SESSION_ID never leaks in.
async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-main-model-"));
  const stateHome = `${root}-home`;
  const previousPotaHome = process.env.POTA_HOME;
  process.env.POTA_HOME = stateHome;
  try {
    await work(root, stateHome);
  } finally {
    if (previousPotaHome === undefined) delete process.env.POTA_HOME;
    else process.env.POTA_HOME = previousPotaHome;
    await rm(root, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
}
