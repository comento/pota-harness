import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const names = ["explorer", "worker"];
const split = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, "frontmatter present");
  return { front: match[1], body: match[2] };
};

test("each role body is byte-identical across the Claude, Antigravity, and role-file surfaces", () => {
  for (const name of names) {
    const claude = split(read(`claude/agents/${name}.md`)).body;
    assert.equal(split(read(`agents/${name}.md`)).body, claude, `agents/${name}.md`);
    assert.equal(read(`skills/pota-work/roles/${name}.md`), claude.replace(/^\n+/, ""), `roles/${name}.md`);
    assert.ok(read(`skills/pota-work/roles/${name}.md`).startsWith(`# ${name}\n`));
  }
});

test("Antigravity agents use the array-tools frontmatter with no model", () => {
  const tools = { explorer: "[read_file, run_command]", worker: "[read_file, edit_file, write_file, run_command]" };
  for (const name of names) {
    const { front } = split(read(`agents/${name}.md`));
    const claudeDescription = split(read(`claude/agents/${name}.md`)).front.match(/^description: (.+)$/m)[1];
    assert.equal(front, `name: ${name}\ndescription: ${claudeDescription}\nsubagent: true\nmainAgent: false\ntools: ${tools[name]}`);
    assert.match(front, /^tools: \[/m);
    assert.doesNotMatch(front, /^model:/m);
  }
});

test("manifests keep Claude agents under claude/agents and Codex without an agents key", () => {
  const claude = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.deepEqual(claude.agents, ["./claude/agents/explorer.md", "./claude/agents/worker.md"]);
  const codex = JSON.parse(read(".codex-plugin/plugin.json"));
  assert.equal("agents" in codex, false);
});

test("both delegation files describe per-host role definitions with the same bullet", () => {
  const bullets = [];
  for (const path of ["skills/pota-plan/delegation.md", "skills/pota-work/delegation.md"]) {
    const text = read(path);
    for (const needle of ["pota://skills/pota-work/roles/explorer.md", "pota://skills/pota-work/roles/worker.md", "invoke_subagent", "~/.codex/agents"]) {
      assert.ok(text.includes(needle), `${path} mentions ${needle}`);
    }
    const bullet = text.split("\n").find((line) => line.startsWith("- Role definitions per host:"));
    assert.ok(bullet, `${path} has the bullet`);
    bullets.push(bullet);
  }
  assert.equal(bullets[0], bullets[1]);
});

test("skills/pota-work/roles holds only the two role files", () => {
  assert.deepEqual(readdirSync(join(root, "skills/pota-work/roles")).sort(), ["explorer.md", "worker.md"]);
  assert.ok(existsSync(join(root, "agents/explorer.md")) && existsSync(join(root, "agents/worker.md")));
});
