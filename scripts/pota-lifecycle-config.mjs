import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { join } from "node:path";

export function updateConfig(config, hookStates, { marketplacePath } = {}) {
  if (marketplacePath === undefined) throw new Error("Pota marketplace path is required");
  let next = removePotaConfig(config);
  next = append(next, `[marketplaces.pota]\nlast_updated = ${JSON.stringify(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))}\nsource_type = "local"\nsource = ${JSON.stringify(marketplacePath)}\n`);
  next = append(next, '[plugins."pota@pota"]\nenabled = true\n');
  for (const state of hookStates) next = append(next, `[hooks.state.${JSON.stringify(state.key)}]\ntrusted_hash = ${JSON.stringify(state.trustedHash)}\n`);
  return next;
}

export function removePotaConfig(config) {
  return splitSections(config).map((section) => isPotaConfigSection(section)
    ? splitTrailingTomlTrivia(section.text).trivia
    : section.text).join("");
}

export function potaConfigProjection(config) {
  return splitSections(config).filter(isPotaConfigSection)
    .map((section) => splitTrailingTomlTrivia(section.text).body).join("");
}

function isPotaConfigSection(section) {
  return section.header === "marketplaces.pota"
    || section.header === 'plugins."pota@pota"'
    || (section.header?.startsWith("hooks.state.") && section.header.includes("pota@pota:"));
}

function splitTrailingTomlTrivia(text) {
  const lines = text.split(/(?<=\n)/);
  let boundary = lines.length;
  while (boundary > 0) {
    const line = lines[boundary - 1];
    if (line.length === 0 || line.trim().length === 0 || line.trimStart().startsWith("#")) boundary -= 1;
    else break;
  }
  return { body: lines.slice(0, boundary).join(""), trivia: lines.slice(boundary).join("") };
}

export async function readSharedConfigSnapshot(path) {
  let pathInfo;
  try {
    pathInfo = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, text: "", digest: "missing" };
    throw error;
  }
  if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) throw new Error(`Managed config is not a regular file: ${path}`);
  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
    handle = await open(path, flags);
  } catch (error) {
    if (["ELOOP", "EFTYPE", "ENXIO"].includes(error?.code)) throw new Error(`Managed config is not a regular file: ${path}`);
    throw error;
  }
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile() || openedInfo.dev !== pathInfo.dev || openedInfo.ino !== pathInfo.ino) {
      throw new Error(`Managed config changed identity while opening: ${path}`);
    }
    const text = await handle.readFile("utf8");
    return { exists: true, text, digest: sha(text) };
  } finally {
    await handle.close();
  }
}

export function ensureSetting(config, sectionName, key, value) {
  const sections = splitSections(config);
  const index = sections.findIndex((section) => section.header === sectionName);
  if (index === -1) return append(config, `[${sectionName}]\n${key} = ${value}\n`);
  const lines = sections[index].text.trimEnd().split("\n");
  const settingIndex = lines.findIndex((line) => line.trim().startsWith(`${key} =`));
  if (settingIndex === -1) lines.push(`${key} = ${value}`);
  else lines[settingIndex] = `${key} = ${value}`;
  sections[index].text = `${lines.join("\n")}\n`;
  return sections.map((section) => section.text).join("");
}

export function hasSetting(config, sectionName, key, value) {
  const section = splitSections(config).find((candidate) => candidate.header === sectionName);
  return section?.text.split("\n").some((line) => line.trim() === `${key} = ${value}`) ?? false;
}

export function splitSections(config) {
  const result = [];
  let current = { header: null, text: "" };
  let multiline = null;
  for (const line of config.split(/(?<=\n)/)) {
    const delimiterCount = (delimiter) => line.split(delimiter).length - 1;
    if (multiline) {
      current.text += line;
      if (delimiterCount(multiline) % 2 === 1) multiline = null;
      continue;
    }
    const doubleCount = delimiterCount('"""');
    const singleCount = delimiterCount("'''");
    // Array-of-tables and headers with trailing comments start a new section too; otherwise a foreign section
    // after Pota's would be absorbed into it and deleted on upgrade/uninstall.
    const trimmed = line.trim();
    const arrayMatch = trimmed.match(/^\[\[([^\[\]]+)\]\]\s*(?:#.*)?$/);
    const match = arrayMatch ? null : trimmed.match(/^\[([^\[\]]+)\]\s*(?:#.*)?$/);
    if (arrayMatch || match) {
      if (current.text.length > 0) result.push(current);
      current = { header: arrayMatch ? `[${arrayMatch[1].trim()}]` : match[1].trim(), text: line };
    } else current.text += line;
    if (doubleCount % 2 === 1) multiline = '"""';
    else if (singleCount % 2 === 1) multiline = "'''";
  }
  if (current.text.length > 0) result.push(current);
  return result;
}

export async function trustedHookStates(root) {
  const parsed = JSON.parse(await readFile(join(root, "hooks", "hooks.json"), "utf8"));
  const states = [];
  const labels = { SessionStart: "session_start", UserPromptSubmit: "user_prompt_submit", PostToolUse: "post_tool_use", Stop: "stop", SubagentStop: "subagent_stop" };
  for (const [eventName, groups] of Object.entries(parsed?.hooks ?? {})) {
    const eventLabel = labels[eventName];
    if (!eventLabel || !Array.isArray(groups)) continue;
    for (const [groupIndex, group] of groups.entries()) for (const [handlerIndex, handler] of (group.hooks ?? []).entries()) {
      states.push({ key: `pota@pota:hooks/hooks.json:${eventLabel}:${groupIndex}:${handlerIndex}`, trustedHash: hookHash(eventLabel, group.matcher, handler) });
    }
  }
  return states;
}

export function hookHash(eventName, matcher, handler) {
  const normalized = { type: "command", command: handler.command, timeout: Math.max(Number(handler.timeout ?? 600), 1), async: false };
  if (typeof handler.statusMessage === "string") normalized.statusMessage = handler.statusMessage;
  const identity = { event_name: eventName, hooks: [normalized] };
  if (typeof matcher === "string") identity.matcher = matcher;
  return sha(JSON.stringify(canonical(identity)));
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function append(config, block) {
  if (config.length === 0) return `${block.trimEnd()}\n`;
  return `${config}${config.endsWith("\n") ? "" : "\n"}${block.trimEnd()}\n`;
}

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
