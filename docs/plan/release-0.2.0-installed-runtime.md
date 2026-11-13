# 계획: Pota 0.2.0 설치본 런타임 릴리스

## 목표

설치본 경로 독립성, 영속 goal/task/receipt 완료 게이트, 안전한 toolcheck 변경을 `@comento/pota-harness@0.2.0`으로 배포합니다. 릴리스 브랜치를 `dev`에 PR로 병합하고, 이어서 `dev`를 `main`에 PR로 병합한 뒤 npm `latest`가 `0.2.0`을 가리키는지 확인합니다.

## 전체 작업

- 결과:
  - `package.json`과 플러그인 manifest가 `0.2.0`으로 정렬됩니다.
  - 실제 npm 배포물로 설치본 독립 실행 E2E와 전체 검증을 통과합니다.
  - `codex/release-0.2.0-installed-runtime`가 `dev`에 병합됩니다.
  - `dev`가 `main`에 병합됩니다.
  - npm `@comento/pota-harness@latest`가 `0.2.0`을 반환합니다.
- 영향 표면:
  - 로컬 버전 메타데이터와 릴리스 계획
  - GitHub release/dev/main 브랜치와 PR
  - npm `@comento/pota-harness` 패키지와 `latest` dist-tag
- 안정 ID:
  - goal: `release-0.2.0-installed-runtime`
  - task `release-prepare`: 버전 정렬 및 릴리스 검증
  - task `merge-dev`: release 브랜치를 `dev`에 PR 병합
  - task `merge-main-publish`: `dev`를 `main`에 PR 병합하고 npm 게시·확인
- 터미널 상태: 모든 task와 최종 검토 증거가 성공하면 완료. 계속할 수 없으면 구체적 이유와 함께 blocked 또는 cancelled.

## 메모리 입력

- `MEMORY.md`
- 별도 관련 `docs/memory/*.md` 없음.

## 모델 가이드

- 적용 모델 계열: Codex.
- 참조: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/codex.md`.
- 근거: 명령 기반 검증, GitHub PR 병합, npm 외부 상태 변경이 핵심입니다.
- 역할 조정: 개발자 지침에 따라 이번 턴에는 subagent를 추가로 생성하지 않고 주 세션이 릴리스 작업을 직접 수행합니다.
- 산출물 언어: 한국어.

## 복잡도 트리아지

- 선택 경로: Heavy Path.
- 근거: GitHub와 npm 외부 상태를 비가역적으로 변경하며 두 보호 브랜치 병합을 포함합니다.
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
  - PR은 Ubuntu/Windows 필수 검사가 성공한 뒤 merge commit 방식으로 병합합니다.
  - 공식 marketplace lifecycle 전환은 이 릴리스에 포함하지 않습니다.

## 도구 준비 상태

- 감지 스택: JavaScript/Node.js.
- toolcheck: `node scripts/pota.mjs toolcheck --json --root .` 통과.
- GitHub: `gh 2.96.0`, `dspaudio`로 인증됨.
- npm: `wonkyoo.nam`으로 인증됨. 작업 시작 시 `latest`는 `0.1.11`.
- 필수 검증 도구: Node.js, npm, git, gh. 누락 없음.
- 설치 시도와 blocker: 없음.

## 실행 가드레일

- 외부 변경 전 검사: `npm run check`, `npm pack --dry-run`, `npm publish --dry-run`, PR check 상태 조회.
- 완전한 dry-run이 없는 동작: PR merge와 실제 `npm publish`; 직전 상태와 인증, 검사 결과를 다시 확인합니다.
- 검증 예산: task당 기본 두 번. 실패하면 한 번 진단·수정하고 재검증하며 두 번 실패하면 blocked로 기록합니다.

## 모듈 작업

### Task `release-prepare`: 버전 정렬과 패키지 검증

- 계약: 두 manifest가 `0.2.0`이고 실제 배포물에 설치본 런타임 변경이 포함되며 모든 테스트가 성공합니다.
- 파일: `package.json`, `.codex-plugin/plugin.json`, `PLAN.md`, 이 계획과 현재 하네스 변경 전체.
- dry-run/check: `npm run check && npm pack --dry-run && npm publish --dry-run`.
- Tests: `npm test`.
- 모듈 수용: `npm run check`.
- 표면 통합: `npm pack --dry-run && npm publish --dry-run`.
- 필수 receipt: `moduleAcceptance`, `surfaceIntegration`.

### Task `merge-dev`: release PR을 dev에 병합

- 계약: 범위가 확인된 commit이 release 브랜치에 push되고, `dev` 대상 PR 필수 검사가 성공한 뒤 병합됩니다.
- dry-run/check: `git diff --check`, `gh pr checks`.
- Tests: Task `release-prepare`의 검증 결과.
- 모듈 수용: PR merge 상태와 `origin/dev` 포함 관계 확인.
- 표면 통합: `gh pr view --json state,mergedAt,mergeCommit`.
- 필수 receipt: `moduleAcceptance`, `surfaceIntegration`.

### Task `merge-main-publish`: main 병합과 npm 게시

- 계약: `dev` → `main` PR이 필수 검사 후 병합되고, 병합된 소스의 `@comento/pota-harness@0.2.0`이 npm `latest`로 게시됩니다.
- dry-run/check: `gh pr checks`, `npm publish --dry-run`.
- Tests: `npm run check`.
- 모듈 수용: main PR merge 상태와 `origin/main` 포함 관계 확인.
- 표면 통합: `npm view @comento/pota-harness version dist-tags --json`에서 version/latest 모두 `0.2.0`.
- 필수 receipt: `moduleAcceptance`, `surfaceIntegration`.

## 증거

- Dry-run/check:
  - `npm run check`: syntax/JSON 검사와 전체 테스트 33/33 통과.
  - `npm pack --dry-run`: `@comento/pota-harness@0.2.0`, 62개 파일, prepack 전체 테스트 33/33 통과.
  - Homebrew npm 12.0.0의 누락된 `sigstore` 내부 모듈 때문에 첫 publish dry-run이 실패함. 새 설치 없이 기존 로컬 캐시의 완전한 npm 10.9.8을 사용해 `npm publish --dry-run`을 통과함.
- 릴리스 준비 중 발견한 CLI 결함: receipt의 `--exit-code`를 camelCase 옵션으로만 읽던 문제를 수정하고 kebab-case 회귀 테스트를 추가함.
- PR #33 첫 Windows CI에서 다른 드라이브의 Node PATH를 저장소 내부로 오판한 containment 결함과 세 건의 Windows 테스트 실행/경로 가정을 발견함. 플랫폼별 path API, `.cmd` shell 실행, cross-drive 회귀 검증으로 수정함.
- PR #33 두 번째 Windows CI에서는 E2E 준비용 npm prefix의 공백이 `npm.cmd` shell 인자에서 분리되는 별도 fixture 결함만 남음. 실제 검증 대상인 Codex 설치 경로와 프로젝트 경로의 공백은 유지하고 npm prefix만 공백 없는 fixture 이름으로 분리함.
- PR #33 세 번째 Windows CI에서는 설치된 npm 패키지 경로의 상위 `node_modules`까지 복사 제외 대상으로 해석해 플러그인 내용 전체가 누락됨. 복사 필터를 전체 상대 경로가 아닌 현재 항목 이름 기준으로 바꾸고, 상위 경로에 `node_modules`가 포함된 Windows 회귀 검증을 추가함.
- 도구 준비: Node.js 정상, GitHub `dspaudio`, npm `wonkyoo.nam`, npm latest `0.1.11` 확인.
- Tests: `npm test` 33/33 통과. pack과 publish dry-run의 prepack에서도 각각 33/33 통과.
- 모듈 수용: `npm run check` 통과, `package.json`과 `.codex-plugin/plugin.json` 모두 `0.2.0` 확인.
- 표면 통합: 실제 배포 파일 목록을 사용하는 `npm pack --dry-run`과 인증된 npm 10.9.8의 `npm publish --dry-run` 통과.
- PR/npm 외부 상태: 실행 후 최종 응답과 GitHub/npm 상태로 확인.
- 두 번 실패 뒤 blocker: 없음.

## 상태

- [x] 계획 완료
- [x] 도구 준비 확인
- [x] 릴리스 준비 검증 완료
- [ ] dev PR 병합 완료
- [ ] main PR 병합 완료
- [ ] npm 0.2.0 게시 확인
