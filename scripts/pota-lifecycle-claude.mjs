import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { quoteShellArg, renderMirrorFile, writeLocator } from "./pota-lifecycle-mirror.mjs";

// The DAG pane hooks module that the thin plugin's hooks/hooks.json lists under `modules`.
export const CLAUDE_MOD_ENTRY = "register.tsx";
export const CLAUDE_MOD_TYPES = "./types/index.d.ts";

// Claude Code loads a plugin's default hooks/hooks.json and merges any manifest hooks, and it only expands
// ${CLAUDE_PLUGIN_ROOT}. The shared package hooks use Codex's ${PLUGIN_ROOT}, so Claude gets a separate thin
// plugin whose hooks call the installed canonical runtime by absolute path. Commands and agents stay in the
// existing ~/.claude mirrors so they are not listed twice. The plugin also carries the claude-mod DAG pane.
export async function stageClaudePlugin({
  stageRoot, runtimeStage, destinationRoot, runtimeRoot, marketplaceName, pluginName,
  releaseVersion, skillNames, platform = process.platform,
}) {
  const staged = join(stageRoot, "claude-plugin");
  const pluginDir = join(staged, pluginName);
  const packageJson = JSON.parse(await readFile(join(runtimeStage, "package.json"), "utf8"));
  const description = packageJson.description ?? "Pota agent harness";
  // The mod's $.state refs name their owning plugin literally, so the mod only works under this plugin name.
  const modManifest = JSON.parse(await readFile(join(runtimeStage, "claude-mod", ".claude-plugin", "plugin.json"), "utf8"));
  if (modManifest.name !== pluginName) throw new Error("Claude mod manifest name must match the plugin name");

  await writeJson(join(staged, ".claude-plugin", "marketplace.json"), {
    name: marketplaceName,
    description: "Local Pota marketplace managed by `pota install`",
    owner: { name: packageJson.author?.name ?? "Pota" },
    plugins: [{ name: pluginName, source: `./${pluginName}`, description, version: releaseVersion }],
  });
  await writeJson(join(pluginDir, ".claude-plugin", "plugin.json"), {
    name: pluginName,
    version: releaseVersion,
    description,
    author: { name: packageJson.author?.name ?? "Pota" },
    ...(packageJson.homepage ? { homepage: packageJson.homepage } : {}),
    ...(packageJson.license ? { license: packageJson.license } : {}),
    types: CLAUDE_MOD_TYPES,
  });
  await writeJson(join(pluginDir, "hooks", "hooks.json"), await claudeHooks(runtimeStage, runtimeRoot, platform));
  await stageClaudeMod(runtimeStage, pluginDir, runtimeRoot);

  for (const name of skillNames) {
    const skillStage = join(pluginDir, "skills", name);
    await cp(join(runtimeStage, "skills", name), skillStage, { recursive: true });
    const locatorPath = join(destinationRoot, pluginName, "skills", name, "references", "pota-runtime.json");
    await renderMirrorFile(join(runtimeStage, "skills", name, "SKILL.md"), join(skillStage, "SKILL.md"), {
      locatorPath, runtimeRoot, includeLocatorNotice: true,
    });
    await writeLocator(join(skillStage, "references", "pota-runtime.json"), runtimeRoot);
  }
  return staged;
}

async function claudeHooks(runtimeStage, runtimeRoot, platform) {
  const source = JSON.parse(await readFile(join(runtimeStage, "hooks", "hooks.json"), "utf8"));
  const stateScript = quoteShellArg(join(runtimeRoot, "scripts", "pota-state.mjs"), platform);
  const hooks = {};
  for (const [eventName, groups] of Object.entries(source.hooks ?? {})) {
    hooks[eventName] = groups.map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).map((handler) => {
        const event = String(handler.command ?? "").match(/pota-state\.mjs"?\s+([a-z-]+)\s*$/)?.[1];
        if (!event) throw new Error(`Unsupported Pota hook command for Claude Code: ${handler.command}`);
        return { ...handler, command: `node ${stateScript} ${event}` };
      }),
    }));
  }
  const { modules } = JSON.parse(await readFile(join(runtimeStage, "claude-mod", "hooks", "hooks.json"), "utf8"));
  return { hooks, modules };
}

// The mod's hooks folder minus its dev hooks.json (the plugin's hooks.json above lists the module), its state
// contract, and a runtime locator the module reads to find the installed CLI.
async function stageClaudeMod(runtimeStage, pluginDir, runtimeRoot) {
  const modRoot = join(runtimeStage, "claude-mod");
  // Copied entry by entry: the path form a `cp` filter receives differs on Windows Node 18.
  for (const entry of (await readdir(join(modRoot, "hooks"))).sort()) {
    if (entry !== "hooks.json") await cp(join(modRoot, "hooks", entry), join(pluginDir, "hooks", entry), { recursive: true });
  }
  await mkdir(join(pluginDir, "types"), { recursive: true });
  await cp(join(modRoot, "types", "index.d.ts"), join(pluginDir, "types", "index.d.ts"));
  await writeLocator(join(pluginDir, "pota-runtime.json"), runtimeRoot);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Registration goes through the documented `claude plugin` CLI. CLAUDE_CONFIG_DIR is only set when the caller
// overrode the Claude home, because setting it for the default home would move Claude's global config file.
// A registration that points at `marketplaceRoot` is Pota's own; any other directory stays foreign.
export function createClaudeRegistration({
  claudeHome, claudeHomeOverridden, marketplaceRoot, marketplaceName, pluginName, releaseVersion,
}) {
  const cli = process.env.POTA_CLAUDE_CLI ?? "claude";
  const pluginId = `${pluginName}@${marketplaceName}`;
  const env = claudeHomeOverridden ? { ...process.env, CLAUDE_CONFIG_DIR: claudeHome } : process.env;

  // A .mjs/.js override runs through the current Node binary so tests can supply a portable stand-in CLI.
  function run(args) {
    if (/\.m?js$/.test(cli)) return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, timeout: 120_000 });
    return spawnSync(cli, args, { encoding: "utf8", env, timeout: 120_000, shell: process.platform === "win32" });
  }

  function available() {
    if (cli === "none") return false;
    const result = run(["--version"]);
    return !result.error && result.status === 0;
  }

  function json(args) {
    const result = run([...args, "--json"]);
    if (result.error || result.status !== 0) {
      throw new Error(`claude ${args.join(" ")} failed: ${(result.stderr || result.stdout || result.error?.message || "").trim().split("\n").at(-1)}`);
    }
    const text = result.stdout.trim();
    try {
      return JSON.parse(text);
    } catch {
      return JSON.parse(text.split("\n").filter(Boolean).at(-1));
    }
  }

  const ownsMarketplace = (entry) => entry?.name === marketplaceName
    && typeof entry.path === "string" && resolve(entry.path) === resolve(marketplaceRoot);
  const ownedPlugins = (list) => (Array.isArray(list) ? list : [])
    .filter((entry) => entry?.id === pluginId && entry.scope === "user");

  function status({ checked = false } = {}) {
    if (!checked && !available()) return { available: false, marketplace: false, installed: false, enabled: false };
    const marketplace = json(["plugin", "marketplace", "list"]).find((entry) => entry?.name === marketplaceName) ?? null;
    const plugin = ownedPlugins(json(["plugin", "list"]))[0] ?? null;
    return {
      available: true,
      marketplace: ownsMarketplace(marketplace),
      foreignMarketplace: Boolean(marketplace) && !ownsMarketplace(marketplace),
      installed: Boolean(plugin),
      enabled: Boolean(plugin?.enabled),
      version: plugin?.version,
    };
  }

  function register() {
    if (!available()) return { registered: false, cliMissing: true, reason: "claude CLI not found" };
    const current = status({ checked: true });
    if (current.foreignMarketplace) {
      return { registered: false, reason: `a different Claude Code marketplace named "${marketplaceName}" already exists` };
    }
    if (!current.marketplace) json(["plugin", "marketplace", "add", marketplaceRoot, "--scope", "user"]);
    // A fresh install copies the current marketplace version into Claude Code's plugin cache.
    if (!current.installed) {
      json(["plugin", "install", pluginId, "--scope", "user"]);
      return { registered: true };
    }
    if (!current.enabled) json(["plugin", "enable", pluginId, "--scope", "user"]);
    if (current.version === releaseVersion) return { registered: true };
    return { registered: true, cacheRefresh: refreshCache(current.version) };
  }

  // An existing install keeps serving its cached copy until `plugin update` replaces it. The update is only
  // requested when the cached version differs, so re-running install on a current cache stays a no-op.
  function refreshCache(cachedVersion) {
    try {
      json(["plugin", "marketplace", "update", marketplaceName]);
    } catch {
      // A directory marketplace needs no refresh; `plugin update` below still reads the current files.
    }
    try {
      json(["plugin", "update", pluginId, "--scope", "user"]);
      // Without a reported version there is nothing to verify; the update itself is the best available signal.
      if (cachedVersion === undefined) return { refreshed: true };
      const version = ownedPlugins(json(["plugin", "list"]))[0]?.version;
      if (version !== releaseVersion) {
        return { refreshed: false, reason: `${pluginId} is still at ${version ?? "an unknown version"} (expected ${releaseVersion})` };
      }
      return { refreshed: true };
    } catch (error) {
      return { refreshed: false, reason: error.message };
    }
  }

  function unregister() {
    if (!available()) return { unregistered: false, reason: "claude CLI not found" };
    const current = status({ checked: true });
    // Only remove a registration that points at Pota's own marketplace directory.
    if (!current.marketplace) return { unregistered: false, reason: "no Pota-owned Claude Code marketplace is registered" };
    if (current.installed) json(["plugin", "uninstall", pluginId, "--scope", "user"]);
    json(["plugin", "marketplace", "remove", marketplaceName]);
    return { unregistered: true };
  }

  return { available, register, status, unregister, pluginId };
}
