import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

test("package and plugin metadata expose the same machine-consumed version", async () => {
  const packageJson = await readJson("package.json");
  const pluginJson = await readJson(".codex-plugin/plugin.json");

  assert.equal(packageJson.version, "1.0.0");
  assert.equal(pluginJson.version, packageJson.version);
  assert.deepEqual(packageJson.bin, {
    pota: "scripts/pota.mjs",
  });
  assert.ok(packageJson.files.includes("scripts/*.mjs"));
  assert.ok(!packageJson.files.includes("scripts/"));
  assert.equal(packageJson.scripts.prepack, "npm run check");
});

const readText = (path) => readFile(resolve(root, path), "utf8");
const lineWith = (content, patterns) => content.split(/\r?\n/).find((line) => patterns.every((pattern) => pattern.test(line)));
const forcedNote = /\b(?:must|always)\s+(?:create|write|add)\s+(?:a\s+)?(?:new\s+)?(?:memory\s+)?note/i;

test("templates/MEMORY.md and templates/PLAN.md equal the English init templates", async () => {
  const { INDEX_TEMPLATES } = await import("../scripts/pota-state-init.mjs");
  assert.equal(await readText("templates/MEMORY.md"), INDEX_TEMPLATES.memory.en);
  assert.equal(await readText("templates/PLAN.md"), INDEX_TEMPLATES.plan.en);
});

test("memory surfaces require a Summary line and pota memory index/check", async () => {
  for (const path of ["skills/pota-memory/SKILL.md", "commands/pota-memory.md", ".agents/workflows/pota-memory.md"]) {
    const content = await readText(path);
    assert.match(content, /`Summary:`/, `${path} Summary line`);
    assert.match(content, /120 characters/, `${path} Summary limit`);
    assert.match(content, /memory index --root/, `${path} memory index`);
    assert.match(content, /memory check --root/, `${path} memory check`);
    assert.doesNotMatch(content, forcedNote, `${path} forced note`);
  }
  const note = (await readText("templates/domain-memory.md")).split(/\r?\n/);
  assert.match(note[0], /^# Domain: <name>$/);
  assert.equal(note[2], "Summary: <one line, at most 120 characters: what this note answers and when to read it>");
});

test("plan surfaces require reuse of related notes and completed plans and the PLAN.md one-line entry", async () => {
  const skill = await readText("skills/pota-plan/SKILL.md");
  assert.ok(skill.includes("2. Read `MEMORY.md` and `PLAN.md` when present; pick related notes and past plans (`planning-rules.md`)."), "pota-plan step 2");
  assert.ok(skill.includes("5. Run `triage-plan`: read the picked notes and plans and installed model guidance,"), "pota-plan step 5");

  const rules = await readText("skills/pota-plan/planning-rules.md");
  assert.match(rules, /^## Reuse Before Planning$/m);
  const reuse = rules.split(/^## Reuse Before Planning$/m)[1].split(/^## /m)[0];
  assert.match(reuse, /`MEMORY\.md`/);
  assert.match(reuse, /`docs\/plan\/ARCHIVE\.md`/);
  assert.match(reuse, /at most 3 completed plans/i);
  assert.match(reuse, /goal, design decisions, and evidence/i);
  assert.match(reuse, /`Related completed plans:`/);
  assert.match(reuse, /`none related`/);
  assert.match(reuse, /200 characters/);
  assert.match(reuse, /plan index --root/);
  assert.match(reuse, /do not read every/i);

  for (const path of ["commands/pota-plan.md", ".agents/workflows/pota-plan.md"]) {
    const content = await readText(path);
    assert.match(content, /related (?:`docs\/memory` )?notes/i, `${path} related notes`);
    assert.match(content, /at most 3 completed plans/i, `${path} completed plans`);
    assert.match(content, /`Related completed plans:`/, `${path} Related completed plans`);
    assert.match(content, /one line of 200 characters or fewer/, `${path} PLAN.md one-line entry`);
    assert.match(content, /plan index --root/, `${path} plan index`);
  }
});

test("work and review surfaces require the Memory promotion decision and forbid forced notes", async () => {
  const skill = await readText("skills/pota-work/SKILL.md");
  assert.ok(skill.includes("8. Record evidence and the memory promotion decision (`verification.md`) in the plan and state before updating `PLAN.md`. Workers report only their assigned task."), "pota-work step 8");

  const verification = await readText("skills/pota-work/verification.md");
  assert.match(verification, /^## Memory Promotion$/m);
  const promotion = verification.split(/^## Memory Promotion$/m)[1].split(/^## /m)[0];
  assert.match(promotion, /`Memory promotion: docs\/memory\/<domain>\.md`/);
  assert.match(promotion, /`Memory promotion: none: <reason>`/);
  assert.match(promotion, /memory index --root/);

  const surfaces = [
    "skills/pota-work/verification.md",
    "commands/pota-work.md",
    ".agents/workflows/pota-work.md",
    "skills/pota-review/SKILL.md",
    "commands/pota-review.md",
    ".agents/workflows/pota-review.md",
  ];
  for (const path of surfaces) {
    const content = await readText(path);
    assert.match(content, /Memory promotion:/, `${path} Memory promotion line`);
    assert.match(content, /none: <reason>/, `${path} none reason`);
    assert.match(content, /do not create a note/i, `${path} optional note`);
    assert.doesNotMatch(content, forcedNote, `${path} forced note`);
  }
  for (const path of ["skills/pota-review/SKILL.md", "commands/pota-review.md", ".agents/workflows/pota-review.md"]) {
    const content = await readText(path);
    assert.match(content, /memory check --root/, `${path} memory check`);
    assert.match(content, /plan check --root/, `${path} plan check`);
  }
});

test("delegation prompts carry the selected memory note paths", async () => {
  for (const path of ["skills/pota-plan/delegation.md", "skills/pota-work/delegation.md"]) {
    const content = await readText(path);
    assert.match(content, /^CONTEXT:.*selected `docs\/memory\/<domain>\.md` note paths/m, `${path} CONTEXT note paths`);
    assert.match(content, /session-start memory list/i, `${path} why paths are passed`);
  }
});

test("agents and their Claude mirrors point to MEMORY.md entries for relevant notes", async () => {
  for (const path of ["agents/explorer.md", "agents/worker.md", ".claude/agents/explorer.md", ".claude/agents/worker.md"]) {
    const content = await readText(path);
    assert.ok(lineWith(content, [/`MEMORY\.md`/, /entries/, /`docs\/memory\/\*\.md`/]), `${path} MEMORY.md entries locate notes`);
    assert.match(content, /continue without repository memory when absent|If absent, continue without repository memory/, `${path} missing MEMORY.md`);
  }
});

test("work plan template declares advisory completion criteria, Related completed plans, and Memory promotion", async () => {
  const template = await readText("templates/work-plan.md");
  assert.match(template, /^- Completion criteria \(advisory text; Pota does not enforce it — completion is gated only by required evidence\):$/m);
  assert.doesNotMatch(template, /^- Completion criteria:$/m);
  const memoryInputs = template.split(/^## Memory Inputs$/m)[1].split(/^## /m)[0];
  assert.match(memoryInputs, /^- Related completed plans: <docs\/plan\/<topic>\.md \| none related>$/m);
  const evidence = template.split(/^## Evidence$/m)[1].split(/^## /m)[0];
  assert.match(evidence, /^- Memory promotion: <docs\/memory\/<domain>\.md \| none: reason>$/m);
});
