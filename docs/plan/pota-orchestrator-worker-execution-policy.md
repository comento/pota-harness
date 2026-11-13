# Plan: Pota orchestrator-worker execution policy

## Goal

Make Pota guidance require the user-called agent to act as the orchestrator, delegate actual implementation work to `worker` subagents whenever subagent tools are available, and relay subagent progress reports to the user, regardless of Light Path or Heavy Path.

## Whole Work

- Outcome: planning/work/model guidance, command/workflow mirrors, plugin prompt, documentation, and lifecycle tests consistently state that implementation belongs to `worker` while the main agent orchestrates, relays supported subagent progress reports or observable lifecycle events, verifies, and records evidence.
- Affected surfaces:
  - `.codex-plugin/plugin.json`
  - `skills/pota-plan/SKILL.md`
  - `skills/pota-work/SKILL.md`
  - `commands/pota-plan.md`
  - `commands/pota-work.md`
  - `.agents/workflows/pota-plan.md`
  - `.agents/workflows/pota-work.md`
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
  - `README.md`
  - `README.ko.md`
  - `scripts/pota.mjs`
  - `test/lifecycle.test.mjs`
  - `PLAN.md`
  - `docs/plan/pota-orchestrator-worker-execution-policy.md`
- Task classification: one cross-surface policy task.
- Sub-tasks, if needed: implementation text/test update delegated to one bounded `worker`; main session relays worker status, reruns verification, and records evidence.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: Codex guidance should be updated so the main session coordinates work, while bounded `worker` subagents perform implementation file edits.
- Role-specific adjustment: this request explicitly authorizes subagent delegation; when subagent tools are available, the local main session must not perform the implementation edits except plan/evidence orchestration.
- User-visible output locale: Korean per user instruction.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: the change updates cross-surface harness policy for implementation orchestration and subagent usage.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: no.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: yes, policy text spans plugin prompt, skills, commands, workflows, model guidance, docs, and tests.
  - Explicit extra-care signal: yes, user stated the principle must hold for both Light Path and Heavy Path.
- Heavy Path trigger, if selected: cross-surface policy refactor and explicit execution-policy requirement.
- Omitted delegation in Light Path, if applicable: not applicable; delegation is mandatory when subagent tools are available.
- Pre-implementation decisions:
  - The main agent may plan, assign ownership, relay subagent status to the user, verify, and record evidence.
  - Actual implementation edits should be performed by `worker`.
  - Subagents must report at start, direction decision, periodic progress, and completion events when the tool provides a progress-reporting channel.
  - The orchestrator must immediately relay received status events, or observable lifecycle events when no mid-run reporting channel exists.
  - If subagent tools are unavailable, guidance should require the main agent to take over implementation directly and record that takeover in evidence.

## Agent Assignments

- Main session: orchestrate the plan, assign implementation ownership, relay subagent status updates, inspect diff, rerun verification, and record evidence.
- `worker`: implement the bounded policy/text/test updates. The worker must read `MEMORY.md`, report key progress events to the orchestrator, preserve existing uncommitted edits, and not revert others' changes.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for this policy text and lifecycle test update.
- Required typecheck/lint/verification tools: `node --check`, JSON parse check, `node --test`, `npm run check`, `npm pack --dry-run`.
- Missing tools: none observed.
- Install/bootstrap commands attempted: none.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation: no external-state mutation; package surface uses `npm pack --dry-run`.
- No dry-run available, if applicable: local repository file edits only.
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 1: orchestrator-worker policy

- Contract: Pota policy says the invoked/main agent orchestrates, relays subagent progress, and verifies, while `worker` subagents perform implementation on both Light Path and Heavy Path when subagent tools are available.
- Sub-tasks, if needed: not needed.
- Files:
  - `.codex-plugin/plugin.json`
  - `skills/pota-plan/SKILL.md`
  - `skills/pota-work/SKILL.md`
  - `commands/pota-plan.md`
  - `commands/pota-work.md`
  - `.agents/workflows/pota-plan.md`
  - `.agents/workflows/pota-work.md`
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
  - `README.md`
  - `README.ko.md`
  - `scripts/pota.mjs`
  - `test/lifecycle.test.mjs`
- Dependencies: existing lifecycle install tests and package checks.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: not applicable.
- Tests: `node --test test/lifecycle.test.mjs`.
- Module acceptance verification: `npm run check`.
- Surface integration verification: `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.

## Evidence

- Dry-run or check: not applicable, no external-state mutation.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; detected stack `javascript`, `node` OK.
- Worker implementation: `worker` Euclid changed `.codex-plugin/plugin.json`, plan/work skills, command/workflow mirrors, model guidance, `README.md`, `README.ko.md`, `scripts/pota.mjs`, and `test/lifecycle.test.mjs`; it reported completion with lifecycle tests, `npm run check`, diff whitespace check, package dry-run, and read-only review evidence.
- Tests: `node --test test/lifecycle.test.mjs` passed with 10 tests.
- Module acceptance: `npm run check` passed with 15 tests after rerunning syntax checks, JSON parsing, and the full test suite.
- Surface integration: `npm --cache /private/tmp/pota-npm-cache pack --dry-run` passed and included updated plugin prompt, commands, workflows, model guidance, scripts, and skills in the package.
- Verification pass count: 1 worker pass plus 1 orchestrator verification pass.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
