# 계획: Pota 0.2.1 goal 작업 컨텍스트 릴리스

## 목표

goal을 명시하지 않은 구현 요청에도 Pota goal 생성을 안내하고, 활성 goal의 전체 순서형 task roadmap과 현재 작업·복귀 지침을 모델 컨텍스트에 제공하는 변경을 `@comento/pota-harness@0.2.1`로 배포합니다. 릴리스 브랜치를 `dev`에 PR로 병합하고, 이어서 `dev`를 `main`에 PR로 병합한 뒤 npm `latest`가 `0.2.1`을 가리키는지 확인합니다.

## 전체 작업

- 결과:
  - `package.json`과 플러그인 manifest가 `0.2.1`로 정렬됩니다.
  - 자동 goal 생성 지침과 task roadmap 컨텍스트의 영문·한국어 및 실제 패키지 설치 경로 검증이 성공합니다.
  - `codex/release-0.2.1-goal-task-context`가 `dev`에 병합됩니다.
  - `dev`가 `main`에 병합됩니다.
  - npm `@comento/pota-harness@latest`가 `0.2.1`을 반환합니다.
- 영향 표면:
  - hook 런타임, lifecycle 정책, 모델 가이드, 문서와 테스트
  - 로컬 버전 메타데이터와 릴리스 계획
  - GitHub release/dev/main 브랜치와 PR
  - npm `@comento/pota-harness` 패키지와 `latest` dist-tag
- 안정 ID:
  - goal: `release-0.2.1-goal-task-context`
  - task `release-prepare`: 버전 정렬 및 릴리스 검증
  - task `merge-dev`: release 브랜치를 `dev`에 PR 병합
  - task `merge-main-publish`: `dev`를 `main`에 PR 병합하고 npm 게시·확인
- 터미널 상태: 모든 task와 최종 검토 증거가 성공하면 완료합니다. 계속할 수 없으면 구체적 이유와 함께 blocked 또는 cancelled로 기록합니다.

## 메모리 입력

- `MEMORY.md`
- 별도 관련 `docs/memory/*.md` 없음.

## 모델 가이드

- 적용 모델 계열: Codex.
- 참조: `docs/model-guidance/README.md`와 현재 Codex 지침.
- 근거: 명령 기반 검증, GitHub PR 병합, npm 외부 상태 변경이 핵심입니다.
- 역할 조정: 상위 지침에 따라 이번 턴에는 subagent를 추가 생성하지 않고 주 세션이 릴리스 작업을 직접 수행합니다.
- 산출물 언어: 한국어.

## 복잡도 트리아지

- 선택 경로: Heavy Path.
- 근거: GitHub와 npm 외부 상태를 변경하며 두 보호 브랜치 병합을 포함합니다.
- 확인한 Heavy Path 신호:
  - 새 디렉터리/모듈/계층: 아니오.
  - 새 도메인 모델/서비스/추상화: 아니오.
  - 보안/인증/세션: 아니오.
  - 외부 API/메시지 큐/결제: 예 — GitHub와 npm.
  - DB 스키마/마이그레이션: 아니오.
  - 동시성/트랜잭션/캐시 무효화: 아니오.
  - 도메인 간 리팩터링: 아니오.
  - 명시적 extra-care: 예 — 사용자가 버전 배포와 두 PR 병합을 함께 요청함.
- 구현 전 결정:
  - 기존 관례대로 release → `dev` → `main` 순서로 병합한 후 npm에 게시합니다.
  - 실제 publish 전에 `npm run check`, `npm pack --dry-run`, `npm publish --dry-run`을 통과시킵니다.
  - PR 필수 검사가 성공한 뒤 merge commit 방식으로 병합합니다.
  - 이 릴리스 범위 밖의 리팩터링과 marketplace 변경은 포함하지 않습니다.

## 도구 준비 상태

- 감지 스택: JavaScript/Node.js.
- 설치본 Pota toolcheck: 통과.
- GitHub: `gh 2.96.0`, `dspaudio`로 인증됨.
- npm: `wonkyoo.nam`으로 인증됨. 작업 시작 시 `latest`는 `0.2.0`.
- 필수 검증 도구: Node.js, npm, git, gh. 누락 없음.
- 설치 시도와 blocker: 없음.

## 실행 가드레일

- 외부 변경 전 검사: `npm run check`, `npm pack --dry-run`, `npm publish --dry-run`, PR check 상태 조회.
- 완전한 dry-run이 없는 동작: PR merge와 실제 `npm publish`; 직전 상태와 인증, 검사 결과를 다시 확인합니다.
- 검증 예산: task당 기본 두 번. 실패하면 한 번 진단·수정하고 재검증하며 두 번 실패하면 blocked로 기록합니다.

## 작업 단계

### Task `release-prepare`: 버전 정렬과 패키지 검증

- 계약: 두 manifest가 `0.2.1`이고 실제 배포물에 goal/task 컨텍스트 변경이 포함되며 모든 테스트가 성공합니다.
- 파일: `package.json`, `.codex-plugin/plugin.json`, `PLAN.md`, 이 계획과 현재 하네스 변경 전체.
- dry-run/check: `npm run check`, `npm pack --dry-run`, `npm publish --dry-run`.
- Tests: `npm test`와 패키지 설치 E2E.
- 모듈 수용: `npm run check`.
- 표면 통합: `npm pack --dry-run`과 `npm publish --dry-run`.
- 필수 receipt: `moduleAcceptance`, `surfaceIntegration`.

### Task `merge-dev`: release PR을 dev에 병합

- 계약: 범위가 확인된 commit이 release 브랜치에 push되고, `dev` 대상 PR 필수 검사가 성공한 뒤 병합됩니다.
- dry-run/check: `git diff --check`, `gh pr checks`.
- Tests: Task `release-prepare`의 검증 결과.
- 모듈 수용: PR merge 상태와 `origin/dev` 포함 관계 확인.
- 표면 통합: `gh pr view --json state,mergedAt,mergeCommit`.
- 필수 receipt: `moduleAcceptance`, `surfaceIntegration`.

### Task `merge-main-publish`: main 병합과 npm 게시

- 계약: `dev` → `main` PR이 필수 검사 후 병합되고, 병합된 소스의 `@comento/pota-harness@0.2.1`이 npm `latest`로 게시됩니다.
- dry-run/check: `gh pr checks`, `npm publish --dry-run`.
- Tests: `npm run check`.
- 모듈 수용: main PR merge 상태와 `origin/main` 포함 관계 확인.
- 표면 통합: `npm view @comento/pota-harness version dist-tags --json`에서 version/latest 모두 `0.2.1`.
- 필수 receipt: `moduleAcceptance`, `surfaceIntegration`.

## 증거

- Dry-run/check: `git diff --check`, `npm --cache /private/tmp/pota-npm-cache run check`, `npm --cache /private/tmp/pota-npm-cache pack --dry-run` 통과.
- Tests: 전체 35/35 통과. pack과 publish dry-run의 prepack에서도 각각 35/35 통과.
- 모듈 수용: 두 manifest의 `0.2.1` 정렬과 `npm run check` 성공을 확인.
- 표면 통합: 실제 배포 파일 62개를 포함한 `@comento/pota-harness@0.2.1` pack dry-run과 npm 게시 dry-run 통과.
- 도구 진단: Homebrew npm 12.0.0은 누락된 `sigstore` 내부 모듈로 publish dry-run이 실패했습니다. 시스템을 변경하지 않고 `/private/tmp`에 npm 10.9.8을 설치해 동일 명령을 성공적으로 검증했습니다.
- PR/npm 외부 상태:
  - PR #35: Ubuntu·Windows CI 통과, `dev`에 merge commit `710d33729316ff67bc031574fbe30b009c2e716d`로 병합.
  - PR #36: Ubuntu·Windows CI 통과, `main`에 merge commit `da39509808281826c8a467946fe2b92c7e269d4c`로 병합.
  - npm: `@comento/pota-harness@0.2.1` 공개 게시 후 registry의 `version`과 `latest`가 모두 `0.2.1`임을 확인.
- 최종 검토: release commit의 `origin/dev` 포함 관계, dev merge commit의 `origin/main` 포함 관계, clean main, 전체 35/35 테스트, pack/publish dry-run, npm latest를 재확인하고 goal `goal-2a56bb23-9696-4b4a-91d7-d87c6cf5eff5`을 완료했습니다.
- 두 번 실패 뒤 blocker: 없음.

## 상태

- [x] 계획 완료
- [x] 도구 준비 확인
- [x] 릴리스 준비 검증 완료
- [x] dev PR 병합 완료
- [x] main PR 병합 완료
- [x] npm 0.2.1 게시 확인
