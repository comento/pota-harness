#!/usr/bin/env node
import { accessSync, constants as fsConstants, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectLegacyManifest, legacyDirectories, readMigrationReports } from "./pota-legacy-migration.mjs";
import { potaHome, resolvePluginRoot } from "./pota-paths.mjs";

// Read-only diagnostics of this plugin copy and the shared POTA_HOME. Versions of other hosts' copies are never
// compared: each host installs and updates its own copy.
export const DOCTOR_USAGE = "Usage: pota doctor [--json]";
// Every manifest that carries the release version. A surface that is absent is listed but only disagreeing versions
// fail, because each host reads its own manifest.
export const VERSION_SURFACES = ["package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"];
export const REQUIRED_PATHS = [
  { path: "scripts/pota.mjs", type: "file" },
  { path: "scripts/pota-state.mjs", type: "file" },
  ...["pota-memory", "pota-plan", "pota-work", "pota-review"].map((name) => ({ path: `skills/${name}/SKILL.md`, type: "file" })),
  { path: "templates", type: "directory" },
];
const MIN_NODE_MAJOR = 18;
const SMALL_FILE_LIMIT = 64 * 1024;
const OFF_VALUES = new Set(["0", "false", "off", "no"]);

if (isCliEntry()) {
  try {
    const json = parseArgs(process.argv.slice(2));
    if (json === null) console.log(DOCTOR_USAGE);
    else {
      const result = await runDoctor();
      console.log(json ? JSON.stringify(result, null, 2) : formatDoctor(result).join("\n"));
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Pota doctor error: ${error.message}`);
    process.exitCode = 2;
  }
}

export async function runDoctor({ env = process.env, pluginRoot = resolvePluginRoot(import.meta.url), nodeVersion = process.version } = {}) {
  const checks = [];
  const home = potaHome(env);
  const versionRead = readJson(join(pluginRoot, "package.json"));
  const version = typeof versionRead.value?.version === "string" ? versionRead.value.version : null;

  const nodeMajor = Number(String(nodeVersion).replace(/^v/, "").split(".")[0]);
  checks.push({ label: "node", ok: Number.isInteger(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR, value: `${nodeVersion} (requires >=${MIN_NODE_MAJOR})` });

  const writable = writableDirectory(home);
  checks.push({ label: "potaHome", ok: writable, value: `${home} (${writable ? "writable" : "not writable"})` });

  checks.push(versionSurfaces(pluginRoot));

  const missing = REQUIRED_PATHS.filter((entry) => !hasType(join(pluginRoot, ...entry.path.split("/")), entry.type)).map((entry) => entry.path);
  checks.push({ label: "required files", ok: missing.length === 0, value: missing.length === 0 ? "present" : `missing ${missing.join(", ")}` });

  let legacy;
  try {
    legacy = await inspectLegacyManifest({ env });
  } catch (error) {
    legacy = { status: "blocked", reason: error.message };
  }
  const leftovers = legacy.status === "none" ? legacyDirectories(env).filter((path) => hasType(path, "directory")) : [];
  checks.push({
    label: "legacy install",
    ok: legacy.status !== "blocked",
    value: legacy.status === "none" ? `none${leftovers.length > 0 ? `; leftover directories: ${leftovers.join(", ")}` : ""}`
      : legacy.status === "present" ? `present ${legacy.version} (hosts: ${legacy.hosts.join(",")})`
        : `blocked ${legacy.reason}`,
  });

  const reports = readMigrationReports({ env });
  const blockedHosts = Object.values(reports).filter((report) => report.status === "blocked").map((report) => report.host);
  checks.push({
    label: "legacy migration",
    ok: legacy.status === "none" || blockedHosts.length === 0,
    value: Object.keys(reports).length === 0 ? "none" : Object.values(reports).map((report) => `${report.host} ${report.status}`).join(", "),
  });

  return {
    ok: checks.every((check) => check.ok),
    version,
    pluginRoot,
    node: nodeVersion,
    potaHome: { path: home, writable },
    checks,
    legacyInstall: { ...legacy, leftoverDirectories: leftovers },
    migration: reports,
    commentChecker: commentCheckerStatus(env, home),
  };
}

export function formatDoctor(result) {
  const lines = [`version: ${result.version ?? "unknown"}`, `pluginRoot: ${result.pluginRoot}`];
  for (const check of result.checks) {
    lines.push(`${check.ok ? "OK" : "FAIL"} ${check.label}: ${check.value}`);
    if (check.label !== "legacy migration") continue;
    for (const report of Object.values(result.migration)) {
      const reason = report.reason ? ` (${report.reason})` : "";
      lines.push(`  ${report.host}: ${report.status}${reason} at ${report.at}, removed ${listLength(report.removed)}, kept ${listLength(report.modified)}`);
      for (const path of Array.isArray(report.modified) ? report.modified : []) lines.push(`    kept: ${path}`);
      for (const command of Array.isArray(report.manual) ? report.manual : []) lines.push(`    manual: ${command}`);
    }
  }
  lines.push(`comment-checker: ${result.commentChecker}`);
  return lines;
}

function versionSurfaces(pluginRoot) {
  const found = [];
  const absent = [];
  const invalid = [];
  for (const surface of VERSION_SURFACES) {
    const read = readJson(join(pluginRoot, ...surface.split("/")));
    if (read.status === "missing") absent.push(surface);
    else if (read.status !== "ok" || typeof read.value?.version !== "string") invalid.push(surface);
    else found.push({ surface, version: read.value.version });
  }
  const versions = [...new Set(found.map((entry) => entry.version))];
  const packageFound = found.some((entry) => entry.surface === "package.json");
  const ok = packageFound && invalid.length === 0 && versions.length === 1;
  const parts = [found.map((entry) => `${entry.surface}=${entry.version}`).join(", ") || "no readable version"];
  if (absent.length > 0) parts.push(`absent: ${absent.join(", ")}`);
  if (invalid.length > 0) parts.push(`invalid: ${invalid.join(", ")}`);
  return { label: "version surfaces", ok, value: ok ? `${versions[0]} (${parts.join("; ")})` : parts.join("; ") };
}

// The same on/off rule and file layout as the comment-checker module, read without importing it.
function commentCheckerStatus(env, home) {
  const raw = env.POTA_COMMENT_CHECKER;
  if (typeof raw === "string" && OFF_VALUES.has(raw.trim().toLowerCase())) return "disabled";
  const config = readJson(join(home, "config.json"));
  if (config.status === "ok" && config.value?.commentChecker === false) return "disabled";
  const root = join(home, "tools", "comment-checker");
  let entries = [];
  try { entries = readdirSync(root); } catch { entries = []; }
  for (const entry of entries.filter((name) => /^v\d+\.\d+\.\d+$/.test(name)).sort().reverse()) {
    if (["comment-checker", "comment-checker.exe"].some((name) => hasType(join(root, entry, name), "file"))) return `ready ${entry.slice(1)}`;
  }
  const lastError = readJson(join(root, "state.json")).value?.lastError;
  return typeof lastError === "string" && lastError.length > 0
    ? `not downloaded (last attempt failed: ${lastError})`
    : "not downloaded yet (fetched in the background at the next session start)";
}

function writableDirectory(path) {
  let current = path;
  while (true) {
    try {
      if (!lstatSync(current).isDirectory() && !isDirectoryThroughLink(current)) return false;
      accessSync(current, fsConstants.W_OK);
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") return false;
      const parent = dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }
}

function isDirectoryThroughLink(path) {
  try { return lstatSync(realpathSync(path)).isDirectory(); } catch { return false; }
}

function hasType(path, type) {
  try {
    const info = lstatSync(path);
    return type === "directory" ? info.isDirectory() : info.isFile();
  } catch {
    return false;
  }
}

function readJson(path) {
  let info;
  try { info = lstatSync(path); } catch (error) { return { status: error?.code === "ENOENT" ? "missing" : "invalid" }; }
  if (!info.isFile() || info.size > SMALL_FILE_LIMIT) return { status: "invalid" };
  try { return { status: "ok", value: JSON.parse(readFileSync(path, "utf8")) }; } catch { return { status: "invalid" }; }
}

function listLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function parseArgs(args) {
  let json = false;
  for (const arg of args) {
    if (arg === "--help" || arg === "help") return null;
    if (arg === "--json" && !json) json = true;
    else throw new Error(`Unexpected argument: ${arg}\n${DOCTOR_USAGE}`);
  }
  return json;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}
