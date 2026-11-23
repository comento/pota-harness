# Domain: lifecycle-install

Summary: 호스트별 플러그인 배치·hook 파일, runtime 위치 규칙, 1.x npm 설치본 이전(상태·사유·fail-closed), 한계, CLI exit 규약. 설치·CLI를 바꿀 때 읽는다.

## Scope

2.0.0부터의 플러그인 설치 구조와 1.x npm 설치본 제거. 대상: 저장소 루트의 manifest·marketplace·hook 파일, `scripts/pota-legacy-migration.mjs`(이전), `scripts/pota-doctor.mjs`, `scripts/pota.mjs`의 명령 분기, `scripts/pota-paths.mjs`(`potaHome`·`installRoot`·`installManifestPath`만 남음), `scripts/pota-lifecycle-lock.mjs`, `scripts/pota-comment-checker.mjs`의 내려받기, `scripts/pota-cleanup.mjs`의 CLI. hook 캡슐과 알림 예산은 `hook-context.md`, 릴리스는 `release-process.md`, 설계·결정과 미확인 목록은 `docs/plan/plugin-native-install.md`(§13이 §1~12보다 우선). 1.x의 lifecycle 트랜잭션·호스트 선택·runtime 유예·자동 업그레이드는 2.0.0에서 코드째 지웠다(1.x 기록은 `docs/plan/auto-upgrade-pota-home.md`).

## Facts

### 플러그인 배치

- 저장소 루트가 세 호스트의 플러그인 루트다. marketplace 이름 `pota-harness`, 플러그인 이름 `pota`, 플러그인 id `pota@pota-harness`(1.x의 `pota`/`pota@pota`와 겹치지 않게 고정). 출처: `test/plugin-manifests.test.mjs` "both marketplaces are pota-harness and list the repository root as the plugin pota".
- 파일과 읽는 호스트:

| 파일 | 호스트 | 내용 |
| --- | --- | --- |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Claude Code | manifest(`agents: ["./claude/agents/explorer.md", "./claude/agents/worker.md"]`, `types: "./types/index.d.ts"`), marketplace(`source: "./"`, 버전 없음) |
| `hooks/hooks.json` | Claude Code | command hook 5개 + mod `modules: ["./register.tsx"]` |
| `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json` | Codex | manifest(`skills: "./skills/"`, `hooks: "./hooks/codex.json"`, `interface`), marketplace(`source: {source: "url", url: "./"}`) |
| `hooks/codex.json` | Codex | `hooks/hooks.json`에서 `modules`를 빼고 `${CLAUDE_PLUGIN_ROOT}`→`${PLUGIN_ROOT}`, 끝 토큰 `claude`→`codex` |
| 루트 `plugin.json`, 루트 `hooks.json` | Antigravity CLI | manifest(`$schema` antigravity.google, `logo: "assets/logo.svg"`), hook 4종(상대 경로 `node ./scripts/pota-state-antigravity.mjs <event>`) |
| 루트 `mcp_config.json`, `scripts/pota-dag-{mcp,mcp-core,app-html}.mjs` | Antigravity MCP App | MCP 서버 `pota-dag`(`node ${PLUGIN_ROOT}/scripts/pota-dag-mcp.mjs`), `ui://pota-dag/app.html` 단일 HTML UI(`open_pota_dag`·`pota_dag_state`, 진입점 `aux_pane`·`global`) |
| `hooks/register.tsx`, `hooks/dag-*.mjs`, `types/index.d.ts` | Claude Code | DAG 패널 mod |
| `claude/agents/{explorer,worker}.md` | Claude Code | agent. 루트 `agents/`에 두지 않는 이유: Antigravity도 루트 `agents/`를 읽는데 frontmatter `tools:`가 Claude 도구 이름이다 |
| `skills/pota-{memory,plan,work,review}/` | 세 호스트 | skill. 호출 이름은 Claude `/pota:pota-plan`, Codex `$pota-plan`, Antigravity `/pota-plan` |

  출처: 각 파일, `test/plugin-manifests.test.mjs` "the ten plugin JSON files parse and the four version surfaces agree", "Claude and Codex hooks run pota-state.mjs with the event and host tokens, and Codex reads only its own file", "Antigravity reads the root plugin.json and root hooks.json with plugin-root relative commands", "Antigravity mcp_config.json registers pota-dag and all DAG MCP scripts are tracked and syntax-checked".
- Codex용 hook 파일을 따로 두는 이유: Codex의 `HooksFile`은 `deny_unknown_fields`(키 `description`·`hooks`만)라 `modules`가 든 `hooks/hooks.json`을 파싱하지 못하고, manifest의 `hooks` 문자열 경로는 기본 탐색을 대체한다(openai/codex 소스 기준, 실행 미확인). `hooks/codex.json`의 최상위 키는 테스트가 고정한다.
- Antigravity manifest는 루트 `plugin.json` 하나다(`.antigravity-plugin/`은 두지 않는다). `agy` 1.0.7은 `.antigravity-plugin/plugin.json`만 있는 디렉터리를 거부했고, 1.5.14의 `agy plugin validate`는 루트 `plugin.json`·`hooks.json`을 통과시키며 `hooks/hooks.json`에는 "never loaded" 경고만 낸다. 그래서 validate는 `--strict` 없이 쓴다. 출처: 계획 §1.4, §13 "`agy` 1.5.14 확인".
- 지운 표면: `commands/`, `agents/`, `.claude/commands/`, `.claude/agents/`, `.agents/workflows/`, `claude-mod/`, `scripts/pota`(sh wrapper), lifecycle·자동 업그레이드 스크립트 13개와 `pota-update-state.mjs`. 추적 파일에 1.x의 runtime locator placeholder와 locator 파일 이름이 없어야 한다(이 검사는 `docs/plan/`·`test/`만 제외한다). 출처: `test/plugin-manifests.test.mjs` "the installer-era command, workflow, mirror, and mod folders are gone", "no shipped file carries the runtime locator".
- 설치 위치(호스트 소유, Pota는 저장하지 않는다): Claude `~/.claude/plugins/cache/pota-harness/pota/<version>/`(버전마다 새 디렉터리, 문서 기준), Antigravity `~/.gemini/config/plugins/pota`(문서 기준, 재설치가 디렉터리를 통째로 교체), Codex는 자기 plugin cache(`$CODEX_HOME/plugins/cache/pota-harness/pota/<version>/`로 예상, 미확인).
- 설치·업데이트·제거 명령은 README 8개의 `## Install`이 정본이다. Claude `claude plugin marketplace add|update|remove`, `claude plugin install|update|uninstall pota@pota-harness`(2.1.327 `--help`로 확인, 서드파티 marketplace 자동 업데이트는 기본 꺼짐, 업데이트는 세션 재시작 뒤 적용). Codex `codex plugin marketplace add|upgrade`, 설치·제거는 TUI `/plugins`(문서·소스 기준, 미실행). Antigravity `agy plugin install <URL>`(재실행이 업데이트), `agy plugin uninstall pota`(1.5.14 `--help`로 확인).

### hook 배선과 runtime 위치

- Claude·Codex hook 명령은 `node "${CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT}/scripts/pota-state.mjs" <event> <claude|codex>`다. `pota-state.mjs`는 셋째 인자가 `claude|codex`가 아니면 host를 `unknown`으로 보고 1.x 이전과 comment-checker 내려받기를 하지 않는다(캡슐은 같다). 출처: `scripts/pota-state.mjs` `HOOK_HOSTS`, `test/session-start-migration.test.mjs` "the hook CLI names the pota.mjs beside it and starts nothing without a known host argument".
- Antigravity는 어댑터 `scripts/pota-state-antigravity.mjs`가 `runStateResult`를 같은 프로세스에서 부른다(host `antigravity`, `autoFetch: true`). `SessionStart`→session-start, `PreInvocation`(`invocationNum === 0`)→user-prompt-submit, `PostToolUse`(편집 도구 3개를 `Write`/`Edit`/`MultiEdit` 모양으로 바꿈)→결과를 세션 파일 pending(최대 8개)에 넣고 다음 `PreInvocation`에 주입, `Stop`(`terminationReason === "model_stop"`만)→`{"decision":"continue","reason"}`. 막은 Stop의 프롬프트 해시(`stopBlockedFor`)는 `invocationNum === 0`(새 turn)과 허용된 Stop에서 지운다(같은 문구의 다음 turn을 이어짐으로 보지 않게). SubagentStop 대응은 없다. `workspacePaths[0]`이 없으면 모든 이벤트가 `{}`다(hook cwd가 플러그인 폴더라 `process.cwd()`로 대신하면 Pota 자신의 `MEMORY.md`·`PLAN.md`를 읽는다). 실패는 모두 `{}`와 exit 0. 세션 파일은 `<POTA_HOME>/hosts/antigravity/<sha256(conversationId) 앞 16자>.json`, 14일 지난 파일은 쓸 때 지운다. 출처: `test/antigravity-hooks.test.mjs`.
- Antigravity DAG MCP App(`mcp_config.json`, `scripts/pota-dag-mcp.mjs`, `scripts/pota-dag-mcp-core.mjs`, `scripts/pota-dag-app-html.mjs`)은 `hooks/dag-*.mjs`와 `readGoalState`·`goalHistoryStats`를 재사용해 `ui://pota-dag/app.html` UI를 제공한다. `pota-state-antigravity.mjs`는 `SessionStart`·`PreInvocation(invocationNum === 0)` 시 최근 워크스페이스를 `<POTA_HOME>/hosts/antigravity-dag/workspaces.json`에 비간섭 기록한다(`hosts/antigravity/` 세션 파일 수 검사와 분리, symlink 거부, 최대 16개·30일 보관·30초 스로틀). 워크스페이스 해석 우선순위는 명시 `root` → `workspaces.json`(live goal 우선) → `HARNESS_REPO_ROOT` → `null`(`process.cwd()`/플러그인 루트 폴백 금지)이다. 출처: `test/antigravity-dag-mcp.test.mjs`.
- runtime 위치는 저장하지 않는다. `Pota CLI:` 줄은 hook이 실행될 때마다 `fileURLToPath(new URL("./pota.mjs", import.meta.url))`로 계산한다(`scripts/pota-state.mjs` `cliPrefixLine`). skill은 `pluginRoot`를 "session-start `Pota CLI:` 줄의 `scripts` 디렉터리의 상위"로 정하고, 그 줄이 없을 때만 `SKILL.md`의 `../..`를 쓰며 사용자에게 hook이 꺼져 있다고 알린다(`skills/pota-plan/SKILL.md` 16행, `skills/pota-work/SKILL.md` 18행). mod `findCli()`는 `${$.plugin.root}/scripts/pota.mjs` 한 곳만 본다(`hooks/register.tsx`). Claude 본문 치환(`${CLAUDE_PLUGIN_ROOT}`)과 `bin/` PATH는 호스트마다 달라서 쓰지 않는다.
- 세션 중 업데이트: Claude는 새 버전을 새 디렉터리에 두므로 열린 세션은 옛 경로로 동작한다. 옛 경로가 사라지면 `Cannot find module`이 나고 `skills/pota-work/recovery.md` 30행대로 세션을 다시 시작한다.
- Pota는 자기 플러그인 루트 안에 쓰지 않는다. 쓰는 곳은 `<POTA_HOME>`뿐이다. Codex의 hook 신뢰는 플러그인 내용 해시에 묶이므로(소스 기준) 루트에 쓰면 승인이 풀린다. 이 규칙을 정적으로 검사하는 테스트는 없다. `hooks/codex.json`의 선언(명령, timeout, `statusMessage`, matcher, 순서)은 선언 해시만 보는 옛 Codex를 위해 릴리스 사이에 바꾸지 않고, 바꾸면 릴리스 노트에 재승인을 적는다. 승인 건너뛰기 플래그는 안내하지 않는다. 출처: 계획 §7.

### `POTA_HOME`

- 루트는 `POTA_HOME ?? ~/.pota`. 2.0.0이 쓰는 곳: `projects/`(goal 상태), `config.json`(`commentChecker`, `modelCeiling`. 남아 있는 `autoUpgrade`는 무시), `tools/comment-checker/`, `migration/`, `hosts/antigravity/`, `hosts/antigravity-dag/`(`workspaces.json`). `install/`·`update/`는 1.x가 남긴 것이고 이전이 지운다. `install/lifecycle.lock`은 이전 runner와 1.x 설치 프로그램이 같은 lock(`createLifecycleLock`, 파일 이름·오류 문구 `Timed out waiting for Pota lifecycle lock` 그대로)으로 서로를 배제하려고 남긴 경로다. 출처: `scripts/pota-paths.mjs`, `scripts/pota-lifecycle-lock.mjs`, `test/lifecycle-lock.test.mjs`.

### 1.x 설치본 이전 (`scripts/pota-legacy-migration.mjs`)

- 감지(SessionStart 안, 동기, 오류는 모두 삼켜 캡슐·exit code를 바꾸지 않음): `POTA_LEGACY_MIGRATION=0|false|off|no`면 끝. host가 `claude|codex|antigravity`가 아니면 끝. `lstat(<POTA_HOME>/install/lifecycle.json)`이 있으면 실행 조건을 본다. 조건 키는 `sha256([manifest mtimeMs:size, host, 경로 env 9개(HOME, USERPROFILE, POTA_HOME, CODEX_HOME, CODEX_CONFIG_PATH, CLAUDE_HOME, CLAUDE_CONFIG_DIR, ANTIGRAVITY_HOME, ANTIGRAVITY_CLI_HOME)])` 앞 32자다. 키가 바뀌면 바로, 보고서가 없거나 `deferred`면 마지막 spawn 10분 뒤, `blocked`면 24시간 뒤 다시 실행한다. 실행은 `spawn(node, [<pluginRoot>/scripts/pota-legacy-migration.mjs, "run", "--host", host], {detached, stdio: "ignore", windowsHide, env})` + `error` 리스너 + `unref`. 표시 파일로 "이미 이전함"을 기억하지 않는다(남은 전역 npm `pota`로 다시 설치될 수 있으므로 매 SessionStart가 `lstat` 한 번을 한다). 출처: `sessionStartMigration`, `runDecision`, `test/legacy-migration.test.mjs` "SessionStart starts one detached runner per manifest, host, and environment and stays quiet otherwise".
- 호스트 단위 제거(R1): runner는 `--host`의 phase 대상만 지운다(Claude: `claude` phase와 등록 해제, Codex: `codex` phase·보존된 Codex runtime·`codex-config`, Antigravity: `antigravity` phase). `core` runtime, 보존된 runtime, `update/`의 알려진 파일(`state.json`, `notice.json`, `last-run.log`, `plugin-notice.json`, `stage/`), manifest는 manifest `hosts`의 모든 호스트 몫이 없어졌을 때만 지우고, manifest가 맨 마지막이며 읽은 뒤 내용이 같을 때만 지운다. manifest는 고치지 않는다(지운 대상은 다음 실행에서 `missing`). 출처: `test/legacy-migration.test.mjs` "a host run removes only that host's part; the runtime and manifest go with the last host".
- 소유 확인: manifest는 `POTA_HOME`부터 symlink 없음, 일반 파일, 1MB 이하, JSON, `schemaVersion === 2`, 키 집합 정확, `plugin === "pota"`, semver `version`, UUID v4 `transactionId`, `origin ∈ {checkout, package}`, 정규 순서의 `hosts`. 각 `targets[i]`의 `(id, phase, path, type)`이 지금 env로 다시 계산한 1.4.0 허용 목록과 같아야 하고, `retained[]`는 `runtime`·`codex-runtime`과 그 버전의 경로여야 한다. 대상 집합이 완전한지는 보지 않는다(1.3.x manifest와 중단된 제거를 받기 위해). 실표본 `test/fixtures/legacy-lifecycle-1.4.0.json`. 출처: `validateManifest`, `expectedTarget`, `test/legacy-migration.test.mjs` "the manifest the real 1.4.0 installer wrote passes the ownership checks".
- 삭제: lock(`<POTA_HOME>/install/lifecycle.lock`, `timeoutMs: 0`) 안에서 manifest를 다시 읽고 전부 다시 검사한다. 대상은 `<path>.pota-checking-<txid>`로 rename → digest 재계산(1.4.0 `targetDigest`와 같은 알고리즘: 파일은 바이트, 트리는 정렬된 일반 파일의 `<posix 상대 경로>\0<bytes>\0`, symlink·특수 파일은 불일치) → 같으면 `.pota-removing-<txid>`로 rename 뒤 삭제, 다르면 원래 이름으로 되돌리고 `modified`. 다음 실행은 남은 `removing` 사본을 digest가 같을 때만 지우고(다르면 남기고 보고), `checking` 사본은 원래 이름으로 되돌린다. lock 해제 뒤 빈 디렉터리만 `rmdir`(install/transactions, install/codex 하위, install/runtime, install, update, `~/.claude/pota`, 두 Antigravity `pota/`, Codex `cache/pota/pota`, `cache/pota`). 전체 제한 120초. 출처: `removeOwned`, `pruneEmptyDirectories`, `test/legacy-migration.test.mjs` "a run that dies after any step is finished by the next run, including renamed copies", "a tree changed after it was renamed aside is restored under its name and kept", "running twice gives the same result".
- 등록 해제가 파일 제거의 전제다(R2). 실패하면 그 호스트의 파일·core·manifest를 남기고 `blocked: host-unregister-failed`와 수동 명령을 보고한다.
  - Claude(manifest에 `claude-plugin` 대상이 있을 때): `claude plugin marketplace list --json`에서 이름 `pota`이고 경로가 `<POTA_HOME>/install/claude`로 풀리는 항목이 있을 때만, `plugin list --json`에 user scope `pota@pota`가 있으면 `claude plugin uninstall pota@pota --scope user`, 그리고 `claude plugin marketplace remove pota`. 다른 경로의 `pota` marketplace는 남의 것으로 보고 "해제할 것 없음"이다. 호출당 30초. `POTA_CLAUDE_CLI`로 CLI를 바꾸고(`none`이면 실패), `CLAUDE_HOME`이 있으면 자식에 `CLAUDE_CONFIG_DIR=CLAUDE_HOME`을 준다. Claude의 JSON 파일은 직접 고치지 않는다. 출처: `unregisterClaude`, `test/legacy-migration.test.mjs` "Claude Code: only Pota's own marketplace is unregistered, and a failed unregistration keeps the Claude files".
  - Codex(`codex-config` 대상이 있을 때, digest는 보지 않음, R3): `CODEX_CONFIG_PATH ?? $CODEX_HOME/config.toml`에서 정확한 이름의 `[marketplaces.pota]`, `[plugins."pota@pota"]`, `[hooks.state."pota@pota:…"]`만 뺀다. `[marketplaces.pota]`의 `source`가 `<POTA_HOME>/install/codex`가 아니면 남의 것으로 보고 건드리지 않는다. `pota@pota-harness` 구획과 사용자 구획·주석·줄 끝은 바이트 그대로다.
- Codex config fail-closed 규칙: 헤더는 여러 줄 문자열 밖에서만 인식하고 따옴표 키 안의 `[`·`]`를 허용한다. 주석·한 줄 문자열 안의 `"""`/`'''`는 여러 줄 문자열을 열지 않고 줄 끝 `\r`은 떼고 본다. 다음은 모두 `failed`(→`host-unregister-failed`): Pota 헤더처럼 보이는 줄(느슨한 정규식 `POTA_HEADER_HINT`)이 인식된 Pota 구획 헤더가 아님, `[marketplaces.pota]`의 `source`를 읽을 수 없음, 다시 쓴 결과에서 Pota 것이 아닌 헤더 줄이 모두 순서대로 남지 않음, config가 symlink거나 일반 파일이 아님, 읽기 오류. `codexConfigState`의 `invalid`는 "없음"으로 보지 않는다. 쓰기는 같은 디렉터리 `.<name>.pota-<uuid>.tmp`(원본 권한 복사, 알 수 없으면 `0o600`) → 다시 읽어 바뀌었으면 포기(`deferred: config-changed`) → rename. 백업은 만들지 않는다(비밀값). 출처: `configOwnership`, `splitSections`, `otherHeadersKept`, `test/legacy-migration.test.mjs` "Codex config: only pota@pota sections owned by the legacy marketplace are removed", "Codex config variants: Pota sections go, every other section stays, and anything unclear fails closed".
- symlink(R11 ③): 등록 해제 전에 그 호스트의 모든 대상(과 `.pota-checking-*`·`.pota-removing-*` 사본)의 상위 경로를 검사해 하나라도 symlink 아래면 `blocked: symlinked-path`로 등록 해제를 포함해 아무것도 하지 않고, 손으로 지울 경로를 `manual`에 적는다. 대상 자체가 symlink면 digest 불일치라 `modified`로 남는다. 출처: `symlinkedTargets`, `test/legacy-migration.test.mjs` "symlinks: a host below a symlinked directory is left alone, a symlinked target or tree entry is kept".
- 보고서 상태와 사유(`<POTA_HOME>/migration/report.json`, 호스트별, 지우지 않음):
  - `completed`: 지웠거나 등록을 해제함. `unchanged`: 할 일 없음.
  - `blocked`: `manifest-invalid`, `manifest-unsupported-schema`(정수 schema지만 2가 아님), `target-outside-allowlist`, `transaction-pending`(`install/transaction.json` 있음), `symlinked-path`, `host-unregister-failed`.
  - `deferred`: `lock-busy`, `update-running`(`<POTA_HOME>/update/update.lock`을 살아 있는 프로세스나 다른 hostname이 쥠, 형식이 틀린 lock은 10분 이내), `time-limit`, `config-changed`, `error`.
  - `unchanged`와 `deferred`(`lock-busy`·`error`)는 같은 키의 `completed`·`blocked` 보고서를 덮지 않는다.
  - `pota migrate status`·`run --dry-run`의 대상 상태는 `verified`, `missing`, `modified`, `leftover`(`.pota-*-<txid>` 사본 있음), `symlinked`다.
- 알림(캡슐 맨 끝 `Pota CLI:` 줄 뒤 + `systemMessage`, en·ko 각 240자 이하): runner를 띄운 첫 세션의 "제거 중", 다음 세션의 "제거함"(보고서 id당 한 번, 남은 호스트 이름 포함), `blocked`(manifest가 남아 있을 때만, 7일에 한 번), `symlinked-path` 전용 문구. `blocked`는 보고서의 `remainingHosts`가 `manifestHosts`(manifest의 `hosts`)와 같을 때, 곧 어느 호스트 몫도 아직 지워지지 않았을 때만 `npx @comento/pota-harness@1.5.0 uninstall`을 안내한다. manifest를 고쳐 쓰지 않으므로 한 호스트 몫이라도 지워진 뒤의 1.x uninstall은 "Refusing to uninstall modified managed artifacts"로 거부되기 때문이다. 그 밖(지워진 몫이 있거나 manifest를 읽지 못해 `manifestHosts`가 `null`)에는 doctor가 보여 주는 수동 항목을 정리한 뒤 `node "<pluginRoot>/scripts/pota.mjs" migrate run --host <h>`를 실행하라는 `blockedRerun` 문구다. 그 밖의 알림의 자세히는 `node "<pluginRoot>/scripts/pota.mjs" doctor`다. 한 세션만 보여 주도록 `migration/notice-<host>.claim.<이전 notice 파일 해시>`를 배타적 생성(`wx`)한다. 실행 조건은 `migration/state.json`. 출처: `MESSAGES`, `claimReportNotice`, `test/legacy-migration.test.mjs` "notice lines stay within 240 characters in English and Korean", `test/session-start-migration.test.mjs`.
- 지우지 않는 것: `projects/`, `config.json`, `tools/comment-checker/`, manifest에 없는 파일, `modified` 대상, 사용자의 `~/.claude/commands`·`agents`·`skills`·`workflows` 디렉터리 자체, Claude의 플러그인 저장소 파일, 전역 npm 패키지, 새 플러그인의 Codex 구획. 1.x Antigravity 설치본은 hook을 등록하지 않았으므로 `~/.gemini/config/hooks.json`은 건드릴 것이 없다. manifest가 없는 옛 배치(1.3 이전)는 소유를 증명할 수 없어 건드리지 않는다.
- CLI `pota migrate status|run [--host <h>] [--all] [--dry-run] [--json]`: `run`은 `--host` 또는 `--all`이 필수(`--all`은 플러그인이 없는 호스트 몫도 지운다), `--dry-run`은 `run`에서만 받고 쓰지 않으며 호스트 CLI도 실행하지 않는다. 출처: `parseCliArgs`, `test/legacy-migration.test.mjs` "the CLI: --dry-run writes nothing, run needs --host or --all, and run --host removes that host".

### `pota doctor` (`scripts/pota-doctor.mjs`)

- 읽기 전용, 라벨 영문 고정, `--json` 지원. 검사: `node`(18 이상), `potaHome`(쓰기 가능), `version surfaces`(이 사본의 4개가 같음. 없는 표면은 나열만 하고 불일치·잘못된 값만 실패, `package.json`은 필수), `required files`(`scripts/pota.mjs`, `scripts/pota-state.mjs`, skill 4개의 `SKILL.md`, `templates/`), `legacy install`(`none`(+남은 1.x 디렉터리), `present <version> (hosts: …)`, `blocked <reason>`), `legacy migration`(호스트별 마지막 보고서, `kept:`·`manual:` 줄). 마지막 줄은 판정에 넣지 않는 `comment-checker: …`. 다른 호스트 사본의 버전은 보지 않는다. 출처: `test/doctor.test.mjs`.

### comment-checker 바이너리

- 고정 release `code-yeongyu/go-claude-code-comment-checker` v0.8.2(MIT), 플랫폼 5개의 SHA256을 `scripts/pota-comment-checker.mjs` `RELEASE_ASSETS`에 고정한다. 버전을 올릴 때는 release `checksums.txt` 값으로 표 전체를 바꾼다.
- 내려받기는 hook 진입점이 `commentChecker: { autoFetch: true }`를 넘겼을 때만 한다: `pota-state.mjs` CLI 진입부(host가 `claude|codex`일 때, R12)와 Antigravity 어댑터의 session-start. SessionStart, 그리고 바이너리가 없을 때의 Claude·Codex PostToolUse가 분리 프로세스(`<pluginRoot>/scripts/pota-comment-checker.mjs fetch`, cwd `POTA_HOME`. 1.x를 쓴 적 없는 홈에는 없으므로 spawn 전에 만든다)를 띄운다. 라이브러리 기본값은 내려받지 않으므로 in-process 테스트는 네트워크를 쓰지 않는다. 출처: `startFetchWhenNeeded`, `test/comment-checker.test.mjs`.
- 위치 `<POTA_HOME>/tools/comment-checker/{v<version>/comment-checker[.exe], state.json, fetch.lock}`. `fetch`: 내장 `fetch`(120초, 32 MiB 상한) → SHA256 비교 → 임시 stage에 OS `tar` 해제 → 최상위 일반 파일 확인·755 → rename. 실패하면 backoff(1시간부터 2배, 최대 24시간). lock은 `createLifecycleLock`(`timeoutMs: 1`, 잡혀 있으면 `locked`), mtime 10분이 넘은 lock은 버린다. Windows는 `%SystemRoot%\System32\tar.exe`를 직접 쓴다.
- 끄기: `POTA_COMMENT_CHECKER=0|false|off|no` 또는 `config.json` `"commentChecker": false`. 읽을 수 없는 config는 켜짐으로 본다. 호스트 인자를 주고 hook을 spawn하는 테스트는 env에 `POTA_COMMENT_CHECKER: "0"`을 둔다.

### CLI help·exit 규약

| 표면 | 0 | 1 | 2 |
| --- | --- | --- | --- |
| root, `init`, `memory`, `plan` | 성공, help, version | `memory`/`plan` check 오류 | 사용법 오류 (`Pota error: …`) |
| `cleanup` | 성공, help, version | 실행 오류 (`Pota cleanup error: …` 한 줄) | 사용법 오류 |
| `goal`, `task` | 성공, help, version, 인자 없음 | 모든 오류 (`Pota goal error: …`) | 사용 안 함 |
| `toolcheck` | 성공, help, version | 도구 누락·설치 거부 | 사용법 오류 |
| `doctor` | 모든 검사 통과, help | 검사 실패 | 사용법 오류 (`Pota doctor error: …`) |
| `migrate` | 성공, `none`, `deferred`, help | `blocked`, 실행 오류 (`Pota migrate error: …`) | 사용법 오류 |
| `install`·`upgrade`·`uninstall`·`auto-upgrade` | — | — | 항상. stderr 한 줄 `pota <command> was removed in 2.0.0. Install or update Pota with your host's plugin command: https://github.com/comento/pota-harness#install` |

- root usage는 8 locale 모두 머리말 + `pota doctor|migrate|cleanup|init|memory|plan|work|review|toolcheck|goal|task`이다. 제거된 명령의 링크가 `#install`이므로 영문 README의 `## Install` 제목을 바꾸지 않는다(`test/readme-plugin-install.test.mjs`가 고정). 출처: `scripts/pota.mjs` `REMOVED_COMMANDS`·`messages`, `test/cli-contract-hardening.test.mjs` "removed npm installer commands print one pointer to the host plugin commands and exit 2", "every locale's usage names the 2.0.0 command list".
- `init`은 `--root` 외 인자를 받으면 아무것도 쓰지 않고 exit 2다. `init --help`는 파일을 만들지 않는다. `goal`/`task`는 `--` 앞의 `--help`를 상태를 읽기 전에 처리하고 `--` 뒤의 `--help`는 `goal verify`로 넘긴다. `cleanup --check --yes`는 사용법 오류다. 내부 hook 스크립트 `node scripts/pota-state.mjs init --help`는 인자를 무시하고 초기화한다. 출처: `scripts/pota.mjs`, `scripts/pota-goal-cli.mjs`, `scripts/pota-cleanup.mjs`, `scripts/pota-state.mjs`.
- `init` 템플릿(`INDEX_TEMPLATES`)은 짧은 인덱스이고 기존 파일을 덮어쓰지 않는다. 출처: `scripts/pota-state-init.mjs`, `test/contract-parity.test.mjs` "templates/MEMORY.md and templates/PLAN.md equal the English init templates".

### 알려진 한계 (R11에서 고치지 않기로 한 것)

- lock 밖 read-modify-write: SessionStart의 `migration/state.json` 갱신과 `lock-busy` 보고서 기록은 lifecycle lock 밖에서 읽고 쓴다. 동시에 여러 세션이 시작하면 한쪽 기록이 덮일 수 있다(다음 SessionStart가 다시 판단한다).
- 다른 hostname의 lock: 다른 기계가 기록한 lifecycle lock은 pid로 회수하지 않고, 다른 hostname의 `update.lock`은 살아 있는 것으로 본다. 홈을 여러 기계가 공유하면 이전이 계속 `deferred`일 수 있다.
- 진행 중인 1.x 자동 업그레이드와의 경합: 살아 있는 runner의 `update.lock`만 피한다(`deferred: update-running`).
- 다른 호스트에 남은 1.x 설치본은 지운 몫을 다시 설치하지 않는다. 그 설치본의 `upgrade`(1.4.0 → 1.5.0 자동 업그레이드 포함)와, 그 실패 안내가 권하는 `npx @comento/pota-harness@latest upgrade`는 "Managed artifact was modified"로 거부되어 그 호스트는 옛 버전에 머문다. 그래서 README는 쓰는 모든 호스트에 플러그인을 설치하라고 이전 절 2단계에 굵게 적는다.
- Antigravity pending 경합: `PreInvocation`은 pending을 읽은 뒤 `pending: []`로 비우므로, 그 사이에 끝난 `PostToolUse`가 넣은 메시지는 주입되지 않고 사라질 수 있다(세션 파일에 lock이 없다).
- Codex config 임시 파일 `.<name>.pota-<uuid>.tmp`가 rename 전에 죽으면 남을 수 있다.
- 1.x를 설치할 때 쓴 경로 env(`CODEX_HOME` 등)가 호스트의 hook 환경에 없으면 허용 목록이 맞지 않아 `blocked: target-outside-allowlist`다.

### 확인하지 못한 것 (2026-11-23 기준)

- Codex 실제 실행 전부: 이 컴퓨터에 `codex`가 없다. marketplace `url: "./"` 해석(U9), `hooks` 경로가 기본 탐색을 대체하는지(U8), hook 환경의 `PLUGIN_ROOT`(U11), 내용 해시 신뢰가 배포 버전에 있는지(U12), `pota@pota`와의 공존(U13), 업데이트 때 옛 cache 삭제(U14), `codex plugin add`·`marketplace upgrade`의 존재. CI `host-validate` job(필수 검사 아님)이 유일한 실제 설치 시험이다.
- Windows 동작 전체(이전, hook, mod).
- 실제 `agy` 세션 안의 hook: cwd, matcher, `invocationNum`이 프롬프트마다 0부터인지(U3), detached 프로세스가 살아남는지(U4), 사용자 전용 메시지 통로(U15). validate·install까지만 확인했다.
- Claude에서 `pota@pota`와 `pota@pota-harness`의 공존(U6)과 옛 버전 디렉터리 유지 기간(U7). README가 `pota@pota`를 먼저 지우게 한다.

## Policy

- 이전을 실행하는 테스트와 실제 설치 검증은 `HOME`, `USERPROFILE`, `POTA_HOME`, `CLAUDE_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CODEX_CONFIG_PATH`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`을 모두 임시 경로로 두고 `POTA_COMMENT_CHECKER=0`, `POTA_CLAUDE_CLI`(가짜 claude)를 쓴다. 실제 `~/.pota`, `~/.claude`, `~/.codex`, `~/.gemini`에는 쓰지 않는다. 호스트 CLI의 `--help`도 임시 `CLAUDE_CONFIG_DIR`·`HOME`에서 실행한다.
- 이전 모듈은 지워진 lifecycle 모듈을 import하지 않는다. import할 수 있는 기존 모듈은 `pota-paths.mjs`, `pota-safe-fs.mjs`, `pota-lifecycle-lock.mjs`뿐이다(R9).
- `pota-lifecycle-lock.mjs`는 1.x와 같은 lock 규약을 지켜야 하므로 바꾸지 않는다.
- 자동으로 지우는 경로를 넓힐 때는 허용 목록·digest·symlink 사전 검사 세 가지를 모두 거치게 하고, 불분명하면 아무것도 지우지 않는 쪽(fail-closed)을 택한다.
- 플러그인 루트 안에 파일을 쓰는 코드를 넣지 않는다. 새 상태는 `<POTA_HOME>` 아래에 둔다.
- 경로로 spawn되는 새 스크립트는 `package.json` `check`의 `node --check` 목록에 넣는다.

## References

- `node --test test/legacy-migration.test.mjs test/session-start-migration.test.mjs test/doctor.test.mjs test/lifecycle-lock.test.mjs test/plugin-manifests.test.mjs test/antigravity-hooks.test.mjs test/antigravity-dag-mcp.test.mjs test/cli-contract-hardening.test.mjs test/comment-checker.test.mjs`
- `docs/plan/plugin-native-install.md`(§1, §2, §6, §7, §12, §13)
