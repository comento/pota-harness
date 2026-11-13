# Plan: Pota plugin model settings and Heavy Path test gate

## Goal

Codex-installed Pota agents must not force a project-local or Claude-only model identifier, and Heavy Path work must require explicit test evidence before completion.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: this changes Codex plugin behavior, harness policy text, and automated lifecycle tests.
- Role-specific adjustment: subagent delegation is omitted because current tool policy only allows spawning on explicit user request.
- User-visible output locale: Korean.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: the user explicitly identified the work as Heavy Path, and the change spans plugin agent metadata, planning/work/review guidance, stop gate behavior, and lifecycle tests.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: no.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: yes, Codex plugin agent metadata and verification policy surfaces.
  - Explicit extra-care signal: yes, user said this is Heavy Path and tests must be forced.
- Heavy Path trigger, if selected: explicit Heavy Path signal and cross-surface harness policy change.
- Omitted delegation in Light Path, if applicable: not applicable.
- Pre-implementation decisions:
  - Codex-facing `agents/*.md` must inherit or use installed Codex agent/model settings instead of hard-coding `model: sonnet`.
  - Heavy Path completion must treat test evidence as required, not optional wording inside general verification.

## Agent Assignments

- `explorer`: omitted due current subagent tool policy requiring explicit user authorization.
- `worker`: omitted due current subagent tool policy requiring explicit user authorization.
- Local main session: plan, implement, verify, and review the bounded slice.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for bounded script/markdown/test changes.
- Required typecheck/lint/verification tools: `node --check`, JSON parse check, `node --test`, `npm pack --dry-run`.
- Missing tools: none observed.
- Install/bootstrap commands attempted: not needed.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation: no external state mutation in implementation; package surface uses `npm pack --dry-run`.
- No dry-run available, if applicable: not applicable.
- Verification loop budget: two passes per slice by default.
- Failure handling: diagnose once, shrink or split the slice, rerun both gates, then record a blocker after the second failed pass.

## Module Slices

### Slice 1: Codex model resolution and Heavy Path test enforcement

- Contract: installed Codex agent metadata avoids Claude-only model lookup, and Heavy Path plans/stop gates require test evidence.
- Files:
  - `agents/explorer.md`
  - `agents/worker.md`
  - `scripts/pota-state.mjs`
  - `templates/PLAN.md`
  - `templates/work-plan.md`
  - `commands/pota-plan.md`
  - `commands/pota-work.md`
  - `skills/pota-plan/SKILL.md`
  - `skills/pota-work/SKILL.md`
  - `test/lifecycle.test.mjs`
- Dependencies: Node built-in test runner.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: not applicable before local file edits; `npm pack --dry-run` for package surface after edits.
- Module acceptance verification: `npm test`.
- Surface integration verification: `npm run check && npm pack --dry-run`.

## Evidence

- Dry-run or check: no dry-run is available for local plugin installation; `npm pack --dry-run` passed for package surface and reported 60 tarball files before the installed plugin was upgraded.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; detected JavaScript and Node runtime.
- Tests: `npm test` passed with 13 tests.
- Module acceptance: `npm test` passed with 13 tests.
- Surface integration: `npm run check && npm pack --dry-run` passed; `npm run check` reran parser checks and tests, and `npm pack --dry-run` included `agents/explorer.md`, `agents/worker.md`, skills, commands, templates, and scripts.
- Installed plugin: `node scripts/pota.mjs upgrade && node scripts/pota.mjs doctor` passed; installed cache path is `/Users/wknam/.codex/plugins/cache/pota/plugins/pota`, `doctor` reported all checks OK, and installed `agents/*` no longer contain a `model:` override.
- Verification pass count: one pass for module acceptance and one pass for surface integration.
- Blocker after two failed passes: none.
- Review: local read-only diff review found no blocking issues; residual risk is limited to host Codex plugin semantics outside this repository's local test harness.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
