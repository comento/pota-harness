# Plan: Antigravity 모델 분류·라우팅 확장 및 `goal finish` effort 우회 지원

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-23)
- Finalized: decision-complete for implementation after planned triage. (2026-11-23)
- Codex UI synchronization: Codex의 `update_plan` / `create_goal` 도구는 Antigravity 호스트에 없음 (unavailable). 대신 Antigravity의 `update_steps`로 단계 상태를 동기화한다.

## Goal

Antigravity의 실제 세션·`swarm` 모델(`Gemini 3.8/4` 계열, `Orchestrator`, `GPT-OSS 120B`, `Claude Opus/Sonnet 5.5`)을 `pota-model-tier.mjs`와 설계·리뷰 게이트에서 정확히 분류하고, `delegation.md`에 `invoke_subagent` 기본 + `swarm` 선택적 모델/effort 라우팅 지침을 추가하며, `goal finish`에도 `--allow-inherited-effort` 옵션을 지원한다. Claude Code와 Codex의 기존 모델 테이블·게이트·훅에는 영향을 주지 않는다.

- Goal ID: `goal-08b6a2a7-13ee-44c9-89a3-e48016446c20`
- Plan ID: `docs/plan/antigravity-model-routing.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version; do not record a user-specific absolute plugin path.
- Completion criteria (advisory text; Pota does not enforce it — completion is gated only by required evidence): Antigravity 신규 모델 ID가 4-tier로 정확히 분류되고, `goal assign`/설계·메인 모델 게이트 및 `goal finish --allow-inherited-effort`가 동작하며, Claude Code/Codex 기존 테스트를 포함한 `npm run check`가 통과한다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled` (an `active` goal is never complete).

## Request Brief

- Original request: "이런 모델이 사용가능한데, 이 부분도 업데이트를 해야겠네" -> "네 제안은 어떻게 하는게 좋을 것 같아?" -> "그러면 claude code나 codex에는 영향이 없어?" -> "네 제안대로 antigravity에 대해서 모델을 할당하도록 수정해줘"
- Interpreted outcome: Antigravity의 실제 세션·`swarm` 모델 ID를 4-tier로 분류·게이트 연동하고, `delegation.md`에 `invoke_subagent` 기본 + `swarm` 선택적 모델/effort 라우팅 지침을 추가하며, `goal finish --allow-inherited-effort`를 지원한다(Claude Code/Codex 무영향).
- Scope: `scripts/pota-model-tier.mjs`, `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-operations-evidence.mjs`, `scripts/pota-goal-cli.mjs`, `test/main-model-gate.test.mjs`, `test/goal-effort.test.mjs`, `test/model-ceiling.test.mjs`, `skills/pota-plan/delegation.md`, `skills/pota-work/delegation.md`, `docs/model-guidance/README.md`, `docs/memory/delegation-model-routing.md`, `test/token-efficiency.test.mjs`.
- Non-scope: Claude Code / Codex 모델 테이블(`MODEL_TIER_BY_HOST["claude-code"]`, `MODEL_TIER_BY_HOST["codex"]`) 변경, `hooks/hooks.json`·`hooks/codex.json`·`plugin.json` 변경, `skills/*/SKILL.md` 바이트 예산 건드림, 버전 범프·PR·릴리스(별도 지시 시 진행).
- Prior records:
  - `pota plan steering --root /Users/wknam/workspace/pota-harness`: 총 8건(`request-brief-steering.md`, `plugin-native-install.md`, `antigravity-dag-panel.md`) 확인. 릴리스는 별도 지시 시 진행.
  - `docs/memory/delegation-model-routing.md`: `MODEL_TIER_BY_HOST`가 코드 정본이며 `test/main-model-gate.test.mjs`가 `delegation.md`의 4-tier 문구를 검사하고 `"gemini-3-pro"`는 미분류(`null`)로 고정되어 있음.
  - `docs/memory/policy-surfaces.md`: `skills/pota-{plan,work}/SKILL.md`는 9,000바이트 상한이므로 수정하지 않고 참조 파일 `delegation.md` 및 `docs/model-guidance/README.md`만 갱신.
- Assumptions:
  - A1 (confirmed): 기본 위임은 `invoke_subagent` 유지, `swarm` 구체 모델·effort 라우팅은 선택적(opt-in)으로 지원하며, `goal finish --allow-inherited-effort`도 함께 수정한다(사용자 승인).
  - A2 (confirmed): Claude Code와 Codex의 기존 모델 분류·게이트·훅에는 영향이 없어야 한다(사용자 확인).
  - A3 (evidence): Antigravity `swarm(action: "models", all: true)`로 확인된 실제 모델 ID 목록: `gemini-3.8-flash-{low,medium,high}`, `gemini-4-hydrogen-{low,medium,high,xhigh}`, `gemini-4-neon-{low,medium,high,xhigh}`, `gemini-4-argon-{low,medium,high}`, `gemini-pro-orchestrator-{g1-pro,neon}`, `gpt-oss-120b-medium`, `claude-sonnet-5-5-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, 그리고 `transcript.jsonl`에서 관측된 `gemini-3.5-flash-lite`, `gemini-4-hydrogen-tiered-{high,xhigh}`.
- Implicit requirements: none: 기존 로컬 분류기·CLI 옵션·문서 표면의 좁은 확장이므로 보안·외부 API·DB·동시성 변경 없음. 단 기존 테스트 계약(`gemini-3-pro` -> `null`, `pro` ceiling 거부, Claude/Codex 설계 게이트 문자열 일치, `SKILL.md` 9,000B 예산)을 100% 보존한다.
- Open questions: none
- Steering log:
- Current request (as of S0): Antigravity의 실제 세션·`swarm` 모델 ID를 4-tier로 분류·게이트 연동하고, `delegation.md`에 `invoke_subagent` 기본 + `swarm` 선택적 라우팅 지침을 추가하며, `goal finish --allow-inherited-effort`를 지원한다(Claude Code/Codex 무영향).

## Whole Work

- Outcome: Antigravity에서 실제 사용 가능한 모델들이 Main Model Gate, Model Ceiling, 설계 게이트, `goal assign` 경고와 일관되게 동작하고, `goal finish`가 Antigravity의 `inherited` effort 우회를 정식 지원한다.
- Affected surfaces:
  - 코드·게이트·테스트: `scripts/pota-model-tier.mjs`, `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-operations-evidence.mjs`, `scripts/pota-goal-cli.mjs`, `test/main-model-gate.test.mjs`, `test/goal-effort.test.mjs`, `test/model-ceiling.test.mjs`
  - 정책·문서·계약 테스트: `skills/pota-plan/delegation.md`, `skills/pota-work/delegation.md`, `docs/model-guidance/README.md`, `docs/memory/delegation-model-routing.md`, `test/token-efficiency.test.mjs`
- Task classification: Light Path — `triage-plan` -> (`tier-and-gates` || `policy-and-docs`) -> `verify`.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/delegation-model-routing.md`
- `docs/memory/policy-surfaces.md`
- Related completed plans: `docs/plan/available-model-ceiling.md`, `docs/plan/main-model-gate-and-test-time.md`, `docs/plan/delegation-model-identity-rules.md`

## Model Guidance

- Applied model family: Gemini / Antigravity (common rules only).
- Referenced guidance:
  - `pota://docs/model-guidance/README.md`
- Rationale: 호스트가 Antigravity이며 Common Rules를 적용한다.
- User-visible response and artifact locale: 한국어 (OS locale). 코드·주석·식별자는 저장소 관례(영어)를 따른다.

## Reasoning Effort Profile

- Model: Antigravity `invoke_subagent` `Model` enum 기준 — fast=`flash_lite`, balanced=`flash`, stronger=`pro`, strongest=`pro`.
- Light Path: planning=`medium`, implementation=`medium`, verification=`medium` (`Effective reasoning effort: inherited`).

## Complexity Triage

- Selected path: Light Path (Planning checkpoint 확정).
- Selection rationale: 기존 `pota-model-tier.mjs`, `pota-goal-operations*.mjs`, `pota-goal-cli.mjs`, `delegation.md` 레이어 안의 좁은 확장이며 새 디렉터리·아키텍처·보안·DB·동시성 신호가 없다.
- Checkpoint ledger:
  - Request checkpoint: Light Path 잠정. 기존 모델 티어·게이트·CLI 옵션 및 문서 표면 확장.
  - Planning checkpoint: Light Path 확정. 근거: `scripts/pota-goal-operations.mjs:281-297`, `scripts/pota-goal-operations-evidence.mjs:136-160`, `scripts/pota-goal-cli.mjs:218-237,340`, `test/main-model-gate.test.mjs:73` 확인 완료. 기존 `gemini-3-pro -> null` 및 Claude/Codex 게이트 계약을 그대로 유지하면서 Antigravity 패턴만 정밀 추가 가능.
  - Code checkpoint: 완료. `tier-and-gates`·`policy-and-docs` 워커가 첫 수정 전 대상 파일·계약 테스트를 확인하고 Light Path를 유지함.
- Heavy Path signals checked:
  - New directory/module/layer: 없음
  - New domain model/service/abstraction: 없음
  - Security/auth/session: 없음
  - External API/message queue/payment: 없음
  - DB schema/migration: 없음
  - Concurrency/transaction/cache invalidation: 없음
  - Cross-domain refactor: 없음
  - Explicit extra-care signal: 없음
- Omitted delegation in Light Path: `heavy-design` 생략 (기존 모듈 내 국소적 확장이므로 triage로 설계 확정).

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | `light` | session | `medium` (effective: `inherited`) |
| `tier-and-gates` | `self` (`worker`) | `light` | `flash` | `medium` (effective: `inherited`) |
| `policy-and-docs` | `self` (`worker`) | `light` | `flash` | `medium` (effective: `inherited`) |
| `verify` | main | `light` | session | `medium` (effective: `inherited`) |

## Tool Readiness

- Detected stack: `javascript`, `typescript`
- Toolcheck command: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" toolcheck --root "/Users/wknam/workspace/pota-harness"`
- Required LSP/symbol tools: `typescript-language-server` (OK)
- Required typecheck/lint/verification tools: `node` (OK), `npm` (OK), `tsc` (OK)
- Missing tools: none
- Install approval: not needed
- Tool blockers: none

## Execution Guardrails

- Test contract first: 기존 테스트를 약화·삭제하지 않고 Antigravity 모델 분류·설계/메인 모델 게이트·모델 상한·`goal finish --allow-inherited-effort`·정책 문서 계약 테스트를 추가한다.
- Verification ladder: 모듈별 집중 `node --test` -> 최종 `npm run check` (`goal finish`).
- Dry-run or check mode: `node --check` + `pota memory check --strict` + `pota plan check --strict` (외부 원격 상태 변경 없음).

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Requested model: stronger (`pro`)
- Effective model: session (main)
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Contract: 대상 파일과 기존 테스트 계약을 확인하고 Light Path 구현 계획을 확정한다.
- Required evidence records:
  - `planArtifact`
  - `triageDecision`

### Task 1: Antigravity model tier classifier, design gate, and `goal finish` effort waiver

- Task ID: `tier-and-gates`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`)
- Effective model: `flash (unreported)`
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `triage-plan`
- Write scope: `scripts/pota-model-tier.mjs`, `scripts/pota-goal-operations.mjs`, `scripts/pota-goal-operations-evidence.mjs`, `scripts/pota-goal-cli.mjs`, `test/main-model-gate.test.mjs`, `test/goal-effort.test.mjs`, `test/model-ceiling.test.mjs`
- Contract:
  1. `scripts/pota-model-tier.mjs`: `MODEL_TIER_BY_HOST`의 `claude-code`/`codex`/`antigravity` 정본 테이블과 `claude-code`/`codex` 매처는 변경하지 않는다. `matchers.antigravity`를 확장해 기존 enum(`flash_lite`, `flash`, `pro`) 외에 실제 Antigravity 모델 ID를 분류한다:
     - `fast`: `/^gemini-[\d.]+-flash-lite(?:-[a-z0-9-]+)?$/`
     - `balanced`: `/^gemini-[\d.]+-flash(?:-(?:low|medium|high|xhigh))?$/`, `/^gpt-oss-\d+b(?:-(?:low|medium|high|xhigh))?$/`
     - `stronger`: `/^gemini-4-(?:hydrogen|neon)(?:-(?:tiered-)?(?:low|medium|high|xhigh))?$/`, `/^gemini-pro-orchestrator(?:-[a-z0-9-]+)?$/`
     - `strongest`: `/^gemini-4-argon(?:-(?:tiered-)?(?:low|medium|high|xhigh))?$/`
     - 추가로 `classifyModel(value, "antigravity")`처럼 `host === "antigravity"`가 명시된 경우에만 `claude-sonnet-*` -> `balanced`, `claude-opus-*` -> `stronger`를 `{ tier, host: "antigravity" }`로 분류한다(`host === null`이면 기존대로 `claude-code` 매처가 우선 처리).
     - `"gemini-3-pro"`는 계속 `null`이어야 하며 `parseModelCeiling("pro")`는 계속 `invalid`여야 한다.
  2. `scripts/pota-goal-operations.mjs` (`ensureHeavyDesignRecorded`): `expected.includes(task.model)`에 더해, `hosts.includes("antigravity")`이고 `isAtOrAboveTier(classifyModel(task.model, "antigravity")?.tier, effectiveTier("strongest", ceiling))`일 때도 통과시킨다(`--host claude-code` / `--host codex`일 때는 기존 정확 일치 동작 100% 유지).
  3. `scripts/pota-goal-operations-evidence.mjs` (`finishGoal`) & `scripts/pota-goal-cli.mjs`: `goal finish`가 `--allow-inherited-effort <reason>` (`effortWaiver`)를 허용하고 `setTaskStatus`에 전달하도록 연결한다(미지정 시 기존 fail-closed 차단 유지).
  4. `test/main-model-gate.test.mjs`, `test/goal-effort.test.mjs`, `test/model-ceiling.test.mjs`: 위 모든 규칙(Antigravity 신규 모델 분류, `gemini-3.8-flash-medium` 세션의 Main Model Gate 발동, `gemini-4-argon-high` 설계 게이트 통과 및 `gemini-4-neon-high`의 상한 없는 설계 게이트 거부 / `stronger` 상한 통과, `goal finish --allow-inherited-effort` 통과 및 미지정 거부, Claude Code/Codex 무영향)을 검증하는 테스트를 추가한다.
- Module acceptance verification: `node --test test/main-model-gate.test.mjs test/goal-effort.test.mjs test/model-ceiling.test.mjs`
- Surface integration verification: `node --test test/antigravity-hooks.test.mjs test/cli-contract-hardening.test.mjs`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 2: Antigravity delegation policy, model guidance, and memory note

- Task ID: `policy-and-docs`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`)
- Effective model: `flash (unreported)`
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `triage-plan`
- Write scope: `skills/pota-plan/delegation.md`, `skills/pota-work/delegation.md`, `docs/model-guidance/README.md`, `docs/memory/delegation-model-routing.md`, `test/token-efficiency.test.mjs`
- Contract:
  1. `skills/pota-plan/delegation.md`, `skills/pota-work/delegation.md`, `docs/model-guidance/README.md`: 기존 Antigravity 4-tier 문구(`fast \`flash_lite\``, `balanced \`flash\``, `stronger \`pro\``, `strongest \`pro\``)를 그대로 유지하면서, 기본 위임은 `invoke_subagent`를 쓰고 `swarm` 도구가 노출된 환경에서 구체 모델·effort 지정이 필요할 때는 `swarm(action: "models")`로 확인 후 `swarm(action: "add", model: ...)`로 해당 tier 모델을 지정하고 `goal assign --model <value> --model-source host-option --host antigravity`로 기록할 수 있음을 간결히 추가한다(`skills/*/SKILL.md`는 수정 금지).
  2. `docs/memory/delegation-model-routing.md`: 기존 `Summary:` 유지. Antigravity 확장 모델 분류 규칙, `swarm` 선택적 라우팅, `goal finish --allow-inherited-effort` 지원을 사실 위주로 기록한다.
  3. `test/token-efficiency.test.mjs`: `delegation.md` 두 파일과 `docs/model-guidance/README.md`가 Antigravity 기본 `invoke_subagent` 및 선택적 `swarm` 모델 라우팅을 명시함을 검증하는 회귀 테스트를 추가한다.
- Module acceptance verification: `node --test test/token-efficiency.test.mjs test/contract-parity.test.mjs`
- Surface integration verification: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" memory check --strict --root "/Users/wknam/workspace/pota-harness"`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 3: Final verification

- Task ID: `verify`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`) / main
- Effective model: session (main)
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `tier-and-gates`, `policy-and-docs`
- Write scope: `docs/plan/antigravity-model-routing.md`, `PLAN.md`
- Contract: `pota plan check --strict`, `pota memory check --strict`, 전체 `npm run check`를 실행하고 `goal finish`로 완료한다.
- Module acceptance verification: `npm run check`
- Surface integration verification: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" plan check --strict --root "/Users/wknam/workspace/pota-harness"`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

## Evidence

- Dry-run or check: `node --check scripts/pota-model-tier.mjs scripts/pota-goal-operations.mjs scripts/pota-goal-operations-evidence.mjs scripts/pota-goal-cli.mjs` 통과, `pota plan check --strict` & `pota memory check --strict` 통과 (`ok: true`, errors 0, warnings 0).
- Tool readiness: `node`, `npm`, `typescript-language-server`, `tsc` 모두 OK (`pota toolcheck`).
- Tests:
  - `tier-and-gates`: `node --test test/main-model-gate.test.mjs test/goal-effort.test.mjs test/model-ceiling.test.mjs test/antigravity-hooks.test.mjs test/cli-contract-hardening.test.mjs` (101/101 pass).
  - `policy-and-docs`: `node --test test/token-efficiency.test.mjs test/contract-parity.test.mjs test/plugin-manifests.test.mjs` (41/41 pass).
  - Final full check: `npm run check` (`verify` `moduleAcceptance` 게이트로 최종 바인딩).
- Module acceptance: 전 태스크 `goal verify --kind moduleAcceptance` exit 0 통과.
- Surface integration: 전 태스크 `goal verify --kind surfaceIntegration` exit 0 통과.
- Goal final review evidence record: `goal finish` (`pota memory check --strict` + `verify` `npm run check` fresh 바인딩)으로 완료.
- Memory promotion: `docs/memory/delegation-model-routing.md` (Antigravity 실모델 분류·설계 게이트·`swarm` 선택적 라우팅·`goal finish --allow-inherited-effort` 기록 완료).
- Verification pass count: 1 (전 태스크 1차 통과).
- Blocker after two failed passes: none

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
