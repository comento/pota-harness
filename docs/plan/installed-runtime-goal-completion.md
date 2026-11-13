# 계획: 설치본 경로 독립성과 목표 완주 런타임

## 목표

현재 사용자 lifecycle 설치 방식을 유지하면서, Pota이 대상 프로젝트에 런타임 파일을 복사하거나 프로젝트의 `scripts/`, `commands/`, `docs/model-guidance/`, `templates/`를 잘못 찾지 않고 설치된 플러그인 폴더의 리소스를 사용하게 합니다. 장기 작업은 저장소별 활성 목표와 task 상태를 영속화하고, Codex `Stop` 계약으로 다음 미완료 task를 자동 재개하여 명시적인 완료·취소·일시정지·차단 상태 전에는 조용히 끝나지 않게 합니다.

## 전체 작업

- 결과:
  - 설치된 플러그인의 스크립트와 정적 리소스는 플러그인 루트 기준으로 해석됩니다.
  - 대상 저장소는 명시적 `--root`, hook payload의 `cwd`, 또는 저장소 탐색으로만 결정됩니다.
  - `SessionStart`와 `UserPromptSubmit`은 초기화되지 않은 저장소를 변경하지 않습니다.
  - 활성 목표·task·검증 receipt는 `.pota/` 아래에 원자적으로 기록되고 중단 후 재개됩니다.
  - `Stop`은 활성 목표의 현재 task만 검사하고, 미완료이면 공식 Codex `{ "decision": "block", "reason": "..." }` 계약으로 작업을 이어갑니다.
  - `SubagentStop`은 해당 에이전트에 배정된 task만 검사하며 전체 계획을 가로막지 않습니다.
  - 증거가 없거나 실패·skip·placeholder인 경우 완료를 허용하지 않습니다.
  - Claude·Antigravity 미러는 대상 프로젝트 상대경로가 아닌 설치된 Pota 런타임을 가리킵니다.
- 영향 표면:
  - CLI와 hook 런타임
  - 목표 상태와 계획/evidence 계약
  - Codex skills/commands, Claude commands/agents, Antigravity skills/workflows
  - lifecycle 설치·doctor의 설치본 경로 검증
  - toolcheck 안전 기본값과 테스트/패키징 E2E
- 작업 분류:
  - Task 1: 설치본 기준 경로 모델과 표면 어댑터
  - Task 2: 영속 목표 상태·scoped stop gate·구조화 evidence
  - Task 3: toolcheck 비변경 기본값과 위험 설치 경계
  - Task 4: 설치 tarball·중단 재개·회귀 통합 검증
- 명시적 제외:
  - 공식 marketplace 설치 방식으로 lifecycle을 교체하는 작업은 사용자의 요청에 따라 후속 작업으로 남깁니다.
  - 이번 변경은 기존 사용자 lifecycle의 설치 위치와 명령을 유지합니다.

## 메모리 입력

- `MEMORY.md`
- 현재 저장소에는 이 작업과 관련된 별도 `docs/memory/*.md` 링크가 없습니다.

## 모델 가이드

- 적용 모델 계열: Codex.
- 참조 문서:
  - `docs/model-guidance/README.md`
  - `docs/model-guidance/codex.md`
- 근거: CLI·hook·정책 표면을 함께 바꾸는 저장소 자동화 작업이며, 명시적 계약과 결정론적 테스트가 필요합니다.
- 역할별 조정: 읽기 전용 explorer가 hook 계약과 설치 경로 영향을 조사하고, 구현은 파일 소유권이 겹치지 않는 bounded worker에게 맡긴 뒤 주 세션이 통합 검토합니다.
- 사용자 응답과 산출물 언어: 한국어.

## 복잡도 트리아지

- 선택 경로: Heavy Path.
- 선택 근거: 새 경로/목표 상태 모듈과 버전드 런타임 상태 모델을 도입하고, CLI·hook·세 가지 설치 표면과 테스트를 횡단합니다.
- 확인한 Heavy Path 신호:
  - 새 디렉터리/모듈/계층: 예 — 공통 경로 모듈과 `.pota` 상태 계층.
  - 새 도메인 모델/서비스/추상화: 예 — goal/task/receipt 상태 모델.
  - 보안/인증/세션: 아니오.
  - 외부 API/메시지 큐/결제: 아니오.
  - DB 스키마/마이그레이션: 아니오.
  - 동시성/트랜잭션/캐시 무효화: 예 — 상태 파일 원자적 갱신과 중단 재개 일관성.
  - 도메인 간 리팩터링: 예 — lifecycle, hook, CLI, policy mirrors, tests.
  - 명시적 extra-care 신호: 예 — 기존 완주 실패와 설치 경로 오작동을 함께 바로잡아 달라는 요청.
- Heavy Path 트리거: 새 런타임 상태 모델, 원자적 상태 갱신, 다중 표면 계약 변경.
- 구현 전 결정:
  - 플러그인 루트는 `import.meta.url` 또는 설치 시 알려진 절대 런타임 경로에서만 구합니다.
  - 저장소 루트와 플러그인 루트를 분리하고, 저장소 안에는 런타임/정적 리소스를 복사하지 않습니다.
  - 목표 상태는 `.pota/state.json`, receipt/이벤트는 git 제외된 `.pota/` 로컬 데이터로 둡니다.
  - `Stop`/`SubagentStop`은 최신 공식 Codex Hooks 문서의 이벤트별 JSON 계약을 사용합니다.
  - 명시적 `pota init`/`pota goal start`만 파일을 생성하며 시작 hook은 읽기 전용입니다.
  - 공식 marketplace lifecycle 전환은 제외합니다.

## 에이전트 배정

- `goal_hook_design` explorer: 공식 hook 출력 계약, 목표 상태 머신, scoped gate 설계의 읽기 전용 조사.
- `plugin_path_design` explorer: 설치본 루트와 대상 저장소 루트 분리, 각 표면의 독립 실행 설계 조사.
- 목표 상태 worker: goal/task/receipt와 hook 처리 파일 및 전용 테스트.
- 설치 경로 worker: plugin/repository root, CLI/lifecycle 및 설치 표면 어댑터와 전용 테스트.
- toolcheck worker: 비변경 기본값, 명시적 설치 동의·timeout·버전 경계와 전용 테스트.
- 주 세션: 계획, 충돌 없는 작업 할당, 통합 검토, 패키지 설치 E2E, evidence 갱신.

## 도구 준비 상태

- 감지 스택: JavaScript, Node.js.
- toolcheck 명령: `node scripts/pota.mjs toolcheck --json` 통과.
- 필요한 LSP/심볼 도구: 이 저장소의 작은 ESM 모듈에는 필수 아님. `rg`와 Node import/export 계약으로 탐색합니다.
- 필요한 typecheck/lint/검증 도구: Node syntax check, `node --test`, `npm run check`, `npm pack`.
- 누락 도구: 없음.
- 설치/부트스트랩 시도: 없음. 이번 작업에서 toolcheck 자동 설치는 안전하지 않은 기존 동작으로 취급합니다.
- 도구 blocker: 없음.

## 실행 가드레일

- 외부 상태 변경 전 dry-run/check: 패키지 표면은 `npm pack --dry-run`; 실제 설치 검증은 격리된 임시 HOME/CODEX_HOME/CLAUDE_HOME/ANTIGRAVITY_HOME에서만 수행합니다.
- dry-run 미지원: 로컬 파일 변경 자체에는 별도 dry-run이 없으므로 작은 `apply_patch`와 테스트 fixture를 사용합니다.
- 검증 루프 예산: task당 기본 두 번.
- 실패 처리: 한 번 진단하고 task를 줄이거나 sub-task로 분할한 뒤 두 게이트를 재실행합니다. 두 번 실패하면 이 문서에 blocker를 기록합니다.

## 모듈 작업

### Task 1: 설치본 기준 경로와 표면 어댑터

- 계약: 플러그인 리소스는 설치본 루트에서, 대상 저장소 상태는 명시적으로 해석한 repo root에서만 접근합니다. 설치된 Claude/Antigravity 표면도 대상 프로젝트의 Pota 파일을 요구하지 않습니다.
- 하위 작업:
  - plugin root/repo root 공통 해석기
  - CLI `--root` 전달과 hook payload `cwd` 소비
  - lifecycle이 설치 시 절대 런타임 경로를 주입한 self-contained 미러 생성
  - doctor의 설치본 참조 유효성 검사
- 파일: `scripts/pota-paths.mjs`, `scripts/pota.mjs`, `scripts/pota-lifecycle.mjs`, `skills/**`, `commands/**`, `.claude/**`, `.agents/**`, 경로 전용 테스트.
- 의존성: Node 표준 라이브러리.
- 도구 준비 요구: `node scripts/pota.mjs toolcheck --json`.
- dry-run/check: 격리 HOME에서 `pota install` 전 lifecycle fixture 확인.
- 모듈 수용 검증: `node --test test/installed-plugin.test.mjs test/lifecycle.test.mjs`.
- 표면 통합 검증: tarball을 임시 prefix에 설치하고 임의 프로젝트 하위 cwd에서 설치본 CLI/스킬 참조 smoke test.

### Task 2: 목표 상태·scoped hook·구조화 evidence

- 계약: 활성 목표에는 정확히 하나의 현재 task가 있으며 상태 전이는 명시적입니다. completion receipt가 성공 명령, exit code 0, 시각, 작업/plan 식별자를 갖지 않으면 task와 goal을 완료할 수 없습니다. Stop은 활성 목표만 자동 재개하고, pause/block/cancel/complete 상태는 종료를 허용합니다.
- 하위 작업:
  - 버전드 goal/task/receipt 상태 스키마와 원자적 저장
  - `goal start/status/resume/pause/block/cancel/complete`, task/evidence 명령
  - Codex hook stdin/JSON stdout 어댑터
  - SubagentStop의 agent assignment 범위 제한
  - 시작 hook의 read-only 재개 context
- 파일: `scripts/pota-goal.mjs`, `scripts/pota-state.mjs`, `hooks/hooks.json`, `skills/pota-work/SKILL.md`, `commands/pota-work.md`, 계획 템플릿, 목표 상태 전용 테스트.
- 의존성: 최신 공식 Codex Hooks 이벤트 계약.
- 도구 준비 요구: Node.js.
- dry-run/check: fixture 상태를 읽는 `goal status --json`과 hook JSON snapshot.
- 모듈 수용 검증: `node --test test/goal-state.test.mjs`.
- 표면 통합 검증: 중단→새 SessionStart→Stop 자동 continuation→receipt→complete E2E.

### Task 3: toolcheck 안전 기본값

- 계약: 기본 toolcheck와 계획 단계는 읽기 전용입니다. 설치는 별도 명시 플래그와 고정/설정된 버전, timeout, 진단 가능한 결과가 있을 때만 실행되며 저장소 로컬 바이너리를 탐지 중 실행하지 않습니다.
- 하위 작업:
  - 탐지와 설치 분리
  - 명시적 동의와 timeout/result schema
  - unpinned/무체크섬 설치 경로 비활성화 또는 안전한 manifest 요구
- 파일: `scripts/pota-toolcheck.mjs`, `skills/pota-plan/SKILL.md`, 미러 정책, `test/toolcheck.test.mjs`.
- 의존성: Node 표준 child process.
- 도구 준비 요구: Node.js.
- dry-run/check: fixture 기반 `toolcheck --json`.
- 모듈 수용 검증: `node --test test/toolcheck.test.mjs`.
- 표면 통합 검증: `npm run check`에서 install 미동작/timeout/진단 contract 확인.

### Task 4: 패키지와 회귀 검증

- 계약: 저장소 원본이 아니라 실제 생성 tarball의 설치본으로 lifecycle, nested cwd, goal resume, negative evidence, mirror 참조를 검증합니다.
- 하위 작업:
  - `npm pack --json` 내용 검사
  - 임시 prefix/HOME 설치 E2E
  - 증거 없음, 실패/skip 증거, 무관한 과거 plan, 미배정 subagent negative fixture
- 파일: `test/**`, `package.json`, 필요 시 CI 검증 명령.
- 의존성: npm, Node test runner.
- 도구 준비 요구: Node.js와 npm.
- dry-run/check: `npm pack --dry-run`.
- 모듈 수용 검증: `npm test`.
- 표면 통합 검증: `npm run check && npm pack --dry-run` 및 임시 설치 E2E.

## 증거

- Dry-run/check: 구현 전 `node scripts/pota.mjs toolcheck --json` 통과. 외부 사용자 환경은 변경하지 않음.
- 도구 준비: JavaScript/Node 감지, Node runtime 정상.
- Tests: 최종 `npm test`에서 32/32 통과.
- 모듈 수용:
  - `node --test test/goal-state.test.mjs test/installed-plugin.test.mjs test/packed-install.test.mjs`: 15/15 통과.
  - 목표/task/receipt 상태 전이, 세션·subagent 범위, 중첩 cwd의 저장소 루트 탐색, 설치 미러의 런타임 locator를 검증함.
- 표면 통합:
  - `npm run check`: syntax/JSON 검사와 전체 테스트 32/32 통과.
  - `npm pack --dry-run`: prepack 전체 테스트 32/32 통과, 배포물 62개 파일에 `pota-goal.mjs`, `pota-paths.mjs`와 설치 표면이 포함됨.
  - 실제 tarball을 임시 npm prefix에 설치하고 원본 package source를 제거한 뒤, 설치 캐시만으로 임의 cwd의 lifecycle/init/goal/Stop/toolcheck가 동작함.
  - 대상 저장소에는 `MEMORY.md`, `PLAN.md`, `.pota/state.json`만 생성하며 플러그인의 `scripts/`, `templates/`, `docs/model-guidance/`를 복사하지 않음을 검증함.
  - toolcheck가 저장소 내부 심볼릭 링크를 따라 외부 경로나 순환 링크를 탐색하지 않음을 검증함.
- 검증 pass 수: 모듈 수용 1회 통과. 표면 통합 1차에서 상위 `npm pack --dry-run` 환경 상속 때문에 fixture tarball 생성이 생략되는 테스트 결함을 발견했고, 자식 pack의 dry-run 환경만 제거한 뒤 2차 통과.
- 두 번 실패 뒤 blocker: 없음.

## 상태

- [x] 계획 완료
- [x] dry-run/check 통과 또는 해당 없음 기록
- [x] 구현 완료
- [x] 모듈 수용 통과
- [x] 표면 통합 통과
- [x] 검토 완료
