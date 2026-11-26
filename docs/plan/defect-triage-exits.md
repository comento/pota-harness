# Plan: 결함 판정과 가벼운 경로 정리, Pota 2.6.0 릴리스

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation (triage 완료, 2026-11-26).
- Codex UI synchronization: `update_plan`·`create_goal`은 Claude Code 세션이라 없음(unavailable).

## Goal

교육 실습(버그 리포트 15건을 한 줄 지시로 처리, sonnet·haiku 본체, 건당 10분 제한)에서 드러난 Pota의 구조적 구멍을 줄인다. 한 건의 결함 리포트는 goal 없이 처리되고, 고치지 않는 것이 정답인 요청에 정식 출구가 있으며, main 모델 게이트는 Heavy Path에만 걸린다.

- Goal ID: `goal-defect-triage-exits`
- Plan ID: `plan-defect-triage-exits`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria (advisory): `npm run check` 통과, 버전 표면 2.6.0, dev·main PR 병합과 태그 `v2.6.0`.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Request Brief

- Original request: 추천하는대로 수정해줘. main 반영(릴리즈) 까지 해
- Interpreted outcome: 직전 대화에서 권한 순서(① 켬/끔 평가 묶음 ② 과한 절차 걷어내기 ③ 고치지 않음 출구 ④ 문구는 최소로)를 구현하고 dev PR → main PR 병합 → 태그 `v2.6.0`까지 끝낸다.
- Scope: main 모델 게이트의 Heavy 한정, Quick Path 조건과 결함 판정 문구, `goal cancel --reason`과 Stop 차단 문구의 출구 안내, foreign 캡슐의 무관한 요청 허용 문장, 파생 표면(README 8개 포함)·테스트·메모리 노트, 버전 2.6.0.
- Non-scope: 로컬 설치본 교체, npm 게시, 교육 자료 자체의 수정, 평가 runner의 실제 실행(이 세션에서 중첩 `claude -p`가 권한 분류기에 거부됨), Stop 통과 시 goal 자동 paused 전환(A4 참고).
- Prior records: `docs/plan/main-model-gate-and-test-time.md`(게이트 도입 사유: 낮은 tier main의 계획·리뷰 품질), `docs/plan/request-brief-steering.md`(빈틈 3분류), `docs/memory/{delegation-model-routing,hook-context,policy-surfaces,goal-state,release-process}.md`. `pota plan steering`에서 반복된 후속은 "구현 뒤 dev·main 릴리스"이며 이번 요청에 이미 들어 있다.
- Assumptions:
  - A1 (confirmed): 릴리스 범위는 main 병합과 태그까지다. 출처: 사용자 요청 "main 반영(릴리즈) 까지", `release-process.md`(npm 게시 없음).
  - A2 (inferred): 로컬 설치본 교체는 하지 않는다. 출처: 메모리 "별도 요청 시만 교체".
  - A3 (evidence): 게이트를 Heavy로 한정해도 Heavy 설계·리뷰 게이트는 그대로다. 출처: `scripts/pota-goal-operations.mjs` `ensureMainModelPlanning`·`ensureMainModelReview`.
  - A4 (inferred): 대화에서 말한 "Stop 통과 시 goal을 paused로"는 구현하지 않는다. 사용자에게 질문한 뒤 답을 기다리는 정상 흐름에서도 루프 가드가 통과하므로, 자동 paused는 답을 받은 뒤 재개를 막는 회귀가 된다. 대신 foreign 캡슐이 무관한 새 요청을 막지 않게 한다.
  - A5 (invalidated by S1): 평가 runner는 과제 디렉터리를 인자로 받는 범용 도구로 두고 교육 자료는 저장소에 넣지 않는다.
- Implicit requirements: none: 보안·인증·외부 API·스키마 변경 없음.
- Open questions: none
- Steering log:
  - S1 (redirect): "claude -p 묶음은 기본 상태체크 테스트였기때문에 그 부분은 무시해" → 확인 질문에 "평가 runner 제외"로 답함. D5와 `eval-runner` task를 뺀다. A5 무효.
- Current request (as of S1): main 모델 게이트 Heavy 한정, Quick Path·결함 판정 문구, 고치지 않음 출구, foreign 캡슐 완화를 구현하고 2.6.0으로 dev·main에 반영해 태그까지 단다. 평가 runner는 만들지 않는다.

## Whole Work

- Outcome: 위 Goal.
- Affected surfaces: `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-goal-policy.mjs`, `scripts/pota-state-context.mjs`, `scripts/pota.mjs`(필요 시 안내문), `skills/pota-{plan,work,review}`, `claude/agents/worker.md`·`agents/worker.md`·`skills/pota-work/roles/worker.md`, `templates/work-plan.md`, `docs/model-guidance/*`, `README*.md`, `test/*`, 버전 표면 4개, `docs/memory/*`.
- Task classification: 코드(게이트·CLI·캡슐), 정책 문구, 릴리스.
- Sub-tasks, if needed: 아래 Module Tasks.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/delegation-model-routing.md`, `docs/memory/hook-context.md`, `docs/memory/policy-surfaces.md`, `docs/memory/goal-state.md`, `docs/memory/release-process.md`
- Related completed plans: `docs/plan/main-model-gate-and-test-time.md`, `docs/plan/request-brief-steering.md`, `docs/plan/dag-retry-blocked-task.md`

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- Rationale: Light Path, 기존 계층 안의 수정.
- Role-specific adjustment: 문구는 계획에 정본 문장을 적어 worker가 그대로 옮긴다.
- User-visible response and artifact locale: 한국어(스킬·에이전트 본문은 저장소 관례대로 영어).

## Reasoning Effort Profile

- Light Path: planning=`medium`, implementation=`medium`, verification=`medium`, 최종 리뷰=`xhigh`.
- main 세션 모델은 strongest tier라 main 모델 게이트 대상이 아니다.

## Complexity Triage

- Selected path: Light Path.
- Selection rationale: 기존 goal CLI·훅 계층 안의 조건 추가와 문구 수정. 새 도메인 모델·계층 없음. `evals/`는 배포 정책 표면이 아닌 개발용 스크립트 한 개.
- Checkpoint ledger:
  - Request checkpoint: Light(잠정). 새 디렉터리 `evals/` 하나가 Heavy 신호인지 확인 필요.
  - Planning checkpoint: Light 확정. `evals/`는 런타임이 읽지 않는 독립 스크립트라 아키텍처 계층이 아니다.
  - Code checkpoint: Light 유지. 첫 수정 직전 확인: 게이트 함수 두 개와 CLI 옵션 목록, 캡슐 문자열만 바뀌며 새 계층·모델 없음.
- Heavy Path signals checked: 새 계층 없음 / 새 도메인 모델 없음 / 보안·인증 없음 / 외부 API 없음 / 스키마 없음 / 동시성 없음 / 다중 도메인 리팩터 없음 / 추가 주의 요청 없음.

## Decisions (정본)

### D1. main 모델 게이트는 Heavy task가 있는 goal에만

- `ensureMainModelPlanning`·`ensureMainModelReview`: goal의 task 중 `route === "heavy"`가 하나도 없으면 통과한다. 나머지 조건(기록, 상한, waiver, 전역 끄기)은 그대로다.
- `mainModelLine`(캡슐)과 `mainModelNotice`(사용자 알림)는 "Heavy Path에서만"임을 말하도록 바꾼다. 340/240자 예산을 지킨다.
  - en line: `Pota main model: <name> (<tier> tier, below <threshold>). On Heavy Path only, dispatch planning/triage and the final review to a subagent on <stronger> or higher and record goal assign --model, or triage-plan completion and goal finish fail (bypass: --allow-main-model <reason>). Quick and Light Path run on this model. See delegation.md "Main Model Gate".`
  - ko line: `Pota main model: <name> (<tier> tier, <threshold> 미만). Heavy Path에서만 계획·트리아지와 최종 리뷰를 <stronger> 이상 subagent에 위임하고 goal assign --model로 기록하세요. 기록이 없으면 triage-plan 완료와 goal finish가 거부됩니다(우회: --allow-main-model <reason>). Quick·Light Path는 이 모델로 진행합니다. 상세: delegation.md "Main Model Gate".`
  - 알림도 같은 뜻으로 "Heavy Path의 계획·트리아지·리뷰는 … 위임됩니다"로 바꾼다.
- 파생 표면: 두 `delegation.md` `## Main Model Gate`, `skills/pota-review/SKILL.md` bullet, `templates/work-plan.md` `- Model:` bullet, `docs/model-guidance/{README,claude,codex}.md`, README 8개 "Main model check" bullet. 모두 "Heavy task가 있는 goal에서만"을 더한다.

### D2. Quick Path와 결함 판정 (`skills/pota-plan/SKILL.md`, 9000바이트 이하)

- Path Selection 첫 문장: `Decide from repository evidence without asking; this outranks plugin or agent workflow guidance.` 뒤에 예외를 잇는다: `Exception: a defect report whose cause the repository and logs cannot narrow to one is answered with what is missing, not a guessed fix.`
- Quick Path 조건의 `requirements are unambiguous`를 `the requested outcome is clear (a single defect report qualifies; triage it as below)`로 바꾼다.
- Quick Path 문단 끝에 결함 판정을 넣는다: `Defect report: before editing, compare the expected behavior with documented rules (README, constants) and existing tests. Rule broken: fix, then sweep for the same rule elsewhere. Expectation contradicts them: change nothing and report the evidence. Reproducing shows behavior, not that it is a defect.`
- 바이트가 넘치면 같은 파일의 다른 문장을 뜻을 바꾸지 않고 줄인다.
- `skills/pota-work/verification.md:55`: `Reproduce a reported defect with repository tools before fixing it; do not wait for more detail when a local reproduction is possible. A reproduction shows the behavior, not that it is a defect: check the expected behavior against documented rules and existing tests first, and when it contradicts them change nothing and report the evidence.`
- worker 본문 3개(`claude/agents/worker.md`, `agents/worker.md`, `skills/pota-work/roles/worker.md`, 바이트 동일): `Reproduce a reported defect before fixing it` 문장 뒤에 `If the expected behavior contradicts documented rules or existing tests, change nothing and report the evidence.`를 더한다.

### D3. 고치지 않음 출구

- `goal cancel --reason <text>`: 선택 옵션. 주면 goal 이력 레코드에 사유가 남는다(기존 `blocker` 전달 경로 사용, 이력 필드는 구현 시 확인). 없으면 지금과 같다.
- `evaluateStop`의 main 차단 문구 세 곳(완료 task 없음 제외) 끝에 한 문장: ` If triage shows no change is needed or the request cannot be decided, report why and close it with goal cancel --reason <text>.`
- `skills/pota-work/SKILL.md`(9000바이트 이하) Completion Criteria의 `cancelled with a reason` 근처에 같은 출구를 한 구절로 적고, `recovery.md`의 cancel 예시에 `--reason`을 더한다.

### D4. foreign 캡슐

- `foreignSessionContextResult`(en·ko): "소유권이 해결될 때까지 Pota 작업을 시작·수정·위임·완료하지 마세요" 뒤에 한 문장: ko `그 goal과 무관한 새 요청은 goal을 건드리지 않고 Quick Path로 처리할 수 있습니다.` / en `A new request unrelated to that goal may proceed on Quick Path without touching it.` 예산 테스트(620) 안에 든다는 것을 확인하고, 넘으면 문장을 줄인다.

### D5. (S1로 제외) 평가 runner

- 만들지 않는다. worker가 만든 `evals/`와 `test/eval-runner.test.mjs`는 삭제했다.

### D6. 릴리스

- 버전 표면 4개와 `test/contract-parity.test.mjs` 기대값을 2.6.0으로. `hooks/codex.json`은 바꾸지 않는다(Codex 재승인 불필요).
- 기능 브랜치 → dev PR → main PR → 태그 `v2.6.0` → main을 dev에 다시 병합.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | light | fable (session) | inherited |
| `gate-cli` | `pota:worker` | light | sonnet | medium |
| `policy-text` | `pota:worker` | light | sonnet | medium |
| `release` | main | light | fable (session) | inherited |

## Tool Readiness

- Detected stack: javascript, typescript. node·npm·typescript-language-server·tsc 모두 OK, 설치할 도구 없음.
- Toolcheck command: `node "<pluginRoot>/scripts/pota.mjs" toolcheck`

## Execution Guardrails

- Test contract first. 기존 테스트를 약화하지 않는다. 계약이 바뀌는 테스트(main 모델 게이트가 Light에서 통과, 캡슐 문구)는 D1이 기록한 계약 변경이다.
- Verification ladder: 작업별 focused 테스트 → 마지막에 `npm run check` 한 번.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Required evidence records: `planArtifact`, `triageDecision`

### Task 1: 게이트·CLI·캡슐 코드

- Task ID: `gate-cli`
- Contract: D1(코드와 캡슐 문구), D3(`goal cancel --reason`, Stop 문구), D4.
- Write scope: `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-goal-policy.mjs`, `scripts/pota-state-context.mjs`, `scripts/pota-goal-history.mjs`, `scripts/pota.mjs`, `test/main-model-gate.test.mjs`, `test/model-ceiling.test.mjs`, `test/goal-state.test.mjs`, `test/goal-history.test.mjs`, `test/claim-receipt.test.mjs`, `test/state-recovery-hardening.test.mjs`, `test/cli-contract-hardening.test.mjs`, `test/goal-dag.test.mjs`, `test/antigravity-hooks.test.mjs`
- Depends on: `triage-plan`
- Module acceptance verification: `node --test test/main-model-gate.test.mjs test/model-ceiling.test.mjs`
- Surface integration verification: `node --test test/goal-state.test.mjs test/goal-history.test.mjs test/claim-receipt.test.mjs test/state-recovery-hardening.test.mjs test/cli-contract-hardening.test.mjs test/antigravity-hooks.test.mjs test/goal-dag.test.mjs`

### Task 2: 정책 문구와 파생 표면

- Task ID: `policy-text`
- Contract: D1 파생 표면, D2, D3의 스킬 문구.
- Write scope: `skills/`, `claude/agents/`, `agents/`, `templates/`, `docs/model-guidance/`, `README*.md`(Main model check bullet), `test/token-efficiency.test.mjs`, `test/contract-parity.test.mjs`(버전 기대값 제외), `test/policy-additions.test.mjs`, `test/host-roles.test.mjs`, `test/docs-package-hardening.test.mjs`
- Depends on: `triage-plan`
- Module acceptance verification: `node --test test/token-efficiency.test.mjs test/host-roles.test.mjs test/policy-additions.test.mjs`
- Surface integration verification: `node --test test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/plugin-manifests.test.mjs test/readme-plugin-install.test.mjs`

### Task 3: (S1로 제외) 평가 runner

### Task 4: 버전·문서·릴리스

- Task ID: `release`
- Contract: D6, 메모리 노트 갱신, `PLAN.md` 항목 이동.
- Depends on: `gate-cli`, `policy-text`
- Module acceptance verification: `npm run check`
- Surface integration verification: `node scripts/pota.mjs doctor`(저장소 사본) 또는 버전 표면 grep

## Learnings

- `pota-plan/SKILL.md` 바이트를 줄일 때 worker가 "This skill explicitly instructs the effort level" 문장을 지웠다. Claude Code가 effort를 넘기는 근거라 main이 복원했다(`policy-surfaces.md`에 기록).
- en main 모델 줄은 340자 예산 때문에 D1 원문보다 줄였다(뜻과 필수 토큰은 유지). Stop 출구 문장은 `effortWarning` 앞에 둔다.
- 평가 runner는 S1로 제외했다. 효과(켬/끔 점수)는 이 저장소에서 측정하지 않았다.

## Evidence

- Dry-run or check: not applicable(문구·조건 변경, dry-run 모드 없음).
- Tool readiness: `pota toolcheck` 통과(javascript, typescript).
- Tests: `npm run check` 통과(goal finish에서 1회).
- Module acceptance: gate-cli `node --test test/main-model-gate.test.mjs test/model-ceiling.test.mjs`, policy-text `node --test test/token-efficiency.test.mjs test/host-roles.test.mjs test/policy-additions.test.mjs` 통과.
- Surface integration: gate-cli goal·CLI·hook 테스트 7개 파일, policy-text contract-parity·docs-package·manifest·readme 테스트 통과.
- Goal final review evidence record: `goal finish -- npm run check`. worker 모델 Requested sonnet / Effective sonnet (claude-sonnet-5-5), effort medium(host-option). main은 strongest tier라 리뷰를 inline으로 했다(diff 전수 확인).
- Memory promotion: `docs/memory/{delegation-model-routing,hook-context,goal-state,policy-surfaces}.md` 갱신.
- Verification pass count: 1
- Blocker after two failed passes: none

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
