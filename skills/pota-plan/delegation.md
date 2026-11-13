# Pota Plan: Delegation and Reasoning Effort

Reference for `pota-plan`. Read before dispatching `explorer` or `worker` agents or recording reasoning effort. Quick Path work done directly by the main agent does not need this file.

## Subagent Lifecycle

- Treat the user-called/main agent as the orchestrator: it plans, assigns, verifies, and records evidence.
- Use `explorer` for independent read-only codebase discovery, impact analysis, pattern searches, and read-only verification that can run in parallel when the current tool list supports it.
- Use `worker` for actual implementation edits with clear file ownership whenever subagent tools are available, on both Light Path and Heavy Path.
- When the subagent tool provides a progress-reporting channel, require subagents to report status to the orchestrator when starting work, when deciding or confirming direction, during periodic progress, and when finishing; the orchestrator must immediately relay received status events to the user. If no mid-run reporting channel exists, relay observable events such as assignment, waiting, and final completion.
- Require delegated subagents to provide a final report before leaving; after capturing the final report and evidence, close or release the completed subagent, then review the final report and evidence before marking the work complete.
- When subagent tools are available, each agent may recursively delegate bounded sub-tasks to subagents, subject to the current surface's depth and concurrency limits.
- If subagent tools are unavailable, the main agent takes over implementation directly and records that takeover in evidence; do not stop solely because subagent tools are unavailable.
- Keep urgent non-implementation blocking work local when the next step depends immediately on the result.
- Tell every delegated agent and child subagent to read project-root `MEMORY.md` when present and continue when absent, keep scope, and tell workers they are not alone in the codebase and must not revert others' edits.
- Put the selected `docs/memory/<domain>.md` note paths (picked from `MEMORY.md` entries) in the prompt `CONTEXT:` line. A delegated agent may not receive the session-start memory list, so do not rely on it reaching subagents.
- Host task-list tools (`update_plan`, `create_goal`, `wrap_up`) are called by the main agent only; a worker or subagent skips them (hosts reject them from subagents) and reports in its final report.
- Every plan must require these status, final-report, close-and-review, and recursive-delegation rules.

## Task Graph

- Every task in `goal start --tasks` / `goal replan --tasks` JSON declares `dependsOn` (task ids) and `writeScope` (literal repo-relative paths; no globs, `..`, or absolute paths). Example: `{"id":"api","title":"API","dependsOn":["triage-plan"],"writeScope":["src/api"]}`.
- Omitted `dependsOn` means the previous task in list order (first task: none); explicit `[]` means no dependency, so sequential plans keep working. In `goal replan` the default chains across completed and new tasks, and `dependsOn` may reference completed tasks. Duplicate ids, unknown ids, self references, and cycles are rejected.
- Omitted `writeScope` is null: that task can only be active alone. Give independent tasks disjoint scopes so they can run in parallel; scope is declarative, not filesystem-enforced.
- Pota has no messaging channel: name the handoff files that carry data between tasks in the plan (`Handoff files:`) and include them in the producer's `writeScope`.

## Delegation Prompt Format

```text
TASK: Produce <role> input needed for the <topic> plan.
EXPECTED OUTCOME: Return concrete decisions, file paths, dependencies, risks, and evidence requirements.
REQUIRED TOOLS: Read-only repository exploration, tool readiness checks, LSP/symbol tools, local command checks.
MODEL: <tier/value> (passed via host option)
REASONING EFFORT: <value> (passed via host option)
MUST DO: Read the project-root `MEMORY.md` before doing assigned work. Preserve proper nouns exactly. Prefer repository evidence. Report missing tools and obtain explicit user approval before any installation. Identify assumptions. Follow the subagent lifecycle rules (status reporting when a channel exists, final report before leaving, recursive delegation only for bounded sub-tasks, passing each child's reasoning effort through the host option; report the exact model ID from your own system prompt in the final report, `unreported` if absent, never guess; skip host task-list tools `update_plan`, `create_goal`, `wrap_up`). Tell workers they are not alone in the codebase and must not revert others' edits. Use the OS locale for user-visible responses and generated or updated documentation, plans, and memory artifacts.
MUST NOT DO: Edit production code. Ask the user. Expand scope. Delegate vague or unbounded work.
CONTEXT: User request, MEMORY.md, selected `docs/memory/<domain>.md` note paths, applied model guidance, repository root, Pota CLI prefix line from the session-start hook.
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
- On every route change, synchronize the plan artifact, repository goal task roadmap through `goal replan`, native UI plan, and reasoning effort profile before mutation. Completed task profiles are preserved as audit history; incomplete task profiles are recalculated for the new path.
