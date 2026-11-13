# Domain: delegation-model-routing

Summary: 작업별 모델 4-tier·호스트별 값, effort 라우팅, dispatch 기록과 완료 게이트(effort·설계 모델). 위임 규칙이나 goal assign을 바꿀 때 읽는다.

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

출처: `skills/pota-plan/delegation.md` "Model and Reasoning Effort Routing". 코드의 strongest 표 `STRONGEST_MODEL_BY_HOST`(`scripts/pota-goal-state-validation.mjs:30`)가 문서와 같은지 `test/goal-effort.test.mjs` "the code strongest table matches…"가 검사한다.

- effort: Light 계획·구현·검증 `medium`, Heavy 계획·리뷰·구현 `high`, 최종 검증·리뷰 `xhigh`. 허용 값은 `low|medium|high|xhigh|max`와 `inherited`다. 출처: 같은 절, `pota-goal-state-validation.mjs:25-27`.
- 모든 새 dispatch는 effort와 model을 host 옵션으로 넘긴다. Claude Code는 Agent `effort`·`model`이다. `subagent_type: "fork"`는 둘 다 무시하므로 라우팅된 작업에 쓰지 않는다. Antigravity는 model tier만 있고 effort 옵션이 없어 effort가 `inherited`다.
- Effective 판정: 넘기고 거부되지 않았으면 요청값이다. 넘기지 않았으면 `not-applied: <reason>`이다. `inherited`는 호스트에 옵션이 없을 때만 쓴다.
- Effective model은 넘긴 값과 worker가 자기 시스템 프롬프트에서 보고한 정확한 모델 ID로 기록한다(예: `opus (claude-opus-5-5)`). ID가 없으면 `unreported`이고 추측하지 않는다.
- 모델이나 effort를 바꾸는 재위임(한 tier 상향, Light→Heavy 승격, 경로 변경)은 반드시 새 dispatch다. 기존 subagent를 `SendMessage`로 이어 쓰면 처음 값이 유지된다.
- 하위 tier worker가 gate에 실패하면 blocker 전에 한 tier 올려 다시 보낸다.
- host task-list 도구(`update_plan`, `create_goal`, `wrap_up`)는 main만 호출한다. subagent는 건너뛰고 최종 보고에 적는다.
- 라우팅은 dispatch 단위다. 전역·사용자 설정 파일은 바꾸지 않는다. `MEMORY.md`나 계획에 `Model routing: inherited`가 있으면 작업별 선택을 끈다.

### 기록 명령과 게이트(코드가 강제)

- 기록: `goal assign --task <id> --agent <id> --effort <v> --effort-source host-option|inherited|not-applied [--route heavy]`. 설계 task는 `--kind design --model <v> --model-source host-option --host claude-code|codex|antigravity`, 실제 ID는 `--effective-model <id|unreported>`로 기록한다. 생략한 옵션은 기존 값을 유지한다. 출처: `pota-goal-cli.mjs:273`, `pota-goal-operations.mjs:236-280`.
- Heavy effort 게이트: 배정된 Heavy task가 effort 없음, `not-applied`, `inherited`이면 `goal task --status completed`와 `goal finish`를 거부한다. 우회는 `--allow-inherited-effort <reason>`이다. Light와 미배정(main 직접) task는 검사하지 않는다. 출처: `pota-goal-operations.mjs:207-214`, `test/goal-effort.test.mjs` 77·101·127행.
- 설계 게이트:
  - `kind: "design"` task는 `--model-source host-option`으로 기록된 strongest 값이어야 완료된다. `--host`를 주면 그 호스트의 값만, 생략하면 세 값 중 하나를 허용한다.
  - 배정된 Heavy task는 goal 안에 완료된 design task가 있어야 완료된다.
  - 둘 다 `--allow-no-design-model <reason>`으로 우회한다.
  - 출처: `pota-goal-operations.mjs:216-233`, `test/goal-effort.test.mjs` 248·279·450·474행.
- 경고(차단 아님):
  - Heavy task를 effort 없이 assign하면 stderr 경고를 낸다.
  - `effectiveModel`이 넘긴 model 이름을 포함하지 않으면 불일치 경고를 낸다(`unreported`는 제외).
  - Stop·SubagentStop은 배정됐는데 `effortSource`가 비어 있으면 문장을 덧붙인다.
  - 출처: `pota-goal-cli.mjs:118-125`, `scripts/pota-goal-policy.mjs:53-57`.
- `goal replan`은 바뀐 task의 effort·model 기록을 초기화한다. `goal stats`는 route·effort를 보이고, model 필드는 설정됐을 때만 보인다. 출처: `test/goal-effort.test.mjs` 203·359·367·538행.

## Policy

- 계획의 Agent Assignments에 task별 Requested/Effective model과 effort를 적고, dispatch 직후 `goal assign`으로 같은 값을 남긴다. 기록만 하고 넘기지 않는 것은 결함이다.
- main이 inline으로 Heavy 작업을 하면 effort를 host 옵션으로 줄 수 없다. 이때는 waiver 사유를 기록한다.
- 경로를 바꾸면 계획, `goal replan` roadmap, host UI plan, effort profile을 함께 다시 계산한다. 완료 task의 기록은 감사 이력으로 둔다.

## References

- `node --test test/goal-effort.test.mjs test/contract-parity.test.mjs`
- 출처 계획: `docs/plan/per-task-model-routing.md`, `docs/plan/dispatch-effort-enforcement.md`, `docs/plan/heavy-design-model-routing.md`, `docs/plan/delegation-model-identity-rules.md`
