# Plan: ChatGPT Desktop / Codex Pota DAG MCP App 지원 및 2.3.0 릴리스

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-24)
- Finalized: decision-complete for implementation after `triage-plan` and `heavy-design`. (2026-11-24)
- Host handoff (2026-11-24): Antigravity 세션이 쿼터 한도로 `s2-mcp-ui-and-action` 도중 중단됐다. Claude Code 세션이 `goal claim`으로 소유권을 인수해 이어서 진행한다. 이후 위임은 Claude Code 값(stronger=`opus`, effort host 옵션)을 쓴다.
- Codex UI synchronization: Codex의 `update_plan` / `create_goal` 도구는 Antigravity 호스트에 없음 (unavailable). 대신 Antigravity의 `update_steps`로 단계 상태를 동기화한다.

## Goal

ChatGPT Desktop / Codex 플러그인(`.codex-plugin/plugin.json` + `.codex-plugin/mcp.json`)에서 기존 `scripts/pota-dag-mcp.mjs` MCP App 서버를 로컬 `stdio`로 연결하고, `scripts/pota-dag-mcp-core.mjs`와 `scripts/pota-dag-app-html.mjs`에 OpenAI Apps SDK(`openai/outputTemplate`, `openai/ui`, `window.openai` 듀얼 브리지) 호환과 Codex 훅 활성 워크스페이스 기록을 추가해 Antigravity와 동일한 Pota DAG UI를 표시할 수 있게 구현한 뒤 Pota `2.3.0`으로 `dev` PR·`main` PR·`v2.3.0` 태그 릴리스까지 완료한다.

- Goal ID: `goal-996d9e71-66fe-480a-8006-91ddf2d4bf01`
- Plan ID: `docs/plan/chatgpt-codex-dag-panel.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version; do not record a user-specific absolute plugin path.
- Completion criteria (advisory text; Pota does not enforce it — completion is gated only by required evidence): `.codex-plugin/mcp.json`과 `.codex-plugin/plugin.json` `mcpServers`가 Claude Code·Antigravity와 충돌 없이 연결되고, `pota-dag-mcp-core.mjs`·`pota-dag-app-html.mjs`가 SEP-1865와 `window.openai` 듀얼 브리지를 모두 지원하며, Codex 훅이 활성 워크스페이스를 기록하고, 4개 버전 표면 `2.3.0` 및 전체 검증(`npm run check`, `claude plugin validate`, `agy plugin validate`, CI `check` + `host-validate`의 `@openai/codex` 설치 검증)을 통과해 `dev` PR·`main` PR·`v2.3.0` 태그로 배포된다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled` (an `active` goal is never complete).

## Request Brief

- Original request: "chatgpt desktop 앱에서도 antigravity와 같은 pota dag를 표시하게 구현해서 2.3.0으로 릴리즈 해줘"
- Interpreted outcome: OpenAI ChatGPT Desktop / Codex 로컬 플러그인(`.codex-plugin/plugin.json`)에서 로컬 `stdio` MCP App(`pota-dag`)을 연결하고, 서버 메타데이터(`_meta.ui` + `_meta["openai/*"]`)와 HTML 클라이언트(SEP-1865 `postMessage` + `window.openai` 듀얼 브리지) 및 Codex 훅 워크스페이스 추적·스킬 지침을 통합 지원한 뒤 버전 `2.3.0`으로 `dev` PR 및 `main` PR 병합과 `v2.3.0` 태그를 배포한다.
- Scope: `.codex-plugin/mcp.json`(신규), `.codex-plugin/plugin.json`, `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-dag-app-html.mjs`, `scripts/pota-state.mjs`, `scripts/pota-state-antigravity.mjs`(또는 공용 워크스페이스 레지스트리 모듈), `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, `skills/pota-plan/planning-rules.md`, `docs/model-guidance/README.md`, `docs/memory/lifecycle-install.md`, `package.json`, `.claude-plugin/plugin.json`, `plugin.json`, `test/antigravity-dag-mcp.test.mjs`, `test/plugin-manifests.test.mjs`, `test/contract-parity.test.mjs`, `test/token-efficiency.test.mjs`, `docs/plan/chatgpt-codex-dag-panel.md`, `PLAN.md`, `docs/plan/ARCHIVE.md`, `dev` PR, `main` PR, `v2.3.0` 태그.
- Non-scope: 원격 HTTPS 서버 호스팅, Claude Code DAG mod(`hooks/register.tsx`) 변경, `hooks/codex.json` 선언 변경(Codex 훅 재승인 회피), npm 게시, 로컬 설치본 강제 교체(별도 요청 시 수행).
- Prior records:
  - `pota plan steering`: 2.2.2까지의 누적 스티어링 확인(Claude Code는 자체 DAG mod `hooks/register.tsx` 사용하므로 MCP DAG 호출 제외, 완료 서브에이전트는 유휴 유지, 로컬 설치본은 별도 요청 시만 교체).
  - `docs/plan/antigravity-dag-panel.md`: `mcp_config.json`, `scripts/pota-dag-mcp*.mjs`, `scripts/pota-dag-app-html.mjs`, `<POTA_HOME>/hosts/antigravity-dag/workspaces.json` 및 `test/antigravity-dag-mcp.test.mjs` 구조 재사용.
  - `docs/memory/lifecycle-install.md`·`policy-surfaces.md`·`release-process.md`: `hooks/codex.json` 선언 변경 금지, `skills/pota-{plan,work}/SKILL.md` 9,000B 상한, 4개 버전 표면 일치, `PLAN.md` 완료 항목 20개 초과 시 `pota plan index --archive`, CI `host-validate`의 `@openai/codex@0.171.0` 실제 설치 확인.
- Assumptions:
  - A1 (evidence): OpenAI 공식 문서 기준 ChatGPT Desktop / Codex 데스크톱 전용 플러그인은 `.codex-plugin/plugin.json`의 `mcpServers` 상대 경로(`./...`)를 통해 로컬 `stdio` MCP 서버(`${PLUGIN_ROOT}` 사용)를 선언하며, UI는 `text/html;profile=mcp-app` + `ui://` + `_meta.ui.resourceUri` / `_meta["openai/outputTemplate"]` + `window.openai` / SEP-1865 `postMessage`를 사용한다.
  - A2 (evidence): 루트 `.mcp.json`은 Claude Code가 자동 탐색하므로 `.codex-plugin/mcp.json`에 두어 Claude Code(자체 `hooks/register.tsx` DAG mod 사용) 및 Antigravity(루트 `mcp_config.json` 사용)와 완전히 격리한다.
- Implicit requirements: 기본 CSP(`default-src 'none'`) 준수, XSS 이스케이프 및 `file://` URI 경로 검증 유지, `hooks/codex.json` 변경 금지, `skills/pota-{plan,work}/SKILL.md` 9,000B 예산 엄수, `pota-state.mjs` 순환 import 금지, `PLAN.md` 완료 항목 20개 초과 시 아카이브.
- Open questions: none
- Steering log:
  - S1 (correction): "2.3.0 범프, 배포는 일단 안하고, 추가 구현을 할거야." -> `release-prep-2.3.0`·`dev-pr`·`main-pr`의 버전 2.3.0 범프 및 PR/태그 배포를 보류하고, 현재 구현·테스트(`dag-and-manifest-tests`) 완료 후 사용자의 추가 구현 요청을 반영할 때까지 로컬 검증 상태로 유지한다.
  - S2 (addition): "네가 제안한 전체를 다 구현해줘. 그걸 2.3.0으로 배포하는거야. 참고로 npm으로 배포하는게 아니라 github에 main 병합이 배포야." -> 3개 호스트(Antigravity, ChatGPT/Codex, Claude Code) 공통으로 (1) Antigravity `transcript.jsonl` 기반 실제 모델·effort·토큰 보강, (2) 전체 노드 인라인 인스펙터(에이전트/모델/effort + 증거 영수증 `receipts[]` + `writeScope` Git Diff 요약 + Antigravity/ChatGPT 후속 요청 버튼), (3) Human-in-the-Loop 제어(Goal 일시정지/재개 + 대기 태스크 수동 승인 게이트 `pota goal gate`), (4) 상단 멀티 뷰 4탭(`DAG`/`Diff`/`Plan`/`에이전트·통계`)을 `heavy-design-s2` 설계 후 구현·테스트하고, 버전 `2.3.0`으로 `dev` PR → `main` PR 병합 및 `v2.3.0` 태그로 배포한다(npm 게시 금지).
  - S3 (addition): "agy나 codex에서도 \"/dag\" 명령으로 pota dag를 열 수 있을까?" → "가능하면 넣어줘" -> `open_pota_dag`만 호출하는 얇은 스킬 `skills/dag/SKILL.md`를 추가한다(`dag-skill`). 호출 이름은 Antigravity `/dag`, Codex `$dag`(Codex는 플러그인이 슬래시 명령을 등록할 수 없어 `/dag` 그대로는 불가), Claude Code에서는 기존 mod `/dag`를 안내하고 `open_pota_dag`를 호출하지 않는다. 근거: Antigravity 문서(스킬이 `/<skill-name>` 슬래시 명령이 됨, workflows는 2026-11-01 이후 미지원), Codex 문서(스킬은 `$` 멘션·`/skills`, 내장 슬래시 명령만 존재). 실제 호스트 TUI에서의 노출은 미확인. 같은 날 사용자 확인: 릴리스는 `main` 병합과 `v2.3.0` 태그까지, npm 게시 없음.
  - S4 (correction): Claude 데스크톱 앱 스크린샷 "pota: 에이전트 대화를 열지 못했습니다: no main view here"와 함께 "claude에서 이런 문제도 있네" -> 데스크톱 앱에는 전환할 main view가 없어 `$.ui.view`가 모든 실행 중 카드를 거부한다. `hooks/register.tsx` `showView`가 거부(deny·예외)를 받으면 토스트 대신 그 태스크의 패널 내 인스펙터를 열고 거부 사유를 인스펙터의 `actionError` 줄에 표시한다(`claude-view-fallback`). `tests/pane.test.tsx`의 "a refusal is said" 기대값(토스트)을 인스펙터 대체로 바꾸는 것은 이 정정에 따른 의도된 계약 변경이다. 메인 보기 복귀 버튼(`back-main`)의 거부는 그대로 토스트로 알린다.
- Current request (as of S4): ChatGPT Desktop / Codex 듀얼 브리지 Pota DAG MCP App에 더해, Antigravity·ChatGPT(Codex)·Claude Code 3호스트 공통으로 (1) Antigravity 트랜스크립트 기반 실제 모델·effort·토큰 보강, (2) 전체 노드 인스펙터(증거 영수증·`writeScope` Diff·대화 후속 요청), (3) Goal 일시정지/재개 및 대기 태스크 수동 승인 게이트, (4) 상단 멀티 뷰 4탭(`DAG`/`Diff`/`Plan`/`에이전트·통계`), (5) Antigravity `/dag`·Codex `$dag` 진입 스킬 `skills/dag`를 구현하고, (6) Claude 데스크톱 앱에서 에이전트 보기가 거부될 때 패널 내 인스펙터로 대체하며, (7) 릴리스 전 리뷰 지적(모델에 노출되는 `open_pota_dag` 결과 축소, 게이트 값 명시 전달, 등록된 워크스페이스만 액션 허용, 폴링 경로의 동기 해시 제거, 게이트 안내 일관성, `.env*` 민감 판정, `showUntrackedFiles` 존중, README 문구)을 반영해 검증한 뒤 Pota `2.3.0`으로 `dev` PR·`main` PR 병합 및 `v2.3.0` 태그로 배포한다(npm 게시 없음).

## Whole Work

- Outcome: Antigravity와 ChatGPT Desktop / Codex 플러그인 모두가 동일한 Pota DAG MCP App 서버·UI를 통해 실시간 Pota goal DAG를 표시하며, Claude Code의 기존 mod 동작에 영향을 주지 않고 `2.3.0`으로 릴리스된다.
- Affected surfaces: Codex MCP 매니페스트, MCP App 서버/HTML 듀얼 브리지, Codex 훅 워크스페이스 레지스트리 연동, 스킬/정책/메모리 문서, 버전 4표면 및 회귀 테스트, `dev`/`main` PR 및 `v2.3.0` 태그.
- Task classification: Heavy Path — `triage-plan` → `heavy-design` → 구현 태스크들 → `verify` → `dev-pr` → `main-pr`.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/lifecycle-install.md`
- `docs/memory/policy-surfaces.md`
- `docs/memory/release-process.md`
- Related completed plans: `docs/plan/antigravity-dag-panel.md`, `docs/plan/release-2.2.2.md`, `docs/plan/plugin-native-install.md`

## Model Guidance

- Applied model family: Gemini / Antigravity (common rules only).
- Referenced guidance:
  - `pota://docs/model-guidance/README.md`
- Rationale: 호스트가 Antigravity이며 Common Rules를 적용한다.
- User-visible response and artifact locale: 한국어 (OS locale).

## Reasoning Effort Profile

- Model: Antigravity `invoke_subagent` `Model` enum 기준 — fast=`flash_lite`, balanced=`flash`, stronger=`pro`, strongest=`pro`.
- Heavy Path: planning/review=`high`, implementation=`high`, final verification/review=`xhigh` (`Effective reasoning effort: inherited`).

## Complexity Triage

- Selected path: Heavy Path (Request checkpoint 잠정).
- Selection rationale: 신규 플러그인 MCP 매니페스트 표면(`.codex-plugin/mcp.json`), iframe 보안 경계 안의 듀얼 프로토콜 브리지(`window.openai` + SEP-1865), 호스트 간 워크스페이스 상태 공유가 포함된다.
- Checkpoint ledger:
  - Request checkpoint: Heavy Path 잠정.
  - Planning checkpoint: Heavy Path 확정. 근거: `.codex-plugin/mcp.json` 신규 매니페스트 표면, `scripts/pota-dag-app-html.mjs`의 `window.openai` + SEP-1865 듀얼 브리지(iframe CSP/보안 경계), `scripts/pota-state.mjs`의 Codex 훅 워크스페이스 기록 연동(`pota-state-antigravity.mjs`와의 순환 import 회피 필요), `test/plugin-manifests.test.mjs`·`test/token-efficiency.test.mjs`·`test/contract-parity.test.mjs` 계약 확인 완료.
  - Code checkpoint: Heavy Path 유지. Antigravity 워커들이 S1·S2 구현 태스크를 이 경로로 수행했다. 인수 시점(2026-11-24) 재확인: `scripts/pota-dag-mcp-core.mjs`·`scripts/pota-dag-app-html.mjs` `node --check` 통과, `test/antigravity-dag-mcp.test.mjs`는 `tools/list` 3종 기대값 1건만 실패(S2 설계 5의 의도된 계약 변경), HTML 클라이언트의 탭·인스펙터·`pota_dag_action` 호출 로직 미구현 확인. 새 Heavy 신호 없음.
- Heavy Path trigger, if selected: 신규 호스트 MCP 매니페스트, 샌드박스 iframe 듀얼 호스트 프로토콜 브리지, 크로스 호스트 상태 공유.
- Pre-implementation decisions (`heavy-design`에서 확정):
  1. `.codex-plugin/mcp.json` 경로·스키마(`.codex-plugin/plugin.json` `mcpServers: "./.codex-plugin/mcp.json"`, `type: "stdio"`, `${PLUGIN_ROOT}`)와 Claude Code·Antigravity 격리 검증.
  2. `scripts/pota-dag-mcp-core.mjs`의 OpenAI Apps SDK 호환 `_meta`(`ui/resourceUri`, `openai/outputTemplate`, `openai/resultCanProduceWidget`, `openai/widgetAccessible`, `openai/visibility`, `openai/ui.availableDisplayModes`, `openai/widgetPrefersBorder`, `openai/widgetDescription`)와 Antigravity `_meta` 공존 설계.
  3. `scripts/pota-dag-app-html.mjs`의 듀얼 브리지 설계(SEP-1865 `postMessage` + `window.openai`의 `toolInput`/`toolOutput`/`theme`/`locale`/`displayMode`/`openai:set_globals`/`callTool`/`notifyIntrinsicHeight`/`requestDisplayMode` + 호스트별 오류 배너·파일 열기 분기).
  4. `scripts/pota-state.mjs`에서 `host === "codex"`일 때 활성 워크스페이스 기록 시 `pota-state-antigravity.mjs`와의 순환 import를 피하는 모듈 구조(공용 모듈 분리 vs 경량 헬퍼) 및 `package.json` `check` 동기화.
- Heavy Path signals checked:
  - New directory/module/layer: 있음 (`.codex-plugin/mcp.json`, 듀얼 브리지 레이어)
  - New domain model/service/abstraction: 있음 (`window.openai` + SEP-1865 듀얼 호스트 어댑터)
  - Security/auth/session: 있음 (샌드박스 iframe CSP, `window.openai` 입력 검증, 심볼릭 링크 방어)
  - External API/message queue/payment: 없음
  - DB schema/migration: 없음
  - Concurrency/transaction/cache invalidation: 있음 (Codex·Antigravity 공용 `workspaces.json` 원자적 쓰기)
  - Cross-domain refactor: 없음
  - Explicit extra-care signal: 없음

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main (+ `explorer` `flash_lite`) | `heavy` | session / `flash_lite` | `high` (effective: `inherited`) |
| `heavy-design` | `research` (`pro`) | `heavy` | `pro` | `high` (effective: `inherited`) |
| `implement` | `self` (`pro`) | `heavy` | `pro` | `high` (effective: `inherited`) |
| `verify` | main | `heavy` | session | `xhigh` (effective: `inherited`) |

## Tool Readiness

- Detected stack: `javascript`, `typescript`
- Toolcheck command: `node "/Users/wknam/.gemini/config/plugins/pota/scripts/pota.mjs" toolcheck --root "/Users/wknam/workspace/pota-harness"`
- Required LSP/symbol tools: `typescript-language-server` (OK)
- Required typecheck/lint/verification tools: `node` (OK), `npm` (OK), `tsc` (OK), `gh` (OK), `claude` (OK), `agy` (OK)
- Missing tools: none
- Install approval: not needed
- Tool blockers: none

## Execution Guardrails

- Test contract first: 듀얼 브리지·OpenAI `_meta`·`.codex-plugin/mcp.json`·Codex 워크스페이스 기록·스킬 예산·`2.3.0` 버전 계약을 모두 자동 테스트로 고정한다.
- Dry-run or check mode before external-state mutation: push/PR 전 `npm run check`, `claude plugin validate .`, `HOME=<tmp> agy plugin validate .`, `node scripts/pota.mjs doctor` 및 CI `host-validate`(`@openai/codex@0.171.0`) 통과 확인.

## Heavy Design

설계 주체: `ChatGPT/Codex DAG Heavy Designer` (`research`, `pro (unreported)`, `high` / `inherited`, agent `1eed48b8-4288-4a5a-a21c-15dfc56b3fb8`).

1. **`.codex-plugin/mcp.json` & `.codex-plugin/plugin.json` (3호스트 무충돌)**:
   - 신규 `.codex-plugin/mcp.json`: `{"mcpServers":{"pota-dag":{"type":"stdio","command":"node","args":["${PLUGIN_ROOT}/scripts/pota-dag-mcp.mjs"]}}}`.
   - `.codex-plugin/plugin.json`에 `"mcpServers": "./.codex-plugin/mcp.json"` 추가. `hooks/codex.json`은 바이트 단위 무변경.
   - 루트 `.mcp.json`은 두지 않아 Claude Code(자체 `hooks/register.tsx` DAG mod)와 Antigravity(루트 `mcp_config.json`)와 완전 격리.
2. **`scripts/pota-dag-mcp-core.mjs` (OpenAI Apps SDK + SEP-1865 `_meta` 병존)**:
   - `DAG_RESOURCE_META`: `ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } }`, `"openai/ui": { availableDisplayModes: ["inline", "fullscreen"] }`, `"openai/widgetPrefersBorder": false`, `"openai/widgetDescription"`, `"openai/widgetCSP": { connect_domains: [], resource_domains: [] }`.
   - `OPEN_POTA_DAG_TOOL._meta`: 기존 `ui`·`com.google.antigravity/ui` 유지 + `"openai/outputTemplate": DAG_APP_RESOURCE_URI`, `"openai/resultCanProduceWidget": true`, `"openai/widgetAccessible": true`, `"openai/visibility": "public"`, `"openai/ui"`, `"openai/widgetPrefersBorder": false`, `"openai/widgetDescription"`.
   - `POTA_DAG_STATE_TOOL._meta`: 기존 `ui: { visibility: ["app"] }` 유지 + `"openai/visibility": "private"`, `"openai/widgetAccessible": true`, `"openai/resultCanProduceWidget": false`.
3. **`scripts/pota-dag-app-html.mjs` (듀얼 호스트 클라이언트 브리지)**:
   - `window.openai` 감지 시 즉시 `bridgeMode = "openai"`, `initialized = true`; `theme`/`locale`/`displayMode`/`maxHeight`/`toolInput`/`toolOutput` 동기화, `openai:set_globals` 구독, 초기 `toolOutput` 부재 시 150ms 뒤 `pota_dag_state` 자가 수화.
   - 하이브리드 호스트용 `ui/initialize` 프로브(`2000ms`)는 `window.parent && window.parent !== window`일 때만 송신하고, `bridgeMode === "openai"`에서 실패·타임아웃 시 오류 배너 없이 조용히 무시.
   - `callTool`은 `window.openai.callTool` 우선 + SEP-1865 `tools/call` 폴백, 반환값 5종 정규화; `emitSizeIfChanged`는 `window.openai.notifyIntrinsicHeight` + 조건부 `ui/notifications/size-changed`.
   - 선택적 전체화면 토글 버튼은 `window.openai.requestDisplayMode` 또는 `availableDisplayModes.includes("fullscreen")`일 때만 노출(Antigravity에서는 숨김 유지).
   - 순수 `window.openai` 모드에서는 `planId`/`writeScope` 파일 칩을 정적 배지로 렌더링해 Antigravity 전용 `toggle-aux-pane` 타임아웃 방지. CSP(`default-src 'none'`, `https?://`·`fetch(`·`innerHTML` 금지) 및 `DOMParser` SVG 살균 유지.
4. **공통 리프 모듈 `scripts/pota-dag-workspaces.mjs` 분리 (순환 의존 방지)**:
   - `WORKSPACE_REGISTRY_SCHEMA_VERSION`, `WORKSPACE_MAX_ENTRIES`, `WORKSPACE_MAX_AGE_MS`, `workspaceRegistryPath`, `readWorkspaceRegistry`, `recordActiveWorkspace`, `writeDagJsonFile`를 리프 모듈로 분리(`pota-paths.mjs`·`pota-safe-fs.mjs`만 의존).
   - `scripts/pota-state-antigravity.mjs`에서 그대로 re-export해 기존 import 100% 호환 유지.
   - `scripts/pota-state.mjs`에서 `host === "codex"`의 `session-start`·`user-prompt-submit` 시 명시 `root` 또는 `payload.cwd`만 비간섭 기록(`process.cwd()` 폴백 금지).
   - `package.json` `scripts.check`에 `node --check scripts/pota-dag-workspaces.mjs` 추가.
5. **계약 변경 및 정책 표면 (2.2.2 → 2.3.0)**:
   - 의도적 계약 변경: 2.2.2의 `skip on Claude Code and Codex`를 2.3.0에서 `Antigravity and Codex/ChatGPT Desktop` + `skip on Claude Code`로 갱신(`ensure` 복구는 Antigravity 전용 유지). `skills/pota-{plan,work}/SKILL.md`는 각 9,000B 이하 유지, `test/token-efficiency.test.mjs` 정규식 동기화.

## Heavy Design (S2)

설계 주체: `S2 3-Host Dashboard Heavy Designer` (`research`, `pro (unreported)`, `high` / `inherited`, agent `0521f695-b050-4075-8aec-7e3d76715834`). 사용자 추가 체크포인트 3건(실행 중 `transcript.jsonl` 불완전 마지막 줄 안전 스킵, 비-Antigravity 호스트 무오류 폴백, 양 호스트 후속 요청·게이트 브리지 테스트) 반영 완료.

1. **Antigravity Transcript Enrichment (`scripts/pota-dag-transcript.mjs`, 읽기 전용 leaf)**:
   - 엄격 UUID 검증(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), 후보 brain 디렉터리(`brainDir` → `ANTIGRAVITY_BRAIN_DIR` → `ANTIGRAVITY_APP_DATA_DIR/brain` → `ANTIGRAVITY_HOME/brain` → `~/.gemini/antigravity/brain`), 심볼릭 링크 차단(`assertNoSymlinkComponents`), `MAX_TRANSCRIPT_BYTES = 4 MiB` tail-read + 첫 잘린 줄 폐기 + 줄 단위 `try-catch`(실행 중 마지막 불완전 JSON 줄 안전 스킵), 64엔트리 LRU 캐시.
   - 파일 미존재·비-UUID(`main`)·권한 오류 시 예외 없이 `null` 반환(ChatGPT/Codex·Claude Code 조용한 폴백). `state.json` 미변경, 응답 시점에만 `resolvedModel`, `resolvedEffort`, `resolvedTier`, `transcript: { turns, tokens: { input, cacheRead, output, cacheHitRate, truncated }, updatedAt }` 및 goal 단위 `agentStats` 오버레이.
2. **Safe Read-Only Git Diff & Plan Reader (`scripts/pota-dag-git.mjs` + 순수 파서 `hooks/dag-model.mjs`)**:
   - `execFile("git", ["-C", root, ...], { shell: false, timeout: 3000 })`로 `status --porcelain=v1 -z`, `diff --numstat -z`, `diff --cached --numstat -z` 조합(unborn HEAD 대응).
   - 경로 검증(절대경로·`-` 옵션 인젝션·`..`·글롭·심볼릭 링크 차단), 민감 파일(`.env*`, `*.pem`, `*.key`, `*secret*`, `*credentials*`, `.npmrc` 등) 본문 읽기 및 `file://` 열기 칩 전면 차단.
   - `readPlanOverview(root, planId)`: 64 KiB 바운드 읽기(초과 시 상단 40 KiB + 하단 24 KiB 슬라이스), Title·Goal·Current request·체크리스트 읽기 전용 요약.
3. **HITL Controls (`approvalGate`, Pause/Resume, `pota_dag_action`)**:
   - `state.json` v3 유지, task에 선택적 boolean `approvalGate`(기본 `false`) 추가. `pota goal gate --task <id> --on|--off [--quiet]` 및 `goal task --status active --approve-gate` 추가.
   - `approvalGate === true`인 task는 `--approve-gate` 없이 `active` 전이 시 fail-closed 거부; `advanceGoal`은 게이트 걸린 ready task를 건너뛰고 모두 게이트면 goal을 `active`로 유지; `evaluateStop`은 게이트 대기 중 무한 루프 방지를 위해 `{ block: false }` 반환; `toggleTaskApprovalGate`는 단일 락 내 원자 토글.
   - MCP app-only/private 도구 `pota_dag_action` (`action: "pause" | "resume" | "toggle_gate"`, `taskId?`) 추가.
4. **All-Node Inline Inspector + 4 Multi-View Tabs (MCP App + Claude Code Mod)**:
   - `hooks/dag-svg.mjs`: 각 카드 `<g class="card" data-task-id="...">` 래핑; MCP HTML은 `data-task-id` 허용 + `MockElement` 호환 `parentNode` 클릭 위임.
   - 상단 4탭(`DAG` / `Diff` / `Plan` / `에이전트·통계`), 헤더 `[일시정지]`/`[재개]`, `#dag-inspector` 드로어(전 노드 클릭, 에이전트·요청/적용/트랜스크립트 모델·effort·토큰, `approvalGate` 토글, `receipts[]` 영수증, `writeScope` diff stat, 후속 요청 버튼: ChatGPT `window.openai.sendFollowUpMessage({ prompt })` + Antigravity SEP-1865 `ui/message` `{ role: "user", content: [{ type: "text", text: prompt }] }`). 921 KiB 점진 축소 cap 및 엄격 CSP(`default-src 'none'`) 유지.
   - Claude Code Mod(`types/index.d.ts` `DagUi` `ui-3` + `DagContext` `ctx-1`, `hooks/register.tsx`): 4탭·Pause/Resume·Gate 토글·전 노드 인스펙터 지원, 실행 중 서브에이전트(`task-sub`) 클릭 뷰 전환 보존.
5. **의도적 테스트 계약 갱신 & 릴리스**:
   - `test/cli-contract-hardening.test.mjs`(`gate` 추가), `test/antigravity-dag-mcp.test.mjs`(`tools/list` 3종 + S2 테스트), `test/claude-mod.test.mjs`(`ui-3`), `package.json` `scripts.check` & `test/plugin-manifests.test.mjs`(`pota-dag-transcript.mjs`, `pota-dag-git.mjs`), `test/contract-parity.test.mjs`(`2.3.0`). npm 게시 금지, GitHub `dev` PR → `main` PR 병합 + `v2.3.0` 태그가 배포.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Route: `light`
- Requested model: stronger (`pro`)
- Effective model: session (main)
- Requested reasoning effort: `high`
- Effective reasoning effort: `inherited`
- Contract: `scripts/pota-state.mjs`, `scripts/pota-dag-app-html.mjs`, `toolcheck`, 테스트 표면 조사 및 Heavy Path 확정.
- Required evidence records:
  - `planArtifact`
  - `triageDecision`

### Task 1: Heavy Design

- Task ID: `heavy-design`
- Initial status: `pending`
- Route: `heavy`
- Kind: `design`
- Requested model: strongest (`pro`)
- Effective model: `pro (unreported)`
- Requested reasoning effort: `high`
- Effective reasoning effort: `inherited`
- Assigned agent ID: `1eed48b8-4288-4a5a-a21c-15dfc56b3fb8`
- Depends on (task ids): `triage-plan`
- Write scope: `docs/plan/chatgpt-codex-dag-panel.md`
- Contract: 4개 사전 설계 결정과 Wave 1~3 태스크 분해를 확정해 `## Heavy Design`에 병합한다.
- Required evidence records:
  - `designRecord`

### Task 2: Codex MCP manifest, OpenAI `_meta`, and shared workspace registry (`mcp-backend-codex`)

- Task ID: `mcp-backend-codex`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Requested reasoning effort: `high`
- Depends on (task ids): `heavy-design`
- Write scope: `.codex-plugin/mcp.json`, `.codex-plugin/plugin.json`, `scripts/pota-dag-workspaces.mjs`, `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-state-antigravity.mjs`, `scripts/pota-state.mjs`, `package.json`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 3: Dual-host HTML client bridge (`mcp-ui-dual-bridge`)

- Task ID: `mcp-ui-dual-bridge`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Requested reasoning effort: `high`
- Depends on (task ids): `heavy-design`
- Write scope: `scripts/pota-dag-app-html.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 4: Policy surfaces and lifecycle memory (`policy-and-memory`)

- Task ID: `policy-and-memory`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Requested reasoning effort: `high`
- Depends on (task ids): `heavy-design`
- Write scope: `skills/pota-plan/SKILL.md`, `skills/pota-work/SKILL.md`, `skills/pota-plan/planning-rules.md`, `docs/model-guidance/README.md`, `docs/memory/lifecycle-install.md`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 5: DAG MCP, dual-bridge, Codex workspace & manifest tests (`dag-and-manifest-tests`)

- Task ID: `dag-and-manifest-tests`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Requested reasoning effort: `high`
- Depends on (task ids): `mcp-backend-codex`, `mcp-ui-dual-bridge`
- Write scope: `test/antigravity-dag-mcp.test.mjs`, `test/plugin-manifests.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 6: Policy contract regression tests (`policy-contract-tests`)

- Task ID: `policy-contract-tests`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Requested reasoning effort: `high`
- Depends on (task ids): `policy-and-memory`, `mcp-backend-codex`
- Write scope: `test/token-efficiency.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 7: 2.3.0 version bump, archive, read-only review, and full check (`release-prep-2.3.0`)

- Task ID: `release-prep-2.3.0`
- Route: `heavy`
- Requested model: stronger (`pro`)
- Requested reasoning effort: `xhigh`
- Depends on (task ids): `dag-and-manifest-tests`, `policy-contract-tests`
- Write scope: `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugin.json`, `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-dag-app-html.mjs`, `test/contract-parity.test.mjs`, `PLAN.md`, `docs/plan/ARCHIVE.md`, `docs/plan/chatgpt-codex-dag-panel.md`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 8: dev PR CI + host-validate and merge (`dev-pr`)

- Task ID: `dev-pr`
- Route: `heavy`
- Requested model: stronger (`pro`) / main
- Requested reasoning effort: `xhigh`
- Depends on (task ids): `release-prep-2.3.0`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 9: main PR CI + merge + v2.3.0 tag (`main-pr`)

- Task ID: `main-pr`
- Route: `heavy`
- Requested model: stronger (`pro`) / main
- Requested reasoning effort: `xhigh`
- Depends on (task ids): `dev-pr`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### S2 tasks (goal replan으로 추가, 상세 계약은 `## Heavy Design (S2)`)

| Task ID | Write scope | Depends on | Agent / model / effort |
| --- | --- | --- | --- |
| `heavy-design-s2` (`kind: design`) | `docs/plan/chatgpt-codex-dag-panel.md` | `dag-and-manifest-tests`, `policy-contract-tests` | Antigravity `pro (unreported)` / `inherited` |
| `s2-hitl-goal-core` | goal CLI·operations·policy·stop hook, `test/goal-state.test.mjs`, `test/cli-contract-hardening.test.mjs` | `heavy-design-s2` | Antigravity `pro (unreported)` / `inherited` |
| `s2-pure-dag-modules` | `hooks/dag-model.mjs`, `hooks/dag-svg.mjs`, `hooks/dag-text.mjs`(+`.d.mts`) | `heavy-design-s2` | Antigravity `pro (unreported)` / `inherited` |
| `s2-transcript-leaf` | `scripts/pota-dag-transcript.mjs`, `test/dag-transcript.test.mjs` | `heavy-design-s2` | Antigravity `pro (unreported)` / `inherited` |
| `s2-git-plan-leaf` | `scripts/pota-dag-git.mjs`, `test/dag-git.test.mjs` | `s2-pure-dag-modules` | Antigravity `pro (unreported)` / `inherited` |
| `s2-claude-mod-panel` | `hooks/register.tsx`, `types/index.d.ts`, `tests/pane.test.tsx`, `test/claude-mod.test.mjs` | `s2-hitl-goal-core`, `s2-pure-dag-modules` | Antigravity `pro (unreported)` / `inherited` |
| `s2-mcp-ui-and-action` | `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-dag-app-html.mjs`, `test/antigravity-dag-mcp.test.mjs` | `s2-hitl-goal-core`, `s2-pure-dag-modules`, `s2-transcript-leaf`, `s2-git-plan-leaf` | Antigravity `pro`(쿼터 중단) → Claude Code `opus` / `high` (host-option) |
| `s2-manifest-checks-and-docs` | `package.json`, `test/plugin-manifests.test.mjs`, `skills/pota-work/recovery.md`, `docs/memory/*` | `s2-hitl-goal-core`, `s2-transcript-leaf`, `s2-git-plan-leaf` | Antigravity `flash (unreported)` / `inherited` |

### S3 tasks (2026-11-24 `goal replan --steer addition`)

| Task ID | Route | Write scope | Depends on | Agent / model / effort |
| --- | --- | --- | --- | --- |
| `dag-skill` | `light` | `skills/dag`, `test/docs-package-hardening.test.mjs`, `test/plugin-manifests.test.mjs`, `scripts/pota-doctor.mjs`, `README*.md` 8개, `docs/memory/lifecycle-install.md` | `s2-mcp-ui-and-action` | Claude Code `sonnet` / `medium` (host-option) |
| `dag-git-untracked` | `light` | `scripts/pota-dag-git.mjs`, `test/dag-git.test.mjs` | `s2-git-plan-leaf` | Claude Code `sonnet` / `medium` (host-option) |

- `dag-skill` 계약: `skills/dag/SKILL.md`는 `open_pota_dag`를 한 번 호출해 패널을 여는 일만 한다. Claude Code에서는 호출하지 않고 mod `/dag`를 안내한다. 스킬 인벤토리 테스트의 4개→5개 변경은 S3에 따른 의도된 계약 변경이다.
- `dag-git-untracked` 계약: `s2-mcp-ui-and-action` 워커 보고에서 나온 결함. `git status --porcelain=v1 -z`가 새 디렉터리를 `?? dir/` 한 줄로 접어 파일 단위 `writeScope` diff에서 빠진다. 실패 테스트로 재현한 뒤 파일 단위로 나열되게 고친다.

### S4 tasks (2026-11-24 `goal replan --steer correction`)

릴리스 전 읽기 전용 리뷰(`pota:explorer`, Claude Code `opus (claude-opus-5-5)` / `xhigh`, host-option): blocker 0, should-fix 4, minor 5. 아래 태스크로 모두 반영했다.

| Task ID | Route | Write scope | Agent / model / effort | 반영한 지적 |
| --- | --- | --- | --- | --- |
| `claude-view-fallback` | `light` | `hooks/register.tsx`, `tests/pane.test.tsx` | main 직접(작은 수정, 위임 없이 수행) | S4 정정: 에이전트 보기 거부 시 패널 내 인스펙터로 대체. mod의 `git status`가 `status.showUntrackedFiles=no`를 존중 |
| `review-fix-mcp` | `heavy` | `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-dag-app-html.mjs`, `test/antigravity-dag-mcp.test.mjs` | Claude Code `opus (claude-opus-5-5)` / `high` | ① `open_pota_dag` `structuredContent`를 요약(이 저장소 기준 99,774 B → 433 B)으로 줄이고 위젯이 `pota_dag_state`로 수화 ② `toggle_gate`에 `enabled: boolean` 필수(오래된 화면 상태로 게이트가 뒤집히는 경합 차단) ③ `pota_dag_action`은 레지스트리·`HARNESS_REPO_ROOT`의 root만 허용 ④ 폴링 경로의 저장소 전체 동기 해시 제거(`fresh: null`), 감시 경로 영수증은 revision·30초 TTL 캐시 |
| `review-fix-gate-guidance` | `heavy` | `scripts/pota-goal-policy.mjs`, `scripts/pota-state-context.mjs`, `scripts/pota-goal-cli.mjs`, 관련 테스트 3개, `docs/memory/goal-state.md`, `skills/pota-work/{delegation,recovery}.md` | Claude Code `opus (claude-opus-5-5)` / `high` | `currentTask`가 게이트 없는 ready task를 우선, 캡슐은 해제 명령 대신 "사용자 승인 대기", `goal ready`가 게이트 task를 `gated`(있을 때만 출력)로 분리, 호스트 버전 혼재 시 게이트가 무시된다는 사실 기록 |
| `review-fix-leaf-readme` | `light` | `hooks/dag-model.mjs`, `scripts/pota-dag-git.mjs`, `test/dag-git.test.mjs`, `test/claude-mod.test.mjs`, `README*.md` 8개 | Claude Code `sonnet (claude-sonnet-5-5)` / `medium` | `.env*`·`service-account*.json` 민감 판정 확대, `status.showUntrackedFiles=no` 존중, README의 "DAG는 Claude 전용" 문구 정정 |

- S2 설계 대비 달라진 계약: MCP의 게이트 조작은 `toggleTaskApprovalGate`(반전)가 아니라 `setTaskApprovalGate`(명시 값)를 쓴다. `pota_dag_action` 입력은 `{ action, taskId?, enabled?, root? }`다. `open_pota_dag` 결과에는 화면 데이터가 없다.
- 남긴 것(이번 릴리스에서 고치지 않음): 실행 중이라 커지는 Antigravity `transcript.jsonl`은 폴링마다 최대 4 MiB 꼬리를 다시 파싱한다. `goal task --status active`의 게이트 거부 오류 문구는 여전히 해제 명령을 안내한다(사용자 승인 요구는 캡슐·`recovery.md`가 담당). paused/blocked 캡슐은 게이트 pending task를 current로 표시할 수 있다. Codex가 `.codex-plugin/mcp.json`의 `stdio`·`${PLUGIN_ROOT}`를 받아들이는지, 호스트가 app 전용 visibility를 강제하는지, 실제 호스트 TUI에서 `/dag`·`$dag`가 노출되는지는 실행으로 확인하지 못했다.

S3 이후 `release-prep-2.3.0`은 위 두 태스크에도 의존한다. S2 이후 `release-prep-2.3.0`은 `s2-mcp-ui-and-action`, `s2-claude-mod-panel`, `s2-manifest-checks-and-docs`에 의존한다.

## Evidence

- Dry-run or check (2026-11-24, 인수 후 최종 상태):
  - `claude plugin validate .` 통과 (✔ Validation passed)
  - `HOME=<tmp> agy plugin validate .` 통과 (경고 1건: 기존 `hooks/hooks.json: never loaded`, `components.skills` 5)
  - `node scripts/pota.mjs doctor` exit 0 (`OK version surfaces: 2.3.0`, `OK required files: present`)
  - `pota plan index --archive`(1건 아카이브) + `pota plan check --strict` + `pota memory check --strict` errors 0, warnings 0
  - `hooks/codex.json`은 `HEAD`와 바이트 동일 (`git diff HEAD --quiet -- hooks/codex.json`)
- Tool readiness: `pota toolcheck` 누락 없음 (`node`, `npm`, `typescript-language-server`, `tsc` OK; `gh`, `claude`, `agy` 사용 확인). 로컬에 `codex` CLI는 없어 Codex 실제 설치 확인은 CI `host-validate`에 맡긴다.
- Tests:
  - `npm run check` exit 0: 531 tests, 531 pass, 0 fail (리뷰 반영 전 524 → 반영 후 531)
  - `claude plugin test .`: 30 pass, 0 fail (`tests/pane.test.tsx`, `node --test` 대상이 아님)
  - `tsc --noEmit -p .` exit 0
  - `wc -c`: `skills/pota-plan/SKILL.md` 8,675 B, `skills/pota-work/SKILL.md` 8,759 B (≤ 9,000 B), `skills/dag/SKILL.md` 766 B
- Module acceptance: S1·S2 태스크는 Antigravity 세션이 `goal verify`로 기록했다. 인수 후 `s2-mcp-ui-and-action`, `dag-skill`, `dag-git-untracked`, `claude-view-fallback`, `review-fix-mcp`, `review-fix-gate-guidance`, `review-fix-leaf-readme`는 각 태스크의 집중 테스트로 `goal verify --kind moduleAcceptance` exit 0. `release-prep-2.3.0`은 버전·매니페스트·색인 테스트로 기록.
- Surface integration: 위 태스크 모두 인접 표면 테스트(`plugin-manifests`, `token-efficiency`, `claude-mod`, `contract-parity`, `repo-index` 등)로 `goal verify --kind surfaceIntegration` exit 0. `release-prep-2.3.0`은 `npm run check` 전체로 기록. `dev-pr`·`main-pr`의 CI·병합·`v2.3.0` 태그 검증은 후속 `goal verify`와 `goal finish`로 완료한다.
- Review: 릴리스 전 읽기 전용 리뷰(Claude Code `opus (claude-opus-5-5)` / `xhigh`) blocker 0, should-fix 4, minor 5 → `### S4 tasks`로 반영. 같은 규칙 탐색: `git status` 호출부 2곳(`scripts/pota-dag-git.mjs`, `hooks/register.tsx`) 모두 수정, 민감 경로 판정은 `isSensitiveRepoPath` 한 곳뿐, 게이트 조작은 mod(`--on`/`--off`)·CLI·MCP 모두 명시 값.
- Takeover: `claude-view-fallback`, 버전 범프, 문서·색인 정리는 main 에이전트가 직접 수행했다(작고 기계적인 변경). 그 밖의 구현은 `worker`에 위임했다.
- Goal final review evidence record: `main-pr` 완료 후 `goal finish`로 기록한다.
- Memory promotion: `docs/memory/lifecycle-install.md`(Codex MCP 배치, `skills/dag`, `open_pota_dag` 요약·`pota_dag_action` 제약), `docs/memory/goal-state.md`(게이트·`gated`·버전 혼재), `docs/memory/hook-context.md`(게이트 대기 캡슐), `docs/memory/policy-surfaces.md`(게이트 대기 규칙, 스킬 5개 인벤토리).
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
