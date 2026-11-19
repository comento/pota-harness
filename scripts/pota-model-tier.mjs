// The single tier table; skills/pota-plan/delegation.md and skills/pota-work/delegation.md document the same values.
export const MODEL_TIERS = Object.freeze(["fast", "balanced", "stronger", "strongest"]);
export const MODEL_TIER_BY_HOST = Object.freeze({
  "claude-code": Object.freeze({ fast: "haiku", balanced: "sonnet", stronger: "opus", strongest: "fable" }),
  codex: Object.freeze({ fast: "gpt-6-luna", balanced: "gpt-6.1-terra", stronger: "gpt-6-sol", strongest: "gpt-6-astra" }),
  antigravity: Object.freeze({ fast: "flash_lite", balanced: "flash", stronger: "pro", strongest: "pro" }),
});
export const STRONGEST_MODEL_BY_HOST = Object.freeze(Object.fromEntries(
  Object.entries(MODEL_TIER_BY_HOST).map(([host, row]) => [host, row.strongest]),
));

const MAX_MODEL_LENGTH = 128;
const HOST_ORDER = Object.keys(MODEL_TIER_BY_HOST);

// Later tiers win, so a value shared by two tiers (Antigravity "pro") maps to the highest one.
function tierByValue(host) {
  const map = new Map();
  for (const tier of MODEL_TIERS) map.set(MODEL_TIER_BY_HOST[host][tier], tier);
  return map;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A value matches when exactly one known token appears between the given boundary characters; two tokens
// ("haiku-opus") or a token glued to more name characters ("opusplan", "gpt-6-solar") stay unknown.
function tokenMatcher(host, boundary) {
  const tiers = tierByValue(host);
  const patterns = [...tiers.keys()].map((token) => [
    tiers.get(token),
    new RegExp(`(?:^|[^${boundary}])${escapeRegExp(token)}(?=[^${boundary}]|$)`, "g"),
  ]);
  return (text) => {
    const found = [];
    for (const [tier, pattern] of patterns) found.push(...Array.from(text.matchAll(pattern), () => tier));
    return found.length === 1 ? found[0] : null;
  };
}

const matchers = {
  "claude-code": tokenMatcher("claude-code", "a-z0-9"),
  codex: tokenMatcher("codex", "a-z0-9."),
  antigravity: (text) => tierByValue("antigravity").get(text) ?? null,
};

export function classifyModel(value, host = null) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text.length === 0 || text.length > MAX_MODEL_LENGTH) return null;
  const hosts = host === null || host === undefined ? HOST_ORDER : (Object.hasOwn(matchers, host) ? [host] : []);
  for (const name of hosts) {
    const tier = matchers[name](text);
    if (tier) return { tier, host: name };
  }
  return null;
}

export function isBelowStronger(tier) {
  return tier === "fast" || tier === "balanced";
}

export function isStrongerOrAbove(tier) {
  return tier === "stronger" || tier === "strongest";
}

// A user-set cap on the usable tier (POTA_MODEL_CEILING or config.json "modelCeiling"). "strongest" means no ceiling,
// and "fast" is not accepted because it would fold every tier into one model and remove the gates.
export const MODEL_CEILINGS = Object.freeze(["balanced", "stronger"]);

export function tierRank(tier) {
  return MODEL_TIERS.indexOf(tier);
}

export function validCeiling(value) {
  return MODEL_CEILINGS.includes(value) ? value : null;
}

export function effectiveTier(tier, ceiling = null) {
  const cap = validCeiling(ceiling);
  return cap && tierRank(cap) < tierRank(tier) ? cap : tier;
}

export function effectiveModel(host, tier, ceiling = null) {
  return MODEL_TIER_BY_HOST[host]?.[effectiveTier(tier, ceiling)] ?? null;
}

export function isBelowTier(tier, floor) {
  return tierRank(tier) !== -1 && tierRank(floor) !== -1 && tierRank(tier) < tierRank(floor);
}

export function isAtOrAboveTier(tier, floor) {
  return tierRank(tier) !== -1 && tierRank(floor) !== -1 && tierRank(tier) >= tierRank(floor);
}

// The host's values at the floor tier or above, in tier order without duplicates (Antigravity "pro" appears once).
export function modelsAtOrAbove(host, floor) {
  if (!Object.hasOwn(MODEL_TIER_BY_HOST, host ?? "") || tierRank(floor) === -1) return [];
  return [...new Set(MODEL_TIERS.slice(tierRank(floor)).map((tier) => MODEL_TIER_BY_HOST[host][tier]))];
}

// status: "unset" (no value), "none" (strongest: no ceiling), "set", or "invalid". A model name is read as its tier,
// except Antigravity "pro": it reads like a "Pro" subscription plan, so as a ceiling it is invalid instead of no ceiling.
export function parseModelCeiling(raw) {
  if (raw === undefined || raw === null) return { status: "unset", ceiling: null };
  if (typeof raw !== "string") return { status: "invalid", ceiling: null };
  const text = raw.trim().toLowerCase();
  if (text.length === 0) return { status: "unset", ceiling: null };
  if (text === "pro") return { status: "invalid", ceiling: null };
  const tier = MODEL_TIERS.includes(text) ? text : classifyModel(text)?.tier;
  if (tier === "strongest") return { status: "none", ceiling: null };
  const ceiling = validCeiling(tier);
  return ceiling ? { status: "set", ceiling } : { status: "invalid", ceiling: null };
}
