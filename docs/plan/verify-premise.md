# Plan: 지시의 사실 전제 확인, Pota 2.6.1 릴리스

## Plan Phase

- Finalized: decision-complete for implementation (문구 4곳, 2026-11-26).
- Codex UI synchronization: Claude Code 세션이라 unavailable.

## Goal

결함 리포트뿐 아니라 사람의 지시에 담긴 사실 전제도 규칙·테스트·로그·실제 데이터로 확인한 뒤 움직이게 한다.

- Completion criteria (advisory): `npm run check` 통과, 2.6.1을 dev·main에 반영, 태그 `v2.6.1`.
- Required goal evidence: `finalReview`

## Request Brief

- Original request: 그렇게 해 / 단순 리포트 만이 아니라 사람의 지시도 그럴 수 있어 / 의심하고 데이터로 판단해
- Interpreted outcome: 2.6.0의 결함 판정 문구를 넓혀, 지시에 담긴 사실 주장을 데이터로 확인하고 어긋나면 바꾸지 않고 근거를 보인다. 2.6.1 패치로 main까지 릴리스한다.
- Scope: `skills/pota-plan/SKILL.md` Quick Path 문장, `skills/pota-work/verification.md`, worker 본문 3개, `test/policy-additions.test.mjs`, 버전 표면, `docs/memory/policy-surfaces.md`.
- Non-scope: 코드(훅·CLI) 변경, 로컬 설치본 교체, npm 게시.
- Prior records: `docs/plan/defect-triage-exits.md`(2.6.0 결함 판정 문구).
- Assumptions:
  - A1 (confirmed): 릴리스 포함. 출처: 직전 답변의 "넣으려면 패치 릴리스(2.6.1)가 필요합니다"에 대한 "그렇게 해".
  - A2 (inferred): 의심 대상은 사실 전제이고 사용자의 의도·결정은 아니다. 어긋나면 거부가 아니라 근거를 보이고 사용자가 정한다. 출처: 답변에서 이 범위를 먼저 밝히고 진행.
- Implicit requirements: none: 문구 변경만 있고 보안·외부 API·스키마 영향 없음.
- Open questions: none
- Steering log:
- Current request (as of S0): 지시의 사실 전제도 데이터로 확인하도록 문구를 넓히고 2.6.1로 릴리스한다.

## Complexity Triage

- Selected path: Light Path(문구 변경이지만 릴리스가 있어 goal을 둔다).
- Checkpoint ledger: Request Light / Planning Light / Code Light. Heavy 신호 없음.

## Agent Assignments

- 문장 4곳은 바이트 예산(9000 중 8994)을 맞춰야 해 main이 직접 고쳤다(worker 위임 없음, main takeover 기록).

## Tool Readiness

- Detected stack: javascript, typescript. `pota toolcheck` 통과(2.6.0 작업과 같은 세션).

## Module Tasks

### Task 0: `triage-plan`

- Required evidence records: `planArtifact`, `triageDecision`

### Task 1: `premise-text`

- Module acceptance verification: `node --test test/policy-additions.test.mjs test/host-roles.test.mjs test/token-efficiency.test.mjs`
- Surface integration verification: `node --test test/contract-parity.test.mjs test/plugin-manifests.test.mjs`

## Learnings

## Evidence

- Tests: `npm run check`(goal finish에서 1회).
- Memory promotion: `docs/memory/policy-surfaces.md` 결함 판정 항목 갱신.

## Status

- [x] Planned
- [x] Implemented
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
