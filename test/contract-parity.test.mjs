import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

test("package and the three host manifests expose the same version", async () => {
  const packageJson = await readJson("package.json");

  assert.equal(packageJson.version, "2.3.0");
  for (const path of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"]) {
    assert.equal((await readJson(path)).version, packageJson.version, `${path} version`);
  }
  // Hosts install the plugin from the repository; the npm package is never published again.
  assert.equal(packageJson.private, true);
  for (const key of ["bin", "files"]) assert.equal(packageJson[key], undefined, `package.json ${key}`);
  assert.equal(packageJson.scripts.prepack, undefined);
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
  for (const path of ["skills/pota-memory/SKILL.md"]) {
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
  assert.match(rules, /one line of 200 characters or fewer/, "PLAN.md one-line entry");
  assert.match(rules, /plan index --root/, "plan index");
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

  const surfaces = ["skills/pota-work/verification.md", "skills/pota-review/SKILL.md"];
  for (const path of surfaces) {
    const content = await readText(path);
    assert.match(content, /Memory promotion:/, `${path} Memory promotion line`);
    assert.match(content, /none: <reason>/, `${path} none reason`);
    assert.match(content, /do not create a note/i, `${path} optional note`);
    assert.doesNotMatch(content, forcedNote, `${path} forced note`);
  }
  for (const path of ["skills/pota-review/SKILL.md"]) {
    const content = await readText(path);
    assert.match(content, /memory check --root/, `${path} memory check`);
    assert.match(content, /plan check --root/, `${path} plan check`);
  }
});

test("tool readiness surfaces tell the agent to ask the user once before installing missing tools", async () => {
  const skill = await readText("skills/pota-plan/SKILL.md");
  assert.ok(skill.includes("If tools are missing, ask the user once whether to install them."), "pota-plan step 5");
  assert.match(await readText("skills/pota-work/SKILL.md"), /ask once before installing missing tools/, "pota-work step 3");

  const canonical = {
    "skills/pota-plan/planning-rules.md": /^## Tool Readiness Policy$/m,
    "skills/pota-work/verification.md": /^## Tool Readiness Policy$/m,
  };
  for (const [path, heading] of Object.entries(canonical)) {
    const policy = (await readText(path)).split(heading)[1].split(/^## /m)[0];
    assert.match(policy, /main agent asks the user once whether to install them/, `${path} asks once`);
    assert.match(policy, /proposed install command or the reason no automatic installer exists/, `${path} question content`);
    assert.match(policy, /continue work that does not need (?:the missing|those) tools/i, `${path} keeps working`);
    assert.match(policy, /do not ask again(?: about the same tools)? in this session/, `${path} asks only once per session`);
    assert.match(policy, /once per session: a blocker an earlier session recorded \(declined or not asked\) does not suppress it/, `${path} earlier blocker does not suppress`);
    assert.match(policy, /new session that still finds the tools missing asks once again/, `${path} new session asks again`);
    assert.match(policy, /subagent (?:never asks|reports them to the orchestrator instead of asking)/i, `${path} subagents do not ask`);
    assert.match(policy, /cannot ask the user \(non-interactive[^)]*\), do not ask; record/, `${path} non-interactive blocker`);
    assert.match(policy, /If the user declines/, `${path} declined blocker`);
    assert.match(policy, /explicit (?:user )?approval/, `${path} approval still required`);
    assert.match(policy, /`toolcheck --install --yes(?: --root "<repoRoot>")?` only for pinned\/supported installers|pinned\/supported installer \(`toolcheck --install --yes`\)/, `${path} pinned installer rule`);
  }

  for (const path of ["docs/model-guidance/README.md"]) {
    const content = await readText(path);
    assert.match(content, /asks? the user once whether to install/, `${path} asks once`);
    assert.match(content, /explicit(?:ly)? approv/, `${path} approval still required`);
    assert.match(content, /proposed command or the reason no automatic installer exists/, `${path} question content`);
    assert.match(content, /non-interactive/, `${path} non-interactive blocker`);
    assert.match(content, /record a blocker/, `${path} blocker`);
  }

  for (const path of ["skills/pota-plan/delegation.md", "skills/pota-work/delegation.md", "claude/agents/worker.md"]) {
    const content = await readText(path);
    assert.match(content, /`toolcheck` install proposal to the orchestrator, which asks the user once/, `${path} subagent reports instead of asking`);
    assert.match(content, /never install without that approval/, `${path} approval still required`);
  }
  assert.doesNotMatch(await readText("skills/pota-work/delegation.md"), /Obtain explicit user approval before installing/, "workers cannot ask the user");

  assert.match(await readText("templates/work-plan.md"), /^- Install approval: asked once and approved, asked once and denied, not asked \(non-interactive run\), or not needed\.$/m);
});

test("all readmes say toolcheck prints install question data and the agent asks once", async () => {
  const cases = {
    "README.md": [/suggested install command/, /asks you once whether to install/, /non-interactive/],
    "README.ko.md": [/제안 설치 명령/, /한 번 묻습니다/, /비대화형/],
    "README.ja.md": [/提案インストールコマンド/, /一度だけ確認/, /非対話/],
    "README.zh.md": [/建议的安装命令/, /询问一次/, /非交互/],
    "README.es.md": [/comando de instalación sugerido/, /una sola vez/, /no es interactiva/],
    "README.fr.md": [/commande d'installation suggérée/, /une seule fois/, /n'est pas interactive/],
    "README.de.md": [/vorgeschlagenen Installationsbefehl/, /fragt einmal/, /nicht interaktiver/],
    "README.pt.md": [/comando de instalacao sugerido/, /uma unica vez/, /nao for interativa/],
  };
  for (const [path, patterns] of Object.entries(cases)) {
    const entry = (await readText(path)).split(/\r?\n/).find((line) => line.startsWith("- `toolcheck`") && /blocker/.test(line));
    assert.ok(entry, `${path} toolcheck missing-tool entry`);
    for (const pattern of patterns) assert.match(entry, pattern, `${path} ${pattern}`);
  }
});

test("delegation prompts carry the selected memory note paths", async () => {
  for (const path of ["skills/pota-plan/delegation.md", "skills/pota-work/delegation.md"]) {
    const content = await readText(path);
    assert.match(content, /^CONTEXT:.*selected `docs\/memory\/<domain>\.md` note paths/m, `${path} CONTEXT note paths`);
    assert.match(content, /session-start memory list/i, `${path} why paths are passed`);
  }
});

test("Claude agents point to MEMORY.md entries for relevant notes", async () => {
  for (const path of ["claude/agents/explorer.md", "claude/agents/worker.md"]) {
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

test("request brief and steering surfaces name the template section, the commands, and the bypass flag", async () => {
  const template = await readText("templates/work-plan.md");
  assert.match(template, /^## Request Brief$/m);
  assert.ok(template.indexOf("## Goal") < template.indexOf("## Request Brief") && template.indexOf("## Request Brief") < template.indexOf("## Whole Work"));
  const brief = template.split(/^## Request Brief$/m)[1].split(/^## /m)[0];
  for (const label of ["Original request", "Interpreted outcome", "Scope", "Non-scope", "Assumptions", "Prior records", "Implicit requirements", "Open questions", "Steering log", "Current request (as of S0)"]) {
    assert.ok(brief.includes(`- ${label}:`), `template ${label}`);
  }
  assert.ok(brief.indexOf("- Prior records:") < brief.indexOf("- Assumptions:"), "Prior records before Assumptions");
  assert.doesNotMatch(brief, /^\s*- S1 \(/m, "template has no S1 example line");

  const reference = await readText("skills/pota-plan/request-brief.md");
  for (const needle of ["## Request Brief", "## Prior records", "pota plan steering", "Prior records", "goal steer", "--steer", "--allow-no-request-brief", "Current request (as of S", "correction", "addition", "redirect", "Quick Path"]) {
    assert.ok(reference.includes(needle), `request-brief.md ${needle}`);
  }

  assert.ok((await readText("skills/pota-plan/SKILL.md")).includes("pota://skills/pota-plan/request-brief.md"), "pota-plan SKILL pointer");
  const rules = await readText("skills/pota-plan/planning-rules.md");
  for (const needle of ["## Request Brief", "--allow-no-request-brief", "goal steer", "--steer", "Current request (as of S", "pota plan steering", "Prior records"]) assert.ok(rules.includes(needle), `planning-rules ${needle}`);
  const work = await readText("skills/pota-work/SKILL.md");
  assert.match(work, /goal replan --quiet[^\n]*--steer "<correction\|addition\|redirect\|none>" --reason/);
  assert.ok(work.includes("pota://skills/pota-plan/request-brief.md"), "pota-work SKILL pointer");
  const recovery = await readText("skills/pota-work/recovery.md");
  for (const needle of ["goal steer", "--steer", "Current request (as of S", "## Request Brief"]) assert.ok(recovery.includes(needle), `recovery ${needle}`);

  for (const path of ["README.md", "README.ko.md", "README.ja.md", "README.zh.md", "README.es.md", "README.fr.md", "README.de.md", "README.pt.md"]) {
    const content = await readText(path);
    for (const needle of ["## Request Brief", "goal steer", "--steer", "--allow-no-request-brief", "Current request (as of S", "pota plan steering", "Prior records"]) assert.ok(content.includes(needle), `${path} ${needle}`);
  }
});
