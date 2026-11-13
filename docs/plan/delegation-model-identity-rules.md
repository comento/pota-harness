# Plan: 모델 위임 규칙 4가지 개선

## Plan Phase

- Finalized: decision-complete for implementation after planned triage.
- Native UI 동기화: Claude Code 앱 task list(`update_plan`) 사용. Codex `create_goal`은 이 host에 없음.

## Goal

Pota의 모델 위임 규칙 4가지를 코드, 문서, 테스트에 반영한다.

1. Effective model에 worker가 보고한 실제 실행 모델 ID를 기록한다(보고가 없으면 별칭과 `unreported`).
2. 모델이나 effort가 바뀌는 재위임은 새 Agent 호출로만 한다(SendMessage 이어 쓰기 금지와 그 이유).
3. host task list 도구(`update_plan`, `create_goal`, `wrap_up`) 동기화는 메인 에이전트만 수행하고 worker와 서브에이전트는 건너뛴다.
4. 설계 task의 모델이 host의 strongest tier인지 완료 게이트에서 검사한다(`--allow-no-design-model` waiver는 유지).

- Plan ID: `delegation-model-identity-rules`
- Completion criteria: 4개 항목이 코드·문서·테스트에 반영되고 `npm run check` 통과, 임시 저장소에서 작업 트리의 `scripts/pota.mjs`로 실제 동작 확인, dev 대상 PR 생성. 릴리스와 npm 게시는 하지 않는다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, `cancelled`.

## Whole Work

- Outcome: 4개 규칙이 모든 정책 표면에서 같은 뜻으로 설명되고, goal CLI가 strongest가 아닌 설계 모델의 완료를 거부하며, 실제 모델 ID가 `goal stats`에 노출된다.
- Affected surfaces:
  - 코드: `scripts/pota-goal-state-validation.mjs`, `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-goal-operations-evidence.mjs`
  - 정책: `skills/pota-{plan,work}/{delegation,heavy-path}.md`, `skills/pota-plan/{SKILL,planning-rules}.md`, `agents/worker.md`, `commands/pota-plan.md`, `.agents/workflows/pota-plan.md`, `templates/work-plan.md`, `docs/model-guidance/{README,claude}.md`
  - 테스트: `test/goal-effort.test.mjs`, `test/token-efficiency.test.mjs`
- 변경하지 않는 표면: `.claude/agents/worker.md`와 `.claude/commands/*`는 설치본 리소스를 가리키는 얇은 미러라 대상이 아니다. `scripts/pota.mjs`의 locale 메시지(`test/lifecycle.test.mjs:151`이 단언)는 그대로 둔다.

## Memory Inputs

- `MEMORY.md`
- `docs/plan/heavy-design-model-routing.md` (0.4.1 설계 게이트와 "알려진 한계")
- `docs/plan/per-task-model-routing.md`, `docs/plan/dispatch-effort-enforcement.md` (tier 정의, Effective 판정)

## Model Guidance

- Applied model family: Claude. `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`.

## Complexity Triage

- Selected path: Light Path. 기존 goal 레이어에 선택 필드 2개와 CLI 옵션 2개를 더하고 기존 완료 게이트 함수를 확장하며, 나머지는 기존 정책 문서의 문구 수정이다.
- Heavy Path signals checked: 새 디렉터리/모듈/레이어 없음, 새 도메인 모델·서비스·추상화 없음(host별 strongest 값은 기존 검증 모듈의 상수 1개), 인증·세션 없음, 외부 API 없음, DB·마이그레이션 없음(schemaVersion 3 유지, 선택 필드), 동시성 없음, 다중 도메인 리팩터 없음, 추가 신중 요청 없음.
- Request checkpoint: provisional Light Path. host 판별 방식과 실제 ID 필드 여부가 미정이라 탐색 후 재판정하기로 함.
- Planning checkpoint: Light Path 유지. `ensureHeavyDesignRecorded`(scripts/pota-goal-operations.mjs:211)에 값 비교를 더하고 `assignTask`·`normalizeTask`·`goalStats`에 선택 필드를 더하는 것으로 충분함을 확인. host 판별은 새 계층 없이 선언 옵션으로 해결.
- Code checkpoint: Light Path 유지. 두 worker가 첫 수정 직전에 대상 파일·호출부·테스트를 확인했고 새 Heavy 신호와 계획과의 모순이 없다고 보고했다.

## Tool Readiness

- Stack: JavaScript(`node --test`, `npm run check`). `node`, `npm` OK.
- Missing: `basedpyright`, `ruff`(Python). 이번 변경은 JS/Markdown뿐이라 무관하며 설치하지 않는다.

## Design Decisions

### D1. 실제 모델 ID 필드 (항목 1)

- task에 선택 필드 `effectiveModel`(비어 있지 않은 문자열, 기본 null)을 추가한다. schemaVersion 3 유지, 필드 부재는 미기록이며 기존 상태 파일은 그대로 읽힌다.
- CLI: `goal assign --effective-model <id|unreported>`. 생략하면 저장된 값을 유지한다. `goal replan`은 다른 모델 필드처럼 null로 초기화한다. `goal stats`는 값이 있을 때만 `effectiveModel`을 노출한다.
- 문서 규칙: worker는 자기 시스템 프롬프트에 적힌 정확한 모델 ID를 최종 보고에 넣는다. main은 `Effective model`을 `<passed value> (<reported ID>)`로 기록하고(예: `fable (claude-fable-5-1)`), 보고에 ID가 없으면 추측하지 않고 `<passed value> (unreported)`로 기록한다.
- `goal assign`은 `model`과 `effectiveModel`이 모두 있고 `effectiveModel`이 `unreported`가 아니며 `model` 문자열을 포함하지 않으면(대소문자 무시) stderr로 경고한다. 완료를 막지는 않는다.

### D2. 설계 게이트가 검사하는 값 (항목 4)

- 게이트는 host 옵션으로 넘긴 값(`model`, 별칭 또는 slug)을 검사한다. 실제 ID(`effectiveModel`)는 검사하지 않는다.
- 근거: 정책 표가 정의하는 것은 넘기는 값이다. 실제 ID는 Claude Code 버전에 따라 바뀌고(`claude-fable-5-1` → `claude-fable-5-2`) worker의 자기 보고라서 강제 기준으로 삼으면 host 업데이트마다 게이트가 깨진다. 불일치는 D1의 경고와 `goal stats`로 드러낸다.

### D3. host 판별 (항목 4)

- 저장소 근거: 런타임은 host와 무관하게 하나의 공유 설치 경로를 쓴다(Claude Code의 runtime locator도 같은 `pluginRoot`를 가리킨다). `scripts/`에는 실행 host를 식별하는 코드가 없고 훅 payload에도 goal CLI가 쓸 host 식별자가 없다. 환경 변수 표식은 Claude Code(`CLAUDECODE`)만 이 세션에서 확인할 수 있었고 Codex·Antigravity는 저장소 근거가 없다. 환경 추측은 테스트 결과를 실행 환경에 따라 바꾸기도 한다.
- 결정: host는 추측하지 않고 선언받는다. `goal assign --host <claude-code|codex|antigravity>`가 선택 필드 `modelHost`에 저장된다(생략 시 저장 값 유지, `goal replan`은 null로 초기화, `goal stats`는 값이 있을 때만 노출).
- strongest 기준값(`delegation.md` host 표): `claude-code` → `fable`, `codex` → `gpt-6-astra`, `antigravity` → `pro`.
- 게이트(`kind: "design"` task 완료 시, `designWaiver` 없을 때):
  1. 기존 검사 유지: `model`이 있고 `modelSource === "host-option"`.
  2. `modelHost`가 있으면 `model`이 그 host의 strongest 값과 같아야 한다.
  3. `modelHost`가 없으면(host 미선언) 실패시키지 않고, `model`이 지원 host 중 하나의 strongest 값(`fable`, `gpt-6-astra`, `pro`)이면 통과한다. 세 값은 host끼리 겹치지 않고, 다른 host의 값은 dispatch에서 host가 거부하므로 이 합집합 검사로도 `opus` 같은 하위 tier 기록을 막는다.
  4. 어긋나면 완료를 거부하고 메시지에 기대값과 `--allow-no-design-model <reason>`을 안내한다.
- `--allow-no-design-model <reason>`은 지금처럼 게이트 전체를 우회한다.

### D4. 문서 문구 (항목 1~4, 모든 표면에서 같은 뜻)

- R1 실제 ID: "Model Effective is the passed value plus the exact model ID the worker reports from its own system prompt, e.g. `fable (claude-fable-5-1)`; when the report has no ID, record `<value> (unreported)` and never guess."
- R2 새 dispatch: "A subagent's model and effort are fixed at dispatch. Any re-dispatch that changes either (one tier up, Light → Heavy promotion, route-change recalculation) MUST be a new dispatch (Claude Code: a new Agent call); never continue the existing subagent with `SendMessage`, which keeps its original model and effort."
- R3 UI 동기화: "Host task-list tools (`update_plan`, `create_goal`, `wrap_up`) are called by the main agent only; a worker or subagent skips them (hosts reject them from subagents) and reports in its final report."
- R4 strongest 게이트: "A design model that is not the host's strongest tier (`--host claude-code` `fable`, `codex` `gpt-6-astra`, `antigravity` `pro`; any of the three when `--host` is omitted) fails completion unless `--allow-no-design-model <reason>`."
- 표면별 배치: R1·R2·R4는 두 `delegation.md`의 Model and Reasoning Effort Routing, `docs/model-guidance/README.md`, `docs/model-guidance/claude.md`, `templates/work-plan.md`에 넣는다. R2는 두 `heavy-path.md`의 route change 항목에도 넣고, R4는 두 `heavy-path.md`의 설계 task 항목에도 넣는다. R3는 `agents/worker.md`, `skills/pota-plan/planning-rules.md`, `skills/pota-plan/SKILL.md`(짧은 괄호 한 개), `commands/pota-plan.md`, `.agents/workflows/pota-plan.md`, 두 `delegation.md`의 lifecycle과 프롬프트 형식에 넣는다. `agents/worker.md`에는 R1(보고 의무)과 R2(자식 dispatch)도 넣는다.
- `skills/pota-plan/SKILL.md`는 9000 bytes 이하를 유지한다(현재 8901). `skills/pota-work/SKILL.md`는 수정하지 않는다.

### 테스트 계약 변경

- 기존 단언은 지우거나 약하게 하지 않는다. 기존 설계 게이트 테스트는 `fable`만 쓰므로 그대로 통과해야 한다.
- `test/goal-effort.test.mjs`의 `pickModel`과 기존 `goalStats` 기대값은 바꾸지 않는다(새 필드는 값이 있을 때만 노출).

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | light | session | session |
| `impl-goal-gate` | `general-purpose` worker | light | `sonnet` | `medium` |
| `impl-policy-docs` | `general-purpose` worker | light | `sonnet` | `medium` |
| `verify` | main | light | session | session |

두 구현 task는 `writeScope`가 겹치지 않아 같은 worktree에서 병렬로 실행한다.

## Module Tasks

### Task 0: `triage-plan`

- Requested/Effective model: session / not-applied: main이 직접 수행
- Requested/Effective reasoning effort: `medium` / not-applied: main이 직접 수행
- Required evidence: `planArtifact`, `triageDecision`

### Task 1: `impl-goal-gate`

- Requested model: `sonnet` / Requested reasoning effort: `medium`
- Effective model: `sonnet (claude-sonnet-5-5)`
- Effective reasoning effort: `medium`
- Depends on: `triage-plan`
- Write scope: `scripts`, `test/goal-effort.test.mjs`
- Contract: D1~D3을 구현한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.
- Test contract(`test/goal-effort.test.mjs`에 추가):
  - host 미선언 design task: `opus`는 완료 거부(메시지에 `fable`, `gpt-6-astra`, `pro`, `--allow-no-design-model <reason>`), `fable`·`gpt-6-astra`·`pro`는 완료.
  - `--host claude-code`: `fable` 완료, `pro`·`opus` 거부. `codex`: `gpt-6-astra` 완료, `fable` 거부. `antigravity`: `pro` 완료.
  - 거부된 non-strongest 값도 `designWaiver`로 완료된다(assign의 waiver와 완료 시 waiver 모두).
  - 잘못된 host 값은 상태 변경 없이 거부된다. 저장된 상태의 잘못된 `modelHost`와 빈 `effectiveModel`도 로드 시 거부된다.
  - `effectiveModel`: assign으로 저장, 생략 시 유지, `unreported` 허용, 공백 문자열 거부, replan 시 `effectiveModel`과 `modelHost`가 null로 초기화.
  - 새 필드가 없는 상태 파일이 그대로 로드되고 `goalStats` 출력이 기존과 같다.
  - CLI: `goal assign --host`와 `--effective-model`이 상태에 전달되고 `goal stats`가 값이 있을 때만 `modelHost`·`effectiveModel`을 노출한다. `model`과 맞지 않는 `effectiveModel`은 stderr 경고를 내고 stdout JSON은 유지된다.
  - 코드의 strongest 표가 `skills/pota-plan/delegation.md`의 표기(`fable`, `gpt-6-astra`, `pro`)와 일치한다.
- Module acceptance: `node --test test/goal-effort.test.mjs`
- Surface integration: `node --test test/goal-state.test.mjs test/goal-dag.test.mjs test/cli-contract-hardening.test.mjs`

### Task 2: `impl-policy-docs`

- Requested model: `sonnet` / Requested reasoning effort: `medium`
- Effective model: `sonnet (claude-sonnet-5-5)`
- Effective reasoning effort: `medium`
- Depends on: `triage-plan`
- Write scope: `skills`, `agents`, `commands`, `.agents`, `templates`, `docs/model-guidance`, `test/token-efficiency.test.mjs`
- Contract: D4의 R1~R4를 표면별 배치대로 넣는다. 표면 단언 테스트를 먼저 쓰고 실패를 확인한 뒤 문서를 고친다.
- Test contract(`test/token-efficiency.test.mjs`에 테스트 1개 추가):
  - R1: 두 `delegation.md`, `docs/model-guidance/README.md`, `docs/model-guidance/claude.md`, `templates/work-plan.md`, `agents/worker.md`가 exact model ID 보고와 `unreported`·never guess를 말한다.
  - R2: 같은 6개 표면과 두 `heavy-path.md`가 model/effort 변경 시 새 dispatch와 `SendMessage` 금지를 말한다.
  - R3: `agents/worker.md`, `skills/pota-plan/planning-rules.md`, `skills/pota-plan/SKILL.md`, `commands/pota-plan.md`, `.agents/workflows/pota-plan.md`, 두 `delegation.md`가 main agent only를 말하고, `update_plan`·`create_goal`·`wrap_up` 세 이름은 `agents/worker.md`, `planning-rules.md`, 두 `delegation.md`에 모두 나온다.
  - R4: 두 `delegation.md`, 두 `heavy-path.md`, `docs/model-guidance/README.md`, `docs/model-guidance/claude.md`가 `--host`와 strongest 값 불일치 시 거부, waiver를 말한다.
- Module acceptance: `node --test test/token-efficiency.test.mjs`
- Surface integration: `node --test test/lifecycle.test.mjs test/contract-parity.test.mjs test/docs-package-hardening.test.mjs`

### Task 3: `verify`

- main이 수행: 두 worker의 diff 검토, 임시 저장소에서 작업 트리 `scripts/pota.mjs` 실제 동작 확인, 이 문서의 Evidence와 `PLAN.md` 갱신, `goal finish -- npm run check`, dev 대상 PR 생성.

## Evidence

- Dispatch: 두 구현 task 모두 새 Claude Code Agent 호출에 `model: "sonnet"`, `effort: "medium"`을 넘겼고 거부되지 않았다. 두 worker는 최종 보고에 자기 시스템 프롬프트의 모델 ID `claude-sonnet-5-5`를 적었다. `verify`와 `triage-plan`은 main이 직접 수행했다(not-applied: 별도 dispatch 없음).
- 이 저장소의 goal 상태는 설치본 0.4.1 CLI가 관리하므로 `--effective-model`로는 기록하지 못했다. 실제 ID는 이 문서에만 기록했다.
- Test-first:
  - `impl-goal-gate`: 구현 전 `node --test test/goal-effort.test.mjs`가 `STRONGEST_MODEL_BY_HOST` import 오류로 실패. 상수만 더한 뒤에는 22개 중 5개(미선언 host의 `opus` 거부, host별 게이트, assign·replan, 저장 상태 검증, CLI 옵션)가 실패.
  - `impl-policy-docs`: 문서 수정 전 새 테스트가 `skills/pota-plan/delegation.md R1 exact model ID`에서 실패.
- 게이트(`goal verify`로 기록, 모두 exit 0):
  - `impl-goal-gate` module acceptance: `node --test test/goal-effort.test.mjs` (22 pass).
  - `impl-goal-gate` surface integration: `node --test test/goal-state.test.mjs test/goal-dag.test.mjs test/cli-contract-hardening.test.mjs` (54 pass).
  - `impl-policy-docs` module acceptance: `node --test test/token-efficiency.test.mjs` (16 pass).
  - `impl-policy-docs` surface integration: `node --test test/lifecycle.test.mjs test/contract-parity.test.mjs test/docs-package-hardening.test.mjs` (19 pass).
- 실사용 경로: 임시 저장소와 임시 `POTA_HOME`에서 작업 트리의 `scripts/pota.mjs`로 확인.
  - host 미선언 + `--model opus`: 완료 거부(`recorded model opus, expected fable | gpt-6-astra | pro`). 같은 task에 `--allow-no-design-model`을 주면 완료.
  - host 미선언 + `--model fable --effective-model claude-fable-5-1`: 완료. `goal stats`에 `"effectiveModel":"claude-fable-5-1"` 노출.
  - `--host claude-code` + `--model pro`: 완료 거부(`expected fable for host claude-code`). `fable`로 다시 기록하면 완료, `goal stats`에 `modelHost`와 `effectiveModel: "unreported"` 노출.
  - `--host codex` + `--model gpt-6-astra`: 완료. `--effective-model gpt-6-sol`은 stderr 경고만 낸다.
  - `--host vscode`: `modelHost must be one of: claude-code, codex, antigravity`로 거부, 상태 변경 없음.
- 최종: `npm run check` exit 0(225 pass, 0 fail), 이후 `goal finish -- npm run check`로 `finalReview` 기록. `skills/pota-plan/SKILL.md` 8934 bytes, `skills/pota-work/SKILL.md` 8908 bytes(미수정).
- 테스트 계약 변경: 없음. 기존 단언, `pickModel`, 기존 `goalStats` 기대값을 그대로 두고 테스트만 추가했다(`test/goal-effort.test.mjs` 6개, `test/token-efficiency.test.mjs` 1개).
- main 직접 수정: `skills/pota-plan/SKILL.md` step 4의 괄호 두 개를 하나로 합쳤다(검토 중 문장 정리 1건).
- 계획 대비 차이: `templates/work-plan.md`의 Model 항목에 R1 한 문장이 더 들어갔다(표면 테스트가 R1을 이 파일에서도 검사). `skills/pota-work/heavy-path.md`의 Route Changes During Work에 R2가 4번으로 들어가 기존 Quick Path 항목이 5번이 됐다.

- 버전: 사용자 요청(2026-11-10)으로 `package.json`과 `.codex-plugin/plugin.json`을 `0.5.0`으로 올리고 테스트의 현재 버전 기대값 5개 파일을 맞췄다. 버전 문자열만 바꿨고 릴리스와 npm 게시는 하지 않았다. 이후 `npm run check` 재실행 exit 0.

## 남은 한계

- 실제 모델 ID는 worker의 자기 보고다. host가 값을 검증해 주지 않으므로 게이트 기준으로 쓰지 않으며, 별칭과 어긋날 때 경고만 낸다.
- host는 선언값이다. `--host`를 생략하면 세 strongest 값 중 하나면 통과하므로, 다른 host의 strongest 값을 적어도 CLI는 막지 못한다(그 값은 dispatch에서 host가 거부한다).
- strongest 값은 코드 상수(`STRONGEST_MODEL_BY_HOST`)다. host의 tier 이름이 바뀌면 `delegation.md` 표와 함께 고쳐야 하며, 그 전까지는 waiver가 필요하다. 표에 없는 host에서 모델 옵션으로 설계를 위임한 경우도 waiver가 필요하다.
- "새 dispatch로 재위임"과 "서브에이전트의 task list 도구 생략"은 문서 규칙이며 CLI가 강제하지 않는다.
- main이 직접 수행하는 미배정 Heavy task는 기존처럼 검사 대상이 아니다.
- 설치본은 `0.5.0`이 릴리스되어 업그레이드되기 전까지 0.4.1 동작을 유지한다. 릴리스와 npm 게시는 이번 범위가 아니다.

## Status

- [x] Planned
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed
