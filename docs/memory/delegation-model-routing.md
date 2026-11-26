# Domain: delegation-model-routing

Summary: 작업별 모델 4-tier·호스트별 값, effort 라우팅, dispatch 기록과 완료 게이트(effort·설계 모델). 위임 규칙이나 goal assign을 바꿀 때 읽는다.
Paths: scripts/pota-model-tier.mjs, scripts/pota-model-ceiling.mjs, skills/pota-plan/delegation.md, skills/pota-work/delegation.md

## Scope

위임 정책 정본 `skills/pota-plan/delegation.md`(work 쪽은 `skills/pota-work/delegation.md`)와 이를 강제하는 `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-goal-policy.mjs`. 문구를 옮길 표면은 `policy-surfaces.md`.

## Facts

### 모델 tier와 effort

| tier | 용도 | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- | --- |
| fast | 읽기 전용 탐색·요약 | `haiku` | `gpt-6-luna` | `flash_lite` |
| balanced | Light 구현·일상 검증 | `sonnet` | `gpt-6.1-terra` | `flash` |
| stronger | 계획·트리아지·Heavy 구현·리뷰·최종 검증 | `opus` | `gpt-6-sol` | `pro` |
| strongest | Heavy 설계만 | `fable` | `gpt-6-astra` | `pro` |

출처: `skills/pota-plan/delegation.md` "Model and Reasoning Effort Routing". 코드 정본은 `scripts/pota-model-tier.mjs`의 `MODEL_TIER_BY_HOST`이고, `STRONGEST_MODEL_BY_HOST`는 그 strongest 열에서 파생돼 `scripts/pota-goal-state-validation.mjs`가 re-export한다. 두 `delegation.md`의 4-tier 전체는 `test/main-model-gate.test.mjs` "the code tier table matches both delegation.md routing sections"가, strongest 값은 `test/goal-effort.test.mjs` "the code strongest table matches…"가 검사한다.

- effort: Light 계획·구현·검증 `medium`, Heavy 계획·리뷰·구현 `high`, 최종 검증·리뷰 `xhigh`. 허용 값은 `low|medium|high|xhigh|max`와 `inherited`다. 출처: 같은 절, `pota-goal-state-validation.mjs:25-27`.
- 모든 새 dispatch는 effort와 model을 host 옵션으로 넘긴다. Claude Code는 Agent `effort`·`model`이다. `subagent_type: "fork"`는 둘 다 무시하므로 라우팅된 작업에 쓰지 않는다. Antigravity 기본 위임은 `invoke_subagent`(`Model` tier enum만 있고 effort 옵션이 없어 effort가 `inherited`)이며, `swarm` 도구가 있는 환경에서 구체 모델·effort 접미사(`-medium`, `-high`, `-xhigh`) 지정이 필요할 때는 선택적으로 `swarm(action: "models")` 확인 후 `swarm(action: "add", model: ...)`로 dispatch하고 `goal assign --model <value> --model-source host-option --host antigravity`로 기록할 수 있다.
- Effective 판정: 넘기고 거부되지 않았으면 요청값이다. 넘기지 않았으면 `not-applied: <reason>`이다. `inherited`는 호스트에 옵션이 없을 때만 쓴다.
- Effective model은 넘긴 값과 worker가 자기 시스템 프롬프트에서 보고한 정확한 모델 ID로 기록한다(예: `opus (claude-opus-5-5)`). ID가 없으면 `unreported`이고 추측하지 않는다.
- 모델이나 effort를 바꾸는 재위임(한 tier 상향, Light→Heavy 승격, 경로 변경)은 반드시 새 dispatch다. 기존 subagent를 `SendMessage`로 이어 쓰면 처음 값이 유지된다.
- 하위 tier worker가 gate에 실패하면 blocker 전에 한 tier 올려 다시 보낸다.
- host task-list 도구(`update_plan`, `create_goal`, `wrap_up`)는 main만 호출한다. subagent는 건너뛰고 최종 보고에 적는다.
- 라우팅은 dispatch 단위다. 전역·사용자 설정 파일은 바꾸지 않는다. `MEMORY.md`나 계획에 `Model routing: inherited`가 있으면 작업별 선택을 끈다.

### 기록 명령과 게이트(코드가 강제)

- 기록: `goal assign --task <id> --agent <id> --effort <v> --effort-source host-option|inherited|not-applied [--route heavy]`. 설계 task는 `--kind design --model <v> --model-source host-option --host claude-code|codex|antigravity`, 실제 ID는 `--effective-model <id|unreported>`로 기록한다. 생략한 옵션은 기존 값을 유지한다. 출처: `pota-goal-cli.mjs:273`, `pota-goal-operations.mjs:236-280`.
- Heavy effort 게이트: 배정된 Heavy task가 effort 없음, `not-applied`, `inherited`이면 `goal task --status completed`와 `goal finish`를 거부한다. 우회는 두 명령 모두 `--allow-inherited-effort <reason>`이다. Light와 미배정(main 직접) task는 검사하지 않는다. 출처: `pota-goal-operations.mjs:207-214`, `pota-goal-operations-evidence.mjs`, `test/goal-effort.test.mjs` 77·101·127행.
- 설계 게이트:
  - `kind: "design"` task는 `--model-source host-option`으로 기록된 strongest 값이어야 완료된다. `--host`를 주면 그 호스트의 값만, 생략하면 세 값 중 하나를 허용한다. Antigravity(`--host antigravity` 또는 `--host` 생략 시 Antigravity 분류)에서는 `pro`뿐 아니라 `classifyModel(model, "antigravity")?.tier`가 요구 floor(상한 없으면 `strongest`=`gemini-4-argon*`, 상한 `stronger`이면 `stronger` 이상)에 도달한 Antigravity 모델도 통과한다(`--host claude-code`와 `--host codex`는 기존 정확 일치 유지).
  - 배정된 Heavy task는 goal 안에 완료된 design task가 있어야 완료된다.
  - 둘 다 `--allow-no-design-model <reason>`으로 우회한다.
  - 출처: `pota-goal-operations.mjs:216-233`, `test/goal-effort.test.mjs` 248·279·450·474행.
- 경고(차단 아님):
  - Heavy task를 effort 없이 assign하면 stderr 경고를 낸다.
  - `effectiveModel`이 넘긴 model 이름을 포함하지 않으면 불일치 경고를 낸다(`unreported`는 제외).
  - Stop·SubagentStop은 배정됐는데 `effortSource`가 비어 있으면 문장을 덧붙인다.
  - 출처: `pota-goal-cli.mjs:118-125`, `scripts/pota-goal-policy.mjs:53-57`.
- `ESCALATE:` 반환(2.4.0): worker가 자기 tier로 끝낼 수 없으면 final report 첫 줄을 `ESCALATE: <reason>`으로 시작하고, orchestrator는 실패한 게이트와 같게 한 tier 위로 새 dispatch하며(모델 상한에서 멈춤) Evidence에 `Escalation:` 줄을 남긴다. 출처: `skills/pota-work/delegation.md`, `test/policy-additions.test.mjs`.
- Heavy `planReview`(2.4.0): `heavy-design` task는 `designRecord`와 함께 `planReview` 증거가 필요하다. stronger tier의 별도 읽기 전용 리뷰어가 기본적으로 승인하고 저장소 근거로 확인한 blocker만 반려하며 재검토는 한 번이다. 출처: `skills/pota-plan/heavy-path.md`, `test/policy-additions.test.mjs`.
- `goal replan`은 바뀐 task의 effort·model 기록을 초기화한다. `goal stats`는 route·effort를 보이고, model 필드는 설정됐을 때만 보인다. 출처: `test/goal-effort.test.mjs` 203·359·367·538행.

### main 모델 게이트

- 분류: `classifyModel(value, host)`(`scripts/pota-model-tier.mjs`)가 ID를 tier로 바꾼다. Claude Code는 family 토큰(`haiku|sonnet|opus|fable`)이 영숫자 경계로 정확히 1개일 때, Codex는 slug가 `[a-z0-9.]` 밖 경계로 정확히 1개일 때, Antigravity는 enum(`flash_lite`·`flash`·`pro`, `pro`는 strongest)과 실제 Antigravity 세션/swarm 모델 ID(`fast`: `gemini-*-flash-lite`, `balanced`: `gemini-*-flash`·`gpt-oss-*`, `stronger`: `gemini-4-hydrogen*`·`gemini-4-neon*`·`gemini-pro-orchestrator*`, `strongest`: `gemini-4-argon*`, `--host antigravity`일 때 `claude-sonnet-*`→`balanced`·`claude-opus-*`→`stronger`)를 분류한다. `gemini-3-pro`·`opusplan`·`default`·두 토큰·표에 없는 값은 `null`이며 `parseModelCeiling("pro")`도 계속 무효다. 출처: `test/main-model-gate.test.mjs` "model tiers classify…".
- 기록: SessionStart(Codex는 UPS도) payload `model`이 fast·balanced면 hook이 payload `session_id` 키로 세션별 파일 `main-model-<sha256 앞 16자>.json`에 남긴다. stronger 이상·미지의 값은 그 세션 파일을 지우고, `model` 필드가 없으면 아무것도 하지 않는다. `agent_id`가 있는 payload는 무시한다. 출처: `scripts/pota-state.mjs` `observeMainModel`.
- G-plan: 그 기록이 있는 세션에서 `requiredEvidence`에 `triageDecision`이 있는 task를 완료(`goal task --status completed`, `goal finish`의 active task 완료)하려면 그 task에 `--model-source host-option`이고 `--host` 기준 stronger 이상인 model 기록이 있어야 한다.
- G-review: 같은 세션에서 `goal finish`·`goal complete`는 `kind: "review"` task 중 같은 조건의 기록이 하나 있어야 한다. `goal finish`는 검증 명령 실행 전에 먼저 검사하고, "tasks remain" 오류가 게이트보다 먼저다. 기록 명령은 `goal assign <task> --kind review --agent <id> --model <v> --model-source host-option --host <h>`다.
- 우회: `--allow-main-model <reason>`(`goal task`·`finish`·`complete`만). 상태에 저장하지 않고 성공 뒤 stderr `Pota warning: main-model gate bypassed for goal <command>: <reason>`를 낸다. 완료가 아닌 전이에 주면 오용 오류다.
- 세션 키: CLI는 `CLAUDE_CODE_SESSION_ID` → `goal.ownerSessionId` → 없음(게이트 없음). hook은 payload `session_id`만 쓴다. Codex는 `goal start --session`이 있어야 게이트가 걸린다.
- fail-open: 기록 파일 없음·손상·symlink·디렉터리·저장 `sessionKey` 불일치·다른 세션·키 없음·저장 model이 stronger 이상이면 통과한다. 저장된 `tier`는 믿지 않고 다시 분류한다. 출처: `pota-goal-operations.mjs` `ensureMainModelPlanning`·`ensureMainModelReview`, `test/main-model-gate.test.mjs` "planning and goal completion pass without a record, with an unrelated session, or with no session key", "a below-stronger main model blocks completing a triageDecision task until a stronger dispatch or a waiver", "goal finish refuses before running verification, and goal complete refuses, without a stronger review dispatch", "the gate keys on CLAUDE_CODE_SESSION_ID, then the goal owner, else nothing".
- 전역 끄기: `POTA_MAIN_MODEL_GATE`가 `0|false|off|no`(trim, 대소문자 무시, `POTA_LEGACY_MIGRATION`·`POTA_COMMENT_CHECKER`와 같은 규칙)면 hook은 관찰·기록·캡슐 줄·알림을 하지 않고, CLI 두 게이트는 기록을 읽지 않고 통과한다. stronger tier를 쓸 수 없는 계정이나 세션 모델을 그대로 쓰기로 한 사용자용이다. hook은 `process.env`, CLI는 `runGoalCli`의 `env`를 본다. 출처: `pota-goal-state.mjs` `mainModelGateEnabled`, `test/main-model-gate.test.mjs` "POTA_MAIN_MODEL_GATE off lets triage completion, goal finish, and goal complete pass despite a below-stronger record".

### 모델 상한

- 출처: `POTA_MODEL_CEILING`(env)과 `<POTA_HOME>/config.json`의 `"modelCeiling"`. env가 비어 있지 않으면 env가 결정하고(무효여도 config로 내려가지 않는다), 아니면 config 키를 본다. 읽을 수 없는 `config.json`(없음·symlink·디렉터리·깨진 JSON·배열)은 조용히 상한 없음이다. 설정 CLI는 없고 사용자가 손으로 적는다. 에이전트는 env 접두나 `config.json` 편집으로 상한을 설정하지 않는다(정책으로만 금지). 출처: `scripts/pota-model-ceiling.mjs` `resolveModelCeiling`.
- 파싱(`parseModelCeiling`, `scripts/pota-model-tier.mjs`): trim·소문자 뒤 tier 이름이면 그 tier, 아니면 `classifyModel`(host 미지정)의 tier. `balanced`·`stronger`는 상한, `strongest`(`fable`·`gpt-6-astra`)는 상한 없음(알림 없음), `fast`·`pro`·분류 실패·비문자열은 무효다. `pro`(대소문자 무관)는 Antigravity strongest로 분류되지만 구독 요금제 "Pro"와 혼동되므로 상한 값으로서만 무효다(설계 기록과 다른 점이다. `classifyModel`과 게이트의 `pro` 취급은 그대로다). 무효는 상한 없음(지금과 같은 엄격한 동작)에 알림만 낸다: hook은 SessionStart마다 `systemMessage`, CLI는 게이트 명령에서 stderr `Pota warning: ignoring invalid model ceiling …` 1줄.
- 유효 tier = `min(tier, 상한)`(`effectiveTier`). 설계 게이트는 `modelsAtOrAbove(host, effectiveTier("strongest", ceiling))` 목록과 완전 일치를 본다(상한 `stronger`·`--host claude-code`면 `opus | fable`, 상한 없으면 지금과 같은 `fable | gpt-6-astra | pro`). main 모델 게이트의 floor는 `effectiveTier("stronger", ceiling)`이고, 기록을 다시 분류하므로 상한 없이 기록된 `sonnet` 세션도 상한 `balanced`의 CLI에서는 통과한다. 상한 `balanced`면 fast main 세션만 게이트가 걸리고 balanced dispatch가 통과한다.
- CLI는 `goal task`의 상태 변경, `goal finish`, `goal complete`에서만 상한을 1회 읽는다(`status`·`assign`·`verify`·`pause` 등은 읽지 않는다). 라이브러리(`setTaskStatus`·`transitionGoal`·`finishGoal`)는 `modelCeiling` 옵션만 보고 env를 읽지 않는다. 상한은 goal 상태·이력에 저장하지 않는다.
- 게이트 에러: 상한이 있으면 ` (model ceiling <tier>)`가 붙고, 끝에 상한 설정 힌트(`POTA_MODEL_CEILING=<options>`, 설계 게이트는 상한 없음 `stronger|balanced`·상한 `stronger`면 `balanced`, main 게이트 2종은 `balanced`)가 붙는다. 상한이 `balanced`면 힌트를 생략한다. 설계 게이트 에러 2종("has no recorded design model" 포함)의 dispatch 대상은 상한이 있으면 "the strongest tier" 대신 상한 tier 모델(`--host`가 있으면 기대 목록의 첫 값, 없으면 세 호스트 값 `opus | gpt-6-sol | pro` 꼴)이다. 상한이 없으면 문구는 그대로다. "no completed design task" 에러는 바뀌지 않는다.
- `goal assign`의 불일치 경고는 `--effective-model`의 tier가 넘긴 model보다 낮을 때만 호스트 대체 문장을 덧붙이고, 상한 안내("if this account cannot use <model>…")는 넘긴 model이 stronger 이상일 때만 붙인다.
- 정책: 상한 줄이 있으면 상한보다 높은 tier는 상한 tier의 모델로 dispatch·기록하고 `Requested model`에 `(ceiling <tier>)`를 적는다. 상한 줄이 없을 때 모델 사유로 dispatch가 거부되면 같은 모델을 재시도하지 않고 한 tier 낮춰 새 dispatch한 뒤 해당 waiver로 닫는다. worker가 낮은 tier ID를 보고하면 결과를 유지하고 `--effective-model`과 계획 Evidence의 `Model substitution:` 줄로 남긴다. 두 경우 모두 사용자에게 한 번 알리고 상한 설정을 안내한다. `resolvedModel` 관측은 하지 않는다(known limit: 게이트는 요청값만 본다).
- 출처: `skills/pota-plan/delegation.md` `## Model Ceiling`, `test/model-ceiling.test.mjs`, 설계 기록 `docs/plan/available-model-ceiling.md` `## Heavy Design`.

## Policy

- 계획의 Agent Assignments에 task별 Requested/Effective model과 effort를 적고, dispatch 직후 `goal assign`으로 같은 값을 남긴다. 기록만 하고 넘기지 않는 것은 결함이다.
- main이 inline으로 Heavy 작업을 하면 effort를 host 옵션으로 줄 수 없다. 이때는 waiver 사유를 기록한다.
- 경로를 바꾸면 계획, `goal replan` roadmap, host UI plan, effort profile을 함께 다시 계산한다. 완료 task의 기록은 감사 이력으로 둔다.

## References

- `node --test test/goal-effort.test.mjs test/contract-parity.test.mjs`
- 출처 계획: `docs/plan/per-task-model-routing.md`, `docs/plan/dispatch-effort-enforcement.md`, `docs/plan/heavy-design-model-routing.md`, `docs/plan/delegation-model-identity-rules.md`
