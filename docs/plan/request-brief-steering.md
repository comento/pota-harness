# Plan: 요청 계약과 스티어링 기록

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (완료)
- Finalized: decision-complete for implementation after planned triage. (완료, 1.4.0 게시)
- Codex UI synchronization: `update_plan` 호출함(Claude Code 데스크톱 task list). `create_goal`은 이 호스트에 없음.

## Goal

사용자의 불명확한 최초 요청과 이후 스티어링을 Pota가 문장 권고가 아니라 계획 아티팩트와 goal CLI 게이트로 보정·기록하게 한다.

- Goal ID: `goal-5dc28bd6-0dc4-4644-8086-7612b2472dd5`
- Plan ID: `docs/plan/request-brief-steering.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria (advisory): 요청 계약이 없는 계획은 `triage-plan`을 완료할 수 없고, 스티어링은 분류·이유와 함께 기록되며 계획에 적히지 않은 스티어링은 거부된다. `npm test` 통과.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Request Brief

- Original request: "pota에 이러한 요청을 보정하는 기능을 넣었으면 해. 최초 사용자의 불확실한 요청에 대한 보정 요청 및 스티어링이 발생했을 때의 처리, 스티어링이 2, 3단계로 왔을 때의 처리 등에 대해서 보정하고 안내하고 명확하게 만드는 그런 스킬? 도구? 기능이 필요해."
- Interpreted outcome: (1) 계획 템플릿과 `pota-plan` 정책에 요청 계약 섹션, 빈틈 처리 규칙, 스티어링 분류 규칙이 있다. (2) goal CLI가 요청 계약이 채워지지 않은 계획의 triage 완료를 거부하고, 스티어링을 종류·이유와 함께 기록하며, 계획에 해당 스티어링 항목이 없으면 거부한다.
- Scope: `templates/work-plan.md`, `skills/pota-plan/`·`skills/pota-work/`와 파생 표면(commands, `.agents/workflows`, README 8개), `scripts/pota-goal-*.mjs`, 테스트, `docs/memory` 갱신. S2부터: 버전 올림, PR 2개 병합, npm 게시.
- Non-scope: hook 캡슐 문구 추가(active UPS 691/700자), hook이 프롬프트 텍스트를 자동 분류하는 기능, 완료된 task를 되돌리는 상태 전이, `scripts/pota.mjs` locale 안내문.
- Prior records: `PLAN.md` Completed 목록에서 기능 계획 뒤에 릴리스 계획이 매번 이어진다(예: `main-model-gate-and-test-time` → `release-1.3.0`, `available-model-ceiling` → `release-1.3.1`). `docs/memory/release-process.md`는 게시 뒤 로컬 설치본 업그레이드 절차를 적고 있다. 이 계획을 처음 쓸 때는 이 기록을 보지 않아 릴리스와 로컬 업그레이드가 S2·S3 스티어링으로 뒤늦게 들어왔다. 과거 계획에는 Request Brief가 없어 `pota plan steering` 대상 기록은 아직 없다.
- Assumptions:
  - A1 (inferred): Quick Path는 계획·goal이 없으므로 CLI 게이트 대상이 아니고 정책 문구(채팅 한두 줄 요약)만 적용한다.
  - A2 (evidence: `docs/memory/goal-state.md` Policy, `test/state-recovery-hardening.test.mjs`): 상태 schema v3는 바꾸지 않는다. 스티어링 기록은 상태 디렉터리의 별도 파일에 둔다.
  - A3 (inferred): 스티어링 종류는 `correction`·`addition`·`redirect`로 시작하고, 사용자 스티어링이 아닌 replan은 `none`으로 표시한다. "다른 작업 전환"은 기존 규칙(별도 goal)이 다루므로 종류에 넣지 않는다.
  - A4 (evidence: `memoryPromotionStatus`의 unknown 처리): 계획 ID가 저장소 안 일반 파일이 아니면 계획 내용을 검사할 수 없으므로 게이트를 건너뛴다.
  - A5 (inferred): 새 CLI 명령과 게이트가 추가되므로 버전은 minor인 1.4.0으로 올린다.
  - A6 (evidence: `docs/memory/release-process.md` npm 인증): `npm publish`는 대화형 인증이 필요해 사용자의 터미널에서 실행한다. 나머지 단계는 에이전트가 한다.
  - A7 (inferred): S4의 "과거의 기록"은 이번처럼 반복되는 누락(구현 뒤 릴리스·로컬 업그레이드)을 과거 계획·스티어링·메모리에서 미리 찾아 요청 계약에 올리라는 뜻으로 해석한다.
- Implicit requirements: 게시된 npm 버전은 되돌릴 수 없으므로 exact-main tarball을 한 번만 pack하고 `npm publish --dry-run`을 먼저 한다. 스티어링 이유는 사용자 텍스트이므로 길이 제한(500자)과 제어문자 정리를 거쳐 저장하고 이력에는 개수만 남긴다. 기존 goal(요청 계약 없는 계획)을 가진 사용자가 업그레이드 후 막히지 않도록 우회 플래그와 정확한 안내 오류를 둔다. `SKILL.md` 9000바이트 예산을 지킨다.
- Open questions: none
- Steering log:
  - S1 (addition): "2단계까지 해보는게 좋을 것 같은데? 단순 문장으로 해서는 효과가 약할 것 같아. 무시되는 경우도 생길 것 같고." → 정책 문구에 더해 CLI 게이트와 스티어링 기록을 같은 goal에 포함.
  - S2 (addition): "이거봐 여기에서도 구현이 되면 develop pr 머지, main pr 머지, npm 배포하라고 했어야 했는데, 내가 빼먹었잖아." → Non-scope의 "릴리스·버전 올림"을 Scope로 옮기고 task `release`를 `verify` 뒤에 추가. 원문·S1과 충돌 없음(범위 추가). 가정 A5·A6 추가.
  - S3 (correction): "로컬 설치본 업그레이드도 추가해야지" → S2에서 내가 Non-scope로 둔 "로컬 설치본 업그레이드(요청 없음)"를 대체한다. task `release`의 Contract에 단계를 추가하고 roadmap은 그대로 둔다.
  - S4 (addition): "그러니까 과거의 기록도 참고해야하는거야" → 요청 계약을 쓸 때 과거 기록(이전 계획의 스티어링 기록, 관련 완료 계획과 그 뒤에 이어진 계획, 메모리 노트)을 참고하는 규칙·라벨 `Prior records`·조회 명령 `pota plan steering`을 Design Contract에 추가. task는 그대로(`cli-gate`·`policy-surfaces`에 항목 추가). 원문·S1~S3과 충돌 없음. 가정 A7 추가.
- Current request (as of S4): 요청 계약 정책·템플릿과 이를 강제하는 goal CLI 게이트·스티어링 기록을 구현하되, 요청 계약 작성 시 과거 기록을 참고하도록 규칙·게이트·조회 명령을 포함한다. 검증 뒤 기능 브랜치 → `dev` PR 병합, `dev` → `main` PR 병합, npm 게시, 로컬 설치본 1.4.0 업그레이드까지 마친다.

## Whole Work

- Outcome: 위 Interpreted outcome.
- Affected surfaces: 계획 템플릿, pota-plan·pota-work 스킬과 참조 파일, commands·workflows 미러, README 8개, goal CLI·이력, 테스트, 메모리 노트 2개.
- Task classification: `triage-plan` → (`cli-gate` ∥ `policy-surfaces`) → `verify` → `release`(S2).

## Design Contract (두 worker가 공유하는 계약)

### 계획 파일 형식 (라벨은 locale과 무관하게 영문 고정)

```markdown
## Request Brief

- Original request: <사용자 원문 그대로>
- Interpreted outcome: <완료 시 참이어야 하는 것>
- Scope:
- Non-scope:
- Assumptions:
  - A1 (evidence|inferred|confirmed): <가정과 출처>
- Implicit requirements: <요청에 없지만 챙길 보안·데이터·되돌림 항목 | none: reason>
- Open questions: <결과를 바꾸고 되돌리기 어려운 질문 | none>
- Steering log:
  - S1 (correction|addition|redirect): <원문> → <바뀐 가정·task>
- Current request (as of S0): <현재 유효한 요청 한 문단>
```

"채워짐"의 정의: 라벨 뒤 같은 줄 값이 비어 있지 않고 `<...>` placeholder가 아니거나, 바로 아래 더 깊게 들여쓴 목록 줄이 하나 이상 있고 그중 placeholder가 아닌 줄이 있다. 섹션 범위는 `## Request Brief` 제목부터 다음 `## ` 제목 전까지다. 코드 펜스 안은 무시한다.

### CLI 동작

계획 파일 판정은 `memoryPromotionStatus`와 같은 안전 규칙(저장소 안 일반 파일, symlink 아님, 512 KiB 이하)을 쓴다. 판정 불가(unknown)면 아래 검사를 건너뛴다.

1. **요청 계약 게이트**: `requiredEvidence`에 `triageDecision`이 있는 task를 `completed`로 바꿀 때(`goal task --status completed`, `goal finish` 경로 포함) 계획 파일의 `## Request Brief`에 `Original request`, `Interpreted outcome`, `Assumptions`, `Implicit requirements`가 채워져 있지 않으면 거부한다. 오류는 빠진 라벨을 나열하고 우회 플래그를 안내한다. 우회: `--allow-no-request-brief <reason>`(완료 전이에서만 허용, 이유는 stderr로 보고).
2. **`goal steer --kind <correction|addition|redirect> --reason <text>`**: task roadmap을 바꾸지 않는 스티어링을 기록한다. active goal에서만 된다.
3. **`goal replan`**: 계획이 파일이면 `--steer <correction|addition|redirect|none>`과 `--reason <text>`가 필수다. `none`은 사용자 스티어링이 아닌 재계획(triage 확정, route 변경)이다. 계획이 unknown이면 둘 다 선택이고, 주어지면 기록한다.
4. **스티어링 순번 검사**(`steer`와 `--steer`가 `none`이 아닌 `replan` 공통, 계획이 파일일 때): 이번이 그 goal의 n번째 스티어링이면 Request Brief 섹션에 `S<n>` 항목 줄(`- S<n> (` 로 시작하는 목록 줄)이 있어야 한다. n이 2 이상이거나 kind가 `redirect`면 `Current request (as of S<n>)` 줄이 채워져 있어야 한다. 없으면 무엇을 적어야 하는지 알려 주고 거부하며, 거부 시 상태와 기록은 바뀌지 않는다.
5. **저장**: 상태 디렉터리의 `steering.json` `{schemaVersion:1, goalId, entries:[{seq, kind, reason, at, replan}]}`. `none`은 `seq: null`로 남기고 순번에 세지 않는다. goalId가 현재 goal과 다르거나 파일이 symlink·손상이면 빈 기록으로 본다. state lock 안에서 임시 파일 + rename으로 쓴다. `state.json` schema는 그대로다.
6. **이력**: terminal 전이의 이력 레코드에 `steering: {total, correction, addition, redirect}` 개수를 더한다(원문 없음). terminal 전이 후 `steering.json`을 지운다. `goal stats`(현재 goal)에도 같은 개수를 넣는다.
7. `goal --help`에 `steer`와 새 플래그를 싣는다.

### S4 추가: 과거 기록 참고

- 계획 라벨 `- Prior records: <consulted plans, memory notes, and past steering, with the recurring follow-ups found | none: reason>`를 `Assumptions` 앞에 둔다. 요청 계약 게이트(CLI 동작 1)의 필수 라벨에 `Prior records`를 더해 5개로 한다.
- 새 명령 `pota plan steering [--limit <1..200>] --root <repoRoot>`: `docs/plan/*.md`(일반 파일, symlink 아님, 512 KiB 이하)의 `## Request Brief` 섹션에서 `- S<n> (correction|addition|redirect): <text>` 줄을 모아 JSON 1개를 낸다: `{"schemaVersion":1,"plans":[{"plan":"docs/plan/<name>.md","entries":[{"seq","kind","text"}]}],"total","byKind":{"correction","addition","redirect"}}`. 항목이 있는 계획만 싣고 mtime 최신순, 기본 20개 계획. text는 제어문자를 공백으로 바꾸고 200자에서 자른다. placeholder(`<...>`) 줄과 코드 펜스 안은 제외한다. 읽지 못하는 파일은 건너뛰고 throw하지 않으며 아무것도 쓰지 않는다. `pota plan check|index`와 같은 exit 규약(0, 사용법 오류 2).
- 스티어링 순번 검사 강화(CLI 동작 4): `S<n>` 줄은 `- S<n> (<kind>): <text>` 형식이고 kind가 명령의 kind와 같으며 text가 비어 있지 않고 placeholder가 아니어야 인정한다. 템플릿의 예시 줄이 검사를 통과시키면 안 된다.
- 정책: 요청 계약을 확정하기 전에 과거 기록을 참고한다. (1) `pota plan steering`으로 이전 계획의 스티어링을 본다. (2) `## Memory Inputs`에서 고른 메모리 노트와 관련 완료 계획(최대 3개)을 본다. (3) `PLAN.md`에서 비슷한 계획 뒤에 무엇이 이어졌는지 본다(예: 기능 계획마다 릴리스 계획이 뒤따름). 반복되는 후속 작업이나 반복된 스티어링은, 저장소 증거로 항상 일어난다고 확인되면 `Implicit requirements`에, 아니면 `Open questions`에 올린다. 참고한 것과 찾은 것을 `Prior records`에 적는다. goal을 끝낼 때 두 번 이상 반복된 스티어링은 `docs/memory` 승격 후보로 본다.

### 정책 문구 (정본: 새 참조 파일 `skills/pota-plan/request-brief.md`)

- 빈틈 처리 3분류: 저장소에서 확인 가능 → 묻지 않고 확인해 `evidence` 가정으로 기록. 틀려도 싸게 되돌릴 수 있음 → `inferred` 가정으로 선언하고 진행하며 사용자에게 한 줄로 알림. 결과를 바꾸고 되돌리기 어려움 → `Open questions`에 적고 선택지형 질문으로 한 번에 묶어 묻기.
- 암묵 요구사항: 변경 표면이 Heavy Path 신호(보안·인증·권한·세션, 외부 API, DB schema, 동시성)에 걸리면 입력 검증·권한 경계·비밀정보·외부 전송·파괴적 동작을 점검해 `Implicit requirements`에 올린다.
- 스티어링 분류와 처리: `correction`(가정 교체, task 유지, `goal steer`), `addition`(task 추가, `goal replan --steer addition`), `redirect`(영향받는 가정·task 무효화, `goal replan --steer redirect`, 이미 완료한 task가 바뀐 가정에 기대면 재검증 task 추가). 무관한 요청은 기존 규칙대로 별도 goal.
- 다단계: 최신 지시를 우선하되 이전 지시·원문과 충돌하면 "S2가 X를 대체한다"를 사용자에게 알린다. 2번째 스티어링부터, 또는 `redirect`면 `Current request (as of S<n>)`를 다시 쓰고 사용자에게 보여 준다.
- Quick Path: 계획이 없으므로 가정이 하나라도 있으면 수정 전에 채팅 한두 줄로 해석과 가정을 알린다.
- `skills/pota-plan/SKILL.md`와 `skills/pota-work/SKILL.md`는 각 9000바이트 이하를 유지한다(현재 8993, 8975). 긴 규칙은 참조 파일에 두고 SKILL.md에는 포인터만 둔다.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/hook-context.md`, `docs/memory/goal-state.md`, `docs/memory/policy-surfaces.md`
- Related completed plans: none related(같은 문제를 다룬 완료 계획 없음. 게이트 패턴은 `docs/plan/main-model-gate-and-test-time.md`의 `--allow-main-model` 방식을 따른다)

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- Rationale: 계약을 계획에 고정하고 worker에게는 계약·파일 범위·검증 명령만 준다.
- User-visible response and artifact locale: ko.

## Reasoning Effort Profile

- Light Path: planning=`medium`, implementation=`medium`, verification=`medium`.
- main 세션 모델은 `claude-fable-5-2`(strongest)라 `Pota main model:` 줄이 없고 main 모델 게이트 대상이 아니다.

## Complexity Triage

- Selected path: Light Path.
- Selection rationale: 기존 goal CLI 계층 안에서 게이트 2개와 명령 1개를 더한다. 상태 schema를 바꾸지 않고, 계획 파일 검사는 기존 `memoryPromotionStatus` 패턴, 우회 플래그는 기존 `--allow-main-model` 패턴, 부가 파일은 기존 `reminder-guard.json`·`history.jsonl` 패턴을 따른다.
- Checkpoint ledger:
  - Request checkpoint: 잠정 Light. 불확실성은 schema 변경 필요 여부와 새 추상화 여부였다.
  - Planning checkpoint: Light 확정. `setTaskStatus`의 완료 분기와 `replanGoal`에 검사를 더하면 되고 schema 변경이 필요 없음을 `scripts/pota-goal-operations.mjs:144-203`에서 확인했다. replan 플래그 필수화는 계획이 파일일 때로 한정해 기존 테스트 43곳(대부분 파일이 아닌 plan id)을 깨지 않는다.
  - Code checkpoint: pending(각 worker가 첫 수정 직전에 정확한 파일·호출자·테스트를 확인하고 보고).
- Heavy Path signals checked:
  - New directory/module/layer: 없음(기존 `scripts/` 계층에 파일 1개 추가 가능).
  - New domain model/service/abstraction: 없음(기존 goal 상태의 부가 기록).
  - Security/auth/session: 없음. 사용자 텍스트 저장은 길이 제한·제어문자 정리로 다룬다.
  - External API/message queue/payment: 없음.
  - DB schema/migration: 없음(state schema v3 유지).
  - Concurrency/transaction/cache invalidation: 기존 state lock 안에서만 쓴다. 새 lock 없음.
  - Cross-domain refactor: 없음.
  - Explicit extra-care signal: 없음.
- Omitted delegation in Light Path: 계획·리뷰 전용 agent는 생략하고 main이 리뷰한다.

## Agent Assignments

이 호스트의 Agent 목록에 `worker` 유형이 없어 `general-purpose`를 worker로 쓴다.

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | `light` | main 세션(`claude-fable-5-2`) | 상속 |
| `cli-gate` | general-purpose(worker) | `light` | `sonnet` | `medium` |
| `policy-surfaces` | general-purpose(worker) | `light` | `sonnet` | `medium` |
| `verify` | main | `light` | main 세션 | 상속 |

## Tool Readiness

- Detected stack: javascript, typescript
- Toolcheck command: `pota toolcheck --root <repoRoot>` → node, npm, typescript-language-server, tsc 모두 OK
- Missing tools: 없음
- Install approval: not needed

## Execution Guardrails

- Test contract first: `cli-gate`는 `test/request-brief.test.mjs`에 아래 요구사항을 먼저 테스트로 쓰고 실패를 확인한 뒤 구현한다.
- Verification ladder: focused tests → `npm test` 1회(약 165초) → `npm pack --dry-run`은 릴리스가 아니므로 생략.
- Dry-run: 외부 상태 변경 없음(not applicable).
- Verification loop budget: task당 2회.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Required evidence records: `planArtifact`, `triageDecision`

### Task 1: goal CLI 게이트와 스티어링 기록

- Task ID: `cli-gate`
- Initial status: `pending`
- Requested model: balanced(`sonnet`) / Effective model: (dispatch 후 기록)
- Requested reasoning effort: `medium` / Effective reasoning effort: (dispatch 후 기록)
- Contract: 위 "CLI 동작" 1~7.
- Test contract:
  - 요구사항: 게이트 1의 거부·통과·우회, `steer` 기록, 파일 계획에서 `replan` 플래그 필수, 순번 검사(S1, S2의 `Current request`, `redirect`), 이력 개수.
  - 불변식: `state.json` schema v3와 `GOAL_STATE_CONTRACT` 불변. 거부된 명령은 상태·`steering.json`을 바꾸지 않는다. 파일이 아닌 plan id에서는 기존 동작과 출력이 같다.
  - 경계: placeholder(`<...>`)만 있는 라벨, 코드 펜스 안의 가짜 섹션, 하위 목록으로 채운 `Assumptions`, 500자 초과·제어문자 이유, 다른 goalId의 `steering.json`, symlink `steering.json`.
  - 실패 모드: 잘못된 `--kind`/`--steer` 값은 사용법 오류, goal 없음, paused goal.
  - 예상 초기 실패: `goal steer`는 알 수 없는 명령, 게이트 테스트는 완료가 통과해 실패.
- Files: `scripts/pota-goal-cli.mjs`, `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-history.mjs`, 필요 시 새 `scripts/pota-goal-steering.mjs`, `test/request-brief.test.mjs`(신규)
- Depends on: `triage-plan`
- Write scope: `scripts`, `test/request-brief.test.mjs`, `test/goal-history.test.mjs`, `test/goal-state.test.mjs`, `test/cli-contract-hardening.test.mjs`
- Handoff files: 없음(계약은 이 계획의 Design Contract)
- Module acceptance verification: `node --test test/request-brief.test.mjs`
- Surface integration verification: `node --test test/goal-state.test.mjs test/goal-history.test.mjs test/cli-contract-hardening.test.mjs test/main-model-gate.test.mjs test/state-recovery-hardening.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 2: 정책 표면과 템플릿

- Task ID: `policy-surfaces`
- Initial status: `pending`
- Requested model: balanced(`sonnet`) / Effective model: (dispatch 후 기록)
- Requested reasoning effort: `medium` / Effective reasoning effort: (dispatch 후 기록)
- Contract: 위 "계획 파일 형식"을 `templates/work-plan.md`에 `## Goal` 다음 섹션으로 넣는다. "정책 문구"를 새 `skills/pota-plan/request-brief.md`에 영문으로 쓴다. `skills/pota-plan/SKILL.md` Reference Files에 포인터를 넣고 `planning-rules.md`에 규칙 bullet을 더한다. `skills/pota-work/SKILL.md`의 replan 예시에 `--steer`·`--reason`을 반영하고 `recovery.md`에 스티어링 처리 문장을 더한다. `commands/pota-{plan,work}.md`와 `.agents/workflows/pota-{plan,work}.md`에 같은 의미의 문장을 옮긴다. README 8개에 요청 계약·`goal steer`·`--allow-no-request-brief`를 담은 bullet 1개씩을 각 언어로 더한다. `test/contract-parity.test.mjs`에 이 표면들이 `## Request Brief`, `goal steer`, `--steer`, `--allow-no-request-brief`, `Current request (as of S`를 담는지 고정하는 테스트를 더한다.
- Files: 위 Contract에 나열한 파일.
- Depends on: `triage-plan`
- Write scope: `skills`, `templates`, `commands`, `.agents`, `README.md`, `README.ko.md`, `README.ja.md`, `README.zh.md`, `README.es.md`, `README.fr.md`, `README.de.md`, `README.pt.md`, `test/contract-parity.test.mjs`
- Module acceptance verification: `node --test test/contract-parity.test.mjs`
- Surface integration verification: `node --test test/token-efficiency.test.mjs test/docs-package-hardening.test.mjs test/installed-plugin.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 3: 검증과 리뷰

- Task ID: `verify`
- Depends on: `cli-gate`, `policy-surfaces`
- Contract: main이 두 worker의 diff를 Design Contract에 대조해 리뷰하고, 임시 저장소에서 CLI를 실제로 실행해 게이트 동작을 확인하며, `docs/memory/goal-state.md`·`policy-surfaces.md`를 갱신한다.
- Module acceptance verification: `node --test test/request-brief.test.mjs test/contract-parity.test.mjs`
- Surface integration verification: 임시 저장소에서 `goal start` → 빈 계약으로 triage 완료 거부 → 계약 채운 뒤 통과 → `goal steer` 순번 거부·통과를 확인하는 실행 기록.
- 리뷰 뒤 `npm test`를 이 task의 증거로 기록한다(S2로 goal 최종 확인은 `release`로 옮김).

### Task 4: 1.4.0 릴리스 (S2)

- Task ID: `release`
- Depends on: `verify`
- Agent: main(외부 상태 변경과 사용자 터미널 단계가 있어 위임하지 않는다)
- Contract: `docs/memory/release-process.md` 절차를 따른다.
  1. `dev`에서 기능 브랜치 `feat/request-brief-steering`을 만들고 버전 표면 4곳을 1.4.0으로 올린다(`package.json`, `.codex-plugin/plugin.json`, `claude-mod/.claude-plugin/plugin.json`, `test/contract-parity.test.mjs`).
  2. `npm run check` 통과 후 커밋·push, 기능 브랜치 → `dev` PR. exact head CI 통과 후 head SHA를 고정해 병합.
  3. `dev` → `main` PR. 같은 방식으로 병합.
  4. 병합된 `main` SHA의 clean detached worktree에서 `npm whoami` 확인 → `npm pack` 1회 → 같은 tarball로 `npm publish --dry-run`.
  5. 사용자가 자기 터미널에서 `npm publish <tarball 경로>` 실행(A6).
  6. `npm view @comento/pota-harness@1.4.0 dist --json`의 shasum·integrity·`latest`를 tarball과 대조하고, 격리 prefix에 설치해 `goal steer`와 요청 계약 게이트를 확인.
  7. 로컬 설치본 업그레이드(S3): `pota auto-upgrade status` 확인 → `npm install -g @comento/pota-harness@1.4.0` → `pota upgrade` → `pota doctor`(첫 줄 `Hosts:`)와 `pota --version` 확인.
  8. `main` 병합 커밋을 `dev`에 다시 합치고, 계획을 Completed로 옮기는 기록 PR을 만든다.
- Dry-run or check command: `npm pack --dry-run`(lifecycle script 포함), `npm publish --dry-run <tarball>`
- Module acceptance verification: `npm view @comento/pota-harness@1.4.0 version` 이 `1.4.0`
- Surface integration verification: 격리 설치본에서 `pota --version`과 `pota goal --help`의 `steer` 확인
- Goal final review: 게시·격리 설치 확인 뒤 `goal finish`

## Evidence

- Tool readiness: toolcheck 모두 OK.
- `triage-plan`: `pota plan check` exit 0 (`planArtifact`, `triageDecision`).
- `policy-surfaces`(worker `general-purpose`, Requested `sonnet`/`medium`, Effective `sonnet (claude-sonnet-5-5)`/`medium`): `node --test test/contract-parity.test.mjs` 11 pass, `node --test test/token-efficiency.test.mjs test/docs-package-hardening.test.mjs test/installed-plugin.test.mjs` 32 pass. 리뷰에서 2건을 돌려보냈다: 세션 ID 안전 문장 삭제 복원, 템플릿의 `S1 (` 예시 줄 제거.
- `cli-gate`(worker `general-purpose`, Requested `sonnet`/`medium`, Effective `sonnet (claude-sonnet-5-5)`/`medium`): `node --test test/request-brief.test.mjs` 17 pass, 표면 통합 6개 파일 exit 0. main이 `pota plan --help`에 `steering`을 더했다(`scripts/pota-index.mjs`, `test/index.test.mjs`).
- `verify`: 임시 저장소 실행 확인(빈 계약 거부 → 채운 뒤 통과, `S1` 없는 steer 거부, `--steer` 없는 replan 거부, `Current request (as of S2)` 없는 2번째 스티어링 거부, `state.json` schema 3 유지, 종료 후 `steering.json` 삭제와 이력 개수). 첫 `npm test`는 `test/lifecycle.test.mjs`가 고정한 "user-called/main agent as the orchestrator" 문구가 줄어 1건 실패했고, 문구 복원 뒤 `npm run check` exit 0(1.4.0 버전 표면 포함).
- Tests: `npm run check` exit 0.
- Verification pass count: `verify` 2회(1회 실패 후 수정).
- `release`:
  - `dev-pr`: comento/pota-harness#16(`feat/request-brief-steering` → `dev`), head `8e99b96`의 CI 7개 검사 통과 후 head SHA 고정 병합 → `733ff7a`.
  - `main-pr`: comento/pota-harness#17(`dev` → `main`), head `733ff7a`의 CI 통과 후 head SHA 고정 병합 → `122b031`.
  - `npm-publish`: `122b031`의 clean detached worktree에서 pack 1회(prepack의 `npm run check` 통과). tarball `comento-pota-harness-1.4.0.tgz`, 277,231 bytes, 120 files, sha1 `a7a028137973888113b2abc6e1281125aa10a7a9`, integrity `sha512-iWMO0v3WRi9cSBNlR0EXtCb+bDLvuUQvZVEOWRYWcB3X2MkX3mG/C+gqdiI7i185ciKko41nIQ3a1101tVvDFg==`. `npm publish --dry-run` 통과 후 사용자가 자기 터미널에서 같은 tarball을 게시했다.
  - registry: `npm view @comento/pota-harness@1.4.0`의 shasum·integrity가 tarball과 일치하고 `latest`는 `1.4.0`이다.
  - 격리 설치(별도 prefix·cache·HOME·`POTA_HOME`): `pota --version` → `pota 1.4.0`, `goal --help`에 `steer`, `plan --help`에 `steering`. 빈 Request Brief로 triage 완료 거부(exit 1), `S1` 없는 `goal steer` 거부(exit 1).
  - 로컬 설치본(S3): `npm install -g @comento/pota-harness@1.4.0` → `pota upgrade`(runtime `~/.pota/install/runtime/1.4.0`) → `pota doctor` 첫 줄 `Hosts: claude,antigravity`, 전 항목 OK.
  - `main` 병합 커밋을 `dev`에 다시 합치는 것은 이 기록 PR에 포함했다.
- Memory promotion: `docs/memory/goal-state.md`(요청 계약 게이트와 스티어링 기록), `docs/memory/policy-surfaces.md`(표면 지도).

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded (외부 상태 변경 없음)
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
