# pota-work

Use the `pota-work` skill.

Prerequisite: resolve the installed Pota runtime from the plugin or skill locator. If the shared runtime or locator is missing, unreadable, or inconsistent, stop every dependent mirror; run published/global `pota doctor`, then `pota upgrade` to recover it. Never repair through another mirror or look for Pota scripts or model guidance in the target repository.

Goal: execute the active goal's current task without bypassing complexity triage, then keep advancing tasks until goal-level final review completes or the goal is explicitly paused, blocked, or cancelled. Quick Path work has no plan or goal: implement, run one focused check plus the project's normal check, and report; escalate to Light Path (plan + goal) before further edits if any Quick Path criterion fails.

Record the code checkpoint after exact file/caller/test inspection immediately before the first edit. After editing begins, a new Heavy Path signal promotes Light Path to Heavy Path: stop further edits, mark affected evidence stale, synchronize the plan artifact, `goal replan` roadmap, and native UI plan, and repeat the code checkpoint. Choose each task's model by its nature (fast, balanced, stronger, strongest) and pass it with effort through the host option; request Light `medium`, Heavy `high`, final verification/review `xhigh`.

Procedure:

1. Every agent reads project-root `MEMORY.md` when present and continues without repository memory when absent before selecting or executing a task.
2. Read `PLAN.md`, the detailed plan, relevant memory notes, and the `pota://` model guidance recorded in the plan through the installed runtime.
3. Read the current task with `goal task status`; run `goal ready` and delegate independent ready tasks to parallel workers (same worktree, disjoint `writeScope`). Fold a new request into an unfinished goal with `goal replan` instead of cancelling it. Copy the session-start hook's `Pota CLI:` prefix literally; never store it in a shell variable. `--root` may be omitted when the cwd is inside the repository.
4. Confirm tool readiness (installation only with explicit approval) and the recorded route.
5. Before implementation, spend reasoning on a focused executable test contract covering requirements, invariants, boundaries, and failure modes. Confirm the intended failure, then give the `worker` the contract, failing evidence, exact file ownership, and constraints and require the minimum change.
6. Run module acceptance and surface integration through `goal verify -- ...`; `--kind "moduleAcceptance|surfaceIntegration"` records both from one run. Treat tool exit codes as authoritative and expand context only around failing tests. Heavy Path records explicit `Tests:` evidence.
7. Never edit, weaken, skip, or delete existing tests, fixtures, or verification commands to make a gate pass unless the plan records the contract change. Reproduce reported defects before fixing, and after a fix search for other implementations of the same rule or pattern.
8. Inspect package lifecycle scripts and run normal `npm pack --dry-run` by default. Content-producing or unknown lifecycle scripts must never use `--ignore-scripts`; only absent or proven content-neutral scripts may use it while the full check remains fresh.
9. Relevant mutation makes the current task's evidence stale; rerun it before completing the task. Do not rerun earlier tasks' checks; finish with one goal-level check through `goal finish -- ...`. Missing, failed, skipped, stale, or placeholder evidence never completes work. `goal stats` measures receipt reruns; `goal stats --history` compares finished goals of the repository.
10. Read the skill's reference files only when needed: `pota://skills/pota-work/verification.md`, `pota://skills/pota-work/delegation.md`, `pota://skills/pota-work/recovery.md`, and `pota://skills/pota-work/heavy-path.md` (Heavy route only).
11. Before `goal finish`, record the memory promotion decision in the plan's Evidence: `Memory promotion: docs/memory/<domain>.md` when the goal produced reusable repository knowledge (write the note with a `Summary:` line, then run `memory index --root <repoRoot>`), otherwise `Memory promotion: none: <reason>`. The line is required and the note is optional: do not create a note when nothing qualifies. Update the plan, goal state, and `PLAN.md` only after evidence exists. Answer side questions briefly and resume unless explicitly asked to pause, stop, or switch.
12. Use the OS locale for user-visible responses and generated or updated documentation, plans, and memory artifacts unless the user asks for another language.
