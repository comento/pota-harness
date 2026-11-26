# Plan: oh-my-openagent 비교에서 고른 게이트·기록 추가, Pota 2.4.0 릴리스

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation (triage 완료).
- Codex UI synchronization: `update_plan`·`create_goal` unavailable (Claude Code 세션, 해당 도구 없음).

## Goal

oh-my-openagent(OmO)와 비교해 Pota 철학(작게 증명하고 멈춘다, 토큰 예산 고정)에 맞는 기능을 더하고 2.4.0으로 배포한다.

- Goal ID: `goal-omo-inspired-gates`
- Plan ID: `plan-omo-inspired-gates`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria (advisory): 고른 기능이 테스트와 실제 hook/CLI 실행으로 확인되고, 버전 표면 4곳이 2.4.0이며, dev·main PR이 병합되고 이 컴퓨터의 Claude Code 설치본이 2.4.0이다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Request Brief

- Original request: 분석 결과에 따라 적합한 것들을 모두 구현해서 더하고, 버전 범프해서 dev pr 머지, main pr 머지, 로컬반영까지 해줘
- Interpreted outcome: 직전 비교 분석의 제안 7개 중 Pota에 적합한 것을 구현해 `dev`와 `main`에 PR로 병합하고, 버전을 올리고, 로컬 저장소와 이 컴퓨터의 플러그인 설치본에 반영한다.
- Scope: 완료 주장 대조(Stop hook), Heavy Path 계획 리뷰 증거 `planReview`, worker의 `ESCALATE:` 반환, 계획의 `## Learnings` 기록, 메모리 노트 `Paths:` 기반 PostToolUse 알림. 버전 표면 4곳, README 8개, 메모리 노트, 릴리스.
- Non-scope: DAG 패널의 실패 task 재배정(triage에서 없음을 확인했으나 세 호스트 UI 변경이고 Codex·ChatGPT Desktop에서 확인할 수 없음), continuation·키워드 모드·team mode·메모리 사이드카, npm 게시(2.x는 게시하지 않음).
- Prior records: `pota plan steering`(14건, 대부분 릴리스 범위 추가), `docs/memory/policy-surfaces.md`, `docs/memory/release-process.md`, `docs/memory/hook-context.md`, `docs/memory/goal-state.md`, `docs/memory/delegation-model-routing.md`. 반복되는 후속: 기능 계획 뒤에 항상 버전 범프·dev→main 승격·태그·`main`→`dev` 역병합·README 8개 갱신이 따랐다.
- Assumptions:
  - A1 (confirmed): 릴리스 범위는 dev PR 병합, main PR 병합, 로컬 반영이다. 출처: 사용자 요청 원문.
  - A2 (inferred): "로컬반영"은 로컬 `dev`·`main` 브랜치 갱신과 이 컴퓨터 Claude Code 플러그인 설치본 업데이트를 뜻한다. 출처: `release-process.md` 절차 6·7.
  - A3 (inferred): 새 기능 추가이므로 버전은 2.4.0(minor)이다. 출처: 2.1.0·2.2.0·2.3.0이 기능 릴리스였다.
  - A4 (evidence): tier 한 단계 승격 재배정과 모델 미가용 처리는 이미 `skills/pota-plan/delegation.md`에 있다. 남은 차이는 worker가 스스로 승격을 요청하는 반환값뿐이다.
- Implicit requirements: hook 변경은 Codex `hooks/codex.json` 선언을 바꾸지 않는다(바꾸면 재승인 필요). hook은 fail-open이어야 하고(오탐이 종료를 막지 않게 알림만), transcript 내용을 `~/.pota` 밖으로 보내지 않는다. 캡슐 문자 예산과 SKILL.md 9000바이트 예산을 지킨다.
- Open questions: none
- Steering log:
  - S1 (addition): "Codex·Antigravity 역할 정의도 포함해" -> Non-scope에 있던 Codex·Antigravity용 `explorer`/`worker` 역할 정의를 범위에 넣는다. task `host-roles`를 추가하고 `docs-version`이 그것에 의존한다. 실행 확인은 `agy plugin validate`와 CI `host-validate`(Codex)까지이고, 실제 Codex 세션 동작은 문서 기준으로 남는다.
- Current request (as of S0): OmO 비교 분석에서 Pota에 적합한 기능을 모두 구현하고, 2.4.0으로 올려 dev·main PR을 병합한 뒤 로컬에 반영한다.

## Whole Work

- Outcome: 아래 5개 기능이 들어간 2.4.0이 `main`에 있고 로컬 브랜치와 이 컴퓨터의 Claude Code 설치본에 반영된다.
- Affected surfaces: `scripts/pota-state-hook.mjs`, `scripts/pota-state.mjs`, `scripts/pota-index.mjs`, `skills/`, `claude/agents/worker.md`, `templates/`, `docs/model-guidance/README.md`, README 8개, `test/`, 버전 표면 4곳, `docs/memory/`.
- Task classification: 코드 2개(`claim-receipt` → `memory-paths`, 둘 다 `scripts/pota-state.mjs`를 고치므로 순차), 정책 문구 1개(`policy-text`, 코드와 병렬), 문서·버전 1개(`docs-version`), 검증·리뷰 1개(`verify`), 릴리스 1개(`release`).

### Design decisions (triage)

1. **완료 주장 대조 (`claim-receipt`)**: Stop gate는 goal이 활성인 동안 이미 종료를 막는다. 남은 틈은 (a) loop guard(`stop_hook_active`이고 진행 없음)가 종료를 허용할 때 사용자가 보는 마지막 답변이 "완료"를 주장하는 경우, (b) 막힌 턴에서 모델이 주장을 고치지 않는 경우다. `payload.last_assistant_message`(Claude Code 2.1.327 바이너리의 Stop 입력 schema에 optional 문자열로 있음을 확인. Codex는 문서 기준, 미실행. Antigravity 어댑터는 넘기지 않으므로 조용히 건너뜀)에서 완료·통과 주장 문장을 찾고, gate가 block일 때만 reason 끝에 한 문장을 붙인다. goal 상태가 객관적으로 미완료일 때만 동작하므로 오탐이 종료를 새로 막지 않는다(기존 block/allow 결정은 바꾸지 않음). 코드 블록·인라인 코드·인용 줄은 무시하고, 부정·예정 표현이 있는 문장은 주장으로 보지 않는다. transcript 파일은 읽지 않는다. 끄기: `POTA_CLAIM_RECEIPT=0`(main model gate와 같은 OFF 값).
2. **메모리 `Paths:` 알림 (`memory-paths`)**: 노트 머리(첫 20줄)에 선택 줄 `Paths: <쉼표로 나눈 저장소 상대 경로 접두사 또는 glob>`을 둔다(최대 8개, 각 120자 이하, 절대 경로·`..` 금지, `*`는 한 구간, `**`는 여러 구간). PostToolUse에서 편집한 파일의 저장소 상대 경로가 맞는 노트를 세션·노트당 한 번 `additionalContext`로 알린다(goal 유무와 무관, `docs/memory/` 자체 편집은 제외, 노트 64개까지만 읽음). `memory check`는 잘못된 항목을 `paths-invalid` 경고로 보고한다. 기존 reminder·comment-checker 결과와 합친다.
3. **Heavy 계획 리뷰 (`planReview`)**: 증거 종류는 자유 문자열이라 CLI 변경 없이 `heavy-design` task의 `requiredEvidence`를 `["designRecord","planReview"]`로 지시한다. 설계 병합 뒤 별도 읽기 전용 리뷰어(stronger tier, `high`)가 고정 프롬프트로 검토한다: 기본 승인, 저장소 근거로 확인한 blocker만 반려, 재검토 1회. 판정은 계획 `## Heavy Design`의 `Plan review:` 줄에 적고 `goal verify --kind planReview`로 묶는다.
4. **`ESCALATE:` 반환**: worker가 자기 tier로 감당할 수 없다고 판단하면 편집을 멈추고 final report 첫 줄에 `ESCALATE: <reason>`을 쓴다. orchestrator는 실패한 게이트와 같게 다뤄 한 tier 위로 새 dispatch하고(상한에서 멈춤) Evidence에 `Escalation:` 줄을 남긴다. 한 단계 승격 규칙 자체는 이미 `delegation.md`에 있다.
5. **`## Learnings`**: 계획 템플릿에 append-only 절을 둔다(`- L<n> (<task-id>): <fact>`). worker는 final report에 `LEARNINGS:`를 적고 orchestrator가 옮기며, 뒤 task의 `CONTEXT:`에 넣는다. Memory Promotion 결정은 이 절을 입력으로 쓴다.
6. **Codex·Antigravity 역할 정의 (`host-roles`, S1)**: 조사 결과(2026-11-26).
   - Antigravity(`agy` 1.5.15): 플러그인 루트 `agents/<name>.md`를 manifest 없이 읽는다. frontmatter는 `name`·`description` 필수, `tools`는 YAML 배열(쉼표 문자열이면 skip), `model`은 생략(`inherit`). 도구 이름은 내장 `migrate-agent-settings` skill의 매핑(`Read`/`Glob`/`Grep`→`read_file`, `Edit`→`edit_file`, `Write`→`write_file`, `Bash`→`run_command`)을 쓴다. `invoke_subagent`에서의 이름(`worker`인지 접두사가 붙는지)과 도구 별칭은 실제 세션에서 확인하지 못했다.
   - Claude Code 2.1.327 실측: manifest에 `agents`를 적으면 루트 `agents/`는 읽지 않는다(임시 플러그인에서 `t1:manifested`만 로드). 그래서 루트 `agents/`를 Antigravity 전용으로 쓸 수 있다. `test/plugin-manifests.test.mjs`의 "루트 `agents` 없음" 검사는 이 계약 변경에 맞춰 고친다(계약 변경 사유: 2.0.0에서는 Claude 도구 이름 파일을 Antigravity가 읽는 것을 막으려던 것이고, 이제 그 자리에 Antigravity 형식 파일을 둔다).
   - Codex: 플러그인 manifest(`RawPluginManifest`)에 agents 키가 없고 커스텀 agent는 `~/.codex/agents/*.toml`·`.codex/agents/`에서만 읽는다. Pota는 플러그인 루트와 `POTA_HOME` 밖에 쓰지 않으므로 역할 파일을 `skills/pota-work/roles/{explorer,worker}.md`로 두고, 이름 있는 Pota agent가 없는 호스트에서는 dispatch 프롬프트 맨 앞에 그 파일 내용을 넣도록 두 `delegation.md`에 적는다. 읽기 전용은 지시문으로만 표현된다(Codex는 agent별 sandbox를 덮어쓰지 않음).
   - 세 표면(`claude/agents/X.md` 본문, `agents/X.md` 본문, `skills/pota-work/roles/X.md`)은 테스트로 바이트 동일하게 묶는다.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/policy-surfaces.md`, `docs/memory/release-process.md`, `docs/memory/hook-context.md`, `docs/memory/goal-state.md`, `docs/memory/delegation-model-routing.md`
- Related completed plans: `docs/plan/comment-checker-hook.md`, `docs/plan/request-brief-steering.md`, `docs/plan/main-model-gate-and-test-time.md`

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- Rationale: Claude Code 세션이고 정책 문구·증거 검토 비중이 크다.
- Role-specific adjustment: worker에는 계약·파일 범위·검증 명령만 주고 넓은 탐색을 시키지 않는다.
- User-visible response and artifact locale: 한국어(스킬·README.md·코드 문구는 저장소의 기존 언어인 영어).

## Reasoning Effort Profile

- Light Path: 구현 `sonnet`/`medium`, 최종 리뷰 `opus`/`medium`. 릴리스이므로 리뷰는 stronger tier로 한다.
- 계획·triage는 main 세션(`Pota main model:` 줄 없음)에서 수행했다.

## Complexity Triage

- Selected path: Light Path.
- Selection rationale: 다섯 기능 모두 기존 모듈 안의 추가다(Stop 분기, PostToolUse 분기, 인덱스 파서, 정책 문구). 새 디렉터리·레이어·도메인 모델이 없고, gate의 block/allow 결정과 goal 상태 스키마를 바꾸지 않는다.
- Checkpoint ledger:
  - Request checkpoint: provisional Heavy. 근거: 세션 종료 hook 동작 변경, 여러 도메인 동시 변경.
  - Planning checkpoint: Light. 근거: `evaluateStop`·`stopHookOutput`의 결정은 그대로 두고 reason 문장만 덧붙인다. 증거 종류는 자유 문자열(`pota-goal-operations-evidence.mjs:219`)이라 `planReview`에 CLI 변경이 없다. `Paths:`는 `extractNoteSummary`와 같은 머리 줄 파서에 더한다. 새 Heavy 신호 없음.
  - Code checkpoint: 각 worker가 첫 편집 직전에 보고한다(아래 Evidence).
- Heavy Path signals checked:
  - New directory/module/layer: 없음(테스트 파일 2개만 추가).
  - New domain model/service/abstraction: 없음.
  - Security/auth/session: 없음(hook은 사용자 인증 세션이 아님. transcript를 읽지 않고 외부 전송 없음).
  - External API/message queue/payment: 없음.
  - DB schema/migration: 없음(goal 상태 스키마 그대로, hook guard 파일 하나 추가).
  - Concurrency/transaction/cache invalidation: 없음(guard 쓰기는 기존 `writeHookGuard`, 실패해도 hook은 계속).
  - Cross-domain refactor: 없음(리팩터링 아님).
  - Explicit extra-care signal: 없음.
- Omitted delegation in Light Path: 설계 dispatch와 구현 전 리뷰는 생략. 최종 리뷰는 유지.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `claim-receipt` | `worker` | `light` | `sonnet` | `medium` |
| `memory-paths` | `worker` | `light` | `sonnet` | `medium` |
| `policy-text` | `worker` | `light` | `sonnet` | `medium` |
| `docs-version` | `worker` | `light` | `sonnet` | `medium` |
| `verify` | main + 리뷰 `worker`(읽기 전용) | `light` | `opus` | `medium` |
| `release` | main | `light` | main session | inherited |

## Tool Readiness

- Detected stack: javascript, typescript
- Toolcheck command: `pota toolcheck --root .`
- Required LSP/symbol tools: `typescript-language-server` (OK)
- Required typecheck/lint/verification tools: `node`, `npm`, `tsc` (OK)
- Missing tools: 없음
- Install approval: not needed.
- Tool blockers: 없음

## Execution Guardrails

- Test contract first: 각 코드 task는 새 테스트 파일에 계약을 먼저 쓰고 실패를 확인한 뒤 구현한다.
- Verification ladder: task별 집중 테스트 → 마지막에 `npm run check` 한 번. `package.json`은 `private`이고 `npm pack`은 쓰지 않는다(`release-process.md`).
- Dry-run or check mode before external-state mutation: PR 병합 전 exact head CI 통과 확인(`gh pr checks`). 플러그인 설치본 갱신 전 `claude plugin list --json`으로 현재 버전 확인.
- Verification loop budget: task당 두 번.
- 기존 테스트·fixture는 약화하지 않는다. 계약 변경은 두 가지뿐이다: 버전 기대값(`test/contract-parity.test.mjs`)을 2.4.0으로(버전 범프), 루트 `agents` 금지 해제(`test/plugin-manifests.test.mjs`, `test/docs-package-hardening.test.mjs`. Design decision 6).

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Requested model: stronger 이상 / Effective model: main session(`Pota main model:` 줄 없음)
- Requested reasoning effort: high / Effective reasoning effort: inherited: main session
- Required evidence records: `planArtifact`, `triageDecision`

### Task 1: 완료 주장 대조

- Task ID: `claim-receipt`
- Requested model: `sonnet` / Requested reasoning effort: `medium`
- Contract: Design decision 1.
- Files / Write scope: `scripts/pota-state-hook.mjs`, `scripts/pota-state.mjs`, `test/claim-receipt.test.mjs`
- Depends on: `triage-plan`
- Module acceptance verification: `node --test test/claim-receipt.test.mjs`
- Surface integration verification: `node --test test/goal-state.test.mjs test/state-recovery-hardening.test.mjs test/token-efficiency.test.mjs test/antigravity-hooks.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 2: 메모리 `Paths:` 알림

- Task ID: `memory-paths`
- Requested model: `sonnet` / Requested reasoning effort: `medium`
- Contract: Design decision 2.
- Files / Write scope: `scripts/pota-index.mjs`, `scripts/pota-state.mjs`, `templates/domain-memory.md`, `test/memory-paths.test.mjs`
- Depends on: `claim-receipt`
- Module acceptance verification: `node --test test/memory-paths.test.mjs`
- Surface integration verification: `node --test test/index.test.mjs test/index-context.test.mjs test/comment-checker.test.mjs test/antigravity-hooks.test.mjs test/token-efficiency.test.mjs test/docs-package-hardening.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 3: 정책 문구

- Task ID: `policy-text`
- Requested model: `sonnet` / Requested reasoning effort: `medium`
- Contract: Design decisions 3·4·5와 `Paths:` 줄 안내(`skills/pota-memory/SKILL.md`), 계약 테스트 추가.
- Files / Write scope: `skills/pota-plan/heavy-path.md`, `skills/pota-plan/delegation.md`, `skills/pota-work/heavy-path.md`, `skills/pota-work/delegation.md`, `skills/pota-work/verification.md`, `skills/pota-memory/SKILL.md`, `claude/agents/worker.md`, `templates/work-plan.md`, `docs/model-guidance/README.md`, `test/policy-additions.test.mjs`
- Depends on: `triage-plan`
- Module acceptance verification: `node --test test/policy-additions.test.mjs`
- Surface integration verification: `node --test test/contract-parity.test.mjs test/token-efficiency.test.mjs test/plugin-manifests.test.mjs test/docs-package-hardening.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 4: README·버전·메모리

- Task ID: `docs-version`
- Requested model: `sonnet` / Requested reasoning effort: `medium`
- Contract: README 8개에 새 기능 bullet 4개, 버전 표면 4곳과 테스트 기대값을 2.4.0으로, `docs/memory/` 노트 갱신과 `Paths:` 줄, `pota memory index`.
- Files / Write scope: `README.md`, `README.ko.md`, `README.ja.md`, `README.zh.md`, `README.es.md`, `README.fr.md`, `README.de.md`, `README.pt.md`, `package.json`, `plugin.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `test/contract-parity.test.mjs`, `docs/memory`, `MEMORY.md`
- Depends on: `memory-paths`, `policy-text`
- Module acceptance verification: `node --test test/contract-parity.test.mjs test/plugin-manifests.test.mjs test/readme-plugin-install.test.mjs test/docs-package-hardening.test.mjs test/repo-index.test.mjs`
- Surface integration verification: `node scripts/pota.mjs doctor`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 5: 검증과 리뷰

- Task ID: `verify`
- Contract: `npm run check` 전체, 실제 hook 진입점(`node scripts/pota-state.mjs stop claude`, `post-tool-use claude`)에 stdin payload를 넣어 동작 확인, 읽기 전용 리뷰(`opus`).
- Depends on: `docs-version`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 6: 릴리스

- Task ID: `release`
- Contract: 기능 브랜치 커밋·push → `dev` PR(CI 통과 뒤 병합) → `dev`→`main` PR(CI 통과 뒤 병합) → 태그 `v2.4.0` → `main`을 `dev`에 역병합 → 로컬 `dev`·`main` 갱신, Claude Code 설치본 업데이트와 `doctor`.
- Depends on: `verify`
- Required evidence records: `surfaceIntegration`

## Learnings

- L1 (claim-receipt): `detectCompletionClaim`은 매칭 구절이 아니라 주장이 든 문장(60자 이하)을 돌려준다. 영어 제외어는 단어 경계, 한국어 제외어(`않`, `필요` 등)는 부분 문자열로 본다. claim은 `gate.block`일 때만 계산한다. 출처: `scripts/pota-state-hook.mjs`.
- L2 (memory-paths): `writeHookGuard`는 부모 디렉터리가 없으면 조용히 저장에 실패한다(`safeWriteFile` 계약). goal 없이 쓰는 guard는 쓰기 전에 goal 상태 디렉터리를 만들어야 한다. 출처: `scripts/pota-state.mjs` `memoryPathsNotice`.
- L4 (verify): `goal verify`는 항상 `-- <argv>`가 필요하다. 스킬 문서의 `goal verify --kind designRecord` 같은 축약형은 그대로 실행하면 실패한다(`scripts/pota-goal-evidence.mjs:7`). `designRecord` 문장은 이번 범위 밖이라 남겼다.
- L3 (memory-paths): `scripts/pota-state.mjs`의 CLI 진입 블록은 top-level await로 모듈 평가 도중에 실행된다. 그 아래에 선언한 모듈 수준 `const`는 hook CLI 경로에서만 TDZ 오류가 나고 호출부 `.catch`가 삼킨다. `runStateResult`를 import하는 테스트로는 드러나지 않으므로 hook 경로는 실제 프로세스 실행 테스트로 덮는다. 출처: `test/memory-paths.test.mjs`의 spawn 테스트.

## Evidence

- Tool readiness: `pota toolcheck --root .` → node, npm, typescript-language-server, tsc 모두 OK.
- Claude Code Stop 입력: 2.1.327 바이너리 schema에 `last_assistant_message: string().optional()`("Text content of the last assistant message before stop") 확인.
- DAG 재배정: `scripts/pota-dag-*.mjs`, `hooks/register.tsx`에 retry·reassign 동작 없음.
- Final review: `opus`(claude-opus-5-5) 읽기 전용 리뷰, `VERDICT: approve`. 낮은 심각도 9건 중 반영: README.ko 조건 오역, policy-surfaces 표, 4번째 이후 노트 알림 누락, Codex `apply_patch`·cwd 기준 상대 경로, `notesForPath` symlink 검사, 서로게이트 자르기, `planReview` 명령 형식, 템플릿 라벨, 완료 주장 오탐 패턴. 남긴 것: symlink 별칭 root에서의 미탐(문서에 한계로 기록), 기존 `designRecord` 축약 명령.
- Surface: 임시 저장소·임시 `POTA_HOME`에서 `node scripts/pota-state.mjs stop claude`(주장 문장 부착, 부정문 미부착, `POTA_CLAIM_RECEIPT=0` 미부착), `post-tool-use claude`(첫 편집 알림, 두 번째 없음) 확인. 이 과정에서 CLI 경로 TDZ 결함을 찾아 고쳤다(L3).
- Memory promotion: docs/memory/hook-context.md
- Tests: `npm run check` → tests 558, pass 558, fail 0.
- Release: 이 계획이 담긴 커밋 뒤에 기능 브랜치→`dev` PR, `dev`→`main` PR, 태그 `v2.4.0`으로 진행한다. PR 번호와 SHA는 GitHub와 태그에 남는다.

## Status

- [x] Planned
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
