---
name: pota-work
description: Use after pota-plan to execute the next incomplete docs/plan module task with the recorded Light/Heavy Path route, bounded worker delegation, dry-run/check evidence, and two verification gates.
---

# Pota Work

Implement a `pota-plan` plan, never as a shortcut around planning: one module task at a time, advancing the goal until every task and the goal-level final review complete. Quick Path work (criteria in `pota-plan`) has no plan or goal: implement, run one focused check plus the project's normal check, and report; if any Quick Path criterion fails, escalate to Light Path (create plan + goal) before further edits.

The user-called/main agent orchestrates (selects, assigns, verifies, records). Implementation edits go to `worker` whenever subagent tools are available; otherwise the main agent takes over and records it. Answer side questions briefly and resume the current task unless the user asks to pause, stop, or switch.

## Re-entry and Required References

At the start and after compaction, restart, delegation, or handoff, restore context in this order: optional root `MEMORY.md` → `pota-work` → the active plan → current-task references → model guidance recorded by the plan. Confirm that plan task, persisted current task, and assignment agree. Missing `MEMORY.md` is not an inconsistency. If state, plan, assignment, or another required reference is missing, unreadable, or inconsistent, do not edit, delegate, record completion evidence, or complete work; report a blocker. No read receipts: state and fresh tool-bound evidence are the authority. A delegated agent restores on its own entry; the orchestrator rereads only changed references, keeping the cached prefix stable.

## Runtime Location

Resolve the read-only runtime from `references/pota-runtime.json` next to this `SKILL.md` (its `pluginRoot`; in a source checkout without it, this file's `../..`). Never search the target repository for Pota files; resolve `pota://...` IDs through `pluginRoot`. If the runtime or locator is missing, unreadable, or inconsistent, stop every dependent mirror and recover with published/global `pota doctor` then `pota upgrade`.

The session-start hook prints `Pota CLI: node "<abs>/scripts/pota.mjs" goal <command>`. Copy that prefix literally into each command; never store it in a shell variable (shell variables do not persist between tool calls). `--root` is optional for every `goal` subcommand: when omitted it resolves via `HARNESS_REPO_ROOT`, else the nearest `.git` ancestor of the cwd.

```sh
node "<pluginRoot>/scripts/pota.mjs" goal task status --root "<repoRoot>"
node "<pluginRoot>/scripts/pota.mjs" goal ready --root "<repoRoot>"
node "<pluginRoot>/scripts/pota.mjs" goal replan --quiet --root "<repoRoot>" --tasks '[{"id":"<task-id>","title":"<task-title>","requiredEvidence":["moduleAcceptance","surfaceIntegration"]}]'
node "<pluginRoot>/scripts/pota.mjs" goal assign --quiet --root "<repoRoot>" --task "<task-id>" --agent "<agent-id>" --effort "<value>" --effort-source "<host-option|inherited|not-applied>"
node "<pluginRoot>/scripts/pota.mjs" goal verify --quiet --root "<repoRoot>" --task "<task-id>" --kind "moduleAcceptance|surfaceIntegration" --watch "<path|path>" -- <tool> <arg> ...
node "<pluginRoot>/scripts/pota.mjs" goal task --quiet --root "<repoRoot>" --task "<task-id>" --status completed
node "<pluginRoot>/scripts/pota.mjs" goal finish --quiet --root "<repoRoot>" --watch "<path|path>" -- <tool> <arg> ...
node "<pluginRoot>/scripts/pota.mjs" goal stats --root "<repoRoot>"
```

- `goal verify` runs the argv after `--` without a shell and binds exit code, output digest, and watched fingerprint. One run with `--kind "a|b"` records one receipt per kind. Evidence scopes are only `task` and `goal`.
- `goal finish` completes the active task (its required evidence must already be fresh), fails if any other task is not completed, runs the argv once, records every goal requiredEvidence kind (default `finalReview`) at goal scope, and completes the goal. It replaces the long form `task --status completed` → `verify --scope goal` → `complete`.
- Read full `goal status` only when receipts are needed. `goal stats` prints JSON receipt counts, reruns, and stale receipts.
- Use `--quiet` on state mutations. Pause, block, cancel, and claim: `recovery.md`.

## Reference Files

Read a reference only when the selected path or situation requires it (Quick and Light Path never need `heavy-path.md`):

- `pota://skills/pota-work/verification.md`: timeouts, watch sets, freshness, defect investigation, tool readiness, dry-run policy.
- `pota://skills/pota-work/delegation.md`: subagent lifecycle, parallel tasks, builder prompt, reasoning effort.
- `pota://skills/pota-work/heavy-path.md`: Heavy gates and route changes; read only on a Heavy route or signal.
- `pota://skills/pota-work/recovery.md`: failed gates, blocked/paused goals, ownership conflicts.

## Procedure

1. Read `MEMORY.md` when present, `PLAN.md`, the plan, relevant memory notes, and the `pota://docs/model-guidance/*.md` inputs it records.
2. Read the current task with `goal task status`, then run `goal ready`: activate (`goal task --task <id> --status active`) and delegate independent ready tasks to parallel workers in the same worktree with disjoint `writeScope` and `--watch` inside it (`delegation.md`); rerun `goal ready` after each completion. Fold new requests in with `goal replan`, never cancel; with no goal, create one from the plan.
3. Confirm tool readiness, route, and the request and planning checkpoints; inspect exact files, callers, and tests and record the code checkpoint just before the first edit (pending blocks mutation).
4. Use the test contract first: spend reasoning on requirements, invariants, boundaries, and failure modes, write focused tests, confirm the intended failure, then give the `worker` only the contract, failing evidence, file scope, and constraints; require the minimum implementation.
5. Before mutating external state, run the recorded dry-run or check (or record its absence).
6. Run both gates through `goal verify -- ...` (module acceptance, surface integration). Treat the tool exit code as authoritative; keep successes short and expand context only for the failing test.
7. Complete the task only with fresh required evidence, then continue. For the last task, run one goal-level final check through `goal finish -- ...`.
8. Record evidence and the memory promotion decision (`verification.md`) in the plan and state before updating `PLAN.md`. Workers report only their assigned task.

## Evidence Rules

- Verification ladder: focused contract tests, then one full repository check after the final change, then package verification. Inspect package lifecycle scripts and run normal `npm pack --dry-run` by default. Content-producing or unknown lifecycle scripts must never use `--ignore-scripts`; only absent or proven content-neutral scripts may use `--ignore-scripts` while the full check is fresh.
- Any relevant mutation after a gate makes that result stale evidence; rerun the affected gate before completing the current task. Do not rerun earlier completed tasks' checks after later edits: one fresh goal-scope receipt for every goal requiredEvidence kind recorded after all task receipts supersedes their fingerprints (if goal requiredEvidence is empty, task freshness is still rechecked).
- Never edit, weaken, skip, or delete existing tests, fixtures, snapshots, or recorded verification commands to make a gate pass; record a genuine contract change in the plan first. After a defect fix, search for other implementations of the same rule or pattern.
- At most two verification passes per task; after two failures, record the blocker (`recovery.md`).
- Model and reasoning effort: This skill explicitly instructs the effort level for delegated work. Use each task's recorded model and request Light `medium`, Heavy `high`, final verification/review `xhigh`. Every new task/worker dispatch MUST pass the task's model and effort through the host option (Claude Code: Agent `model`/`effort`; never `fork`). Recording without passing is a defect. Record Requested/Effective model and reasoning effort per task (details, Heavy completion gate: `delegation.md`). Route changes resync the reasoning effort profile: completed profiles are preserved, incomplete profiles are recalculated.
- Missing, failed, skipped, stale, or placeholder evidence never completes work. Use the OS locale for output and artifacts.

## Completion Criteria

- Both gates passed with fresh evidence (Heavy: `Tests:`); the goal finished through `goal finish` or is explicitly `paused`, `blocked`, or `cancelled` with a reason.
- Delegation, tool readiness, dry-run, route, and model guidance followed the plan; no judge weakened; defect fixes record the same-rule sweep.
- Evidence is in the plan before `PLAN.md` is updated.
