# Plan: Pota stop gate plan index recheck

## Goal

Prevent agents from ending when the full planned work is not actually complete by making the stop hook recheck indexed and unindexed plan files.

## Whole Work

- Outcome: `Stop` and `SubagentStop` fail when unfinished work exists in `docs/plan`, even if `PLAN.md` Active Plans missed the plan or a plan was moved to Completed Plans too early.
- Affected surfaces:
  - `scripts/pota-state.mjs`
  - `test/lifecycle.test.mjs`
  - `PLAN.md`
  - `docs/plan/pota-stop-gate-plan-index-recheck.md`
- Task classification: one lifecycle stop-gate task.
- Sub-tasks, if needed: not needed.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: Codex guidance requires a plan before implementation, small file-scoped edits, and command-based verification.
- Role-specific adjustment: keep implementation local because subagent tool policy only allows spawning when explicitly requested.
- User-visible output locale: Korean per user instruction.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: this changes repository automation and stop-hook behavior.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: no.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: no.
  - Explicit extra-care signal: no.
- Heavy Path trigger, if selected: repository automation hook behavior.
- Omitted delegation in Light Path, if applicable: not applicable.
- Pre-implementation decisions:
  - Reuse the existing `Stop` and `SubagentStop` hooks.
  - Extend `scripts/pota-state.mjs` instead of adding a second hook command.

## Agent Assignments

- Local main session: implement stop-gate scan and regression tests.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck`.
- Required LSP/symbol tools: not required for this focused lifecycle change.
- Required typecheck/lint/verification tools: `node --check`, `node --test`, `npm run check`.
- Missing tools: none observed.
- Install/bootstrap commands attempted: none.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation: not applicable, no external-state mutation.
- No dry-run available, if applicable: local repository file edits only.
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 1: stop-gate recheck

- Contract: stop-hook state checks active, completed, and unindexed `docs/plan/*.md` files before allowing completion.
- Sub-tasks, if needed: not needed.
- Files:
  - `scripts/pota-state.mjs`
  - `test/lifecycle.test.mjs`
  - `PLAN.md`
  - `docs/plan/pota-stop-gate-plan-index-recheck.md`
- Dependencies: existing lifecycle tests and Node test runner.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: not applicable.
- Module acceptance verification: `node --test test/lifecycle.test.mjs`.
- Surface integration verification: `npm run check`.

## Evidence

- Dry-run or check: not applicable, no external-state mutation.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; detected stack `javascript`, `node` OK.
- Tests: `node --test test/lifecycle.test.mjs` passed with 10 tests; `npm run check` passed with 15 tests.
- Module acceptance: `node --test test/lifecycle.test.mjs` passed.
- Surface integration: `npm run check` passed; `npm --cache /private/tmp/pota-npm-cache pack --dry-run` passed and included `scripts/pota-state.mjs` plus `hooks/hooks.json` in the package.
- Verification pass count: 1.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
