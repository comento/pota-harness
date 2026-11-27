# Plan: 요청한 끝 지점까지 가기와 닫기 규칙, Pota 2.6.4 릴리스

## Plan Phase

- Finalized: decision-complete for implementation (문구·템플릿·게이트 라벨 1개·캡슐 문장, 2026-11-27).
- Codex UI synchronization: Claude Code 세션이라 unavailable.

## Goal

요청이 말한 끝 지점(커밋·머지·태그·배포·로컬 반영)에 닿기 전에 goal이 끝나거나 턴이 멈추지 않게 하고, 과거 프롬프트에서 반복된 지시(동반 문서 닫기, 증거를 사용자에게 보이기, 정정의 규칙화)를 하네스 규칙으로 옮긴다.

- Completion criteria (advisory): `npm run check` 통과, 2.6.4가 dev·main에 병합, 태그 `v2.6.4`, 로컬 설치본 2.6.4.
- Required goal evidence: `finalReview`

## Request Brief

- Original request: 전부 다 구현해 릴리스, 로컬 반영까지 다해줘
- Interpreted outcome: 직전 분석 보고의 접목 지점 6개(끝 지점 task, `End state` 칸, 대기 규칙, 닫기 점검, 보고에 증거 첨부, 정정의 규칙화 제안)를 모두 구현해 2.6.4로 main까지 릴리스하고 로컬 설치본을 갱신한다.
- End state: main 병합 + 태그 `v2.6.4` + main을 dev에 병합 + 로컬 설치본 2.6.4 (npm 게시 없음)
- Scope: `templates/work-plan.md`, `skills/pota-plan/{SKILL,request-brief,planning-rules}.md`, `skills/pota-work/{SKILL,verification}.md`, `skills/pota-review/SKILL.md`, `scripts/pota-goal-steering.mjs`(게이트 라벨), `scripts/pota-goal-policy.mjs`(Stop 문구), `scripts/pota-state-context.mjs`(idle 문장), 관련 테스트, 버전 표면, `docs/memory` 노트.
- Non-scope: `endState` 증거를 요구하는 새 CLI 명령·새 상태 필드, active·paused 캡슐, worker 본문, README, npm 게시.
- Prior records: `docs/plan/triage-in-capsule.md`(캡슐에 실어야 닿는다, 예산 변경 절차), `docs/plan/defect-triage-exits.md`(Stop 문구에 안내를 싣는 방식), `docs/memory/{policy-surfaces,hook-context,goal-state,release-process}.md`. 반복 후속: 기능 계획마다 dev·main PR, 태그, 로컬 설치본 갱신이 뒤따랐다.
- Assumptions:
  - A1 (confirmed): 릴리스와 로컬 반영 포함. 출처: 요청 "릴리스, 로컬 반영까지 다해줘".
  - A2 (inferred): 끝 지점 강제는 새 CLI 장치 없이 기존 수단으로 한다. `requiredEvidence`가 자유 문자열이고 `goal finish`가 미완료 task가 있으면 거부하므로, 로드맵에 `deliver` task(`endState` 증거)를 두면 Stop 훅이 끝 지점까지 턴을 붙잡는다.
  - A3 (inferred): `End state`를 Request Brief 게이트 라벨에 넣는다(triage 완료 때 채워져 있어야 함). 2.6.3 이전 계획은 기존 우회 `--allow-no-request-brief`를 쓴다.
  - A4 (inferred): goal 없이 처리하는 Git 작업("develop pr 머지, main pr 머지까지")에는 Stop 훅이 없으므로 idle 캡슐에 한 문장을 싣는다.
- Implicit requirements: idle UserPromptSubmit 캡슐 예산 820 → 940(계약 변경. 사유: 끝 지점·대기 문장 약 150자). Request Brief 게이트 라벨 5 → 6(계약 변경. 사유: 끝 지점 미기록이 이번 멈춤의 원인). 동반 산출물: `docs/memory/{hook-context,policy-surfaces,goal-state}.md`, `PLAN.md`.
- Open questions: none
- Steering log:
- Current request (as of S0): 접목 지점 6개를 구현해 2.6.4로 릴리스하고 로컬 설치본까지 갱신한다.

## Complexity Triage

- Selected path: Light Path(기존 계층 안의 문구·템플릿·상수 변경. 새 모델·계층·명령 없음).
- Checkpoint ledger: Request Light / Planning Light / Code Light. Heavy 신호 없음(게이트 라벨 추가는 기존 배열 원소 1개).

## Agent Assignments

- 바이트 예산에 맞춰 문장을 깎는 편집이라 main이 직접 고친다(worker 위임 없음, main takeover 기록).

## Tool Readiness

- Detected stack: javascript. `pota toolcheck`는 같은 세션에서 통과.

## Module Tasks

### Task 0: `triage-plan`

- Required evidence records: `planArtifact`, `triageDecision`

### Task 1: `implement`

- Contract:
  - 끝 지점: 템플릿 `End state` 칸, `request-brief.md` 절, 게이트 라벨, `planning-rules.md`·`pota-plan` 본문의 `deliver` task 규칙.
  - 대기: Stop 차단 문구, `verification.md` 절, idle 캡슐 문장.
  - 닫기: 동반 산출물을 `Implicit requirements`에 싣고 리뷰가 확인.
  - 증거 공개: 사용자에게 보이는 변경은 보고에 증거 자체를 싣는다.
  - 규칙화: 사용자의 정정을 완료 시 승격 후보로 제시.
- Module acceptance verification: `node --test test/request-brief.test.mjs test/policy-additions.test.mjs test/token-efficiency.test.mjs test/index-context.test.mjs test/antigravity-hooks.test.mjs test/goal-state.test.mjs test/goal-effort.test.mjs`
- Surface integration verification: `npm run check`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 2: `deliver`

- Contract: 기능 브랜치 → dev PR 병합 → dev → main PR 병합 → 태그 `v2.6.4` → main을 dev에 병합 → 로컬 설치본 갱신.
- Required evidence records: `endState`(태그가 origin/main을 가리키고 설치본 버전이 2.6.4임을 읽는 명령).

## Learnings

- L1 (implement): Stop 차단 문구에 `deploy`라는 낱말을 넣으면 `test/goal-state.test.mjs`의 게이트 검사(문구에 게이트 task id `deploy`가 없어야 함)가 깨진다. 대기 문장은 "CI or another external or background job"으로 썼다.
- L2 (implement): `skills/pota-plan/SKILL.md`는 9000바이트 상한에서 2바이트 남는다(8998). `deliver` 문장 110바이트를 넣으려고 Completion Criteria 둘째 줄과 Procedure 8·9를 줄였다.
- L3 (triage-plan): 2.6.3 릴리스에서 CI 통과 뒤 멈춘 원인은 `goal finish`가 `npm run check`에서 goal을 닫아 병합·태그·설치 단계에 Stop 훅이 없었던 것이다. 이번 goal은 `deliver` task를 두고 진행했다.

## Evidence

- Release: comento/pota-harness#49(dev), comento/pota-harness#50(main) 병합, 태그 `v2.6.4`, main을 dev에 병합, 로컬 설치본 2.6.3 → 2.6.4.
- Tests: `npm run check`(implement의 `surfaceIntegration`), 집중 테스트 9개 파일(`moduleAcceptance`).
- End state: `deliver`의 `endState` 증거(태그 `v2.6.4`가 origin/main에 있고 설치본이 2.6.4).
- Memory promotion: `docs/memory/goal-state.md`, `docs/memory/policy-surfaces.md`, `docs/memory/hook-context.md`
- Rule candidates: "CI가 통과했는데도 병합을 이어가지 않고 멈춰 있었던 것과 같은 문제가 없어야 해" → 이번 릴리스의 규칙 자체로 반영(추가 후보 없음).

## Status

- [x] Planned
- [x] Implemented
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
