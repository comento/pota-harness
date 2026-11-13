import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memoryPromotionReminder } from "./pota-goal-history.mjs";
import { resolvePluginRoot, resolveRepoRoot } from "./pota-paths.mjs";

const GOAL_COMMANDS = ["start", "status", "ready", "stats", "task", "replan", "claim", "assign", "receipt", "verify", "finish", "pause", "resume", "block", "cancel", "complete"];
const GOAL_USAGE = [
  `Usage: pota goal <${GOAL_COMMANDS.join("|")}> [options] [--root PATH]`,
  "Note: --criteria (completionCriteria) is advisory and is not enforced; completion is gated only by required evidence.",
].join("\n");

export async function runGoalCli(args, {
  stdout = console.log,
  stderr = console.error,
  defaultGoalEvidence,
  operations,
}) {
  const [firstCommand = "help", ...remaining] = args;
  const [command = "help", ...rest] = firstCommand === "goal" ? remaining : [firstCommand, ...remaining];
  // Help and version are answered before parsing options or touching state; arguments after -- are passed through.
  const leading = [command, ...rest];
  const separator = leading.indexOf("--");
  const beforeSeparator = separator === -1 ? leading : leading.slice(0, separator);
  const help = command === "help" || beforeSeparator.includes("--help");
  const version = beforeSeparator.includes("--version");
  if (help && version) throw new Error("--help and --version cannot be used together");
  if (help) {
    stdout(GOAL_USAGE);
    return null;
  }
  if (version) {
    stdout(`pota ${JSON.parse(readFileSync(join(resolvePluginRoot(import.meta.url), "package.json"), "utf8")).version}`);
    return null;
  }
  if (!GOAL_COMMANDS.includes(command)) throw new Error(unknownCommandMessage(command));
  const { options, positional, passthrough } = parseArgs(rest, command);
  // Without --root, resolve the repository (HARNESS_REPO_ROOT or the nearest .git ancestor), not a subdirectory cwd.
  const root = resolveRepoRoot({ explicitRoot: options.root ?? null });
  const emit = options.quiet ? () => {} : stdout;
  // Terminal notices go to stderr only; stdout and the exit code stay those of the transition.
  const onTerminal = (record, { historyError } = {}) => {
    if (historyError) stderr(`Pota warning: goal history was not recorded: ${firstLine(historyError)}`);
    if (record?.status === "completed" && record.memoryPromotion === "missing") stderr(memoryPromotionReminder(record.planId));
  };
  if (command === "start") {
    const tasks = parseTasks(options.tasks ?? positional.slice(0));
    const state = await operations.startGoal({
      root,
      goal: options.goal,
      planId: options.plan,
      tasks,
      completionCriteria: splitValues(options.criteria),
      requiredEvidence: options.requiredEvidence ? splitValues(options.requiredEvidence) : defaultGoalEvidence,
      ownerSessionId: options.session,
      evidencePolicy: options.evidencePolicy ?? options["evidence-policy"] ?? "tool-bound",
    });
    emit(JSON.stringify(state));
    return state;
  }
  if (command === "status") {
    const state = await operations.readGoalState({ root });
    stdout(JSON.stringify(state));
    return state;
  }
  if (command === "task") {
    if (positional[0] === "status" && options.status === undefined) {
      const state = await operations.readGoalState({ root });
      if (!state) {
        stdout(JSON.stringify(null));
        return null;
      }
      const requestedTaskId = options.task ?? positional[1];
      const task = requestedTaskId === undefined
        ? state.tasks.find((candidate) => candidate.status === "active") ?? null
        : state.tasks.find((candidate) => candidate.id === requestedTaskId);
      if (requestedTaskId !== undefined && task === undefined) throw new Error(`Unknown task: ${requestedTaskId}`);
      stdout(JSON.stringify(task));
      return task;
    }
    const taskAction = taskStatusFromAction(positional[0]);
    const state = await operations.setTaskStatus({
      root,
      taskId: options.task ?? (taskAction ? positional[1] : positional[0]),
      status: options.status ?? taskAction ?? positional[1],
      blocker: options.reason,
      effortWaiver: options["allow-inherited-effort"],
      designWaiver: options["allow-no-design-model"],
    });
    emit(JSON.stringify(state));
    return state;
  }
  if (command === "replan") {
    const state = await operations.replanGoal({ root, tasks: parseTasks(options.tasks ?? positional.slice(0)) });
    emit(JSON.stringify(state));
    return state;
  }
  if (command === "claim") {
    const state = await operations.claimGoal({ root, sessionId: options.session });
    emit(JSON.stringify(state));
    return state;
  }
  if (command === "assign") {
    const state = await operations.assignTask({
      root,
      taskId: options.task ?? positional[0],
      agentId: options.agent ?? positional[1] ?? null,
      effort: options.effort,
      effortSource: options["effort-source"],
      route: options.route,
      effortWaiver: options["allow-inherited-effort"],
      kind: options.kind,
      model: options.model,
      modelSource: options["model-source"],
      designWaiver: options["allow-no-design-model"],
      effectiveModel: options["effective-model"],
      modelHost: options.host,
    });
    const task = state.tasks.find((item) => item.id === String(options.task ?? positional[0]).trim());
    if (task?.route === "heavy" && task.assignedAgentId && (!task.effort || task.effortSource === "not-applied")) {
      stderr(`Pota warning: Heavy task ${task.id} is assigned without an applied effort (effort ${task.effort ?? "none"}, source ${task.effortSource ?? "none"}); dispatch with the plan's effort and record --effort <level> --effort-source host-option.`);
    }
    // A worker-reported ID that does not contain the passed alias hints at a silent fallback; warn, never block.
    if (task?.model && task.effectiveModel && task.effectiveModel !== "unreported" && !task.effectiveModel.toLowerCase().includes(task.model.toLowerCase())) {
      stderr(`Pota warning: Task ${task.id} effective model ${task.effectiveModel} does not match the passed model ${task.model}; check the dispatch result.`);
    }
    emit(JSON.stringify(state));
    return state;
  }
  if (command === "receipt") {
    const state = await operations.recordReceipt({
      root,
      taskId: options.task ?? positional[0],
      kind: options.kind,
      scope: options.scope,
      command: options.command,
      exitCode: numberOption(options.exitCode ?? options["exit-code"] ?? options.exit),
      timestamp: options.timestamp,
      goalId: options.goalId ?? options["goal-id"],
      planId: options.plan,
    });
    emit(JSON.stringify(state));
    return state;
  }
  if (command === "verify") {
    const result = await operations.verifyAndRecord({
      root,
      taskId: options.task ?? positional[0],
      kind: splitValues(options.kind),
      scope: options.scope,
      watchPaths: splitValues(options.watch),
      argv: passthrough,
      timeoutMs: options["timeout-ms"] === undefined
        ? 600_000
        : positiveIntegerOption(options["timeout-ms"], "timeout-ms"),
    });
    const summaries = result.receipts.map((receipt) => ({
      id: receipt.id,
      scope: receipt.scope,
      kind: receipt.kind,
      exitCode: receipt.exitCode,
      outputDigest: receipt.outputDigest,
      workspaceFingerprint: receipt.workspaceFingerprint,
    }));
    emit(JSON.stringify(summaries.length === 1 ? summaries[0] : summaries));
    return result.state;
  }
  if (command === "finish") {
    const state = await operations.finishGoal({
      root,
      onTerminal,
      watchPaths: splitValues(options.watch),
      argv: passthrough,
      timeoutMs: options["timeout-ms"] === undefined
        ? 600_000
        : positiveIntegerOption(options["timeout-ms"], "timeout-ms"),
    });
    emit(JSON.stringify({ id: state.goal.id, status: state.goal.status }));
    return state;
  }
  if (command === "ready") {
    const state = await operations.readGoalState({ root });
    const ids = (status) => (state ? state.tasks.filter((task) => task.status === status).map((task) => task.id) : []);
    const summary = { active: ids("active"), ready: operations.readyTasks(state).map((task) => task.id), blocked: ids("blocked") };
    stdout(JSON.stringify(summary));
    return summary;
  }
  if (command === "stats") {
    if (options.limit !== undefined && !options.history) throw new Error("--limit requires --history");
    if (options.history) {
      const history = await operations.goalHistoryStats({ root, limit: options.limit });
      stdout(JSON.stringify(history));
      return history;
    }
    const stats = operations.goalStats(await operations.readGoalState({ root }), root);
    stdout(JSON.stringify(stats));
    return stats;
  }
  if (["pause", "resume", "block", "cancel", "complete"].includes(command)) {
    const state = await operations.transitionGoal({
      root,
      status: { pause: "paused", resume: "active", block: "blocked", cancel: "cancelled", complete: "completed" }[command],
      blocker: options.reason,
      onTerminal,
    });
    emit(JSON.stringify(state));
    return state;
  }
  throw new Error(unknownCommandMessage(command));
}

function unknownCommandMessage(command) {
  return `unknown goal command: ${command} (run pota goal --help)`;
}

function parseArgs(args, command) {
  const options = {};
  const positional = [];
  const passthrough = [];
  const booleanOptions = new Set(["quiet", "history"]);
  const allowed = allowedOptions(command);
  const seenCanonicalOptions = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") {
      passthrough.push(...args.slice(index + 1));
      break;
    }
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const option = value.slice(2);
    const equalsIndex = option.indexOf("=");
    const key = equalsIndex === -1 ? option : option.slice(0, equalsIndex);
    const inline = equalsIndex === -1 ? undefined : option.slice(equalsIndex + 1);
    if (!allowed.has(key)) throw new Error(`Unknown option for ${command}: --${key}`);
    const canonicalKey = canonicalOptionKey(key);
    if (seenCanonicalOptions.has(canonicalKey)) throw new Error(`--${canonicalKey} may only be provided once`);
    seenCanonicalOptions.add(canonicalKey);
    if (inline !== undefined) {
      if (!booleanOptions.has(key) && inline.length === 0) throw new Error(`--${key} requires a value`);
      if (booleanOptions.has(key) && !["true", "false"].includes(inline)) throw new Error(`--${key} must be true or false`);
      options[key] = booleanOptions.has(key) ? inline !== "false" : inline;
    } else if (booleanOptions.has(key)) {
      options[key] = true;
    } else {
      const next = args[index + 1];
      if (next === undefined || next === "--" || next.startsWith("--")) throw new Error(`--${key} requires a value`);
      options[key] = next;
      index += 1;
    }
  }
  return { options, positional, passthrough };
}

function canonicalOptionKey(key) {
  return {
    exitCode: "exit-code",
    exit: "exit-code",
    goalId: "goal-id",
    evidencePolicy: "evidence-policy",
  }[key] ?? key;
}

function allowedOptions(command) {
  const common = ["root", "quiet"];
  const byCommand = {
    start: ["goal", "plan", "tasks", "criteria", "requiredEvidence", "session", "evidencePolicy", "evidence-policy"],
    status: [],
    task: ["task", "status", "reason", "allow-inherited-effort", "allow-no-design-model"],
    replan: ["tasks"],
    claim: ["session"],
    assign: ["task", "agent", "effort", "effort-source", "route", "allow-inherited-effort", "kind", "model", "model-source", "allow-no-design-model", "effective-model", "host"],
    receipt: ["task", "kind", "scope", "command", "exitCode", "exit-code", "exit", "timestamp", "goalId", "goal-id", "plan"],
    verify: ["task", "kind", "scope", "watch", "timeout-ms"],
    finish: ["watch", "timeout-ms"],
    stats: ["history", "limit"],
    ready: [],
    pause: [],
    resume: [],
    block: ["reason"],
    cancel: [],
    complete: [],
    help: [],
  };
  return new Set([...common, ...(byCommand[command] ?? [])]);
}

function parseTasks(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("Provide tasks with --tasks JSON or positional task titles");
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("--tasks JSON must be an array");
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) return value.split("|").map((item) => item.trim()).filter(Boolean);
    throw error;
  }
}

function firstLine(error) {
  return String(error?.message ?? error).split(/\r?\n/)[0];
}

function splitValues(value) {
  if (!value) return [];
  return String(value).split("|").map((item) => item.trim()).filter(Boolean);
}

function numberOption(value) {
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isInteger(result)) throw new Error("exitCode must be an integer");
  return result;
}

function positiveIntegerOption(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0 || result > 3_600_000) {
    throw new Error(`${label} must be an integer between 1 and 3600000`);
  }
  return result;
}

function taskStatusFromAction(value) {
  return {
    start: "active",
    activate: "active",
    active: "active",
    complete: "completed",
    completed: "completed",
    block: "blocked",
    blocked: "blocked",
    pending: "pending",
  }[value] ?? null;
}
