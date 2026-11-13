# 계획: 계획 중단에도 goal/task를 보존하는 2단계 계획

## 계획 단계

- 현재 단계: 트리아지 완료, 구현용 decision-complete 계획.
- 초기 단계 결과: `triage-plan`이 active인 Codex UI plan과 UI goal, 저장소 plan과 Pota goal을 생성했습니다.
- UI 동기화 증거: 사용자가 "그래 이제 목표가 뜨고, 단계가 생겼어. 이 방식이야."라고 실제 표시를 확인했습니다.

## 목표

구현 또는 계속 실행 요청은 트리아지 절차 자체를 task로 포함한 초기 계획을 먼저 기록하고 곧바로 Pota goal을 영속화합니다. 이후 탐색·트리아지 결과로 같은 계획을 decision-complete 상태까지 갱신하여, 중간 질문이나 턴 종료가 발생해도 UI와 다음 hook에 goal/task roadmap 및 복귀 지점이 남도록 합니다.

- Goal ID: `goal-planning-first-persistence`
- Plan ID: `plan-goal-before-planning-interruption`
- Runtime resources: 설치된 Pota 버전에서 해석하는 `pota://` 리소스
- 완료 기준: planning-first 순서가 hook, skill, command, 기본 prompt, model guidance, README에 일관되게 반영되고 회귀 테스트와 전체 패키지 검증이 통과합니다.
- 필수 goal 증거: `finalReview`
- 종료 상태: `completed`, `paused`, `blocked`, `cancelled` 중 하나

## 전체 작업

- 결과:
  - MEMORY와 사용자 요청만으로 트리아지 절차, 예상 영향 표면, 상위 실행 단계를 담은 초기 계획을 먼저 작성합니다.
  - 초기 계획 직후, 상세 탐색·복잡도 판정·사용자 질문 전에 영속 goal을 생성하거나 기존 goal에 연결합니다.
  - 새 goal의 첫 active task는 `triage-plan`이며, 트리아지 기준·조사 범위·계획 갱신 조건을 명시합니다.
  - 탐색과 Light/Heavy Path 판정 결과를 같은 계획에 반영해 decision-complete 상태로 승격한 뒤에만 구현을 시작합니다.
  - consultation, explanation, plan-only 요청에는 goal을 만들지 않는 경계와 hook의 비변경 동작을 유지합니다.
- 영향 표면: `scripts/pota-state.mjs`, `scripts/pota-state.sh`, `.codex-plugin/plugin.json`, `skills/pota-plan/SKILL.md`, `commands/pota-plan.md`, model guidance, 계획 templates와 surface mirror, README, lifecycle/goal-state/packed-install 테스트.
- 작업 분류: 기존 prompt와 workflow 순서를 교정하는 하나의 bounded policy task.
- 하위 작업: 초기 계획 계약, goal 활성화 시점, 트리아지 후 계획 갱신 계약, 영문·한국어 및 설치 tarball 회귀 검증.

## 메모리 입력

- `MEMORY.md`
- 관련 상세 memory 문서는 없음.

## 모델 가이드

- 적용 모델 계열: Codex.
- 참조 문서: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/codex.md`.
- 근거: 명시적인 작업 순서와 hook 컨텍스트를 작은 정책 변경 및 결정론적 테스트로 검증할 수 있습니다.
- 역할별 조정: 상위 multi-agent 정책이 사용자 요청 없는 subagent 생성을 금지하므로 주 세션이 구현·검증을 직접 인계합니다.
- 사용자 응답과 산출물 언어: 한국어.

## 복잡도 트리아지

- 현재 단계: 초기 계획. 아래 판정은 이 문제를 재현한 저장소 탐색 결과를 반영한 확정 트리아지이며, 일반 Pota 실행에서는 `triage-plan` task 수행 중 채워집니다.
- 선택 경로: Light Path.
- 선택 근거: 기존 goal/task 상태 모델과 명령은 그대로 두고, 초기 계획·goal 활성화·트리아지 후 계획 확정 순서만 기존 정책 표면에서 교정합니다.
- 확인한 Heavy Path 신호:
  - 새 디렉터리/모듈/계층: 아니오.
  - 새 도메인 모델/서비스/추상화: 아니오.
  - 보안/인증/세션: 아니오. 기존 session ownership을 유지합니다.
  - 외부 API/메시지 큐/결제: 아니오.
  - DB 스키마/마이그레이션: 아니오.
  - 동시성/트랜잭션/캐시 무효화: 아니오.
  - 도메인 간 리팩터링: 아니오.
  - 명시적 extra-care 신호: 아니오.
- Heavy Path 트리거: 없음.
- 생략한 위임: 상위 정책상 사용자가 subagent를 요청하지 않았으므로 로컬 주 세션이 구현·검증합니다.
- 구현 전 결정:
  - hook이 자연어 prompt를 분류해 자동 상태 파일을 쓰지는 않습니다.
  - 에이전트는 intent를 구현/계속 실행으로 분류하면 MEMORY와 요청을 근거로 초기 계획부터 기록합니다.
  - 초기 계획은 트리아지의 입력, 조사 범위, 판정 기준, 갱신 조건과 예상 상위 실행 단계를 포함합니다.
  - 초기 계획 파일과 PLAN.md 색인을 쓴 직후 goal을 시작하며, 첫 task는 `triage-plan`입니다.
  - 탐색과 트리아지 결과로 같은 계획을 갱신하고 decision-complete 여부를 명시한 뒤 구현 task로 넘어갑니다.

## 에이전트 배정

- 주 세션: 계획, 구현, 테스트, 증거 기록, 최종 검토.
- `explorer`/`worker`: 상위 multi-agent 정책 때문에 생략.

## 도구 준비 상태

- 감지 스택: JavaScript, Node.js.
- toolcheck: 설치 runtime의 `toolcheck --root /Users/wknam/workspace/pota-harness` 통과.
- 필요한 LSP/심볼 도구: 작은 ESM 문자열·Markdown·테스트 변경에는 필수 아님. `rg`와 Node 테스트를 사용합니다.
- 필요한 typecheck/lint/검증 도구: Node syntax check, `node --test`, `npm run check`, `npm pack --dry-run`.
- 누락 도구: 없음.
- 설치 승인: 필요 없음.
- 도구 blocker: 없음.

## 실행 가드레일

- dry-run/check: 구현 전 `node --test test/goal-state.test.mjs test/lifecycle.test.mjs`를 기준선으로 실행합니다.
- 외부 상태 변경: 없음. 저장소 파일만 수정합니다.
- 검증 루프 예산: 두 번.
- 실패 처리: 한 번 진단하고 범위를 줄여 두 게이트를 재실행하며, 두 번째 실패 뒤 blocker를 기록합니다.

## 초기 Roadmap과 모듈 작업

### Task: 트리아지 수행과 계획 확정

- Task ID: `task-triage-plan`
- 초기 상태: `active`
- 계약: MEMORY와 초기 계획에 기록된 조사 범위·Heavy Path 기준을 따라 탐색하고, Light/Heavy Path 판정과 구체적인 파일 범위·검증 명령을 같은 계획에 반영해 decision-complete 상태로 확정합니다.
- 완료 조건: 계획에 도구 준비, 전체 작업, 영향 표면, 모든 Heavy Path 신호, 선택 경로, 구현 task 계약 및 두 검증 게이트가 채워집니다.
- 필수 receipt: `planArtifact`, `triageDecision`.

### Task: 2단계 계획 정책 구현

- Task ID: `task-two-phase-plan-policy`
- 초기 상태: `pending`
- 계약: 초기 계획을 먼저 쓰고 goal을 연결한 뒤, 계획된 트리아지를 통해 같은 계획을 decision-complete 상태로 갱신하며 구현은 그 이후에만 수행하도록 모든 정책 표면을 정렬합니다.
- 파일: `.codex-plugin/plugin.json`, `commands/pota-plan.md`, `skills/pota-plan/SKILL.md`, `docs/model-guidance/README.md`, `docs/model-guidance/codex.md`, `scripts/pota-state.mjs`, `README.md`, `README.ko.md`, `test/goal-state.test.mjs`, `test/lifecycle.test.mjs`, `test/packed-install.test.mjs`.
- 의존성: 기존 goal CLI와 hook 상태 컨텍스트.
- dry-run/check 명령: `node --test test/goal-state.test.mjs test/lifecycle.test.mjs`.
- 모듈 수용 검증: `node --test test/goal-state.test.mjs test/lifecycle.test.mjs`.
- 표면 통합 검증: `npm run check`.
- 필수 receipt: `moduleAcceptance`, `surfaceIntegration`.

### Task: 최종 검증과 검토

- Task ID: `task-final-verify`
- 초기 상태: `pending`
- 계약: 전체 검사, package dry-run, diff 검토로 소스와 설치본의 2단계 계획 순서가 일치하는지 확인합니다.
- 모듈 수용 검증: `npm run check`.
- 표면 통합 검증: `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
- 필수 receipt: `moduleAcceptance`, `surfaceIntegration`.

## 증거

- Dry-run/check: 변경 전 `node --test test/goal-state.test.mjs test/lifecycle.test.mjs` 20/20 통과.
- 도구 준비: JavaScript/Node 감지 및 toolcheck 통과.
- 계획 산출물: `PLAN.md`와 이 문서에 초기 roadmap, 계획된 트리아지, 판정 기준, 구현 계약을 기록하고 트리아지 결과로 현재 문서를 갱신했습니다.
- 트리아지 판정: 기존 goal/task 상태 스키마는 변경하지 않는 Light Path. 결함은 저장소 상태와 Codex UI 상태가 별개인데 기존 정책이 UI `update_plan`/`create_goal` 호출 및 초기 계획 단계를 요구하지 않은 순서 문제입니다.
- UI 확인: Codex `create_goal`과 `update_plan` 호출 뒤 사용자가 goal과 단계 표시를 확인했습니다.
- Tests: 집중 회귀 테스트 `node --test test/goal-state.test.mjs test/lifecycle.test.mjs test/packed-install.test.mjs` 21/21 통과, 전체 `npm --cache /private/tmp/pota-npm-cache run check` 35/35 통과.
- 모듈 수용: hook 영문·한국어 컨텍스트, 설치된 plugin default prompt, 실제 tarball 설치 경로가 초기 계획 → `update_plan` → `create_goal` → 저장소 goal → 트리아지 후 계획 갱신 계약을 검증했습니다.
- 표면 통합: `npm --cache /private/tmp/pota-npm-cache pack --dry-run` 통과, 62개 파일이 포함된 `@comento/pota-harness@0.2.1` tarball 구성을 확인했습니다.
- Goal final review evidence: `git diff --check` 통과, 정책 검색으로 Codex UI 도구 순서와 `triage-plan` 계약이 manifest, skill, command, hook, model guidance, templates, mirrors, README, tests에 반영된 것을 확인했습니다.
- 검증 pass 수: 집중 회귀 1차에서 정책보다 좁은 정규식 1건이 실패했고, 실제 `update_plan first and then create_goal` 계약에 맞춰 테스트를 교정한 2차 21/21 통과. 전체 검사와 package dry-run은 각 1회 통과.
- 두 번 실패 뒤 blocker: 없음.

## 상태

- [x] 계획 완료
- [x] dry-run/check 통과
- [x] 구현 완료
- [x] 모듈 수용 통과
- [x] 표면 통합 통과
- [x] 검토 완료
- [x] Goal 완료
