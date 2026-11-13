# Plan: Pota 오버헤드 축소

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation after planned triage (코드 탐색 후 같은 턴에서 확정).
- Codex UI synchronization: Codex `update_plan`/`create_goal` 없음(Claude Code 데스크톱). 앱 task list로 동일 순서를 표시합니다.

## Goal

실사용 분석에서 Pota 몫으로 추정된 비용(증거 재실행, CLI 시행착오, 무거운 절차 문서, 반복 hook 주입, 잦은 왕복)을 줄이면서 fail-closed 증거 보장을 유지합니다.

- Goal ID: runtime 발급
- Plan ID: `docs/plan/pota-overhead-reduction.md`
- Completion criteria: 아래 6개 개선이 구현되고 `npm run check` 전체 통과, package dry-run 통과.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

1. 증거 신선도: task 완료 시점에만 task 증거 신선도를 요구합니다. goal 완료 시에는 모든 task receipt 뒤에 기록된 신선한 goal-scope 증거가 있으면 task 증거의 지문 재확인을 면제합니다. goal requiredEvidence가 비어 있으면 기존처럼 task 지문을 재확인합니다.
2. CLI: `--root` 생략 시 `resolveRepoRoot`(HARNESS_REPO_ROOT, git 루트 탐색)로 결정. 잘못된 scope 오류에 허용값 표시. SessionStart capsule에 절대 경로 CLI 접두어 주입.
3. 왕복 축소: `goal verify --kind a|b`로 한 번 실행해 여러 증거 기록. `goal finish -- <argv>`로 활성 task 완료 + goal requiredEvidence 일괄 verify + goal complete.
4. PostToolUse 리마인더를 goal/task/session당 1회로 제한(guard 파일).
5. 측정: `goal stats`로 verify 실행 수, kind별 수, 재실행 수, 현재 stale 수 출력.
6. 문서: `pota-plan`/`pota-work` SKILL.md를 핵심 계약 위주로 축소하고 상세 절차는 `pota://skills/<name>/*.md` 참조 문서로 분리. 계획·goal 없이 처리하는 Quick Path 기준 추가. 새 CLI 기능 반영.

## Memory Inputs

- `MEMORY.md` (정책만 존재, docs/memory 상세 노트 없음)

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/claude.md` (기존 정책 그대로 적용)
- Rationale: 오케스트레이터가 코드 변경을 직접 수행하고, 파일이 겹치지 않는 문서 축소를 worker 1명에게 위임합니다.
- User-visible response and artifact locale: 한국어.

## Reasoning Effort Profile

- Model: inherited.
- Requested reasoning effort: 문서 worker `medium`; Effective: `inherited` (Agent 도구에 task별 effort 옵션을 사용하지 않음).

## Complexity Triage

- Selected path: Light Path.
- Selection rationale: 기존 모듈(goal CLI, operations, state hook, 문서) 안의 동작 변경입니다. 새 레이어나 도메인 모델은 없습니다.
- Checkpoint ledger:
  - Request checkpoint: Light 잠정. 증거 정책 완화가 보안성 신호인지 검토 필요.
  - Planning checkpoint: Light 확정. 증거 완화는 "신선한 goal 증거가 모든 task 증거 이후"라는 조건으로 fail-closed를 유지합니다. 인증·세션·DB·동시성 변경 없음(guard 파일은 stop-guard와 같은 best-effort 패턴).
  - Code checkpoint: `pota-goal-operations-mutations.mjs`, `pota-goal-cli.mjs`, `pota-goal-operations-evidence.mjs`, `pota-state.mjs`, `pota-state-context.mjs`, `pota-goal-state.mjs` 확인 완료. Light 유지.
- Heavy Path signals checked: 새 디렉터리/레이어 없음, 새 도메인 모델 없음, 보안/인증/세션 없음, 외부 API 없음, DB 스키마 없음(goal state schema 변경 없음), 동시성/트랜잭션 변경 없음(기존 lock 재사용), 교차 도메인 리팩터 없음, 추가 주의 요청 없음.

## Agent Assignments

- `worker`(문서): `skills/*`, `commands/*`, `.claude/commands/*`, `.agents/workflows/*`, `agents/*`, `docs/model-guidance/*`, README의 CLI 설명, 문서 문구를 검사하는 테스트(`test/token-efficiency.test.mjs`의 문서 관련 부분, `test/docs-package-hardening.test.mjs`).
- 오케스트레이터(코드): `scripts/*.mjs`, `test/goal-state.test.mjs`, `test/verification-contracts.test.mjs`, `test/cli-contract-hardening.test.mjs`, hook 관련 테스트.

## Tool Readiness

- Detected stack: Node.js ESM (>=18), `node --test`.
- Toolcheck: 별도 LSP 불필요. `npm run check`가 문법 검사와 전체 테스트를 수행합니다.
- Missing tools: 없음.

## Module Tasks

### Task 0: `triage-plan`
- Required evidence: `planArtifact`, `triageDecision`.

### Task 1: `evidence-freshness`
- Files: `scripts/pota-goal-operations-mutations.mjs`, 테스트.
- Module acceptance: `node --test test/goal-state.test.mjs test/verification-contracts.test.mjs`
- Surface integration: `npm test`

### Task 2: `cli-ergonomics`
- Files: `scripts/pota-goal-cli.mjs`, `scripts/pota-goal-operations-evidence.mjs`, `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-state-validation.mjs`, `scripts/pota-state.mjs`, `scripts/pota-state-context.mjs`, `scripts/pota-goal-state.mjs`, 테스트.
- 범위: root 자동 결정, scope 오류 메시지, multi-kind verify, `goal finish`, `goal stats`, SessionStart CLI 접두어, PostToolUse 1회 리마인더.
- Module acceptance: 관련 focused test
- Surface integration: `npm test`

### Task 3: `docs-slim` (worker)
- Files: 위 문서 범위.
- Module acceptance: `node --test test/token-efficiency.test.mjs test/docs-package-hardening.test.mjs`
- Surface integration: `npm test`

### Task 4: `verify`
- `npm run check`, `npm pack --dry-run`, goal `finalReview`.

## 추가 범위: task DAG와 병렬 위임 (Heavy Path)

사용자 요청(2026-11-06)으로 같은 goal에 추가합니다. `docs-slim` 완료 후 `goal replan`으로 `verify` 뒤에 붙입니다. goal은 취소하거나 새로 시작하지 않습니다.

- 경로: Heavy Path. 근거는 동시 active task(동시성)와 새 추상화(task 의존 그래프)입니다.
- 기준 코드: 사용자가 읽은 GitHub `0b7683e`는 HEAD(`e104992`)의 조상이 아닙니다. 다만 `git diff HEAD 0b7683e` 결과가 비어 있어 트리 내용은 같습니다. 이 위에 토큰 개선 변경을 더한 현재 작업 트리를 기준으로 합니다.
- worktree 분리 확인: goal 상태는 `~/.pota/projects/<repositoryId>/worktrees/<worktreeId>/state.json`에 저장됩니다(`scripts/pota-paths.mjs` `goalStateDirectory`). `worktreeId`는 gitDir 해시이므로 다른 git worktree는 다른 상태를 봅니다. 따라서 병렬 worker는 같은 worktree에서만 실행합니다.
- 토큰 제약(사용자 강조): DAG 도입이 토큰을 크게 늘려서는 안 됩니다. active task가 1개이고 `dependsOn`을 쓰지 않는 goal의 hook 출력은 바이트 단위로 같아야 합니다. 병렬일 때만 active ID/제목을 길이 제한해 한 줄 덧붙이고, 전체 그래프는 넣지 않습니다.
- hook 출력 크기 기준(변경 전, 3-task 표준 goal, 문자 수): en idle UPS 514, ko idle UPS 324, en active UPS 725, en active SessionStart 747, ko active UPS 561, ko active SessionStart 648. 측정 스크립트는 세션 scratchpad의 `hook-size.mjs`입니다.

### 설계

- task 필드: `dependsOn: string[]`, `writeScope: string[] | null`. state schema를 v3로 올립니다.
- 기본값: `dependsOn`을 생략하면 바로 앞 task(목록 순서)에 의존하고, 첫 task는 `[]`입니다. 명시적인 `[]`는 의존성이 없다는 뜻입니다. v1/v2 상태도 같은 규칙으로 마이그레이션합니다.
- 검증(start/replan/validateState): 중복 ID, 없는 ID, 자기 참조, 순환을 거부합니다. replan은 완료된 task를 참조할 수 있습니다.
- `writeScope`: 저장소 상대 경로이며 `..`과 절대 경로는 거부합니다. 같은 경로이거나 디렉터리 접두 관계이면 겹치는 것으로 봅니다.
- ready: 선행 task가 모두 completed인 pending task입니다.
- active 규칙: 선행 task가 모두 completed여야 하고, 동시 active는 최대 4개입니다. active task끼리 `writeScope`가 겹치면 안 되며, `writeScope`가 없는 task는 단독으로만 active가 될 수 있습니다. start와 replan은 모두 pending으로 두고, 순서상 첫 ready task 하나만 자동으로 active로 만듭니다(기존 순차 동작 유지). 병렬 task는 orchestrator가 `goal task --task X --status active`로 엽니다.
- 완료와 차단: active task가 하나도 없을 때만 다음 ready task를 자동으로 active로 만듭니다. blocked task의 하위 task는 pending으로 남습니다. active task와 ready task가 모두 없을 때만 goal이 blocked가 됩니다. skipped 상태는 만들지 않습니다.
- `goal ready`: 읽기 전용입니다. `{"active":[...],"ready":[...],"blocked":[...]}`처럼 ID만 출력합니다.
- `goal verify`: task 범위 검증에서 active가 2개 이상이고 `--watch`가 없으면 명령을 실행하기 전에 거부합니다.
- Stop: 메인 Stop은 active task 전체를 나열합니다(ID와 제목 길이 제한). SubagentStop은 해당 agent에 할당된 미완료 task를 찾아 판단합니다.
- 도입하지 않음: WAL, lease, 자동 재시도, send, fingerprint 기반 부분 재실행.

### 판정 기준 변경 사유(사전 기록)

- `test/goal-state.test.mjs`가 `schemaVersion` 2를 고정하고 있습니다(40행, 165행). 스키마를 v3로 올리므로 기대값을 3으로 바꿉니다. 165행의 v1 마이그레이션 테스트는 v1에서 v3로 가는 결과를 확인하도록 바꿉니다. 그 밖의 테스트는 약화하거나 건너뛰지 않습니다.

### DAG task

1. `dag-tests`: 완료 조건 1~8을 실패하는 테스트로 먼저 고정하고, 실패를 확인합니다.
2. `dag-core`: 스키마 v3, 정규화, 검증, 마이그레이션, ready 계산, 상태 전이, verify 가드, Stop을 구현합니다. 파일은 `scripts/pota-goal-*.mjs`입니다.
3. `dag-hook-cli`: `goal ready` CLI와 병렬 hook 한 줄을 추가하고 크기를 측정합니다. 파일은 `scripts/pota-goal-cli.mjs`, `scripts/pota-state-context.mjs`입니다.
4. `dag-docs`: pota-plan/pota-work 절차를 수정하고 template, commands 미러, defaultPrompt, README를 갱신합니다.
5. `dag-verify`: `npm run check`, `npm pack --dry-run`, 실제 설치본 goal CLI 표면 검증, 최종 리뷰를 수행합니다.

### 구현 기록

- 사전 리뷰(Plan 에이전트 1회, 읽기 전용): 지적 9건을 다음과 같이 반영했습니다.
  - 선행 task 완료 여부는 상태 전이 시점에만 검사합니다. 읽기 시점에는 그래프 검사, 동시 active 상한, writeScope만 검사하므로 마이그레이션된 v2 상태가 막히지 않습니다.
  - replan의 `dependsOn` 기본값은 완료 task와 새 task를 합친 목록 기준으로 계산합니다.
  - 모든 `→active` 전이에서 `assertCanBeActive`를 검사합니다.
  - 완료와 차단 처리 모두 `advanceGoal`로 처리해 데드락을 감지하면 goal을 blocked로 전이합니다.
  - `currentTask`는 ready task를 우선으로 고르고, blocked goal을 resume하면 ready task를 활성화합니다. 이때 goal을 다시 blocked로 만들지는 않습니다.
  - SubagentStop은 해당 agent에 할당된 active task를 판단합니다. stop guard는 scope별로 저장하며, 서브에이전트는 자기 task의 상태와 `updatedAt`을 진행 지표로 씁니다.
  - verify 가드: 다른 task가 active이면 `--watch`를 필수로 하고, 그 경로가 대상 task의 writeScope 안에 있어야 합니다. goal scope 검증은 active가 2개 이상일 때 `--watch`가 필요합니다.
  - writeScope 겹침은 세그먼트 단위, 대소문자 구분 없이 판정합니다. 경로를 정규화하고, glob 문자와 빈 배열은 거부합니다. writeScope는 선언일 뿐 파일시스템에서 강제하지 않습니다.
  - 리뷰어가 제안한 "v2 마이그레이션에서 active/completed task는 `[]`로" 규칙은 채택하지 않았습니다. 사용자 지정 규칙(앞 task 의존)을 유지하고, 위의 읽기 시점 완화로 같은 문제를 해결했습니다.
- 구현 주체: Heavy Path 정책상 worker 위임이 기본입니다. 다만 사용자가 토큰을 늘리지 말라고 강조했습니다. 오케스트레이터는 이미 이 파일들을 읽은 상태라, 새 worker에게 다시 읽히는 비용을 피하려고 코드는 직접 구현했습니다. 문서는 같은 `docs-slim` worker에게 이어서 맡겼습니다.
- 기존 테스트 회귀 3건을 수정했습니다. replan 오류 순서, 단일 blocked task를 resume하면 다시 blocked가 되던 문제, pending task에 할당된 agent까지 막던 SubagentStop입니다. 판정 기준을 바꾼 기존 테스트는 사전에 기록한 `schemaVersion` 2→3뿐입니다.
- hook 크기(변경 후): 모든 측정값이 변경 전과 같습니다(en idle UPS 514, ko idle UPS 324, en active UPS 725, en active SessionStart 747, ko active UPS 561, ko active SessionStart 648). 병렬 줄은 active가 2개 이상일 때만 붙습니다. 테스트에서 이 줄은 160자 이하, 전체는 820자 이하로 제한합니다.

## Evidence

- 토큰 개선 `verify`: `npm pack --dry-run`(prepack `npm run check` 포함) 통과, 증거 2건을 한 번 실행으로 기록했습니다.
- DAG: `node --test` 201/201 통과(신규 `test/goal-dag.test.mjs` 9건 포함).
- `dag-verify`: `npm pack --dry-run`(prepack `npm run check`) 통과. 실제 설치본 표면 검증(tarball 전역 설치 → 임시 git 저장소에서 병렬 활성화, `--watch` 가드, 형제 수정 뒤 증거 유지, join ready, 하위 디렉터리 root 자동 결정, `goal stats`, `goal finish`) 통과.
- Goal final review: `goal finish -- node --test`로 `finalReview`를 기록하고 goal을 `completed`로 전이했습니다. 완료 직전 `goal stats`는 receipt 20건, 재실행 0건이었습니다. 앞선 task 증거 14건은 stale 상태였지만 신선한 goal 증거로 면제됐습니다. 이전 규칙이었다면 해당 검사를 모두 다시 실행해야 했습니다.

## Status

- [x] Planned
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed (DAG 사전 리뷰 반영, worker 결과 검토)
- [x] Goal completed
