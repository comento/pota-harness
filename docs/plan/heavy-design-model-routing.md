# Plan: Heavy Path 설계 모델 위임

## Plan Phase

- Finalized: decision-complete for implementation after planned triage.
- Native UI 동기화: Claude Code 앱 task list(`update_plan`) 사용. Codex `create_goal`은 이 host에 없음.

## Goal

Heavy Path 설계가 메인 세션의 planning에 묻혀 세션 모델로 실행되는 문제를 없앤다. 설계를 strongest tier(Claude Code `fable`)로 위임하는 별도 task로 정의하고, 위임 모델 기록이 없으면 완료할 수 없게 한다.

- Plan ID: `heavy-design-model-routing`
- Completion criteria: Heavy Path 정책 표면이 설계 task를 같은 규칙으로 설명하고, goal CLI가 설계 task의 모델 미기록과 설계 없는 Heavy task 완료를 거부하며, `npm run check` 통과.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, `cancelled`.

## Whole Work

- Outcome: `kind: "design"` task가 `--model`로 위임 모델을 기록해야 완료된다. 완료된 설계 task가 없으면 worker에 배정된 다른 `route: "heavy"` task를 완료할 수 없다.
- Affected surfaces: `scripts/pota-goal-{state-validation,operations,cli,operations-evidence}.mjs`, `skills/pota-{plan,work}/{SKILL,delegation,heavy-path}.md`, `templates/work-plan.md`, `docs/model-guidance/{README,claude}.md`, `test/goal-effort.test.mjs`.

## Memory Inputs

- `MEMORY.md`
- `docs/plan/per-task-model-routing.md` (tier 정의, "goal 상태에 model 저장"은 당시 범위 외)

## Complexity Triage

- Selected path: Light Path. 기존 goal 레이어에 선택 필드와 완료 게이트를 더하며, 새 모듈·서비스·저장소 없음.
- Heavy Path signals checked: 새 디렉터리/레이어, 새 추상화, 인증, 외부 API, DB, 동시성, 다중 도메인 리팩터, 추가 신중 요청 모두 없음.
- Request checkpoint: provisional Light Path. 사용자가 수정 범위를 승인했고 기존 goal 레이어 안의 변경.
- Planning checkpoint: Light Path 유지. `ensureHeavyEffortApplied`와 같은 패턴으로 구현 가능함을 코드에서 확인.
- Code checkpoint: Light Path 유지. worker가 `setTaskStatus`, `assignTask`, 상태 검증, CLI 옵션표와 호출 테스트를 확인했고 새 Heavy 신호 없음.

## Tool Readiness

- Stack: JavaScript(`node --test`, `npm run check`). `node`, `npm` OK. Python 도구(`basedpyright`, `ruff`) 미설치지만 이번 변경은 JS/Markdown뿐이라 무관.

## Design Decisions

1. 흐름: `plan -> Heavy design task -> pre-implementation review -> worker -> verification`. Heavy 판정 시 `goal replan`으로 `triage-plan` 뒤에 `kind: "design"` task(권장 ID `heavy-design`, `route: "heavy"`, `requiredEvidence: ["designRecord"]`)를 넣고 구현 task가 이를 `dependsOn`한다.
2. 설계 위임은 read-only이며 strongest tier(Claude Code `model: "fable"`, `effort: "high"`, `fork` 금지)로 보낸다. 결과는 계획의 `## Heavy Design`에 main이 반영하고 `goal verify --kind designRecord`로 그 계획 파일을 묶는다.
3. 상태 필드(선택, schemaVersion 3 유지, 부재=미기록): `kind`(`design`|null), `model`, `modelSource`(effort와 같은 `host-option|inherited|not-applied`), `designWaiver`.
4. CLI: `goal assign --kind design --model <value> --model-source <source>`, `--allow-no-design-model <reason>`(`goal assign`, `goal task` 완료 시). tasks JSON에서 `kind` 허용.
5. 완료 게이트 `ensureHeavyDesignRecorded`:
   - `kind: "design"` task는 `model`이 있고 `modelSource`가 `host-option`이어야 완료 가능.
   - 그 외 `route: "heavy"` + `assignedAgentId`가 있는 task는 완료된 design task가 있어야 완료 가능.
   - 어느 쪽이든 `designWaiver`가 있으면 통과. Light와 main-agent 미배정 task는 기존 effort 게이트처럼 검사하지 않는다.
6. 모델 값은 host별로 달라(`fable`, Codex/Antigravity tier) 특정 이름을 강제하지 않는다. Requested/Effective 기록과 strongest tier 지시로 다룬다.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `implement` | `general-purpose` worker | light | `sonnet` | `medium` |
| `verify` | main | light | session | session |

## Module Tasks

### Task: `implement`

- Requested model: `sonnet` / Requested reasoning effort: `medium`
- Test contract(`test/goal-effort.test.mjs`): design task의 model 미기록 완료 거부, host-option 기록 시 완료, not-applied/inherited는 waiver 필요, 설계 없는 배정 Heavy task 완료 거부와 waiver 통과, Light 무영향, 잘못된 `kind`/source 거부, 레거시 상태 로드, replan의 model 필드 초기화, CLI 플래그 전달, `goal stats` 노출(값이 있을 때만).
- Module acceptance: `node --test test/goal-effort.test.mjs`
- Surface integration: `node --test test/lifecycle.test.mjs test/token-efficiency.test.mjs test/contract-parity.test.mjs`
- Constraints: `skills/*/SKILL.md` 9000 bytes 예산, 기존 테스트의 단언 의미 유지.

### Task: `verify`

- `npm run check`로 전체 확인 후 `goal finish`.

## Evidence

- Effective model/effort: `implement`는 Claude Code Agent 호출에 `model: "sonnet"`, `effort: "medium"` 전달, 거부 없음. `verify`는 main 세션이 직접 수행(not-applied: 별도 dispatch 없음).
- 게이트: `node --test test/goal-effort.test.mjs`, `node --test test/lifecycle.test.mjs test/token-efficiency.test.mjs test/contract-parity.test.mjs`를 `goal verify`로 기록.
- 실사용 경로: 임시 저장소에서 작업 트리의 `scripts/pota.mjs`로 설계 없는 Heavy 완료 거부, 모델 미기록 설계 완료 거부, 기록 후 설계·구현 완료, replan 후 설계 유지, `goal stats` 노출을 확인.
- 최종: `goal finish -- npm run check` exit 0. `skills/pota-plan/SKILL.md` 8901 bytes, `skills/pota-work/SKILL.md` 8908 bytes.
- 알려진 한계: 모델 이름은 host별로 달라 강제하지 않으므로 `--model opus`로 기록해도 게이트는 통과한다. main이 직접 수행하는 미배정 Heavy task도 기존 effort 게이트처럼 검사 대상이 아니다. 설치본은 이 변경이 릴리스되어 업그레이드되기 전까지 0.4.0 동작을 유지한다.
- 테스트 계약 변경: `test/token-efficiency.test.mjs:372`의 Heavy flow 정규식을 새 흐름 문구로 교체. `test/goal-effort.test.mjs`에서 배정된 Heavy task를 완료하는 기존 fixture는 새 게이트의 대상이므로 `designWaiver` 또는 `--allow-no-design-model`을 추가했고, 각 테스트의 단언은 유지.
