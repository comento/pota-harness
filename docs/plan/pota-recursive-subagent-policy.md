# Plan: Pota recursive subagent policy

## Goal

Pota guidance must allow each agent to recursively call subagents for bounded sub-tasks when the current agent surface supports subagents, while preserving memory, scope, and verification rules.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: this updates delegation policy across plugin, skills, commands, and agent definitions.
- Role-specific adjustment: no live subagent delegation is needed to edit policy text; current session tool policy still governs actual spawning.
- User-visible output locale: Korean.

## Complexity Triage

- Selected path: Light Path.
- Selection rationale: the change stays inside existing policy documents and lifecycle tests without adding runtime architecture.
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
- Omitted delegation in Light Path, if applicable: direct local edit is smaller.
- Pre-implementation decisions:
  - Use `subagent` consistently.
  - Bound recursive delegation to explicit sub-tasks and current surface/tool limits.
  - Require every child subagent to read `MEMORY.md`, preserve scope, and avoid reverting others' edits.

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

### Task 1: recursive delegation guidance

- Contract: plugin and agent guidance allows recursive subagent delegation for bounded sub-tasks when available.
- Files:
  - `.codex-plugin/plugin.json`
  - `agents/explorer.md`
  - `agents/worker.md`
  - `commands/*.md`
  - `skills/*/SKILL.md`
  - `.agents/workflows/*.md`
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
- Surface integration: `npm run check && npm pack --dry-run` passed; packaged contents included updated plugin manifest, agent definitions, skills, commands, and Antigravity workflows.
- Verification pass count: one pass for module acceptance and one pass for surface integration.
- Blocker after two failed passes: none.
- Review: local diff review found recursive bounded sub-task delegation guidance in plugin default prompt, `agents/explorer.md`, `agents/worker.md`, memory/plan/work/review skills, commands, workflows, and lifecycle assertions.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
