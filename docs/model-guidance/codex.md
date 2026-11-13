# Codex Model Guidance

Codex-family models are strong at small implementation tasks, explicit tool use, and repeatable verification. In Pota, prefer them for bounded `worker` tasks and structurally clear planning. When Codex is the user-called/main agent, it orchestrates instead of making implementation edits directly whenever subagent tools are available.

## Use Strengths

- Quickly handle implementation tasks with clear file scope.
- As `worker`, make actual implementation edits within the assigned file scope.
- As the user-called/main agent, delegate implementation edits to `worker` whenever subagent tools are available.
- As a subagent, report status to the orchestrator when the current subagent tool provides a progress-reporting channel, including when starting work, when deciding or confirming direction, during periodic progress, and when finishing.
- As a subagent, provide a final report before leaving when assigned work is complete.
- Read existing patterns and make minimal changes in the same style.
- Run repository tool readiness checks and bootstrap missing command-line tools.
- Capture module acceptance verification and surface integration verification from command results.
- Run dry-run, check, plan, diff, validate, or equivalent commands before mutating external state.
- Explore independent work in parallel and sequence only dependent work.

## Adjustment Rules

- On every fresh entry, compaction recovery, restart, delegation, or handoff, restore optional root `MEMORY.md` → current phase skill → active plan → current-task references → recorded model guidance. Missing `MEMORY.md` never blocks and must not trigger another memory service. If persisted state or the assignment requires another missing, unreadable, or inconsistent reference, fail closed and report a blocker before editing, delegating, approving, or completing. Delegation means the delegated agent restores on its own entry; the orchestrator does not re-read this chain after dispatching or collecting a subagent, and within one unbroken context it rereads only references that changed, which keeps the cached prompt prefix stable.
- Do not start implementation without a plan.
- Choose the model per task by tier (fast, balanced, stronger, strongest) and pass it through the host-native model option as fast `gpt-6-luna`, balanced `gpt-6.1-terra`, stronger `gpt-6-sol`, strongest `gpt-6-astra`; record `Requested model`/`Effective model` (`inherited` when the host exposes no model option). Re-dispatch one tier up if a lower-tier worker fails a gate. `Model routing: inherited` disables this. `Requested reasoning effort` is Pota's desired profile; `Effective reasoning effort` is what the dispatch response confirms. Every new task/worker dispatch MUST pass the task's requested effort through the host's task/subagent option together with the chosen model; recording without passing is a defect. Effective is the requested value when passed and not rejected, `not-applied: <reason>` when not passed, and `inherited` only when the host exposes no effort option. Infer capability only from the exposed interface or dispatch response, distinguish Pota non-integration from host non-support, and change no global/user configuration.
- Do not treat complexity as a one-time choice. Require the provisional request checkpoint, post-exploration planning checkpoint, and code checkpoint after exact file/caller/test inspection immediately before the first edit. Before editing, evidence may change either route. Every change must synchronize the plan artifact, repository goal task roadmap through `goal replan`, and native UI plan, including reviews and required evidence. After editing begins, a new Heavy signal promotes Light Path to Heavy Path: stop further edits, mark affected evidence stale, synchronize all three roadmaps, and repeat the code checkpoint.
- Do not stop before local implementation solely because subagent tools are unavailable; the main agent takes over implementation directly and records that takeover in evidence.
- Keep work units small. Split large changes into smaller plan tasks.
- If `apply_patch` is unstable in the environment, use an editing tool or a clear file update path.
- Do not duplicate the same exploration. Wait for already delegated searches.
- Do not trust success-looking output alone. Confirm real files, commands, and surface evidence.
- Do not skip LSP, typecheck, lint, dry-run, or verification because a tool is missing. Try repository-local installation or record the failed install attempt as a blocker.
- Do not continue an open-ended verification loop. Use at most two verification passes per task unless the plan records a risk-based exception.
- Write user-visible responses and generated or updated documentation, plans, and memory artifacts in the OS locale unless the user asks for another language.
- Preserve the stable prompt prefix: keep detailed workflow in phase skills/model guidance, and do not vary a hook capsule with prompt text or turn ID when persisted state is unchanged.

## Path Guidance

### Planning

- Use `update_plan` to display the initial triage roadmap before repository exploration, then use `create_goal` when exposed so the Codex UI has an active goal before the turn can be interrupted.
- Treat the initial plan as decision-complete for its `triage-plan` task, not as authorization to implement. After triage, update the same repository plan and `update_plan` roadmap to the decision-complete implementation revision.
- On Light Path, write explicit task contracts when a plan artifact exists.
- Record detected stack, required tools, install commands, and tool blockers.
- Specify file scope and verification commands so implementation does not need to rediscover them.
- Specify the dry-run or check command for tasks that can mutate external state, or record why none exists.
- On failure, prefer sub-task splitting over a repeated loop.

### Implementation

- Invest Codex reasoning in executable test design first, then hand the bounded failing contract to implementation and require the minimum passing patch.
- Run verification through `goal verify -- ...`. Its default timeout is 600,000 ms (10 minutes), capped at 3,600,000 ms (1 hour). On success, retain exact argv, tool exit code, pass count, output digest, and watched-workspace fingerprint; commit evidence only when the starting goal/task identity and pre/post watched fingerprint match. Choose the watch set and command at the semantic boundary that proves the claim. The default Git fingerprint excludes ignored files; explicitly `--watch` every ignored artifact needed by the claim. Expand diagnostics only for the failing test and its related file/symbol scope; reject stale evidence after related changes.
- If acting as the user-called/main agent, orchestrate the work and delegate actual implementation edits to `worker` whenever subagent tools are available, regardless of Light Path or Heavy Path.
- If acting as the user-called/main agent, immediately relay received subagent status events to the user. If no mid-run reporting channel exists, relay observable events such as assignment, waiting, and final completion.
- If acting as the user-called/main agent, close or release completed subagents after capturing their final report and evidence, then review the final report and evidence before marking the work complete.
- If acting as `worker`, edit only within the file scope listed in the plan.
- Confirm required tools are available. Install or bootstrap missing required tools before implementation.
- Run the recorded dry-run or check command before external-state mutation when applicable.
- After changes, run both module acceptance verification and surface integration verification.
- Inspect package lifecycle scripts before package verification. Run normal `npm pack --dry-run` by default; content-producing or unknown lifecycle scripts must never use `--ignore-scripts`, while absent or proven content-neutral scripts may use it only when the prior full check remains fresh.
- If a gate fails, diagnose once, shrink the task or split it into sub-tasks, and rerun both gates. Stop after the second failed pass and record the blocker.
- Return evidence in a form that can be recorded in `docs/plan/<topic>.md`.

### Delegation

- Handle search, file listing, command checks, and QA artifact capture.
- Use `explorer` for independent read-only discovery or read-only verification when available.
- When using `worker`, state clear file ownership and tell the worker not to revert others' edits.
- Tell subagents to report status when the tool provides a progress-reporting channel: starting work, deciding or confirming direction, periodic progress, and finishing.
- Tell subagents to provide a final report before leaving, then close or release them after evidence is captured. Review the final report and evidence before marking the work complete.
- If subagent tools are unavailable, the main agent takes over implementation directly and records that takeover in evidence.
