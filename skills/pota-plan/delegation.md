# Pota Plan: Delegation and Reasoning Effort

Reference for `pota-plan`. Read before dispatching `explorer` or `worker` agents or recording reasoning effort. Quick Path work done directly by the main agent does not need this file.

## Subagent Lifecycle

- Treat the user-called/main agent as the orchestrator: it plans, assigns, verifies, and records evidence.
- Use `explorer` for independent read-only codebase discovery, impact analysis, pattern searches, and read-only verification that can run in parallel when the current tool list supports it.
- Use `worker` for actual implementation edits with clear file ownership whenever subagent tools are available, on both Light Path and Heavy Path.
- When the subagent tool provides a progress-reporting channel, require subagents to report status to the orchestrator when starting work, when deciding or confirming direction, during periodic progress, and when finishing; the orchestrator must immediately relay received status events to the user. If no mid-run reporting channel exists, relay observable events such as assignment, waiting, and final completion.
- Require delegated subagents to provide a final report before leaving; after capturing the final report and evidence, close or release the completed subagent when the host provides a non-destructive close/release action, or leave completed subagents idle instead of calling a destructive kill (such as Antigravity's `manage_subagents(kill)`, which marks them `Cancelled` in the UI), then review the final report and evidence before marking the work complete.
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
MUST DO: Read the project-root `MEMORY.md` before doing assigned work. Preserve proper nouns exactly. Prefer repository evidence. Report missing tools with the `toolcheck` install proposal to the orchestrator, which asks the user once; never install without that approval. Identify assumptions. Follow the subagent lifecycle rules (status reporting when a channel exists, final report before leaving, recursive delegation only for bounded sub-tasks, passing each child's reasoning effort through the host option; report the exact model ID from your own system prompt in the final report, `unreported` if absent, never guess; skip host task-list tools `update_plan`, `create_goal`, `wrap_up`). Tell workers they are not alone in the codebase and must not revert others' edits. Use the OS locale for user-visible responses and generated or updated documentation, plans, and memory artifacts.
MUST NOT DO: Edit production code. Ask the user. Expand scope. Delegate vague or unbounded work.
CONTEXT: User request, MEMORY.md, selected `docs/memory/<domain>.md` note paths, applied model guidance, repository root, Pota CLI prefix line from the session-start hook, the `Pota model ceiling:` line when present.
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
| Antigravity | Default `invoke_subagent` `Model` takes only a tier enum: fast `flash_lite`, balanced `flash`, stronger `pro`, strongest `pro` (no tier above `pro`); `inherit` is not used for routed work, and it has no effort option. Optional `swarm` dispatch: when `swarm` is available and a specific model or effort suffix (`-medium`, `-high`, `-xhigh`) is needed (e.g., Heavy design on `gemini-4-argon-*`), check `swarm(action: "models")` first and dispatch via `swarm(action: "add", model: "<model>")`. | `invoke_subagent`: model: passed value, effort: `inherited`; `swarm`: requested model/effort |
| Host without an option | None. | `inherited` |

- On Antigravity, default delegation uses `invoke_subagent`. When `swarm` is used, record the passed model with `goal assign --model <value> --model-source host-option --host antigravity`; Pota classifies Antigravity model IDs into the 4 tiers (`fast`: `gemini-*-flash-lite`; `balanced`: `gemini-*-flash`, `gpt-oss-*`, `claude-sonnet-*`; `stronger`: `gemini-4-hydrogen*`, `gemini-4-neon*`, `gemini-pro-orchestrator*`, `claude-opus-*`; `strongest`: `gemini-4-argon*`).

- After each dispatch, record state with `goal assign --task <id> --agent <id> --effort <value> --effort-source <host-option|inherited|not-applied>`; for a `kind: "design"` task also `--model <value> --model-source host-option --host <claude-code|codex|antigravity>`. A design model that is not the host's strongest tier (`--host claude-code` `fable`, `codex` `gpt-6-astra`, `antigravity` `pro`; any of the three when `--host` is omitted) fails completion unless `--allow-no-design-model <reason>`. Under a model ceiling the ceiling tier's model or a higher one passes (see Model Ceiling). Mark Heavy tasks with `route: "heavy"` (tasks JSON field or `goal assign --route heavy`). A Heavy task with no effort, `not-applied`, or `inherited` fails `goal task --status completed` unless `--allow-inherited-effort <reason>` records why.
- On every route change, synchronize the plan artifact, repository goal task roadmap through `goal replan`, native UI plan, and reasoning effort profile before mutation. Completed task profiles are preserved as audit history; incomplete task profiles are recalculated for the new path.

## Main Model Gate

Routing covers dispatches only, so work the main agent does itself runs on the session model. The session-start hook reads the host's `model` field. When it is below the stronger tier (fast or balanced), the hook adds one `Pota main model:` line to the capsule, shows the user a notice, and records the model for this session.

- With that line present, the main agent does not plan, triage, or review inline. Dispatch planning and triage (the `triage-plan` work) and the final review to the stronger tier or above (the capped stronger tier under a model ceiling) through the host option, then record each dispatch: `goal assign triage-plan --agent <id> --model <value> --model-source host-option --host <claude-code|codex|antigravity>` and `goal assign <review-task> --kind review --agent <id> --model <value> --model-source host-option --host <claude-code|codex|antigravity>`.
- Enforced by the CLI: completing a task whose required evidence includes `triageDecision`, and `goal finish` or `goal complete`, fail without that record. `--allow-main-model <reason>` on the completing command is the only bypass. Use it when subagent tools are unavailable, when `Model routing: inherited` is set, when the user accepts the session model, or when the session model changed after session start (give the exact model ID from your own system prompt). Record the reason in the plan's Evidence.
- No line means no gate: an absent or unrecognized `model` value is never treated as a lower tier. A model switch is picked up by the next session start at the latest. `POTA_MAIN_MODEL_GATE=0` (or `false`, `off`, `no`) turns the line, the notice, the record, and both CLI checks off, for users who keep the session model; an account that cannot use the stronger tier sets a model ceiling instead (see Model Ceiling).

## Model Ceiling

The tier values above assume every tier is usable. When the account cannot or should not use the higher tiers (subscription, organization policy, usage credits), the user sets a ceiling: `POTA_MODEL_CEILING=stronger|balanced`, or `"modelCeiling"` in `~/.pota/config.json` (the environment variable wins; a model name such as `opus` or `sonnet` is read as its tier). The session-start hook then adds one `Pota model ceiling:` line to the capsule.

- With that line present, tiers above the ceiling use the ceiling tier's model: ceiling `stronger` runs strongest-tier work (Heavy design) on the stronger model; ceiling `balanced` runs stronger- and strongest-tier work on the balanced model. The line overrides the tier values in skill text, templates, and the table above. Never dispatch above the ceiling, and stop the one-tier-up re-dispatch at the ceiling.
- The task structure does not change: Heavy design stays a separate `kind: "design"` dispatch, and planning, triage, and review are still dispatched when the capsule has a `Pota main model:` line. Pass the capped value through the host option and record it (`goal assign --model <capped value> --model-source host-option --host <claude-code|codex|antigravity>`); write `Requested model` as the capped value with `(ceiling <tier>)`. Put the `Pota model ceiling:` line in each delegation prompt's `CONTEXT:`.
- Enforced by the CLI with the same setting: the design gate accepts the ceiling tier's model or any higher one, and the main-model gate uses the capped stronger tier (ceiling `balanced`: only a fast main session is gated, and a balanced dispatch passes).
- The ceiling is the user's setting. Never set `POTA_MODEL_CEILING` yourself, for a session or for a single command, and never edit `config.json`.
- Without that line, when a host rejects a dispatch because the model is unavailable: do not retry the same model. Re-dispatch one tier down as a new dispatch, record the value actually passed, and complete the affected gate with its waiver (`--allow-no-design-model <reason>` or `--allow-main-model <reason>`) naming the rejected model.
- Without that line, when a worker reports a model ID of a lower tier than the passed value (the host substituted it): keep the result, do not re-dispatch the same model, record `goal assign --effective-model <id>` and a `Model substitution:` line in the plan's Evidence.
- In both cases tell the user once which model was unavailable and that a model ceiling can be set.
- An invalid value applies no ceiling: the hook shows the user a notice and the CLI warns on stderr. `strongest` means no ceiling; `fast` is not accepted, and neither is `pro` (Antigravity's model name reads like a "Pro" subscription plan).
