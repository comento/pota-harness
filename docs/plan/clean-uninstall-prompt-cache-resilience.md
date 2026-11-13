# Plan: clean uninstall과 프롬프트 캐시 복원력

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation.
- Codex UI synchronization: 초기 roadmap을 `update_plan`과 `create_goal`에 동기화했습니다. 기존 repository goal 교착으로 새 repository goal start는 bootstrap 수정 뒤로 지연합니다.

## Goal

Pota가 소유한 설치 흔적을 안전하게 clean uninstall하고, 필수 정책 유실 없이 정적 prompt prefix와 지연 로딩 참조를 사용하며, 관련 회귀를 자동 검증합니다.

- Goal ID: `goal-clean-uninstall-prompt-cache-resilience`
- Plan ID: `plan-clean-uninstall-prompt-cache-resilience`
- Runtime resources: `pota://` 리소스는 설치된 Pota locator로 해석합니다.
- Completion criteria: managed-only 설치의 uninstall 뒤 cache root가 사라지고 unmanaged child는 보존되며, 완료된 task 증거 교착이 해소되고, 정책 kernel/required reference/cache proxy 계약이 자동 테스트로 고정됩니다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, 또는 `cancelled`.

## Whole Work

- Outcome: uninstall, goal evidence, prompt 구조와 token/cache 회귀 계약을 함께 바로잡습니다.
- Affected surfaces: lifecycle transaction/lock cleanup, goal completion evidence, plugin default prompt, skills와 hook context, tests와 사용자 문서.
- Task classification: 트리아지, lifecycle/goal 신뢰성, prompt 복원력, 통합 검증.
- Sub-tasks: 각 구현 task에서 실패 테스트를 먼저 추가하고 최소 구현으로 통과시킵니다.

## Memory Inputs

- `MEMORY.md`
- 현재 관련 domain memory 없음.

## Model Guidance

- Applied model family: Codex.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/codex.md`.
- Rationale: 저장소 구현·검증과 bounded worker 위임이 필요한 작업입니다.
- User-visible response and artifact locale: 한국어.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: lifecycle transaction/lock/cache cleanup과 goal evidence state machine을 변경하고 prompt/skill/hook/test 표면을 함께 정렬합니다.
- Heavy Path signals checked:
  - New directory/module/layer: 아니오.
  - New domain model/service/abstraction: 아니오.
  - Security/auth/session: session recovery의 fail-closed context를 변경하지만 인증·권한 모델은 변경하지 않음.
  - External API/message queue/payment: 아니오.
  - DB schema/migration: 아니오.
  - Concurrency/transaction/cache invalidation: 예. lifecycle lock 해제와 empty-only cache pruning 경합을 처리함.
  - Cross-domain refactor: 예. lifecycle, goal, prompt, skills, hooks, tests, docs 표면.
  - Explicit extra-care signal: 예. clean uninstall과 높은 cache efficiency를 정책 유실 없이 구현.
- Heavy Path trigger: transaction/cache boundary와 cross-domain prompt contract.
- Pre-implementation decisions: recursive delete 금지, completed task transition 재개방 금지, provider cache API 의존 금지, read receipt로 모델 독해를 허위 증명하지 않음.

## Agent Assignments

- Main agent: 계획, 긴급 goal bootstrap 판단, 최종 검증과 리뷰.
- `lifecycle_goal_triage`: lifecycle/goal 설계와 테스트 계약 완료.
- `prompt_reference_triage`: policy kernel/lazy reference 복원 계약 완료.
- `worker` 1: `scripts/pota-goal.mjs`, `scripts/pota-lifecycle.mjs`, lifecycle/goal focused tests.
- `worker` 2: `.codex-plugin/plugin.json`, `scripts/pota-state.mjs`, agent/skill/model-guidance prompt 표면과 token/packed/lifecycle tests. Worker는 서로의 편집을 되돌리지 않습니다.
- verification/review agent: 전체 diff read-only 리뷰.

## Tool Readiness

- Detected stack: Node.js ESM, `node:test`, npm package.
- Toolcheck command: 설치된 Pota의 `toolcheck --root /Users/wknam/workspace/pota-harness`.
- Required tools: Node.js syntax/test runner, npm check/package dry-run, `rg`.
- Toolcheck result: JavaScript stack, Node와 npm 모두 OK.
- Missing tools: 없음.
- Install approval: not needed.
- Tool blockers: repository goal bootstrap만 제품 결함으로 지연; 구현 도구 blocker 없음.

## Execution Guardrails

- 실제 사용자 설치에서 uninstall을 실행하지 않습니다. lifecycle 검증은 격리된 임시 HOME fixture에서만 수행합니다.
- managed cache root는 비어 있을 때만 제거하고 unmanaged content는 보존합니다.
- 상시 prompt에는 안전·복원 kernel을 남기고 상세 절차만 지연 로딩합니다.
- 필수 참조 유실은 state/receipt 또는 동등한 fail-closed 계약으로 검출합니다.
- focused tests → 전체 `npm run check` → 정상 lifecycle을 포함한 `npm pack --dry-run` 순서로 검증합니다.
- Verification loop budget: task당 기본 2회.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Contract: 관련 코드·테스트·model guidance·tool readiness를 조사하고 Heavy Path 구현 계획을 확정합니다.
- Required evidence: `planArtifact`, `triageDecision`.

### Task 1: lifecycle과 goal 완료 신뢰성

- Task ID: `lifecycle-goal-reliability`
- Initial status: `pending`
- Contract:
  - `verifyAndRecord`가 active 또는 completed task에만 tool-bound evidence를 기록하게 하되 task 상태/identity/fingerprint 검사를 유지합니다.
  - task transition graph는 `completed`에서 다시 열지 않습니다.
  - uninstall transaction의 `finishTransaction()` 성공 뒤 rollback catch 바깥에서 managed child scaffold를 bottom-up empty-only prune합니다. commit 뒤 cleanup 오류는 이미 삭제된 backup/journal로 rollback하지 않고 별도 실패로 전파합니다.
  - nonce 소유 lock을 실제로 해제한 경우에만 `afterRelease`에서 `.pota`와 marketplace root를 empty-only prune합니다. nonce가 바뀌면 post-release prune을 금지합니다.
  - 다음 lifecycle이 pruning과 경합해 lock parent `ENOENT`를 만나면 parent를 재생성하고 재시도합니다.
  - rollback/operation 실패 시 post-commit prune하지 않고 unmanaged child는 모든 scaffold 단계에서 보존합니다.
- Files: `scripts/pota-goal.mjs`, `scripts/pota-lifecycle.mjs`, `test/goal-state.test.mjs`, `test/lifecycle.test.mjs`, `test/lifecycle-transaction.test.mjs`, `commands/pota-uninstall.md`, `README*.md`.
- Expected initial failures: completed task verify 거부; managed-only uninstall 뒤 marketplace root 존재.
- Tests:
  - goal: active/completed verify 허용, pending/blocked/terminal goal 거부, completed status/assignment 불변, goal/plan/task-status/watch 경합 거부.
  - lifecycle: managed-only root 전체 부재, 각 scaffold의 unmanaged child 보존, rollback/failure scaffold 복구, lock waiter `ENOENT` 재시도, nonce replacement 시 post-release prune 금지, uninstall 뒤 reinstall/doctor 성공.
  - commands: `node --test test/goal-state.test.mjs`; `node --test test/lifecycle.test.mjs test/lifecycle-transaction.test.mjs`.
- Bootstrap: focused test 뒤 patched source CLI로 기존 release goal의 stale completed-task evidence를 비파괴 명령으로 refresh하고 goal을 complete한 뒤 현재 repository goal을 start합니다. `.pota/state.json` 직접 수정이나 cancel은 금지합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 2: prompt kernel과 지연 참조 복원력

- Task ID: `prompt-reference-resilience`
- Initial status: `pending`
- Contract:
  - `defaultPrompt`를 1,600자 이하의 6–8문장 정적 kernel로 줄이고 MEMORY, phase skill, active plan/current refs, compaction/restart/delegation 복원, missing-reference fail-close, evidence/external-state/side-question 불변식을 남깁니다.
  - 상세 goal bootstrap/delegation/package/verification ladder는 phase skills와 model guidance에만 둡니다.
  - hook capsule은 정적 kernel을 먼저 두고 active `planId`, current task, `pota-work`, all-complete `pota-review`를 복원합니다. foreign session은 빈 context 대신 generic conflict/fail-close capsule을 반환합니다.
  - foreign-session capsule은 SessionStart/UserPromptSubmit에만 goal 제목·plan/task를 노출하지 않는 모델 행동 지침으로 반환합니다. Stop/SubagentStop은 기존처럼 foreign goal 때문에 block하지 않습니다.
  - active plan 파일이 없거나 required reference를 읽을 수 없으면 capsule이 수정·위임·완료 중단과 blocker 보고를 지시합니다. 별도 read receipt schema는 만들지 않습니다.
  - explorer/worker와 phase skills는 MEMORY → active plan → current task refs → recorded model guidance 순서를 재진입마다 복원하고 누락 시 blocker를 보고합니다.
  - provider cache key/breakpoint/live API 또는 독해를 증명하지 못하는 read receipt schema는 추가하지 않습니다.
- Files: `.codex-plugin/plugin.json`, `scripts/pota-state.mjs`, `agents/explorer.md`, `agents/worker.md`, `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, `skills/pota-review/SKILL.md`, `docs/model-guidance/README.md`, `docs/model-guidance/codex.md`, 관련 tests.
- Expected initial failures: kernel 1,600자 budget, planId/phase skill/fail-close capsule, foreign-session conflict capsule, idle/active/foreign의 static-prefix-first 순서, payload `turn_id`가 달라도 동일 state context가 byte-identical인 assertion.
- Tests: `node --test test/token-efficiency.test.mjs test/goal-state.test.mjs test/packed-install.test.mjs test/lifecycle.test.mjs`.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: 통합 검증과 리뷰

- Task ID: `verify-review`
- Initial status: `pending`
- Contract: focused tests 뒤 전체 `npm run check`, lifecycle script가 content-producing임을 반영한 정상 `npm --cache /private/tmp/pota-npm-cache pack --dry-run`, 독립 read-only 리뷰를 수행합니다.
- Tests: `npm run check`; `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

## Evidence

- Plan phase: decision-complete for implementation.
- Tool readiness: installed Pota toolcheck에서 Node/npm OK.
- Triage decision: Heavy Path; 두 explorer의 lifecycle/goal 및 prompt/reference 계약을 반영함.
- Goal bootstrap resolved: patched source CLI로 기존 `Pota 0.2.3 릴리스`의 completed task evidence를 상태/assignment 변경 없이 갱신하고 completion criteria를 재확인한 뒤 goal을 명시적으로 완료했습니다. 이어 현재 repository goal을 시작해 모든 task 증거를 기록했습니다.
- Documentation boundary: Pota-managed surface는 clean uninstall하고 repository MEMORY/PLAN/state는 보존합니다. global package, package-manager download cache, legacy backups/shared config는 자동 삭제하지 않으며 문서에 별도 범위와 선택적 후속 cleanup으로 명시합니다.
- Pre-implementation review: commit/cleanup 오류 경계와 foreign-session hook semantics의 두 P1을 위 계약으로 해소했습니다. P2 test matrix와 문서 범위도 반영했습니다.
- Implementation evidence: managed-only root 제거·unmanaged 보존·rollback/nonce/ENOENT·재설치 smoke, completed-task evidence refresh/race fail-close, 7문장 1,021자 kernel, idle 420자/active 700자 상한, exact plan/task reference와 foreign-active no-leak/terminal-idle 계약을 자동 테스트로 고정했습니다.
- Verification evidence: `npm run check` 118/118 통과, lifecycle script를 포함한 정상 `npm --cache /private/tmp/pota-npm-cache pack --dry-run` 통과, `git diff --check` 통과.
- Final review: 세 차례 finding 수정 뒤 독립 read-only 재리뷰에서 actionable finding 없이 승인했습니다. provider 실제 cache telemetry는 이 저장소가 직접 제어하지 않으므로 문자수·결정성 proxy만 보장합니다.
- Safety evidence: 사용자 현재 설치에는 install/uninstall을 실행하지 않았고 모든 lifecycle mutation 테스트는 격리된 임시 HOME에서만 수행했습니다.

## Status

- [x] Planned
- [x] Implemented
- [x] Verified and reviewed
- [x] Goal completed or explicit terminal blocker recorded
