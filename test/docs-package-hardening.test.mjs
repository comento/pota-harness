import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { agentNames, commandNames, skillNames } from "../scripts/pota-lifecycle.mjs";

const root = resolve(".");
const read = (path) => readFile(resolve(root, path), "utf8");

const expectedCommandNames = [
  "pota-doctor",
  "pota-install",
  "pota-memory",
  "pota-plan",
  "pota-review",
  "pota-toolcheck",
  "pota-uninstall",
  "pota-upgrade",
  "pota-work",
];
const expectedAgentNames = ["explorer", "worker"];
const expectedSkillNames = ["pota-memory", "pota-plan", "pota-review", "pota-work"];

test("package excludes the retired shell state runtime", async () => {
  await assert.rejects(stat(resolve(root, "scripts/pota-state.sh")), { code: "ENOENT" });
  const packageJson = JSON.parse(await read("package.json"));
  assert.ok(!packageJson.files.includes("scripts/"));
  assert.ok(packageJson.files.includes("scripts/*.mjs"));

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packed = spawnSync(npm, ["pack", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const report = JSON.parse(packed.stdout);
  // npm <=11 prints an array (or a bare entry); npm 12 keys the entry by package name.
  const entry = Array.isArray(report)
    ? report[0]
    : report.files
      ? report
      : Object.values(report)[0];
  const paths = entry.files.map((file) => file.path);
  assert.ok(paths.includes("scripts/pota-state.mjs"));
  assert.ok(!paths.includes("scripts/pota-state.sh"));
});

test("host mirror inventory semantically covers nine commands", async () => {
  assert.deepEqual(commandNames().map((name) => `pota-${name}`).sort(), expectedCommandNames.sort());
  for (const name of commandNames()) {
    await stat(resolve(root, "commands", `pota-${name}.md`));
    await stat(resolve(root, ".agents", "workflows", `pota-${name}.md`));
    await stat(resolve(root, ".claude", "commands", `pota-${name}.md`));
  }
});

test("host mirror inventory semantically covers two agents and four skills", async () => {
  assert.deepEqual(agentNames().sort(), expectedAgentNames.sort());
  for (const name of agentNames()) {
    await stat(resolve(root, "agents", `${name}.md`));
    await stat(resolve(root, ".claude", "agents", `${name}.md`));
  }

  assert.deepEqual(skillNames().slice().sort(), expectedSkillNames.sort());
  for (const name of skillNames()) {
    await stat(resolve(root, "skills", name, "SKILL.md"));
    await stat(resolve(root, ".agents", "workflows", `${name}.md`));
  }
});

test("CI is least-privilege, bounded, SHA-pinned, and packs without rerunning prepack", async () => {
  const ci = (await read(".github/workflows/ci.yml")).replace(/\r\n/g, "\n");
  assert.match(ci, /^permissions:\n\s+contents:\s*read$/m);
  assert.match(ci, /^\s+timeout-minutes:\s*\d+$/m);
  assert.match(ci, /actions\/checkout@[0-9a-f]{40}\s+# v4/);
  assert.match(ci, /actions\/setup-node@[0-9a-f]{40}\s+# v4/);
  assert.doesNotMatch(ci, /^\s+- uses: actions\/(?:checkout|setup-node)@v\d/gm);
  assert.match(ci, /npm pack --dry-run --ignore-scripts/);
  // Branch protection requires the single "check" context, so a summary job must gate on the whole matrix.
  assert.match(ci, /^\s+name: check\n\s+if: always\(\)\n\s+needs: check$/m);
  assert.match(ci, /MATRIX_RESULT" = "success"[\s\S]*MATRIX_RESULT: \$\{\{ needs\.check\.result \}\}/);
  assert.equal((ci.match(/^\s+- run: npm run check$/gm) ?? []).length, 1);
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

test("all readmes document host selection, auto-upgrade, and the POTA_HOME install layout", async () => {
  for (const path of readmes) {
    const readme = await read(path);
    assert.match(readme, /`--hosts/, `${path} --hosts`);
    assert.match(readme, /`--allow-downgrade`/, `${path} --allow-downgrade`);
    assert.match(readme, /`pota auto-upgrade status\|on\|off\|run`/, `${path} auto-upgrade CLI`);
    assert.match(readme, /`POTA_AUTO_UPGRADE=0`/, `${path} POTA_AUTO_UPGRADE`);
    assert.match(readme, /`~\/\.pota\/install\//, `${path} ~/.pota install layout`);
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
