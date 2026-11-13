import { createInterface } from "node:readline";

// Hosts Pota can install into, in canonical order. The ownership manifest records a non-empty subset in this order.
export const HOSTS = ["codex", "claude", "antigravity"];
const HOST_LABELS = { codex: "Codex", claude: "Claude Code", antigravity: "Antigravity" };
const PROMPT_ATTEMPTS = 3;

export function isHostSelection(hosts) {
  return Array.isArray(hosts) && hosts.length > 0 && hosts.length <= HOSTS.length
    && hosts.every((host, index) => HOSTS.includes(host) && (index === 0 || HOSTS.indexOf(hosts[index - 1]) < HOSTS.indexOf(host)));
}

// `all` or a comma-separated list of host ids; the result is in canonical order. Missing, empty, unknown, and
// duplicate values are rejected so nothing is locked or staged for a selection the user did not mean.
export function parseHostsOption(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid --hosts value: ${value === undefined ? "missing" : "empty"}`);
  if (value === "all") return [...HOSTS];
  const names = value.split(",").map((name) => name.trim());
  const seen = new Set();
  for (const name of names) {
    if (name.length === 0) throw new Error(`Invalid --hosts value: ${value} (empty host name)`);
    if (!HOSTS.includes(name)) throw new Error(`Invalid --hosts value: ${value} (unknown host ${name}; use all or ${HOSTS.join(",")})`);
    if (seen.has(name)) throw new Error(`Invalid --hosts value: ${value} (duplicate host ${name})`);
    seen.add(name);
  }
  return HOSTS.filter((host) => seen.has(host));
}

// The host a managed or journal-only target belongs to; `core` targets are installed for every selection.
export function hostOfTarget(id) {
  if (id === "runtime" || id === "ownership" || id.startsWith("retired-runtime-")) return "core";
  if (["codex-source", "marketplace", "codex-runtime", "codex-config", "previous-codex-runtime"].includes(id)
      || id.startsWith("retired-codex-runtime-")) return "codex";
  if (id.startsWith("claude-")) return "claude";
  if (/^(?:ide|cli)-/.test(id)) return "antigravity";
  return null;
}

export function hostLabels(hosts) {
  return hosts.map((host) => HOST_LABELS[host]).join(", ");
}

function promptText(ko) {
  return ko ? [
    "Pota를 설치할 호스트를 선택하세요.",
    "  1) 전체 — Codex, Claude Code, Antigravity (기본)",
    "  2) Claude Code만",
    "  3) Codex만",
    "  4) Antigravity만",
    "번호를 입력하거나 호스트 이름을 쉼표로 구분해 입력하세요 (codex,claude,antigravity) [1]: ",
  ] : [
    "Select the hosts to install Pota into.",
    "  1) All — Codex, Claude Code, Antigravity (default)",
    "  2) Claude Code only",
    "  3) Codex only",
    "  4) Antigravity only",
    "Enter a number, or host names separated by commas (codex,claude,antigravity) [1]: ",
  ];
}

export function parseHostsAnswer(answer) {
  const value = answer.trim();
  const choices = { "": HOSTS, 1: HOSTS, 2: ["claude"], 3: ["codex"], 4: ["antigravity"] };
  if (Object.hasOwn(choices, value)) return [...choices[value]];
  return parseHostsOption(value);
}

// Asks once, re-asks after an invalid answer, and gives up after three attempts or at end of input. An empty answer
// selects every host. The caller asks before taking the lifecycle lock, so a waiting prompt never blocks another run.
export async function promptHosts({ input, output, ko = false }) {
  const lines = promptText(ko);
  const question = lines.at(-1);
  const reader = createInterface({ input, terminal: false });
  const answers = reader[Symbol.asyncIterator]();
  try {
    output.write(lines.join("\n"));
    for (let attempt = 1; attempt <= PROMPT_ATTEMPTS; attempt += 1) {
      if (attempt > 1) output.write(question);
      const next = await answers.next();
      if (next.done) {
        output.write("\n");
        break;
      }
      try {
        const hosts = parseHostsAnswer(next.value);
        output.write(ko
          ? `선택한 호스트: ${hostLabels(hosts)}. 나중에 바꾸려면: pota install --hosts <목록>\n`
          : `Selected hosts: ${hostLabels(hosts)}. To change later: pota install --hosts <list>\n`);
        return hosts;
      } catch {
        output.write(ko ? `잘못된 입력입니다: ${next.value.trim()}\n` : `Invalid selection: ${next.value.trim()}\n`);
      }
    }
  } finally {
    reader.close();
  }
  throw new Error("No valid host selection was entered.");
}
