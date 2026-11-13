import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliScript = resolve("scripts", "pota.mjs");
const repoRoot = resolve(".");

test("this repository's MEMORY.md and PLAN.md pass strict index checks", async () => {
  const potaHome = await mkdtemp(join(tmpdir(), "pota-repo-index-"));
  try {
    for (const kind of ["memory", "plan"]) {
      const result = spawnSync(process.execPath, [cliScript, kind, "check", "--strict", "--root", repoRoot], {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "en_US.UTF-8", POTA_HOME: potaHome },
      });
      assert.equal(result.status, 0, `${kind} check --strict failed:\n${result.stdout}${result.stderr}`);
      const report = JSON.parse(result.stdout);
      assert.equal(report.ok, true, kind);
      assert.deepEqual(report.errors, [], kind);
      assert.deepEqual(report.warnings, [], kind);
      assert.ok(report.files > 0, `${kind} has indexed files`);
    }
  } finally {
    await rm(potaHome, { recursive: true, force: true });
  }
});
