import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { runtimeRequiredPaths, runtimeRequiredRelativePaths } from "../scripts/pota-paths.mjs";
import { targetDigest } from "../scripts/pota-lifecycle.mjs";

const fakeClaudeCli = resolve("test/fixtures/fake-claude.mjs");
const sourceRoot = resolve(".");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const lifecycleScript = join(sourceRoot, "scripts", "pota-lifecycle.mjs");
const releaseVersion = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")).version;

test("runtime locator includes extracted goal CLI dependency", () => {
  const closure = new Set(runtimeRequiredRelativePaths(sourceRoot));

  assert.equal(closure.has(join("scripts", "pota-goal-cli.mjs")), true);
  // The detached auto-upgrade runner is spawned by path, so it is an entrypoint of its own.
  assert.equal(closure.has(join("scripts", "pota-auto-upgrade.mjs")), true);
  assert.equal(closure.has(join("scripts", "pota-update-state.mjs")), true);
});

test("packed install remains self-contained after the npm package source is removed", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pota-packed-install-"));
  const packDirectory = join(temp, "pack");
  const npmCache = join(temp, "npm-cache");
  const prefix = join(temp, "npm-prefix");
  const project = join(temp, "target project");
  const nestedProject = join(project, "packages", "app");
  const unrelated = join(temp, "unrelated cwd");
  const env = {
    ...process.env,
    POTA_HOME: join(temp, "Pota Home"),
    CODEX_HOME: join(temp, "Codex Home"),
    CLAUDE_HOME: join(temp, "Claude Home"),
    POTA_CLAUDE_CLI: fakeClaudeCli,
    ANTIGRAVITY_HOME: join(temp, "Antigravity Home"),
    ANTIGRAVITY_CLI_HOME: join(temp, "Antigravity CLI Home"),
    HOME: join(temp, "Home"),
    CODEX_CONFIG_PATH: join(temp, "config.toml"),
    npm_config_cache: npmCache,
  };
  delete env.npm_config_dry_run;
  delete env.NPM_CONFIG_DRY_RUN;

  try {
    await stat(sourceRoot);
    await Promise.all([
      mkdir(packDirectory, { recursive: true }),
      mkdir(project, { recursive: true }),
      mkdir(join(project, ".git"), { recursive: true }),
      mkdir(nestedProject, { recursive: true }),
      mkdir(unrelated, { recursive: true }),
    ]);
    await writeFile(env.CODEX_CONFIG_PATH, "[profiles.default]\nmodel = \"gpt-5\"\n");

    const packed = run(npmCommand, ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], { cwd: sourceRoot, env });
    assert.equal(packed.status, 0, packed.stderr);
    const packReport = JSON.parse(packed.stdout);
    const packEntry = Array.isArray(packReport)
      ? packReport[0]
      : packReport.filename
        ? packReport
        : Object.values(packReport)[0];
    assert.equal(packEntry.name, "@comento/pota-harness");
    const tarball = join(packDirectory, packEntry.filename);
    await stat(tarball);

    const npmInstall = run(npmCommand, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", prefix, tarball], { cwd: temp, env });
    assert.equal(npmInstall.status, 0, npmInstall.stderr);
    const packageRoot = join(prefix, "node_modules", "@comento", "pota-harness");
    const packageCli = join(packageRoot, "scripts", "pota.mjs");
    const packageBin = join(prefix, "node_modules", ".bin", process.platform === "win32" ? "pota.cmd" : "pota");
    await stat(join(packageRoot, ".codex-plugin", "plugin.json"));
    await stat(packageBin);

    const lifecycleInstall = run(packageBin, ["install"], { cwd: unrelated, env });
    assert.equal(lifecycleInstall.status, 0, lifecycleInstall.stderr);

    const marketplaceSource = join(env.POTA_HOME, "install", "codex", "plugins", "pota");
    const installedRoot = join(env.POTA_HOME, "install", "runtime", releaseVersion);
    const installedCli = join(installedRoot, "scripts", "pota.mjs");
    await stat(join(marketplaceSource, ".codex-plugin", "plugin.json"));
    await stat(join(env.CODEX_HOME, "plugins", "cache", "pota", "pota", releaseVersion, "hooks", "hooks.json"));
    const ownership = JSON.parse(await readFile(join(env.POTA_HOME, "install", "lifecycle.json"), "utf8"));
    assert.equal(ownership.origin, "package", "an npm package source has no .git");
    const installedManifest = JSON.parse(await readFile(join(installedRoot, ".codex-plugin", "plugin.json"), "utf8"));
    assert.equal(installedManifest.hooks, "./hooks/hooks.json");
    const installedPrompt = installedManifest.interface.defaultPrompt.join("\n");
    assert.equal(installedManifest.interface.defaultPrompt.length, 7);
    assert.ok(installedPrompt.length <= 1600, `installed defaultPrompt is ${installedPrompt.length} characters; budget is 1600`);
    assert.match(installedPrompt, /MEMORY\.md.*phase skill.*active plan/is);
    assert.match(installedPrompt, /compaction, restart, handoff, or delegation/i);
    assert.match(installedPrompt, /missing MEMORY\.md never blocks work/i);
    assert.doesNotMatch(installedPrompt, /update_plan|create_goal|package lifecycle|--ignore-scripts/i);
    const installedPlanSkill = await readFile(join(installedRoot, "skills", "pota-plan", "SKILL.md"), "utf8");
    const installedWorkSkill = await readFile(join(installedRoot, "skills", "pota-work", "SKILL.md"), "utf8");
    assert.match(installedPlanSkill, /update_plan.*create_goal/is);
    assert.match(installedPlanSkill, /MEMORY\.md.*pota-plan.*active plan.*current-task references.*model guidance/is);
    assert.match(installedWorkSkill, /package lifecycle scripts/is);
    assert.match(installedWorkSkill, /content-producing.*never.*--ignore-scripts/is);
    assert.match(installedWorkSkill, /MEMORY\.md.*pota-work.*active plan.*current-task references.*model guidance/is);
    const installedLocator = JSON.parse(await readFile(join(installedRoot, ".pota-runtime.json"), "utf8"));
    assert.equal(installedLocator.pluginRoot, installedRoot);
    assert.equal(installedLocator.entrypoints.cli, installedCli);
    assert.equal(installedLocator.resources.modelGuidance, join(installedRoot, "docs", "model-guidance"));
    await rm(packageRoot, { recursive: true, force: true });
    await assertPackedLocatorRemovalMatrix({ installedRoot, installedLocator, env, temp, unrelated });

    const init = run(process.execPath, [installedCli, "init", "--root", project], { cwd: unrelated, env });
    assert.equal(init.status, 0, init.stderr);
    await stat(join(project, "MEMORY.md"));
    await stat(join(project, "PLAN.md"));
    await assert.rejects(stat(join(project, "scripts")));
    await assert.rejects(stat(join(project, "templates")));
    await assert.rejects(stat(join(project, "docs", "model-guidance")));

    const promptHook = run(process.execPath, [join(installedRoot, "scripts", "pota-state.mjs"), "user-prompt-submit"], {
      cwd: unrelated,
      env,
      input: JSON.stringify({
        cwd: nestedProject,
        session_id: "packed-session",
        turn_id: "packed-turn",
        prompt: "Implement the requested fix",
      }),
    });
    assert.equal(promptHook.status, 0, promptHook.stderr);
    const promptHookOutput = JSON.parse(promptHook.stdout);
    assert.equal(promptHookOutput.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(promptHookOutput.hookSpecificOutput.additionalContext, /^Pota kernel: root MEMORY\.md is optional/);
    assert.match(promptHookOutput.hookSpecificOutput.additionalContext, /non-trivial implementation.*load pota-plan/i);
    assert.match(promptHookOutput.hookSpecificOutput.additionalContext, /restore\/create its plan and task/i);
    assert.match(promptHookOutput.hookSpecificOutput.additionalContext, /stop only if active state.*missing, unreadable, or inconsistent/i);

    const goal = run(process.execPath, [
      installedCli,
      "goal", "start",
      "--root", project,
      "--goal", "Packed install goal",
      "--plan", "docs/plan/packed.md",
      "--tasks", JSON.stringify([
        { id: "packed-current", title: "Packed task" },
        { id: "packed-next", title: "Verify packed roadmap" },
      ]),
      "--session", "packed-session",
    ], { cwd: unrelated, env });
    assert.equal(goal.status, 0, goal.stderr);

    const activePromptHook = run(process.execPath, [join(installedRoot, "scripts", "pota-state.mjs"), "user-prompt-submit"], {
      cwd: unrelated,
      env,
      input: JSON.stringify({ cwd: nestedProject, session_id: "packed-session", turn_id: "packed-turn-2", prompt: "What is the status?" }),
    });
    assert.equal(activePromptHook.status, 0, activePromptHook.stderr);
    const activePromptOutput = JSON.parse(activePromptHook.stdout);
    assert.match(activePromptOutput.hookSpecificOutput.additionalContext, /^Pota kernel: root MEMORY\.md is optional/);
    assert.match(activePromptOutput.hookSpecificOutput.additionalContext, /load pota-work/i);
    assert.match(activePromptOutput.hookSpecificOutput.additionalContext, /docs\/plan\/packed\.md/);
    assert.match(activePromptOutput.hookSpecificOutput.additionalContext, /1\. packed-current \[active\] Packed task/);
    assert.match(activePromptOutput.hookSpecificOutput.additionalContext, /2\. packed-next \[pending\] Verify packed roadmap/);
    assert.match(activePromptOutput.hookSpecificOutput.additionalContext, /resume packed-current/);
    assert.match(activePromptOutput.hookSpecificOutput.additionalContext, /stop only if active state.*missing, unreadable, or inconsistent/i);

    const hook = run(process.execPath, [join(installedRoot, "scripts", "pota-state.mjs"), "stop"], {
      cwd: unrelated,
      env,
      input: JSON.stringify({ cwd: nestedProject, session_id: "packed-session", turn_id: "packed-turn" }),
    });
    assert.equal(hook.status, 0, hook.stderr);
    const hookOutput = JSON.parse(hook.stdout);
    assert.equal(hookOutput.decision, "block");
    assert.match(hookOutput.reason, /Packed task/);

    const toolcheck = run(process.execPath, [installedCli, "toolcheck", "--json", "--root", project], { cwd: unrelated, env });
    assert.equal(toolcheck.status, 0, toolcheck.stderr);
    const report = JSON.parse(toolcheck.stdout);
    assert.equal(report.root, project);
    assert.deepEqual(report.detected, []);

    const status = run(process.execPath, [installedCli, "goal", "status", "--root", project], { cwd: unrelated, env });
    assert.equal(status.status, 0, status.stderr);
    const state = JSON.parse(status.stdout);
    assert.equal(state.goal.ownerSessionId, "packed-session");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

async function assertPackedLocatorRemovalMatrix({ installedRoot, installedLocator, env, temp, unrelated }) {
  const executableClosure = runtimeRequiredRelativePaths(installedRoot);
  const required = runtimeRequiredPaths(installedLocator).map((path) => relative(installedRoot, path));
  for (const path of executableClosure) assert.equal(required.includes(path), true, `runtime locator closure includes ${path}`);

  const ownershipPath = join(env.POTA_HOME, "install", "lifecycle.json");
  const originalOwnership = await readFile(ownershipPath, "utf8");
  const quarantineRoot = join(temp, "locator-removal-matrix");
  for (const [index, relativePath] of required.entries()) {
    const requiredPath = join(installedRoot, relativePath);
    const quarantine = join(quarantineRoot, String(index));
    await mkdir(dirname(quarantine), { recursive: true });
    await rename(requiredPath, quarantine);
    try {
      const ownership = JSON.parse(originalOwnership);
      ownership.targets.find((record) => record.id === "runtime").installedDigest = await targetDigest(installedRoot, "tree");
      await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);

      const doctor = run(process.execPath, [lifecycleScript, "doctor"], { cwd: unrelated, env });
      assert.match(doctor.stdout, /^OK ownership digests$/m, `${relativePath}\n${doctor.stdout}\n${doctor.stderr}`);
      assert.match(doctor.stdout, /^FAIL installed runtime locator$/m, `${relativePath}\n${doctor.stdout}\n${doctor.stderr}`);
    } finally {
      await rename(quarantine, requiredPath);
      await writeFile(ownershipPath, originalOwnership);
    }
  }
}

function run(command, args, { cwd, env, input } = {}) {
  return spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
    timeout: 60_000,
  });
}
