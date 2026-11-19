# Plan: main 모델 게이트, 테스트 시간 단축, DAG 기본 보기

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-19 작성)
- Finalized: decision-complete for implementation after planned triage. (2026-11-19, `heavy-design` 결과를 `## Heavy Design`에 반영한 뒤 `model-gate` 착수)
- Codex UI synchronization: Claude Code 데스크톱 세션이라 `update_plan`은 호스트 task list(`mcp__ccd_turn__update_plan`)로 동기화했고 `create_goal`은 없다(unavailable: 이 호스트에 해당 도구 없음).

## Goal

1. 세션의 main 모델이 stronger tier 미만일 때 계획·트리아지·리뷰·최종 검증이 그 모델로 조용히 수행되는 구멍을 막는다.
2. 전체 검사(`npm run check`, 실측 3분 55초)의 wall-clock을 줄인다.
3. DAG 패널이 기본으로 전체 그래프를 보여 주고, 이전·현재·다음은 사용자가 고르는 옵션이 되게 한다(작업 중 사용자 추가 요청).

- Goal ID: `goal-9fe933d4-e2c8-485b-80cb-48215e8c1625`
- Plan ID: `docs/plan/main-model-gate-and-test-time.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria (advisory): 위 3개가 테스트로 고정되고 `npm run check`가 통과한다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome: 위 Goal 3개.
- Affected surfaces:
  - 모델 게이트: `scripts/pota-state.mjs`, `scripts/pota-state-context.mjs`, `scripts/pota-goal-*.mjs`, `hooks/hooks.json`(필요 시), `skills/pota-{plan,work}/delegation.md`, `skills/pota-review/SKILL.md`, 파생 표면(`commands/`, `.agents/workflows/`, `templates/work-plan.md`, `agents/`, README 8개), `test/goal-effort.test.mjs`, `test/token-efficiency.test.mjs`, `test/contract-parity.test.mjs`, `test/index-context.test.mjs`, `docs/memory/{delegation-model-routing,hook-context,policy-surfaces}.md`. 정확한 목록은 `heavy-design`이 확정한다.
  - 테스트 시간: `test/lifecycle-transaction.test.mjs`와 그 분할 파일, 공용 헬퍼 파일.
  - DAG: `claude-mod/hooks/register.tsx`, `claude-mod/hooks/dag-model.mjs`, `test/claude-mod.test.mjs`, `claude-mod/tests/pane.test.tsx`, README 8개의 `/dag` 줄.
- Task classification: 모델 게이트는 Heavy(완료 게이트 의미 변경, hook이 쓰는 새 상태), 나머지 둘은 Light.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/delegation-model-routing.md`
- `docs/memory/policy-surfaces.md`
- `docs/memory/hook-context.md`
- `docs/memory/goal-state.md`
- `docs/memory/release-process.md`(15~16행: `prepack` 중복 실행과 `--ignore-scripts` 허용 근거)
- Related completed plans: `docs/plan/heavy-design-model-routing.md`, `docs/plan/delegation-model-identity-rules.md`, `docs/plan/dag-terminal-graph.md`

## Model Guidance

- Applied model family: Claude.
- Referenced guidance:
  - `pota://docs/model-guidance/README.md`
  - `pota://docs/model-guidance/claude.md`
- Rationale: worker에게 계약·파일 범위·검증 명령을 명시적으로 주고 최소 변경을 요구한다.
- Role-specific adjustment: 설계는 read-only, 구현은 writeScope 한정.
- User-visible response and artifact locale: 한국어.

## Reasoning Effort Profile

- Light task: `medium`. Heavy task: `high`. 최종 리뷰: `xhigh`.
- 모델·effort는 모든 dispatch에서 Agent `model`/`effort`로 넘긴다(`fork` 금지).

## Triage Findings

### 모델 게이트

- 라우팅은 dispatch에만 적용된다. main이 직접 하는 일은 검사하지 않는다: `ensureHeavyEffortApplied`·`ensureHeavyDesignRecorded`는 `!task.assignedAgentId`면 통과한다(`scripts/pota-goal-operations.mjs:207-233`).
- `finalReview`는 `goal finish -- <argv>`의 exit 0만 묶는다. 리뷰 수행자·모델은 기록되지 않는다(`docs/memory/goal-state.md`).
- `pota-review`의 리뷰 위임은 선택이다(`skills/pota-review/SKILL.md` Procedure 4).
- 이력: goal 21건 중 Heavy task가 없는 10건은 모두 `delegated=0`(`goal stats --history`와 `history.jsonl`).
- main 모델 식별 수단(공식 문서 조회, 2026-11-19, 실제 payload로는 미검증):
  - Claude Code: SessionStart stdin에 선택 필드 `model`(생략 가능, 값 형식 미명시). UPS·Stop에는 없다. 세션 중 변경은 `PostModelSwitch` 이벤트의 `to_model`(v2.1.251+).
  - Codex: SessionStart·UPS payload에 `model`(active model slug).
  - 환경변수로는 확인되지 않았다.
- 예산: `skills/pota-{plan,work}/SKILL.md`는 9000바이트 상한에 여유 7·25바이트라 새 문구는 참조 파일(`delegation.md`)에 둔다. UPS 캡슐은 여유가 없어 싣지 않는다. SessionStart 추가 줄은 조건부(낮은 tier일 때만)로 둔다.
- 과거 결정: `heavy-design-model-routing`은 "main이 직접 수행하는 미배정 Heavy task는 검사 대상이 아니다"를 알려진 한계로 남겼다(78행).

### 테스트 시간

- 파일 단독 실행 시간(ms): `lifecycle-transaction` 195365, `lifecycle` 58243, `auto-upgrade` 55601, `packed-install` 24220, `lifecycle-hardening` 24184, 나머지는 각 11초 이하. 직렬 합 414초, `npm test` wall 235초(12코어, 139% CPU).
- `node --test`는 파일 단위로 병렬 실행하고 파일 안은 직렬이다. 테스트가 `spawnSync`를 쓰므로 파일 안 concurrency 옵션은 효과가 없다. 따라서 wall은 가장 긴 파일(195초)에 묶인다.
- `lifecycle-transaction.test.mjs`는 59개 테스트, 약 1380행, 헬퍼는 1273행 이후에 있다. 테스트마다 격리된 임시 home을 쓴다(`withHome`).
- `npm pack --dry-run`은 `prepack`으로 전체 검사를 다시 돌린다(실측 확인). 이미 `release-process.md`가 content-neutral 근거로 로컬 `--ignore-scripts`를 허용하므로 이 계획에서 바꾸지 않는다.
- 결정: `lifecycle-transaction.test.mjs`를 4개 안팎의 파일로 나눠 가장 긴 파일을 60초 이하로 만든다. 예상 wall은 약 60초(현재 다음으로 긴 `lifecycle` 58초에 묶임). 그 아래로 더 줄이는 일(다른 두 파일 분할)은 이번 범위 밖이다.

### DAG 기본 보기

- 보기 4종(`previous|current|next|all`)과 `/dag <view>`는 이미 있다. 기본값만 `current`다: `claude-mod/hooks/register.tsx:65`(`dagUi` 초기값), `claude-mod/hooks/dag-model.mjs:284`(잘못된 view의 fallback).
- `dagUi`는 `shape: "ui-1"`로 저장된다. 주석대로 tag를 바꾸면 이전 버전이 저장한 값을 버리므로, 기존 사용자의 저장된 `current`가 남지 않게 `ui-2`로 올린다.
- `/dag`(인자 없음)는 저장된 view를 유지한다. 사용자가 고른 보기는 그대로 둔다.

## Complexity Triage

- Selected path: 혼합. `model-gate`는 Heavy Path, `test-split`·`dag-default-all`은 Light Path.
- Selection rationale: 모델 게이트는 완료 게이트의 통과 조건을 바꾸고 hook이 세션 모델을 기록하는 새 상태를 만든다. 나머지 둘은 기존 계층 안의 좁은 변경이다.
- Checkpoint ledger:
  - Request checkpoint: 잠정 Light. main 모델 식별 수단과 새 상태 필요 여부가 불확실했다.
  - Planning checkpoint: 모델 게이트를 Heavy로 승격. 근거: 완료 게이트 의미 변경, hook payload 계약(호스트별 차이), 새 상태 파일 또는 필드. 나머지는 Light 유지.
  - Code checkpoint: pending(각 task의 worker가 첫 편집 직전에 기록).
- Heavy Path signals checked:
  - New directory/module/layer: 없음.
  - New domain model/service/abstraction: 있음(세션 main 모델 기록과 tier 분류).
  - Security/auth/session: 없음.
  - External API/message queue/payment: 없음.
  - DB schema/migration: 없음(goal state schema 버전은 올리지 않는 것을 설계 제약으로 둔다).
  - Concurrency/transaction/cache invalidation: hook이 상태를 쓰면 state lock 규칙을 따라야 한다(설계에서 확인).
  - Cross-domain refactor: 없음.
  - Explicit extra-care signal: 없음.
- Heavy Path trigger: 새 추상화와 완료 게이트 변경.
- Pre-implementation decisions(설계가 답해야 함):
  1. main 모델을 어디서 얻고 어디에 저장하는가(hook이 쓰는 guard류 파일 vs CLI 인자 vs 저장하지 않음). 읽기 전용 hook 원칙과 `reminder-guard.json` 선례를 함께 본다.
  2. 모델 ID → tier 분류 규칙(호스트별 표, 미지의 ID 처리: 경고는 fail-open, 게이트는 어떻게).
  3. 게이트의 발동 조건과 통과 조건: 무엇을 막는가(`goal finish`, `triage-plan` 완료), 무엇이 통과시키는가(stronger 이상으로 dispatch한 리뷰 기록), 우회 플래그 이름.
  4. 세션 중 모델 변경(`PostModelSwitch`)과 `model` 필드가 없는 경우의 동작.
  5. 사용자에게 보이는 알림(`systemMessage`) 문구와 문자 예산.
  6. 고칠 정책 표면 목록과 테스트 계약.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | - | 세션 모델(not-applied: main 직접 수행) | not-applied |
| `heavy-design` | 설계 subagent(read-only) | heavy | `fable` | `high` |
| `test-split` | `worker` | light | `sonnet` | `medium` |
| `dag-default-all` | `worker` | light | `sonnet` | `medium` |
| `model-gate` | `worker` | heavy | `opus` | `high` |
| `verify` | 리뷰 subagent(read-only) + main의 `goal finish` | - | `opus` | `xhigh` |

## Tool Readiness

- Detected stack: javascript, typescript.
- Toolcheck command: `pota toolcheck --root <repoRoot>` → node, npm, typescript-language-server, tsc 모두 OK.
- Missing tools: 없음. Install approval: not needed.

## Execution Guardrails

- Test contract first. 기존 테스트·fixture·검증 명령을 약화하지 않는다. `test-split`은 테스트 본문을 옮기기만 하고 테스트 이름과 개수(59)를 보존한다(위치 변경이 유일한 계약 변경이며 사유는 wall-clock 단축).
- Verification ladder: task별 집중 테스트 → 마지막에 `npm run check` 1회(`goal finish`).
- 병렬 task는 서로 다른 writeScope만 건드린다. worker는 다른 worker의 편집을 되돌리지 않는다.
- Dry-run: 외부 상태 변경 없음(로컬 파일만). 커밋·푸시는 사용자가 요청할 때만 한다.
- Verification loop budget: task당 2회.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Requested/Effective model: 세션 모델 / not-applied: main 직접 수행
- Required evidence records: `planArtifact`, `triageDecision`(`pota plan check`로 이 파일을 묶는다).

### Task 1: main 모델 게이트 설계

- Task ID: `heavy-design` (`kind: "design"`, `route: "heavy"`)
- Requested model / effort: `fable` / `high`
- Effective model / effort: dispatch 후 기록
- Contract: 위 Pre-implementation decisions 6개에 답하고, 변경 파일 목록·테스트 계약·문구 초안을 낸다. read-only.
- Depends on: `triage-plan`
- Write scope: `docs/plan/main-model-gate-and-test-time.md`(main이 `## Heavy Design`에 반영)
- Required evidence records: `designRecord`(`pota plan check` + `--watch` 이 파일)

### Task 2: lifecycle-transaction 테스트 분할

- Task ID: `test-split`
- Requested model / effort: `sonnet` / `medium`
- Contract: `test/lifecycle-transaction.test.mjs`의 `test()` 블록 59개(루프 확장 후 실행 68개)를 이름·본문 변경 없이 4개 안팎의 파일로 나누고 공용 헬퍼는 한 모듈로 뺀다. 가장 긴 파일의 단독 실행이 60초 이하. 헬퍼 모듈이 `node --test`에서 테스트로 실행돼도 실패하거나 부작용을 내지 않아야 한다. Windows·POSIX 모두에서 동작(경로는 `node:path`).
- Files: `test/lifecycle-transaction.test.mjs`, 새 `test/lifecycle-transaction-*.test.mjs`, 헬퍼 모듈.
- Depends on: `triage-plan`
- Write scope: `test/lifecycle-transaction.test.mjs`, `test/lifecycle-transaction-commit.test.mjs`, `test/lifecycle-transaction-rollback.test.mjs`, `test/lifecycle-transaction-recovery.test.mjs`, `test/lifecycle-transaction-hosts.test.mjs`, `test/support`
- Module acceptance verification: 분할 파일 전체를 `node --test`로 실행해 실행 수 68 유지, fail 0.
- Surface integration verification: `npm test` 통과와 wall-clock 기록(목표 90초 이하).

### Task 3: DAG 기본 보기를 전체로

- Task ID: `dag-default-all`
- Requested model / effort: `sonnet` / `medium`
- Contract: 패널을 처음 열 때(자동 열림과 인자 없는 `/dag`) 전체 그래프가 보인다. `dagUi` 초기 view와 잘못된 view의 fallback을 `all`로 바꾸고 `shape`를 `ui-2`로 올린다. `/dag previous|current|next|all`과 한국어 별칭은 그대로 동작하고, 사용자가 고른 보기는 유지된다. README 8개의 `/dag` 줄에 기본이 전체임을 반영한다.
- Files: `claude-mod/hooks/register.tsx`, `claude-mod/hooks/dag-model.mjs`, `test/claude-mod.test.mjs`, `claude-mod/tests/pane.test.tsx`, `README.md`, `README.{ko,ja,zh,es,fr,de,pt}.md`
- Depends on: `triage-plan`
- Write scope: `claude-mod`, `test/claude-mod.test.mjs`, `test/claude-mod-term.test.mjs`, `test/claude-mod-root.test.mjs`, `README.md`, `README.ko.md`, `README.ja.md`, `README.zh.md`, `README.es.md`, `README.fr.md`, `README.de.md`, `README.pt.md`
- Module acceptance verification: `node --test test/claude-mod.test.mjs test/claude-mod-term.test.mjs test/claude-mod-root.test.mjs`
- Surface integration verification: `node --test test/docs-package-hardening.test.mjs test/installed-plugin.test.mjs`(README 계약과 설치본 mod 파일)

### Task 4: main 모델 게이트 구현

- Task ID: `model-gate` (`route: "heavy"`)
- Requested model / effort: `opus` / `high`
- Contract: `## Heavy Design`의 결정대로 구현한다.
- Depends on: `heavy-design`, `dag-default-all`(README 겹침 방지)
- Write scope: `scripts`, `skills`, `commands`, `.agents`, `agents`, `.claude`, `templates`, `hooks`, `docs/memory`, `docs/model-guidance`, `README.md` 외 README 7개, `test/goal-effort.test.mjs`, `test/token-efficiency.test.mjs`, `test/contract-parity.test.mjs`, `test/index-context.test.mjs`, `test/goal-state.test.mjs`, `test/state-recovery-hardening.test.mjs`, 설계가 지정한 새 테스트 파일
- Tests: 설계가 지정한 집중 테스트 명령(`## Heavy Design`에 기록).
- Module acceptance / Surface integration verification: 설계가 지정.

### Task 5: 최종 리뷰와 검증

- Task ID: `verify`
- Requested model / effort: `opus` / `xhigh`(read-only 리뷰 dispatch), 이후 main이 `goal finish -- npm run check`
- Depends on: `test-split`, `dag-default-all`, `model-gate`

## Heavy Design

- 설계 dispatch: Claude Code Agent `model: "fable"`, `effort: "high"`(read-only, 거부 없음). 보고된 모델 ID `claude-fable-5-2`.
- Pre-implementation review(main, 2026-11-19): 설계를 그대로 채택한다. 확인한 점: 정상 사용자(opus·fable main) 비용 0과 바이트 동일 출력, 모르는 경우 전부 fail-open, schema 버전·`hooks/hooks.json`·SKILL.md 2개 불변, 검증 명령 실행 전에 `goal finish`를 거부. 구현 시 지킬 것: 아래 §2~§6을 추가 설계 판단 없이 따르고, 가정(§7)이 틀려도 안전하게 실패하는 동작을 테스트로 고정한다. `docs/memory` 노트 갱신 가운데 `test-split`이 보고한 테스트 경로 참조 수정은 main이 메모리 승격 단계에서 따로 한다.

### Heavy Design: main 모델 게이트 (task `heavy-design`)

보고 모델 ID: `claude-fable-5-2` (시스템 프롬프트 기재값). 파일 수정 없음, `pota goal` 상태 변경 없음(읽기 전용 `goal status` 1회), 호스트 task-list 도구 호출 없음.

> 구현 후 변경(리뷰 M1·M2, 아래 Evidence 참고): 기록은 단일 `main-model-guard.json`이 아니라 세션별 `main-model-<sha256(key) 앞 16자>.json`이고, "갱신 유실은 fail-open"이라는 D1의 주장은 틀렸다. §8의 "전역 off 스위치는 하지 않음"도 뒤집혀 `POTA_MAIN_MODEL_GATE=0`이 추가됐다. 아래 본문은 설계 당시 기록이다.

#### 0. 권장안 요약

- hook이 SessionStart(및 Codex UPS) payload의 `model`을 분류해, **stronger 미만(fast·balanced)으로 확인된 경우에만** 캡슐 1줄 + 사용자 `systemMessage` + 세션별 guard 기록(`main-model-guard.json`)을 남긴다.
- CLI는 그 기록이 **현재 세션 키**로 존재할 때만 두 지점을 막는다: `triageDecision` 증거를 요구하는 task의 완료, 그리고 `goal finish`/`goal complete`.
- 통과 조건은 stronger 이상 host-option dispatch 기록, 우회는 `--allow-main-model <reason>` 하나.
- 모델을 모르는 모든 경우(필드 없음, 미지의 ID, 세션 키 없음, guard 손상)는 fail-open이다. opus/fable main은 출력이 바이트 단위로 같고 파일을 쓰지 않는다.
- `hooks/hooks.json`, goal state schema(3), history 레코드, SKILL.md 2개, `defaultPrompt`, UPS 캡슐 문구는 건드리지 않는다. `PostModelSwitch` hook은 추가하지 않는다.

#### 1. 결정 6개

##### D1. main 모델의 출처와 저장

| 대안 | 내용 | 판정 |
| --- | --- | --- |
| A. hook이 쓰는 guard 파일 | payload `model`을 `<goalStateDirectory>/main-model-guard.json`에 세션별로 기록 | **채택** |
| B. CLI 인자 자기 신고(`--main-model`) | main이 시스템 프롬프트의 ID를 넘김 | 기각: 검사 대상(낮은 tier 모델)의 자기 신고에 의존하고, `goal start`가 있는 SKILL.md에 문구를 넣을 예산(7바이트)이 없다 |
| C. 저장 안 함(알림만) | hook이 경고만 출력 | 기각: 게이트가 없다 |
| D. `state.json`에 기록 | hook이 goal 상태를 mutate | 기각: revision이 올라 Stop loop guard가 진척으로 오인한다(`scripts/pota-state.mjs:179-182`). SessionStart 시점엔 goal이 없는 경우가 많다 |

A의 세부:
- 위치·형식: `hookGuardPath(root, "main-model")`(`scripts/pota-goal-state.mjs:24-26`). 내용은 `{"schemaVersion":1,"sessions":{"<sessionKey>":{"model","tier","host","at"}}}`, 최대 8개(`at` 오래된 것부터 버림).
- **낮은 tier 항목만 저장한다.** stronger 이상·미지의 ID가 보고되면 그 세션 항목을 지운다(파일이 없으면 읽기 1회로 끝).
- lock 없이 쓴다(`reminder-guard.json`·`stop-guard.json` 선례, `pota-goal-state.mjs:47-53`). 갱신 유실이나 찢어진 읽기는 `readHookGuard`가 `null`을 돌려 fail-open이 된다.
- **읽기 전용 원칙의 유일한 예외**: 낮은 tier가 확인된 때에 한해 worktree 상태 디렉터리를 만든다. 이유: Claude Code는 SessionStart에만 `model`이 있고 그 시점엔 goal이 없어 디렉터리가 없을 수 있다. `safeWriteFile`은 디렉터리를 만들지 않으므로(`scripts/pota-safe-fs.mjs:74-79`) 지금 구조로는 조용히 실패해, 새 저장소의 첫 goal이 통째로 빠진다.
- 세션 키: hook은 `payload.session_id`, CLI는 `env.CLAUDE_CODE_SESSION_ID` → 없으면 `state.goal.ownerSessionId` → 없으면 키 없음(게이트 없음).
  - 관찰 근거(문서 아님): 이 환경(Claude Code 2.1.327, claude-desktop)의 Bash 도구 env에 `CLAUDE_CODE_SESSION_ID`가 있고, 현재 goal의 `reminder-guard.json`에 hook이 남긴 `sessionId`(`dc672d75…`)와 같다. subagent의 Bash env도 main과 같은 값이다.
  - 실제 goal의 `ownerSessionId`는 `null`이었다(`goal status` 확인). owner만으로는 Claude Code에서 키를 얻지 못한다.

##### D2. 모델 ID → tier 분류와 정본

새 순수 모듈 `scripts/pota-model-tier.mjs`가 유일한 표다.

```js
export const MODEL_TIERS = Object.freeze(["fast", "balanced", "stronger", "strongest"]);
export const MODEL_TIER_BY_HOST = Object.freeze({
  "claude-code": Object.freeze({ fast: "haiku", balanced: "sonnet", stronger: "opus", strongest: "fable" }),
  codex: Object.freeze({ fast: "gpt-6-luna", balanced: "gpt-6.1-terra", stronger: "gpt-6-sol", strongest: "gpt-6-astra" }),
  antigravity: Object.freeze({ fast: "flash_lite", balanced: "flash", stronger: "pro", strongest: "pro" }),
});
export const STRONGEST_MODEL_BY_HOST = /* 위 표의 strongest 열에서 파생, frozen */;
export function classifyModel(value, host = null)   // → { tier, host } | null
export function isBelowStronger(tier)               // fast | balanced
export function isStrongerOrAbove(tier)             // stronger | strongest
```

`classifyModel` 규칙(프로토타입으로 아래 예시 전부 확인함):
- 전처리: 문자열이 아니면 `null`. `trim().toLowerCase()` 후 길이 0 또는 128 초과면 `null`.
- `claude-code`: family 토큰이 영숫자 경계로 **정확히 1개** 있을 때 그 tier. 정규식 `(^|[^a-z0-9])<family>([^a-z0-9]|$)`.
  - `haiku`, `claude-haiku-4-5-20251001` → fast / `sonnet`, `Sonnet[1m]`, `claude-sonnet-5-5[1m]` → balanced / `opus`, `claude-opus-5-5`, `us.anthropic.claude-opus-4-7-v1:0`, `Claude Opus 5.5` → stronger / `fable`, `claude-fable-5-2` → strongest
  - `opusplan`, `default`, `haiku-opus`(2개 일치) → `null`
- `codex`: slug가 `[a-z0-9.]` 이외 문자 경계로 정확히 1개. `gpt-6-sol`, `gpt-6-sol-2026-10-01`, `openai/gpt-6-luna`는 일치. `gpt-6-solar`, `gpt-6-sol.5`, `gpt-5` → `null`.
- `antigravity`: enum **완전 일치**만. `pro`는 가장 높은 tier(strongest). `gemini-3-pro` → `null`.
- `host`가 주어지면 그 호스트 규칙만, `null`이면 claude-code → codex → antigravity 순서로 처음 일치한 것.
- 미지의 ID는 `null`. main 모델이면 기록·알림·게이트 모두 없음. dispatch 기록이면 통과 증거로 인정하지 않음(이 판정은 main이 낮다고 확인된 뒤에만 일어난다).

정본 유지:
- `scripts/pota-goal-state-validation.mjs:29-30`의 리터럴을 `import { STRONGEST_MODEL_BY_HOST } from "./pota-model-tier.mjs"; export { STRONGEST_MODEL_BY_HOST };`로 바꾼다. 기존 import(`pota-goal-operations.mjs:8`, `test/goal-effort.test.mjs:21`)와 `validModelHost`는 그대로 동작한다.
- 테스트로 묶기: 기존 strongest 테스트(`test/goal-effort.test.mjs:569`)는 유지. 새 테스트가 두 `delegation.md`의 4-tier 전체를 표와 대조한다(§5 T2).

##### D3. 게이트

- **G-plan**: `requiredEvidence`에 `triageDecision`이 있는 task를 `completed`로 바꿀 때(`goal task --status completed`, `goal finish`가 active task를 완료할 때 포함).
  - 통과: 그 task에 `modelSource === "host-option"`이고 `classifyModel(task.model, task.modelHost)`가 stronger 이상.
- **G-review**: goal 완료(`goal finish`, `goal complete`).
  - 통과: goal 안에 `kind: "review"`이고 같은 조건의 model 기록을 가진 task가 하나 이상.
  - `goal finish`는 검증 명령을 돌리기 **전에** 먼저 검사한다(4분짜리 `npm run check` 뒤에 거부되는 일을 막는다). `transitionGoal(completed)`에서도 한 번 더 검사해 `goal complete`를 덮는다.
- `assignedAgentId`는 통과 조건에 넣지 않는다. `goal assign`을 agent 없이 다시 부르면 `null`로 덮이기 때문이다(`pota-goal-operations.mjs:262`). design 게이트도 model 기록만 본다(`:222`).
- 새 kind: `TASK_KINDS = new Set(["design", "review"])`(`pota-goal-state-validation.mjs:28`). schema 버전은 그대로다. 기존 `/kind must be one of: design/` 단언 3곳(`test/goal-effort.test.mjs:317,331,334`)은 계속 일치한다. claude-mod는 `design`이 아닌 kind를 `null`로 본다(`claude-mod/hooks/dag-model.mjs:92`).
- 우회 플래그: `--allow-main-model <reason>` (`goal task`, `goal finish`, `goal complete`). 상태에 저장하지 않고, CLI가 성공 뒤 stderr에 `Pota warning: main-model gate bypassed for goal <command>: <reason>`를 낸다.
- 모를 때는 fail-open. 근거:
  1. payload 값 형식이 실측되지 않았다.
  2. 기존 테스트 수백 건이 기록 없이 `finishGoal`/`setTaskStatus`를 부른다.
  3. 정상 사용자 비용 0 요구.
  4. 증거·Stop 게이트는 그대로라 이 게이트는 추가 층이다.
- 정상 사용자 비용: hook은 guard 읽기 1회(ENOENT), CLI는 게이트 후보 명령에서만 읽기 1~2회. 새 출력·플래그·프롬프트·쓰기 없음. 세션 키가 없으면 읽기도 없다.

에러 문구(영문, 한 줄). `<expected>`는 host를 알면 `opus or fable` / `gpt-6-sol or gpt-6-astra` / `pro`, 모르면 `the stronger tier or above`:

```
Planning task <id> was not dispatched at the stronger tier: this session's main model is <model> (<tier> tier). Dispatch planning and triage to <expected> and record goal assign <id> --agent <id> --model <value> --model-source host-option, or complete with --allow-main-model <reason> (for example when the session model changed after session start)
```
```
Goal <goalId> has no review dispatched at the stronger tier: this session's main model is <model> (<tier> tier). Dispatch the final review to <expected> and record goal assign <review-task> --kind review --agent <id> --model <value> --model-source host-option, or pass --allow-main-model <reason> to goal finish or goal complete (for example when the session model changed after session start)
```
- 오용: `--allow-main-model applies only when completing a task` / `--allow-main-model applies only when completing a goal`.

##### D4. 세션 중 모델 변경과 `model` 부재

- `model` 필드 없음: 아무것도 하지 않는다(I/O 0, 출력 동일, 기존 기록 유지).
- Claude Code 세션 중 변경: 다음 SessionStart(startup·resume·clear·compact)에서 반영된다.
  - 낮→높으로 바꾼 뒤 그 전에 게이트를 만나면 에러 문구가 안내하는 대로 `--allow-main-model "switched to <정확한 ID>"`로 통과한다.
  - 높→낮은 다음 SessionStart까지 감지하지 못한다(fail-open, known limit).
- Codex: UPS payload에 `model`이 있으므로 같은 함수로 매 프롬프트 기록을 동기화한다. 문구는 UPS 캡슐에 싣지 않고, 낮은 tier로 **바뀐 순간** `systemMessage`만 1회 낸다.
- **`PostModelSwitch` hook은 추가하지 않는다.** 비용:
  1. 공용 `hooks/hooks.json`에 Codex가 모르는 이벤트가 들어간다(Codex의 처리 방식 미검증). `trustedHookStates`는 모르는 이벤트를 건너뛴다(`scripts/pota-lifecycle-config.mjs:121-124`).
  2. Claude 얇은 플러그인의 이벤트 집합을 정확히 5개로 고정한 테스트(`test/lifecycle.test.mjs:506`)가 있고, 이 파일은 `model-gate` writeScope 밖이다.
  3. v2.1.251 미만 Claude Code가 모르는 이벤트를 어떻게 다루는지 미검증이다. hooks 파일 전체가 거부되면 Pota hook이 전부 죽는다.
  4. `to_model` payload 미검증.
- 후속으로 넣을 때의 형태: 공용 파일이 아니라 `claudeHooks`(`scripts/pota-lifecycle-claude.mjs:56-72`)가 Claude 전용 항목 1개를 덧붙이고, `pota-state.mjs`에 `post-model-switch` 분기를 더해 같은 기록 함수를 `to_model`로 부른다. 기록 함수는 이벤트와 무관하게 설계했다.

##### D5. 문구와 문자 예산

접두 `Pota main model:`은 `Pota CLI:`처럼 **두 locale 공통 영문 고정**이다(영문 `delegation.md`가 이 문자열로 줄의 존재를 가리킨다).

캡슐 줄 — SessionStart에만, `Pota CLI:` 줄 뒤·업데이트 알림 줄 앞. idle·active·paused·blocked·foreign 모두:

```
en: Pota main model: ${model} (${tier} tier, below stronger). Dispatch planning/triage and the final review to a subagent on ${stronger} or higher and record goal assign --model, or triage-plan completion and goal finish fail (bypass: --allow-main-model <reason>). See delegation.md "Main Model Gate".
ko: Pota main model: ${model} (${tier} tier, stronger 미만). 계획·트리아지와 최종 리뷰를 ${stronger} 이상 subagent에 위임하고 goal assign --model로 기록하세요. 기록이 없으면 triage-plan 완료와 goal finish가 거부됩니다(우회: --allow-main-model <reason>). 상세: delegation.md "Main Model Gate".
```

`systemMessage`(사용자용) — 기록이 새로 쓰이거나 모델이 바뀐 때 1회. 세션 키가 없으면 매번:

```
en: Pota: this session runs on ${model}, below the stronger tier. Planning, triage, and review go to subagents on ${stronger} or higher. A model switch is picked up by the next session start at the latest.
ko: Pota: 이 세션의 main 모델(${model})은 stronger tier 미만입니다. 계획·트리아지·리뷰는 ${stronger} 이상 subagent에 위임됩니다. 모델을 바꾸면 늦어도 다음 세션 시작 때 반영됩니다.
```

- `${model}`은 40자 clip(`contextLimits.mainModel: 40`), `${stronger}`는 `MODEL_TIER_BY_HOST[host].stronger`.
- 실측 문자 수:

| 입력 | 줄 en | 줄 ko | 알림 en | 알림 ko |
| --- | --- | --- | --- | --- |
| `sonnet` | 289 | 234 | 192 | 116 |
| `claude-haiku-4-5-20251001` | 304 | 249 | 211 | 135 |
| 40자 clip + `gpt-6-sol`(최대) | 328 | 273 | 231 | 155 |

- **예산: 줄 340, 알림 240.** 업데이트 알림과 같은 "상시 예산 밖의 조건부 줄"로 취급한다(`test/token-efficiency.test.mjs:41-43` 주석 선례). 기존 예산 테스트의 payload에는 `model`이 없어 영향이 없다.
- 업데이트 알림과 겹치면 `systemMessage`는 `"<main 모델 알림>\n<업데이트 줄>"`이다. `withUpdateNotice`가 기존 값을 덮어쓰지 않고 합치게 고친다(`pota-state.mjs:239`). 업데이트 줄이 마지막이라는 기존 단언(`test/auto-upgrade.test.mjs:579-581`)은 유지된다.

##### D6. 변경 파일과 테스트 계약

§2~§6 참조.

#### 2. 코드 명세

**`scripts/pota-model-tier.mjs` (신규, import 없음)** — D2 그대로. 런타임 필수 파일 목록은 import에서 유도되고(`scripts/pota-paths.mjs:177-191`) 패키지는 `scripts/*.mjs`를 싣으므로 추가 등록이 없다.

**`scripts/pota-goal-state-validation.mjs`**
- `:28` `TASK_KINDS`에 `"review"` 추가.
- `:29-30` re-export로 교체.

**`scripts/pota-goal-state.mjs`**
- `writeHookGuard(root, name, value, { ensureDirectory = false } = {})`: `true`면 try 안에서 `ensureGoalStateDirectory(root)`(`:120`) 먼저. 오류는 지금처럼 삼킨다.
- `export function hostSessionId(env = process.env)`: `env.CLAUDE_CODE_SESSION_ID`가 trim 후 1~128자 문자열이면 그 값, 아니면 `null`.
- `export async function readMainModelRecord(root, sessionKey)`:
  - guard가 `schemaVersion === 1`이고 `sessions`가 배열 아닌 객체이며 `Object.hasOwn(sessions, sessionKey)`일 때만 본다.
  - 저장된 `tier`를 믿지 않고 `classifyModel(entry.model)`로 다시 분류해, 낮을 때만 `{ model, tier, host }`. 그 외 전부 `null`.
- `export async function syncMainModelRecord(root, sessionKey, entry, { now = new Date() } = {})`:
  - `entry`는 `{ model, tier, host }` 또는 `null`.
  - `entry`가 있고 같은 키의 `model`이 같으면 `"unchanged"`. 다르거나 없으면 `{ ...entry, at }`로 넣고 8개 cap 뒤 `ensureDirectory: true`로 쓰고 `"recorded"`.
  - `entry`가 `null`이고 항목이 있으면 지우고 쓴 뒤 `"cleared"`, 없으면 쓰지 않고 `"unchanged"`.

**`scripts/pota-state-context.mjs`**
- `contextLimits.mainModel = 40`.
- `export function mainModelLine({ ko, model, tier, host })`, `export function mainModelNotice({ ko, model, host })` — D5 문자열.
- `export function appendNotice(result, line, userMessage = null)`: `line`이 있으면 `message`와 `additionalContext` 끝에 붙인다. `userMessage`가 있으면 `systemMessage = [기존, userMessage].filter(Boolean).join("\n")`.

**`scripts/pota-state.mjs`**
- `runStateResult` 옵션에 `mainModel = {}`(테스트용 `now`).
- `:54-60` 분기: `promptContextResult` 뒤에 `observeMainModel` → `withMainModelNotice`. session-start만 이어서 `withUpdateNotice`. 이 단계 전체를 try/catch로 감싸 오류 시 원래 결과를 돌려준다.
- `observeMainModel(root, payload, { now })`:
  1. `raw` = `payload.model`이 문자열이면 그 값, `payload.model.id`가 문자열이면 그 값(방어적), 아니면 `null` 반환.
  2. `payload.agent_id`가 비어 있지 않은 문자열이면 `null`(subagent 문맥).
  3. `model = raw.trim()`. `/^[\x21-\x7e][\x20-\x7e]{0,127}$/`에 맞지 않으면 `null`.
  4. `classified = classifyModel(model)`, `low = classified && isBelowStronger(classified.tier)`.
  5. `key` = `payload.session_id`가 1~128자 문자열이면 그 값. **env는 쓰지 않는다**(§7 가정 4).
  6. `key`가 있으면 `syncMainModelRecord(root, key, low ? { model, ...classified } : null)`, 없으면 `low ? "recorded" : "unchanged"`.
  7. `low`면 `{ model, tier, host, notify: change === "recorded" }`, 아니면 `null`.
- `withMainModelNotice(result, { ko, event, observed })`: `observed`가 없으면 그대로. `line`은 session-start일 때만, `notice`는 `notify`일 때만. `appendNotice(result, line, notice)`.
- `withUpdateNotice`(`:229-240`)는 `appendNotice(result, line, line)`을 쓴다.

**`scripts/pota-goal-operations.mjs`**
- `setTaskStatus({ …, mainModelWaiver, sessionId = null })`: waiver는 `optionalText`, completed가 아니면 위 오용 에러. `:148-150`의 기존 검사 뒤에 `await ensureMainModelPlanning(root, state, task, { sessionId, waiver })`.
- `transitionGoal({ …, mainModelWaiver, sessionId = null })`: terminal 분기(`:98-110`)에서 `applyGoalTransition` **뒤**, `nextStatus === "completed"`일 때 `await ensureMainModelReview(root, next, { sessionId, waiver })`. 기존 "tasks remain"·증거 에러의 우선순위가 유지된다.
- 공통:
  ```js
  const dispatchedAtStronger = (task) => task.modelSource === "host-option"
    && isStrongerOrAbove(classifyModel(task.model, task.modelHost ?? null)?.tier);
  // key = sessionId ?? state.goal.ownerSessionId ?? null; 없으면 guard를 읽지 않고 통과
  export async function ensureMainModelReview(root, state, { sessionId = null, waiver = null } = {})
  ```
  검사 순서: waiver → 통과 증거(순수 계산) → guard 읽기.

**`scripts/pota-goal-operations-evidence.mjs`** — `finishGoal({ …, mainModelWaiver, sessionId = null })`: `:147-148` 뒤, `setTaskStatus` 앞에서 `ensureMainModelReview(root, initialState, …)`. `setTaskStatus`와 `transitionGoal`에 두 값을 넘긴다.

**`scripts/pota-goal-cli.mjs`**
- `runGoalCli(args, { …, env = process.env })`, `const sessionId = hostSessionId(env)`.
- `allowedOptions`(`:267-285`): `task`, `finish`, `complete`에 `allow-main-model`.
- `task`·`finish`·전이 분기에 `mainModelWaiver: options["allow-main-model"]`, `sessionId` 전달. 플래그가 있으면 성공 뒤 stderr 경고.

**`scripts/pota-goal.mjs:30`** — `handleGoalCli(args, { stdout, stderr, env = process.env })`로 env 전달.

**바꾸지 않는 것**: `hooks/hooks.json`, `scripts/pota-lifecycle-claude.mjs`, `scripts/pota-goal-history.mjs`(레코드 키가 `test/goal-history.test.mjs:29`에 고정, writeScope 밖), `scripts/pota.mjs`, `package.json`, `.codex-plugin/plugin.json`.

#### 3. 정책 표면

**정본 — `skills/pota-plan/delegation.md`와 `skills/pota-work/delegation.md` 끝에 같은 절 추가**(두 파일은 바이트 상한 테스트가 없다):

```markdown
## Main Model Gate

Routing covers dispatches only, so work the main agent does itself runs on the session model. The session-start hook reads the host's `model` field. When it is below the stronger tier (fast or balanced), the hook adds one `Pota main model:` line to the capsule, shows the user a notice, and records the model for this session.

- With that line present, the main agent does not plan, triage, or review inline. Dispatch planning and triage (the `triage-plan` work) and the final review to the stronger tier or above through the host option, then record each dispatch: `goal assign triage-plan --agent <id> --model <value> --model-source host-option --host <claude-code|codex|antigravity>` and `goal assign <review-task> --kind review --agent <id> --model <value> --model-source host-option --host <claude-code|codex|antigravity>`.
- Enforced by the CLI: completing a task whose required evidence includes `triageDecision`, and `goal finish` or `goal complete`, fail without that record. `--allow-main-model <reason>` on the completing command is the only bypass. Use it when subagent tools are unavailable, when `Model routing: inherited` is set, when the user accepts the session model, or when the session model changed after session start (give the exact model ID from your own system prompt). Record the reason in the plan's Evidence.
- No line means no gate: an absent or unrecognized `model` value is never treated as a lower tier. A model switch is picked up by the next session start at the latest.
```

**파생 표면**

| 파일 | 변경 |
| --- | --- |
| `skills/pota-review/SKILL.md` Procedure 4 (`:28-32`) | 하위 bullet 1개: "When the session-start capsule has a `Pota main model:` line, this delegation is required: dispatch the review at the stronger tier or above and record `goal assign <task> --kind review --agent <id> --model <value> --model-source host-option`; otherwise `goal finish` fails unless `--allow-main-model <reason>`." |
| `commands/pota-review.md` 3번, `.agents/workflows/pota-review.md` 3번 | 같은 문장 1개 |
| `templates/work-plan.md:45` (`- Model:` bullet) | 끝에: "When the session-start capsule has a `Pota main model:` line, dispatch planning/triage and the final review to the stronger tier or above and record them (`--kind review` for the review); `triage-plan` completion and `goal finish` fail otherwise unless `--allow-main-model <reason>`." |
| `docs/model-guidance/README.md` (`## Model and Reasoning Effort Routing`, `:55` 뒤) | "Main model gate" bullet 1개(같은 의미) |
| `docs/model-guidance/claude.md:21` 뒤, `docs/model-guidance/codex.md:22` 뒤 | 각 bullet 1개. codex.md에는 "the gate needs the goal owner session (`goal start --session`)" 포함 |
| README 8개 | "Comment checker" bullet 바로 뒤(`README.md:173`, `README.ko.md:165`, 나머지 6개 `:147`)에 bullet 1개 |
| `docs/memory/delegation-model-routing.md` | "main 모델 게이트" 소절: 표 정본 `pota-model-tier.mjs`, G-plan/G-review, `--kind review`, `--allow-main-model`, 세션 키, fail-open. `:20`의 출처를 새 모듈로 |
| `docs/memory/hook-context.md` | 조건부 줄·`systemMessage` 1회 규칙·순서, 예산 표에 "main 모델 줄 340 / 알림 240" 행, UPS는 기록만 |
| `docs/memory/goal-state.md` | 파일 목록(`:14`)에 `main-model-guard.json`, 읽기 전용 예외(`:16`), `TASK_KINDS` |
| `docs/memory/policy-surfaces.md` | 위 표면 목록 1항목 |

- memory 노트의 `Summary:` 줄은 바꾸지 않는다(루트 `MEMORY.md`가 writeScope 밖).
- 고치지 않는 것과 이유:
  - `skills/pota-{plan,work}/SKILL.md`: 예산 없음. 캡슐 줄이 `delegation.md`를 가리킨다.
  - `commands/pota-{plan,work}.md`, `.agents/workflows/pota-{plan,work}.md`: 지금도 model 라우팅 문구가 없다(design 게이트 선례와 같은 범위).
  - `agents/*.md`, `.claude/agents/*.md`: 게이트는 main 전용이다.
  - `.claude/commands/*`: 포인터일 뿐이다.
  - `defaultPrompt`, `scripts/pota.mjs` messages: 해당 없음.
- 설치 미러 금지 패턴(`node scripts/…`, `commands/pota-…`, `templates/…`, `docs/model-guidance/…` 상대 참조)은 위 문구에 없다.

README bullet 문안(식별자는 전 locale 영문 그대로):
- **en**: `- Main model check: when the session's main model is below the stronger tier, \`SessionStart\` adds a \`Pota main model:\` line and a one-time notice. Planning/triage and the final review must then be dispatched to the stronger tier or above and recorded (\`goal assign … --kind review\` for the review); otherwise completing \`triage-plan\` and \`goal finish\` are refused unless \`--allow-main-model <reason>\` is passed. An absent or unrecognized model value never triggers this.`
- **ko**: `- main 모델 확인: 세션의 main 모델이 stronger tier 미만이면 \`SessionStart\`가 \`Pota main model:\` 줄과 1회 알림을 추가합니다. 이때 계획·트리아지와 최종 리뷰는 stronger tier 이상으로 위임하고 기록해야 하며(리뷰는 \`goal assign … --kind review\`), 기록이 없으면 \`triage-plan\` 완료와 \`goal finish\`가 거부됩니다. 우회는 \`--allow-main-model <reason>\`입니다. 모델 값이 없거나 인식되지 않으면 동작하지 않습니다.`
- **ja**: `- main model チェック: セッションの main model が stronger tier 未満の場合、\`SessionStart\` は \`Pota main model:\` 行と 1 回の通知を追加します。このとき計画・トリアージと最終レビューは stronger tier 以上に委任して記録する必要があり(レビューは \`goal assign … --kind review\`)、記録がなければ \`triage-plan\` の完了と \`goal finish\` は拒否されます。回避は \`--allow-main-model <reason>\` です。model 値がない、または認識できない場合は動作しません。`
- **zh**: `- main model 检查: 当会话的 main model 低于 stronger tier 时,\`SessionStart\` 会添加一行 \`Pota main model:\` 和一次性通知。此时计划/分诊和最终评审必须委派给 stronger tier 或更高并记录(评审使用 \`goal assign … --kind review\`),否则 \`triage-plan\` 的完成和 \`goal finish\` 会被拒绝;绕过方式是 \`--allow-main-model <reason>\`。model 值缺失或无法识别时不生效。`
- **es**: `- Comprobación del main model: cuando el main model de la sesión está por debajo del tier stronger, \`SessionStart\` añade una línea \`Pota main model:\` y un aviso único. La planificación/triaje y la revisión final deben entonces delegarse al tier stronger o superior y registrarse (la revisión con \`goal assign … --kind review\`); sin ese registro se rechazan la finalización de \`triage-plan\` y \`goal finish\`, salvo con \`--allow-main-model <reason>\`. Un valor de model ausente o no reconocido nunca la activa.`
- **fr**: `- Vérification du main model : lorsque le main model de la session est inférieur au tier stronger, \`SessionStart\` ajoute une ligne \`Pota main model:\` et un avis unique. La planification/le triage et la revue finale doivent alors être délégués au tier stronger ou supérieur et enregistrés (la revue avec \`goal assign … --kind review\`) ; sans cet enregistrement, la complétion de \`triage-plan\` et \`goal finish\` sont refusés, sauf avec \`--allow-main-model <reason>\`. Une valeur de model absente ou non reconnue ne la déclenche jamais.`
- **de**: `- Main-model-Prüfung: Liegt das main model der Sitzung unter dem stronger tier, fügt \`SessionStart\` eine Zeile \`Pota main model:\` und einen einmaligen Hinweis hinzu. Planung/Triage und das abschließende Review müssen dann an den stronger tier oder höher delegiert und aufgezeichnet werden (das Review mit \`goal assign … --kind review\`); ohne diesen Eintrag werden der Abschluss von \`triage-plan\` und \`goal finish\` abgelehnt, außer mit \`--allow-main-model <reason>\`. Ein fehlender oder nicht erkannter model-Wert löst sie nie aus.`
- **pt**: `- Verificação do main model: quando o main model da sessão está abaixo do tier stronger, \`SessionStart\` adiciona uma linha \`Pota main model:\` e um aviso único. O planejamento/triagem e a revisão final devem então ser delegados ao tier stronger ou superior e registrados (a revisão com \`goal assign … --kind review\`); sem esse registro, a conclusão de \`triage-plan\` e \`goal finish\` são recusados, salvo com \`--allow-main-model <reason>\`. Um valor de model ausente ou não reconhecido nunca a aciona.`

#### 4. 테스트 작성 시 주의

- 개발 중 `npm test`는 Claude Code 안에서 돌아 실제 `CLAUDE_CODE_SESSION_ID`를 상속한다. 새 테스트는 라이브러리 호출엔 `sessionId`를 명시하고, `handleGoalCli`엔 `env`를 주입하며, spawn할 땐 env에서 그 변수를 지운다.
- 기존 테스트는 단언을 바꾸지 않는다. 약화·삭제 없음.

#### 5. 테스트 계약

**신규 `test/main-model-gate.test.mjs`** — 예상 초기 실패는 전부 `scripts/pota-model-tier.mjs` 없음(ERR_MODULE_NOT_FOUND)으로 파일 전체 실패.

| # | 테스트 이름 | 검증 |
| --- | --- | --- |
| T1 | `model tiers classify aliases, full IDs, and unknown values per host` | D2 예시 전부. host 지정 시 타 호스트 값은 `null`(`classifyModel("pro","claude-code")`). 비문자열·빈 값·129자 → `null` |
| T2 | `the code tier table matches both delegation.md routing sections` | 두 `delegation.md` 각각: Claude 4-tier 문장(`fast = …(Claude Code \`haiku\`); balanced = …(\`sonnet\`); stronger = …(\`opus\`); strongest = …(\`fable\`)`)을 표에서 만든 정규식으로 확인. codex·antigravity는 tier마다 `` `${tier} \`${value}\`` `` 포함. `STRONGEST_MODEL_BY_HOST`가 strongest 열과 `deepEqual` |
| T3 | `SessionStart with a below-stronger model adds the main-model line after the Pota CLI line, mirrors a notice, and records the session` | en·ko. 마지막 줄 `/^Pota main model: /`, 그 앞 줄 `/^Pota CLI: node /`. `systemMessage`가 알림 문자열과 같음. guard `sessions.s1`의 `model`·`tier`·`host`. en·ko 문자열 1개씩 `assert.equal` 고정 |
| T4 | `SessionStart with a stronger, strongest, unknown, or absent model is byte-identical and creates no Pota home` | `opus`, `claude-fable-5-2`, `gpt-6-sol`, `opusplan`, `default`, 필드 없음, `42`, `{id:"claude-opus-5-5"}`. `JSON.stringify(hookOutput)`이 model 없는 결과와 같고 `lstat(POTA_HOME)`은 ENOENT |
| T5 | `a repeated SessionStart keeps the line but notifies once; a later stronger model clears the record` | 2회차: 줄 있음, `systemMessage` 없음. 3회차(opus): 줄 없음, `sessions`에 키 없음 |
| T6 | `UserPromptSubmit never adds main-model context and syncs the record from a Codex model field` | UPS + `gpt-6-luna`: `additionalContext`가 model 없는 결과와 같고 기록 생김, `systemMessage` 1회. `gpt-6-sol`: 기록 삭제, `systemMessage` 없음 |
| T7 | `subagent payloads and payloads without a session id never record` | `agent_id` 있음: 줄·알림·guard 모두 없음. `session_id` 없음: 줄·알림 있고 guard 없음 |
| T8 | `only a below-stronger payload creates the worktree state directory, holding only main-model-guard.json` | 디렉터리 트리 검사. 9번째 세션에서 가장 오래된 키가 빠짐 |
| T9 | `main-model lines stay within 340 and 240 characters and stay on one line` | en·ko × fast·balanced × 3 host × (짧은 ID, 200자 ID). `\n` 없음 |
| T10 | `appendNotice keeps the context order and joins systemMessage` | 두 번 적용: 줄 순서, `systemMessage === "a\nb"`. `line`이 `null`이면 context 불변 |
| T11 | `planning and goal completion pass without a record, with an unrelated session, or with no session key` | fail-open 매트릭스: guard 없음 / 다른 세션 키 / `sessionId` null + owner null / 손상 JSON / `sessions`가 배열 / 저장 tier가 stronger / 키 `__proto__` |
| T12 | `a below-stronger main model blocks completing a triageDecision task until a stronger dispatch or a waiver` | 에러 정규식(`Planning task triage-plan was not dispatched…main model claude-haiku-4-5-20251001 \(fast tier\)…opus or fable…--allow-main-model <reason>`). task는 `active` 유지. `--model sonnet`은 여전히 거부. `opus` host-option은 통과. waiver 통과. completed 아닌 상태에 waiver → 오용 에러. `triageDecision` 없는 task는 무관 |
| T13 | `goal finish refuses before running verification, and goal complete refuses, without a stronger review dispatch` | 검증 argv가 marker 파일을 쓰게 하고 파일 없음을 단언. active task 그대로. `assignTask({kind:"review", model:"opus", modelHost:"claude-code"})` 뒤 성공. waiver 경로. `transitionGoal(completed)` 직접 호출도 거부. "tasks remain" 에러가 게이트보다 먼저 |
| T14 | `review dispatch tier is judged per host and unknown or non-host-option models do not pass` | 통과: claude-code `opus`·`fable`·`claude-opus-5-5`, codex `gpt-6-sol`·`gpt-6-astra`, antigravity `pro`, host 없는 `pro`. 거부: `sonnet`, `gpt-6.1-terra`, `flash`, `modelSource: inherited`, kind 없는 opus task |
| T15 | `the gate keys on CLAUDE_CODE_SESSION_ID, then the goal owner, else nothing` | `handleGoalCli(…, { env })`: guard에 s1(low). env s2 → 통과 / env s1 → 거부 / env 없음 + owner s1 → 거부 / env 없음 + owner null → 통과 |
| T16 | `goal CLI accepts --allow-main-model on task, finish, and complete, rejects it elsewhere, and reports the bypass on stderr` | stdout JSON 불변. stderr 1줄 `/^Pota warning: main-model gate bypassed for goal finish: /`. `goal pause --allow-main-model x` → `Unknown option for pause` |
| T17 | `kind review is accepted by start, replan, and assign, and stats show it` | `goalStats(...).tasks[i].kind === "review"`. `kind: "build"`는 여전히 거부 |

**수정 `test/token-efficiency.test.mjs`** — 테스트 1개 추가, 기존 단언 불변:

| # | 테스트 이름 | 검증 | 예상 초기 실패 |
| --- | --- | --- | --- |
| T18 | `main-model gate surfaces name the capsule line, the review kind, and the bypass flag` | 두 `delegation.md`: `/^## Main Model Gate$/m`, `` `Pota main model:` ``, `--kind review`, `--allow-main-model <reason>`, `triageDecision`, `Model routing: inherited`. review 3표면: `--kind review`, `--allow-main-model`. `templates/work-plan.md`, `docs/model-guidance/{README,claude,codex}.md`, README 8개: `--allow-main-model`. README 8개: `` `Pota main model:` `` | 문구 없음으로 단언 실패 |

그대로 통과해야 하는 기존 계약:
- `test/token-efficiency.test.mjs:379-384`(SKILL.md 9000바이트), `:43-68`, `:70-113`
- `test/index-context.test.mjs`의 baseline·"hooks create no files"
- `test/goal-state.test.mjs:867`
- `test/state-recovery-hardening.test.mjs`(620자, `GOAL_STATE_CONTRACT`)
- `test/auto-upgrade.test.mjs:572-609`
- `test/lifecycle.test.mjs:506`
- `test/goal-history.test.mjs`
- `test/goal-effort.test.mjs` 전부

#### 6. `model-gate` task 검증 명령

- Tests(집중, 구현 중 반복): `node --test test/main-model-gate.test.mjs test/goal-effort.test.mjs test/token-efficiency.test.mjs`
- Module acceptance: `node --test test/main-model-gate.test.mjs test/goal-effort.test.mjs test/goal-state.test.mjs test/goal-dag.test.mjs test/goal-history.test.mjs test/state-recovery-hardening.test.mjs test/cli-contract-hardening.test.mjs`
- Surface integration: `node --test test/token-efficiency.test.mjs test/index-context.test.mjs test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/verification-contracts.test.mjs test/auto-upgrade.test.mjs test/installed-plugin.test.mjs`
- 문서 검사: `pota memory check --root <repoRoot>`와 `pota plan check --root <repoRoot>`가 exit 0.
- 다른 task가 active인 동안에는 `goal verify`에 `--watch`로 이 task의 writeScope 경로를 준다.
- 전체 `npm run check`는 `verify` task의 `goal finish`에서 1회.

#### 7. 가정과, 틀렸을 때의 동작

| # | 가정(미검증) | 틀리면 |
| --- | --- | --- |
| 1 | Claude Code SessionStart `model`이 alias나 전체 ID 문자열이다 | 객체 `{id}`도 받는다. 그 외 형식·display name 불일치는 `null` → 알림·게이트 없음 |
| 2 | Codex SessionStart·UPS `model`이 문서의 slug다 | 불일치는 `null` → fail-open |
| 3 | `CLAUDE_CODE_SESSION_ID`가 CLI 프로세스에 있고 hook `session_id`와 같다(이 환경에서만 관찰) | 없으면 owner로, 그것도 없으면 게이트 없음. 값이 다르면 조회 실패로 게이트 없음. 알림은 payload만 쓰므로 영향 없음 |
| 4 | SessionStart는 main 세션에서 자기 `session_id`로만 발생한다 | subagent·teammate가 main의 `session_id`로 낮은 모델을 보고하면 opus main이 잘못 막힐 수 있다. 완화: `agent_id` payload 무시, hook은 env가 아니라 payload 키만 사용, 에러가 기록된 모델을 보여 주고 `--allow-main-model`로 통과, main의 다음 SessionStart가 기록을 지움 |
| 5 | SessionStart가 resume·compact 때도 그 시점 `model`을 싣는다 | 안 실으면 기존 기록 유지. 낮→높 전환 사용자는 waiver로 통과 |
| 6 | `systemMessage`가 SessionStart·UPS에서 사용자에게 보인다 | 업데이트 알림과 같은 경로. 안 보여도 캡슐 줄과 게이트 에러는 남는다 |

릴리스 전 권장 수동 확인(자동 증거 아님): 설치본에서 `claude --model haiku`로 세션을 열어 알림과 `main-model-guard.json`을 보고, opus 세션에서 파일이 생기지 않는지 본다. 3·4번 가정을 실측하는 유일한 방법이다.

#### 8. 의도적으로 하지 않는 것 (known limits)

- `PostModelSwitch` hook, transcript 읽기로 실제 응답 모델 확인.
- Claude Code의 세션 중 높→낮 전환 감지(다음 SessionStart까지).
- Codex에서 `goal start --session` 없이 게이트 발동. 세션 키를 얻을 env가 확인되지 않아 알림만 뜬다.
- Antigravity: hook이 없어 알림·게이트 모두 없다.
- 낮은 main이 inline으로 하는 Heavy 구현, Light 구현, Quick Path 작업, Heavy 경로의 pre-implementation review 게이트. 기존 한계(`docs/plan/heavy-design-model-routing.md` 78행) 그대로다.
- `triageDecision` 증거 없이 시작한 계획 task(문자열 task 등)는 G-plan 대상이 아니다.
- 표에 없는 모델(신·구 모델, `opusplan`, `default`)은 분류하지 않는다. 표는 `delegation.md`와 함께 갱신한다.
- waiver를 state·history에 저장하거나 `goal stats`에 집계하지 않는다(stderr와 계획 Evidence 기록만).
- 전역 off 스위치(`POTA_MAIN_MODEL_GATE=0` 등)와 hook의 `Model routing: inherited` 인식. 지금은 waiver 사유로 처리하고, 요구가 생기면 후속으로 둔다.
- 구버전 runtime이 `kind: "review"` 상태를 읽으면 검증 오류가 난다(`design` 추가 때와 같은 혼합 버전 한계). 같은 worktree의 goal을 신·구 runtime 세션이 동시에 다룰 때만 생긴다.

##### Critical Files for Implementation
- /Users/wknam/workspace/pota-harness/scripts/pota-state.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-goal-operations.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-goal-state.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-state-context.mjs
- /Users/wknam/workspace/pota-harness/skills/pota-plan/delegation.md

## Evidence

- 사전 실측(2026-11-19): `npm test` 3분 55초, hook 이벤트 약 115ms, 파일별 시간은 Triage Findings 참고.
- Tool readiness: toolcheck 전부 OK(node, npm, typescript-language-server, tsc).
- Dry-run or check: 해당 없음(로컬 파일 변경만, 외부 상태 변경 없음).
- Dispatch(모두 Claude Code Agent의 `model`/`effort`로 전달, 거부 없음. 괄호는 worker가 보고한 모델 ID):
  - `heavy-design`: `fable`/`high` (`claude-fable-5-2`)
  - `test-split`: `sonnet`/`medium` (`claude-sonnet-5-5`)
  - `dag-default-all`: `sonnet`/`medium` (`claude-sonnet-5-5`)
  - `model-gate`: `opus`/`high` (`claude-opus-5-5`), 리뷰 수정 재위임도 새 dispatch `opus`/`high` (`claude-opus-5-5`)
  - `verify` 리뷰: `opus`/`xhigh`, read-only (`claude-opus-5-5`)
  - `triage-plan`과 증거 기록·메모리 노트 경로 수정은 main이 직접 수행(not-applied: 별도 dispatch 없음). main 세션 모델은 `claude-fable-5-2`.
- Module acceptance / Surface integration(`goal verify`, exit 0):
  - `dag-default-all`: `node --test test/claude-mod.test.mjs test/claude-mod-term.test.mjs test/claude-mod-root.test.mjs` / `node --test test/docs-package-hardening.test.mjs test/installed-plugin.test.mjs`. worker가 `npx --no-install tsc -p claude-mod --noEmit` exit 0도 보고.
  - `test-split`: 분할 파일 5개 `node --test` / `npm test`. 실행 수는 분할 전후 68개로 같다(`test()` 블록 61개, 루프 확장 후 68개. 계획 초안의 "59개"는 잘못 센 값이다). 리뷰어가 HEAD 원본과 이름·본문 일치를 확인했다.
  - `model-gate`: 설계 §6의 Module acceptance 7개 파일 / Surface integration 7개 파일.
- Tests: `node --test test/main-model-gate.test.mjs test/goal-effort.test.mjs test/token-efficiency.test.mjs` exit 0(리뷰 수정 후 63/63).
- 테스트 시간 결과: `npm test` wall 235초 → 165초(main 측정, 분할 직후). 분할 파일은 단독 38~42초지만 5개를 함께 돌리면 약 100초다. 테스트가 디스크·CPU를 경합해 "wall은 가장 긴 파일에 묶인다"는 트리아지 가정이 틀렸고, 목표 90초에는 못 미쳤다. 더 줄이려면 테스트마다 반복하는 설치 비용을 줄여야 한다(범위 밖).
- 실제 동작 확인(임시 POTA_HOME·임시 git 저장소에서 hook 실행): haiku payload는 `Pota main model:` 줄, `systemMessage`, 세션 파일 1개. opus payload와 `POTA_MAIN_MODEL_GATE=0`은 model 없는 출력과 바이트 동일하고 POTA_HOME을 만들지 않는다.
- 리뷰(`opus`/`xhigh`): blocker·major 없음. 반영한 지적:
  - M1: 단일 guard 파일을 lock 없이 읽고-고쳐-쓰면 다른 세션이 지운 낮은 tier 기록이 되살아나 opus 세션이 잘못 막힌다(50회 중 50회 재현). 세션별 파일로 바꾸고 동시성 테스트를 추가했다.
  - M2: 영구 opt-out이 없었다. `POTA_MAIN_MODEL_GATE=0|false|off|no`를 추가했다. 기준 등급(opus 이상)은 사용자 결정으로 유지한다(2026-11-19, "일단은 그대로").
  - M3·M5: `PLAN.md` 색인 문구, `docs/memory/{release-process,lifecycle-install}.md`의 분할 후 테스트 경로를 고쳤다.
- 반영하지 않은 지적(residual): 게이트가 걸리지 않은 세션에서도 `--allow-main-model`을 주면 bypass 경고가 나온다(N3). 캡슐 줄·README는 `triage-plan`과 `goal finish`만 말하고 `goal complete`와 Codex의 `--session` 조건을 생략한다(N4). 분할 파일명이 내용을 뜻하지 않는다(N1). 낮은 tier 세션은 여는 worktree마다 세션 파일을 남긴다(N7, 디렉터리당 8개 상한).
- 실측하지 못한 가정: 실제 Claude Code·Codex SessionStart `model` 값의 형식, `CLAUDE_CODE_SESSION_ID`와 hook `session_id`의 일치(`/clear` 뒤 포함), Codex subagent의 hook payload. 틀리면 게이트가 걸리지 않는 쪽으로 동작하도록 테스트로 고정했다. 설치본에서 `claude --model haiku`로 수동 확인이 남아 있다. Node 18과 Windows는 로컬에서 돌리지 못했다(CI 매트릭스 대상).
- 구독 등급에 따라 `opus`·`fable`이 없을 때: main 모델 게이트는 스위치나 `--allow-main-model`로, 기존 Heavy 설계 게이트는 `--allow-no-design-model`로 우회한다. 없는 모델로 dispatch했을 때 호스트가 거부하는지 조용히 대체하는지는 확인하지 못했다.
- Goal final review evidence record: `goal finish -- npm run check`(아래 Status 참고).
- Memory promotion: docs/memory/delegation-model-routing.md (함께 갱신: `hook-context.md`, `goal-state.md`, `policy-surfaces.md`, `lifecycle-install.md`, `release-process.md`)
- Verification pass count: task별 1회. `model-gate`는 리뷰 수정 뒤 goal 수준 최종 검사로 다시 덮었다.
- Blocker after two failed passes: 없음.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
