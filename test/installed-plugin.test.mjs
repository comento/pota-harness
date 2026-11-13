import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { main } from "../scripts/pota.mjs";
import { quoteShellArg, renderInstalledMirror } from "../scripts/pota-lifecycle.mjs";
import { createRuntimeLocator, parseRootArgs, resolvePluginRoot } from "../scripts/pota-paths.mjs";

const fakeClaudeCli = resolve("test/fixtures/fake-claude.mjs");
const sourceRoot = resolve(".");
const lifecycleScript = join(sourceRoot, "scripts", "pota-lifecycle.mjs");
const releaseVersion = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")).version;

test("plugin and repository roots remain separate", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pota roots "));
  const repository = join(temp, "repository");
  const nested = join(repository, "packages", "app");
  try {
    await mkdir(join(repository, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });

    assert.equal(resolvePluginRoot(new URL("../scripts/pota.mjs", import.meta.url)), sourceRoot);
    assert.equal(parseRootArgs([], { cwd: nested, env: {} }).repoRoot, repository);
    assert.equal(parseRootArgs(["--json", "--root", "../repository"], { cwd: nested, env: {} }).repoRoot, resolve(nested, "../repository"));
    assert.deepEqual(parseRootArgs(["--root=/tmp/example", "--json"], { cwd: nested, env: {} }).args, ["--json"]);
    assert.throws(() => parseRootArgs(["--root"], { cwd: nested, env: {} }), /requires a path/);
    assert.throws(() => parseRootArgs(["--root=a", "--root=b"], { cwd: nested, env: {} }), /only be provided once/);

    const locator = createRuntimeLocator(sourceRoot);
    assert.equal(locator.pluginRoot, sourceRoot);
    assert.equal(locator.entrypoints.cli, join(sourceRoot, "scripts", "pota.mjs"));
    assert.equal(locator.resources.templates, join(sourceRoot, "templates"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("CLI dispatch preserves goal and task root arguments", async () => {
  const calls = [];
  const runner = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };
  const previousExitCode = process.exitCode;
  try {
    await main("goal", ["status", "--root", "/tmp/project"], { runner });
    await main("task", ["complete", "task-1", "--root=/tmp/project"], { runner });
  } finally {
    process.exitCode = previousExitCode;
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[0].endsWith(join("scripts", "pota-goal.mjs")), true);
  assert.deepEqual(calls[0].args.slice(1), ["status", "--root", "/tmp/project"]);
  assert.deepEqual(calls[1].args.slice(1), ["task", "complete", "task-1", "--root=/tmp/project"]);
});

test("installed mirror rendering quotes executable paths without interpolation", () => {
  assert.equal(quoteShellArg("/tmp/Pota's files", "linux"), "'/tmp/Pota'\\''s files'");
  assert.equal(quoteShellArg("C:\\Program Files\\Pota", "win32"), '"C:\\Program Files\\Pota"');

  const rendered = renderInstalledMirror(
    "Run `node scripts/pota.mjs toolcheck` and read `docs/model-guidance/codex.md`.",
    { runtimeRoot: "/tmp/Pota's files", locatorPath: "/tmp/locator.json", platform: "linux" },
  );
  assert.match(rendered, /node '\/tmp\/Pota'\\''s files\/scripts\/pota\.mjs' toolcheck/);
  assert.match(rendered, /\/tmp\/Pota's files\/docs\/model-guidance\/codex\.md/);
  assertNoTargetRelativeRuntimeReferences(rendered, "rendered fixture");
});

test("installed mirrors resolve Pota resources through runtime locators", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pota installed "));
  const env = isolatedEnvironment(temp);
  const project = join(temp, "target project");
  const unrelatedCwd = join(temp, "unrelated cwd");
  const installedRoot = join(env.POTA_HOME, "install", "runtime", releaseVersion);
  const claudeLocatorPath = join(env.CLAUDE_HOME, "pota", "runtime.json");

  try {
    await mkdir(project, { recursive: true });
    await mkdir(unrelatedCwd, { recursive: true });
    await mkdir(dirname(env.CODEX_CONFIG_PATH), { recursive: true });
    await writeFile(env.CODEX_CONFIG_PATH, "[profiles.default]\nmodel = \"gpt-5\"\n");

    const install = runLifecycle("install", env);
    assert.equal(install.status, 0, install.stderr);

    const installedLocator = await readJson(join(installedRoot, ".pota-runtime.json"));
    assertRuntimeLocator(installedLocator, installedRoot);
    assertRuntimeLocator(await readJson(claudeLocatorPath), installedRoot);
    for (const skill of ["pota-memory", "pota-plan", "pota-work", "pota-review"]) {
      assertRuntimeLocator(await readJson(join(installedRoot, "skills", skill, "references", "pota-runtime.json")), installedRoot);
    }

    assertRuntimeLocator(await readJson(join(env.ANTIGRAVITY_HOME, "pota", "runtime.json")), installedRoot);
    assertRuntimeLocator(await readJson(join(env.ANTIGRAVITY_CLI_HOME, "pota", "runtime.json")), installedRoot);
    for (const skill of ["pota-memory", "pota-plan", "pota-work", "pota-review"]) {
      assertRuntimeLocator(await readJson(join(env.ANTIGRAVITY_HOME, "skills", skill, "references", "pota-runtime.json")), installedRoot);
      await stat(join(env.ANTIGRAVITY_CLI_HOME, "skills", `${skill}.md`));
    }

    const mirrorFiles = [
      ...(await markdownFiles(join(env.CLAUDE_HOME, "commands"))),
      ...(await markdownFiles(join(env.CLAUDE_HOME, "agents"))),
      ...(await markdownFiles(join(env.ANTIGRAVITY_HOME, "skills"))),
      ...(await markdownFiles(join(env.ANTIGRAVITY_HOME, "workflows"))),
      ...(await markdownFiles(join(env.ANTIGRAVITY_CLI_HOME, "skills"))),
      ...(await markdownFiles(join(env.ANTIGRAVITY_CLI_HOME, "workflows"))),
    ];
    for (const path of mirrorFiles) assertNoTargetRelativeRuntimeReferences(await readFile(path, "utf8"), path);

    const installedCli = join(installedRoot, "scripts", "pota.mjs");
    const cachedUpgrade = spawnSync(process.execPath, [installedCli, "upgrade"], { env, encoding: "utf8" });
    assert.equal(cachedUpgrade.status, 1);
    assert.match(cachedUpgrade.stderr, /package\/global source, not from the installed cache/);

    const init = spawnSync(process.execPath, [installedCli, "init", "--root", project], {
      cwd: unrelatedCwd,
      env,
      encoding: "utf8",
    });
    assert.equal(init.status, 0, init.stderr);
    await stat(join(project, "MEMORY.md"));
    await assert.rejects(stat(join(unrelatedCwd, "MEMORY.md")));

    const goal = spawnSync(process.execPath, [
      installedCli,
      "goal",
      "start",
      "--root", project,
      "--goal", "Installed runtime goal",
      "--plan", "docs/plan/installed.md",
      "--tasks", "Verify installed path",
      "--session", "installed-session",
    ], {
      cwd: unrelatedCwd,
      env,
      encoding: "utf8",
    });
    assert.equal(goal.status, 0, goal.stderr);
    const status = spawnSync(process.execPath, [installedCli, "goal", "status", "--root", project], {
      cwd: unrelatedCwd,
      env,
      encoding: "utf8",
    });
    assert.equal(status.status, 0, status.stderr);
    const goalState = JSON.parse(status.stdout);
    assert.equal(goalState.goal.title, "Installed runtime goal");
    assert.equal(goalState.goal.ownerSessionId, "installed-session");

    const doctor = runLifecycle("doctor", env);
    assert.equal(doctor.status, hostToolsAvailable() ? 0 : 1, doctor.stdout + doctor.stderr);
    if (hostToolsAvailable()) assert.doesNotMatch(doctor.stdout, /^FAIL/m);
    else assert.match(doctor.stdout, /^FAIL (?:Codex|Antigravity)/m);

    const staleLocator = { ...(await readJson(claudeLocatorPath)), pluginRoot: project };
    await writeFile(claudeLocatorPath, `${JSON.stringify(staleLocator, null, 2)}\n`);
    const staleDoctor = runLifecycle("doctor", env);
    assert.equal(staleDoctor.status, 1);
    assert.match(staleDoctor.stdout, /^FAIL Claude runtime locator$/m);

    await writeFile(claudeLocatorPath, `${JSON.stringify(installedLocator, null, 2)}\n`);
    await rm(join(installedRoot, "templates", "work-plan.md"));
    const missingDoctor = runLifecycle("doctor", env);
    assert.equal(missingDoctor.status, 1);
    assert.match(missingDoctor.stdout, /^FAIL installed plan template$/m);
    assert.match(missingDoctor.stdout, /^FAIL installed runtime locator$/m);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("install or upgrade from the canonical runtime, the Codex cache, or the Codex source is refused", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pota installed cache "));
  const env = isolatedEnvironment(temp);
  try {
    await mkdir(dirname(env.CODEX_CONFIG_PATH), { recursive: true });
    await writeFile(env.CODEX_CONFIG_PATH, "");
    const install = runLifecycle("install", env);
    assert.equal(install.status, 0, install.stderr);
    const ownershipPath = join(env.POTA_HOME, "install", "lifecycle.json");
    const ownership = await readFile(ownershipPath, "utf8");

    for (const installedRoot of [
      join(env.POTA_HOME, "install", "runtime", releaseVersion),
      join(env.CODEX_HOME, "plugins", "cache", "pota", "pota", releaseVersion),
      join(env.POTA_HOME, "install", "codex", "plugins", "pota"),
    ]) {
      for (const command of ["install", "upgrade"]) {
        const result = spawnSync(process.execPath, [join(installedRoot, "scripts", "pota.mjs"), command], { env, encoding: "utf8" });
        assert.equal(result.status, 1, `${installedRoot} ${command}\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /package\/global source, not from the installed cache/);
      }
    }
    assert.equal(await readFile(ownershipPath, "utf8"), ownership);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("SessionStart from an installed copy prints the canonical CLI path", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pota installed session "));
  const env = isolatedEnvironment(temp);
  const project = join(temp, "project");
  try {
    await mkdir(project, { recursive: true });
    await mkdir(dirname(env.CODEX_CONFIG_PATH), { recursive: true });
    await writeFile(env.CODEX_CONFIG_PATH, "");
    const install = runLifecycle("install", env);
    assert.equal(install.status, 0, install.stderr);
    const canonicalCli = join(env.POTA_HOME, "install", "runtime", releaseVersion, "scripts", "pota.mjs");
    // Codex runs hooks from its cache copy, which an upgrade can remove; the capsule points at the canonical runtime.
    for (const installedRoot of [
      join(env.CODEX_HOME, "plugins", "cache", "pota", "pota", releaseVersion),
      join(env.POTA_HOME, "install", "runtime", releaseVersion),
    ]) {
      const hook = spawnSync(process.execPath, [join(installedRoot, "scripts", "pota-state.mjs"), "session-start"], {
        cwd: project, env, encoding: "utf8", input: JSON.stringify({ cwd: project, session_id: "installed-session" }),
      });
      assert.equal(hook.status, 0, hook.stderr);
      const context = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
      assert.ok(context.includes(`Pota CLI: node ${JSON.stringify(canonicalCli)} goal <command>`), `${installedRoot}\n${context}`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

function isolatedEnvironment(temp) {
  return {
    ...process.env,
    POTA_HOME: join(temp, "Pota Home"),
    CODEX_HOME: join(temp, "Codex Home"),
    CLAUDE_HOME: join(temp, "Claude Home"),
    POTA_CLAUDE_CLI: fakeClaudeCli,
    ANTIGRAVITY_HOME: join(temp, "Antigravity Home"),
    ANTIGRAVITY_CLI_HOME: join(temp, "Antigravity CLI Home"),
    HOME: join(temp, "Home"),
    CODEX_CONFIG_PATH: join(temp, "Codex Home", "config.toml"),
  };
}

function runLifecycle(command, env) {
  return spawnSync(process.execPath, [lifecycleScript, command], {
    cwd: sourceRoot,
    env,
    encoding: "utf8",
  });
}

function hostToolsAvailable() {
  return commandAvailable("codex") && commandAvailable("agy");
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return result.error === undefined && result.status === 0;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertRuntimeLocator(locator, installedRoot) {
  assert.equal(locator.schemaVersion, 1);
  assert.equal(locator.plugin, "pota");
  assert.equal(locator.pluginRoot, installedRoot);
  assert.equal(locator.entrypoints.cli, join(installedRoot, "scripts", "pota.mjs"));
  assert.equal(locator.resources.modelGuidance, join(installedRoot, "docs", "model-guidance"));
}

async function markdownFiles(root) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".md")) output.push(path);
    }
  }
  await walk(root);
  return output;
}

function assertNoTargetRelativeRuntimeReferences(content, path) {
  assert.doesNotMatch(content, /{{POTA_RUNTIME_LOCATOR_JSON}}/, path);
  assert.doesNotMatch(content, /\bnode\s+scripts[\\/]/, path);
  assert.doesNotMatch(content, /(?:^|[\s`("'=])commands\/pota-[A-Za-z0-9._<>/-]+/m, path);
  assert.doesNotMatch(content, /(?:^|[\s`("'=])agents\/(?:explorer|worker)\.md/m, path);
  assert.doesNotMatch(content, /(?:^|[\s`("'=])templates\/[A-Za-z0-9._<>/-]+/m, path);
  assert.doesNotMatch(content, /(?:^|[\s`("'=])docs\/model-guidance\/[A-Za-z0-9._<>/-]+/m, path);
}
