# Plan: <topic>

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation after planned triage.
- Codex UI synchronization: `update_plan` status and `create_goal` status, or an explicit unavailable reason.

## Goal

Describe the observable result.

- Goal ID: `goal-<stable-id>`
- Plan ID: `plan-<stable-id>`
- Runtime resources: `pota://` resources resolved by the installed Pota version; do not record a user-specific absolute plugin path.
- Completion criteria (advisory text; Pota does not enforce it — completion is gated only by required evidence):
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled` (an `active` goal is never complete).

## Whole Work

- Outcome:
- Affected surfaces:
- Task classification:
- Sub-tasks, if needed:

## Memory Inputs

- `MEMORY.md`
- `docs/memory/<domain>.md`
- Related completed plans: <docs/plan/<topic>.md | none related>

## Model Guidance

- Applied model family: Codex or Claude.
- Referenced guidance:
  - `pota://docs/model-guidance/README.md`
  - `pota://docs/model-guidance/<claude-or-codex>.md`
- Rationale:
- Role-specific adjustment:
- User-visible response and artifact locale: OS locale unless the user asks for another language.

## Reasoning Effort Profile

- Model: decided per task (fast `haiku` for read-only exploration/search/summarization; balanced `sonnet` for Light implementation and routine verification; stronger `opus` for planning, complexity triage, Heavy implementation, review, and final verification/review; strongest `fable` for Heavy design only, as a separate `kind: "design"` task dispatched to that tier rather than part of planning). Pass it through the host option on every dispatch (Claude Code: Agent `model`, never `fork`); re-dispatch one tier up (fast, balanced, stronger, strongest) if a lower-tier worker fails a gate; `Model routing: inherited` disables this. Effective model adds the exact model ID the worker reports from its own system prompt (`unreported` when absent; never guess). A re-dispatch that changes model or effort MUST be a new dispatch, never `SendMessage`. A design model below the host's strongest tier (`--host`: `fable`/`gpt-6-astra`/`pro`) fails completion unless `--allow-no-design-model <reason>`. Never change model/global config.
- Light Path: planning=`medium`, implementation=`medium`, verification=`medium`.
- Heavy Path: planning/review=`high`, implementation=`high`, final verification/review=`xhigh`.
- Host boundary: every new task/worker dispatch MUST pass the task's requested effort through the host option (Claude Code: Agent `effort`, never `fork`; Codex: host-native option). Recording without passing is a defect. Use `inherited` only when the host has no option.
- Route-change gate: synchronize the plan artifact, repository goal task roadmap through `goal replan`, native UI plan, and reasoning effort profile before edits resume. Completed task profiles are preserved as audit history; incomplete task profiles are recalculated for the new path.
- Every module task records:
  - Requested model:
- Effective model: <applied value (reported model ID | unreported) | not-applied: reason | inherited: host has no option>
- Requested reasoning effort:
  - Effective reasoning effort: <applied value | not-applied: reason | inherited: host has no option>

## Complexity Triage

- Selected path: Light Path or Heavy Path.
- Selection rationale:
- Checkpoint ledger:
  - Request checkpoint: provisional route, request/`MEMORY.md` evidence, uncertainty, and newly found Heavy Path signals.
  - Planning checkpoint: post-exploration route, affected-surface/test evidence, and newly found Heavy Path signals.
  - Code checkpoint: `pending` until exact files/callers/tests are inspected; record the final route immediately before the first edit.
- Route-change synchronization: before editing, evidence may change either route. Update the plan artifact, replace the incomplete repository goal task roadmap with `goal replan`, and update the native UI plan to the same stable task order, reviews, assignments, and required evidence before mutation.
- Late promotion: after editing begins, a new Heavy Path signal promotes Light Path to Heavy Path. Stop further edits, mark affected evidence stale, synchronize all three roadmaps, run newly required review, and repeat the code checkpoint before resuming.
- Heavy Path signals checked:
  - New directory/module/layer:
  - New domain model/service/abstraction:
  - Security/auth/session:
  - External API/message queue/payment:
  - DB schema/migration:
  - Concurrency/transaction/cache invalidation:
  - Cross-domain refactor:
  - Explicit extra-care signal:
- Heavy Path trigger, if selected:
- Omitted delegation in Light Path, if applicable:
- Pre-implementation decisions:

### Path Criteria

- Light Path: narrow changes inside existing architecture layers. Direct edit or one bounded `worker`, then focused verification.
- Heavy Path: new directory/module/layer, new domain model/service/abstraction, security/session/auth, external API/message queue/payment, DB schema/migration, concurrency/transaction/cache changes, cross-domain refactor, or explicit extra-care request.

## Agent Assignments

- `explorer`: read-only discovery, impact analysis, pattern search, and read-only verification when available.
- `worker`: bounded implementation tasks with clear file ownership, or scoped verification work.
- Local main session: urgent blocking work when the next step depends immediately on the result.

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `<task-id>` | `<agent>` | `light` or `heavy` | <tier/value passed via host option> | <value passed via host option> |

## Tool Readiness

- Detected stack:
- Toolcheck command:
- Required LSP/symbol tools:
- Required typecheck/lint/verification tools:
- Missing tools:
- Install approval: not requested, approved, denied, or not needed.
- Install/bootstrap commands proposed or attempted:
- Tool blockers:

## Execution Guardrails

- Test contract first: requirements, invariants, boundaries, failure modes, expected initial failure, and authoritative tool result.
- Token budget: high reasoning for plan/triage/test design; bounded minimum implementation; concise tool-derived verification summaries.
- Verification ladder: focused tests, one final full check, then package dry-run if no files changed. Inspect lifecycle scripts first; run normal `npm pack --dry-run` by default. Content-producing or unknown scripts must never use `--ignore-scripts`; only absent or proven content-neutral scripts may use it while evidence remains fresh.
- Evidence freshness: relevant changes after verification make affected evidence stale.
- Verification execution: `goal verify` defaults to 600,000 ms (10 minutes), is capped at 3,600,000 ms (1 hour), and records only when the starting goal/task identity and pre/post watched fingerprint match.
- Evidence boundary: choose the semantic boundary whose watch set and command prove the claimed behavior.
- Dry-run or check mode before external-state mutation:
- No dry-run available, if applicable:
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Requested model:
- Effective model: <applied value (reported model ID | unreported) | not-applied: reason | inherited: host has no option>
- Requested reasoning effort:
- Effective reasoning effort: <applied value | not-applied: reason | inherited: host has no option>
- Contract: execute the investigation scope and Heavy Path criteria declared by the initial plan, then update this file and the Codex UI plan to the decision-complete implementation revision.
- Required evidence records:
  - `planArtifact`: command, exit code 0, timestamp, goal ID, task ID, and plan ID.
  - `triageDecision`: command, exit code 0, timestamp, goal ID, task ID, and plan ID.

### Task 1: <module>

- Task ID: `task-1`
- Initial status: `pending` or `active`
- Requested model:
- Effective model: <applied value (reported model ID | unreported) | not-applied: reason | inherited: host has no option>
- Requested reasoning effort:
- Effective reasoning effort: <applied value | not-applied: reason | inherited: host has no option>
- Contract:
- Sub-tasks, if needed:
- Files:
- Depends on (task ids):
- Write scope:
- Handoff files:
- Tool readiness requirement:
- Dry-run or check command:
- Module acceptance verification:
- Surface integration verification:
- Required evidence records:
  - `moduleAcceptance`: command, exit code 0, timestamp, goal ID, task ID, and plan ID.
  - `surfaceIntegration`: command or QA artifact, exit code 0, timestamp, goal ID, task ID, and plan ID.
- Assigned agent ID, if delegated:
- Blocker: a concrete reason is required when status becomes `blocked`.

## Evidence

- Dry-run or check:
- Tool readiness:
- Tests:
- Module acceptance:
- Surface integration:
- Goal final review evidence record:
- Memory promotion: <docs/memory/<domain>.md | none: reason>
- Verification pass count:
- Blocker after two failed passes:

## Status

- [ ] Planned
- [ ] Dry-run or check passed, or not applicable was recorded
- [ ] Implemented
- [ ] Module acceptance passed
- [ ] Surface integration passed
- [ ] Reviewed
- [ ] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
