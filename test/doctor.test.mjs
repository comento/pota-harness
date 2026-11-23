import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { formatDoctor, REQUIRED_PATHS, runDoctor, VERSION_SURFACES } from "../scripts/pota-doctor.mjs";
import { runLegacyRemoval } from "../scripts/pota-legacy-migration.mjs";
import { isolatedEnv, withLegacyInstall } from "./support/legacy-install.mjs";

// The doctor and the modules it loads, copied into each fixture plugin root so the CLI resolves that root.
const DOCTOR_SCRIPTS = ["pota-doctor.mjs", "pota-legacy-migration.mjs", "pota-paths.mjs", "pota-safe-fs.mjs", "pota-lifecycle-lock.mjs"];

// A plugin copy in the final 2.0.0 layout, built from the doctor's own data so it does not depend on this checkout.
async function createPluginRoot(temp, version = "2.0.0") {
  const root = join(temp, "plugin");
  for (const surface of VERSION_SURFACES) {
    const path = join(root, ...surface.split("/"));
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify({ name: "pota", version }, null, 2)}\n`);
  }
  for (const entry of REQUIRED_PATHS) {
    const path = join(root, ...entry.path.split("/"));
    if (entry.type === "directory") await mkdir(path, { recursive: true });
    else {
      await mkdir(resolve(path, ".."), { recursive: true });
      await writeFile(path, "// fixture\n");
    }
  }
  for (const name of DOCTOR_SCRIPTS) await copyFile(resolve("scripts", name), join(root, "scripts", name));
  return root;
}

async function withPlugin(operation) {
  const temp = await mkdtemp(join(tmpdir(), "pota-doctor-"));
  try {
    const env = isolatedEnv(temp, join(temp, "home"));
    await operation({ temp, env, root: await createPluginRoot(temp) });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function doctorCli(root, env, ...args) {
  return spawnSync(process.execPath, [join(root, "scripts", "pota-doctor.mjs"), ...args], { encoding: "utf8", env });
}

function line(lines, prefix) {
  return lines.find((candidate) => candidate.startsWith(prefix));
}

test("a healthy plugin copy passes with English labels and exit 0, as text and as JSON", async () => {
  await withPlugin(async ({ env, root }) => {
    const result = await runDoctor({ env, pluginRoot: root, nodeVersion: "v22.11.0" });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    const lines = formatDoctor(result);
    assert.equal(lines[0], "version: 2.0.0");
    assert.equal(lines[1], `pluginRoot: ${root}`);
    assert.equal(line(lines, "OK node"), "OK node: v22.11.0 (requires >=18)");
    assert.match(line(lines, "OK potaHome"), /\(writable\)$/);
    assert.equal(line(lines, "OK version surfaces"), `OK version surfaces: 2.0.0 (${VERSION_SURFACES.map((surface) => `${surface}=2.0.0`).join(", ")})`);
    assert.equal(line(lines, "OK required files"), "OK required files: present");
    assert.equal(line(lines, "OK legacy install"), "OK legacy install: none");
    assert.equal(line(lines, "OK legacy migration"), "OK legacy migration: none");
    assert.equal(lines.at(-1), "comment-checker: disabled");

    const text = doctorCli(root, env);
    assert.equal(text.status, 0, text.stdout + text.stderr);
    const json = doctorCli(root, env, "--json");
    assert.equal(json.status, 0, json.stderr);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.version, "2.0.0");
    assert.equal(parsed.pluginRoot, await realpath(root));
    assert.deepEqual(parsed.checks.map((check) => check.label), ["node", "potaHome", "version surfaces", "required files", "legacy install", "legacy migration"]);
    assert.equal(doctorCli(root, env, "--bogus").status, 2);
  });
});

test("a missing required file or disagreeing version surfaces fail with exit 1; an absent surface is only listed", async () => {
  await withPlugin(async ({ env, root }) => {
    await rm(join(root, "scripts", "pota-state.mjs"));
    const missing = doctorCli(root, env);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /^FAIL required files: missing scripts\/pota-state\.mjs$/m);

    await writeFile(join(root, "scripts", "pota-state.mjs"), "// fixture\n");
    await writeFile(join(root, "plugin.json"), `${JSON.stringify({ name: "pota", version: "2.0.1" })}\n`);
    const mismatch = doctorCli(root, env, "--json");
    assert.equal(mismatch.status, 1);
    const surfaces = JSON.parse(mismatch.stdout).checks.find((check) => check.label === "version surfaces");
    assert.equal(surfaces.ok, false);
    assert.match(surfaces.value, /plugin\.json=2\.0\.1/);

    await rm(join(root, "plugin.json"));
    const absent = await runDoctor({ env, pluginRoot: root });
    assert.equal(absent.ok, true);
    assert.match(line(formatDoctor(absent), "OK version surfaces"), /absent: plugin\.json\)$/);
  });
});

test("a legacy npm install is reported as present, blocked, or kept after migration", async () => {
  await withLegacyInstall({}, async (install) => {
    const root = await createPluginRoot(install.temp);
    const present = doctorCli(root, install.env);
    assert.equal(present.status, 0, present.stdout);
    assert.match(present.stdout, /^OK legacy install: present 1\.4\.0 \(hosts: codex,claude,antigravity\)$/m);

    const modified = install.target("claude-command-plan").path;
    await writeFile(modified, "edited\n");
    await runLegacyRemoval({ env: { ...install.env, POTA_CLAUDE_CLI: "none" }, now: new Date("2026-11-23T00:00:00Z"), host: "all" });
    const blocked = doctorCli(root, install.env);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /^FAIL legacy migration: codex completed, claude blocked, antigravity completed$/m);
    assert.match(blocked.stdout, /^ {2}claude: blocked \(host-unregister-failed\) at 2026-11-23T00:00:00\.000Z, removed 0, kept 0$/m);
    assert.match(blocked.stdout, /^ {4}manual: claude plugin uninstall pota@pota --scope user$/m);

    await runLegacyRemoval({ env: install.env, now: new Date("2026-11-23T01:00:00Z"), host: "claude" });
    const kept = doctorCli(root, install.env);
    assert.equal(kept.status, 0, kept.stdout);
    assert.ok(kept.stdout.split("\n").includes(`    kept: ${modified}`));

    await writeFile(install.manifestPath, "{broken");
    const invalid = doctorCli(root, install.env, "--json");
    assert.equal(invalid.status, 1);
    assert.deepEqual(JSON.parse(invalid.stdout).legacyInstall, { status: "blocked", reason: "manifest-invalid", version: null, leftoverDirectories: [] });
  });
});
