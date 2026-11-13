# 계획: 단계별 복잡도 재평가

## 계획 단계

- 초기 상태: `triage-plan` 실행에는 의사결정이 완료됐지만 구현 준비는 끝나지 않았습니다.
- 최종 상태: 계획 단계 트리아지를 마쳐 구현 가능한 수준입니다. 구현 편집 직전의 코드 체크포인트 통과가 추가로 필요합니다.
- Codex UI 동기화: 초기 로드맵은 `update_plan`과 `create_goal`에 동기화했으며, 이 최종 로드맵으로 다시 맞춥니다.

## 목표

요청 접수, 계획 구체화, 구현 직전 코드 확인의 각 단계에서 새 증거로 복잡도를 재평가하고, 뒤 단계에서 위험이 발견되면 Light Path를 Heavy Path로 안전하게 승격하는 Pota 워크플로를 제공합니다.

- Goal ID: `goal-408b6d1c-cd5d-4acc-ba0f-a2a096071472`
- Plan ID: `plan-staged-complexity-reassessment`
- 런타임 리소스: 설치된 Pota 버전으로 `pota://` 리소스를 해석합니다.
- 완료 조건: 단계별 판정 상태와 승격 규칙이 정책·런타임·테스트에 일관되게 반영되고 전체 검사와 패키지 dry-run을 통과합니다.
- 필수 goal 증거: `finalReview`
- 종료 상태: `completed`, `paused`, `blocked`, `cancelled` 중 하나이며 `active`는 완료가 아닙니다.

## 전체 작업

- 결과: 단일 시점 복잡도 판정을 다단계 재평가 구조로 교체하고, 늦게 발견된 Heavy Path 신호가 기존 Light Path 결정을 무효화하도록 합니다.
- 예상 영향 범위: 계획 스킬/명령/에이전트 지침, lifecycle 또는 상태 런타임, 계획 템플릿, 관련 회귀 테스트와 문서.
- 작업 분류: 먼저 현재 판정 지점과 상태 전이를 조사한 뒤, 테스트 계약을 확정하고 최소 정책·런타임 변경과 회귀 검증을 수행합니다.
- 하위 작업: 요청 단계 판정, 계획 단계 재판정, 코드 확인 단계 재판정, 단방향 승격과 증거 신선도, 복귀/중단 상태 보존.

## 메모리 입력

- `MEMORY.md`
- 관련 `docs/memory/*.md`는 조사에서 색인과 주제를 확인한 뒤 필요한 파일만 읽습니다.

## 모델 지침

- 적용 모델 계열: Codex.
- 참조 예정 지침:
  - `pota://docs/model-guidance/README.md`
  - `pota://docs/model-guidance/codex.md`
- 근거: 현재 실행 환경과 계획 스킬이 Codex 오케스트레이션 및 검증 동기화를 요구합니다.
- 역할 조정: 현재 상위 실행 정책상 사용자가 위임을 요청하지 않았으므로 서브에이전트는 사용하지 않고 메인 세션이 조사·구현·검증을 수행합니다.
- 사용자 응답과 산출물 언어: OS 로케일에 따라 한국어를 사용합니다.

## 복잡도 트리아지

- 선택 경로: Heavy Path.
- 판정 기록:
  - 요청 체크포인트: `provisional-heavy`. 요청이 복잡도 트리아지의 동작 자체를 바꾸며 다단계 안전장치를 명시했습니다.
  - 계획 체크포인트: `heavy`. 설치된 모든 에이전트 표면에서 같은 계약을 유지해야 하는 교차 표면 변경임을 저장소 조사로 확인했습니다.
  - 코드 체크포인트: `heavy / repeated and completed`. 최초 확인 뒤 사용자가 경로 변경 시 task 목록 재구성을 추가로 요구해 편집을 중단하고 범위를 다시 조사했습니다. `scripts/pota-goal.mjs`에 미완료 roadmap 교체 기능이 없음을 확인했으며 런타임·테스트 범위를 추가한 뒤 Heavy 경로를 유지합니다.
- 재평가/승격 규칙:
  - 각 체크포인트는 새로 확인한 증거, 발견한 Heavy Path 신호, 현재 경로를 계획에 남깁니다.
  - 요청 판정은 잠정값이며 계획 판정이 이를 대체합니다. 구현 준비가 끝난 뒤에는 코드 체크포인트가 완료되기 전 편집할 수 없습니다.
  - 요청 판정은 잠정값이므로 계획 체크포인트에서 Light↔Heavy 양방향 재분류할 수 있습니다. 코드 체크포인트도 첫 편집 전의 실제 코드 증거로 양방향 재분류할 수 있습니다.
  - 경로가 바뀌면 상세 plan, 저장소 goal의 task roadmap, Codex UI task 목록, 필수 evidence/리뷰/할당을 새 경로에 맞게 함께 재구성하고 동기화가 끝날 때까지 구현을 차단합니다.
  - 편집이 시작된 뒤에는 새 Heavy Path 신호에 따른 Light→Heavy 승격만 허용합니다. Heavy→Light 하향은 다음 계획 체크포인트에서 모든 Heavy 신호가 해소됐다는 명시적 증거가 있을 때만 가능합니다.
  - 편집 도중 새 Heavy Path 신호를 발견하면 추가 편집을 중단하고 관련 증거를 stale로 표시한 뒤 코드 체크포인트부터 다시 수행합니다.
- Heavy Path 신호 확인 결과:
  - 새 디렉터리/모듈/레이어: 없음.
  - 새 도메인 모델/서비스/추상화: 없음.
  - 보안/인증/세션: 없음.
  - 외부 API/메시지 큐/결제: 없음.
  - DB 스키마/마이그레이션: 없음.
  - 동시성/트랜잭션/캐시 무효화: 없음.
  - 교차 도메인 리팩터링: 있음. Codex plugin prompt, 스킬, 명령, Antigravity workflow, 모델 지침, 템플릿, hook 상태 문구가 같은 계약을 공유합니다.
  - 명시적 신중 처리 신호: 있음. 사용자가 요청·계획·코드 확인의 단계별 재평가 문제를 명시했습니다.
- 사전 구현 결정:
  - plan artifact를 authoritative checkpoint ledger로 사용하고, 저장소 goal에는 완료 task를 보존하면서 미완료 roadmap을 교체하는 명시적 `goal replan` 연산을 추가합니다.
  - `request`, `plan`, `code` 세 체크포인트를 필수로 하고, `code`는 정확한 구현 범위 확인 후 첫 편집 직전에 완료합니다.
  - 경로가 바뀌면 plan artifact를 먼저 갱신한 뒤 저장소 roadmap과 Codex UI plan을 같은 stable task ID 순서로 동기화합니다. 제거된 미완료 task의 증거와 goal-level 최종 증거는 폐기하여 stale 증거가 새 경로를 통과하지 못하게 합니다.
  - 현재 상위 실행 정책이 사용자 요청 없는 서브에이전트를 금지하므로 사전 구현 검토와 구현은 메인 세션이 수행하며 이 예외를 증거에 기록합니다.
- 사전 구현 검토: 통과. 상태 스키마 변경 없이 plan artifact를 체크포인트 원장으로 사용하면 기존 goal/evidence 결속을 유지하면서 실패 폐쇄형 재평가를 추가할 수 있습니다. 코드 체크포인트 이후 경로는 Heavy로 유지하며 구현 범위 변경은 없습니다.

## 에이전트 할당

- 서브에이전트: 현재 상위 실행 정책상 사용자가 요청하지 않아 사용하지 않습니다.
- 메인 세션: 조사, 계획 확정, 구현, 두 검증 게이트를 직접 수행합니다.

## 도구 준비 상태

- 감지한 스택: JavaScript(Node.js 18+, ESM), Markdown/JSON 정책 산출물.
- Toolcheck 명령: `node <installed-pota>/scripts/pota.mjs toolcheck --root /Users/wknam/workspace/pota-harness` — Node와 npm 모두 OK.
- 필요한 LSP/심볼 도구: 실행 코드의 심볼 변경이 없고 정책 문서/문자열 계약 변경이므로 `rg` 구조 검색과 Node 구문 검사를 동등한 대안으로 사용합니다.
- 필요한 타입 검사/린트/검증 도구: Node 내장 test runner, `npm run check`, `npm pack --dry-run`.
- 누락 도구: 없음.
- 설치 승인: 필요 없음.
- 도구 차단 요인: 현재 없음.

## 실행 가드레일

- 테스트 계약 우선: 단계별 판정, 단방향 승격, 상태/계획 동기화, 증거 stale 처리를 실패 테스트로 먼저 고정합니다.
- 검증 사다리: 관련 집중 테스트 → 전체 검사 → lifecycle 스크립트 확인 후 일반 `npm pack --dry-run`.
- 증거 신선도: 판정·상태·정책 관련 파일이 바뀌면 이전 검증 증거는 stale입니다.
- 외부 상태 변경 전 dry-run: 이 작업은 저장소 내부 변경이며 패키징에는 `npm pack --dry-run`을 사용합니다.
- 검증 루프: 작업당 기본 2회. 실패하면 한 번 진단하고 범위를 축소해 두 게이트를 다시 실행하며, 두 번째 실패 후 차단 사유를 기록합니다.

## 모듈 작업

### 작업 0: 계획된 트리아지와 계획 확정

- Task ID: `triage-plan`
- 초기 상태: `active`
- 계약: 현재 복잡도 판정 지점, 계획/상태/lifecycle 호출 흐름, 관련 테스트와 도구 준비 상태를 조사하고 3단계 재평가 및 승격 규칙을 구현 가능한 계획으로 확정합니다.
- 조사 범위: `skills/`, `commands/`, `agents/`, `scripts/`, `templates/`, `test/`, 관련 문서와 package 스크립트.
- 필수 증거:
  - `planArtifact`: 명령, 종료 코드 0, 시각, goal ID, task ID, plan ID.
  - `triageDecision`: 명령, 종료 코드 0, 시각, goal ID, task ID, plan ID.

### 작업 1: 단계별 트리아지와 task roadmap 재구성 구현

- Task ID: `implement`
- 초기 상태: `pending`
- 계약: 활성 goal에서 완료 task는 보존하고 미완료 task 목록을 새 경로의 roadmap으로 교체하는 런타임을 구현한 뒤, 세 체크포인트와 경로 변경 시 plan/task/UI/evidence 동기화 정책을 모든 설치 표면에 반영합니다.
- 하위 작업:
  - `roadmap-contract-tests`: 완료 task 보존, 미완료 task 교체, 제거 task/goal evidence 폐기, 잘못된 roadmap 거부를 검증합니다.
  - `roadmap-runtime`: `scripts/pota-goal.mjs` API/CLI와 사용법을 최소 변경합니다.
  - `implement-contract-tests`: 설치·실행 표면별 단계 계약과 roadmap 재구성 요구를 검증하는 회귀 assertion을 추가하고 초기 실패를 확인합니다.
  - `implement-policy-surfaces`: 계획/작업 스킬과 명령, Antigravity workflow, 모델 지침, 템플릿, plugin/hook 문구, worker 지침을 일관되게 갱신합니다.
- 파일: `scripts/pota-goal.mjs`, `test/goal-state.test.mjs`, `test/contract-parity.test.mjs`, `test/lifecycle.test.mjs`, `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, `commands/pota-plan.md`, `commands/pota-work.md`, `.agents/workflows/pota-plan.md`, `.agents/workflows/pota-work.md`, `docs/model-guidance/README.md`, `docs/model-guidance/codex.md`, `docs/model-guidance/claude.md`, `templates/work-plan.md`, `templates/PLAN.md`, `.codex-plugin/plugin.json`, `scripts/pota-state.mjs`, `scripts/pota.mjs`, `agents/worker.md`.
- 경계: schema version은 유지하고 완료 task 및 그 task evidence는 보존합니다. 새 미완료 roadmap은 최소 한 task를 포함하며 stable ID 중복을 거부합니다.
- 예상 초기 실패: `replanGoal` export와 `goal replan` CLI가 없어 새 goal-state 테스트가 실패합니다.
- Dry-run/check: 외부 상태 변경이 없으므로 별도 dry-run은 해당 없음. 첫 변경은 테스트 assertion이며 되돌릴 수 있습니다.
- Tests: `node --test test/goal-state.test.mjs test/contract-parity.test.mjs test/lifecycle.test.mjs`.
- 모듈 인수 검증: `node --test test/goal-state.test.mjs test/contract-parity.test.mjs test/lifecycle.test.mjs`.
- 표면 통합 검증: `npm run check`.
- 필수 증거: `moduleAcceptance`, `surfaceIntegration`.

### 작업 2: 전체 검증과 최종 검토

- Task ID: `verify`
- 초기 상태: `pending`
- 계약: 집중 테스트, 전체 검사, 패키지 dry-run으로 설치 산출물까지 정책 일관성을 검증하고 diff 기반 최종 리뷰를 기록합니다.
- Tests: `node --test test/contract-parity.test.mjs test/lifecycle.test.mjs test/goal-state.test.mjs test/packed-install.test.mjs`.
- 모듈 인수 검증: `npm run check`.
- 표면 통합 검증: `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
- 필수 증거: `moduleAcceptance`, `surfaceIntegration`, `finalReview`.

## 증거

- Dry-run/check: 외부 상태 변경 없음. 저장소 내부 변경은 실패 테스트부터 적용했고, 패키지는 최종 단계에서 normal `npm pack --dry-run`으로 확인합니다.
- 도구 준비: JavaScript 감지, Node/npm OK, 누락 도구 없음.
- Tests: `node --test test/goal-state.test.mjs test/contract-parity.test.mjs test/lifecycle.test.mjs` — 32/32 통과. 초기에는 `replanGoal` 부재와 단일 트리아지 문구로 실패했으며 최소 구현 후 통과했습니다.
- 모듈 인수: 위 집중 테스트를 변경 후 다시 `goal verify`로 실행, exit 0, `receipt-a3293c0b-6268-4676-91b4-c92d0e44c60d`.
- 표면 통합: `npm run check`를 `goal verify`로 실행, 109/109 통과, exit 0, `receipt-7bfe1ec8-d0bb-4844-8399-e20eaebadf1a`.
- 최종 검증 모듈 인수: `node --test test/goal-state.test.mjs test/contract-parity.test.mjs test/lifecycle.test.mjs test/packed-install.test.mjs`, exit 0, `receipt-25bb9add-6069-44a0-96f1-1e35e829eda1`.
- 최종 검증 표면 통합: normal `npm --cache /private/tmp/pota-npm-cache pack --dry-run`이 `prepack` 전체 검사를 포함해 통과, exit 0, `receipt-4d5baffb-95ba-47e5-a600-d658ffeb7e31`.
- Goal 최종 검토: `git diff --check`와 변경된 Node 엔트리 구문 검사 통과. 범위 이탈, stale task evidence 재사용, roadmap/UI 동기화 누락 없음.
- 검증 횟수: 구현 작업 2회. 첫 전체 pass는 idle hook 420자 예산 초과(445자) 1건으로 실패했고 문구를 압축한 뒤 집중 32/32와 전체 109/109를 통과했습니다.
- 두 번 실패 후 차단 사유: 없음.

## 상태

- [x] 계획 완료
- [x] Dry-run/check 통과 또는 해당 없음 기록
- [x] 구현 완료
- [x] 모듈 인수 통과
- [x] 표면 통합 통과
- [x] 검토 완료
- [x] Goal 완료 조건 충족; 아래 결속 증거 기록 직후 repository/UI 상태를 `completed`로 전환
