import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const rootCli = resolve("scripts", "pota.mjs");
const toolcheckCli = resolve("scripts", "pota-toolcheck.mjs");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const usage = "Usage: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task\n";
const toolcheckUsage = "Usage: pota toolcheck [--root PATH] [--json] [--install --yes]\n";

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? resolve("."),
    encoding: "utf8",
    env: options.env ?? process.env,
    timeout: 5_000,
  });
}

function assertExit(result, expected) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, expected.status);
  assert.equal(result.stdout, expected.stdout);
  assert.equal(result.stderr, expected.stderr);
}

test("root help and version exit successfully without dispatching work", () => {
  assertExit(run(rootCli, ["--help"]), { status: 0, stdout: usage, stderr: "" });
  assertExit(run(rootCli, ["help"]), { status: 0, stdout: usage, stderr: "" });
  assertExit(run(rootCli, ["--version"]), { status: 0, stdout: `pota ${version}\n`, stderr: "" });
  assertExit(run(rootCli, ["version"]), { status: 0, stdout: `pota ${version}\n`, stderr: "" });
});

test("root rejects unknown commands and reports parser failures without stack traces", () => {
  assertExit(run(rootCli, ["unknown"]), { status: 2, stdout: "", stderr: "Pota error: unknown command: unknown\n" });

  for (const [args, message] of [
    [["init", "--root"], "--root requires a path"],
    [["init", "--root", ".", "--root=elsewhere"], "--root may only be provided once"],
  ]) {
    const result = run(rootCli, args);
    assertExit(result, { status: 2, stdout: "", stderr: `Pota error: ${message}\n` });
    assert.doesNotMatch(result.stderr, /\n\s+at |file:\/\/|Node\.js v/);
  }
});

test("toolcheck help and version exit successfully without running checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pota-cli-help-"));
  try {
    await writeFile(join(root, "package.json"), "{}\n");
    const env = { ...process.env, PATH: "" };

    assertExit(run(toolcheckCli, ["--help", "--root", root], { env }), { status: 0, stdout: toolcheckUsage, stderr: "" });
    assertExit(run(toolcheckCli, ["--version", "--root", root], { env }), { status: 0, stdout: `pota ${version}\n`, stderr: "" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("toolcheck rejects unknown, duplicate, and missing-value options", () => {
  for (const [args, message] of [
    [["--unknown"], "unknown option: --unknown"],
    [["unexpected"], "unknown option: unexpected"],
    [["--install", "--install"], "--install may only be provided once"],
    [["--root=one", "--root", "two"], "--root may only be provided once"],
    [["--root"], "--root requires a path"],
    [["--root="], "--root requires a path"],
  ]) {
    assertExit(run(toolcheckCli, args), { status: 2, stdout: "", stderr: `Pota toolcheck error: ${message}\n` });
  }
});

test("toolcheck emits a stable JSON usage error when JSON was requested", () => {
  const expected = `${JSON.stringify({
    schemaVersion: 1,
    error: {
      code: "CLI_USAGE",
      message: "unknown option: --unknown",
    },
  }, null, 2)}\n`;

  assertExit(run(toolcheckCli, ["--json", "--unknown"]), { status: 2, stdout: expected, stderr: "" });
});

test("toolcheck successful JSON report shape remains unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pota-cli-json-"));
  try {
    const result = run(toolcheckCli, ["--json", "--root", root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      root,
      timeoutMs: 10_000,
      detected: [],
      install: {
        requested: false,
        confirmed: false,
        refused: false,
        refusalReason: null,
      },
      results: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("goal and task status expose the same stable no-state contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "pota-cli-no-state-"));
  const stateHome = await mkdtemp(join(tmpdir(), "pota-cli-no-state-home-"));
  try {
    const env = { ...process.env, POTA_HOME: stateHome };
    assertExit(run(rootCli, ["goal", "status", "--root", root], { env }), {
      status: 0,
      stdout: "null\n",
      stderr: "",
    });
    assertExit(run(rootCli, ["task", "status", "--root", root], { env }), {
      status: 0,
      stdout: "null\n",
      stderr: "",
    });
    assertExit(run(rootCli, ["task", "status", "--quiet", "--root", root], { env }), {
      status: 0,
      stdout: "null\n",
      stderr: "",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("task status returns the active task or a requested task", async () => {
  const root = await mkdtemp(join(tmpdir(), "pota-cli-task-status-"));
  const stateHome = await mkdtemp(join(tmpdir(), "pota-cli-task-status-home-"));
  try {
    const env = { ...process.env, POTA_HOME: stateHome };
    const started = run(rootCli, [
      "goal", "start",
      "--root", root,
      "--goal", "status contract",
      "--plan", "plan-status",
      "--tasks", JSON.stringify([{ id: "first", title: "First" }, { id: "second", title: "Second" }]),
      "--criteria", "status visible",
      "--requiredEvidence", "test",
    ], { env });
    assert.equal(started.status, 0, started.stderr);

    const current = run(rootCli, ["task", "status", "--root", root], { env });
    assert.equal(current.status, 0, current.stderr);
    assert.equal(JSON.parse(current.stdout).id, "first");
    const quietCurrent = run(rootCli, ["task", "status", "--quiet", "--root", root], { env });
    assert.equal(quietCurrent.status, 0, quietCurrent.stderr);
    assert.equal(JSON.parse(quietCurrent.stdout).id, "first");

    const requested = run(rootCli, ["task", "status", "second", "--root", root], { env });
    assert.equal(requested.status, 0, requested.stderr);
    assert.equal(JSON.parse(requested.stdout).id, "second");
    const quietRequested = run(rootCli, ["task", "status", "second", "--quiet", "--root", root], { env });
    assert.equal(quietRequested.status, 0, quietRequested.stderr);
    assert.equal(JSON.parse(quietRequested.stdout).id, "second");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
});

const initUsage = "Usage: pota init [--root PATH]\n";
const goalUsage = [
  "Usage: pota goal <start|status|ready|stats|task|replan|claim|assign|receipt|verify|finish|pause|resume|block|cancel|complete> [options] [--root PATH]",
  "Note: --criteria (completionCriteria) is advisory and is not enforced; completion is gated only by required evidence.",
  "",
].join("\n");

async function withIsolatedCli(operation) {
  const sandbox = await mkdtemp(join(tmpdir(), "pota-cli-contract-"));
  try {
    const root = join(sandbox, "repo");
    const home = join(sandbox, "home");
    const stateHome = join(sandbox, "pota-home");
    await Promise.all([mkdir(root), mkdir(home), mkdir(stateHome)]);
    const env = { ...process.env, LC_ALL: "en_US.UTF-8", HOME: home, POTA_HOME: stateHome };
    await operation({ root, home, stateHome, env });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

async function listTree(directory) {
  return (await readdir(directory, { recursive: true })).sort();
}

test("init --help and --version exit 0 and create no files", async () => {
  await withIsolatedCli(async ({ root, home, stateHome, env }) => {
    assertExit(run(rootCli, ["init", "--help", "--root", root], { env }), { status: 0, stdout: initUsage, stderr: "" });
    assertExit(run(rootCli, ["init", "--root", root, "--version"], { env }), { status: 0, stdout: `pota ${version}\n`, stderr: "" });
    assert.deepEqual(await listTree(root), []);
    assert.deepEqual(await listTree(home), []);
    assert.deepEqual(await listTree(stateHome), []);
  });
});

test("init rejects unknown options with exit 2 and creates no files", async () => {
  await withIsolatedCli(async ({ root, home, stateHome, env }) => {
    for (const [args, message] of [
      [["init", "--root", root, "--bogus"], "unknown option: --bogus"],
      [["init", "--root", root, "extra"], "unknown option: extra"],
      [["init", "--root", root, "--help", "--yes"], "unknown option: --yes"],
      [["init", "--root", root, "--help", "--version"], "--help and --version cannot be used together"],
    ]) {
      const result = run(rootCli, args, { env });
      assertExit(result, { status: 2, stdout: "", stderr: `Pota error: ${message}\n` });
    }
    assert.deepEqual(await listTree(root), []);
    assert.deepEqual(await listTree(home), []);
    assert.deepEqual(await listTree(stateHome), []);
  });
});

test("lifecycle commands accept only --hosts and --allow-downgrade on install and upgrade and keep the documented --help exception", async () => {
  await withIsolatedCli(async ({ root, home, stateHome, env }) => {
    const lifecycleEnv = {
      ...env,
      CODEX_HOME: join(home, ".codex"),
      CLAUDE_HOME: join(home, ".claude"),
      ANTIGRAVITY_HOME: join(home, ".gemini", "config"),
      ANTIGRAVITY_CLI_HOME: join(home, ".gemini", "antigravity-cli"),
      CODEX_CONFIG_PATH: join(home, ".codex", "config.toml"),
      POTA_CLAUDE_CLI: "none",
    };
    for (const [args, message] of [
      [["install", "--help"], "Lifecycle command install does not accept arguments: --help"],
      [["upgrade", "--hosts", "all", "--help"], "Lifecycle command upgrade does not accept arguments: --help"],
      [["doctor", "--hosts", "all"], "Lifecycle command doctor does not accept arguments: --hosts all"],
      [["uninstall", "--hosts=claude"], "Lifecycle command uninstall does not accept arguments: --hosts=claude"],
      [["install", "--hosts"], "Invalid --hosts value: missing"],
      [["install", "--hosts="], "Invalid --hosts value: empty"],
      [["upgrade", "--hosts", "gemini"], "Invalid --hosts value: gemini (unknown host gemini; use all or codex,claude,antigravity)"],
      [["install", "--hosts", "claude,claude"], "Invalid --hosts value: claude,claude (duplicate host claude)"],
      [["doctor", "--allow-downgrade"], "Lifecycle command doctor does not accept arguments: --allow-downgrade"],
      [["uninstall", "--allow-downgrade"], "Lifecycle command uninstall does not accept arguments: --allow-downgrade"],
      [["install", "--allow-downgrade", "--allow-downgrade"], "Lifecycle command install does not accept arguments: --allow-downgrade"],
      [["upgrade", "--auto", "--allow-downgrade"], "--auto cannot be combined with --allow-downgrade"],
    ]) {
      assertExit(run(rootCli, args, { env: lifecycleEnv }), { status: 1, stdout: "", stderr: `Pota lifecycle error: ${message}\n` });
    }
    assertExit(run(resolve("scripts", "pota-lifecycle.mjs"), [], { env: lifecycleEnv }), {
      status: 0,
      stdout: "Usage: pota install|upgrade [--hosts all|codex,claude,antigravity] [--allow-downgrade] | doctor | uninstall | toolcheck\n",
      stderr: "",
    });
    assert.deepEqual(await listTree(root), []);
    assert.deepEqual(await listTree(home), []);
    assert.deepEqual(await listTree(stateHome), []);
  });
});

test("goal and task --help print usage with the advisory criteria notice and exit 0 without reading state", async () => {
  await withIsolatedCli(async ({ root, stateHome, env }) => {
    // A fresh Pota home stays empty: help creates no state.
    for (const args of [
      ["goal", "--help"],
      ["goal", "start", "--help", "--root", root],
      ["goal", "start", "--goal", "--help"],
      ["task", "--help"],
      ["task", "complete", "first", "--help", "--root", root],
    ]) {
      assertExit(run(rootCli, args, { env }), { status: 0, stdout: goalUsage, stderr: "" });
    }
    assert.deepEqual(await listTree(stateHome), []);
    assert.deepEqual(await listTree(root), []);

    // A corrupted state file would fail any read; help never touches it.
    const started = run(rootCli, ["goal", "start", "--quiet", "--root", root, "--goal", "help contract", "--plan", "plan-help", "--tasks", "Only task"], { env });
    assert.equal(started.status, 0, started.stderr);
    const statePath = (await listTree(stateHome)).find((path) => path.endsWith("state.json"));
    assert.ok(statePath, "goal start must persist a state file");
    await writeFile(join(stateHome, statePath), "{corrupt\n");
    assert.equal(run(rootCli, ["goal", "status", "--root", root], { env }).status, 1);
    const treeBefore = await listTree(stateHome);
    for (const args of [
      ["goal", "status", "--help", "--root", root],
      ["goal", "complete", "--root", root, "--help"],
      ["task", "status", "--help", "--root", root],
    ]) {
      assertExit(run(rootCli, args, { env }), { status: 0, stdout: goalUsage, stderr: "" });
    }
    assert.equal(await readFile(join(stateHome, statePath), "utf8"), "{corrupt\n");
    assert.deepEqual(await listTree(stateHome), treeBefore);
  });
});

test("goal --version prints the package version", async () => {
  await withIsolatedCli(async ({ root, stateHome, env }) => {
    assertExit(run(rootCli, ["goal", "--version"], { env }), { status: 0, stdout: `pota ${version}\n`, stderr: "" });
    assertExit(run(rootCli, ["task", "status", "--version", "--root", root], { env }), { status: 0, stdout: `pota ${version}\n`, stderr: "" });
    assertExit(run(rootCli, ["goal", "--help", "--version"], { env }), {
      status: 1,
      stdout: "",
      stderr: "Pota goal error: --help and --version cannot be used together\n",
    });
    assert.deepEqual(await listTree(stateHome), []);
  });
});

test("bare goal prints usage and exits 0", async () => {
  await withIsolatedCli(async ({ root, stateHome, env }) => {
    assertExit(run(rootCli, ["goal"], { env, cwd: root }), { status: 0, stdout: goalUsage, stderr: "" });
    assertExit(run(rootCli, ["goal", "help"], { env, cwd: root }), { status: 0, stdout: goalUsage, stderr: "" });
    assertExit(run(rootCli, ["goal", "help", "--root", root], { env }), { status: 0, stdout: goalUsage, stderr: "" });
    assert.deepEqual(await listTree(stateHome), []);
  });
});

test("--help after -- is passed through to goal verify", async () => {
  await withIsolatedCli(async ({ root, env }) => {
    const probe = join(root, "probe.mjs");
    await writeFile(probe, "process.exit(process.argv.slice(2).join(' ') === '--help' ? 0 : 7);\n");
    const started = run(rootCli, ["goal", "start", "--quiet", "--root", root, "--goal", "passthrough", "--plan", "plan-passthrough", "--tasks", "Only task"], { env });
    assert.equal(started.status, 0, started.stderr);
    const taskId = JSON.parse(run(rootCli, ["task", "status", "--root", root], { env }).stdout).id;

    const result = run(rootCli, ["goal", "verify", "--root", root, "--task", taskId, "--kind", "test", "--", process.execPath, probe, "--help"], { env });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).exitCode, 0);
  });
});

test("unknown goal subcommands exit 1 with a one-line error", async () => {
  await withIsolatedCli(async ({ root, stateHome, env }) => {
    assertExit(run(rootCli, ["goal", "bogus", "--root", root], { env }), {
      status: 1,
      stdout: "",
      stderr: "Pota goal error: unknown goal command: bogus (run pota goal --help)\n",
    });
    assertExit(run(rootCli, ["goal", "bogus", "--unknown-flag", "--root", root], { env }), {
      status: 1,
      stdout: "",
      stderr: "Pota goal error: unknown goal command: bogus (run pota goal --help)\n",
    });
    assert.deepEqual(await listTree(stateHome), []);
  });
});
