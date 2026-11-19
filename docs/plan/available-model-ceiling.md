# Plan: 구독 등급에 맞춘 모델 상한

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-19)
- Finalized: decision-complete for implementation after planned triage. (2026-11-19, `heavy-design` 결과 반영 후 구현 착수)
- Codex UI synchronization: Claude Code 데스크톱 세션이라 `update_plan`은 호스트 task list로 동기화했고 `create_goal`은 없다(unavailable).

## Goal

계정에서 `opus`나 `fable`을 쓸 수 없을 때(예: 구독 등급) 하네스가 "쓸 수 있는 가장 높은 모델"을 기준으로 tier를 고르고 게이트를 판정하게 한다. 지금은 Heavy 설계 게이트가 `fable`을, main 모델 게이트가 `opus` 이상을 고정으로 요구해 그런 계정은 goal마다 우회 플래그가 필요하다.

- Goal ID: `goal start`가 발급한 값(Evidence에 기록)
- Plan ID: `docs/plan/available-model-ceiling.md`
- Completion criteria (advisory): 상한이 정해진 계정에서 우회 플래그 없이 goal을 끝낼 수 있고, 상한이 없는 계정의 동작은 지금과 같다. `npm run check` 통과.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome: 위 Goal.
- Affected surfaces(예상): `scripts/pota-model-tier.mjs`, `scripts/pota-goal-*.mjs`, `scripts/pota-state*.mjs`, 두 `delegation.md`, `skills/pota-{plan,work}/heavy-path.md`, `templates/work-plan.md`, `docs/model-guidance/`, README 8개, `docs/memory/delegation-model-routing.md`, `test/main-model-gate.test.mjs`, `test/goal-effort.test.mjs`.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/delegation-model-routing.md`
- `docs/memory/policy-surfaces.md`
- `docs/memory/hook-context.md`
- Related completed plans: `docs/plan/main-model-gate-and-test-time.md`, `docs/plan/heavy-design-model-routing.md`, `docs/plan/per-task-model-routing.md`

## Triage Findings

공식 문서 조회(2026-11-19, code.claude.com의 model-config·sub-agents·hooks·cli-reference). 실제 계정으로 실측한 것은 아니다.

- 플랜별 가용성: 문서상 `default` 모델은 Pro·Max·Team·Enterprise·API 모두 Opus 5.5다. Fable은 어느 플랜에서도 기본이 아니고 명시적으로 골라야 하며, 사용분이 usage credits로 청구될 수 있다. 조직이 `availableModels`·`deniedModels`나 admin console로 모델을 막을 수 있다. "Pro에 Fable이 포함된다/안 된다"를 직접 밝힌 문장은 찾지 못했다(미확인).
- 없는 모델로 subagent를 띄웠을 때: 조직 허용목록이 막은 경우는 오류 없이 대체 실행한다(같은 family의 허용 버전 → `CLAUDE_CODE_SUBAGENT_MODEL` → 부모 모델). 구독 entitlement 부족일 때의 동작은 문서에 없다(미확인). 따라서 `fable`로 "요청"하고 기록해도 실제로는 낮은 모델이 돌 수 있고, 현행 설계 게이트는 요청값만 본다.
- 스크립트가 계정의 가용 모델이나 구독 등급을 알아낼 문서화된 방법은 없다(hook 공통 필드·환경변수·CLI 하위 명령 모두 없음). 관측 가능한 것은 SessionStart의 `model`(main), 그리고 PostToolUse에서 Agent 도구의 `tool_response.resolvedModel`(subagent가 실제 시작한 모델)이다.
- 현행 코드: tier 표는 `scripts/pota-model-tier.mjs` 하나다. 상한이 영향을 줄 곳은 설계 게이트(`pota-goal-operations.mjs:239`, `STRONGEST_MODEL_BY_HOST` 고정), main 모델 게이트(`isBelowStronger`·`isStrongerOrAbove`, `pota-goal-state.mjs:96`, `pota-state.mjs:276`, `pota-goal-operations.mjs:251`), 안내 문구(`pota-state-context.mjs:179`, `pota-goal-operations.mjs:261`)다.
- 결정: 자동 감지는 근거가 부족하므로(entitlement 동작 미확인, 가용 목록 조회 수단 없음) 상한은 사용자가 정하는 설정으로 둔다. 값은 호스트 중립적인 tier 이름으로 받는다. 상한이 없으면 동작은 지금과 바이트 단위로 같다. `resolvedModel` 관측으로 "요청과 다른 모델이 돌았다"를 알리는 것은 설계에서 범위 포함 여부를 정한다.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: 완료 게이트 2개(설계 모델, main 모델)의 통과 조건이 바뀐다.
- Checkpoint ledger:
  - Request checkpoint: 잠정 Heavy.
  - Planning checkpoint: Heavy 확정. 근거: 게이트 통과 조건 변경, 새 설정 표면.
  - Code checkpoint: pending(worker가 첫 편집 직전에 기록).
- Heavy Path signals checked: 새 추상화(모델 상한) 있음. 보안·외부 API·DB·동시성·다중 도메인 리팩터 없음. schema 버전은 올리지 않는다.
- Pre-implementation decisions(설계가 답해야 함):
  1. 상한을 어디서 읽는가: 환경변수만인지, `POTA_HOME`의 설정 파일과 CLI 명령도 두는지(`POTA_AUTO_UPGRADE`·`pota auto-upgrade` 선례). hook과 CLI가 같은 값을 보아야 한다.
  2. 값의 형식: tier 이름(`balanced`·`stronger`)과 호스트 모델 alias(`sonnet`·`opus`) 허용 여부, 잘못된 값의 처리.
  3. 상한이 tier 표·설계 게이트·main 모델 게이트·에러 문구에 적용되는 정확한 규칙. 상한이 `stronger`면 설계는 `opus`로 통과하고, `balanced`면 설계와 main 기준이 `sonnet`이 된다.
  4. 모델(에이전트)이 상한을 아는 방법: SessionStart 캡슐의 조건부 줄과 `delegation.md` 문구. 상한이 없을 때 출력은 바이트 동일해야 한다.
  5. 상한을 정하도록 안내하는 지점: 게이트 에러 문구, README. dispatch가 거부되거나 worker가 낮은 모델 ID를 보고했을 때의 정책.
  6. `resolvedModel` 관측(PostToolUse matcher에 Agent 추가)을 이번에 넣을지. `hooks/hooks.json` 변경 비용(Codex trust hash, Claude 얇은 플러그인 테스트)을 따진다.
  7. 변경 파일과 테스트 계약, 검증 명령.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | - | 세션 모델(not-applied: main 직접 수행) | not-applied |
| `heavy-design` | 설계 subagent(read-only) | heavy | `fable` | `high` |
| `model-ceiling` | `worker` | heavy | `opus` | `high` |
| `verify` | 리뷰 subagent(read-only) + main의 `goal finish` | - | `opus` | `xhigh` |

## Tool Readiness

- toolcheck: node, npm, typescript-language-server, tsc 모두 OK(같은 세션의 앞선 goal에서 확인).

## Execution Guardrails

- Test contract first. 기존 테스트·fixture를 약화하지 않는다.
- 상한이 없을 때의 hook 출력·게이트 동작은 지금과 같아야 한다(테스트로 고정).
- Verification ladder: 집중 테스트 → `goal finish -- npm run check` 1회.
- 외부 상태 변경 없음. 커밋·푸시는 사용자가 요청할 때만.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Required evidence records: `planArtifact`, `triageDecision`.

### Task 1: 모델 상한 설계

- Task ID: `heavy-design` (`kind: "design"`, `route: "heavy"`)
- Requested model / effort: `fable` / `high`
- Contract: Pre-implementation decisions 7개에 답하고 변경 파일·테스트 계약·문구를 낸다. read-only.
- Required evidence records: `designRecord`

### Task 2: 모델 상한 구현

- Task ID: `model-ceiling` (`route: "heavy"`)
- Requested model / effort: `opus` / `high`
- Contract: `## Heavy Design`대로 구현한다.
- Depends on: `heavy-design`
- Tests / Module acceptance / Surface integration: 설계가 지정.

### Task 3: 최종 리뷰와 검증

- Task ID: `verify`
- Requested model / effort: `opus` / `xhigh`(read-only 리뷰), 이후 main이 `goal finish -- npm run check`
- Depends on: `model-ceiling`

## Heavy Design

- 설계 dispatch: Claude Code Agent `model: "fable"`, `effort: "high"`(read-only, 거부 없음). 보고된 모델 ID `claude-fable-5-2`.
- Pre-implementation review(main, 2026-11-19): 설계를 채택한다. 설계가 확인을 요청한 점은 이렇게 정한다: 상한 출처는 env + `<POTA_HOME>/config.json`으로 한다. env가 없을 때 `config.json`을 읽는 것(쓰기·디렉터리 생성 없음)은 허용한다. hook과 CLI가 같은 값을 보게 하는 유일한 경로이기 때문이다. `resolvedModel` 관측을 범위에서 빼는 것도 동의한다(`hooks/hooks.json` 변경 비용, 문서로만 확인된 필드).

### Heavy Design: 모델 상한

보고 모델 ID: `claude-fable-5-2` (시스템 프롬프트 기재값). 파일 수정 없음, `pota goal` 상태 변경 명령 실행 없음, 호스트 task-list 도구 호출 없음. 문자 수는 `node -e`로 문자열만 계산했다(파일 쓰기 없음).

#### 0. 권장안 요약

- 상한은 사용자 설정이다. 출처는 `POTA_MODEL_CEILING`(env)과 `<POTA_HOME>/config.json`의 `"modelCeiling"` 두 곳이고 env가 우선한다. 새 CLI 명령은 만들지 않는다.
- 값은 `balanced|stronger`다. `strongest`는 "상한 없음"으로 받고, 모델 이름(`sonnet`, `opus`, `gpt-6-sol` 등)은 `classifyModel`로 tier로 바꾼다. `fast`와 그 밖의 값은 무효이며 상한 없이 알림만 낸다.
- 유효 tier = `min(tier, 상한)`. 설계 게이트는 유효 strongest 이상의 값을, main 모델 게이트는 유효 stronger를 기준으로 판정한다.
- 상한이 있을 때만 SessionStart 캡슐에 `Pota model ceiling:` 1줄이 붙는다(`Pota CLI:` 줄 뒤, `Pota main model:` 줄 앞).
- `hooks/hooks.json`, goal state schema(3), SKILL.md 2개, `defaultPrompt`, UPS 캡슐 문구는 건드리지 않는다. `resolvedModel` 관측은 이번 범위에서 뺀다.

**main이 확인할 점 1개**: 권장안은 "파일 I/O 동일" 제약에서 읽기 1회만큼 벗어난다. env가 없을 때 `config.json`을 `lstatSync` 1회 한다(쓰기·디렉터리 생성은 0). 읽기도 허용하지 않으려면 `resolveModelCeiling`에서 config 단계만 빼면 env 전용이 되고 나머지 명세는 그대로다. 그 경우 hook과 CLI가 같은 값을 본다는 보장은 없어진다(D1).

#### 1. 결정 7개

##### D1. 상한의 출처: env + `config.json`, env 우선

| 경로 | hook이 봄 | Bash CLI가 봄 | 근거 |
| --- | --- | --- | --- |
| Claude Code `settings.json`의 `env` | 예(문서 기준, 미실측) | 예(실측) | 이 세션에서 `~/.claude/settings.json` `env` 키 3개가 모두 Bash env에 있었다 |
| 셸 프로필 export, 터미널에서 실행 | 예 | 예 | 둘 다 호스트 프로세스 env 상속 |
| 셸 프로필 export, 데스크톱 앱 실행 | 불확실 | 예 | Bash 도구만 프로필로 초기화된다 |
| Codex `shell_environment_policy`의 `set`이나 제한적 `inherit` | hook만 또는 CLI만 | 갈림 | 가정(미실측) |
| `<POTA_HOME>/config.json` | 예 | 예 | 둘 다 `potaHome()`으로 같은 파일을 읽는다(`scripts/pota-paths.mjs:9-12`). main 모델 기록 파일이 이미 같은 전제에 의존한다(`:32-34`) |

- env만으로는 "hook과 CLI가 같은 값을 본다"를 보장할 수 없다. `config.json`은 보장한다. 상한은 계정 속성이라 사용자 단위 파일이 맞다.
- env는 선례(`POTA_AUTO_UPGRADE`·`POTA_COMMENT_CHECKER`가 env + `config.json` 키, `scripts/pota-update-state.mjs:69-79`, `scripts/pota-comment-checker.mjs:70-75`)와 세션 단위 override를 위해 남긴다.
- 값이 갈려도 안전하다. CLI만 상한을 보면 게이트만 완화되고 캡슐 줄이 없다(지금과 같은 dispatch). hook만 보면 CLI가 지금처럼 엄격히 거부하고 에러가 `config.json`을 안내한다.
- CLI 명령은 만들지 않는다. `"autoUpgrade": false`처럼 손으로 적는다. `pota auto-upgrade on|off`는 다른 키를 보존하고(`scripts/pota-auto-upgrade.mjs:83-89`) uninstall은 `config.json`을 남긴다.

추가되는 읽기(쓰기 0):
- SessionStart hook 진입점에서 1회.
- UPS는 payload에 `model`이 있을 때만(Claude Code UPS는 해당 없음).
- `goal task`(상태 변경), `goal finish`, `goal complete`에서 1회.
- 설치본 SessionStart는 이미 같은 파일을 읽는다(`autoUpgradeSetting`).

##### D2. 값 형식과 파싱

`parseModelCeiling(raw)` → `{ status: "unset"|"none"|"set"|"invalid", ceiling: "balanced"|"stronger"|null }`

1. `undefined`·`null`은 `unset`. 문자열이 아니면 `invalid`.
2. `trim().toLowerCase()` 후 빈 문자열이면 `unset`.
3. `MODEL_TIERS`에 있으면 그 tier, 아니면 `classifyModel(text)?.tier`(host 미지정). 분류 실패는 `invalid`.
4. `strongest`는 `none`(명시적 상한 없음, 알림 없음). `stronger`·`balanced`는 `set`. `fast`는 `invalid`.

- 예: `opus`·`claude-opus-5-5`·`gpt-6-sol` → stronger. `sonnet`·`flash` → balanced. `fable`·`pro` → none. `haiku`·`opusplan`·`off`·`turbo` → invalid.
- 우선순위: env가 `unset`이 아니면 env가 결정한다(무효여도 config로 내려가지 않는다). env가 `unset`이면 config 키를 본다.
- 읽을 수 없는 `config.json`(없음·symlink·디렉터리·깨진 JSON·배열)은 조용히 상한 없음이다. 키가 있는데 값이 무효일 때만 알린다.
- 무효 처리: 상한 없음(지금과 같은 엄격한 동작)에 알림 2곳. hook은 SessionStart마다 사용자 `systemMessage`(캡슐 본문 불변), CLI는 게이트 명령에서 stderr 1줄.
- `fast`를 거부하는 이유: 모든 tier가 한 모델로 접혀 게이트가 사라진다. 그 용도는 `Model routing: inherited`다.

##### D3. 유효 tier 규칙과 적용

`scripts/pota-model-tier.mjs`에 추가(순수 함수, import 없음 유지):

```js
export const MODEL_CEILINGS = Object.freeze(["balanced", "stronger"]);
export function tierRank(tier)                         // MODEL_TIERS.indexOf, 미지의 값 -1
export function validCeiling(value)                    // MODEL_CEILINGS에 있으면 그 값, 아니면 null
export function effectiveTier(tier, ceiling = null)    // validCeiling이면 rank가 낮은 쪽, 아니면 tier 그대로
export function effectiveModel(host, tier, ceiling = null)  // MODEL_TIER_BY_HOST[host]?.[effectiveTier(...)] ?? null
export function isBelowTier(tier, floor)               // 둘 다 알려진 tier이고 rank(tier) < rank(floor)
export function isAtOrAboveTier(tier, floor)           // 둘 다 알려진 tier이고 rank(tier) >= rank(floor)
export function modelsAtOrAbove(host, floor)           // floor 이상 tier의 값, tier 순서, 중복 제거
export function parseModelCeiling(raw)                 // D2
```

`isBelowStronger`·`isStrongerOrAbove`는 그대로 둔다(기존 테스트가 쓴다).

**설계 게이트** `ensureHeavyDesignRecorded(state, task, ceiling = null)` (`scripts/pota-goal-operations.mjs:232-246`):

```js
const hosts = task.modelHost ? [task.modelHost] : Object.keys(MODEL_TIER_BY_HOST);
const expected = [...new Set(hosts.flatMap((host) => modelsAtOrAbove(host, effectiveTier("strongest", ceiling))))];
```

- 완전 일치 판정을 유지한다(`:240`). 상한이 없으면 목록이 지금과 같다(`fable | gpt-6-astra | pro`, `test/goal-effort.test.mjs:443` 정규식과 순서 일치).
- 상한 `stronger`, `--host claude-code`: `opus | fable`. host 생략: `opus | fable | gpt-6-sol | gpt-6-astra | pro`.
- 상한 `balanced`, `--host claude-code`: `sonnet | opus | fable`.
- Antigravity: 상한 `stronger`면 `pro`(중복 제거), `balanced`면 `flash | pro`.
- 상한보다 높은 모델 기록(`fable`)은 목록에 있어 통과한다.
- 에러: 기존 문장에서 `for host …` 뒤에 상한이 있으면 ` (model ceiling ${ceiling})`를 넣고 끝에 힌트를 붙인다. "has no recorded design model"과 "no completed design task" 에러는 바꾸지 않는다.

**main 모델 게이트** (`:250-280`). `floor = effectiveTier("stronger", ceiling)`:

- `dispatchedAtStronger(task)` → `dispatchedAtOrAbove(task, floor)`: `modelSource === "host-option" && isAtOrAboveTier(classifyModel(task.model, task.modelHost ?? null)?.tier, floor)`.
- `readMainModelRecord(root, sessionKey, floor = "stronger")`(`scripts/pota-goal-state.mjs:92-97`): `isBelowStronger`를 `isBelowTier(classified.tier, floor)`로 바꾼다. 다시 분류하므로 상한 없이 기록된 `sonnet`도 상한 `balanced`의 CLI에서는 통과한다.
- `strongerExpectation(host, ceiling)`: `[effectiveModel(host,"stronger",ceiling), effectiveModel(host,"strongest",ceiling)]`의 중복 제거 후 `" or "`. host를 모르면 `the ${floor} tier or above`. 상한 없음은 지금과 같다(`opus or fable`, `pro`). 상한 `stronger`는 `opus`, `balanced`는 `sonnet`.
- 에러 문구: `at the stronger tier`를 `at the ${floor} tier${ceiling ? ` (model ceiling ${ceiling})` : ""}`로 바꾸고 끝에 힌트를 붙인다. 상한이 없으면 앞부분이 바이트 동일하다.

| 상한 | main | 결과 |
| --- | --- | --- |
| `balanced` | sonnet | 줄·기록·게이트 없음. hook이 기존 기록을 지운다 |
| `balanced` | haiku | 게이트 있음. `sonnet` 이상 host-option dispatch면 통과, `haiku` dispatch는 거부 |
| `stronger` | haiku·sonnet | 기준은 지금과 같고 안내 값만 `opus` |
| 없음·`strongest`·무효 | - | 지금과 동일 |

**힌트**(게이트 에러 3종 끝에, 상한이 `balanced`면 생략):

```
. If this account cannot use that model, have the user set a model ceiling (POTA_MODEL_CEILING=<options>, or "modelCeiling" in ~/.pota/config.json); never set it yourself. See delegation.md "Model Ceiling"
```

`<options>`: 설계 게이트는 상한 없음이면 `stronger|balanced`, 상한 `stronger`면 `balanced`. main 모델 게이트 2종은 항상 `balanced`. 기존 테스트 정규식은 끝이 고정돼 있지 않아 그대로 맞는다(`test/goal-effort.test.mjs:443,488`, `test/main-model-gate.test.mjs:36-43`).

##### D4. 캡슐 줄

SessionStart에만 싣는다. 순서: `Pota CLI:` → `Pota model ceiling:` → `Pota main model:` → 업데이트 알림. idle·active·paused·blocked·foreign 모두 같다. 접두는 두 locale 공통 영문이다. hook은 호스트를 모르므로 세 호스트 값을 함께 적는다. `POTA_MAIN_MODEL_GATE`가 꺼져 있어도 이 줄은 나온다.

```
en: Pota model ceiling: ${c} (Claude Code ${cc}, Codex ${cx}, Antigravity ${ag}). Never dispatch above it: ${work} runs on that model; pass and record that value (goal assign --model) and the gates accept it. This overrides tier values in skill text. See delegation.md "Model Ceiling".
ko: Pota model ceiling: ${c} (Claude Code ${cc}, Codex ${cx}, Antigravity ${ag}). 이보다 높은 모델로 dispatch하지 마세요. ${work}도 이 모델로 실행하고, 넘긴 값을 goal assign --model로 기록하면 게이트를 통과합니다. skill 문구의 tier 값보다 이 줄이 우선합니다. 상세: delegation.md "Model Ceiling".
```

- `${cc}`·`${cx}`·`${ag}`는 `MODEL_TIER_BY_HOST[host][c]`.
- `${work}` en: stronger는 `strongest-tier work (Heavy design)`, balanced는 `stronger- and strongest-tier work (planning, triage, review, Heavy work)`.
- `${work}` ko: stronger는 `strongest tier 작업(Heavy 설계)`, balanced는 `stronger·strongest tier 작업(계획·트리아지·리뷰·Heavy 작업)`.

| 상한 | en | ko |
| --- | --- | --- |
| `stronger` | 313 | 260 |
| `balanced` | 359 | 288 |

예산은 줄 380자다(입력 가변 부분이 없는 고정 문자열 4개). 업데이트 알림·main 모델 줄처럼 상시 예산 밖의 조건부 줄로 취급한다.

무효 알림(`systemMessage`만, SessionStart마다, 값은 40자 clip):

```
en: Pota: model ceiling ${JSON.stringify(value)} (${where}) is not valid; use balanced or stronger (or a model name such as sonnet or opus). No ceiling is applied.
ko: Pota: 모델 상한 값 ${JSON.stringify(value)}(${where})이 올바르지 않습니다. balanced 또는 stronger(또는 sonnet·opus 같은 모델 이름)를 쓰세요. 상한은 적용되지 않습니다.
```

`${where}`는 `POTA_MODEL_CEILING` 또는 `config.json "modelCeiling"`. 최대 195자(en)·163자(ko), 예산 240.

기존 main 모델 줄은 유효 tier를 따른다. `mainModelLine({ ko, model, tier, host, threshold = "stronger" })`와 `mainModelNotice({ ko, model, host, threshold = "stronger" })`(`scripts/pota-state-context.mjs:161-180`):
- `below stronger` → `below ${threshold}`, `stronger 미만` → `${threshold} 미만`.
- 알림의 `the stronger tier` → `the ${threshold} tier`, `stronger tier 미만` → `${threshold} tier 미만`.
- `${stronger}` → `MODEL_TIER_BY_HOST[host][threshold]`.
- 기본값이면 기존 고정 문자열과 같다(`test/main-model-gate.test.mjs:136-143`). `balanced`일 때 최대 줄 328자·알림 235자로 기존 예산 340/240 안이다.

##### D5. 안내 지점과 정책

- 안내 지점: 게이트 에러 힌트(D3), `goal assign` 불일치 경고 보강, 두 `delegation.md`의 `## Model Ceiling`, README 8개, 무효 알림.
- 불일치 경고(`scripts/pota-goal-cli.mjs:135-138`): `classifyModel(effectiveModel, host)`의 tier가 `classifyModel(model, host)`보다 낮을 때만 같은 stderr 줄 끝에 ` The host may have substituted a lower model; if this account cannot use ${task.model}, have the user set a model ceiling (see delegation.md "Model Ceiling").`를 붙인다. `test/goal-effort.test.mjs:554`는 접두 일치라 통과한다.
- 정책(상한 줄이 없을 때):
  - dispatch가 모델 사유로 거부되면 같은 모델을 다시 시도하지 않는다. 한 tier 낮춰 새 dispatch하고, 실제 넘긴 값을 기록하고, 해당 게이트는 거부된 모델을 적은 waiver(`--allow-no-design-model <reason>` 또는 `--allow-main-model <reason>`)로 닫는다.
  - worker가 요청보다 낮은 tier의 ID를 보고하면(호스트 대체) 결과를 유지한다. 같은 모델로 재dispatch하지 않고 `--effective-model <id>`와 계획 Evidence의 `Model substitution:` 줄로 남긴다.
  - 두 경우 모두 사용자에게 한 번 알리고 상한 설정을 안내한다.
- 에이전트는 상한을 스스로 설정하지 않는다(env 접두, `config.json` 편집 모두). 근거: `skills/pota-plan/delegation.md:48` "never change model or global/user config files".
- "한 tier 상향" 재dispatch(`delegation.md:46`)는 상한에서 멈춘다.

##### D6. `resolvedModel` 관측: 이번 범위에서 제외

- `tool_response.resolvedModel`은 문서로만 확인됐다. background Agent 호출의 응답 형태도 모른다.
- `hooks/hooks.json:29` matcher에 `Agent`를 더하면 기존 항목의 Codex trust hash가 바뀐다(matcher가 hash에 들어간다, `scripts/pota-lifecycle-config.mjs:132-138`).
- 모든 Agent 호출마다 hook 프로세스가 뜬다. `postToolUseReminder`(`scripts/pota-state.mjs:103-136`)가 첫 편집이 아니라 첫 Agent 호출에 나오게 되어 상한 없는 사용자의 출력이 바뀐다. `tool_name` 분기가 추가로 필요하다.
- 기록하려면 hook이 `state.json`을 고치거나(Stop loop guard 문제) 새 파일이 필요하고, dispatch 시점엔 `goal assign` 전이라 task 매핑이 없다.
- 낮은 모델 대체는 이미 호스트 중립 경로로 드러난다: worker의 모델 ID 보고 → `--effective-model` → 불일치 경고(D5에서 보강).
- known limit: 게이트는 요청값만 본다. 호스트가 조용히 낮은 모델로 대체하고 worker가 ID를 보고하지 않으면 알 수 없다.
- 후속 형태: `claudeHooks`(`scripts/pota-lifecycle-claude.mjs:56-72`)가 Claude 전용 PostToolUse 항목(`^(Agent|Task)$`)을 덧붙이고 `pota-state.mjs`의 별도 분기가 경고만 낸다(상태 쓰기 없음).

##### D7. 변경 파일·테스트·검증

§2~§5.

#### 2. 코드 명세

**`scripts/pota-model-tier.mjs`**: D3의 export 추가.

**`scripts/pota-model-ceiling.mjs`(신규)**:

```js
export const NO_MODEL_CEILING = Object.freeze({ ceiling: null, source: null, invalid: null });
// env가 unset이 아니면 env가 결정. 아니면 <home>/config.json의 modelCeiling. throw·쓰기 없음.
export function resolveModelCeiling({ env = process.env, home = potaHome() } = {})
// → { ceiling: "balanced"|"stronger"|null, source: "env"|"config"|null, invalid: null | { source, value } }
export function invalidModelCeilingWarning({ source, value })
```

- import: `potaHome`(`pota-paths.mjs`), `readJsonFile`(`pota-update-state.mjs:44-49`), `parseModelCeiling`.
- config 경로는 `join(home, "config.json")`이다. `home`은 주입된 `env`가 아니라 `potaHome()`(process.env)에서 온다. 테스트가 `env: {}`를 주입해도 실제 `~/.pota`를 읽지 않게 하기 위해서다.
- `invalid.value`: 문자열은 trim 후 제어문자를 공백으로 바꾸고 40자 clip. 비문자열은 `JSON.stringify` 후 clip.
- 전체를 try/catch로 감싸 오류 시 `NO_MODEL_CEILING`.
- 경고 문자열: `Pota warning: ignoring invalid model ceiling ${JSON.stringify(value)} from ${where}; use balanced or stronger. No ceiling is applied.`

**`scripts/pota-goal-state.mjs`**: `readMainModelRecord(root, sessionKey, floor = "stronger")`.

**`scripts/pota-goal-operations.mjs`**:
- `setTaskStatus({ …, modelCeiling = null })`, `transitionGoal({ …, modelCeiling = null })`. 진입에서 `const ceiling = validCeiling(modelCeiling)`.
- `:161` `ensureHeavyDesignRecorded(state, task, ceiling)`.
- `:163`·`:109`의 옵션에 `ceiling` 추가.
- `ensureMainModelPlanning`·`ensureMainModelReview`의 옵션에 `ceiling = null`. `mainModelRecordFor(root, state, sessionId, floor)`.
- 검사 순서(waiver → 통과 증거 → 기록 읽기)는 그대로다.

**`scripts/pota-goal-operations-evidence.mjs:135-157`**: `finishGoal({ …, modelCeiling = null })`. `ensureMainModelReview`, `setTaskStatus`, `transitionGoal`에 전달.

**`scripts/pota-goal-cli.mjs`**:
- 지연 resolver를 둔다: 첫 호출에서 `resolveModelCeiling({ env })`, `invalid`면 stderr 경고 1회, 이후 캐시된 `ceiling` 반환.
- 호출 지점은 `task` 상태 변경 분기(`:90`), `finish`(`:181`), 전이 분기 중 `command === "complete"`일 때만(`:216`).
- `goal task status`, `assign`, `verify`, `pause` 등은 호출하지 않는다(I/O 없음).
- `:135-138` 경고 보강(D5).

**`scripts/pota-state-context.mjs`**:
- `export function modelCeilingLine({ ko, ceiling })`, `export function modelCeilingInvalidNotice({ ko, source, value })`(D4 문자열).
- `mainModelLine`·`mainModelNotice`에 `threshold = "stronger"`. `strongerModel(host, threshold)`.

**`scripts/pota-state.mjs`**:
- `runStateResult(event, { …, modelCeiling = NO_MODEL_CEILING })`. 라이브러리 기본값은 env를 읽지 않는다. 개발자 환경의 상한이 in-process 캡슐 예산 테스트로 새지 않게 하기 위해서다.
- 진입점(`:21-33`): `session-start`이거나 `user-prompt-submit`이면서 `payload?.model !== undefined`일 때만 `modelCeiling: resolveModelCeiling()`을 넘긴다.
- `:60-69` 분기: `promptContextResult` → (session-start만) `withModelCeiling` → `withObservedMainModel(…, { floor: effectiveTier("stronger", modelCeiling.ceiling) })` → `withUpdateNotice`.
- `withModelCeiling(result, { ko, setting })`: 줄(`setting.ceiling`이 있을 때)과 알림(`setting.invalid`가 있을 때)을 `appendNotice(result, line, notice)`로 붙인다. 둘 다 없으면 `result` 그대로. try/catch로 오류 시 `result`.
- `observeMainModel(root, payload, { now, floor = "stronger" })`: `low = classified && isBelowTier(classified.tier, floor)`. 줄과 알림에 `threshold: floor` 전달.

**바꾸지 않는 것**: `hooks/hooks.json`, `scripts/pota-goal-state-validation.mjs`, `scripts/pota-goal.mjs`, `scripts/pota.mjs`, `scripts/pota-lifecycle-*.mjs`, `scripts/pota-goal-history.mjs`, `package.json`, `.codex-plugin/plugin.json`, `claude-mod/`, `skills/pota-{plan,work}/SKILL.md`, `agents/*.md`.

#### 3. 정책 표면

**SKILL.md 2개**: 수정하지 않는다(8993·8975바이트, `test/token-efficiency.test.mjs:379-384`). `skills/pota-plan/SKILL.md:60`의 "strongest `fable`"은 상한 없는 기본 표로 남는다. 상한이 있으면 캡슐 줄의 "This overrides tier values in skill text"와 `delegation.md`의 `## Model Ceiling`이 우선한다.

**정본: 두 `delegation.md` 끝에 같은 절 추가**

```markdown
## Model Ceiling

The tier values above assume every tier is usable. When the account cannot or should not use the higher tiers (subscription, organization policy, usage credits), the user sets a ceiling: `POTA_MODEL_CEILING=stronger|balanced`, or `"modelCeiling"` in `~/.pota/config.json` (the environment variable wins; a model name such as `opus` or `sonnet` is read as its tier). The session-start hook then adds one `Pota model ceiling:` line to the capsule.

- With that line present, tiers above the ceiling use the ceiling tier's model: ceiling `stronger` runs strongest-tier work (Heavy design) on the stronger model; ceiling `balanced` runs stronger- and strongest-tier work on the balanced model. The line overrides the tier values in skill text, templates, and the table above. Never dispatch above the ceiling, and stop the one-tier-up re-dispatch at the ceiling.
- The task structure does not change: Heavy design stays a separate `kind: "design"` dispatch, and planning, triage, and review are still dispatched when the capsule has a `Pota main model:` line. Pass the capped value through the host option and record it (`goal assign --model <capped value> --model-source host-option --host <claude-code|codex|antigravity>`); write `Requested model` as the capped value with `(ceiling <tier>)`. Put the `Pota model ceiling:` line in each delegation prompt's `CONTEXT:`.
- Enforced by the CLI with the same setting: the design gate accepts the ceiling tier's model or any higher one, and the main-model gate uses the capped stronger tier (ceiling `balanced`: only a fast main session is gated, and a balanced dispatch passes).
- The ceiling is the user's setting. Never set `POTA_MODEL_CEILING` yourself, for a session or for a single command, and never edit `config.json`.
- Without that line, when a host rejects a dispatch because the model is unavailable: do not retry the same model. Re-dispatch one tier down as a new dispatch, record the value actually passed, and complete the affected gate with its waiver (`--allow-no-design-model <reason>` or `--allow-main-model <reason>`) naming the rejected model.
- Without that line, when a worker reports a model ID of a lower tier than the passed value (the host substituted it): keep the result, do not re-dispatch the same model, record `goal assign --effective-model <id>` and a `Model substitution:` line in the plan's Evidence.
- In both cases tell the user once which model was unavailable and that a model ceiling can be set.
- An invalid value applies no ceiling: the hook shows the user a notice and the CLI warns on stderr. `strongest` means no ceiling; `fast` is not accepted.
```

두 `delegation.md`의 기존 문장 보강:
- `:64` 설계 게이트 문장 뒤: ` Under a model ceiling the ceiling tier's model or a higher one passes (see Model Ceiling).`
- `:71` "to the stronger tier or above" 뒤: ` (the capped stronger tier under a model ceiling)`
- `:73` "for accounts that cannot use the stronger tier or users who keep the session model" → `for users who keep the session model; an account that cannot use the stronger tier sets a model ceiling instead (see Model Ceiling)`. `POTA_MAIN_MODEL_GATE=0`은 유지한다(`test/token-efficiency.test.mjs:555-557`).
- 프롬프트 형식의 `CONTEXT:` 줄 끝(plan `:37`, work 대응 줄)에 `, the \`Pota model ceiling:\` line when present` 추가. `test/contract-parity.test.mjs:186` 정규식은 유지된다.

**파생 표면**

| 파일 | 변경 |
| --- | --- |
| `skills/pota-plan/heavy-path.md:9` | "This is the only bypass." 뒤에: `When the session-start capsule has a \`Pota model ceiling:\` line, the strongest tier is the ceiling tier's model (\`delegation.md\` "Model Ceiling"): dispatch the design there and the gate accepts it.` |
| `skills/pota-work/heavy-path.md:8` | 같은 위치에: `Under a \`Pota model ceiling:\` capsule line the gate accepts the ceiling tier's model or higher (\`delegation.md\` "Model Ceiling").` |
| `templates/work-plan.md:45` | bullet 끝에: `When the capsule has a \`Pota model ceiling:\` line, tiers above the ceiling use the ceiling tier's model, the design gate accepts it, and \`Requested model\` records the capped value; the ceiling is the user's setting (\`POTA_MODEL_CEILING\` or \`"modelCeiling"\` in \`~/.pota/config.json\`), never set by the agent.` |
| `docs/model-guidance/README.md`(`:56` 뒤) | bullet 1개: `Model ceiling: when the user sets \`POTA_MODEL_CEILING=stronger\|balanced\` (or \`"modelCeiling"\` in \`~/.pota/config.json\`), the session-start capsule has a \`Pota model ceiling:\` line; tiers above the ceiling use the ceiling tier's model, the design gate accepts that model or higher, and the main-model gate uses the capped stronger tier. The agent never sets the ceiling. An invalid value applies none.` |
| `docs/model-guidance/claude.md`(`:22` 뒤) | `With a \`Pota model ceiling:\` line, dispatch above-ceiling work on the ceiling model (\`stronger\`: Heavy design on \`opus\`; \`balanced\`: planning, review, and Heavy work on \`sonnet\`) and record that value; \`POTA_MODEL_CEILING\` is set by the user (for example in \`settings.json\` \`env\`), never by the agent.` |
| `docs/model-guidance/codex.md`(`:23` 뒤) | 같은 문장의 Codex 판(`gpt-6-sol`, `gpt-6.1-terra`)에 `Prefer \`"modelCeiling"\` in \`~/.pota/config.json\`: a shell environment policy can hide the variable from hooks or commands.` 추가 |
| README 8개 | "Main model check" bullet 바로 뒤(`README.md:174`, `README.ko.md:166`, 나머지 `:148`)에 bullet 1개 |
| `docs/memory/delegation-model-routing.md` | "모델 상한" 소절: 출처·우선순위·파싱, 유효 tier, 두 게이트 규칙, 힌트, 대체·거부 정책 |
| `docs/memory/hook-context.md` | 줄 순서·문구·무효 알림, 예산 표에 "모델 상한 줄 380 / 무효 알림 240", 진입점에서만 resolve |
| `docs/memory/policy-surfaces.md` | 위 표면 목록 1항목 |
| `docs/memory/lifecycle-install.md` | `config.json` 키에 `modelCeiling`, 테스트 주의 |
| `docs/memory/goal-state.md` | 상한은 상태·이력에 저장하지 않는다는 1줄 |

`Summary:` 줄은 바꾸지 않는다. 설치 미러 금지 패턴은 문구에 없다. `commands/pota-{plan,work}.md`, `.agents/workflows/*`, `agents/*.md`, `skills/pota-review/SKILL.md`는 고치지 않는다(모델 값 문구가 없거나 캡슐 줄과 `CONTEXT:`로 전달된다).

README bullet(식별자는 전 locale 영문 그대로):

- **en**: `- Model ceiling: when the account cannot or should not use the higher tiers (subscription, organization policy, usage credits), set \`POTA_MODEL_CEILING=stronger\` (or \`balanced\`; a model name such as \`opus\` or \`sonnet\` also works), or \`"modelCeiling": "stronger"\` in \`~/.pota/config.json\`. The environment variable wins, and \`config.json\` is the one place every hook and CLI call reads. \`SessionStart\` then adds a \`Pota model ceiling:\` line, tiers above the ceiling use the ceiling tier's model, the Heavy design gate accepts that model, and the main model check uses the capped stronger tier. Without a setting nothing changes; an invalid value applies no ceiling and is reported.`
- **ko**: `- 모델 상한: 계정에서 상위 tier를 쓸 수 없거나 쓰지 않을 때(구독 등급, 조직 정책, usage credits) \`POTA_MODEL_CEILING=stronger\`(또는 \`balanced\`, \`opus\`·\`sonnet\` 같은 모델 이름도 가능)를 설정하거나 \`~/.pota/config.json\`에 \`"modelCeiling": "stronger"\`를 적습니다. 환경변수가 우선이고, \`config.json\`은 모든 hook과 CLI 호출이 똑같이 읽는 위치입니다. 설정하면 \`SessionStart\`가 \`Pota model ceiling:\` 줄을 추가하고, 상한보다 높은 tier는 상한 tier의 모델을 쓰며, Heavy 설계 게이트가 그 모델을 통과시키고, main 모델 확인은 상한이 적용된 stronger tier를 기준으로 합니다. 설정이 없으면 동작은 그대로이고, 잘못된 값은 상한 없이 알림만 냅니다.`
- **ja**: `- model ceiling: アカウントで上位 tier を使えない、または使わない場合(サブスクリプション、組織ポリシー、usage credits)は \`POTA_MODEL_CEILING=stronger\`(または \`balanced\`。\`opus\` や \`sonnet\` などの model 名も可)を設定するか、\`~/.pota/config.json\` に \`"modelCeiling": "stronger"\` を書きます。環境変数が優先され、\`config.json\` はすべての hook と CLI 呼び出しが同じ値を読む場所です。設定すると \`SessionStart\` が \`Pota model ceiling:\` 行を追加し、ceiling より上の tier は ceiling tier の model を使い、Heavy 設計ゲートはその model を通し、main model チェックは ceiling 適用後の stronger tier を基準にします。設定がなければ動作は変わらず、無効な値は ceiling なしとして通知されます。`
- **zh**: `- model ceiling: 当账户不能或不打算使用更高的 tier 时(订阅等级、组织策略、usage credits),设置 \`POTA_MODEL_CEILING=stronger\`(或 \`balanced\`;也可以写 \`opus\`、\`sonnet\` 等 model 名),或在 \`~/.pota/config.json\` 中写入 \`"modelCeiling": "stronger"\`。环境变量优先,\`config.json\` 是所有 hook 和 CLI 调用都会读取的同一位置。设置后 \`SessionStart\` 会添加一行 \`Pota model ceiling:\`,高于 ceiling 的 tier 使用 ceiling tier 的 model,Heavy 设计门禁接受该 model,main model 检查以应用 ceiling 后的 stronger tier 为准。未设置时行为不变;无效值不应用 ceiling 并给出提示。`
- **es**: `- Model ceiling: cuando la cuenta no puede o no debe usar los tiers superiores (suscripción, política de la organización, usage credits), define \`POTA_MODEL_CEILING=stronger\` (o \`balanced\`; también vale un nombre de model como \`opus\` o \`sonnet\`) o \`"modelCeiling": "stronger"\` en \`~/.pota/config.json\`. La variable de entorno tiene prioridad, y \`config.json\` es el único lugar que leen por igual todos los hooks y llamadas de la CLI. \`SessionStart\` añade entonces una línea \`Pota model ceiling:\`, los tiers por encima del ceiling usan el model del tier del ceiling, la puerta de diseño Heavy acepta ese model y la comprobación del main model usa el tier stronger limitado. Sin configuración nada cambia; un valor no válido no aplica ningún ceiling y se notifica.`
- **fr**: `- Model ceiling : lorsque le compte ne peut pas ou ne doit pas utiliser les tiers supérieurs (abonnement, politique de l'organisation, usage credits), définissez \`POTA_MODEL_CEILING=stronger\` (ou \`balanced\` ; un nom de model tel que \`opus\` ou \`sonnet\` convient aussi) ou \`"modelCeiling": "stronger"\` dans \`~/.pota/config.json\`. La variable d'environnement est prioritaire, et \`config.json\` est l'emplacement unique lu de la même façon par tous les hooks et appels de la CLI. \`SessionStart\` ajoute alors une ligne \`Pota model ceiling:\`, les tiers au-dessus du ceiling utilisent le model du tier du ceiling, la porte de conception Heavy accepte ce model et la vérification du main model utilise le tier stronger plafonné. Sans réglage, rien ne change ; une valeur invalide n'applique aucun ceiling et est signalée.`
- **de**: `- Model ceiling: Wenn das Konto die höheren tiers nicht nutzen kann oder soll (Abonnement, Organisationsrichtlinie, usage credits), setze \`POTA_MODEL_CEILING=stronger\` (oder \`balanced\`; ein model-Name wie \`opus\` oder \`sonnet\` geht ebenfalls) oder \`"modelCeiling": "stronger"\` in \`~/.pota/config.json\`. Die Umgebungsvariable hat Vorrang, und \`config.json\` ist der eine Ort, den alle hooks und CLI-Aufrufe gleich lesen. \`SessionStart\` fügt dann eine Zeile \`Pota model ceiling:\` hinzu, tiers über dem ceiling verwenden das model des ceiling-tier, das Heavy-Design-Gate akzeptiert dieses model, und die Main-model-Prüfung verwendet den gedeckelten stronger tier. Ohne Einstellung ändert sich nichts; ein ungültiger Wert wendet kein ceiling an und wird gemeldet.`
- **pt**: `- Model ceiling: quando a conta não pode ou não deve usar os tiers superiores (assinatura, política da organização, usage credits), defina \`POTA_MODEL_CEILING=stronger\` (ou \`balanced\`; um nome de model como \`opus\` ou \`sonnet\` também serve) ou \`"modelCeiling": "stronger"\` em \`~/.pota/config.json\`. A variável de ambiente tem prioridade, e \`config.json\` é o único lugar lido da mesma forma por todos os hooks e chamadas da CLI. \`SessionStart\` então adiciona uma linha \`Pota model ceiling:\`, os tiers acima do ceiling usam o model do tier do ceiling, o gate de design Heavy aceita esse model e a verificação do main model usa o tier stronger limitado. Sem configuração nada muda; um valor inválido não aplica nenhum ceiling e é informado.`

#### 4. 테스트 계약

작성 규칙:
- 라이브러리 호출은 `modelCeiling`을 명시하고, `handleGoalCli`에는 `env`를 주입한다.
- hook helper는 `modelCeiling: resolveModelCeiling({ env })`를 넘긴다.
- spawn할 때는 env에서 `POTA_MODEL_CEILING`을 지우거나 명시한다.
- `POTA_HOME`은 임시 경로로 둔다.
- 기존 테스트의 단언은 바꾸지 않는다.

**신규 `test/model-ceiling.test.mjs`**: 예상 초기 실패는 `scripts/pota-model-ceiling.mjs` 없음(ERR_MODULE_NOT_FOUND)으로 파일 전체 실패.

| # | 테스트 이름 | 검증 |
| --- | --- | --- |
| C1 | `parseModelCeiling reads tier names and model names, treats strongest as no ceiling, and rejects fast and unknown values` | D2 예시 전부. `" Stronger "` → set. `42`·`true`·`{}` → invalid. `""`·`undefined`·`null` → unset |
| C2 | `effectiveTier, effectiveModel, and modelsAtOrAbove cap the tier table per host` | 상한 없음은 원표. `effectiveModel("claude-code","strongest","stronger") === "opus"`. `modelsAtOrAbove("antigravity","stronger")`는 `["pro"]`, `("claude-code","stronger")`는 `["opus","fable"]`. `validCeiling("fast") === null` |
| C3 | `resolveModelCeiling prefers the environment, falls back to config.json, and never throws or writes` | env 유효. env 빈 값 + config. env 무효 + config 유효 → 상한 없음 + `invalid.source === "env"`. env `strongest` + config `balanced` → 상한 없음, invalid 없음. config 없음·깨짐·배열·symlink·디렉터리 → `NO_MODEL_CEILING`과 `deepEqual`. `modelCeiling: 5` → invalid(config). 없는 home은 ENOENT 유지 |
| C4 | `SessionStart adds the model ceiling line after the Pota CLI line and before the main-model line` | en·ko × 2 상한 고정 문자열 4개 `assert.equal`. haiku payload일 때 끝 3줄 순서가 CLI, ceiling, main model. 유효 상한만 있으면 `systemMessage` 없음 |
| C5 | `no ceiling keeps SessionStart and UserPromptSubmit output byte-identical and writes nothing` | 옵션 생략, `NO_MODEL_CEILING`, `resolveModelCeiling({ env: {} })`, env `strongest` 모두 baseline과 `JSON.stringify` 동일. `lstat(POTA_HOME)` ENOENT |
| C6 | `UserPromptSubmit never carries the ceiling line or the invalid notice` | 상한 유효·무효 모두 UPS 출력이 baseline과 동일 |
| C7 | `an invalid ceiling adds only a user notice on SessionStart` | `additionalContext`는 baseline과 같고 `systemMessage`는 `modelCeilingInvalidNotice(...)`와 같음. 낮은 main 모델과 겹치면 무효 알림이 먼저 |
| C8 | `model ceiling lines stay within 380 and 240 characters and stay on one line` | en·ko × 2 상한. 무효 알림은 200자 값 × 2 출처. `\n` 없음. 접두 `/^Pota model ceiling: /` |
| C9 | `ceiling balanced gates only a fast main session and names the balanced model` | sonnet payload는 줄·기록 없음(이전 기록 삭제). haiku는 줄에 `(fast tier, below balanced)`와 `sonnet`, 기록 생성 |
| C10 | `the design gate accepts the ceiling tier's model or higher and still rejects lower models` | D3 목록. 에러 정규식 `recorded model sonnet, expected opus \| fable for host claude-code \(model ceiling stronger\)`. `modelCeiling` 생략·`null`·`"turbo"`·`"fast"`면 `opus` 거부 |
| C11 | `the main-model gate uses the capped stronger tier` | 상한 `balanced`: 상한 없이 기록된 sonnet 세션은 triage 완료·`finishGoal`·`transitionGoal(completed)` 통과. haiku 기록은 `at the balanced tier \(model ceiling balanced\).*to sonnet and record`로 거부, `sonnet` dispatch 뒤 통과, `haiku` dispatch는 거부. 상한 `stronger`: 안내가 `to opus and record`, `opus`·`fable` dispatch 통과 |
| C12 | `gate errors point to the model ceiling unless it is already balanced` | 상한 없음·`stronger`는 힌트 있음(옵션 문자열 포함). `balanced`는 없음. "has no recorded design model" 에러에는 없음 |
| C13 | `goal CLI reads the ceiling from POTA_MODEL_CEILING and config.json on task, finish, and complete` | env `stronger` + `opus` 설계 task 완료. env 없음 + 임시 home `config.json`으로 완료. 둘 다 없으면 거부. `goal finish`·`goal complete` 경로 포함 |
| C14 | `an invalid ceiling warns once on stderr and applies no ceiling` | stderr 첫 줄 `/^Pota warning: ignoring invalid model ceiling "turbo" from POTA_MODEL_CEILING/`. 게이트는 거부. `goal status`·`assign`·`pause`는 경고 없음 |
| C15 | `the hook entry point resolves the ceiling from the environment and config.json` | `scripts/pota-state.mjs session-start`를 spawn: env `opus` → 줄 있음, config만 → 줄 있음, 둘 다 없음 → 줄 없음. `user-prompt-submit`은 항상 없음 |
| C16 | `the effective-model mismatch warning adds the ceiling hint only for a lower tier` | `fable` + `claude-opus-5-5`는 힌트 있음. `opus` + `claude-fable-5-2`와 미지의 ID는 기존 문장만 |

**수정 `test/token-efficiency.test.mjs`**: 테스트 1개 추가, 기존 단언 불변.

| # | 테스트 이름 | 검증 | 예상 초기 실패 |
| --- | --- | --- | --- |
| C17 | `model ceiling surfaces name the capsule line, the setting, and the user-only rule` | 두 `delegation.md`: `/^## Model Ceiling$/m`, `` `Pota model ceiling:` ``, `POTA_MODEL_CEILING`, `"modelCeiling"`, `/Never set .POTA_MODEL_CEILING. yourself/`, `Model substitution:`, CONTEXT 줄의 `` `Pota model ceiling:` ``. heavy-path 2개, `templates/work-plan.md`, `docs/model-guidance/{README,claude,codex}.md`: `` `Pota model ceiling:` ``. README 8개: `POTA_MODEL_CEILING=stronger`, `"modelCeiling"`, `` `Pota model ceiling:` `` | 문구 없음으로 단언 실패 |

그대로 통과해야 하는 기존 계약:
- `test/main-model-gate.test.mjs` 전부(고정 문자열, 340/240 예산, fail-open 매트릭스)
- `test/goal-effort.test.mjs` 전부(`:443`, `:474-494`, `:554`, `:569`)
- `test/token-efficiency.test.mjs:379-384`(9000바이트), `:502-534`, `:536-558`
- `test/index-context.test.mjs`, `test/goal-state.test.mjs:867`, `test/state-recovery-hardening.test.mjs`
- `test/auto-upgrade.test.mjs:572-609`, `test/lifecycle.test.mjs:506`, `test/contract-parity.test.mjs:186`, `test/docs-package-hardening.test.mjs:89-126`

#### 5. `model-ceiling` task 검증 명령

- Tests: `node --test test/model-ceiling.test.mjs test/main-model-gate.test.mjs test/goal-effort.test.mjs test/token-efficiency.test.mjs`
- Module acceptance: `node --test test/model-ceiling.test.mjs test/main-model-gate.test.mjs test/goal-effort.test.mjs test/goal-state.test.mjs test/goal-dag.test.mjs test/goal-history.test.mjs test/state-recovery-hardening.test.mjs test/cli-contract-hardening.test.mjs`
- Surface integration: `node --test test/token-efficiency.test.mjs test/index-context.test.mjs test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/verification-contracts.test.mjs test/auto-upgrade.test.mjs test/installed-plugin.test.mjs`
- 문서 검사: `pota memory check --root <repoRoot>`, `pota plan check --root <repoRoot>`가 exit 0.
- 전체 `npm run check`는 `verify` task의 `goal finish`에서 1회.
- 구현 순서: 테스트(C1~C17) → `pota-model-tier.mjs` → `pota-model-ceiling.mjs` → `pota-goal-state.mjs` → `pota-goal-operations*.mjs` → `pota-goal-cli.mjs` → `pota-state-context.mjs` → `pota-state.mjs` → 정책 표면 → README → `docs/memory`.

#### 6. 가정과, 틀렸을 때의 동작

| # | 가정(미검증) | 틀리면 |
| --- | --- | --- |
| 1 | Claude Code `settings.json` `env`가 hook 프로세스에도 전달된다(Bash만 실측) | hook에 줄이 없고 CLI만 상한을 본다: 게이트만 완화, dispatch는 지금과 같다. README가 `config.json`을 공통 위치로 안내한다 |
| 2 | 가용하지 않은 모델의 dispatch는 거부되거나 조용히 대체된다(entitlement 동작 미확인) | 정책이 두 경우를 모두 다룬다. 조용한 대체를 ID 보고 없이 잡지는 못한다(known limit) |
| 3 | hook과 CLI의 `POTA_HOME`이 같다 | 기존 main 모델 기록과 같은 전제다. 다르면 한쪽만 상한을 보고 1번과 같은 결과다 |
| 4 | SessionStart가 compact·resume 때도 다시 발생해 줄이 유지된다 | `Pota CLI:` 줄과 같은 전제다. 줄이 사라져도 CLI 게이트는 상한을 적용한다 |
| 5 | Codex `shell_environment_policy` 기본값이 `POTA_*`를 통과시킨다 | CLI만 못 보면 지금처럼 엄격히 거부하고 에러가 `config.json`을 안내한다 |

릴리스 전 권장 수동 확인(자동 증거 아님): 설치본에서 `settings.json` `env`에 `POTA_MODEL_CEILING=stronger`를 두고 세션을 열어 캡슐 줄을 확인하고, `--model opus` 설계 task가 완료되는지 본다.

#### 7. 의도적으로 하지 않는 것 (known limits)

- 가용 모델·구독 등급 자동 감지, `resolvedModel` 관측, `hooks/hooks.json` 변경.
- 게이트는 요청값만 본다. `effectiveModel`이 상한이나 요청보다 낮아도 막지 않고 경고만 낸다.
- 상한을 state·history·`goal stats`에 기록하지 않는다(schema 3 유지). 감사 기록은 계획의 `Requested model … (ceiling <tier>)`뿐이다.
- 에이전트가 명령 앞에 `POTA_MODEL_CEILING=…`을 붙여 게이트를 완화하는 것은 정책으로만 금지한다. `POTA_MAIN_MODEL_GATE=0`과 같은 한계다.
- 설정용 CLI 명령(`pota model-ceiling …`)이 없다. 손으로 깨뜨린 `config.json`은 상한 없음이 되고 자동 업그레이드도 꺼진다(기존 동작).
- 호스트별·프로젝트별 상한이 없다(tier 하나가 모든 호스트에 적용). 상한 `fast`는 지원하지 않는다.
- Antigravity는 hook이 없어 캡슐 줄이 없다. CLI 게이트만 상한을 적용한다. 상한 `stronger`는 Antigravity에서 값이 같아 효과가 없다.
- subagent는 캡슐을 받지 않을 수 있다. 위임 프롬프트의 `CONTEXT:`로만 전달된다.
- SKILL.md 2개와 `agents/worker.md`의 "strongest `fable`" 문구는 그대로다.
- 무효 알림은 중복 제거 없이 SessionStart마다 나온다(상태 파일을 쓰지 않기 위해서).
- 이 저장소의 테스트를 `POTA_MODEL_CEILING`을 export한 채 돌리는 것은 지원하지 않는다. `...process.env`로 spawn하는 기존 hook 테스트가 줄을 하나 더 받는다. in-process 테스트와 `config.json` 경로는 격리돼 있다.
- 상한에 의한 통과를 stderr로 알리지 않는다.

##### Critical Files for Implementation
- /Users/wknam/workspace/pota-harness/scripts/pota-model-tier.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-goal-operations.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-state.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-state-context.mjs
- /Users/wknam/workspace/pota-harness/skills/pota-plan/delegation.md

## Evidence

- Dispatch 기록:
  - `heavy-design`: Agent `model: "fable"`, `effort: "high"` → Effective `fable (claude-fable-5-2)` / `high`.
  - `model-ceiling`: Agent `model: "opus"`, `effort: "high"` → Effective `opus (claude-opus-5-5)` / `high`. 리뷰 지적 수정은 새 dispatch(`opus`/`high`, `claude-opus-5-5`).
  - `verify`: read-only 리뷰 Agent `model: "opus"`, `effort: "xhigh"` → Effective `opus (claude-opus-5-5)` / `xhigh`.
- Tests: 테스트 먼저 작성, 초기 실패 확인(`ERR_MODULE_NOT_FOUND`, C17 단언 실패). 구현 후 §5 Tests 80/80.
- Module acceptance: `goal verify --kind moduleAcceptance`(§5 명령, `env -u POTA_MODEL_CEILING`) exit 0, 144건 통과.
- Surface integration: `goal verify --kind surfaceIntegration`(§5 명령) exit 0, 97건 통과.
- 리뷰(2026-11-19): Critical·Major 없음. 반영한 Minor: 짝 없는 surrogate로 무효 알림이 240자를 넘던 문제(395→195자), 상한 아래 설계 게이트 에러의 dispatch 안내, 불일치 경고 힌트 조건, 테스트 보강(UPS floor, `goal finish` 경로, `## Model Ceiling` 절 바이트 동일), home 계산 try 내부 이동, own-property 검사, README `config.json` 설명. 수정 후 7개 파일 115건 통과, `memory check` ok.
- 설계와 달라진 점: 상한 값 `pro`는 D2의 "상한 없음"이 아니라 무효(알림)로 처리한다. 구독 요금제 이름 "Pro"와 혼동되기 때문이다. `--host`가 없을 때 상한 아래 설계 에러는 `opus | gpt-6-sol | pro`를 안내한다.
- 반영하지 않은 지적: 읽을 수 없는 `config.json` 알림, `POTA_HOME` 경로를 반영한 힌트, "below the stronger tier" 문구 일반화, 세션 도중 상한 변경 시 재알림, 잘린 값 말줄임표, 함수 인자 형태 통일.
- 확인하지 못한 것: 실제 호스트에서 `settings.json` `env`가 hook에 전달되는지, Codex·Antigravity 실제 실행, 계정에 없는 모델로 dispatch했을 때의 실제 호스트 동작(문서로만 확인).
- Goal final review evidence record: `goal finish -- npm run check`.
- Memory promotion: `docs/memory/delegation-model-routing.md`, `docs/memory/hook-context.md`, `docs/memory/policy-surfaces.md`, `docs/memory/lifecycle-install.md`, `docs/memory/goal-state.md`

## Status

- [x] Planned
- [x] Implemented
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
