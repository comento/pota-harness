import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startGoal } from "../scripts/pota-goal.mjs";
import {
  checkPostToolUse, commentCheckerPaths, commentCheckerStatusLine, extractCheckRequests, fetchCommentChecker,
  parseApplyPatch, startFetchWhenNeeded,
} from "../scripts/pota-comment-checker.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";

const posix = process.platform !== "win32";
const sessionId = "comment-checker-session";

test("Claude Code and Codex edit payloads map to checker tool inputs", () => {
  const cwd = "/repo";
  const requests = (tool_name, tool_input, extra = {}) => extractCheckRequests({ tool_name, tool_input, cwd, ...extra });

  assert.deepEqual(requests("Write", { file_path: "/repo/a.js", content: "x" }), [
    { toolName: "Write", filePath: "/repo/a.js", toolInput: { file_path: "/repo/a.js", content: "x" } },
  ]);
  assert.deepEqual(requests("edit", { filePath: "src/b.js", oldString: "a", newString: "b" }), [
    { toolName: "Edit", filePath: resolve(cwd, "src/b.js"), toolInput: { file_path: resolve(cwd, "src/b.js"), old_string: "a", new_string: "b" } },
  ]);
  assert.deepEqual(requests("MultiEdit", { file_path: "/repo/c.js", edits: [{ old_string: "a", new_string: "b" }, { bad: true }] }), [
    { toolName: "MultiEdit", filePath: "/repo/c.js", toolInput: { file_path: "/repo/c.js", edits: [{ old_string: "a", new_string: "b" }] } },
  ]);
  assert.deepEqual(requests("Edit", { file_path: "/repo/a.js", old_string: "a", new_string: "b" }, { tool_response: { success: false } }), []);
  assert.deepEqual(requests("write", { path: "/repo/a.js", content: "x" }, { tool_response: { is_error: true } }), []);
  assert.deepEqual(requests("Read", { file_path: "/repo/a.js" }), []);
  assert.deepEqual(requests("Edit", { file_path: "/repo/a.js" }), []);
  assert.deepEqual(extractCheckRequests({ tool_name: "Write" }), []);

  const patch = "*** Begin Patch\n*** Add File: new.js\n+// added\n+const a = 1;\n*** End Patch";
  assert.deepEqual(requests("apply_patch", { command: patch }), [
    { toolName: "Write", filePath: resolve(cwd, "new.js"), toolInput: { file_path: resolve(cwd, "new.js"), content: "// added\nconst a = 1;" } },
  ]);
});

test("apply_patch parsing covers add, update with context, move, and delete", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: a.js",
    "+one",
    "*** Update File: b.js",
    "@@ function b()",
    " keep",
    "-old",
    "+// new comment",
    "+new",
    "*** Update File: c.js",
    "*** Move to: d.js",
    "@@",
    "-x",
    "+y",
    "*** End of File",
    "*** Delete File: e.js",
    "*** Update File: f.js",
    "-only removed",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(parseApplyPatch(patch), [
    { filePath: "a.js", before: "", after: "one" },
    { filePath: "b.js", before: "keep\nold", after: "keep\n// new comment\nnew" },
    { filePath: "d.js", before: "x", after: "y" },
  ]);
});

test("post-tool-use blocks with the checker's findings and stays silent for clean, failing, or disabled checks", { skip: !posix }, async () => {
  await withHome(async ({ env, project, home }) => {
    const input = join(home, "checker-input.json");
    await fakeChecker(env, { exit: 2, message: "COMMENT DETECTED: // increments i", input });
    const payload = editPayload(project);
    const run = (extraEnv = {}) => runStateResult("post-tool-use", {
      root: project, payload, locale: "en_US", commentChecker: { env: { ...env, ...extraEnv } },
    });

    const blocked = await run();
    assert.equal(blocked.hookOutput.decision, "block");
    assert.match(blocked.hookOutput.reason, /comment-checker found issues in .*a\.js:\nCOMMENT DETECTED: \/\/ increments i/);
    assert.equal(blocked.hookOutput.hookSpecificOutput, undefined);
    const sent = JSON.parse(await readFile(input, "utf8"));
    assert.equal(sent.tool_name, "Edit");
    assert.equal(sent.hook_event_name, "PostToolUse");
    assert.equal(sent.session_id, sessionId);
    assert.deepEqual(sent.tool_input, payload.tool_input);

    assert.deepEqual((await run({ POTA_COMMENT_CHECKER: "off" })).hookOutput, {});
    await writeFile(join(env.POTA_HOME, "config.json"), JSON.stringify({ commentChecker: false }));
    assert.deepEqual((await run()).hookOutput, {});
    await rm(join(env.POTA_HOME, "config.json"));

    await fakeChecker(env, { exit: 0, message: "" });
    assert.deepEqual((await run()).hookOutput, {});
    await fakeChecker(env, { exit: 1, message: "panic" });
    assert.deepEqual((await run()).hookOutput, {});
  });
});

test("a checker that outlives the budget lets the edit pass", { skip: !posix }, async () => {
  await withHome(async ({ env, project }) => {
    await fakeChecker(env, { exit: 2, message: "late", sleep: 5 });
    const started = Date.now();
    assert.equal(await checkPostToolUse(editPayload(project), { env, budgetMs: 300 }), null);
    assert.ok(Date.now() - started < 3000);
  });
});

test("findings and the goal reminder are returned together", { skip: !posix }, async () => {
  await withHome(async ({ env, project }) => {
    await fakeChecker(env, { exit: 2, message: "COMMENT DETECTED" });
    const previous = process.env.POTA_HOME;
    process.env.POTA_HOME = env.POTA_HOME;
    try {
      await startGoal({ root: project, goal: "g", planId: "docs/plan/g.md", ownerSessionId: sessionId, tasks: [{ id: "t", title: "t" }] });
      const result = await runStateResult("post-tool-use", {
        root: project, payload: editPayload(project), locale: "en_US", commentChecker: { env },
      });
      assert.equal(result.hookOutput.decision, "block");
      assert.match(result.hookOutput.reason, /COMMENT DETECTED/);
      assert.match(result.hookOutput.hookSpecificOutput.additionalContext, /^Pota check:/);
      assert.equal(result.hookOutput.hookSpecificOutput.hookEventName, "PostToolUse");
    } finally {
      if (previous === undefined) delete process.env.POTA_HOME;
      else process.env.POTA_HOME = previous;
    }
  });
});

test("a missing binary starts one detached fetch from this plugin copy only when the hook entry point asks", async () => {
  await withHome(async ({ env, project, home }) => {
    const pluginRoot = join(home, "plugin");
    const fetchArgs = [join(pluginRoot, "scripts", "pota-comment-checker.mjs"), "fetch"];
    const spawn = spawnRecorder();

    // The library default never downloads, so in-process callers and tests stay off the network.
    assert.equal(await checkPostToolUse(editPayload(project), { env, spawn, pluginRoot }), null);
    assert.equal(startFetchWhenNeeded({ env, spawn, pluginRoot }), false);
    assert.equal(spawn.calls.length, 0);

    assert.equal(await checkPostToolUse(editPayload(project), { env, spawn, pluginRoot, autoFetch: true }), null);
    assert.equal(spawn.calls.length, 1);
    const [command, args, options] = spawn.calls[0];
    assert.equal(command, process.execPath);
    assert.deepEqual(args, fetchArgs);
    assert.equal(options.detached, true);
    assert.equal(options.stdio, "ignore");
    assert.equal(spawn.unrefCalls, 1);

    const previous = process.env.POTA_HOME;
    process.env.POTA_HOME = env.POTA_HOME;
    try {
      const sessionStart = (commentChecker) => runStateResult("session-start", {
        root: project, payload: { cwd: project, session_id: sessionId }, locale: "en_US", migration: { env, pluginRoot }, commentChecker,
      });
      const library = spawnRecorder();
      await sessionStart({ spawn: library });
      assert.equal(library.calls.length, 0);
      const hook = spawnRecorder();
      await sessionStart({ spawn: hook, autoFetch: true });
      assert.equal(hook.calls.length, 1);
      assert.deepEqual(hook.calls[0][1], fetchArgs);
    } finally {
      if (previous === undefined) delete process.env.POTA_HOME;
      else process.env.POTA_HOME = previous;
    }

    const fetch = (options = {}) => startFetchWhenNeeded({ env, spawn, pluginRoot, autoFetch: true, ...options });
    assert.equal(fetch({ env: { ...env, POTA_COMMENT_CHECKER: "0" } }), false);
    assert.equal(fetch({ platform: "aix", arch: "ppc64" }), false);
    const paths = commentCheckerPaths(env);
    await writeFile(paths.state, JSON.stringify({ schemaVersion: 1, nextAttemptAt: new Date(Date.now() + 60_000).toISOString() }));
    assert.equal(fetch(), false);
    await rm(paths.state);
    await writeFile(paths.lock, JSON.stringify({ pid: process.pid }));
    assert.equal(fetch(), false);
    await rm(paths.lock);
    await fakeChecker(env, { exit: 0, message: "" });
    assert.equal(fetch(), false);
    assert.equal(spawn.calls.length, 1);
  });
});

test("fetch installs a verified archive, rejects a wrong digest with a backoff, and respects the lock", { skip: !posix }, async () => {
  await withHome(async ({ env, home }) => {
    const source = join(home, "asset");
    await mkdir(source);
    await writeFile(join(source, "comment-checker"), "#!/bin/sh\nexit 0\n");
    await writeFile(join(source, "README.md"), "readme");
    const archivePath = join(home, "asset.tar.gz");
    assert.equal(spawnSync("tar", ["-czf", archivePath, "-C", source, "comment-checker", "README.md"]).status, 0);
    const archive = await readFile(archivePath);
    const sha256 = createHash("sha256").update(archive).digest("hex");

    await withServer(archive, async (url) => {
      const asset = { name: "asset.tar.gz", url, sha256, zip: false };
      const paths = commentCheckerPaths(env);
      const now = new Date("2026-01-01T00:00:00Z");

      const wrong = await fetchCommentChecker({ env, now, asset: { ...asset, sha256: "0".repeat(64) } });
      assert.equal(wrong.status, "failed");
      assert.match(wrong.error, /SHA256 mismatch/);
      const state = JSON.parse(await readFile(paths.state, "utf8"));
      assert.equal(state.consecutiveFailures, 1);
      assert.equal(state.nextAttemptAt, "2026-01-01T01:00:00.000Z");
      await assert.rejects(lstat(paths.binary));
      assert.match(commentCheckerStatusLine(env), /last attempt failed: SHA256 mismatch/);

      const lock = (pid) => JSON.stringify({ schemaVersion: 1, pid, hostname: hostname(), nonce: "n", acquiredAt: new Date().toISOString() });
      await writeFile(paths.lock, lock(process.pid));
      assert.equal((await fetchCommentChecker({ env, now, asset })).status, "locked");
      // A lock older than any fetch is abandoned even when its pid is alive (a reused pid).
      const old = new Date(Date.now() - 11 * 60 * 1000);
      await utimes(paths.lock, old, old);
      assert.equal((await fetchCommentChecker({ env, now, asset })).status, "installed");
      await rm(paths.directory, { recursive: true });
      // A lock left by a dead process is reclaimed.
      await writeFile(paths.lock, lock(2 ** 30));

      const installed = await fetchCommentChecker({ env, now, asset });
      assert.equal(installed.status, "installed", installed.error);
      assert.equal(((await lstat(paths.binary)).mode & 0o111) !== 0, true);
      assert.deepEqual((await readdir(paths.directory)).sort(), ["comment-checker"]);
      assert.deepEqual((await readdir(paths.root)).sort(), ["state.json", "v0.8.2"]);
      assert.equal(JSON.parse(await readFile(paths.state, "utf8")).consecutiveFailures, 0);
      assert.equal(commentCheckerStatusLine(env), "comment-checker: ready 0.8.2");
      assert.equal((await fetchCommentChecker({ env, now, asset })).status, "present");
    });
  });
});

test("fetch reports disabled and unsupported platforms without touching the network", async () => {
  await withHome(async ({ env }) => {
    const fetchImpl = () => { throw new Error("network"); };
    assert.deepEqual(await fetchCommentChecker({ env: { ...env, POTA_COMMENT_CHECKER: "no" }, fetchImpl }), { status: "disabled" });
    assert.deepEqual(await fetchCommentChecker({ env, fetchImpl, platform: "aix", arch: "ppc64" }), { status: "unsupported", platform: "aix-ppc64" });
    assert.equal(commentCheckerStatusLine({ ...env, POTA_COMMENT_CHECKER: "0" }), "comment-checker: disabled");
  });
});

async function withHome(fn) {
  const home = await mkdtemp(join(tmpdir(), "pota-comment-checker-"));
  const project = join(home, "project");
  await mkdir(join(project, ".git"), { recursive: true });
  const env = { ...process.env, POTA_HOME: join(home, "pota-home") };
  delete env.POTA_COMMENT_CHECKER;
  await mkdir(commentCheckerPaths(env).root, { recursive: true });
  try {
    await fn({ env, project, home });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function editPayload(project) {
  return {
    session_id: sessionId,
    cwd: project,
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: join(project, "a.js"), old_string: "i++", new_string: "// increments i\ni++" },
    tool_response: { filePath: join(project, "a.js"), success: true },
  };
}

async function fakeChecker(env, { exit, message, input, sleep }) {
  const { binary, directory } = commentCheckerPaths(env);
  await mkdir(directory, { recursive: true });
  const lines = ["#!/bin/sh", input ? `cat > ${JSON.stringify(input)}` : "cat > /dev/null"];
  if (sleep) lines.push(`sleep ${sleep}`);
  if (message) lines.push(`printf '%s\\n' ${JSON.stringify(message)} >&2`);
  lines.push(`exit ${exit}`);
  await writeFile(binary, `${lines.join("\n")}\n`);
  await chmod(binary, 0o755);
}

function spawnRecorder() {
  const recorder = { calls: [], unrefCalls: 0 };
  recorder.spawn = (...args) => {
    recorder.calls.push(args);
    return { on() {}, unref() { recorder.unrefCalls += 1; } };
  };
  const spawn = (...args) => recorder.spawn(...args);
  Object.defineProperties(spawn, {
    calls: { get: () => recorder.calls },
    unrefCalls: { get: () => recorder.unrefCalls },
  });
  return spawn;
}

async function withServer(body, fn) {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/gzip", "content-length": body.length });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/asset.tar.gz`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
