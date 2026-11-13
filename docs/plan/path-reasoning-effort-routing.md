# Plan: 경로별 추론 강도 라우팅

## Plan Phase

- Initial: `triage-plan`에 대해 decision-complete이며 아직 implementation-ready가 아니었습니다.
- Finalized: 계획 체크포인트에서 Heavy Path로 확정했으며, 사전 검토 뒤 코드 체크포인트를 통과하면 구현할 수 있습니다.
- Codex UI synchronization: 초기 3-task roadmap을 동기화했습니다. 최종 Heavy roadmap은 `triage-plan` 완료 뒤 `pre-review`·`implement`·`verify`와 각 requested effort를 repository `goal replan` 및 `update_plan`으로 함께 동기화합니다.

## Goal

Light/Heavy Path와 task 역할에 따라 모델은 상속하고 추론 강도를 선택하며, 경로가 바뀔 때 plan artifact·repository goal task roadmap·Codex UI plan·추론 프로필을 함께 다시 계산하는 Pota 계약을 구현합니다.

- Goal ID: `goal-bca1aa43-ce7f-4dec-be7c-adc0873af36c`
- Plan ID: `docs/plan/path-reasoning-effort-routing.md`
- Runtime resources: `pota://` 리소스는 설치된 Pota 버전으로 해석합니다.
- 완료 조건: 경로별 추론 강도 정책, task별 프로필, 경로 변경 동기화 규칙이 지원 표면과 테스트에 일관되게 반영되고 집중 검사·전체 검사·package dry-run을 통과합니다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, `cancelled` 중 하나입니다.

## Whole Work

- 결과: 모델 자동 교체 없이 host/model 기본값을 상속하고 Light/Heavy Path와 task 역할로 reasoning effort를 라우팅합니다.
- 예상 영향 표면: 계획 template, plan/work skills와 command/workflow mirror, model guidance, worker 계약, plugin prompt, README, 관련 lifecycle/contract/goal 회귀 테스트.
- 작업 분류: `triage-plan` → 정책·테스트 최소 구현 → 전체 검증과 최종 검토.
- 하위 작업: 정책/템플릿 계약 확정, Heavy 사전 검토, 실패 계약 테스트, 최소 정책 구현, 전체 검증.

## Memory Inputs

- `MEMORY.md`
- 관련 상세 memory는 트리아지에서 존재 여부를 확인합니다.

## Model Guidance

- Applied model family: Codex.
- Referenced guidance:
  - `pota://docs/model-guidance/README.md`
  - `pota://docs/model-guidance/codex.md`
- Rationale: 현재 user-called/main agent가 Codex이며, 모델 상속과 task별 추론 강도 라우팅의 host 적용 경계를 확인해야 합니다.
- Role-specific adjustment: 모델은 항상 host/user 기본값을 상속합니다. 새 task/subagent를 시작할 때 host 도구가 지원하면 requested effort만 전달하고, 지원하지 않으면 `effective: inherited`를 기록합니다.
- 사용자 가시 응답과 산출물 언어: 한국어.

## Complexity Triage

- Request checkpoint: `provisional-heavy`. 사용자가 경로별 task 구성과 추론 강도의 동시 변경을 요구했으며, 요청/`MEMORY.md`만으로는 상태 스키마 변경 필요성이 불확실했습니다.
- Planning checkpoint: `heavy`. 저장소 조사 결과 새 schema는 필요 없지만 plan/work skills, command/workflow, model guidance, template, plugin/runtime prompt와 테스트에 걸친 실행 정책 변경임을 확인했습니다.
- Code checkpoint: `heavy / passed before first implementation edit`. worker가 owned dirty 17개 파일의 기존 diff, 정확한 policy surface·호출자·집중 테스트를 확인했고 `git diff --check`가 clean임을 보고했습니다.
- Completion checkpoint: `heavy / roadmap extended`. 구현 뒤 최종 goal 전이에서 완료된 `triage-plan`의 plan-bound evidence가 후속 계획 갱신으로 stale이 되었지만, `goal verify`가 완료 task의 재검증을 거부하는 구조적 빈틈을 확인했습니다. 상태를 되돌리지 않는 완료 task evidence refresh와 회귀 테스트를 별도 task로 추가합니다.
- Selected path: Heavy Path.
- Selection rationale: 새 상태 추상화는 만들지 않지만 여러 host 실행 표면에 동일한 task-level effort 계약을 적용하는 교차 표면 변경입니다.
- Heavy Path signals checked:
  - New directory/module/layer: 요청만으로는 없음.
  - New domain model/service/abstraction: 없음. 상세 plan의 task 메타데이터를 권위 프로필로 사용합니다.
  - Security/auth/session: 없음.
  - External API/message queue/payment: 없음.
  - DB schema/migration: 없음.
  - Concurrency/transaction/cache invalidation: 없음. 기존 `goal replan`의 완료 task 보존·미완료 roadmap 교체 계약을 재사용합니다.
  - Cross-domain refactor: 있음. plan/work/model guidance/plugin prompt/template와 host workflow mirror가 같은 실행 계약을 공유합니다.
  - Explicit extra-care signal: 다단계 경로 변경과 task 목록 동기화 요구가 있습니다.
- Heavy Path trigger, if selected: 교차 표면 실행 정책 변경과 경로 재분류 시 roadmap/profile 원자적 동기화 요구.
- Omitted delegation in Light Path, if applicable: 해당 없음.
- Pre-implementation decisions:
  - `docs/plan/<topic>.md`의 각 task에 `requested reasoning effort`와 `effective reasoning effort`를 기록하며 이를 권위 프로필로 사용합니다.
  - 기본 매핑은 Light task=`medium`, Heavy planning/review/implementation=`high`, Heavy final review=`xhigh`입니다. host가 값을 지원하지 않으면 가장 가까운 값을 임의 선택하지 않고 `effective: inherited`로 기록합니다.
  - 모델 override는 하지 않습니다. subagent 생성 도구가 effort override를 노출할 때만 `reasoning_effort`를 전달하고 `model`은 생략합니다.
  - 경로 변경 시 plan artifact를 먼저 갱신하고, 새 경로의 task 목록·reviews·assignments·required evidence·requested effort를 함께 계산한 뒤 `goal replan`과 native UI plan을 같은 순서/표기로 동기화합니다.
  - 완료 task의 기존 프로필은 감사 기록으로 보존하고 미완료 task만 새 경로 프로필로 교체합니다.
  - 최초 구현 범위에서는 `scripts/pota-goal.mjs`를 제외했습니다. 완료 체크포인트에서 발견한 stale evidence 차단을 해결하기 위해 이 파일과 `test/goal-state.test.mjs`만 추가 범위로 승인하며, schema version·`scripts/pota-lifecycle.mjs`·host 전역 model/profile config는 계속 변경하지 않습니다.

## Reasoning Effort Routing

- Light Path defaults: planning=`medium`, implementation=`medium`, verification=`medium`.
- Heavy Path defaults: planning/review=`high`, implementation=`high`, final verification/review=`xhigh`.
- Main task already running: 모델과 실제 effort를 강제로 변경하지 않고 `effective: inherited`로 기록합니다.
- Newly delegated task: host tool이 지원하면 requested effort를 전달하고 실제 적용값을 `effective`로 기록합니다.
- Unsupported host/value: 모델이나 전역 설정을 바꾸지 않고 `effective: inherited`와 미지원 사유를 기록합니다.
- Route change gate: plan, repository task roadmap, native UI plan, reasoning profile 네 표면이 일치하기 전에는 편집을 재개하지 않습니다.
- Completed `triage-plan`: requested=`high`, effective=`inherited`(이미 실행 중인 main task여서 host 설정을 변경하지 않음).
- Active `pre-review`: requested=`high`, effective=`high`(새 subagent dispatch에서 host 도구가 `reasoning_effort: high`를 수락했고 model override는 생략함).

### Path Criteria

- Light Path: 기존 정책 문구와 template/test 정렬만으로 동작 계약을 충족합니다.
- Heavy Path: 새 goal/task 상태 필드·CLI 동작·새 추상화가 필요하거나 여러 runtime 표면의 실행 정책을 함께 변경합니다.

## Agent Assignments

- `explorer`: read-only 영향 분석과 host 지원 경계를 확인했으며 schema/lifecycle 변경이 불필요하다고 판정했습니다. 최종 Heavy 계획 사전 검토도 수행합니다.
- `worker`: requested effort=`high`로 새로 위임하며, 정확한 파일/호출자/테스트를 확인해 코드 체크포인트를 보고한 뒤 실제 구현을 담당합니다.
- Local main session: goal/plan 동기화, 긴급 차단 조사, 검증과 evidence 기록.

## Tool Readiness

- Detected stack: JavaScript(Node.js 18+, ESM), Markdown/JSON 정책 산출물.
- Toolcheck command: 설치된 Pota `toolcheck --root /Users/wknam/workspace/pota-harness`.
- Required LSP/symbol tools: 실행 심볼 변경이 없는 정책/문자열 계약이므로 `rg` 구조 검색과 Node parser/test를 동등한 fallback으로 사용합니다.
- Required typecheck/lint/verification tools: Node `--check`, 내장 test runner, `npm run check`, normal `npm pack --dry-run`.
- Missing tools: 없음. toolcheck에서 Node/npm OK.
- Install approval: not needed.
- Install/bootstrap commands proposed or attempted: 없음.
- Tool blockers: 없음.

## Execution Guardrails

- Test contract first: Light=`medium`, Heavy=`high`/final review=`xhigh`, 모델 상속, path 변경 시 네 표면 동기화, unsupported host의 `effective: inherited`를 실패 assertion으로 먼저 고정합니다.
- Token budget: 계획·트리아지·테스트 설계에는 높은 추론을 쓰고 구현은 최소 변경으로 제한합니다.
- Verification ladder: 집중 테스트 → `npm run check` → lifecycle script 확인 후 정상 `npm pack --dry-run`.
- Evidence freshness: 관련 파일 변경 후 이전 evidence는 stale입니다.
- Dirty-worktree baseline: 현재 수정된 다단계 트리아지 파일과 미추적 계획 파일은 기존 사용자 소유 변경입니다. worker는 첫 편집 전에 `git status --short`, `git diff --check`, 관련 `git diff`를 읽어 기준선을 확인하고, reset/checkout/revert 없이 기존 hunk를 보존해야 합니다. 완료 후 main agent는 staged-triage contract test와 범위 diff를 함께 검토해 기존 변경이 유지됐음을 확인합니다.
- Verification execution: `goal verify`의 task identity와 fingerprint 결속을 사용합니다.
- Evidence boundary: 정책 parity는 `test/contract-parity.test.mjs`, runtime/plugin/install prompt는 `test/lifecycle.test.mjs`, reasoning 배분 계약은 `test/token-efficiency.test.mjs`로 검증합니다.
- Dry-run or check mode before external-state mutation: 외부 상태 변경은 예상하지 않으며 package dry-run만 수행합니다.
- No dry-run available, if applicable: 해당 없음.
- Verification loop budget: task당 두 번.
- Failure handling: 한 번 진단하고 task를 축소·분할한 뒤 재검증하며 두 번째 실패 후 blocker를 기록합니다.

## Module Tasks

### Task 0: 계획된 트리아지와 plan 확정

- Task ID: `triage-plan`
- Initial status: `active`
- Requested reasoning effort: `high`.
- Effective reasoning effort: `inherited` — main task가 이미 실행 중이어서 host/model 설정을 변경하지 않았습니다.
- Contract: 기존 경로 재평가 구현, goal/task 상태, model guidance, host별 agent 설정 경계를 조사하고 저장 방식과 검증 계약을 확정합니다.
- Required evidence records:
  - `planArtifact`
  - `triageDecision`

### Task 1: Heavy 계획 사전 검토

- Task ID: `pre-review`
- Initial status: `pending`
- Requested reasoning effort: `high`.
- Effective reasoning effort: `high` — 새 subagent dispatch가 `reasoning_effort: high`를 수락했으며 model override는 생략했습니다.
- Contract: schema/lifecycle 비변경, 모델 상속, requested/effective fallback, 네 표면 route-change gate, 파일·테스트 범위의 누락과 충돌을 read-only로 검토합니다.
- Required evidence records: `planReview`.

### Task 2: 경로별 추론 강도 라우팅 구현

- Task ID: `implement`
- Initial status: `pending`
- Requested reasoning effort: `high`.
- Effective reasoning effort: `high` — 새 worker dispatch가 `reasoning_effort: high`를 수락했고 model override는 생략했습니다.
- Contract: 최종 트리아지가 지정한 파일에 모델 상속·task별 reasoning effort·경로 변경 시 프로필 재계산 계약과 회귀 테스트를 최소 변경으로 구현합니다.
- Existing-change guardrail: worker는 편집 전 dirty 파일의 현재 diff를 읽고 기존 단계별 트리아지 hunk를 보존합니다. 다른 작업의 변경을 reset, checkout, revert하거나 덮어쓰지 않습니다. 최종 보고에는 기존 hunk 보존 확인과 범위 diff 요약을 포함합니다.
- Files: `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, `commands/pota-plan.md`, `commands/pota-work.md`, `.agents/workflows/pota-plan.md`, `.agents/workflows/pota-work.md`, `docs/model-guidance/README.md`, `docs/model-guidance/codex.md`, `docs/model-guidance/claude.md`, `templates/work-plan.md`, `templates/PLAN.md`, `agents/worker.md`, `.codex-plugin/plugin.json`, `scripts/pota.mjs`, `scripts/pota-state.mjs`, `README.md`, `README.ko.md`, `test/contract-parity.test.mjs`, `test/lifecycle.test.mjs`, `test/token-efficiency.test.mjs`.
- Explicitly excluded: `scripts/pota-goal.mjs`, `test/goal-state.test.mjs`, `scripts/pota-lifecycle.mjs`, host 전역 설정.
- Dependencies: `triage-plan`, `pre-review` 완료.
- Tool readiness requirement: Node/package 검사와 필요한 symbol-aware fallback이 준비되어야 합니다.
- Dry-run or check command: 새 assertion을 추가한 뒤 `node --test test/contract-parity.test.mjs test/lifecycle.test.mjs test/token-efficiency.test.mjs`가 기존 구현에서 의도대로 실패함을 확인합니다.
- Tests: `node --test test/contract-parity.test.mjs test/lifecycle.test.mjs test/token-efficiency.test.mjs`.
- Module acceptance verification: 위 집중 Node test.
- Surface integration verification: `npm run check`.
- Existing-change preservation verification: staged complexity reassessment assertions가 포함된 집중 테스트와 main-agent 범위 diff review.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: 전체 검증과 최종 검토

- Task ID: `verify`
- Initial status: `pending`
- Requested reasoning effort: `xhigh`.
- Effective reasoning effort: `xhigh` — 새 read-only reviewer dispatch가 `reasoning_effort: xhigh`를 수락했고 model override는 생략했습니다.
- Contract: 집중 테스트, 전체 검사, package dry-run과 read-only diff 검토로 정책·mirror·패키지 정합성을 확인합니다.
- Dependencies: `implement` 완료.
- Tests: `node --test test/contract-parity.test.mjs test/lifecycle.test.mjs test/token-efficiency.test.mjs test/packed-install.test.mjs`.
- Module acceptance verification: `npm run check`.
- Surface integration verification: 정상 `npm pack --dry-run`.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`, `finalReview`.

### Task 4: 완료 task의 stale evidence 재검증 보완

- Task ID: `evidence-refresh`
- Initial status: `active`
- Requested reasoning effort: `high`.
- Effective reasoning effort: `inherited` — 완료 단계에서 main task가 직접 처리하므로 실행 중 설정을 바꾸지 않습니다.
- Contract: `goal verify`가 active task뿐 아니라 completed task에도 tool-bound evidence를 새 fingerprint로 추가할 수 있게 하되, pending task는 계속 거부하고 task 상태와 roadmap은 변경하지 않습니다.
- Files: `scripts/pota-goal.mjs`, `test/goal-state.test.mjs`, 이 plan과 `PLAN.md`.
- Dependencies: 기존 `verify` 완료.
- Tests: `node --test test/goal-state.test.mjs`.
- Module acceptance verification: `node --test test/goal-state.test.mjs`.
- Surface integration verification: `npm run check`.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

## Evidence

- Dry-run or check: 외부 상태 변경은 없었습니다. worker가 새 contract assertion을 먼저 추가해 집중 22개 중 기존 18개 통과, effort-routing 계약 부재에 해당하는 4개만 의도대로 실패함을 확인했습니다.
- Tool readiness: JavaScript 감지, Node/npm OK, 누락 도구 없음. 실행 코드 심볼 변경 없이 `rg`, Node parser와 test runner를 사용했습니다.
- Pre-review: requested/effective effort=`high`; 최초 2개 finding(task profile 실제값, dirty baseline 보존)을 보완한 뒤 승인됐고 `receipt-905a51ba-6578-447a-a2ad-1bad5539627f`로 결속했습니다.
- Worker handoff: requested/effective effort=`high`, model inherited. 허용된 20개 파일만 수정했고 기존 staged complexity hunk를 보존했으며 excluded 파일과 global config를 건드리지 않았습니다.
- Tests: `node --test test/contract-parity.test.mjs test/lifecycle.test.mjs test/token-efficiency.test.mjs` — 22/22 통과.
- Module acceptance: 위 집중 테스트, `receipt-83c5044b-7f02-43b3-a9a7-0626b22ace78`.
- Surface integration: `npm run check` — 110/110 통과, 최신 결속 증거 `receipt-bd8184b4-ef78-462e-99f0-ac028941c895`.
- Final verification profile: requested/effective effort=`xhigh`, model inherited. reviewer의 첫 판정에서 effective placeholder를 발견해 실제 dispatch 값으로 수정했으며, plan이 watch set에 포함되므로 최종 두 게이트를 다시 실행합니다.
- Final module acceptance: plan 수정 후 `node --test test/contract-parity.test.mjs test/lifecycle.test.mjs test/token-efficiency.test.mjs test/packed-install.test.mjs` 재실행 통과, `receipt-9a517fce-4305-43c0-8995-68dfbe1fcab1`.
- Final surface integration: plan 수정 후 normal `npm --cache /private/tmp/pota-npm-cache pack --dry-run` 재실행 통과, prepack 전체 110/110 및 package content 확인, `receipt-23495fa4-7964-462b-b317-daff1278748b`.
- Final read-only review: requested/effective effort=`xhigh`, model inherited. 최초 P1(effective placeholder)을 수정하고 plan 포함 두 gate를 새 fingerprint로 재실행했으며, 재검토에서 새 blocker 없음으로 승인됐습니다. 잔여 위험은 host별 실제 effort 지원 여부가 dispatch 응답에 의존하고 defaultPrompt가 3,522/3,600자로 여유 78자라는 점입니다.
- Completion checkpoint finding: 최초 goal 완료 시도는 `Task triage-plan has stale evidence record: triageDecision`으로 중단됐습니다. 구현 결과 자체가 아니라 완료 task evidence refresh 경로 부재가 원인이며 `evidence-refresh` task로 보완합니다.
- Evidence refresh: 완료 task를 다시 active로 되돌리지 않고 `goal verify`가 새 tool-bound receipt를 추가하도록 허용했습니다. 검증 중 status 변경 감지와 pending task 거부는 유지합니다.
- Evidence refresh tests: `node --test test/goal-state.test.mjs test/verification-contracts.test.mjs` 통과.
- Refreshed surface integration: `npm run check` — 110/110 통과.
- Goal final review evidence record: 이 최종 artifact를 포함한 완료 task evidence와 goal-level `finalReview`를 새 fingerprint로 다시 결속한 뒤 완료 전이를 수행합니다.
- Verification pass count: 구현 후 집중/전체 게이트 1회 통과. evidence capture transport 때문에 동일 전체 검사가 추가 실행됐으나 모두 exit 0이었습니다.
- Blocker after two failed passes: 없음.

## Status

- [x] Initial triage plan created
- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Completed-task evidence refresh implemented and verified
- [x] Goal completion ready; fresh task/goal evidence 직후 repository/UI를 completed로 전환
