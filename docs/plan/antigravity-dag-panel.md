# Plan: Antigravity Pota DAG 사이드바/보조 패널 (MCP App)

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-23)
- Finalized: decision-complete for `heavy-design` and implementation after planned triage (`heavy-design` 결과를 `## Heavy Design`에 반영한 뒤 구현 시작). (2026-11-23)
- Codex UI synchronization: Codex의 `update_plan` / `create_goal` 도구는 Antigravity 호스트에 없음 (unavailable). 대신 Antigravity의 `update_steps`로 단계 상태를 동기화한다.

## Goal

Antigravity 플러그인에 MCP App 기반의 Pota DAG 사이드바(`global`) 및 보조 패널(`aux_pane`)을 추가한다. 기존 `hooks/dag-*.mjs` 순수 모듈을 재사용해 Claude Code Pota DAG 패널과 유사한 화면·UX로 현재 Pota goal의 wave별 DAG, 요약, 보기 전환 4개, 실행 중/막힘/다음 대기 목록을 보여 주고 갱신한다.

- Goal ID: `goal-d109dfe1-a693-474e-b2c7-99e63eddebf5`
- Plan ID: `docs/plan/antigravity-dag-panel.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version; do not record a user-specific absolute plugin path.
- Completion criteria (advisory text; Pota does not enforce it — completion is gated only by required evidence): Antigravity 플러그인에 `mcp_config.json`과 Pota DAG MCP App 서버/UI가 포함되고, 기존 `hooks/dag-*.mjs` 모듈을 재사용하며, `agy plugin validate .`와 `npm run check`가 통과한다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled` (an `active` goal is never complete).

## Request Brief

- Original request: "pota dag 기능을 사이드 바로 띄울 수 있겠네?" -> "만들어줘" -> "claude code의 pota dag 사이드바와 비슷한 느낌으로 구현되는거지?"
- Interpreted outcome: Antigravity에서 Pota 플러그인을 활성화하면 좌측 사이드바(`global`)와 우측 보조 패널(`aux_pane`)에서 Pota DAG를 열 수 있고, Claude Code Pota DAG 패널과 유사한 구성(상단 요약, 보기 4개 `이전`/`현재`/`다음`/`전체`, 새로고침, wave별 DAG SVG, 하단 실행 중/막힘/다음 대기 목록, 상세 펼치기 및 관련 파일 열기)으로 현재 저장소의 Pota goal 상태를 보여 주고 주기적으로 갱신한다.
- Scope: 루트 `mcp_config.json`, Zero-dependency Node MCP App 서버(`scripts/pota-dag-mcp.mjs`, `scripts/pota-dag-mcp-core.mjs`), 단일 HTML UI 생성기(`scripts/pota-dag-app-html.mjs`), Antigravity 훅 활성 워크스페이스 기록 연동(`scripts/pota-state-antigravity.mjs`, 기존 `hosts/antigravity/` 세션 파일 계약 비간섭), `package.json` `check` 스크립트 갱신, 자동화 테스트(`test/antigravity-dag-mcp.test.mjs`, `test/plugin-manifests.test.mjs`), 필요 시 `docs/memory/lifecycle-install.md` 갱신, 및 S1 추가분(Antigravity에서 완료된 서브에이전트를 `manage_subagents(kill)`로 닫지 않도록 정책 표면 `skills/pota-{plan,work}/delegation.md`, `docs/model-guidance/README.md`, `test/token-efficiency.test.mjs` 보완).
- Non-scope: 버전 범프·npm/GitHub 릴리스(별도 요청 시 진행), Claude Code mod(`hooks/register.tsx`) UI 변경, Codex 호스트 화면, 외부 npm 런타임 의존성 추가.
- Prior records:
  - `pota plan steering --root /Users/wknam/workspace/pota-harness`: 2개 계획에서 총 7건의 스티어링 확인(`plugin-native-install.md`, `request-brief-steering.md`). 반복 패턴으로 기능 구현 뒤 릴리스/로컬 설치본 확인을 별도 요청하는 경향이 있으나, 본 요청에는 릴리스 지시가 없으므로 Non-scope로 두고 완료 후 릴리스/재설치 안내를 제공한다.
  - `docs/memory/lifecycle-install.md`: 저장소 루트가 3개 호스트의 플러그인 루트이며 플러그인 루트 안에 파일을 쓰면 안 되고 상태는 `<POTA_HOME>` 아래에만 써야 함; 경로로 spawn되는 새 스크립트는 `package.json` `check`에 추가; `plugin.json` 허용 키 12개 및 `hooks.json` 4개 이벤트 계약 고정; `agy plugin validate`는 `--strict` 없이 사용(`hooks/hooks.json` 경고 허용).
  - `docs/memory/hook-context.md`: `PreInvocation`/`SessionStart` 캡슐 문자 예산 엄격 유지(새 문구 추가 금지).
  - `docs/plan/claude-dag-panel.md`, `docs/plan/dag-open-running-task.md`: 순수 모듈 5개(`hooks/dag-*.mjs`) 인터페이스, 보기 4개(`all` 기본값, `previous`/`current`/`next`/`all`), SVG 위상 유지, 실행 중 카드 클릭 상세(`taskDetail`) 정책 재사용.
- Assumptions:
  - A1 (inferred): 우측 보조 패널(`aux_pane`)과 좌측 사이드바(`global`) 진입점을 모두 제공한다(직전 대화에서 두 진입점을 함께 안내했고 사용자가 승인함).
  - A2 (evidence): 저장소는 외부 런타임 의존성이 없는 Node `>=18` zero-dependency 플러그인이므로(`package.json`), MCP stdio 서버와 SEP-1865 `postMessage` 브리지는 Node stdlib 및 단일 HTML 인라인 JS로 외부 패키지 없이 구현한다.
  - A3 (evidence): `test/plugin-manifests.test.mjs`가 루트 `plugin.json` 허용 키 12개와 루트 `hooks.json` 4개 이벤트·명령 문자열을 고정하므로, `mcp_config.json`만 루트에 추가하고 `plugin.json`·`hooks.json`의 기존 계약은 유지한다.
  - A4 (evidence): `test/antigravity-hooks.test.mjs`의 `sessionFiles()`가 `<POTA_HOME>/hosts/antigravity/` 디렉터리의 전체 파일 수를 검증하므로, 최근 활성 워크스페이스 기록은 `hosts/antigravity/` 바깥(예: `<POTA_HOME>/hosts/antigravity-dag/workspaces.json`)에 저장해야 기존 테스트와 충돌하지 않는다.
  - A5 (inferred): Antigravity는 서브에이전트 트랜스크립트 전환 API를 제공하지 않으므로, 실행 중 task 클릭 시 상세 펼치기(`taskDetail`)와 `docs/plan`·`writeScope` 파일 열기(`com.google.antigravity/toggle-aux-pane`)를 제공한다.
- Implicit requirements:
  - 보안·CSP: HTML UI는 Antigravity 기본 CSP(`default-src 'none'`, 인라인 스크립트/스타일만 허용, 외부 fetch/CDN 금지) 안에서 완전히 동작해야 한다.
  - XSS/주입 방어: goal 제목·task 제목·blocker·writeScope·파일 경로 등 모든 사용자/저장소 문자열은 HTML/SVG 삽입 시 철저히 이스케이프(`textContent` 또는 `escapeXml`)하고, `toggle-aux-pane`의 `file://` URI는 검증된 저장소 루트 하위 경로만 허용한다(경로 탈출·임의 프로토콜 차단).
  - 경로·심볼릭 링크 방어: `<POTA_HOME>` 아래 상태 파일 읽기/쓰기는 `pota-safe-fs.mjs`의 `assertNoSymlinkComponents`/`safeWriteFile` 규약을 따르고, 플러그인 루트에는 어떤 파일도 쓰지 않는다.
  - 명령 실행 경계: MCP 서버는 셸(`sh -c`) 없이 직접 모듈 호출(`scripts/pota-goal.mjs` / `readGoalState`·`getGoalStats`) 또는 인자 배열 기반 안전한 호출만 사용하며, 임의 명령 실행이나 시크릿 노출을 금지한다.
  - 장애 격리(fail-closed/graceful): MCP 서버 오류·빈 상태·종료된 goal·잘못된 root 인자 시 크래시하지 않고 구조화된 오류/빈 상태 응답을 반환한다.
- Open questions: none
- Steering log:
  - S1 (addition): "지금 수정하는 김에 그것도 작업해" -> Antigravity 호스트에서 완료된 서브에이전트를 `manage_subagents(kill)`로 종료해 UI에 `Cancelled`로 표시되는 문제를 막도록 정책 표면(`skills/pota-plan/delegation.md`, `skills/pota-work/delegation.md`, `docs/model-guidance/README.md`, `test/token-efficiency.test.mjs`)을 보완하는 `policy-subagent-close` 태스크를 `verify` 앞에 추가.
- Current request (as of S0): Antigravity 플러그인에 MCP App 기반의 Pota DAG 사이드바(`global`) 및 보조 패널(`aux_pane`)을 구현하여, Claude Code의 Pota DAG 패널과 비슷한 느낌으로 기존 `hooks/dag-*.mjs` 모듈을 재사용해 현재 Pota goal 상태를 시각화하고 갱신한다.

## Whole Work

- Outcome: Antigravity 네이티브 플러그인에 `mcp_config.json` + zero-dependency Node MCP App 서버와 단일 HTML UI(`ui://pota-dag/app.html`)를 추가해 좌측 사이드바(`global`) 및 우측 보조 패널(`aux_pane`)에서 Pota DAG를 실시간 조회·조작할 수 있게 한다.
- Affected surfaces:
  - `mcp_config.json` (신규: Antigravity MCP 서버 등록)
  - `scripts/pota-dag-mcp.mjs` (신규: stdio JSON-RPC 2.0 MCP 서버 엔트리포인트)
  - `scripts/pota-dag-mcp-core.mjs` (신규: 워크스페이스 탐색, goal 상태/이력 조회, `dag-*.mjs` 결합, 툴/리소스 핸들러)
  - `scripts/pota-dag-app-html.mjs` (신규: `ui://pota-dag/app.html` 단일 HTML/CSS/JS 문서 생성기)
  - `scripts/pota-state-antigravity.mjs` (수정: `SessionStart`/`PreInvocation` 시 최근 활성 워크스페이스 메타데이터를 `<POTA_HOME>/hosts/antigravity-dag/workspaces.json`에 비간섭 기록)
  - `package.json` (수정: `check` 스크립트에 새 `scripts/pota-dag-*.mjs` `node --check` 추가)
  - `test/antigravity-dag-mcp.test.mjs` (신규: MCP 프로토콜·도구·리소스·HTML·보안·워크스페이스 해석 테스트)
  - `test/plugin-manifests.test.mjs` (수정: `mcp_config.json` 파싱·추적 파일 검증 추가)
  - `docs/memory/lifecycle-install.md` (필요 시 Antigravity `mcp_config.json` 표면 기록)
- Task classification: Heavy Path — `triage-plan` -> `heavy-design` -> (`mcp-backend` || `mcp-ui`) -> `tests-and-manifests` -> `verify`.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/lifecycle-install.md`
- `docs/memory/hook-context.md`
- `docs/memory/goal-state.md`
- `docs/memory/policy-surfaces.md`
- Related completed plans: `docs/plan/claude-dag-panel.md`, `docs/plan/dag-open-running-task.md`, `docs/plan/plugin-native-install.md`

## Model Guidance

- Applied model family: Gemini / Antigravity (common rules only; Claude/Codex 전용 조정 미적용).
- Referenced guidance:
  - `pota://docs/model-guidance/README.md`
- Rationale: 호스트가 Antigravity이며 `docs/model-guidance/README.md`에 따라 Claude/Codex 외 모델은 Common Rules를 적용한다.
- Role-specific adjustment: 탐색은 `flash_lite`, Heavy 설계·구현·최종 리뷰는 `pro`(Antigravity 최고 tier)로 위임한다.
- User-visible response and artifact locale: 한국어 (OS locale). 코드·주석·식별자는 저장소 관례(영어)를 따른다.

## Reasoning Effort Profile

- Model: Antigravity `invoke_subagent` `Model` enum 기준 — fast=`flash_lite`, balanced=`flash`, stronger=`pro`, strongest=`pro`.
- Heavy Path: planning/review=`high`, implementation=`high`, final verification/review=`xhigh` (호스트가 별도 effort 파라미터를 노출하지 않으므로 `Effective reasoning effort: inherited`).
- Every module task records Requested/Effective model and reasoning effort.

## Complexity Triage

- Selected path: Heavy Path (Planning checkpoint 확정).
- Selection rationale: 신규 MCP 서버 프로토콜 레이어(`scripts/pota-dag-mcp*.mjs`)와 단일 HTML UI 브리지(`scripts/pota-dag-app-html.mjs`), 신규 플러그인 매니페스트 표면(`mcp_config.json`), CSP/파일 URI/심볼릭 링크 보안 경계가 포함된다.
- Checkpoint ledger:
  - Request checkpoint: Heavy Path 잠정. 근거: 새 MCP App 서버·UI 모듈 추가, `mcp_config.json` 신규 표면, 훅 연동.
  - Planning checkpoint: Heavy Path 확정. 근거: `package.json` zero-dependency 확인(자체 MCP stdio + SEP-1865 `postMessage` 구현 필요), `test/plugin-manifests.test.mjs`·`test/antigravity-hooks.test.mjs`의 엄격한 계약 확인(`hosts/antigravity/` 파일 수 검사), `agy 1.5.14` 로더 검증 가능 확인.
  - Code checkpoint: 완료. 각 구현 워커(`mcp-backend`, `mcp-ui`, `tests-and-manifests`, `policy-subagent-close`)가 첫 편집 직전 대상 파일·호출자·테스트를 점검하고 각 태스크의 route(`heavy` / S1 `light`)를 확정함.
- Heavy Path signals checked:
  - New directory/module/layer: 있음 (`mcp_config.json`, MCP App 서버 및 UI 레이어)
  - New domain model/service/abstraction: 있음 (MCP stdio JSON-RPC 서버, SEP-1865 브리지, 워크스페이스 레지스트리)
  - Security/auth/session: 있음 (iframe 기본 CSP, XSS 방어, `file://` URI 경로 검증, symlink 방어)
  - External API/message queue/payment: 없음 (로컬 stdio MCP + iframe `postMessage`)
  - DB schema/migration: 없음
  - Concurrency/transaction/cache invalidation: 있음 (훅의 워크스페이스 파일 원자적 쓰기·읽기)
  - Cross-domain refactor: 없음
  - Explicit extra-care signal: 없음
- Heavy Path trigger, if selected: 새 MCP App 서버/UI 레이어, 프로토콜/보안 경계, 원자적 상태 공유.
- Pre-implementation decisions (`heavy-design`에서 확정):
  1. MCP stdio JSON-RPC 2.0 서버 프레이밍·메서드·에러 코드 계약 및 `open_pota_dag` / `pota_dag_state` 도구 스키마·`_meta` 구조(`ui.resourceUri`, `ui.visibility`, `com.google.antigravity/ui.entrypoints`).
  2. `ui://pota-dag/app.html`의 SEP-1865 `postMessage` 브리지(프로토콜 버전 `2026-01-26`, 핸드셰이크, `ping` 응답, `tool-input`/`tool-result`/`host-context-changed`, `tools/call`, `size-changed`, `toggle-aux-pane`)와 렌더링/폴링/테마 매핑 설계.
  3. 워크스페이스 탐색 순서(명시 `root` -> 최근 활성 워크스페이스 기록 -> `<POTA_HOME>/projects` 활성 goal 스캔 -> `HARNESS_REPO_ROOT`)와 `scripts/pota-state-antigravity.mjs` 기록 파일 위치(`<POTA_HOME>/hosts/antigravity-dag/workspaces.json`) 및 원자적 쓰기 계약.
  4. `renderDagSvg()`의 반응형 폭 재계산 전략(서버에서 폭 인자로 재렌더 vs 클라이언트 폭 전달) 및 1 MiB trajectory 제한 준수 전략.

## Agent Assignments

- `explorer` (`research`, `Model: "flash_lite"`): `triage-plan` 영향 조사 완료 및 정리됨.
- `heavy-design` (`research`, `Model: "pro"`): 읽기 전용 Heavy 설계 전담.
- `worker` (`self`, `Model: "pro"`): `mcp-backend`, `mcp-ui`, `tests-and-manifests` 구현 태스크 전담.
- Local main session: 오케스트레이션, 상태 전이, `goal verify`, 최종 검증 및 리뷰.

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main (+ `explorer` `flash_lite`) | `heavy` | session / `flash_lite` | `high` (effective: `inherited`) |
| `heavy-design` | `research` (`heavy-design`) | `heavy` | `pro` | `high` (effective: `inherited`) |
| `mcp-backend` | `self` (`worker`) | `heavy` | `pro` | `high` (effective: `inherited`) |
| `mcp-ui` | `self` (`worker`) | `heavy` | `pro` | `high` (effective: `inherited`) |
| `tests-and-manifests` | `self` (`worker`) | `heavy` | `pro` | `high` (effective: `inherited`) |
| `verify` | main (+ `research` reviewer `pro`) | `heavy` | session / `pro` | `xhigh` (effective: `inherited`) |

## Tool Readiness

- Detected stack: `javascript`, `typescript`
- Toolcheck command: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" toolcheck --root "/Users/wknam/workspace/pota-harness"`
- Required LSP/symbol tools: `typescript-language-server` (OK)
- Required typecheck/lint/verification tools: `node` (OK), `npm` (OK), `tsc` (OK), `agy` 1.5.14 (`agy plugin validate .` OK)
- Missing tools: none
- Install approval: not needed
- Install/bootstrap commands proposed or attempted: none
- Tool blockers: none

## Execution Guardrails

- Test contract first: 각 구현 태스크는 요구사항, 불변식, 경계 조건, 실패 모드를 만족하는 단위/통합 테스트로 검증한다.
- Verification ladder: 모듈별 집중 `node --test` -> `agy plugin validate . --json` -> 최종 `npm run check` (`node --check` 전체 + `node --test` 전체).
- Dry-run or check mode before external-state mutation: `agy plugin validate . --json` 및 `node --check`로 플러그인 로더 호환성과 문법을 검증한다. 외부 원격 상태 변경(PR/push/publish)은 이번 범위 밖이다.
- Verification loop budget: 태스크당 최대 2회.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Requested model: stronger (`pro`)
- Effective model: session (main) + explorer `flash_lite (unreported)`
- Requested reasoning effort: `high`
- Effective reasoning effort: `inherited` (Antigravity 호스트는 effort 파라미터를 노출하지 않음)
- Contract: 저장소 메모리 노트, 과거 스티어링, 관련 완료 플랜, `package.json`, `test/plugin-manifests.test.mjs`, `test/antigravity-hooks.test.mjs`, `toolcheck`, `agy plugin validate .`를 조사하고 Heavy Path 계획과 로드맵을 확정한다.
- Required evidence records:
  - `planArtifact`: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" plan check --root "/Users/wknam/workspace/pota-harness"`
  - `triageDecision`: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" toolcheck --root "/Users/wknam/workspace/pota-harness"`

### Task 1: Heavy Path design

- Task ID: `heavy-design`
- Initial status: `pending`
- Kind: `design`
- Route: `heavy`
- Requested model: strongest (`pro`)
- Effective model: `pro (unreported)`
- Requested reasoning effort: `high`
- Effective reasoning effort: `inherited` (Antigravity `invoke_subagent` exposes `Model` tier only and no reasoning-effort option)
- Depends on (task ids): `triage-plan`
- Write scope: null (read-only design; main merges result into `## Heavy Design` of `docs/plan/antigravity-dag-panel.md`)
- Contract: 위 Pre-implementation decisions 4가지를 저장소 코드와 Antigravity MCP App 스펙(`mcp-app-development/SKILL.md`, SEP-1865)에 근거해 결정 완료 수준으로 설계하고, 모듈별 파일·함수 시그니처·데이터 계약·테스트 계약을 제시한다.
- Required evidence records:
  - `designRecord`: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" plan check --root "/Users/wknam/workspace/pota-harness"` (after merging `## Heavy Design` into this plan)

### Task 2: MCP server, workspace registry, and plugin wiring

- Task ID: `mcp-backend`
- Initial status: `pending`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Effective model: `pro (unreported)`
- Requested reasoning effort: `high`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `heavy-design`
- Write scope: `mcp_config.json`, `scripts/pota-dag-mcp.mjs`, `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-state-antigravity.mjs`, `package.json`
- Handoff files: `scripts/pota-dag-mcp-core.mjs` (UI payload shape consumed by `scripts/pota-dag-app-html.mjs` and tested by `test/antigravity-dag-mcp.test.mjs`)
- Contract: `## Heavy Design`에 따라 Zero-dep MCP stdio 서버, 워크스페이스 레지스트리 및 `dag-*.mjs` 연동 코어, Antigravity 훅의 활성 워크스페이스 비간섭 기록, 루트 `mcp_config.json`, `package.json` `check` 항목을 구현한다.
- Dry-run or check command: `node --check scripts/pota-dag-mcp.mjs && node --check scripts/pota-dag-mcp-core.mjs && node --check scripts/pota-state-antigravity.mjs && agy plugin validate . --json`
- Module acceptance verification: `node --check scripts/pota-dag-mcp.mjs && node --check scripts/pota-dag-mcp-core.mjs && node --check scripts/pota-state-antigravity.mjs`
- Surface integration verification: `node --test test/antigravity-hooks.test.mjs test/claude-mod.test.mjs`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 3: MCP App single-file HTML UI

- Task ID: `mcp-ui`
- Initial status: `pending`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Effective model: `pro (unreported)`
- Requested reasoning effort: `high`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `heavy-design`
- Write scope: `scripts/pota-dag-app-html.mjs`
- Handoff files: `scripts/pota-dag-app-html.mjs` (imported by `scripts/pota-dag-mcp-core.mjs`)
- Contract: `## Heavy Design`에 따라 `ui://pota-dag/app.html` 단일 자체 완결 HTML/CSS/JS 문서를 생성하는 모듈을 구현한다. SEP-1865 `postMessage` JSON-RPC 브리지, 라이트/다크 호스트 테마 변수 연동, 보기 전환 4개(`이전`/`현재`/`다음`/`전체` + 단축키 `1`~`4`), 새로고침·폴링, 워크스페이스 선택기, SVG 그래프 반응형 표시, 실행 중 task 상세 펼치기 및 파일 열기(`toggle-aux-pane`)를 구현한다.
- Dry-run or check command: `node --check scripts/pota-dag-app-html.mjs`
- Module acceptance verification: `node --check scripts/pota-dag-app-html.mjs`
- Surface integration verification: `node -e "import('./scripts/pota-dag-app-html.mjs').then(m => { const html = m.renderDagAppHtml(); if (!html.includes('ui/initialize') || !html.includes('<!DOCTYPE html>')) process.exit(1); })"`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 4: Automated tests, manifest checks, and memory note

- Task ID: `tests-and-manifests`
- Initial status: `pending`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Effective model: `pro (unreported)`
- Requested reasoning effort: `high`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `mcp-backend`, `mcp-ui`
- Write scope: `test/antigravity-dag-mcp.test.mjs`, `test/plugin-manifests.test.mjs`, `docs/memory/lifecycle-install.md`
- Contract: MCP stdio JSON-RPC 엔드투엔드 테스트, 워크스페이스 해석·보안(XSS/파일 URI/심볼릭 링크)·빈/종료 상태·보기 전환·HTML CSP 검증 테스트를 작성하고, `test/plugin-manifests.test.mjs`에 `mcp_config.json` 검증을 추가하며, 필요 시 `docs/memory/lifecycle-install.md`에 Antigravity `mcp_config.json` 표면을 기록한다.
- Dry-run or check command: `agy plugin validate . --json`
- Module acceptance verification: `node --test test/antigravity-dag-mcp.test.mjs`
- Surface integration verification: `node --test test/plugin-manifests.test.mjs test/antigravity-hooks.test.mjs test/antigravity-dag-mcp.test.mjs`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 5: Antigravity completed subagent close/kill policy wording (S1 addition)

- Task ID: `policy-subagent-close`
- Initial status: `pending`
- Route: `light`
- Requested model: balanced (`flash`)
- Effective model: `flash (unreported)`
- Requested reasoning effort: `medium`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `tests-and-manifests`
- Write scope: `skills/pota-plan/delegation.md`, `skills/pota-work/delegation.md`, `docs/model-guidance/README.md`, `test/token-efficiency.test.mjs`
- Contract: 완료된 서브에이전트를 정리할 때 호스트가 비파괴적 close/release 수단을 제공할 때만 닫고, Antigravity처럼 `manage_subagents(kill)`만 있어 종료 시 `Cancelled`로 표시되는 호스트에서는 완료된 서브에이전트를 kill하지 않고 유휴 상태로 두도록 `skills/pota-plan/delegation.md`, `skills/pota-work/delegation.md`, `docs/model-guidance/README.md`를 보완하고, `test/token-efficiency.test.mjs`에 회귀 테스트를 추가한다. 기존 정규식(`final report before leaving.*close or release`)과 `SKILL.md` 바이트 예산은 유지한다.
- Module acceptance verification: `node --test test/token-efficiency.test.mjs`
- Surface integration verification: `node --test test/contract-parity.test.mjs test/plugin-manifests.test.mjs`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

### Task 6: Final verification and read-only review

- Task ID: `verify`
- Initial status: `pending`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Effective model: `pro (unreported)`
- Requested reasoning effort: `xhigh`
- Effective reasoning effort: `inherited`
- Depends on (task ids): `policy-subagent-close`
- Write scope: `docs/plan/antigravity-dag-panel.md`, `PLAN.md`
- Contract: 전체 `npm run check`, `agy plugin validate . --json`, `pota plan check` 및 `pota memory check`를 실행하고, 읽기 전용 리뷰(`research` `pro`)를 수행해 결함이 없음을 확인한 뒤 `goal finish`로 완료한다.
- Module acceptance verification: `npm run check`
- Surface integration verification: `agy plugin validate . --json`
- Required evidence records:
  - `moduleAcceptance`
  - `surfaceIntegration`

## Heavy Design

- 작성: `heavy-design` 서브에이전트 (읽기 전용, 모델 `pro`, 시스템 프롬프트 ID `unreported`, 요청 effort `high`, 실효 effort `inherited`).
- 핵심 확인 사실 (설계를 좌우한 저장소 근거):
  1. `scripts/pota-goal.mjs`의 실제 export는 `readGoalState`, `goalStats`, `goalHistoryStats`이다. `goalStats()`는 매 호출마다 `workspaceFingerprint()`(`git ls-files`)를 동기 실행하므로 5초 폴링에서는 호출하지 않고, `readGoalState({ root })`와(goal 종료 시점에만) `goalHistoryStats({ root, limit: 5 })`를 in-process 호출한다.
  2. `state.json`과 `history.jsonl`은 `<POTA_HOME>/projects/<repositoryId>/worktrees/<worktreeId>/` 아래 해시 디렉터리에 저장되며 절대 경로 `root`를 보관하지 않으므로, `scripts/pota-state-antigravity.mjs`가 최근 활성 워크스페이스를 `<POTA_HOME>/hosts/antigravity-dag/workspaces.json`에 기록한다.
  3. `test/antigravity-hooks.test.mjs`의 `sessionFiles()`가 `<POTA_HOME>/hosts/antigravity` 전체 파일 개수를 검사하므로, 워크스페이스 레지스트리는 반드시 `hosts/antigravity/` 바깥인 `hosts/antigravity-dag/workspaces.json`에 둔다.
  4. `hooks/dag-svg.mjs`의 `:root` 변수는 HTML `<style>`에서 `:root[data-theme="light"]`·`:root[data-theme="dark"]`가 `hostContext.styles.variables`와 폴백으로 덮어쓰므로 `dag-svg.mjs` 무수정으로 Antigravity 라이트/다크 테마와 조화된다.
  5. `test/plugin-manifests.test.mjs`는 `git ls-files --cached`로 `isTracked`를 검사하므로, 신규 추적 파일은 검증 전 스테이징 또는 추적 확인이 필요하다.

### 1. 파일 배치 및 모듈 경계

- `mcp_config.json`: `{ "mcpServers": { "pota-dag": { "command": "node", "args": ["${PLUGIN_ROOT}/scripts/pota-dag-mcp.mjs"] } } }`.
- `scripts/pota-dag-mcp.mjs`: NDJSON stdio JSON-RPC 2.0 엔트리포인트 (`isCliEntry()` 가드, stdout 오염 전면 금지, 빈 줄 무시, `-32700`/`-32600` 응답, notification 무응답, `EPIPE` 정상 종료).
- `scripts/pota-dag-mcp-core.mjs`: 순수·테스트 가능한 MCP 라우터 (`createDagMcpServer`, `OPEN_POTA_DAG_TOOL`, `POTA_DAG_STATE_TOOL`, `DAG_RESOURCE_DESCRIPTOR`, `resolveSafeRepoFileUri`, `resolveWorkspace`). `hooks/dag-{model,text,svg,events}.mjs`와 `scripts/pota-goal.mjs` 직접 재사용, 워크스페이스별 `DagState` 캐시 및 `(seq, view, width, minute, locale)` SVG 메모이제이션으로 변화 없는 폴링 시 `svg.source` 바이트 동일성 보장.
- `scripts/pota-dag-app-html.mjs`: `DAG_APP_RESOURCE_URI = "ui://pota-dag/app.html"`, `DAG_APP_MIME_TYPE = "text/html;profile=mcp-app"`, `renderDagAppHtml({ title, version })`. 외부 URL·fetch·WebSocket 없이 기본 CSP(`default-src 'none'`) 완벽 준수.
- `scripts/pota-state-antigravity.mjs`: `workspaceRegistryPath`, `readWorkspaceRegistry`, `recordActiveWorkspace` 추가(`WORKSPACE_REGISTRY_SCHEMA_VERSION = 1`, 최대 16개, 30일 보관, 30초 쓰기 스로틀, `safeWriteFile`+`rename` 원자적 쓰기, symlink 거부). `session-start` 및 `pre-invocation(invocationNum === 0)`에서만 best-effort 호출.
- `package.json`: `scripts.check`에 `scripts/pota-dag-mcp.mjs`, `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-dag-app-html.mjs`의 `node --check` 추가.

### 2. MCP 프로토콜 및 Antigravity MCP App 계약

- 지원 메서드: `initialize` (협상 버전 `2025-11-25`/`2025-06-18`/`2025-03-26`/`2024-11-05`, capabilities `tools`+`resources`), `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read` (`-32002` on unknown URI), 미지원 메서드 `-32601`.
- 도구 2개:
  1. `open_pota_dag`: 모든 인자 optional (`root`, `view`, `locale`), `_meta.ui.resourceUri = "ui://pota-dag/app.html"`, `_meta.ui.visibility = ["model", "app"]`, `_meta["com.google.antigravity/ui"].entrypoints = [{ type: "aux_pane", title: "Pota DAG" }, { type: "global", title: "Pota DAG" }]`.
  2. `pota_dag_state`: 앱 전용 (`_meta.ui.visibility = ["app"]`), 인자 `root`, `view`, `width` (`240..1600`), `locale`, `forceEpoch`.
- 리소스: `ui://pota-dag/app.html`, `mimeType: "text/html;profile=mcp-app"`, `_meta: { ui: { prefersBorder: false } }`.
- `structuredContent` (900 KiB 안전 상한, trajectory 1 MiB 제한 준수): `schemaVersion: 1`, `seq`, `fetchedAt`, `minute`, `epoch`, `locale`, `view`, `width`, `root`, `rootLabel`, `workspaces[]`, `goal` (`planFileUri` 포함), `ended`, `summary`, `svg`, `empty`, `hiddenAfter`, `sections` (`running[]`에 `detailLines`+`files[]`, `blocked[]`, `next[]`, `more`), `error`, `messages`.

### 3. SEP-1865 `postMessage` 브리지 및 UI/테마 설계

- 핸들러(`window.addEventListener("message", ...)`, `event.source === window.parent` 검증) 선등록 후 `ui/initialize` (`protocolVersion: "2026-01-26"`, `appInfo`, `appCapabilities: {}`) → 응답 수신 시 `applyHostContext` 후 `ui/notifications/initialized` 송신.
- 호스트 `ping` 요청에 `{}` 즉시 응답, `ui/notifications/tool-input`·`tool-result`·`tool-cancelled`·`host-context-changed` 처리. `tool-result`에 `structuredContent` 누락 시 `pota_dag_state`로 자동 복구.
- 앱 → 호스트: `tools/call` 최대 4개 동시 요청 제한(초과 시 최신 요청 1개 coalesce, 15s 타임아웃), inline 전용 `ui/notifications/size-changed`(최대 800px), `com.google.antigravity/toggle-aux-pane` (`tabType: "fileView"`, `uri`, `-32601`/`isError` 시 비차단 토스트 표시).
- 화면: 상단 헤더(goal 제목, 상태 뱃지, `planId` 열기 버튼, 워크스페이스 선택기, blocker, 요약 줄) + 도구 모음(보기 4개 `이전`/`현재`/`다음`/`전체` 기본 `all` + 단축키 `1`~`4` + 새로고침) + SVG 그래프(`DOMParser` 안전 마운트 + 화이트리스트/금지 태그·속성 차단 + `ResizeObserver` 20px 양자화 150ms 디바운스 폭 재렌더) + 하단 섹션(실행 중 카드 클릭 상세 펼치기 + `writeScope` 파일 열기 버튼, 막힘, 다음 대기, 오류 줄).
- 폴링: `ended !== null` 중단, `active` 5s, 그 외 30s, 3회 이상 연속 실패 시 지수 백오프(최대 120s), `document.hidden` 스킵 및 재노출 시 즉시 갱신.

### 4. 워크스페이스 해석 및 보안 불변식

- 해석 순서: ① 명시적 절대 경로 `root` -> ② `<POTA_HOME>/hosts/antigravity-dag/workspaces.json` (live goal 있는 최근 워크스페이스 우선, 없으면 최근 유효 디렉터리) -> ③ `HARNESS_REPO_ROOT` -> ④ 빈 상태 폴백 (`root: null`; **`process.cwd()`/`PLUGIN_ROOT`로 절대 폴백 금지**).
- XSS: 모든 동적 텍스트 `textContent` 전용, SVG는 `escapeXml` + 클라이언트 `DOMParser` 검증.
- `resolveSafeRepoFileUri(root, candidatePath)`: 상대 경로만 허용, `..`/NUL/glob 거부, `workspaceRoot`부터 대상까지 모든 세그먼트 `lstatSync` symlink 거부, `isFile()` 확인, `realpathSync` 범위 재확인 후 `pathToFileURL(target).href` 반환.
- `child_process` 미사용, 플러그인 루트 쓰기 전면 금지.

### 5. 테스트 계약

- `test/antigravity-dag-mcp.test.mjs`: stdio E2E 수명주기, MCP App 메타/리소스 계약, 비간섭 워크스페이스 레지스트리 & symlink 방어 & 우선순위, 보기 전환·폭 레이아웃·연속 폴링 SVG 불변·종료 상태·오류/1 MiB 제한, XSS/`file://` URI/HTML CSP 검증.
- `test/plugin-manifests.test.mjs`: `mcp_config.json` 파싱·서버 명령·`scripts/pota-dag-mcp.mjs` 추적 확인 + `package.json` `scripts.check` 검증.

## Evidence

- Dry-run or check: `agy plugin validate . --json` 통과 (`hooks: 1`, `mcpServers: 1`, `skills: 4`, 기존 `hooks/hooks.json` 경고 1건 외 오류 0건), `tsc --noEmit -p tsconfig.json` 통과, `pota plan check`·`pota memory check` 통과 (`ok: true`, errors 0, warnings 0).
- Tool readiness: `node`, `npm`, `typescript-language-server`, `tsc` 모두 OK (`pota toolcheck`).
- Tests:
  - `mcp-backend`: `node --check scripts/pota-dag-mcp.mjs scripts/pota-dag-mcp-core.mjs scripts/pota-state-antigravity.mjs` (exit 0), `node --test test/antigravity-hooks.test.mjs test/claude-mod.test.mjs` (41/41 pass).
  - `mcp-ui`: `node --check scripts/pota-dag-app-html.mjs` (exit 0), HTML/SEP-1865/CSP 정적 및 `vm` 동작 검증 통과.
  - `tests-and-manifests`: `node --test test/antigravity-dag-mcp.test.mjs test/plugin-manifests.test.mjs test/antigravity-hooks.test.mjs` (29/29 pass).
  - `policy-subagent-close`: `node --test test/token-efficiency.test.mjs test/contract-parity.test.mjs test/plugin-manifests.test.mjs` (40/40 pass).
  - Final full check: `npm run check` (`verify` 게이트 및 `goal finish`로 최종 바인딩).
- Module acceptance: 전 태스크 `goal verify --kind moduleAcceptance` exit 0 통과.
- Surface integration: 전 태스크 `goal verify --kind surfaceIntegration` exit 0 통과 (`agy plugin validate . --json` 포함).
- Goal final review evidence record: `Final Code Reviewer` (`research`, `pro`, `unreported`, `xhigh`/`inherited`) 읽기 전용 적대적 리뷰 `APPROVE` (Blocker 0건). 잔여 리스크: 실제 Antigravity 호스트 UI 내부에서의 `ui://pota-dag/app.html` iframe 렌더링, `global`/`aux_pane` 진입점 클릭, `toggle-aux-pane` 파일 탭 열기, 호스트 테마 실시간 전환은 플러그인 재설치/새로고침 후 실사용 스모크로 최종 확인 필요.
- Memory promotion: `docs/memory/lifecycle-install.md` (Antigravity `mcp_config.json`, `scripts/pota-dag-*.mjs`, `<POTA_HOME>/hosts/antigravity-dag/workspaces.json` 표면 기록 완료).
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
