# Pota Work: Delegation and Reasoning Effort

Reference for `pota-work`. Read before dispatching a `worker` or `explorer`, or when recording reasoning effort. Quick Path work done directly by the main agent does not need this file.

## Subagent Lifecycle

- The user-called/main agent is the orchestrator: it selects the task, assigns implementation, verifies results, and records evidence. Actual implementation edits belong to `worker` subagents whenever subagent tools are available, regardless of Light Path or Heavy Path.
- Delegate implementation with exact files, ownership, constraints, and model-specific adjustment rules. For Light Path use one bounded `worker`. Use `explorer` for parallel read-only discovery or verification when useful.
- When the subagent tool provides a progress-reporting channel, subagents report status to the orchestrator when starting work, when deciding or confirming direction, during periodic progress, and when finishing. The orchestrator must immediately relay received status events to the user. If no mid-run reporting channel exists, the orchestrator relays observable events such as assignment, waiting, and final completion.
- Delegated subagents must provide a final report before leaving. After the orchestrator captures the final report and evidence, it must close or release the completed subagent, then review the final report and evidence before marking the work complete.
- When subagent tools are available, each agent may recursively delegate bounded sub-tasks to subagents. Every child subagent reads project-root `MEMORY.md` when present and continues when absent, keeps the assigned scope, and preserves others' edits.
- Put the selected `docs/memory/<domain>.md` note paths (picked from `MEMORY.md` entries) in the prompt `CONTEXT:` line. A delegated agent may not receive the session-start memory list, so do not rely on it reaching subagents.
- Host task-list tools (`update_plan`, `create_goal`, `wrap_up`) are called by the main agent only; a worker or subagent skips them (hosts reject them from subagents) and reports in its final report.
- If subagent tools are unavailable, the main agent takes over implementation directly and records that takeover in evidence.
- `worker` returns a structured handoff for only its assigned goal/task: changed files, tool readiness result, dry-run or check result when applicable, automated test result for Heavy Path, module acceptance command and result, surface integration command or QA artifact, blocker, and cleanup notes. A worker must not select the next task.

## Parallel Tasks

- `goal ready` (read-only) prints `{"active":[...],"ready":[...],"blocked":[...]}` task ids. A ready task is pending with every dependency completed.
- Only ready tasks can be activated: `goal task --task <id> --status active`. At most 4 tasks are active at once; active `writeScope`s must not overlap (segment-wise prefix, case-insensitive), and a task without `writeScope` is active only alone. start/replan/completion auto-activate only the first ready task when nothing is active; open further parallel tasks explicitly.
- Assign one `worker` per active task (`goal assign`); assignment, evidence, and completion stay per task. Workers stay inside their `writeScope` and exchange data only through the plan's handoff files.
- Parallel workers must run in the same Git worktree: goal state is stored per worktree, so another worktree sees no goal.
- While other tasks are active, task-scope `goal verify` needs `--watch` paths inside that task's `writeScope`, so sibling edits cannot stale or fail its evidence; goal-scope verify needs `--watch` when 2 or more tasks are active.
- Rerun `goal ready` after each completion. A blocked task keeps its dependents pending while unrelated branches continue; the goal becomes blocked only when no task is active or ready.
- Main Stop gates on all active tasks; SubagentStop gates the stopping agent's own assigned active task. The hook adds one `Parallel active:` line only when 2 or more tasks are active.

## Builder Prompt Format

```text
TASK: Implement task <task-id> for <topic>.
EXPECTED OUTCOME: Minimal code or documentation change satisfying the task contract.
REQUIRED TOOLS: Scoped file editing, tool readiness checks, existing test/build commands, surface QA commands.
MODEL: <tier/value> (passed via host option)
REASONING EFFORT: <value> (passed via host option)
MUST DO: Read the project-root `MEMORY.md` before doing assigned work and follow its policy. Stay within the listed file scope and the task's `writeScope`. Assume you are not alone in the codebase; do not revert others' edits. Follow the subagent lifecycle rules (status reporting when a channel exists, final report before leaving, recursive delegation only for bounded sub-tasks with these same constraints, passing each child's reasoning effort through the host option; report the exact model ID from your own system prompt in the final report, `unreported` if absent, never guess; skip host task-list tools `update_plan`, `create_goal`, `wrap_up`). Obtain explicit user approval before installing missing tools. Run dry-run or check mode before external-state mutation when available. Provide module evidence, surface evidence, and a structured handoff scoped to the assigned goal/task. Never edit, weaken, skip, or delete existing tests, fixtures, or verification commands to pass a gate without a reason recorded in the plan. After a defect fix, search for other implementations of the same rule or pattern and report them. Copy the Pota CLI prefix line literally; never store it in a shell variable. Use the OS locale for user-visible responses and generated or updated documentation, plans, and memory artifacts.
MUST NOT DO: Ask the user. Skip LSP/typecheck/lint because a tool is missing without attempting installation. Refactor unrelated code. Continue an open-ended verification loop. Treat a side question as permission to abandon the active task. Delegate vague or unbounded work. Claim completion without evidence. Modify files outside the assigned ownership.
CONTEXT: docs/plan/<topic>.md task, selected `docs/memory/<domain>.md` note paths, applied model guidance, exact files, verification commands, Pota CLI prefix line.
```

## Model and Reasoning Effort Routing

This skill explicitly instructs the effort level for delegated work. It also instructs each task's model.

- The plan decides each task's model from its nature and records `Requested model` and `Effective model`; models are not always inherited. Tiers: fast = read-only exploration, search, inventory, summarization (Claude Code `haiku`); balanced = Light Path implementation and routine verification (`sonnet`); stronger = planning, complexity triage, Heavy Path implementation, review, and final verification/review (`opus`); strongest = Heavy Path design only (`fable`).
- Model Effective is the passed value plus the exact model ID the worker reports from its own system prompt, e.g. `fable (claude-fable-5-1)`; when the report has no ID, record `<value> (unreported)` and never guess, via `goal assign --effective-model <id|unreported>`. Not passed is `not-applied: <reason>`; `inherited` only when the host has no model option. Codex passes the tier's slug (table below) through the host-native model option, else `inherited`.
- If a lower-tier worker fails a gate, re-dispatch that task one tier up (fast, balanced, stronger, strongest) before recording a blocker.
- A subagent's model and effort are fixed at dispatch. Any re-dispatch that changes either (one tier up, Light → Heavy promotion, route-change recalculation) MUST be a new dispatch (Claude Code: a new Agent call); never continue the existing subagent with `SendMessage`, which keeps its original model and effort.
- Routing is per dispatch only; never change model or global/user config files. `Model routing: inherited` in `MEMORY.md` or the plan disables per-task selection.
- Light Path planning, implementation, and verification request `medium`.
- Heavy Path planning, review, and implementation request `high`; final verification and review request `xhigh`.
- Every new task/worker dispatch MUST pass the task's requested effort through the host option. Recording without passing is a defect. Pass the chosen model the same way (Claude Code: Agent `model`). Child (recursive) dispatches follow the same rule.
- Every module task records `Requested reasoning effort` and `Effective reasoning effort` in `docs/plan/<topic>.md`. Requested is Pota's desired profile; Effective is decided by the dispatch call:
  - Effort passed and not rejected: Effective is the requested value.
  - Effort not passed: `not-applied: <reason>`; the reason is required.
  - `inherited` only when the host exposes no effort option. Describe host capability only from the exposed interface or dispatch response, and distinguish Pota non-integration from host non-support.

| Host | Model / effort option | Effective |
| --- | --- | --- |
| Claude Code | Agent tool `model` parameter (`haiku\|sonnet\|opus\|fable`). `effort` parameter (`low\|medium\|high\|xhigh\|max`), matching Pota values one to one. `subagent_type: "fork"` ignores `model` and `effort`, so never dispatch routed work as a fork. | requested value |
| Codex | Host-native model option (fast `gpt-6-luna`, balanced `gpt-6.1-terra`, stronger `gpt-6-sol`, strongest `gpt-6-astra`) and task/subagent reasoning-effort option or equivalent. | requested value |
| Antigravity | `invoke_subagent` `Model` takes only a tier enum: fast `flash_lite`, balanced `flash`, stronger `pro`, strongest `pro` (no tier above `pro`); `inherit` is not used for routed work. No effort option. | model: passed value; effort: `inherited` |
| Host without an option | None. | `inherited` |

- After each dispatch, record state with `goal assign --task <id> --agent <id> --effort <value> --effort-source <host-option|inherited|not-applied>`; for a `kind: "design"` task also `--model <value> --model-source host-option --host <claude-code|codex|antigravity>`. A design model that is not the host's strongest tier (`--host claude-code` `fable`, `codex` `gpt-6-astra`, `antigravity` `pro`; any of the three when `--host` is omitted) fails completion unless `--allow-no-design-model <reason>`. Mark Heavy tasks with `route: "heavy"` (tasks JSON field or `goal assign --route heavy`). A Heavy task with no effort, `not-applied`, or `inherited` fails `goal task --status completed` unless `--allow-inherited-effort <reason>` records why.
- On every route change, synchronize the plan artifact, repository goal task roadmap through `goal replan`, native UI plan, and reasoning effort profile before edits resume. Completed task profiles are preserved as audit history; incomplete task profiles are recalculated for the new path.
