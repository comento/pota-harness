# Plan: 메모리·계획 인덱스 재활용과 측정·감사 잔여 수정

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (완료)
- Finalized: decision-complete for implementation. 세부 설계 결정은 `## Heavy Design`에 확정돼 있다.
- Codex UI synchronization: Claude Code 데스크톱 `update_plan`으로 task list 동기화. `create_goal`은 이 호스트에 없어 unavailable.

## Goal

Pota가 저장소 메모리와 완료 계획을 실제로 재활용하도록 만든다. 사용자가 지정한 4개 항목을 모두 수정한다.

1. `MEMORY.md`는 `docs/memory/*.md`의 위치를 알려주는 인덱스이고, 실제 지식은 `docs/memory`에 들어가며, Pota 실행 시 hook 프롬프트로 어떤 메모리가 있는지 에이전트에게 인지시킨다.
2. `PLAN.md`도 같은 방식이다. 루트는 `docs/plan/*.md` 위치를 알려주는 짧은 인덱스이고, hook 프롬프트로 존재를 알린다.
3. goal 간 효과 측정 수단을 추가한다.
4. 0.2.7 감사 잔여(F6, F10, F11)의 현재 상태를 확인하고 남은 것을 수정한다.

- Goal ID: `goal-d0ae86cc-4237-4662-8469-581f90e6fe7c`
- Plan ID: `docs/plan/memory-plan-index-reuse.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version. 구현 대상은 이 저장소(source checkout)이며, 설치본(0.5.0)은 goal CLI 실행에만 쓴다.
- Completion criteria: 4개 항목 각각이 테스트로 고정되고 `npm run check`와 `npm pack --dry-run`이 통과하며, 이 저장소의 `MEMORY.md`/`docs/memory`/`PLAN.md`가 새 구조를 따른다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome: 위 4개 항목. 1·2번이 최우선.
- 현재 상태(조사 결과):
  - hook 주입문은 `kernelBase()`의 "루트 MEMORY.md는 선택 사항이며, 있으면 읽으세요" 한 문장뿐이다(`scripts/pota-state-context.mjs:84`). `docs/memory`에 어떤 노트가 있는지, 완료 계획이 무엇인지 알리지 않는다.
  - `MEMORY.md`와 `docs/memory`의 일치를 검사하거나 인덱스를 만드는 코드가 없다. 스크립트에서 이 경로를 다루는 곳은 `init` 템플릿(`scripts/pota-state-init.mjs`)과 증거 fingerprint 제외 규칙(`scripts/pota-goal-evidence.mjs:92`)뿐이다.
  - 메모리 기록은 `pota-memory` 스킬을 명시적으로 쓸 때만 일어난다. `pota-work`/`pota-review` 완료 절차에 메모리 승격 단계가 없다. 이 저장소의 `docs/memory`는 비어 있다.
  - `init`이 만드는 `PLAN.md`에는 긴 Planning Rules가 들어가고(스킬과 중복), 완료 항목은 길이 제한 없이 누적된다. 이 저장소 `PLAN.md`는 70줄이며 대부분 긴 완료 항목이다.
  - hook 토큰 예산 테스트: idle ≤ 620자, active ≤ 700자(`test/token-efficiency.test.mjs:48,73,197`), `defaultPrompt` ≤ 1600자, SKILL.md ≤ 9000바이트.
  - goal 상태는 worktree당 파일 1개(`~/.pota/projects/<repo>/worktrees/<wt>/`)이고, goal이 종료 상태가 되면 그 파일을 삭제한다(`scripts/pota-goal-operations.mjs:93-104`). goal 간 이력이 남지 않아 `goal stats`는 현재 goal만 본다. (triage 때 "새 goal 시작 시 덮어쓴다"고 적었던 것을 설계 단계에서 정정)
- Affected surfaces: `scripts/`(새 인덱스 모듈, `pota.mjs`, `pota-state-context.mjs`, `pota-state.mjs`, `pota-state-init.mjs`, `pota-goal-*`, 감사 잔여 대상), `skills/*`, `commands/*`와 미러(`.claude/commands`, `.agents/workflows`), `agents/*`와 `.claude/agents`, `templates/*`, `.codex-plugin/plugin.json`, `README*.md`(8개 locale), `test/*`, 이 저장소의 `MEMORY.md`·`PLAN.md`·`docs/memory/*`.
- Task classification: 아래 Module Tasks.

## Memory Inputs

- `MEMORY.md`: dev 브랜치에서 시작, 고유명사 보존, OS locale(한국어)로 산출물 작성.
- `docs/memory/`: 비어 있음(이번 작업의 대상).

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`.
- User-visible response and artifact locale: 한국어. 코드·스킬·영문 README는 기존 언어를 따른다.

## Reasoning Effort Profile

- Heavy Path: planning/review=`high`, implementation=`high`, final verification/review=`xhigh`.
- 설계는 strongest(`fable`), 구현·리뷰는 stronger(`opus`), 읽기 전용 조사는 balanced(`sonnet`).

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: 사용자의 extra-care 신호, 새 모듈과 CLI 표면, 새 영속 파일(goal 이력), hook 프롬프트 계약 변경, 다중 영역 변경.
- Checkpoint ledger:
  - Request checkpoint: Heavy(provisional). 근거: 사용자 요청의 "가장 신경써야 하는 부분".
  - Planning checkpoint: Heavy 확정. 근거: 위 조사 결과. 새 모듈(인덱스), 새 영속 상태(goal 이력), hook 예산 계약 변경이 필요하다.
  - Code checkpoint: Heavy 유지. 설계 task가 대상 파일·호출부·테스트를 줄 번호까지 확인했고(`## Heavy Design` 0절), 새 Heavy 신호나 경로 변경 사유는 없다. 첫 편집 직전에 기록.
- Heavy Path signals checked:
  - New directory/module/layer: 있음(인덱스 모듈).
  - New domain model/service/abstraction: 있음(인덱스 항목, goal 이력 레코드).
  - Security/auth/session: 없음.
  - External API/message queue/payment: 없음.
  - DB schema/migration: 없음(goal state schema 변경 여부는 설계에서 결정).
  - Concurrency/transaction/cache invalidation: 있음(goal 이력 기록은 state lock 안에서, F6는 lock 삭제 범위).
  - Cross-domain refactor: 있음(hook, CLI, 스킬, 템플릿, 문서).
  - Explicit extra-care signal: 있음.
- Pre-implementation decisions (`heavy-design`이 확정):
  1. 인덱스 항목 형식과 원천: `MEMORY.md`/`PLAN.md`의 한 줄 형식, 노트 요약을 어디서 읽는지, 길이 상한.
  2. CLI 표면: 인덱스 재생성과 검사 명령의 이름, 출력, exit code. 검사 실패 조건(미연결 파일, 죽은 링크, 길이 초과).
  3. hook 주입: SessionStart와 UserPromptSubmit 각각에 무엇을 넣는지, 문자 예산, 넘칠 때의 축약 규칙, 메모리가 없을 때의 문구. 기존 620/700자 예산 테스트를 어떻게 바꾸는지.
  4. 메모리 승격 지점: goal 완료 흐름(`goal finish`, Stop gate, `pota-work`/`pota-review` 절차) 중 어디에서 메모리 기록을 요구하거나 상기시키는지, 강제 수준.
  5. `PLAN.md` 구성: Planning Rules 처리, 완료 항목의 한 줄 상한, 오래된 완료 항목 아카이브 위치와 규칙, 기존 저장소 마이그레이션.
  6. 계획 재활용: `pota-plan`이 관련 완료 계획을 찾아 읽는 절차.
  7. goal 이력: 기록 시점, 레코드 필드, 저장 위치, 상한, `goal stats`의 집계 출력.
  8. 감사 잔여 수정 방식(아래 Audit Residual 조사 결과 기준).

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | heavy | main | high |
| `heavy-design` | Plan(읽기 전용) | heavy | fable | high |
| `index-core` | worker | heavy | opus | high |
| `goal-history` | worker | heavy | opus | high |
| `audit-residual` | worker | heavy | opus | high |
| `hook-context` | worker | heavy | opus | high |
| `policy-surfaces` | worker | heavy | opus | high |
| `dogfood` | worker | heavy | opus | high |
| `verify` | main + 읽기 전용 reviewer | heavy | opus | xhigh |

## Tool Readiness

- Detected stack: javascript(Node ESM, 의존성 없음). toolcheck가 python도 감지했지만 추적되지 않는 `.omo/` 연구 스크립트 때문이며 이번 작업 범위가 아니다.
- Toolcheck command: `pota toolcheck --root <repoRoot>` → node OK, npm OK, basedpyright/ruff MISSING(범위 밖, 설치 요청 안 함).
- Required verification tools: `node --test`, `npm run check`, `npm pack --dry-run`.
- Install approval: not needed.

## Execution Guardrails

- Test contract first: 각 구현 task는 실패하는 테스트를 먼저 쓰고 실패를 확인한 뒤 최소 구현한다.
- 기존 테스트를 약화·삭제하지 않는다. hook 문자 예산처럼 계약 자체가 바뀌는 경우는 `## Heavy Design`에 변경 사유를 기록한 뒤 바꾼다.
- 토큰 제약: 메모리·계획이 없는 저장소의 hook 출력 증가는 최소로 한다. UserPromptSubmit은 매 프롬프트마다 누적되므로 목록은 SessionStart에만 싣는 것을 기본안으로 한다.
- Verification ladder: task별 focused test → 마지막에 `npm run check` 1회 → `npm pack --dry-run`(prepack이 check를 실행하므로 `--ignore-scripts` 금지).
- External-state mutation: 없음. 커밋·푸시·릴리스·npm publish는 이번 goal 범위가 아니다.
- Verification loop budget: task당 2회.

## Module Tasks

### Task 0: `triage-plan`

- 조사와 계획 확정. Required evidence: `planArtifact`, `triageDecision`.

### Task 1: `heavy-design`

- Kind: design, route heavy. Depends on: `triage-plan`. Write scope: 없음(결과는 main이 이 파일 `## Heavy Design`에 병합).
- Contract: 위 Pre-implementation decisions 1~8을 확정하고, 각 구현 task의 파일 범위·테스트 계약·수용 기준을 구체화한다.
- Required evidence: `designRecord`.

### Task 2: `index-core`

- Contract: `docs/memory`·`docs/plan`을 스캔해 인덱스 항목을 만들고, 루트 인덱스와의 불일치를 검사하고, 인덱스를 재생성하는 모듈과 CLI.
- Depends on: `heavy-design`. Write scope: `scripts/pota-index.mjs`, `scripts/pota.mjs`, `scripts/pota-state-init.mjs`, `package.json`, `test/index.test.mjs`.
- Module acceptance: `node --test test/index.test.mjs`. Surface integration: `node --test test/lifecycle.test.mjs test/cli-contract-hardening.test.mjs`.

### Task 3: `goal-history`

- Contract: goal 종료 시 요약 레코드를 이력에 남기고 `goal stats`가 goal 간 집계를 출력한다.
- Depends on: `heavy-design`. Write scope: `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-operations-evidence.mjs`, `scripts/pota-goal-state.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-goal.mjs`, `test/goal-history.test.mjs`.
- Module acceptance: `node --test test/goal-history.test.mjs`. Surface integration: `node --test test/goal-state.test.mjs test/goal-dag.test.mjs test/goal-effort.test.mjs`.

### Task 4: `audit-residual`

- Contract: F6·F10·F11 중 현재도 열려 있는 것을 수정한다(조사 결과는 아래 Audit Residual).
- Depends on: `index-core`, `goal-history`(`scripts/pota.mjs`, `scripts/pota-goal-cli.mjs`를 함께 건드리므로 순차). Write scope: `scripts/pota-cleanup.mjs`, `scripts/pota-safe-fs.mjs`, `scripts/pota.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-goal.mjs`, `scripts/pota-lifecycle.mjs`, `test/cleanup-hardening.test.mjs`, `test/cli-contract-hardening.test.mjs`.
- Module acceptance: `node --test test/cleanup-hardening.test.mjs test/cli-contract-hardening.test.mjs`. Surface integration: `node --test test/lifecycle.test.mjs test/goal-state.test.mjs test/state-recovery-hardening.test.mjs`.

### Task 5: `hook-context`

- Contract: SessionStart/UserPromptSubmit 캡슐에 메모리·계획 인덱스 인지 문구를 예산 안에서 싣는다.
- Depends on: `index-core`. Write scope: `scripts/pota-state-context.mjs`, `scripts/pota-state.mjs`, `test/token-efficiency.test.mjs`, `test/index-context.test.mjs`.
- Module acceptance: `node --test test/index-context.test.mjs test/token-efficiency.test.mjs`. Surface integration: `node --test test/goal-state.test.mjs test/installed-plugin.test.mjs`.

### Task 6: `policy-surfaces`

- Contract: 스킬·명령·미러·에이전트·템플릿·`defaultPrompt`·README 8개 locale에 새 인덱스 규칙, 메모리 승격 단계, 계획 재활용 절차, 새 CLI, F10 고지를 반영한다.
- Depends on: `index-core`, `goal-history`, `audit-residual`, `hook-context`. Write scope: `skills`, `commands`, `.claude`, `.agents`, `agents`, `templates`, `.codex-plugin`, `README.md`, `README.ko.md`, `README.ja.md`, `README.zh.md`, `README.es.md`, `README.fr.md`, `README.de.md`, `README.pt.md`, `test/contract-parity.test.mjs`, `test/docs-package-hardening.test.mjs`.
- Module acceptance: `node --test test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/token-efficiency.test.mjs`. Surface integration: `node --test test/lifecycle.test.mjs test/installed-plugin.test.mjs`.

### Task 7: `dogfood`

- Contract: 이 저장소의 완료 계획에서 재사용할 지식을 `docs/memory/<domain>.md`로 정리하고, `MEMORY.md`와 `PLAN.md`를 새 인덱스 구조로 바꾼다. 새 검사 명령이 이 저장소에서 통과한다.
- Depends on: `index-core`, `policy-surfaces`. Write scope: `MEMORY.md`, `PLAN.md`, `docs/memory`, `docs/plan`.
- Module acceptance: 새 인덱스 검사 명령(이름은 설계에서 확정). Surface integration: source checkout의 `pota-state.mjs session-start` 출력에 이 저장소 메모리 노트가 나타나는지 확인.

### Task 8: `verify`

- Contract: `npm run check`, `npm pack --dry-run`, 독립 읽기 전용 리뷰(xhigh), 최종 `goal finish`.
- Depends on: 전부.

## Audit Residual

읽기 전용 explorer(`sonnet`, 보고 모델 ID `claude-sonnet-5-5`, effort `high`)가 0.5.0 코드에서 확인한 결과다. 격리한 임시 repo와 임시 `HOME`에서 실행했고 `cleanup --yes`와 lifecycle 명령은 실행하지 않았다.

- F6 stale-lock 삭제 범위: STILL OPEN. `scripts/pota-cleanup.mjs:8,27,41-52`가 이름 정규식과 파일 타입만 보고 `state.lock`, `state.lock.stale.*`를 삭제 대상으로 분류한다. 내용이 임의 텍스트인 파일도 `cleanup --check`에서 `known`으로 나온다. lock 내용 파서(`scripts/pota-safe-fs.mjs`의 `parseLockRecord`, `isReclaimableLock`)는 있지만 cleanup에 연결돼 있지 않다.
  - 수정: lock 파일은 내용이 유효한 lock 레코드일 때만 known으로 분류하고, 아니면 unknown으로 보존한다. 살아 있는 owner의 `state.lock`은 삭제하지 않는다. 기존 `test/cleanup-hardening.test.mjs:171` 부근은 임의 내용 stale lock의 삭제를 기대하므로, 이 계약 변경을 여기에 기록하고 fixture를 유효 레코드로 바꾼다.
- F10 completionCriteria 고지: STILL OPEN. 기계 계약(`GOAL_STATE_CONTRACT.completionCriteria = advisory, enforced false`)은 있지만 README, `templates/work-plan.md:16`, CLI usage 어디에도 사용자 고지가 없다.
  - 수정: CLI usage 문구는 `audit-residual`, README·템플릿 문구는 `policy-surfaces`에서 추가하고 `test/docs-package-hardening.test.mjs`로 고정한다.
- F11 CLI help/exit: PARTIAL. 잔여 3건이 재현된다.
  - (a) `pota init --help`/`--version`/임의 옵션이 모두 exit 0으로 파일을 생성한다(`scripts/pota.mjs:33-37`이 남은 인자를 검사하지 않음).
  - (b) `pota cleanup --help`/`--bogus`와 symlink 오류가 Node 스택 트레이스를 그대로 출력한다(`scripts/pota-cleanup.mjs:57-67`에 try/catch 없음).
  - (c) `pota goal --help`/`--version`, `pota task --help`가 exit 1 오류로 처리된다. root와 toolcheck는 help/version exit 0, 사용법 오류 exit 2다.
  - 수정: init은 인자를 받으면 변경 없이 거부하고 help는 usage 출력 후 exit 0. cleanup은 오류를 `Pota cleanup error: …` 한 줄로 내고 help/version을 지원. goal/task는 `--help`/`--version`을 exit 0으로 지원. goal 실행 오류의 기존 exit code는 기존 테스트가 고정한 값을 유지한다(설계에서 확인).

## Heavy Design

설계 task(`fable`, effort `high`, 읽기 전용) 결과다. 아래 내용이 위 Module Tasks의 write scope·의존·테스트 계약과 다르면 이 절이 우선한다.

보고 모델 ID: `claude-fable-5-2`. 읽기 전용으로 수행했고 파일·git·`~/.pota`는 건드리지 않았다. 실행한 것은 `scripts/pota-state-context.mjs`의 순수 함수 호출과 문자열 길이·바이트 계산뿐이다.

#### 0. 계획 전제를 바꾸는 사실 6가지

1. **종료된 goal은 덮어쓰이지 않고 이미 삭제된다.** `transitionGoal`의 terminal 분기가 lock 안에서 `rm(path)`한다(`scripts/pota-goal-operations.mjs:93-104`, 계약은 `scripts/pota-goal-state-validation.mjs:12-17`의 `persistence: "deleted"`). 계획 34행의 "새 goal을 시작하면 덮어쓴다"는 예전 버전이 남긴 terminal 상태 파일에만 해당한다(`pota-goal-operations.mjs:44`). 이력 기록 지점은 terminal 전이가 주 경로다.
2. **active UserPromptSubmit에는 여유가 없다.** 실측: en idle UPS 514, en active UPS 691(예산 700), 큰 roadmap 케이스는 정확히 700(`test/token-efficiency.test.mjs:197`). ko는 324/527. active UPS에는 한 글자도 더 못 싣는다.
3. **`pota memory`, `pota plan`은 이미 있는 명령이다**(`scripts/pota.mjs:48-51`, 안내문 출력). 하위 명령으로 붙이면 `test/cli-contract-hardening.test.mjs:11`이 고정한 usage 문자열을 바꾸지 않아도 된다.
4. **`init`의 Planning Rules를 테스트가 고정하고 있다**(`test/lifecycle.test.mjs:181-197`). 인덱스에서 빼려면 이 테스트를 바꿔야 하는데, 계획의 `index-core` write scope에 이 파일이 없다.
5. **F6를 고치면 계획이 언급하지 않은 테스트도 깨진다.** `test/goal-state.test.mjs:628-644`가 내용이 `"stale\n"`인 `state.lock`의 삭제를 기대한다.
6. **SKILL.md 바이트 예산이 거의 찼다.** `skills/pota-plan/SKILL.md` 8934, `skills/pota-work/SKILL.md` 8908바이트(상한 9000, `test/token-efficiency.test.mjs:349-354`). 새 절차는 참조 파일에 넣어야 한다.

#### 1. Pre-implementation decisions 확정

##### 결정 1. 인덱스 항목 형식과 원천

**한 줄 형식(두 인덱스 공통)**

```
- [<name>](docs/<memory|plan>/<name>.md): <summary>
```

- `<name>`은 파일 basename에서 `.md`를 뺀 값이다. 링크 텍스트·hook 표기·CLI 보고가 모두 이 식별자를 쓴다.
- 경로는 항상 POSIX `/`.
- 상한: summary 120자(넘으면 119자 + `…`), 한 줄 200자, name 64자, 루트 파일 120줄 또는 16384바이트.
- name에 공백·`()[]<>`·백틱·제어문자가 있거나 64자를 넘으면 색인하지 않고 `unsafe-name` 오류로 보고한다.
- 스캔은 `docs/<kind>` 최상위의 일반 파일 `*.md`만 한다. `README.md`와 (plan의) `ARCHIVE.md`는 제외하고, 하위 디렉터리는 `nested-ignored` 경고로만 알린다.

**파서(예전 형식 호환)**

- 코드 펜스 밖의 목록 줄(`^\s*[-*+]\s+`)에서 `docs/(memory|plan)/<file>.md` 참조를 처음 하나만 인식한다.
- 허용 형태 3가지: `[text](docs/…)`(앞의 `./` 허용), `` `docs/…` ``, 맨 경로.
- 파일명 문자 클래스에서 `<>`를 빼므로 `docs/memory/<domain>.md` 같은 placeholder는 항목이 아니다.
- 참조 뒤의 `:`, ` - `, ` — `를 걷어낸 나머지가 summary다.
- 현재 `## ` 제목을 section으로 기록한다.
- `docs/plan/ARCHIVE.md` 안에서는 `(<name>.md)` 상대 링크도 plan 항목으로 인식한다.
- 섹션 제목 `## Domain Knowledge`, `## Active Plans`, `## Completed Plans`, `## Planning Rules`는 모든 locale에서 영문 고정 식별자다. ko 템플릿도 이미 영문 제목을 쓴다(`scripts/pota-state-init.mjs:31,87,91,95`).

**summary 원천(memory)**

1. 노트 머리 4096바이트, 첫 20줄 안의 `Summary:` 줄. 정규식 `/^(?:[-*>]\s*)?(?:\*\*)?Summary:(?:\*\*)?\s*(.+?)\s*$/i`. 값이 `<…>` placeholder면 없는 것으로 본다.
2. 없으면 기존 인덱스 줄의 summary(손으로 쓴 문구 보존).
3. 없으면 `## Scope` 아래 첫 문단 줄 → 첫 비제목 줄 → H1(`Domain:` 접두 제거) → name.

`Summary:`는 `Tests:` 증거 줄처럼 locale과 무관한 고정 키다. 2~3으로 얻은 경우 `summary-missing` 경고를 낸다.

**summary 원천(plan)**

- 기존 줄의 문구를 그대로 둔다.
- 새로 추가하는 항목만 계획 H1에서 `^# \S+:\s*` 접두(`Plan:`, `계획:`)를 뗀 제목을 쓴다(120자 clip).

**재생성 시 보존 불변식.** `index`가 루트 파일에 하는 일은 아래 4가지뿐이고, 그 밖의 바이트(`## Policy` 등)는 그대로 둔다.

1. 새 항목 줄 삽입.
2. memory에서 노트의 `Summary:`와 인덱스 문구가 다를 때 그 한 줄을 정규 형식으로 교체.
3. Pota가 만든 placeholder 줄을 정확히 일치할 때만 제거. 대상은 `- Link detailed notes under \`docs/memory/\`.`, `- Link detailed plans under \`docs/plan/\`.`, `- Move completed topics here with evidence links.`와 그 ko 판 3개(`pota-state-init.mjs:11,33,55,59,89,93`).
4. `--archive`를 준 경우에만 줄·섹션을 `docs/plan/ARCHIVE.md`로 원문 이동.

죽은 링크는 지우지 않고 오류로 보고한다. EOL은 기존 파일의 것을 따르고, 쓰기는 `safeWriteFile` 임시 파일 + `rename`으로 한다.

**기본안에서 바꾼 점.** managed 마커 블록을 쓰지 않는다. 마커 방식은 예전 파일에 마커를 삽입하는 마이그레이션이 필요하고 손으로 쓴 summary를 덮어쓸 위험이 있다. "섹션 + 줄 단위 편집"은 예전 `MEMORY.md`에 마이그레이션 없이 동작한다.

**삽입 위치**

- memory: `## Domain Knowledge` 목록 끝. 섹션이 없으면 파일 끝에 섹션을 추가한다.
- plan: 파일의 체크박스(`- [ ]`/`- [x]`)가 1개 이상이고 미체크가 없으면 `## Completed Plans` 목록 맨 위, 아니면 `## Active Plans` 목록 끝. 어디에 넣었는지 보고에 싣는다.

##### 결정 2. CLI 표면

새 모듈 `scripts/pota-index.mjs`. `scripts/pota.mjs`가 정적 import한다(`scripts/pota-paths.mjs:144-160`의 런타임 closure에 자동 포함되므로 동적 import 금지).

```
pota memory                       # 기존 안내문 그대로 (exit 0)
pota memory check [--root PATH] [--strict]
pota memory index [--root PATH] [--dry-run]
pota plan   check [--root PATH] [--strict]
pota plan   index [--root PATH] [--dry-run] [--archive]
pota memory|plan --help           # "Usage: pota memory [check|index] [--root PATH] [--strict] [--dry-run]"
                                   # plan은 끝에 " [--archive]" 추가. 영문 고정(toolcheck 선례: scripts/pota-toolcheck.mjs:44)
```

**출력.** 항상 JSON 1개(2칸 들여쓰기, `cleanup`·`goal`과 같은 관례).

```json
{ "schemaVersion": 1, "kind": "memory", "index": "MEMORY.md", "directory": "docs/memory",
  "ok": true, "files": 6, "entries": 6,
  "errors": [{ "code": "unindexed", "path": "docs/memory/x.md", "message": "…" }],
  "warnings": [] }
```

`index`는 적용 후 상태의 같은 보고에 다음을 더한다: `changed`, `dryRun`, `added`, `updated`, `removedPlaceholders`, `archived`, `movedSections`, `placed`(`{name: "active"|"completed"}`).

**exit code**

| 코드 | 의미 |
| --- | --- |
| 0 | errors 없음(`--strict`면 warnings도 없음) |
| 1 | errors가 남음 |
| 2 | 사용법 오류. 기존 root handler의 `Pota error: <msg>`(`pota.mjs:154-156`). 알 수 없는 하위 명령은 `unknown memory command: <x>`, 알 수 없는 옵션은 `unknown option: <x>` |

**오류 코드(exit 1)와 메시지(영문 고정)**

| code | 조건 | message |
| --- | --- | --- |
| `index-missing` | 디렉터리에 파일이 있는데 루트 인덱스가 없음 | `MEMORY.md is missing but docs/memory has N notes; run pota memory index` |
| `unindexed` | 파일에 항목이 없음 | `docs/memory/x.md is not listed in MEMORY.md; run pota memory index` |
| `dead-link` | 항목이 없는 파일을 가리킴(ARCHIVE 포함) | `MEMORY.md line N links docs/memory/x.md, which does not exist; fix the path or delete the line` |
| `duplicate` | 같은 파일이 2줄 이상 | `docs/memory/x.md is listed on lines N, M` |
| `stale-summary` (memory) | 노트 `Summary:`(clip 후)와 인덱스 문구가 다름 | `MEMORY.md line N is older than the Summary line of docs/memory/x.md; run pota memory index` |
| `unsafe-name` | 위 name 규칙 위반 | `docs/memory/<file> cannot be indexed: rename it without spaces, brackets, or backticks (max 64 characters)` |
| `unsafe-path` | 루트 인덱스·디렉터리가 symlink이거나 일반 파일·디렉터리가 아니거나 인덱스가 262144바이트 초과 | `MEMORY.md is not a regular file inside the repository (symlink, special file, or over 256 KiB); index was not read` |

**경고 코드(`--strict`에서만 실패)**

- `summary-missing`, `summary-too-long`, `entry-too-long`, `root-too-long`, `nested-ignored`, `skipped-non-regular`
- `completed-overflow`: Completed 항목이 20개 초과. 메시지에 `run pota plan index --archive`.
- `legacy-planning-rules`: `## Planning Rules` 섹션이 있음. 메시지에 `rules live in the pota-plan skill; pota plan index --archive moves this section to docs/plan/ARCHIVE.md`.

##### 결정 3. hook 주입

**구조.** I/O는 `pota-index.mjs`의 `hookIndexSnapshot`, 렌더링은 `pota-state-context.mjs`(순수 함수 유지)가 맡는다. `scripts/pota-state.mjs:49-64`에서 state를 읽은 뒤 snapshot을 얻어 `contextResult({ ko, state, event, index })`와 `foreignSessionContextResult({ …, index })`에 넘긴다. 블록은 캡슐 뒤, `Pota CLI:` 줄 앞에 붙인다.

**task 간 인터페이스(snapshot)**

```js
hookIndexSnapshot({ root, memory: "list" | "count" | "none", plans: boolean })   // 절대 throw하지 않음
// → { memory: { count, entries: [{ name, summary|null }], drift: boolean } | null,
//     plans:  { files, active: [name], latest: [name], archive: boolean } | null }
```

- `count`: `docs/memory`의 일반 `*.md` 수(`readdir` 1회).
- `entries`: `MEMORY.md` 순서의 색인 항목(파일이 있는 것) 뒤에 미색인 파일(summary `null`, 이름순). 최대 64개.
- `drift`: 미색인 파일이나 죽은 링크가 있으면 true.
- `plans.files`: `docs/plan`의 일반 `*.md` 수(`ARCHIVE.md`, `README.md` 제외).
- `plans.active`: `## Active Plans` 항목 name. `plans.latest`: `## Completed Plans` 앞 3개. `plans.archive`: `ARCHIVE.md` 존재 여부.
- `count`가 0이면 `memory`는 `null`. plan 파일과 항목이 모두 없으면 `plans`는 `null`.

**상태별 주입**

| 이벤트 / 상태 | 주입 | snapshot 호출 |
| --- | --- | --- |
| SessionStart idle | memory 블록 + plan 블록 | `memory:"list", plans:true` |
| SessionStart active·paused·blocked(소유 session) | memory 블록만 | `memory:"list", plans:false` |
| SessionStart foreign | memory 블록만 | `memory:"list", plans:false` |
| UserPromptSubmit idle | 개수 문장 1개(노트가 1개 이상일 때만) | `memory:"count"` |
| UserPromptSubmit active·paused·blocked·foreign | 없음, 디스크 I/O 없음 | 호출 안 함 |

- foreign에 plan 블록을 싣지 않는 이유: plan name이 드러나면 "goal, plan, task 상세를 노출하지 않는다"는 캡슐 약속(`pota-state-context.mjs:114-115`, `test/token-efficiency.test.mjs:148`)을 어긴다.
- active에 plan 블록을 싣지 않는 이유: 캡슐이 이미 정확한 plan을 지정한다.

**문구**

UPS idle 문장은 `kernelBase` 바로 뒤, idle 정책 앞에 넣는다. `kernelBase` 문장은 바꾸지 않는다(`/^Pota kernel: root MEMORY\.md is optional/`와 `test/goal-state.test.mjs:553`의 `read it when present`를 유지).

- en: ` docs/memory has N notes (index: MEMORY.md); read only those this task needs.` (N=9999일 때 80자, 합계 594 ≤ 620)
- ko: ` docs/memory에 노트 N개가 있습니다(색인: MEMORY.md). 작업에 필요한 것만 읽으세요.` (61자, 합계 385)

memory 블록:

```
Repo memory — docs/memory/<name>.md (index: MEMORY.md); read only what the task needs:
- <name>: <summary>
- <name>
(index out of date: run pota memory index)
```

- ko 머리줄: `저장소 메모리 — docs/memory/<name>.md (색인: MEMORY.md), 작업에 필요한 것만 읽으세요:`
- ko drift 줄: `(색인이 오래됨: pota memory index 실행)`. drift 줄은 `drift`가 true일 때만 붙는다.
- 미색인 항목은 summary 없이 `- <name>`.
- 1단계: 모든 항목이 8줄 이하이고 블록이 640자 이하이면 `- name: summary` 줄로 싣는다(name 32자 clip, 한 줄 84자 clip).
- 2단계(넘칠 때): 이름만 한 줄에 `a, b, c, …`로 640자까지 채우고 남으면 en ` +N more in MEMORY.md`, ko ` 외 N개(MEMORY.md 참조)`를 붙인다.

기본안의 "+N개 축약"만 쓰면 6개 정도만 보이고 나머지의 존재를 모른다. 이름 목록은 같은 예산으로 40개 안팎을 알릴 수 있어 이 방식으로 바꿨다.

plan 블록(idle SessionStart 전용, 한 줄):

- en: `Plans — docs/plan/<name>.md (index: PLAN.md, older: docs/plan/ARCHIVE.md): 44 files; active: a, b; latest completed: x, y, z. Check related plans before planning similar work.`
- ko: `계획 — docs/plan/<name>.md (색인: PLAN.md, 이전 항목: docs/plan/ARCHIVE.md): 파일 44개; 진행 중: a, b; 최근 완료: x, y, z. 비슷한 작업을 계획하기 전에 관련 계획을 확인하세요.`
- `, older: …` 구는 `archive`가 true일 때만 넣는다.
- active와 latest는 각 최대 3개, name 32자 clip.
- 320자를 넘으면 latest 이름을 뒤에서부터 빼고, 그래도 넘으면 active를 개수(`active: 4`)로 바꾼다. 이 저장소 예시는 en 248자, ko 207자다.
- `PLAN.md`를 파싱하지 못하면 `…: 12 files. Check related plans…`만 낸다.

**예산과 기존 테스트 처리**

- 기존 620/700/820/160 테스트는 모두 그대로 둔다(`test/token-efficiency.test.mjs:48,73,197`, `test/state-recovery-hardening.test.mjs:50,83`, `test/goal-dag.test.mjs:256-257`). 이 테스트들의 임시 저장소에는 노트가 없어 출력이 바뀌지 않는다.
- 새 상한(`contextLimits`에 추가): `memoryBlock: 640`, `planBlock: 320`, `memoryLines: 8`, `memoryLine: 84`, `indexName: 32`. SessionStart 증가분은 최대 962자(640 + 320 + 줄바꿈 2)다.
- UPS idle은 노트가 있어도 620 이하다.
- **메모리·계획이 전혀 없는 저장소**는 SessionStart와 UPS 출력이 0.5.0과 바이트 단위로 같다. `init` 직후(템플릿만 있고 항목 0개)도 같다.

**디스크 읽기 실패 처리와 timeout**

- `hookIndexSnapshot`은 전체를 try/catch로 감싸고, 실패하면 해당 부분을 `null`로 둔다. 블록만 빠지고 hook은 성공한다.
- 읽기 전에 `assertNoSymlinkComponents(root, target)`와 `lstat().isFile()`을 확인한다. FIFO나 장치 파일을 열지 않으므로 10초 timeout(`hooks/hooks.json`) 안에서 멈추지 않는다. 크기가 262144바이트를 넘으면 파싱을 건너뛰고 `readdir` 이름만 쓴다.
- `docs`나 `docs/memory`가 symlink이면 블록을 싣지 않는다. 진단은 `check`의 `unsafe-path`가 맡는다.
- 디렉터리 안의 symlink 파일은 `dirent.isFile()`이 false라 세지 않는다.
- hook은 노트 파일 본문을 읽지 않는다. SessionStart는 파일 2개 읽기 + `readdir` 2회, UPS idle은 `readdir` 1회, 그 밖의 UPS는 0회다.
- hook은 아무것도 쓰지 않는다(`test/goal-state.test.mjs:569-570` 유지).
- 블록에 절대 경로를 넣지 않는다(`test/goal-state.test.mjs:1087`, 0.3.0 hotfix 교훈 `docs/plan/release-0.3.0.md:31`).

##### 결정 4. 메모리 승격

강제 수준은 "결정 기록은 의무, 노트 작성은 선택, 누락 시 한 줄 알림"이다. 완료 게이트에는 넣지 않는다.

- **절차.** `goal finish` 전에 goal당 한 번 판단해 계획 Evidence에 아래 둘 중 하나를 남긴다.
  - `Memory promotion: docs/memory/<domain>.md`
  - `Memory promotion: none: <reason>`

  승격 대상: 다음 작업이 다시 찾아야 할 비자명한 제약·불변식, 기각한 대안이 딸린 결정, 반복되는 실패와 해법, 검증 레시피. 대상이 아닌 것: 코드나 테스트가 이미 말하는 것, 이번 작업에만 해당하는 세부, 계획 단계의 재진술.
- **문구 위치.** 바이트 예산 때문에 본문은 `skills/pota-work/verification.md`의 새 절 `## Memory Promotion`에 둔다. `SKILL.md`는 8단계 한 줄만 다음으로 바꾼다(교체 후 8995바이트로 계산됨).
  - `8. Record evidence and the memory promotion decision (\`verification.md\`) in the plan and state before updating \`PLAN.md\`. Workers report only their assigned task.`
- **검토.** `pota-review`는 이 줄의 존재와 `memory check`·`plan check` 통과를 확인한다. `templates/work-plan.md`의 `## Evidence`에 `- Memory promotion: <docs/memory/<domain>.md | none: reason>`을 추가한다.
- **기계적 알림.** `goal finish`와 `goal complete`가 성공했을 때, `planId`가 저장소 안의 일반 파일(512 KiB 이하)이고 그 안에 채워진 `Memory promotion:` 줄이 없으면 stderr에 한 줄을 낸다. exit code와 stdout은 그대로다.
  - `Pota memory: plan <planId> has no "Memory promotion:" line. If this goal produced reusable repository knowledge, write it to docs/memory/<domain>.md and run pota memory index; otherwise record "Memory promotion: none: <reason>" in the plan.`
  - `planId`가 파일이 아니면(테스트의 `plan-status` 등) 조용히 넘어간다. `cancel`에는 내지 않는다.
  - 판정 정규식: `/^\s*(?:[-*]\s*)?Memory promotion\s*:\s*(.*)$/im`. 값이 비었거나 `<…>`이면 `missing`, `none` 또는 `없음`으로 시작하면 `none`, 그 밖은 `note`.
- hook에는 싣지 않는다(UPS 예산).

##### 결정 5. `PLAN.md` 구성

**새 `init` 템플릿(en).** `pota-state-init.mjs`에서 `export const INDEX_TEMPLATES = { memory: { en, ko }, plan: { en, ko } }`로 내보내 `templates/*`와 동일성 테스트를 건다.

```
# PLAN

Index of work plans. Each line locates one plan in `docs/plan/`; details and evidence live in the plan. Planning rules live in the `pota-plan` skill. Maintain with `pota plan index` and `pota plan check`.

## Active Plans

## Completed Plans

Newest first; one line per plan. `pota plan index --archive` moves older entries to `docs/plan/ARCHIVE.md`.
```

```
# MEMORY

Index of repository knowledge. Each line under Domain Knowledge locates one note in `docs/memory/`; the knowledge itself lives in the note. Maintain with `pota memory index` and `pota memory check`.

## Domain Knowledge

## Policy

(기존 Policy 4줄 유지. `## Update Rules`는 스킬과 중복이라 삭제)
```

ko 판은 같은 구조의 한국어 문장이며 제목은 영문 그대로다. 목록 형태의 placeholder 줄은 더 만들지 않는다.

**계약 변경(사유 기록).** `test/lifecycle.test.mjs:181-197`의 Planning Rules 단언 10개를 제거하고 다음으로 바꾼다.

- `plan`과 `planKo`에 `## Planning Rules`가 없다.
- 둘 다 `pota-plan`과 `pota plan index`를 포함한다.
- `plan`은 700자 이하다.
- `memoryKo`의 `/문서, 계획, 메모리 산출물/`은 유지한다.
- 규칙 문구의 보증은 정본인 `skills/pota-plan/planning-rules.md`로 옮긴다(현재 파일에 이미 있어 즉시 통과하는 재배치 단언).
  - `/complexity triage, the selected path, and the Heavy Path signals checked/` (17행)
  - `/Request checkpoint, planning checkpoint, and code checkpoint/` (47행)
  - `/plan artifact, repository goal task roadmap, native UI plan/` (48행)

사유: 규칙이 스킬과 중복이고, 에이전트가 `PLAN.md`를 읽을 때마다 약 3KB를 쓴다.

**완료 항목 규칙**

- 최신이 위, 한 줄 200자 이하. 루트에는 20개(`completedKeep`)만 둔다.
- `pota plan index --archive`가 하는 일:
  - Completed 목록의 21번째 이후 줄을 `docs/plan/ARCHIVE.md` 목록 맨 위로 옮긴다(상대 순서 유지). 링크 대상만 `docs/plan/x.md`에서 `x.md`로 바꾸고 나머지는 원문 그대로다.
  - `## Planning Rules` 섹션 전체를 ARCHIVE 끝의 `## Legacy Planning Rules` 아래로 원문 이동한다.
- ARCHIVE가 없으면 다음 머리말로 만든다.
  - `# Plan Archive` / `Older completed plan entries moved from \`PLAN.md\` by \`pota plan index --archive\`. Newest first.`
- 삭제는 없고 이동만 한다. `--dry-run`으로 미리 볼 수 있다.

**기존 저장소 호환**

- hook과 `check`는 예전 형식에서 마이그레이션 없이 동작한다.
- `init`은 기존 파일을 건드리지 않는다(`writeIfMissing`, `pota-state-init.mjs:124-137`).
- 플래그 없는 `index`는 덧붙이기만 한다.
- 이동은 사용자가 `--archive`를 명시했을 때만 일어난다. 자동 마이그레이션은 없다.
- 예전 형식은 `check`가 경고(exit 0)로만 알린다.

##### 결정 6. 계획 재활용

`pota-plan` 2단계와 5단계 문구를 교체한다(교체 후 8999바이트로 계산됨. 여유가 1바이트뿐이라 다른 편집을 더하면 넘는다).

- 2단계: `2. Read \`MEMORY.md\` and \`PLAN.md\` when present; pick related notes and past plans (\`planning-rules.md\`). A non-trivial …`
- 5단계: `5. Run \`triage-plan\`: read the picked notes and plans and installed model guidance, …`

본문은 `skills/pota-plan/planning-rules.md`의 새 절 `## Reuse Before Planning`에 둔다.

- `MEMORY.md` 항목 중 요청의 모듈·표면·실패와 맞는 노트만 고른다.
- `PLAN.md`(오래된 주제는 `docs/plan/ARCHIVE.md`)에서 같은 모듈을 바꿨거나 같은 종류의 문제를 푼 완료 계획을 최대 3개 골라 목표·설계 결정·증거 절만 읽는다. 검증 명령, 제약, 기각한 접근을 재사용한다.
- 계획의 `## Memory Inputs`에 `Related completed plans:`로 기록하고, 없으면 `none related`라고 쓴다.
- 전부 읽지 않는다.
- 계획 파일을 만들면 Active Plans에 200자 이하 한 줄을 넣거나 `pota plan index`를 실행한다.

위임 프롬프트의 `CONTEXT:`에는 고른 노트 경로를 넣는다(양쪽 `delegation.md`). 서브에이전트가 SessionStart 블록을 받지 못한다는 것은 추론이다(4절 참조).

##### 결정 7. goal 이력

새 모듈 `scripts/pota-goal-history.mjs`. 계획의 write scope에 없으므로 추가해야 한다.

- **위치:** `join(goalStateDirectory(root), "history.jsonl")`. worktree별 파일이라 기존 state lock(`pota-goal-state.mjs:115-118`)이 그대로 보호하고 새 lock이 필요 없다. 집계는 `~/.pota/projects/<repositoryId>/worktrees/*/history.jsonl`을 읽기 전용으로 합친다.
- **기록 시점**
  - (a) `transitionGoal`의 terminal 분기에서 `validateState(next)` 뒤, `rm(path)` 앞, lock 안(`pota-goal-operations.mjs:99-102`). `recordedBy: "transition"`.
  - (b) `startGoal`이 예전 버전이 남긴 terminal 상태를 덮어쓰기 직전(`pota-goal-operations.mjs:44` 통과 후, `writeGoalStateUnlocked` 앞). `recordedBy: "start"`, `endedAt`은 `existing.goal.updatedAt`.
  - worktree 불일치로 지우는 상태(`:38-43`, `:77-89`)는 기록하지 않는다.
- **쓰기 방식:** 파일을 읽어 유효한 줄만 남기고, 같은 `goalId`가 있으면 교체하고, 끝에 추가한 뒤 최근 200개(`GOAL_HISTORY_MAX_RECORDS`)만 유지한다. 임시 파일 + `rename`으로 쓴다. 기록과 `rm` 사이에서 죽어 재시도해도 중복이 생기지 않는다.
- **실패 정책:** 이력 기록 실패는 전이를 막지 않는다. `transitionGoal`과 `finishGoal`에 `onTerminal(record, { historyError })` 콜백을 추가하고(기본 no-op), CLI가 실패 시 stderr에 `Pota warning: goal history was not recorded: <첫 줄>`을 낸다. 결정 4의 알림도 이 콜백으로 낸다.
- **레코드(`schemaVersion: 1`)**

```json
{ "schemaVersion": 1, "goalId": "…", "planId": "…", "title": "<120자 clip>", "status": "completed|cancelled",
  "worktreeId": "…", "createdAt": "…", "endedAt": "…", "durationMs": 0, "revision": 0, "evidencePolicy": "tool-bound",
  "tasks": { "total": 0, "completed": 0, "heavy": 0, "light": 0, "delegated": 0, "design": 0 },
  "receipts": { "total": 0, "tool": 0, "reruns": 0, "byKind": {} },
  "waivers": { "effort": 0, "design": 0 }, "models": {}, "efforts": {},
  "memoryPromotion": "note|none|missing|unknown", "recordedBy": "transition|start" }
```

  - `reruns`는 `goalStats`와 같은 정의다(`pota-goal-operations-evidence.mjs:161-166`).
  - stale 수는 fingerprint 재계산 비용 때문에 넣지 않는다.
  - 절대 경로는 넣지 않는다.
- **goal state schema는 바꾸지 않는다.** `GOAL_STATE_VERSION` 3 유지. `GOAL_STATE_CONTRACT.terminal`에 키를 더하면 `test/state-recovery-hardening.test.mjs:133-138`의 `deepEqual`이 깨지므로 건드리지 않는다.
- **집계 CLI:** `goal stats`는 출력을 그대로 둔다(goal 없으면 `null`). 새 옵션 `goal stats --history [--limit N]`(N은 1~200)을 더한다. `history`는 `booleanOptions`에, `history`와 `limit`은 `allowedOptions.stats`에 추가한다(`pota-goal-cli.mjs:177,235`). lock을 잡지 않고 디렉터리도 만들지 않는다.

```json
{ "schemaVersion": 1, "scope": "repository", "goals": 12, "completed": 10, "cancelled": 2, "skippedLines": 0,
  "window": { "from": "…", "to": "…" },
  "durationMs": { "median": 0, "p90": 0 },
  "tasks": { "total": 0, "median": 0, "heavy": 0, "light": 0, "delegated": 0 },
  "receipts": { "total": 0, "tool": 0, "reruns": 0, "rerunRate": 0.0, "median": 0 },
  "waivers": { "effort": 0, "design": 0 },
  "memoryPromotion": { "note": 0, "none": 0, "missing": 0, "unknown": 0 },
  "trend": { "older": { "goals": 0, "durationMsMedian": 0, "receiptsMedian": 0, "rerunRate": 0.0 }, "newer": { } },
  "recent": [{ "goalId": "", "planId": "", "status": "", "endedAt": "", "durationMs": 0, "tasks": 0, "receipts": 0, "reruns": 0, "memoryPromotion": "" }] }
```

  - 중앙값과 비율은 completed만 대상으로 한다. 짝수 개면 가운데 두 값 평균을 반올림하고, p90은 `sorted[ceil(0.9n)-1]`이다.
  - `rerunRate`는 `reruns / max(1, receipts.total)`를 소수 3자리로 낸다.
  - `trend`는 completed가 4개 미만이면 `null`이고, 그 이상이면 `endedAt` 순으로 반을 나눈다(홀수면 newer가 하나 더 많다). goal 간 효과는 이 값으로 본다.
  - `recent`는 최신순 최대 5개다.
  - 이력이 없으면 `{"schemaVersion":1,"scope":"repository","goals":0}`를 내고 exit 0이다.

##### 결정 8. 감사 잔여

**F6**(`pota-cleanup.mjs`). `pota-safe-fs.mjs`에서 `parseLockRecord`를 export하고, `lockOwnerIsDead(record)`(`hostname`이 같고 `!pidIsAlive(pid)`)를 새로 export해 `isReclaimableLock`(`:177-180`)도 이것을 쓰게 한다.

| 항목 | 내용 | 분류 |
| --- | --- | --- |
| `state.lock` (일반 파일, 4096바이트 이하) | 유효 레코드 + 같은 host + 죽은 pid | known |
| `state.lock` | 유효 레코드 + pid 생존 또는 `EPERM` | unknown, 사유 `live-lock-owner` |
| `state.lock` | 유효 레코드 + 다른 host | unknown, 사유 `foreign-host-lock` |
| `state.lock` | 파싱 불가 또는 크기 초과 | unknown, 사유 `invalid-lock-record` |
| `state.lock.stale.<nonce>.<uuid>` | 유효 레코드이고 `record.nonce === <nonce>` | known |
| `state.lock.stale.*` (`malformed` 포함) | 그 밖 | unknown, 사유 `invalid-lock-record` |
| `state.json`, `tools/` | 기존과 같음 | 기존과 같음 |

- 결과 JSON에 `preservedReasons: { "<name>": "<reason>" }`를 추가한다. 기존 키의 형태는 그대로다.
- `--yes`는 삭제 직전에 내용을 다시 읽어 같은 판정인지 확인한다.
- malformed quarantine은 나이와 무관하게 보존한다. 감사 로드맵의 "conservative F6 stale-file preservation"(`.omo/ulw-research/20260901-101319/completion-audit-0.2.7.md:50`)을 따른 것이다.

**F10.** 실행 중 stderr 경고는 넣지 않는다(스킬이 매번 `--criteria`를 넘기므로 잡음이 된다). 고지는 세 곳에 둔다.

- `pota goal --help` 둘째 줄: `Note: --criteria (completionCriteria) is advisory and is not enforced; completion is gated only by required evidence.`
- `templates/work-plan.md:16`: `- Completion criteria (advisory text; Pota does not enforce it — completion is gated only by required evidence):`
- README 8개 locale: 토큰 `completionCriteria`와 `advisory`를 영문 그대로 포함한 문장.

**F11**

- (a) `init`(`pota.mjs:33-37`): `parseRootArgs` 뒤 남은 인자를 본다.
  - `--help` 하나면 `Usage: pota init [--root PATH]`를 내고 exit 0, 파일 변경 없음.
  - `--version` 하나면 `pota <version>`, exit 0.
  - 그 밖은 `Pota error: unknown option: <x>`, exit 2, 파일 변경 없음.
- (b) `cleanup`(`pota-cleanup.mjs:57-67`): main을 try/catch로 감싼다.
  - `--help`는 `Usage: pota cleanup [--root PATH] [--check | --yes]`, exit 0. `--version`은 `pota <version>`, exit 0.
  - 사용법 오류(알 수 없는 옵션, `--root` 값 없음, 중복)는 `Pota cleanup error: unknown option: --bogus` 형식, exit 2.
  - 실행 오류(symlink root, 디렉터리 아님, 상태 JSON 오류)는 `Pota cleanup error: <msg>` 한 줄, exit 1. 스택 트레이스는 없다.
- (c) `goal`/`task`(`pota-goal-cli.mjs`, `pota-goal.mjs`):
  - `--` 앞에 `--help`가 있으면(하위 명령이 있어도) usage 2줄을 stdout에 내고 exit 0, 상태를 읽거나 쓰지 않는다. `pota goal`(인자 없음)과 `pota goal help`도 같다.
  - usage 첫 줄: `Usage: pota goal <start|status|ready|stats|task|replan|claim|assign|receipt|verify|finish|pause|resume|block|cancel|complete> [options] [--root PATH]`
  - `--version`은 `pota <version>`, exit 0. 둘을 함께 주면 `--help and --version cannot be used together` 오류다.
  - `--` 뒤의 `--help`는 passthrough라 건드리지 않는다.
  - 알 수 없는 하위 명령은 `Pota goal error: unknown goal command: <x> (run pota goal --help)`, exit 1.

**exit 규약(확정)**

| 표면 | 0 | 1 | 2 |
| --- | --- | --- | --- |
| root / `init` / `memory` / `plan` | 성공, help, version | check 실패(`memory`/`plan`만) | 사용법 오류와 그 밖의 예외 |
| `cleanup` | 성공, help, version | 실행 오류 | 사용법 오류 |
| `goal` / `task` | 성공, help, version | 모든 오류 | 사용 안 함 |
| `toolcheck` | 변경 없음 | 변경 없음 | 변경 없음 |

`goal` 오류를 전부 exit 1로 두는 근거: 기존 테스트는 `notEqual(status, 0)`만 고정하고(`test/verification-contracts.test.mjs:364-375`), 구현은 1이다(`pota-goal.mjs:64`). 바꿀 이유가 없다.

**기대가 바뀌는 기존 테스트**

1. `test/cleanup-hardening.test.mjs:171-188`: fixture를 유효한 죽은 owner 레코드로 바꾼다(`{schemaVersion:1,pid:99999999,hostname:hostname(),nonce,acquiredAt}`, 선례 `test/verification-contracts.test.mjs:47-49`). malformed quarantine은 보존 기대로 분리한다.
2. `test/goal-state.test.mjs:628-644`: `state.lock` fixture만 유효한 죽은 owner 레코드로 바꾼다. 기대값은 그대로다.
3. `test/lifecycle.test.mjs:181-197`: 결정 5의 계약 변경.

그 밖의 cleanup symlink·비디렉터리 테스트는 `notEqual 0`과 stderr 정규식만 보므로 그대로 통과한다.

#### 2. task별 테스트 계약과 write scope 수정

**write scope 정정 요약(계획 대비)**

| task | 추가 | 제거 또는 비고 |
| --- | --- | --- |
| `index-core` | `test/lifecycle.test.mjs` | `package.json`은 변경 불필요(`files`의 `scripts/*.mjs`가 포함, `test/contract-parity.test.mjs:19`) |
| `goal-history` | `scripts/pota-goal-history.mjs` | — |
| `audit-residual` | `test/goal-state.test.mjs`(628-644 fixture만) | `scripts/pota-lifecycle.mjs` 제거(이미 trailing 인자를 거부함, `pota-lifecycle.mjs:91-96`) |
| `hook-context` | — | `test/token-efficiency.test.mjs`는 수정하지 않음(예산 유지) |
| `policy-surfaces` | — | 정책 문구 테스트는 `test/contract-parity.test.mjs`와 `test/docs-package-hardening.test.mjs`에 둔다. `.claude/commands/*.md`는 locator 포인터라 변경 없음. `.claude/agents/*.md`는 `agents/*.md`와 함께 고친다 |
| `dogfood` | `test/repo-index.test.mjs` | 의존에 `hook-context`를 명시(표면 확인이 session-start 출력) |

task 간 겹침은 없다. `scripts/pota.mjs`는 `index-core` → `audit-residual`, `scripts/pota-goal-cli.mjs`와 `pota-goal.mjs`는 `goal-history` → `audit-residual` 순서로 계획의 의존이 이미 직렬화한다. `pota.mjs`의 `messages`(8 locale의 memory·plan 안내문에 영문 상수 `memoryIndexPolicy`, `planIndexPolicy` 추가)는 `index-core`가 맡는다.

새 CLI 테스트는 모두 env에 `LC_ALL: "en_US.UTF-8"`과 임시 `POTA_HOME`을 명시한다.

##### `index-core`

수정 파일: `scripts/pota-index.mjs`(신규), `scripts/pota.mjs`, `scripts/pota-state-init.mjs`, `test/index.test.mjs`(신규), `test/lifecycle.test.mjs`.

불변식:

- `index` 2회차는 `changed: false`이고 파일이 바이트 단위로 같다.
- 관리 대상 줄 밖은 바이트 단위로 보존된다.
- 죽은 링크를 지우지 않는다.
- `hookIndexSnapshot`은 throw하지 않고 쓰지 않는다.
- symlink를 따라가지 않는다.

`test/index.test.mjs`에 먼저 실패해야 하는 케이스:

1. `parseIndexEntries accepts link, backtick, and bare path forms and ignores placeholders and code fences`
2. `extractNoteSummary prefers the Summary line, then Scope paragraph, then title`
3. `memory check reports unindexed, dead-link, duplicate, and stale-summary with exit 1`
4. `memory check passes a legacy MEMORY.md whose notes are all linked and only warns`
5. `memory index adds missing notes, refreshes changed Summary lines, and preserves the Policy section byte-for-byte`
6. `memory index keeps a hand-written summary when the note has no Summary line`
7. `memory index removes only exact Pota placeholder lines`
8. `memory index is idempotent and --dry-run writes nothing`
9. `memory index creates MEMORY.md from the locale template when notes exist without an index`
10. `plan index places unindexed plans by checkbox status and reports the placement`
11. `plan index --archive moves entries beyond 20 and the legacy Planning Rules section verbatim to docs/plan/ARCHIVE.md`
12. `plan index without --archive never moves or deletes existing lines`
13. `plan check treats ARCHIVE.md entries as indexed and reports completed-overflow and legacy-planning-rules as warnings; --strict fails`
14. `index and check reject symlinked index files, symlinked docs directories, oversized indexes, and unsafe names`
15. `summary and entry limits: 120/121-character summary, 200/201-character line, 64/65-character name`
16. `hookIndexSnapshot returns null parts for missing, unreadable, symlinked, or special-file inputs and never writes`
17. `hookIndexSnapshot lists indexed entries in index order, then unindexed files, and flags drift`
18. `pota memory and pota plan without a subcommand keep printing guidance; unknown subcommands and options exit 2`
19. `init templates are short indexes without Planning Rules in en and ko`

`test/lifecycle.test.mjs` 수정은 결정 5와 같다.

##### `goal-history`

수정 파일: `scripts/pota-goal-history.mjs`(신규), `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-operations-evidence.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-goal.mjs`, `test/goal-history.test.mjs`(신규). `scripts/pota-goal-state.mjs`는 필요할 때만.

불변식:

- 이력 실패가 전이를 막지 않는다.
- 플래그 없는 `goal stats` 출력은 그대로다.
- idle hook과 `stats --history`는 `~/.pota`에 디렉터리를 만들지 않는다(`test/goal-state.test.mjs:861-866`).
- 파일은 200개를 넘지 않는다.

`test/goal-history.test.mjs` 케이스:

1. `completing a goal appends one history record inside the state lock before state deletion`
2. `cancelling a goal records status cancelled`
3. `starting over a persisted legacy terminal state records it once with recordedBy start`
4. `a retried terminal transition replaces the record for the same goalId`
5. `history keeps the newest 200 records`
6. `invalid history lines are skipped and counted, never fatal`
7. `a history write failure does not block completion and surfaces a warning on stderr` (history 경로를 디렉터리로 만들어 유발)
8. `goal stats without --history is unchanged and prints null when no goal exists`
9. `goal stats --history aggregates across worktree directories of the same repository`
10. `goal stats --history reports medians, rerunRate, memoryPromotion counts, and trend only from four completed goals`
11. `goal stats --history with no history prints goals 0 and creates no state directory`
12. `--limit accepts 1..200 and rejects 0, 201, and non-integers`
13. `goal finish prints the memory promotion reminder only when the plan file lacks a filled Memory promotion line`
14. `memoryPromotion is unknown and silent when planId is not a repository file`
15. `stale-worktree state removal records no history`

##### `audit-residual`

수정 파일: `scripts/pota-cleanup.mjs`, `scripts/pota-safe-fs.mjs`, `scripts/pota.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-goal.mjs`, `test/cleanup-hardening.test.mjs`, `test/cli-contract-hardening.test.mjs`, `test/goal-state.test.mjs`.

`test/cleanup-hardening.test.mjs`:

1. (수정) `cleanup removes known legacy entries with their owned filesystem types` — 유효 레코드 fixture로 변경
2. `cleanup preserves lock files whose content is not a valid lock record`
3. `cleanup preserves a state.lock held by a live owner in dry-run and --yes`
4. `cleanup preserves a foreign-host lock and reports preservedReasons`
5. `cleanup removes a quarantined lock only when its name nonce matches the record`
6. `cleanup --help and --version exit 0 without inspecting the repository`
7. `cleanup usage errors exit 2 and runtime errors exit 1 as one-line messages without stack traces`

`test/cli-contract-hardening.test.mjs`:

1. `init --help and --version exit 0 and create no files`
2. `init rejects unknown options with exit 2 and creates no files`
3. `goal and task --help print usage with the advisory criteria notice and exit 0 without reading state`
4. `goal --version prints the package version`
5. `bare goal prints usage and exits 0`
6. `--help after -- is passed through to goal verify`
7. `unknown goal subcommands exit 1 with a one-line error`

##### `hook-context`

수정 파일: `scripts/pota-state-context.mjs`, `scripts/pota-state.mjs`, `test/index-context.test.mjs`(신규).

`test/index-context.test.mjs`:

1. `SessionStart and UserPromptSubmit are byte-identical to the baseline when the repository has no notes or plans` (빈 root와 `init` 직후 root 모두, en/ko)
2. `idle SessionStart lists memory notes with summaries and a plan line, before the Pota CLI line`
3. `the memory block degrades to a names-only line past 8 entries or 640 characters and reports the remainder` (노트 50개 × 요약 500자)
4. `the plan block stays within 320 characters by dropping latest names, then active names` (계획 200개, 긴 이름)
5. `unindexed notes appear by name and add the out-of-date hint`
6. `active, paused, and blocked SessionStart add only the memory block` (같은 상태의 노트 없는 출력과 차이가 641자 이하)
7. `foreign SessionStart adds the memory block but never plan names` (`docs/plan/secret-owner.md`를 Active에 색인해 두고 검사)
8. `idle UserPromptSubmit adds one count sentence and stays within 620 characters for 9999 notes (en and ko)`
9. `active, paused, blocked, and foreign UserPromptSubmit are unchanged by notes`
10. `index capsules contain no absolute repository path and are deterministic`
11. `symlinked MEMORY.md, symlinked docs/memory, a FIFO named MEMORY.md, and an oversized index yield the baseline capsule` (FIFO는 win32에서 skip, 5초 안에 반환)
12. `hooks create no files in the repository or Pota home`

##### `policy-surfaces`

수정 파일:

- `skills/pota-memory/SKILL.md`, `skills/pota-plan/SKILL.md`, `skills/pota-plan/planning-rules.md`, `skills/pota-plan/delegation.md`
- `skills/pota-work/SKILL.md`, `skills/pota-work/verification.md`, `skills/pota-work/delegation.md`, `skills/pota-review/SKILL.md`
- `commands/pota-{memory,plan,work,review}.md`와 `.agents/workflows/`의 같은 4개
- `agents/{explorer,worker}.md`와 `.claude/agents/`의 같은 2개
- `templates/MEMORY.md`, `templates/PLAN.md`, `templates/domain-memory.md`, `templates/work-plan.md`
- `.codex-plugin/plugin.json`, README 8개
- `test/contract-parity.test.mjs`, `test/docs-package-hardening.test.mjs`

제약:

- SKILL.md 9000바이트. 위 교체 문구만 쓰면 plan 8999, work 8995.
- `defaultPrompt`는 7줄, 1600자 이하(현재 1015자). 0번 줄에만 `(it indexes docs/memory notes; PLAN.md indexes docs/plan plans — open only the entries the task needs)`를 넣는다. `/root MEMORY\.md.*when it exists.*continue without repository memory/i`를 유지해야 한다.
- 미러 문서에 `templates/…`, `node scripts/…`, `commands/pota-…` 같은 상대 참조를 넣지 않는다(`test/installed-plugin.test.mjs:229-236`). 명령은 `memory index --root <repoRoot>` 식으로 쓴다.
- `templates/domain-memory.md`는 H1 아래에 `Summary: <one line, at most 120 characters: what this note answers and when to read it>`를 추가한다.

`test/contract-parity.test.mjs`:

1. `templates/MEMORY.md and templates/PLAN.md equal the English init templates`
2. `memory surfaces require a Summary line and pota memory index/check` (skill, command, workflow)
3. `plan surfaces require reuse of related notes and completed plans and the PLAN.md one-line entry`
4. `work and review surfaces require the Memory promotion decision and forbid forced notes` (`/none: <reason>/`, `/do not create a note/i`)
5. `delegation prompts carry the selected memory note paths`
6. `agents and their Claude mirrors point to MEMORY.md entries for relevant notes`
7. `work plan template declares advisory completion criteria, Related completed plans, and Memory promotion`

`test/docs-package-hardening.test.mjs`:

1. `all readmes document the memory and plan index commands, ARCHIVE.md, goal stats --history, and advisory completionCriteria`
2. `the README cleanup entry states that only valid dead-owner lock records are removed` (en, ko)

기존 `test/token-efficiency.test.mjs` 전체는 수정 없이 통과해야 한다.

##### `dogfood`

수정 파일: `MEMORY.md`, `PLAN.md`, `docs/memory/*.md`(6개), `docs/plan/ARCHIVE.md`(신규), `test/repo-index.test.mjs`(신규).

절차:

1. 노트 6개를 쓴다(`Summary:` 포함, 한국어).
2. `node scripts/pota.mjs memory index --root .`
3. `node scripts/pota.mjs plan index --archive --root .` — 완료 42개 중 22개와 `## Planning Rules`(`PLAN.md:58-70`)가 원문 그대로 ARCHIVE로 가고, `PLAN.md:19`의 placeholder가 제거된다.
4. 남은 20줄을 200자 이하로 손으로 줄인다.
5. `MEMORY.md`의 `## Update Rules`를 삭제한다. `## Policy`는 `dev` 브랜치 규칙을 포함해 유지한다.

`docs/plan/token-efficient-reliable-harness.md`는 건드리지 않는다(`test/token-efficiency.test.mjs:468-469`).

`test/repo-index.test.mjs`: `this repository's MEMORY.md and PLAN.md pass strict index checks`.

수용 기준: `memory check --strict`와 `plan check --strict`가 exit 0이다.

표면 확인: `POTA_HOME=<scratchpad 임시 경로> node scripts/pota-state.mjs session-start`에 `{"cwd":"<repo>","session_id":"dogfood"}`를 stdin으로 준다. 설치본 0.5.0 hook은 새 블록을 내지 않으므로 반드시 source checkout 스크립트로 확인해야 하고, 임시 `POTA_HOME`을 쓰면 실제 `~/.pota`를 건드리지 않는다.

#### 3. `dogfood` 노트 제안(6개)

| name | 다룰 사실 | 출처 계획 |
| --- | --- | --- |
| `hook-context` | 캡슐 예산(UPS idle 620, active 700, 병렬 820과 줄 160, paused/blocked SessionStart 620, 새 블록 640/320). SessionStart는 세션당 1회이고 UPS는 누적된다는 것. 캡슐에 저장소 절대 경로 금지(0.3.0에서 637자로 넘친 사고). foreign 캡슐은 goal 정보를 숨긴다. PostToolUse는 goal/task/session당 1회 | `fix-token-methodology-review-findings.md`, `pota-overhead-reduction.md`, `release-0.3.0.md`, `goal-task-roadmap-context.md`, `clean-uninstall-prompt-cache-resilience.md` |
| `goal-state` | 상태 위치(`~/.pota/projects/<repo>/worktrees/<wt>/`). worktree 결속과 stale 제거. terminal은 삭제 후 이력으로 남는다. tool-bound 증거와 fingerprint(`PLAN.md`, `docs/plan`, `docs/memory` 제외). goal 증거가 task 재검증을 대체하는 규칙. lock 회수 조건. completionCriteria는 advisory | `installed-runtime-goal-completion.md`, `harness-reliability-remediation.md`, `pota-overhead-reduction.md` |
| `lifecycle-install` | install/upgrade/uninstall transaction과 ownership manifest. 공유 `config.toml` merge surface. Claude plugin과 hook 등록(`${PLUGIN_ROOT}` vs `${CLAUDE_PLUGIN_ROOT}`). 미러와 runtime locator. 설치 cache에서 upgrade 금지 | `harness-reliability-remediation.md`, `upgrade-shared-config-ownership.md`, `clean-uninstall-prompt-cache-resilience.md`, `installed-runtime-goal-completion.md` |
| `policy-surfaces` | 정책 문구를 바꿀 때 함께 고치는 표면 지도(skills + 참조 파일, `commands`, `.agents/workflows`, `.claude/commands`는 포인터, `agents`와 `.claude/agents`, `templates`, `defaultPrompt` 7줄 1600자, `pota.mjs` 8 locale, README 8개). SKILL.md 9000바이트 상한과 현재 여유. 미러 상대 참조 금지 테스트 | `pota-overhead-reduction.md`, `fix-token-methodology-review-findings.md`, `release-0.1.11-locale-artifacts.md`, `pota-orchestrator-worker-execution-policy.md` |
| `delegation-model-routing` | 4-tier 모델과 host별 strongest 값. effort 라우팅(Light medium, Heavy high, 최종 xhigh). host option 전달 의무와 Effective 판정. 실제 모델 ID 기록. 설계 task strongest 게이트와 waiver 2종. 모델이나 effort를 바꾸면 새 dispatch | `per-task-model-routing.md`, `dispatch-effort-enforcement.md`, `heavy-design-model-routing.md`, `delegation-model-identity-rules.md`, `path-reasoning-effort-routing.md` |
| `release-process` | 기능 브랜치 → `dev` → `main` PR(exact head CI 후 head 고정 병합). clean detached worktree에서 pack 1회, 같은 tarball로 publish. registry digest 대조와 격리 설치 검증. 로컬 `pota upgrade`와 `doctor`. 버전 표면(`package.json`, `.codex-plugin/plugin.json`, 테스트 5개 파일). `npm pack --dry-run`은 prepack이 check를 실행한다. Windows + Node current의 lifecycle lock 타이밍 플레이크 | `release-0.5.0.md`, `release-0.4.1.md`, `release-0.3.0.md`, `release-0.2.5.md`, `pota-verification-infrastructure.md` |

제외한 것:

- 0.1.x 정책 계획들(subagent close, fallback, terminology 등)은 현재 스킬 문구가 정본이라 노트로 옮길 것이 없다.
- 개별 릴리스의 PR 번호나 digest는 계획 파일에 두면 충분하다.

#### 4. 위험과 미해결 사항

**사실**

- SKILL.md 여유가 교체 후 1바이트(plan), 5바이트(work)다. `policy-surfaces`에서 다른 문구를 더하면 `test/token-efficiency.test.mjs:353`이 실패한다. 추가 문구는 참조 파일에만 넣어야 한다.
- 구현 중 hook은 설치본 0.5.0이 계속 낸다. 새 주입은 릴리스와 upgrade 뒤에야 실제 세션에 보인다. 버전 변경과 릴리스는 이 goal 범위 밖이며, 버전을 올리면 테스트 5개 파일의 `0.5.0` 고정값을 같이 바꿔야 한다.
- `test/cli-contract-hardening.test.mjs:32`는 locale env를 고정하지 않아 `LANG=ko_KR`인 셸에서는 usage 비교가 깨진다(현재 셸은 `LANG`이 비어 en-US). 새 테스트는 `LC_ALL`을 고정한다. 기존 테스트 수정은 범위 밖이다.
- `pota install --help`는 지금도 exit 1이다(`pota-lifecycle.mjs:95`). Audit Residual의 3건에 없어 손대지 않았다.

**추론·가정**

- 서브에이전트가 SessionStart 주입을 받지 못한다는 것은 추론이다(저장소에 SubagentStart hook이 없고 `hooks/hooks.json`에 5개 이벤트만 있다). 그래서 위임 프롬프트에 노트 경로를 싣도록 했다.
- Codex·Antigravity의 SessionStart 출력 크기 제한과 압축 후 재실행 여부는 저장소 증거로 확인하지 못했다. 최대 약 1.8천 자라 문제없을 것으로 가정했다.
- `--archive`는 Completed 목록이 최신순이라고 가정한다. 이 저장소는 최신순이지만(`PLAN.md:15-56`), 오래된 순으로 쌓은 사용자 저장소에서는 최신 항목이 ARCHIVE로 간다. 명시 플래그, `--dry-run`, 무삭제 이동으로 피해를 한정했고 README에 순서 규약을 적는다. 순서 자동 판별은 넣지 않았다.
- 이력 집계의 "저장소" 단위는 `repositoryId`(git common dir 해시, `pota-paths.mjs:14-16`)다. git이 아닌 디렉터리나 저장소를 옮긴 경우 이력이 갈린다.
- 예전 terminal 상태 파일이 실제로 남아 있는 사용자가 얼마나 되는지는 모른다. 7(b) 경로는 저비용 안전망이다.

**미해결(구현 중 판단 불필요, 기록만)**

- malformed quarantine 파일은 `cleanup`으로 지울 수 없게 된다. 사용자가 `preservedReasons`를 보고 수동 삭제한다. 의도한 보수적 동작이다.
- `index`끼리 동시에 실행하면 마지막 쓰기가 이긴다. 저장소 파일에는 lock을 두지 않았다.
- `Memory promotion:` 키와 `none` 값은 영문 고정이다(`없음`만 추가 허용). 다른 표현은 `note`로 집계된다.

##### Critical Files for Implementation

- `/Users/wknam/workspace/pota-harness/scripts/pota-state-context.mjs`
- `/Users/wknam/workspace/pota-harness/scripts/pota-state.mjs`
- `/Users/wknam/workspace/pota-harness/scripts/pota.mjs`
- `/Users/wknam/workspace/pota-harness/scripts/pota-goal-operations.mjs`
- `/Users/wknam/workspace/pota-harness/scripts/pota-cleanup.mjs`

함께 볼 파일: `/Users/wknam/workspace/pota-harness/scripts/pota-state-init.mjs`, `/Users/wknam/workspace/pota-harness/scripts/pota-goal-cli.mjs`, `/Users/wknam/workspace/pota-harness/scripts/pota-safe-fs.mjs`, `/Users/wknam/workspace/pota-harness/test/lifecycle.test.mjs`, `/Users/wknam/workspace/pota-harness/test/goal-state.test.mjs`, `/Users/wknam/workspace/pota-harness/skills/pota-plan/planning-rules.md`, `/Users/wknam/workspace/pota-harness/skills/pota-work/verification.md`.

## Evidence

- Tool readiness: `pota toolcheck` 실행, node/npm OK.
- `triage-plan`: `planArtifact`·`triageDecision` 기록. main이 inline으로 수행(effort host option 미적용, waiver 기록).
- `heavy-design`: Requested/Effective model `fable (claude-fable-5-2)`, effort `high`(host option). `designRecord` 기록.
- `goal-history`: Requested/Effective model `opus (claude-opus-5-5)`, effort `high`(host option).
  - Tests: `node --test test/goal-history.test.mjs test/goal-state.test.mjs test/goal-dag.test.mjs test/goal-effort.test.mjs` 통과(83개, 실패 0). 이 한 번의 실행으로 `moduleAcceptance`·`surfaceIntegration`을 기록.
  - 구현 중 정한 해석: `--limit`은 `--history`와 함께만 허용, 중앙값·비율·trend는 completed goal만 대상, 메모리 승격 알림은 completed이고 `Memory promotion:` 줄이 없을 때만 stderr로 출력.
- `index-core`: Requested/Effective model `opus (claude-opus-5-5)`, effort `high`(host option).
  - Tests: `node --test test/index.test.mjs test/lifecycle.test.mjs test/cli-contract-hardening.test.mjs` 통과(exit 0). 이 한 번의 실행으로 `moduleAcceptance`·`surfaceIntegration`을 기록.
  - 계약 변경: `test/lifecycle.test.mjs`의 `init` Planning Rules 단언을 `## Heavy Design` 결정 5대로 교체.
  - `dogfood`가 알아야 할 점: 이 저장소에서 `plan index --archive --dry-run`은 21개 항목을 옮긴다(설계 예상 22개는 placeholder 1줄을 항목으로 센 것). `docs/plan/release-0.2.7.md`는 `PLAN.md`에 없어 Active Plans에 추가되므로 Completed로 옮겨야 한다.
  - 구현 중 정한 해석: `MEMORY.md`가 symlink·특수 파일·크기 초과이면 snapshot의 `memory`는 `null`(설계의 "readdir 이름만 사용" 대신 baseline 캡슐 유지). 생성하는 인덱스 줄은 200자 이하로 clip.
- `hook-context`: Requested/Effective model `opus (claude-opus-5-5)`, effort `high`(host option).
  - Tests: `node --test test/index-context.test.mjs test/token-efficiency.test.mjs test/goal-state.test.mjs test/installed-plugin.test.mjs` 통과(exit 0). 이 한 번의 실행으로 `moduleAcceptance`·`surfaceIntegration`을 기록. 기존 620/700자 예산 테스트는 수정하지 않았다.
  - 관찰: 노트 3개·계획 5개인 임시 저장소에서 idle SessionStart는 en 924자·ko 792자, idle UserPromptSubmit은 en 591자·ko 382자.
  - 남은 사소한 점: 노트가 1개일 때 en 문구가 `1 notes`가 된다(설계 문구 그대로). plan 블록의 "active를 개수로 축약" 단계는 이름 clip 때문에 실제로 도달하지 않는다.
- `audit-residual`: Requested/Effective model `opus (claude-opus-5-5)`, effort `high`(host option).
  - Tests: `node --test test/cleanup-hardening.test.mjs test/cli-contract-hardening.test.mjs test/lifecycle.test.mjs test/goal-state.test.mjs test/state-recovery-hardening.test.mjs` 통과(exit 0). 이 한 번의 실행으로 `moduleAcceptance`·`surfaceIntegration`을 기록.
  - 계약 변경: `test/cleanup-hardening.test.mjs`와 `test/goal-state.test.mjs`의 lock fixture를 유효한 죽은 owner 레코드로 교체(`## Heavy Design` 결정 8).
  - 구현 중 정한 해석: `cleanup --check --yes` 동시 사용은 사용법 오류(exit 2)로 거부(이전에는 삭제를 실행). 4096바이트 상한은 `state.lock.stale.*`에도 적용.
  - 같은 규칙 훑기 결과(수정하지 않음): 이름만 보고 lock을 지우는 다른 경로는 없다. `node scripts/pota-state.mjs init --help`를 직접 실행하면 여전히 초기화한다(내부 hook 스크립트, 공개 CLI `pota init`은 수정됨). `pota install --help`는 변경 없이 exit 1이다(설계에서 범위 밖으로 기록).
- `policy-surfaces`: Requested/Effective model `opus (claude-opus-5-5)`, effort `high`(host option).
  - Tests: `node --test test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/token-efficiency.test.mjs test/lifecycle.test.mjs test/installed-plugin.test.mjs` 통과(exit 0). 이 한 번의 실행으로 `moduleAcceptance`·`surfaceIntegration`을 기록.
  - worker의 1차 surface 검증에서 1건 실패 후 수정: `defaultPrompt` 삽입 문구가 `test/lifecycle.test.mjs:360`의 정규식 사이에 끼어 있었고, 위치를 `first when it exists` 뒤로 옮겨 2차에 통과.
  - 바이트 예산: `skills/pota-plan/SKILL.md` 8999, `skills/pota-work/SKILL.md` 8962(상한 9000). `defaultPrompt` 7줄 1118자(상한 1600).
  - cleanup F6 문장은 `README.md`와 `README.ko.md`에만 넣었다(설계 테스트 계약이 en·ko만 요구).
- `dogfood`: Requested/Effective model `opus (claude-opus-5-5)`, effort `high`(host option).
  - Tests: `node --test test/repo-index.test.mjs` 통과(`moduleAcceptance`). source checkout의 `scripts/pota-state.mjs session-start`를 임시 `POTA_HOME`으로 실행해 캡슐에 노트 6개 이름, `docs/plan/ARCHIVE.md`, 진행 중 계획 이름이 있고 저장소 절대 경로가 없음을 확인(`surfaceIntegration`).
  - 결과: `docs/memory` 노트 6개, `PLAN.md` 70줄 → 36줄, 완료 항목 22개와 `## Planning Rules`를 `docs/plan/ARCHIVE.md`로 원문 이동, `memory check --strict`·`plan check --strict` exit 0.
  - 관찰: hook의 노트 줄은 84자에서 잘려 summary 뒷부분이 보이지 않는다. `Summary:`는 핵심을 앞에 쓴다(노트 `hook-context`의 Policy에 기록).
- Memory promotion: docs/memory/hook-context.md, docs/memory/goal-state.md, docs/memory/lifecycle-install.md, docs/memory/policy-surfaces.md (이번 goal에서 바뀐 동작을 `dogfood` task가 노트에 반영)
- 독립 리뷰(`opus (claude-opus-5-5)`, effort `xhigh`, 읽기 전용): 전체 `node --test` 294개 통과를 확인했고 결함 9건을 보고했다. `review-fixes` task를 `goal replan`으로 추가해 수정한다.
  - H1: `memory index`/`check`가 `## Domain Knowledge` 밖의 목록 줄을 항목으로 보고 덮어쓰거나 `duplicate`로 판정한다(보존 불변식 위반).
  - M1: 4-backtick 펜스나 닫히지 않은 펜스에서 `index`가 멱등이 아니고 섹션을 중복 추가한다.
  - M2: `plan index --archive`가 loose list 항목의 첫 줄만 옮긴다.
  - M3: 저장소 텍스트의 제어문자·줄 구분자가 SessionStart 캡슐에 그대로 들어간다(프롬프트 주입 표면).
  - L1: `ARCHIVE.md`의 임의 상대 링크가 plan 항목으로 인식된다. L2: `## Legacy Planning Rules` 아래 제목 중복. L5: 노트 사실 오류 2건.
  - 수정하지 않고 잔여 위험으로 남기는 것: L3(이력 재기록이 `schemaVersion` 1이 아닌 줄을 버린다. 현재 버전은 1뿐이라 영향 없음), L4(`cleanup --yes`의 재판정과 삭제 사이 경쟁 창. 현재 Pota는 `<repo>/.pota/state.lock`을 쓰지 않아 예전 버전과 동시에 돌 때만 해당).
  - 리뷰가 문제 없다고 확인한 것: 노트·계획 없는 저장소의 hook 출력이 HEAD와 동일(120건), 무작위 20000건에서 예산 초과 없음, foreign 캡슐에 plan 이름 없음, `PLAN.md` 재구성에서 누락·중복 없음, 테스트 약화 없음.
- `review-fixes`: Requested/Effective model `opus (claude-opus-5-5)`, effort `high`(host option).
  - Tests: `node --test test/index.test.mjs test/index-context.test.mjs test/repo-index.test.mjs test/token-efficiency.test.mjs test/lifecycle.test.mjs test/installed-plugin.test.mjs` 통과(exit 0). worker의 전체 `node --test`는 302개 통과.
  - 설계(결정 1)에서 바뀐 계약: 인덱스 항목은 인덱스 섹션(memory는 `## Domain Knowledge`, plan은 제목이 `Plans`로 끝나는 섹션) 안의 목록 줄만 인정하고 그 밖의 참조는 "언급"으로 보며, summary 갱신은 참조 뒤 부분만 바꾼다. `ARCHIVE.md`의 상대 링크는 첫 `## ` 앞에서만 항목이다. `--archive`는 Planning Rules 본문만 옮긴다. 새 오류 코드 `control-character`(check), `unclosed-fence`(index).
  - 계약 변경: 기존 archive 테스트의 기대값에서 중복 제목 2줄만 제거(L2). 본문 원문 검증은 유지.
  - 하지 않은 것: en `1 notes` 문구는 `test/index-context.test.mjs`가 고정하고 있어 그대로 두었다.
  - 잔여 위험: `## Domain Knowledge`가 없는 예전 `MEMORY.md`에 `index`가 섹션을 덧붙이면 그 전의 항목들은 언급으로 취급돼 hook에 summary가 나오지 않는다(내용은 보존).
- `doc-sync`: Requested/Effective model `opus (claude-opus-5-5)`, effort `high`(host option).
  - Tests: `node --test test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/token-efficiency.test.mjs test/lifecycle.test.mjs test/installed-plugin.test.mjs test/repo-index.test.mjs` 통과(exit 0).
  - README 8개, `skills/pota-memory/SKILL.md`, `commands/pota-memory.md`와 미러, `skills/pota-plan/planning-rules.md`를 `review-fixes` 뒤의 실제 동작에 맞췄다.
- `verify`: 독립 리뷰는 `opus (claude-opus-5-5)`, effort `xhigh`(host option). 리뷰 뒤 수정분은 `review-fixes`·`doc-sync`의 focused test로 검증했고 두 번째 독립 리뷰는 하지 않았다.
  - Tests: `npm pack --dry-run`(prepack이 `npm run check` 실행)으로 task 증거를 기록하고, `goal finish -- npm run check`로 `finalReview`를 기록한다. 결과는 goal 이력과 최종 보고에 남긴다.
- Dry-run or check: 외부 상태 변경 없음. 커밋·푸시·버전 변경·npm publish는 이 goal 범위가 아니다.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
