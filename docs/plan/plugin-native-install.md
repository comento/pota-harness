# Plan: 호스트 플러그인 설치로 전환, Pota 2.0.0

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation after planned triage. triage 완료(2026-11-23). 구현 task의 세부 분할은 `heavy-design` 결과로 `goal replan --steer none`에서 확정한다.
- Codex UI synchronization: `update_plan` 호출함(Claude Code 데스크톱 task list). `create_goal`은 이 호스트에 없음.

## Goal

Pota를 npm 설치 프로그램(`pota install`)이 아니라 각 호스트(Claude Code, Codex, Antigravity CLI)의 플러그인 설치 명령으로 설치·업데이트하게 한다. 플러그인은 스스로 완결되어 자기 안의 스크립트를 runtime으로 쓴다.

- Goal ID: `goal-e98ee57e-475e-4a4e-b3fe-c4d0b91ea73e`
- Plan ID: `docs/plan/plugin-native-install.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria (advisory): 세 호스트 각각에서 저장소를 소스로 한 플러그인 설치만으로 skill·hook·goal CLI가 동작하고, 기존 npm 설치본에서 옮겨 오는 경로가 있으며, `npm run check`가 통과한다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Request Brief

- Original request: "추천하는대로 할게. 2.0.0 으로 진행해보자."
- Interpreted outcome: (1) 저장소 루트가 세 호스트의 플러그인 모양이고, 각 호스트의 설치 명령으로 Pota가 설치된다. (2) hook·skill·CLI는 플러그인 설치본 안의 스크립트를 실행하며 `~/.pota/install/runtime`에 의존하지 않는다. (3) 업데이트는 호스트의 방식에 맡기고 npm 기준 자동 업그레이드는 없앤다. (4) 기존 npm 설치본은 플러그인의 첫 SessionStart hook이 감지해 제거하고, 아무것도 하지 않은 기존 사용자는 마지막 npm 버전이 플러그인 설치로 안내한다. (5) npm 설치 경로(`pota install|upgrade|uninstall`, lifecycle)는 없앤다. (6) 버전은 2.0.0이다.
- Scope: 호스트별 manifest와 플러그인 배치, runtime 위치 결정 방식, hook 배선, lifecycle·자동 업그레이드 코드 제거 또는 축소, 이전(migration) 처리, 테스트, README 8개와 정책 표면, `docs/memory` 갱신, 버전 표면.
- Non-scope: Antigravity IDE(사용자 지시로 제외), 공식 marketplace 등재, goal 상태 schema 변경, 모델 상한을 플러그인 설정·저장소 설정으로 받는 기능(이 대화에서 논의했으나 이번 요청에 포함되지 않음).
- Prior records: `pota plan steering`은 `request-brief-steering`의 S1~S4를 보여 준다. 그중 S2("구현이 되면 develop pr 머지, main pr 머지, npm 배포")와 S3("로컬 설치본 업그레이드도 추가해야지")는 구현 요청에서 릴리스 범위가 빠졌던 기록이다. `PLAN.md` Completed 목록에서도 기능 계획 뒤에 릴리스 계획이 매번 이어진다. 관련 노트: `docs/memory/lifecycle-install.md`, `release-process.md`, `hook-context.md`, `policy-surfaces.md`. 관련 완료 계획: `auto-upgrade-pota-home`, `claude-dag-panel`, `request-brief-steering`.
- Assumptions:
  - A1 (confirmed: 사용자 "런타임은 각각의 호스트에서 책임지는 방식-설사 중복이 있더라도- 맞을 것 같고"): 호스트마다 플러그인 설치본이 자기 runtime이다.
  - A2 (confirmed: 사용자 "호스트에서 업그레이드 하는 방식이 맞을 것 같아"): 업데이트는 호스트에 맡긴다.
  - A3 (confirmed: 사용자 "플러그인으로 설치했을 때 기존 버전을 삭제하고 설치하게 하면 되지 않나?"): 기존 npm 설치본은 제거한다. 실행 시점은 내가 권한 두 가지(첫 SessionStart hook, 마지막 npm 버전)이고 사용자가 "추천하는대로 할게"로 받아들였다.
  - A4 (confirmed: 사용자 "배포본이 main이 되는건 다들 기대하는 방식일텐데..."): `main`이 배포본이다.
  - A5 (confirmed: "추천하는대로 할게"): npm 설치 경로를 없앤다.
  - A6 (confirmed: 사용자 "antigravity ide는 무시해"): Antigravity는 CLI(`agy`)만 대상이다.
  - A7 (inferred): goal 상태는 계속 `~/.pota/projects/`에 두고 호스트 간에 공유한다. `config.json`도 그대로 읽는다.
  - A8 (inferred): 세 호스트의 플러그인 계약(플러그인 루트 변수, hook 이벤트, 담을 수 있는 구성요소, 저장소 URL 설치)은 triage에서 조사해 확정한다. 지원하지 않는 부분이 있으면 그 호스트에 한해 대안을 설계한다.
  - A9 (confirmed: 사용자 S1): 호스트마다 설치된 Pota 버전이 달라도 된다. 버전 관리는 호스트의 일이고 Pota는 호스트 간 버전을 맞추거나 비교하지 않는다. 공유되는 goal 상태의 호환은 상태 schema 버전으로만 판단한다.
  - A10 (confirmed: 사용자 S2 "안내용 1.x만 게시"): 2.0.0은 npm에 게시하지 않는다. 1.x 코드에서 세션 시작 안내 문구만 바꾼 마지막 버전 하나(1.5.0)를 게시해 플러그인 설치를 안내하고, 그 뒤 npm 패키지에 deprecated 표시를 단다. 이 버전은 스스로 제거하지 않는다. 기존 설치본 제거는 플러그인의 첫 SessionStart hook만 한다(A3의 "마지막 npm 버전" 부분을 대체).
- Implicit requirements: 기존 설치본 제거는 Pota가 설치한 파일에 한정하고 `~/.pota/projects/`(goal 상태)와 `config.json`은 지우지 않는다. 사용자의 `~/.gemini/config/hooks.json`에서는 Pota 항목만 걷어낸다. hook이 자동으로 지우는 동작이므로 소유 확인(manifest 기록과 일치)이 실패하면 지우지 않고 알린다. 플러그인 hook이 실행하는 명령은 플러그인 루트 안의 스크립트로 고정한다. npm에 게시한 버전은 되돌릴 수 없다.
- Open questions: none(릴리스 범위는 S2로 확정).
- Steering log:
  - S1 (correction): "그러니까 각각의 에이전트를 모두 별개의 플러그인으로 설치한다고 했을 때, 버전이 달라도 상관 없다는 이야기야", "버전 관리는 호스트가 알아서 하는거니까" → 가정 A9 추가. 내가 대화에서 말한 "버전이 다른 두 호스트는 schema 버전 검사로 막는다"를 대체한다: 플러그인 버전 불일치는 막지 않고, 상태 schema가 다를 때만 다룬다. task는 그대로.
  - S2 (addition): "안내용 1.x만 게시" → 가정 A10 추가, task `release` 추가(dev PR 병합, main PR 병합, 1.5.0 안내 버전 게시, npm deprecated 표시, 이 컴퓨터의 기존 설치본을 플러그인으로 교체). 내가 처음 권한 "스스로 제거하는 마지막 npm 버전"을 대체한다.
- Current request (as of S2): Pota 2.0.0에서 npm 설치 프로그램을 없애고 Claude Code, Codex, Antigravity CLI 각각의 플러그인 설치 명령으로 설치·업데이트하게 한다. 플러그인은 호스트가 설치한 자리의 스크립트를 runtime으로 쓰고, 호스트마다 버전이 달라도 된다. 기존 npm 설치본은 플러그인의 첫 SessionStart hook이 제거한다. 2.0.0은 npm에 게시하지 않고, 1.x에서 안내 문구만 바꾼 1.5.0을 마지막으로 게시한 뒤 패키지를 deprecated로 표시한다. 릴리스는 dev PR·main PR 병합, 1.5.0 게시, 이 컴퓨터의 설치본 교체까지 포함한다.

## Whole Work

- Outcome: 위 Interpreted outcome.
- Affected surfaces: `.claude-plugin/`, `.codex-plugin/`, `.antigravity-plugin/`, `hooks/`, `skills/`, `commands/`, `agents/`, `.agents/workflows/`, `claude-mod/`, `scripts/pota-lifecycle*.mjs`, `scripts/pota-auto-upgrade.mjs`, `scripts/pota-paths.mjs`, `scripts/pota.mjs`, `test/`, README 8개, `docs/memory/`, `package.json`. 정확한 목록은 triage에서 확정한다.
- Task classification: Heavy Path(설치 구조 전환, 여러 도메인에 걸친 변경, 사용자 파일을 지우는 이전 처리).
- Sub-tasks, if needed: triage에서 확정.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/lifecycle-install.md`, `docs/memory/hook-context.md`, `docs/memory/release-process.md`, `docs/memory/policy-surfaces.md`
- Related completed plans: `docs/plan/auto-upgrade-pota-home.md`, `docs/plan/claude-dag-panel.md`, `docs/plan/request-brief-steering.md`

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- Rationale: main 세션이 Claude Code다.
- User-visible response and artifact locale: ko.

## Reasoning Effort Profile

- Heavy Path: planning/review=`high`, implementation=`high`, final verification/review=`xhigh`.
- 조사(read-only)는 fast tier `haiku`, 설계는 strongest tier `fable`의 별도 `kind: "design"` task, 구현은 stronger tier `opus`로 dispatch한다.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: 새 manifest 디렉터리와 설치 구조 전환, lifecycle·hook·skill·문서에 걸친 변경, 사용자 홈의 파일을 지우는 이전 처리.
- Checkpoint ledger:
  - Request checkpoint: Heavy. 근거는 요청(설치 방식 전환, major 버전)과 `MEMORY.md`의 lifecycle 노트.
  - Planning checkpoint: Heavy 유지. 근거: lifecycle·자동 업그레이드 2624줄과 테스트 146개(전체 505개의 약 29%)가 대상이고, 호스트 3개의 manifest·hook 배선과 사용자 홈 파일을 지우는 이전 처리가 새로 생긴다(아래 Research Findings).
  - Code checkpoint: Heavy 확정(2026-11-23). 설계와 검토가 정확한 파일·호출자·테스트를 확인했고(§5, §9, §10, §13) 경로 변경 신호는 없다.
- Heavy Path signals checked:
  - New directory/module/layer: 예(`.antigravity-plugin/`, 루트 `.claude-plugin/`).
  - Cross-domain refactor: 예.
  - New domain model/service/abstraction: 예(플러그인 루트 기준 runtime 결정, Antigravity hook 어댑터, 이전 처리 모듈).
  - Security/auth/session: 예(hook이 사용자 홈의 파일을 자동으로 지운다. Codex hook 신뢰를 설치 프로그램이 대신 기록하던 동작이 사라진다).
  - External API/message queue/payment: 아니오.
  - DB schema/migration: 아니오(goal 상태 schema는 그대로). 설치 구조의 이전은 있다.
  - Concurrency/transaction/cache invalidation: 예(여러 호스트의 SessionStart가 동시에 이전을 시도할 수 있어 lock이 필요하다).
  - Explicit extra-care signal: 아니오.
- Heavy Path trigger: 새 디렉터리와 구조 전환, 여러 도메인에 걸친 변경, 사용자 파일 삭제.
- Pre-implementation decisions: `heavy-design`이 정한다. 목록은 Task 1의 Contract에 있다.

## Research Findings (triage, 2026-11-23)

세부 내용은 이 세션의 handoff 파일 네 개에 있다(세션 scratchpad의 `research-claude.md`, `research-codex.md`, `research-antigravity.md`, `research-current-install.md`). 설계가 끝나면 필요한 사실은 `## Heavy Design`과 `docs/memory`로 옮긴다.

- Claude Code: 저장소 루트를 플러그인으로 쓰는 `.claude-plugin/marketplace.json`의 `"source": "./"`가 문서에 있다. 설치는 `/plugin marketplace add owner/repo` 뒤 `/plugin install name@marketplace`, 또는 `claude plugin install name --marketplace owner/repo`. `${CLAUDE_PLUGIN_ROOT}`는 hook 명령과 플러그인 skill·command·agent 본문에서 치환되고 hook 프로세스의 환경 변수로도 들어가지만, Bash 도구의 환경에는 없다. 설치본은 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`으로 버전마다 경로가 바뀐다. `hooks/hooks.json`은 자동 발견되고 `modules` 키가 있으면 mod다. `bin/`의 실행 파일은 Bash 도구의 PATH에 들어간다. 설치 시 실행되는 스크립트는 없고 가장 이른 이벤트는 SessionStart다. 서드파티 marketplace의 자동 업데이트는 기본으로 꺼져 있다. 버전은 `plugin.json`의 `version`이 우선이고 문자열이 바뀌어야 업데이트로 본다.
- Codex: 이 컴퓨터에 `codex`가 없어 문서와 소스로만 확인했다. `codex plugin marketplace add owner/repo` 뒤 TUI `/plugins`에서 설치하는 두 단계다. marketplace 파일은 `.agents/plugins/marketplace.json`(`.claude-plugin/marketplace.json`도 읽음), 루트 플러그인은 `source: {source: "url", url: "./"}` 형태다(obra/superpowers 실례). hook 명령은 `PLUGIN_ROOT`와 호환용 `CLAUDE_PLUGIN_ROOT`를 받는다. 플러그인 hook은 설치만으로 신뢰되지 않고 사용자가 `/hooks`에서 승인해야 하며 신뢰는 hook 해시에 묶인다. 지금 설치 프로그램은 이 신뢰를 `config.toml`에 대신 기록한다. 업데이트는 `codex plugin marketplace upgrade`.
- Antigravity CLI: manifest는 `.antigravity-plugin/plugin.json`(필수는 `name`뿐, `additionalProperties: false`). hook 파일은 플러그인 루트의 `hooks.json`이고 `hooks/hooks.json`·`commands/`는 읽지 않는다. workflow는 플러그인 구성요소가 아니며 skill이 `/<skill-name>`으로 노출된다. 이벤트는 SessionStart·PreToolUse·PostToolUse·PreInvocation·PostInvocation·Stop이고 사용자 프롬프트 이벤트는 없다(PreInvocation이 `lastUserInput`을 준다). 입출력은 camelCase JSON, 컨텍스트 주입은 `injectSteps`, Stop은 `{"decision":"continue","reason"}`로 막는다. hook 명령은 플러그인 루트를 cwd로 실행되어 상대 경로를 쓴다. skill 본문용 루트 변수는 없다. 설치 위치는 문서상 `~/.gemini/config/plugins/<name>`. 업데이트는 재설치로 보인다(확인 못 함). `agy plugin validate`가 있어 로컬 검증이 가능하다.
- 현재 구조: lifecycle·자동 업그레이드 14개 파일 2624줄, 전용 테스트 10개 파일 146개. lifecycle 밖에서 설치 배치에 의존하는 곳은 `pota-state.mjs`(CLI prefix, 업데이트 알림), `pota-update-state.mjs`, `pota-comment-checker.mjs`(lifecycle lock, runtime 경로), `pota-paths.mjs`(locator), `pota-model-ceiling.mjs`(`readJsonFile`), `claude-mod/hooks/register.tsx`(`findCli`), skill 4개의 locator 문장, `.claude/*`·`.agents/workflows/*`의 `{{POTA_RUNTIME_LOCATOR_JSON}}`다. `pota doctor`의 검사는 전부 설치 배치 기준이다. 기존 설치본의 소유 기록은 `~/.pota/install/lifecycle.json`(schema 2, `targets[].path`와 digest)이고 기존 `uninstall()`은 수정된 파일이 하나라도 있으면 거부한다.

## Heavy Design

설계 task `heavy-design`의 결과다(model `fable`, 보고된 ID `claude-fable-5-2`, effort `high`, 2026-11-23). 아래 절 번호는 설계 문서의 것이다.

- 대상 계획: `docs/plan/plugin-native-install.md` Task 1 `heavy-design` (read-only 설계)
- 작성 기준: 저장소 `feat/plugin-native-install` (`b559730`), `origin/main` = `122b031` (1.4.0)
- 확인 도구: Claude Code 2.1.327(`claude plugin validate`), `agy` 1.0.7(로컬, 최신은 1.5.14), `codex`는 미설치라 openai/codex HEAD 소스 발췌로만 확인
- 표기: **[검증]** = 이 컴퓨터에서 명령으로 확인, **[문서]** = 공식 문서·changelog, **[소스]** = openai/codex HEAD 소스, **[미검증]** = 확인하지 못한 가정(§12에 모음)
- 사용자 결정 반영: A1~A10, S1(호스트 간 버전 비교 없음), S2(1.5.0은 안내 전용, 2.0.0은 npm 미게시)

### 0. 결정 요약

| # | 결정 |
| --- | --- |
| D1 | 저장소 루트가 세 호스트의 플러그인 루트다. marketplace 이름은 `pota-harness`, 플러그인 이름은 `pota`, 플러그인 id는 `pota@pota-harness`(기존 `pota@pota`와 구분된다). |
| D2 | hook 파일은 호스트마다 따로 둔다: Claude `hooks/hooks.json`(mod `modules` 포함), Codex `hooks/codex.json`, Antigravity 루트 `hooks.json`. 한 파일로 Claude와 Codex를 같이 쓰지 않는다. |
| D3 | Antigravity manifest는 루트 `plugin.json` 하나만 둔다(`.antigravity-plugin/plugin.json`은 두지 않는다). |
| D4 | runtime 위치는 저장하지 않는다. SessionStart hook이 `import.meta.url`로 계산한 `Pota CLI:` 줄이 유일한 기준이고, 그 줄이 없을 때만 `SKILL.md`의 `../..`를 쓴다. locator 파일과 `{{POTA_RUNTIME_LOCATOR_JSON}}`은 없앤다. `bin/`은 만들지 않는다. |
| D5 | Claude mod는 루트 플러그인에 넣는다(`hooks/register.tsx`, `types/index.d.ts`). `claude-mod/`는 없앤다. |
| D6 | `commands/`, `.claude/commands/`, `.claude/agents/`, `.agents/workflows/`는 지운다. plan·work·review·memory는 skill만 남고, toolcheck는 skill로 만들지 않는다. agent 2개는 `claude/agents/`로 옮겨 Claude만 읽게 한다. |
| D7 | lifecycle·자동 업그레이드 13개 파일과 `pota-update-state.mjs`를 지운다. `pota-lifecycle-lock.mjs`만 그대로 남긴다. `pota doctor`는 읽기 전용 진단으로 다시 만든다. `pota migrate`를 추가한다. |
| D8 | 기존 설치본 제거는 플러그인의 SessionStart hook이 감지하고, 분리된(detached) 프로세스가 수행한다. 대상별 digest가 맞는 것만 지우고, manifest가 통과하지 못하면 아무것도 지우지 않는다. |
| D9 | 1.5.0은 `origin/main`(`122b031`)에서 만든 `release/1.x` 브랜치에서 내고 `dev`·`main`에 병합하지 않는다. 안내는 7일에 한 번이다. |
| D10 | 2.0.0 `package.json`은 `private: true`, `bin`·`files`·`prepack` 없음. 버전 표면은 4개다. |
| D11 | 구현 task는 5개(+ 별도 worktree의 1.5.0 task 1개)다. |

### 1. 저장소 배치와 manifest

#### 1.1 디렉터리

```
.claude-plugin/plugin.json         Claude manifest
.claude-plugin/marketplace.json    Claude marketplace (pota-harness)
.codex-plugin/plugin.json          Codex manifest
.agents/plugins/marketplace.json   Codex marketplace (pota-harness)
plugin.json                        Antigravity manifest
hooks.json                         Antigravity hooks
hooks/hooks.json                   Claude hooks + mod modules
hooks/codex.json                   Codex hooks
hooks/register.tsx, hooks/dag-*.mjs, hooks/dag-*.d.mts   Claude mod (claude-mod/hooks에서 이동)
types/index.d.ts                   Claude mod 타입 계약 (claude-mod/types에서 이동)
tests/pane.test.tsx, tsconfig.json Claude mod 개발용 (claude-mod에서 이동)
claude/agents/{explorer,worker}.md Claude agent (agents/에서 이동)
skills/pota-{memory,plan,work,review}/
scripts/  templates/  docs/model-guidance/
package.json                       private, 버전 표면
```

지우는 것: `claude-mod/`, `agents/`, `commands/`, `.claude/commands/`, `.claude/agents/`, `.agents/workflows/`, `scripts/pota`(sh wrapper, `package.json:37`의 `files`에서만 쓰임).

#### 1.2 Claude Code

`.claude-plugin/plugin.json` — **[검증]** 같은 모양의 scratch 플러그인이 `claude plugin validate`를 통과했다(modules `hooks/register.tsx`, hook 5개, skill `pota:pota-{memory,plan,review,work}`, agent `pota:explorer`·`pota:worker`, 상태 계약 `pota.dag`·`pota.dagUi`·`pota.dagAgents`. 경고는 `ICON_MISSING` 하나).

```json
{
  "name": "pota",
  "version": "2.0.0",
  "description": "Token-efficient agent harness with tool readiness for Codex, Claude Code, and Antigravity",
  "author": { "name": "WkNam" },
  "homepage": "https://github.com/comento/pota-harness",
  "repository": "https://github.com/comento/pota-harness",
  "license": "MIT",
  "keywords": ["agent", "harness", "planning", "memory", "verification"],
  "agents": ["./claude/agents/explorer.md", "./claude/agents/worker.md"],
  "types": "./types/index.d.ts"
}
```

`.claude-plugin/marketplace.json` — 버전을 적지 않는다(버전은 `plugin.json`이 기준).

```json
{
  "name": "pota-harness",
  "description": "Pota Harness plugin marketplace (this repository root is the plugin)",
  "owner": { "name": "WkNam" },
  "plugins": [
    {
      "name": "pota",
      "source": "./",
      "description": "Memory, planning, tool readiness, and two-gate verification harness for agent work."
    }
  ]
}
```

`hooks/hooks.json` — 지금 파일(`hooks/hooks.json`)에서 변수 이름, 끝의 호스트 토큰, `modules`만 바뀐다. timeout 10, `statusMessage`, PostToolUse matcher는 그대로다.

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/pota-state.mjs\" session-start claude", "timeout": 10, "statusMessage": "Pota: loading read-only repository context" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/pota-state.mjs\" user-prompt-submit claude", "timeout": 10, "statusMessage": "Pota: loading read-only work context" }] }],
    "PostToolUse": [{ "matcher": "^(apply_patch|write|Write|edit|Edit|multi_edit|multiedit|MultiEdit)$", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/pota-state.mjs\" post-tool-use claude", "timeout": 10, "statusMessage": "Pota: reminding current goal evidence requirements" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/pota-state.mjs\" stop claude", "timeout": 10, "statusMessage": "Pota: checking the active goal task" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/pota-state.mjs\" subagent-stop claude", "timeout": 10, "statusMessage": "Pota: checking this subagent's assigned task" }] }]
  },
  "modules": ["./register.tsx"]
}
```

설치와 업데이트:

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
# 업데이트 (서드파티 marketplace는 자동 업데이트가 기본으로 꺼져 있다 [문서])
claude plugin marketplace update pota-harness
claude plugin update pota@pota-harness     # 세션을 다시 시작해야 적용
```

세션 안에서는 `/plugin marketplace add comento/pota-harness`, `/plugin install pota@pota-harness`.

#### 1.3 Codex

`.codex-plugin/plugin.json` — 지금 파일에서 `version`과 `hooks` 한 줄만 바뀐다. `interface`(9~39행, `defaultPrompt` 7줄 포함)는 바이트 그대로 둔다(`test/token-efficiency.test.mjs:23-38`이 고정).

```json
{
  "name": "pota",
  "version": "2.0.0",
  "description": "Token-efficient agent harness with tool readiness for Codex, Claude Code, and Antigravity.",
  "author": { "name": "WkNam" },
  "skills": "./skills/",
  "hooks": "./hooks/codex.json",
  "interface": { "…": "현재 .codex-plugin/plugin.json 9~39행과 동일" }
}
```

- `hooks` 문자열 경로는 기본 탐색(`hooks/hooks.json`)을 **대체**한다 **[소스]**. 지금 설치 프로그램도 설치본 manifest에 `hooks: "./hooks/hooks.json"`을 넣어 쓰고 있다(`scripts/pota-lifecycle-staging.mjs:114`).
- Codex의 `HooksFile`은 `deny_unknown_fields`이고 키는 `description`, `hooks`뿐이다 **[소스]**. `modules`가 있는 `hooks/hooks.json`을 Codex가 읽으면 파싱에 실패한다. 그래서 파일을 나눈다(D2).

`hooks/codex.json` — `hooks/hooks.json`에서 `modules`를 빼고, `${CLAUDE_PLUGIN_ROOT}`를 `${PLUGIN_ROOT}`로, 끝 토큰 `claude`를 `codex`로 바꾼 것과 같다. 예:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"${PLUGIN_ROOT}/scripts/pota-state.mjs\" session-start codex", "timeout": 10, "statusMessage": "Pota: loading read-only repository context" }] }]
  }
}
```

(나머지 4개 이벤트도 같은 규칙. `test/plugin-manifests.test.mjs`가 두 파일이 이 치환 규칙으로 같음을 검사한다.)

`.agents/plugins/marketplace.json` — obra/superpowers가 쓰는 루트 플러그인 형태다 **[문서]**.

```json
{
  "name": "pota-harness",
  "plugins": [
    {
      "name": "pota",
      "source": { "source": "url", "url": "./" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

설치와 업데이트 **[소스, 미검증]**:

```sh
codex plugin marketplace add comento/pota-harness
codex plugin add pota@pota-harness        # 이 명령이 없는 버전에서는 TUI /plugins 에서 pota 설치
# 설치 뒤와 업데이트 뒤마다 TUI /hooks 에서 Pota hook 5개 승인 (§7)
codex plugin marketplace upgrade pota-harness
```

#### 1.4 Antigravity CLI

`plugin.json`(루트) — **[검증]** 로컬 `agy` 1.0.7은 `.antigravity-plugin/plugin.json`만 있는 디렉터리를 `Error: missing plugin.json: stat plugin.json`으로 거부했고, 루트 `plugin.json`이 있는 디렉터리는 `skills: 4 processed, agents: 2 processed, hooks: 1 processed`로 통과시켰다. `.antigravity-plugin/`은 1.3.2부터다 **[문서]**. 루트 manifest는 옛 버전과 새 버전에서 모두 읽히므로 이것 하나만 둔다.

```json
{
  "$schema": "https://antigravity.google/schemas/v1/plugin.json",
  "name": "pota",
  "displayName": "Pota Harness",
  "version": "2.0.0",
  "description": "Memory, planning, tool readiness, and two-gate verification harness for agent work.",
  "suggestedPrompts": [
    "Plan this change with pota-plan before implementing it",
    "Continue the active Pota goal in this repository"
  ],
  "author": { "name": "WkNam" },
  "homepage": "https://github.com/comento/pota-harness",
  "repository": "https://github.com/comento/pota-harness",
  "license": "MIT",
  "keywords": ["agent", "harness", "planning", "memory", "verification"]
}
```

`hooks.json`(루트) — hook 명령은 플러그인 루트를 cwd로 실행되므로 상대 경로를 쓴다 **[문서]**. `${PLUGIN_ROOT}`는 1.5.3 미만에서 설정되지 않고 validate가 경고하므로 쓰지 않는다.

```json
{
  "pota": {
    "SessionStart": [{ "type": "command", "command": "node ./scripts/pota-state-antigravity.mjs session-start", "timeout": 10 }],
    "PreInvocation": [{ "type": "command", "command": "node ./scripts/pota-state-antigravity.mjs pre-invocation", "timeout": 10 }],
    "PostToolUse": [{ "matcher": "^(write_to_file|replace_file_content|multi_replace_file_content)$", "hooks": [{ "type": "command", "command": "node ./scripts/pota-state-antigravity.mjs post-tool-use", "timeout": 10 }] }],
    "Stop": [{ "type": "command", "command": "node ./scripts/pota-state-antigravity.mjs stop", "timeout": 10 }]
  }
}
```

설치와 업데이트:

```sh
agy plugin install https://github.com/comento/pota-harness
# 업데이트: 같은 명령을 다시 실행 (1.1.28부터 관리 디렉터리를 통째로 교체 [문서])
```

README는 `agy` 1.5.6 이상을 권장 버전으로 적는다(Stop 입력의 `continuation_active`가 1.5.6부터). 어댑터는 그 필드가 없어도 동작한다(§3.3).

#### 1.5 세 호스트가 서로의 파일을 잘못 읽지 않는 이유

| 파일 | Claude | Codex | Antigravity |
| --- | --- | --- | --- |
| 루트 `plugin.json` | 읽지 않음 **[검증]** | `$schema`가 agent-plugins.org일 때만 읽음. 이 파일은 antigravity.google schema라 `.codex-plugin/plugin.json`으로 넘어감 **[소스]** | manifest |
| `.claude-plugin/plugin.json` | manifest | `.codex-plugin/plugin.json`이 먼저라 읽지 않음 **[소스]** | 읽지 않음 |
| `.claude-plugin/marketplace.json` | marketplace | `.agents/plugins/marketplace.json`이 먼저 **[소스]** | 해당 없음 |
| `hooks/hooks.json` | hook + mod | manifest `hooks`가 기본 탐색을 대체해 읽지 않음 **[소스]** | 읽지 않음(1.4.x부터 경고만) **[문서]** |
| `hooks/codex.json` | 읽지 않음 **[검증]** | hook | 읽지 않음 |
| 루트 `hooks.json` | 읽지 않음 **[검증]** | 읽지 않음 | hook |
| `claude/agents/` | manifest `agents`로 읽음 **[검증]** | 읽지 않음 | 읽지 않음(`agents/`가 아니므로) |

`agents/`를 루트에 두지 않는 이유: Antigravity도 루트 `agents/`를 읽는데 frontmatter `tools:`의 값이 Antigravity 도구 이름이어야 한다 **[문서]**. 지금 파일은 Claude 도구 이름(`agents/worker.md:4`)이라 두 호스트에 같은 파일을 쓸 수 없다. 기존 Antigravity 설치본에도 agent는 없었다(`scripts/pota-lifecycle-integrity.mjs:170-177`의 `ide-*`·`cli-*` 대상에 agent 없음).

`agy plugin validate`는 `hooks/hooks.json` 경고를 내므로 `--strict` 없이 실행한다.

**결정**: 위 9개 파일을 이 내용으로 둔다. marketplace 이름 `pota-harness`와 플러그인 id `pota@pota-harness`는 기존 `pota`/`pota@pota`와 겹치지 않아야 하므로 바꾸지 않는다.

### 2. Runtime 위치 결정

#### 2.1 규칙

1. hook: 호스트가 넣어 주는 값으로 스크립트를 찾는다. Claude `${CLAUDE_PLUGIN_ROOT}`, Codex `${PLUGIN_ROOT}`, Antigravity는 cwd 기준 상대 경로.
2. 스크립트끼리: `import.meta.url` 기준 상대 import(지금과 같다).
3. CLI 경로: `scripts/pota-state.mjs`의 `cliPrefixLine()`이 `fileURLToPath(new URL("./pota.mjs", import.meta.url))`만 쓴다. `installedCanonicalCli()`(`scripts/pota-state.mjs:224-231`)와 `.pota-runtime.json`은 지운다. 이 값은 hook이 실행될 때마다 계산하고 어디에도 저장하지 않는다.
4. skill·agent 본문: **`pluginRoot` = SessionStart가 출력한 `Pota CLI:` 줄에서 `scripts/` 위의 디렉터리.** 그 줄이 없을 때만 `SKILL.md`의 `../..`를 쓰고, 사용자에게 Pota hook이 꺼져 있다고 알린다. 세 호스트가 같은 문장을 쓴다. Claude의 본문 치환(`${CLAUDE_PLUGIN_ROOT}`)과 `bin/` PATH는 쓰지 않는다(호스트마다 달라지고, `bin/pota`는 남아 있을 수 있는 전역 npm `pota`와 이름이 겹친다).
5. Claude mod: `findCli()`(`claude-mod/hooks/register.tsx:107-124`)는 `` `${$.plugin.root}/scripts/pota.mjs` `` 한 곳만 본다. `pota-runtime.json` 읽기와 `../scripts` fallback은 지운다. `dag-text.mjs:24,63`의 `noRuntime` 문구는 "Pota 플러그인을 다시 설치하세요"/"Reinstall the Pota plugin."으로 바꾼다.

Bash 도구 환경에 플러그인 루트 변수가 없다는 문제는 4번으로 해결된다(에이전트가 절대 경로가 든 prefix를 그대로 복사한다. 지금 규칙과 같다).

#### 2.2 바꿀 문장 (바이트 예산 확인됨)

`skills/pota-plan/SKILL.md` 16행(455바이트 → 455바이트):

> `` `pluginRoot` is this session's Pota plugin copy: the directory above `scripts/` in the session-start `Pota CLI:` line; without that line, this file's `../..` (then tell the user Pota hooks are inactive). Never search the target repository for Pota files or derive `pluginRoot` from the cwd. If `pluginRoot` is missing or unreadable, stop and have the user reinstall or update the Pota plugin with the host's plugin command; never repair from another copy. ``

`skills/pota-plan/SKILL.md` 43행(201 → 197바이트): 끝을 `` …and report that the Pota plugin needs reinstalling. ``로 바꾼다.

`skills/pota-work/SKILL.md` 18행(425 → 419바이트):

> `` `pluginRoot` is this session's Pota plugin copy: the directory above `scripts/` in the session-start `Pota CLI:` line; without that line, this file's `../..` (then tell the user Pota hooks are inactive). Never search the target repository for Pota files; resolve `pota://...` IDs through `pluginRoot`. If `pluginRoot` is missing or unreadable, stop and have the user reinstall or update the Pota plugin (`recovery.md`). ``

결과: `pota-plan` 8995바이트, `pota-work` 8972바이트(둘 다 9000 이하, `python3`로 측정). 18·20행의 `Pota CLI:` 설명과 명령 예시는 그대로 둔다.

예산이 없는 파일은 같은 뜻으로 고친다: `skills/pota-memory/SKILL.md` 20·26행, `skills/pota-review/SKILL.md` 20행, `docs/model-guidance/README.md` 10행, `skills/pota-work/recovery.md` 30행. `recovery.md` 30행의 새 내용:

> `` If a `Pota CLI:` path stops working mid-session (`Cannot find module`), the host updated or removed that plugin copy: restart the session so SessionStart prints the new prefix; if it still fails, reinstall the plugin with the host's plugin command. No `Pota CLI:` line on Codex usually means Pota's hooks are not approved: ask the user to approve them in `/hooks`. ``

#### 2.3 세션 중 업데이트

| 호스트 | 동작 | 결과 |
| --- | --- | --- |
| Claude | 새 버전은 새 디렉터리(`~/.claude/plugins/cache/pota-harness/pota/<version>/`)에 놓이고 옛 디렉터리는 유예 기간 동안 남는다 **[문서, 기간 미검증]** | 진행 중인 세션은 옛 경로로 계속 동작. 다시 시작하면 새 경로 |
| Antigravity | 같은 경로(`~/.gemini/config/plugins/pota`)를 통째로 교체 **[문서]** | 경로는 그대로, 내용만 새 버전 |
| Codex | 옛 cache 디렉터리를 지울 수 있다(`scripts/pota-state.mjs:218`의 기존 주석) **[미검증]** | 옛 prefix가 `Cannot find module`로 실패 → `recovery.md` 문장대로 세션 재시작 |

**결정**: 위 5개 규칙과 문장을 쓴다. `scripts/pota-paths.mjs`에서 `RUNTIME_LOCATOR_SCHEMA_VERSION`, `createRuntimeLocator`, `runtimeEntryRelativePaths`, `runtimeRequiredRelativePaths`, `runtimeRequiredPaths`(124~190행)를 지운다. 각 skill의 `references/pota-runtime.json`은 더 이상 만들지 않는다.

### 3. Hook 배선

#### 3.1 이벤트 대응

| Pota 이벤트 | Claude (`hooks/hooks.json`) | Codex (`hooks/codex.json`) | Antigravity (`hooks.json` → 어댑터) |
| --- | --- | --- | --- |
| `session-start` | `SessionStart` | `SessionStart` | `SessionStart` |
| `user-prompt-submit` | `UserPromptSubmit` | `UserPromptSubmit` | `PreInvocation`에서 `invocationNum === 0`일 때 |
| `post-tool-use` | `PostToolUse`(matcher 그대로) | `PostToolUse`(matcher 그대로) | `PostToolUse`(편집 도구 3개). 결과는 다음 `PreInvocation`에 주입 |
| `stop` | `Stop` | `Stop` | `Stop`(`terminationReason === "model_stop"`일 때만) |
| `subagent-stop` | `SubagentStop` | `SubagentStop` | 없음(대응 이벤트 없음) |

Claude와 Codex는 `scripts/pota-state.mjs <event> <host>`를 그대로 쓴다. `pota-state.mjs`는 `process.argv[3]`을 호스트(`claude`|`codex`, 그 밖은 `unknown`)로 읽어 이전 알림(§6)에만 쓴다.

#### 3.2 Claude mod

`claude-mod/hooks/*` → `hooks/`, `claude-mod/types/index.d.ts` → `types/index.d.ts`, `claude-mod/tests/pane.test.tsx` → `tests/pane.test.tsx`, `claude-mod/tsconfig.json` → `tsconfig.json`(`include`는 그대로 `[".claude-plugin/types", "hooks", "types", "tests"]`). `claude-mod/.claude-plugin/plugin.json`은 지우고 `types` 선언은 루트 manifest가 갖는다. `tests/`는 `test/`와 이름이 달라 `node --test`의 기본 탐색에 걸리지 않고, `.tsx`는 탐색 패턴에 없다. `.gitignore`에 `.claude-plugin/types/`(엔진이 개발 중에 쓰는 타입 폴더)를 추가한다.

#### 3.3 Antigravity 어댑터 `scripts/pota-state-antigravity.mjs`

`runStateResult(event, { payload, … })`(`scripts/pota-state.mjs:44`)를 같은 프로세스에서 부르고 입출력만 바꾼다. 실패는 모두 삼키고 `{}`를 출력한다(Antigravity는 0이 아닌 종료를 기록만 하고 무시한다 **[문서]**).

입력 변환(공통): `session_id = conversationId`, `cwd = workspacePaths[0]`, `model = modelName`.

| 어댑터 인자 | 하는 일 | 출력 |
| --- | --- | --- |
| `session-start` | `runStateResult("session-start", { payload, host: "antigravity", commentChecker: { autoFetch: true } })` | `additionalContext`가 있으면 `{"injectSteps":[{"systemMessage":{"systemMessage":"<text>"}}]}`, 없으면 `{}` |
| `pre-invocation` | `invocationNum === 0`이면 `user-prompt-submit` 캡슐을 만들고, 세션 파일에 쌓인 pending 문장이 있으면 뒤에 붙인 뒤 비운다. `invocationNum > 0`이면 pending만 내보낸다 | 위와 같은 `injectSteps` 또는 `{}` |
| `post-tool-use` | `toolCall.name`·`toolCall.args`를 Claude 모양으로 바꿔 `post-tool-use`를 실행: `write_to_file{TargetFile, CodeContent}` → `Write{file_path, content}`, `replace_file_content{TargetFile, TargetContent, ReplacementContent}` → `Edit{file_path, old_string, new_string}`, `multi_replace_file_content{TargetFile, ReplacementChunks[]}` → `MultiEdit{file_path, edits[]}`. 결과의 `reason`/`additionalContext`를 pending에 저장 | 항상 `{}`(Antigravity의 PostToolUse 출력은 비어 있어야 한다 **[문서]**) |
| `stop` | `terminationReason !== "model_stop"`이면 아무것도 하지 않는다. 아니면 `stop_hook_active = continuation_active ?? (세션 파일의 stopBlockedFor === sha256(lastUserInput))`로 `stop`을 실행 | `decision: "block"`이면 `{"decision":"continue","reason":"<reason>"}`를 내고 `stopBlockedFor`를 기록, 아니면 `{}` |

- 사용자에게 보일 `systemMessage`(이전 알림 등)는 따로 내보낼 통로가 확인되지 않아 주입 문장에 같이 넣는다.
- 세션 파일: `<POTA_HOME>/hosts/antigravity/<sha256(conversationId) 앞 16자>.json`, 내용 `{ schemaVersion: 1, pending: [..최대 8개], stopBlockedFor }`. pending이나 Stop 차단이 생길 때만 만든다. 쓸 때 14일 지난 파일을 지운다. 경로 검사와 쓰기는 `assertNoSymlinkComponents`·`safeWriteFile`(`scripts/pota-safe-fs.mjs:26,74`)을 쓴다.
- 반복 차단 방지는 지금 로직 그대로다: `stop_hook_active`이고 진행이 없으면 통과(`scripts/pota-state-hook.mjs:11`, `recordStopProgress` `scripts/pota-state.mjs:190-206`). Antigravity 자체도 계속 막는 Stop hook을 N번 뒤 끊는다(1.1.9 **[문서]**).
- 캡슐 예산: `pre-invocation`의 캡슐은 `user-prompt-submit` 결과를 그대로 쓰므로 active 700자·idle 620자 예산이 그대로 적용된다. pending 문장은 있을 때만 붙는다.

**결정**: hook 파일 3개, 어댑터 1개. `SubagentStop`은 Antigravity에서 지원하지 않는다고 README에 적는다.

### 4. Command, agent, workflow

| 지금 | 2.0.0 | 이유 |
| --- | --- | --- |
| `commands/pota-{plan,work,review,memory}.md` | 삭제 | 같은 이름의 skill이 세 호스트에서 호출된다(Claude `/pota:pota-plan`, Antigravity `/pota-plan`, Codex `$pota-plan`) |
| `commands/pota-{install,upgrade,uninstall}.md` | 삭제 | 설치 프로그램이 없다 |
| `commands/pota-doctor.md` | 삭제 | `pota doctor`는 CLI로만 남는다(§5.3) |
| `commands/pota-toolcheck.md` | 삭제, skill로 만들지 않음 | `pota-plan` 절차 5번이 `toolcheck`를 실행한다. skill을 하나 더 두면 모든 세션에 설명 한 줄이 늘어난다. Tool Readiness 정본은 `skills/pota-plan/planning-rules.md`와 `skills/pota-work/verification.md`에 그대로 있다 |
| `.claude/commands/*.md` 9개 | 삭제 | 설치 프로그램이 렌더링하던 포인터다. 플러그인에서는 쓰이지 않는다 |
| `.claude/agents/{explorer,worker}.md` | 삭제 | 같은 이유 |
| `.agents/workflows/*.md` 9개 | 삭제 | workflow는 Antigravity 플러그인 구성요소가 아니다 **[문서]** |
| `agents/{explorer,worker}.md` | `claude/agents/`로 이동(내용 그대로) | §1.5 |

`{{POTA_RUNTIME_LOCATOR_JSON}}`은 위 삭제로 저장소에서 사라진다. `test/plugin-manifests.test.mjs`가 추적 파일 전체에 이 문자열이 없음을 검사한다.

README 8개에 옮겨 온 사용자를 위한 대응표를 넣는다: `/pota-plan` → Claude `/pota:pota-plan`·Antigravity `/pota-plan`·Codex `$pota-plan`, `/pota-toolcheck` → 에이전트에게 "pota toolcheck 실행" 요청, `pota install|upgrade|uninstall` → 호스트의 플러그인 명령.

**결정**: 위 표대로 한다. `test/contract-parity.test.mjs`, `test/token-efficiency.test.mjs`, `test/docs-package-hardening.test.mjs`의 표면 목록에서 command·workflow·mirror 경로를 빼고 `agents/` 경로를 `claude/agents/`로 바꾼다. 이것은 계약 변경이므로 계획의 `## Heavy Design`에 먼저 기록한다.

### 5. 지울 코드와 남길 코드

#### 5.1 삭제 (13 + 1개 파일)

`scripts/pota-lifecycle.mjs`, `-claude`, `-commands`, `-config`, `-hosts`, `-integrity`, `-layout`, `-mirror`, `-staging`, `-transaction`, `-transaction-journal`, `-transaction-targets`, `scripts/pota-auto-upgrade.mjs`, `scripts/pota-update-state.mjs`, 그리고 `scripts/pota`.

#### 5.2 유지와 이동

| 대상 | 처리 |
| --- | --- |
| `scripts/pota-lifecycle-lock.mjs` (`createLifecycleLock`) | **한 글자도 바꾸지 않고 남긴다.** 이전 처리가 기존 설치 프로그램과 같은 lock 파일·같은 규약(`<POTA_HOME>/install/lifecycle.lock`)으로 서로를 배제해야 하고, `pota-comment-checker.mjs:287`도 같은 구현을 쓴다. 오류 문구 `Timed out waiting for Pota lifecycle lock`(`pota-comment-checker.mjs:30`이 비교)도 그대로다 |
| `readJsonFile`, `writeJsonAtomic`, `writeFileAtomic` (`pota-update-state.mjs:44-65`) | `scripts/pota-safe-fs.mjs`로 그대로 옮긴다. `pota-comment-checker.mjs:10`, `pota-model-ceiling.mjs:4`의 import를 고친다 |
| `runningInstall`, `readInstallManifest`, `updatePaths` | 삭제. `pota-comment-checker.mjs`는 `config.json` 경로를 `join(potaHome(env), "config.json")`으로 직접 만든다 |
| comment-checker 내려받기 조건 (`pota-comment-checker.mjs:251-253`) | "설치된 runtime일 때만"을 "hook 진입점이 `commentChecker: { autoFetch: true }`를 넘겼을 때만"으로 바꾼다. `pota-state.mjs`의 CLI 진입부(24~38행)와 Antigravity 어댑터만 이 값을 넘긴다. 라이브러리 기본값은 내려받지 않으므로 테스트가 네트워크를 쓰지 않는다(모델 상한의 "라이브러리 기본값은 환경을 읽지 않는다"와 같은 방식, `pota-state.mjs:51`). 자식은 `resolvePluginRoot(import.meta.url)`의 `scripts/pota-comment-checker.mjs fetch` |
| `sessionStartUpdate`, `withUpdateNotice`, `updateNoticeLine` (`pota-state.mjs:247-257`, `pota-state-context.mjs:133-155`) | 삭제. 같은 자리에 `withMigrationNotice`가 들어간다(§6) |
| `autoUpgrade` 설정, `POTA_AUTO_UPGRADE` | 읽지 않는다. `config.json`에 남아 있어도 무시한다 |
| `pota-paths.mjs` | locator 코드 삭제(§2). `potaHome`, `installRoot`, `installManifestPath`(9~22행)는 이전 처리가 쓰므로 남긴다 |
| `pota-cleanup.mjs`, goal·index·toolcheck·model 스크립트 | 변경 없음 |

#### 5.3 CLI (`scripts/pota.mjs`)

- 명령 집합: `doctor|migrate|cleanup|init|memory|plan|work|review|toolcheck|goal|task`.
- `install`, `upgrade`, `uninstall`, `auto-upgrade`는 한 줄을 출력하고 exit 2로 끝난다: `pota <command> was removed in 2.0.0. Install or update Pota with your host's plugin command: https://github.com/comento/pota-harness#install`. lifecycle 프로세스를 띄우던 24~28행과 83~87행은 지운다.
- usage 문자열 8개(144, 151, 158, 165, 172, 179, 186, 193행)는 각 locale의 머리말은 그대로 두고 명령 목록만 `pota doctor|migrate|cleanup|init|memory|plan|work|review|toolcheck|goal|task`로 바꾼다.
- `pota doctor`(새 파일 `scripts/pota-doctor.mjs`, 읽기 전용, 출력 라벨은 영문 고정, `--json` 지원): `version`, `pluginRoot`, `node`, `potaHome`(쓰기 가능 여부), 이 플러그인 사본의 버전 표면 4개 일치 여부, 필수 파일 존재(`scripts/pota-state.mjs`, `skills/*/SKILL.md`, `templates/`), 기존 npm 설치본 상태(`none`|`present <version>`|`blocked <reason>`), 마지막 이전 보고서 요약, comment-checker 상태. 문제가 있으면 exit 1. 호스트 간 버전 비교는 하지 않는다(S1).
- `pota migrate status|run [--dry-run] [--json]`: §6의 모듈을 사람이 직접 실행하는 통로다.
- 버전은 계속 `<pluginRoot>/package.json`에서 읽는다(13행).

#### 5.4 `package.json` (2.0.0, npm에 게시하지 않음)

```json
{
  "name": "@comento/pota-harness",
  "version": "2.0.0",
  "private": true,
  "description": "Token-efficient agent harness with tool readiness for Codex, Claude Code, and Antigravity",
  "license": "MIT",
  "author": { "name": "WkNam" },
  "homepage": "https://github.com/comento/pota-harness",
  "repository": { "type": "git", "url": "git+https://github.com/comento/pota-harness.git" },
  "scripts": {
    "check": "node --check scripts/pota.mjs && node --check scripts/pota-paths.mjs && node --check scripts/pota-safe-fs.mjs && node --check scripts/pota-goal.mjs && node --check scripts/pota-state.mjs && node --check scripts/pota-state-antigravity.mjs && node --check scripts/pota-cleanup.mjs && node --check scripts/pota-legacy-migration.mjs && node --check scripts/pota-doctor.mjs && node --check scripts/pota-lifecycle-lock.mjs && node --check scripts/pota-comment-checker.mjs && node --check scripts/pota-toolcheck.mjs && npm test",
    "test": "node --test"
  },
  "engines": { "node": ">=18" }
}
```

- `private: true`: 실수로 `npm publish`하는 것을 npm이 거부한다. 파일은 남긴다(`scripts/pota.mjs:13`이 버전을 읽고, `npm run check`가 필요하다).
- `bin`, `files`, `keywords`, `prepack` 삭제. manifest JSON 유효성은 `check`의 inline `JSON.parse` 대신 `test/plugin-manifests.test.mjs`가 본다.

**결정**: 위와 같다.

### 6. 이전(migration)

#### 6.1 2.0.0 플러그인의 기존 설치본 제거

새 파일 `scripts/pota-legacy-migration.mjs` 하나에 담는다. 지워질 lifecycle 모듈을 import하지 않고, 필요한 규칙(허용 목록, digest, config 구획 제거)을 1.4.0 코드에서 옮겨 적는다.

##### 감지 (SessionStart 안, 동기, 수 ms)

`pota-state.mjs`의 `session-start`에서 캡슐을 만든 뒤 `withMigrationNotice(result, ko, { env, now, spawn, pluginRoot, host })`를 부른다. 이 단계의 오류는 모두 삼켜 캡슐과 exit code를 바꾸지 않는다(지금 `withUpdateNotice`와 같은 규칙).

1. `POTA_LEGACY_MIGRATION`이 `0|false|off|no`면 아무것도 하지 않는다.
2. `<POTA_HOME>/migration/report.json`에 아직 보여 주지 않은 보고서가 있으면 rename으로 가져와 한 줄 알림을 만든다(한 세션만 한 번 보여 준다. `claimNotice`와 같은 방식).
3. `lstat(<POTA_HOME>/install/lifecycle.json)`: 없으면 끝. 표시 파일로 "이미 이전함"을 기억하지 않는다. 남아 있는 전역 npm `pota`로 누군가 다시 설치할 수 있으므로 SessionStart마다 본다(비용은 `lstat` 한 번).
4. 있으면 실행 조건을 본다: `<POTA_HOME>/migration/state.json`의 `{ manifestKey, spawnedAt }`에서 `manifestKey`(manifest의 `mtimeMs:size`)가 다르거나, 10분이 지났는데 보고서가 없거나, `blocked` 보고서가 24시간 지났으면 실행한다.
5. 실행: `spawn(process.execPath, ["<pluginRoot>/scripts/pota-legacy-migration.mjs", "run", "--host", host], { detached: true, stdio: "ignore" }).unref()`(자동 업그레이드 runner와 comment-checker fetch가 쓰는 방식). `state.json`을 쓰고 "제거 중" 알림을 붙인다.

hook 안에서 직접 지우지 않는 이유: hook 제한이 10초인데 제거에는 runtime 트리 4개의 digest 계산과 `claude` CLI 호출 2~3번(각 수 초)이 들어간다.

##### 소유 확인 (runner, 삭제 전에 전부 끝낸다)

1. manifest: `POTA_HOME`부터 symlink 구성요소가 없고, 일반 파일이고, 1MB 이하이고, JSON이며, `schemaVersion === 2`, `plugin === "pota"`, `version`이 semver 모양, `targets[]`·`retained[]`의 각 항목이 필요한 키만 가진다(`validateOwnershipShape`의 모양 검사와 같다).
2. 허용 목록: 각 `targets[i]`의 `(id, phase, path, type)`이 현재 환경(`HOME`/`USERPROFILE`, `POTA_HOME`, `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`)에서 다시 계산한 값과 같아야 한다. 계산식은 `scripts/pota-lifecycle-integrity.mjs:179-203`과 `scripts/pota-lifecycle-layout.mjs:10-33`, `scripts/pota-lifecycle.mjs:36-42`를 그대로 옮긴다(명령 9개, skill 4개, agent 2개 이름 고정). `retained[]`는 `id ∈ {runtime, codex-runtime}`이고 경로가 그 버전의 runtime 경로와 같아야 한다. 기존 검사와 달리 "대상 집합이 완전한가"는 보지 않는다(1.3.x manifest와 중단된 제거를 받아들이기 위해서다).
3. 1·2 중 하나라도 실패하면 **아무것도 지우지 않고** `blocked`(`manifest-invalid`|`manifest-unsupported-schema`|`target-outside-allowlist`)로 끝낸다.
4. `<POTA_HOME>/install/transaction.json`이 있으면(기존 설치 프로그램의 중단된 트랜잭션) `blocked: transaction-pending`.
5. 대상별 digest(`targetDigest`, 같은 알고리즘): `installedDigest`와 같으면 `verified`, 없으면 `missing`(할 일 없음), 다르거나 symlink·특수 파일이면 `modified`. **`modified`는 지우지 않고 보고서에 경로를 남긴다.** 기존 `uninstall()`처럼 전체를 거부하지 않는 이유는, 대상 하나가 달라졌다고 hook이 두 벌로 도는 상태가 계속되는 것이 더 나쁘기 때문이다.

##### 제거 순서 (lock 안)

lock: `createLifecycleLock({ lifecycleLockPath: <POTA_HOME>/install/lifecycle.lock }).withLifecycleLock(op, { timeoutMs: 0, afterRelease })`. 잡지 못하면(다른 호스트의 runner, 기존 `pota upgrade`, 자동 업그레이드) 조용히 끝내고 다음 SessionStart에서 다시 시도한다. `<POTA_HOME>/update/update.lock`을 살아 있는 프로세스가 쥐고 있어도 같다.

1. **호스트 등록 해제** (파일보다 먼저. 호스트가 지워진 파일을 가리키는 시간을 줄인다)
   - Claude(manifest에 `claude-plugin` 대상이 있을 때): `claude plugin marketplace list --json`에서 이름이 `pota`이고 경로가 `<POTA_HOME>/install/claude`로 풀리는 항목이 있을 때만 `claude plugin uninstall pota@pota`, `claude plugin marketplace remove pota`를 실행한다(`createClaudeRegistration().unregister()`의 소유 판정과 같다. 각 호출 30초 제한). 경로가 다르면 남의 marketplace이므로 건드리지 않는다. `claude` CLI가 없거나 실패하면 **파일 제거는 계속하고** 보고서의 `manual`에 두 명령을 적는다. Claude의 JSON 파일을 직접 고치지 않는다. `~/.claude/plugins/cache/pota/pota/<version>`은 Claude 소유이므로 지우지 않는다(`uninstall`이 지운다).
   - Codex(manifest에 `codex-config` 대상이 있을 때): `$CODEX_HOME/config.toml`에서 `[marketplaces.pota]`, `[plugins."pota@pota"]`, `[hooks.state."pota@pota:…"]` 구획만 뺀다(`removePotaConfig`·`splitSections`·`isPotaConfigSection`을 옮김). 구획 이름은 정확히 일치해야 하므로 `[marketplaces.pota-harness]`, `[plugins."pota@pota-harness"]`, `[hooks.state."pota@pota-harness:hooks/codex.json:…"]`는 남는다(`pota@pota:`는 `pota@pota-harness:`의 접두어가 아니다. 테스트로 고정). `[marketplaces.pota]`의 경로가 `<POTA_HOME>/install/codex` 아래가 아니면 건드리지 않는다. 쓰기는 같은 디렉터리의 임시 파일 + rename이고, 읽은 뒤 내용이 바뀌었으면 포기하고 다음 실행에 맡긴다. symlink인 `config.toml`은 거부한다(`readSharedConfigSnapshot`과 같다). 백업 파일은 만들지 않는다(설정에 비밀값이 있을 수 있다).
2. **`antigravity`, `claude` phase의 대상** (역순): `~/.gemini/config/skills/pota-*`, `~/.gemini/config/workflows/pota-*.md`, `~/.gemini/antigravity-cli/{skills,workflows}/pota-*.md`, 두 `pota/runtime.json`, `~/.claude/commands/pota-*.md`, `~/.claude/agents/pota-{explorer,worker}.md`, `~/.claude/pota/runtime.json`, `<POTA_HOME>/install/claude`.
3. **`codex` phase의 대상**: `$CODEX_HOME/plugins/cache/pota/pota/<version>`, 보존된 codex runtime, `<POTA_HOME>/install/codex/…`.
4. **`core`**: `<POTA_HOME>/install/runtime/<version>`과 보존된 runtime.
5. `<POTA_HOME>/update/`의 알려진 파일(`state.json`, `notice.json`, `last-run.log`, `plugin-notice.json`, `stage/`).
6. **manifest `lifecycle.json`은 맨 마지막.**
7. lock을 놓은 뒤(`afterRelease`) 빈 디렉터리 정리: `install/transactions`, `install/codex`, `install/runtime`, `install`, `update`, `~/.claude/pota`, `~/.gemini/config/pota`, `~/.gemini/antigravity-cli/pota`, `$CODEX_HOME/plugins/cache/pota/pota`, `$CODEX_HOME/plugins/cache/pota`. 모두 `rmdir`만 쓰고 비어 있지 않으면 남긴다.
8. `<POTA_HOME>/migration/report.json`을 쓴다.

삭제 방식: 파일은 `unlink`. 트리는 같은 부모 안에서 `<path>.pota-removing-<manifest.transactionId>`로 rename한 뒤 지운다.

##### 동시성, 멱등성, 중단 안전

- 여러 호스트의 SessionStart가 동시에 runner를 띄워도 lock을 잡은 하나만 일한다.
- 모든 단계가 다시 실행해도 같은 결과다: 이미 없는 대상은 `missing`, 등록 해제는 "없음"을 성공으로 본다.
- 중간에 죽어도 manifest가 남아 있으므로 다음 SessionStart가 다시 시작한다. 트리를 지우다 죽은 경우 남은 것은 `<path>.pota-removing-<transactionId>`이고, 이름을 manifest에서 다시 계산할 수 있으므로 다음 실행이 지운다(반쯤 지워진 트리가 `modified`로 오인되어 영영 남는 일을 막는다).
- runner 전체 제한은 120초다. 넘기면 끝내고 다음에 이어 한다.
- manifest 삭제 뒤 7번 전에 죽으면 빈 디렉터리만 남는다. `pota doctor`가 보여 준다.

##### 알림 (en·ko, 각 240자 이하를 테스트로 고정)

| 상황 | 문구(en) |
| --- | --- |
| runner를 띄운 세션 | `Pota: removing the legacy npm install in the background. Legacy Pota hooks and commands stop working in this session; restart it when convenient.` |
| 완료(다음 SessionStart, 한 번) | `Pota: removed the legacy npm install (<version>). Kept <k> modified items; other hosts need the plugin: <hosts>. Details: pota doctor` (k=0, hosts 없음이면 그 절을 뺀다) |
| 막힘(7일에 한 번) | `Pota: could not remove the legacy npm install (<reason>). Run npx @comento/pota-harness@1.5.0 uninstall, then restart. Details: pota doctor` |

- `<hosts>`는 manifest의 `hosts`에서 지금 호스트를 뺀 목록이다. 다른 호스트에 플러그인이 설치됐는지는 확인하지 않는다(S1, 다른 호스트의 저장소를 읽지 않는다).
- 알림은 캡슐 맨 끝(`Pota CLI:` 줄 뒤)에 붙이고 `systemMessage`에도 넣는다. UserPromptSubmit 캡슐은 바뀌지 않는다.
- 첫 세션에서는 기존 hook과 새 hook이 같이 돈다(호스트가 hook을 세션 시작 때 읽기 때문이다). 캡슐과 Stop 판정이 두 번 나오고, 기존 `Pota CLI:` 경로는 제거 뒤 실패한다. 그래서 "제거 중" 알림이 재시작을 안내한다.

##### 지우지 않는 것

`<POTA_HOME>/projects/`(goal 상태), `<POTA_HOME>/config.json`, `<POTA_HOME>/tools/comment-checker/`, manifest에 없는 모든 파일, `modified` 대상, 사용자의 `~/.claude/commands`·`~/.claude/agents`·`skills`·`workflows` 디렉터리 자체, Claude의 플러그인 저장소 파일, 전역 npm 패키지(README에 `npm uninstall -g @comento/pota-harness` 안내), 새 플러그인의 Codex 설정 구획. 기존 Antigravity 설치본은 hook을 등록하지 않았으므로(`scripts/pota-lifecycle-staging.mjs`) `~/.gemini/config/hooks.json`은 건드릴 것이 없다.

manifest 없이 남은 옛 파일(1.3 이전 배치, 수동으로 `~/.pota/install`만 지운 경우)은 소유를 증명할 수 없으므로 지우지 않는다. README에 `npx @comento/pota-harness@1.5.0 uninstall`을 먼저 실행하라고 적는다.

#### 6.2 (a) 1.5.0: 안내 전용 마지막 npm 버전

- **브랜치**: `origin/main`의 `122b031`(1.4.0)에서 `release/1.x`를 만들어 origin에 올리고, 작업 브랜치 `chore/plugin-notice-1.5.0` → `release/1.x` PR로 넣는다(`ci.yml`의 `pull_request`는 base를 가리지 않으므로 CI가 돈다). **`dev`·`main`에 병합하지 않는다**(2.0.0이 그 코드를 지운다). `release/1.x`는 지우지 않고 남긴다. 릴리스 기록은 `dev`의 `docs/memory/release-process.md`에 문서로만 남긴다.
- **변경 파일**
  - `scripts/pota-update-state.mjs`: `claimPluginNotice(paths, { now })` 추가. `<POTA_HOME>/update/plugin-notice.json`의 `{ schemaVersion: 1, shownAt }`이 없거나 7일이 지났을 때만 참이고, 참을 돌려주기 전에 `writeJsonAtomic`으로 `shownAt`을 먼저 쓴다. `updatePaths`에 `pluginNotice` 경로를 넣고 `removeUpdateState`의 삭제 목록에 추가한다.
  - `scripts/pota-state-context.mjs`: `pluginNoticeLines({ ko, hosts })` 추가(아래 문구).
  - `scripts/pota-state.mjs`: `withUpdateNotice` 뒤에 `withPluginNotice`를 붙인다. `runningInstall(pluginRoot, paths)`가 참일 때(설치된 runtime, 소스 checkout 아님)만 동작하고 오류는 삼킨다.
  - 버전 표면 1.5.0: `package.json`, `.codex-plugin/plugin.json`, `claude-mod/.claude-plugin/plugin.json`.
  - 테스트: `test/auto-upgrade.test.mjs`(7일 제한, 동시 세션 한 번만), `test/token-efficiency.test.mjs`(문구 길이).
  - `README.md`와 번역 7개: 맨 위에 플러그인 설치로 옮겼다는 문단 하나.
  - 그 밖의 코드(lifecycle, runner)는 바꾸지 않는다. 스스로 제거하지 않는다.
- **문구**: 전체 안내는 사용자에게 보이는 `systemMessage`에만 넣고, 모델 컨텍스트에는 짧은 한 줄만 넣는다(에이전트가 설치 명령을 스스로 실행하지 않게 한다).
  - `systemMessage`(en, manifest의 `hosts`에 있는 호스트 줄만):
    `Pota now installs as a host plugin; this npm install (1.5.0) is the last one. The plugin removes this install on its first session.`
    `Claude Code: claude plugin uninstall pota@pota && claude plugin marketplace add comento/pota-harness && claude plugin install pota@pota-harness`
    `Codex: codex plugin marketplace add comento/pota-harness, install pota from /plugins, then approve its hooks in /hooks`
    `Antigravity: agy plugin install https://github.com/comento/pota-harness`
  - `additionalContext`(160자 이하): `Pota notice: this npm install is final; the user was shown host plugin install commands. Do not run them unless asked.`
  - Claude 줄에 `claude plugin uninstall pota@pota`를 넣는 이유: 이름이 같은 플러그인 두 개(`pota@pota`, `pota@pota-harness`)가 같이 켜진 상태를 Claude가 어떻게 다루는지 확인하지 못했다(§12 U6). 먼저 지우면 그 상태가 생기지 않는다. marketplace `pota` 항목은 남지만 플러그인의 이전 처리가 지운다.
- **잔소리 방지**: 7일에 한 번, 먼저 가져간 세션 하나만. 기존 Antigravity 설치본은 hook이 없어 이 안내가 뜨지 않으므로, Claude·Codex 세션의 안내에 Antigravity 줄을 같이 넣는다. Antigravity만 쓰는 사용자는 npm deprecated 문구와 README로 안내받는다.
- **기존 사용자의 경로**: 1.4.0의 runner가 `npm view …@latest`로 1.5.0을 받아 `pota-lifecycle.mjs upgrade --auto`를 실행한다. 진입점·manifest 버전 판정·exit code는 1.4.0과 같으므로 runner 계약은 바뀌지 않는다. 그 뒤 `latest`는 1.5.0에 머문다.
- **게시 순서**: ① 2.0.0을 `main`에 병합(플러그인이 설치 가능해진 뒤에 안내해야 한다) → ② `release/1.x`의 정확한 SHA에서 tarball을 만들어 사용자가 `npm publish`(기존 절차) → ③ 이 컴퓨터에서 1.4.0 → 1.5.0 자동 업그레이드와 안내 확인 → ④ 플러그인 설치와 기존 설치본 제거 확인 → ⑤ `npm deprecate @comento/pota-harness "Pota moved to host plugins: https://github.com/comento/pota-harness#install"`. deprecate를 마지막에 두는 이유는 ③이 deprecate 경고와 무관하게 통과하는 것을 먼저 보기 위해서다.

#### 6.3 (b) 2.0.0의 `package.json`

§5.4와 같다: `private: true` 유지, `bin` 삭제, `files`·`prepack` 삭제, `npm run check`는 남은 스크립트의 `node --check`와 `npm test`. `npm pack`은 어디에서도 실행하지 않는다.

**결정**: §6.1~6.3 그대로. 호스트 간 버전 비교는 어디에도 없다.

### 7. Codex hook 신뢰

- 플러그인 hook은 설치만으로 신뢰되지 않는다. HEAD 소스에서 신뢰는 선언 해시와 **플러그인 전체 내용 해시**(`codex-plugin-bundle-v1`, 루트의 모든 파일)를 같이 본다 **[소스]**. 따라서 내용 해시를 보는 Codex에서는 **업데이트할 때마다 다시 승인해야 하고**, Pota가 이를 피할 방법은 없다. 설치 프로그램이 `config.toml`에 신뢰를 대신 적던 동작은 없앤다(되살리지 않는다).
- 설계 규칙
  1. Pota는 자기 플러그인 루트 안에 파일을 쓰지 않는다(쓰면 내용 해시가 바뀌어 승인이 풀린다). 쓰는 곳은 `<POTA_HOME>`뿐이다. `test/plugin-manifests.test.mjs`가 스크립트에 `pluginRoot` 아래로 쓰는 코드가 없음을 정적으로 검사하지는 못하므로, 이 규칙은 `docs/memory`에 남기고 hook 테스트가 임시 플러그인 사본의 파일 목록이 hook 실행 전후로 같음을 확인한다.
  2. `hooks/codex.json`의 선언(명령, timeout, `statusMessage`, matcher, 파일 경로, 순서)은 선언 해시만 보는 옛 Codex를 위해 릴리스 사이에 바꾸지 않는다. 바꾸면 릴리스 노트에 재승인을 적는다.
  3. 승인을 건너뛰는 플래그(`--dangerously-bypass-hook-trust`)는 안내하지 않는다.
- 안내 위치: README 8개의 Codex 설치 절(설치 뒤와 업데이트 뒤 `/hooks`에서 5개 승인), 1.5.0 안내의 Codex 줄, `skills/pota-work/recovery.md` 30행. 승인하지 않으면 `Pota CLI:` 줄이 나오지 않고, skill의 fallback 문장이 사용자에게 hook이 꺼져 있다고 알리게 한다(조용히 넘어가지 않는다).

**결정**: 재승인은 받아들이고 위 세 곳에서 안내한다.

### 8. 버전 표면, 릴리스 절차, CI

- **버전 표면(4개)**: `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugin.json`. marketplace 파일 두 개에는 버전을 적지 않는다. `test/contract-parity.test.mjs:9-27`의 검사는 이 4개가 같은지로 바꾼다.
- **릴리스 절차**: feature → `dev` PR → `main` PR. **`main` 병합이 배포다**(Claude·Codex marketplace와 `agy plugin install <repo URL>`이 기본 브랜치를 읽는다. 저장소는 PUBLIC, 기본 브랜치 `main` **[검증]**). exact-main tarball과 `npm publish` 단계는 2.x에서 없앤다. `main`으로 가는 PR은 플러그인 내용이 바뀌면 반드시 4개 표면의 버전을 올린다(Claude는 버전 문자열이 바뀌어야 업데이트로 본다 **[문서]**). 병합 커밋에 `v<version>` 태그를 단다(`codex plugin marketplace add comento/pota-harness@v2.0.0`처럼 고정하거나 되돌릴 때 쓴다).
- **병합 뒤 확인**: 이 컴퓨터에서 `claude plugin marketplace update pota-harness && claude plugin update pota@pota-harness` 뒤 `claude plugin list --json`의 버전, `agy plugin install https://github.com/comento/pota-harness` 뒤 `agy plugin list`.
- **CI (`.github/workflows/ci.yml`)**
  - `check` matrix: `npm run check`, `node scripts/pota.mjs`, TypeScript 도구 설치, `node scripts/pota.mjs toolcheck --json`은 그대로. `npm pack --dry-run --ignore-scripts` 단계와 그 주석은 지운다. TypeScript 주석의 `claude-mod/`는 `hooks/`·`types/`로 고친다.
  - 새 job `host-validate`(`ubuntu-latest`, node current, `timeout-minutes: 15`, action은 SHA 고정, `check-summary`의 `needs`에는 **넣지 않는다**):
    - `npm install --global @anthropic-ai/claude-code@<구현 시점 버전 고정>` → `CLAUDE_CONFIG_DIR="$RUNNER_TEMP/claude" claude plugin validate .`
    - `npm install --global @openai/codex@<구현 시점 버전 고정>` → `CODEX_HOME="$RUNNER_TEMP/codex" codex plugin marketplace add "$GITHUB_WORKSPACE"` → `codex plugin add pota@pota-harness` → `codex plugin list --json` → `test -f "$CODEX_HOME"/plugins/cache/pota-harness/pota/*/hooks/codex.json`
    - 이 job은 Codex를 실제로 실행해 볼 수 있는 유일한 곳이다. 인증 없이 도는지는 **[미검증]**이므로 필수 검사에 넣지 않되, 실패하면 빨갛게 보인다. `verify` task가 결과를 읽고 기록한다. `agy`는 CI 설치 방법이 문서에 없어 넣지 않는다.
  - `test/docs-package-hardening.test.mjs:73`의 CI 검사는 pack 단계 요구를 빼고 새 job에도 권한·timeout·SHA 고정을 요구하도록 고친다.

**결정**: 위와 같다.

### 9. 테스트 계획

#### 9.1 지우는 테스트 (10개 파일 + 지원 3개)

`test/lifecycle.test.mjs`, `test/lifecycle-hardening.test.mjs`, `test/lifecycle-transaction.test.mjs`, `-commit`, `-hosts`, `-recovery`, `-rollback`, `test/auto-upgrade.test.mjs`, `test/installed-plugin.test.mjs`, `test/packed-install.test.mjs`, `test/support/lifecycle-transaction.mjs`, `test/fixtures/fake-npm.mjs`, `test/fixtures/fake-claude.mjs`.

이 중 계속 필요한 계약은 새 테스트로 옮긴다: lock의 dead-pid 회수·소유 확인(`lifecycle-hardening`·`lifecycle-transaction-commit`에 있던 것) → `test/lifecycle-lock.test.mjs`. 설치본에 대상 저장소 기준 상대 참조가 없어야 한다는 검사(`installed-plugin.test.mjs:229-236`) → `test/plugin-manifests.test.mjs`가 skill·agent·guidance 본문에 대해 같은 정규식으로 본다.

#### 9.2 고치는 테스트

| 파일 | 변경 |
| --- | --- |
| `test/claude-mod.test.mjs`, `-root`, `-term` | import 경로 `../claude-mod/hooks/` → `../hooks/`, `resolve("claude-mod")` → 루트 |
| `test/contract-parity.test.mjs` | 버전 표면 4개, command·workflow·`.claude` 표면 제거, `agents/` → `claude/agents/` |
| `test/token-efficiency.test.mjs` | 같은 표면 정리, "update notice lines" 테스트 삭제, SKILL.md 9000바이트 검사는 그대로 |
| `test/docs-package-hardening.test.mjs` | 명령 9개 인벤토리 삭제, agent 2개·skill 4개 인벤토리는 새 경로로, CI 검사 수정, README의 `--hosts`·`pota auto-upgrade`·`POTA_AUTO_UPGRADE=0`·`~/.pota/install/` 요구 삭제 |
| `test/cli-contract-hardening.test.mjs` | 228행의 lifecycle 명령 테스트 → 제거된 명령 4개가 안내 한 줄과 exit 2를 내는 테스트, usage 문자열 |
| `test/comment-checker.test.mjs` | 135행 "installed runtime only" → `autoFetch`가 참일 때만 한 번 띄운다, 229행 "install and upgrade report the fetch" 삭제 |

#### 9.3 새 테스트

| 파일 | 내용 |
| --- | --- |
| `test/plugin-manifests.test.mjs` | 9개 JSON이 파싱된다. 버전 4개가 같다. `hooks/codex.json`의 최상위 키는 `description`·`hooks`뿐이다(Codex `deny_unknown_fields`). `hooks/codex.json` = `hooks/hooks.json`에서 `modules` 제거 + 변수·호스트 토큰 치환. hook 명령이 가리키는 스크립트가 존재한다. `.codex-plugin/plugin.json`의 `hooks`가 `./hooks/codex.json`이다. 두 marketplace의 이름이 `pota-harness`, 플러그인 이름이 `pota`다. 루트 `plugin.json`의 `$schema`가 agent-plugins.org가 아니고 허용 키만 있다. `commands/`, `agents/`, `.claude/commands`, `.agents/workflows`, `claude-mod/`가 없다. 추적 파일에 `{{POTA_RUNTIME_LOCATOR_JSON}}`, `pota-runtime.json`이 없다 |
| `test/antigravity-hooks.test.mjs` | 어댑터를 자식 프로세스로 실행: camelCase 입력 변환, `injectSteps` 모양, `invocationNum` 0과 >0, PostToolUse가 항상 `{}`이고 pending이 다음 `pre-invocation`에 한 번만 나온다, 편집 도구 3개 변환, Stop의 `terminationReason` 분기와 `{"decision":"continue"}`, `continuation_active`가 없을 때의 반복 방지, 잘못된 stdin에서 `{}`와 exit 0, 캡슐 길이 예산 |
| `test/legacy-migration.test.mjs` | 임시 `HOME`·`POTA_HOME`에 만든 가짜 기존 설치본(`test/support/legacy-install.mjs`, digest는 모듈과 따로 구현)으로: 전부 `verified`면 모두 지우고 manifest가 마지막, `modified` 대상은 남고 보고됨, 허용 목록 밖 경로가 있으면 아무것도 지우지 않음, schema 1·깨진 manifest·symlink manifest 거부, `projects/`·`config.json`·`tools/`가 그대로, Codex `config.toml`에서 `pota@pota` 구획만 빠지고 `pota@pota-harness` 구획과 사용자 구획·주석이 바이트 그대로, 가짜 `claude` CLI로 소유 marketplace일 때만 해제·CLI 없음·남의 `pota` marketplace, lock을 다른 프로세스가 쥐면 아무것도 하지 않음, 각 단계 뒤에 죽인 다음 다시 실행하면 완료(`.pota-removing-*` 정리 포함), 두 번 실행해도 같은 결과, `--dry-run`은 쓰지 않음. `test/fixtures/legacy-lifecycle-1.4.0.json`(실제 1.4.0 설치 프로그램이 임시 HOME에 만든 manifest를 `<HOME>`으로 치환한 표본)을 모듈이 받아들이는지도 본다 |
| `test/session-start-migration.test.mjs` | SessionStart가 manifest 없을 때 캡슐을 바꾸지 않는다, 있을 때 runner를 한 번만 띄운다(주입한 `spawn`), 10분·24시간 조건, 보고서 알림은 한 세션만, `POTA_LEGACY_MIGRATION=0`, 알림 240자, 이 단계의 예외가 캡슐을 바꾸지 않는다, `Pota CLI:` 줄이 hook 스크립트 옆의 `pota.mjs`를 가리킨다 |
| `test/doctor.test.mjs` | 정상·기존 설치본 있음·필수 파일 없음의 출력과 exit code, `--json` |
| `test/lifecycle-lock.test.mjs` | §9.1에서 옮긴 lock 계약 |
| `test/readme-plugin-install.test.mjs` | README 8개가 호스트별 설치·업데이트 명령, Codex `/hooks` 승인, 대응표, `npx @comento/pota-harness@1.5.0 uninstall`을 담고 `pota install`·`pota upgrade`를 설치 방법으로 안내하지 않는다 |

#### 9.4 실제 설치 검증 (`verify` task, 임시 홈)

Claude Code(이 컴퓨터) — `CLAUDE_CONFIG_DIR`가 플러그인 설치를 격리한다 **[검증]**(임시 디렉터리에서 `claude plugin list --json`이 `[]`).

```sh
T=$(mktemp -d); export CLAUDE_CONFIG_DIR=$T/claude POTA_HOME=$T/pota
claude plugin validate .
claude plugin marketplace add "$PWD" && claude plugin install pota@pota-harness
claude plugin list --json          # installPath 확인, 버전 2.0.0
echo '{"cwd":"'$PWD'","session_id":"v"}' | node "<installPath>/scripts/pota-state.mjs" session-start claude
#  → Pota CLI: 줄이 <installPath>/scripts/pota.mjs 를 가리키는지
node "<installPath>/scripts/pota.mjs" doctor
```

같은 임시 홈에 가짜 기존 설치본과 이름이 `pota`인 디렉터리 marketplace를 등록한 뒤 `pota@pota`와 `pota@pota-harness`가 같이 설치되는지(U6), `node "<installPath>/scripts/pota.mjs" migrate run` 뒤 `claude plugin marketplace list --json`에 `pota-harness`만 남는지 본다. 인증이 필요한 실제 세션(mod pane, hook이 세션 안에서 도는지)은 임시 홈에서 할 수 없으므로 `release` task에서 이 컴퓨터의 실제 설치본을 교체할 때 확인한다.

Antigravity CLI(이 컴퓨터) — `HOME` 교체가 격리한다 **[검증]**(`No imported plugins.`).

```sh
T=$(mktemp -d)
HOME=$T agy plugin validate "$PWD"            # --strict 없이, exit 0
HOME=$T agy plugin install "$PWD" && HOME=$T agy plugin list
ls "$T/.gemini/config/plugins/pota"           # 설치 위치와 skills/, hooks.json, scripts/ 확인
cd "$T/.gemini/config/plugins/pota" && echo '{"conversationId":"v","workspacePaths":["'$OLDPWD'"]}' | node ./scripts/pota-state-antigravity.mjs session-start
```

로컬 `agy`는 1.0.7이다. 최신 버전에서의 동작(§12 U1~U5)은 사용자가 `agy update`를 한 뒤에만 확인할 수 있으므로, `verify`는 시험한 `agy` 버전을 기록하고 1.5.6 미만이면 그 사실을 미검증 항목으로 남긴다. 실제 세션 확인은 `release` task에서 한다.

Codex(대체 수단) — ① `test/plugin-manifests.test.mjs`의 소스 기반 계약 검사, ② CI `host-validate` job의 실제 설치, ③ README에 적은 수동 확인 절차(`codex plugin list`, `/hooks` 승인 뒤 첫 프롬프트에 `Pota CLI:` 줄). 잘못된 가정이 드러나는 방식은 §12에 적었다.

### 10. 구현 task 분할

`feat/plugin-native-install`에서 순서대로 한다. T1과 T2는 기존 파일을 건드리지 않는 추가만 하므로 병렬로 돌릴 수 있다. T3 끝에서는 `npm run check`가 **통과하지 않는다**(버전 표면과 표면 테스트가 T4에서 맞춰진다). 그래서 T3의 검증은 범위 안의 테스트 파일로 하고, T4의 두 번째 검증이 전체 check다. 그 밖의 task는 끝에서 `npm run check`가 통과한다.

#### T1 `legacy-migration`

- contract: §6.1의 모듈과 `pota doctor`(§5.3)를 독립 파일로 만든다. 기존 파일을 고치지 않고 lifecycle 모듈을 import하지 않는다. export: `sessionStartMigration({ env, now, spawn, pluginRoot, host })`, `migrationNoticeLine({ ko, notice })`, `planLegacyRemoval({ env })`, `runLegacyRemoval({ env, now })`, CLI `run|status [--dry-run] [--json] [--host <h>]`. `test/fixtures/legacy-lifecycle-1.4.0.json`은 아직 남아 있는 1.4.0 설치 프로그램을 임시 `HOME`에서 실행해 만든다.
- dependsOn: `[]`
- writeScope: `scripts/pota-legacy-migration.mjs`, `scripts/pota-doctor.mjs`, `test/legacy-migration.test.mjs`, `test/doctor.test.mjs`, `test/support/legacy-install.mjs`, `test/fixtures/legacy-lifecycle-1.4.0.json`
- 검증 1: `node --test test/legacy-migration.test.mjs test/doctor.test.mjs`
- 검증 2: `npm run check`

#### T2 `antigravity-adapter`

- contract: §3.3의 어댑터. `runStateResult`를 import해 쓰고 `pota-state.mjs`는 고치지 않는다.
- dependsOn: `[]`
- writeScope: `scripts/pota-state-antigravity.mjs`, `test/antigravity-hooks.test.mjs`
- 검증 1: `node --test test/antigravity-hooks.test.mjs`
- 검증 2: `npm run check`

#### T3 `runtime-cutover`

- contract: §5.1~5.4와 §2.1의 1~3번, §6.1의 감지 배선. lifecycle·자동 업그레이드 파일과 그 테스트를 지우고, CLI·hook 진입점·comment-checker·경로 모듈·`package.json`(2.0.0, private)을 고친다. `pota.mjs`에 `doctor`·`migrate` 연결, `pota-state.mjs`에 호스트 인자·`withMigrationNotice`·`autoFetch`. 끝에서 전체 check는 빨갛다(`contract-parity`의 버전 검사, `token-efficiency`의 `updateNoticeLine` import, `docs-package-hardening`).
- dependsOn: `["legacy-migration", "antigravity-adapter"]`
- writeScope: `scripts/pota.mjs`, `scripts/pota`, `scripts/pota-state.mjs`, `scripts/pota-state-context.mjs`, `scripts/pota-paths.mjs`, `scripts/pota-safe-fs.mjs`, `scripts/pota-comment-checker.mjs`, `scripts/pota-model-ceiling.mjs`, `scripts/pota-update-state.mjs`, `scripts/pota-auto-upgrade.mjs`, `scripts/pota-lifecycle.mjs`, `scripts/pota-lifecycle-claude.mjs`, `scripts/pota-lifecycle-commands.mjs`, `scripts/pota-lifecycle-config.mjs`, `scripts/pota-lifecycle-hosts.mjs`, `scripts/pota-lifecycle-integrity.mjs`, `scripts/pota-lifecycle-layout.mjs`, `scripts/pota-lifecycle-mirror.mjs`, `scripts/pota-lifecycle-staging.mjs`, `scripts/pota-lifecycle-transaction.mjs`, `scripts/pota-lifecycle-transaction-journal.mjs`, `scripts/pota-lifecycle-transaction-targets.mjs`, `package.json`, `test/lifecycle.test.mjs`, `test/lifecycle-hardening.test.mjs`, `test/lifecycle-transaction.test.mjs`, `test/lifecycle-transaction-commit.test.mjs`, `test/lifecycle-transaction-hosts.test.mjs`, `test/lifecycle-transaction-recovery.test.mjs`, `test/lifecycle-transaction-rollback.test.mjs`, `test/auto-upgrade.test.mjs`, `test/installed-plugin.test.mjs`, `test/packed-install.test.mjs`, `test/support/lifecycle-transaction.mjs`, `test/fixtures/fake-npm.mjs`, `test/fixtures/fake-claude.mjs`, `test/cli-contract-hardening.test.mjs`, `test/comment-checker.test.mjs`, `test/session-start-migration.test.mjs`, `test/lifecycle-lock.test.mjs`
- 검증 1: `node --test test/cli-contract-hardening.test.mjs test/comment-checker.test.mjs test/session-start-migration.test.mjs test/lifecycle-lock.test.mjs`
- 검증 2: `node --test test/legacy-migration.test.mjs test/doctor.test.mjs test/antigravity-hooks.test.mjs test/goal-state.test.mjs test/goal-dag.test.mjs test/index-context.test.mjs test/main-model-gate.test.mjs test/model-ceiling.test.mjs test/cleanup-hardening.test.mjs`

#### T4 `layout-cutover`

- contract: §1, §2.2, §3.1~3.2, §4, §8의 CI. manifest·hook 파일을 만들고, mod와 agent를 옮기고, command·workflow·mirror를 지우고, skill 문장을 바꾸고, 표면 테스트를 맞춘다. SKILL.md 두 개는 §2.2의 문장을 그대로 쓴다(9000바이트 이하).
- dependsOn: `["runtime-cutover"]`
- writeScope: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `.agents/workflows/`, `plugin.json`, `hooks.json`, `hooks/`, `types/`, `tests/`, `tsconfig.json`, `claude-mod/`, `claude/agents/`, `agents/`, `commands/`, `.claude/commands/`, `.claude/agents/`, `skills/`, `docs/model-guidance/README.md`, `.gitignore`, `.github/workflows/ci.yml`, `test/plugin-manifests.test.mjs`, `test/claude-mod.test.mjs`, `test/claude-mod-root.test.mjs`, `test/claude-mod-term.test.mjs`, `test/contract-parity.test.mjs`, `test/token-efficiency.test.mjs`, `test/docs-package-hardening.test.mjs`
- 검증 1: `node --test test/plugin-manifests.test.mjs test/contract-parity.test.mjs test/token-efficiency.test.mjs test/docs-package-hardening.test.mjs test/claude-mod.test.mjs test/claude-mod-root.test.mjs test/claude-mod-term.test.mjs`
- 검증 2: `npm run check`

#### T5 `docs`

- contract: README 8개(설치·업데이트·Codex 승인·대응표·옛 설치본 안내, 자동 업그레이드와 `--hosts` 절 삭제), `docs/memory` 갱신(`lifecycle-install.md`는 플러그인 설치와 이전 처리 내용으로 다시 쓰고, `hook-context.md`·`policy-surfaces.md`·`release-process.md`는 바뀐 표면·예산·절차로 고친다), `MEMORY.md` 인덱스.
- dependsOn: `["layout-cutover"]`
- writeScope: `README.md`, `README.ko.md`, `README.ja.md`, `README.zh.md`, `README.es.md`, `README.fr.md`, `README.de.md`, `README.pt.md`, `docs/memory/`, `MEMORY.md`, `test/readme-plugin-install.test.mjs`
- 검증 1: `node --test test/readme-plugin-install.test.mjs test/docs-package-hardening.test.mjs test/contract-parity.test.mjs`
- 검증 2: `npm run check`

#### T6 `notice-1x` (별도 worktree, `release/1.x`)

- contract: §6.2. `git worktree add <path> -b chore/plugin-notice-1.5.0 origin/main` 뒤 그 worktree에서만 작업한다. 이 저장소 worktree의 파일과 겹치지 않는다(goal 상태도 worktree별이다). 게시는 `release` task가 §6.2의 순서로 한다.
- dependsOn: `[]`(코드는 독립. 게시만 2.0.0의 `main` 병합 뒤)
- writeScope(그 worktree 기준): `scripts/pota-update-state.mjs`, `scripts/pota-state-context.mjs`, `scripts/pota-state.mjs`, `package.json`, `.codex-plugin/plugin.json`, `claude-mod/.claude-plugin/plugin.json`, `test/auto-upgrade.test.mjs`, `test/token-efficiency.test.mjs`, `README.md`, `README.ko.md`, `README.ja.md`, `README.zh.md`, `README.es.md`, `README.fr.md`, `README.de.md`, `README.pt.md`
- 검증 1: `node --test test/auto-upgrade.test.mjs test/token-efficiency.test.mjs`
- 검증 2: `npm run check`

### 11. 위험 (큰 것부터)

| 순위 | 위험 | 완화 |
| --- | --- | --- |
| 1 | hook이 사용자 홈의 파일을 자동으로 지운다. 소유 판정이 틀리면 사용자 파일이 사라진다 | manifest schema·허용 목록·digest 세 가지가 모두 맞는 대상만 지운다. 하나라도 구조 검사에 실패하면 전체 중단. `rmdir`은 빈 디렉터리만. 실제 1.4.0 manifest 표본으로 테스트. `POTA_LEGACY_MIGRATION=0`으로 끌 수 있고 `pota migrate run --dry-run`으로 미리 본다 |
| 2 | Codex를 이 컴퓨터에서 한 번도 실행하지 못한 채 배포한다 | 소스 기반 계약 테스트, CI `host-validate`, 가정이 틀리면 드러나는 설계(§12), README의 수동 확인 절차 |
| 3 | Codex 업데이트마다 hook 재승인이 필요해 사용자가 hook 없이 쓰게 된다 | README·안내·`recovery.md`, `Pota CLI:` 줄이 없을 때 skill이 사용자에게 알림 |
| 4 | 첫 세션에서 기존 hook과 새 hook이 같이 돌고, 이름이 같은 Claude 플러그인 두 개의 동작을 모른다 | 1.5.0 안내의 Claude 줄이 `pota@pota`를 먼저 지우게 한다. "제거 중" 알림이 재시작을 안내. `verify`가 임시 홈에서 공존을 시험 |
| 5 | 한 호스트에서 이전이 돌면 다른 호스트의 기존 설치본도 사라진다 | 완료 알림이 남은 호스트를 이름으로 알려 준다. README에 "쓰는 호스트 모두에 플러그인을 먼저 설치" 권장 |
| 6 | 로컬 `agy`가 1.0.7이라 최신 버전의 hook 동작을 확인하지 못했다 | 루트 `plugin.json`과 상대 경로로 옛 버전에서도 설치된다. 어댑터는 모르는 입력에 `{}`를 낸다. `verify`가 시험 버전을 기록 |
| 7 | `claude` CLI가 없어 등록 해제에 실패하면 Claude가 지워진 디렉터리를 가리킨다 | 보고서와 알림에 수동 명령 두 개. `pota doctor`에 표시 |
| 8 | T3 끝에서 전체 check가 빨갛다 | T3 → T4를 연속으로 실행하고 T4의 전체 check를 통과 조건으로 한다. T3·T4 사이에 커밋을 나누더라도 PR은 T5까지 끝난 뒤 연다 |
| 9 | 1.5.0은 게시하면 되돌릴 수 없다 | 문구와 7일 제한 외에는 코드를 바꾸지 않는다. 2.0.0이 `main`에 있고 이 컴퓨터에서 설치가 확인된 뒤에 게시 |
| 10 | 플러그인 사본에 `test/`, `docs/`, README 8개가 같이 설치된다 | 동작에 영향 없음. Codex 내용 해시가 문서 변경에도 바뀌지만 어차피 버전을 올릴 때만 배포된다 |

### 12. 확인하지 못한 사실

각 항목은 틀렸을 때 어떻게 드러나는지와 그때 할 일을 같이 적는다.

| # | 가정 | 틀리면 보이는 것 | 그때 할 일 |
| --- | --- | --- | --- |
| U1 | 최신 `agy`가 루트 `plugin.json`을 계속 읽는다(문서에는 있음) | `agy plugin install`이 manifest 없음으로 실패 | `.antigravity-plugin/plugin.json`을 같은 내용으로 추가(버전 표면 5개) |
| U2 | `agy` hook 명령의 cwd가 플러그인 루트다(1.0.7 포함) | `Cannot find module ./scripts/…`가 hook 로그에 남고 캡슐이 없음 → skill fallback 문장 | README의 최소 버전을 올린다 |
| U3 | `PreInvocation`의 `invocationNum`이 사용자 턴마다 0부터다 | 두 번째 프롬프트부터 캡슐이 없음(`verify`의 두 프롬프트 시험) | `sha256(lastUserInput)` 비교로 바꾼다(세션 파일 사용) |
| U4 | `agy`가 hook이 띄운 detached 프로세스를 죽이지 않는다 | 이전이 끝나지 않고 "제거 중" 알림이 반복 | `pota migrate run`을 안내(알림 문구에 추가) |
| U5 | `agy` 설치 위치가 `~/.gemini/config/plugins/pota`이고 재설치가 업데이트다 | `verify`의 `ls`에서 드러남 | 문서만 고친다(경로를 저장하지 않으므로 코드 영향 없음) |
| U6 | Claude에서 `pota@pota`와 `pota@pota-harness`를 같이 설치할 수 있다 | `claude plugin install`이 실패하거나 skill이 중복 | 이미 1.5.0 안내가 먼저 지우게 한다. README에도 같은 순서를 적는다 |
| U7 | Claude가 업데이트 뒤 옛 버전 디렉터리를 얼마나 남기는지 | 세션 중 `Cannot find module` | `recovery.md` 문장대로 재시작 |
| U8 | Codex: `hooks: "./hooks/codex.json"`이 기본 탐색을 대체한다(HEAD 소스) | Codex가 `hooks/hooks.json`을 읽어 `failed to parse plugin hooks config`를 내고 hook이 없음 | Codex용을 `hooks/hooks.json`으로, Claude용을 manifest가 가리키는 다른 파일로 바꾸는 것을 검토(mod `modules`가 기본 경로 밖에서 동작하는지 먼저 확인 필요) |
| U9 | Codex: `.agents/plugins/marketplace.json`의 `{"source":"url","url":"./"}`가 루트 플러그인으로 풀린다 | CI `host-validate`의 `codex plugin add` 실패 | `"source": "./"` 문자열 형태로 바꾼다 |
| U10 | Codex: `codex plugin add`가 설치된 버전에 있고 인증 없이 돈다 | CI job 실패 | README는 이미 TUI `/plugins`를 같이 안내한다. CI는 marketplace 추가까지만 본다 |
| U11 | Codex: hook 환경에 `PLUGIN_ROOT`가 들어온다 | `node "/scripts/pota-state.mjs"` 실패가 hook 오류로 보임 | `${CLAUDE_PLUGIN_ROOT}`(호환 변수)로 바꾼다 |
| U12 | Codex: 내용 해시 신뢰가 배포된 버전에도 들어 있다 | 업데이트 뒤 재승인 요구가 없음(문제 아님) | 안내 문구만 완화 |
| U13 | Codex: 이름이 같은 `pota@pota`와 `pota@pota-harness`의 공존 동작 | 첫 세션의 중복 hook·skill | 이전 처리가 `config.toml`에서 옛 구획을 지운다. 재시작 안내 |
| U14 | Codex가 업데이트 때 옛 cache 디렉터리를 지운다 | 세션 중 `Cannot find module` | `recovery.md` 문장대로 재시작 |
| U15 | Antigravity에서 사용자에게만 보이는 메시지를 내는 방법(`userMessage`·`ephemeralMessage`의 표시 방식) | 알림이 모델 컨텍스트로만 감 | 지금 설계가 이미 주입 문장에 넣는다 |
| U16 | `npm deprecate` 뒤에도 1.4.0 runner의 `npm view`·`npm install`이 그대로 동작한다 | 자동 업그레이드가 `failed` 알림 | deprecate를 게시 순서의 마지막에 두었다. 문제가 보이면 deprecate를 푼다(`npm deprecate … ""`) |
| U17 | CI에서 `claude plugin validate .`가 인증 없이 돈다(로컬에서는 임시 `CLAUDE_CONFIG_DIR`로 다른 명령이 동작) | `host-validate` 실패 | 필수 검사가 아니므로 병합은 막히지 않는다. 단계에서 뺀다 |

### 13. 검토 반영 (설계 수정, 2026-11-23)

`design-review`(model `opus`, 보고된 ID `claude-opus-5-5`, effort `high`)의 결과다. blocker는 없었고 major 5건과 minor를 아래처럼 반영한다. 이 절이 위 §1~12와 다르면 이 절이 우선한다.

- **R1 호스트 단위 제거(§6.1 대체)**: 이전은 지금 호스트의 것만 지운다. runner는 `--host <claude|codex|antigravity>`를 받고, 그 호스트의 phase 대상만 제거한다(Claude: `claude` phase와 등록 해제, Codex: `codex` phase와 `codex-config`, Antigravity: `antigravity` phase). 다른 호스트의 기존 설치본과 `core` runtime은 그대로 두어 플러그인을 아직 설치하지 않은 호스트가 계속 동작하게 한다(S1). `core` runtime, 보존된 runtime, `update/`, manifest는 manifest의 `hosts`에 있는 모든 호스트의 phase 대상이 없어졌을 때(이번 실행 뒤 기준)만 지운다. manifest는 고치지 않는다: 이미 지운 대상은 다음 실행에서 `missing`으로 판정된다. `pota migrate run`은 `--host <h>`가 필수이고 `--all`은 모든 호스트를 차례로 처리한다. 호스트 토큰이 `unknown`이면 아무것도 지우지 않는다.
- **R2 등록 해제가 파일 제거의 전제**: 호스트 등록 해제(Claude `claude plugin uninstall`·`marketplace remove`, Codex `config.toml` 구획 제거)가 성공했거나 등록이 원래 없을 때만 그 호스트 phase의 파일을 지운다. 실패하면 그 phase·`core`·manifest를 남기고 `blocked: host-unregister-failed`와 수동 명령을 보고한다. "CLI가 실패해도 파일 제거는 계속" 규칙은 없앤다.
- **R3 `codex-config`는 digest로 막지 않는다**: 소유 증명은 정확한 구획 이름과 `[marketplaces.pota]`의 source가 `<POTA_HOME>/install/codex`인 것으로 한다. 임시 파일은 원본의 권한을 복사하고, 알 수 없으면 `0o600`으로 만든다. 환경 변수 `CODEX_CONFIG_PATH`도 경로 계산에 포함한다.
- **R4 모든 검사는 lock 안에서**: lock을 잡은 뒤 manifest를 다시 읽고 전체 검사를 한다. 트리는 rename한 사본의 digest를 다시 계산해 `installedDigest`와 같을 때만 지우고, 다르면 원래 이름으로 되돌린 뒤 `modified`로 기록한다. rename 접미사는 manifest의 `transactionId`가 UUID v4 정규식을 통과할 때만 쓰고, 아니면 `blocked: manifest-invalid`다. 보존된 runtime도 digest를 검사한다.
- **R5 검증과 fixture의 격리**: 이전 처리를 실행하는 모든 테스트와 `verify`의 실제 설치 검증은 `HOME`, `USERPROFILE`, `POTA_HOME`, `CLAUDE_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_CONFIG_PATH`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`을 모두 임시 경로로 지정하고 comment-checker 내려받기를 끈다. 이전 모듈은 기존 설치 프로그램과 같은 방식으로 `POTA_CLAUDE_CLI`와 Claude 홈 환경 변수 대응(`scripts/pota-lifecycle-claude.mjs`의 규칙)을 따른다. `test/fixtures/legacy-lifecycle-1.4.0.json`은 이 격리 환경에서 가짜 `claude` CLI로 1.4.0 설치 프로그램을 실행해 만든다. 이 컴퓨터의 실제 설치본은 `release` task에서만 건드린다.
- **R6 1.5.0 안내의 Claude 줄**: 명령을 `&&`로 잇지 않고 세 줄로 따로 적는다. 첫 줄은 `claude plugin uninstall pota@pota --scope user`다. `claimPluginNotice`는 읽고 쓰는 방식이 아니라 배타적 생성(`wx`) 또는 rename으로 한 세션만 가져가게 한다.
- **R7 알림과 보고서**: `report.json`은 지우지 않고 남기며(`pota doctor`가 요약), 알림을 보여 줬는지는 별도 파일로 기록한다. `blocked` 알림은 7일에 한 번, "제거 중" 알림은 runner를 띄운 세션 한 번이다. lock을 잡지 못해 끝난 실행은 `deferred` 보고서를 남기고 알림을 반복하지 않는다. `state.json`의 실행 조건 키에는 manifest 지문과 함께 호스트와 경로 환경 변수의 지문을 넣어, 한 호스트의 `blocked`가 다른 호스트의 실행을 막지 않게 한다.
- **R8 그 밖의 수정**: detached `spawn`에 `windowsHide: true`. 빈 디렉터리 정리 목록에 `install/codex/.agents/plugins`, `install/codex/.agents`, `install/codex/plugins`를 추가한다. 사용자에게 보이는 안내의 `pota doctor`는 `node "<pluginRoot>/scripts/pota.mjs" doctor` 형태로 적는다(2.0.0에는 `bin`이 없다). skill 문장의 "`scripts/` 위의 디렉터리"는 구분자에 의존하지 않게 "the parent of the `scripts` directory in the session-start `Pota CLI:` line"으로 쓴다(바이트 예산 9000 이하를 다시 확인한다). ko 알림 문구도 240자 이하로 테스트에 고정한다.
- **R9 task 분할 수정(§10)**: T1 `legacy-migration`이 import할 수 있는 기존 모듈은 `scripts/pota-paths.mjs`, `scripts/pota-safe-fs.mjs`의 지금 있는 export, `scripts/pota-lifecycle-lock.mjs`뿐이다(`pota-update-state.mjs`를 import하지 않는다). T1·T2·`notice-1x`는 병렬로 돌리되 각자 자기 테스트 파일만 실행하고, 전체 `npm run check`는 main 세션이 셋이 끝난 뒤 한 번 돌린다. T3 `runtime-cutover`의 테스트에 "Antigravity SessionStart가 이전 알림을 내는 경로"를 추가하고, 그 테스트 파일 `test/antigravity-hooks.test.mjs`의 해당 부분 수정을 T3의 writeScope에 넣는다(T2가 끝난 뒤이므로 겹치지 않는다).
- **남은 미확인**: Codex 실제 실행, `pota@pota`와 `pota@pota-harness`의 공존(U6), `agy` 세션 안의 hook cwd와 matcher, Windows 동작. `verify`와 `release`에서 확인하거나 미확인으로 보고한다.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Requested model: main 세션(`claude-fable-5-2`)
- Effective model: `claude-fable-5-2`
- Requested reasoning effort: `high`
- Effective reasoning effort: inherited: main 세션
- Contract: 조사 범위는 (a) 세 호스트의 플러그인 계약: manifest 형식, 플러그인 루트를 가리키는 변수, 지원하는 hook 이벤트, skill·command·agent·workflow·mod를 담는 방식, 저장소 URL 또는 marketplace 설치, 설치 시 코드 실행 여부, 업데이트 방식. (b) 현재 설치 구조: lifecycle이 호스트별로 만드는 파일, runtime locator를 읽는 곳, 자동 업그레이드, 관련 테스트와 문서. toolcheck를 실행한다. Heavy 기준을 다시 확인하고, 이 파일을 구현 가능한 수준으로 갱신한다.
- Required evidence records: `planArtifact`, `triageDecision`

### Task 1: Heavy design

- Task ID: `heavy-design`
- Initial status: `pending`
- Kind: `design`, Route: `heavy`
- Requested model: `fable`
- Effective model: `fable (claude-fable-5-2)`
- Requested reasoning effort: `high`
- Effective reasoning effort: `high`
- Contract: read-only 설계. 결과를 이 파일의 `## Heavy Design`에 합친다. 정할 것:
  1. 저장소 루트의 호스트별 manifest와 디렉터리 배치(Claude `.claude-plugin/{plugin,marketplace}.json`, Codex `.codex-plugin/plugin.json`과 `.agents/plugins/marketplace.json`, Antigravity `.antigravity-plugin/plugin.json`과 루트 `hooks.json`), 한 저장소에서 세 호스트가 서로의 파일을 잘못 읽지 않게 하는 방법.
  2. runtime 결정: 각 호스트가 설치한 자리를 그대로 쓰고 그 절대 경로를 어디에도 저장하지 않는다(사용자 확인: "claude code에서 runtime 위치가 공식에서 제안하는 위치여야 나중에 업데이트할 때 문제가 없지 않아?"). hook은 호스트 변수 또는 상대 경로로, skill·command·agent 본문은 호스트가 치환하는 값이나 SessionStart hook이 알려 주는 CLI prefix로 CLI를 찾는다. Bash 도구 환경에 플러그인 루트 변수가 없다는 점과 버전마다 경로가 바뀐다는 점을 다룬다.
  3. hook 배선: 호스트별 이벤트 대응(Antigravity의 PreInvocation·입출력 형식 어댑터), Claude mod(`modules`)를 루트 플러그인에 담는 방법.
  4. Claude command·agent, Antigravity workflow를 플러그인 구성요소로 옮기는 방법과 `{{POTA_RUNTIME_LOCATOR_JSON}}` 제거.
  5. 없앨 코드와 남길 코드: lifecycle·자동 업그레이드·`pota-update-state`, `pota doctor`의 새 역할, `pota-comment-checker`의 lock·경로 의존, `bin`과 npm 패키지의 처리.
  6. 이전(migration): 플러그인 첫 SessionStart에서 기존 npm 설치본을 제거하는 절차(소유 확인, 수정된 파일 처리, lock, 실패 시 동작, 지우지 않는 것), 그리고 기존 사용자를 옮기는 마지막 npm 버전의 형태(기존 자동 업그레이드 runner가 호출하는 진입점과 성공 판정을 고려).
  7. Codex hook 신뢰를 사용자가 직접 승인해야 하는 점의 안내 방식.
  8. 버전 표면과 릴리스 절차의 변화, CI에서 할 설치 검증.
  9. 테스트 계획: 지울 테스트, 고칠 테스트, 새 테스트, 호스트별 실제 설치 검증(Claude와 `agy`는 이 컴퓨터에서, Codex는 문서 기준과 CI).
  10. 구현 task 분할: task마다 `dependsOn`, 서로 겹치지 않는 `writeScope`, 검증 명령 두 개.
- Files: 수정 없음(read-only).
- Depends on: `triage-plan`
- Required evidence records: `designRecord`

### Task 2: 설계 검토

- Task ID: `design-review`
- Initial status: `pending`
- Route: `heavy`
- Requested model: `opus`, Requested reasoning effort: `high`
- Contract: `## Heavy Design`을 조사 기록과 코드에 대조해 read-only로 검토한다. 호스트 계약과 어긋나는 점, 이전 처리의 데이터 손실 위험, 빠진 표면을 찾는다. 지적은 구현 전에 계획에 반영한다.
- Depends on: `heavy-design`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`

### Task 3~8: 구현 (Heavy Design §10과 §13 R9)

| Task ID | 내용 | Depends on | model / effort |
| --- | --- | --- | --- |
| `legacy-migration` | §6.1과 §13 R1~R5·R7·R8의 이전 모듈, `pota doctor` | `design-review` | `opus` / `high` |
| `antigravity-adapter` | §3.3 어댑터 | `design-review` | `opus` / `high` |
| `notice-1x` | §6.2와 §13 R6, 별도 worktree의 `release/1.x`용 1.5.0 | `design-review` | `opus` / `high` |
| `runtime-cutover` | §5, §2.1의 1~3번, 감지 배선 | `legacy-migration`, `antigravity-adapter` | `opus` / `high` |
| `layout-cutover` | §1, §2.2, §3.1~3.2, §4, §8의 CI | `runtime-cutover` | `opus` / `high` |
| `docs` | README 8개, `docs/memory`, `MEMORY.md` | `layout-cutover` | `opus` / `high` |

writeScope와 검증 명령 두 개는 §10의 T1~T6에 있다. 모든 구현 task의 Required evidence는 `moduleAcceptance`(§10의 검증 1)와 `surfaceIntegration`(§10의 검증 2, 단 T1·T2·`notice-1x`는 §13 R9에 따라 main 세션이 돌리는 전체 check)이다.

### Task 9: 검증과 최종 검토

- Task ID: `verify`
- Initial status: `pending`
- Route: `heavy`
- Requested model: `opus`, Requested reasoning effort: `xhigh`
- Contract: `npm run check`, 호스트별 실제 설치 검증, `docs/memory` 갱신, 최종 검토.
- Depends on: `docs`, `notice-1x`
- Module acceptance verification: `npm run check`
- Surface integration verification: 임시 홈에서 Claude 플러그인 설치와 `agy plugin validate`

### Task 10: 릴리스

- Task ID: `release`
- Initial status: `pending`
- Route: `heavy`
- Requested model: main 세션, Requested reasoning effort: `high`
- Contract: (1) 2.0.0 기능 브랜치를 `dev`에 PR로 병합, `dev`를 `main`에 PR로 병합(CI 통과, head SHA 고정). (2) 1.4.0 기준의 별도 브랜치에서 안내 문구만 바꾼 1.5.0을 만들어 exact tarball을 한 번 pack하고 `npm publish --dry-run` 뒤 사용자가 자기 터미널에서 게시한다. (3) 게시 확인 뒤 `npm deprecate`도 사용자가 실행한다. (4) 이 컴퓨터의 기존 설치본을 플러그인 설치로 교체하고 동작을 확인한다. 1.5.0 브랜치를 어디에 병합할지는 `heavy-design`이 정한다.
- Depends on: `verify`
- Dry-run or check command: `npm publish --dry-run`


## Evidence

- (triage 뒤 기록)

## Status

- [ ] Planned
- [ ] Dry-run or check passed, or not applicable was recorded
- [ ] Implemented
- [ ] Module acceptance passed
- [ ] Surface integration passed
- [ ] Reviewed
- [ ] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
