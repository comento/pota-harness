# Plan: 결함 판정을 프롬프트 캡슐에 싣기와 도구 만들기, Pota 2.6.3 릴리스

## Plan Phase

- Finalized: decision-complete for implementation (캡슐 문구 1줄과 예산, 문구 변경, 2026-11-26).
- Codex UI synchronization: Claude Code 세션이라 unavailable.

## Goal

결함 판정 규칙(문서화된 규칙과 어긋나거나 원인이 확인되지 않으면 바꾸지 않고 보고)이 `pota-plan` 스킬을 읽지 않는 작은 수정에도 닿게 하고, 반복해서 쓸 조회나 없는 지정 도구는 만들어 쓰게 한다.

- Completion criteria (advisory): `npm run check` 통과, 2.6.3을 dev·main에 반영, 태그 `v2.6.3`.
- Required goal evidence: `finalReview`

## Request Brief

- Original request: 진행해 / 근데 툴은 왜 안만들지?
- Interpreted outcome: 2.6.2 재확인에서 드러난 약점(규칙을 바꾸자는 리포트를 결함처럼 고침, 원인 미확인인데 추정으로 고침)을 막고, 도구를 만들지 않고 멈추거나 일회용으로 끝내는 문구를 보강해 2.6.3으로 main까지 릴리스한다.
- Scope: `scripts/pota-state-context.mjs` idle UserPromptSubmit 문장(en·ko), idle 캡슐 예산 테스트 3곳, `skills/pota-work/verification.md`, worker 본문 3개, `test/policy-additions.test.mjs`, 버전 표면, `docs/memory/hook-context.md`·`policy-surfaces.md`.
- Non-scope: `skills/pota-plan/SKILL.md`(바이트 예산 6 남음, 문구 유지), active·paused 캡슐, 스크립트 실행기 구현, npm 게시.
- Prior records: `docs/plan/same-rule-fix-and-scripts.md`, `docs/plan/verify-premise.md`, `docs/plan/defect-triage-exits.md`.
- Assumptions:
  - A1 (confirmed): 릴리스 포함. 출처: 제안 "문구에 보강해 2.6.3으로 내는 것을 권합니다. 진행할까요?"에 대한 "진행해".
  - A2 (inferred): 제안했던 "스킬 문구 보강" 대신 캡슐에 싣는다. 출처: 기준 실행에서 104를 틀린 5회는 모두 `pota-plan` 스킬을 읽지 않았고 맞은 2회는 읽었다. 스킬 문구를 더 고쳐도 읽지 않으면 닿지 않는다.
  - A3 (inferred): "툴은 왜 안만들지?"는 2.6.2의 A2(일회용 스크립트만)가 요청보다 약했다는 지적이다. 다시 쓸 조회와 없는 지정 도구는 만들게 하되, 프로젝트 지침이 도구 제작을 금지하면 따른다. 출처: 원 요청 "툴을 써서 빨리 해결할 수 있다면 툴을 만들도록해".
- Implicit requirements: idle UserPromptSubmit 캡슐 예산 620 → 820(계약 변경). 사유: 판정 문장 약 180자를 매 요청에 싣는다. active(700)·paused(620) 예산은 그대로다.
- Open questions: none
- Steering log:
- Current request (as of S0): 결함 판정 한 줄을 idle 프롬프트 캡슐에 싣고 도구 만들기 문구를 보강해 2.6.3으로 릴리스한다.

## Complexity Triage

- Selected path: Light Path(훅 문구 1줄과 예산 상수, 문구 변경. 새 계층·모델 없음).
- Checkpoint ledger: Request Light / Planning Light / Code Light. Heavy 신호 없음.

## Agent Assignments

- 변경이 문장 몇 개와 테스트 상수라 main이 직접 고친다(worker 위임 없음, main takeover 기록).

## Tool Readiness

- Detected stack: javascript, typescript. `pota toolcheck` 통과(같은 세션).

## Module Tasks

### Task 0: `triage-plan`

- Required evidence records: `planArtifact`, `triageDecision`

### Task 1: `capsule-triage-tool-text`

- Module acceptance verification: `node --test test/index-context.test.mjs test/token-efficiency.test.mjs test/antigravity-hooks.test.mjs test/policy-additions.test.mjs test/host-roles.test.mjs`
- Surface integration verification: `node --test test/contract-parity.test.mjs test/plugin-manifests.test.mjs`

## Learnings

- 2.6.2 재확인(서브에이전트 재현): 15건 12/15(2.6.1은 11/15). 105·113이 맞음으로 바뀌었다.
- 104(규칙을 바꾸자는 리포트)는 2.6.1에서 4회 중 1회, 2.6.2에서 4회 중 2회 맞았다. 틀린 5회는 모두 `pota-plan` 스킬을 읽지 않았고 맞은 실행은 읽었다. 판정 문구가 스킬 안에만 있으면 작은 수정에는 닿지 않는다.
- 106(로그 없이는 원인 미확인)은 두 버전 모두 절반 이상이 추정으로 고쳤다.
- 2.6.3 문구로 다시 돌린 결과: 15건 13/15(틀린 2건은 로그 도구가 필요한 106·107). 104는 4회 모두 고치지 않고 규칙 변경을 결정 사항으로 보고했고, 106은 4회 모두 추정 수정 없이 멈췄다.
- 지켜볼 점: 2.6.3 실행 21회 중 5회가 실습 `CLAUDE.md`의 "이름을 말한 파일만" 규칙을 작업 폴더 전체에 적용해 코드를 읽지 않았다(이전 실행에서는 없던 모습). 점수에는 영향이 없었지만 캡슐 문장이 지나친 조심을 부르는지 실제 세션에서 확인이 필요하다.
- 재현은 sonnet 서브에이전트에 세션 입력을 재현한 것이라 실시간 훅은 검증하지 못했다.

## Evidence

- Tests: `npm run check`(goal finish에서 1회).
- Memory promotion: `docs/memory/hook-context.md` 예산 표, `docs/memory/policy-surfaces.md`.

## Status

- [x] Planned
- [x] Implemented
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
