#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_TIMEOUT_MS,
  commandOk,
  execute,
  inspectCommand,
  localExecutableAvailable,
  run,
} from "./pota-toolcheck-runtime.mjs";
import { buildRequirements, collectEntries, detectStacks } from "./pota-toolcheck-detect.mjs";

export {
  commandCandidates,
  commandOk,
  DEFAULT_TIMEOUT_MS,
  inspectCommand,
  isWithin,
  localExecutableAvailable,
  run,
  shouldUseShell,
  systemCommandCandidates,
} from "./pota-toolcheck-runtime.mjs";
export {
  addJvmBuildToolRequirements,
  addJvmRequirements,
  buildRequirements,
  collectEntries,
  composerInstall,
  detectStacks,
  installDev,
  jdtlsInstall,
  packageManager,
  packageManagerSource,
  pushUnique,
  pythonInstall,
  req,
  unsafeReq,
} from "./pota-toolcheck-detect.mjs";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const usage = "Usage: pota toolcheck [--root PATH] [--json] [--install --yes]";

if (isCliEntry()) {
  const args = process.argv.slice(2);
  try {
    const options = parseCliArgs(args);
    if (options.action === "help") {
      console.log(usage);
    } else if (options.action === "version") {
      console.log(`pota ${version}`);
    } else {
      const report = await createReport(options);
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printReport(report);
      if (report.install.refused || report.results.some((result) => !result.ok)) process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes("--json")) {
      console.log(JSON.stringify({ schemaVersion: 1, error: { code: "CLI_USAGE", message } }, null, 2));
    } else {
      console.error(`Pota toolcheck error: ${message}`);
    }
    process.exitCode = 2;
  }
}

export function parseCliArgs(args, cwd = process.cwd()) {
  let root = cwd;
  let install = false;
  let yes = false;
  let json = false;
  let action = "check";
  const provided = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--help", "--version", "--install", "--yes", "--json"].includes(argument)) {
      if (provided.has(argument)) throw new Error(`${argument} may only be provided once`);
      provided.add(argument);
      if (argument === "--help") action = "help";
      else if (argument === "--version") action = "version";
      else if (argument === "--install") install = true;
      else if (argument === "--yes") yes = true;
      else json = true;
    } else if (argument === "--root" || argument.startsWith("--root=")) {
      if (provided.has("--root")) throw new Error("--root may only be provided once");
      provided.add("--root");
      const value = argument === "--root" ? args[index + 1] : argument.slice("--root=".length);
      if (!value || value.startsWith("--")) throw new Error("--root requires a path");
      root = value;
      if (argument === "--root") index += 1;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }

  if (provided.has("--help") && provided.has("--version")) {
    throw new Error("--help and --version cannot be used together");
  }
  return { root: resolve(cwd, root), install, yes, json, action };
}

export async function createReport({
  root = process.cwd(),
  install = false,
  yes = false,
  runner = run,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  localChecker = localExecutableAvailable,
  platform = process.platform,
} = {}) {
  const resolvedRoot = resolve(root);
  const entries = await collectEntries(resolvedRoot);
  const detected = detectStacks(entries);
  const requirements = buildRequirements(detected, entries, commandOk, platform);
  const results = [];
  const installRefused = install && !yes;

  for (const requirement of requirements) {
    let check = inspectCommand(requirement, {
      root: resolvedRoot,
      runner,
      timeoutMs,
      localChecker,
      platform,
    });
    let installed = false;
    let installDiagnostic = null;
    let installRefusal = null;

    if (!check.ok && install) {
      if (!yes) {
        installRefusal = "explicit-confirmation-required";
      } else if (!requirement.install) {
        installRefusal = "installer-unavailable";
      } else {
        installDiagnostic = execute(requirement.install.command, requirement.install.args, {
          root: resolvedRoot,
          runner,
          timeoutMs,
        });
        installed = installDiagnostic.status === 0;
        if (installed) {
          check = inspectCommand(requirement, {
            root: resolvedRoot,
            runner,
            timeoutMs,
            localChecker,
            platform,
          });
        }
      }
    }

    results.push({
      name: requirement.name,
      reason: requirement.reason,
      ok: check.ok,
      availability: check.availability,
      source: check.source,
      candidate: check.candidate,
      check: check.diagnostic,
      installed,
      installCommand: requirement.install ? formatCommand(requirement.install) : null,
      installStatus: installDiagnostic?.status ?? null,
      install: {
        available: Boolean(requirement.install),
        unavailableReason: requirement.installUnavailableReason ?? null,
        requested: install,
        attempted: Boolean(installDiagnostic),
        refusal: installRefusal,
        diagnostic: installDiagnostic,
      },
    });
  }

  return {
    schemaVersion: 1,
    root: resolvedRoot,
    timeoutMs,
    detected,
    install: {
      requested: install,
      confirmed: install && yes,
      refused: installRefused,
      refusalReason: installRefused ? "--install requires the additional --yes confirmation flag" : null,
    },
    results,
  };
}

function printReport(report) {
  console.log(`Pota toolcheck: ${report.root}`);
  console.log(`Detected stacks: ${report.detected.length > 0 ? report.detected.join(", ") : "none"}`);
  if (report.install.refused) console.log(`INSTALL REFUSED - ${report.install.refusalReason}`);
  for (const result of report.results) {
    const prefix = result.ok ? result.availability === "discovered" ? "DISCOVERED" : "OK" : "MISSING";
    const installedText = result.installed ? " installed" : "";
    console.log(`${prefix}${installedText} ${result.name} - ${result.reason}`);
    if (result.check?.timedOut) console.log(`  check timed out after ${result.check.durationMs}ms`);
    if (!result.ok && result.install.unavailableReason) console.log(`  install unavailable: ${result.install.unavailableReason}`);
    else if (!result.ok && result.installCommand) console.log(`  install: ${result.installCommand}`);
  }
}

function formatCommand(command) {
  return [command.command, ...command.args].join(" ");
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}
