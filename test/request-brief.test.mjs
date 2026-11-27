import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  GOAL_STATE_CONTRACT,
  goalHistoryPath,
  goalStatePath,
  goalStats,
  handleGoalCli,
  readGoalState,
  recordReceipt,
  replanGoal,
  setTaskStatus,
  startGoal,
  transitionGoal,
} from "../scripts/pota-goal.mjs";

const PLAN_ID = "docs/plan/brief.md";
const STEER_USAGE_HINT = /S1/;

const filledBrief = (extra = "") => `# Plan

## Request Brief

- Original request: "make it better"
- Interpreted outcome: faster startup
- End state: local change
- Prior records: none: no related plans
- Scope: scripts
- Non-scope: docs
- Assumptions:
  - A1 (inferred): only node
- Implicit requirements: none: no external effects
- Open questions: none
- Steering log:
${extra}
## Whole Work

- Outcome: x
`;

const s1 = "  - S1 (correction): \"not that\" -> A1 replaced\n";
const current = (n) => `- Current request (as of S${n}): the new request\n`;

test("completing a triageDecision task is rejected without a filled Request Brief and lists the missing labels", async () => {
  await withTempRoot(async (root) => {
    await writePlan(root, "# Plan\n\n## Goal\n\n- x\n");
    await startTriageGoal(root);
    const before = await readFile(goalStatePath(root), "utf8");
    await assert.rejects(
      setTaskStatus({ root, taskId: "triage-plan", status: "completed" }),
      (error) => {
        for (const label of ["Original request", "Interpreted outcome", "End state", "Prior records", "Assumptions", "Implicit requirements"]) assert.match(error.message, new RegExp(label));
        assert.match(error.message, /--allow-no-request-brief <reason>/);
        return true;
      },
    );
    assert.equal(await readFile(goalStatePath(root), "utf8"), before);
  });
});

test("a filled Request Brief lets the triage task complete; a non-triage task is never gated", async () => {
  await withTempRoot(async (root) => {
    await writePlan(root, filledBrief());
    await startTriageGoal(root);
    await recordTriage(root);
    const state = await setTaskStatus({ root, taskId: "triage-plan", status: "completed" });
    assert.equal(state.tasks[0].status, "completed");
  });
  await withTempRoot(async (root) => {
    await writePlan(root, "# Plan\n");
    await startTriageGoal(root);
    await recordTriage(root);
    await setTaskStatus({ root, taskId: "triage-plan", status: "completed", requestBriefWaiver: "legacy plan" });
    await recordReceipt({ root, taskId: "work", kind: "moduleAcceptance", command: "c", exitCode: 0 });
    await recordReceipt({ root, taskId: "work", kind: "surfaceIntegration", command: "c", exitCode: 0 });
    const state = await setTaskStatus({ root, taskId: "work", status: "completed" });
    assert.equal(state.tasks[1].status, "completed");
  });
});

test("placeholders, fenced fake sections, and empty sub-lists do not count as filled; sub-lists do", async () => {
  const template = `## Request Brief

- Original request: <user's words>
- Interpreted outcome: <what is true when done>
- End state: <the last step>
- Prior records: <plans, notes, past steering | none: reason>
- Assumptions:
  - A1 (evidence|inferred|confirmed): <assumption and source>
- Implicit requirements: <items | none: reason>
`;
  await withTempRoot(async (root) => {
    await writePlan(root, template);
    await startTriageGoal(root);
    await recordTriage(root);
    await assert.rejects(setTaskStatus({ root, taskId: "triage-plan", status: "completed" }), (error) => {
      for (const label of ["Original request", "Interpreted outcome", "End state", "Prior records", "Assumptions", "Implicit requirements"]) assert.match(error.message, new RegExp(label));
      return true;
    });
    await writePlan(root, `# Plan\n\n\`\`\`markdown\n${filledBrief()}\`\`\`\n`);
    await assert.rejects(setTaskStatus({ root, taskId: "triage-plan", status: "completed" }), /Original request/);
    // The Request Brief section ends at the next ## heading; labels after it do not count.
    await writePlan(root, `## Request Brief\n\n- Original request: a\n\n## Other\n\n- Interpreted outcome: b\n- Prior records: none: x\n- Assumptions:\n  - A1 (inferred): c\n- Implicit requirements: none: d\n`);
    await assert.rejects(setTaskStatus({ root, taskId: "triage-plan", status: "completed" }), (error) => {
      assert.match(error.message, /Interpreted outcome/);
      assert.doesNotMatch(error.message, /Original request/);
      return true;
    });
    // Assumptions filled only by a sub-list.
    await writePlan(root, filledBrief());
    assert.equal((await setTaskStatus({ root, taskId: "triage-plan", status: "completed" })).tasks[0].status, "completed");
  });
});

test("--allow-no-request-brief bypasses the gate, is reported on stderr, and applies only to completion", async () => {
  await withTempRoot(async (root) => {
    await writePlan(root, "# Plan\n");
    await startTriageGoal(root);
    await recordTriage(root);
    const result = await cli(root, ["task", "triage-plan", "--status", "blocked", "--reason", "w", "--allow-no-request-brief", "legacy"]).catch((error) => error);
    assert.match(result.message, /--allow-no-request-brief applies only when completing a task/);
    const done = await cli(root, ["task", "--task", "triage-plan", "--status", "completed"]).catch((error) => error);
    assert.match(done.message, /--allow-no-request-brief <reason>/);
    const ok = await cli(root, ["task", "--task", "triage-plan", "--status", "completed", "--allow-no-request-brief", "legacy plan"]);
    assert.match(ok.stderr, /Pota warning: request-brief gate bypassed for goal task: legacy plan/);
    assert.equal(JSON.parse(ok.stdout).tasks[0].status, "completed");
  });
});

test("goal finish is gated for a triage task and accepts --allow-no-request-brief", async () => {
  await withTempRoot(async (root) => {
    await writePlan(root, "# Plan\n");
    await startGoal({
      root, goal: "g", planId: PLAN_ID, evidencePolicy: "declared", requiredEvidence: ["finalReview"],
      tasks: [{ id: "triage-plan", title: "t", requiredEvidence: ["planArtifact", "triageDecision"] }],
    });
    await recordTriage(root);
    const argv = [process.execPath, "-e", "process.exit(0)"];
    await assert.rejects(cli(root, ["finish", "--", ...argv]), /--allow-no-request-brief <reason>/);
    assert.equal((await readGoalState({ root })).tasks[0].status, "active");
    const out = await cli(root, ["finish", "--allow-no-request-brief", "legacy", "--", ...argv]);
    assert.match(out.stderr, /request-brief gate bypassed for goal finish: legacy/);
    assert.equal(await readGoalState({ root }), null);
  });
});

test("a plan id that is not a regular file skips every gate and keeps state and stdout unchanged", async () => {
  await withTempRoot(async (root) => {
    await startGoal({
      root, goal: "g", planId: "plan-status", evidencePolicy: "declared",
      tasks: [{ id: "triage-plan", title: "t", requiredEvidence: ["planArtifact", "triageDecision"] }],
    });
    await recordTriage(root);
    const done = await cli(root, ["task", "--task", "triage-plan", "--status", "completed"]);
    assert.equal(done.stderr, "");
    const replanned = await cli(root, ["replan", "--tasks", '[{"id":"more","title":"More"}]']);
    assert.equal(replanned.stderr, "");
    assert.deepEqual(JSON.parse(replanned.stdout).tasks.map((item) => item.id), ["triage-plan", "more"]);
    const steered = await cli(root, ["steer", "--kind", "correction", "--reason", "r"]);
    assert.equal(JSON.parse(steered.stdout).seq, 1);
  });
});

test("goal steer records an entry with kind and sanitized reason; a file plan needs the S<n> line first", async () => {
  await withTempRoot(async (root) => {
    await writePlan(root, filledBrief());
    await startTriageGoal(root);
    const stateBefore = await readFile(goalStatePath(root), "utf8");
    await assert.rejects(cli(root, ["steer", "--kind", "correction", "--reason", "wrong assumption"]), (error) => {
      assert.match(error.message, STEER_USAGE_HINT);
      assert.match(error.message, /Steering log/);
      return true;
    });
    await assert.rejects(access(steeringPath(root)));

    await writePlan(root, filledBrief(s1));
    const reason = `bad\u0000\u0007 reason\n${"x".repeat(600)}`;
    const out = await cli(root, ["steer", "--kind", "correction", "--reason", reason]);
    const entry = JSON.parse(out.stdout);
    assert.equal(entry.seq, 1);
    assert.equal(entry.kind, "correction");
    const stored = JSON.parse(await readFile(steeringPath(root), "utf8"));
    const goal = await readGoalState({ root });
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.goalId, goal.goal.id);
    assert.equal(stored.entries.length, 1);
    assert.equal(stored.entries[0].replan, false);
    assert.match(stored.entries[0].reason, /^bad reason x+$/);
    assert.ok([...stored.entries[0].reason].length <= 500);
    assert.doesNotMatch(stored.entries[0].reason, /[\u0000-\u001f]/);
    assert.ok(Number.isFinite(Date.parse(stored.entries[0].at)));
    // state.json is never rewritten by steer, and the schema stays v3.
    assert.equal(await readFile(goalStatePath(root), "utf8"), stateBefore);
    assert.equal(JSON.parse(stateBefore).schemaVersion, 3);
    assert.equal(typeof GOAL_STATE_CONTRACT, "object");
  });
});

test("the second steering and any redirect need a Current request line for that S<n>", async () => {
  await withTempRoot(async (root) => {
    await writePlan(root, filledBrief(s1));
    await startTriageGoal(root);
    await cli(root, ["steer", "--kind", "correction", "--reason", "one"]);
    const s2 = `${s1}  - S2 (addition): "also" -> task added\n`;
    await writePlan(root, filledBrief(s2));
    await assert.rejects(cli(root, ["steer", "--kind", "addition", "--reason", "two"]), /Current request \(as of S2\)/);
    assert.equal(JSON.parse(await readFile(steeringPath(root), "utf8")).entries.length, 1);
    await writePlan(root, filledBrief(s2).replace("- Steering log:", `${current(2)}- Steering log:`));
    const out = await cli(root, ["steer", "--kind", "addition", "--reason", "two"]);
    assert.equal(JSON.parse(out.stdout).seq, 2);
  });
  await withTempRoot(async (root) => {
    // A first steering of kind redirect also needs Current request (as of S1).
    await writePlan(root, filledBrief("  - S1 (redirect): \"switch\" -> all replaced\n"));
    await startTriageGoal(root);
    await assert.rejects(cli(root, ["steer", "--kind", "redirect", "--reason", "r"]), /Current request \(as of S1\)/);
    await writePlan(root, filledBrief("  - S1 (redirect): \"switch\" -> all replaced\n").replace("- Steering log:", `${current(1)}- Steering log:`));
    assert.equal(JSON.parse((await cli(root, ["steer", "--kind", "redirect", "--reason", "r"])).stdout).seq, 1);
  });
});

test("steer rejects bad usage, a missing goal, and a paused goal without writing anything", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(cli(root, ["steer", "--kind", "correction", "--reason", "r"]), /No Pota goal state exists/);
    await startGoal({ root, goal: "g", planId: "plan-status", tasks: ["a"] });
    await assert.rejects(cli(root, ["steer", "--kind", "bogus", "--reason", "r"]), /correction\|addition\|redirect/);
    await assert.rejects(cli(root, ["steer", "--reason", "r"]), /--kind/);
    await assert.rejects(cli(root, ["steer", "--kind", "correction"]), /--reason/);
    await assert.rejects(cli(root, ["steer", "--kind", "correction", "--reason", "\u0001 \n"]), /reason/);
    await cli(root, ["pause"]);
    await assert.rejects(cli(root, ["steer", "--kind", "correction", "--reason", "r"]), /Only an active goal can be steered/);
    await assert.rejects(access(steeringPath(root)));
  });
});

test("replan on a file plan requires --steer and --reason; none is recorded without a sequence number", async () => {
  await withTempRoot(async (root) => {
    await writePlan(root, filledBrief());
    await startTriageGoal(root);
    const tasks = '[{"id":"extra","title":"Extra"}]';
    await assert.rejects(cli(root, ["replan", "--tasks", tasks]), /--steer <correction\|addition\|redirect\|none> and --reason/);
    await assert.rejects(cli(root, ["replan", "--tasks", tasks, "--steer", "none"]), /--reason/);
    await assert.rejects(cli(root, ["replan", "--tasks", tasks, "--steer", "bogus", "--reason", "r"]), /correction\|addition\|redirect\|none/);
    assert.equal((await readGoalState({ root })).tasks.length, 2);
    await cli(root, ["replan", "--tasks", tasks, "--steer", "none", "--reason", "triage settled"]);
    const stored = JSON.parse(await readFile(steeringPath(root), "utf8"));
    assert.deepEqual(stored.entries.map((entry) => [entry.seq, entry.kind, entry.replan]), [[null, "none", true]]);
    // none does not consume a sequence number: the first user steering is still S1.
    await assert.rejects(cli(root, ["replan", "--tasks", '[{"id":"e2","title":"E2"}]', "--steer", "addition", "--reason", "r"]), /S1/);
    await writePlan(root, filledBrief("  - S1 (addition): \"more\" -> e2\n"));
    await cli(root, ["replan", "--tasks", '[{"id":"e2","title":"E2"}]', "--steer", "addition", "--reason", "r"]);
    const after = JSON.parse(await readFile(steeringPath(root), "utf8"));
    assert.deepEqual(after.entries.map((entry) => entry.seq), [null, 1]);
  });
});

test("a rejected replan leaves tasks and steering.json unchanged", async () => {
  await withTempRoot(async (root) => {
    await writePlan(root, filledBrief());
    await startTriageGoal(root);
    const before = await readFile(goalStatePath(root), "utf8");
    await assert.rejects(replanGoal({ root, tasks: ["x"], steer: "addition", reason: "r" }), STEER_USAGE_HINT);
    assert.equal(await readFile(goalStatePath(root), "utf8"), before);
    await assert.rejects(access(steeringPath(root)));
  });
});

test("when the plan is unknown, replan accepts and records --steer and --reason but needs both", async () => {
  await withTempRoot(async (root) => {
    await startGoal({ root, goal: "g", planId: "plan-status", tasks: ["a"] });
    await assert.rejects(cli(root, ["replan", "--tasks", '[{"id":"b","title":"B"}]', "--steer", "addition"]), /--reason/);
    await cli(root, ["replan", "--tasks", '[{"id":"b","title":"B"}]', "--steer", "addition", "--reason", "more work"]);
    const stored = JSON.parse(await readFile(steeringPath(root), "utf8"));
    assert.deepEqual(stored.entries.map((entry) => [entry.seq, entry.kind, entry.reason]), [[1, "addition", "more work"]]);
  });
});

test("steering.json for another goal, a symlink, or corrupt content reads as empty", async () => {
  await withTempRoot(async (root) => {
    await startGoal({ root, goal: "g", planId: "plan-status", tasks: ["a"] });
    const path = steeringPath(root);
    await writeFile(path, JSON.stringify({ schemaVersion: 1, goalId: "goal-other", entries: [{ seq: 1, kind: "correction", reason: "old", at: new Date().toISOString(), replan: false }] }));
    assert.equal(JSON.parse((await cli(root, ["steer", "--kind", "correction", "--reason", "mine"])).stdout).seq, 1);
    assert.equal(JSON.parse(await readFile(path, "utf8")).entries.length, 1);

    await rm(path);
    const target = join(root, "elsewhere.json");
    await writeFile(target, "{}");
    await symlink(target, path);
    assert.equal(goalStats(await readGoalState({ root }), root).steering.total, 0);
    assert.equal(JSON.parse((await cli(root, ["steer", "--kind", "addition", "--reason", "x"])).stdout).seq, 1);
    assert.equal((await lstat(path)).isSymbolicLink(), false);
    assert.equal(await readFile(target, "utf8"), "{}");

    await writeFile(path, "{not json");
    assert.equal(goalStats(await readGoalState({ root }), root).steering.total, 0);
    assert.equal(JSON.parse((await cli(root, ["steer", "--kind", "addition", "--reason", "y"])).stdout).seq, 1);
  });
});

test("goal stats and the history record carry steering counts only, and terminal removes steering.json", async () => {
  await withTempRoot(async (root) => {
    await startGoal({ root, goal: "g", planId: "plan-status", evidencePolicy: "declared", requiredEvidence: ["finalReview"], tasks: [{ id: "only", title: "Only", requiredEvidence: ["moduleAcceptance"] }] });
    assert.deepEqual(goalStats(await readGoalState({ root }), root).steering, { total: 0, correction: 0, addition: 0, redirect: 0 });
    await cli(root, ["steer", "--kind", "correction", "--reason", "secret reason text"]);
    await cli(root, ["steer", "--kind", "redirect", "--reason", "r2"]);
    await cli(root, ["replan", "--tasks", '[{"id":"only","title":"Only","requiredEvidence":["moduleAcceptance"]}]', "--steer", "none", "--reason", "n"]);
    const stats = JSON.parse((await cli(root, ["stats"])).stdout);
    assert.deepEqual(stats.steering, { total: 2, correction: 1, addition: 0, redirect: 1 });
    await recordReceipt({ root, taskId: "only", kind: "moduleAcceptance", command: "c", exitCode: 0 });
    await setTaskStatus({ root, taskId: "only", status: "completed" });
    await recordReceipt({ root, scope: "goal", kind: "finalReview", command: "c", exitCode: 0 });
    await transitionGoal({ root, status: "completed" });
    const text = await readFile(goalHistoryPath(root), "utf8");
    const record = JSON.parse(text.trim().split("\n").at(-1));
    assert.deepEqual(record.steering, { total: 2, correction: 1, addition: 0, redirect: 1 });
    assert.doesNotMatch(text, /secret reason text/);
    await assert.rejects(access(steeringPath(root)));
  });
});

test("an S<n> line must match the command kind and carry real text; the template example does not count", async () => {
  await withTempRoot(async (root) => {
    await startTriageGoal(root);
    for (const line of [
      "  - S1 (correction|addition|redirect): <the user's words> -> <changed>\n",
      "  - S1 (correction): <the user's words>\n",
      "  - S1 (correction):\n",
      "  - S1 (addition): \"x\" -> y\n",
      "  - S1 correction: x\n",
    ]) {
      await writePlan(root, filledBrief(line));
      await assert.rejects(cli(root, ["steer", "--kind", "correction", "--reason", "r"]), /S1/, line);
    }
    await assert.rejects(access(steeringPath(root)));
  });
});

test("pota plan steering lists Request Brief steering entries read-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "pota-plan-steering-"));
  try {
    const plans = join(root, "docs", "plan");
    await mkdir(plans, { recursive: true });
    await writeFile(join(plans, "a.md"), filledBrief("  - S1 (correction): first\u0001 text\n  - S2 (redirect): " + "y".repeat(300) + "\n  - S3 (addition): <placeholder>\n"));
    await writeFile(join(plans, "b.md"), `## Request Brief\n\n\`\`\`\n- S1 (addition): fenced\n\`\`\`\n`);
    await writeFile(join(plans, "c.md"), filledBrief("  - S1 (addition): later\n"));
    await utimes(join(plans, "a.md"), new Date(1000), new Date(1000));
    await symlink(join(plans, "c.md"), join(plans, "link.md"));
    const run = (args) => spawnSync(process.execPath, [join(process.cwd(), "scripts", "pota.mjs"), "plan", "steering", ...args, "--root", root], { encoding: "utf8" });
    const result = run([]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.plans.map((plan) => plan.plan), ["docs/plan/c.md", "docs/plan/a.md"]);
    assert.deepEqual(report.byKind, { correction: 1, addition: 1, redirect: 1 });
    assert.equal(report.total, 3);
    const a = report.plans[1].entries;
    assert.equal(a[0].text, "first text");
    assert.equal([...a[1].text].length, 200);
    assert.equal(JSON.parse(run(["--limit", "1"]).stdout).plans.length, 1);
    assert.equal(run(["--limit", "0"]).status, 2);
    assert.equal(run(["--bogus"]).status, 2);
    assert.deepEqual((await readdir(root)).sort(), ["docs"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("goal --help lists steer and the new flags", async () => {
  const lines = [];
  await handleGoalCli(["--help"], { stdout: (line) => lines.push(line), stderr: () => {}, env: process.env });
  const help = lines.join("\n");
  for (const text of ["steer", "--allow-no-request-brief", "--steer", "--reason"]) assert.ok(help.includes(text), text);
});

function steeringPath(root) {
  return join(dirname(goalStatePath(root)), "steering.json");
}

async function writePlan(root, text) {
  const path = join(root, PLAN_ID);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function startTriageGoal(root) {
  return startGoal({
    root,
    goal: "Brief goal",
    planId: PLAN_ID,
    evidencePolicy: "declared",
    requiredEvidence: ["finalReview"],
    tasks: [
      { id: "triage-plan", title: "Triage", requiredEvidence: ["planArtifact", "triageDecision"] },
      { id: "work", title: "Work" },
    ],
  });
}

async function recordTriage(root) {
  for (const kind of ["planArtifact", "triageDecision"]) {
    await recordReceipt({ root, taskId: "triage-plan", kind, command: `record ${kind}`, exitCode: 0 });
  }
}

async function cli(root, args) {
  const out = [];
  const err = [];
  const separator = args.indexOf("--");
  const withRoot = separator === -1 ? [...args, "--root", root] : [...args.slice(0, separator), "--root", root, ...args.slice(separator)];
  await handleGoalCli(withRoot, { stdout: (line) => out.push(line), stderr: (line) => err.push(line), env: { ...process.env } });
  return { stdout: out.join("\n"), stderr: err.join("\n") };
}

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-request-brief-"));
  const stateHome = `${root}-home`;
  const previousPotaHome = process.env.POTA_HOME;
  process.env.POTA_HOME = stateHome;
  try {
    await work(root);
  } finally {
    if (previousPotaHome === undefined) delete process.env.POTA_HOME;
    else process.env.POTA_HOME = previousPotaHome;
    await rm(root, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
}
