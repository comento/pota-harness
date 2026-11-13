# Plan: Release 0.1.9 Codex multi-agent settings

## Goal

Publish the Pota Codex multi-agent settings update as `@comento/pota-harness@0.1.9`, merge `dev` to `main` through GitHub PRs, and update the local Pota installation to the published version.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: this task mutates GitHub, npm, and local installed Codex state, so dry-runs and explicit verification must precede irreversible operations.
- Role-specific adjustment: keep the release task small, record command evidence, and do not use subagents because the current `spawn_agent` tool policy requires an explicit user delegation request.
- User-visible output locale: Korean.

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
  - Cross-domain refactor: no, the code change is scoped to lifecycle settings, tests, and docs.
  - Explicit extra-care signal: yes, the user requested npm publish, PR merges, and local installation.
- Heavy Path trigger, if selected: external release state mutation.
- Omitted delegation in Light Path, if applicable: not applicable.
- Pre-implementation decisions:
  - Publish `@comento/pota-harness@0.1.9` because npm latest is `0.1.8`.
  - Keep `package.json` and `.codex-plugin/plugin.json` versions aligned at `0.1.9`.
  - Use `dev` as the integration branch, then merge to `main`.

## Agent Assignments

- Local main session: version bump, release plan, checks, commit, push, PR creation/merge, npm publish, local upgrade, and evidence recording.

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
  - `gh auth status`
  - `npm whoami`
- No dry-run available, if applicable: GitHub PR merge and `npm publish` have no full reversible dry-run; use checks, PR status, and npm publish dry-run first.
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 1: release preparation

- Contract: Codex multi-agent settings change, tests, version bump, and release plan are committed on `dev`.
- Sub-tasks, if needed:
  - Verify package metadata and dry-runs.
  - Commit release changes.
- Files:
  - `package.json`
  - `.codex-plugin/plugin.json`
  - `PLAN.md`
  - `docs/plan/release-0.1.9-codex-multi-agent-settings.md`
  - `scripts/pota-lifecycle.mjs`
  - `test/lifecycle.test.mjs`
  - `commands/pota-doctor.md`
  - `README.md`
  - `README.ko.md`
- Dependencies: npm package metadata and GitHub remote.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`.
- Dry-run or check command: `npm test && npm run check && npm pack --dry-run && npm publish --dry-run`.
- Tests: `npm test`.
- Module acceptance verification: `npm test && npm run check`.
- Surface integration verification: `npm pack --dry-run && npm publish --dry-run`.

### Task 2: external release and local update

- Contract: `dev` is pushed, merged to `main` by PR, `@comento/pota-harness@0.1.9` is published to npm, and local Pota installation uses the published/latest version.
- Sub-tasks, if needed:
  - Push `dev`.
  - Create and merge `dev -> main` PR.
  - Publish npm package.
  - Update local installation and run doctor.
- Files: release metadata and installed local plugin state.
- Dependencies: GitHub and npm authentication.
- Tool readiness requirement: `gh auth status` and `npm whoami`.
- Dry-run or check command: PR status checks and npm publish dry-run from Task 1.
- Tests: `npm test`.
- Module acceptance verification: `gh pr view`, `git ls-remote`, and `npm view @comento/pota-harness version`.
- Surface integration verification: `bun add -g @comento/pota-harness@latest`, then `pota upgrade && pota doctor`.

## Evidence

- Tool readiness: `node scripts/pota.mjs toolcheck` passed; `gh auth status` authenticated as `dspaudio`; `npm whoami` returned `wonkyoo.nam`; `npm view @comento/pota-harness version` returned `0.1.8`.
- Dry-run or check: `npm pack --dry-run` passed for `@comento/pota-harness@0.1.9` with 60 tarball files; `npm publish --dry-run` passed for tag `latest`.
- Tests: `npm test` passed with 13 tests.
- Module acceptance: `npm test && npm run check` passed; `npm run check` reran syntax checks, JSON parsing, and 13 tests.
- Surface integration: `npm pack --dry-run && npm publish --dry-run` passed for `@comento/pota-harness@0.1.9`.
- Dev PR merge: PR #21 merged `codex/release-0.1.9-codex-multi-agent-settings` into `dev` at merge commit `e9dd67eddacc55b840c12b21881d9957402ff7c9` after Windows and Ubuntu CI passed.
- Main PR merge: PR #22 merged `dev` into `main` at merge commit `ef3f00e4b6d3cf2765ed4b368957d68e807cc588` after Windows and Ubuntu CI passed.
- Branch alignment: `origin/dev` and `origin/main` were fast-forward aligned to `ef3f00e4b6d3cf2765ed4b368957d68e807cc588`.
- npm publish: `npm publish` succeeded for `@comento/pota-harness@0.1.9`; after registry propagation, `npm view @comento/pota-harness version` returned `0.1.9` and `latest` points to `0.1.9`.
- Local environment update: `bun add -g @comento/pota-harness@latest` installed `@comento/pota-harness@0.1.9`; `pota upgrade && pota doctor` passed all installation checks, including `config features.multi_agent` and `config agents.max_depth`.
- Verification pass count: one release-preparation pass plus one publish/local-update verification pass.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
