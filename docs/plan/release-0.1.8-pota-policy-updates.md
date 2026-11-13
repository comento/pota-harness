# Plan: Release 0.1.8 Pota policy updates

## Goal

Publish Pota policy updates for Codex model inheritance, Heavy Path test evidence, side-question resume behavior, task/sub-task terminology, whole-work planning, and recursive bounded subagent delegation; merge through GitHub and update the local installation.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: release work mutates GitHub, npm, and local installed plugin state, so checks and dry-runs must precede irreversible operations.
- Role-specific adjustment: keep release tasks small, run package dry-runs before publish, and record evidence in this plan.
- User-visible output locale: Korean.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: repository automation plus GitHub PR merge, npm publish, and local installation update mutate external state.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: yes, GitHub and npm release operations.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: yes, packaged policy surfaces changed across skills, commands, workflows, docs, tests, and plugin metadata.
  - Explicit extra-care signal: yes, user requested npm publish, PR merges, and local update.
- Heavy Path trigger, if selected: external release state mutation.
- Omitted delegation in Light Path, if applicable: not applicable.
- Pre-implementation decisions:
  - Publish `@comento/pota-harness@0.1.8` because npm latest is `0.1.7`.
  - Keep `package.json` and `.codex-plugin/plugin.json` versions aligned at `0.1.8`.
  - Create and merge a `dev -> main` PR because no open PR currently exists and `dev`/`main` started aligned.

## Agent Assignments

- Local main session: release preparation, commit, push, PR creation/merge, npm publish, local upgrade, and evidence recording.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for this release task.
- Required typecheck/lint/verification tools: `npm test`, `npm run check`, `npm pack --dry-run`, `npm publish --dry-run`, `gh`, `git`, `npm`.
- Missing tools: none observed.
- Install/bootstrap commands attempted: not needed.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation:
  - `npm test`
  - `npm run check`
  - `npm pack --dry-run`
  - `npm publish --dry-run`
  - `gh pr list --state open --json ...`
- No dry-run available, if applicable: GitHub PR merge and npm publish have no full reversible dry-run; use checks, PR status, and npm publish dry-run before running.
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 1: release preparation

- Contract: all policy updates, tests, version bump, and release plan are committed on `dev`.
- Sub-tasks, if needed:
  - Verify package metadata and dry-runs.
  - Commit release changes.
- Files:
  - `package.json`
  - `.codex-plugin/plugin.json`
  - `PLAN.md`
  - `docs/plan/release-0.1.8-pota-policy-updates.md`
  - policy/test files already changed in previous completed plans.
- Dependencies: npm package metadata and GitHub remote.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: `npm test && npm run check && npm pack --dry-run && npm publish --dry-run`.
- Module acceptance verification: `npm test && npm run check`.
- Surface integration verification: `npm pack --dry-run && npm publish --dry-run`.

### Task 2: external release and local update

- Contract: `dev` is pushed, merged to `main` by PR, `@comento/pota-harness@0.1.8` is published to npm, and local Pota installation uses the published/latest version.
- Sub-tasks, if needed:
  - Push `dev`.
  - Create and merge `dev -> main` PR.
  - Publish npm package.
  - Update local installation and run doctor.
- Files: release metadata and installed local plugin state.
- Dependencies: GitHub and npm authentication.
- Tool readiness requirement: `gh auth status` and `npm whoami`.
- Dry-run or check command: PR status checks and npm publish dry-run from Task 1.
- Module acceptance verification: `gh pr view`, `git ls-remote`, and `npm view @comento/pota-harness version`.
- Surface integration verification: `node scripts/pota.mjs upgrade && node scripts/pota.mjs doctor`, followed by global install update and `pota doctor` when available.

## Evidence

- Dry-run or check: `npm pack --dry-run` passed for `@comento/pota-harness@0.1.8` with 60 tarball files; `npm publish --dry-run` passed for tag `latest`.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; `gh auth status` authenticated as `dspaudio`; `npm whoami` returned `wonkyoo.nam`; `npm view @comento/pota-harness version` returned `0.1.7`.
- Tests: `npm test` passed with 13 tests.
- Module acceptance: `npm test && npm run check` passed; `npm run check` reran syntax checks, JSON parsing, and 13 tests.
- Surface integration: `npm pack --dry-run && npm publish --dry-run` passed for `@comento/pota-harness@0.1.8`.
- Dev PR merge: `dev` was pushed at `fce8c5938f603113c2e9a95c65e63531c59784df`; PR #19 was created from `dev` to `main`.
- Main PR merge: PR #19 merged to `main` at merge commit `8be04093dc17330f74cca568b9093d4f1cb459b0` after Ubuntu and Windows CI passed.
- Branch alignment: local `dev` fast-forwarded to `origin/main`; `origin/dev` and `origin/main` both point to `8be04093dc17330f74cca568b9093d4f1cb459b0`.
- npm publish: `npm publish` succeeded for `@comento/pota-harness@0.1.8`; `npm view @comento/pota-harness version` returned `0.1.8` and `latest` points to `0.1.8`.
- Local environment update: `bun add -g @comento/pota-harness@latest` installed `@comento/pota-harness@0.1.8`; `pota upgrade && pota doctor` passed all installation checks.
- Verification pass count: one release-preparation pass plus one publish/local-update verification pass.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
