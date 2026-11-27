import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const read = (path) => readFile(resolve(root, path), "utf8");
const expectTokens = async (path, tokens) => {
  const text = await read(path);
  for (const token of tokens) assert.ok(text.includes(token), `${path} must contain ${token}`);
  return text;
};

const delegations = ["skills/pota-plan/delegation.md", "skills/pota-work/delegation.md"];

test("Heavy plan review: planReview evidence, verdict contract, and plan line", async () => {
  await expectTokens("skills/pota-plan/heavy-path.md", ["planReview", "VERDICT: approve", "VERDICT: reject", "Plan review:", "NOTES:", "path:line"]);
  const heavy = await readFile(new URL("../skills/pota-plan/heavy-path.md", import.meta.url), "utf8");
  const verify = heavy.split("\n").find((line) => line.includes("--kind planReview"));
  assert.match(verify, /--kind planReview --watch "docs\/plan\/<topic>\.md" -- node "<pluginRoot>\/scripts\/pota\.mjs" plan check --root "<repoRoot>"/);
  await expectTokens("skills/pota-work/heavy-path.md", ["planReview"]);
  const template = await expectTokens("templates/work-plan.md", ["Plan review"]);
  assert.ok(template.indexOf("Plan review") < template.indexOf("### Path Criteria"));
});

test("worker ESCALATE return and the orchestrator's one-tier-up handling", async () => {
  await expectTokens("claude/agents/worker.md", ["ESCALATE:"]);
  for (const path of delegations) await expectTokens(path, ["ESCALATE:", "Escalation:"]);
});

test("plan Learnings section, worker LEARNINGS report, and promotion input", async () => {
  await expectTokens("claude/agents/worker.md", ["LEARNINGS:"]);
  for (const path of delegations) await expectTokens(path, ["## Learnings", "LEARNINGS:"]);
  const template = await expectTokens("templates/work-plan.md", ["## Learnings", "## Evidence"]);
  assert.ok(template.indexOf("## Learnings") < template.indexOf("## Evidence"));
  await expectTokens("skills/pota-work/verification.md", ["## Learnings"]);
});

test("end state, waiting, closing, and rule candidates are pinned on every surface", async () => {
  await expectTokens("templates/work-plan.md", ["- End state:", "- Rule candidates:", "companion artifacts"]);
  await expectTokens("skills/pota-plan/SKILL.md", ["end the roadmap with a `deliver` task"]);
  await expectTokens("skills/pota-plan/planning-rules.md", ["ends its roadmap with a `deliver` task requiring `endState` evidence"]);
  await expectTokens("skills/pota-plan/request-brief.md", ["## End state", '"requiredEvidence":["endState"]', "The work goes exactly that far", "Companion artifacts are implicit requirements too", "is a rule candidate"]);
  await expectTokens("skills/pota-work/verification.md", ["## Waiting on External State", "take the next step in the same turn", "## End State and Closing", "Show the evidence, not only the verdict", "Promote a rule candidate"]);
  await expectTokens("skills/pota-work/SKILL.md", ["waiting on CI, end state and closing"]);
  await expectTokens("skills/pota-review/SKILL.md", ["`End state` was reached and not passed"]);
  await expectTokens("scripts/pota-goal-policy.mjs", ["Waiting on CI or another external or background job is not a reason to stop: check its state and continue."]);
});

test("memory notes may carry a Paths line", async () => {
  await expectTokens("skills/pota-memory/SKILL.md", ["Paths:", "paths-invalid"]);
});

test("model guidance names every addition", async () => {
  await expectTokens("docs/model-guidance/README.md", ["POTA_CLAIM_RECEIPT", "planReview", "ESCALATE:", "Paths:", "## Learnings"]);
});

test("defect triage: plan Quick Path, verification, and all worker bodies pin the no-change exit", async () => {
  await expectTokens("skills/pota-plan/SKILL.md", ["fix every place that breaks the same rule", "run a short script rather than guess"]);
  await expectTokens("skills/pota-work/verification.md", ["is not a completed sweep", "write and run a short throwaway script", "instead of bypassing the restriction", "when the tool is missing, build it unless project instructions forbid creating tools"]);
  for (const path of ["claude/agents/worker.md", "agents/worker.md", "skills/pota-work/roles/worker.md"]) {
    await expectTokens(path, ["fix the ones that break it inside your write scope and report the rest", "write and run a short throwaway script", "then build a small reusable tool and report it"]);
  }
  await expectTokens("skills/pota-plan/SKILL.md", ["Defect report or a factual claim in an instruction:", "Contradicted: change nothing and report the evidence.", "a single defect report qualifies", "not a guessed fix"]);
  await expectTokens("skills/pota-work/verification.md", ["when it contradicts them change nothing and report the evidence", "Doubt the claim, not the user's intent or decision"]);
  for (const path of ["claude/agents/worker.md", "agents/worker.md", "skills/pota-work/roles/worker.md"]) {
    await expectTokens(path, ["If the expected behavior, or a factual claim in the instruction, contradicts documented rules, existing tests, logs, or real data, change nothing and report the evidence."]);
  }
  await expectTokens("skills/pota-work/SKILL.md", ["goal cancel --reason <text>"]);
  await expectTokens("skills/pota-work/recovery.md", ['goal cancel --quiet --root "<repoRoot>" --reason "<why>"']);
});
