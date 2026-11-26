import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const read = (path) => readFile(resolve(root, path), "utf8");

const expectedAgentNames = ["explorer", "worker"];
const expectedSkillNames = ["dag", "pota-memory", "pota-plan", "pota-review", "pota-work"];

test("the retired shell state runtime stays deleted", async () => {
  await assert.rejects(stat(resolve(root, "scripts/pota-state.sh")), { code: "ENOENT" });
});

test("plugin inventory covers two Claude agents, two Antigravity agents, and five skills and no command or workflow surfaces", async () => {
  const agents = (await readdir(resolve(root, "claude", "agents"))).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));
  assert.deepEqual(agents.sort(), expectedAgentNames);
  const skills = (await readdir(resolve(root, "skills"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(skills.sort(), expectedSkillNames);
  for (const name of skills) await stat(resolve(root, "skills", name, "SKILL.md"));
  const antigravity = (await readdir(resolve(root, "agents"))).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));
  assert.deepEqual(antigravity.sort(), expectedAgentNames);
  for (const path of ["commands", ".claude/commands", ".claude/agents", ".agents/workflows"]) {
    await assert.rejects(stat(resolve(root, path)), { code: "ENOENT" }, `${path} is gone`);
  }
});

test("the dag skill only opens the Pota DAG panel and stays tiny", async () => {
  const body = await read("skills/dag/SKILL.md");
  assert.match(body, /^---\nname: dag\ndescription: [^\n]+\n---\n/);
  assert.match(body, /open_pota_dag/);
  assert.match(body, /Claude Code[^\n]*`\/dag`/);
  assert.ok(Buffer.byteLength(body) < 2000, "dag skill stays under 2,000 bytes");
});

test("CI is least-privilege, bounded, SHA-pinned, and keeps host validation out of the required check", async () => {
  const ci = (await read(".github/workflows/ci.yml")).replace(/\r\n/g, "\n");
  assert.match(ci, /^permissions:\n\s+contents:\s*read$/m);
  assert.doesNotMatch(ci, /^ +permissions:/m, "no job widens the permissions");
  assert.match(ci, /actions\/checkout@[0-9a-f]{40}\s+# v4/);
  assert.match(ci, /actions\/setup-node@[0-9a-f]{40}\s+# v4/);
  assert.doesNotMatch(ci, /^\s+- uses: [^@\s]+@(?![0-9a-f]{40}\b)/m, "every action is SHA-pinned");
  assert.doesNotMatch(ci, /npm pack/);
  const jobs = ci.split(/^jobs:\n/m)[1].split(/^ {2}(?=[a-z][\w-]*:\n)/m).filter(Boolean);
  assert.ok(jobs.length >= 3, "check, check-summary, and host-validate jobs");
  for (const job of jobs) assert.match(job, /^\s+timeout-minutes:\s*\d+$/m, `${job.split(":")[0]} timeout`);
  // Branch protection requires the single "check" context, so a summary job must gate on the whole matrix.
  assert.match(ci, /^\s+name: check\n\s+if: always\(\)\n\s+needs: check$/m);
  assert.match(ci, /MATRIX_RESULT" = "success"[\s\S]*MATRIX_RESULT: \$\{\{ needs\.check\.result \}\}/);
  assert.equal((ci.match(/^\s+- run: npm run check$/gm) ?? []).length, 1);
  const hostValidate = jobs.find((job) => job.startsWith("host-validate:"));
  assert.ok(hostValidate, "host-validate job");
  assert.match(hostValidate, /npm install --global @anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
  assert.match(hostValidate, /npm install --global @openai\/codex@\d+\.\d+\.\d+/);
  assert.match(hostValidate, /CLAUDE_CONFIG_DIR: \$\{\{ runner\.temp \}\}\/claude/);
  assert.match(hostValidate, /claude plugin validate \./);
  assert.match(hostValidate, /CODEX_HOME: \$\{\{ runner\.temp \}\}\/codex/);
  assert.match(hostValidate, /codex plugin add pota@pota-harness/);
  assert.match(hostValidate, /hooks\/codex\.json/);
  assert.doesNotMatch(ci, /needs: \[?[^\n]*host-validate/, "host-validate is not required");
});

const readmes = ["README.md", "README.ko.md", "README.ja.md", "README.zh.md", "README.es.md", "README.fr.md", "README.de.md", "README.pt.md"];

test("all readmes document the memory and plan index commands, ARCHIVE.md, goal stats --history, and advisory completionCriteria", async () => {
  for (const path of readmes) {
    const readme = await read(path);
    assert.match(readme, /`pota memory check\|index\b/, `${path} memory index commands`);
    assert.match(readme, /`pota plan check\|index \[--archive\]/, `${path} plan index commands`);
    assert.match(readme, /`docs\/plan\/ARCHIVE\.md`/, `${path} ARCHIVE.md`);
    assert.match(readme, /`## Completed Plans`/, `${path} Completed Plans order`);
    assert.match(readme, /SessionStart/, `${path} session-start index notice`);
    assert.match(readme, /`goal stats --history( \[--limit N\])?`/, `${path} goal stats --history`);
    assert.ok(/`completionCriteria`[^\n]*`advisory`|`advisory`[^\n]*`completionCriteria`/.test(readme), `${path} advisory completionCriteria`);
    assert.match(readme, /`Memory promotion:/, `${path} Memory promotion decision`);
  }
});

test("no readme points at the legacy Claude marketplace path", async () => {
  for (const path of readmes) {
    const readme = await read(path);
    assert.doesNotMatch(readme, /~\/\.codex\/plugins\/cache\/pota\/claude/, `${path} legacy Claude marketplace path`);
  }
});

test("the README cleanup entry states that only valid dead-owner lock records are removed", async () => {
  const cases = {
    "README.md": [/valid lock record/, /owner process (?:on this host )?is dead/, /preserved/, /`preservedReasons`/],
    "README.ko.md": [/유효한 lock 레코드/, /owner 프로세스가 (?:종료된|죽은)/, /보존/, /`preservedReasons`/],
  };
  for (const [path, patterns] of Object.entries(cases)) {
    const entry = (await read(path)).split(/\r?\n/).find((line) => line.startsWith("- `pota cleanup --root <repo>`"));
    assert.ok(entry, `${path} cleanup entry`);
    for (const pattern of patterns) assert.match(entry, pattern, `${path} ${pattern}`);
  }
});
