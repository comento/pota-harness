import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkIndex, extractNotePaths, matchNotePath, notesForPath } from "../scripts/pota-index.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";

test("extractNotePaths parses, cleans, and classifies entries", () => {
  assert.deepEqual(extractNotePaths("# D\n\nSummary: x\nPaths: scripts/, `test/a.mjs`, ./src/, , docs/**/*.md\n"),
    { paths: ["scripts", "test/a.mjs", "src", "docs/**/*.md"], invalid: [] });
  assert.deepEqual(extractNotePaths("- **Paths:** a, b").paths, ["a", "b"]);
  assert.deepEqual(extractNotePaths("PATHS: a").paths, ["a"]);
  const bad = extractNotePaths(`Paths: /abs, C:\\x, ../up, a/../b, a\\b, a\u0007b, ${"x".repeat(121)}, ok`);
  assert.deepEqual(bad.paths, ["ok"]);
  assert.equal(bad.invalid.length, 7);
  const many = extractNotePaths(`Paths: ${Array.from({ length: 10 }, (_, i) => `p${i}`).join(", ")}`);
  assert.equal(many.paths.length, 8);
  assert.deepEqual(many.invalid, ["p8", "p9"]);
  assert.deepEqual(extractNotePaths("Paths: <optional: a, b>"), { paths: [], invalid: [] });
  assert.deepEqual(extractNotePaths("# D\n"), { paths: [], invalid: [] });
  const late = `${"line\n".repeat(20)}Paths: scripts/\n`;
  assert.deepEqual(extractNotePaths(late), { paths: [], invalid: [] });
});

test("matchNotePath handles prefixes, globs, and escaping", () => {
  assert.ok(matchNotePath("scripts", "scripts/a.mjs"));
  assert.ok(matchNotePath("scripts/a.mjs", "scripts/a.mjs"));
  assert.ok(!matchNotePath("scripts/pota", "scripts/pota-x.mjs"));
  assert.ok(matchNotePath("scripts/*.mjs", "scripts/a.mjs"));
  assert.ok(!matchNotePath("scripts/*.mjs", "scripts/sub/a.mjs"));
  assert.ok(matchNotePath("scripts/**/a.mjs", "scripts/x/y/a.mjs"));
  assert.ok(matchNotePath("test/*", "test/dir/a.mjs"));
  assert.ok(matchNotePath("a+b/*.js", "a+b/c.js"));
  assert.ok(!matchNotePath("a.b/*", "axb/c"));
  assert.ok(matchNotePath("scripts/**/a.mjs", "scripts/a.mjs"));
  assert.ok(matchNotePath("**/*.md", "README.md"));
  assert.ok(matchNotePath("**/*.md", "docs/x/README.md"));
  assert.deepEqual(extractNotePaths("Paths: .").invalid, ["."]);
  assert.deepEqual(extractNotePaths("Paths: .").paths, []);
});

async function withRoot(fn) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "pota-memory-paths-")));
  const root = join(home, "project");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "docs", "memory"), { recursive: true });
  const previous = process.env.POTA_HOME;
  await mkdir(join(home, "pota-home"), { recursive: true });
  process.env.POTA_HOME = join(home, "pota-home");
  try {
    await fn(root);
  } finally {
    if (previous === undefined) delete process.env.POTA_HOME; else process.env.POTA_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

const note = (paths) => `# Domain: x\n\nSummary: about x\nPaths: ${paths}\n\n## Scope\n`;

test("memory check warns about invalid Paths entries and notesForPath filters", async () => {
  await withRoot(async (root) => {
    await writeFile(join(root, "MEMORY.md"), "# MEMORY\n\n## Domain Knowledge\n\n- [a](docs/memory/a.md): about x\n- [b](docs/memory/b.md): about x\n");
    await writeFile(join(root, "docs", "memory", "a.md"), note("scripts/, ../out"));
    await writeFile(join(root, "docs", "memory", "b.md"), note("test/"));
    const result = await checkIndex(root, "memory");
    const warning = result.warnings.find((item) => item.code === "paths-invalid");
    assert.ok(warning, JSON.stringify(result));
    assert.match(warning.message, /docs\/memory\/a\.md has an invalid Paths: entry: \.\.\/out;/);
    assert.equal(result.warnings.filter((item) => item.code === "paths-invalid").length, 1);
    assert.deepEqual(await notesForPath(root, "scripts/a.mjs"), ["a"]);
    assert.deepEqual(await notesForPath(root, "src/a.mjs"), []);
    assert.deepEqual(await notesForPath(join(root, "missing"), "scripts/a.mjs"), []);
  });
});

test("post-tool-use announces a matching note once per session and note", async () => {
  await withRoot(async (root) => {
    await writeFile(join(root, "docs", "memory", "x.md"), note("scripts/"));
    const run = (session_id, file) => runStateResult("post-tool-use", {
      root, locale: "en_US", commentChecker: { env: { ...process.env, POTA_COMMENT_CHECKER: "off" } },
      payload: { session_id, tool_name: "Edit", tool_input: { file_path: join(root, ...file.split("/")), old_string: "a", new_string: "b" } },
    });
    const context = (result) => result.hookOutput?.hookSpecificOutput?.additionalContext;
    const first = await run("s1", "scripts/a.mjs");
    assert.equal(context(first), "Pota memory: docs/memory/x.md covers scripts/a.mjs; read it before changing this area if you have not.");
    assert.equal(first.message, context(first));
    assert.equal(context(await run("s1", "scripts/b.mjs")), undefined);
    assert.match(context(await run("s2", "scripts/a.mjs")), /docs\/memory\/x\.md covers/);
    assert.equal(context(await run("s3", "docs/memory/x.md")), undefined);
    assert.equal(context(await run("s3", "src/a.mjs")), undefined);
  });
});

test("post-tool-use CLI entry point announces a matching note", async () => {
  await withRoot(async (root) => {
    await writeFile(join(root, "docs", "memory", "x.md"), note("src"));
    const script = fileURLToPath(new URL("../scripts/pota-state.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "post-tool-use", "claude"], {
      input: JSON.stringify({ session_id: "cli-s1", cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "src", "a.js"), old_string: "a", new_string: "b" } }),
      env: { ...process.env, POTA_HOME: process.env.POTA_HOME, POTA_COMMENT_CHECKER: "0" },
      encoding: "utf8"
    });
    const context = JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? "";
    assert.ok(context.includes("docs/memory/x.md") && context.includes("src/a.js"), result.stdout + result.stderr);
  });
});

test("notesForPath excludes already announced notes before capping at three", async () => {
  await withRoot(async (root) => {
    for (const name of ["a", "b", "c", "d"]) await writeFile(join(root, "docs", "memory", `${name}.md`), note("scripts"));
    assert.deepEqual(await notesForPath(root, "scripts/x.mjs"), ["a", "b", "c"]);
    assert.deepEqual(await notesForPath(root, "scripts/x.mjs", { exclude: ["a", "b", "c"] }), ["d"]);
    const run = (file) => runStateResult("post-tool-use", {
      root, locale: "en_US", commentChecker: { env: { ...process.env, POTA_COMMENT_CHECKER: "off" } },
      payload: { session_id: "cap", tool_name: "Edit", tool_input: { file_path: join(root, file), old_string: "a", new_string: "b" } },
    });
    const context = (result) => result.hookOutput?.hookSpecificOutput?.additionalContext;
    const first = context(await run("scripts/x.mjs"));
    assert.ok(/a\.md, docs\/memory\/b\.md, docs\/memory\/c\.md/.test(first) && !first.includes("d.md"), first);
    assert.match(context(await run("scripts/y.mjs")), /docs\/memory\/d\.md/);
    assert.equal(context(await run("scripts/z.mjs")), undefined);
  });
});

test("notesForPath ignores a symlinked docs/memory", async (t) => {
  await withRoot(async (root) => {
    const outside = join(root, "..", "outside-memory");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "o.md"), note("scripts"));
    await rm(join(root, "docs", "memory"), { recursive: true, force: true });
    try {
      await symlink(outside, join(root, "docs", "memory"), "dir");
    } catch (error) {
      if (error?.code === "EPERM") return t.skip("symlink creation not permitted");
      throw error;
    }
    assert.deepEqual(await notesForPath(root, "scripts/a.mjs"), []);
  });
});

test("memory notice resolves relative paths against cwd and reads apply_patch", async () => {
  await withRoot(async (root) => {
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "docs", "memory", "s.md"), note("scripts"));
    await writeFile(join(root, "docs", "memory", "r.md"), note("src"));
    const run = (session_id, payload) => runStateResult("post-tool-use", {
      root, locale: "en_US", commentChecker: { env: { ...process.env, POTA_COMMENT_CHECKER: "off" } },
      payload: { session_id, ...payload },
    });
    const context = (result) => result.hookOutput?.hookSpecificOutput?.additionalContext;
    const rel = await run("rel", { cwd: join(root, "scripts"), tool_name: "Edit", tool_input: { file_path: "a.mjs", old_string: "a", new_string: "b" } });
    assert.match(context(rel), /docs\/memory\/s\.md covers scripts\/a\.mjs/);
    const patch = await run("patch", { cwd: root, tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: src/a.js\n@@\n-a\n+b\n*** End Patch" } });
    assert.match(context(patch), /docs\/memory\/r\.md covers src\/a\.js/);
  });
});
