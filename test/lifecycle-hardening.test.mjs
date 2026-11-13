import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const fakeClaudeCli = resolve("test/fixtures/fake-claude.mjs");
const root = resolve(".");
const lifecycleScript = join(root, "scripts", "pota-lifecycle.mjs");

for (const fixture of [
  { name: "Codex", ancestor: (env) => join(env.CODEX_HOME, "plugins", "cache", "pota", "pota") },
  { name: "Claude", ancestor: (env) => join(env.CLAUDE_HOME, "commands") },
  { name: "Antigravity", ancestor: (env) => join(env.ANTIGRAVITY_HOME, "skills") },
]) {
  test(`install rejects a ${fixture.name} descendant ancestor symlink without outside writes`, async () => {
    // Given
    await withHome(async ({ env, outside }) => {
      const ancestor = fixture.ancestor(env);
      await mkdir(dirname(ancestor), { recursive: true });
      await symlink(outside, ancestor);

      // When
      const result = run(["install"], env);

      // Then
      assert.equal(result.status, 1);
      assert.match(result.stderr, /ancestor must not be a symlink/);
      assert.deepEqual(await readdir(outside), []);
    });
  });
}

test("install rejects a symlinked POTA_HOME install ancestor without outside writes", async () => {
  // doctor only takes the lifecycle lock, so it checks the lock path ancestors; install and uninstall check every target.
  for (const { ancestor, commands } of [
    { ancestor: (env) => env.POTA_HOME, commands: ["install", "doctor", "uninstall"] },
    { ancestor: (env) => join(env.POTA_HOME, "install"), commands: ["install", "doctor", "uninstall"] },
    { ancestor: (env) => join(env.POTA_HOME, "install", "codex"), commands: ["install", "uninstall"] },
  ]) {
    // Given
    await withHome(async ({ env, outside }) => {
      const link = ancestor(env);
      await mkdir(dirname(link), { recursive: true });
      await symlink(outside, link);

      // When
      const results = commands.map((command) => run([command], env));

      // Then
      for (const result of results) {
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, /ancestor must not be a symlink/);
      }
      assert.deepEqual(await readdir(outside), []);
      await assert.rejects(stat(join(env.CODEX_HOME, "plugins", "cache", "pota")));
    });
  }
});

test("install rejects every trailing argument before lock or stage mutation", async () => {
  // Given
  await withHome(async ({ env, paths }) => {
    for (const args of [["install", "--dry-run", "--unknown"], ["install", "unexpected"], ["upgrade", "unexpected"], ["doctor", "unexpected"], ["uninstall", "unexpected"], ["help", "unexpected"]]) {
      // When
      const result = run(args, env);

      // Then
      assert.equal(result.status, 1, `${args.join(" ")}\n${result.stderr}`);
      assert.match(result.stderr, /does not accept arguments/);
      await assert.rejects(stat(paths.install));
      await assert.rejects(stat(paths.codexCache));
    }
  });
});

test("--hosts accepts all or a comma list and rejects missing, empty, unknown, and duplicate values before mutation", async () => {
  // Given
  await withHome(async ({ env, paths }) => {
    for (const args of [
      ["install", "--hosts"], ["install", "--hosts="], ["install", "--hosts", ""], ["install", "--hosts", "gemini"],
      ["install", "--hosts", "codex,codex"], ["upgrade", "--hosts=codex,,claude"], ["upgrade", "--hosts", "all,codex"],
      ["install", "--hosts", "claude", "--hosts", "codex"],
    ]) {
      // When
      const result = run(args, env);

      // Then
      assert.equal(result.status, 1, `${args.join(" ")}\n${result.stderr}`);
      assert.match(result.stderr, /^Pota lifecycle error: Invalid --hosts value/, args.join(" "));
      await assert.rejects(stat(paths.install));
      await assert.rejects(stat(paths.codexCache));
    }
    for (const args of [["doctor", "--hosts", "all"], ["uninstall", "--hosts=all"], ["install", "--hosts", "all", "--dry-run"]]) {
      const result = run(args, env);
      assert.equal(result.status, 1, `${args.join(" ")}\n${result.stderr}`);
      assert.match(result.stderr, /does not accept arguments/, args.join(" "));
      await assert.rejects(stat(paths.install));
    }
  });
  for (const [args, hosts] of [[["install", "--hosts", "all"], ["codex", "claude", "antigravity"]], [["install", "--hosts=antigravity,codex"], ["codex", "antigravity"]]]) {
    await withHome(async ({ env, paths }) => {
      // When
      const result = run(args, env);

      // Then
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(await readFile(paths.ownership, "utf8")).hosts, hosts);
    });
  }
});

for (const fixture of [
  { name: "Codex", ancestor: (env) => join(env.CODEX_HOME, "plugins", "cache", "pota", "pota"), hosts: "claude,antigravity" },
  { name: "Codex config", ancestor: (env) => env.CODEX_HOME, hosts: "claude,antigravity" },
  { name: "Claude", ancestor: (env) => join(env.CLAUDE_HOME, "commands"), hosts: "codex,antigravity" },
  { name: "Antigravity", ancestor: (env) => join(env.ANTIGRAVITY_HOME, "skills"), hosts: "codex,claude" },
]) {
  test(`a symlinked ${fixture.name} home of an unselected host does not block install`, async () => {
    // Given
    await withHome(async ({ env, outside, paths }) => {
      const ancestor = fixture.ancestor(env);
      await mkdir(dirname(ancestor), { recursive: true });
      await symlink(outside, ancestor);

      // When
      const install = run(["install", "--hosts", fixture.hosts], env);
      const upgrade = run(["upgrade"], env);
      const uninstall = run(["uninstall"], env);

      // Then
      assert.equal(install.status, 0, install.stdout + install.stderr);
      assert.equal(upgrade.status, 0, upgrade.stdout + upgrade.stderr);
      assert.equal(uninstall.status, 0, uninstall.stdout + uninstall.stderr);
      assert.deepEqual(await readdir(outside), []);
      await assert.rejects(stat(paths.install));
    });
  });
}

test("invalid lifecycle lock timeouts fail within a bounded interval before mutation", async () => {
  // Given
  await withHome(async ({ env, paths }) => {
    for (const timeout of ["NaN", "0", "-1", "Infinity", "9007199254740992"]) {
      // When
      const startedAt = Date.now();
      const result = run(["install"], { ...env, POTA_LIFECYCLE_LOCK_TIMEOUT_MS: timeout });
      const elapsedMs = Date.now() - startedAt;

      // Then
      assert.equal(result.status, 1, `${timeout}\n${result.stderr}`);
      assert.match(result.stderr, /POTA_LIFECYCLE_LOCK_TIMEOUT_MS must be an integer between 1 and 2147483647/);
      assert.ok(elapsedMs < 2_000, `${timeout} took ${elapsedMs}ms`);
      await assert.rejects(stat(paths.install));
      await assert.rejects(stat(paths.codexCache));
    }
  });
});

test("the next lifecycle run removes a crashed transaction owned stage", async () => {
  // Given
  await withHome(async ({ env, paths }) => {
    const crashed = run(["install"], { ...env, POTA_TEST_CRASH_AFTER_STAGE: "1" });
    assert.equal(crashed.status, 87, crashed.stderr);
    const journal = JSON.parse(await readFile(paths.transaction, "utf8"));
    const transactionDirectory = join(paths.transactions, journal.id);
    await stat(join(transactionDirectory, "stage"));

    // When
    const recovered = run(["install"], env);

    // Then
    assert.equal(recovered.status, 0, recovered.stderr);
    await assert.rejects(stat(transactionDirectory));
    await assert.rejects(stat(paths.transaction));
  });
});

test("upgrade fails closed when a managed digest changes after preflight", async () => {
  // Given
  await withHome(async ({ env, paths }) => {
    assert.equal(run(["install"], env).status, 0);
    const target = join(env.CLAUDE_HOME, "commands", "pota-plan.md");

    // When
    const raced = run(["upgrade"], {
      ...env,
      POTA_TEST_MUTATE_AFTER_PREFLIGHT_ID: "claude-command-plan",
      POTA_TEST_MUTATION_CONTENT: "concurrent mutation\n",
    });

    // Then
    assert.equal(raced.status, 1, raced.stderr);
    assert.match(raced.stderr, /changed after lifecycle preflight/);
    assert.equal(await readFile(target, "utf8"), "concurrent mutation\n");
    await assert.rejects(stat(paths.transaction));
  });
});

test("an EXDEV staging rename fails without a partial target and restores prior ownership", async () => {
  // Given
  await withHome(async ({ env, paths }) => {
    assert.equal(run(["install"], env).status, 0);
    const target = join(env.CLAUDE_HOME, "commands", "pota-plan.md");
    const before = await readFile(target, "utf8");
    const ownershipBefore = await readFile(paths.ownership, "utf8");

    // When
    const result = run(["upgrade"], { ...env, POTA_TEST_FORCE_EXDEV_ID: "claude-command-plan" });

    // Then
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Cross-device replacement is not supported safely/);
    assert.equal(await readFile(target, "utf8"), before);
    assert.equal(await readFile(paths.ownership, "utf8"), ownershipBefore);
    await assert.rejects(stat(paths.transaction));
    assert.deepEqual(await readdir(paths.transactions), []);
  });
});

async function withHome(runTest) {
  const temp = await mkdtemp(join(tmpdir(), "pota-hardening-"));
  const env = {
    ...process.env,
    HOME: join(temp, "home"),
    POTA_HOME: join(temp, "pota-home"),
    CODEX_HOME: join(temp, "codex"),
    CLAUDE_HOME: join(temp, "claude"),
    POTA_CLAUDE_CLI: fakeClaudeCli,
    ANTIGRAVITY_HOME: join(temp, "gemini", "config"),
    ANTIGRAVITY_CLI_HOME: join(temp, "gemini", "antigravity-cli"),
    CODEX_CONFIG_PATH: join(temp, "codex", "config.toml"),
  };
  const install = join(env.POTA_HOME, "install");
  const paths = {
    install,
    codexCache: join(env.CODEX_HOME, "plugins", "cache", "pota"),
    ownership: join(install, "lifecycle.json"),
    transaction: join(install, "transaction.json"),
    transactions: join(install, "transactions"),
  };
  const outside = join(temp, "outside");
  await mkdir(outside);
  await writeFile(join(temp, "fixture-marker"), "fixture\n");
  try {
    await runTest({ env, outside, paths });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function run(args, env) {
  return spawnSync(process.execPath, [lifecycleScript, ...args], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
}
