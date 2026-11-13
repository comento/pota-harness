import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve, win32 } from "node:path";
import {
  RUNTIME_LOCATOR_SCHEMA_VERSION,
  createRuntimeLocator,
  runtimeRequiredPaths,
} from "./pota-paths.mjs";

export function antigravityRuntimeLocatorPath(root) {
  return join(root, "pota", "runtime.json");
}

export function installedSkillLocatorPath(runtimeRoot, name) {
  return join(runtimeRoot, "skills", name, "references", "pota-runtime.json");
}

export function antigravitySkillLocatorPath(root, name) {
  return join(root, "skills", name, "references", "pota-runtime.json");
}

export async function writeLocator(path, root) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(createRuntimeLocator(root), null, 2)}\n`);
}

export async function validRuntimeLocator(path, runtimeRoot) {
  try {
    const locator = JSON.parse(await readFile(path, "utf8"));
    const expected = createRuntimeLocator(runtimeRoot);
    if (locator?.schemaVersion !== RUNTIME_LOCATOR_SCHEMA_VERSION || resolve(locator.pluginRoot ?? ".") !== resolve(runtimeRoot)) return false;
    for (const [name, value] of Object.entries(expected.entrypoints)) if (locator.entrypoints?.[name] !== value) return false;
    for (const [name, value] of Object.entries(expected.resources)) if (locator.resources?.[name] !== value) return false;
    return (await Promise.all(runtimeRequiredPaths(locator).map(exists))).every(Boolean);
  } catch {
    return false;
  }
}

export async function renderMirrorFile(source, destination, { locatorPath, runtimeRoot, includeLocatorNotice = false }) {
  const content = await readFile(source, "utf8");
  const notice = includeLocatorNotice ? `\n\n## Installed Pota runtime\n\nRead the structured runtime locator at \`${JSON.stringify(locatorPath)}\`. Resolve Pota scripts and static resources from its absolute paths, never from the target project.\n` : "";
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${renderInstalledMirror(content, { runtimeRoot, locatorPath }).trimEnd()}${notice}`);
}

export function renderInstalledMirror(content, { runtimeRoot, locatorPath, platform = process.platform }) {
  const platformJoin = platform === "win32" ? win32.join : posix.join;
  const quotedCli = quoteShellArg(platformJoin(runtimeRoot, "scripts", "pota.mjs"), platform);
  let rendered = content.replaceAll("{{POTA_RUNTIME_LOCATOR_JSON}}", JSON.stringify(locatorPath))
    .replace(/\bnode\s+scripts\/pota\.mjs\b/g, `node ${quotedCli}`)
    .replace(/\bnode\s+scripts\/([A-Za-z0-9._/-]+)/g, (_, path) => `node ${quoteShellArg(platformJoin(runtimeRoot, "scripts", path), platform)}`);
  rendered = rendered.replace(/(^|[\s`("'=])(commands|agents|templates|docs\/model-guidance)\/([A-Za-z0-9._<>/-]+)/gm,
    (_, prefix, directory, suffix) => `${prefix}${platformJoin(runtimeRoot, directory, suffix)}`);
  return rendered;
}

export function quoteShellArg(value, platform = process.platform) {
  return platform === "win32" ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", "'\\''")}'`;
}

export async function validateAntigravitySkills(root, skillNames, runtimeRoot) {
  try {
    if (!(await validRuntimeLocator(antigravityRuntimeLocatorPath(root), runtimeRoot))) return false;
    for (const name of skillNames) {
      const content = await readFile(join(root, "skills", `${name}.md`), "utf8");
      if (!/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(content) || !/^name:\s*\S+/m.test(content) || !/^description:\s*\S+/m.test(content)) return false;
      if (!content.includes(JSON.stringify(antigravityRuntimeLocatorPath(root)))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
