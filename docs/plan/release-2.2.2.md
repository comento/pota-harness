# Plan: Pota 2.2.2 릴리스 (Claude 플러그인 icon·author 매니페스트 반영)

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-24)
- Finalized: decision-complete for implementation after planned triage. (2026-11-24)
- Codex UI synchronization: Codex의 `update_plan` / `create_goal` 도구는 Antigravity 호스트에 없음 (unavailable). 대신 Antigravity의 `update_steps`로 단계 상태를 동기화한다.

## Goal

`.claude-plugin/plugin.json`의 `icon` 필드와 `.claude-plugin/marketplace.json`의 `plugins[0].author` 필드를 포함한 변경분을 버전 `2.2.2`로 4개 버전 표면 및 테스트에 반영하고, `chore/release-2.2.2` → `dev` PR과 `dev` → `main` PR을 CI 통과 후 병합하며 `v2.2.2` 태그를 배포한다.

- Goal ID: `goal-8f088fd4-d99c-4efa-8c6e-6f313b16e24c`
- Plan ID: `docs/plan/release-2.2.2.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version; do not record a user-specific absolute plugin path.
- Completion criteria (advisory text; Pota does not enforce it — completion is gated only by required evidence): 4개 버전 표면이 `2.2.2`로 일치하고, `npm run check`·`claude plugin validate .`·`agy plugin validate .`·`pota doctor`가 통과하며, `dev` PR과 `main` PR이 exact-head CI 통과 후 병합되고 `v2.2.2` 태그가 `main` 병합 커밋에 푸시된다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled` (an `active` goal is never complete).

## Request Brief

- Original request: "2.2.2로 dev pr 머지 main pr 머지까지 진행해줘"
- Interpreted outcome: 현재 작업 트리의 Claude 플러그인 매니페스트 변경(`.claude-plugin/plugin.json` `icon`, `.claude-plugin/marketplace.json` `author`)을 포함해 Pota를 `2.2.2`로 릴리스하고 `dev` PR 및 `main` PR을 CI 검증 후 병합한다.
- Scope: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, `.codex-plugin/plugin.json`, `plugin.json`, `test/contract-parity.test.mjs`, `test/plugin-manifests.test.mjs`, `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, `skills/pota-plan/planning-rules.md`, `docs/model-guidance/README.md`, `scripts/pota-dag-mcp-core.mjs`, `test/token-efficiency.test.mjs`, `docs/plan/release-2.2.2.md`, `PLAN.md`, `docs/plan/ARCHIVE.md`, `chore/release-2.2.2` → `dev` PR (#30), `feat/antigravity-dag-auto-open` → `dev` PR, `dev` → `main` PR (#31), `v2.2.2` 태그.
- Non-scope: npm 게시(2.x는 `main` 병합이 배포), Claude Code/Codex 훅·mod·에이전트 동작 변경, `hooks/codex.json`·런타임 훅 캡슐 변경, 사용자 로컬 설치본 재교체(별도 요청 시 수행).
- Prior records:
  - `pota plan steering --root /Users/wknam/workspace/pota-harness`: 총 8건(`request-brief-steering.md` 4건, `plugin-native-install.md` 3건, `antigravity-dag-panel.md` 1건) 확인. 로컬 설치본 교체는 명시적 요청 시에만 수행하며, 완료된 서브에이전트는 `manage_subagents(kill)` 대신 유휴 상태로 둔다.
  - `docs/memory/release-process.md`: 4개 버전 표면(`package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugin.json`) + `test/contract-parity.test.mjs` 기대값 일치, marketplace 2개는 버전 미기재, `PLAN.md` 완료 항목 20개 초과 시 `pota plan index --archive`, exact-head CI `check` 통과 후 `--match-head-commit` 병합, `main` 병합 커밋에 `v2.2.2` 태그.
  - `docs/memory/lifecycle-install.md`: `agy plugin validate`는 `--strict` 없이 실행(임시 `HOME`), `claude plugin validate .`로 매니페스트 검증.
- Assumptions:
  - A1 (confirmed): 개발자 이름은 `WkNam`으로 유지하고, `.claude-plugin/plugin.json`의 `icon: "./assets/logo.svg"`와 `.claude-plugin/marketplace.json`의 `plugins[0].author.name: "WkNam"`을 `2.2.2`에 포함한다.
  - A2 (evidence): `origin/main`은 `1d6adb9` (`v2.2.1`, PR #29), `origin/dev`는 `0ded001` (PR #28)이며 열린 PR은 없다.
- Implicit requirements: `PLAN.md` 완료 항목 20개 초과 시 `pota plan index --archive` 실행, `marketplace.json`에는 `version` 미기재, 브랜치 보호 필수 `check` 통과 후 `--match-head-commit` 병합.
- Open questions: none
- Steering log:
  - S1 (addition): "goal start 직후 open_pota_dag를 자동 호출하라는 지침이 antigravity에 있어야 하는데?" / "이걸 포함해서 2.2.2로 해" / "claude code나 codex에서는 제외하는거 맞지?" -> Antigravity 전용(Claude Code·Codex 제외) `open_pota_dag` 자동 호출 지침을 `skills/pota-plan/SKILL.md`·`skills/pota-work/SKILL.md`(각 9,000B 예산 준수)·`skills/pota-plan/planning-rules.md`·`docs/model-guidance/README.md`와 회귀 테스트(`test/token-efficiency.test.mjs`)에 추가하고, `scripts/pota-dag-mcp-core.mjs` fallback 버전을 `2.2.2`로 맞춘 뒤 `dev` PR을 추가 병합해 열린 `main` PR #31에 포함시킨다.
  - S2 (addition): "pota_pota-dag mcp 가 좀전에 확인해보니 뻗어있었던거 같던데" / "이거 상태 확인해서 띄우는 것도 코드에 넣어야 해" / "지금은 내가 수동으로 restart했는데, 일반 사용자가 그렇게 쓰기엔 귀찮고 어려워" -> `scripts/pota-dag-mcp.mjs`(PID 생존 파일 `<POTA_HOME>/hosts/antigravity-dag/server.json` 기록·예외 방어·`ensure` 하위 명령)와 `scripts/pota-state-antigravity.mjs`(Antigravity `SessionStart`/`PreInvocation` 시 생존 확인 후 비정상일 때만 loopback 한정 `RefreshMcpServers` 자동 복구·30초 스로틀·비차단) 및 단위 테스트(`test/antigravity-dag-mcp.test.mjs`)를 `dag-mcp-auto-recover` 태스크로 추가해 2.2.2에 함께 포함시킨다.
- Current request (as of S2): Claude 플러그인 매니페스트(`icon`, `author`), Antigravity 전용 `open_pota_dag` 자동 호출 지침(Claude Code·Codex 제외), 그리고 Antigravity `pota_pota-dag` MCP 서버 생존 확인·자동 복구(`server.json` + loopback `RefreshMcpServers` + `ensure` CLI)를 모두 Pota `2.2.2`로 검증·반영한 뒤 `dev` PR과 `main` PR #31을 CI 통과 후 병합하고 `v2.2.2` 태그를 배포한다.

## Whole Work

- Outcome: Pota `2.2.2`가 `dev`와 `main`에 병합되고 `v2.2.2` 태그가 원격에 푸시된다.
- Affected surfaces: 4개 버전 매니페스트, `.claude-plugin/marketplace.json`, 계약·매니페스트 테스트 2개, 계획/인덱스 문서, GitHub PR(`dev`, `main`) 및 `v2.2.2` 태그.
- Task classification: Light Path — `triage-plan` → `bump-and-test` → `dev-pr` → `main-pr`.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/release-process.md`
- `docs/memory/lifecycle-install.md`
- Related completed plans: `docs/plan/antigravity-model-routing.md`, `docs/plan/dag-open-running-task.md`

## Model Guidance

- Applied model family: Gemini / Antigravity (common rules only).
- Referenced guidance:
  - `pota://docs/model-guidance/README.md`
- Rationale: 호스트가 Antigravity이며 Common Rules를 적용한다.
- User-visible response and artifact locale: 한국어 (OS locale).

## Reasoning Effort Profile

- Model: Antigravity `invoke_subagent` `Model` enum 기준 — fast=`flash_lite`, balanced=`flash`, stronger=`pro`, strongest=`pro`.
- Light Path: planning=`medium`, implementation=`medium`, verification=`medium` (`Effective reasoning effort: inherited`).

## Complexity Triage

- Selected path: Light Path (Planning checkpoint 확정).
- Selection rationale: 기존 매니페스트 4개 버전 범프, 기존 테스트 2개 갱신, 표준 `dev` → `main` 릴리스 PR 절차로 새 아키텍처·보안·DB·동시성 변경이 없다.
- Checkpoint ledger:
  - Request checkpoint: Light Path 잠정. 2.2.2 패치 릴리스 및 표준 PR 승격.
  - Planning checkpoint: Light Path 확정. 근거: `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugin.json` 4곳 버전 `2.2.1` 및 `test/contract-parity.test.mjs:12` 확인, `toolcheck` 전 항목 OK, `gh auth status` 정상 및 열린 PR 없음.
  - Code checkpoint: 완료 (`bump-and-test` 워커가 4개 버전 표면과 테스트 2개 수정 전 대상 확인 후 Light Path 유지).
- Heavy Path signals checked:
  - New directory/module/layer: 없음
  - New domain model/service/abstraction: 없음
  - Security/auth/session: 없음
  - External API/message queue/payment: 없음
  - DB schema/migration: 없음
  - Concurrency/transaction/cache invalidation: 없음
  - Cross-domain refactor: 없음
  - Explicit extra-care signal: 없음
- Omitted delegation in Light Path: `heavy-design` 생략 (표준 패치 릴리스).

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | `light` | session | `medium` (effective: `inherited`) |
| `bump-and-test` | `self` (`worker`) | `light` | `flash` | `medium` (effective: `inherited`) |
| `dev-pr` | main | `light` | session | `medium` (effective: `inherited`) |
| `main-pr` | main | `light` | session | `medium` (effective: `inherited`) |

## Tool Readiness

- Detected stack: `javascript`, `typescript`
- Toolcheck command: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" toolcheck --root "/Users/wknam/workspace/pota-harness"`
- Required LSP/symbol tools: `typescript-language-server` (OK)
- Required typecheck/lint/verification tools: `node` (OK), `npm` (OK), `tsc` (OK), `gh` (OK), `claude` (OK), `agy` (OK)
- Missing tools: none
- Install approval: not needed
- Tool blockers: none

## Execution Guardrails

- Test contract first: `test/contract-parity.test.mjs`(버전 `2.2.2`)와 `test/plugin-manifests.test.mjs`(Claude `icon: "./assets/logo.svg"` 추적 및 marketplace `plugins[0].author.name === "WkNam"`)를 포함해 `npm run check` 전체 통과를 요구한다.
- Verification ladder: 집중 매니페스트/계약 테스트 → `npm run check` + `claude plugin validate .` + `HOME=<tmp> agy plugin validate .` + `node scripts/pota.mjs doctor` → GitHub Actions CI `check` 통과.
- Dry-run or check mode before external-state mutation: push/PR 전 로컬 `npm run check`, 호스트 validate 2종, `pota doctor`, `pota plan check --strict`, `pota memory check --strict` 통과.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Requested model: stronger (`pro`)
- Effective model: session (main)
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Contract: `toolcheck`, `pota plan steering`, 버전 표면 점검을 수행하고 이 계획을 `decision-complete for implementation`으로 확정한다.
- Required evidence records:
  - `planArtifact`
  - `triageDecision`

### Task 1: version bump to 2.2.2, manifest contract tests, and local verification

- Task ID: `bump-and-test`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`)
- Effective model: `flash (unreported)`
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Assigned agent ID: `435a5401-d9b2-42ec-990e-aed21afc67d4`
- Depends on (task ids): `triage-plan`
- Write scope: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `plugin.json`, `test/contract-parity.test.mjs`, `test/plugin-manifests.test.mjs`, `docs/plan/release-2.2.2.md`, `PLAN.md`, `docs/plan/ARCHIVE.md`
- Contract:
  1. `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugin.json`의 `version`을 `"2.2.2"`로 올린다(`.claude-plugin/marketplace.json`·`.agents/plugins/marketplace.json`에는 `version`을 적지 않는다).
  2. `test/contract-parity.test.mjs`의 기대 버전을 `"2.2.2"`로 갱신한다.
  3. `test/plugin-manifests.test.mjs`에 `.claude-plugin/plugin.json`의 `icon === "./assets/logo.svg"`(git tracked) 및 `.claude-plugin/marketplace.json`의 `plugins[0].author.name === "WkNam"` 검증을 추가한다.
  4. `PLAN.md`의 2.2.2 항목을 `## Completed Plans`로 옮기고 `pota plan index --archive --root /Users/wknam/workspace/pota-harness`로 20개 초과 항목을 `docs/plan/ARCHIVE.md`로 아카이브하며 `plan check --strict`·`memory check --strict`를 통과시킨다.
  5. `npm run check`, `claude plugin validate .`, `HOME=<tmp> agy plugin validate .`, `node scripts/pota.mjs doctor`를 통과시킨다.
- Module acceptance verification: `node --test test/plugin-manifests.test.mjs test/contract-parity.test.mjs test/repo-index.test.mjs`
- Surface integration verification: `npm run check`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 2: push feature branch and merge dev PR

- Task ID: `dev-pr`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`) / main
- Effective model: session (main)
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `bump-and-test`
- Contract: `chore/release-2.2.2` 브랜치에 커밋·푸시 후 `chore/release-2.2.2` → `dev` PR을 생성하고 exact head SHA의 CI `check` 통과를 확인한 뒤 `--match-head-commit`으로 병합한다.
- Module acceptance verification: `gh pr checks <dev-pr> --watch` (required `check` pass)
- Surface integration verification: `gh pr view <dev-pr> --json state,mergeCommit` (`MERGED`)
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 3: Antigravity-only `open_pota_dag` auto-open guidance (S1)

- Task ID: `dag-auto-open`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`)
- Effective model: `flash (unreported)`
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Assigned agent ID: `f39333cf-7398-4f48-9da8-5599229c2ff8`
- Depends on (task ids): `dev-pr`
- Write scope: `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, `skills/pota-plan/planning-rules.md`, `docs/model-guidance/README.md`, `scripts/pota-dag-mcp-core.mjs`, `test/token-efficiency.test.mjs`
- Contract:
  1. `skills/pota-plan/SKILL.md` (<= 9,000B 엄수): Step 4(`goal start`) 직후에 Antigravity 전용으로 `open_pota_dag` MCP 도구가 노출되어 있을 때 호출하고 Claude Code·Codex에서는 건너뛰라는 간결한 지침을 추가한다(기존 테스트 문자열·바이트 예산 보존).
  2. `skills/pota-work/SKILL.md` (<= 9,000B 엄수): Step 2에서 활성 goal 재개/갱신 시 Antigravity에서 `open_pota_dag`가 노출되어 있으면 호출(Claude Code·Codex 제외)하도록 간결히 추가한다(기존 테스트 문자열·바이트 예산 보존).
  3. `skills/pota-plan/planning-rules.md` & `docs/model-guidance/README.md`: Antigravity 전용 규칙 정본을 기록한다(`goal start` 직후 및 활성 goal 재개 시 `pota_pota-dag`의 `open_pota_dag`를 `{"root": "<repoRoot>"}`로 호출, 메인 에이전트만 수행, 도구 미노출 시 실패/차단 금지, Claude Code·Codex 제외).
  4. `scripts/pota-dag-mcp-core.mjs`: `DEFAULT_SERVER_VERSION` fallback을 `"2.2.2"`로 갱신한다.
  5. `test/token-efficiency.test.mjs`: 위 4개 문서 표면이 Antigravity 전용 `open_pota_dag` 자동 호출 및 Claude Code·Codex 제외를 명시함을 검증하는 회귀 테스트를 추가한다.
- Module acceptance verification: `node --test test/token-efficiency.test.mjs test/contract-parity.test.mjs test/antigravity-dag-mcp.test.mjs`
- Surface integration verification: `npm run check`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 4: Antigravity `pota-dag` MCP liveness check and auto-recovery (S2)

- Task ID: `dag-mcp-auto-recover`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`)
- Effective model: `flash (unreported)`
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Assigned agent ID: `79397e8e-0594-454f-a574-5c2d7300b18e`
- Depends on (task ids): `dag-auto-open`
- Write scope: `scripts/pota-state-antigravity.mjs`, `scripts/pota-dag-mcp.mjs`, `skills/pota-plan/planning-rules.md`, `docs/model-guidance/README.md`, `test/antigravity-dag-mcp.test.mjs`
- Contract:
  1. `scripts/pota-state-antigravity.mjs`: `<POTA_HOME>/hosts/antigravity-dag/server.json` 경로(`dagMcpServerStatePath`)와 `recordDagMcpServerPid`, `clearDagMcpServerPid`, `ensureAntigravityDagMcp({ env, now, force, fetchImpl, isPidAlive })`를 추가한다.
     - `POTA_ANTIGRAVITY_DAG_REFRESH=0|false|off|no`이면 `{ status: "skipped", reason: "disabled" }`.
     - `ANTIGRAVITY_CSRF_TOKEN`이 없으면 `{ status: "skipped", reason: "no-csrf-token" }` (테스트·비-Antigravity 환경 네트워크 무접근).
     - `server.json`의 `pid`가 살아 있으면(`isPidAlive(pid)` -> `process.kill(pid, 0)`) `{ status: "alive", pid }` 반환(정상 서버 재시작 금지).
     - 최근 `lastRefreshAt`이 30초 미만이고 `!force`이면 `{ status: "throttled" }`.
     - `ANTIGRAVITY_LS_ADDRESS`(기본 `localhost:5387`)는 반드시 loopback 호스트(`localhost`, `127.0.0.1`, `[::1]`, `::1`)만 허용하며 외부 호스트면 `{ status: "skipped", reason: "non-loopback-address" }`로 차단한다(토큰 유출 방지).
     - 조건 충족 시 `lastRefreshAt`을 기록하고 `http://<addr>/exa.language_server_pb.LanguageServerService/RefreshMcpServers`에 `{"serverName":"pota_pota-dag"}`와 `x-codeium-csrf-token` 헤더로 POST(1500ms timeout, 예외·오류 시 throw 없이 `{ status: "failed" }` 반환, 토큰 로그 금지).
     - `runAntigravityHook`의 `session-start`와 `pre-invocation(invocationNum === 0)`에서 `ensureAntigravityDagMcp`를 비차단(`.catch(() => {})`)으로 호출한다.
  2. `scripts/pota-dag-mcp.mjs`:
     - CLI stdio 서버 기동 시 `recordDagMcpServerPid()`로 PID를 기록하고 정상 종료 시 자기 PID일 때만 `clearDagMcpServerPid()`를 호출한다.
     - CLI 진입부에 `uncaughtException`/`unhandledRejection` 방어를 추가해 일시적 오류로 서버가 뻗거나 stdout JSON-RPC 프레이밍이 오염되지 않게 한다.
     - `node "<pluginRoot>/scripts/pota-dag-mcp.mjs" ensure [--force]` 하위 명령을 지원해 `ensureAntigravityDagMcp` 결과 JSON을 출력한다.
  3. `skills/pota-plan/planning-rules.md` & `docs/model-guidance/README.md`: Antigravity에서 `open_pota_dag` 호출이 MCP 중단/연결 실패로 실패하면 `node "<pluginRoot>/scripts/pota-dag-mcp.mjs" ensure` 실행 후 1회 재시도하라고 한 문장 보강한다(Claude Code·Codex 제외).
  4. `test/antigravity-dag-mcp.test.mjs`: alive 스킵, dead PID/파일 부재 시 refresh, 30초 스로틀, CSRF 토큰 미설정 시 스킵, 비-loopback 주소 거부(SSRF/토큰 유출 방어), `POTA_ANTIGRAVITY_DAG_REFRESH=0` 비활성화, HTTP 500/네트워크 실패 시 비차단 실패 반환, `ensure` CLI 출력, `runAntigravityHook` 연동 및 `hosts/antigravity/` 세션 파일 수 무영향을 검증하는 테스트를 추가한다.
- Module acceptance verification: `node --test test/antigravity-dag-mcp.test.mjs test/antigravity-hooks.test.mjs`
- Surface integration verification: `npm run check`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 5: merge S1/S2 dev PR

- Task ID: `dev-pr-s1`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`) / main
- Effective model: session (main)
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `dag-mcp-auto-recover`
- Contract: `feat/antigravity-dag-auto-open` 브랜치를 커밋·푸시하고 `dev` PR을 생성해 CI `check` 통과 후 `--match-head-commit`으로 병합한다.
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 6: merge dev -> main PR and push v2.2.2 tag

- Task ID: `main-pr`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`) / main
- Effective model: session (main)
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `dev-pr-s1`
- Contract: `dev` → `main` 릴리스 PR #31이 S1/S2 병합 커밋을 포함한 exact head SHA로 CI `check`를 통과하면 `--match-head-commit`으로 병합한다. 이어서 `origin/main`을 fetch해 병합 커밋에 `v2.2.2` 태그를 생성·푸시하고 `git ls-remote --tags origin v2.2.2` 및 `main` PR 병합 상태를 확인한다.
- Module acceptance verification: `gh pr checks <main-pr> --watch` (required `check` pass)
- Surface integration verification: `gh pr view <main-pr> --json state,mergeCommit` (`MERGED`) 및 `git ls-remote --tags origin v2.2.2`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

## Evidence

- Dry-run or check:
  - `claude plugin validate .` 통과 (✔ Validation passed)
  - `HOME=<tmp> agy plugin validate .` 통과 (✔ Validation passed with 1 warning: `hooks/hooks.json: never loaded`)
  - `node scripts/pota.mjs doctor` 통과 (`OK version surfaces: 2.2.2`)
  - `pota plan index --archive` (1건 아카이브) + `pota plan check --strict` + `pota memory check --strict` 통과 (`ok: true`, errors 0, warnings 0)
- Tool readiness: `node`, `npm`, `typescript-language-server`, `tsc`, `gh`, `claude`, `agy` 모두 OK (`pota toolcheck`).
- Tests:
  - `bump-and-test` 집중 테스트: `node --test test/plugin-manifests.test.mjs test/contract-parity.test.mjs test/repo-index.test.mjs` 통과 (`moduleAcceptance` 바인딩)
  - `dag-auto-open` (S1): `wc -c skills/pota-plan/SKILL.md` (8,659B <= 9,000B), `skills/pota-work/SKILL.md` (8,743B <= 9,000B); `test/token-efficiency.test.mjs`·`contract-parity`·`plugin-manifests`·`antigravity-dag-mcp` 47/47 통과
  - `dag-mcp-auto-recover` (S2): `node --test test/antigravity-dag-mcp.test.mjs test/antigravity-hooks.test.mjs test/plugin-manifests.test.mjs test/token-efficiency.test.mjs` 51/51 통과
  - 전체 저장소 검증: `npm run check` 통과 (`surfaceIntegration` 바인딩)
- Module acceptance: `triage-plan` (`planArtifact|triageDecision`) 및 `bump-and-test` (`moduleAcceptance`) `goal verify` exit 0 통과.
- Surface integration: `bump-and-test` (`npm run check`) `goal verify` exit 0 통과; `dev-pr` 및 `main-pr` CI·병합·`v2.2.2` 태그 검증은 후속 `goal verify` 및 `goal finish`로 완료.
- Goal final review evidence record: `main-pr` 완료 후 `goal finish`로 완료.
- Memory promotion: none: 기존 `docs/memory/release-process.md`와 `docs/memory/lifecycle-install.md` 절차 범위 내 패치 릴리스이며 새로운 도메인 규칙 변경이 없음.
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
