# Plan: Pota 0.2.3 릴리스

## Plan Phase

- Initial: decision-complete for triage; not implementation-ready.
- Finalized: decision-complete for implementation.
- Codex UI synchronization: 초기 roadmap을 UI plan/goal과 repository goal에 동기화합니다.

## Goal

현재 하네스 신뢰성 개선 변경을 0.2.3으로 준비하고, `dev` PR 병합 후 `main` PR을 병합하여 npm에 배포한 다음 npm 설치본으로 재설치 및 실제 upgrade smoke test를 완료합니다.

- Plan ID: `docs/plan/release-0.2.3.md`
- Completion criteria: dev/main PR 병합, npm `@comento/pota-harness@0.2.3` 확인, npm 설치본 재설치, 0.2.2 기반 실제 upgrade smoke 및 doctor 검증 성공.
- Required goal evidence: `finalReview`.
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome: 검증된 변경이 GitHub의 dev→main 승격 흐름을 거쳐 npm 0.2.3으로 게시되고, 게시 산출물이 로컬 custom lifecycle에서 정상 설치·업그레이드됩니다.
- Anticipated affected surfaces: release metadata, package artifact, git branch/commits, GitHub PRs, npm registry, 격리 smoke home, 최종 사용자 홈 Pota 설치본.
- Stable roadmap: `triage-plan` → `release-prepare` → `dev-pr` → `main-pr` → `publish-reinstall-smoke` → `final-verify`.

## Memory Inputs

- `MEMORY.md`
- release 관련 `docs/memory/*.md`가 있으면 triage에서 필요한 항목만 읽습니다.

## Complexity Triage

- Selected path: Heavy Path.
- Rationale: GitHub 병합, npm publish, 사용자 홈 재설치라는 비가역·외부 상태 변경과 교차 버전 lifecycle 검증이 포함됩니다.
- Heavy Path signals:
  - External API/state: GitHub PR·merge와 npm registry publish.
  - Transaction/cache boundary: 사용자 홈의 legacy 0.2.2 ownership adoption과 versioned runtime upgrade.
  - Cross-domain change: package metadata, lifecycle fixtures, CI, release plan, GitHub/npm 상태.
  - Extra care: 사용자가 dev→main→publish→reinstall/smoke 순서를 명시했습니다.
- Checked but absent: DB schema, authentication product logic, payment/message queue, 새 architecture layer.

## Agent Assignments

- Main agent: orchestration, 외부 상태 변경, repository goal/evidence, 최종 승인.
- Explorer/reviewer: release 상태와 계획의 read-only 검토.
- Worker: release metadata의 bounded 변경이 필요할 때만 담당.

## Tool Readiness

- Required: git, GitHub connected app, Node/npm, npm publish authentication, repository checks.
- Available: Node 26.5.0, 시스템 npm 12.0.0, 릴리스용 npm 10.9.8, git, Codex GitHub app.
- GitHub: 로컬 `gh` 토큰은 만료됐지만 GitHub app의 read/create/merge 경로가 정상입니다. push는 git credential을 dry-run으로 확인합니다.
- npm: `npm whoami`는 `wonkyoo.nam`, registry latest는 0.2.2입니다. 이전 sigstore 문제를 피하기 위해 `/private/tmp/pota-npm-runtime/node_modules/npm/bin/npm-cli.js`의 npm 10.9.8을 pack/publish에 사용합니다.
- Installation: 새 도구 설치는 하지 않습니다.

## Execution Guardrails

- worktree 전체가 이번 릴리스 범위인지 diff로 확인한 뒤 명시적으로 stage합니다.
- publish 전에 full check, `npm pack --dry-run --json`, `npm publish --dry-run`을 수행합니다.
- dev PR 병합이 확인된 뒤에만 main PR을 만들고, main 병합이 확인된 뒤에만 npm publish합니다.
- registry에 0.2.3이 확인된 뒤 npm 산출물만 사용해 격리 upgrade smoke를 수행합니다.
- 사용자 홈 재설치는 smoke 성공 뒤 실행하며 기존 custom lifecycle의 ownership/conflict 검사를 우회하지 않습니다.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Contract: branch/remote/auth/npm/version/release 정책과 현재 diff 범위를 확인해 실행 순서와 중단 조건을 확정합니다.
- Required evidence: `planArtifact`, `triageDecision`.

### Task 1: release metadata and artifact preparation

- Task ID: `release-prepare`
- Initial status: `pending`
- Contract: 0.2.3 version metadata와 release artifact를 준비하고 전체 검사·pack/publish dry-run을 통과합니다.
- Files: `package.json`, `.codex-plugin/plugin.json`, current-version assertion tests, `.github/workflows/ci.yml`, `test/lifecycle-transaction.test.mjs`.
- Invariants:
  - `scripts/release-integrity-0.2.2.json`과 production legacy adoption version은 0.2.2로 유지합니다.
  - current release/runtime expectation만 0.2.3으로 올립니다.
  - legacy fixture는 변하는 `HEAD`가 아니라 실제 0.2.2 publish main SHA `521782bf37dd0ab269a14caf7b19660c33243018`에서 재구성합니다. `.github/workflows/ci.yml`의 checkout은 `fetch-depth: 0`으로 해당 고정 commit을 반드시 읽을 수 있어야 하며, helper는 commit이 없으면 명시적으로 실패합니다.
- Tests: `npm run check`, `git diff --check`.
- Module acceptance: 두 manifest 0.2.3, 전체 104개 이상 테스트 통과.
- Surface integration: npm 10.9.8의 정상 `pack --dry-run --json`과 `publish --dry-run --access public --tag latest` 성공.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 2: dev pull request

- Task ID: `dev-pr`
- Initial status: `pending`
- Contract: scoped commit을 push하고 dev 대상 PR을 생성·검증·병합합니다.
- Branch: `codex/release-0.2.3-harness-reliability`, base `dev`.
- Dry-run: explicit staged diff, `git push --dry-run`, GitHub compare.
- Module acceptance: PR head/base와 3 OS × Node 18/current checks 성공.
- Surface integration: 동일 head SHA에 연결된 3 OS × Node 18/current 6개 check가 모두 success인지 확인하고 merge 직전에 PR head SHA 불변을 재검사한 뒤 expected head SHA를 고정해 merge하며 remote dev 포함 관계를 확인합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: main pull request

- Task ID: `main-pr`
- Initial status: `pending`
- Contract: dev의 검증된 0.2.3 변경만 main으로 승격하는 PR을 생성·검증·병합합니다.
- Dry-run: GitHub `dev...main` compare에서 의도한 release diff만 확인.
- Module acceptance: dev→main PR head/base와 CI 성공.
- Surface integration: 동일 dev head SHA에 연결된 6개 check가 모두 success인지 확인하고 merge 직전에 head 불변을 재검사한 뒤 expected dev SHA를 고정해 merge하며 remote main 포함 관계를 확인합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 4: npm publish, reinstall, and upgrade smoke

- Task ID: `publish-reinstall-smoke`
- Initial status: `pending`
- Contract: main SHA에서 npm 0.2.3을 게시·확인하고 npm 산출물로 격리 upgrade smoke 후 사용자 홈을 재설치합니다.
- Publish invariant:
  - clean `origin/main` SHA에서 두 manifest 0.2.3과 registry의 0.2.3 부재를 재확인합니다.
  - npm 10.9.8로 실제 `npm pack --json` tarball을 한 번 만들고 SHA-512 integrity와 SHA-1 shasum을 기록합니다.
  - 그 동일 `.tgz`에 `npm publish --dry-run --access public --tag latest`를 수행한 뒤 동일 파일을 실제 publish합니다. 작업 디렉터리를 다시 pack해 게시하지 않습니다.
  - publish 응답 손실·timeout·모호한 실패가 발생하면 `npm view @comento/pota-harness@0.2.3 dist --json`을 먼저 조회합니다. registry integrity/shasum이 고정 tarball과 정확히 같으면 성공으로 판정하고, 버전이 없거나 digest가 다르면 중단합니다. blind retry는 금지합니다.
- Registry verification: version/latest/dist tarball이 모두 0.2.3을 가리켜야 합니다.
- Isolated smoke:
  1. registry에서 `@comento/pota-harness@0.2.2`를 임시 prefix에 설치하고 격리 HOME에 legacy install.
  2. 같은 prefix를 registry `@comento/pota-harness@0.2.3`으로 재설치하고 `pota upgrade` 실행.
  3. ownership/versioned runtime이 0.2.3이고 이전 runtime이 제거되며 `doctor`가 성공하는지 확인.
- User-home apply:
  - 적용 전 시스템 npm의 active global prefix, `command -v pota`, symlink target, global package root/version을 확정합니다. 현재 관측값은 prefix `/opt/homebrew`, CLI `/opt/homebrew/bin/pota`, package `/opt/homebrew/lib/node_modules/@comento/pota-harness@0.2.2`입니다.
  - global package/version, Pota ownership·managed target inventory, config와 legacy/custom cache·mirror 경로를 임시 backup root에 보존하고 backup digest를 확인합니다.
  - 격리 smoke 성공 후 npm 10.9.8에 확인된 active prefix를 `--prefix <active-prefix>`로 명시하여 `npm install -g @comento/pota-harness@0.2.3`을 실행합니다. 설치 후 `command -v pota`, symlink target, package manifest가 같은 prefix의 0.2.3인지 확인한 뒤 새 CLI의 `pota upgrade`, `pota doctor` 순으로 실행합니다. ownership conflict는 우회하지 않습니다.
  - global install이 실패하면 실제 active prefix의 CLI target/package version을 다시 확인합니다. 변경이나 손상이 있으면 같은 prefix에 registry 0.2.2 복원을 한 번 시도하고 검증한 뒤 중단하며, home lifecycle은 실행하지 않습니다. `pota upgrade`가 실패하면 transaction이 기존 home digest를 복원했는지 확인하고 동일 prefix의 global package를 registry 0.2.2로 되돌립니다.
  - upgrade가 성공했지만 doctor만 실패하면 ownership/digest와 Codex/Antigravity 진단을 한 번 수행합니다. managed state가 일관되면 0.2.3을 보존하고 goal을 blocked로 기록하며, 불일치면 backup을 보존한 채 자동 파괴적 복원을 하지 않고 중단합니다.
  - 모든 검증이 성공한 뒤에만 backup을 정리하며, 실패 시 recovery artifact 위치를 보고합니다.
- Tests: registry version/dist 확인, isolated npm artifact smoke, 실제 사용자 홈 doctor.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 5: final verification and review

- Task ID: `final-verify`
- Initial status: `pending`
- Contract: GitHub, npm registry, 설치본 0.2.3과 doctor 상태를 재확인하고 독립 리뷰 뒤 goal을 완료합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

## Evidence

- Tool readiness: Node 26.5.0, 릴리스용 npm 10.9.8, git push credential, GitHub app, npm 계정 `wonkyoo.nam`을 확인했습니다. 만료된 `gh` CLI 토큰 대신 GitHub app의 PR/merge/check 경로를 사용했습니다.
- Local/package gates: 최종 `npm run check` 106/106, `git diff --check`, clean main `npm pack --json`, 동일 tarball `npm publish --dry-run`이 성공했습니다.
- Windows portability gates: CI에서 발견한 filtered copy, transient lock, PATHEXT, CRLF, lifecycle lock budget 문제를 각각 bounded 수정·focused test·독립 리뷰로 닫았습니다. 최종 release head `2c2ff7c9ed82bbf0a137d943492ad53aa6d20f99`의 CI run 74가 3 OS × Node 18/current 6/6 성공했습니다.
- GitHub PRs: release→dev [#43](https://github.com/comento/pota-harness/pull/43)은 merge commit `9c78b05338b5f7755831a4b66dc4c651658736d7`, dev→main [#44](https://github.com/comento/pota-harness/pull/44)는 merge commit `fad37a01796f4f5372d3ef4b0e43c0801ed63ecc`입니다. PR #44의 CI run 75도 동일 6/6 성공했습니다.
- npm publish: clean main `fad37a01796f4f5372d3ef4b0e43c0801ed63ecc`에서 만든 `comento-pota-harness-0.2.3.tgz` 99,146 bytes를 dry-run과 실제 publish에 동일하게 사용했습니다. Registry `latest=0.2.3`, shasum `e6d28e34a90fb976e5869b0d077ac9edb6bce0e1`, integrity `sha512-wVzDuChtHuejPkYdSYjdVcvR19P6pOd/IXtX7DGywp5KYZBVR/k22EQmc7HcziW0raK6V6nkjlHv5tPf/l5oRw==`가 고정 tarball과 일치합니다.
- Isolated smoke: registry 0.2.2를 격리 prefix에 설치해 legacy tree를 만든 뒤 같은 prefix를 registry 0.2.3으로 재설치했습니다. `pota upgrade`가 ownership 0.2.3과 44개 target을 만들고 이전 runtime을 제거했으며 `pota doctor`가 전 항목 성공했습니다.
- User-home apply: `/opt/homebrew` global package를 npm 0.2.3으로 재설치한 뒤 실제 legacy home을 transactionally upgrade했습니다. package/source/runtime/ownership이 모두 0.2.3이고 이전 runtime은 없으며 `pota doctor` 전 항목이 성공했습니다. 적용 전 backup은 `/private/tmp/pota-actual-backup-023.x3MH30/pre-upgrade.tgz`에 만들고 SHA-256 `f16c8b31d9c0364c7142207626c1c03b7d78d49e1a73fbaf2f10b9b731c6da9f`를 확인했습니다.
- Goal final review: 독립 리뷰가 GitHub, npm registry, 격리 smoke, 실제 설치본, backup과 tool-bound receipt를 대조했으며 correctness·scope·evidence finding 없이 승인했습니다.

## Status

- [x] Initial triage plan created
- [x] Planned
- [x] Release prepared
- [x] dev PR merged
- [x] main PR merged
- [x] npm 0.2.3 published
- [x] npm reinstall and upgrade smoke passed
- [x] Reviewed and completed
