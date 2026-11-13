# 계획: Pota 0.2.2 릴리스

## 계획 단계

- 현재 단계: 완료. dev/main 병합과 npm 게시·registry 확인까지 끝났습니다.
- UI 동기화: Codex UI plan과 goal을 먼저 생성했습니다.
- 최종 동기화: 모든 repository task의 tool-bound evidence를 확인한 뒤 UI plan과 goal을 완료합니다.

## 목표

현재 Pota 변경사항을 `0.2.2`로 준비하고 검증한 뒤, 릴리스 브랜치에서 `dev` 대상 PR을 병합하고 `dev`에서 `main` 대상 PR을 병합한 다음 npm registry에 `@comento/pota-harness@0.2.2`를 게시합니다.

- Goal ID: `goal-release-0.2.2`
- Plan ID: `docs/plan/release-0.2.2.md`
- 완료 기준:
  - 배포 대상 변경과 버전 산출물이 `0.2.2`로 일치합니다.
  - 전체 검사와 실제 package dry-run이 통과합니다.
  - 릴리스 브랜치 → `dev` PR과 `dev` → `main` PR이 순서대로 검증·병합됩니다.
  - npm `latest`가 `@comento/pota-harness@0.2.2`를 가리키며 게시된 tarball을 조회할 수 있습니다.
- 필수 goal 증거: `finalReview`.
- 종료 상태: `completed`, `paused`, `blocked`, `cancelled` 중 하나.

## 초기 작업 순서

### Task 0: 릴리스 트리아지와 계획 확정

- Task ID: `task-release-triage`
- 초기 상태: `active`.
- 계약: 현재 브랜치와 worktree, 변경 범위, 기존 릴리스 관례, 원격 `dev`/`main`, GitHub/npm 인증, 버전 및 package lifecycle을 읽기 전용으로 확인해 실행·롤백 경계를 확정합니다.
- 필수 증거 기록: `planArtifact`, `triageDecision`.

### Task 1: 0.2.2 산출물 준비와 검증

- Task ID: `task-release-prepare`
- 초기 상태: `pending`.
- 계약: 버전 파일과 릴리스 문서를 `0.2.2`로 정렬하고 전체 검사·package dry-run을 통과합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task 2: dev PR 생성과 병합

- Task ID: `task-merge-dev`
- 초기 상태: `pending`.
- 계약: 의도한 변경만 커밋·push하고 `dev` 대상 PR의 검사 통과를 확인한 뒤 병합합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: main PR 생성과 병합

- Task ID: `task-merge-main`
- 초기 상태: `pending`.
- 계약: 갱신된 `dev`에서 `main` 대상 PR을 생성하고 검사 통과를 확인한 뒤 병합합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task 4: npm 게시와 최종 확인

- Task ID: `task-publish-npm`
- 초기 상태: `pending`.
- 계약: 병합된 `main`과 package 내용을 대조하고 `@comento/pota-harness@0.2.2`를 게시한 뒤 registry의 version, dist-tag, tarball을 확인합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

## 초기 경로 판정

- 예상 경로: Heavy Path.
- 근거: GitHub의 두 순차 PR 병합과 npm 공개 게시라는 외부 상태 변경을 포함하며, 각 단계가 다음 단계의 불변 입력입니다.
- 외부 변경 전 dry-run/check: `npm run check`, lifecycle 분류, `npm pack --dry-run`, PR checks, `npm view`.
- 위임: 상위 정책상 사용자가 subagent를 명시하지 않았으므로 주 세션이 직접 수행합니다.

## 트리아지 결과와 실행 계약

### 상태와 인증

- 기준 브랜치: 로컬 `main`과 `origin/main`은 `bb29888`로 일치합니다. 현재 변경은 아직 커밋되지 않았으며 이번 릴리스 범위 전체입니다.
- 원격 관계: `origin/main`은 `origin/dev`보다 merge commit 4개 앞서고 `origin/dev`만의 커밋은 없습니다. `main`에서 만든 릴리스 브랜치를 `dev`에 먼저 병합하면 dev가 누락된 main 이력도 함께 따라잡습니다.
- 릴리스 브랜치: `codex/release-0.2.2-token-efficient-evidence`.
- 열린 PR: 없음.
- GitHub: 로컬 `gh` 토큰은 만료됐지만 설치된 GitHub 연결 앱에서 repository/PR 조회·생성·병합 권한을 확인했습니다. git fetch는 성공했으며 push는 릴리스 브랜치 생성 뒤 확인합니다.
- npm: `npm whoami`는 `wonkyoo.nam`, registry의 `version`과 `latest`는 모두 `0.2.1`입니다.
- npm runtime: 시스템 npm `12.0.0`은 이전 릴리스에서 `sigstore` 내부 모듈 누락이 확인됐으므로, 설치 없이 기존 `/private/tmp/pota-npm-runtime/node_modules/npm/bin/npm-cli.js`의 npm `10.9.8`을 publish dry-run과 실제 publish에 사용합니다.

### 변경·버전·lifecycle

- 변경 범위: goal/UI 선행 계획, tool-bound evidence schema v2, inline CLI 호환성, bounded context, lifecycle 안전 정책, 8개 locale, 테스트와 관련 계획 문서.
- 버전 파일: `package.json`과 `.codex-plugin/plugin.json`의 `0.2.1`을 `0.2.2`로 함께 올립니다.
- package lifecycle: `prepack`은 `npm run check`만 실행하는 content-neutral 검증입니다. 릴리스 위험을 낮추기 위해 전체 검사 후에도 npm 10.9.8의 정상 `pack --dry-run`과 `publish --dry-run`을 실행해 실제 publish 경로를 검증합니다.

### 경로 판정

- 선택 경로: Heavy Path.
- 근거: GitHub의 두 순차 PR merge와 npm 공개 publish가 외부 상태를 변경하고, 각 단계의 head SHA와 검사 결과가 다음 단계의 입력입니다.
- Heavy Path 신호:
  - 새 디렉터리/계층: 릴리스 자체에는 없음.
  - 새 도메인 모델/서비스: 릴리스 대상 변경에 goal evidence schema v2가 포함됨.
  - 보안/인증/세션: 제품 변경에는 없음. GitHub/npm 게시 인증은 외부 실행 전제임.
  - 외부 API: GitHub와 npm 사용.
  - DB/마이그레이션/트랜잭션/캐시: 없음.
  - 도메인 간 변경: runtime, hooks, skills, locale docs, tests, package metadata를 포함.
  - extra-care: 사용자가 dev PR → main PR → npm 순서를 명시함.
- 위임 생략: 상위 정책이 명시적 요청 없는 subagent 생성을 금지하므로 주 세션이 구현·검증·외부 전이를 직접 수행합니다.

### 단계별 불변식과 검증

- `task-release-prepare`
  - 파일: 현재 변경 전체, `package.json`, `.codex-plugin/plugin.json`, 이 계획과 `PLAN.md`.
  - Module acceptance: 두 manifest가 `0.2.2`, `npm run check`, `git diff --check`.
  - Surface integration: npm 10.9.8의 `pack --dry-run`과 `publish --dry-run`이 `@comento/pota-harness@0.2.2`에 성공.
- `task-merge-dev`
  - 사전 검사: branch diff와 push SHA 확인, GitHub compare 결과 확인.
  - Module acceptance: release branch → `dev` PR의 head/base와 CI 성공.
  - Surface integration: expected head SHA를 고정한 merge 성공 및 merge SHA가 `origin/dev`에 포함됨.
- `task-merge-main`
  - 사전 검사: merge된 `dev`와 `main` compare, PR head SHA 확인.
  - Module acceptance: `dev` → `main` PR의 CI 성공.
  - Surface integration: expected head SHA를 고정한 merge 성공 및 merge SHA가 `origin/main`에 포함됨.
- `task-publish-npm`
  - 사전 검사: publish 직전 `origin/main` SHA, 두 manifest `0.2.2`, npm에 `0.2.2`가 아직 없음, publish dry-run 결과 재확인.
  - Module acceptance: 병합된 `main`에서 npm 10.9.8 `publish --access public --tag latest` 성공.
  - Surface integration: `npm view @comento/pota-harness@0.2.2 version dist --json`과 `npm view @comento/pota-harness dist-tags --json`에서 version/latest/tarball 확인.
- loop budget: 각 검증은 기본 2회 이내. CI 또는 registry 전파 대기는 동일 검증의 polling으로 취급하고 코드 변경 시에만 준비 게이트를 다시 실행합니다.
- 완전한 dry-run이 없는 작업: PR merge와 실제 npm publish. 직전 expected SHA, CI, registry 부재를 다시 확인한 뒤 수행합니다.

## 상태

- [x] 초기 UI plan/goal 생성
- [x] 초기 repository plan 작성
- [x] 릴리스 트리아지와 decision-complete 갱신
- [x] 0.2.2 준비·검증
- [x] dev PR 병합
- [x] main PR 병합
- [x] npm 게시·최종 확인

## 실행 증거

- Tests: npm 10.9.8로 `npm run check` 통과. Pota tool-bound 결과는 61줄, digest `sha256:70d18cc7603a8b43d49199e36e6c94e3c190d71d518ab2411d55b9a39fe35c54`입니다.
- Module acceptance: `package.json`과 `.codex-plugin/plugin.json`이 모두 `0.2.2`이고 `git diff --check`가 통과했습니다.
- Surface integration: 정상 `prepack`을 포함한 `npm pack --dry-run --json`과 `npm publish --dry-run --access public --tag latest`가 각각 성공했습니다. 결과 digest는 `sha256:00c99c5126c26e066a12701b0f83d19af13aa68630278f246c3f9a1c84966e79`, `sha256:c84b324b98f3df18f76ff2ce9cdbda08ddbe3250169fb9c56fd7446fceb40643`입니다.
- PR #39: head `b7690b1da0eabcb2be8f0ee9c4ff74bdecb71360`에서 Ubuntu·Windows CI 성공을 확인한 뒤 `dev`에 merge commit `a7496e52ccd786c6453dd6a416d2a9124c21122f`로 병합했습니다. fetch 후 release commit 포함 관계와 `origin/dev` head 일치를 확인했습니다.
- PR #40: `dev` head `a7496e52ccd786c6453dd6a416d2a9124c21122f`에서 새 CI run #65의 Ubuntu·Windows 성공을 확인한 뒤 `main`에 merge commit `521782bf37dd0ab269a14caf7b19660c33243018`로 병합했습니다. fetch 후 dev merge commit 포함 관계와 `origin/main` head 일치를 확인했습니다.
- npm: `origin/main@521782bf37dd0ab269a14caf7b19660c33243018`의 clean detached worktree에서 47/47 테스트, 62-file publish dry-run을 재확인하고 `@comento/pota-harness@0.2.2`를 `latest`로 게시했습니다. registry가 version/latest `0.2.2`, tarball `https://registry.npmjs.org/@comento/pota-harness/-/pota-harness-0.2.2.tgz`, shasum `063ad38c3e4212c6880088ee4bc3560a35926044`를 반환했습니다.
- 검증 실패와 blocker: 최초 실제 publish는 샌드박스 DNS `ENOTFOUND`로 종료됐습니다. 동일 main SHA에서 네트워크 권한을 명시적으로 승인받아 한 번 재실행했고 성공했습니다. 코드·패키지 검증 실패나 잔여 blocker는 없습니다.
