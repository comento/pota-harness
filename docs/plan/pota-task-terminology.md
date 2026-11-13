# Plan: Pota task terminology

## Goal

Rename Pota's user-facing "slice" terminology to "task" across runtime instructions, packaged guidance, templates, and tests while preserving code API usage such as JavaScript `slice()`.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: this is a repo-wide terminology cleanup with automated lifecycle and package-surface verification.
- Role-specific adjustment: subagent delegation omitted because current tool policy only allows spawning on explicit user request.
- User-visible output locale: Korean.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: the change is terminology-only but spans runtime messages, hooks/state templates, skills, commands, workflows, localized READMEs, and tests.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: no.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: yes, user-facing terminology across multiple package surfaces.
  - Explicit extra-care signal: no.
- Heavy Path trigger, if selected: cross-surface terminology refactor.
- Omitted delegation in Light Path, if applicable: not applicable.
- Pre-implementation decisions:
  - Replace conceptual `slice`/`slices` wording with `task`/`tasks`.
  - Preserve JavaScript API calls such as `pending.slice(0, 3)`.
  - Leave historical completed `docs/plan/*` evidence unchanged unless needed for active plan status.

## Agent Assignments

- `explorer`: omitted.
- `worker`: omitted.
- Local main session: implement and verify terminology changes.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for terminology/test changes.
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

### Task 1: user-facing terminology rename

- Contract: packaged Pota guidance uses `task` instead of conceptual `slice`, with tests updated for the new stop-gate language.
- Files:
  - `.codex-plugin/plugin.json`
  - `.agents/workflows/*.md`
  - `.claude/commands/*.md`
  - `README*.md`
  - `commands/*.md`
  - `docs/model-guidance/*.md`
  - `scripts/pota-state.mjs`
  - `scripts/pota-state.sh`
  - `scripts/pota.mjs`
  - `skills/*/SKILL.md`
  - `templates/*.md`
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
- Surface integration: `npm run check && npm pack --dry-run` passed; packaged contents included updated READMEs, commands, skills, templates, scripts, plugin manifest, Claude command, and Antigravity workflow.
- Verification pass count: one pass for module acceptance and one pass for surface integration.
- Blocker after two failed passes: none.
- Review: `rg` found no remaining user-facing `slice` wording in packaged/runtime surfaces except intentional terminology-plan references and JavaScript API calls (`pending.slice`, `process.argv.slice`); task split wording now uses `sub-task`.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
