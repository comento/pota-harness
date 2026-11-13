# Plan: Release 0.1.11 locale artifacts

## Goal

`@comento/pota-harness@0.1.11`로 locale artifact 정책 수정과 한국어 초기화 템플릿을 배포하고, release branch를 `dev`에 머지한 뒤 `dev`를 `main`에 머지하고 npm 최신 버전을 확인한다.

## Whole Work

- Outcome: 버전 메타데이터가 `0.1.11`로 올라가고, locale 정책 변경이 검증되며, dev PR과 main PR이 머지되고, `@comento/pota-harness@0.1.11`이 npm에 배포된다.
- Affected surfaces:
  - `package.json`
  - `.codex-plugin/plugin.json`
  - `scripts/pota.mjs`
  - `scripts/pota-state.mjs`
  - `scripts/pota-state.sh`
  - `skills/`, `commands/`, `.agents/workflows/`
  - `templates/`, `README*.md`, `docs/model-guidance/`
  - `PLAN.md`
  - `docs/plan/release-0.1.11-locale-artifacts.md`
  - GitHub branches and PRs
  - npm package registry
- Task classification: release preparation plus external release.
- Sub-tasks, if needed:
  - Record release plan and bump package metadata.
  - Run local checks and npm dry-runs.
  - Commit, push, create/merge release-to-dev PR.
  - Create/merge dev-to-main PR.
  - Publish npm package and verify registry latest.
  - Record completion evidence.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- Rationale: 릴리스 작업은 명령 기반 검증, dry-run, GitHub/npm 외부 상태 변경을 포함한다.
- Role-specific adjustment: subagent 도구가 현재 노출되지 않아 main agent가 구현을 직접 수행하고 그 사실을 증거에 기록한다.
- User-visible response and artifact locale: Korean per user instruction.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: GitHub PR merge와 npm publish가 외부 상태를 변경하며, 사용자도 버전 bump부터 배포까지 명시적으로 요청했다.
- Heavy Path signals checked:
  - New directory/module/layer: no.
  - New domain model/service/abstraction: no.
  - Security/auth/session: no.
  - External API/message queue/payment: yes, GitHub and npm release operations.
  - DB schema/migration: no.
  - Concurrency/transaction/cache invalidation: no.
  - Cross-domain refactor: no, but release touches multiple package surfaces.
  - Explicit extra-care signal: yes, user requested version bump, dev PR merge, main PR merge, and npm publish.
- Heavy Path trigger, if selected: external release state mutation.
- Omitted delegation in Light Path, if applicable: not applicable.
- Pre-implementation decisions:
  - Publish `@comento/pota-harness@0.1.11` because npm latest is `0.1.10`.
  - Keep `package.json` and `.codex-plugin/plugin.json` versions aligned.
  - Use `codex/release-0.1.11-locale-artifacts` as the release branch.
  - Merge release branch into `dev` first, then merge `dev` into `main`.
  - Run `npm pack --dry-run` and `npm publish --dry-run` before real publish.
  - Record completion evidence after npm publish.

## Agent Assignments

- Local main session: subagent tools are unavailable in the current tool list; main agent records this takeover, edits bounded files, verifies, commits, pushes, creates/merges PRs, publishes npm, and records evidence.

## Tool Readiness

- Detected stack: JavaScript.
- Toolcheck command: `node scripts/pota.mjs toolcheck` passed.
- Required LSP/symbol tools: not required for this release task.
- Required typecheck/lint/verification tools: `npm test`, `npm run check`, `npm pack --dry-run`, `npm publish --dry-run`, `gh`, `git`, `npm`.
- Missing tools: none.
- Install/bootstrap commands attempted: none.
- Tool blockers: none.

## Execution Guardrails

- Dry-run or check mode before external-state mutation:
  - `npm test`
  - `npm run check`
  - `npm pack --dry-run`
  - `npm publish --dry-run`
  - PR checks before merge.
- No dry-run available, if applicable: GitHub PR merge and real `npm publish` have no full reversible dry-run; use checks and publish dry-run first.
- Verification loop budget: two passes per task by default.
- Failure handling: diagnose once, shrink the task or split it into sub-tasks, rerun both gates, then record a blocker after the second failed pass.

## Module Tasks

### Task 1: release preparation

- Contract: locale artifact policy changes, Korean initialization templates, version bump, and release plan are committed on the release branch.
- Sub-tasks, if needed: not needed.
- Files:
  - `.agents/workflows/*.md`
  - `.codex-plugin/plugin.json`
  - `MEMORY.md`
  - `PLAN.md`
  - `README*.md`
  - `commands/*.md`
  - `docs/model-guidance/*.md`
  - `docs/plan/release-0.1.11-locale-artifacts.md`
  - `package.json`
  - `scripts/pota-state.mjs`
  - `scripts/pota-state.sh`
  - `scripts/pota.mjs`
  - `skills/*/SKILL.md`
  - `templates/*.md`
  - `test/lifecycle.test.mjs`
- Dependencies: npm package metadata and GitHub remote.
- Tool readiness requirement: `node scripts/pota.mjs toolcheck`, `npm whoami`, and `gh auth status`.
- Dry-run or check command: `npm test && npm run check && npm pack --dry-run && npm publish --dry-run`.
- Tests: `npm test`.
- Module acceptance verification: `npm test && npm run check`.
- Surface integration verification: `npm pack --dry-run && npm publish --dry-run`.

### Task 2: external release

- Contract: release branch is merged to `dev`, `dev` is merged to `main`, `@comento/pota-harness@0.1.11` is published to npm, and npm latest reports `0.1.11`.
- Sub-tasks, if needed: record completion evidence after publish.
- Files: release metadata and external GitHub/npm state.
- Dependencies: GitHub and npm authentication.
- Tool readiness requirement: `git fetch`, `git push`, PR creation/merge capability, and `npm whoami`.
- Dry-run or check command: PR checks and npm publish dry-run from Task 1.
- Tests: `npm test`.
- Module acceptance verification: `gh pr view`, `git ls-remote`, and `npm view @comento/pota-harness version`.
- Surface integration verification: `npm view @comento/pota-harness version` reports `0.1.11`.

## Evidence

- Dry-run or check: `npm pack --dry-run` passed for `@comento/pota-harness@0.1.11` with 60 tarball files; `npm publish --dry-run` passed for tag `latest`.
- Tool readiness: `node scripts/pota.mjs toolcheck` passed; `gh auth status` authenticated as `dspaudio`; `npm whoami` returned `wonkyoo.nam`; `npm view @comento/pota-harness version` returned `0.1.10`.
- Tests: `npm test` passed with 15 tests; `npm run check` passed and reran the 15 tests.
- Module acceptance: `npm run check` passed for `@comento/pota-harness@0.1.11`.
- Surface integration: `npm pack --dry-run` and `npm publish --dry-run` passed for `@comento/pota-harness@0.1.11`; `npm view @comento/pota-harness version dist-tags.latest` returned `0.1.11` for both fields.
- Version metadata: `package.json` and `.codex-plugin/plugin.json` both report version `0.1.11`.
- Delegation takeover: subagent tools were unavailable in the active tool list, so the main agent implemented directly and recorded this takeover.
- Dev PR merge: PR #29 merged `codex/release-0.1.11-locale-artifacts` into `dev` at merge commit `a46aa65f06d3540a486797b080d40b9d01aaa59e` after Ubuntu and Windows CI passed.
- Main PR merge: PR #30 merged `dev` into `main` at merge commit `c85af86bed15cf3d6c445350c7225a35bc5e49e5` after Ubuntu and Windows CI passed. PR branch update first merged prior `main` completion evidence into `dev`.
- npm publish: `npm publish` succeeded for `@comento/pota-harness@0.1.11`; publish-time `prepack` ran `npm run check`, which passed with 15 tests.
- Verification pass count: 1 release-preparation pass plus 1 publish/PR verification pass.
- Blocker after two failed passes: none.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
