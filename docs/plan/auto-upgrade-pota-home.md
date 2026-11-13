# Plan: 자동 업그레이드와 `~/.pota` 설치 루트

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-12 작성)
- Finalized: decision-complete for implementation after planned triage. 단, Pre-implementation decisions는 `heavy-design`이 확정한 뒤 구현을 시작한다.
- Codex UI synchronization: `update_plan`은 Claude 데스크탑 task list(`mcp__ccd_turn__update_plan`)로 동기화했다. `create_goal`은 이 호스트에 없어 unavailable.

## Goal

npm으로 한 번 설치하면 이후 Claude Code·Codex 세션에서 Pota이 스스로 최신 버전으로 올라가고, `pota upgrade`가 호스트 캐시까지 빠짐없이 갱신하며, 최초 `pota install`에서 설치할 호스트를 고를 수 있다.

- Goal ID: `goal-08e920e6-a4e2-42f4-8668-718751c2081f`
- Plan ID: `docs/plan/auto-upgrade-pota-home.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria (advisory): 격리 HOME에서 install(호스트 선택) → 구버전에서 자동 업그레이드 → 다음 세션 캡슐의 업데이트 알림을 확인하고 `npm run check`가 통과한다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome (사용자 결정, 2026-11-12):
  1. 설치 루트를 `~/.pota`으로 옮긴다. 기존 `$CODEX_HOME/plugins/cache/pota` 설치는 upgrade가 이전한다.
  2. `pota upgrade`가 Claude Code 플러그인 캐시까지 갱신한다.
  3. 자동 업그레이드는 기본 켜짐이고 major·minor 구분 없이 자동 적용한다. 끄는 설정을 둔다.
  4. 열린 세션의 hook이 깨지지 않도록 이전 versioned runtime을 유예한다.
  5. 최초 `pota install`에서 호스트 선택 CLI prompt(전체 / Claude만 / Codex만 등)를 보여 주고, 선택을 기록해 upgrade와 자동 업그레이드가 따른다.
- Affected surfaces: `scripts/pota-lifecycle*.mjs`(10개), `scripts/pota-paths.mjs`, `scripts/pota-state.mjs`·`pota-state-context.mjs`, `scripts/pota.mjs`, `hooks/hooks.json`, `package.json`(`check`의 `node --check` 목록, `files`), `test/lifecycle*.test.mjs`·`installed-plugin`·`packed-install`·`cli-contract-hardening`, README 8개 언어, `docs/memory/lifecycle-install.md`·`hook-context.md`.
- Task classification: Heavy Path.
- 범위 밖: 버전 올림, 커밋·푸시, npm publish(릴리스는 별도 계획). GitHub 마켓플레이스 배포.

## Triage Findings

조사한 현재 동작(2026-11-12, `dev` e20c0b9):

- 설치 루트는 `marketplaceRoot = $CODEX_HOME/plugins/cache/pota` 한 상수에서 파생된다. manifest·journal·lock, Codex source(`plugins/pota`), versioned runtime(`pota/<version>`), Claude 마켓플레이스(`claude/`)가 모두 그 아래다. `scripts/pota-lifecycle.mjs:39-56`.
- 심볼릭 링크 조상 검사(`assertLifecycleMutationPaths`)가 `codexHome`을 기준 루트로 쓴다. `scripts/pota-lifecycle.mjs:109-121`.
- upgrade는 manifest 버전이 다르면 `previous-codex-runtime`을 cleanup 단계에서 제거한다. 이전 runtime이 즉시 사라진다. `scripts/pota-lifecycle-commands.mjs:44-53`.
- Claude 등록 `register()`는 이미 설치된 경우 아무것도 하지 않는다. Claude는 `~/.claude/plugins/cache/pota/pota/<version>/` 사본을 로드하므로 upgrade 뒤에도 이전 hook 경로를 쓴다. `ownsMarketplace`는 등록된 디렉터리 경로가 `marketplaceRoot`와 같을 때만 소유로 본다. 루트를 옮기면 기존 등록은 "foreign"으로 판정된다. `scripts/pota-lifecycle-claude.mjs:101-128`.
- `claude plugin update <plugin>`이 CLI에 있다(`restart required to apply`).
- Codex `config.toml`의 `[marketplaces.pota]`은 `source_type = "local"`, `source = <marketplaceRoot>`다. 루트를 옮기면 projection 경로가 바뀐다. `scripts/pota-lifecycle-config.mjs`, `updateConfig`의 `marketplacePath`.
- 필수 소유 대상은 호스트 구분 없이 고정 목록이다(`requiredOwnershipTargets`). 호스트를 빼려면 목록이 선택에 따라 달라져야 한다. `scripts/pota-lifecycle-integrity.mjs:115-124`.
- lifecycle 명령은 인자를 받지 않는다(`install --help`도 exit 1). 호스트 선택 옵션은 이 규약을 바꾼다. `scripts/pota-lifecycle.mjs:91-96`.
- 설치 cache의 CLI로는 install·upgrade를 거부한다. 자동 업그레이드는 패키지 소스에서 실행해야 한다. `scripts/pota-lifecycle-commands.mjs:31-34`.
- hook 이벤트는 `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `SubagentStop`이고 timeout은 10초다. SessionStart 캡슐에는 문자 예산 테스트가 있다(`hook-context.md`). `hooks/hooks.json`, `scripts/pota-state.mjs:50-67`.
- npm 레지스트리를 조회하거나 새 버전을 알리는 코드는 없다.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/lifecycle-install.md`, `docs/memory/hook-context.md`, `docs/memory/release-process.md`(버전 표면 확인용)
- Related completed plans: `docs/plan/upgrade-shared-config-ownership.md`, `docs/plan/clean-uninstall-prompt-cache-resilience.md`

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`.
- User-visible response and artifact locale: 한국어.

## Reasoning Effort Profile

- Heavy Path: planning/review=`high`, implementation=`high`, final verification/review=`xhigh`.
- 모델: 설계 `fable`, 구현·리뷰 `opus`. 모든 dispatch는 Agent `model`/`effort` host option으로 전달한다.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: 설치 루트 이전은 소유권 manifest·트랜잭션·lock 위치를 함께 옮기는 migration이고, 자동 업그레이드는 외부 레지스트리 호출과 세션 간 동시성을 새로 만든다.
- Checkpoint ledger:
  - Request checkpoint: Heavy 잠정. 근거: 설치 루트 이전, 트랜잭션 변경, 외부 npm 호출, 백그라운드 프로세스.
  - Planning checkpoint: Heavy 확정. 근거: 위 Triage Findings.
  - Code checkpoint: Heavy 유지(2026-11-12). 설계 task가 대상 파일·호출부·테스트를 줄 번호까지 확인했고(`## Heavy Design` 1·3절) 새 Heavy 신호나 경로 변경 사유는 없다.
- Heavy Path signals checked:
  - New directory/module/layer: 있음(자동 업그레이드 모듈, 호스트 선택 모듈).
  - New domain model/service/abstraction: 있음(호스트 선택 기록, 업데이트 확인 상태).
  - Security/auth/session: 있음(레지스트리에서 받은 코드를 자동 실행).
  - External API/message queue/payment: 있음(npm registry).
  - DB schema/migration: 있음(manifest schema, 설치 루트 migration).
  - Concurrency/transaction/cache invalidation: 있음(여러 세션의 동시 확인·설치, 이전 runtime 유예, Claude 캐시 갱신).
  - Cross-domain refactor: 있음(lifecycle, hook, CLI, 문서).
  - Explicit extra-care signal: 없음.
- Pre-implementation decisions (`heavy-design`이 확정):
  1. `~/.pota` 레이아웃과 override env 이름. `CODEX_HOME`과의 관계, 심볼릭 링크 검사 기준 루트.
  2. 기존 루트에서의 이전 절차: 어느 lock을 잡는지, 옛 manifest를 어떻게 인수하고 옛 트리를 언제 지우는지, 중단 시 복구, 수정된 관리 파일이 있을 때의 거부.
  3. 루트 이전에 따른 호스트 재등록: Claude 디렉터리 마켓플레이스 경로 교체(remove → add), Codex `config.toml`의 `source` 갱신과 hook trust hash 영향.
  4. Claude 캐시 갱신: `claude plugin update`만으로 충분한지, `marketplace update`가 먼저 필요한지, 실패 시 exit code와 안내.
  5. 이전 runtime 유예: 남길 세대 수, manifest 기록 방식과 integrity 검사, 제거 시점, uninstall 처리.
  6. 호스트 선택: prompt 문구와 선택지(Antigravity 포함 조합), 비대화형(TTY 아님)·CI 기본값, `--hosts` 옵션, manifest 필드, 나중에 선택을 바꾸는 방법과 빠진 호스트 산출물 제거, doctor·uninstall의 호스트별 검사, 기존 설치의 기본 선택.
  7. 자동 업그레이드: 확인 주기와 상태 파일 위치, hook에서 분리된 프로세스를 띄우는 방식, 실행 명령(`npx -y @comento/pota-harness@latest upgrade` 대 전역 npm 갱신), lifecycle lock과의 관계, 실패 backoff, 끄는 설정, 소스 체크아웃·로컬 tarball 설치에서의 동작, 설치 버전이 latest보다 높을 때, 오프라인, Windows.
  8. 알림: SessionStart 캡슐에 넣는 문구(성공·실패·수동 조치 필요), 문자 예산 변경, 한 번만 보여 주는 규칙.
  9. 무결성: 자동 실행 전 확인할 것(패키지 이름·버전 형식, registry 응답 검증).

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | heavy | main | high |
| `heavy-design` | Plan(읽기 전용) | heavy | fable | high |
| `claude-cache-refresh` | worker | heavy | opus | high |
| `pota-home-layout` | worker | heavy | opus | high |
| `pota-home-migration` | worker | heavy | opus | high |
| `runtime-retention` | worker | heavy | opus | high |
| `host-selection` | worker | heavy | opus | high |
| `auto-upgrade` | worker | heavy | opus | high |
| `docs-memory` | worker | heavy | opus | high |
| `verify` | main + 읽기 전용 reviewer | heavy | opus | xhigh |

## Tool Readiness

- Detected stack: javascript(Node ESM, 의존성 없음). toolcheck가 python도 감지하지만 추적되지 않는 `.omo/` 때문이며 범위 밖이다.
- Toolcheck command: `pota toolcheck --root .` → node OK, npm OK, basedpyright/ruff MISSING(범위 밖, 설치 요청 안 함).
- Required verification tools: `node --test`, `npm run check`, `npm pack --dry-run`.
- Install approval: not needed.

## Execution Guardrails

- Test contract first: 각 구현 task는 실패하는 테스트를 먼저 쓰고 실패를 확인한 뒤 최소 구현한다.
- 격리: 모든 lifecycle 테스트는 임시 HOME과 env override로 격리한다. 실제 `~/.pota`, `~/.codex`, `~/.claude`에 쓰지 않는다. 자동 업그레이드 테스트는 실제 npm registry를 호출하지 않고 대역(stand-in)을 쓴다. Claude CLI는 기존 `POTA_CLAUDE_CLI` 대역을 쓴다.
- 기존 테스트를 약화·삭제하지 않는다. 경로 상수나 인자 규약처럼 계약이 바뀌는 경우는 `## Heavy Design`에 사유를 기록한 뒤 바꾼다.
- 새 스크립트는 진입점에서 정적 import로 연결한다(runtime closure 규칙).
- Verification ladder: task별 focused test → 마지막에 `npm run check` 1회 → `npm pack --dry-run`(prepack이 check를 실행하므로 `--ignore-scripts` 금지).
- External-state mutation: 없음. 커밋·푸시·릴리스·npm publish, 실제 설치본 upgrade는 이번 goal 범위가 아니다.
- Verification loop budget: task당 2회.

## Module Tasks

구현 task는 lifecycle 파일을 공유하므로 병렬로 돌리지 않고 순서대로 진행한다.

### Task 0: `triage-plan`

- 조사와 계획 확정. Required evidence: `planArtifact`, `triageDecision`.

### Task 1: `heavy-design`

- Kind: design, route heavy. Depends on: `triage-plan`. Write scope: 없음(결과는 main이 이 파일 `## Heavy Design`에 병합).
- Contract: Pre-implementation decisions 1~9를 확정하고, 각 구현 task의 파일 범위·테스트 계약·수용 기준을 구체화한다.
- Required evidence: `designRecord`.

### Task 2: `claude-cache-refresh`

- Contract: upgrade가 이미 설치된 Claude 플러그인의 캐시를 새 버전으로 갱신한다. 갱신 실패는 설치를 되돌리지 않고 수동 명령을 안내한다.
- Depends on: `heavy-design`. Write scope: `scripts/pota-lifecycle-claude.mjs`, `scripts/pota-lifecycle-commands.mjs`, `test/lifecycle.test.mjs`(Claude 대역 CLI 케이스).
- Module acceptance: `node --test test/lifecycle.test.mjs`
- Surface integration: `node --test test/installed-plugin.test.mjs test/packed-install.test.mjs`

### Task 3a: `pota-home-layout`

- Contract: 신규 설치·같은 레이아웃 upgrade·uninstall·doctor가 `POTA_HOME/install` 레이아웃과 manifest schema 2로 동작한다. Codex 호스트 캐시는 `$CODEX_HOME/plugins/cache/pota/pota/<version>`에 남는다. 상세는 `## Heavy Design` 3절 Task 3a.
- Depends on: `claude-cache-refresh`.
- Module acceptance: `node --test test/lifecycle.test.mjs test/lifecycle-transaction.test.mjs test/lifecycle-hardening.test.mjs`
- Surface integration: `node --test test/installed-plugin.test.mjs test/packed-install.test.mjs`

### Task 3b: `pota-home-migration`

- Contract: 0.6.0 이하 설치(legacy 레이아웃)가 upgrade 한 번으로 이전되고, 중단되면 복구되며, 수정된 관리 파일이 있으면 거부한다. Claude 마켓플레이스가 새 경로로 재등록된다. 상세는 `## Heavy Design` 3절 Task 3b.
- Depends on: `pota-home-layout`.
- Module acceptance: `node --test test/lifecycle-transaction.test.mjs test/lifecycle.test.mjs`
- Surface integration: `node --test test/lifecycle-hardening.test.mjs test/installed-plugin.test.mjs test/packed-install.test.mjs`

### Task 4: `runtime-retention`

- Contract: upgrade 뒤에도 직전 runtime이 남아 열린 세션의 hook이 계속 동작한다. 유예가 끝난 runtime은 이후 upgrade가 제거하고, uninstall은 모두 제거한다.
- Depends on: `pota-home-migration`. Write scope: `scripts/pota-lifecycle-commands.mjs`, `scripts/pota-lifecycle-integrity.mjs`, `scripts/pota-lifecycle-transaction*.mjs`, `test/lifecycle-transaction.test.mjs`.
- Module acceptance: `node --test test/lifecycle-transaction.test.mjs`
- Surface integration: `node --test test/lifecycle.test.mjs test/installed-plugin.test.mjs`

### Task 5: `host-selection`

- Contract: 대화형 install은 호스트 선택 prompt를 보여 주고, 비대화형은 옵션이나 기본값을 따른다. 선택은 manifest에 기록되고 upgrade·doctor·uninstall이 선택된 호스트만 다룬다.
- Depends on: `runtime-retention`. Write scope: `scripts/pota-lifecycle.mjs`, `scripts/pota-lifecycle-commands.mjs`, `scripts/pota-lifecycle-integrity.mjs`, `scripts/pota-lifecycle-staging.mjs`, `scripts/pota.mjs`, 새 prompt 모듈, `package.json`, 관련 테스트.
- Module acceptance: `node --test test/lifecycle.test.mjs test/lifecycle-hardening.test.mjs`
- Surface integration: `node --test test/cli-contract-hardening.test.mjs test/packed-install.test.mjs`

### Task 6: `auto-upgrade`

- Contract: SessionStart가 주기적으로 새 버전을 확인하고, 있으면 hook을 막지 않는 분리 프로세스로 upgrade를 실행한다. 다음 세션 캡슐에 결과를 한 번 알린다. 설정으로 끌 수 있다.
- Depends on: `host-selection`. Write scope: 새 자동 업그레이드 모듈, `scripts/pota-state.mjs`, `scripts/pota-state-context.mjs`, `scripts/pota.mjs`, `package.json`, 새 테스트 파일, hook 예산 테스트.
- Module acceptance: 새 테스트 파일의 `node --test`
- Surface integration: `node --test test/installed-plugin.test.mjs`와 hook 캡슐 테스트

### Task 7: `docs-memory`

- Contract: README 8개 언어의 설치·업그레이드 안내와 `docs/memory/lifecycle-install.md`·`hook-context.md`가 새 동작과 일치한다.
- Depends on: `auto-upgrade`. Write scope: `README*.md`, `docs/memory/*.md`, `MEMORY.md`.
- Module acceptance: `node scripts/pota.mjs memory check --root .`
- Surface integration: `node --test test/contract-parity.test.mjs`

### Task 8: `verify`

- Contract: 독립 리뷰와 최종 검증. `npm run check`, `npm pack --dry-run`, 격리 HOME에서의 install → upgrade → 자동 업그레이드 시나리오.
- Depends on: `docs-memory`. Required goal evidence: `finalReview`.

## Heavy Design

설계 채택 메모(main, 2026-11-12):

- `heavy-design`: Requested/Effective model `fable (claude-fable-5-2)`, effort `high`(host option).
- 4절의 제안을 채택한다: `pota-home-root`를 `pota-home-layout`과 `pota-home-migration`으로 나누고, write scope 보정(Task 2 `test/fixtures/fake-claude.mjs`, Task 4 `scripts/pota-state.mjs`, Task 7 `commands/`·`.agents/workflows/`의 lifecycle 문서)을 반영한다. 각 구현 task의 파일 범위와 테스트 계약은 아래 3절이 기준이다.
- 6절 질문은 설계 기본값으로 진행하고 사용자에게 보고한다: (1) 게시 즉시 자동 적용(대기 시간 없음), (2) 수동 다운그레이드는 지금 동작 유지, (3) lifecycle 관리 파일은 `~/.pota/install/` 아래에 둔다. 사용자가 다르게 정하면 해당 task에서 바꾼다.
- 전제 변경: Codex versioned runtime은 Codex 자신의 플러그인 캐시 경로라 `$CODEX_HOME`에 남는다(0절 1항).

- 설계 모델 ID: `claude-fable-5-2` (system prompt 표기 그대로). effort: high.
- 읽기 전용으로 수행했다. 실행한 명령은 `git log/rev-parse`, 파일 읽기, `claude plugin … --help`, `codex plugin … --help`, `codex --version`, `~/.claude/plugins/{installed_plugins,known_marketplaces}.json`의 pota 항목 읽기뿐이다. 테스트와 호스트 CLI의 상태 변경 명령은 실행하지 않았다.

### 0. 계획 전제에서 달라지는 점 (먼저 읽을 것)

1. **Codex versioned runtime은 `~/.pota`으로 옮길 수 없다.** `$CODEX_HOME/plugins/cache/pota/pota/<version>`은 Pota의 임의 경로가 아니라 Codex 자신의 플러그인 캐시 경로다. 이 디렉터리가 없으면 Codex가 `pota@pota`을 설치된 것으로 보지 않는다. 근거: `docs/plan/harness-reliability-remediation.md:59`(A/B smoke 결정), `test/lifecycle-transaction.test.mjs:689-704` "Codex A/B gate proves the versioned custom cache is required". 따라서 "설치 루트 이전"은 **Pota 소유 상태(manifest·journal·lock), canonical runtime, Codex marketplace source, Claude marketplace**를 옮기는 것이고, Codex 캐시는 Claude 캐시(`~/.claude/plugins/cache/pota/pota/<version>`)와 같은 "호스트 캐시"로 `CODEX_HOME`에 남는다.
2. **`~/.pota`은 이미 쓰이고 있다.** `potaHome()`이 `POTA_HOME ?? ~/.pota`을 돌려주고 goal 상태가 `projects/` 아래에 있다(`scripts/pota-paths.mjs:9-24`). 실제 머신의 `~/.pota`에도 `projects`만 있다. 새 env를 만들지 않고 `POTA_HOME`을 재사용한다.
3. **manifest schema는 한 번만 올린다(1 → 2).** `hosts`, `origin`, `retained` 필드를 `pota-home-root`에서 한꺼번에 정의하고, 뒤 task가 동작을 채운다.
4. **task 경계 제안**: `pota-home-root`를 `pota-home-layout`(새 레이아웃·schema 2·신규 설치)과 `pota-home-migration`(legacy 이전·재등록)으로 나눈다. 이유와 대안은 4절.

가정 표기: 저장소 증거로 확정할 수 없는 호스트 동작은 **가정 A1~A7**로 표시하고, 실제 CLI로 확인하는 gate(G1, G2)를 task에 넣었다.

---

### 1. 결정 1~9

#### 결정 1 — `~/.pota` 레이아웃, override env, 심볼릭 링크 기준

확정안:

```
<potaHome> = POTA_HOME ?? ~/.pota            (기존 potaHome() 재사용)
  projects/…                    goal 상태 (변경 없음)
  config.json                   사용자 설정 { schemaVersion: 1, autoUpgrade: bool }
  update/                       자동 업그레이드 상태 (digest 관리 대상 아님)
    state.json  notice.json  update.lock  last-run.log  stage/
  install/                      ← installRoot. lifecycle 관리 대상 전부
    lifecycle.json              소유권 manifest (schema 2)
    lifecycle.lock  transaction.json  transactions/<id>/{stage,backup}
    runtime/<version>/          canonical runtime (모든 locator·Claude hook·`Pota CLI:` 줄이 가리킴)
    codex/                      Codex local marketplace source
      .agents/plugins/marketplace.json
      plugins/pota/
    claude/                     Claude directory marketplace (.claude-plugin/marketplace.json, pota/…)

$CODEX_HOME/plugins/cache/pota/pota/<version>/   Codex 호스트 캐시 (codex 선택 시에만, 관리 대상 id `codex-runtime`)
```

- override: `POTA_HOME` 하나. `CODEX_HOME`·`CLAUDE_HOME`·`ANTIGRAVITY_HOME`·`ANTIGRAVITY_CLI_HOME`·`CODEX_CONFIG_PATH`는 그대로이고 `POTA_HOME`과 독립이다.
- 심볼릭 링크 검사: `assertLifecycleMutationPaths`의 기준 루트를 `[potaHomeRoot, <install 하위 경로>]`로 바꾸고, Codex 캐시는 `[codexHome, codexCacheRoot]`로 유지한다. `doctor`의 lock 경로 검사(`scripts/pota-lifecycle.mjs:79`)도 `potaHomeRoot` 기준으로 바꾼다. goal 상태가 이미 symlink된 `~/.pota`을 거부하므로(`scripts/pota-goal-state.mjs:120-137`, `scripts/pota-safe-fs.mjs:26-45`) 정책이 일치한다.
- "설치 cache에서 실행 거부"(`scripts/pota-lifecycle-commands.mjs:32-34`)는 "`pluginRoot`가 `installRoot` 안이거나 `$CODEX_HOME/plugins/cache/pota` 안"으로 일반화한다. `update/stage/`는 `install/` 밖이라 자동 업그레이드의 패키지 소스로 쓸 수 있다.
- 경로 상수는 새 모듈 `scripts/pota-lifecycle-layout.mjs`의 `createLayout({ env, releaseVersion })`가 `current`와 `legacy`(0.6.0 상수 그대로) 두 벌을 돌려준다. 지금은 `scripts/pota-lifecycle.mjs:30-56`에 한 벌만 있다.

근거: `scripts/pota-lifecycle.mjs:39-56,108-138`, `docs/plan/clean-uninstall-prompt-cache-resilience.md:77`(빈 managed root만 제거, unmanaged 보존 — `install/`을 goal 상태·설정과 분리해야 이 규칙이 그대로 선다).

거부한 대안:
- `~/.pota` 바로 아래에 기존 구조를 그대로 두기(`~/.pota/.pota/lifecycle.json`): 상수 한 줄만 바꾸면 되지만 goal 상태·설정과 digest 관리 대상이 섞여 "빈 root 제거"와 "설치 cache 실행 거부" 판정이 흐려진다.
- 새 env `POTA_INSTALL_ROOT`: 표면만 늘고 테스트 격리는 `POTA_HOME`으로 충분하다.
- canonical runtime을 Codex marketplace source로 겸용(`source.path = ./runtime/<v>`): 사본 하나(약 0.7MB)를 줄이지만 검증된 marketplace 항목 형태(`./plugins/pota`)를 바꾼다.

#### 결정 2 — 기존 루트에서의 이전 트랜잭션

확정안:

- **두 스택**: `createIntegrity`·`createTransactionManager`·`createCommands`는 모두 context 주입형이다(`scripts/pota-lifecycle.mjs:57-70`). `layout.legacy`로 legacy 스택을 하나 더 만든다. legacy 스택은 0.6.0과 동일하게 동작한다.
- **lock**: 새 lock(`install/lifecycle.lock`)을 항상 먼저 잡고, legacy 디렉터리 `$CODEX_HOME/plugins/cache/pota/.pota`이 있으면 legacy lock을 이어서 잡는다(순서 고정: new → legacy). 0.6.0 이하 프로세스는 legacy lock만 잡으므로 동시 실행이 직렬화된다. lock 구현은 경로만 받는다(`scripts/pota-lifecycle-lock.mjs:8`).
- **순서(install/upgrade, 두 lock 안)**:
  1. legacy journal이 있으면 legacy 스택으로 복구 → 새 journal 복구(`recoverInterruptedTransaction`).
  2. manifest 읽기: 새 경로 우선, 없으면 legacy 경로. 둘 다 있으면 `Both legacy and current ownership manifests exist`로 거부.
  3. legacy manifest면 legacy 스택으로 `validateOwnershipShape` + `assertOwnershipDigests`. 수정된 관리 파일이 하나라도 있으면 `Managed artifact was modified: <path>`로 거부하고 아무것도 바꾸지 않는다(`scripts/pota-lifecycle-integrity.mjs:42-49`). manifest가 없고 0.2.2 트리가 있으면 legacy 스택의 `adoptLegacy`에 **legacy 레이아웃 대상 목록**을 넘긴다(지금은 새 staged 대상을 순회하므로 그대로 두면 새 경로에서 아무것도 못 찾는다, `scripts/pota-lifecycle-legacy.mjs:17-48`).
  4. 트랜잭션은 **새 루트**에 만든다(`install/transactions/<id>`). stage 뒤 대상 목록 = 새 대상(replace) + legacy 제거 대상(remove, phase `cleanup`): `legacy-root-codex-source`, `legacy-root-marketplace`, `legacy-root-claude-plugin`, 버전이 다르면 `previous-codex-runtime`. 이 id들은 `ownedBy: <legacy record id>`를 달아 `assertTargetsReplaceable`이 legacy record와 path·type·digest를 대조한다(지금의 `previous-codex-runtime` 특례 `scripts/pota-lifecycle-integrity.mjs:24-28`를 일반화).
  5. phase 순서 `core → codex → claude → antigravity → config → cleanup`. 그다음 새 manifest(`ownership`, schema 2) 쓰기와 legacy manifest 제거(`legacy-ownership`)를 같은 트랜잭션에 넣는다.
  6. commit(`finishTransaction`)이 `transactions/<id>`를 지우는 순간이 옛 트리의 실제 삭제 시점이다(`scripts/pota-lifecycle-transaction-journal.mjs:34-44`). 그 전까지 옛 트리는 backup으로 rename된 상태라 rollback이 되돌린다.
  7. commit 뒤: Claude 재등록(결정 3) → legacy scaffold를 `rmdir`로만 정리(`plugins`, `.agents/plugins`, `.agents`, `.pota/transactions`) → legacy lock 해제 뒤 `.pota`, legacy root(비었을 때만). unmanaged 자식은 보존한다.
- **중단 복구**: journal이 새 루트에 있으므로 새 버전의 다음 lifecycle 실행이 backup에서 legacy 설치 전체를 복원한다. journal allowlist(`validateTransactionJournal`, `…-journal.mjs:96-127`)에 위 `legacy-root-*`·`legacy-ownership` id와 `core` phase를 추가한다.
- **이전 중·후 0.6.0 CLI를 실행한 경우**: legacy manifest가 없거나 digest가 달라 `adoptLegacy`의 `legacy Pota root is missing` 또는 `Managed artifact was modified`로 거부된다(fail-closed, 손상 없음). 문서에 "이전된 설치는 새 버전 CLI로만 다룬다"를 적는다.
- **uninstall**: 새 manifest가 있으면 current 스택, legacy manifest만 있으면 **legacy 스택 그대로**(이전하지 않고 제거). `bunx @comento/pota-harness@latest uninstall`이 문서화된 제거 방법이라 legacy 사용자도 바로 쓸 수 있어야 한다(`commands/pota-uninstall.md:5-9`).
- **doctor**: current 스택만 본다. legacy manifest만 있으면 `FAIL ownership manifest`와 함께 `Legacy installation found at <path>; run pota upgrade to migrate` 한 줄을 낸다.
- **이전 upgrade에서는 runtime 유예를 하지 않는다**: legacy runtime은 Codex 캐시 경로에 있어 남기면 Codex 캐시에 두 버전이 생긴다(결정 5 G2). 0.6.0에는 자동 업그레이드가 없으므로 이 upgrade는 사용자가 직접 실행하는 1회이고, 열린 세션 재시작이 필요한 것은 지금까지의 모든 upgrade와 같다.

근거: 위 파일·줄. EXDEV는 지금도 거부한다(`scripts/pota-lifecycle-transaction-targets.mjs:71-87`). `CODEX_HOME`이 `~/.pota`과 다른 볼륨이면 이전이 `Cross-device replacement is not supported safely`로 깨끗이 rollback된다(지금 `CLAUDE_HOME`이 다른 볼륨일 때와 같은 한계).

거부한 대안: 옛 트리를 복사한 뒤 별도 단계에서 삭제(두 설치가 공존하는 창이 생기고 journal 하나로 되돌릴 수 없다). legacy uninstall을 "upgrade 먼저" 안내로 거부(문서화된 uninstall 경로가 두 단계가 된다).

#### 결정 3 — 호스트 재등록: Claude marketplace와 Codex `config.toml`

확정안:

- **Claude**: `createClaudeRegistration`에 `legacyMarketplaceRoot`를 추가한다. 상태 판정은 세 가지다: `owned`(path == `install/claude`), `ownedLegacy`(path == legacy `…/cache/pota/claude`), `foreign`(그 외, 지금처럼 손대지 않음). 파일 commit **뒤** 순서:
  1. `ownedLegacy`면 `plugin uninstall pota@pota --scope user`(설치돼 있을 때) → `plugin marketplace remove pota`.
  2. 미등록이면 `plugin marketplace add <install/claude> --scope user` → `plugin install pota@pota --scope user`. install이 새 버전을 Claude 캐시에 복사하므로 캐시도 함께 갱신된다.
  3. 실패하면 파일은 그대로 두고 수동 명령을 출력하고 exit 1(지금의 `reportClaudeRegistration` 철학, `scripts/pota-lifecycle-commands.mjs:90-105`).
- **Codex**: `updateConfig`의 `marketplacePath` 기본값을 `install/codex`로 바꾼다(`scripts/pota-lifecycle.mjs:161`, `scripts/pota-lifecycle-config.mjs:9`). `[plugins."pota@pota"]`과 hook trust 항목은 그대로다.
- **hook trust hash 영향 없음**: `hookHash`는 `hooks/hooks.json`의 literal command(`node "${PLUGIN_ROOT}/scripts/pota-state.mjs" …`)·timeout·statusMessage·matcher만 해시한다(`scripts/pota-lifecycle-config.mjs:118-138`). 설치 경로가 들어가지 않고 key(`pota@pota:hooks/hooks.json:<event>:<g>:<h>`)도 같다. `hooks/hooks.json`은 이번 작업에서 수정하지 않는다.
- config는 mutable merge surface라 projection digest가 바뀌어도 거부 대상이 아니다(`docs/plan/upgrade-shared-config-ownership.md:67-68`).

**Gate G1 (가정 A1)**: Codex가 `CODEX_HOME` 밖의 `source_type = "local"` marketplace를 받아들이고, 캐시가 `$CODEX_HOME/plugins/cache/pota/pota/<v>`에 있으면 installed/enabled/version을 보고한다. 기존 A/B gate 테스트를 새 레이아웃으로 옮겨 확인한다(이 머신에 `codex-cli 0.164.0`이 있어 로컬에서 실행된다). **G1이 실패하면** Codex marketplace source 두 대상(`codex-source`, `marketplace`)만 legacy 위치(`$CODEX_HOME/plugins/cache/pota/{plugins/pota,.agents/plugins/marketplace.json}`)에 두고 config `source`를 그대로 둔다. layout 모듈의 상수 두 개만 바뀐다. 결과를 계획 Evidence에 기록한다.

거부한 대안: `codex plugin add`/`codex plugin marketplace add`로 전환(`docs/plan/harness-reliability-remediation.md:58`, `commands/pota-install.md:11`이 custom lifecycle 유지를 결정). 트랜잭션 안에서 Claude 등록을 먼저 바꾸기(rollback 시 등록 복원이 필요해지고, "파일 먼저 commit" 원칙과 어긋난다).

#### 결정 4 — Claude 캐시 갱신

확정안: `register()`가 "이미 등록·설치됨"일 때 캐시 버전을 확인해 갱신한다.

1. `plugin list --json`의 pota 항목 `version`이 `releaseVersion`과 같으면 아무 것도 호출하지 않는다(지금의 "재실행은 두 번 등록하지 않는다" 계약 유지).
2. 다르면 `plugin marketplace update pota`(실패해도 계속) → `plugin update pota@pota --scope user` → 다시 `plugin list`로 `version === releaseVersion` 확인.
3. 실패(명령 실패 또는 버전이 그대로)면 설치는 되돌리지 않고 `Claude Code plugin cache refresh failed: <이유>. To finish: claude plugin marketplace update pota && claude plugin update pota@pota --scope user` 출력, exit 1.
4. `claude` CLI가 없으면 지금처럼 안내만 하고 exit 0. 단 `upgrade --auto`(결정 7)에서는 Claude가 선택된 호스트인데 캐시 갱신을 확인하지 못하면 exit 1로 한다(자동 업그레이드 runner가 "수동 조치 필요"를 판정하는 유일한 신호).
5. `doctor`에 `Claude plugin cache version` 검사를 추가한다.

근거: `scripts/pota-lifecycle-claude.mjs:119-129`(등록돼 있으면 no-op). 실제 등록 형태: `known_marketplaces.json`의 pota은 `source: directory`이고 `installLocation`이 같은 디렉터리(사본 없음), `installed_plugins.json`은 `installPath: ~/.claude/plugins/cache/pota/pota/0.6.0`, `version: "0.6.0"`. marketplace의 `lastUpdated`(11-05)보다 플러그인 `lastUpdated`(11-11)가 뒤라 `plugin update`만으로도 갱신된 것으로 보이지만, `marketplace update`는 무해하므로 먼저 호출한다. help 확인: `claude plugin marketplace update [name] [--json]`, `claude plugin update <plugin> [-s scope] [--json]`.

가정 A3: `claude plugin list --json` 항목에 `version`이 있다(on-disk 형식과 기존 대역 근거). 없으면(`undefined`) 갱신을 항상 호출하고 버전 검증은 건너뛴다. 가정 A4: 최신 상태에서 `plugin update`의 exit code를 모른다 → 버전이 다를 때만 호출해 의존하지 않는다. `-y`는 넘기지 않는다(marketplace-declared command 자동 수락을 피한다).

거부한 대안: uninstall → install 재등록으로 갱신(사용자의 enable 상태와 등록 시각을 매번 지운다). Claude 캐시 디렉터리에 직접 쓰기(호스트 내부 형식 의존).

#### 결정 5 — 이전 runtime 유예

확정안:

- **대상**: canonical runtime `install/runtime/<old>`. Claude hook, locator, 캡슐의 `Pota CLI:` 줄이 이 절대 경로를 쓴다(`scripts/pota-lifecycle-claude.mjs:47-62`, `scripts/pota-state.mjs:152-157`).
- **규칙**: 버전이 바뀌는 upgrade에서 직전 runtime을 지우지 않고 manifest `retained`에 옮긴다. `retiredAt + 3일`(사용자 결정 2026-11-12, 설계 원안은 7일)이 지난 항목과 3개를 넘는 가장 오래된 항목은 **다음 install/upgrade 실행**의 `cleanup` phase에서 제거한다(journal id `retired-runtime-<version>`). 시계 주입 없이 테스트에서 `retiredAt`을 과거로 고쳐 검증한다.
- **manifest 표현**: `retained: [{ id: "runtime" | "codex-runtime", version, path, installedDigest, retiredAt }]`. 검증: key 집합 고정, `version` 정규식, `version !== ownership.version`, `path`가 그 id·version의 allowlist 경로와 일치, digest 형식, ISO 시각, 중복 없음, 길이 상한.
- **integrity**: `assertOwnershipDigests`와 `ownershipDigestsValid`가 `retained`도 검사한다. 수정된 유예 runtime은 upgrade·uninstall을 거부시킨다(다른 관리 트리와 같은 fail-closed).
- **uninstall**: `retained` 전부를 `core` phase에서 제거한다.
- **되돌아가는 경우**: 새로 설치할 버전이 `retained`에 있으면 그 항목을 소유 대상으로 보고 교체하며 `retained`에서 뺀다.
- **`Pota CLI:` 줄**: 설치본에서 실행 중이면(`<pluginRoot>/.pota-runtime.json`이 있으면) 그 locator의 `entrypoints.cli`(canonical)를 쓴다. Codex 캐시 사본에서 실행된 hook이 지워질 수 있는 캐시 경로를 캡슐에 싣지 않게 한다. 소스 체크아웃에서는 지금과 같다.
- **Codex 캐시(`codex-runtime`)**: 기본은 **유예하지 않는다**(지금처럼 `previous-codex-runtime`을 `cleanup`에서 제거, `scripts/pota-lifecycle-commands.mjs:45-53`).

**Gate G2 (가정 A2)**: Codex가 캐시에 두 버전이 있을 때 어느 것을 고르는지 저장소 증거가 없다. 사전순 최대를 고르면 `0.9.0`과 `0.10.0`이 함께 있을 때 옛 버전을 로드한다. `runtime-retention`에서 격리 `CODEX_HOME`에 `0.9.0`·`0.10.0` 두 디렉터리를 만들어 `codex plugin list --json`의 `version`을 확인한다. `0.10.0`이면 Codex 캐시도 같은 규칙으로 유예한다(schema는 이미 `id: "codex-runtime"`을 받는다). 아니거나 Codex가 없으면 단일 버전을 유지하고 한계를 문서에 적는다. 결과를 Evidence에 기록한다.

근거: `docs/memory/lifecycle-install.md` Policy("기존 세션은 이전 버전 경로를 가리킨다"), `docs/plan/release-0.5.0.md:35`.

거부한 대안: 세대 수만으로 유예(1세대는 연속 hotfix 두 번에 열린 세션이 깨진다). `targets`에 `retained-runtime-<v>` record로 넣기(record key가 고정이라 `retiredAt`을 실을 수 없다, `…-integrity.mjs:83`). hook에서 만료 runtime 삭제(hook이 lock·삭제를 하게 된다).

#### 결정 6 — 호스트 선택

확정안:

- 호스트 id: `codex`, `claude`, `antigravity`. canonical 순서 고정.
- 대상 → 호스트:

| 호스트 | 대상 id |
| --- | --- |
| (core, 항상) | `runtime`, manifest |
| codex | `codex-source`, `marketplace`, `codex-runtime`, `codex-config` |
| claude | `claude-runtime`, `claude-command-*`, `claude-agent-*`, `claude-plugin` + `claude plugin` 등록 |
| antigravity | `ide-runtime`, `cli-runtime`, `ide-skill-*`, `cli-skill-*`, `ide-workflow-*`, `cli-workflow-*`, legacy `~/.agents` 이전 대상 |

- **prompt 조건**: 명령이 `install` ∧ `--hosts` 없음 ∧ manifest(새·legacy) 없음 ∧ `stdin`·`stdout`이 TTY ∧ `CI` env 없음. lock을 잡기 **전에** 묻는다.
- **prompt 문구**(ko / en, `localeFamily()` `scripts/pota-lifecycle.mjs:170`):

```
Pota을 설치할 호스트를 선택하세요.
  1) 전체 — Codex, Claude Code, Antigravity (기본)
  2) Claude Code만
  3) Codex만
  4) Antigravity만
번호를 입력하거나 호스트 이름을 쉼표로 구분해 입력하세요 (codex,claude,antigravity) [1]:
```
```
Select the hosts to install Pota into.
  1) All — Codex, Claude Code, Antigravity (default)
  2) Claude Code only
  3) Codex only
  4) Antigravity only
Enter a number, or host names separated by commas (codex,claude,antigravity) [1]:
```
  빈 입력은 1. 잘못된 입력은 다시 묻고 3회 뒤 `No valid host selection was entered.`로 exit 1(변경 없음). EOF도 exit 1. 선택 뒤 `선택한 호스트: … 나중에 바꾸려면: pota install --hosts <목록>` 한 줄.
- **비대화형 기본값**: 전체. 지금 동작과 모든 기존 테스트(TTY 없는 `spawnSync`)가 그대로 유지된다.
- **`--hosts`**: `install`·`upgrade`만 받는다. `--hosts <list>` 또는 `--hosts=<list>`, 값은 `all` 또는 쉼표 목록. 누락·빈 값·모르는 이름·중복은 `Invalid --hosts value: …`로 exit 1(lock·stage 전). 그 밖의 trailing 인자는 지금 문구(`does not accept arguments`)로 거부한다. `--help`도 지금처럼 거부한다(문서화된 예외 유지).
- **적용 우선순위**: `--hosts`(또는 prompt 결과) → manifest `hosts` → 전체. `upgrade`와 자동 업그레이드는 묻지 않는다.
- **manifest 필드**: `hosts: ["codex","claude","antigravity"]`의 비어 있지 않은 부분집합, canonical 순서. `requiredOwnershipTargets(version, hosts)`가 필수 대상을 정한다(지금은 고정 목록 `…-integrity.mjs:115-123`). 선택되지 않은 호스트의 record가 있으면 invalid다.
- **기존 설치 기본값**: schema 1(legacy) manifest는 전체 설치였으므로 이전 시 `hosts` = 전체.
- **선택 변경**: `pota install --hosts …` 또는 `pota upgrade --hosts …`. 추가된 호스트는 새 대상으로 stage(이미 있는 unmanaged 산출물이면 거부). 빠진 호스트는 그 record를 같은 id의 remove 연산으로 제거(digest가 다르면 거부), `codex-config`는 uninstall과 같은 방식으로 Pota section만 제거(`…-commands.mjs:121-128`). claude가 빠지면 uninstall과 같이 **파일 제거 전에** unregister하고 rollback 시 다시 등록한다(`…-commands.mjs:117-118,143-146`).
- **doctor**: 첫 줄 `Hosts: …`, 선택된 호스트의 검사만 낸다. **uninstall**: manifest record 기준이라 그대로 동작하고, claude가 선택된 경우에만 unregister를 호출한다.
- symlink 검사는 (선택 ∪ 기록된) 호스트의 경로만 한다. Claude만 쓰는 사용자의 `~/.codex`가 symlink여도 막지 않는다.
- 새 모듈 `scripts/pota-lifecycle-hosts.mjs`: `HOSTS`, `parseHostsOption`, `hostOfTarget`, `promptHosts({ input, output, ko })`.

거부한 대안: 호스트 CLI·홈 디렉터리 감지로 기본값 정하기(신뢰할 신호가 아니고 기존 "전체 설치" 계약이 바뀐다). `--no-codex` 같은 부정 flag(조합이 늘어난다). 선택을 `config.json`에 두기(digest·필수 대상 검증과 분리된다).

#### 결정 7 — 자동 업그레이드

확정안:

| 항목 | 값 |
| --- | --- |
| 시점 | SessionStart hook만. UPS·Stop은 건드리지 않는다 |
| 확인 주기 | 24시간. 기준 시각 = `state.lastCheckedAt ?? manifest.installedAt` (방금 설치·업그레이드한 설치본은 24시간 동안 확인하지 않는다) |
| hook이 하는 일 | manifest·locator·`config.json`·`state.json`·`notice.json` 읽기, 알림 1줄, 조건이 맞으면 분리 프로세스 spawn. 네트워크·lock·설치는 하지 않는다 |
| 분리 방식 | `spawn(process.execPath, [<같은 runtime>/scripts/pota-auto-upgrade.mjs, "run"], { detached: true, stdio: "ignore", windowsHide: true, cwd: potaHome })` + `child.on("error", noop)` + `unref()` |
| 버전 조회 | runner가 `npm view @comento/pota-harness@latest version --json` (30초) |
| 실행 명령 | stage 디렉터리(`update/stage/`, 최소 `package.json` 선작성, cwd로 지정)에서 `npm install --ignore-scripts --no-audit --no-fund --no-save @comento/pota-harness@<정확한 버전>` (120초) → 검증(결정 9) → `node <stage>/node_modules/@comento/pota-harness/scripts/pota-lifecycle.mjs upgrade --auto` (300초) |
| lock | runner는 `update/update.lock`을 `createLifecycleLock({ lifecycleLockPath })`로 잡는다(대기 없이 실패하면 조용히 종료, 죽은 pid는 기존 규칙으로 회수). lifecycle lock은 자식 `upgrade`가 평소대로 잡는다(기본 대기 60초) |
| 성공 판정 | 자식 종료 뒤 manifest `version === 목표 버전`. exit code 0이면 `updated`, 0이 아니면 `manual`(파일은 올라갔지만 Claude 캐시 미갱신) |
| backoff | 조회·설치 실패: `min(1h × 2^(n-1), 24h)`, 알림 없음. `upgrade` 실패: 그 버전에 대해 `min(24h × 2^(n-1), 7d)`, 알림은 버전당 1회. 더 새 버전이 나오면 초기화 |
| 끄는 설정 | env `POTA_AUTO_UPGRADE=0|false|off|no`, 또는 `config.json`의 `autoUpgrade: false`. CLI `pota auto-upgrade status|on|off|run`. `config.json`을 읽을 수 없거나 형식이 틀리면 **끔**으로 본다 |
| 소스 체크아웃 | 두 겹으로 막는다. (1) hook이 설치본에서 실행 중일 때만 동작한다: `<pluginRoot>/.pota-runtime.json`이 있고 그 `pluginRoot`가 `install/runtime/<manifest.version>`일 때만 spawn. (2) 설치할 때 `pluginRoot/.git`이 있으면 manifest `origin: "checkout"`으로 기록하고 runner가 건너뛴다 |
| 로컬 tarball 설치 | registry 설치와 구분하지 않는다(`origin: "package"`). 버전 비교만 한다 |
| 설치 버전 ≥ latest | 아무 것도 하지 않고 `latestSeen`만 기록. 다운그레이드하지 않는다. 설치본이 prerelease이고 core 버전이 latest와 같으면 올린다 |
| 오프라인·npm 없음·샌드박스 | 조회 실패로 처리: 조용히 backoff, `status`에서만 보인다 |
| Windows | runner는 `process.execPath`로 직접 spawn. npm은 기존 Claude 대역과 같은 규칙(`.mjs`면 Node로, 아니면 `shell: win32`, `…-claude.mjs:77-80`). npm 인자에 경로를 넣지 않는다(cwd로 stage 지정) — `npm.cmd`의 공백 경로 분리를 피한다(`docs/plan/release-0.2.0-installed-runtime.md` Evidence) |
| uninstall 경합 | `upgrade --auto`는 lifecycle lock 안에서 schema 2 manifest가 없으면 `auto-upgrade requires an existing installation`으로 거부한다. uninstall 직후 runner가 재설치하는 일을 막는다 |

- 상태 파일(모두 tmp + rename으로 원자적 쓰기):
  - `update/state.json`: `{ schemaVersion: 1, lastCheckedAt, latestSeen, consecutiveFailures, nextAttemptAt, failedVersion, lastResult: { kind, at, from, to, detail } }`
  - `update/notice.json`: `{ schemaVersion: 1, kind: "updated" | "failed" | "manual", from, to, at }` (슬롯 1개)
  - `update/last-run.log`: 마지막 실행의 npm·lifecycle 출력, 64 KiB 상한
- uninstall은 lock 해제 뒤 `update/`의 알려진 파일과 자기 `stage/`를 지우고 빈 디렉터리를 정리한다. `config.json`과 `projects/`는 남긴다(사용자 설정·goal 상태 보존, `commands/pota-uninstall.md:22`).
- **버전 간 계약(바꾸면 옛 runner가 깨진다)**: runner는 옛 버전이고 실행 대상은 새 버전이다. 고정하는 것은 세 가지뿐이다: `pota-lifecycle.mjs upgrade --auto` 호출 형태, `POTA_HOME/install/lifecycle.json`의 `version`, exit code 의미. `lifecycle-install.md`에 기록한다.
- 새 스크립트: `scripts/pota-update-state.mjs`(경로·읽기·판정·알림 claim; hook과 runner가 정적 import), `scripts/pota-auto-upgrade.mjs`(runner + CLI; `runtimeEntryRelativePaths`와 `package.json` `check`에 추가).

근거: hook timeout 10초(`hooks/hooks.json`), 설치 cache 실행 거부(`…-commands.mjs:32-34`), 패키지 소스를 지워도 설치본이 동작(`test/packed-install.test.mjs` "packed install remains self-contained…"), `npm install --ignore-scripts --no-audit --no-fund --prefix … <tarball>` 선례(같은 테스트), `engines.node >=18`.

가정 A5: `npm view … version --json`은 JSON 문자열을 낸다(객체면 `version` 필드를 읽는다 — npm 12가 출력 형태를 바꾼 선례 `test/docs-package-hardening.test.mjs:38-43`). 가정 A6: 두 호스트 모두 hook이 띄운 detached 자식을 hook 종료 뒤 죽이지 않는다. 죽이면 다음 주기에 다시 시도될 뿐이다.

거부한 대안:
- `npx -y @comento/pota-harness@latest upgrade`: 실행 전에 받은 패키지를 검증할 수 없고, `latest`를 조회와 실행에서 두 번 해석하며, `--ignore-scripts`를 보장하지 못한다.
- 전역 `npm i -g @comento/pota-harness@latest`: 사용자의 전역 prefix를 바꾸고 권한 문제가 난다. 설치 방식(bunx·npx·전역·체크아웃)에 의존한다.
- hook 안에서 registry `fetch`: 10초 timeout과 "hook은 막지 않는다"에 어긋나고 사용자의 `.npmrc`(사내 registry·proxy)를 무시한다.
- runner가 새 패키지의 `apply` 진입점에 위임: 더 유연하지만 지금은 계약 세 가지로 충분하다.

#### 결정 8 — 알림

확정안:

- 위치: SessionStart 캡슐의 **맨 끝**(`Pota CLI:` 줄 뒤)에 한 줄 + 같은 문장을 `hookOutput.systemMessage`에도 싣는다. 정적 kernel이 먼저 오는 순서와 프롬프트 캐시 접두부를 건드리지 않는다(`docs/plan/clean-uninstall-prompt-cache-resilience.md:116-126`). foreign 캡슐에도 붙는다(설치본 정보라 소유자 작업을 노출하지 않는다).
- 문구(버전은 예시):

| kind | ko | en |
| --- | --- | --- |
| `updated` | `Pota 업데이트: 0.6.0 → 0.7.0 자동 업그레이드되었습니다. 이 세션부터 적용됩니다. 사용자에게 한 번 알려 주세요.` | `Pota update: auto-upgraded 0.6.0 → 0.7.0; this session runs 0.7.0. Mention it to the user once.` |
| `failed` | `Pota 업데이트: 0.7.0 자동 업그레이드가 실패했습니다. 사용자에게 "npx @comento/pota-harness@latest upgrade" 실행 또는 "pota auto-upgrade status" 확인을 안내하세요.` | `Pota update: auto-upgrade to 0.7.0 failed. Tell the user to run "npx @comento/pota-harness@latest upgrade" or check "pota auto-upgrade status".` |
| `manual` | `Pota 업데이트: 0.7.0이 설치되었지만 Claude Code 플러그인 캐시가 갱신되지 않았습니다. 사용자에게 "claude plugin update pota@pota" 실행을 안내하세요.` | `Pota update: 0.7.0 is installed but the Claude Code plugin cache was not refreshed. Tell the user to run "claude plugin update pota@pota".` |

- **한 번만**: hook이 `notice.json`을 읽고 보여 줄 조건이 맞으면 `rename`으로 claim한 뒤 지운다(먼저 rename에 성공한 세션 하나만 보여 준다). `updated`는 실행 중 runtime 버전이 `to`와 같을 때만(실제로 새 버전을 쓰는 세션), `failed`·`manual`은 설치본에서 실행 중인 어느 버전이든 보여 준다. 14일 지난 알림은 조용히 지운다. 사용자가 직접 실행한 `pota upgrade`는 알림을 만들지 않는다.
- **동작 범위**: 알림을 포함한 모든 업데이트 동작은 "설치본에서 실행 중"일 때만 한다(`.pota-runtime.json`이 있고 그 `pluginRoot`가 `install/runtime/` 아래). 소스 체크아웃의 in-process 테스트가 실제 사용자의 알림을 소비하지 않는다.
- **예산**: 기존 예산(UPS 620/700, paused·blocked SessionStart 620 등 `docs/memory/hook-context.md` 표)은 "알림이 없을 때" 기준으로 그대로 둔다. 새 계약: 알림 한 줄 ≤ 160자(en·ko, 세 kind, 긴 버전 문자열 포함). 알림은 1회성이라 상시 예산에 넣지 않는다. 이 계약 변경 사유를 `hook-context.md`에 기록한다.
- hook의 업데이트 단계에서 난 오류는 삼킨다. `hookFailureResult`의 "could not read goal state" 문구로 새지 않게 한다(`scripts/pota-state.mjs:170-174`).

가정 A7: `systemMessage`는 두 호스트에서 사용자에게 보인다(선례는 hook 실패 알림뿐). 모델용 한 줄이 계약이고 `systemMessage`는 보조다.

거부한 대안: 앞에 붙이기(`prependContext`, kernel-first 순서가 깨진다). UPS에 싣기(프롬프트마다 누적, `hook-context.md` Policy). 호스트별 1회(hook이 호스트를 확실히 구분할 근거가 없다).

#### 결정 9 — 자동 실행 전 무결성

확정안(하나라도 어긋나면 실행하지 않고 실패로 기록):

1. 패키지 이름은 상수 `@comento/pota-harness`. state·env에서 읽지 않는다.
2. registry 응답: exit 0, JSON 파싱 성공, `^\d+\.\d+\.\d+$`(prerelease·build 거부), 길이 ≤ 32.
3. 설치 버전보다 엄격히 높을 때만 진행(숫자 3항 비교).
4. stage는 `update/stage/`를 지우고 새로 만든다. `potaHome` 기준 symlink 조상 검사(`assertNoSymlinkComponents`, `scripts/pota-safe-fs.mjs:26-45`).
5. 설치는 정확한 버전 지정 + `--ignore-scripts`. tarball integrity는 npm이 registry metadata로 검증한다.
6. 설치 뒤: `node_modules/@comento/pota-harness/package.json`의 `name === "@comento/pota-harness"`·`version === 목표`, `.codex-plugin/plugin.json`의 `name === "pota"`·`version === 목표`, `scripts/pota-lifecycle.mjs`가 일반 파일, 패키지 트리에 symlink·특수 파일 없음, `node_modules`에 `@comento/pota-harness` 외 패키지 없음(의존성 0 전제).
7. 실행은 `process.execPath` + 절대 경로. shell·bin shim·PATH 조회를 거치지 않는다.
8. lifecycle 자체의 fail-closed(manifest·digest 검증, 트랜잭션)가 그대로 적용된다.
9. 실행 뒤 manifest `version`으로 성공을 판정한다.

하지 않는 것: 서명·provenance 검증(`npm audit signatures`). npm 계정이 탈취되면 자동 실행된다는 잔여 위험은 "기본 켜짐 + 전 버전 자동 적용" 결정에 내재하며, 끄는 설정과 문서 안내로 다룬다(5절 질문 1).

근거: `scripts/pota-lifecycle-staging.mjs:117-132`(일반 파일만 복사), `…-integrity.mjs:154-157`(버전 정규식), `package.json`(의존성 없음).

---

### 2. manifest schema 변경과 하위 호환

schema 2 (`<potaHome>/install/lifecycle.json`):

```json
{
  "schemaVersion": 2, "plugin": "pota", "version": "0.7.0",
  "transactionId": "<uuid v4>", "installedAt": "<ISO>",
  "origin": "package",
  "hosts": ["codex", "claude", "antigravity"],
  "targets": [{ "id": "…", "phase": "…", "path": "…", "type": "file|tree|config", "installedDigest": "sha256:…", "previous": null }],
  "retained": [{ "id": "runtime", "version": "0.6.0", "path": "…/install/runtime/0.6.0", "installedDigest": "sha256:…", "retiredAt": "<ISO>" }]
}
```

- 대상 allowlist(schema 2): `runtime`(phase `core`, `install/runtime/<version>`), `codex-source`(`install/codex/plugins/pota`), `marketplace`(`install/codex/.agents/plugins/marketplace.json`), `codex-runtime`(`$CODEX_HOME/plugins/cache/pota/pota/<version>`), `claude-plugin`(`install/claude`), 나머지 id·경로는 지금과 같다(`…-integrity.mjs:125-152`). phase 목록에 `core`가 맨 앞에 추가된다.
- journal 전용 id: `ownership`, `legacy-ownership`, `legacy-root-codex-source`, `legacy-root-marketplace`, `legacy-root-claude-plugin`, `previous-codex-runtime`, `retired-runtime-<version>`, 기존 `legacy-ide-*`·`legacy-cli-*`.
- 검증은 `schemaVersion`으로 갈린다. schema 1은 legacy 경로에서만, schema 2는 새 경로에서만 유효하다. schema 1 검증 로직(key 집합, `CLAUDE_PLUGIN_SINCE`, 고정 필수 목록)은 legacy 스택에서 바이트 그대로 유지한다.
- **0.6.0 manifest에서의 upgrade 경로**: 결정 2의 순서 그대로다. legacy manifest(schema 1)를 legacy 스택으로 검증 → 한 트랜잭션에서 새 대상 설치 + legacy 대상 제거 + schema 2 manifest 쓰기 + legacy manifest 제거 → `hosts` = 전체, `origin`은 실행 소스에 따라, `retained` = `[]`.
- 0.2.2 무-manifest 트리: 지금처럼 `adoptLegacy`로 합성 ownership을 만든 뒤 같은 이전 경로를 탄다.
- 0.2.9 이전 manifest(`claude-plugin` 없음): schema 1 검증의 기존 예외가 그대로 처리한다(`…-integrity.mjs:99-103,115-118`).
- 역방향: 0.6.0 이하 CLI는 이전된 설치를 거부한다(결정 2). 새 버전으로 uninstall한 뒤 구버전을 설치해야 한다.

---

### 3. 구현 task별 계약

공통 규칙:
- 모든 lifecycle 테스트 env helper(`withHome` 2곳, `claudePluginEnv`, `isolatedEnvironment`, `packed-install`의 env)는 **`POTA_HOME`을 명시적으로** 임시 경로로 준다. `...process.env`를 펼치므로 개발자 셸에 `POTA_HOME`이 있으면 실제 경로에 쓰게 된다.
- 새 테스트는 버전 문자열을 `package.json`에서 읽는다. 버전 literal 표면을 늘리지 않는다(`docs/memory/release-process.md` "버전 표면").
- `test/fixtures/` 아래 대역은 인자 없이 로드되면 no-op이어야 한다(`node --test`가 `test/` 아래 `.mjs`를 로드한다, `test/fixtures/fake-claude.mjs:6-7`).

#### Task 2 `claude-cache-refresh`

- 파일: `scripts/pota-lifecycle-claude.mjs`, `scripts/pota-lifecycle-commands.mjs`, `test/lifecycle.test.mjs`, **`test/fixtures/fake-claude.mjs`**(계획 write scope에 추가 필요).
- 대역 확장(`fake-claude.mjs`): `plugin install`·`plugin update`가 실제처럼 `<CLAUDE_CONFIG_DIR>/plugins/cache/<marketplace>/<plugin>/<version>`에 사본을 만들고 `version`·`installPath`를 기록한다. `plugin update <id>`(미설치면 실패, 같은 버전이면 exit 0), `plugin marketplace update [name]` 추가. 실패 주입 env `FAKE_CLAUDE_FAIL="<명령 접두>"`, `FAKE_CLAUDE_UPDATE_NOOP=1`(exit 0인데 버전이 그대로). 0.6.0 lifecycle이 쓰는 명령과는 호환을 유지한다(Task 3b가 published 0.6.0 트리를 이 대역으로 돌린다).
- 계약 변경 기록: 기존 테스트의 `state.plugins[0].installPath === join(pluginMarketplace, "pota")` 단언을 캐시 경로로 바꾼다. 사유: 실제 Claude는 캐시 사본에 설치한다(`installed_plugins.json` 실측). 대역의 충실도를 올리는 변경이고 제품 계약을 약화하지 않는다.
- 먼저 쓸 실패 테스트:
  1. `upgrade refreshes a stale Claude Code plugin cache to the installed version` — 설치 뒤 대역 state의 플러그인 `version`을 `0.5.0`으로 바꾸고 upgrade. exit 0, 로그에 `plugin marketplace update pota`과 `plugin update pota@pota --scope user`가 순서대로, state `version`이 현재 버전.
  2. `upgrade does not call claude plugin update when the cache already matches` — 같은 버전 재실행 로그에 `plugin update`·`marketplace update`·`marketplace add`·`plugin install`이 추가되지 않는다.
  3. `a failed Claude cache refresh keeps the upgrade committed, exits 1, and prints the manual command` — `FAKE_CLAUDE_FAIL="plugin update"`. exit 1, stdout에 `Claude Code plugin cache refresh failed:`와 `claude plugin marketplace update pota && claude plugin update pota@pota --scope user`, manifest·runtime은 새 상태 그대로.
  4. `a refresh that leaves the old cached version is reported as failed` — `FAKE_CLAUDE_UPDATE_NOOP=1`. exit 1, `still at 0.5.0`.
  5. `doctor fails when the Claude Code plugin cache version differs` — `FAIL Claude plugin cache version`.
- 수용 기준: 위 5개 통과, 기존 Claude 등록·foreign 테스트 통과, `claude` CLI 없음 경로는 exit 0 유지.
- focused: `node --test test/lifecycle.test.mjs` / surface: `node --test test/installed-plugin.test.mjs test/packed-install.test.mjs`

#### Task 3a `pota-home-layout` (제안: `pota-home-root`의 전반부)

- 파일(신규): `scripts/pota-lifecycle-layout.mjs`. 수정: `scripts/pota-lifecycle.mjs`, `…-integrity.mjs`, `…-commands.mjs`, `…-staging.mjs`, `…-transaction-journal.mjs`, `…-claude.mjs`(root 인자만), `scripts/pota-paths.mjs`(`installRoot(env)`·`installManifestPath(env)` helper), `package.json`(`check`에 새 모듈). 테스트: `test/lifecycle.test.mjs`, `test/lifecycle-transaction.test.mjs`, `test/lifecycle-hardening.test.mjs`, `test/installed-plugin.test.mjs`, `test/packed-install.test.mjs`의 경로 helper와 기대 경로.
- 범위: 신규 설치·같은 레이아웃 upgrade·uninstall·doctor가 새 레이아웃과 schema 2(`hosts` 전체, `origin`, `retained: []`)로 동작한다. legacy 처리는 3b. 이 단계에서 legacy manifest를 만나면 `Legacy installation found; migration is not available in this build`로 거부해도 된다(3b가 교체).
- 계약 변경 기록: 기존 테스트의 경로 상수(`plugins/cache/pota/.pota/lifecycle.json` 등)와 `ownership.schemaVersion === 1` 단언이 바뀐다. 사유: 사용자 결정 (a). 단언의 의미(무엇이 존재·부재해야 하는가)는 유지한다.
- 먼저 쓸 실패 테스트:
  1. `install places the manifest, canonical runtime, Codex marketplace source, and Claude marketplace under POTA_HOME/install` — schema 2 필드, 각 경로 존재, `$CODEX_HOME/plugins/cache/pota` 아래에는 `pota/<version>`만.
  2. `every runtime locator and Claude hook points at the canonical runtime` — Codex 캐시·Codex source·Claude·Antigravity locator의 `pluginRoot`, Claude `hooks.json` command 경로.
  3. `config projection points marketplaces.pota at the Codex marketplace root and keeps hook trust hashes` — `source` 값, `trusted_hash` 집합이 `trustedHookStates`와 일치.
  4. `install or upgrade from the canonical runtime, the Codex cache, or the Codex source is refused`(`test/installed-plugin.test.mjs:113-116` 확장).
  5. `install rejects a symlinked POTA_HOME install ancestor without outside writes`(hardening fixture에 Pota home 추가, Codex fixture는 캐시 경로로).
  6. `managed-only uninstall prunes the install root and Codex cache scaffolds and can reinstall`, `uninstall preserves unmanaged children at every scaffold`(포팅).
  7. `failure injection after-core rolls back every committed phase`(기존 phase 루프에 `core` 추가).
  8. `journal schema rejects entries outside the current allowlist`(포팅).
  9. **G1**: `Codex A/B gate proves the versioned custom cache is required`(포팅, Codex 없으면 skip). 실패 시 결정 3의 fallback 적용.
- env 주입점: `POTA_HOME`(신규 사용), 기존 `POTA_TEST_*` 전부 유지.
- 수용 기준: 위 통과 + 기존 lifecycle 3개 파일의 모든 케이스가 새 경로로 통과, 실제 홈에 쓰지 않음(임시 디렉터리 밖 변경 없음).
- focused: `node --test test/lifecycle.test.mjs test/lifecycle-transaction.test.mjs test/lifecycle-hardening.test.mjs` / surface: `node --test test/installed-plugin.test.mjs test/packed-install.test.mjs`

#### Task 3b `pota-home-migration` (제안: 후반부)

- 파일: `scripts/pota-lifecycle.mjs`(legacy 스택 구성, 이중 lock, legacy scaffold 정리), `…-commands.mjs`, `…-integrity.mjs`(`ownedBy`), `…-legacy.mjs`, `…-transaction-journal.mjs`, `…-claude.mjs`(`ownedLegacy`), `test/lifecycle-transaction.test.mjs`, `test/lifecycle.test.mjs`.
- 테스트 준비물: published 0.6.0 트리 = `main` 병합 커밋 `9e2e137962c06615c91fa07de9528577bf58cb13`(`package.json` 0.6.0 확인). 기존 `materializePublishedTree`(0.2.4에 쓰는 것, `test/lifecycle-transaction.test.mjs:352-372`)로 꺼내 그 lifecycle로 legacy 설치를 만든다. CI는 `fetch-depth: 0`이다.
- 새 테스트 hook: `POTA_TEST_CRASH_AFTER_PHASE=<phase>`(해당 phase 뒤 `process.exit(88)`; 기존 `POTA_TEST_CRASH_AFTER_STAGE` 패턴 `…-commands.mjs:39`).
- 먼저 쓸 실패 테스트:
  1. `a published 0.6.0 installation migrates to POTA_HOME with one upgrade` — schema 2 manifest, legacy `.pota`·`plugins`·`.agents`·`claude` 부재, legacy root에 `pota/<version>`만, config `source` 갱신, 대역 로그가 `plugin uninstall pota@pota --scope user` → `plugin marketplace remove pota` → `plugin marketplace add <install/claude> --scope user` → `plugin install pota@pota --scope user` 순서, 등록 path가 새 경로.
  2. `migration refuses a modified legacy managed artifact and changes nothing` — exit 1, `Managed artifact was modified`, legacy manifest 바이트 동일, 새 루트에 manifest·runtime 없음.
  3. `migration failure injection <phase> restores the complete legacy installation`(`after-core`~`after-cleanup` 각각) — legacy manifest 동일, legacy 대상 digest 동일, 이어서 upgrade 성공.
  4. `the next lifecycle run recovers a migration that crashed after the cleanup phase` — exit 88, 새 루트에 journal 존재, 다음 `upgrade`가 복구 후 이전 완료.
  5. `migration recovers an interrupted legacy journal first` — 0.6.0 lifecycle을 `POTA_TEST_CRASH_AFTER_STAGE=1`로 중단시킨 뒤 upgrade.
  6. `a live legacy lifecycle lock blocks migration` — legacy lock을 살아 있는 pid로 잡고 `POTA_LIFECYCLE_LOCK_TIMEOUT_MS=500`. `Timed out waiting for Pota lifecycle lock`, 변경 없음.
  7. `migration preserves unmanaged children of the legacy root`.
  8. `an exact legacy 0.2.2 tree is adopted and migrated`(기존 4개 0.2.2 케이스 포팅: 정확 일치 채택, 수정 파일·추가 파일·수정 mirror 거부).
  9. `uninstall removes a legacy-layout installation without migrating`.
  10. `doctor reports a legacy installation with a migration hint`.
  11. `legacy and current manifests together fail closed`.
  12. `migration leaves a foreign Claude Code marketplace named pota untouched`, `a failed Claude re-registration after migration exits 1 with the manual commands and keeps the files`.
- 수용 기준: 위 통과, Task 3a 테스트 회귀 없음.
- focused: `node --test test/lifecycle-transaction.test.mjs test/lifecycle.test.mjs` / surface: `node --test test/lifecycle-hardening.test.mjs test/installed-plugin.test.mjs test/packed-install.test.mjs`

#### Task 4 `runtime-retention`

- 파일: `scripts/pota-lifecycle-commands.mjs`, `…-integrity.mjs`, `…-transaction-journal.mjs`, **`scripts/pota-state.mjs`**(`cliPrefixLine`, write scope 추가 필요), `test/lifecycle-transaction.test.mjs`, `test/installed-plugin.test.mjs`.
- 테스트 helper: `rewriteOwnedVersion`(`test/lifecycle-transaction.test.mjs:906-929`)이 `runtime`과 `codex-runtime` 두 record를 함께 옮기게 고친다.
- 계약 변경 기록: `an owned 0.2.2 installation upgrades to 0.6.0 and removes only the previous runtime`의 "이전 runtime 제거" 단언이 canonical runtime에 대해서는 "유예"로 바뀐다. 사유: 사용자 결정 (e).
- 먼저 쓸 실패 테스트:
  1. `a cross-version upgrade keeps the previous canonical runtime and records it as retained` — 디렉터리 존재, `retained` 항목의 digest 일치, 옛 runtime의 `pota-state.mjs session-start`가 exit 0.
  2. `a retained runtime past the grace period is removed by the next upgrade` — `retiredAt`을 4일 전으로.
  3. `retained runtimes are capped at three`.
  4. `a modified retained runtime blocks upgrade and uninstall`.
  5. `uninstall removes retained runtimes`.
  6. `a cleanup failure restores retained runtimes and the manifest`(`after-cleanup`).
  7. `doctor reports a modified retained runtime`(`FAIL ownership digests`).
  8. `reinstalling a retained version adopts it and drops the retained entry`.
  9. `an invalid retained entry fails closed`(allowlist 밖 path, 현재 버전과 같은 version, 모르는 key).
  10. `SessionStart from an installed copy prints the canonical CLI path`(Codex 캐시 사본에서 실행).
  11. **G2**: `Codex cache retention gate`(Codex 없으면 skip): `0.9.0`·`0.10.0` 두 캐시에서 보고 버전 확인. 결과에 따라 `upgrade removes the previous Codex cache version` 또는 `…keeps…` 중 하나를 확정한다.
- 수용 기준: 위 통과, G2 결과와 채택한 분기가 Evidence에 기록됨.
- focused: `node --test test/lifecycle-transaction.test.mjs` / surface: `node --test test/lifecycle.test.mjs test/installed-plugin.test.mjs`

#### Task 5 `host-selection`

- 파일(신규): `scripts/pota-lifecycle-hosts.mjs`. 수정: `scripts/pota-lifecycle.mjs`(인자 파싱, prompt, usage), `…-commands.mjs`, `…-integrity.mjs`, `…-staging.mjs`, `package.json`(`check`). `scripts/pota.mjs`는 이미 인자를 그대로 넘기고 `stdio: "inherit"`라 수정이 필요 없다(`scripts/pota.mjs:23-27`). 테스트: `test/lifecycle.test.mjs`, `test/lifecycle-hardening.test.mjs`, `test/cli-contract-hardening.test.mjs`.
- 새 테스트 hook: `POTA_TEST_HOSTS_PROMPT_TTY=1`(pipe stdin으로 대화형 경로를 탄다. pty 없이 CLI 수준 검증).
- 먼저 쓸 실패 테스트:
  1. `--hosts accepts all or a comma list and rejects missing, empty, unknown, and duplicate values before mutation` — exit 1, `Invalid --hosts value`, 설치 루트 미생성. 기존 `install rejects every trailing argument…`(`test/lifecycle-hardening.test.mjs:35-48`)는 그대로 통과해야 한다.
  2. `a non-interactive install without --hosts installs every host`.
  3. `install --hosts claude writes only core and Claude targets` — `CODEX_HOME` 아래 미생성, `config.toml` 바이트 동일, Antigravity 경로 미생성, manifest `hosts: ["claude"]`.
  4. `install --hosts codex never calls the claude CLI`(대역 로그 없음).
  5. `upgrade follows the recorded host selection`.
  6. `upgrade --hosts adds a host and removes a deselected host` — 빠진 호스트의 파일·config section 제거, claude 빠질 때 unregister.
  7. `deselecting a host with a modified artifact is refused and changes nothing`.
  8. `a rollback after Claude deselection re-registers the plugin`(`POTA_TEST_FAIL_PHASE`).
  9. `an interactive install prompts once and records the choice`(stdin `2\n`).
  10. `the prompt re-asks on invalid input and exits 1 after three attempts without mutation`, `EOF at the prompt exits 1`.
  11. `no prompt for upgrade, for an existing manifest, for --hosts, without a TTY, or when CI is set`.
  12. `a manifest whose hosts are empty, unordered, unknown, or inconsistent with its targets fails closed`.
  13. `doctor checks only the selected hosts and prints the selection`.
  14. `a symlinked home of an unselected host does not block install`.
  15. `promptHosts` 단위 테스트(ko·en 문구, 번호·쉼표 목록·빈 입력).
- 수용 기준: 위 통과, Task 3b의 이전 테스트에서 `hosts`가 전체로 기록됨.
- focused: `node --test test/lifecycle.test.mjs test/lifecycle-hardening.test.mjs` / surface: `node --test test/cli-contract-hardening.test.mjs test/packed-install.test.mjs`

#### Task 6 `auto-upgrade`

- 파일(신규): `scripts/pota-update-state.mjs`, `scripts/pota-auto-upgrade.mjs`, `test/auto-upgrade.test.mjs`, `test/fixtures/fake-npm.mjs`. 수정: `scripts/pota-state.mjs`, `scripts/pota-state-context.mjs`(알림 문구), `scripts/pota.mjs`(`auto-upgrade` 분기, 8개 locale `usage`), `scripts/pota-paths.mjs`(`runtimeEntryRelativePaths`), `scripts/pota-lifecycle.mjs`·`…-commands.mjs`(`--auto`, origin 기록, uninstall의 `update/` 정리), `package.json`(`check`), `test/cli-contract-hardening.test.mjs`(usage 상수), `test/index-context.test.mjs` 또는 `test/token-efficiency.test.mjs`(알림 예산).
- 계약 변경 기록: root usage 문자열에 `auto-upgrade`가 추가된다(`test/cli-contract-hardening.test.mjs:11`). `auto-upgrade`의 exit 규약은 root와 같다(0 성공·help, 1 실행 오류, 2 사용법 오류). lifecycle 인자 규약에 `upgrade --auto`가 추가된다.
- 대역·주입점:
  - `POTA_NPM_CLI`(신규, `POTA_CLAUDE_CLI`와 같은 규칙) → `test/fixtures/fake-npm.mjs`: `view @comento/pota-harness@latest version --json`은 `FAKE_NPM_LATEST` 값을 JSON으로, `install … @comento/pota-harness@<v>`는 저장소 소스를 `<cwd>/node_modules/@comento/pota-harness`에 복사(`.git`·`node_modules`·`test`·`.omo`·`docs/plan`·`docs/memory` 제외)하고 두 manifest의 version을 `<v>`로 쓴다. 호출 로그 `FAKE_NPM_LOG`, 실패 주입 `FAKE_NPM_FAIL=view|install`, 변조 주입 `FAKE_NPM_TAMPER=name|version|symlink|extra-package`.
  - "구버전 설치"는 Task 4의 `rewriteOwnedVersion`으로 만들고 `FAKE_NPM_LATEST`는 `package.json`의 현재 버전으로 준다. 저장소 버전을 올리지 않는다.
  - "확인할 때가 됨"은 `update/state.json`의 `lastCheckedAt`을 과거로 써서 만든다. 시계 env는 두지 않는다.
  - hook 단계는 `runStateResult(event, { …, update })`의 선택 주입(`{ env, now, spawn, pluginRoot }`)으로 단위 검증한다. 기본값은 실제 구현.
- 먼저 쓸 실패 테스트(`test/auto-upgrade.test.mjs`):
  1. `SessionStart from a source checkout never reads or writes update state`(설치 manifest와 pending 알림이 있어도 출력 바이트 동일, `update/` 변화 없음).
  2. `SessionStart from an installed runtime spawns a detached runner only when a check is due` — 주입한 `spawn`이 `detached: true`, `stdio: "ignore"`, `windowsHide: true`로 한 번 호출. 방금 설치한 상태·`nextAttemptAt` 미래·끔 설정에서는 호출 없음.
  3. `auto-upgrade is off for POTA_AUTO_UPGRADE=0, for config autoUpgrade false, and for an unreadable config`.
  4. `the runner upgrades an older installation and writes one updated notice`(runner를 `spawnSync`로 직접 실행) — manifest version이 최신, fake npm 로그가 `view` → `install … @comento/pota-harness@<v>` 순서이고 인자에 경로 없음, `notice.json` kind `updated`, stage 정리.
  5. `the runner does nothing when the installed version is equal or higher`, `…never downgrades`, `…upgrades a prerelease install to the same core release`.
  6. `the runner rejects an invalid registry answer`(prerelease, 비-semver, 비-JSON, 빈 값) — 설치 호출 없음.
  7. `the runner refuses a staged package that fails verification`(`FAKE_NPM_TAMPER` 4종) — lifecycle 미실행, `failed` 기록.
  8. `registry and install failures back off silently`(알림 없음, `nextAttemptAt` 증가, 연속 실패 시 간격 2배·상한).
  9. `a failed lifecycle upgrade writes one failed notice per version and backs off`(관리 파일을 수정해 거부시킴).
  10. `an upgrade whose Claude cache refresh fails writes a manual notice`(`FAKE_CLAUDE_FAIL`).
  11. `a second runner exits while update.lock is held`, `a stale update.lock from a dead pid is reclaimed`.
  12. `the runner skips a checkout-origin installation`, `install from a git checkout records origin checkout`.
  13. `upgrade --auto without an existing schema 2 manifest is refused and installs nothing`(uninstall 경합).
  14. `the next SessionStart shows the notice once and only on the upgraded version` — `updated`는 버전이 맞는 hook에서 1회, 두 번째 SessionStart에는 없음, 옛 runtime의 hook은 소비하지 않음. `failed`·`manual`은 어느 설치본 버전에서나 1회. 14일 지난 알림은 표시 없이 삭제.
  15. `update notice lines stay within 160 characters`(en·ko × 3 kind × 긴 버전), `the notice is appended after the Pota CLI line and mirrored in systemMessage`, `capsules without a notice are unchanged`.
  16. `an auto-upgrade hook error never changes the capsule or the exit code`(손상된 `state.json`·`notice.json`, spawn 실패).
  17. `pota auto-upgrade status|on|off` — JSON 보고, `config.json` 원자적 쓰기, 사용법 오류 exit 2.
  18. `uninstall removes update state and keeps config.json and projects`.
  19. e2e 1개: 설치본 runtime의 `pota-state.mjs session-start`를 실제로 실행 → `notice.json`이 생길 때까지 poll(상한 30초) → 다음 SessionStart 캡슐에 알림.
- 수용 기준: 위 통과, 기존 hook 예산 테스트 무변경 통과, 실제 registry·실제 홈 접근 없음(fake npm 로그 외 npm 호출 없음), hook 단계의 추가 I/O는 작은 파일 읽기와 spawn 1회뿐.
- focused: `node --test test/auto-upgrade.test.mjs` / surface: `node --test test/installed-plugin.test.mjs test/packed-install.test.mjs test/cli-contract-hardening.test.mjs test/token-efficiency.test.mjs test/index-context.test.mjs test/state-recovery-hardening.test.mjs test/goal-state.test.mjs`

#### Task 7 `docs-memory`

- 파일: `README.md`와 `README.{ko,ja,zh,es,fr,de,pt}.md`, `docs/memory/lifecycle-install.md`, `docs/memory/hook-context.md`, `docs/memory/release-process.md`(로컬 업그레이드 절차 한 줄), `MEMORY.md`. **write scope 추가 필요**: `commands/pota-{install,upgrade,doctor,uninstall}.md`와 `.agents/workflows/pota-{install,upgrade,doctor,uninstall}.md`. `commands/pota-uninstall.md:16`이 `~/.codex/plugins/cache/pota`을, `commands/pota-install.md:15-22`가 옛 구조를 적고 있다(`docs/memory/policy-surfaces.md` 표면 지도).
- 내용: 새 레이아웃과 `POTA_HOME`, 이전(1회, 열린 세션 재시작), 호스트 선택과 `--hosts`, 유예 규칙, 자동 업그레이드(주기·끄는 법·알림·`pota auto-upgrade`), Claude 캐시 갱신과 수동 명령, runner ↔ lifecycle 버전 간 계약, CLI exit 규약 표(lifecycle 인자, `auto-upgrade`), 알림 예산, G1·G2 결과.
- 검사 대상 문장: README 8개가 `--hosts`, `auto-upgrade`, `POTA_AUTO_UPGRADE`, `~/.pota`을 담는지 `test/docs-package-hardening.test.mjs`에 케이스를 추가한다(기존 README 필수 문구 검사 패턴 `:89-115`).
- 수용 기준: `node scripts/pota.mjs memory check --root .` 오류 없음, `Summary:`를 바꿨다면 `pota memory index` 실행.
- focused: `node scripts/pota.mjs memory check --root .` / surface: `node --test test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/token-efficiency.test.mjs`

---

### 4. task 순서·경계 제안

1. **`pota-home-root` 분할(권장)**: 3a는 모든 lifecycle 테스트의 경로 상수와 schema를 바꾸는 넓고 기계적인 변경이고, 3b는 이중 lock·legacy 스택·이전 트랜잭션이라는 좁고 위험한 변경이다. 한 task에 두면 검증 예산(task당 2회) 안에서 실패 원인을 가르기 어렵고 리뷰 diff가 섞인다. 분할하지 않으려면 한 task 안에서 3a를 먼저 통과시킨 뒤 3b를 시작하는 checkpoint를 둔다.
2. **순서는 유지**: `claude-cache-refresh`가 먼저여야 대역의 캐시 모델과 `plugin update`가 뒤 task에서 쓰인다. `runtime-retention`은 canonical runtime(3a)이, `host-selection`은 schema 2의 `hosts`(3a)가, `auto-upgrade`는 `--auto`·유예·호스트 기록이 필요하다.
3. **write scope 보정**: Task 2에 `test/fixtures/fake-claude.mjs`, Task 4에 `scripts/pota-state.mjs`, Task 7에 `commands/`·`.agents/workflows/`의 lifecycle 4개 문서.
4. **`hooks/hooks.json`은 영향 표면에서 뺀다**: 수정하지 않는다.

---

### 5. 위험과 함정

구현자가 빠지기 쉬운 것:

- **runtime closure**: 새 스크립트는 진입점에서 정적 import로 잇는다. `scripts/pota-auto-upgrade.mjs`는 경로로 spawn되는 진입점이라 `runtimeEntryRelativePaths`(`scripts/pota-paths.mjs:136-143`)에 넣는다. 넣으면 `assertPackedLocatorRemovalMatrix`가 파일마다 doctor를 한 번 더 돌린다(느려질 뿐 계약은 같다). 동적 import는 closure에서 빠진다.
- **`package.json` `check`**: `node --check` 목록은 손으로 관리한다(44행). 새 모듈 4개(`pota-lifecycle-layout`, `pota-lifecycle-hosts`, `pota-update-state`, `pota-auto-upgrade`)를 넣는다. `files`는 `scripts/*.mjs` glob이라 그대로다.
- **spawn 함정**: `stdio: "ignore"`가 아니면 hook의 stdout pipe가 열려 호스트가 업그레이드 끝까지 기다린다. `error` 리스너가 없으면 spawn 실패가 uncaught exception이 되어 hook이 죽는다. cwd를 저장소로 두지 않는다.
- **runner는 실행 중 자기 runtime 디렉터리에서 파일을 늦게 읽지 않는다**: Codex 캐시 사본에서 시작됐다면 upgrade 중 그 디렉터리가 교체될 수 있다.
- **`shouldCopyPluginPath`**: stage 경로에 `.pota`·`node_modules`가 조상으로 들어간다. 필터는 마지막 segment만 본다(`…-staging.mjs:146-147`, 0.2.0 Windows 회귀의 수정 지점). 조상 segment 검사로 되돌리면 설치 내용이 통째로 빠진다. Task 6 테스트 4가 이 경로를 실제로 탄다.
- **npm이 상위 디렉터리를 prefix로 잡는다**: stage에 `package.json`을 먼저 쓰지 않으면 `~`나 `~/.pota`의 `package.json`·`node_modules`로 올라가 설치한다.
- **`adoptLegacy`에 새 staged 대상을 넘기면 안 된다**: legacy 레이아웃 대상 목록을 넘긴다.
- **journal allowlist**: 새 id·phase를 `validateTransactionJournal`과 `expectedManagedTarget` 양쪽에 넣지 않으면 중단 복구가 `unsafe entry`로 실패한다. 같은 journal에 같은 id가 두 번 나오면 거부되므로(`…-journal.mjs:122`) legacy 제거 대상은 `legacy-root-*` id를 쓴다.
- **prompt는 lock 밖에서**: lock을 쥔 채 입력을 기다리면 다른 lifecycle·자동 업그레이드가 60초 뒤 timeout된다.
- **정책 문구 미러**: lifecycle 문구를 고치면 `commands/`와 `.agents/workflows/`를 함께 고친다. `.claude/commands/`는 포인터라 정책 문구가 없다. 캡슐 문구는 SessionStart에만 추가하고 UPS에는 싣지 않는다. `skills/pota-plan/SKILL.md`는 여유 1바이트라 이번 작업에서 건드리지 않는다(`docs/memory/policy-surfaces.md` 예산).
- **`pota.mjs` usage는 8개 locale 모두** 고친다. `scripts/pota-lifecycle.mjs:173`의 usage(en·ko)도 따로 있다.
- **테스트 격리**: `POTA_HOME` 명시(3절 공통 규칙). Codex gate 테스트는 `CODEX_HOME`을 임시 경로로 준 `codex plugin list --json`만 호출한다.
- **Windows**: `npm.cmd`는 `shell: true`가 필요하고 인자에 공백 경로를 넣지 않는다. 임시 경로의 8.3 짧은 이름 때문에 경로 비교는 `realpath`로 한다(`docs/memory/release-process.md` "알려진 위험"). lock 동시성 테스트의 타이밍 여유가 작다.

남는 위험:

- **Codex 열린 세션**: G2가 실패하면 Codex 캐시는 단일 버전이라, upgrade 뒤 열린 Codex 세션의 hook은 지금처럼 실패한다. 자동 업그레이드로 이 일이 세션 도중에 일어날 수 있다. `Pota CLI:` 줄을 canonical로 돌려 CLI는 살린다. Codex가 `${PLUGIN_ROOT}`를 세션 시작 때 고정하는지 hook마다 다시 푸는지는 저장소 증거가 없다.
- **env 불일치**: 설치할 때와 hook 환경의 `CODEX_HOME`·`CLAUDE_HOME`이 다르면 자동 업그레이드가 allowlist 불일치로 거부된다(fail-closed, `failed` 알림). manifest에 홈 경로를 기록하는 것은 이번 범위에 넣지 않았다.
- **PATH**: GUI에서 뜬 호스트의 hook 환경에 `claude`·`npm`이 없을 수 있다. `claude`가 없으면 `manual` 알림, `npm`이 없으면 조용한 backoff다.
- **수동 다운그레이드**: 자동으로 0.9.0이 된 뒤 오래된 전역 `pota`(0.7.0)으로 `pota upgrade`를 치면 0.7.0으로 내려가고 다음 날 다시 올라간다. 막으려면 lifecycle이 `ownership.version > releaseVersion`일 때 `--allow-downgrade` 없이는 거부하면 된다(질문 2).
- **유예 runtime과 goal 상태 schema**: 옛 runtime의 hook이 새 버전이 쓴 `~/.pota/projects` 상태를 읽는다. 지금까지는 옛 세션이 통째로 깨져서 드러나지 않던 조합이다. goal 상태 schema를 바꾸는 릴리스는 이 점을 검토해야 한다.
- **교차 볼륨**: `CODEX_HOME`이 `~/.pota`과 다른 파일시스템이면 설치·이전이 EXDEV로 거부된다.
- **공급망**: 9절 참조. 자동 적용의 내재 위험이다.
- **의존성 0 전제**: `@comento/pota-harness`에 의존성이 생기면 결정 9의 6번 검사와 fake npm을 함께 고쳐야 한다.

---

### 6. 사용자에게 물어야 하는 것 (저장소 증거로 결정 불가, 3개)

1. **게시 후 대기 시간**: 새 버전이 npm에 올라오면 다음 확인 때 바로 적용한다(설계 기본값). 잘못 게시된 버전은 되돌릴 수 없으므로(`docs/memory/release-process.md` Policy) "게시 후 24시간이 지난 버전만 자동 적용"을 둘 수 있다. 두려면 `npm view @comento/pota-harness time --json` 조회 한 번이 추가된다.
2. **수동 다운그레이드 방지**: 설치본보다 낮은 버전의 CLI로 `install`·`upgrade`를 실행하면 거부하고 `--allow-downgrade`를 요구할지. 설계 기본값은 지금 동작 유지(내려감)이고, 5절에 위험으로 적었다.
3. **`~/.pota/install/` 하위 디렉터리**: lifecycle 관리 파일을 `~/.pota` 바로 아래가 아니라 `~/.pota/install/`에 둔다(goal 상태 `projects/`·설정·업데이트 상태와 분리). "`~/.pota`으로 옮긴다"는 결정을 이렇게 해석해도 되는지.

---

### 참고: 확인한 사실 요약

- `claude` 2.1.321: `plugin marketplace {add,list,remove,update}`, `plugin update <plugin> [-s scope] [--json] [-y]`, `plugin install`.
- `codex-cli` 0.164.0: `plugin {add,list,marketplace,remove}`, `plugin marketplace {add,list,upgrade,remove}`.
- 실제 Claude 등록: marketplace `source: directory`(installLocation 동일), 플러그인 `installPath` `~/.claude/plugins/cache/pota/pota/0.6.0`. Claude 캐시에는 옛 버전 디렉터리(0.2.9~0.6.0)가 남아 있다.
- published 0.6.0 커밋: `9e2e137962c06615c91fa07de9528577bf58cb13`.

#### Critical Files for Implementation

- /Users/wknam/workspace/pota-harness/scripts/pota-lifecycle.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-commands.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-integrity.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-transaction-journal.mjs
- /Users/wknam/workspace/pota-harness/scripts/pota-state.mjs

함께 볼 파일: /Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-claude.mjs, /Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-staging.mjs, /Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-legacy.mjs, /Users/wknam/workspace/pota-harness/scripts/pota-paths.mjs, /Users/wknam/workspace/pota-harness/test/fixtures/fake-claude.mjs, /Users/wknam/workspace/pota-harness/test/lifecycle-transaction.test.mjs, /Users/wknam/workspace/pota-harness/docs/plan/auto-upgrade-pota-home.md

## Evidence

- Tool readiness: `pota toolcheck --root .` → node OK, npm OK(2026-11-12).
- `claude-cache-refresh`(2026-11-12): worker `opus (claude-opus-5-5)`, effort `high`(host option). 테스트 5개 추가, 구현 전 실패 확인(테스트 2는 회귀 방지용이라 구현 전부터 통과). Tests: `node --test test/lifecycle.test.mjs` 19/19, `node --test test/installed-plugin.test.mjs test/packed-install.test.mjs` 6/6. 가정 A3 확인: 실제 `claude plugin list --json`의 pota 항목에 `version`이 있다.
- `pota-home-layout`(2026-11-12): worker `opus (claude-opus-5-5)`, effort `high`(host option). Tests: lifecycle 3개 파일 87개 중 80 통과·7 skip(legacy 전용, `pota-home-migration`에서 포팅), `installed-plugin`·`packed-install` 7/7, 전체 `node --test` 316개 중 309 통과·7 skip. **G1 통과**: `codex-cli 0.164.0`이 `CODEX_HOME` 밖의 `source_type="local"` marketplace를 받아들여 fallback을 적용하지 않았다. 설계와 다른 점: 이전 canonical runtime 제거용 journal id `previous-runtime` 추가(유예 task가 대체), `hosts`는 전체 집합만 유효(호스트 선택 task가 완화), legacy 표지가 있으면 `Legacy installation found; migration is not available in this build`로 거부(다음 task가 교체).
- `pota-home-migration`(2026-11-12): worker `opus (claude-opus-5-5)`, effort `high`(host option). 신규 테스트 18개와 포팅 7개, 구현 전 실패 확인. Tests: `lifecycle-transaction`·`lifecycle` 94/94(skip 0), `lifecycle-hardening`·`installed-plugin`·`packed-install` 16/16, 전체 `node --test` 332/332. receipt는 worker가 `goal verify`로 기록했고 완료 처리 시 freshness가 확인됐다. 설계와 다른 점: `previous-*` 특례를 `ownedBy` 일반 규칙으로 대체(불일치 메시지가 `Removal target does not match ownership manifest: <id>`로 바뀜), `unregister()`가 legacy 경로 등록도 제거, 거부 테스트 `a legacy-layout installation is refused…`는 이전 테스트로 대체.
- `runtime-retention`(2026-11-12): worker `opus (claude-opus-5-5)`, effort `high`(host option). 유예 기간 3일(`RETAINED_RUNTIME_GRACE_MS`), id별 상한 3개. Tests: `lifecycle-transaction` 87/87, `lifecycle`·`installed-plugin` 25/25, 전체 `node --test` 345/345. **G2 결과**: `codex-cli 0.164.0`은 캐시의 여러 버전 중 버전상 가장 높은 것을 보고한다(`0.9.0`+`0.10.0` → `0.10.0`, mtime 무관). 그래서 Codex 캐시도 `retained`의 `id: "codex-runtime"`으로 유예한다. 설계에 없던 보완: 릴리스보다 같거나 높은 Codex 캐시 사본은 유예하지 않고 제거(다운그레이드 시 Codex가 높은 사본을 로드하지 않게), journal id `retired-codex-runtime-<version>` 추가, `previous-runtime` id 제거. `Pota CLI:` 줄은 설치본에서 locator의 canonical 경로를 쓴다.
- `host-selection`(2026-11-12): worker `opus (claude-opus-5-5)`, effort `high`(host option). 테스트 22개 추가, 구현 전 18개 실패 확인(나머지는 단위·회귀 방지용). Tests: `lifecycle`·`lifecycle-hardening` 48/48, `cli-contract-hardening`·`packed-install` 18/18, 전체 `node --test` 367/367. 설계가 정하지 않아 worker가 정한 것: legacy 이전과 전체가 아닌 `--hosts`를 함께 주면 거부(먼저 전체 이전, 다음 실행에서 선택), doctor 첫 줄 `Hosts: <id 쉼표 목록>`, `--hosts` 중복 지정 거부, install·upgrade도 종료 시 빈 루트 정리.
- `auto-upgrade`(2026-11-12): worker `opus (claude-opus-5-5)`, effort `high`(host option). 테스트 24개 추가, 구현 전 20개 실패 확인. Tests: `auto-upgrade` 23/23, surface 7개 파일 97/97, 전체 `node --test` 392/392. 실제 npm registry 호출 없음(`POTA_NPM_CLI` 대역), 실제 `~/.pota`에는 `projects`만 있음. 설계와 다른 점: `pota auto-upgrade run`은 주기·backoff를 보지 않고 즉시 확인, 확인 기준 시각은 `max(lastCheckedAt, installedAt)`, hook도 `origin: "checkout"`이면 spawn하지 않음, `--auto`와 `--hosts` 동시 지정 거부, 깨진 `config.json`은 `on`/`off`가 덮어쓰지 않고 exit 1, `node_modules`의 `.`으로 시작하는 항목은 패키지로 세지 않음. runtime 진입점이 7개가 됐다(`pota-auto-upgrade.mjs`).
- 문서 task가 반영할 사실: CLI `pota auto-upgrade status|on|off|run`(exit 0/1/2, JSON 출력), 끄기 `POTA_AUTO_UPGRADE=0|false|off|no` 또는 `<POTA_HOME>/config.json`의 `"autoUpgrade": false`(읽을 수 없으면 끔), 파일 `<POTA_HOME>/update/{state.json,notice.json,last-run.log,update.lock,stage/}`, 24시간 주기(설치·업그레이드 직후 24시간은 확인 안 함), 알림 3종과 160자 상한, 버전 간 계약 3가지(`pota-lifecycle.mjs upgrade --auto` 호출 형태, `install/lifecycle.json`의 `version`, exit code 의미).
- `docs-memory`(2026-11-12): worker `opus (claude-opus-5-5)`, effort `high`(host option). README 8개, `commands/`·`.agents/workflows/`의 lifecycle 문서 8개, `docs/memory/{lifecycle-install,hook-context,release-process}.md`, `MEMORY.md` 갱신. 범위 밖 한 줄 수정: `docs/memory/policy-surfaces.md`의 README 필수 문구 목록과 출처 줄 범위. Tests: `memory check` ok, `contract-parity`·`docs-package-hardening`·`token-efficiency` 32/32. 남긴 것: `commands/pota-uninstall.md:11`과 ja·zh·es·fr·de·pt README의 uninstall 서술이 "수정된 항목만 보존"으로 적혀 있으나 실제는 uninstall 전체 거부(이번 작업 이전부터의 불일치, `verify`에서 처리 여부 결정).
- 독립 리뷰(2026-11-12, `opus (claude-opus-5-5)`, effort `xhigh`, 읽기 전용): 치명 0, 높음 1, 중간 4, 낮음 6. 관련 테스트 8개 파일 통과를 확인했고 H1·M1·M2·M4는 격리 HOME에서 재현했다. `review-fixes` task를 `goal replan`으로 추가해 수정한다.
  - H1: journal 검사가 `runtime`·`codex-runtime` 경로를 실행 중인 CLI의 `releaseVersion` 기준으로만 허용해, 설치본 버전과 CLI 버전이 다르면 rollback·중단 복구가 `unsafe entry`로 실패한다(legacy uninstall, 중단된 legacy journal, 버전이 다른 uninstall).
  - M1: 설치본보다 낮은 버전의 CLI로 `upgrade`하면 조용히 다운그레이드되고 자동 업그레이드와 반복된다. `doctor`는 CLI 버전 기준으로 검사해 정상 설치본에 FAIL을 낸다. → 사용자에게 열어 둔 질문(다운그레이드 방지)을 재현된 결함으로 보고 거부 + `--allow-downgrade`로 정한다.
  - M2: runner의 `finally` stage 삭제가 실패하면 state가 기록되지 않아 backoff 없이 세션마다 반복된다.
  - M3: `upgrade --auto`의 exit≠0이 원인과 무관하게 모두 `manual` 알림이 된다(foreign marketplace, commit 뒤 다른 오류 포함).
  - M4: 유예 runtime이 외부에서 지워지면 upgrade·uninstall이 영구히 막힌다.
  - L1 uninstall과 runner 경합 시 `update/` 재생성, L2 사용자가 끈 Claude 플러그인을 다시 켬(수정 안 함, 기존 동작), L3 hook 환경의 호스트 env 의존(수정 안 함, 문서화), L4 claude CLI 없이 이전했을 때 수동 명령에 `marketplace remove` 누락, L5 문서 불일치 2건, L6 버전이 다른 경로의 테스트 공백.
- `review-fixes`(2026-11-12): worker `opus (claude-opus-5-5)`, effort `high`(host option). H1(journal의 `runtime`·`codex-runtime`을 parent의 `<version>` 직계 자식으로 구조 검사), M1(설치본보다 낮은 CLI의 install/upgrade 거부와 `--allow-downgrade`, doctor의 버전 차이 줄과 manifest 버전 기준 검사), M2(stage 삭제 실패를 삼키고 state를 항상 기록), M3(`upgrade --auto`의 exit 3 = manual, foreign marketplace는 exit 0, commit 뒤 오류는 `failed` 1회), M4(없어진 `retained` 항목은 제거된 것으로 처리), L1, L4, L5와 문서를 반영. 버전이 다른 CLI 테스트는 작업 트리 복사본의 버전만 올리는 helper `newerCli()`로 작성. Tests: lifecycle 3개 파일과 `auto-upgrade` 175/175, surface 6개 파일 56/56, `memory check` ok, 전체 `node --test` 409/409. 남긴 한계: `compareVersions`가 prerelease를 같은 release로 취급해 같은 core 버전의 prerelease CLI로 내려가는 것은 막지 못한다. L2(자동 업그레이드가 사용자가 끈 Claude 플러그인을 다시 켬)는 기존 수동 upgrade와 같은 동작이라 수정하지 않았다.
- `verify`(2026-11-12): 독립 리뷰 `opus (claude-opus-5-5)`, effort `xhigh`(host option). main이 `npm run check`(exit 0)와 `node scripts/pota.mjs memory check --root .`(ok)를 `goal verify`로 기록.
- Goal final review evidence record: `goal finish -- npm pack --dry-run`(prepack이 `npm run check` 실행) exit 0, 2026-11-12. goal `goal-08e920e6-a4e2-42f4-8668-718751c2081f` completed.
- Memory promotion: `docs/memory/lifecycle-install.md`(레이아웃, 이전, 호스트 선택, 유예, 자동 업그레이드, 버전 간 계약, G1·G2), `docs/memory/hook-context.md`(업데이트 알림과 160자 예산), `docs/memory/release-process.md`(로컬 업그레이드 절차), `docs/memory/policy-surfaces.md`(README 필수 문구).
- 격리 확인: 모든 검증 뒤 실제 `~/.pota`에는 `projects`만 있다. 저장소 버전은 0.6.0 그대로이고 커밋·푸시·게시는 하지 않았다.
- 범위 밖으로 남긴 것: 버전 올림과 릴리스(별도 계획), 실제 설치본의 upgrade(이전) 실행, 실제 npm registry·Windows에서의 자동 업그레이드 확인.

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
