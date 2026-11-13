# Plan: Pota subagent unavailable main fallback

## Goal

Correct Pota execution policy so unavailable subagent tools cause the main agent to take implementation responsibility, rather than recording a blocker/fallback before local work.

## Whole Work

- Outcome: policy text, CLI messages, documentation, and lifecycle tests consistently say implementation goes to `worker` when subagent tools are available; when they are unavailable, the main agent implements directly and records that it took over. Subagent progress reporting is conditional on tool support, and otherwise the orchestrator relays observable lifecycle events.
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
  - `docs/plan/pota-orchestrator-worker-execution-policy.md`
  - `PLAN.md`
  - `docs/plan/pota-subagent-unavailable-main-fallback.md`
- Task classification: one cross-surface policy correction.
- Sub-tasks, if needed: implementation text/test correction delegated to one bounded `worker`; main session relays worker status, reruns verification, and records evidence.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: user corrected the fallback semantics; Codex guidance should preserve worker-first implementation while making main-agent takeover explicit when subagent tools are absent.
- Role-specific adjustment: subagent tools are available in this session, so actual edits are delegated to `worker`.
- User-visible output locale: Korean per user instruction.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: the correction touches cross-surface harness policy, CLI messages, tests, and docs.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: no.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: yes, policy text spans plugin prompt, skills, commands, workflows, model guidance, docs, and tests.
  - Explicit extra-care signal: yes, user corrected a mandatory execution principle.
- Heavy Path trigger, if selected: cross-surface execution-policy correction.
- Omitted delegation in Light Path, if applicable: not applicable; subagent tools are available and actual edits are delegated.
- Pre-implementation decisions:
  - Replace blocker/fallback wording with main-agent takeover wording.
  - Keep worker-first behavior whenever subagent tools are available.
  - Keep subagent progress reporting and immediate relay requirements unchanged.

## Agent Assignments

- Main session: orchestrate the plan, assign implementation ownership, relay subagent status updates, inspect diff, rerun verification, and record evidence.
- `worker`: correct policy text and tests within the assigned file scope. The worker must read `MEMORY.md`, report progress events, preserve existing uncommitted edits, and not revert others' changes.

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

### Task 1: unavailable-subagent fallback correction

- Contract: when subagent tools are unavailable, Pota guidance says the main agent takes over implementation directly and records that takeover in evidence; it does not instruct agents to block before local implementation.
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
  - `docs/plan/pota-orchestrator-worker-execution-policy.md`
- Dependencies: existing lifecycle tests and package checks.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: not applicable.
- Tests: `node --test test/lifecycle.test.mjs`.
- Module acceptance verification: `npm run check`.
- Surface integration verification: `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.

## Evidence

- Dry-run or check: not applicable, no external-state mutation.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; detected stack `javascript`, `node` OK.
- Worker implementation: unavailable for the final narrow correction because the current subagent tool surface did not provide a reliable mid-run progress-reporting channel for the requested protocol.
- Main-agent takeover: two delegated workers could not provide mid-run status through the available tool channel; the main agent took over the narrow policy correction and recorded that takeover here.
- Tests: `node --test test/lifecycle.test.mjs` passed with 10 tests.
- Module acceptance: `npm run check` passed with 15 tests after syntax checks, JSON parsing, and full tests.
- Surface integration: `npm --cache /private/tmp/pota-npm-cache pack --dry-run` passed and included updated plugin prompt, commands, workflows, model guidance, scripts, and skills in the package.
- Verification pass count: 1.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
