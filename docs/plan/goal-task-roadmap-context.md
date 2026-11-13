# 계획: goal 작업 단계와 복귀 컨텍스트

## 목표

활성 Pota goal이 있으면 `SessionStart`와 `UserPromptSubmit`이 현재 task뿐 아니라 모든 작업 단계의 순서와 상태를 모델 가시 컨텍스트로 제공하고, 곁가지 질문을 답한 뒤 원래 현재 task로 복귀하도록 보장합니다.

## 전체 작업

- 결과:
  - 활성 goal의 task roadmap이 stable task ID, 제목, 상태와 함께 hook 컨텍스트에 표시됩니다.
  - 현재 task가 명확히 표시되고 곁가지 질문 뒤 해당 task를 재개하라는 지침이 포함됩니다.
  - goal이 없는 구현 요청에는 decision-complete plan에서 명시적 작업 단계를 만들라는 지침이 포함됩니다.
  - session ownership과 Stop gate 계약은 유지됩니다.
- 영향 표면: hook context, 플러그인/계획·작업 정책, README, goal 및 packed-install 테스트.
- 작업 분류: 기존 goal/task 상태를 표시하는 하나의 bounded task.
- 하위 작업: roadmap formatter, 정책 정렬, 영문·한국어 및 설치본 검증.

## 메모리 입력

- `MEMORY.md`
- 관련 상세 memory 문서는 없음.

## 모델 가이드

- 적용 모델 계열: Codex.
- 참조: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/codex.md`.
- 근거: 구조화된 task 상태와 hook 출력의 결정론적 검증에 적합합니다.
- 역할별 조정: 상위 정책상 명시적 subagent 요청이 없어 주 세션이 직접 구현·검증합니다.
- 사용자 응답과 산출물 언어: 한국어.

## 복잡도 트리아지

- 선택 경로: Light Path.
- 선택 근거: 기존 goal/task 상태 모델을 읽어 context 문자열로 표시하며 새 상태나 계층을 추가하지 않습니다.
- 확인한 Heavy Path 신호:
  - 새 디렉터리/모듈/계층: 아니오.
  - 새 도메인 모델/서비스/추상화: 아니오.
  - 보안/인증/세션: 아니오. 기존 ownership 검사 유지.
  - 외부 API/메시지 큐/결제: 아니오.
  - DB 스키마/마이그레이션: 아니오.
  - 동시성/트랜잭션/캐시 무효화: 아니오.
  - 도메인 간 리팩터링: 아니오.
  - 명시적 extra-care 신호: 아니오.
- Heavy Path 트리거: 없음.
- 생략한 위임: 상위 multi-agent 정책상 사용자가 subagent를 요청하지 않음.
- 구현 전 결정:
  - roadmap은 `.pota/state.json`의 task 배열 순서를 그대로 사용합니다.
  - 각 단계는 `<순번>. <id> [<status>] <title>` 형식으로 표시합니다.
  - 전체 plan 본문을 hook에 싣지 않고 중단 복귀에 필요한 최소 상태만 제공합니다.

## 에이전트 배정

- 주 세션: 구현, 검증, review, evidence.
- `explorer`/`worker`: 상위 정책 때문에 생략.

## 도구 준비 상태

- 감지 스택: JavaScript, Node.js.
- toolcheck: 설치된 runtime의 `toolcheck --root /Users/wknam/workspace/pota-harness` 통과.
- 필요한 LSP/심볼 도구: 작은 ESM formatter 변경에는 필수 아님.
- 검증 도구: Node syntax/test, npm check, package dry-run.
- 누락 도구/설치/blocker: 없음.

## 실행 가드레일

- dry-run/check: `node --test test/goal-state.test.mjs`.
- 외부 상태 변경: 없음.
- 검증 루프 예산: task당 두 번.
- 실패 처리: 한 번 진단 후 범위를 줄여 재검증하고 두 번 실패하면 blocker 기록.

## 모듈 작업

### Task goal-task-roadmap: 작업 단계와 복귀 지침 노출

- 계약: 활성 goal hook context가 전체 task roadmap, 현재 task, 곁가지 질문 뒤 복귀 지침을 제공하고 goal 미생성 구현 요청은 plan의 명시적 task 단계를 요구합니다.
- 파일: `scripts/pota-state.mjs`, `.codex-plugin/plugin.json`, `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, `README.md`, `README.ko.md`, `test/goal-state.test.mjs`, `test/packed-install.test.mjs`, `test/lifecycle.test.mjs`.
- 의존성: 기존 goal/task 상태와 hook additionalContext.
- dry-run/check: `node --test test/goal-state.test.mjs`.
- 모듈 수용: `node --test test/goal-state.test.mjs test/lifecycle.test.mjs`.
- 표면 통합: `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.

## 증거

- Dry-run/check: 구현 전 `node --test test/goal-state.test.mjs` 11/11 통과.
- 도구 준비: JavaScript/Node 정상.
- Tests: package prepack의 전체 syntax/JSON/Node test 35/35 통과.
- 모듈 수용: `node --test test/goal-state.test.mjs test/lifecycle.test.mjs` 20/20 통과. 영문·한국어에서 3단계 roadmap, 상태, 현재 task, 곁가지 질문 복귀 지침을 검증했습니다.
- 표면 통합: `npm --cache /private/tmp/pota-npm-cache pack --dry-run` 통과. 실제 tarball 설치본에서 `packed-current [active]`와 `packed-next [pending]` 단계 및 현재 task 복귀 지침을 확인했습니다.
- 최종 검토: `git diff --check` 통과. plan 범위 밖 리팩터링이 없고 기존 session ownership/Stop gate 테스트도 통과했습니다. 모든 task가 완료되고 goal final review만 남은 active 구간에도 완료 roadmap을 유지하도록 경계 사례를 보완했으며 남은 기능상 finding은 없습니다.
- 잔여 위험: Codex는 개별 hook context를 약 2,500 token으로 제한하므로 비정상적으로 많은 task나 매우 긴 제목은 UI에서 preview가 잘릴 수 있습니다. 상태 파일과 전체 hook output은 유지되며 일반적인 작은 task 분해에서는 영향이 없습니다.
- 검증 pass 수: 기준선 1회, 구현 후 모듈/표면 1회, review 경계 보완 후 두 게이트 1회 통과.
- blocker: 없음.

## 상태

- [x] 계획 완료
- [x] dry-run/check 통과
- [x] 구현 완료
- [x] 모듈 수용 통과
- [x] 표면 통합 통과
- [x] 검토 완료
