# Plan: DAG 패널에서 막힌 task 재시도, Pota 2.5.0 릴리스

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation (triage 완료).
- Codex UI synchronization: `update_plan`·`create_goal` unavailable (Claude Code 세션, 해당 도구 없음).

## Goal

막힌(`blocked`) task만 다시 배정 대상으로 되돌리는 동작을 CLI와 세 호스트의 DAG 패널에 넣고 2.5.0으로 배포한다.

- Goal ID: `goal-dag-retry-blocked-task`
- Plan ID: `plan-dag-retry-blocked-task`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria (advisory): `goal retry`와 패널 재시도 버튼이 테스트와 실제 CLI·MCP 실행으로 확인되고, 버전 표면 4곳이 2.5.0이며, dev·main PR이 병합되고 이 컴퓨터의 Claude Code 설치본이 2.5.0이다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Request Brief

- Original request: 실패한 task의 DAG 재배정도 구현해야지!
- Interpreted outcome: 2.4.0 계획(`docs/plan/omo-inspired-gates.md`)에서 Non-scope로 뺀 "DAG 패널의 실패 task 재배정"을 구현하고, 그 요청의 릴리스 범위(버전 범프, dev PR 병합, main PR 병합, 로컬 반영)를 그대로 적용한다.
- Scope: goal 상태 연산 `retryTask`, CLI `goal retry`, MCP `pota_dag_action`의 `retry_task`, MCP App HTML과 Claude Code mod의 재시도 버튼, `pota-work` 복구 문구, README 8개, 메모리 노트, 버전 표면 4곳, 릴리스.
- Non-scope: 완료된 task 재실행, 패널에서 모델 tier 고르기, 자동 재시도(사람이 누르거나 orchestrator가 명령할 때만), task 상태 `failed` 신설(상태 schema는 바꾸지 않음), npm 게시.
- Prior records: `docs/plan/omo-inspired-gates.md`(제안 6 "DAG의 부분 복구", Evidence "DAG 재배정: retry·reassign 동작 없음"), `docs/plan/chatgpt-codex-dag-panel.md`(HITL 동작 `pause`/`resume`/`toggle_gate`), `docs/memory/goal-state.md`, `docs/memory/policy-surfaces.md`, `docs/memory/release-process.md`.
- Assumptions:
  - A1 (inferred): "실패한 task"는 Pota의 `blocked` task다. task 상태는 `pending`·`active`·`blocked`·`completed` 넷뿐이다. 출처: `scripts/pota-goal-state-validation.mjs:7`.
  - A2 (inferred): 릴리스 범위는 직전 요청과 같다(dev PR 병합, main PR 병합, 태그, 로컬 반영). 출처: 직전 요청 원문 "적합한 것들을 모두 구현해서 더하고, 버전 범프해서 dev pr 머지, main pr 머지, 로컬반영까지 해줘"와 이번 요청 "도 구현해야지".
  - A3 (inferred): 새 기능이므로 2.5.0(minor)이다.
  - A4 (inferred): "재배정"은 이전 배정 기록을 지우고 orchestrator가 새 worker를 dispatch하게 하는 것이다. 패널은 worker를 직접 띄울 수 없다(호스트의 agent 도구는 모델만 호출).
- Implicit requirements: 완료된 task와 그 영수증은 건드리지 않는다(재시도 대상 task의 영수증만 지운다). `pota_dag_action`은 등록된 워크스페이스에서만 동작한다(기존 규칙). 패널 문구는 한국어·영어 둘 다. Codex·ChatGPT Desktop 실제 화면은 이 컴퓨터에서 확인할 수 없으므로 MCP 프로토콜 테스트와 HTML 정적 검사로 확인한다.
- Open questions: none
- Steering log: (none)
- Current request (as of S0): 막힌 task를 DAG 패널과 CLI에서 재시도(재배정)할 수 있게 하고 2.5.0으로 배포한다.

## Whole Work

- Outcome: `goal retry --task <id>`와 패널의 재시도 버튼이 들어간 2.5.0이 `main`에 있고 로컬에 반영된다.
- Affected surfaces: `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-dag-app-html.mjs`, `hooks/register.tsx`, `hooks/dag-events.mjs`, `hooks/dag-text.mjs`, `skills/pota-work/recovery.md`, README 8개, `docs/memory/`, 버전 표면 4곳, `test/`, `tests/`.
- Task classification: 코어 1개(`retry-core`), UI 1개(`retry-ui`), 문서·버전 1개(`docs-version`). 세 task는 파일이 겹치지 않고 계약이 아래에 고정돼 있어 병렬이다. 이어서 `verify`, `release`.

### Design decisions (triage)

1. **연산 `retryTask({ root, taskId })`** (`scripts/pota-goal-operations.mjs`, 단일 lock):
   - goal이 `cancelled`·`completed`면 기존 `assertGoalMutable` 오류. task가 `blocked`가 아니면 `Task <id> is <status>; only a blocked task can be retried` 오류.
   - task: `status = "pending"`, `blocker = null`, 배정 기록 초기화(`assignedAgentId`, `effort`, `effortSource`, `model`, `modelSource`, `effectiveModel`, `modelHost`를 `null`), 그 task의 task-scope 영수증 삭제(`goal replan`이 미완료 task의 영수증을 지우는 것과 같다). `route`·`kind`·`approvalGate`·`requiredEvidence`·waiver, 다른 task의 영수증은 그대로 둔다. 영수증이 없으므로 완료하려면 검증을 다시 기록해야 한다. Heavy effort·design 게이트는 `assignedAgentId`가 없으면 검사하지 않으므로 새 dispatch 기록 자체를 강제하지는 않는다(리뷰에서 확인, 문구로 지시).
   - goal: `blocked`이고 `goal.blocker`가 어떤 blocked task의 사유이거나 `advanceGoal`의 기본 문구일 때만 `active`로 되돌린다. `goal block --reason`으로 사람이 막은 goal은 그대로 두고 task만 `pending`으로 돌린다(풀려면 `goal resume`). `paused`도 그대로 둔다.
   - goal이 `active`면 `advanceGoal(state, null)`을 호출한다. 활성 task가 없을 때 준비된 첫 비게이트 task가 활성화되고, 실행할 수 있는 task가 없으면(의존성이 막힘) 남은 blocked task의 사유로 다시 `blocked`가 된다.
2. **CLI `goal retry --task <id>`**: `GOAL_COMMANDS`, 도움말 한 줄, `allowedOptions`(`task`), `hooks/dag-events.mjs`의 `MUTATING_SUBS`에 `retry` 추가. 출력은 다른 변경 명령처럼 상태 JSON.
3. **MCP `pota_dag_action`의 `retry_task`**: `taskId` 필수, `enabled` 불가. 허용 목록·schema enum·설명·오류 문구(`expected pause, resume, toggle_gate, or retry_task`)에 추가.
4. **패널 버튼**: `blocked` task의 인스펙터에만 "재시도"/"Retry" 버튼. HTML은 `runDagAction("retry_task", task.id)`, Claude Code mod는 `goal retry --task <id>` 실행(게이트 버튼과 같은 경로). goal이 끝났으면 버튼 없음.
5. **정책 문구**: `skills/pota-work/recovery.md`에 "재시도로 `pending`/`active`가 된 task는 새 worker로 dispatch하고 `goal assign`을 다시 기록한다. 같은 원인으로 다시 막히면 tier 한 단계 승격 규칙을 따른다"를 넣는다. orchestrator 스스로도 원인을 고친 뒤 `goal retry`를 쓸 수 있다.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/goal-state.md`, `docs/memory/policy-surfaces.md`, `docs/memory/release-process.md`, `docs/memory/lifecycle-install.md`
- Related completed plans: `docs/plan/chatgpt-codex-dag-panel.md`, `docs/plan/omo-inspired-gates.md`

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- Rationale: Claude Code 세션이다.
- Role-specific adjustment: worker에는 계약·파일 범위·검증 명령만 준다.
- User-visible response and artifact locale: 한국어(스킬·README.md·코드 문구는 저장소의 기존 언어).

## Reasoning Effort Profile

- Light Path: 구현 `sonnet`/`medium`, 최종 리뷰 `opus`/`high`.
- 계획·triage는 main 세션에서 수행했다.

## Tool Readiness

- `pota toolcheck --root .` 결과는 Evidence에 적는다.

## Complexity Triage

- Request checkpoint: Light(잠정). 기존 goal 연산·CLI·패널 계층 안의 동작 추가.
- Planning checkpoint: Light. Heavy 신호 확인: 새 디렉터리·모듈·계층 없음, 새 도메인 모델·추상화 없음(상태 schema 불변), 보안·인증 없음, 외부 API 없음, DB 없음, 동시성은 기존 `mutateGoal` lock 재사용, 다중 도메인 리팩터 없음, 사용자의 신중 요청 없음.
- Code checkpoint: Light 유지(첫 편집 직전 확인, 변경 없음).
- Selected path: Light Path.

## Agent Assignments

| Task | Agent | Requested model/effort | Effective |
| --- | --- | --- | --- |
| `retry-core` | `pota:worker` | `sonnet` / `medium` | Evidence에 기록 |
| `retry-ui` | `pota:worker` | `sonnet` / `medium` | Evidence에 기록 |
| `docs-version` | `pota:worker` | `sonnet` / `medium` | Evidence에 기록 |
| `verify` | 읽기 전용 리뷰어 | `opus` / `high` | Evidence에 기록 |
| `release` | main | - | - |

## Module Tasks

### `retry-core`

- Write scope: `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-dag-mcp-core.mjs`, `hooks/dag-events.mjs`, `test/goal-retry.test.mjs`, `test/antigravity-dag-mcp.test.mjs`.
- Contract: Design decisions 1~3.
- Check 1 (`moduleAcceptance`): `node --test test/goal-retry.test.mjs`
- Check 2 (`surfaceIntegration`): `node --test test/goal-state.test.mjs test/goal-dag.test.mjs test/antigravity-dag-mcp.test.mjs test/cli-contract-hardening.test.mjs`

### `retry-ui`

- Write scope: `scripts/pota-dag-app-html.mjs`, `hooks/register.tsx`, `hooks/dag-text.mjs`, `hooks/dag-text.d.mts`, `tests/pane.test.tsx`, `test/dag-retry-ui.test.mjs`.
- Contract: Design decision 4.
- Check 1 (`moduleAcceptance`): `node --test test/dag-retry-ui.test.mjs`
- Check 2 (`surfaceIntegration`): `npm run typecheck`가 있으면 그것, 없으면 `package.json`의 mod 검사 스크립트(worker가 확인해 보고).

### `docs-version`

- Write scope: `skills/pota-work/recovery.md`, README 8개, `docs/memory/goal-state.md`, `docs/memory/policy-surfaces.md`, `MEMORY.md`, 버전 표면 4곳, `test/contract-parity.test.mjs`, `test/token-efficiency.test.mjs`.
- Contract: Design decision 5, 버전 2.5.0.
- Check 1 (`moduleAcceptance`): `node --test test/contract-parity.test.mjs test/token-efficiency.test.mjs test/plugin-manifests.test.mjs`
- Check 2 (`surfaceIntegration`): `node scripts/pota.mjs doctor`

### `verify`

- Check 1 (`moduleAcceptance`): `npm run check`
- Check 2 (`surfaceIntegration`): 임시 저장소·임시 `POTA_HOME`에서 `goal retry` 실제 실행 스크립트(Evidence에 명령 기록), 그리고 읽기 전용 리뷰.

### `release`

- dev PR, main PR, 태그 `v2.5.0`, 로컬 브랜치·설치본 갱신. Check (`surfaceIntegration`): 새 설치본 `doctor`.

## Learnings

- L1 (retry-core): `scripts/pota-goal.mjs`는 operations를 명시 목록으로 import·주입·재export한다. 새 goal 명령은 이 파일 세 곳과 `test/cli-contract-hardening.test.mjs`의 도움말 고정 문구(`goalUsage`)를 함께 고쳐야 한다. 계획의 write scope에서 빠져 worker가 `ESCALATE:`로 올렸고 orchestrator가 반영했다.
- L2 (retry-ui): `hooks/register.tsx`와 `tests/pane.test.tsx`는 `tsc` 타입 검사 대상이지만 저장소에 실행 경로가 없다. mod 버튼 동작은 타입 검사와 정적 문자열 테스트로만 확인된다.
- L3 (verify): Heavy effort·design 게이트는 `assignedAgentId`가 없으면 검사하지 않는다. 배정 기록을 지우는 것만으로는 새 dispatch 기록을 강제하지 못하므로 재시도는 그 task의 영수증을 지워 재검증을 요구한다.
- L4 (verify): `transitionGoal`은 같은 상태로의 전이가 no-op이라 이미 blocked인 goal의 blocker를 바꾸지 못한다.

## Evidence

- Tool readiness: `pota toolcheck --root .` → node, npm, typescript-language-server, tsc 모두 OK.
- Dispatch: `retry-core`·`retry-ui`·`docs-version`·리뷰 반영 worker 모두 Requested `sonnet`/`medium`, Effective `claude-sonnet-5-5`. 리뷰는 Requested `opus`/`high`.
- Escalation: `retry-core` worker가 write scope 밖 파일 2개(`scripts/pota-goal.mjs`, `test/cli-contract-hardening.test.mjs`)가 필요하다고 올렸다. tier 문제가 아니라 계획의 범위 누락이어서 승격하지 않고 orchestrator가 두 파일을 직접 고쳤다(L1).
- Surface: 임시 저장소·임시 `POTA_HOME`에서 `goal retry --task a`(blocked → active, 배정 기록 null, goal blocked → active), blocked가 아닌 task 거부, `pota-dag-mcp.mjs --host codex`에 `tools/call pota_dag_action {action: "retry_task"}`(상태 payload 반환) 확인.
- Final review: `opus` 읽기 전용 리뷰, 첫 판정 `VERDICT: request-changes`(7건). 반영: 재시도 task의 영수증 삭제, 사람이 `goal block`으로 막은 goal 유지, 실행할 task가 없으면 다시 blocked, 테스트 단언 보강(배정 필드·보존 필드·영수증·세 경계 경우), README·recovery·메모리 문구 정정, pane 부정 단언 위치. 남긴 것: ended goal에서 버튼이 없는 pane 테스트(코드 조건 `state.ended === null`은 있음), Claude mod에서 쓰이지 않는 `retryHint` 문구. 반영 뒤 재리뷰는 하지 않았고 orchestrator가 최종 `retryTask` diff를 직접 읽었다.
- Not verified: Codex·ChatGPT Desktop·Antigravity·Claude Code의 실제 패널 화면에서 버튼을 눌러 보지 못했다.
- Memory promotion: docs/memory/goal-state.md, docs/memory/policy-surfaces.md
- Tests: `npm run check` → tests 574, pass 574, fail 0.

## Status

- [x] `triage-plan`
- [x] `retry-core`
- [x] `retry-ui`
- [x] `docs-version`
- [x] `verify`
- [x] `release`
