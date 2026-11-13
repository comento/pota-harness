#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { runState } from "./pota-state.mjs";
import { INDEX_USAGE, checkIndex, parseIndexArgs, updateIndex } from "./pota-index.mjs";
import { parseRootArgs, resolvePluginRoot } from "./pota-paths.mjs";

const pluginRoot = resolvePluginRoot(import.meta.url);
const scriptDir = join(pluginRoot, "scripts");
const version = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")).version;

export async function main(command = "help", args = [], { runner = spawnSync } = {}) {
  if (command === "help" || command === "--help") {
    console.log(message("usage"));
    return;
  }
  if (command === "version" || command === "--version") {
    console.log(`pota ${version}`);
    return;
  }
  if (["install", "upgrade", "doctor", "uninstall"].includes(command)) {
    const result = runner(process.execPath, [join(scriptDir, "pota-lifecycle.mjs"), command, ...args], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (["goal", "task"].includes(command)) {
    const goalArgs = command === "goal" ? args : ["task", ...args];
    const result = runner(process.execPath, [join(scriptDir, "pota-goal.mjs"), ...goalArgs], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (command === "memory" || command === "plan") {
    const options = parseIndexArgs(command, args);
    if (options.action === "guidance") {
      console.log(message(command));
      return;
    }
    if (options.action === "help") {
      console.log(INDEX_USAGE[command]);
      return;
    }
    if (options.action === "version") {
      console.log(`pota ${version}`);
      return;
    }
    const report = options.action === "check"
      ? await checkIndex(options.root, command, { strict: options.strict })
      : await updateIndex(options.root, command, { dryRun: options.dryRun, archive: options.archive, ko: localeFamily() === "ko" });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  const { args: rest, repoRoot } = parseRootArgs(args);
  if (command === "init") {
    // Reject every remaining argument before init writes anything.
    if (rest.length === 1 && rest[0] === "--help") {
      console.log("Usage: pota init [--root PATH]");
      return;
    }
    if (rest.length === 1 && rest[0] === "--version") {
      console.log(`pota ${version}`);
      return;
    }
    const unexpected = rest.find((argument) => argument !== "--help" && argument !== "--version");
    if (unexpected !== undefined) throw new Error(`unknown option: ${unexpected}`);
    if (rest.includes("--help") && rest.includes("--version")) throw new Error("--help and --version cannot be used together");
    if (rest.length > 0) throw new Error(`${rest[0]} may only be provided once`);
    console.log(await runState("manual", { root: repoRoot }));
    return;
  }
  if (command === "toolcheck") {
    const result = runner(process.execPath, [join(scriptDir, "pota-toolcheck.mjs"), ...args], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (command === "auto-upgrade") {
    const result = runner(process.execPath, [join(scriptDir, "pota-auto-upgrade.mjs"), ...args], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (command === "cleanup") {
    const result = runner(process.execPath, [join(scriptDir, "pota-cleanup.mjs"), ...args], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (["work", "review"].includes(command)) {
    console.log(message(command));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

export function message(key, locale = localeValue()) {
  const family = localeFamily(locale);
  return messages[family]?.[key] ?? messages.en[key];
}

export function localeFamily(locale = localeValue()) {
  const normalized = locale.toLowerCase();
  for (const family of ["ko", "ja", "zh", "es", "fr", "de", "pt"]) {
    if (normalized.startsWith(family)) return family;
  }
  return "en";
}

function localeValue() {
  return [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]
    .find((value) => typeof value === "string" && value.length > 0) ?? Intl.DateTimeFormat().resolvedOptions().locale;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

const planExecutionPolicy = "The user-called/main agent is the orchestrator; implementation edits go to worker subagents whenever subagent tools are available. When the subagent tool provides a progress-reporting channel, subagents report status to the orchestrator when starting work, when deciding or confirming direction, during periodic progress, and when finishing; the orchestrator must immediately relay received status events to the user. If no mid-run reporting channel exists, the orchestrator relays observable events such as assignment, waiting, and final completion. When a delegated subagent finishes, it must provide its final report before leaving; after the orchestrator captures the final report and evidence, the orchestrator must close or release the completed subagent, then review the final report and evidence before marking the work complete. If subagent tools are unavailable, the main agent takes over implementation directly and records that takeover in evidence.";
const workExecutionPolicy = "The user-called/main agent orchestrates, while worker subagents perform implementation edits whenever subagent tools are available. When the subagent tool provides a progress-reporting channel, subagents report status to the orchestrator when starting work, when deciding or confirming direction, during periodic progress, and when finishing; the orchestrator must immediately relay received status events to the user. If no mid-run reporting channel exists, the orchestrator relays observable events such as assignment, waiting, and final completion. When a delegated subagent finishes, it must provide its final report before leaving; after the orchestrator captures the final report and evidence, the orchestrator must close or release the completed subagent, then review the final report and evidence before marking the work complete. If subagent tools are unavailable, the main agent takes over implementation directly and records that takeover in evidence.";
const tokenEfficientWorkPolicy = "Use a test contract for requirements, invariants, boundaries, and failure modes before the minimum implementation. The tool exit code is authoritative. Run goal verify -- <argv> and expand only failures. Inspect package lifecycle scripts: content-producing or unknown scripts must never use --ignore-scripts; only absent or proven content-neutral scripts may use it while prior full-check evidence remains fresh.";
const stagedTriagePolicy = "Use request, planning, and code checkpoints. Before the first edit, evidence may change either route; synchronize the plan artifact, repository goal task roadmap through goal replan, and native UI plan. After editing starts, a new Heavy Path signal promotes Light Path to Heavy Path: stop further edits, mark affected evidence stale, synchronize all three roadmaps, and repeat the code checkpoint.";
const stagedTriagePolicyKo = "요청, 계획, 코드 체크포인트를 사용합니다. 첫 편집 전에는 증거에 따라 어느 경로로든 바꿀 수 있으며 plan artifact, 저장소 goal task roadmap, native UI plan을 동기화합니다. 편집 뒤 새 Heavy Path 신호가 나오면 Light Path를 Heavy Path로 승격하고 추가 편집을 중단하며 관련 증거를 stale로 표시한 뒤 세 roadmap과 코드 체크포인트를 다시 맞춥니다.";
const reasoningEffortPolicy = "Choose a model per task (fast/balanced/stronger/strongest) and pass it like effort; route reasoning effort by task: Light planning/implementation/verification=medium; Heavy planning/review/implementation=high; final verification/review=xhigh. Every new task/worker dispatch MUST pass the requested effort through the host option (Claude Code: Agent `effort`, never fork) and the chosen model the same way (Agent `model`); Effective is the passed value, `not-applied: <reason>` when not passed, `inherited` only when the host has no option. Never change global/user config.";
const artifactLocalePolicy = "Write user-visible responses and generated or updated documentation, plans, and memory artifacts in the OS locale unless the user asks for another language.";
const memoryIndexPolicy = "Each MEMORY.md line under Domain Knowledge locates one docs/memory/<name>.md note with its one-line Summary; maintain it with pota memory index and verify it with pota memory check.";
const planIndexPolicy = "Each PLAN.md line locates one docs/plan/<name>.md plan under Active Plans or Completed Plans (newest first); maintain it with pota plan index (--archive moves older entries to docs/plan/ARCHIVE.md) and verify it with pota plan check.";
const artifactLocalePolicyKo = "사용자가 다른 언어를 요청하지 않는 한, 사용자에게 보이는 응답과 생성 또는 갱신하는 문서, 계획, 메모리 산출물은 OS locale 언어로 작성합니다.";

const messages = {
  en: {
    memory: `Use the pota-memory skill. Keep MEMORY.md as a short index and write details to docs/memory/<domain>.md. ${artifactLocalePolicy} ${memoryIndexPolicy}`,
    plan: `Use the pota-plan skill before non-trivial implementation. Read project-root MEMORY.md first when present; if absent, continue without repository memory. Understand the whole work first, then classify it into executable tasks and sub-tasks. Keep PLAN.md as an index, write detailed plans to docs/plan/<topic>.md, and record Light/Heavy Path triage before any mutation. ${stagedTriagePolicy} ${reasoningEffortPolicy} ${artifactLocalePolicy} ${planExecutionPolicy} ${planIndexPolicy}`,
    work: `Use pota-work only after a plan exists. Read root MEMORY.md when present and continue without it when absent. ${tokenEfficientWorkPolicy} Execute one task through its recorded Light/Heavy Path. ${stagedTriagePolicy} ${reasoningEffortPolicy} ${workExecutionPolicy} ${artifactLocalePolicy} Resume active work after side questions unless asked to pause, stop, or switch.`,
    review: `Use the pota-review skill. Compare evidence against PLAN.md and MEMORY.md. ${artifactLocalePolicy}`,
    usage: "Usage: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task",
  },
  ko: {
    memory: `pota-memory 스킬을 사용하세요. MEMORY.md는 짧은 색인으로, 상세 내용은 docs/memory/<domain>.md에 기록합니다. ${artifactLocalePolicyKo} ${memoryIndexPolicy}`,
    plan: `중요 구현 전에는 pota-plan 스킬을 사용하세요. 프로젝트 루트 MEMORY.md가 있으면 먼저 읽고, 없으면 저장소 메모리 없이 계속 진행합니다. 먼저 전체 작업을 파악한 뒤 실행 가능한 task와 필요한 sub-task로 분류합니다. PLAN.md는 색인으로, 상세 계획은 docs/plan/<topic>.md에 기록하며 파일 변경 전 Light/Heavy Path 트리아지를 남깁니다. ${stagedTriagePolicyKo} ${reasoningEffortPolicy} ${artifactLocalePolicyKo} ${planExecutionPolicy} ${planIndexPolicy}`,
    work: `계획이 있으면 pota-work를 사용하세요. 루트 MEMORY.md가 있으면 읽고 없으면 무시하고 진행합니다. ${tokenEfficientWorkPolicy} 기록된 Light/Heavy Path로 한 task를 수행합니다. ${stagedTriagePolicyKo} ${reasoningEffortPolicy} ${workExecutionPolicy} ${artifactLocalePolicyKo} 곁가지 질문 뒤에는 일시중지·중단·전환 요청이 없으면 active work를 재개합니다.`,
    review: `pota-review 스킬을 사용하세요. PLAN.md와 MEMORY.md 기준으로 증거를 비교합니다. ${artifactLocalePolicyKo}`,
    usage: "사용법: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task",
  },
  ja: {
    memory: `pota-memory スキルを使用してください。MEMORY.md は短い索引にし、詳細は docs/memory/<domain>.md に記録します。${artifactLocalePolicy} ${memoryIndexPolicy}`,
    plan: `pota-plan スキルを使用してください。PLAN.md は索引にし、詳細計画は docs/plan/<topic>.md に記録します。${reasoningEffortPolicy} ${artifactLocalePolicy} ${planExecutionPolicy} ${planIndexPolicy}`,
    work: `pota-work スキルを使用してください。1つのモジュールスライスを実行し、モジュール証拠と表面証拠を取得します。${tokenEfficientWorkPolicy} ${reasoningEffortPolicy} ${workExecutionPolicy} ${artifactLocalePolicy}`,
    review: `pota-review スキルを使用してください。PLAN.md と MEMORY.md に照らして証拠を比較します。${artifactLocalePolicy}`,
    usage: "使い方: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task",
  },
  zh: {
    memory: `使用 pota-memory skill。将 MEMORY.md 保持为简短索引，并将详细内容写入 docs/memory/<domain>.md。${artifactLocalePolicy} ${memoryIndexPolicy}`,
    plan: `使用 pota-plan skill。将 PLAN.md 保持为索引，并将详细计划写入 docs/plan/<topic>.md。${reasoningEffortPolicy} ${artifactLocalePolicy} ${planExecutionPolicy} ${planIndexPolicy}`,
    work: `使用 pota-work skill。执行一个模块切片，并收集模块证据。${tokenEfficientWorkPolicy} ${reasoningEffortPolicy} ${workExecutionPolicy} ${artifactLocalePolicy}`,
    review: `使用 pota-review skill。根据 PLAN.md 和 MEMORY.md 对比证据。${artifactLocalePolicy}`,
    usage: "用法: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task",
  },
  es: {
    memory: `Usa la skill pota-memory. Mantén MEMORY.md como un índice breve y escribe los detalles en docs/memory/<domain>.md. ${artifactLocalePolicy} ${memoryIndexPolicy}`,
    plan: `Usa la skill pota-plan. Mantén PLAN.md como índice y escribe los planes detallados en docs/plan/<topic>.md. ${reasoningEffortPolicy} ${artifactLocalePolicy} ${planExecutionPolicy} ${planIndexPolicy}`,
    work: `Usa la skill pota-work. Ejecuta un solo segmento de módulo y captura evidencia de módulo y de superficie. ${tokenEfficientWorkPolicy} ${reasoningEffortPolicy} ${workExecutionPolicy} ${artifactLocalePolicy}`,
    review: `Usa la skill pota-review. Compara la evidencia con PLAN.md y MEMORY.md. ${artifactLocalePolicy}`,
    usage: "Uso: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task",
  },
  fr: {
    memory: `Utilisez la skill pota-memory. Gardez MEMORY.md comme index court et écrivez les détails dans docs/memory/<domain>.md. ${artifactLocalePolicy} ${memoryIndexPolicy}`,
    plan: `Utilisez la skill pota-plan. Gardez MEMORY.md comme index et écrivez les plans détaillés dans docs/plan/<topic>.md. ${reasoningEffortPolicy} ${artifactLocalePolicy} ${planExecutionPolicy} ${planIndexPolicy}`,
    work: `Utilisez la skill pota-work. Exécutez une tranche de module et capturez les preuves de module et de surface. ${tokenEfficientWorkPolicy} ${reasoningEffortPolicy} ${workExecutionPolicy} ${artifactLocalePolicy}`,
    review: `Utilisez la skill pota-review. Comparez les preuves avec PLAN.md et MEMORY.md. ${artifactLocalePolicy}`,
    usage: "Utilisation: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task",
  },
  de: {
    memory: `Verwenden Sie die Skill pota-memory. Halten Sie MEMORY.md als kurzen Index und schreiben Sie Details nach docs/memory/<domain>.md. ${artifactLocalePolicy} ${memoryIndexPolicy}`,
    plan: `Verwenden Sie die Skill pota-plan. Halten Sie MEMORY.md als Index und schreiben Sie Detailpläne nach docs/plan/<topic>.md. ${reasoningEffortPolicy} ${artifactLocalePolicy} ${planExecutionPolicy} ${planIndexPolicy}`,
    work: `Verwenden Sie die Skill pota-work. Führen Sie einen Modulabschnitt aus und erfassen Sie Modul- und Oberflächenbelege. ${tokenEfficientWorkPolicy} ${reasoningEffortPolicy} ${workExecutionPolicy} ${artifactLocalePolicy}`,
    review: `Verwenden Sie die Skill pota-review. Vergleichen Sie Belege mit PLAN.md und MEMORY.md. ${artifactLocalePolicy}`,
    usage: "Verwendung: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task",
  },
  pt: {
    memory: `Use a skill pota-memory. Mantenha MEMORY.md como um índice curto e escreva detalhes em docs/memory/<domain>.md. ${artifactLocalePolicy} ${memoryIndexPolicy}`,
    plan: `Use a skill pota-plan. Mantenha MEMORY.md como índice e escreva planos detalhados em docs/plan/<topic>.md. ${reasoningEffortPolicy} ${artifactLocalePolicy} ${planExecutionPolicy} ${planIndexPolicy}`,
    work: `Use a skill pota-work. Execute uma fatia de módulo e capture evidências de módulo e de superfície. ${tokenEfficientWorkPolicy} ${reasoningEffortPolicy} ${workExecutionPolicy} ${artifactLocalePolicy}`,
    review: `Use a skill pota-review. Compare evidências com PLAN.md e MEMORY.md. ${artifactLocalePolicy}`,
    usage: "Uso: pota install|upgrade|doctor|uninstall|auto-upgrade|cleanup|init|memory|plan|work|review|toolcheck|goal|task",
  },
};

if (isCliEntry()) {
  const [command = "help", ...args] = process.argv.slice(2);
  try {
    await main(command, args);
  } catch (error) {
    console.error(`Pota error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
