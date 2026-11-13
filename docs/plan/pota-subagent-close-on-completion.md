# Plan: Pota subagent close on completion

## Goal

Require completed subagents to be closed or released after the orchestrator captures their final report and evidence, then require the orchestrator to review that final report and evidence before marking work complete.

## Whole Work

- Outcome: Pota guidance, CLI messages, docs, and lifecycle tests state that finished subagents must provide a final report before leaving, then be closed/released after evidence is captured instead of being left open; after that, the orchestrator reviews the final report and evidence before marking work complete.
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
  - `docs/plan/pota-subagent-close-on-completion.md`
- Task classification: one policy/test update.
- Sub-tasks, if needed: not needed.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: the current subagent tool surface cannot reliably provide mid-run reports, so the main agent takes over the narrow policy edit and records that takeover.
- Role-specific adjustment: keep the edit scoped and verify lifecycle tests.
- User-visible output locale: Korean per user instruction.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: cross-surface policy text and lifecycle tests change.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: no.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: yes, policy text spans plugin prompt, skills, commands, workflows, model guidance, docs, and tests.
  - Explicit extra-care signal: yes, user corrected subagent lifecycle behavior.
- Heavy Path trigger, if selected: cross-surface execution-policy correction.
- Omitted delegation in Light Path, if applicable: not applicable.
- Pre-implementation decisions:
  - The orchestrator closes/releases subagents after final report and evidence are captured.
  - Closing/releasing happens only after the orchestrator has the final output needed for evidence.
  - After close/release, the orchestrator reviews the final report and evidence before marking work complete.

## Agent Assignments

- Main session: implement this narrow correction because the available subagent tool channel did not support the requested mid-run reporting protocol, then verify and record evidence.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for this policy text and lifecycle test update.
- Required typecheck/lint/verification tools: `node --test`, `npm run check`, `npm pack --dry-run`.
- Missing tools: none observed.
- Install/bootstrap commands attempted: none.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation: no external-state mutation; package surface uses `npm pack --dry-run`.
- No dry-run available, if applicable: local repository file edits only.
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 1: close completed subagents

- Contract: Pota guidance says completed subagents are closed/released after final report and evidence capture, then the orchestrator reviews final report and evidence before marking work complete.
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
- Dependencies: existing lifecycle tests and package checks.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: not applicable.
- Tests: `node --test test/lifecycle.test.mjs`.
- Module acceptance verification: `npm run check`.
- Surface integration verification: `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.

## Evidence

- Dry-run or check: not applicable, no external-state mutation.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; detected stack `javascript`, `node` OK.
- Tests: `node --test test/lifecycle.test.mjs` passed with 10 tests, including final report/evidence review policy assertions.
- Module acceptance: `npm run check` passed with 15 tests after syntax checks, JSON parsing, and full tests.
- Surface integration: `npm --cache /private/tmp/pota-npm-cache pack --dry-run` passed and included updated plugin prompt, commands, workflows, model guidance, scripts, and skills in the package.
- Stop gates: `node scripts/pota-state.mjs stop` and `node scripts/pota-state.mjs subagent-stop` passed.
- Verification pass count: 1.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
