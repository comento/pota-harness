# Plan: Pota verification infrastructure

## Goal

Add automated evidence for Pota's install lifecycle, toolcheck stack detection, packaging, and CI checks.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: this is a bounded implementation slice with explicit command verification.
- Role-specific adjustment: keep edits small, run module and surface checks, and record evidence here.
- User-visible output locale: Korean per repository/user instruction.

## Complexity Triage

- Selected route: full route.
- Selection rationale: touches CLI lifecycle, package scripts, test fixtures, and CI behavior across multiple files.
- Omitted fast-route roles and rationale: none; the user requested implementation directly and no subagent spawn was explicitly requested by the current tool policy.
- Full-route pre-review decisions: tests must avoid real user home directories and use temporary `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, and `ANTIGRAVITY_CLI_HOME`.

## Agent Assignments

- `planner`: this plan.
- `builder`: main Codex session.
- `reviewer`: main Codex session after verification.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota-toolcheck.mjs --json`.
- Required LSP/symbol tools: not required for this bounded script/test change.
- Required typecheck/lint/verification tools: `node --check`, `node --test`, `npm pack --dry-run`.
- Missing tools: none observed.
- Install/bootstrap commands attempted: none.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation: lifecycle tests use temporary homes; package verification uses `npm pack --dry-run`.
- No dry-run available, if applicable: not applicable.
- Verification loop budget: two passes per slice by default.
- Failure handling: diagnose once, shrink or split the slice, rerun both gates, then record a blocker after the second failed pass.

## Module Slices

### Slice 1: testable CLI verification

- Contract: lifecycle and toolcheck behavior are covered by automated tests and CI without mutating real user state.
- Files:
  - `scripts/pota-lifecycle.mjs`
  - `scripts/pota-toolcheck.mjs`
  - `test/*.test.mjs`
  - `test/fixtures/toolcheck/*`
  - `.github/workflows/ci.yml`
  - `package.json`
- Dependencies: Node built-in `node:test`.
- Tool readiness requirement: `node scripts/pota-toolcheck.mjs --json` passes.
- Dry-run or check command: `npm pack --dry-run`.
- Module acceptance verification: `npm test`.
- Surface integration verification: `npm run check && npm pack --dry-run`.

## Evidence

- Dry-run or check: `npm pack --dry-run` passed; tarball contains runtime docs under `docs/model-guidance/` and excludes `docs/plan/`.
- Tool readiness: `node scripts/pota-toolcheck.mjs --json` passed after implementation with detected stack `javascript` and `node` OK.
- Module acceptance: `npm test` passed with 7 tests.
- Surface integration: `npm run check` passed; `npm pack --dry-run` passed.
- Verification pass count: 2.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
