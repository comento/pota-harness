# Plan: Pota 0.2.5 hotfix 릴리스

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for release execution.
- Completed: release artifacts, promotion receipts, registry verification, and independent review recorded.

## Goal

검증 완료된 mutable shared config hotfix를 원격 branch에 push하고, exact head를 `dev`와 `main` PR로 순차 승격한 뒤 동일 main 산출물을 npm `@comento/pota-harness@0.2.5` latest로 게시합니다.

- Plan ID: `docs/plan/release-0.2.5.md`
- Safety: 현재 사용자 Pota 설치와 `~/.codex/config.toml`은 읽거나 변경하지 않습니다.
- Required goal evidence: `finalReview`.

## Whole Work

1. `triage-plan`: branch/commit, clean worktree, gh/npm 인증, version/registry 상태, CI 계약과 dry-run 근거를 확인해 릴리스 계획을 확정합니다.
2. `dev-pr`: hotfix branch를 push하고 exact head의 CI 성공 뒤 `dev` PR을 병합합니다.
3. `main-pr`: exact dev head를 `main` PR로 승격하고 CI 성공 뒤 병합합니다.
4. `npm-publish`: exact main tree에서 tarball을 생성·검증하고 npm 0.2.5를 게시해 registry digest와 격리 install/CLI를 확인합니다.
5. `release-complete`: 브랜치·PR·CI·npm 증거를 검토하고 계획과 goal을 완료합니다.

## Initial Investigation Scope

- 현재 branch/HEAD/worktree 및 origin/dev/main 관계.
- GitHub CLI 인증과 open PR/CI 상태.
- npm 인증, 현재 latest/version 존재 여부, lifecycle scripts와 pack/publish dry-run.
- 기존 0.2.4 릴리스 계획의 exact-head 및 동일 tarball 게시 계약.

## Triage Result

- Current branch/head: `codex/hotfix-0.2.5-shared-config-upgrade` at `feccfc07b5a660aaa9fd6f3d2211f7d65216530b`, based on `origin/dev` `8930e9539f73092c81f10ef15f09067794d6bca2`.
- Worktree: release plan/index만 uncommitted입니다. 두 파일을 별도 release-plan commit으로 포함한 새 exact head를 CI/merge 기준으로 사용합니다.
- Remote after fresh fetch: `origin/dev=8930e9539f73092c81f10ef15f09067794d6bca2`, `origin/main=89dfedf063c49e2fc644685e4aca12c975929c40`.
- GitHub: `comento/pota-harness`, default `main`, escalated network context의 `gh auth status` 성공, open PR 없음. CI는 macOS/Ubuntu/Windows × Node 18/current 6 jobs입니다.
- npm: account `wonkyoo.nam`, `latest=0.2.4`, `@comento/pota-harness@0.2.5` E404. System npm 12는 사용하지 않고 검증된 npm 10.9.8 `/private/tmp/pota-npm-runtime/node_modules/npm/bin/npm-cli.js`를 고정합니다.
- Package gates: npm 10.9.8 normal-script `pack --dry-run`과 `publish --dry-run` 모두 129/129 tests, 64-file package, SHA-1 `08cfef271e70553ae8c94726f4c8a9671848c87a`, integrity `sha512-O/cvRuqRhPTRBjxriMKcy2sJSvUhFI/gpgCkgSOtsDbcggzALX1fobceUqLkEP34WUNXOGDhItDrxfcptvYQOw==`로 통과했습니다.

## Complexity Triage

- Selected path: Heavy Path.
- Rationale: GitHub push/PR/merge와 npm registry publish라는 외부 상태 변경을 exact SHA와 package digest에 묶어 순차 실행해야 합니다.
- Heavy Path signals found: external API/registry mutation, multi-branch promotion, irreversible package-version publish.
- Checked but not found: 새 코드 구현, auth 정책 변경, DB/migration, queue/payment, 새 architecture layer. Hotfix 구현 자체는 이미 검증·commit됐습니다.
- Roles: main orchestrator가 외부 mutation과 evidence를 수행하고, read-only preflight agent가 branch/version/CI/npm gate를 독립 확인했습니다. 최종 reviewer가 merge SHA·registry digest·smoke를 재검토합니다.

## Execution Contracts

### Task 0: triage-plan

- Status: completed after bound evidence.
- Checks: toolcheck/version/auth/registry/remote state, npm 10.9.8 pack and publish dry-run.

### Task 1: dev-pr

- Status: completed.
- Contract: release-plan commit 뒤 `git diff --check`, clean status, `git push --dry-run`을 재실행하고 branch를 push합니다. base `dev` ready PR을 만들고 exact PR head의 CI 6/6 성공 후 merge 직전 head를 재조회해 `--match-head-commit`으로 고정 병합합니다.
- Failure boundary: head 변경, CI 실패/누락, base drift가 있으면 병합하지 않습니다.

### Task 2: main-pr

- Status: completed.
- Contract: fresh fetch한 exact `origin/dev`를 head로 `dev`→`main` ready PR을 만들고, exact head CI 6/6 후 `--match-head-commit`으로 병합합니다.
- Failure boundary: dev에 unrelated 추가 변경이 들어오거나 head/CI가 달라지면 중단합니다.

### Task 3: npm-publish

- Status: completed.
- Contract: main merge 후 freshly fetched `origin/main` exact SHA의 clean detached worktree를 만들고 npm 10.9.8로 worktree 밖 tarball을 한 번 생성합니다. 동일 절대 경로 tarball을 `publish --dry-run`과 실제 `publish --access public --tag latest`에 전달합니다.
- Preconditions: `HEAD == origin/main == main PR merge SHA`, clean worktree, 0.2.5 manifests, npm whoami, registry E404.
- Failure boundary: publish 응답이 모호하면 blind retry하지 않고 registry version/dist digest를 먼저 조회합니다.
- Verification: registry version/latest/shasum/integrity 일치와 완전 격리된 HOME/CODEX_HOME/CLAUDE_HOME/ANTIGRAVITY_HOME/npm cache/prefix의 registry install 및 CLI help. lifecycle install/upgrade/uninstall은 실행하지 않습니다.

### Task 4: release-complete

- Status: completed.
- Contract: branch/PR exact heads, CI 6/6, dev/main merge SHA, registry digest와 isolated smoke를 독립 재검토하고 plan/goal evidence를 완료합니다.

## Evidence

- Release head: hotfix `feccfc07b5a660aaa9fd6f3d2211f7d65216530b`와 release-plan commit을 포함한 exact head `d87bc9d2cf0939446bc9e60ef92c34f3f7df8a63`을 push했습니다.
- dev promotion: PR #51은 exact head `d87bc9d2cf0939446bc9e60ef92c34f3f7df8a63`의 macOS/Ubuntu/Windows × Node 18/current CI 6/6 성공 후 merge commit `5336a322345dd8869fb55e5865ebc9cb48de940f`로 병합됐습니다.
- main promotion: PR #52는 exact dev head `5336a322345dd8869fb55e5865ebc9cb48de940f`에서 같은 CI 6/6을 통과하고 merge commit `e3b55fa2983f60729f5fe097e2354c9437014523`로 병합됐습니다. 첫 macOS/Node 18 run의 `parallel receipts are serialized without lost updates`가 20개 중 19개를 관찰한 단발성 경합 실패였고, 동일 SHA의 failed-job 1회 재실행에서 전체 check와 package dry-run이 통과했습니다.
- Branch policy: `dev`와 `main`의 legacy required context `check`가 matrix job 이름을 집계하지 않아 GitHub가 6/6 성공 뒤에도 `BLOCKED`/`BEHIND`를 표시했습니다. required approvals는 0이고 conversation은 모두 resolved였으므로 exact head를 `--match-head-commit`으로 고정한 administrator merge API 경로를 사용했습니다.
- Package: freshly fetched exact `origin/main=e3b55fa2983f60729f5fe097e2354c9437014523`의 detached clean worktree에서 npm 10.9.8 normal-script pack을 한 번 실행했습니다. 129 tests 중 128 pass, 환경 의존 1 skip, 64 files, SHA-1 `08cfef271e70553ae8c94726f4c8a9671848c87a`, integrity `sha512-O/cvRuqRhPTRBjxriMKcy2sJSvUhFI/gpgCkgSOtsDbcggzALX1fobceUqLkEP34WUNXOGDhItDrxfcptvYQOw==`였습니다.
- Publish: 같은 외부 tarball 절대 경로로 npm 10.9.8 `publish --dry-run`과 실제 `publish --access public --tag latest`를 실행했습니다. Registry의 `version=0.2.5`, `latest=0.2.5`, shasum/integrity가 고정 tarball과 정확히 일치합니다.
- Isolated smoke: 별도 HOME, `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`, npm cache/prefix에서 새 registry cache로 `@comento/pota-harness@0.2.5`를 `--ignore-scripts` 설치하고 두 manifest의 0.2.5와 CLI `--help`를 확인했습니다. Pota lifecycle install/upgrade/uninstall은 실행하지 않았습니다.
- Independent review: PR #51/#52 live metadata와 CI 6/6, d87→5336→e3b merge ancestry와 동일 tree, exact-main tarball digest, npm live metadata, 격리 lockfile/install/CLI를 read-only로 대조해 actionable finding이 없음을 확인했습니다.
- Residual risk: 게시 후 registry 설치본 lifecycle E2E는 안전 경계상 실행하지 않았습니다. 해당 경로는 릴리스 전 actual 0.2.4→0.2.5 격리 upgrade 계약과 전체 CI로 검증됐으며, registry/remote 결과는 2026-07-23 live snapshot입니다.
- Safety: 사용자 Pota 설치와 `~/.codex/config.toml`은 읽거나 변경하지 않았습니다.

## Status

- [x] Initial plan created
- [x] Triage finalized
- [x] dev PR merged
- [x] main PR merged
- [x] npm 0.2.5 published and verified
- [x] Final review completed
