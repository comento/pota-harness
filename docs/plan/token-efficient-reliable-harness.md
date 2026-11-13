# 계획: 토큰 효율과 신뢰성을 함께 보장하는 Pota 방법론

## 계획 단계

- 현재 단계: 완료.
- 초기 UI 동기화: `update_plan`으로 3단계 roadmap을 표시하고 `create_goal`과 저장소 goal을 시작했습니다.
- 완료 상태: 아래 테스트 설계와 Heavy Path 검토 결정에 따라 구현·검증·goal 전이를 마쳤습니다.

## 목표

Pota가 문제 없이 복귀·검증·완료되는 fail-closed 특성을 유지하면서, 에이전트가 매 턴 읽고 생성하고 반복하는 컨텍스트와 불필요한 검증을 줄이는 실행 방법론을 정의하고 하네스에 반영합니다.

- Goal ID: `goal-token-efficient-reliable-harness`
- Plan ID: `plan-token-efficient-reliable-harness`
- 완료 기준:
  - 토큰 비용을 유발하는 반복 표면과 신뢰성 불변식을 근거로 분류합니다.
  - 최소 컨텍스트·점진적 공개·증거 재사용·변경 위험 기반 검증 규칙이 일관된 정책으로 반영됩니다.
  - 토큰 절감 규칙이 goal/task 복귀와 fail-closed 증거 전환을 약화하지 않음을 자동 테스트로 검증합니다.
- 필수 goal 증거: `finalReview`.
- 종료 상태: `completed`, `paused`, `blocked`, `cancelled` 중 하나.

## 전체 작업

- 결과:
  - 매번 전체 지침을 반복하지 않고 현재 phase/task에 필요한 최소 컨텍스트만 노출합니다.
  - repository evidence와 이미 통과한 검증을 안전하게 재사용하되, 변경 뒤 stale evidence는 거부합니다.
  - Light/Heavy Path와 변경 표면에 비례해 탐색·위임·검증 예산을 정합니다.
  - 요약·상태 보고·계획 산출물은 짧은 색인과 상세 문서로 분리합니다.
- 영향 표면: `.codex-plugin/plugin.json`, `scripts/pota-state.mjs`, `scripts/pota-goal.mjs`, `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, 관련 command/model guidance/templates/README, goal/lifecycle/packed-install/token-efficiency 테스트.
- 상위 task: 비용/불변식 트리아지 → 테스트 계약 설계 → 최소 runtime·정책 구현 → 회귀·비용·패키지 검증.

## 토큰 효율 방법론

### 1. 테스트 계약 우선 배분

- 추론 토큰은 구현 코드 초안보다 요구사항, 불변식, 경계조건, 실패 모드와 executable test 설계에 우선 배분합니다.
- 구현은 먼저 실패하는 집중 테스트가 요구하는 최소 변경으로 제한합니다.
- 성공 판단은 모델의 설명이 아니라 테스트 도구의 exit code와 기계적 요약을 사용합니다.

### 2. 성공은 축약하고 실패만 확장

- 성공한 명령은 명령, exit code, 통과 개수 같은 짧은 증거만 기록합니다.
- 실패 시에만 실패한 test 이름, assertion, 관련 파일 범위로 컨텍스트를 확장합니다.
- 상태 변경 CLI는 `--quiet`를 사용해 성공할 때 전체 state JSON을 대화에 반환하지 않습니다.

### 3. Phase capsule과 점진적 공개

- 반복 hook은 현재 goal 제목, ordered roadmap, current task, 다음 전환 조건, 곁가지 질문 뒤 복귀점만 전달합니다.
- goal이 이미 active이면 goal 생성 지침을 반복하지 않습니다.
- `MEMORY.md`와 `PLAN.md`는 색인만 읽고, 현재 task가 직접 참조한 상세 문서만 추가로 읽습니다.

### 4. 검증 사다리와 신선도

- 순서: 설계된 집중 테스트 실패 확인 → 최소 구현 → 집중 테스트 → 변경 후 전체 검사 1회 → 전체 검사 뒤 변경이 없을 때 package content dry-run.
- package 검증 전 `prepack`, `prepare`, `prepublishOnly` 등 lifecycle script가 package content를 생성하는지 검사합니다. 기본값은 정상 `npm pack --dry-run`이며, content-producing이거나 분류하지 못한 script에는 `--ignore-scripts`를 사용하지 않습니다. script가 없거나 content-neutral임을 입증했고 직전 전체 검사가 여전히 유효할 때만 `--ignore-scripts`로 file list를 검증합니다.
- 검증 뒤 관련 파일이 바뀌면 해당 증거는 stale로 취급하고 영향 범위에 맞는 게이트를 다시 실행합니다.

### 5. 단계별 토큰 예산

- 계획·트리아지·테스트 설계: 높은 추론 예산을 허용합니다.
- 구현: 테스트 계약을 만족하는 bounded 최소 변경만 수행합니다.
- 검증·전환: 도구 결과를 권위 있는 판정으로 사용하고 사용자 보고는 요약합니다.
- 서브에이전트는 독립 조사나 분리된 구현이 실제로 중복 읽기보다 저렴할 때만 사용합니다.

## 메모리 입력

- `MEMORY.md`
- 현재 연결된 상세 memory 문서는 없음.

## 트리아지 결과와 구현 계약

### Task: 토큰 비용과 신뢰성 불변식 트리아지

- Task ID: `task-token-triage`
- 초기 상태: `active`
- 조사 범위:
  - hook이 goal 없음/있음 상태에서 주입하는 컨텍스트 크기와 반복 문장.
  - plugin default prompt, skill, command, model guidance 사이의 중복 규칙.
  - 계획 template과 실제 계획 산출물의 필수/중복 필드.
  - 전체 테스트와 집중 테스트가 중복 실행되는 흐름 및 안전한 증거 재사용 경계.
  - MEMORY/PLAN 색인과 상세 문서의 점진적 공개가 실제 지침에 반영된 정도.
- 판정 기준:
  - 새 상태 모델·캐시·해시 기반 증거 유효성 기능이 필요하면 Heavy Path 후보로 판정합니다.
  - 기존 문자열 formatter와 정책 정렬만으로 해결되면 Light Path로 판정합니다.
- toolcheck: 설치 runtime의 `toolcheck --root /Users/wknam/workspace/pota-harness`.
- 갱신 산출물: 비용원 목록, 반드시 보존할 신뢰성 불변식, 선택 경로, 구체 파일 범위, 검증 명령, 정량 기준.
- 필수 증거 기록: `planArtifact`, `triageDecision`.

### 측정된 비용원

- `.codex-plugin/plugin.json` default prompt: 4,390자.
- goal이 없는 `UserPromptSubmit` hook: 808자.
- 3단계 active goal hook: 1,273자, 7줄. active 상태에서도 초기 goal 생성 정책 808자 상당을 반복합니다.
- 핵심 계획/작업/prompt/runtime guidance 파일 9개의 합계: 92,840자.
- goal CLI의 상태 변경 명령은 성공할 때마다 전체 `.pota/state.json`을 stdout으로 출력하여 task와 증거 기록이 늘수록 출력 토큰이 선형 증가합니다.
- `npm pack --dry-run`은 `prepack`을 통해 직전 `npm run check` 전체 테스트를 다시 실행합니다.

### 반드시 보존할 신뢰성 불변식

- 초기 UI plan/goal과 저장소 goal은 트리아지 전에 생성됩니다.
- active goal hook은 전체 roadmap, current task와 side-question 복귀점을 유지합니다.
- missing/failed/stale evidence는 task나 goal을 완료하지 못합니다.
- 구현은 decision-complete 계획과 executable test 계약 뒤에만 시작합니다.
- UI 단계는 저장소 Pota의 증거 기반 전환 성공 뒤에만 동기화됩니다.

### Task: 토큰 효율 방법론과 하네스 구현

- Task ID: `task-token-policy`
- 초기 상태: `pending`
- 계약:
  - 새 token-efficiency 테스트를 먼저 작성해 반복 context와 default prompt의 문자 예산, active hook의 필수 정보, CLI quiet 동작을 executable contract로 만듭니다.
  - idle hook은 420자 이하, 3단계 active hook은 700자 이하를 목표로 하며 필수 불변식 문구는 유지합니다.
  - default prompt는 테스트 우선·도구 판정·실패 시 확장·UI 전환 안전성을 포함하면서 3,600자 이하로 줄입니다.
  - goal CLI `--quiet`는 옵션 위치와 무관하게 stdout을 억제하되 상태 변경과 오류 exit는 그대로 유지합니다.
  - plan/work/model guidance에 테스트 설계 우선 배분과 검증 사다리를 반영합니다.
- 하위 작업:
  - `task-token-tests`: 실패하는 비용·불변식 테스트를 먼저 추가.
  - `task-token-runtime`: compact phase capsule과 `--quiet` 구현.
  - `task-token-guidance`: 방법론을 정책·templates·README에 정렬.
- 파일: `test/token-efficiency.test.mjs`, `test/goal-state.test.mjs`, `test/lifecycle.test.mjs`, `test/packed-install.test.mjs`, `.codex-plugin/plugin.json`, `scripts/pota-state.mjs`, `scripts/pota-goal.mjs`, planning/work/model guidance와 문서 표면.
- Tests: `node --test test/token-efficiency.test.mjs test/goal-state.test.mjs test/lifecycle.test.mjs test/packed-install.test.mjs`.
- 모듈 수용: 위 집중 테스트.
- 표면 통합: `npm --cache /private/tmp/pota-npm-cache run check`.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task: 최종 검증과 검토

- Task ID: `task-token-verify`
- 초기 상태: `pending`
- 계약: 기능 회귀, package 내용, 토큰 비용 기준, diff와 증거 신선도를 검토합니다.
- Tests: `npm --cache /private/tmp/pota-npm-cache run check`.
- 모듈 수용: `npm --cache /private/tmp/pota-npm-cache run check`.
- 표면 통합: 직전 전체 검사 뒤 변경이 없을 때 `npm --cache /private/tmp/pota-npm-cache pack --dry-run --ignore-scripts`.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

## 복잡도 트리아지

- 선택 경로: Heavy Path.
- 선택 근거: hook context, goal CLI, plugin prompt, planning/work methodology와 검증 흐름을 함께 바꾸며 “test contract first”라는 새 실행 추상화를 도입합니다. 사용자가 방법론을 추론해 문제없이 반영하라고 명시해 추가 검토가 필요합니다.
- 확인한 Heavy Path 신호:
  - 새 디렉터리/모듈/계층: 새 production module은 없지만 전용 token-efficiency test module을 추가합니다.
  - 새 도메인 모델/서비스/추상화: 실행 상태 모델은 유지하고, test-contract-first/token-budget 방법론 추상화를 정책에 추가합니다.
  - 보안/인증/세션: 없음.
  - 외부 API/메시지 큐/결제: 없음.
  - DB 스키마/마이그레이션: 없음.
  - 동시성/트랜잭션/캐시: 없음.
  - 도메인 간 리팩터링: hook, CLI, planning/work/test/package 표면을 가로지르는 workflow refactor.
  - 명시적 extra-care: 있음. 토큰을 줄이되 문제없이 동작하도록 방법론 추론을 요청함.
- 위임: 상위 정책이 사용자의 명시적 subagent 요청 없는 생성을 금지하므로 주 세션이 구현·검증을 직접 수행합니다.
- 사전 구현 검토 결정:
  - 성공 output만 억제하고 오류 output/exit code는 보존합니다.
  - active hook에서 초기 goal 정책만 제거하며 roadmap/current/resume은 유지합니다.
  - 문자 수는 tokenizer에 독립적인 deterministic proxy로 사용하고 예산을 테스트합니다.
  - 검증 재사용은 직전 전체 검사 뒤 변경이 없는 package content 검사에만 허용합니다.

## 도구 준비 상태

- 감지 스택: JavaScript.
- toolcheck: Node runtime 정상.
- 필요한 LSP: 작은 ESM/문자열 정책 변경에는 필수 아님. Node syntax/test와 `rg`로 심볼·표면을 검증합니다.
- 필요한 검증: Node test runner, `npm run check`, `npm pack --dry-run --ignore-scripts`, `git diff --check`.
- 설치 승인: 요청하지 않음.
- 외부 상태 변경: 없음.

## 증거

- 초기 계획 산출물: 이 문서와 `PLAN.md` 색인.
- UI plan/goal: 3단계 roadmap과 active goal 생성 완료.
- 트리아지: 위 비용 측정과 Heavy Path 판정 완료.
- 테스트 계약 실패 기준선: 구현 전 `node --test test/token-efficiency.test.mjs` 실행 결과 0/4 통과. default prompt 4,390자, idle hook 808자, `--quiet` 미지원, work 방법론 부재로 의도한 네 경계가 모두 실패했습니다.
- 최소 구현 뒤 집중 계약: 같은 명령 4/4 통과.
- 영향 표면 집중 검증: `node --test test/token-efficiency.test.mjs test/goal-state.test.mjs test/lifecycle.test.mjs test/packed-install.test.mjs` 실행 결과 25/25 통과.
- 최종 비용 측정: default prompt 2,549자, idle hook 277자, 3-task active hook 434자·7줄. 각 예산 3,600/420/700자 이하이며 active roadmap/current/resume을 유지합니다.
- 전체 검사: `npm --cache /private/tmp/pota-npm-cache run check` 실행 결과 syntax/JSON 검사와 39/39 테스트 통과.
- package content: 전체 검사 뒤 관련 변경 없이 `npm --cache /private/tmp/pota-npm-cache pack --dry-run --ignore-scripts` 실행 결과 62개 파일, 76.0 kB tarball 구성을 확인했습니다. prepack 테스트는 중복 실행하지 않았습니다.
- 증거 재사용: 위 전체 검사 뒤 package/runtime 파일이 바뀌지 않아 동일 결과를 구현 task의 surface gate와 최종 검증 task의 module gate에 각각 바인딩했습니다. 이후 변경은 `.pota` 상태와 package 밖 계획 색인뿐입니다.
- 최종 검토: production·policy·test diff를 계획의 불변식과 대조했고 추가 결함을 찾지 못했습니다. `git diff --check`도 통과했습니다.

## 상태

- [x] 초기 계획 작성
- [x] Codex UI와 저장소 goal 동기화
- [x] 트리아지 및 구현 계획 확정
- [x] 구현
- [x] 모듈 수용 검증
- [x] 표면 통합 검증
- [x] 최종 검토와 Goal 완료
