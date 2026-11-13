import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_TIMEOUT_MS,
  buildRequirements,
  commandCandidates,
  collectEntries,
  createReport,
  detectStacks,
  jdtlsInstall,
  isWithin,
  packageManager,
  parseCliArgs,
  shouldUseShell,
  systemCommandCandidates,
} from "../scripts/pota-toolcheck.mjs";

const fixtures = resolve("test", "fixtures", "toolcheck");

test("collectEntries and detectStacks identify supported repository stacks", async () => {
  const entries = await collectEntries(join(fixtures, "polyglot"));
  const detected = detectStacks(entries);

  assert.deepEqual(detected, [
    "javascript",
    "typescript",
    "python",
    "php",
    "java",
    "kotlin",
    "swift",
    "go",
    "rust",
  ]);
});

test("nested manifest basenames identify every supported repository stack", () => {
  const entries = [
    "web/package.json",
    "web/tsconfig.json",
    "worker/pyproject.toml",
    "api/composer.json",
    "jvm/pom.xml",
    "jvm/src/App.kt",
    "ios/Package.swift",
    "service/go.mod",
    "native/Cargo.toml",
  ];

  assert.deepEqual(detectStacks(entries), [
    "javascript",
    "typescript",
    "python",
    "php",
    "java",
    "kotlin",
    "swift",
    "go",
    "rust",
  ]);
});

test("root lockfile wins before nested package manager and nested lockfiles are a fallback", () => {
  assert.equal(packageManager([
    "apps/web/pnpm-lock.yaml",
    "yarn.lock",
    "apps/worker/bun.lock",
  ]), "yarn");
  assert.equal(packageManager([
    "apps/deep/yarn.lock",
    "services/api/pnpm-lock.yaml",
  ]), "pnpm");
  assert.equal(packageManager(["packages/web/package.json"]), "npm");
});

test("JavaScript requires node and the package manager selected from the repository", () => {
  for (const [lockfile, manager] of [
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
  ]) {
    const requirements = buildRequirements(["javascript"], ["apps/web/package.json", `apps/web/${lockfile}`]);
    assert.deepEqual(requirements.map(({ name }) => name), ["node", manager]);
  }
});

test("nested PHP, JVM, Swift, Go, and Rust markers produce their tool requirements", () => {
  const entries = [
    "api/composer.json",
    "jvm/pom.xml",
    "ios/Package.swift",
    "service/go.mod",
    "native/Cargo.toml",
  ];
  const requirements = buildRequirements(detectStacks(entries), entries);
  const names = new Set(requirements.map(({ name }) => name));

  for (const name of ["php", "composer", "java", "javac", "mvn", "swift", "sourcekit-lsp", "gopls", "cargo"]) {
    assert.ok(names.has(name), `${name} requirement is missing`);
  }
});

test("collectEntries does not follow symbolic links outside the repository", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pota-toolcheck-links-"));
  const root = join(temp, "repository");
  const outside = join(temp, "outside");
  try {
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(outside, { recursive: true }),
    ]);
    await writeFile(join(root, "package.json"), "{}\n");
    await writeFile(join(outside, "escaped.ts"), "export {};\n");
    await symlink(outside, join(root, "linked-outside"), "dir");
    await symlink(root, join(root, "loop"), "dir");

    const entries = await collectEntries(root);

    assert.deepEqual(entries, ["package.json"]);
    assert.deepEqual(detectStacks(entries), ["javascript"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("buildRequirements leaves unpinned project package installers unavailable", () => {
  const entries = ["package.json", "pnpm-lock.yaml", "tsconfig.json", "pyproject.toml", "composer.json"];
  const requirements = buildRequirements(["typescript", "python", "php"], entries);
  const byName = Object.fromEntries(requirements.map((requirement) => [requirement.name, requirement]));

  assert.equal(packageManager(entries), "pnpm");
  assert.equal(byName["typescript-language-server"].install, null);
  assert.match(byName["typescript-language-server"].installUnavailableReason, /pinned package versions/);
  assert.equal(byName.basedpyright.install, null);
  assert.match(byName.basedpyright.installUnavailableReason, /pinned package versions/);
  assert.equal(byName.phpactor.install, null);
  assert.match(byName.phpactor.installUnavailableReason, /pinned package versions/);
});

test("JDTLS and Go latest installers are disabled", () => {
  const requirements = buildRequirements(["java", "go"], ["pom.xml"], undefined, "linux");
  const byName = Object.fromEntries(requirements.map((requirement) => [requirement.name, requirement]));

  assert.equal(jdtlsInstall("linux"), null);
  assert.equal(byName.jdtls.install, null);
  assert.match(byName.jdtls.installUnavailableReason, /checksum-free/);
  assert.equal(byName.gopls.install, null);
  assert.match(byName.gopls.installUnavailableReason, /unpinned/);
  assert.equal(byName["golangci-lint"].install, null);
  assert.match(byName["golangci-lint"].installUnavailableReason, /unpinned/);
});

test("commandCandidates includes Windows executable shims for local bins", () => {
  const root = "C:\\repo";
  const candidates = commandCandidates("tsc", root, "win32");

  assert.ok(candidates.includes(join(root, "node_modules", ".bin", "tsc.cmd")));
  assert.ok(candidates.includes(join(root, "vendor", "bin", "tsc.bat")));
  assert.ok(candidates.includes("tsc.exe"));
  assert.equal(shouldUseShell(join(root, "node_modules", ".bin", "tsc.cmd"), "win32"), true);
  assert.equal(shouldUseShell(join(root, "node_modules", ".bin", "tsc"), "win32"), false);
  assert.equal(shouldUseShell(join(root, "node_modules", ".bin", "tsc.cmd"), "linux"), false);
  assert.equal(isWithin("D:\\a\\repository", "C:\\hostedtoolcache\\node", "win32"), false);
  assert.equal(isWithin("D:\\a\\repository", "D:\\a\\repository\\tools", "win32"), true);
  assert.deepEqual(systemCommandCandidates("npm", "win32"), ["npm", "npm.cmd", "npm.bat", "npm.exe"]);
});

test("Windows tool checks execute command shims available through PATH", async () => {
  const calls = [];
  const report = await createReport({
    root: join(fixtures, "javascript"),
    platform: "win32",
    runner(command) {
      calls.push(command);
      return { status: command === "node" || command === "npm.cmd" ? 0 : 1 };
    },
  });

  assert.equal(report.results.find(({ name }) => name === "npm").ok, true);
  assert.equal(report.results.find(({ name }) => name === "npm").candidate, "npm.cmd");
  assert.deepEqual(calls, ["node", "npm", "npm.cmd"]);
});

test("createReport is read-only by default", async () => {
  const calls = [];
  const report = await createReport({
    root: join(fixtures, "javascript"),
    platform: "linux",
    runner(command, args, options) {
      calls.push({ command, args, options });
      return { status: command === "node" ? 0 : 1, durationMs: 3 };
    },
  });

  assert.deepEqual(report.detected, ["javascript"]);
  assert.equal(report.install.requested, false);
  assert.equal(report.install.confirmed, false);
  assert.equal(report.results.length, 2);
  assert.equal(report.results[0].name, "node");
  assert.equal(report.results[0].ok, true);
  assert.equal(report.results[0].availability, "verified");
  assert.equal(report.results[0].installed, false);
  assert.equal(report.results[1].name, "npm");
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args].join(" ")), ["node --version", "npm --version"]);
  assert.equal(calls[0].options.timeoutMs, DEFAULT_TIMEOUT_MS);
});

test("--install is refused without the additional confirmation", async () => {
  const calls = [];
  const report = await createReport({
    root: join(fixtures, "javascript"),
    install: true,
    platform: "linux",
    runner(command, args) {
      calls.push([command, ...args].join(" "));
      return { status: 1 };
    },
  });

  assert.equal(report.install.requested, true);
  assert.equal(report.install.confirmed, false);
  assert.equal(report.install.refused, true);
  assert.match(report.install.refusalReason, /--yes/);
  assert.equal(report.results[0].install.refusal, "explicit-confirmation-required");
  assert.equal(report.results[0].install.attempted, false);
  assert.deepEqual(calls, ["node --version", "npm --version"]);
});

test("--install --yes never runs an unavailable built-in installer", async () => {
  const calls = [];
  const report = await createReport({
    root: join(fixtures, "javascript"),
    install: true,
    yes: true,
    platform: "linux",
    runner(command, args) {
      calls.push([command, ...args].join(" "));
      return { status: 1 };
    },
  });

  assert.deepEqual(calls, ["node --version", "npm --version"]);
  assert.equal(report.install.refused, false);
  assert.deepEqual(report.results.map(({ install }) => install.refusal), [
    "installer-unavailable",
    "installer-unavailable",
  ]);
  assert.ok(report.results.every(({ install }) => install.attempted === false));
});

test("diagnostics report timeout metadata without command output", async () => {
  const report = await createReport({
    root: join(fixtures, "javascript"),
    timeoutMs: 25,
    runner(_command, _args, options) {
      assert.equal(options.timeoutMs, 25);
      return {
        status: null,
        signal: "SIGTERM",
        error: { code: "ETIMEDOUT" },
        durationMs: 25,
        stdout: "sensitive full stdout",
        stderr: "sensitive full stderr",
      };
    },
  });

  assert.equal(report.results[0].availability, "timeout");
  assert.deepEqual(report.results[0].check, {
    status: null,
    signal: "SIGTERM",
    errorCode: "ETIMEDOUT",
    timedOut: true,
    durationMs: 25,
  });
  assert.doesNotMatch(JSON.stringify(report), /sensitive full/);
});

test("explicit --root selects the inspected repository", async () => {
  const relativeRoot = join("test", "fixtures", "toolcheck", "javascript");
  const parsed = parseCliArgs(["--json", "--root", relativeRoot], resolve("."));

  assert.equal(parsed.root, join(resolve("."), relativeRoot));
  assert.equal(parsed.json, true);

  const result = spawnSync(process.execPath, [
    resolve("scripts", "pota-toolcheck.mjs"),
    "--json",
    `--root=${join(fixtures, "javascript")}`,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.root, join(fixtures, "javascript"));
  assert.deepEqual(report.detected, ["javascript"]);
});

test("CLI JSON detects a nested JavaScript repository and its package manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "pota-toolcheck-cli-"));
  try {
    await mkdir(join(root, "apps", "web"), { recursive: true });
    await writeFile(join(root, "apps", "web", "package.json"), "{}\n");
    await writeFile(join(root, "apps", "web", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const result = spawnSync(process.execPath, [
      resolve("scripts", "pota.mjs"),
      "toolcheck",
      "--json",
      "--root",
      root,
    ], { encoding: "utf8" });
    assert.ok([0, 1].includes(result.status), result.stderr);
    const report = JSON.parse(result.stdout);

    assert.deepEqual(report.detected, ["javascript"]);
    assert.deepEqual(report.results.map(({ name }) => name), ["node", "pnpm"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository-local wrappers are discovered without being executed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pota-toolcheck-"));
  try {
    await writeFile(join(root, "build.gradle"), "plugins {}\n");
    await writeFile(join(root, "gradlew"), "#!/bin/sh\nexit 99\n");
    await chmod(join(root, "gradlew"), 0o755);
    const calls = [];
    const report = await createReport({
      root,
      runner(command, args) {
        calls.push([command, ...args].join(" "));
        return { status: 1 };
      },
    });
    const gradleWrapper = report.results.find((result) => result.name === "./gradlew");

    assert.equal(gradleWrapper.ok, true);
    assert.equal(gradleWrapper.availability, "discovered");
    assert.equal(gradleWrapper.source, "repository");
    assert.equal(gradleWrapper.check, null);
    assert.ok(!calls.some((call) => call.includes("gradlew")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
