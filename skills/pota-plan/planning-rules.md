# Pota Plan: Planning Rules

Reference for `pota-plan`. Read when writing or finalizing a Light or Heavy Path plan. Quick Path work has no plan and never needs this file.

## When Planning Is Required

Do not treat planning as optional for implementation that is more than a Quick Path change. Produce or update a plan when the request changes behavior, architecture, data, or multiple files, or when an external operation requires code edits, conflict resolution, destructive recovery, release/deploy, or design. External-state mutation alone is not a planning trigger: routine known-target Git/GitHub operations such as status, fetch, checkout, branch, merge, push, and PR management stay plan/goal-free.

Plan from the whole work down. First understand the full requested outcome and affected surfaces, then classify the work into small executable tasks. If one task is still too broad to verify cleanly, split it into sub-tasks.

## Reuse Before Planning

Reuse recorded knowledge before exploring from scratch. Do not read every note or plan; pick by the index lines.

- From `MEMORY.md` entries (`- [<name>](docs/memory/<name>.md): <summary>`), pick only the notes whose summary matches the request's modules, surfaces, or failures. The session-start hook lists the same notes; with no notes, continue without repository memory.
- From `PLAN.md` (older topics in `docs/plan/ARCHIVE.md`), pick at most 3 completed plans that changed the same modules or solved the same kind of problem. Read only their goal, design decisions, and evidence sections, and reuse their verification commands, constraints, and rejected approaches.
- Record the picks in the plan's `## Memory Inputs`: the selected `docs/memory/<domain>.md` paths and `Related completed plans:` with the plan paths, or `none related`.
- Pass the selected note paths to delegated agents in the prompt `CONTEXT:` line (`delegation.md`).
- When you create a plan file, add one line of 200 characters or fewer for it under `## Active Plans` in `PLAN.md` (`- [<topic>](docs/plan/<topic>.md): <title>`), or run `node "<pluginRoot>/scripts/pota.mjs" plan index --root "<repoRoot>"`. Entries are list lines under `## ` headings ending in `Plans`; a plan link elsewhere is a mention that `plan index` never rewrites. `## Completed Plans` stays newest first; `plan index --archive --root "<repoRoot>"` moves entries beyond the newest 20 to `docs/plan/ARCHIVE.md` without deleting them, and `plan check --root "<repoRoot>"` reports dead links and unindexed plans.

## Planning Rules

- Every initial plan must be decision-complete for its triage task and explicitly not implementation-ready; the post-triage revision must be decision-complete for implementation.
- Every non-trivial implementation or planned-work continuation plan must be shown through Codex `update_plan` and `create_goal` before triage when those tools are available (host task-list tools `update_plan`, `create_goal`, `wrap_up` are called by the main agent only; a worker or subagent skips them and reports in its final report), then synchronized again after triage. Routine known-target Git/GitHub operations and Quick Path work do not create a plan or goal.
- Every plan must describe the whole work first, then classify it into executable tasks and any needed sub-tasks.
- Every plan must treat the user-called/main agent as the orchestrator and assign implementation edits to `worker` whenever subagent tools are available, regardless of Light Path or Heavy Path (see `pota://skills/pota-plan/delegation.md`).
- Every plan must include complexity triage, the selected path, and the Heavy Path signals checked, even when Light Path is selected.
- Every plan must include applied model guidance and rationale.
- Every plan must include tool readiness results: detected stack, required LSP/check tools, installed tools, and blockers.
- Every executable plan must include a stable goal ID, stable task IDs, explicit terminal states, and fail-closed required evidence. A missing evidence section never means success.
- Every implementation task must be small enough to verify with two checks: module acceptance verification and surface integration verification. Plan one goal-level final check (`finalReview`) run once through `goal finish` instead of rerunning earlier task checks after later edits.
- Spend planning tokens on executable test design: requirements, invariants, boundaries, failure modes, expected initial failure, and authoritative tool result. Give implementation a bounded test contract and exact file scope; require the minimum passing change rather than renewed broad discovery.
- Plan focused tests first, one final full check, and a package dry-run when no change occurred after the full check. Require lifecycle inspection, normal script execution for content-producing or unknown scripts, and `--ignore-scripts` only for absent or proven content-neutral scripts.
- Heavy Path tasks must include an explicit automated test command and a `Tests:` evidence line.
- Every risky or external-state-changing task must include the closest available dry-run or check command before the write/apply command.
- Verification can expand for risk, but the reason must be recorded.
- The default loop budget is two verification passes per task. If a gate fails, diagnose once, shrink or split the task, and rerun both gates. After two failed passes, record the blocker in `docs/plan/<topic>.md`.
- Give every plan and ordered task a stable ID and declare task-level and goal-level required evidence, so Codex UI and hook context can show the roadmap and restore the current task after side questions.
- Ask the user only when agents, repository evidence, or local verification cannot answer the decision.
- User-visible responses and generated or updated documentation, plans, and memory artifacts follow the OS locale unless the user asks for another language.

## Light Path Detail

Light Path examples: one new API endpoint within existing layers; add or modify a controller or service method; strengthen validation rules; adjust query logic; change copy text or constants; fix one clearly scoped bug that exceeds Quick Path limits.

Light Path flow: main-agent orchestration -> bounded `worker` implementation when subagent tools are available -> main-agent takeover when they are unavailable -> focused verification by the main agent or a scoped verification `worker` -> report. Planning/review agents may be skipped; the verification gate stays.

## Route Record

`docs/plan/<topic>.md` must record:

- Selected path and selection rationale.
- Heavy Path conditions found, if any, and conditions checked and not found.
- Roles or delegation omitted in Light Path and why.
- Any main-agent takeover because subagent tools were unavailable, and its evidence record.
- Pre-implementation decisions that review must resolve in Heavy Path.
- Request checkpoint, planning checkpoint, and code checkpoint status, evidence, newly found signals, and route.
- Every route change and the synchronized plan artifact, repository goal task roadmap, native UI plan, assignments, reviews, required evidence, and stale evidence invalidation.

## Tool Readiness Policy

Do not silently skip LSP, typecheck, lint, dry-run, or verification because the tool is missing. Tool installation is a separate external-state change and requires explicit user approval.

- Detect the codebase stack from repository files before choosing tools.
- Prefer repository-local installation through the existing package manager and lockfile; use ephemeral runners only when project-local installation is not appropriate.
- After approval, use the runtime's `toolcheck --install --yes --root "<repoRoot>"` only for pinned/supported installers, or the approved repository-native command. Run the tool after installation and record the result.
- If installation was not approved or is impossible, record the proposed or attempted command, failure summary, and blocker in `docs/plan/<topic>.md`.
- Treat "LSP server not installed" as an unresolved blocker until installation or an equivalent symbol-aware fallback has been attempted.

## Dry-Run Policy

Prefer repository-native dry-run and check modes before mutating external state.

- Migrations and database changes: `--pretend`, dry-run, schema diff, rollback feasibility check, or equivalent.
- Package and release work: inspect lifecycle scripts first, then use normal `npm pack --dry-run`, publish dry-run, build check, or equivalent. Never skip content-producing or unknown lifecycle scripts with `--ignore-scripts`; it is allowed only for absent or proven content-neutral scripts while prior full-check evidence remains fresh.
- Infrastructure and deployment: plan, diff, validate, check, or equivalent.
- Code generation and formatting: check mode before write mode when available.
- If no dry-run mode exists, record that fact and select the smallest reversible command or test artifact available.
