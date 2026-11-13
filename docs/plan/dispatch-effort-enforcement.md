# Plan: dispatch 시 추론 강도 실제 적용과 검증

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation after planned triage.
- UI synchronization: Claude Code 데스크톱 `update_plan` 사용. Codex `create_goal`은 이 host에 없음.

## Goal

Pota의 추론 강도 배분이 기록에서 끝나지 않고 작업 dispatch마다 host 옵션으로 실제 전달·검증되게 한다. Claude Code를 1급 host로 지원한다.

- Plan ID: `dispatch-effort-enforcement`
- Completion criteria:
  - Claude Code에서 Heavy Path 워커 dispatch 시 Agent 호출에 `effort: "high"`가 들어간다(이 작업 자체의 워커 dispatch transcript로 확인).
  - effort 없이 assign한 Heavy task는 `goal task --status completed`에서 실패하고 `--allow-inherited-effort <reason>`으로만 통과한다.
  - `templates/work-plan.md`에 `inherited`가 기본값으로 미리 채워지지 않는다.
  - 기존 Codex 동작과 Light Path(`medium`) 동작을 유지한다.
  - assign 시 effort 저장, completed 시 검사, stats 출력 단위 테스트가 있다.
- Required goal evidence: `finalReview`

## Whole Work

- Outcome: 스킬·delegation·템플릿·model guidance의 명령형 effort 규칙과 host 매핑, goal 상태의 task별 effort/source 저장과 Heavy 완료 게이트.
- Affected surfaces: `skills/pota-plan/*`, `skills/pota-work/*`, `templates/work-plan.md`, `docs/model-guidance/*`, `agents/worker.md`, `scripts/pota-goal*.mjs`, `scripts/pota-state*.mjs`, `test/*`.
- 범위 외: 모델 배분 정책(요청 6번, 선택·정책 결정 필요). "Models always inherit"를 그대로 유지하고 사용자 결정을 받는다.

## Memory Inputs

- `MEMORY.md`

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`

## Reasoning Effort Profile

- Model: inherited.
- Heavy Path: planning/review=`high`, implementation=`high`, final verification/review=`xhigh`.
- Host: Claude Code Agent 도구 `effort` 파라미터로 전달. fork는 사용하지 않는다.

## Complexity Triage

- Selected path: Heavy Path.
- Request checkpoint: Heavy(goal 상태에 task 필드 추가, 완료 게이트 변경).
- Planning checkpoint: Heavy 유지. 상태 스키마에 선택 필드 추가(버전 증가 없이 하위 호환), 완료 게이트 정책 변경.
- Code checkpoint: 각 worker가 파일·호출자·테스트 확인 후 첫 편집 직전 기록.
- Heavy Path signals checked:
  - New directory/module/layer: 없음
  - New domain model/service/abstraction: task 상태 필드(effort, effortSource, route, effortWaiver) 추가
  - Security/auth/session: 없음
  - External API/message queue/payment: 없음
  - DB schema/migration: goal state JSON 필드 추가(하위 호환 선택 필드)
  - Concurrency/transaction/cache invalidation: 없음(기존 lock 경로 재사용)
  - Cross-domain refactor: 문서·스크립트 동시 변경
  - Explicit extra-care signal: 실사용 사고 재발 방지
- Pre-implementation decisions:
  - Heavy 판정: task JSON의 선택 필드 `route: "light"|"heavy"`(start/replan)와 `goal assign --route`. 상태에는 `route`(null 허용).
  - `goal assign --effort <low|medium|high|xhigh|max|inherited> --effort-source <host-option|inherited|not-applied>`; source 생략 시 effort가 `inherited`면 `inherited`, 그 외는 `host-option`. `inherited` effort는 source `inherited`만 허용, `host-option`은 구체 값만 허용.
  - Heavy task를 assign할 때 effort가 없거나 source가 `not-applied`면 stderr 경고.
  - `goal task --status completed`: route=`heavy`이고 assign된(assignedAgentId 있음) task가 effort 없음 또는 source `not-applied`/`inherited`이면 실패. `--allow-inherited-effort <reason>`(assign 또는 task 명령)으로 사유를 기록해야 통과. 미assign(main agent 직접 수행) task는 검사하지 않는다.
  - `goal stats`에 `tasks: [{id, route, effort, effortSource}]` 추가.
  - Stop·SubagentStop 차단 메시지: assign된 활성 task의 effortSource가 비어 있으면 한 줄 경고 추가.

## Agent Assignments

| Task | Agent | dispatch effort |
| --- | --- | --- |
| `triage-plan` | main | inherited (main session) |
| `docs-effort-rules` | `worker` (Claude Code Agent) | `high` |
| `goal-effort-state` | `worker` (Claude Code Agent) | `high` |
| `verify` | main + review | `xhigh` 요청 |

## Tool Readiness

- Detected stack: Node.js ESM, `node --test`.
- Required verification: `npm test`, `npm run check`, `npm pack --dry-run`.
- Missing tools: 없음.

## Module Tasks

### Task 0: planned triage

- Task ID: `triage-plan`
- Requested reasoning effort: `high`
- Effective reasoning effort: inherited: main session (host가 main 세션 effort를 task 단위로 바꾸는 옵션을 노출하지 않음)

### Task 1: 문서·스킬 effort 규칙

- Task ID: `docs-effort-rules`
- Requested reasoning effort: `high`
- Effective reasoning effort: dispatch 결과로 기록
- Write scope: `skills`, `templates`, `docs/model-guidance`, `agents`
- Contract: 요청 1·2·3·5항. 명령형 규칙, skill instruction 명시 문장, host 매핑 표, Effective 판정 규칙, 템플릿 기본값 제거와 dispatch effort 열, Builder Prompt `REASONING EFFORT` 줄, claude.md 예시와 fork 주의. 모순되는 기존 `inherited` 설명(model-guidance README/codex, agents/worker.md)만 최소 정렬.
- Module acceptance: `npm test`
- Surface integration: `npm pack --dry-run`에 변경 파일 포함 확인

### Task 2: goal 상태 effort 저장·게이트

- Task ID: `goal-effort-state`
- Requested reasoning effort: `high`
- Effective reasoning effort: dispatch 결과로 기록
- Write scope: `scripts`, `test`
- Contract: 요청 4항과 위 Pre-implementation decisions. 단위 테스트 추가.
- Module acceptance: `npm test`
- Surface integration: `npm run check`

### Task 3: 최종 검증

- Task ID: `verify`
- Requested reasoning effort: `xhigh`
- Contract: 전체 diff 리뷰, `npm run check`, 수용 기준 대조.

## Evidence

- Effective reasoning effort:
  - `docs-effort-rules`: `high` (Claude Code Agent 호출에 `effort: "high"` 전달, 거부 없음)
  - `goal-effort-state`: `high` (Claude Code Agent 호출에 `effort: "high"` 전달, 거부 없음)
  - `verify`: not-applied: 최종 리뷰를 별도 dispatch 없이 main 세션이 직접 수행
  - goal 상태 기록: 이 goal은 설치본 0.3.0 CLI로 운영해 `--effort` 옵션이 없었다. 새 CLI는 아래 smoke로 검증.
- 범위 추가: `README.md`, `README.ko.md`의 "`Effective: inherited`는 override 미확인일 뿐" 문장이 새 규칙과 모순돼 해당 문장만 정렬. `test/lifecycle.test.mjs`의 옛 정책 문구 정규식을 새 정책 문구 검사 2개로 교체(정책 변경에 따른 계약 갱신).
- 모듈 검사: `node --test test/contract-parity.test.mjs test/docs-package-hardening.test.mjs` 통과; `node --test test/goal-effort.test.mjs test/goal-state.test.mjs test/goal-dag.test.mjs test/lifecycle.test.mjs` 통과.
- 전체 검사: `npm run check` 212/212 통과.
- Smoke(격리 `POTA_HOME`, 소스 CLI): Heavy task를 effort 없이 assign → stderr 경고, `goal task --status completed` 실패(해결 방법 포함 메시지), `goal assign --effort high` 후 `goal stats`에 `effort: high, effortSource: host-option` 출력, 완료 성공.
- Package: `npm pack --dry-run` 95 files, prepack check 통과.
- 모델 배분(요청 6번): 2026-11-09 사용자 결정으로 상속 고정을 철회하고 작업별 결정으로 변경. [per-task-model-routing](per-task-model-routing.md)이 대체.

## Status

- [x] Planned
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed
