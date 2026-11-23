# Plan: DAG 창에서 실행 중인 task 열기 (Pota 2.1.0)

## Plan Phase

- Finalized: decision-complete for implementation after planned triage.
- Codex UI synchronization: 해당 없음(Claude Code 세션). 앱 task 목록은 `update_plan`으로 맞춘다.

## Goal

DAG 창의 "실행 중" 카드를 누르면 그 task를 맡은 서브에이전트의 대화가 본 화면에 열린다. 서브에이전트 없이 main이 하는 task는 창 안에서 상세가 펼쳐진다.

- Runtime resources: `pota://` 자원. 사용자별 절대 경로를 기록하지 않는다.
- Completion criteria: 실행 중 카드를 눌러 에이전트 대화가 열리고 main으로 돌아올 수 있으며, `npm run check`와 `claude plugin test .`가 통과하고 2.1.0이 `main`에 있다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`

## Request Brief

- Original request: "dag 그래프를 보다가 문득 든 생각인데, 현재 실행중인 부분을 클릭하면 해당 내용을 볼 수 있게 할 수 있을까?" → "2.0.0 뒤에 진행" → "시작"
- Interpreted outcome: 실행 중인 task를 누르면 그 task가 지금 하는 일을 볼 수 있다.
- Scope: Claude mod(`hooks/register.tsx`, `hooks/dag-text.mjs`와 타입, `types/index.d.ts`), 그 테스트, 버전 표면 4개(2.1.0), 창 동작을 설명하는 문서가 있으면 그 문장.
- Non-scope: 그래프(SVG) 노드 직접 클릭. `Svg`의 `isInteractive`는 hover·tooltip만 열고 누름 이벤트를 주지 않는다(mod API 2.1.330 타입 `SvgProps`). Codex·Antigravity에는 mod가 없다. goal 상태 schema는 바꾸지 않는다.
- Prior records: `docs/plan/plugin-native-install.md`의 Request Brief 후속 항목. `docs/plan/dag-pane-claude-mod.md` 계열의 DAG 창 계획.
- Assumptions:
  - A1 (confirmed): 누름 동작은 "에이전트 대화 열기". main이 직접 하는 task는 창 안 상세. 사용자가 질문에서 선택했다.
  - A2 (confirmed): 릴리스 범위는 `main`까지 2.1.0(dev PR, main PR, 태그 `v2.1.0`, 이 컴퓨터 플러그인 업데이트와 실제 창 확인).
  - A3 (evidence): `$.ui.view({ agentId })`는 사람의 입력(누름)에 답하는 호출에서만 되고, `{}`로 main에 돌아온다. `agentId`는 `$.agent.list()`의 `id`다(mod API 타입).
  - A4 (evidence): 실행 중 카드는 이미 task와 에이전트를 연결한다(`hooks/dag-events.mjs`의 배정 규칙, `hooks/dag-text.mjs`의 `who`).
- Implicit requirements: 끝난 에이전트나 거부(`{ deny }`)는 조용히 실패하지 않고 사유를 보여 준다. 저장된 `dagUi` 값의 모양이 바뀌면 `shape`로 옛 값을 처리한다.
- Open questions: none
- Steering log:
- Current request (as of S0): DAG 창의 실행 중 카드를 누르면 맡은 서브에이전트의 대화를 본 화면에 열고, main이 하는 task는 창 안에서 상세를 펼친다. 2.1.0으로 `main`까지 릴리스한다.

## Whole Work

- Outcome: 실행 중 카드의 제목이 버튼이 된다. 누르면 `$.ui.view({ agentId })`. 에이전트 화면을 보는 동안 창에 "메인으로" 버튼이 나온다. 에이전트가 없는 task는 상세(수정 범위, 모델·effort, 선행 task, 증거)를 펼치고 접는다.
- Affected surfaces: `hooks/register.tsx`, `hooks/dag-text.mjs`, `hooks/dag-text.d.mts`, `types/index.d.ts`, `tests/pane.test.tsx`, `test/claude-mod*.test.mjs`, 버전 표면 4개와 버전을 고정한 테스트, `docs/memory`의 DAG 창 설명(있으면).
- Task classification: Light Path. 기존 mod 안의 좁은 변경이고 새 모듈·모델이 없다.

## Memory Inputs

- `MEMORY.md`, `docs/memory/policy-surfaces.md`(버전 표면), `docs/memory/release-process.md`(2.x 릴리스 절차)

## Complexity Triage

- Selected path: Light Path.
- Checkpoint ledger:
  - Request checkpoint: Light. 기존 창에 버튼을 다는 변경.
  - Planning checkpoint: Light 유지. mod API에 `$.ui.view`가 있고 task–에이전트 연결이 이미 있다. Heavy 신호 없음.
  - Code checkpoint: Light 유지. worker가 첫 수정 전에 `runningSections`와 Pane hook을 확인한다.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `implement` | `worker` | `light` | `opus` | `medium` |
| `verify` | main + reviewer | `light` | `opus` | `medium` |
| `release` | main | `light` | (main) | (main) |

## Module Tasks

### implement

- writeScope: `hooks/register.tsx`, `hooks/dag-text.mjs`, `hooks/dag-text.d.mts`, `types/index.d.ts`, `tests/pane.test.tsx`, `test/claude-mod.test.mjs`, `test/claude-mod-root.test.mjs`, `test/claude-mod-term.test.mjs`, `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugin.json`, `test/contract-parity.test.mjs`, `test/plugin-manifests.test.mjs`, `test/doctor.test.mjs`, `test/session-start-migration.test.mjs`, `docs/memory/`
- 검증 1: `node --test test/claude-mod.test.mjs test/claude-mod-root.test.mjs test/claude-mod-term.test.mjs test/contract-parity.test.mjs test/plugin-manifests.test.mjs`
- 검증 2: `npm run check`

### verify

- 임시 `CLAUDE_CONFIG_DIR`에서 `claude plugin validate .`와 `claude plugin test .`, 읽기 전용 리뷰.

### release

- dev PR → main PR(CI 통과 후 head SHA 고정 병합) → 태그 `v2.1.0` → `claude plugin marketplace update pota-harness`와 `claude plugin update pota@pota-harness`, 실제 DAG 창에서 누름 확인(이 세션은 옛 버전을 불러온 상태라 새 세션이 필요하면 사용자 확인으로 남긴다).

## Evidence

- (기록 예정)

## Status

- [x] Planned
- [ ] Implemented
- [ ] Module acceptance passed
- [ ] Surface integration passed
- [ ] Reviewed
- [ ] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
