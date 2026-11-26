# Plan: 같은 규칙 함께 고치기와 스크립트 활용, Pota 2.6.2 릴리스

## Plan Phase

- Finalized: decision-complete for implementation (문구 변경, 2026-11-26).
- Codex UI synchronization: Claude Code 세션이라 unavailable.

## Goal

결함을 고칠 때 같은 규칙을 어긴 다른 곳을 보고만 하지 않고 함께 고치게 하고, 데이터로 판단할 일은 짧은 스크립트를 만들어 확인하게 한다.

- Completion criteria (advisory): `npm run check` 통과, 2.6.2를 dev·main에 반영, 태그 `v2.6.2`.
- Required goal evidence: `finalReview`

## Request Brief

- Original request: 2.6.2를 만들어야 겠네? 그리고 툴을 써서 빨리 해결할 수 있다면 툴을 만들도록해. 클로드의 코드모드 , omo의 eval 기능이잖아
- Interpreted outcome: 실습 과제 확인에서 드러난 구멍(같은 규칙이 두 파일에 있는 105·113번을 찾고도 고치지 않음)을 문구로 막고, 손으로 읽거나 추측하는 대신 짧은 스크립트로 확인·해결하라는 지침을 더해 2.6.2로 main까지 릴리스한다.
- Scope: `skills/pota-plan/SKILL.md` Quick Path 문장, `skills/pota-work/SKILL.md`, `skills/pota-work/verification.md`, worker 본문 3개, `test/policy-additions.test.mjs`, 버전 표면, `docs/memory/policy-surfaces.md`.
- Non-scope: 훅·CLI 코드 변경, 스크립트 실행기(eval 도구) 자체의 구현, npm 게시.
- Prior records: `docs/plan/defect-triage-exits.md`, `docs/plan/verify-premise.md`.
- Assumptions:
  - A1 (confirmed): 릴리스 포함. 출처: "2.6.2를 만들어야 겠네?".
  - A2 (inferred): "툴을 만들도록"은 에이전트가 작업 중 짧은 스크립트를 써서 돌리라는 지침이며, Pota에 새 실행 도구를 넣으라는 뜻은 아니다. 호스트(Claude Code 등)가 이미 셸·코드 실행을 제공한다. 출처: "클로드의 코드모드 , omo의 eval 기능이잖아".
  - A3 (inferred): 프로젝트 지침이 데이터 출처를 특정 도구로 제한하면 그 제한을 우회하지 않는다(실습 `CLAUDE.md`의 운영 로그 규칙과 같은 경우). 출처: 실습 확인에서 106·107번이 그 제한으로 멈춘 것은 맞는 동작이었다.
- Implicit requirements: none: 문구 변경만 있다.
- Open questions: none
- Steering log:
- Current request (as of S0): 같은 규칙을 어긴 곳을 함께 고치고, 데이터로 판단할 일은 스크립트로 확인하도록 문구를 바꿔 2.6.2로 릴리스한다.

## Complexity Triage

- Selected path: Light Path(문구 변경이지만 릴리스가 있어 goal을 둔다).
- Checkpoint ledger: Request Light / Planning Light / Code Light. Heavy 신호 없음.

## Agent Assignments

- 바이트 예산(9000 중 8994)을 맞춰야 해 main이 직접 고쳤다(worker 위임 없음, main takeover 기록).

## Tool Readiness

- Detected stack: javascript, typescript. `pota toolcheck` 통과(같은 세션).

## Module Tasks

### Task 0: `triage-plan`

- Required evidence records: `planArtifact`, `triageDecision`

### Task 1: `sweep-script-text`

- Module acceptance verification: `node --test test/policy-additions.test.mjs test/host-roles.test.mjs test/token-efficiency.test.mjs`
- Surface integration verification: `node --test test/contract-parity.test.mjs test/plugin-manifests.test.mjs`

## Learnings

- 실습 과제 15건을 서브에이전트로 재현했을 때 Pota 2.6.1과 하네스 없는 조건이 둘 다 11/15였다. 틀린 건은 같은 규칙 두 곳(105·113)과 로그가 필요한 건(106·107)이었다.
- `pota-plan/SKILL.md`의 DAG 문장("Antigravity and Codex/ChatGPT Desktop … skip on Claude Code")은 `test/token-efficiency.test.mjs`가 고정한다. 줄일 때 건드리지 않는다.

## Evidence

- Tests: `npm run check`(goal finish에서 1회).
- Memory promotion: `docs/memory/policy-surfaces.md` 결함 판정 항목 갱신.

## Status

- [x] Planned
- [x] Implemented
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
