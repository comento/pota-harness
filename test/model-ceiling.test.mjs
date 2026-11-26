import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assignTask,
  finishGoal,
  handleGoalCli,
  readGoalState,
  recordReceipt,
  setTaskStatus,
  startGoal,
  transitionGoal,
} from "../scripts/pota-goal.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import {
  mainModelLine, mainModelNotice, modelCeilingInvalidNotice, modelCeilingLine,
} from "../scripts/pota-state-context.mjs";
import { mainModelRecordPath } from "../scripts/pota-goal-state.mjs";
import {
  MODEL_CEILINGS, MODEL_TIERS, MODEL_TIER_BY_HOST,
  classifyModel, effectiveModel, effectiveTier, isAtOrAboveTier, isBelowTier, modelsAtOrAbove, parseModelCeiling, tierRank, validCeiling,
} from "../scripts/pota-model-tier.mjs";
import { NO_MODEL_CEILING, invalidModelCeilingWarning, resolveModelCeiling } from "../scripts/pota-model-ceiling.mjs";

const HAIKU = "claude-haiku-4-5-20251001";
const passArgv = [process.execPath, "-e", "process.exit(0)"];
const STATE_SCRIPT = resolve("scripts/pota-state.mjs");

const CEILING_LINES = {
  stronger: {
    en: "Pota model ceiling: stronger (Claude Code opus, Codex gpt-6-sol, Antigravity pro). Never dispatch above it: strongest-tier work (Heavy design) runs on that model; pass and record that value (goal assign --model) and the gates accept it. This overrides tier values in skill text. See delegation.md \"Model Ceiling\".",
    ko: "Pota model ceiling: stronger (Claude Code opus, Codex gpt-6-sol, Antigravity pro). 이보다 높은 모델로 dispatch하지 마세요. strongest tier 작업(Heavy 설계)도 이 모델로 실행하고, 넘긴 값을 goal assign --model로 기록하면 게이트를 통과합니다. skill 문구의 tier 값보다 이 줄이 우선합니다. 상세: delegation.md \"Model Ceiling\".",
  },
  balanced: {
    en: "Pota model ceiling: balanced (Claude Code sonnet, Codex gpt-6.1-terra, Antigravity flash). Never dispatch above it: stronger- and strongest-tier work (planning, triage, review, Heavy work) runs on that model; pass and record that value (goal assign --model) and the gates accept it. This overrides tier values in skill text. See delegation.md \"Model Ceiling\".",
    ko: "Pota model ceiling: balanced (Claude Code sonnet, Codex gpt-6.1-terra, Antigravity flash). 이보다 높은 모델로 dispatch하지 마세요. stronger·strongest tier 작업(계획·트리아지·리뷰·Heavy 작업)도 이 모델로 실행하고, 넘긴 값을 goal assign --model로 기록하면 게이트를 통과합니다. skill 문구의 tier 값보다 이 줄이 우선합니다. 상세: delegation.md \"Model Ceiling\".",
  },
};

test("parseModelCeiling reads tier names and model names, treats strongest as no ceiling, and rejects fast and unknown values", () => {
  const set = (ceiling) => ({ status: "set", ceiling });
  const cases = [
    ["stronger", set("stronger")],
    ["balanced", set("balanced")],
    [" Stronger ", set("stronger")],
    ["opus", set("stronger")],
    ["claude-opus-5-5", set("stronger")],
    ["gpt-6-sol", set("stronger")],
    ["sonnet", set("balanced")],
    ["flash", set("balanced")],
    ["gemini-3.8-flash-medium", set("balanced")],
    ["gpt-oss-120b-medium", set("balanced")],
    ["gemini-4-neon-high", set("stronger")],
    ["gemini-4-hydrogen-tiered-xhigh", set("stronger")],
    ["gemini-pro-orchestrator-neon", set("stronger")],
    ["strongest", { status: "none", ceiling: null }],
    ["fable", { status: "none", ceiling: null }],
    ["gpt-6-astra", { status: "none", ceiling: null }],
    ["gemini-4-argon-high", { status: "none", ceiling: null }],
    ["pro", { status: "invalid", ceiling: null }],
    [" PRO ", { status: "invalid", ceiling: null }],
    ["Pro", { status: "invalid", ceiling: null }],
    ["fast", { status: "invalid", ceiling: null }],
    ["haiku", { status: "invalid", ceiling: null }],
    ["gemini-3.5-flash-lite", { status: "invalid", ceiling: null }],
    ["opusplan", { status: "invalid", ceiling: null }],
    ["off", { status: "invalid", ceiling: null }],
    ["turbo", { status: "invalid", ceiling: null }],
    [42, { status: "invalid", ceiling: null }],
    [true, { status: "invalid", ceiling: null }],
    [{}, { status: "invalid", ceiling: null }],
    ["", { status: "unset", ceiling: null }],
    ["   ", { status: "unset", ceiling: null }],
    [undefined, { status: "unset", ceiling: null }],
    [null, { status: "unset", ceiling: null }],
  ];
  for (const [raw, expected] of cases) assert.deepEqual(parseModelCeiling(raw), expected, JSON.stringify(raw));
  // "pro" reads like the "Pro" subscription plan, so only the ceiling rejects it; the tier table still classifies it.
  assert.deepEqual(classifyModel("pro"), { tier: "strongest", host: "antigravity" });
  assert.deepEqual(
    resolveModelCeiling({ env: { POTA_MODEL_CEILING: "Pro" } }),
    { ceiling: null, source: null, invalid: { source: "env", value: "Pro" } },
  );
});

test("effectiveTier, effectiveModel, and modelsAtOrAbove cap the tier table per host", () => {
  assert.deepEqual([...MODEL_CEILINGS], ["balanced", "stronger"]);
  for (const tier of MODEL_TIERS) {
    assert.equal(effectiveTier(tier), tier);
    assert.equal(effectiveTier(tier, null), tier);
    assert.equal(effectiveTier(tier, "fast"), tier, "fast is not a ceiling");
    assert.equal(effectiveTier(tier, "turbo"), tier);
    for (const host of Object.keys(MODEL_TIER_BY_HOST)) assert.equal(effectiveModel(host, tier), MODEL_TIER_BY_HOST[host][tier]);
  }
  assert.equal(effectiveTier("strongest", "stronger"), "stronger");
  assert.equal(effectiveTier("strongest", "balanced"), "balanced");
  assert.equal(effectiveTier("stronger", "balanced"), "balanced");
  assert.equal(effectiveTier("fast", "balanced"), "fast");
  assert.equal(effectiveModel("claude-code", "strongest", "stronger"), "opus");
  assert.equal(effectiveModel("claude-code", "stronger", "balanced"), "sonnet");
  assert.equal(effectiveModel("codex", "strongest", "balanced"), "gpt-6.1-terra");
  assert.equal(effectiveModel("gemini", "strongest"), null);
  assert.deepEqual(modelsAtOrAbove("claude-code", "strongest"), ["fable"]);
  assert.deepEqual(modelsAtOrAbove("claude-code", "stronger"), ["opus", "fable"]);
  assert.deepEqual(modelsAtOrAbove("claude-code", "balanced"), ["sonnet", "opus", "fable"]);
  assert.deepEqual(modelsAtOrAbove("antigravity", "stronger"), ["pro"]);
  assert.deepEqual(modelsAtOrAbove("antigravity", "balanced"), ["flash", "pro"]);
  assert.deepEqual(modelsAtOrAbove("gemini", "stronger"), []);
  assert.equal(validCeiling("fast"), null);
  assert.equal(validCeiling("strongest"), null);
  assert.equal(validCeiling("stronger"), "stronger");
  assert.equal(validCeiling("balanced"), "balanced");
  assert.equal(tierRank("fast"), 0);
  assert.equal(tierRank("strongest"), 3);
  assert.equal(tierRank("turbo"), -1);
  assert.equal(isBelowTier("balanced", "stronger"), true);
  assert.equal(isBelowTier("balanced", "balanced"), false);
  assert.equal(isBelowTier(undefined, "balanced"), false);
  assert.equal(isAtOrAboveTier("balanced", "balanced"), true);
  assert.equal(isAtOrAboveTier("fast", "balanced"), false);
  assert.equal(isAtOrAboveTier(undefined, "fast"), false);
});

test("resolveModelCeiling prefers the environment, falls back to config.json, and never throws or writes", async () => {
  await withTempHome(async (home) => {
    const resolveWith = (env) => resolveModelCeiling({ env, home });
    assert.deepEqual(resolveWith({ POTA_MODEL_CEILING: "opus" }), { ceiling: "stronger", source: "env", invalid: null });
    await rm(home, { recursive: true, force: true });
    assert.deepEqual(resolveWith({}), NO_MODEL_CEILING, "a missing home is no ceiling");
    await assert.rejects(lstat(home), { code: "ENOENT" }, "resolving never creates the home");

    await writeConfig(home, { modelCeiling: "balanced", autoUpgrade: false });
    assert.deepEqual(resolveWith({ POTA_MODEL_CEILING: "  " }), { ceiling: "balanced", source: "config", invalid: null });
    assert.deepEqual(resolveWith({}), { ceiling: "balanced", source: "config", invalid: null });
    assert.deepEqual(
      resolveWith({ POTA_MODEL_CEILING: "turbo" }),
      { ceiling: null, source: null, invalid: { source: "env", value: "turbo" } },
      "an invalid environment value never falls back to config.json",
    );
    assert.deepEqual(resolveWith({ POTA_MODEL_CEILING: "strongest" }), NO_MODEL_CEILING);

    await writeConfig(home, { modelCeiling: 5 });
    assert.deepEqual(resolveWith({}), { ceiling: null, source: null, invalid: { source: "config", value: "5" } });
    await writeConfig(home, { autoUpgrade: true });
    assert.deepEqual(resolveWith({}), NO_MODEL_CEILING);
    await writeConfig(home, "{not json");
    assert.deepEqual(resolveWith({}), NO_MODEL_CEILING);
    await writeConfig(home, ["stronger"]);
    assert.deepEqual(resolveWith({}), NO_MODEL_CEILING);

    const config = join(home, "config.json");
    const target = join(home, "target.json");
    await writeFile(target, JSON.stringify({ modelCeiling: "stronger" }));
    await rm(config, { force: true });
    await symlink(target, config);
    assert.deepEqual(resolveWith({}), NO_MODEL_CEILING, "a symlinked config.json is not read");
    await rm(config, { force: true });
    await mkdir(config);
    assert.deepEqual(resolveWith({}), NO_MODEL_CEILING, "a directory is not read");

    const long = resolveWith({ POTA_MODEL_CEILING: `bad\n${"x".repeat(200)}` });
    assert.equal(long.invalid.source, "env");
    assert.ok(long.invalid.value.length <= 40, long.invalid.value);
    assert.doesNotMatch(long.invalid.value, /\n/);
  });

  // The default home is computed inside the guard, so a failing home lookup is no ceiling instead of a hook crash.
  const savedEnv = process.env;
  process.env = {
    get POTA_HOME() {
      throw new Error("home lookup failed");
    },
  };
  try {
    assert.deepEqual(resolveModelCeiling({ env: {} }), NO_MODEL_CEILING);
  } finally {
    process.env = savedEnv;
  }
});

test("SessionStart adds the model ceiling line after the Pota CLI line and before the main-model line", async () => {
  for (const ceilingValue of ["stronger", "balanced"]) {
    assert.equal(modelCeilingLine({ ko: false, ceiling: ceilingValue }), CEILING_LINES[ceilingValue].en);
    assert.equal(modelCeilingLine({ ko: true, ceiling: ceilingValue }), CEILING_LINES[ceilingValue].ko);
  }
  assert.equal(modelCeilingLine({ ko: false, ceiling: null }), null);
  for (const value of ["__proto__", "constructor", "toString", "hasOwnProperty", "fast", "strongest"]) {
    for (const ko of [false, true]) assert.equal(modelCeilingLine({ ko, ceiling: value }), null, value);
  }
  for (const [locale, ko] of [["en-US", false], ["ko-KR", true]]) {
    await withTempRoot(async (root) => {
      const plain = await hook(root, "session-start", { session_id: "s1" }, { locale, modelCeiling: ceiling("opus") });
      const lines = contextLines(plain);
      assert.equal(lines.at(-1), CEILING_LINES.stronger[ko ? "ko" : "en"]);
      assert.match(lines.at(-2), /^Pota CLI: node /);
      assert.equal(plain.hookOutput.systemMessage, undefined, "a valid ceiling alone never notifies the user");

      const low = await hook(root, "session-start", { session_id: "s1", model: HAIKU }, { locale, modelCeiling: ceiling("stronger") });
      const [cli, line, main] = contextLines(low).slice(-3);
      assert.match(cli, /^Pota CLI: node /);
      assert.equal(line, CEILING_LINES.stronger[ko ? "ko" : "en"]);
      assert.equal(main, mainModelLine({ ko, model: HAIKU, tier: "fast", host: "claude-code" }));
    });
  }
});

test("no ceiling keeps SessionStart and UserPromptSubmit output byte-identical and writes nothing", async () => {
  await withTempRoot(async (root, stateHome) => {
    for (const locale of ["en-US", "ko-KR"]) {
      for (const event of ["session-start", "user-prompt-submit"]) {
        for (const payload of [{ session_id: "s1" }, { session_id: "s1", model: "opus" }]) {
          const baseline = await hook(root, event, payload, { locale });
          for (const [label, modelCeiling] of [
            ["NO_MODEL_CEILING", NO_MODEL_CEILING],
            ["empty env", resolveModelCeiling({ env: {} })],
            ["strongest", ceiling("strongest")],
            ["fable", ceiling("fable")],
          ]) {
            const result = await hook(root, event, payload, { locale, modelCeiling });
            const name = `${locale} ${event} ${JSON.stringify(payload)} ${label}`;
            assert.equal(JSON.stringify(result.hookOutput), JSON.stringify(baseline.hookOutput), name);
            assert.equal(result.message, baseline.message, name);
          }
        }
      }
    }
    await assert.rejects(lstat(stateHome), { code: "ENOENT" });
  });
});

test("UserPromptSubmit never carries the ceiling line or the invalid notice", async () => {
  await withTempRoot(async (root) => {
    for (const locale of ["en-US", "ko-KR"]) {
      const baseline = await hook(root, "user-prompt-submit", { session_id: "s1" }, { locale });
      for (const value of ["stronger", "balanced", "turbo", "fast"]) {
        const result = await hook(root, "user-prompt-submit", { session_id: "s1" }, { locale, modelCeiling: ceiling(value) });
        assert.equal(JSON.stringify(result.hookOutput), JSON.stringify(baseline.hookOutput), `${locale} ${value}`);
        assert.equal(result.message, baseline.message, `${locale} ${value}`);
      }
    }
  });
});

test("an invalid ceiling adds only a user notice on SessionStart", async () => {
  for (const [locale, ko] of [["en-US", false], ["ko-KR", true]]) {
    await withTempRoot(async (root) => {
      const baseline = await hook(root, "session-start", { session_id: "s1" }, { locale });
      const invalid = await hook(root, "session-start", { session_id: "s1" }, { locale, modelCeiling: ceiling("turbo") });
      assert.equal(
        invalid.hookOutput.hookSpecificOutput.additionalContext,
        baseline.hookOutput.hookSpecificOutput.additionalContext,
      );
      const notice = modelCeilingInvalidNotice({ ko, source: "env", value: "turbo" });
      assert.equal(invalid.hookOutput.systemMessage, notice);

      const low = await hook(root, "session-start", { session_id: "s2", model: HAIKU }, { locale, modelCeiling: ceiling("fast") });
      assert.equal(
        low.hookOutput.systemMessage,
        `${modelCeilingInvalidNotice({ ko, source: "env", value: "fast" })}\n${mainModelNotice({ ko, model: HAIKU, host: "claude-code" })}`,
        "the invalid notice comes first",
      );
      assert.equal(contextLines(low).at(-1), mainModelLine({ ko, model: HAIKU, tier: "fast", host: "claude-code" }));
      assert.doesNotMatch(low.hookOutput.hookSpecificOutput.additionalContext, /Pota model ceiling:/);
    });
  }
  assert.equal(
    modelCeilingInvalidNotice({ ko: false, source: "config", value: "turbo" }),
    "Pota: model ceiling \"turbo\" (config.json \"modelCeiling\") is not valid; use balanced or stronger (or a model name such as sonnet or opus). No ceiling is applied.",
  );
  assert.equal(
    modelCeilingInvalidNotice({ ko: true, source: "env", value: "turbo" }),
    "Pota: 모델 상한 값 \"turbo\"(POTA_MODEL_CEILING)이 올바르지 않습니다. balanced 또는 stronger(또는 sonnet·opus 같은 모델 이름)를 쓰세요. 상한은 적용되지 않습니다.",
  );
});

test("model ceiling lines stay within 380 and 240 characters and stay on one line", () => {
  for (const ko of [false, true]) {
    for (const ceilingValue of ["stronger", "balanced"]) {
      const line = modelCeilingLine({ ko, ceiling: ceilingValue });
      assert.ok(line.length <= 380, `${ko ? "ko" : "en"} ${ceilingValue} line is ${line.length} characters; budget is 380`);
      assert.doesNotMatch(line, /\n/);
      assert.match(line, /^Pota model ceiling: /);
      for (const host of Object.keys(MODEL_TIER_BY_HOST)) assert.ok(line.includes(MODEL_TIER_BY_HOST[host][ceilingValue]), host);
    }
    for (const source of ["env", "config"]) {
      for (const value of ["x".repeat(200), "\"\\".repeat(100), `a\n${"b".repeat(198)}`]) {
        const notice = modelCeilingInvalidNotice({ ko, source, value });
        assert.ok(notice.length <= 240, `${ko ? "ko" : "en"} ${source} notice is ${notice.length} characters; budget is 240`);
        assert.doesNotMatch(notice, /\n/);
      }
    }
  }
});

test("invalid ceiling notices and CLI warnings stay within 240 characters for unpaired surrogates, quotes, and backslashes", async () => {
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const values = [
    "\ud800".repeat(100), "\udc00".repeat(100), `a${"\udfff\ud800".repeat(50)}`, "\"".repeat(100), "\\".repeat(100),
    "\"\\".repeat(100), ["\ud800".repeat(100)], { modelCeiling: "\"\\".repeat(100) },
  ];
  await withTempRoot(async (root, stateHome) => {
    for (const raw of values) {
      const settings = [];
      if (typeof raw === "string") settings.push(resolveModelCeiling({ env: { POTA_MODEL_CEILING: raw }, home: stateHome }));
      await writeConfig(stateHome, { modelCeiling: raw });
      settings.push(resolveModelCeiling({ env: {}, home: stateHome }));
      for (const setting of settings) {
        const label = `${setting.invalid?.source} ${JSON.stringify(raw).slice(0, 30)}`;
        assert.ok(setting.invalid, label);
        const warning = invalidModelCeilingWarning(setting.invalid);
        assert.ok(warning.length <= 240, `${label} warning is ${warning.length} characters; budget is 240`);
        assert.doesNotMatch(warning, loneSurrogate, label);
        for (const [locale, ko] of [["en-US", false], ["ko-KR", true]]) {
          const notice = modelCeilingInvalidNotice({ ko, ...setting.invalid });
          assert.ok(notice.length <= 240, `${locale} ${label} notice is ${notice.length} characters; budget is 240`);
          assert.doesNotMatch(notice, loneSurrogate, label);
          const result = await hook(root, "session-start", { session_id: "s1" }, { locale, modelCeiling: setting });
          assert.equal(result.hookOutput.systemMessage, notice, label);
        }
      }
    }
    for (const ko of [false, true]) {
      const notice = modelCeilingInvalidNotice({ ko, source: "config", value: "\ud800".repeat(200) });
      assert.ok(notice.length <= 240, `a raw value is ${notice.length} characters`);
      assert.ok(notice.includes("�"), "an unpaired surrogate becomes U+FFFD");
    }
  });
});

test("ceiling balanced gates only a fast main session and names the balanced model", async () => {
  await withTempRoot(async (root) => {
    await hook(root, "session-start", { session_id: "s1", model: "sonnet" });
    assert.equal(JSON.parse(await readFile(mainModelRecordPath(root, "s1"), "utf8")).model, "sonnet", "recorded without a ceiling");

    const balanced = await hook(root, "session-start", { session_id: "s1", model: "sonnet" }, { modelCeiling: ceiling("balanced") });
    assert.equal(contextLines(balanced).at(-1), CEILING_LINES.balanced.en);
    assert.doesNotMatch(balanced.hookOutput.hookSpecificOutput.additionalContext, /Pota main model:/);
    assert.equal(balanced.hookOutput.systemMessage, undefined);
    await assert.rejects(lstat(mainModelRecordPath(root, "s1")), { code: "ENOENT" }, "the earlier record is cleared");

    const fast = await hook(root, "session-start", { session_id: "s1", model: "haiku" }, { modelCeiling: ceiling("sonnet") });
    const line = contextLines(fast).at(-1);
    assert.match(line, /^Pota main model: haiku \(fast tier, below balanced\)/);
    assert.ok(line.includes("sonnet"));
    assert.equal(line, mainModelLine({ ko: false, model: "haiku", tier: "fast", host: "claude-code", threshold: "balanced" }));
    assert.equal(fast.hookOutput.systemMessage, mainModelNotice({ ko: false, model: "haiku", host: "claude-code", threshold: "balanced" }));
    assert.match(fast.hookOutput.systemMessage, /below the balanced tier\. On Heavy Path, planning, triage, and review go to subagents on sonnet or higher/);
    assert.equal(JSON.parse(await readFile(mainModelRecordPath(root, "s1"), "utf8")).model, "haiku");
  });
  assert.equal(
    mainModelLine({ ko: true, model: "haiku", tier: "fast", host: "claude-code", threshold: "balanced" }),
    "Pota main model: haiku (fast tier, balanced 미만). Heavy Path에서만 계획·트리아지와 최종 리뷰를 sonnet 이상 subagent에 위임하고 goal assign --model로 기록하세요. 기록이 없으면 triage-plan 완료와 goal finish가 거부됩니다(우회: --allow-main-model <reason>). Quick·Light Path는 이 모델로 진행합니다. 상세: delegation.md \"Main Model Gate\".",
  );
  for (const ko of [false, true]) {
    for (const host of Object.keys(MODEL_TIER_BY_HOST)) {
      const model = `claude-haiku-${"9".repeat(187)}`;
      assert.ok(mainModelLine({ ko, model, tier: "fast", host, threshold: "balanced" }).length <= 340);
      assert.ok(mainModelNotice({ ko, model, host, threshold: "balanced" }).length <= 240);
    }
  }
});

test("the design gate accepts the ceiling tier's model or higher and still rejects lower models", async () => {
  const cases = [
    ["stronger", "claude-code", "opus", true],
    ["stronger", "claude-code", "fable", true],
    ["stronger", "claude-code", "sonnet", /recorded model sonnet, expected opus \| fable for host claude-code \(model ceiling stronger\)/],
    ["stronger", null, "gpt-6-sol", true],
    ["stronger", null, "pro", true],
    ["stronger", null, "sonnet", /recorded model sonnet, expected opus \| fable \| gpt-6-sol \| gpt-6-astra \| pro \(model ceiling stronger\)/],
    ["balanced", "claude-code", "sonnet", true],
    ["balanced", "claude-code", "haiku", /recorded model haiku, expected sonnet \| opus \| fable for host claude-code \(model ceiling balanced\)/],
    ["stronger", "antigravity", "pro", true],
    ["stronger", "antigravity", "gemini-4-neon-high", true],
    ["stronger", "antigravity", "claude-opus-5-5-high", true],
    ["stronger", "antigravity", "gemini-4-argon-high", true],
    ["stronger", "antigravity", "flash", /recorded model flash, expected pro for host antigravity \(model ceiling stronger\)/],
    ["stronger", "antigravity", "gemini-3.8-flash-medium", /recorded model gemini-3\.8-flash-medium, expected pro for host antigravity \(model ceiling stronger\)/],
    ["balanced", "antigravity", "flash", true],
    ["balanced", "antigravity", "gemini-3.8-flash-medium", true],
    ["balanced", "antigravity", "claude-sonnet-5-5-medium", true],
    ["balanced", "antigravity", "flash_lite", /recorded model flash_lite, expected flash \| pro for host antigravity \(model ceiling balanced\)/],
    ["balanced", "antigravity", "gemini-3.5-flash-lite", /recorded model gemini-3\.5-flash-lite, expected flash \| pro for host antigravity \(model ceiling balanced\)/],
    ["balanced", "codex", "gpt-6.1-terra", true],
  ];
  for (const [modelCeiling, modelHost, model, expected] of cases) {
    await withTempRoot(async (root) => {
      await startDesignGoal(root);
      await assignTask({ root, taskId: "design", kind: "design", model, ...(modelHost ? { modelHost } : {}) });
      await recordTaskEvidence(root, "design");
      const label = `${modelCeiling} ${modelHost} ${model}`;
      const completing = setTaskStatus({ root, taskId: "design", status: "completed", modelCeiling });
      if (expected === true) assert.equal(task(await completing, "design").status, "completed", label);
      else await assert.rejects(completing, expected, label);
    });
  }
  for (const modelCeiling of [undefined, null, "turbo", "fast", "strongest"]) {
    await withTempRoot(async (root) => {
      await startDesignGoal(root);
      await assignTask({ root, taskId: "design", kind: "design", model: "opus", modelHost: "claude-code" });
      await recordTaskEvidence(root, "design");
      await assert.rejects(
        setTaskStatus({ root, taskId: "design", status: "completed", ...(modelCeiling === undefined ? {} : { modelCeiling }) }),
        /recorded model opus, expected fable for host claude-code; dispatch it/,
        String(modelCeiling),
      );
    });
  }
});

test("the main-model gate uses the capped stronger tier", async () => {
  // A balanced session recorded without a ceiling passes every completion path under ceiling balanced.
  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [triageTask(), { id: "build", title: "Build" }] });
    await recordSession(root, "s1", "sonnet");
    await recordTriageEvidence(root);
    await assert.rejects(setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1" }), /at the stronger tier: /);
    const planned = await setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1", modelCeiling: "balanced" });
    assert.equal(task(planned, "triage-plan").status, "completed");
    await recordTaskEvidence(root, "build");
    await assert.rejects(finishGoal({ root, argv: passArgv, sessionId: "s1" }), /no review dispatched at the stronger tier/);
    const finished = await finishGoal({ root, argv: passArgv, sessionId: "s1", modelCeiling: "balanced" });
    assert.equal(finished.goal.status, "completed");
  });
  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [{ id: "build", title: "Build" }] });
    await recordSession(root, "s1", "sonnet");
    await recordTaskEvidence(root, "build");
    await setTaskStatus({ root, taskId: "build", status: "completed", sessionId: "s1", modelCeiling: "balanced" });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "final review", exitCode: 0 });
    await assert.rejects(transitionGoal({ root, status: "completed", sessionId: "s1" }), /no review dispatched at the stronger tier/);
    const completed = await transitionGoal({ root, status: "completed", sessionId: "s1", modelCeiling: "balanced" });
    assert.equal(completed.goal.status, "completed");
  });

  // A fast session under ceiling balanced needs a balanced-or-higher dispatch.
  await withTempRoot(async (root) => {
    await startPlanningGoal(root, { tasks: [triageTask(), { id: "review", title: "Review" }] });
    await recordSession(root, "s1", HAIKU);
    await recordTriageEvidence(root);
    const complete = () => setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1", modelCeiling: "balanced" });
    await assert.rejects(complete(), /at the balanced tier \(model ceiling balanced\).*to sonnet and record/);
    await assignTask({ root, taskId: "triage-plan", agentId: "planner", model: "haiku", modelHost: "claude-code" });
    await assert.rejects(complete(), /at the balanced tier \(model ceiling balanced\)/, "a fast dispatch stays below the floor");
    await assignTask({ root, taskId: "triage-plan", agentId: "planner", model: "sonnet", modelHost: "claude-code" });
    assert.equal(task(await complete(), "triage-plan").status, "completed");

    await recordTaskEvidence(root, "review");
    await assert.rejects(
      finishGoal({ root, argv: passArgv, sessionId: "s1", modelCeiling: "balanced" }),
      /no review dispatched at the balanced tier \(model ceiling balanced\).*to sonnet and record/,
    );
    await assignTask({ root, taskId: "review", kind: "review", agentId: "reviewer", effort: "high", designWaiver: "review only", model: "sonnet", modelHost: "claude-code" });
    const finished = await finishGoal({ root, argv: passArgv, sessionId: "s1", modelCeiling: "balanced" });
    assert.equal(finished.goal.status, "completed");
  });

  // Ceiling stronger keeps the floor and names opus.
  for (const model of ["opus", "fable"]) {
    await withTempRoot(async (root) => {
      await startPlanningGoal(root, { tasks: [triageTask(), { id: "build", title: "Build" }] });
      await recordSession(root, "s1", HAIKU);
      await recordTriageEvidence(root);
      const complete = () => setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1", modelCeiling: "stronger" });
      await assert.rejects(complete(), /at the stronger tier \(model ceiling stronger\).*to opus and record/);
      await assignTask({ root, taskId: "triage-plan", agentId: "planner", model: "sonnet", modelHost: "claude-code" });
      await assert.rejects(complete(), /at the stronger tier \(model ceiling stronger\)/);
      await assignTask({ root, taskId: "triage-plan", agentId: "planner", model, modelHost: "claude-code" });
      assert.equal(task(await complete(), "triage-plan").status, "completed", model);
    });
  }
});

test("gate errors point to the model ceiling unless it is already balanced", async () => {
  const hint = (options) => new RegExp(
    `\\. If this account cannot use that model, have the user set a model ceiling \\(POTA_MODEL_CEILING=${options.replace("|", "\\|")}, `
    + "or \"modelCeiling\" in ~/\\.pota/config\\.json\\); never set it yourself\\. See delegation\\.md \"Model Ceiling\"$",
  );
  const designError = async (modelCeiling, model) => withTempRoot(async (root) => {
    await startDesignGoal(root);
    await assignTask({ root, taskId: "design", kind: "design", model, modelHost: "claude-code" });
    await recordTaskEvidence(root, "design");
    return setTaskStatus({ root, taskId: "design", status: "completed", modelCeiling }).then(() => null, (error) => error.message);
  });
  assert.match(await designError(null, "opus"), hint("stronger|balanced"));
  assert.match(await designError("stronger", "sonnet"), hint("balanced"));
  const balancedDesign = await designError("balanced", "haiku");
  assert.match(balancedDesign, /expected sonnet \| opus \| fable for host claude-code \(model ceiling balanced\)/);
  assert.doesNotMatch(balancedDesign, /Model Ceiling|POTA_MODEL_CEILING/);

  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    await recordTaskEvidence(root, "design");
    const error = await setTaskStatus({ root, taskId: "design", status: "completed" }).then(() => null, (failure) => failure.message);
    assert.match(error, /has no recorded design model/);
    assert.doesNotMatch(error, /Model Ceiling|POTA_MODEL_CEILING/);
  });

  for (const [modelCeiling, hinted] of [[null, true], ["stronger", true], ["balanced", false]]) {
    await withTempRoot(async (root) => {
      await startPlanningGoal(root, { tasks: [triageTask()] });
      await recordSession(root, "s1", HAIKU);
      await recordTriageEvidence(root);
      const planning = await setTaskStatus({ root, taskId: "triage-plan", status: "completed", sessionId: "s1", modelCeiling })
        .then(() => null, (error) => error.message);
      const review = await finishGoal({ root, argv: passArgv, sessionId: "s1", modelCeiling })
        .then(() => null, (error) => error.message);
      for (const message of [planning, review]) {
        assert.equal(typeof message, "string", String(modelCeiling));
        if (hinted) assert.match(message, hint("balanced"), String(modelCeiling));
        else assert.doesNotMatch(message, /Model Ceiling|POTA_MODEL_CEILING/, String(modelCeiling));
      }
    });
  }
});

test("design gate errors under a ceiling name the ceiling tier's model as the dispatch target", async () => {
  const designError = (modelCeiling, assignment) => withTempRoot(async (root) => {
    await startDesignGoal(root);
    if (assignment) await assignTask({ root, taskId: "design", kind: "design", ...assignment });
    await recordTaskEvidence(root, "design");
    return setTaskStatus({ root, taskId: "design", status: "completed", modelCeiling }).then(() => null, (error) => error.message);
  });
  const cases = [
    ["stronger", { model: "sonnet", modelHost: "claude-code" }, "; dispatch it to opus and record goal assign design"],
    ["balanced", { model: "haiku", modelHost: "claude-code" }, "; dispatch it to sonnet and record goal assign design"],
    ["balanced", { model: "gpt-6-luna", modelHost: "codex" }, "; dispatch it to gpt-6.1-terra and record goal assign design"],
    ["stronger", { model: "sonnet" }, "; dispatch it to opus | gpt-6-sol | pro and record goal assign design"],
    ["stronger", null, "; dispatch it to opus | gpt-6-sol | pro and record goal assign design"],
    ["balanced", { model: "inherited", modelHost: "codex" }, "; dispatch it to gpt-6.1-terra and record goal assign design"],
  ];
  for (const [modelCeiling, assignment, target] of cases) {
    const message = await designError(modelCeiling, assignment);
    assert.ok(message.includes(target), `${modelCeiling} ${JSON.stringify(assignment)}: ${message}`);
    assert.doesNotMatch(message, /strongest tier/, `${modelCeiling} ${JSON.stringify(assignment)}`);
  }
  // Without a ceiling both messages keep the strongest-tier wording.
  for (const assignment of [{ model: "opus", modelHost: "claude-code" }, null]) {
    assert.ok((await designError(null, assignment)).includes("; dispatch it to the strongest tier and record goal assign design"));
  }
});

test("goal finish applies the ceiling to the design gate of the active task", async () => {
  const prepare = async (root) => {
    await startGoal({
      root,
      goal: "Finish a design under a ceiling",
      planId: "docs/plan/ceiling-design.md",
      evidencePolicy: "declared",
      tasks: [{ id: "design", title: "Heavy design", route: "heavy", kind: "design" }],
    });
    await assignTask({ root, taskId: "design", kind: "design", model: "opus", modelHost: "claude-code" });
    await recordTaskEvidence(root, "design");
  };
  await withTempRoot(async (root) => {
    await prepare(root);
    await assert.rejects(finishGoal({ root, argv: passArgv }), /recorded model opus, expected fable for host claude-code;/);
    const finished = await finishGoal({ root, argv: passArgv, modelCeiling: "balanced" });
    assert.equal(finished.goal.status, "completed", "ceiling balanced accepts opus");
    assert.equal(task(finished, "design").status, "completed");
  });
  await withTempRoot(async (root) => {
    await prepare(root);
    const io = (env) => ({ stdout: () => {}, stderr: () => {}, env });
    await assert.rejects(handleGoalCli(["goal", "finish", "--root", root, "--", ...passArgv], io({})), /expected fable for host claude-code;/);
    await handleGoalCli(["goal", "finish", "--root", root, "--", ...passArgv], io({ POTA_MODEL_CEILING: "stronger" }));
    assert.equal(await readGoalState({ root }), null, "the goal finished through the CLI");
  });
});

test("UserPromptSubmit with a model applies the ceiling floor to the record and the notice", async () => {
  await withTempRoot(async (root, stateHome) => {
    const run = (sessionId, model) => {
      const env = { ...process.env, POTA_HOME: stateHome, LANG: "en_US.UTF-8", LC_ALL: "", LC_MESSAGES: "" };
      delete env.POTA_MAIN_MODEL_GATE;
      delete env.POTA_MODEL_CEILING;
      const result = spawnSync(process.execPath, [STATE_SCRIPT, "user-prompt-submit"], {
        input: JSON.stringify({ cwd: root, session_id: sessionId, model }),
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const recorded = async (sessionId) => lstat(mainModelRecordPath(root, sessionId)).then(() => true, () => false);

    // Without a ceiling a balanced model is below the stronger floor.
    assert.equal(run("baseline", "gpt-6.1-terra").systemMessage, mainModelNotice({ ko: false, model: "gpt-6.1-terra", host: "codex" }));
    assert.equal(await recorded("baseline"), true);

    await writeConfig(stateHome, { modelCeiling: "balanced" });
    for (const [host, balanced, fast] of [["codex", "gpt-6.1-terra", "gpt-6-luna"], ["claude-code", "sonnet", "haiku"]]) {
      const atFloor = run(`${host}-balanced`, balanced);
      assert.equal(atFloor.systemMessage, undefined, `${balanced} is at the balanced floor`);
      assert.doesNotMatch(atFloor.hookSpecificOutput?.additionalContext ?? "", /Pota (main model|model ceiling):/);
      assert.equal(await recorded(`${host}-balanced`), false, `${balanced} is not recorded`);

      const below = run(`${host}-fast`, fast);
      assert.equal(below.systemMessage, mainModelNotice({ ko: false, model: fast, host, threshold: "balanced" }), fast);
      assert.match(below.systemMessage, /below the balanced tier/);
      assert.doesNotMatch(below.hookSpecificOutput?.additionalContext ?? "", /Pota (main model|model ceiling):/);
      assert.equal(JSON.parse(await readFile(mainModelRecordPath(root, `${host}-fast`), "utf8")).model, fast);
    }
  });
});

test("both delegation.md files carry a byte-identical Model Ceiling section", async () => {
  const section = async (path) => {
    const text = await readFile(path, "utf8");
    const start = text.indexOf("\n## Model Ceiling\n");
    assert.notEqual(start, -1, path);
    const end = text.indexOf("\n## ", start + 1);
    return text.slice(start, end === -1 ? undefined : end);
  };
  const plan = await section("skills/pota-plan/delegation.md");
  assert.equal(await section("skills/pota-work/delegation.md"), plan);
  assert.ok(plan.length > 200, "the section has content");
});

test("goal CLI reads the ceiling from POTA_MODEL_CEILING and config.json on task, finish, and complete", async () => {
  const io = (env, err = []) => ({ stdout: () => {}, stderr: (line) => err.push(line), env });
  const completeDesign = (root, env, err) => handleGoalCli(["goal", "task", "design", "--status", "completed", "--root", root], io(env, err));
  const prepareDesign = async (root) => {
    await startDesignGoal(root);
    await assignTask({ root, taskId: "design", kind: "design", model: "opus", modelHost: "claude-code" });
    await recordTaskEvidence(root, "design");
  };
  await withTempRoot(async (root) => {
    await prepareDesign(root);
    await assert.rejects(completeDesign(root, {}), /expected fable for host claude-code;/, "no setting keeps the strict gate");
    const err = [];
    await completeDesign(root, { POTA_MODEL_CEILING: "stronger" }, err);
    assert.deepEqual(err, []);
    assert.equal(task(await readGoalState({ root }), "design").status, "completed");
  });
  await withTempRoot(async (root, stateHome) => {
    await prepareDesign(root);
    await writeConfig(stateHome, { modelCeiling: "opus" });
    await completeDesign(root, {});
    assert.equal(task(await readGoalState({ root }), "design").status, "completed");
  });

  const prepareReview = async (root) => {
    await startPlanningGoal(root, { tasks: [{ id: "build", title: "Build" }] });
    await recordSession(root, "s1", HAIKU);
    await assignTask({ root, taskId: "build", kind: "review", agentId: "reviewer", effort: "high", designWaiver: "review only", model: "sonnet", modelHost: "claude-code" });
    await recordTaskEvidence(root, "build");
  };
  await withTempRoot(async (root) => {
    await prepareReview(root);
    const finish = (env) => handleGoalCli(["goal", "finish", "--root", root, "--", ...passArgv], io(env));
    await assert.rejects(finish({ CLAUDE_CODE_SESSION_ID: "s1" }), /no review dispatched at the stronger tier/);
    await finish({ CLAUDE_CODE_SESSION_ID: "s1", POTA_MODEL_CEILING: "balanced" });
    assert.equal(await readGoalState({ root }), null, "the goal finished");
  });
  await withTempRoot(async (root, stateHome) => {
    await prepareReview(root);
    await setTaskStatus({ root, taskId: "build", status: "completed", sessionId: "s1" });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "final review", exitCode: 0 });
    const complete = () => handleGoalCli(["goal", "complete", "--root", root], io({ CLAUDE_CODE_SESSION_ID: "s1" }));
    await assert.rejects(complete(), /no review dispatched at the stronger tier/);
    await writeConfig(stateHome, { modelCeiling: "sonnet" });
    await complete();
    assert.equal(await readGoalState({ root }), null, "the goal completed");
  });
});

test("an invalid ceiling warns once on stderr and applies no ceiling", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    const env = { POTA_MODEL_CEILING: "turbo" };
    const quiet = [];
    const io = (err) => ({ stdout: () => {}, stderr: (line) => err.push(line), env });
    await handleGoalCli(["goal", "status", "--root", root], io(quiet));
    await handleGoalCli(["goal", "assign", "design", "--root", root, "--kind", "design", "--model", "opus", "--host", "claude-code"], io(quiet));
    await handleGoalCli(["goal", "task", "status", "--root", root], io(quiet));
    assert.deepEqual(quiet, [], "status, assign, and task status never read the setting");
    await recordTaskEvidence(root, "design");
    const err = [];
    await assert.rejects(
      handleGoalCli(["goal", "task", "design", "--status", "completed", "--root", root], io(err)),
      /expected fable for host claude-code;/,
    );
    assert.equal(err.length, 1);
    assert.match(err[0], /^Pota warning: ignoring invalid model ceiling "turbo" from POTA_MODEL_CEILING/);
    assert.equal(err[0], invalidModelCeilingWarning({ source: "env", value: "turbo" }));
    await handleGoalCli(["goal", "pause", "--root", root], io(quiet));
    assert.deepEqual(quiet, [], "pause never reads the setting");
  });
  assert.equal(
    invalidModelCeilingWarning({ source: "config", value: "5" }),
    "Pota warning: ignoring invalid model ceiling \"5\" from config.json \"modelCeiling\"; use balanced or stronger. No ceiling is applied.",
  );
});

test("the hook entry point resolves the ceiling from the environment and config.json", async () => {
  await withTempRoot(async (root, stateHome) => {
    const run = (event, extraEnv, payload = {}) => {
      const env = { ...process.env, POTA_HOME: stateHome, LANG: "en_US.UTF-8", LC_ALL: "", LC_MESSAGES: "", ...extraEnv };
      delete env.POTA_MAIN_MODEL_GATE;
      if (!("POTA_MODEL_CEILING" in extraEnv)) delete env.POTA_MODEL_CEILING;
      const result = spawnSync(process.execPath, [STATE_SCRIPT, event], {
        input: JSON.stringify({ cwd: root, session_id: "s1", ...payload }),
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? "";
    };
    assert.ok(run("session-start", { POTA_MODEL_CEILING: "opus" }).split("\n").includes(CEILING_LINES.stronger.en));
    assert.doesNotMatch(run("session-start", {}), /Pota model ceiling:/);
    assert.doesNotMatch(run("user-prompt-submit", { POTA_MODEL_CEILING: "opus" }, { model: "gpt-6-sol" }), /Pota model ceiling:/);
    await writeConfig(stateHome, { modelCeiling: "balanced" });
    assert.ok(run("session-start", {}).split("\n").includes(CEILING_LINES.balanced.en));
    assert.doesNotMatch(run("user-prompt-submit", {}), /Pota model ceiling:/);
    assert.doesNotMatch(run("user-prompt-submit", {}, { model: "gpt-6-sol" }), /Pota model ceiling:/);
  });
});

test("the effective-model mismatch warning adds the ceiling hint only for a lower tier", async () => {
  await withTempRoot(async (root) => {
    await startDesignGoal(root);
    const err = [];
    const io = { stdout: () => {}, stderr: (line) => err.push(line), env: {} };
    const assign = (model, effective) => handleGoalCli(
      ["goal", "assign", "design", "--root", root, "--kind", "design", "--model", model, "--host", "claude-code", "--effective-model", effective],
      io,
    );
    await assign("fable", "claude-opus-5-5");
    assert.deepEqual(err, [
      "Pota warning: Task design effective model claude-opus-5-5 does not match the passed model fable; check the dispatch result. The host may have substituted a lower model; if this account cannot use fable, have the user set a model ceiling (see delegation.md \"Model Ceiling\").",
    ]);
    err.length = 0;
    await assign("opus", "claude-fable-5-2");
    assert.deepEqual(err, ["Pota warning: Task design effective model claude-fable-5-2 does not match the passed model opus; check the dispatch result."]);
    err.length = 0;
    await assign("fable", "mystery-model-1");
    assert.deepEqual(err, ["Pota warning: Task design effective model mystery-model-1 does not match the passed model fable; check the dispatch result."]);
    err.length = 0;
    await assign("opus", "claude-sonnet-5-1");
    assert.deepEqual(err, [
      "Pota warning: Task design effective model claude-sonnet-5-1 does not match the passed model opus; check the dispatch result. The host may have substituted a lower model; if this account cannot use opus, have the user set a model ceiling (see delegation.md \"Model Ceiling\").",
    ]);
    err.length = 0;
    // A balanced or fast passed model is never the reason to set a ceiling.
    await assign("sonnet", HAIKU);
    assert.deepEqual(err, [
      `Pota warning: Task design effective model ${HAIKU} does not match the passed model sonnet; check the dispatch result. The host may have substituted a lower model.`,
    ]);
  });
});

function ceiling(value) {
  return resolveModelCeiling({ env: { POTA_MODEL_CEILING: value } });
}

// env is explicit so the host's POTA_MAIN_MODEL_GATE never leaks in; modelCeiling is passed only when given.
async function hook(root, event, payload, { locale = "en-US", env = {}, modelCeiling } = {}) {
  return runStateResult(event, {
    root,
    locale,
    payload: { cwd: root, ...payload },
    mainModel: { env },
    ...(modelCeiling === undefined ? {} : { modelCeiling }),
  });
}

function contextLines(result) {
  return result.hookOutput.hookSpecificOutput.additionalContext.split("\n");
}

async function recordSession(root, sessionId, model) {
  await hook(root, "session-start", { session_id: sessionId, model });
  assert.equal(JSON.parse(await readFile(mainModelRecordPath(root, sessionId), "utf8")).model, model);
}

async function writeConfig(home, value) {
  await mkdir(home, { recursive: true });
  const path = join(home, "config.json");
  await rm(path, { recursive: true, force: true });
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value));
}

function triageTask() {
  return { id: "triage-plan", title: "Run planned triage and finalize the plan", requiredEvidence: ["planArtifact", "triageDecision"] };
}

// The main-model gate applies only to goals with a Heavy Path task; the first non-triage task (else the first) is heavy.
async function startPlanningGoal(root, { tasks }) {
  const found = tasks.findIndex((item) => item.id !== "triage-plan");
  const target = found === -1 ? 0 : found;
  tasks = tasks.map((item, index) => (index === target ? { ...item, route: "heavy" } : item));
  return startGoal({ root, goal: "Cap the model tier", planId: "docs/plan/ceiling.md", evidencePolicy: "declared", tasks });
}

async function startDesignGoal(root) {
  return startGoal({
    root,
    goal: "Route Heavy design under a ceiling",
    planId: "docs/plan/ceiling-design.md",
    evidencePolicy: "declared",
    tasks: [
      { id: "design", title: "Heavy design", route: "heavy", kind: "design" },
      { id: "light", title: "Light task" },
    ],
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

async function withTempHome(work) {
  const base = await mkdtemp(join(tmpdir(), "pota-model-ceiling-home-"));
  try {
    await work(join(base, "home"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

// Library calls pass sessionId and modelCeiling explicitly and CLI calls inject env, so the host's
// CLAUDE_CODE_SESSION_ID and POTA_MODEL_CEILING never leak in; config.json lives under the temporary POTA_HOME.
async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-model-ceiling-"));
  const stateHome = `${root}-home`;
  const previousPotaHome = process.env.POTA_HOME;
  process.env.POTA_HOME = stateHome;
  try {
    return await work(root, stateHome);
  } finally {
    if (previousPotaHome === undefined) delete process.env.POTA_HOME;
    else process.env.POTA_HOME = previousPotaHome;
    await rm(root, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
}
