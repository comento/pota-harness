# 계획: 토큰 효율 방법론 검토 findings 전체 수정

## 계획 단계

- 현재 단계: 완료.
- UI 동기화: 이 초기 roadmap을 `update_plan`과 `create_goal`, 저장소 Pota goal에 먼저 표시한 뒤 상세 탐색을 시작합니다.
- 갱신 결과: 기존 파서 호환성, 도구 결과의 신뢰 경계, package lifecycle 유형, bounded context와 locale 표면을 확인해 각 테스트 계약과 구현 범위를 확정했습니다.

## 목표

검토에서 확인된 P1 세 건과 나머지 일관성·확장성 문제를 수정해 inline CLI 호환성을 복구하고, 증거가 실제 도구 실행 결과와 결합되도록 하며, content-producing lifecycle을 건너뛰지 않는 안전한 package 검증 정책과 bounded context를 만듭니다.

- Goal ID: `goal-fix-token-methodology-p1`
- Plan ID: `plan-fix-token-methodology-p1`
- 완료 기준:
  - `--key=value` 기존 옵션과 `--quiet` boolean 옵션이 함께 정상 동작합니다.
  - task 완료 증거는 하네스가 직접 실행한 도구 결과로 생성되고, 관련 작업공간 변경 뒤에는 stale로 거부됩니다.
  - `--ignore-scripts`는 prepack이 content-neutral한 중복 검사임을 확인한 경우에만 허용됩니다.
  - goal/task 수와 제목 길이가 커져도 active hook은 bounded phase capsule을 유지하면서 현재 위치와 복귀 정보를 보존합니다.
  - 지원 locale과 사용자 가시 증거 용어가 동일한 방법론을 전달하고, `goal status`는 실수로 silent해지지 않습니다.
  - 완료 계획의 상단 phase와 하단 상태가 일치합니다.
  - 집중 회귀, 전체 검사, package surface 검증이 통과합니다.
- 필수 goal 증거: `finalReview`.
- 종료 상태: `completed`, `paused`, `blocked`, `cancelled` 중 하나.

## 전체 작업

- 결과: P1 결함과 추가 문제를 각각 먼저 실패하는 executable test 또는 결정론적 정책 assertion으로 고정하고 최소 구현으로 통과시킵니다.
- 예상 영향 표면: `scripts/pota-goal.mjs`, `scripts/pota-state.mjs`, `scripts/pota.mjs`, goal CLI 및 상태 테스트, `skills/pota-work/SKILL.md`, command/workflow/model guidance, 지원 locale README, token-efficiency 테스트, 계획 문서.
- 초기 roadmap: 트리아지와 계약 확정 → CLI·도구 증거 수정 → 안전한 package 정책 → bounded context·locale·용어·계획 일관성 수정 → 전체 검증·검토.

## 메모리 입력

- `MEMORY.md`
- 관련 상세 memory 없음.

## 초기 트리아지 Task

- Task ID: `task-p1-triage`
- 초기 상태: `active`.
- 조사 범위:
  - 기존 `parseArgs`의 separated/inline/boolean 동작과 main CLI 전달 경계.
  - `recordReceipt`, task/goal 완료 게이트, timestamp/revision 및 worktree 상태로 만들 수 있는 최소 신선도 계약.
  - package scripts를 content-neutral verification과 content-producing lifecycle로 분류할 수 있는 결정 규칙.
  - task 수·제목 길이별 active hook 상한과 복귀에 필요한 최소 roadmap 표현.
  - 8개 지원 locale의 work 메시지, README, 사용자 가시 hook/error 용어와 완료 계획 phase.
- Heavy Path 판정 기준: 새 evidence 실행 명령이나 state schema 변경이 필요하면 Heavy Path, 기존 필드와 CLI 경계 안의 호환 수정이면 Light Path.
- toolcheck: 설치 runtime의 `toolcheck --root /Users/wknam/workspace/pota-harness`.
- 완료 조건: 선택 경로, 테스트 계약, 구체 파일, 두 검증 게이트를 같은 계획에 기록합니다.
- 필수 증거 기록: `planArtifact`, `triageDecision`.

## 예상 구현 Task

### Task: inline 옵션 파서 호환성

- Task ID: `task-inline-options`
- 초기 상태: `pending`.
- 계약: boolean 변환은 `--quiet`에만 적용하고 기존 `--root=`, `--goal=`, `--plan=`, `--exit-code=` 값을 문자열로 보존합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task: 도구 실행과 증거 신선도 결합

- Task ID: `task-tool-evidence`
- 초기 상태: `pending`.
- 계약: 테스트 도구 실행과 증거 기록을 한 명령 경계로 결합하고, 실행 뒤 관련 작업공간 변경 시 증거를 stale로 판정할 최소 fail-closed 기준을 구현합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task: 안전한 package 검증 정책

- Task ID: `task-safe-pack`
- 초기 상태: `pending`.
- 계약: prepack이 빌드나 생성 등 package content를 바꿀 수 있으면 scripts를 실행하고, 중복 검사만 수행하는 것으로 확인된 경우에만 `--ignore-scripts`를 허용하도록 모든 work 표면을 정렬합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task: bounded active context

- Task ID: `task-context-budget`
- 초기 상태: `pending`.
- 계약: 전체 ordered roadmap은 repository state와 UI에 보존하고, 반복 hook은 원래 index가 있는 current 주변 window·status count·omitted count·resume 위치만 전달해 제목·task 수가 커져도 정한 상한을 넘지 않게 합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task: 지원 surface·용어·계획 상태 일관성

- Task ID: `task-surface-consistency`
- 초기 상태: `pending`.
- 계약: 8개 지원 locale의 work 방법론을 정렬하고 사용자 가시 `receipt`를 “evidence record/증거 기록” 계열로 바꾸며, `goal status --quiet`의 silent 성공을 방지하고 완료 계획의 phase 문구를 완료 상태와 맞춥니다. 내부 state field와 `goal receipt` 명령은 호환성을 유지합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

### Task: 전체 검증과 최종 검토

- Task ID: `task-p1-verify`
- 초기 상태: `pending`.
- 계약: 세 회귀 계약, 전체 테스트, 실제 package surface, diff와 증거 신선도를 검토합니다.
- 필수 증거 기록: `moduleAcceptance`, `surfaceIntegration`.

## 초기 도구·경로 상태

- 감지 스택: JavaScript/Node.js.
- 위임: 상위 정책이 사용자의 명시적 subagent 요청 없는 생성을 금지하므로 주 세션이 구현과 검증을 직접 수행합니다.
- 구현 경로: Heavy Path.
- 외부 상태 변경: 없음. 저장소 파일과 임시 test fixture만 사용합니다.

## 트리아지 결과와 결정된 설계

### 경로 판정

- 선택 경로: Heavy Path.
- 근거: goal evidence schema를 v2로 호환 마이그레이션하고, 실제 검증 프로세스 실행·출력 digest·workspace fingerprint를 결합하는 새 `goal verify` 런타임 경계를 추가합니다. hook·CLI·package workflow·8개 locale도 함께 변경합니다.
- 확인한 Heavy Path 신호:
  - 새 디렉터리/계층: 없음.
  - 새 도메인 모델/서비스: evidence record에 tool source와 workspace fingerprint를 추가하는 상태 모델 변경 있음.
  - 보안/인증/세션: 없음.
  - 외부 API/메시지 큐/결제: 없음.
  - DB/마이그레이션: 없음.
  - 동시성/트랜잭션/캐시: 없음.
  - 도메인 간 변경: goal state, CLI, hook context, package workflow, locale documentation을 가로지름.
  - extra-care: 검토 findings 전체를 fail-closed 방식으로 수정하라는 명시 요청.
- 위임: 상위 정책이 사용자 요청 없는 subagent 생성을 금지하므로 주 세션이 직접 구현·검증합니다.

### Tool-bound evidence 계약

- `GOAL_STATE_VERSION`을 2로 올리고 v1을 읽을 때 기존 evidence record를 `declared`, goal policy를 `tool-bound`로 호환 마이그레이션합니다. 완료된 과거 goal은 읽을 수 있고, 미완료 goal은 필요한 검증을 실제 도구로 다시 통과해야 합니다.
- 새 `goal verify` 명령은 `--` 뒤 argv를 shell 없이 실행합니다. 성공하면 exact argv, exit code 0, bounded summary/output digest, timestamp, watch paths와 workspace fingerprint를 한 번에 기록합니다. 실패하면 증거를 기록하지 않고 bounded failure output과 non-zero exit를 반환합니다.
- 새 goal의 required evidence는 기본적으로 `tool-bound`입니다. 기존 `goal receipt` 명령과 `receipts` state field는 호환성을 위해 유지하되, declared evidence는 tool-bound goal의 완료 게이트를 통과하지 못합니다.
- fingerprint는 `--watch`가 있으면 해당 경로, 없으면 git tracked/untracked workspace 전체를 대상으로 파일 path·content를 SHA-256으로 계산하며 `.git`과 `.pota`은 제외합니다. 완료 게이트에서 재계산 결과가 다르면 `stale evidence`로 거부합니다.
- `goal status`는 `--quiet`가 붙어도 상태를 출력하고, 성공 mutation과 `goal verify --quiet`만 stdout을 억제합니다.

### CLI 파서 계약

- `--quiet`와 `--quiet=false`만 boolean으로 해석합니다.
- `--root=/path`, `--goal=text`, `--plan=path`, `--exit-code=0` 등 기존 inline 값은 문자열 그대로 보존합니다.
- `--` 이후 값은 `goal verify`가 실행할 exact argv로 분리합니다.

### Package lifecycle 계약

- 기본 package surface 검증은 lifecycle script를 포함한 정상 `npm pack --dry-run`입니다.
- `--ignore-scripts`는 `package.json`의 `prepack`/`prepare`/관련 lifecycle을 직접 확인해 absent이거나 test/lint/check처럼 content-neutral verification만 수행한다고 근거를 기록한 경우에만 사용합니다.
- build, generate, compile, copy, bundle처럼 content-producing이거나 분류가 불명확하면 scripts를 생략하지 않습니다.

### Bounded context 계약

- repository state와 Codex UI에는 전체 ordered roadmap을 유지합니다.
- 반복 hook은 goal/title과 task ID/title을 제한 길이로 자르고, task가 많으면 current 주변 3개와 전체 status count·원래 index·omitted count를 표시합니다.
- 짧은 3-task roadmap의 기존 출력과 current/resume 의미는 유지하고, 긴 20-task fixture도 700자 이하를 만족해야 합니다.

### Surface 일관성 계약

- `scripts/pota.mjs`가 지원하는 `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de`, `pt` work 메시지 모두 test-contract/tool-result/failure-expansion/safe-pack 의미를 포함합니다.
- 각 지원 README에 token-efficient 실행 규칙을 추가하고 사용자 가시 hook/error/policy 문구는 evidence record 계열로 통일합니다. 내부 `goal receipt` 명령과 state field는 유지합니다.
- 이전 완료 계획 `docs/plan/token-efficient-reliable-harness.md`의 상단 phase를 완료 상태로 교정하고, 이 계획도 완료 시 상단·하단을 함께 갱신합니다.

## 실행 테스트 계약

- 구현 전 실패 기준:
  - inline non-boolean 옵션이 boolean으로 손상되는 CLI 테스트.
  - 실행하지 않은 declared evidence가 새 goal 완료를 통과하는 테스트.
  - 실제 성공/실패 명령과 file mutation 뒤 stale rejection을 검증하는 `goal verify` 테스트.
  - content-producing prepack에서 `--ignore-scripts`를 금지하는 policy assertion.
  - 20개 긴 task의 active hook 700자 예산 테스트.
  - 8개 locale work 메시지와 사용자 가시 evidence 용어 assertion.
  - `goal status --quiet`가 상태를 출력하는 테스트.
- task별 집중 검증:
  - CLI/evidence: `node --test test/goal-state.test.mjs test/token-efficiency.test.mjs`.
  - package/context/surface: `node --test test/token-efficiency.test.mjs test/lifecycle.test.mjs test/packed-install.test.mjs`.
- 최종 모듈 수용: `npm --cache /private/tmp/pota-npm-cache run check`.
- 최종 표면 통합: 이 저장소의 `prepack`이 `npm run check`만 수행하는 content-neutral 중복 검사임을 확인했으므로, 전체 검사 뒤 관련 변경이 없을 때 `npm --cache /private/tmp/pota-npm-cache pack --dry-run --ignore-scripts`.
- 최종 검토: `git diff --check`와 plan/runtime/state invariant 대조.

## 상태

- [x] 초기 계획 작성
- [x] UI와 저장소 goal 동기화
- [x] 트리아지와 구현 계약 확정
- [x] 검토 findings 전체 구현
- [x] 모듈·표면 검증
- [x] 최종 검토와 Goal 완료

## 완료 증거

- 집중 회귀: `node --test test/goal-state.test.mjs test/token-efficiency.test.mjs test/lifecycle.test.mjs` — 32개 테스트 통과.
- 전체 검사: `npm --cache /private/tmp/pota-npm-cache run check` — tool-bound `moduleAcceptance`로 실행해 exit code 0과 output digest를 기록했습니다.
- package surface: `package.json`의 `prepack`이 `npm run check`만 실행하는 content-neutral 검증임을 확인한 뒤, 신선한 전체 검사 직후 `npm --cache /private/tmp/pota-npm-cache pack --dry-run --ignore-scripts`를 tool-bound `surfaceIntegration`으로 실행해 exit code 0과 output digest를 기록했습니다.
- 추가 회귀: 검증 대상 preflight, 직접 tool evidence 위조 차단, v1 source 강제 마이그레이션, `=`가 여러 개인 inline 값, blocked task 복귀 context를 각각 실패 테스트로 고정하고 통과시켰습니다.
- 최종 검토: `git diff --check`와 v2 goal state의 모든 task/goal workspace fingerprint 재검증을 통과한 뒤 goal을 `completed`로 전이했습니다.
