import { join } from "node:path";
import { parseModelCeiling } from "./pota-model-tier.mjs";
import { potaHome } from "./pota-paths.mjs";
import { readJsonFile } from "./pota-safe-fs.mjs";

export const NO_MODEL_CEILING = Object.freeze({ ceiling: null, source: null, invalid: null });

const INVALID_VALUE_LENGTH = 40;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/gu;
// JSON.stringify writes an unpaired surrogate as a six-character escape, which would break the notice budgets.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const SOURCE_NAMES = { env: "POTA_MODEL_CEILING", config: "config.json \"modelCeiling\"" };

// POTA_MODEL_CEILING decides when it is set (an invalid value never falls back to config.json); otherwise
// "modelCeiling" in <POTA_HOME>/config.json, the one file every hook and CLI call reads. The home comes from
// process.env, not the injected env, so a test that injects env: {} never reads the real ~/.pota. Never throws or writes.
export function resolveModelCeiling({ env = process.env, home } = {}) {
  try {
    const directory = home ?? potaHome();
    const fromEnv = parseModelCeiling(env?.POTA_MODEL_CEILING);
    if (fromEnv.status !== "unset") return settingFrom(fromEnv, "env", env.POTA_MODEL_CEILING);
    const config = readJsonFile(join(directory, "config.json"));
    if (config.status !== "ok" || !isPlainObject(config.value) || !Object.hasOwn(config.value, "modelCeiling")) return NO_MODEL_CEILING;
    return settingFrom(parseModelCeiling(config.value.modelCeiling), "config", config.value.modelCeiling);
  } catch {
    return NO_MODEL_CEILING;
  }
}

export function invalidModelCeilingWarning({ source, value }) {
  return `Pota warning: ignoring invalid model ceiling ${JSON.stringify(displayValue(value))} from ${modelCeilingSourceName(source)}; use balanced or stronger. No ceiling is applied.`;
}

export function modelCeilingSourceName(source) {
  return SOURCE_NAMES[source] ?? SOURCE_NAMES.env;
}

function settingFrom(parsed, source, raw) {
  if (parsed.status === "set") return { ceiling: parsed.ceiling, source, invalid: null };
  if (parsed.status === "invalid") return { ceiling: null, source: null, invalid: { source, value: displayValue(raw) } };
  return NO_MODEL_CEILING;
}

// A short, single-line, well-formed copy of the rejected value for the notice and the warning.
function displayValue(raw) {
  const text = (typeof raw === "string" ? raw.trim().replace(UNSAFE_TEXT, " ") : String(JSON.stringify(raw)))
    .replace(LONE_SURROGATE, "\uFFFD");
  let clipped = "";
  for (const character of text) {
    if (clipped.length + character.length > INVALID_VALUE_LENGTH) break;
    clipped += character;
  }
  return clipped;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
