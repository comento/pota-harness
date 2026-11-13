import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  PLAN_ID_MAX_LENGTH,
  RECOVERY_REFERENCE_MAX_LENGTH,
  TASK_ID_MAX_LENGTH,
  goalStatePath,
  readGoalState,
  recordReceipt,
  setTaskStatus,
  startGoal,
  transitionGoal,
} from "../scripts/pota-goal.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import { updateNoticeLine } from "../scripts/pota-state-context.mjs";
import { message } from "../scripts/pota.mjs";

const cliScript = resolve("scripts/pota.mjs");

test("recurring Codex instructions are a small stable recovery kernel", async () => {
  const manifest = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));
  const prompt = manifest.interface.defaultPrompt.join("\n");

  assert.equal(manifest.interface.defaultPrompt.length, 7);
  assert.ok(prompt.length <= 1600, `defaultPrompt is ${prompt.length} characters; budget is 1600`);
  assert.match(prompt, /root MEMORY\.md.*when it exists.*continue without repository memory/i);
  assert.match(prompt, /phase skill.*pota-plan.*pota-work.*pota-review/i);
  assert.match(prompt, /active plan.*current-task references/i);
  assert.match(prompt, /compaction, restart, handoff, or delegation/i);
  assert.match(prompt, /missing MEMORY\.md never blocks work/i);
  assert.match(prompt, /missing, failed, skipped, stale, or placeholder evidence never completes work/i);
  assert.match(prompt, /external-state changes.*dry-run\/check/i);
  assert.match(prompt, /side questions.*resume the current task/i);
  assert.doesNotMatch(prompt, /update_plan|create_goal|package lifecycle|--ignore-scripts|progress-reporting channel/i);
});

// A one-time SessionStart line outside the standing budgets above; long versions are bounded by the registry check
// (x.y.z, at most 32 characters) and by clipping an installed prerelease.
test("update notice lines stay within 160 characters", () => {
  const longVersion = `${"1".repeat(14)}.${"2".repeat(8)}.${"3".repeat(8)}`;
  assert.equal(longVersion.length, 32);
  for (const ko of [false, true]) {
    for (const kind of ["updated", "failed", "manual"]) {
      for (const [from, to] of [["0.6.0", "0.7.0"], [`${longVersion}-prerelease.with.a.long.tail`, longVersion]]) {
        const line = updateNoticeLine({ ko, notice: { schemaVersion: 1, kind, from, to, at: new Date().toISOString() } });
        assert.ok(line.length <= 160, `${ko ? "ko" : "en"} ${kind} notice is ${line.length} characters; budget is 160`);
        assert.doesNotMatch(line, /\n/);
        assert.match(line, ko ? /^Pota 업데이트: / : /^Pota update: /);
      }
    }
  }
  assert.equal(
    updateNoticeLine({ ko: false, notice: { kind: "updated", from: "0.6.0", to: "0.7.0" } }),
    "Pota update: auto-upgraded 0.6.0 → 0.7.0; this session runs 0.7.0. Mention it to the user once.",
  );
  assert.equal(
    updateNoticeLine({ ko: true, notice: { kind: "failed", from: "0.6.0", to: "0.7.0" } }),
    'Pota 업데이트: 0.7.0 자동 업그레이드가 실패했습니다. 사용자에게 "npx @comento/pota-harness@latest upgrade" 실행 또는 "pota auto-upgrade status" 확인을 안내하세요.',
  );
  assert.equal(
    updateNoticeLine({ ko: false, notice: { kind: "manual", from: "0.6.0", to: "0.7.0" } }),
    'Pota update: 0.7.0 is installed but the Claude Code plugin cache was not refreshed. Tell the user to run "claude plugin update pota@pota".',
  );
});

test("hook context is a compact phase capsule without dropping recovery state", async () => {
  await withTempRoot(async (root) => {
    const idle = await runStateResult("user-prompt-submit", {
      root,
      locale: "en-US",
      payload: { cwd: root, session_id: "budget-session", prompt: "Implement the fix" },
    });
    const idleContext = idle.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(idleContext.length <= 620, `idle hook is ${idleContext.length} characters; budget is 620`);
    assert.match(idleContext, /^Pota kernel: root MEMORY\.md is optional/);
    assert.match(idleContext, /non-trivial implementation.*planned-work continuation.*load pota-plan/i);
    assert.match(idleContext, /known-target Git\/GitHub operations stay plan\/goal-free/i);
    assert.match(idleContext, /code edits.*conflict resolution.*destructive recovery.*release\/deploy.*design/i);
    assert.match(idleContext, /consultation.*plan-only/i);
    assert.match(idleContext, /stop only if active state.*missing, unreadable, or inconsistent/i);

    await startGoal({
      root,
      goal: "Keep the reliable roadmap while reducing repeated context",
      planId: "docs/plan/token-budget.md",
      ownerSessionId: "budget-session",
      tasks: [
        { id: "triage", title: "Measure context and finalize the plan" },
        { id: "implement", title: "Implement the bounded change" },
        { id: "verify", title: "Verify tool evidence" },
      ],
    });
    const active = await runStateResult("user-prompt-submit", {
      root,
      locale: "en-US",
      payload: { cwd: root, session_id: "budget-session", prompt: "What is the status?" },
    });
    const activeContext = active.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(activeContext.length <= 700, `active hook is ${activeContext.length} characters; budget is 700`);
    assert.match(activeContext, /^Pota kernel: root MEMORY\.md is optional/);
    assert.match(activeContext, /load pota-work/i);
    assert.match(activeContext, /docs\/plan\/token-budget\.md/);
    assert.match(activeContext, /1\. triage \[active\]/);
    assert.match(activeContext, /2\. implement \[pending\]/);
    assert.match(activeContext, /current.*triage/i);
    assert.match(activeContext, /side question.*resume.*triage/i);
    assert.match(activeContext, /stop only if active state.*missing, unreadable, or inconsistent/i);
  });
});

test("hook capsules are deterministic for the same state and restore review phase", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Deterministic recovery",
      planId: "docs/plan/deterministic.md",
      ownerSessionId: "deterministic-session",
      evidencePolicy: "declared",
      tasks: [{ id: "only", title: "Only task" }],
    });

    const first = await runStateResult("user-prompt-submit", {
      root,
      locale: "en-US",
      payload: { cwd: root, session_id: "deterministic-session", turn_id: "turn-1", prompt: "First prompt" },
    });
    const second = await runStateResult("user-prompt-submit", {
      root,
      locale: "en-US",
      payload: { cwd: root, session_id: "deterministic-session", turn_id: "turn-2", prompt: "Different prompt" },
    });
    assert.equal(
      first.hookOutput.hookSpecificOutput.additionalContext,
      second.hookOutput.hookSpecificOutput.additionalContext,
    );

    await recordReceipt({ root, taskId: "only", kind: "moduleAcceptance", command: "node --test", exitCode: 0 });
    await recordReceipt({ root, taskId: "only", kind: "surfaceIntegration", command: "npm run check", exitCode: 0 });
    await setTaskStatus({ root, taskId: "only", status: "completed" });
    const review = await runStateResult("session-start", {
      root,
      locale: "en-US",
      payload: { cwd: root, session_id: "deterministic-session", turn_id: "turn-3" },
    });
    const reviewContext = review.hookOutput.hookSpecificOutput.additionalContext;
    assert.match(reviewContext, /^Pota kernel: root MEMORY\.md is optional/);
    assert.match(reviewContext, /load pota-review/i);
    assert.match(reviewContext, /docs\/plan\/deterministic\.md/);
    assert.match(reviewContext, /stop only if active state.*missing, unreadable, or inconsistent/i);
  });
});

test("foreign sessions receive only a generic fail-closed capsule", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root,
      goal: "Secret owner goal",
      planId: "docs/plan/secret-owner.md",
      ownerSessionId: "owner-session",
      tasks: [{ id: "secret-task", title: "Secret task title" }],
    });

    for (const event of ["session-start", "user-prompt-submit"]) {
      const foreign = await runStateResult(event, {
        root,
        locale: "en-US",
        payload: { cwd: root, session_id: "foreign-session", turn_id: "foreign-turn", prompt: "Continue" },
      });
      const context = foreign.hookOutput.hookSpecificOutput.additionalContext;
      assert.match(context, /^Pota kernel: root MEMORY\.md is optional/);
      assert.match(context, /owned by another session/i);
      assert.match(context, /inspect.*goal status/i);
      assert.match(context, /do not start, edit, delegate, or complete/i);
      assert.doesNotMatch(context, /Secret owner goal|secret-owner|secret-task|Secret task title/);
    }

    for (const event of ["stop", "subagent-stop"]) {
      const stop = await runStateResult(event, {
        root,
        locale: "en-US",
        payload: { cwd: root, session_id: "foreign-session", turn_id: "foreign-turn", agent_id: "foreign-agent" },
      });
      assert.deepEqual(stop.hookOutput, {}, `${event} must not block work owned by another session`);
    }

    await transitionGoal({ root, status: "cancelled" });
    assert.equal(await readGoalState({ root }), null);
    for (const event of ["session-start", "user-prompt-submit"]) {
      const terminal = await runStateResult(event, {
        root,
        locale: "en-US",
        payload: { cwd: root, session_id: "foreign-session", turn_id: "terminal-turn", prompt: "Start new work" },
      });
      const context = terminal.hookOutput.hookSpecificOutput.additionalContext;
      assert.match(context, /^Pota kernel: root MEMORY\.md is optional/);
      assert.match(context, /load pota-plan/i);
      assert.doesNotMatch(context, /owned by another session|Secret owner goal|secret-owner|secret-task|Secret task title/i);
    }
  });
});

test("active hook stays bounded for long goals and large roadmaps", async () => {
  await withTempRoot(async (root) => {
    const exactPlanId = "p".repeat(RECOVERY_REFERENCE_MAX_LENGTH - TASK_ID_MAX_LENGTH);
    const exactTaskId = "t".repeat(TASK_ID_MAX_LENGTH);
    await startGoal({
      root,
      goal: "G".repeat(600),
      planId: exactPlanId,
      ownerSessionId: "large-roadmap-session",
      tasks: Array.from({ length: 20 }, (_, index) => ({
        id: index === 0 ? exactTaskId : `task-${index + 1}`,
        title: `Long task ${index + 1} ${"t".repeat(200)}`,
      })),
    });

    const active = await runStateResult("user-prompt-submit", {
      root,
      locale: "en-US",
      payload: { cwd: root, session_id: "large-roadmap-session", prompt: "Continue" },
    });
    const context = active.hookOutput.hookSpecificOutput.additionalContext;
    assert.ok(context.length <= 700, `large active hook is ${context.length} characters; budget is 700`);
    assert.match(context, /20/);
    assert.match(context, /omitted/i);
    assert.ok(context.includes(exactPlanId), "active hook must preserve the exact plan reference");
    assert.ok(context.includes(`Exact task: ${exactTaskId}.`), "active hook must preserve the exact current task id");
    assert.match(context, /After side questions or steers, resume that exact task; advance to final review/i);
    assert.match(context, /next task-2, task-3/);
  });
});

test("goal state bounds exact recovery references and rejects oversized legacy state", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      startGoal({ root, goal: "Long plan", planId: "p".repeat(PLAN_ID_MAX_LENGTH + 1), tasks: [{ id: "task", title: "Task" }] }),
      /planId must be at most 128 characters/,
    );
    await assert.rejects(
      startGoal({ root, goal: "Long task", planId: "plan", tasks: [{ id: "t".repeat(TASK_ID_MAX_LENGTH + 1), title: "Task" }] }),
      /tasks\[0\]\.id must be at most 64 characters/,
    );
    await assert.rejects(
      startGoal({
        root,
        goal: "Combined limit",
        planId: "p".repeat(RECOVERY_REFERENCE_MAX_LENGTH - TASK_ID_MAX_LENGTH + 1),
        tasks: [{ id: "t".repeat(TASK_ID_MAX_LENGTH), title: "Task" }],
      }),
      /planId and taskId must total at most 160 characters/,
    );

    const baseline = await startGoal({ root, goal: "Legacy bound", planId: "plan", tasks: [{ id: "task", title: "Task" }] });
    const legacy = structuredClone(baseline);
    legacy.schemaVersion = 1;
    delete legacy.goal.evidencePolicy;
    legacy.goal.planId = "p".repeat(PLAN_ID_MAX_LENGTH + 1);
    await writeFile(goalStatePath(root), `${JSON.stringify(legacy, null, 2)}\n`);
    await assert.rejects(readGoalState({ root }), /goal\.planId must be at most 128 characters/);

    const paddedPlan = structuredClone(baseline);
    paddedPlan.goal.planId = ` ${"p".repeat(96)}${" ".repeat(900)}`;
    await writeFile(goalStatePath(root), `${JSON.stringify(paddedPlan, null, 2)}\n`);
    await assert.rejects(readGoalState({ root }), /goal\.planId must not have leading or trailing whitespace/);

    const paddedTask = structuredClone(baseline);
    paddedTask.tasks[0].id = ` ${"t".repeat(64)} `;
    await writeFile(goalStatePath(root), `${JSON.stringify(paddedTask, null, 2)}\n`);
    await assert.rejects(readGoalState({ root }), /task\.id must not have leading or trailing whitespace/);

    const paddedCombined = structuredClone(baseline);
    paddedCombined.goal.planId = `${"p".repeat(96)} `;
    paddedCombined.tasks[0].id = `${"t".repeat(64)} `;
    await writeFile(goalStatePath(root), `${JSON.stringify(paddedCombined, null, 2)}\n`);
    await assert.rejects(readGoalState({ root }), /must not have leading or trailing whitespace/);
  });
});

test("goal CLI quiet mode preserves state and suppresses successful JSON", async () => {
  await withTempRoot(async (root) => {
    const started = spawnSync(process.execPath, [
      cliScript,
      "goal", "start",
      "--quiet",
      "--root", root,
      "--goal", "Quiet state mutation",
      "--plan", "docs/plan/quiet.md",
      "--tasks", "Quiet task",
    ], { cwd: root, encoding: "utf8" });

    assert.equal(started.status, 0, started.stderr);
    assert.equal(started.stdout, "");
    assert.equal((await readGoalState({ root })).goal.title, "Quiet state mutation");

    const status = spawnSync(process.execPath, [cliScript, "goal", "status", "--root", root, "--quiet"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).goal.title, "Quiet state mutation");
  });
});

test("work guidance spends reasoning on tests and trusts bounded tool evidence", async () => {
  const work = await readFile("skills/pota-work/SKILL.md", "utf8");

  assert.match(work, /test contract first/i);
  assert.match(work, /requirements, invariants, boundaries, and failure modes/i);
  assert.match(work, /minimum implementation/i);
  assert.match(work, /tool exit code.*authoritative/i);
  assert.match(work, /expand.*only.*failing test/i);
  assert.match(work, /inspect.*package.*lifecycle/i);
  assert.match(work, /content-producing.*(?:must not|never).*--ignore-scripts/is);
  assert.match(work, /content-neutral.*--ignore-scripts/is);
  assert.match(work, /stale evidence/i);
  assert.match(work, /goal verify.*--/i);
  assert.match(work, /recorded model.*Agent `model`\/`effort`; never `fork`/is);
  assert.match(work, /requested.*effective.*reasoning effort/is);
  assert.match(work, /Light.*medium.*Heavy.*high.*xhigh/is);
  assert.match(work, /completed.*profiles?.*preserv/is);
  assert.match(work, /incomplete.*profiles?.*(?:recalculate|replace)/is);
});

test("work, review, and memory guidance protect the judge and close defects with evidence", async () => {
  const read = (path) => readFile(path, "utf8");
  const workSurfaces = ["skills/pota-work/SKILL.md", "commands/pota-work.md", ".agents/workflows/pota-work.md", "agents/worker.md"];
  for (const path of workSurfaces) {
    const content = await read(path);
    assert.match(content, /never edit, weaken, skip, or delete existing tests.*verification commands/is, `${path} judge protection`);
    assert.match(content, /same rule or pattern/i, `${path} same-rule sweep`);
  }

  // Defect investigation detail lives in the pota-work verification reference loaded on demand.
  const work = await read("skills/pota-work/SKILL.md");
  assert.match(work, /pota:\/\/skills\/pota-work\/verification\.md/);
  const verification = await read("skills/pota-work/verification.md");
  assert.match(verification, /reproduce.*before fixing/is);
  assert.match(verification, /one hypothesis at a time.*measurement/is);
  assert.match(verification, /feasibility.*experiment/is);
  assert.match(verification, /never edit, weaken, skip, or delete existing tests.*verification commands/is);

  for (const path of ["skills/pota-review/SKILL.md", "commands/pota-review.md", ".agents/workflows/pota-review.md"]) {
    const content = await read(path);
    assert.match(content, /test, fixture, and verification-command diffs/i, `${path} judge diff review`);
    assert.match(content, /same-rule sweep/i, `${path} same-rule sweep review`);
  }

  for (const path of ["skills/pota-memory/SKILL.md", "commands/pota-memory.md", ".agents/workflows/pota-memory.md"]) {
    const content = await read(path);
    assert.match(content, /machine-checkable.*(?:test|lint|script|hook)/is, `${path} executable lessons`);
  }
});

test("agents and phase guidance restore required references and fail closed", async () => {
  const surfaces = await Promise.all([
    "agents/explorer.md",
    "agents/worker.md",
    "skills/pota-plan/SKILL.md",
    "skills/pota-work/SKILL.md",
    "skills/pota-review/SKILL.md",
    "docs/model-guidance/README.md",
    "docs/model-guidance/codex.md",
  ].map(async (path) => [path, await readFile(path, "utf8")]));

  for (const [path, content] of surfaces) {
    assert.match(content, /MEMORY\.md.*(?:phase skill|pota-(?:plan|work|review)).*active plan.*(?:current-task|current task|completed\/current-task).*model guidance/is, `${path} recovery order`);
    assert.match(content, /missing, unreadable, or inconsistent/is, `${path} missing-reference guard`);
    assert.match(content, /(?:do not|fail closed)/i, `${path} fail-closed action`);
  }

  const allGuidance = surfaces.map(([, content]) => content).join("\n");
  assert.doesNotMatch(allGuidance, /requiredReferences|readReceipt|read_receipt/);
});

test("plan and work skills stay slim and load detailed procedures on demand", async () => {
  const read = (path) => readFile(path, "utf8");
  for (const path of ["skills/pota-plan/SKILL.md", "skills/pota-work/SKILL.md"]) {
    const bytes = Buffer.byteLength(await read(path), "utf8");
    assert.ok(bytes <= 9000, `${path} is ${bytes} bytes; budget is 9000`);
  }

  const references = {
    "pota-plan": ["planning-rules.md", "delegation.md", "heavy-path.md"],
    "pota-work": ["verification.md", "delegation.md", "heavy-path.md", "recovery.md"],
  };
  for (const [skill, files] of Object.entries(references)) {
    const content = await read(`skills/${skill}/SKILL.md`);
    assert.match(content, /read a reference only when the selected path or situation requires it/i, `${skill} on-demand rule`);
    assert.match(content, /Quick and Light Path never need `heavy-path\.md`/, `${skill} heavy-path gate`);
    for (const file of files) {
      assert.ok(content.includes(`pota://skills/${skill}/${file}`), `${skill} references ${file}`);
      assert.ok((await read(`skills/${skill}/${file}`)).length > 0, `${skill}/${file} exists`);
    }
  }

  // Moved procedures keep their contracts in the reference files.
  const planHeavy = await read("skills/pota-plan/heavy-path.md");
  assert.match(planHeavy, /plan -> Heavy design task -> pre-implementation review -> bounded `worker` implementation/);
  assert.match(planHeavy, /only promote Light Path to Heavy Path/);
  const planRules = await read("skills/pota-plan/planning-rules.md");
  assert.match(planRules, /## Route Record/);
  assert.match(planRules, /content-producing.*--ignore-scripts/is);
  const planDelegation = await read("skills/pota-plan/delegation.md");
  assert.match(planDelegation, /TASK: Produce <role> input/);
  assert.match(planDelegation, /final report before leaving.*close or release/is);
  assert.match(planDelegation, /Light.*medium.*Heavy.*high.*xhigh/is);
  const workDelegation = await read("skills/pota-work/delegation.md");
  assert.match(workDelegation, /TASK: Implement task <task-id>/);
  assert.match(workDelegation, /completed.*profiles?.*preserv/is);
  const workRecovery = await read("skills/pota-work/recovery.md");
  assert.match(workRecovery, /two failed passes.*blocked/is);
  assert.match(workRecovery, /goal claim/);
});

test("plan and work guidance define the Quick Path and the finish/stats CLI contract", async () => {
  const read = (path) => readFile(path, "utf8");
  for (const path of ["skills/pota-plan/SKILL.md", "commands/pota-plan.md", ".agents/workflows/pota-plan.md"]) {
    const content = await read(path);
    assert.match(content, /Quick Path/, `${path} Quick Path`);
    assert.match(content, /unambiguous/i, `${path} unambiguous requirements`);
    assert.match(content, /about 3 files or fewer inside existing layers/i, `${path} file limit`);
    assert.match(content, /no Heavy Path signal/i, `${path} no Heavy signal`);
    assert.match(content, /no external-state mutation/i, `${path} no external-state mutation`);
    assert.match(content, /one or two (?:verification )?commands/i, `${path} verification size`);
    assert.match(content, /escalate to Light Path \(.*plan \+ goal\) before further edits/i, `${path} escalation`);
    assert.match(content, /routine known-target Git\/GitHub operations?/i, `${path} Git ops stay plan-free`);
  }
  for (const path of ["skills/pota-work/SKILL.md", "commands/pota-work.md", ".agents/workflows/pota-work.md"]) {
    const content = await read(path);
    assert.match(content, /Quick Path/, `${path} Quick Path`);
    assert.match(content, /goal finish/, `${path} goal finish`);
    assert.match(content, /moduleAcceptance\|surfaceIntegration/, `${path} multi-kind verify`);
  }

  const work = await read("skills/pota-work/SKILL.md");
  assert.match(work, /goal finish --quiet --root "<repoRoot>" --watch "<path\|path>" -- <tool>/);
  assert.match(work, /goal stats --root "<repoRoot>"/);
  assert.match(work, /--root` is optional for every `goal` subcommand.*HARNESS_REPO_ROOT.*\.git/);
  assert.match(work, /Pota CLI: node "<abs>\/scripts\/pota\.mjs" goal <command>`/);
  assert.match(work, /never store it in a shell variable/);
  assert.match(work, /Evidence scopes are only `task` and `goal`/);
  assert.match(work, /Do not rerun earlier completed tasks' checks/);
  assert.match(work, /goal requiredEvidence is empty, task freshness is still rechecked/);
  assert.doesNotMatch(work, /goal complete --quiet/, "the three-step finish sequence is only shown as the long form");
  const verification = await read("skills/pota-work/verification.md");
  assert.match(verification, /once per goal\/task\/session/);
  assert.match(verification, /reruns \(repeated scope\+task\+kind\)/);
});

test("plan and work guidance document the task DAG and parallel delegation", async () => {
  const read = (path) => readFile(path, "utf8");
  const plan = await read("skills/pota-plan/SKILL.md");
  assert.match(plan, /`dependsOn` and `writeScope` in the `--tasks` JSON and named handoff files/);
  const planDelegation = await read("skills/pota-plan/delegation.md");
  assert.match(planDelegation, /Omitted `dependsOn` means the previous task.*explicit `\[\]` means no dependency/s);
  assert.match(planDelegation, /cycles are rejected/);
  assert.match(planDelegation, /no globs, `\.\.`, or absolute paths/);

  const work = await read("skills/pota-work/SKILL.md");
  assert.match(work, /goal ready --root "<repoRoot>"/);
  assert.match(work, /run `goal ready`.*parallel workers in the same worktree with disjoint `writeScope` and `--watch` inside it.*rerun `goal ready` after each completion/);
  const workDelegation = await read("skills/pota-work/delegation.md");
  assert.match(workDelegation, /At most 4 tasks are active/);
  assert.match(workDelegation, /without `writeScope` is active only alone/);
  assert.match(workDelegation, /same Git worktree/);
  assert.match(workDelegation, /`--watch` paths inside that task's `writeScope`/);
  assert.match(workDelegation, /goal becomes blocked only when no task is active or ready/);

  const template = await read("templates/work-plan.md");
  assert.match(template, /^- Depends on \(task ids\):$/m);
  assert.match(template, /^- Write scope:$/m);
  assert.match(template, /^- Handoff files:$/m);
  assert.doesNotMatch(template, /^- Dependencies:/m);
});

test("every supported locale exposes the token-efficient work contract", () => {
  for (const locale of ["en-US", "ko-KR", "ja-JP", "zh-CN", "es-ES", "fr-FR", "de-DE", "pt-BR"]) {
    const work = message("work", locale);
    assert.match(work, /test contract/i, `${locale} test contract`);
    assert.match(work, /tool exit code/i, `${locale} tool result authority`);
    assert.match(work, /content-producing/i, `${locale} lifecycle safety`);
    assert.match(work, /--ignore-scripts/i, `${locale} conditional script skip`);
  }
});

test("supported readmes document safe token-efficient verification and completed plans report completion", async () => {
  for (const path of ["README.md", "README.ko.md", "README.ja.md", "README.zh.md", "README.es.md", "README.fr.md", "README.de.md", "README.pt.md"]) {
    const readme = await readFile(path, "utf8");
    assert.match(readme, /test contract/i, `${path} test contract`);
    assert.match(readme, /content-producing/i, `${path} lifecycle classification`);
    assert.match(readme, /--ignore-scripts/i, `${path} safe package rule`);
  }

  const completedPlan = await readFile("docs/plan/token-efficient-reliable-harness.md", "utf8");
  assert.match(completedPlan, /현재 단계: 완료/);
});

test("delegation policy surfaces state model identity, new-dispatch, task-list, and strongest-design rules", async () => {
  const read = (path) => readFile(path, "utf8");
  const delegations = ["skills/pota-plan/delegation.md", "skills/pota-work/delegation.md"];
  const heavyPaths = ["skills/pota-plan/heavy-path.md", "skills/pota-work/heavy-path.md"];
  const guidance = ["docs/model-guidance/README.md", "docs/model-guidance/claude.md"];
  const identity = [...delegations, ...guidance, "templates/work-plan.md", "agents/worker.md"];

  for (const path of identity) {
    const content = await read(path);
    assert.match(content, /exact model ID/i, `${path} R1 exact model ID`);
    assert.match(content, /unreported/, `${path} R1 unreported`);
    assert.match(content, /never guess/i, `${path} R1 never guess`);
  }
  for (const path of [...identity.filter((path) => path !== "agents/worker.md"), ...heavyPaths]) {
    const content = await read(path);
    assert.match(content, /new dispatch/i, `${path} R2 new dispatch`);
    assert.match(content, /SendMessage/, `${path} R2 SendMessage`);
  }
  assert.match(await read("agents/worker.md"), /new dispatch.*SendMessage|SendMessage.*new dispatch/is, "agents/worker.md R2");
  for (const path of ["agents/worker.md", "skills/pota-plan/planning-rules.md", "skills/pota-plan/SKILL.md", "commands/pota-plan.md", ".agents/workflows/pota-plan.md", ...delegations]) {
    assert.match(await read(path), /main agent only/i, `${path} R3 main agent only`);
  }
  for (const path of ["agents/worker.md", "skills/pota-plan/planning-rules.md", ...delegations]) {
    const content = await read(path);
    for (const name of ["update_plan", "create_goal", "wrap_up"]) assert.ok(content.includes(`\`${name}\``), `${path} R3 ${name}`);
  }
  for (const path of [...delegations, ...heavyPaths, ...guidance]) {
    const content = await read(path);
    assert.match(content, /--host/, `${path} R4 --host`);
    assert.match(content, /strongest/i, `${path} R4 strongest`);
    assert.match(content, /--allow-no-design-model/, `${path} R4 waiver`);
  }
});

async function withTempRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "pota-token-efficiency-"));
  const stateHome = `${root}-home`;
  const previousPotaHome = process.env.POTA_HOME;
  process.env.POTA_HOME = stateHome;
  try {
    await run(root);
  } finally {
    if (previousPotaHome === undefined) delete process.env.POTA_HOME;
    else process.env.POTA_HOME = previousPotaHome;
    await rm(root, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
}
