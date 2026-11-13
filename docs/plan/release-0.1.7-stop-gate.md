# Plan: Release 0.1.7 stop gate

## Goal

Publish the Pota stop-gate fix so active plan work blocks premature Stop/SubagentStop completion, then update the local installed environment.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: release work mutates external GitHub and npm state, so commands need dry-run/check evidence before irreversible steps.
- Role-specific adjustment: keep each release step small, verify the package before publishing, and record evidence in this plan.
- User-visible output locale: Korean per repository/user instruction.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: repository automation plus GitHub PR merges, npm publish, and local installation update mutate external state.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: yes, GitHub and npm release operations.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: no.
  - Explicit extra-care signal: yes, user requested the full release chain.
- Heavy Path trigger, if selected: external release state mutation.
- Omitted delegation: subagent tool policy allows spawning only on explicit user request, so release verification stays local.
- Pre-implementation decisions:
  - No open PRs exist; create a new `dev -> main` PR after committing and pushing `dev`.
  - `npm view @comento/pota-harness version` reports `0.1.6`; bump to `0.1.7` before publish.

## Agent Assignments

- Local main session: commit, push, PR creation/merge, npm publish, local upgrade, and evidence recording.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck`.
- Required LSP/symbol tools: not required for this release slice.
- Required typecheck/lint/verification tools: `npm run check`, `npm pack --dry-run`, `npm publish --dry-run`, `gh`, `git`, `npm`.
- Missing tools: none observed.
- Install/bootstrap commands attempted: none.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation:
  - `npm run check`
  - `npm pack --dry-run`
  - `npm publish --dry-run`
  - `gh pr list --state open --json ...`
- No dry-run available, if applicable: GitHub PR merge and npm publish have no full reversible dry-run; use checks and PR status before running.
- Verification loop budget: two passes per slice by default.
- Failure handling: diagnose once, shrink or split the slice, rerun both gates, then record a blocker after the second failed pass.

## Module Slices

### Slice 1: release preparation

- Contract: stop-gate fix, tests, version bump, and release plan are committed on `dev`.
- Files:
  - `scripts/pota-state.mjs`
  - `test/lifecycle.test.mjs`
  - `package.json`
  - `PLAN.md`
  - `docs/plan/release-0.1.7-stop-gate.md`
- Dependencies: npm package metadata and GitHub remote.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: `npm run check && npm pack --dry-run && npm publish --dry-run`.
- Module acceptance verification: `npm run check`.
- Surface integration verification: `npm pack --dry-run` and `npm publish --dry-run`.

### Slice 2: external release

- Contract: `dev` is pushed, merged to `main` by PR, `@comento/pota-harness@0.1.7` is published to npm, and local Pota installation is upgraded.
- Files: release metadata only.
- Dependencies: GitHub and npm authentication.
- Tool readiness requirement: `gh pr list` and `npm whoami`.
- Dry-run or check command: PR status checks and npm publish dry-run from Slice 1.
- Module acceptance verification: `gh pr view`, `git ls-remote`, and `npm view @comento/pota-harness version`.
- Surface integration verification: `node scripts/pota.mjs upgrade && node scripts/pota.mjs doctor`.

## Evidence

- Tool readiness: `node scripts/pota.mjs toolcheck` passed; detected stack `javascript`, `node` OK.
- Tests: `npm run check` passed with 12 tests.
- Release preparation checks: `npm run check` passed with 12 tests; `npm pack --dry-run` passed for `@comento/pota-harness@0.1.7` with 60 tarball files; `npm publish --dry-run` passed for tag `latest`.
- CI fix: first PR run passed Ubuntu but failed Windows because active plan path containment used a POSIX slash prefix; changed to `node:path.relative()` plus `isAbsolute()`, then reran `npm run check`, `npm pack --dry-run`, and `npm publish --dry-run` successfully.
- Dev PR merge: `dev` pushed with release commits; PR #17 created from `dev` to `main`.
- Main PR merge: PR #17 merged to `main` at merge commit `d22fbd382c76cad2d35805795a600334dcc932c0` after Ubuntu and Windows CI passed.
- npm publish: `npm publish` succeeded for `@comento/pota-harness@0.1.7`; `npm view @comento/pota-harness version` returned `0.1.7` and `latest` points to `0.1.7`.
- Local environment update: `node scripts/pota.mjs upgrade && node scripts/pota.mjs doctor` passed; `bun add -g @comento/pota-harness@latest` installed `@comento/pota-harness@0.1.7`; `pota doctor` passed.
- Verification pass count: 2.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
