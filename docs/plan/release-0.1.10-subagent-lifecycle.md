# Plan: Release 0.1.10 subagent lifecycle

## Goal

Publish the subagent lifecycle and stop-gate policy updates as `@comento/pota-harness@0.1.10`, merge the release branch into `dev`, merge `dev` into `main`, and verify npm latest.

## Whole Work

- Outcome: version metadata is bumped to `0.1.10`, release checks and npm publish dry-run pass before external mutation, a dev PR and a main PR are merged, and `@comento/pota-harness@0.1.10` is published to npm.
- Affected surfaces:
  - `package.json`
  - `.codex-plugin/plugin.json`
  - `PLAN.md`
  - `docs/plan/release-0.1.10-subagent-lifecycle.md`
  - GitHub branches and PRs
  - npm package registry
- Task classification: release preparation plus external release.
- Sub-tasks, if needed:
  - Bump version and record release plan.
  - Run local checks and npm dry-runs.
  - Commit, push, create/merge release-to-dev PR.
  - Create/merge dev-to-main PR.
  - Publish npm package and verify registry latest.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: release work is command-heavy, requires explicit dry-run evidence, and has external-state mutations.
- Role-specific adjustment: main agent orchestrates and delegates bounded file edits to `worker`; after the worker final report, main closes/releases the worker and reviews final report/evidence before continuing.
- User-visible output locale: Korean per user instruction.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: GitHub PR merges and npm publish mutate external state and require release verification.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: yes, GitHub and npm release operations.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: no new refactor, but release includes multiple package surfaces.
  - Explicit extra-care signal: yes, user requested version bump, npm publish, dev PR merge, and main PR merge.
- Heavy Path trigger, if selected: external release state mutation.
- Omitted delegation in Light Path, if applicable: not applicable.
- Pre-implementation decisions:
  - Publish `@comento/pota-harness@0.1.10` if npm latest is `0.1.9`.
  - Keep `package.json` and `.codex-plugin/plugin.json` versions aligned.
  - Use `codex/release-0.1.10-subagent-lifecycle` as the release branch.
  - Merge release branch into `dev` first, then merge `dev` into `main`.
  - Run npm publish dry-run before the real publish.

## Agent Assignments

- `worker`: bump release metadata in `package.json` and `.codex-plugin/plugin.json`; preserve existing user edits and do not revert other files.
- Local main session: orchestrate, verify, record evidence, commit, push, create/merge PRs, publish npm, and verify registry state.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for this release task.
- Required typecheck/lint/verification tools: `npm test`, `npm run check`, `npm pack --dry-run`, `npm publish --dry-run`, `gh`, `git`, `npm`.
- Missing tools: none locally; npm registry access required network outside the sandbox and succeeded with approval.
- Install/bootstrap commands attempted: none.
- Tool blockers: `gh auth status` reported invalid local `gh` token; GitHub App connector may be required if `gh` cannot create/merge PRs.

## Execution Guardrails

- Dry-run or check mode before external-state mutation:
  - `npm test`
  - `npm run check`
  - `npm pack --dry-run`
  - `npm publish --dry-run`
  - PR status checks before merge.
- No dry-run available, if applicable: GitHub PR merge and real `npm publish` have no full reversible dry-run; use checks and publish dry-run first.
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 1: release preparation

- Contract: current policy changes, version bump, and release plan are committed on the release branch.
- Sub-tasks, if needed: not needed.
- Files:
  - `package.json`
  - `.codex-plugin/plugin.json`
  - `PLAN.md`
  - `docs/plan/release-0.1.10-subagent-lifecycle.md`
- Dependencies: npm package metadata and GitHub remote.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`, `npm whoami`, and `gh auth status` or GitHub App fallback.
- Dry-run or check command: `npm test && npm run check && npm pack --dry-run && npm publish --dry-run`.
- Tests: `npm test`.
- Module acceptance verification: `npm test && npm run check`.
- Surface integration verification: `npm pack --dry-run && npm publish --dry-run`.

### Task 2: external release

- Contract: release branch is merged to `dev`, `dev` is merged to `main`, `@comento/pota-harness@0.1.10` is published to npm, and npm latest reports `0.1.10`.
- Sub-tasks, if needed: use GitHub App fallback if local `gh` token remains invalid.
- Files: release metadata and installed GitHub/npm external state.
- Dependencies: GitHub and npm authentication.
- Tool readiness requirement: `git fetch`, `git push`, PR creation/merge capability, and `npm whoami`.
- Dry-run or check command: PR checks and npm publish dry-run from Task 1.
- Tests: `npm test`.
- Module acceptance verification: `gh pr view` or GitHub App PR metadata, `git ls-remote`, and `npm view @comento/pota-harness version`.
- Surface integration verification: `npm view @comento/pota-harness version` reports `0.1.10`.

## Evidence

- Dry-run or check: `npm --cache /private/tmp/pota-npm-cache pack --dry-run` passed for `@comento/pota-harness@0.1.10` with 60 tarball files; `npm --cache /private/tmp/pota-npm-cache publish --dry-run` passed for tag `latest`.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; `git fetch origin` passed; `npm view @comento/pota-harness version` returned `0.1.9`; `npm whoami` returned `wonkyoo.nam`; `gh auth status` reported invalid local token.
- Tests: `npm run check` passed with 15 tests; `npm pack --dry-run` and `npm publish --dry-run` reran `npm run check`.
- Version metadata: `node -e "const fs=require('node:fs'); for (const f of ['package.json','.codex-plugin/plugin.json']) { const data=JSON.parse(fs.readFileSync(f,'utf8')); if (data.version !== '0.1.10') throw new Error(f + ' version ' + data.version); }"` passed, confirming both release metadata versions are `0.1.10`.
- Module acceptance: `npm run check` passed for `@comento/pota-harness@0.1.10`.
- Surface integration: `npm --cache /private/tmp/pota-npm-cache pack --dry-run` and `npm --cache /private/tmp/pota-npm-cache publish --dry-run` passed for `@comento/pota-harness@0.1.10`.
- Dev PR merge: PR #25 merged `codex/release-0.1.10-subagent-lifecycle` into `dev` at merge commit `e23b89c352814aa954539fd613a43491a002c781` after Ubuntu and Windows CI passed.
- Main PR merge: PR #26 merged `dev` into `main` at merge commit `8166c25877ba408b855883946bb5433451f1a418` after Ubuntu and Windows CI passed.
- npm publish: `npm --cache /private/tmp/pota-npm-cache publish` succeeded for `@comento/pota-harness@0.1.10`; `npm view @comento/pota-harness version` returned `0.1.10`.
- Verification pass count: 1 release-preparation pass plus 1 publish/PR verification pass.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
