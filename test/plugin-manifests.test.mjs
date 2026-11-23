import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(".");
const readText = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(readText(path));

const manifestPaths = [
  "package.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  "plugin.json",
  "hooks.json",
  "hooks/hooks.json",
  "hooks/codex.json",
];
const versionSurfaces = ["package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"];
const stateEvents = {
  SessionStart: "session-start",
  UserPromptSubmit: "user-prompt-submit",
  PostToolUse: "post-tool-use",
  Stop: "stop",
  SubagentStop: "subagent-stop",
};
const antigravityEvents = {
  SessionStart: "session-start",
  PreInvocation: "pre-invocation",
  PostToolUse: "post-tool-use",
  Stop: "stop",
};

const commandsOf = (hooks) => Object.entries(hooks).flatMap(([event, groups]) => groups.flatMap((group) => (group.hooks ?? [group]).map((hook) => [event, hook.command])));

test("the nine plugin JSON files parse and the four version surfaces agree", () => {
  for (const path of manifestPaths) assert.doesNotThrow(() => readJson(path), path);
  const version = readJson("package.json").version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const path of versionSurfaces) assert.equal(readJson(path).version, version, `${path} version`);
  for (const path of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"]) {
    const marketplace = readJson(path);
    assert.equal(marketplace.version, undefined, `${path} carries no version`);
    for (const plugin of marketplace.plugins) assert.equal(plugin.version, undefined, `${path} plugin carries no version`);
  }
});

test("both marketplaces are pota-harness and list the repository root as the plugin pota", () => {
  const claude = readJson(".claude-plugin/marketplace.json");
  assert.equal(claude.name, "pota-harness");
  assert.deepEqual(claude.plugins.map((plugin) => [plugin.name, plugin.source]), [["pota", "./"]]);
  const codex = readJson(".agents/plugins/marketplace.json");
  assert.equal(codex.name, "pota-harness");
  assert.deepEqual(codex.plugins.map((plugin) => [plugin.name, plugin.source]), [["pota", { source: "url", url: "./" }]]);
  for (const path of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"]) assert.equal(readJson(path).name, "pota", path);
});

test("the Claude manifest names the agents and the mod type contract, and hooks.json loads the mod", () => {
  const manifest = readJson(".claude-plugin/plugin.json");
  assert.deepEqual(manifest.agents, ["./claude/agents/explorer.md", "./claude/agents/worker.md"]);
  for (const path of [...manifest.agents, manifest.types]) assert.ok(existsSync(join(root, path)), `${path} exists`);
  const hooks = readJson("hooks/hooks.json");
  assert.deepEqual(Object.keys(hooks).sort(), ["hooks", "modules"]);
  assert.deepEqual(hooks.modules, ["./register.tsx"]);
  for (const module of hooks.modules) assert.ok(existsSync(join(root, "hooks", module)), `${module} exists`);
});

test("Claude and Codex hooks run pota-state.mjs with the event and host tokens, and Codex reads only its own file", () => {
  const claude = readJson("hooks/hooks.json");
  const codex = readJson("hooks/codex.json");
  assert.equal(readJson(".codex-plugin/plugin.json").hooks, "./hooks/codex.json");
  assert.equal(readJson(".codex-plugin/plugin.json").skills, "./skills/");
  // Codex parses hook files with deny_unknown_fields: only description and hooks are allowed.
  for (const key of Object.keys(codex)) assert.ok(["description", "hooks"].includes(key), `hooks/codex.json key ${key}`);

  assert.deepEqual(Object.keys(claude.hooks), Object.keys(stateEvents));
  for (const [file, variable, host, hooks] of [
    ["hooks/hooks.json", "CLAUDE_PLUGIN_ROOT", "claude", claude.hooks],
    ["hooks/codex.json", "PLUGIN_ROOT", "codex", codex.hooks],
  ]) {
    for (const [event, command] of commandsOf(hooks)) {
      assert.equal(command, `node "\${${variable}}/scripts/pota-state.mjs" ${stateEvents[event]} ${host}`, `${file} ${event}`);
      const script = command.match(/^node "\$\{[A-Z_]+\}\/([^"]+)"/)[1];
      assert.ok(existsSync(join(root, script)), `${file} ${script} exists`);
    }
  }

  // hooks/codex.json is hooks/hooks.json without modules, with the Codex root variable and host token.
  const derived = JSON.parse(
    JSON.stringify({ hooks: claude.hooks })
      .replaceAll("${CLAUDE_PLUGIN_ROOT}", "${PLUGIN_ROOT}")
      .replace(/(pota-state\.mjs\\" [a-z-]+) claude"/g, '$1 codex"'),
  );
  assert.deepEqual(codex, derived);
  const postToolUse = claude.hooks.PostToolUse[0];
  assert.equal(postToolUse.matcher, "^(apply_patch|write|Write|edit|Edit|multi_edit|multiedit|MultiEdit)$");
  for (const [, groups] of Object.entries(claude.hooks)) for (const hook of groups[0].hooks) assert.equal(hook.timeout, 10);
});

test("Antigravity reads the root plugin.json and root hooks.json with plugin-root relative commands", () => {
  const manifest = readJson("plugin.json");
  // Codex reads a root plugin.json only under the agent-plugins.org schema; this one must stay Antigravity's.
  assert.equal(manifest.$schema, "https://antigravity.google/schemas/v1/plugin.json");
  assert.doesNotMatch(manifest.$schema, /agent-plugins\.org/);
  const allowed = ["$schema", "name", "displayName", "version", "description", "logo", "suggestedPrompts", "author", "homepage", "repository", "license", "keywords"];
  for (const key of Object.keys(manifest)) assert.ok(allowed.includes(key), `plugin.json key ${key}`);
  assert.equal(manifest.logo, "assets/logo.svg");
  assert.ok(existsSync(join(root, manifest.logo)));
  assert.equal(existsSync(join(root, ".antigravity-plugin")), false);

  const hooks = readJson("hooks.json");
  assert.deepEqual(Object.keys(hooks), ["pota"]);
  assert.deepEqual(Object.keys(hooks.pota), Object.keys(antigravityEvents));
  assert.equal(hooks.pota.PostToolUse[0].matcher, "^(write_to_file|replace_file_content|multi_replace_file_content)$");
  for (const [event, command] of commandsOf(hooks.pota)) {
    assert.equal(command, `node ./scripts/pota-state-antigravity.mjs ${antigravityEvents[event]}`, `hooks.json ${event}`);
    assert.ok(existsSync(join(root, "scripts/pota-state-antigravity.mjs")));
  }
});

test("the Codex interface logo fields point at the shared logo", () => {
  const { interface: face } = readJson(".codex-plugin/plugin.json");
  for (const key of ["composerIcon", "logo"]) {
    assert.equal(face[key], "./assets/logo.svg", key);
    assert.ok(existsSync(join(root, face[key])), `${key} exists`);
  }
});

test("the installer-era command, workflow, mirror, and mod folders are gone", () => {
  for (const path of ["commands", "agents", ".claude/commands", ".claude/agents", ".agents/workflows", "claude-mod", "scripts/pota"]) {
    assert.equal(existsSync(join(root, path)), false, `${path} exists`);
  }
});

test("no shipped file carries the runtime locator", () => {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  // Plan records and tests describe the retired locator on purpose; docs/memory is rewritten with the README task.
  const files = listed.stdout.split("\n").filter((path) => path && !/^(?:docs\/plan|docs\/memory|test)\//.test(path) && existsSync(join(root, path)));
  assert.ok(files.includes("skills/pota-plan/SKILL.md"));
  for (const path of files) {
    const content = readFileSync(join(root, path), "latin1");
    assert.equal(content.includes("{{POTA_RUNTIME_LOCATOR_JSON}}"), false, `${path} locator placeholder`);
    assert.equal(content.includes("pota-runtime.json"), false, `${path} locator file`);
  }
});

test("skills, agents, and model guidance never resolve Pota files against the target repository", () => {
  const markdown = (directory) => readdirSync(join(root, directory), { recursive: true }).filter((path) => path.endsWith(".md")).map((path) => join(directory, path));
  const paths = [...markdown("skills"), ...markdown("claude/agents"), ...markdown("docs/model-guidance")];
  assert.ok(paths.length >= 15);
  for (const path of paths) {
    const content = readText(path);
    assert.doesNotMatch(content, /\bnode\s+scripts[\\/]/, path);
    assert.doesNotMatch(content, /(?:^|[\s`("'=])commands\/pota-[A-Za-z0-9._<>/-]+/m, path);
    assert.doesNotMatch(content, /(?:^|[\s`("'=])agents\/(?:explorer|worker)\.md/m, path);
    assert.doesNotMatch(content, /(?:^|[\s`("'=])templates\/[A-Za-z0-9._<>/-]+/m, path);
    assert.doesNotMatch(content, /(?:^|[\s`("'=])docs\/model-guidance\/[A-Za-z0-9._<>/-]+/m, path);
    assert.doesNotMatch(content, /\bpota (?:install|upgrade|uninstall)\b|published\/global/, path);
  }
});
