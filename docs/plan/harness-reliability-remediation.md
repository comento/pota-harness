# Plan: Pota 하네스 신뢰성 개선

## Plan Phase

- Initial: `triage-plan`에 대해 decision-complete로 생성했습니다.
- Finalized: decision-complete for implementation.
- Codex UI synchronization: 초기 `update_plan`과 `create_goal` 완료; 본 확정 계획으로 `update_plan`을 다시 동기화합니다.

## Goal

리뷰에서 재현된 Pota 하네스의 상태 무결성, 설치 안전성, 호스트 호환성, 검증 계약 결함을 회귀 테스트와 함께 수정하여 운영 가능한 신뢰성 기준을 충족합니다.

- Goal ID: `goal-472845db-0634-40dd-aa67-68388d67d471`
- Plan ID: `plan-harness-reliability-remediation`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria: 재현된 P0/P1 결함에 대한 자동화 회귀 테스트, 전체 check, 실제 CLI/package 표면 검증이 통과해야 합니다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome: 동시 에이전트 상태 변경이 유실되지 않고, 검증이 원래 goal에 결속되며, 설치·업그레이드·제거가 사용자 환경을 손상하지 않고, 지원 호스트가 실제 설치를 인식합니다.
- Anticipated affected surfaces: goal state runtime, lifecycle/configuration, hooks, toolcheck, tests/CI, README·plan artifacts.
- Stable task classification: `triage-plan` → `state-safety` → `lifecycle-host` → `verification-contracts` → `integration-docs` → `final-verify`. Repository goal의 단일 active-task 불변식에 맞춰 순차 실행합니다.
- Sub-tasks: 각 구현 task는 아래 실패 테스트 계약과 파일 소유권을 넘지 않습니다.

## Memory Inputs

- `MEMORY.md`
- 관련 `docs/memory/*.md`가 존재하면 triage에서 필요한 항목만 읽습니다.

## Model Guidance

- Applied model family: Codex.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/codex.md`.
- Rationale: 다중 파일·동시성·전역 lifecycle 변경은 정확한 파일 범위와 실행 가능한 회귀 계약이 필요합니다.
- Role-specific adjustment: main agent가 orchestration과 최종 검증을 담당하고 구현은 bounded worker에 위임합니다.
- User-visible response and artifact locale: 한국어.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: 상태 동시성, 트랜잭션 경계, symlink 경로 안전성, 전역 lifecycle 복구, 여러 host surface를 함께 변경합니다.
- Heavy Path signals checked:
  - New directory/module/layer: 안전 파일 helper와 transaction/ownership metadata가 필요할 수 있음.
  - New domain model/service/abstraction: 별도 서비스 계층은 만들지 않고 기존 script module 내부 helper로 제한.
  - Security/auth/session: symlink containment과 전역 파일 소유권 안전성이 해당.
  - External API/message queue/payment: 해당 없음. Codex CLI는 격리 home에서 read-only/smoke 검증에만 사용.
  - DB schema/migration: 해당 없음.
  - Concurrency/transaction/cache invalidation: state lock과 lifecycle rollback이 명확히 해당.
  - Cross-domain refactor: goal/lifecycle/toolcheck/tests/docs에 걸쳐 해당.
  - Explicit extra-care signal: 충분한 검사·추론과 근거 기반 구현 요청이 해당.
- Heavy Path trigger: concurrency·transaction boundary, path safety, cross-domain 변경.
- Pre-implementation decisions:
  - state mutation은 `.pota/state.lock` 배타 lock과 bounded retry로 직렬화합니다. lock record는 `schemaVersion`, `pid`, `hostname`, `nonce`, `acquiredAt`을 가지며 live owner의 lock은 절대 탈취하지 않습니다.
  - verify는 실행 전 identity/fingerprint를 캡처하고 종료 후 동일성 확인 뒤 lock 안에서 receipt를 기록합니다.
  - init/state write는 repository root 아래 기존 component의 symlink를 거부합니다.
  - custom lifecycle과 custom marketplace root를 유지합니다. 공식 marketplace/plugin CLI 중심 흐름으로 전환하지 않습니다.
  - versioned cache는 Task 2의 isolated A/B smoke가 unversioned=`installed:false`, versioned=`installed:true`를 증명할 때만 custom transaction 산출물에 추가합니다. 이 gate가 실패하면 versioned cache 경로 변경만 건너뛰고 나머지 lifecycle 안전성 개선은 계속하며, 호스트 인식 차이를 잔여 blocker로 기록합니다.
  - install은 공용 `[features]`와 `[agents]`를 더 이상 강제 수정하지 않고, Pota-owned section만 보존 편집합니다.
  - automatic tool installer는 새로 만들지 않고 현재 unavailable 계약을 정확히 문서화합니다.

## Agent Assignments

- `explorer`: 상태/설치/호스트 계약의 read-only 재확인과 영향 분석.
- `worker`: triage 후 분리된 파일 소유권에 따라 bounded 구현.
- Local main session: 계획, 충돌 조정, repository goal evidence, 최종 통합 검증.

## Tool Readiness

- Detected stack: JavaScript/Node.js ESM CLI package.
- Toolcheck command: installed Pota runtime의 `toolcheck --root /Users/wknam/workspace/pota-harness`.
- Required LSP/symbol tools: repository에 별도 LSP 설정은 없으며 `rg`와 ESM export/import 기반 symbol search를 동등 fallback으로 사용합니다.
- Required typecheck/lint/verification tools: Node.js v26.5.0, npm 12.0.0, Node test runner, Codex CLI 0.144.6, `npm pack --dry-run`.
- Missing tools: 없음. 현행 toolcheck는 npm을 누락하므로 `verification-contracts`에서 보강합니다.
- Install approval: not needed. 외부 package를 추가하지 않습니다.
- Tool blockers: 없음.

## Execution Guardrails

- Test contract first: 각 재현을 실패 테스트로 고정하고 최소 구현만 적용합니다.
- Verification ladder: focused tests → full `npm run check` → normal `npm pack --dry-run`.
- Evidence freshness: 관련 변경 뒤 해당 gate를 다시 실행합니다.
- Dry-run/check: 외부 사용자 home은 수정하지 않고 임시 home과 temp repository에서 lifecycle/host 동작을 검증합니다.
- Verification loop budget: task당 기본 2회.
- Failure handling: 한 번 진단 후 task를 축소하고, 두 번째 실패 후 blocker를 기록합니다.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Contract: 설치된 model guidance, tool readiness, 현재 구현·테스트·공식 host 계약을 확인하고 본 계획을 implementation-ready로 확정합니다.
- Investigation scope: `scripts/`, `test/`, `.github/workflows/`, plugin manifests, README/commands/skills/workflows, 공식 Codex·Antigravity 설치 계약.
- Plan update condition: 파일 소유권, 테스트 계약, dry-run 및 두 verification gate가 각 task에 결정되면 finalized로 전환합니다.
- Required evidence records: `planArtifact`, `triageDecision`.

### Task 1: state integrity and path safety

- Task ID: `state-safety`
- Initial status: `pending`
- Contract: 동시 state mutation을 유실 없이 직렬화하고 verify를 시작 goal/snapshot에 결속하며 repository 밖 쓰기와 잘못된 CLI mutation을 fail closed로 차단합니다.
- Files: `scripts/pota-goal.mjs`, `scripts/pota-state.mjs`, 신규 `scripts/pota-safe-fs.mjs`, `test/goal-state.test.mjs`, 신규 필수 `test/verification-contracts.test.mjs`.
- Failure tests first: 20개 병렬 receipt, 동시 start, cross-goal verify, timeout, verify 중 watched mutation, `.pota`/`docs`/dangling file symlink, 누락·중복·unknown CLI option, PostToolUse `hookSpecificOutput.additionalContext` 및 CLI 순수 JSON, dead-PID stale recovery, live-PID no-steal timeout, malformed recent no-steal, malformed old recovery, 예외 이후 lock release.
- Lock ownership/recovery contract:
  - lock 획득은 최대 5초 동안 25ms 간격으로 재시도하며 verify의 외부 명령 실행 중에는 lock을 보유하지 않습니다.
  - 동일 hostname의 PID가 살아 있거나 `EPERM`이면 탈취하지 않고 timeout합니다. `ESRCH`인 dead PID만 stale로 회수합니다.
  - malformed lock은 30초보다 오래된 경우에만 회수하고, 최근 malformed lock은 timeout합니다. 다른/알 수 없는 hostname은 age만으로 탈취하지 않습니다.
  - stale 회수는 lock을 nonce를 포함한 고유 quarantine 경로로 rename한 뒤 읽은 record/nonce가 판정 당시 값과 같은지 확인하여 삭제합니다. 소유권이 바뀌었으면 복원 또는 중단합니다. hostile filesystem TOCTOU는 잔여 위험으로 명시합니다.
- Tool readiness requirement: Node test runner.
- Dry-run/check: production 외부 상태 변경 없음; 모든 write 테스트는 임시 repository 사용.
- Tests: `node --test test/goal-state.test.mjs test/verification-contracts.test.mjs`.
- Module acceptance: 위 focused test 통과.
- Surface integration: CLI subprocess로 option/timeout/receipt와 PostToolUse JSON 동작 검증.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 2: transactional custom lifecycle and host compatibility

- Task ID: `lifecycle-host`
- Initial status: `pending`
- Contract: 기존 custom marketplace/config orchestration을 유지하면서 gated versioned runtime cache, staged commit/rollback, ownership-aware uninstall, Pota-owned TOML section 보존, 실제 Codex·Antigravity 상태 진단을 구현합니다. 전면 공식 marketplace/plugin 전환은 제외합니다.
- Files: `scripts/pota-lifecycle.mjs`, 신규 version-pinned release integrity manifest/helper, `test/lifecycle.test.mjs`, `test/installed-plugin.test.mjs`, 신규 필수 `test/lifecycle-transaction.test.mjs`.
- Failure tests first:
  - isolated Codex A/B smoke로 versioned cache 필수성 gate.
  - manifest 없는 정상 legacy 0.2.2 설치의 one-time adoption과 upgrade 성공, 수정된 legacy mirror 보존·충돌, 유효하지 않은 legacy root 보존·충돌, legacy runtime 파일 1개 변조 시 root 전체 보존·충돌.
  - valid TOML spacing/comment/array/multiline 보존과 public feature key 미수정.
  - `after-codex`, `after-claude`, `after-antigravity`, `after-config` failure injection의 역순 rollback.
  - upgrade 실패 시 이전 runtime 유지, unmanaged/modified mirror 보존, manifest 손상 fail closed.
  - 새 ownership schema의 교차 버전 upgrade에서 이전 versioned runtime 전체 digest를 선검증하고, 새 runtime 적용 뒤 cleanup transaction으로만 제거하며 cleanup 실패 시 이전 버전 전체를 복원.
  - Codex installed/enabled/version 상태와 Antigravity IDE `~/.gemini/config/skills/<folder>/SKILL.md`, CLI global flat `.md` 호환 산출물.
- Tool readiness requirement: Node test runner; 실제 Codex smoke는 isolated `CODEX_HOME`에서만 수행.
- Dry-run/check: staging tree와 config candidate 검증 후 destination commit; 테스트는 모두 임시 home.
- Tests: `node --test test/lifecycle.test.mjs test/installed-plugin.test.mjs test/lifecycle-transaction.test.mjs`.
- Module acceptance: lifecycle focused tests 통과.
- Surface integration: isolated home의 실제 `codex plugin list` JSON으로 installed/enabled/version 판정하고, 설치된 `agy` 1.0.7의 plugin validation/list와 공식 skill 경로 구조 assertion을 수행합니다.
- Ownership manifest state table:
  - 위치: `<marketplaceRoot>/.pota/lifecycle.json`, `schemaVersion: 1`, Pota/version/transaction ID와 모든 managed destination의 path/type/installedDigest/previous metadata를 기록.
  - install: unmanaged preexisting target이면 overwrite하지 않고 전체 rollback.
  - upgrade: manifest-owned target의 current digest가 이전 installedDigest와 같을 때만 교체; 사용자 수정 시 fail closed.
  - uninstall: current digest가 installedDigest와 같을 때만 제거하고 previous backup을 복원; 사용자 수정 시 보존하고 conflict exit.
  - manifest 누락/손상: 외부 mirror/config를 광범위 삭제하지 않고 실패.
  - one-time legacy adoption: manifest가 없을 때 Codex legacy root의 `.codex-plugin/plugin.json` name/version과 runtime locator만 신뢰하지 않습니다. 지원하는 legacy release(최초 0.2.2)에 대해 package release 시 고정한 상대경로별 SHA-256 allowlist와 설치 root의 전체 일반 파일 집합·digest를 비교하여 모두 일치할 때만 Pota-owned root로 인식합니다.
  - legacy root 비교에서 허용하는 생성 차이는 정확한 schema/root/entrypoint/resource 값을 가진 `.pota-runtime.json`, 각 skill의 `references/pota-runtime.json`, 그리고 release manifest에 `hooks: "./hooks/hooks.json"`만 추가한 `.codex-plugin/plugin.json`으로 제한합니다. 그 밖의 누락·추가·변조 파일은 모두 conflict입니다. symlink와 특수 파일은 인수하지 않습니다.
  - Claude/Antigravity mirror는 해당 locator와 인식된 legacy tree로부터 렌더링한 기대 상대경로 집합·내용 digest가 정확히 일치할 때만 함께 인수합니다.
  - legacy adoption 전에 인수 대상 전체를 transaction backup에 보존하고 manifest를 생성한 뒤 upgrade합니다. 수정되었거나 식별 불가능한 root/mirror/config는 overwrite·삭제하지 않고 conflict로 실패합니다.
  - config: 공용 feature/agents table은 수정하지 않고 Pota-owned sections만 교체·제거; unrelated bytes를 보존.
- Commit order: staged validation → custom marketplace source/versioned runtime → Claude mirrors → Antigravity mirrors → config; 실패 시 역순 rollback. uninstall은 외부 mirror/config 처리 후 marketplace root를 마지막에 제거.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: verification, hooks, and tool readiness contracts

- Task ID: `verification-contracts`
- Initial status: `pending`
- Contract: nested stack/package-manager readiness를 탐지하며 installer-unavailable 계약을 코드에서 고정합니다. goal verify와 PostToolUse는 `state-safety`에서 완료된 계약을 소비합니다.
- Files: `scripts/pota-toolcheck.mjs`, `test/toolcheck.test.mjs`.
- Failure tests first: nested package/manifests, root package manager 우선순위, JavaScript node+npm requirement, unavailable installer 무실행.
- Tool readiness requirement: Node test runner.
- Dry-run/check: read-only detection tests.
- Tests: `node --test test/toolcheck.test.mjs`.
- Module acceptance: focused toolcheck tests 통과.
- Surface integration: 임시 nested repository에 대한 `pota toolcheck --json` CLI 결과 검증.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 4: integration tests and documentation parity

- Task ID: `integration-docs`
- Initial status: `pending`
- Contract: packed E2E를 npm cache와 실제 bin shim으로 격리하고 CI 지원 matrix 및 README/command/skill/workflow의 핵심 계약을 실제 구현과 맞춥니다.
- Files: `test/packed-install.test.mjs`, 신규 `test/contract-parity.test.mjs`, `.github/workflows/ci.yml`, `README*.md`, `commands/`, `skills/`, `.agents/workflows/`, `.claude/commands/`, `docs/model-guidance/`, `templates/work-plan.md`, `PLAN.md`.
- Failure tests first: package bin shim 실행, cache 격리, timeout/pre-post/evidence-boundary/installer-unavailable parity.
- Tool readiness requirement: Node/npm.
- Dry-run/check: normal `npm pack --dry-run`; `prepack`은 content-neutral check로 분류하되 최종 package gate에서는 정상 실행.
- Tests: `node --test test/contract-parity.test.mjs test/packed-install.test.mjs test/token-efficiency.test.mjs`.
- Module acceptance: parity 및 packed test 통과.
- Surface integration: 실제 packed npm bin과 cached runtime 실행.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 5: final full verification

- Task ID: `final-verify`
- Initial status: `pending`
- Contract: 모든 diff를 독립 리뷰하고 격리 npm cache에서 전체 check와 정상 package dry-run을 통과시킨 뒤 goal-level finalReview를 기록합니다.
- Files: 전체 변경 diff와 plan evidence만 검토.
- Tests: `env npm_config_cache=<temp> npm run check`.
- Module acceptance: full check 통과.
- Surface integration: `env npm_config_cache=<temp> npm pack --dry-run --json` 성공 및 package contents 검토.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

## Evidence

- Tool readiness: JavaScript/Node와 실제 repository package manager를 함께 탐지하며, 지원 installer가 없는 요구사항은 `installer-unavailable`로 fail closed합니다.
- Tests: 격리 npm cache의 `npm run check`에서 104/104 통과.
- Module acceptance: state, lifecycle, toolcheck, parity/packed focused gate와 전체 check 통과.
- Surface integration: host CLI 없는 제한 PATH, custom versioned cache Codex A/B, packed npm bin, `npm pack --dry-run --json` 64-file 산출물 검증 통과.
- Independent review: 최초 P0 3건(교차 버전 upgrade, 잘못된 evidence watch 경계, clean CI host 의존)을 발견해 수정했으며, 재리뷰에서 코드 변경 승인. 모든 task evidence는 올바른 `|` watch 경계로 재발급합니다.
- Goal final review evidence record: 최종 파일 상태에서 발급.
- Verification pass count: focused gates, full check, package dry-run, 독립 재리뷰 완료.

## Status

- [x] Initial triage plan created
- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completion evidence prepared; repository goal transition follows the final bound receipt
