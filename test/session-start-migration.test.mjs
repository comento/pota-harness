import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runLegacyRemoval } from "../scripts/pota-legacy-migration.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import { createLegacyInstall, isolatedEnv } from "./support/legacy-install.mjs";

// Every run here uses an isolated HOME, POTA_HOME, and host homes (test/support/legacy-install.mjs) and a recording
// spawn, so no runner starts and nothing outside the temp directory is read or removed.
const NOW = new Date("2026-11-23T00:00:00.000Z");
const MINUTE = 60 * 1000;
const at = (offset) => new Date(NOW.getTime() + offset);
const sessionId = "migration-session";
const repoCli = resolve("scripts", "pota.mjs");

function fakeSpawn() {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { on() {}, unref() {} };
  };
  return { calls, spawn };
}

// Goal state lives under process.env.POTA_HOME, so the in-process hook reads only the temp home.
async function withProcessHome(env, work) {
  const previous = { HOME: process.env.HOME, POTA_HOME: process.env.POTA_HOME };
  process.env.HOME = env.HOME;
  process.env.POTA_HOME = env.POTA_HOME;
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withInstall(options, work) {
  const install = await createLegacyInstall(options);
  const repo = join(install.temp, "repo");
  await mkdir(join(repo, ".git"), { recursive: true });
  try {
    await withProcessHome(install.env, () => work({ install, repo, pluginRoot: join(install.temp, "plugin") }));
  } finally {
    await install.cleanup();
  }
}

function sessionStart({ repo, env, pluginRoot, spawn, host, now = NOW, locale = "en_US", event = "session-start" }) {
  return runStateResult(event, {
    root: repo,
    locale,
    payload: { cwd: repo, session_id: sessionId },
    host,
    migration: { env, now, spawn, pluginRoot },
  });
}

function contextLines(result) {
  return result.hookOutput.hookSpecificOutput.additionalContext.split("\n");
}

test("without a legacy manifest SessionStart keeps the capsule and writes nothing", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pota-session-migration-"));
  try {
    const env = isolatedEnv(temp, join(temp, "home"));
    const repo = join(temp, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await withProcessHome(env, async () => {
      const { calls, spawn } = fakeSpawn();
      const pluginRoot = join(temp, "plugin");
      const baseline = await sessionStart({ repo, env, pluginRoot, spawn, host: "unknown" });
      for (const host of ["claude", "codex", "antigravity"]) {
        assert.deepEqual(await sessionStart({ repo, env, pluginRoot, spawn, host }), baseline, host);
      }
      assert.equal(calls.length, 0);
      assert.equal(existsSync(join(env.POTA_HOME, "migration")), false);
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("a legacy manifest starts one runner and appends the notice after the CLI line and to systemMessage", async () => {
  await withInstall({}, async ({ install, repo, pluginRoot }) => {
    const { calls, spawn } = fakeSpawn();
    const env = install.env;
    const baseline = await sessionStart({ repo, env, pluginRoot, spawn, host: "unknown" });
    assert.equal(calls.length, 0, "the default host never starts a runner");

    const notice = "Pota: removing the legacy npm install in the background. Legacy Pota hooks and commands stop working in this session; restart it when convenient.";
    const first = await sessionStart({ repo, env, pluginRoot, spawn, host: "claude" });
    assert.deepEqual(contextLines(first), [...contextLines(baseline), notice]);
    assert.match(contextLines(first).at(-2), /^Pota CLI: node /);
    assert.equal(first.hookOutput.systemMessage, notice);
    assert.equal(first.status, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      command: process.execPath,
      args: [join(pluginRoot, "scripts", "pota-legacy-migration.mjs"), "run", "--host", "claude"],
      options: { detached: true, stdio: "ignore", windowsHide: true, env },
    });

    assert.deepEqual(await sessionStart({ repo, env, pluginRoot, spawn, host: "claude", now: at(MINUTE) }), baseline);
    const prompt = await sessionStart({ repo, env, pluginRoot, spawn, host: "claude", now: at(20 * MINUTE), event: "user-prompt-submit" });
    assert.equal(prompt.hookOutput.systemMessage, undefined, "UserPromptSubmit never runs the migration step");
    assert.equal(calls.length, 1);

    assert.deepEqual(await sessionStart({ repo, env: { ...env, POTA_LEGACY_MIGRATION: "0" }, pluginRoot, spawn, host: "codex" }), baseline);
    assert.equal(calls.length, 1);
  });
});

test("a finished removal is announced once, in the host's locale, with the doctor command of this plugin copy", async () => {
  await withInstall({ hosts: ["claude", "antigravity"] }, async ({ install, repo, pluginRoot }) => {
    const { calls, spawn } = fakeSpawn();
    const env = install.env;
    await sessionStart({ repo, env, pluginRoot, spawn, host: "antigravity" });
    const removal = await runLegacyRemoval({ env, now: at(MINUTE), host: "antigravity" });
    assert.equal(removal.status, "completed");

    const doctor = `node "${join(pluginRoot, "scripts", "pota.mjs")}" doctor`;
    const shown = await sessionStart({ repo, env, pluginRoot, spawn, host: "antigravity", now: at(2 * MINUTE), locale: "ko_KR" });
    const line = `Pota: 기존 npm 설치본(1.4.0)을 제거했습니다. 다른 호스트에는 플러그인 설치가 필요합니다: Claude Code. 자세히: ${doctor}`;
    assert.equal(contextLines(shown).at(-1), line);
    assert.equal(shown.hookOutput.systemMessage, line);
    const again = await sessionStart({ repo, env, pluginRoot, spawn, host: "antigravity", now: at(3 * MINUTE) });
    assert.equal(again.hookOutput.systemMessage, undefined);
    assert.equal(calls.length, 1);
  });
});

test("an error in the migration step leaves the capsule and status unchanged", async () => {
  await withInstall({}, async ({ install, repo, pluginRoot }) => {
    const baseline = await sessionStart({ repo, env: install.env, pluginRoot, spawn: fakeSpawn().spawn, host: "unknown" });
    const throwing = () => { throw new Error("spawn failed"); };
    assert.deepEqual(await sessionStart({ repo, env: install.env, pluginRoot, spawn: throwing, host: "claude" }), baseline);
  });
});

test("the hook CLI names the pota.mjs beside it and starts nothing without a known host argument", async () => {
  const temp = realpathSync(await mkdtemp(join(tmpdir(), "pota-session-cli-")));
  try {
    const env = isolatedEnv(temp, join(temp, "home"));
    const repo = join(temp, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(env.HOME, { recursive: true });
    // A plugin copy elsewhere, with a leftover 1.x locator that must not be read.
    const plugin = join(temp, "plugin");
    await cp(resolve("scripts"), join(plugin, "scripts"), { recursive: true });
    await cp(resolve("package.json"), join(plugin, "package.json"));
    await writeFile(join(plugin, ".pota-runtime.json"), JSON.stringify({ plugin: "pota", entrypoints: { cli: join(temp, "elsewhere", "pota.mjs") } }));
    // A legacy manifest is present, so only the host argument decides whether a runner would start.
    await mkdir(join(env.POTA_HOME, "install"), { recursive: true });
    await writeFile(join(env.POTA_HOME, "install", "lifecycle.json"), "{}\n");

    const hook = (script, args) => spawnSync(process.execPath, [script, "session-start", ...args], {
      cwd: repo, env, input: JSON.stringify({ cwd: repo, session_id: sessionId }), encoding: "utf8",
    });
    for (const [script, cli] of [[join(plugin, "scripts", "pota-state.mjs"), join(plugin, "scripts", "pota.mjs")], [resolve("scripts", "pota-state.mjs"), repoCli]]) {
      for (const args of [[], ["gemini"]]) {
        const result = hook(script, args);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, "");
        const output = JSON.parse(result.stdout);
        const lines = output.hookSpecificOutput.additionalContext.split("\n");
        assert.equal(lines.at(-1), `Pota CLI: node ${JSON.stringify(cli)} goal <command>`);
        assert.equal(output.systemMessage, undefined);
      }
    }
    assert.equal(existsSync(join(env.POTA_HOME, "migration")), false, "no runner state without a host argument");
    assert.equal(existsSync(join(env.POTA_HOME, "tools")), false, "no comment-checker download without a host argument");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
