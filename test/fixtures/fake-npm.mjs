// Minimal stand-in for the npm CLI used by auto-upgrade tests; it never reaches a registry.
// `view @comento/pota-harness@latest version --json` prints FAKE_NPM_LATEST as JSON (FAKE_NPM_VIEW_RAW=1 prints it verbatim).
// `install … @comento/pota-harness@<version>` copies this repository into <cwd>/node_modules/@comento/pota-harness and writes <version> into
// package.json and .codex-plugin/plugin.json. Every call is appended to FAKE_NPM_LOG as one JSON line ({ args, cwd }).
// Failure injection: FAKE_NPM_FAIL=view|install. Tampering: FAKE_NPM_TAMPER=name|version|symlink|extra-package.
// Races: FAKE_NPM_UNINSTALL_FIRST=<pota-lifecycle.mjs> runs `uninstall` with it before `install` copies anything;
// FAKE_NPM_LOCK_STAGE=1 makes the staged scripts/ directory read-only after `install`, so the stage cannot be removed.
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// node --test also loads files under test/; without CLI arguments this module is a no-op there.
if (process.argv.length <= 2) process.exit(0);
const args = process.argv.slice(2);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
if (process.env.FAKE_NPM_LOG) appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
const command = args[0];
if (process.env.FAKE_NPM_FAIL && process.env.FAKE_NPM_FAIL === command) {
  console.error(`npm error injected ${command} failure`);
  process.exit(1);
}

if (command === "view") {
  if (args[1] !== "@comento/pota-harness@latest") {
    console.error(`npm error unexpected view target ${args[1]}`);
    process.exit(1);
  }
  const latest = process.env.FAKE_NPM_LATEST ?? "";
  process.stdout.write(process.env.FAKE_NPM_VIEW_RAW === "1" ? latest : `${JSON.stringify(latest)}\n`);
} else if (command === "install") {
  const version = /^@comento\/pota-harness@(.+)$/.exec(args.at(-1) ?? "")?.[1];
  if (!version) {
    console.error(`npm error unexpected install spec ${args.at(-1)}`);
    process.exit(1);
  }
  if (process.env.FAKE_NPM_UNINSTALL_FIRST) {
    const uninstall = spawnSync(process.execPath, [process.env.FAKE_NPM_UNINSTALL_FIRST, "uninstall"], { env: process.env, encoding: "utf8" });
    if (uninstall.status !== 0) {
      console.error(`npm error uninstall before install failed: ${uninstall.stdout}${uninstall.stderr}`);
      process.exit(1);
    }
  }
  const modules = join(process.cwd(), "node_modules");
  const destination = join(modules, "@comento", "pota-harness");
  // Entries are copied one by one instead of through a cpSync filter: the path a filter receives differs between
  // Node versions on Windows, and a copied .git would make the lifecycle record a checkout-origin installation.
  const excluded = new Set([".git", "node_modules", "test", ".omo", ".pota"]);
  const excludedDocs = new Set(["plan", "memory"]);
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(sourceRoot)) {
    if (excluded.has(name)) continue;
    if (name !== "docs") {
      cpSync(join(sourceRoot, name), join(destination, name), { recursive: true });
      continue;
    }
    mkdirSync(join(destination, "docs"), { recursive: true });
    for (const child of readdirSync(join(sourceRoot, "docs"))) {
      if (!excludedDocs.has(child)) cpSync(join(sourceRoot, "docs", child), join(destination, "docs", child), { recursive: true });
    }
  }
  for (const manifest of ["package.json", join(".codex-plugin", "plugin.json")]) {
    const path = join(destination, manifest);
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.version = version;
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  const tamper = process.env.FAKE_NPM_TAMPER;
  if (tamper === "name" || tamper === "version") {
    const path = join(destination, "package.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (tamper === "name") value.name = "@comento/pota-harness-impostor";
    else value.version = "0.0.0-tampered";
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  } else if (tamper === "symlink") {
    symlinkSync(join(destination, "package.json"), join(destination, "scripts", "linked.json"));
  } else if (tamper === "extra-package") {
    mkdirSync(join(modules, "left-pad"), { recursive: true });
    writeFileSync(join(modules, "left-pad", "package.json"), `${JSON.stringify({ name: "left-pad", version: "1.0.0" })}\n`);
  }
  if (process.env.FAKE_NPM_LOCK_STAGE === "1") chmodSync(join(destination, "scripts"), 0o555);
  console.log(`added 1 package`);
} else {
  console.error(`npm error unsupported fake npm command: ${args.join(" ")}`);
  process.exit(1);
}
