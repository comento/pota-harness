import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { potaHome, installRoot as potaInstallRoot, installManifestPath } from "./pota-paths.mjs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// Path constants for the lifecycle: everything lives under <potaHome>/install, except the Codex plugin cache.
// Codex only treats pota@pota as installed when its own plugin cache holds pota/<version>, so that host
// cache stays under CODEX_HOME.
export function createLayout({ env = process.env, releaseVersion, marketplaceName = "pota", pluginName = "pota" }) {
  if (typeof releaseVersion !== "string" || !VERSION_PATTERN.test(releaseVersion)) throw new Error(`Invalid Pota release version: ${releaseVersion}`);
  const homeRoot = env.HOME ?? env.USERPROFILE ?? homedir() ?? ".";
  const codexHome = resolve(env.CODEX_HOME ?? join(homeRoot, ".codex"));
  const potaHomeRoot = potaHome(env);
  const codexCacheRoot = join(codexHome, "plugins", "cache", marketplaceName);
  const codexRuntimeParent = join(codexCacheRoot, pluginName);
  const shared = { potaHomeRoot, codexHome, codexCacheRoot, codexRuntimeParent };

  const installRoot = potaInstallRoot(env);
  const codexMarketplaceRoot = join(installRoot, "codex");
  return layoutPaths({
    ...shared,
    installRoot,
    stateRoot: installRoot,
    ownershipPath: installManifestPath(env),
    marketplaceRoot: codexMarketplaceRoot,
    installedPluginRoot: join(codexMarketplaceRoot, "plugins", pluginName),
    marketplaceJsonPath: join(codexMarketplaceRoot, ".agents", "plugins", "marketplace.json"),
    claudePluginMarketplaceRoot: join(installRoot, "claude"),
    runtimeParent: join(installRoot, "runtime"),
  }, releaseVersion);
}

function layoutPaths(paths, releaseVersion) {
  const runtimeRootFor = (version) => versionedChild(paths.runtimeParent, version);
  const codexRuntimeRootFor = (version) => versionedChild(paths.codexRuntimeParent, version);
  return {
    ...paths,
    transactionPath: join(paths.stateRoot, "transaction.json"),
    transactionRoot: join(paths.stateRoot, "transactions"),
    lifecycleLockPath: join(paths.stateRoot, "lifecycle.lock"),
    runtimeRoot: runtimeRootFor(releaseVersion),
    codexRuntimeRoot: codexRuntimeRootFor(releaseVersion),
    runtimeRootFor,
    codexRuntimeRootFor,
  };
}

function versionedChild(parent, version) {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) throw new Error(`Invalid Pota runtime version: ${version}`);
  return join(parent, version);
}
