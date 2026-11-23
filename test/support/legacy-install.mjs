import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Builds a fake 1.4.0 npm installation in a fresh temp home. Every path variable the installer and the migration read
// points into that home, so nothing here can reach the real ~/.pota, ~/.claude, ~/.codex, or ~/.gemini. The target
// list comes from the manifest that the real 1.4.0 installer wrote (test/fixtures/legacy-lifecycle-1.4.0.json), and
// the digests are computed here, independently of scripts/pota-legacy-migration.mjs.
export const fixturePath = fileURLToPath(new URL("../fixtures/legacy-lifecycle-1.4.0.json", import.meta.url));
export const ALL_HOSTS = ["codex", "claude", "antigravity"];
const HARNESS_HOOK_HASH = `sha256:${"b".repeat(64)}`;
const LEGACY_HOOK_HASH = `sha256:${"a".repeat(64)}`;

export function isolatedEnv(temp, home, extra = {}) {
  const env = {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home,
    USERPROFILE: home,
    POTA_HOME: join(home, ".pota"),
    CLAUDE_HOME: join(home, ".claude"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    CODEX_HOME: join(home, ".codex"),
    CODEX_CONFIG_PATH: join(home, ".codex", "config.toml"),
    ANTIGRAVITY_HOME: join(home, ".gemini", "config"),
    ANTIGRAVITY_CLI_HOME: join(home, ".gemini", "antigravity-cli"),
    POTA_CLAUDE_CLI: join(temp, "fake-claude.mjs"),
    POTA_COMMENT_CHECKER: "0",
    LANG: "en_US.UTF-8",
    ...extra,
  };
  return env;
}

export function hostOfId(id) {
  if (id === "runtime") return "core";
  if (["codex-source", "marketplace", "codex-runtime", "codex-config"].includes(id)) return "codex";
  if (id.startsWith("claude-")) return "claude";
  return "antigravity";
}

// The fixture with `<HOME>` mapped onto `home` using this platform's separators.
export async function fixtureManifest(home) {
  const manifest = JSON.parse(await readFile(fixturePath, "utf8"));
  for (const record of manifest.targets) record.path = mapHome(record.path, home);
  return manifest;
}

function mapHome(path, home) {
  if (!path.startsWith("<HOME>/")) throw new Error(`Fixture path outside <HOME>: ${path}`);
  return join(home, ...path.slice("<HOME>/".length).split("/"));
}

export function codexConfig(marketplaceRoot) {
  const segments = {
    user: '# user settings\nmodel = "gpt-5"\n\n',
    harnessMarketplace: '[marketplaces.pota-harness]\nsource_type = "git"\nsource = "comento/pota-harness"\n\n',
    legacyMarketplace: `[marketplaces.pota]\nlast_updated = "2026-11-20T00:00:00Z"\nsource_type = "local"\nsource = ${JSON.stringify(marketplaceRoot)}\n`,
    legacyPlugin: '[plugins."pota@pota"]\nenabled = true\n',
    trivia: "\n# keep this comment\n",
    harnessPlugin: '[plugins."pota@pota-harness"]\nenabled = true\n',
    legacyHook: `[hooks.state."pota@pota:hooks/hooks.json:session_start:0:0"]\ntrusted_hash = "${LEGACY_HOOK_HASH}"\n`,
    harnessHook: `[hooks.state."pota@pota-harness:hooks/codex.json:session_start:0:0"]\ntrusted_hash = "${HARNESS_HOOK_HASH}"\n`,
    profile: '[profiles.work]\nmodel = "o3"\n',
  };
  const s = segments;
  return {
    before: s.user + s.harnessMarketplace + s.legacyMarketplace + s.legacyPlugin + s.trivia + s.harnessPlugin + s.legacyHook + s.harnessHook + s.profile,
    after: s.user + s.harnessMarketplace + s.trivia + s.harnessPlugin + s.harnessHook + s.profile,
  };
}

// An independent implementation of the 1.4.0 ownership digest.
export async function digestOf(path, type) {
  if (type === "file") return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(relative(path, full).split(sep).join("/"));
    }
  }
  await walk(path);
  const hash = createHash("sha256");
  for (const file of files.sort()) hash.update(`${file}\0`).update(await readFile(join(path, file))).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

async function writeTarget(path, type, id) {
  if (type === "file") {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `legacy ${id}\n`);
    return;
  }
  await mkdir(join(path, "nested"), { recursive: true });
  await writeFile(join(path, "README.md"), `legacy tree ${id}\n`);
  await writeFile(join(path, "nested", `${id}.txt`), `nested ${id}\n`);
}

// options.hosts: the recorded host selection. options.retained: [{ id, version }]. options.claude: "owned" (default),
// "foreign" (a `pota` marketplace elsewhere), or "absent". options.codexConfig: "owned" (default), "foreign", "absent".
export async function createLegacyInstall({ hosts = ALL_HOSTS, retained = [], claude = "owned", codexConfig: configMode = "owned", env: extraEnv = {} } = {}) {
  const temp = await mkdtemp(join(tmpdir(), "pota-legacy-"));
  const home = join(temp, "home");
  const env = isolatedEnv(temp, home, extraEnv);
  const manifest = await fixtureManifest(home);
  manifest.hosts = ALL_HOSTS.filter((host) => hosts.includes(host));
  manifest.targets = manifest.targets.filter((record) => hostOfId(record.id) === "core" || manifest.hosts.includes(hostOfId(record.id)));
  const potaHome = env.POTA_HOME;
  const codexMarketplaceRoot = join(potaHome, "install", "codex");
  const config = codexConfig(codexMarketplaceRoot);
  for (const record of manifest.targets) {
    if (record.type === "config") {
      if (configMode === "absent") continue;
      await mkdir(dirname(record.path), { recursive: true });
      await writeFile(record.path, configMode === "foreign" ? codexConfig(join(temp, "elsewhere")).before : config.before);
      continue;
    }
    await writeTarget(record.path, record.type, record.id);
    record.installedDigest = await digestOf(record.path, record.type);
  }
  manifest.retained = [];
  for (const entry of retained) {
    const path = entry.id === "runtime"
      ? join(potaHome, "install", "runtime", entry.version)
      : join(env.CODEX_HOME, "plugins", "cache", "pota", "pota", entry.version);
    await writeTarget(path, "tree", `retained-${entry.id}-${entry.version}`);
    manifest.retained.push({ id: entry.id, version: entry.version, path, installedDigest: await digestOf(path, "tree"), retiredAt: "2026-11-19T00:00:00.000Z" });
  }
  const manifestPath = join(potaHome, "install", "lifecycle.json");
  await writeManifest(manifestPath, manifest);
  await mkdir(join(potaHome, "install", "transactions"), { recursive: true });

  const keep = {
    goalState: join(potaHome, "projects", "project-x", "worktrees", "worktree-y", "state.json"),
    config: join(potaHome, "config.json"),
    checker: join(potaHome, "tools", "comment-checker", "v0.8.2", "comment-checker"),
  };
  for (const [name, path] of Object.entries(keep)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `keep ${name}\n`);
  }
  const update = join(potaHome, "update");
  await mkdir(join(update, "stage", "node_modules"), { recursive: true });
  for (const name of ["state.json", "notice.json", "last-run.log", "plugin-notice.json"]) await writeFile(join(update, name), `${name}\n`);
  await writeFile(join(update, "stage", "node_modules", "marker"), "stage\n");

  await writeFile(join(temp, "fake-claude.mjs"), FAKE_CLAUDE_SOURCE);
  const claudeMarketplaces = [{ name: "pota-harness", source: "github", path: join(temp, "claude-marketplaces", "pota-harness") }];
  if (claude === "owned") claudeMarketplaces.push({ name: "pota", source: "directory", path: join(potaHome, "install", "claude") });
  if (claude === "foreign") claudeMarketplaces.push({ name: "pota", source: "directory", path: join(temp, "someone-else", "pota") });
  await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
  await writeFile(join(env.CLAUDE_CONFIG_DIR, "fake-claude-state.json"), JSON.stringify({
    marketplaces: claudeMarketplaces,
    plugins: [
      ...(claude === "absent" ? [] : [{ id: "pota@pota", scope: "user", enabled: true, version: "1.4.0" }]),
      { id: "pota@pota-harness", scope: "user", enabled: true, version: "2.0.0" },
    ],
  }, null, 2));

  return {
    temp,
    home,
    env,
    manifest,
    manifestPath,
    keep,
    update,
    config,
    claudeLog: join(env.CLAUDE_CONFIG_DIR, "fake-claude.log"),
    claudeState: join(env.CLAUDE_CONFIG_DIR, "fake-claude-state.json"),
    target: (id) => manifest.targets.find((record) => record.id === id),
    hostTargets: (host) => manifest.targets.filter((record) => record.type !== "config" && hostOfId(record.id) === host),
    writeManifest: (value) => writeManifest(manifestPath, value),
    cleanup: () => rm(temp, { recursive: true, force: true }),
  };
}

async function writeManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function withLegacyInstall(options, operation) {
  const install = await createLegacyInstall(options);
  try {
    return await operation(install);
  } finally {
    await install.cleanup();
  }
}

export function pathExists(path) {
  return existsSync(path);
}

// Every entry under `root` with its content digest; `skip` lists relative paths (and their subtrees) to leave out.
export async function snapshot(root, skip = []) {
  const result = {};
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const key = relative(root, path).split(sep).join("/");
      if (skip.some((prefix) => key === prefix || key.startsWith(`${prefix}/`))) continue;
      const info = await lstat(path);
      if (info.isSymbolicLink()) result[key] = `symlink:${await readlink(path)}`;
      else if (info.isDirectory()) {
        result[`${key}/`] = "directory";
        await visit(path);
      } else result[key] = createHash("sha256").update(await readFile(path)).digest("hex");
    }
  }
  await visit(root);
  return result;
}

export async function readClaudeLog(install) {
  try { return (await readFile(install.claudeLog, "utf8")).trim().split("\n").filter(Boolean); } catch { return []; }
}

const FAKE_CLAUDE_SOURCE = `// Stand-in for the claude plugin CLI. State lives in CLAUDE_CONFIG_DIR; every call is logged there.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.CLAUDE_CONFIG_DIR;
if (!home) {
  console.error("fake claude requires CLAUDE_CONFIG_DIR");
  process.exit(2);
}
mkdirSync(home, { recursive: true });
const statePath = join(home, "fake-claude-state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { marketplaces: [], plugins: [] };
const args = process.argv.slice(2).filter((arg) => arg !== "--json");
appendFileSync(join(home, "fake-claude.log"), args.join(" ") + "\\n");
const fail = () => { console.log(JSON.stringify({ outcome: "failed" })); process.exit(1); };
if (process.env.FAKE_CLAUDE_FAIL && args.join(" ").startsWith(process.env.FAKE_CLAUDE_FAIL)) fail();
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const ok = () => console.log(JSON.stringify({ outcome: "ok" }));
const [first, second, third, fourth] = args;
if (first === "--version") console.log("0.0.0 (fake Claude Code)");
else if (first === "plugin" && second === "marketplace" && third === "list") console.log(JSON.stringify(state.marketplaces));
else if (first === "plugin" && second === "list") console.log(JSON.stringify(state.plugins));
else if (first === "plugin" && second === "uninstall") {
  state.plugins = state.plugins.filter((plugin) => plugin.id !== third);
  save();
  ok();
} else if (first === "plugin" && second === "marketplace" && third === "remove") {
  state.marketplaces = state.marketplaces.filter((marketplace) => marketplace.name !== fourth);
  state.plugins = state.plugins.filter((plugin) => !plugin.id.endsWith("@" + fourth));
  save();
  ok();
} else fail();
`;
