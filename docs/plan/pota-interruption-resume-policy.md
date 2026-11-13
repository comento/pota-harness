# Plan: Pota interruption resume policy

## Goal

When a user asks a side question while Pota work is still incomplete, the agent must answer the side question and then continue the prior active work unless the user explicitly says to pause, stop, or redirect.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: this is a prompt/workflow policy fix with direct automated lifecycle coverage.
- Role-specific adjustment: subagent delegation omitted because current tool policy only allows spawning on explicit user request.
- User-visible output locale: Korean.

## Complexity Triage

- Selected path: Light Path.
- Selection rationale: the change stays inside existing plugin instructions, command messages, and lifecycle tests without adding a new architecture layer or external integration.
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
- Omitted delegation in Light Path, if applicable: direct local edit is smaller and avoids coordination overhead.
- Pre-implementation decisions:
  - Put the strongest instruction in the Codex plugin `defaultPrompt`.
  - Mirror the instruction in `pota-work` command/skill guidance because that is the active-task execution surface.
  - Add lifecycle tests so install output keeps the policy in the installed plugin manifest and CLI work guidance.

## Agent Assignments

- `explorer`: omitted.
- `worker`: omitted.
- Local main session: implement and verify the bounded policy task.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for bounded JSON/Markdown/test changes.
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

### Task 1: interruption resume instruction

- Contract: Codex plugin and work guidance explicitly require resuming active work after a side question unless the user explicitly pauses, stops, or redirects.
- Files:
  - `.codex-plugin/plugin.json`
  - `commands/pota-work.md`
  - `skills/pota-work/SKILL.md`
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
- Surface integration: `npm run check && npm pack --dry-run` passed; packaged contents included updated plugin manifest, work command, work skill, Claude command, and Antigravity workflow.
- Verification pass count: one pass for module acceptance and one pass for surface integration after the final terminology update.
- Blocker after two failed passes: none.
- Review: local diff and terminology search found no remaining user-facing `slice` wording in runtime/package surfaces except intentional references in the terminology plan and JavaScript `slice()` API calls.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
