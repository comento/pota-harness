import { copyFile, cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { readSharedConfigSnapshot, trustedHookStates } from "./pota-lifecycle-config.mjs";
import {
  antigravityRuntimeLocatorPath, antigravitySkillLocatorPath, renderMirrorFile, writeLocator,
} from "./pota-lifecycle-mirror.mjs";
import { stageClaudePlugin } from "./pota-lifecycle-claude.mjs";
import { HOSTS } from "./pota-lifecycle-hosts.mjs";

export function createStaging(context) {
  const {
    agentNames, antigravityCliHome, antigravityHome, claudeHome, claudePluginMarketplaceRoot,
    claudeRuntimeLocatorPath, codexRuntimeRoot, commandNames, releaseVersion, configPath, installedPluginRoot,
    marketplaceJsonPath, marketplaceName, pluginName,
    pluginRoot, runtimeRoot, skillNames, updateConfig, assertRegularTree,
  } = context;
// The canonical runtime is always staged; each selected host adds its own targets (see pota-lifecycle-hosts.mjs).
async function stageInstall(stageRoot, hosts = HOSTS) {
  const targets = [];
  const add = (id, phase, destination, staged, type = "tree", details = {}) => targets.push({ id, phase, path: destination, staged, type, ...details });
  // Every copy carries locators to the canonical runtime, so mirrors and hooks never depend on a host cache.
  const runtimeStage = join(stageRoot, "runtime");
  await copyPluginCandidate(runtimeStage, runtimeRoot);
  add("runtime", "core", runtimeRoot, runtimeStage);
  if (hosts.includes("codex")) await stageCodex(stageRoot, add);
  if (hosts.includes("claude")) await stageClaude(stageRoot, runtimeStage, add);
  if (hosts.includes("antigravity")) {
    await stageAntigravity(targets, stageRoot, runtimeStage, antigravityHome, "ide", false);
    await stageAntigravity(targets, stageRoot, runtimeStage, antigravityCliHome, "cli", true);
  }
  if (hosts.includes("codex")) {
    const configStage = join(stageRoot, "config.toml");
    const hookStates = await trustedHookStates(runtimeStage);
    const configSnapshot = await readSharedConfigSnapshot(configPath);
    await writeFile(configStage, updateConfig(configSnapshot.text, hookStates));
    add("codex-config", "config", configPath, configStage, "config", { configSourceDigest: configSnapshot.digest });
  }
  for (const target of targets) await assertRegularTree(target.staged);
  return targets;
}

async function stageCodex(stageRoot, add) {
  const sourceStage = join(stageRoot, "codex-source");
  const codexRuntimeStage = join(stageRoot, "codex-runtime");
  await copyPluginCandidate(sourceStage, runtimeRoot);
  await copyPluginCandidate(codexRuntimeStage, runtimeRoot);
  add("codex-source", "codex", installedPluginRoot, sourceStage);
  add("codex-runtime", "codex", codexRuntimeRoot, codexRuntimeStage);

  const marketplaceStage = join(stageRoot, "marketplace.json");
  await writeFile(marketplaceStage, `${JSON.stringify({
    name: marketplaceName,
    interface: { displayName: "Pota" },
    plugins: [{ name: pluginName, source: { source: "local", path: "./plugins/pota" }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }],
  }, null, 2)}\n`);
  add("marketplace", "codex", marketplaceJsonPath, marketplaceStage, "file");
}

async function stageClaude(stageRoot, runtimeStage, add) {
  const claudeLocator = join(stageRoot, "claude-runtime.json");
  await writeLocator(claudeLocator, runtimeRoot);
  add("claude-runtime", "claude", claudeRuntimeLocatorPath, claudeLocator, "file");
  for (const name of commandNames()) {
    const staged = join(stageRoot, "claude-commands", `pota-${name}.md`);
    await renderMirrorFile(join(runtimeStage, ".claude", "commands", `pota-${name}.md`), staged, { locatorPath: claudeRuntimeLocatorPath, runtimeRoot });
    add(`claude-command-${name}`, "claude", join(claudeHome, "commands", `pota-${name}.md`), staged, "file");
  }
  for (const name of agentNames()) {
    const staged = join(stageRoot, "claude-agents", `pota-${name}.md`);
    await renderMirrorFile(join(runtimeStage, ".claude", "agents", `${name}.md`), staged, { locatorPath: claudeRuntimeLocatorPath, runtimeRoot });
    add(`claude-agent-${name}`, "claude", join(claudeHome, "agents", `pota-${name}.md`), staged, "file");
  }

  const claudePluginStage = await stageClaudePlugin({
    stageRoot, runtimeStage, destinationRoot: claudePluginMarketplaceRoot, runtimeRoot,
    marketplaceName, pluginName, releaseVersion, skillNames: skillNames(),
  });
  add("claude-plugin", "claude", claudePluginMarketplaceRoot, claudePluginStage);
}

async function stageAntigravity(targets, stageRoot, runtimeStage, destinationRoot, label, flatSkills) {
  const locatorPath = antigravityRuntimeLocatorPath(destinationRoot);
  const locatorStage = join(stageRoot, `${label}-runtime.json`);
  await writeLocator(locatorStage, runtimeRoot);
  targets.push({ id: `${label}-runtime`, phase: "antigravity", path: locatorPath, staged: locatorStage, type: "file" });
  for (const name of skillNames()) {
    if (flatSkills) {
      const staged = join(stageRoot, `${label}-skills`, `${name}.md`);
      await renderMirrorFile(join(runtimeStage, "skills", name, "SKILL.md"), staged, { locatorPath, runtimeRoot, includeLocatorNotice: true });
      targets.push({ id: `${label}-skill-${name}`, phase: "antigravity", path: join(destinationRoot, "skills", `${name}.md`), staged, type: "file" });
    } else {
      const staged = join(stageRoot, `${label}-skills`, name);
      await cp(join(runtimeStage, "skills", name), staged, { recursive: true });
      await renderMirrorFile(join(runtimeStage, "skills", name, "SKILL.md"), join(staged, "SKILL.md"), {
        locatorPath: antigravitySkillLocatorPath(destinationRoot, name),
        runtimeRoot,
        includeLocatorNotice: true,
      });
      await writeLocator(join(staged, "references", "pota-runtime.json"), runtimeRoot);
      targets.push({ id: `${label}-skill-${name}`, phase: "antigravity", path: join(destinationRoot, "skills", name), staged, type: "tree" });
    }
  }
  for (const name of commandNames()) {
    const staged = join(stageRoot, `${label}-workflows`, `pota-${name}.md`);
    await renderMirrorFile(join(runtimeStage, ".agents", "workflows", `pota-${name}.md`), staged, { locatorPath, runtimeRoot });
    targets.push({ id: `${label}-workflow-${name}`, phase: "antigravity", path: join(destinationRoot, "workflows", `pota-${name}.md`), staged, type: "file" });
  }
}

async function copyPluginCandidate(destination, locatorRoot) {
  await copyPluginTree(pluginRoot, destination);
  const manifestPath = join(destination, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.hooks = "./hooks/hooks.json";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeLocator(join(destination, ".pota-runtime.json"), locatorRoot);
  for (const name of skillNames()) await writeLocator(join(destination, "skills", name, "references", "pota-runtime.json"), locatorRoot);
}

async function copyPluginTree(source, destination) {
  if (!shouldCopyPluginPath(source, pluginRoot)) return;
  const info = await lstat(source);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
    throw new Error(`Plugin source must contain only regular files and directories: ${source}`);
  }
  if (info.isFile()) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return;
  }
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source);
  entries.sort();
  for (const entry of entries) await copyPluginTree(join(source, entry), join(destination, entry));
}

  return { stageInstall };
}

export function pathHasSegment(path, segment) { return path.split(/[\\/]+/).includes(segment); }

export function shouldCopyPluginPath(source, pluginRoot) {
  const name = source.split(/[\\/]+/).at(-1);
  if ([".git", "node_modules", ".pota"].includes(name)) return false;
  if (sep === "/" && source.includes("\\")) return true;
  const relativePath = relative(pluginRoot, source);
  if (isAbsolute(relativePath)) return true;
  const path = relativePath.split(sep).join("/");
  if (path === "") return true;
  if (path.startsWith("../") || path === "..") return true;
  if (/^(package\.json|LICENSE|README(?:\.[^.]+)?\.md)$/.test(path)) return true;
  if (path === "docs") return true;
  if (path.startsWith("docs/")) return path === "docs/model-guidance" || path.startsWith("docs/model-guidance/");
  return [".agents", ".claude", ".codex-plugin", "agents", "commands", "hooks", "scripts", "skills", "templates"]
    .some((directory) => path === directory || path.startsWith(`${directory}/`));
}
