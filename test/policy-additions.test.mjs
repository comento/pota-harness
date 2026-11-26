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

test("memory notes may carry a Paths line", async () => {
  await expectTokens("skills/pota-memory/SKILL.md", ["Paths:", "paths-invalid"]);
});

test("model guidance names every addition", async () => {
  await expectTokens("docs/model-guidance/README.md", ["POTA_CLAIM_RECEIPT", "planReview", "ESCALATE:", "Paths:", "## Learnings"]);
});
