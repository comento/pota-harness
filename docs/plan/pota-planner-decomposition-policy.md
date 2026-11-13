# Plan: Pota planner decomposition policy

## Goal

Pota planning guidance must require planners to understand the whole work first, then classify it into small executable tasks and, when a task needs further subdivision, sub-tasks.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: this is a prompt/workflow policy update with lifecycle test coverage.
- Role-specific adjustment: subagent delegation omitted because current tool policy only allows spawning on explicit user request.
- User-visible output locale: Korean.

## Complexity Triage

- Selected path: Light Path.
- Selection rationale: the change stays inside existing planning instructions, templates, CLI messages, and lifecycle tests.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: no.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: no.
  - Explicit extra-care signal: no.
- Heavy Path trigger, if selected: not applicable.
- Omitted delegation in Light Path, if applicable: direct local edit is smaller and faster.
- Pre-implementation decisions:
  - Put the strongest rule in `pota-plan` skill guidance.
  - Mirror it in Codex plugin default prompt, commands, Antigravity workflow, and work-plan template.
  - Add lifecycle assertions for CLI plan guidance and installed plugin manifest.

## Agent Assignments

- `explorer`: omitted.
- `worker`: omitted.
- Local main session: implement and verify.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for bounded instruction/test changes.
- Required typecheck/lint/verification tools: `npm test`, `npm run check`, `npm pack --dry-run`.
- Missing tools: none observed.
- Install/bootstrap commands attempted: not needed.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation: no external-state mutation in implementation; package surface uses `npm pack --dry-run`.
- No dry-run available, if applicable: not applicable.
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 1: planner decomposition guidance

- Contract: planning surfaces require whole-work assessment followed by task and sub-task classification.
- Files:
  - `.codex-plugin/plugin.json`
  - `.agents/workflows/pota-plan.md`
  - `commands/pota-plan.md`
  - `skills/pota-plan/SKILL.md`
  - `templates/work-plan.md`
  - `scripts/pota.mjs`
  - `test/lifecycle.test.mjs`
- Dependencies: Node built-in test runner.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: not applicable before local file edits.
- Module acceptance verification: `npm test`.
- Surface integration verification: `npm run check && npm pack --dry-run`.

## Evidence

- Dry-run or check: no external-state mutation in implementation; `npm pack --dry-run` passed for package surface and reported 60 tarball files.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; detected JavaScript and Node runtime.
- Tests: `npm test` passed with 13 tests.
- Module acceptance: `npm test` passed with 13 tests.
- Surface integration: `npm run check && npm pack --dry-run` passed; packaged contents included updated plugin manifest, plan command, plan skill, Antigravity workflow, template, CLI message, and lifecycle tests.
- Verification pass count: one pass for module acceptance and one pass for surface integration after recursive subagent policy changes.
- Blocker after two failed passes: none.
- Review: local diff review found the whole-work -> task -> sub-task rule in plugin default prompt, `pota-plan` skill, command, workflow, template, CLI message, and lifecycle assertions.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
