# Plan: Pota 0.2.4 릴리스

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation.

## Goal

현재 clean uninstall·prompt cache 복원력 변경을 Pota 0.2.4로 준비하고, dev PR과 main PR을 검증·병합한 뒤 npm `latest`로 게시합니다.

- Goal ID: `goal-release-0.2.4`
- Plan ID: `docs/plan/release-0.2.4.md`
- Completion criteria: 0.2.4 산출물 검증, dev/main PR CI 성공 및 병합, npm 0.2.4 게시와 registry 확인.
- Required goal evidence: `finalReview`.
- Terminal state: `completed`, `paused`, `blocked`, 또는 `cancelled`.

## Whole Work

- Outcome: 현재 변경을 릴리스 브랜치에 커밋하고 dev와 main으로 순차 승격한 뒤 npm에 0.2.4를 게시합니다.
- Anticipated surfaces: package/plugin 버전 메타데이터, 릴리스 계획, git branch/commit, GitHub PR·CI, npm package/registry.
- Stable roadmap: triage → release preparation → dev PR → main PR → npm publish → final verification/review.

## Memory Inputs

- `MEMORY.md`
- 관련 domain memory는 triage에서 확인합니다.

## Initial Investigation Scope

- 현재 branch/worktree와 기존 변경 범위.
- 0.2.3 릴리스 계획·workflow·package lifecycle·버전 표면.
- GitHub remote/PR/CI 상태와 npm 인증·registry 상태의 read-only 확인.
- 정상 `npm run check`, `npm pack --dry-run`, `npm publish --dry-run` 경로.

## Triage Result

- Base state: local `dev` and `origin/dev` are both `eb63b6836ce5c8de0395daaa554225b66979a003`; `origin/main` is `87472d2c32c676785fd8062477ec11d7e3d42c19`.
- Current changes: clean uninstall, completed-task evidence refresh, prompt recovery/cache shape, tests/docs가 아직 commit되지 않은 상태입니다.
- Release branch: `codex/release-0.2.4-clean-uninstall-cache`, base `dev`. 같은 이름의 remote branch와 열린 0.2.4 PR은 없습니다.
- Version surfaces: `package.json`, `.codex-plugin/plugin.json`, current-version assertions in `test/contract-parity.test.mjs`, `test/installed-plugin.test.mjs`, `test/lifecycle-transaction.test.mjs`, `test/lifecycle.test.mjs`, `test/packed-install.test.mjs`만 0.2.4로 올립니다. `scripts/release-integrity-0.2.2.json`과 legacy adoption 0.2.2 계약, 과거 릴리스 계획은 유지합니다.
- GitHub: 갱신된 `gh` token과 git credential, GitHub app의 read/write PR·workflow·merge 경로가 모두 동작합니다. PR 생성·병합은 GitHub app을 사용하고 CI 재확인은 `gh`로 교차 검증합니다.
- npm: account `wonkyoo.nam` 인증됨; registry의 `@comento/pota-harness@0.2.4`는 E404로 미게시 상태입니다.
- npm runtime: system npm 12.0.0은 직전 릴리스에서 sigstore 게시 문제가 있었으므로 사용하지 않습니다. 검증된 `/private/tmp/pota-npm-runtime/node_modules/npm/bin/npm-cli.js`의 npm 10.9.8을 pack, tarball dry-run, actual publish 모두에 동일하게 사용합니다.
- Package lifecycle: `prepack`은 content-producing `npm run check`이므로 `--ignore-scripts`를 사용하지 않습니다.

## Initial Toolcheck

- Node/npm, git, gh, repository test runner, Pota toolcheck를 triage에서 확인합니다.
- 도구 설치는 명시적 승인 없이는 수행하지 않습니다.

## Tool Readiness

- Detected stack: JavaScript ESM, Node `node:test`, npm package, GitHub Actions.
- Pota toolcheck: Node와 npm OK, missing tool 없음.
- Required tools: Node 26.5.0, 고정 npm 10.9.8 CLI, git, GitHub app, registry network.
- Blockers: 없음. `gh` CLI 인증은 사용할 수 없지만 GitHub app이 동등한 PR/CI/merge 표면을 제공합니다.

## Initial Heavy Path Criteria

- 외부 상태 변경: git push, PR 생성·병합, npm publish.
- release branch 승격과 package registry 게시가 있어 Heavy Path를 우선 검토합니다.
- 보안/인증·DB·새 아키텍처·transaction/cache 변경 여부는 triage에서 코드 diff로 확인합니다.

## Complexity Triage

- Selected path: Heavy Path.
- Rationale: 구현 diff 자체가 lifecycle transaction/cache 및 goal session recovery를 포함하고, 릴리스는 GitHub branch/PR merge와 npm registry라는 외부 상태를 순차 변경합니다.
- Heavy Path signals found: transaction/cache behavior, session recovery, cross-surface changes, external publish/merge.
- Checked but not found: 새 디렉터리/아키텍처 레이어, 새 domain model/service, auth 정책 변경, DB schema/migration, queue/payment.
- Pre-implementation decisions: 0.2.4 current-version surface만 변경; 실제 사용자 Pota install/upgrade/uninstall은 실행하지 않음; CI 실패 시 원인 수정은 별도 bounded sub-task; 검증된 PR head SHA를 merge API의 `expected_head_sha`로 고정; 고정 npm 10.9.8과 worktree 밖 동일 tarball 사용; publish 응답이 모호하면 registry digest 조회 전 blind retry 금지.

## Agent Assignments

- Main orchestrator: 계획·goal evidence, branch/commit/push, GitHub app PR/CI/merge, npm dry-run/publish/registry 검증.
- Pre-implementation reviewer: 버전 범위, 승격 순서, publish fail-close 조건을 read-only 검토.
- Release worker: version metadata와 current-version tests만 수정하며 기존 변경을 되돌리지 않음.
- Final reviewer: exact merged SHA, package digest, registry 결과와 goal evidence를 read-only 대조.

## Initial Tasks

### Task 0: triage-plan

- Status: completed.
- Contract: 저장소·도구·릴리스 표면을 조사하고 dry-run/check 및 rollback/중단 경계를 포함한 decision-complete 실행 계획을 확정합니다.
- Required evidence: `planArtifact`, `triageDecision`.

### Task 1: release-prepare

- Status: completed.
- Contract: 위에 확정한 current-version surface를 0.2.4로 올리고, `git diff --check`, 전체 `npm run check`, 정상 `npm pack --dry-run`, `npm publish --dry-run`을 통과합니다.
- Files: `package.json`, `.codex-plugin/plugin.json`, 5개 current-version test files, `PLAN.md`, `docs/plan/release-0.2.4.md`.
- Test contract: 두 manifest가 0.2.4로 일치하고 모든 installed/runtime/current ownership expectation이 0.2.4이며 legacy 0.2.2 integrity/adoption 계약은 유지됩니다.
- Expected initial failure: current-version assertions와 manifests가 0.2.3입니다.
- Tests: focused version assertion, `npm run check`, `npm --cache /private/tmp/pota-npm-cache pack --dry-run`, `npm --cache /private/tmp/pota-npm-cache publish --dry-run --access public --tag latest`.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 2: dev-pr

- Status: completed.
- Contract: `codex/release-0.2.4-clean-uninstall-cache`를 만들고 전체 변경을 의도적으로 commit한 뒤 push합니다. GitHub app으로 base `dev` PR을 생성하고 head SHA의 3 OS × Node 18/current CI 6/6 성공을 확인한 뒤 merge commit 방식으로 병합합니다.
- Dry-run/check: `git diff --check`, `git status --short`, `git diff --stat`, branch가 `origin/dev`에서 분기했는지 확인하고 실제 push 직전 `git push --dry-run origin HEAD:<branch>`를 실행합니다.
- Failure boundary: CI 실패 시 merge 금지; 한 번 진단 후 bounded fix와 전체 gate 재실행. merge 직전 PR head를 재조회하고 검증된 head SHA를 GitHub merge API의 `expected_head_sha`로 전달합니다. head가 바뀌거나 expected SHA가 거부되면 merge하지 않고 이전 CI evidence를 폐기합니다.
- Tests: head SHA workflow run 6 jobs success, merge 결과의 base/head/merge SHA 확인.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: main-pr

- Status: completed.
- Contract: dev merge 후 remote `dev` SHA를 확인하고 GitHub app으로 `dev`→`main` PR을 생성합니다. PR head SHA의 CI 6/6 성공과 base가 최신 `main`임을 확인한 뒤 merge commit으로 병합합니다.
- Dry-run/check: `git fetch origin`, `git merge-base --is-ancestor <dev-merge-sha> origin/dev`, GitHub compare/PR 상태.
- Failure boundary: dev 이외 변경이 섞이거나 CI가 실패하면 main merge 금지. merge 직전 PR head를 재조회하고 CI가 성공한 SHA와 동일할 때만 그 값을 `expected_head_sha`로 전달하며, 불일치는 중단합니다.
- Tests: main PR head workflow 6 jobs success, merge SHA가 `origin/main`에 포함됨.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 4: npm-publish

- Status: completed.
- Contract: main merge 뒤 새로 fetch한 exact `origin/main` SHA를 임시 clean worktree로 checkout합니다. pack 직전에 `HEAD == freshly fetched origin/main == main PR merge SHA`와 `git status --porcelain` empty를 확인합니다. 고정 npm 10.9.8의 `npm pack --json --pack-destination <external-artifact-dir>`로 worktree 밖에 한 번 만든 tarball의 SHA-1/SHA-512를 고정하고 tracked tree가 계속 clean인지 재확인합니다. 같은 외부 `.tgz` 절대 경로를 npm 10.9.8의 `publish --dry-run`과 실제 `publish --access public --tag latest` argv에 전달합니다.
- Preconditions: exact clean worktree와 외부 artifact directory, manifests 0.2.4, registry 0.2.4 부재, npm account `wonkyoo.nam`, main PR merge SHA 일치, npm CLI 10.9.8.
- Failure boundary: publish timeout/응답 손실 시 `npm view @comento/pota-harness@0.2.4 dist --json`으로 먼저 확인합니다. registry digest가 고정 tarball과 일치할 때만 성공이며 blind retry하지 않습니다.
- Registry verification: `version=0.2.4`, `latest=0.2.4`, dist shasum/integrity/tarball이 고정 tarball과 일치해야 합니다.
- Isolated smoke: `HOME`, `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`, npm cache와 install prefix를 모두 하나의 임시 root 아래 명시합니다. registry `@comento/pota-harness@0.2.4`를 임시 prefix에 설치하고 package manifest와 CLI help만 읽기 전용으로 확인합니다. Pota lifecycle install/upgrade/uninstall은 격리 환경에서도 실행하지 않으며 사용자 현재 설치도 변경하지 않습니다.
- Tests: publish dry-run JSON, registry version/dist-tags/dist, isolated npm install/CLI.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 5: final-verify

- Status: completed.
- Contract: release→dev와 dev→main PR/merge SHA, main package digest, npm registry 0.2.4/latest, isolated smoke, plan/goal evidence를 재확인하고 독립 리뷰합니다.
- Tests: GitHub app PR/workflow state, `npm view @comento/pota-harness@0.2.4 version dist --json`, `npm view @comento/pota-harness dist-tags --json`, `git diff --check`.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

## Verification Loop

- Task당 기본 2회. 실패하면 한 번 진단하고 범위를 줄여 재실행하며, 두 번째 실패 뒤에는 goal/task를 blocked로 기록합니다.
- 외부 상태 증거는 exact branch/commit/package digest에 묶고 관련 mutation 뒤 stale로 취급합니다.

## Evidence

- Initial tool/remote/registry triage: Node/npm OK, remote dev/main SHA 확인, 0.2.4 branch/PR 부재, npm account와 version E404 확인.
- Pre-implementation review: 두 PR의 expected head 원자적 merge, npm 10.9.8 고정, 외부 tarball 경로와 clean-main 경계, 모든 HOME/cache가 격리된 smoke를 계획에 반영해 P1/P2 findings를 해소했습니다.
- Release preparation: 두 manifest와 current-version test surface를 0.2.4로 갱신하고 legacy 0.2.2 integrity/adoption 계약을 유지했습니다. Focused 59/59, 고정 npm 10.9.8의 전체 `npm run check` 118/118, `npm pack --dry-run --json`, `npm publish --dry-run --access public --tag latest --json`, `git diff --check`가 통과했습니다.
- dev promotion: release commit `e2e5cf8ed0c0f4d895603731685c86ddd5ee549c`를 PR #47로 `dev`에 제안했습니다. exact head의 macOS/Ubuntu/Windows × Node 18/current CI 6/6 성공을 재확인하고 `expected_head_sha`로 고정해 merge commit `796bdc9cb52a345de14a168f7ad980bf4dafb2d4`로 병합했습니다.
- main promotion: `dev` merge SHA `796bdc9cb52a345de14a168f7ad980bf4dafb2d4`를 PR #48로 `main`에 제안했습니다. exact head의 CI 6/6 성공을 재확인하고 `expected_head_sha`로 고정해 merge commit `5b6cd2b31a34c1d5c00c4c0881ddee4a5d8f406c`로 병합했습니다.
- npm publish: freshly fetched `origin/main`과 동일한 detached clean worktree `5b6cd2b31a34c1d5c00c4c0881ddee4a5d8f406c`에서 npm 10.9.8로 118/118 tests와 pack을 통과했습니다. 동일 tarball의 SHA-1은 `8a6949492a9009d71d6cef84d356d599ecff8ff5`, integrity는 `sha512-l6bMJBlmUV4jwKXu+8Cxj/kpAj+FQdb6uawHqi50GBoRT3i6aFf6DDKSgiw7eXaPL33vzJ/iKRbtizU8rjV8jg==`이며 dry-run과 실제 publish에 같은 절대 경로를 전달했습니다.
- Registry/smoke: npm registry에서 `version=0.2.4`, `latest=0.2.4`, tarball shasum/integrity 일치를 확인했습니다. 모든 HOME, Pota harness home, npm cache와 prefix를 임시 root로 격리한 설치에서 package version 0.2.4와 CLI `--help`를 확인했습니다.
- Independent review: PR head/merge SHA, 각 CI 6/6, dev/main ancestry, clean worktree, tarball digest, registry metadata, npm 10.9.8, isolated install/CLI를 read-only로 독립 대조했습니다. 릴리스 산출물 차단 이슈는 없었고, 계획/goal 증거 동기화 P1 finding은 이 evidence/status 갱신과 tool-bound receipt 기록으로 해소했습니다.
- Safety: 사용자 현재 Pota 설치에는 lifecycle 명령을 실행하지 않습니다.

## Status

- [x] Initial plan created
- [x] Triage finalized
- [x] Release prepared
- [x] dev PR merged
- [x] main PR merged
- [x] npm 0.2.4 published
- [x] Reviewed and completed
