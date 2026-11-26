import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, posix, resolve } from "node:path";

const root = resolve(".");
const readText = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(readText(path));
// A GitHub install gets only committed files, so a path a manifest names must be tracked, not just present here.
const trackedFiles = (() => {
  const listed = spawnSync("git", ["ls-files", "--cached", "-z"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  return new Set(listed.stdout.split("\0").filter(Boolean));
})();
const isTracked = (...parts) => trackedFiles.has(posix.normalize(posix.join(...parts)));

const manifestPaths = [
  "package.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".codex-plugin/mcp.json",
  ".agents/plugins/marketplace.json",
  "plugin.json",
  "hooks.json",
  "hooks/hooks.json",
  "hooks/codex.json",
  "mcp_config.json",
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

test("the eleven plugin JSON files parse and the four version surfaces agree", () => {
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
  assert.equal(claude.plugins[0].author?.name, "WkNam");
  const codex = readJson(".agents/plugins/marketplace.json");
  assert.equal(codex.name, "pota-harness");
  assert.deepEqual(codex.plugins.map((plugin) => [plugin.name, plugin.source]), [["pota", { source: "url", url: "./" }]]);
  for (const path of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"]) assert.equal(readJson(path).name, "pota", path);
});

test("the Claude manifest names the agents and the mod type contract, and hooks.json loads the mod", () => {
  const manifest = readJson(".claude-plugin/plugin.json");
  assert.equal(manifest.icon, "./assets/logo.svg");
  assert.ok(isTracked(manifest.icon), `${manifest.icon} is tracked`);
  assert.deepEqual(manifest.agents, ["./claude/agents/explorer.md", "./claude/agents/worker.md"]);
  for (const path of [...manifest.agents, manifest.types]) assert.ok(isTracked(path), `${path} is tracked`);
  const hooks = readJson("hooks/hooks.json");
  assert.deepEqual(Object.keys(hooks).sort(), ["hooks", "modules"]);
  assert.deepEqual(hooks.modules, ["./register.tsx"]);
  for (const module of hooks.modules) assert.ok(isTracked("hooks", module), `${module} is tracked`);
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
      assert.ok(isTracked(script), `${file} ${script} is tracked`);
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
  assert.ok(isTracked(manifest.logo), `${manifest.logo} is tracked`);
  assert.equal(existsSync(join(root, ".antigravity-plugin")), false);

  const hooks = readJson("hooks.json");
  assert.deepEqual(Object.keys(hooks), ["pota"]);
  assert.deepEqual(Object.keys(hooks.pota), Object.keys(antigravityEvents));
  assert.equal(hooks.pota.PostToolUse[0].matcher, "^(write_to_file|replace_file_content|multi_replace_file_content)$");
  for (const [event, command] of commandsOf(hooks.pota)) {
    assert.equal(command, `node ./scripts/pota-state-antigravity.mjs ${antigravityEvents[event]}`, `hooks.json ${event}`);
    const script = command.match(/^node \.\/(\S+)/)[1];
    assert.ok(isTracked(script), `hooks.json ${script} is tracked`);
  }
});

test("Antigravity mcp_config.json registers pota-dag and all DAG MCP scripts are tracked and syntax-checked", () => {
  // Antigravity MCP 서버 등록과 추적·문법 검사 대상 스크립트 계약을 고정한다.
  const mcpConfig = readJson("mcp_config.json");
  assert.deepEqual(Object.keys(mcpConfig), ["mcpServers"]);
  assert.deepEqual(Object.keys(mcpConfig.mcpServers), ["pota-dag"]);
  const potaDag = mcpConfig.mcpServers["pota-dag"];
  assert.equal(potaDag.command, "node");
  assert.deepEqual(potaDag.args, ["${PLUGIN_ROOT}/scripts/pota-dag-mcp.mjs"]);

  for (const path of [
    "mcp_config.json",
    "scripts/pota-dag-mcp.mjs",
    "scripts/pota-dag-mcp-core.mjs",
    "scripts/pota-dag-app-html.mjs",
    "scripts/pota-dag-transcript.mjs",
    "scripts/pota-dag-git.mjs",
  ]) {
    assert.ok(isTracked(path), `${path} is tracked`);
  }

  const checkScript = readJson("package.json").scripts.check;
  for (const script of [
    "scripts/pota-dag-mcp.mjs",
    "scripts/pota-dag-mcp-core.mjs",
    "scripts/pota-dag-app-html.mjs",
    "scripts/pota-dag-transcript.mjs",
    "scripts/pota-dag-git.mjs",
  ]) {
    assert.ok(checkScript.includes(`node --check ${script}`), `package.json check includes node --check ${script}`);
  }
});

test("Codex .codex-plugin/mcp.json registers pota-dag in isolation while keeping hooks/codex.json untouched", () => {
  // Codex MCP App 설정과 3호스트 격리(루트 .mcp.json 부재, Claude 매니페스트 무변경), 공용 워크스페이스 모듈 검사를 고정한다.
  const codexManifest = readJson(".codex-plugin/plugin.json");
  assert.equal(codexManifest.mcpServers, "./.codex-plugin/mcp.json");

  const codexMcp = readJson(".codex-plugin/mcp.json");
  assert.deepEqual(Object.keys(codexMcp), ["mcpServers"]);
  assert.deepEqual(Object.keys(codexMcp.mcpServers), ["pota-dag"]);
  const potaDag = codexMcp.mcpServers["pota-dag"];
  assert.equal(potaDag.type, "stdio");
  assert.equal(potaDag.command, "node");
  assert.deepEqual(potaDag.args, ["${PLUGIN_ROOT}/scripts/pota-dag-mcp.mjs", "--host", "codex"]);

  assert.ok(isTracked(".codex-plugin/mcp.json"), ".codex-plugin/mcp.json is tracked");
  assert.ok(isTracked("scripts/pota-dag-workspaces.mjs"), "scripts/pota-dag-workspaces.mjs is tracked");

  const checkScript = readJson("package.json").scripts.check;
  assert.ok(
    checkScript.includes("node --check scripts/pota-dag-workspaces.mjs"),
    "package.json check includes node --check scripts/pota-dag-workspaces.mjs",
  );

  // 루트 .mcp.json을 두지 않고 Claude/Antigravity 매니페스트에 mcpServers를 추가하지 않아 3호스트를 격리한다.
  assert.equal(existsSync(join(root, ".mcp.json")), false);
  const claudeManifest = readJson(".claude-plugin/plugin.json");
  assert.equal(Object.hasOwn(claudeManifest, "mcpServers"), false);
  assert.equal(claudeManifest.mcpServers, undefined);

  // Codex hook 재승인을 피하기 위해 hooks/codex.json 선언 계약이 유지되는지 검증한다.
  const codexHooks = readJson("hooks/codex.json");
  assert.deepEqual(Object.keys(codexHooks), ["hooks"]);
  assert.deepEqual(Object.keys(codexHooks.hooks), Object.keys(stateEvents));
  assert.equal(
    codexHooks.hooks.PostToolUse[0].matcher,
    "^(apply_patch|write|Write|edit|Edit|multi_edit|multiedit|MultiEdit)$",
  );
  const expectedCodexContracts = {
    SessionStart: {
      command: 'node "${PLUGIN_ROOT}/scripts/pota-state.mjs" session-start codex',
      timeout: 10,
      statusMessage: "Pota: loading read-only repository context",
    },
    UserPromptSubmit: {
      command: 'node "${PLUGIN_ROOT}/scripts/pota-state.mjs" user-prompt-submit codex',
      timeout: 10,
      statusMessage: "Pota: loading read-only work context",
    },
    PostToolUse: {
      command: 'node "${PLUGIN_ROOT}/scripts/pota-state.mjs" post-tool-use codex',
      timeout: 10,
      statusMessage: "Pota: reminding current goal evidence requirements",
    },
    Stop: {
      command: 'node "${PLUGIN_ROOT}/scripts/pota-state.mjs" stop codex',
      timeout: 10,
      statusMessage: "Pota: checking the active goal task",
    },
    SubagentStop: {
      command: 'node "${PLUGIN_ROOT}/scripts/pota-state.mjs" subagent-stop codex',
      timeout: 10,
      statusMessage: "Pota: checking this subagent's assigned task",
    },
  };
  for (const [event, expected] of Object.entries(expectedCodexContracts)) {
    const groups = codexHooks.hooks[event];
    assert.equal(groups.length, 1, `hooks/codex.json ${event} group count`);
    assert.equal(groups[0].hooks.length, 1, `hooks/codex.json ${event} hook count`);
    assert.deepEqual(groups[0].hooks[0], { type: "command", ...expected }, `hooks/codex.json ${event}`);
  }
});

test("the Codex interface logo fields point at the shared logo", () => {
  const { interface: face } = readJson(".codex-plugin/plugin.json");
  for (const key of ["composerIcon", "logo"]) {
    assert.equal(face[key], "./assets/logo.svg", key);
    assert.ok(isTracked(face[key]), `${key} is tracked`);
  }
});

test("the installer-era command, workflow, mirror, and mod folders are gone", () => {
  for (const path of ["commands", ".claude/commands", ".claude/agents", ".agents/workflows", "claude-mod", "scripts/pota"]) {
    assert.equal(existsSync(join(root, path)), false, `${path} exists`);
  }
});

test("no shipped file carries the runtime locator", () => {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  // Plan records and tests describe the retired locator on purpose.
  const files = listed.stdout.split("\n").filter((path) => path && !/^(?:docs\/plan|test)\//.test(path) && existsSync(join(root, path)));
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
