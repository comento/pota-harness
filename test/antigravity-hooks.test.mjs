import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { recordReceipt, startGoal } from "../scripts/pota-goal.mjs";
import {
  PENDING_MAX,
  claudeToolCall,
  contextText,
  injectStepsOutput,
  runAntigravityHook,
  sessionFileName,
  statePayload,
  stopOutput,
} from "../scripts/pota-state-antigravity.mjs";
import { runLegacyRemoval } from "../scripts/pota-legacy-migration.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import { createLegacyInstall } from "./support/legacy-install.mjs";

const adapter = resolve("scripts/pota-state-antigravity.mjs");
const conversationId = "agy-conversation-1";

test("camelCase input maps to the Claude payload and session-start passes the host options", async () => {
  await withWorkspace(async ({ repo, env }) => {
    const input = {
      conversationId,
      workspacePaths: [repo, "/elsewhere"],
      modelName: "gemini-3-pro",
      transcriptPath: "/tmp/transcript.jsonl",
      lastUserInput: "Fix the bug",
    };
    assert.deepEqual(statePayload(input), {
      session_id: conversationId,
      cwd: repo,
      model: "gemini-3-pro",
      transcript_path: "/tmp/transcript.jsonl",
      prompt: "Fix the bug",
    });
    assert.deepEqual(statePayload({ workspacePaths: [], conversationId: "" }), {});

    const calls = [];
    const run = async (event, options) => {
      calls.push({ event, options });
      return { status: 0, message: "", hookOutput: { hookSpecificOutput: { additionalContext: "capsule" } } };
    };
    const output = await runAntigravityHook("session-start", input, { env, run });
    assert.deepEqual(output, { injectSteps: [{ systemMessage: { systemMessage: "capsule" } }] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event, "session-start");
    assert.equal(calls[0].options.host, "antigravity");
    assert.deepEqual(calls[0].options.commentChecker, { autoFetch: true });
    assert.deepEqual(calls[0].options.payload, statePayload(input));
  });
});

test("session-start injects the capsule as one systemMessage step", async () => {
  await withWorkspace(async ({ repo, env }) => {
    const { status, output } = runHook(env, "session-start", { conversationId, workspacePaths: [repo] });
    assert.equal(status, 0);
    assert.deepEqual(Object.keys(output), ["injectSteps"]);
    assert.equal(output.injectSteps.length, 1);
    assert.deepEqual(Object.keys(output.injectSteps[0]), ["systemMessage"]);
    assert.deepEqual(Object.keys(output.injectSteps[0].systemMessage), ["systemMessage"]);
    const text = output.injectSteps[0].systemMessage.systemMessage;
    assert.match(text, /^Pota kernel: root MEMORY\.md is optional/);
    assert.match(text, /\nPota CLI: node ".*pota\.mjs" goal <command>/);
  });
});

test("pre-invocation builds the prompt capsule only for invocationNum 0", async () => {
  await withWorkspace(async ({ repo, env }) => {
    const base = { conversationId, workspacePaths: [repo], lastUserInput: "Implement the fix" };
    const first = runHook(env, "pre-invocation", { ...base, invocationNum: 0 });
    assert.equal(first.status, 0);
    const text = first.output.injectSteps[0].systemMessage.systemMessage;
    assert.match(text, /^Pota kernel: root MEMORY\.md is optional/);
    assert.match(text, /non-trivial implementation.*load pota-plan/i);
    assert.doesNotMatch(text, /Pota CLI:/);

    for (const invocationNum of [1, 5]) {
      const later = runHook(env, "pre-invocation", { ...base, invocationNum });
      assert.equal(later.status, 0);
      assert.deepEqual(later.output, {});
    }
    assert.deepEqual(runHook(env, "pre-invocation", base).output, {}, "a missing invocationNum is not the first call");
    assert.equal(await sessionFiles(env), null, "no session file without pending or a stop block");
  });
});

test("post-tool-use always prints {} and its reminder is injected exactly once", async () => {
  await withWorkspace(async ({ repo, env }) => {
    await startTwoTaskGoal(repo);
    const toolCall = { name: "write_to_file", args: { TargetFile: join(repo, "a.txt"), CodeContent: "a\n" } };
    const post = runHook(env, "post-tool-use", { conversationId, workspacePaths: [repo], toolCall });
    assert.equal(post.status, 0);
    assert.deepEqual(post.output, {});
    const record = JSON.parse(await readFile(sessionPath(env), "utf8"));
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.stopBlockedFor, null);
    assert.equal(record.pending.length, 1);
    assert.match(record.pending[0], /^Pota check: external-state changes need dry-run\/check evidence/);

    const repeat = runHook(env, "post-tool-use", { conversationId, workspacePaths: [repo], toolCall });
    assert.deepEqual(repeat.output, {});
    assert.equal(JSON.parse(await readFile(sessionPath(env), "utf8")).pending.length, 1, "the reminder guard still dedupes");

    const emitted = runHook(env, "pre-invocation", { conversationId, workspacePaths: [repo], invocationNum: 2 });
    assert.deepEqual(emitted.output, { injectSteps: [{ systemMessage: { systemMessage: record.pending[0] } }] });
    assert.deepEqual(runHook(env, "pre-invocation", { conversationId, workspacePaths: [repo], invocationNum: 3 }).output, {});
    assert.equal(await sessionFiles(env), 0, "an emptied session file is removed");

    await recordReceipt({ root: repo, taskId: "first", kind: "moduleAcceptance", command: "check first", exitCode: 0 });
    await writeFile(sessionPath(env), `${JSON.stringify({ schemaVersion: 1, pending: ["Queued note."], stopBlockedFor: null })}\n`);
    const withCapsule = runHook(env, "pre-invocation", { conversationId, workspacePaths: [repo], invocationNum: 0, lastUserInput: "Next" });
    const text = withCapsule.output.injectSteps[0].systemMessage.systemMessage;
    assert.match(text, /^Pota kernel:/);
    assert.ok(text.endsWith("\nQueued note."), "pending text follows the capsule");
    assert.equal(withCapsule.output.injectSteps.length, 1);
  });
});

test("post-tool-use keeps at most eight pending messages", async () => {
  await withWorkspace(async ({ repo, env }) => {
    let count = 0;
    const run = async () => ({ status: 0, message: "", hookOutput: { decision: "block", reason: `finding ${++count}` } });
    const toolCall = { name: "replace_file_content", args: { TargetFile: "b.txt", TargetContent: "x", ReplacementContent: "y" } };
    for (let index = 0; index < PENDING_MAX + 2; index += 1) {
      assert.deepEqual(await runAntigravityHook("post-tool-use", { conversationId, workspacePaths: [repo], toolCall }, { env, run }), {});
    }
    const record = JSON.parse(await readFile(sessionPath(env), "utf8"));
    assert.deepEqual(record.pending, Array.from({ length: PENDING_MAX }, (_, index) => `finding ${index + 3}`));
  });
});

test("the three Antigravity edit tools convert to Write, Edit, and MultiEdit", async () => {
  assert.deepEqual(claudeToolCall({ name: "write_to_file", args: { TargetFile: "/w/a.js", CodeContent: "let a;\n" } }), {
    tool_name: "Write",
    tool_input: { file_path: "/w/a.js", content: "let a;\n" },
  });
  assert.deepEqual(claudeToolCall({
    name: "replace_file_content",
    args: { TargetFile: "/w/b.js", TargetContent: "old", ReplacementContent: "new" },
  }), { tool_name: "Edit", tool_input: { file_path: "/w/b.js", old_string: "old", new_string: "new" } });
  assert.deepEqual(claudeToolCall({
    name: "multi_replace_file_content",
    args: JSON.stringify({
      TargetFile: "/w/c.js",
      ReplacementChunks: [
        { TargetContent: "one", ReplacementContent: "1", StartLine: 1 },
        { TargetContent: "two", ReplacementContent: "2" },
      ],
    }),
  }), {
    tool_name: "MultiEdit",
    tool_input: { file_path: "/w/c.js", edits: [{ old_string: "one", new_string: "1" }, { old_string: "two", new_string: "2" }] },
  });
  assert.equal(claudeToolCall({ name: "run_command", args: { CommandLine: "ls" } }), null);
  assert.equal(claudeToolCall({ name: "write_to_file", args: { CodeContent: "no target" } }), null);
  assert.equal(claudeToolCall({ name: "write_to_file", args: "not json" }), null);

  await withWorkspace(async ({ repo, env }) => {
    const calls = [];
    const run = async (event, options) => {
      calls.push({ event, payload: options.payload });
      return { status: 0, message: "", hookOutput: {} };
    };
    const toolCall = { name: "replace_file_content", args: { TargetFile: "src/x.js", TargetContent: "a", ReplacementContent: "b" } };
    await runAntigravityHook("post-tool-use", { conversationId, workspacePaths: [repo], toolCall }, { env, run });
    assert.deepEqual(calls, [{
      event: "post-tool-use",
      payload: {
        session_id: conversationId,
        cwd: repo,
        tool_name: "Edit",
        tool_input: { file_path: "src/x.js", old_string: "a", new_string: "b" },
      },
    }]);
    await runAntigravityHook("post-tool-use", { conversationId, workspacePaths: [repo], toolCall: { name: "view_file", args: {} } }, { env, run });
    assert.equal(calls.length, 1, "other tools never reach the state hook");
    assert.equal(await sessionFiles(env), null);
  });
});

test("Stop blocks only on model_stop and records the blocked prompt", async () => {
  await withWorkspace(async ({ repo, env }) => {
    const base = { conversationId, workspacePaths: [repo], lastUserInput: "Finish the goal" };
    assert.deepEqual(runHook(env, "stop", { ...base, terminationReason: "model_stop" }).output, {}, "no goal allows the stop");

    await startTwoTaskGoal(repo);
    for (const terminationReason of ["user_cancel", "error", undefined]) {
      const skipped = runHook(env, "stop", { ...base, terminationReason });
      assert.equal(skipped.status, 0);
      assert.deepEqual(skipped.output, {});
    }
    assert.equal(await sessionFiles(env), null, "a skipped stop writes nothing");

    const blocked = runHook(env, "stop", { ...base, terminationReason: "model_stop" });
    assert.deepEqual(Object.keys(blocked.output).sort(), ["decision", "reason"]);
    assert.equal(blocked.output.decision, "continue");
    assert.match(blocked.output.reason, /first/);
    const record = JSON.parse(await readFile(sessionPath(env), "utf8"));
    assert.equal(record.stopBlockedFor, sha256("Finish the goal"));
    assert.deepEqual(record.pending, []);

    const continued = runHook(env, "stop", { ...base, terminationReason: "model_stop", continuation_active: true });
    assert.deepEqual(continued.output, {}, "continuation_active without progress allows the stop");
    const fresh = runHook(env, "stop", { ...base, terminationReason: "model_stop", continuation_active: false });
    assert.equal(fresh.output.decision, "continue", "continuation_active false overrides the recorded hash");

    assert.deepEqual(stopOutput({ hookOutput: { continue: true, systemMessage: "loop guard" } }), {});
    assert.deepEqual(stopOutput({ hookOutput: { decision: "block", reason: "r" } }), { decision: "continue", reason: "r" });
  });
});

test("without continuation_active the recorded prompt hash stops a no-progress loop", async () => {
  await withWorkspace(async ({ repo, env }) => {
    await startTwoTaskGoal(repo);
    const input = { conversationId, workspacePaths: [repo], lastUserInput: "Keep going", terminationReason: "model_stop" };
    assert.equal(runHook(env, "stop", input).output.decision, "continue");
    assert.deepEqual(runHook(env, "stop", input).output, {}, "the same prompt without progress is allowed to stop");

    await recordReceipt({ root: repo, taskId: "first", kind: "moduleAcceptance", command: "check first", exitCode: 0 });
    assert.equal(runHook(env, "stop", input).output.decision, "continue", "progress keeps driving the goal");
    assert.deepEqual(runHook(env, "stop", input).output, {});

    const next = runHook(env, "stop", { ...input, lastUserInput: "A new prompt" });
    assert.equal(next.output.decision, "continue", "a new user prompt is a new turn");
    assert.equal(JSON.parse(await readFile(sessionPath(env), "utf8")).stopBlockedFor, sha256("A new prompt"));
  });
});

test("malformed stdin, unknown events, and hook failures print {} and exit 0", async () => {
  await withWorkspace(async ({ repo, env }) => {
    for (const event of ["session-start", "pre-invocation", "post-tool-use", "stop"]) {
      for (const stdin of ["{not json", "", "null"]) {
        const result = runHook(env, event, stdin);
        assert.equal(result.status, 0, `${event} ${JSON.stringify(stdin)}`);
        assert.equal(result.stdout, "{}\n");
      }
    }
    const unknown = runHook(env, "subagent-stop", { conversationId, workspacePaths: [repo] });
    assert.equal(unknown.stdout, "{}\n");
    const missing = runHook(env, undefined, { conversationId, workspacePaths: [repo] });
    assert.equal(missing.stdout, "{}\n");

    const failing = async () => { throw new Error("boom"); };
    for (const event of ["session-start", "pre-invocation", "post-tool-use", "stop"]) {
      const input = {
        conversationId, workspacePaths: [repo], invocationNum: 0, terminationReason: "model_stop",
        toolCall: { name: "write_to_file", args: { TargetFile: "a", CodeContent: "" } },
      };
      assert.deepEqual(await runAntigravityHook(event, input, { env, run: failing }), {});
    }
  });
});

test("injected text keeps the prompt capsule budgets and folds in user notices once", async () => {
  await withWorkspace(async ({ repo, env }) => {
    const idle = runHook(env, "pre-invocation", { conversationId, workspacePaths: [repo], invocationNum: 0, lastUserInput: "Go" });
    const idleText = idle.output.injectSteps[0].systemMessage.systemMessage;
    assert.ok(idleText.length <= 620, `idle capsule is ${idleText.length} characters; budget is 620`);

    await startGoal({
      root: repo,
      goal: "G".repeat(600),
      planId: "p".repeat(96),
      ownerSessionId: conversationId,
      tasks: Array.from({ length: 20 }, (_, index) => ({
        id: index === 0 ? "t".repeat(64) : `task-${index + 1}`,
        title: `Long task ${index + 1} ${"t".repeat(200)}`,
      })),
    });
    const active = runHook(env, "pre-invocation", { conversationId, workspacePaths: [repo], invocationNum: 0, lastUserInput: "Go" });
    const activeText = active.output.injectSteps[0].systemMessage.systemMessage;
    assert.ok(activeText.length <= 700, `active capsule is ${activeText.length} characters; budget is 700`);
    assert.ok(activeText.includes(`Exact task: ${"t".repeat(64)}.`));
  });

  assert.equal(contextText({ hookOutput: { hookSpecificOutput: { additionalContext: "capsule\nnotice" }, systemMessage: "notice\nuser only" } }), "capsule\nnotice\nuser only");
  assert.equal(contextText({ hookOutput: { systemMessage: "failure only" } }), "failure only");
  assert.deepEqual(injectStepsOutput(""), {});
});

test("session files are pruned after 14 days and never written through a symlink", async () => {
  await withWorkspace(async ({ repo, base, env }) => {
    const run = async () => ({ status: 0, message: "", hookOutput: { hookSpecificOutput: { additionalContext: "note" } } });
    const toolCall = { name: "write_to_file", args: { TargetFile: "a", CodeContent: "" } };
    const directory = join(env.POTA_HOME, "hosts", "antigravity");
    await mkdir(directory, { recursive: true });
    const stale = join(directory, `${"0".repeat(16)}.json`);
    const recent = join(directory, `${"1".repeat(16)}.json`);
    const unrelated = join(directory, "keep.txt");
    for (const path of [stale, recent, unrelated]) await writeFile(path, "{}\n");
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await utimes(stale, old, old);
    await utimes(unrelated, old, old);
    await runAntigravityHook("post-tool-use", { conversationId, workspacePaths: [repo], toolCall }, { env, run });
    assert.deepEqual((await readdir(directory)).sort(), [sessionFileName(conversationId), `${"1".repeat(16)}.json`, "keep.txt"].sort());

    const linkedHome = join(base, "linked-home");
    const outside = join(base, "outside");
    await mkdir(join(linkedHome, "hosts"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(linkedHome, "hosts", "antigravity"));
    const linkedEnv = { ...env, POTA_HOME: linkedHome };
    assert.deepEqual(await runAntigravityHook("post-tool-use", { conversationId, workspacePaths: [repo], toolCall }, { env: linkedEnv, run }), {});
    assert.deepEqual(await readdir(outside), []);
  });
});

// The legacy install, every host home, and POTA_HOME live in one temp directory (test/support/legacy-install.mjs). The
// runner is never started: in-process runs record the spawn, and the CLI run sees no manifest.
test("SessionStart injects the legacy-migration notice for the antigravity host", async () => {
  const install = await createLegacyInstall({ hosts: ["antigravity"] });
  const repo = join(install.temp, "repo");
  const previous = { HOME: process.env.HOME, POTA_HOME: process.env.POTA_HOME };
  process.env.HOME = install.env.HOME;
  process.env.POTA_HOME = install.env.POTA_HOME;
  try {
    await mkdir(repo);
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: repo, encoding: "utf8" }).status, 0);
    const pluginRoot = join(install.temp, "plugin");
    const calls = [];
    const spawn = (command, args) => {
      calls.push(args);
      return { on() {}, unref() {} };
    };
    const run = (event, options) => runStateResult(event, { ...options, migration: { ...options.migration, spawn, pluginRoot } });
    const input = { conversationId, workspacePaths: [repo] };

    const started = await runAntigravityHook("session-start", input, { env: install.env, run });
    const text = started.injectSteps[0].systemMessage.systemMessage;
    const lines = text.split("\n");
    assert.match(lines.at(-2), /^Pota CLI: node /);
    assert.equal(lines.at(-1), "Pota: removing the legacy npm install in the background. Legacy Pota hooks and commands stop working in this session; restart it when convenient.");
    assert.equal(lines.filter((line) => line.startsWith("Pota: removing")).length, 1, "the systemMessage copy is folded in once");
    assert.deepEqual(calls, [[join(pluginRoot, "scripts", "pota-legacy-migration.mjs"), "run", "--host", "antigravity"]]);

    assert.equal((await runLegacyRemoval({ env: install.env, host: "antigravity" })).status, "completed");
    assert.equal(existsSync(install.manifestPath), false);
    const { status, output } = runHook(install.env, "session-start", input);
    assert.equal(status, 0);
    const doctor = `node "${join(resolve("."), "scripts", "pota.mjs")}" doctor`;
    assert.equal(output.injectSteps[0].systemMessage.systemMessage.split("\n").at(-1), `Pota: removed the legacy npm install (1.4.0). Details: ${doctor}`);
    assert.match(runHook(install.env, "session-start", input).output.injectSteps[0].systemMessage.systemMessage.split("\n").at(-1), /^Pota CLI: /, "shown once");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await install.cleanup();
  }
});

function runHook(env, event, input) {
  const args = event === undefined ? [adapter] : [adapter, event];
  const result = spawnSync(process.execPath, args, {
    cwd: env.HOME,
    env,
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });
  assert.equal(result.stderr, "", result.stderr);
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    output = undefined;
  }
  return { status: result.status, stdout: result.stdout, output };
}

async function startTwoTaskGoal(root) {
  return startGoal({
    root,
    goal: "Antigravity adapter coverage",
    planId: "docs/plan/antigravity.md",
    evidencePolicy: "declared",
    ownerSessionId: conversationId,
    tasks: [{ id: "first", title: "First task" }, { id: "second", title: "Second task" }],
  });
}

function sessionPath(env) {
  return join(env.POTA_HOME, "hosts", "antigravity", sessionFileName(conversationId));
}

async function sessionFiles(env) {
  try {
    return (await readdir(join(env.POTA_HOME, "hosts", "antigravity"))).length;
  } catch {
    return null;
  }
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// The child and this process share one isolated POTA_HOME and HOME; downloads, upgrades, and model settings are off.
async function withWorkspace(work) {
  const base = realpathSync(await mkdtemp(join(tmpdir(), "pota-antigravity-")));
  const home = join(base, "home");
  const repo = join(base, "repo");
  await mkdir(home);
  await mkdir(repo);
  const git = spawnSync("git", ["init", "-q"], { cwd: repo, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    POTA_HOME: join(base, "pota-home"),
    LANG: "en_US.UTF-8",
    POTA_COMMENT_CHECKER: "0",
    POTA_AUTO_UPGRADE: "0",
  };
  const previous = { HOME: process.env.HOME, POTA_HOME: process.env.POTA_HOME };
  process.env.HOME = env.HOME;
  process.env.POTA_HOME = env.POTA_HOME;
  try {
    await work({ base, repo, env });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(base, { recursive: true, force: true });
  }
}
