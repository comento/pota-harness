# Pota Harness

Pota Harness는 Claude Code, Codex / ChatGPT Desktop, Antigravity CLI를 위한 토큰 효율적인 멀티에이전트 하네스 플러그인입니다.

[English](README.md)

핵심 아이디어는 hooks, 지속 상태, 명시적 계획, 집중 위임, 종료 시점 가드 같은 유용한 에이전트 하네스 동작을 유지하는 것입니다. Pota는 반복적인 TDD 검증 루프를 기본값으로 삼지 않습니다. 대신 작업을 작은 모듈 작업으로 나누고 두 가지 검증 게이트로 증명합니다.

1. 모듈 수용 검증: 변경된 모듈 계약을 증명합니다.
2. 표면 통합 검증: CLI, HTTP, 브라우저, 파일 산출물 같은 실제 표면을 통해 동작을 증명합니다.

외부 상태를 변경할 수 있는 작업은 실행 전에 가장 가까운 dry-run 또는 check 모드를 기록하고 실행합니다. 검증은 제한됩니다. 기본적으로 각 작업은 두 번의 검증 패스를 가지며, 이후에는 반복 루프를 계속하지 않고 blocker를 기록하거나 작업을 sub-task로 나눕니다.

Pota는 도구 준비 상태도 작업의 일부로 다룹니다. LSP, typecheck, lint, dry-run, 검증 도구를 저장소 스택 기준으로 확인합니다. 누락 도구는 명시적 승인과 고정된 지원 installer가 모두 있을 때만 설치하고, 그렇지 않으면 blocker로 보고합니다.

## Install

Pota는 Claude Code, Codex(ChatGPT Desktop 포함), Antigravity CLI의 플러그인입니다. 이 저장소의 루트가 플러그인이고, `main` 브랜치가 배포 버전입니다. 각 호스트는 자기 플러그인 명령으로 자기 사본을 설치·업데이트·제거하며, 그 사본이 그 호스트의 runtime입니다. hook, skill, CLI가 모두 그 사본에서 실행됩니다. 호스트마다 버전이 달라도 되고 Pota는 버전을 서로 비교하지 않습니다. `~/.pota/projects/`의 goal 상태는 모든 호스트가 함께 씁니다.

### Claude Code

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
```

세션 안에서는 `/plugin marketplace add comento/pota-harness`, `/plugin install pota@pota-harness`로 같은 일을 합니다. Claude Code는 서드파티 marketplace를 기본으로 자동 업데이트하지 않으므로 직접 업데이트하고 세션을 다시 시작합니다.

```sh
claude plugin marketplace update pota-harness
claude plugin update pota@pota-harness
```

제거:

```sh
claude plugin uninstall pota@pota-harness
claude plugin marketplace remove pota-harness
```

### Codex

```sh
codex plugin marketplace add comento/pota-harness
```

그다음 Codex TUI에서:

1. `/plugins`를 열어 `pota-harness` marketplace에서 `pota`를 설치하고 새 세션을 시작합니다.
2. `/hooks`를 열어 Pota hook 5개를 승인합니다. Codex는 승인하기 전에는 플러그인 hook을 실행하지 않고, 승인은 hook 내용에 묶이므로 업데이트할 때마다 `/hooks`에서 다시 승인해야 합니다. 승인하지 않으면 세션에 `Pota CLI:` 줄이 나오지 않고, Pota skill이 Pota hook이 꺼져 있다고 알립니다.

플러그인은 로컬 `pota-dag` MCP 서버(`.codex-plugin/mcp.json`)도 등록하며, 이 서버가 Codex와 ChatGPT Desktop에서 [DAG 패널](#dag-panel)을 보여 줍니다.

업데이트는 `codex plugin marketplace upgrade pota-harness` 뒤 `/hooks`에서 다시 승인합니다. 제거는 `/plugins`에서 플러그인을 열고 "Uninstall plugin"을 고릅니다. 이 Codex 절차는 Codex 문서와 소스를 따른 것이며, 실제 Codex 설치본에서는 아직 실행해 보지 않았습니다.

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

업데이트는 같은 명령을 다시 실행합니다. Antigravity 문서는 다시 설치하면 설치된 사본을 교체한다고 설명합니다. 제거는 `agy plugin uninstall pota`입니다. `agy` 1.5.6 이상을 권장합니다. Antigravity는 CLI만 지원하고 Antigravity IDE는 지원하지 않습니다. 플러그인은 로컬 `pota-dag` MCP 서버(루트 `mcp_config.json`)도 등록하며, 이 서버가 [DAG 패널](#dag-panel)을 보여 줍니다.

### What each host gets

| | Claude Code | Codex / ChatGPT Desktop | Antigravity CLI |
| --- | --- | --- | --- |
| Skill | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory`, `$dag` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory`, `/dag` |
| Hook | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | 같은 5개(`/hooks`에서 승인한 뒤) | SessionStart, PreInvocation(프롬프트 컨텍스트), PostToolUse, Stop. SubagentStop 없음 |
| Agent `explorer`, `worker` | 있음(플러그인 agent `pota:explorer`, `pota:worker`) | 역할 파일(`skills/pota-work/roles/`)을 orchestrator가 dispatch 프롬프트 맨 앞에 넣음(Codex 플러그인은 agent를 등록할 수 없음) | 있음(플러그인의 `agents/`) |
| DAG 패널 | mod pane, mod 명령 `/dag`로 엶 | MCP App(`pota-dag` 서버), `$dag`로 엶 | MCP App(`pota-dag` 서버), `/dag`로 엶 |

Antigravity `invoke_subagent`의 agent 이름과 Codex 역할 파일 방식은 아직 실제 세션에서 실행해 보지 않았으며, `agy plugin validate`가 agent 2개를 처리하는 것까지만 확인했습니다.

### Coming from the npm install (1.x)

Pota 2.x는 npm에 게시하지 않으며 전역 `pota` 명령이 없습니다. npm 패키지 `@comento/pota-harness`는 이 설치 안내만 보여 주는 1.5.0이 마지막이고, 패키지는 deprecated로 표시됩니다.

1. Claude Code만: 먼저 `claude plugin uninstall pota@pota --scope user`로 1.x 플러그인을 지웁니다.
2. **쓰는 모든 호스트에 플러그인을 설치합니다.** 아래 제거는 호스트 단위로 일어나며, 1.x 설치본에 남은 호스트는 다른 호스트 몫이 지워진 뒤 업그레이드(자동 업그레이드 포함)가 "Managed artifact was modified"로 거부되어 더 이상 갱신되지 않습니다.
3. 세션을 시작합니다. 플러그인의 세션 시작이 1.x ownership manifest(`~/.pota/install/lifecycle.json`)를 찾으면 그 호스트 몫의 1.x 설치본을 백그라운드 프로세스로 제거하고 그 사실을 알립니다. 세션을 한 번 다시 시작하세요. 다음 세션이 결과를 한 번 알려 줍니다. 공유 1.x runtime, `~/.pota/update/`, manifest는 모든 호스트 몫이 없어진 뒤에만 지웁니다.

제거는 1.x manifest에 기록되고 digest가 그대로인 파일·디렉터리와, Codex `config.toml`의 Pota 구획만 지웁니다. `~/.pota/projects/`(goal 상태), `~/.pota/config.json`, `~/.pota/tools/comment-checker/`, 사용자가 고친 파일(남긴 항목으로 보고), manifest에 없는 모든 것, 전역 npm 패키지(`npm uninstall -g @comento/pota-harness`로 지웁니다)는 남깁니다. 다음 경우에는 그 호스트에서 아무것도 지우지 않고 이유를 알립니다.

- 호스트 경로의 디렉터리가 symlink인 경우(`symlinked-path`. 보고된 경로를 직접 지웁니다)
- 호스트 등록을 안전하게 해제할 수 없는 경우(`host-unregister-failed`): `claude` CLI가 없거나 실패하는 경우, Codex `config.toml`에서 Pota 구획을 안전하게 가려낼 수 없거나 다시 쓰면 다른 구획이 바뀌는 경우
- manifest가 잘못됐거나, schema를 지원하지 않거나, 예상 경로 밖을 가리키거나, 1.x 설치 트랜잭션이 중단된 경우(`manifest-invalid`, `manifest-unsupported-schema`, `target-outside-allowlist`, `transaction-pending`). 1.x를 `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`, `CODEX_CONFIG_PATH`를 지정해 설치했다면 호스트에도 같은 값을 둡니다. 그 밖에는 아직 어느 호스트 몫도 지워지지 않았을 때 `npx @comento/pota-harness@1.5.0 uninstall`을 실행한 뒤 다시 시작합니다.

한 호스트 몫이라도 지워진 뒤에는 manifest를 고쳐 쓰지 않으므로 1.x uninstall이 "Refusing to uninstall modified managed artifacts"로 거부합니다. 이때 거부 알림은 `doctor`가 보여 주는 수동 항목을 정리한 뒤 그 호스트에 대해 `node "<pluginRoot>/scripts/pota.mjs" migrate run --host <host>`를 실행하라고 안내합니다.

거부된 제거는 24시간 뒤 다시 시도하고, 알림은 7일에 한 번까지만 냅니다. 1.3 이전 설치본은 ownership manifest가 없어 건드리지 않으므로, 플러그인을 설치하기 전에 `npx @comento/pota-harness@1.5.0 uninstall`로 지웁니다. 상태를 보거나 제거를 직접 실행하려면(`<pluginRoot>`는 아래 설명):

```sh
node "<pluginRoot>/scripts/pota.mjs" doctor
node "<pluginRoot>/scripts/pota.mjs" migrate status
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude --dry-run
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude
```

`POTA_LEGACY_MIGRATION=0`(`false`, `off`, `no`도 가능)은 자동 제거를 끕니다. 1.x 이름은 2.x에서 다음과 같습니다.

| 1.x | 2.x |
| --- | --- |
| `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` | 위 표의 호스트별 skill 이름 |
| `/pota-toolcheck` | 에이전트에게 `pota toolcheck` 실행을 요청 |
| `/pota-doctor` | `pota doctor` |
| CLI의 `install`, `upgrade`, `uninstall` 명령과 자동 업그레이드 | 위의 호스트 플러그인 명령. CLI는 이 절을 가리키는 안내를 출력하고 exit 2로 끝납니다 |

### Running the Pota CLI

세션이 시작될 때마다 그 호스트 플러그인 사본의 `scripts/pota.mjs` 절대 경로가 담긴 `Pota CLI:` 줄이 나오고, 에이전트는 그 경로로 Pota 명령을 실행합니다. `<pluginRoot>`는 그 `scripts` 디렉터리의 상위 디렉터리이며, 호스트가 새 버전을 설치하면 경로가 바뀝니다. 이 README의 `pota <command>`는 `node "<pluginRoot>/scripts/pota.mjs" <command>`를 뜻합니다.

## Complexity Triage

모든 구현 작업은 agent, plugin, delegated workflow 지침을 적용하기 전에 먼저 complexity triage를 거칩니다. triage는 사용자에게 묻지 않고 저장소 탐색, 예상 변경 범위, 위험 신호를 기준으로 결정합니다.

- Light Path: 기존 아키텍처 레이어 안의 좁은 변경입니다. 기본값이지만, 사용자가 호출한 main agent는 여전히 orchestration을 맡고 subagent 도구가 있으면 구현 편집을 하나의 제한된 `worker`에 위임한 뒤 검증 게이트를 유지합니다.
- Heavy Path: 새 디렉터리/모듈/레이어, 새 도메인 모델/서비스/추상화, 보안/세션/인증, 외부 API/message queue/payment, DB schema/migration, concurrency/transaction/cache 변경, 여러 도메인 리팩터링, 또는 사용자의 extra-care 요청입니다.

선택된 path와 근거는 계획 산출물이 있을 때 `docs/plan/<topic>.md`에 기록합니다. Light Path에서도 두 검증 게이트는 유지됩니다. subagent 도구가 없으면 main agent가 implementation을 직접 인계하고, 그 takeover를 evidence에 기록합니다.

Pota는 task 성격에 따라 task별 model을 네 tier(호스트마다 값 하나)로 정하고 reasoning effort도 라우팅합니다. `MEMORY.md`나 계획에 `Model routing: inherited`를 적으면 작업별 model 선택이 꺼집니다.

| Tier | 용도 | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- | --- |
| fast | 읽기 전용 탐색·요약 | `haiku` | `gpt-6-luna` | `flash_lite` |
| balanced | Light 구현·일상 검증 | `sonnet` | `gpt-6.1-terra` | `flash` |
| stronger | 계획·트리아지·Heavy 구현·리뷰·최종 검증 | `opus` | `gpt-6-sol` | `pro` |
| strongest | Heavy 설계만 | `fable` | `gpt-6-astra` | `pro` |

Antigravity의 기본 위임 도구 `invoke_subagent`는 tier 값만 받고 effort option이 없어서 effort를 `inherited`로 기록합니다. `swarm` 도구가 있으면 선택적으로 구체 model을 effort 접미사와 함께 dispatch할 수 있습니다. Pota는 실제 Antigravity 세션과 `swarm`의 model ID(Gemini, GPT-OSS, Claude 계열)도 같은 네 tier로 분류해 게이트에 씁니다. effort가 적용되지 않은 채(`inherited`, `not-applied`, 없음) 배정된 Heavy task는 `--allow-inherited-effort <reason>`을 주지 않으면 `goal task --status completed`와 `goal finish`로 완료할 수 없습니다. Light 계획·구현·검증은 `medium`, Heavy 계획·검토·구현은 `high`, 최종 검증·검토는 `xhigh`를 요청합니다. Requested는 Pota가 원하는 profile이고 Effective는 dispatch 결과가 확인한 적용값입니다. 새 task/worker dispatch마다 정한 model과 요청 effort를 host option으로 반드시 넘깁니다(Claude Code: Agent `model`/`effort`, `fork` 금지). Effective는 넘긴 값이고, 넘기지 않았으면 `not-applied: <사유>`, host에 option이 없을 때만 `inherited`입니다. Host capability는 노출된 interface 또는 dispatch 응답으로만 판단하고, Pota가 option을 통합/사용하지 않기로 한 선택과 host 미지원은 구분합니다. path가 바뀌면 plan artifact, 저장소 goal task roadmap, native UI plan, effort profile을 함께 동기화하고 완료 profile은 보존하며 미완료 profile은 재계산합니다.

subagent 도구가 progress-reporting channel을 제공하면 subagent는 작업 시작, 방향 결정/확인, 주기적 진행, 완료 시점에 orchestrator에게 상태를 보고합니다. orchestrator는 받은 status event를 즉시 사용자에게 전달합니다. mid-run reporting channel이 없으면 orchestrator는 할당, 대기, 최종 완료처럼 관측 가능한 event를 사용자에게 전달합니다.

위임받은 subagent는 작업을 마치면 퇴근 전에 final report를 남깁니다. orchestrator가 final report와 evidence를 회수한 뒤, host에 비파괴적인 close/release 동작이 있으면 완료된 subagent를 close/release하고, 없으면 kill하지 않고 유휴 상태로 둡니다(Antigravity의 `manage_subagents(kill)`은 `Cancelled`로 표시합니다). 그 다음 orchestrator가 final report와 evidence를 검토한 뒤 작업 완료 여부를 판단합니다.

## Tool Readiness

`pota toolcheck`는 현재 저장소에서 JavaScript, TypeScript, Python, PHP, Java, Kotlin, Swift, Go, Rust 스택을 감지하고, 해당 LSP와 검증 도구를 확인합니다.

```sh
pota toolcheck --root .
# 명시적 승인을 받은 경우에만:
pota toolcheck --install --yes --root .
```

- `toolcheck`는 감지된 스택과 누락 도구를 보고합니다. 누락 도구마다 제안 설치 명령이나 자동 설치가 불가능한 사유를 출력하고, 에이전트는 설치할지 한 번 묻습니다. 거부하거나 비대화형 실행이면 blocker로 기록합니다.
- 기본 검사는 읽기 전용이고 timeout으로 제한되며, 저장소 로컬 wrapper를 단순 탐지를 위해 실행하지 않습니다.
- `toolcheck --install`은 사용자의 명시적 승인과 `--yes`를 모두 요구합니다. 버전이 고정되지 않았거나 checksum이 없는 installer는 `latest`를 내려받는 대신 canonical `installer-unavailable` 거부 결과로 보고합니다.
- Pota 계획은 감지된 스택, 필요한 도구, 설치 명령, blocker를 기록합니다.
- LSP server가 없다는 사실만으로 정밀한 코드베이스 탐색을 건너뛸 수 없습니다. 설치 또는 동등한 symbol-aware fallback을 먼저 시도해야 합니다.

## Dry-Run And Loop Policy

- 마이그레이션과 데이터베이스 변경은 write/apply 명령 전에 `--pretend`, dry-run, schema diff, rollback 가능성 검사, 또는 가장 가까운 저장소 네이티브 방식을 사용합니다.
- 패키지, 릴리스, 인프라, 배포, 코드 생성, 포매팅 작업은 가능한 경우 상태 변경 전에 check, plan, diff, validate, dry-run 모드를 사용합니다.
- dry-run이 없으면 계획에 그 사실을 기록하고 가장 작고 되돌릴 수 있는 명령 또는 테스트 산출물을 선택합니다.
- 검증 게이트가 실패하면 Pota는 한 번 진단하고 작업을 줄이거나 sub-task로 나눈 뒤 두 게이트를 다시 실행합니다.
- 같은 작업에서 두 번의 검증 패스가 실패하면 반복 루프를 계속하지 않고 `docs/plan/<topic>.md`에 blocker를 기록합니다.

## Verification Integrity

- 구현자는 판정 기준을 바꿀 수 없습니다. 기존 test, fixture, snapshot, 기록된 검증 명령은 계획에 계약 변경 사유를 먼저 기록하지 않는 한 게이트 통과를 위해 수정·약화·skip·삭제하지 않습니다. 리뷰는 이 diff를 검사하고 사유 없는 약화를 거부합니다.
- 보고된 결함은 수정 전에 도구로 먼저 재현합니다. 원인이 불명확한 실패는 가설을 하나씩 세우고 측정으로 닫으며, 가능 여부 질문은 검증 없는 "불가능"이 아니라 제한된 실험으로 답합니다.
- 결함을 고친 뒤에는 같은 규칙이나 패턴의 다른 구현을 저장소 전체에서 찾아 범위 안에서 고치거나 후속 작업으로 기록합니다.
- 반복되고 기계적으로 확인 가능한 교훈은 메모리 문장을 늘리는 대신 test, lint rule, script, hook으로 옮깁니다.

## Model Guidance

Pota는 Claude-family와 Codex-family 모델에만 모델별 조정을 적용합니다.

- Claude-family: 긴 컨텍스트, 정책 해석, 계획/증거 검토에 유용합니다.
- Codex-family: 작은 구현 작업, 명시적 파일 편집, command 기반 검증, 제한된 `worker` 작업에 유용합니다.

자세한 가이드는 설치된 플러그인에 있으며 `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`, `pota://docs/model-guidance/codex.md`로 참조합니다.

## Repository Artifacts

하네스는 대상 저장소 루트에 다음 파일을 생성하고 유지합니다.

- `MEMORY.md`: 지속 도메인 지식의 짧은 색인. `## Domain Knowledge` 아래에 노트당 한 줄(`- [<name>](docs/memory/<name>.md): <summary>`)을 두고, 저장소 `## Policy`를 함께 둡니다.
- `docs/memory/*.md`: 도메인별 상세 지식. 각 노트는 H1 아래에 한 줄 `Summary:`(120자 이하)를 두며, 색인과 hook이 이 줄을 보여 줍니다. 노트는 `Summary:` 뒤에 선택 줄 `Paths:`를 둘 수 있습니다.
- `PLAN.md`: 작업 계획의 짧은 색인. `## Active Plans`와 `## Completed Plans` 아래에 계획당 200자 이하 한 줄을 둡니다. 계획 규칙은 `PLAN.md`가 아니라 `pota-plan` 스킬에 있습니다.
- `docs/plan/*.md`: 상세 실행 계획.
- `docs/plan/ARCHIVE.md`: `pota plan index --archive`가 `PLAN.md`에서 옮긴 오래된 완료 항목을 최신순으로 보관하고, 예전 `## Planning Rules` 절의 본문은 `## Legacy Planning Rules` 아래에 둡니다. 첫 `## ` 제목 앞의 목록 줄은 색인된 것으로 셉니다.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json`: 중단 재개와 범위가 제한된 종료 게이트에 쓰는 사용자 홈의 프로젝트/워크트리별 활성 goal/task/증거 상태입니다. 프로젝트 작업 트리는 런타임 상태를 소유하지 않습니다.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl`: 완료·취소된 goal마다 요약 레코드 하나를 남기며(worktree당 최신 200개), `goal stats --history`가 읽습니다.

`## Completed Plans`는 최신 항목이 위에 오도록 유지합니다. `pota plan index --archive`는 앞의 20개 항목을 남기고 나머지를 아무것도 지우지 않고 `docs/plan/ARCHIVE.md`로 옮기므로, 오래된 순으로 쌓은 목록에서는 최신 계획이 보관됩니다. 먼저 `--dry-run`으로 확인하세요. 기존 `MEMORY.md`/`PLAN.md`는 마이그레이션 없이 동작합니다. `init`은 기존 파일을 다시 쓰지 않고, `check`는 예전 형식을 경고로만 알립니다.

`SessionStart`에서 hook은 어떤 메모리 노트가 있는지(이름과 `Summary:`, 목록이 길면 이름만 나열한 한 줄)를 에이전트에게 알리고, 활성 goal이 없으면 계획 색인 한 줄(계획 수, 진행 중 계획, 최근 완료 계획, 있으면 `docs/plan/ARCHIVE.md`)을 덧붙입니다. 활성·일시정지·차단 goal이나 다른 session이 소유한 goal이 있으면 메모리 목록만 싣고, 다른 session의 캡슐에는 계획 이름을 넣지 않습니다. goal이 없을 때의 `UserPromptSubmit`은 노트 개수를 알리는 한 문장만 더합니다. hook은 색인 파일과 디렉터리 목록만 읽고 노트 본문은 읽지 않으며 아무것도 쓰지 않습니다. 노트와 계획이 없는 저장소의 hook 출력은 이전과 같습니다.

`pota-work`는 `goal finish` 전에 goal마다 한 번 메모리 승격 결정을 계획의 Evidence에 기록합니다. 다시 쓸 저장소 지식이 생겼으면 `Memory promotion: docs/memory/<domain>.md`, 아니면 `Memory promotion: none: <reason>`입니다. 결정 기록은 필수이고 노트 작성은 선택입니다. goal이 완료됐는데 계획 파일에 채워진 `Memory promotion:` 줄이 없으면 `goal finish`와 `goal complete`가 stderr에 한 줄 알림을 내며, exit code와 stdout은 바뀌지 않습니다.

script, template, agent, model guidance는 호스트의 플러그인 사본에 있고, 대상 저장소에는 Pota 파일을 복사하지 않습니다. 그 사본이 없거나 읽을 수 없으면 호스트의 플러그인 명령으로 다시 설치하거나 업데이트합니다. 다른 호스트의 사본으로 복구하거나 대상 저장소에서 Pota 파일을 찾지 않습니다.

## Commands

아래의 `pota <command>`는 세션 시작의 `Pota CLI:` 줄에 나온 경로로 실행하는 `node "<pluginRoot>/scripts/pota.mjs" <command>`입니다([Running the Pota CLI](#running-the-pota-cli) 참고).

- `pota doctor [--json]`: 이 플러그인 사본과 `~/.pota`를 읽기만 하는 진단입니다. 버전, `pluginRoot`, Node.js(18 이상), `POTA_HOME` 쓰기 가능 여부, 이 사본의 버전 표면 4개 일치 여부, 필수 파일, 1.x 설치본(`none`, `present <version>`, `blocked <reason>`), 호스트별 마지막 제거 보고서(남긴 경로와 수동 명령 포함), comment-checker 상태를 보여 줍니다. 다른 호스트의 사본과 비교하지 않습니다. 검사가 실패하면 exit 1, 사용법 오류는 exit 2입니다.
- `pota migrate status|run [--host claude|codex|antigravity] [--all] [--dry-run] [--json]`: 1.x 설치본 제거를 직접 실행합니다. `status`는 실행하면 할 일과 마지막 보고서를 보여 줍니다. `run`은 `--host <host>` 또는 `--all`(플러그인을 아직 설치하지 않은 호스트까지 모든 호스트)이 필요하고, `--dry-run`은 아무것도 바꾸지 않고 계획만 보여 줍니다. 제거가 거부되면 exit 1, 사용법 오류는 exit 2입니다.
- `pota toolcheck`: 저장소 스택과 필요한 LSP·검증 도구를 확인하며, 승인된 지원 installer만 실행합니다.
- `pota cleanup --root <repo>`: 기본값은 legacy 프로젝트 로컬 `.pota` 잔여물을 읽기 전용으로 보고합니다. `--yes`는 유효한 활성 상태를 사용자 홈 저장소로 조정·이관하고 알려진 상태/lock/tool 잔여물만 제거하며, 알 수 없는 파일은 보존하고 비었을 때만 디렉터리를 정리합니다. `state.lock`은 이 host에서 owner 프로세스가 종료된 유효한 lock 레코드일 때만 삭제하고, 격리된 `state.lock.stale.*` 파일은 유효한 레코드의 nonce가 파일 이름과 일치할 때만 삭제합니다. owner가 살아 있거나 다른 host의 lock, 파싱할 수 없는 lock은 보존하고 `preservedReasons`에 사유를 남깁니다. `--help`와 `--version`은 exit 0, 사용법 오류는 exit 2, 실행 오류는 `Pota cleanup error:` 한 줄과 exit 1입니다.
- `pota goal ...`: 저장소의 영속 goal을 시작·조회·일시정지·재개·차단·취소·완료합니다. `goal claim --session <id>`는 같은 작업을 이어받는 session(재개·압축·handoff·fork)에 미완료 goal의 소유권을 넘기며, 미완료 goal 중에 들어온 새 작업은 goal을 취소하지 않고 `goal replan`으로 합칩니다. 기본 tool-bound 정책은 `goal verify -- <argv>`가 명령을 직접 실행해 성공 증거를 기록합니다. `goal receipt`는 기존 선언 증거를 가져오는 호환 명령입니다. 모든 `goal` 하위 명령에서 `--root`는 선택이며, 생략하면 `HARNESS_REPO_ROOT`, 없으면 cwd에서 가장 가까운 `.git` 상위 디렉터리로 결정됩니다. `goal verify --kind "moduleAcceptance|surfaceIntegration" -- <argv>`는 한 번 실행으로 kind마다 receipt를 기록하며, evidence scope는 `task`와 `goal`뿐입니다. `goal finish [--watch "<path|path>"] [--timeout-ms N] -- <argv>`는 active task를 완료하고(필수 증거가 fresh여야 함) argv를 한 번 실행해 goal requiredEvidence의 모든 kind(기본 `finalReview`)를 goal scope로 기록한 뒤 goal을 완료합니다. 이 goal scope 증거가 모든 task receipt 이후에 기록되면 이전 task 검사를 다시 실행하지 않습니다. `goal stats`는 현재 goal의 receipt 수, 재실행, stale receipt를 JSON으로 출력합니다. `goal stats --history [--limit N]`은 저장소의 모든 worktree에서 끝난 goal을 집계합니다: 완료·취소 수, 소요 시간 중앙값과 p90, task·receipt 중앙값, 재실행 비율, 메모리 승격 결정 수, 완료 goal이 4개 이상일 때의 이전/최근 `trend`, 최근 goal 목록입니다. 이력이 없으면 `{"schemaVersion":1,"scope":"repository","goals":0}`을 출력합니다. `completionCriteria`(`goal start --criteria`)는 `advisory`입니다. Pota는 이를 기록만 하고 강제하지 않으며, 완료는 필수 증거로만 판정합니다. task는 `dependsOn`(생략 시 이전 task)과 `writeScope`를 선언하고, `goal ready`는 active/ready/blocked task id를 출력하며, write scope가 겹치지 않는 ready task는 같은 worktree에서 최대 4개까지 병렬로 active가 될 수 있습니다. `goal gate --task <id> --on|--off [--reason <text>]`는 active나 completed가 아닌 task에 수동 승인 게이트를 걸거나 풉니다. 게이트가 걸린 task는 자동으로 시작되지 않고 이어갈 작업으로 제시되지도 않습니다. `goal ready`는 그 task를 `ready` 대신 `gated`(게이트가 있을 때만 나오는 key)에 내고, 게이트 task만 남으면 hook 컨텍스트가 goal이 사용자 승인을 기다린다고 알립니다. 게이트는 사용자만 풉니다: `goal gate --off`, `goal task --task <id> --status active --approve-gate`, 또는 DAG 패널에서. 게이트는 공유 goal 상태에 저장되므로 저장소에서 작업하는 모든 호스트가 2.3.0 이상일 때만 강제됩니다. `goal retry --task <id>`는 `blocked` task를 `pending`으로 되돌리고 blocker, dispatch 기록(agent, effort, model, effective model, host), 그 task의 영수증을 지워(완료하려면 두 검증을 다시 기록해야 합니다) orchestrator가 새 worker로 dispatch하게 합니다. route·kind·승인 게이트·필요 증거·다른 task의 영수증·완료된 task는 그대로입니다. 그 task의 blocker로 막힌 goal은 다시 `active`가 되고, 활성 task가 없으면 준비된 첫 task가 활성화됩니다(게이트 task는 계속 대기). 실행할 task가 없으면 남은 blocked task의 사유로 다시 blocked가 됩니다. `goal block`으로 직접 막은 goal은 재시도로 풀리지 않으며(`goal resume` 필요) `paused` goal은 paused로 남습니다. 다른 상태의 task는 거부합니다.
- `pota memory check|index [--root <repo>]`: `check`는 `MEMORY.md`와 `docs/memory/*.md`를 대조해 JSON 보고서 하나를 출력합니다. 미색인 노트, 죽은 링크, 중복, 오래된 요약, 요약의 제어문자, 안전하지 않은 경로가 있으면 exit 1이고, 경고는 `--strict`에서만 실패합니다. 항목은 `## Domain Knowledge` 아래의 목록 줄입니다(그 절이 없는 예전 파일은 모든 목록 줄). 다른 절의 노트 링크는 언급이며 `index`가 다시 쓰지 않습니다. `index`는 빠진 노트를 추가하고 `Summary:`가 바뀌면 링크 뒤의 요약 부분만 바꾸며(링크가 여럿인 줄은 그대로 둠), 그 절 안에서 Pota placeholder 줄만 정확히 일치할 때 제거하고 항목이나 죽은 링크는 지우지 않으며 나머지 내용은 바이트 단위로 보존합니다. `--dry-run`으로 미리 볼 수 있습니다. 삽입 지점이 닫히지 않은 코드 펜스 안이면 `index`는 아무것도 쓰지 않고 `unclosed-fence`로 exit 1입니다. 사용법 오류는 exit 2이고, 하위 명령 없는 `pota memory`는 기존 안내문을 출력합니다.
- `pota plan check|index [--archive] [--root <repo>]`: `PLAN.md`와 `docs/plan/*.md`에 같은 검사와 색인을 적용하며, 항목은 제목이 `Plans`로 끝나는 `## ` 절(`## Superseded Plans` 등)의 목록 줄입니다. `index`는 체크박스가 모두 체크된 계획을 `## Completed Plans` 맨 위에, 그 밖의 계획을 `## Active Plans`에 넣습니다. 줄을 옮기는 것은 `--archive`뿐이며, 최신 20개를 넘는 완료 항목(들여쓴 문단 포함)과 예전 `## Planning Rules` 절의 본문을 `docs/plan/ARCHIVE.md`로 옮깁니다. `check`는 `## Completed Plans`가 20개를 넘거나 예전 `## Planning Rules` 절이 남아 있으면 경고합니다.
- `pota-memory`: 도메인 지식을 탐색하고 `Summary:` 줄이 있는 노트를 쓰며 `MEMORY.md` 색인을 유지합니다.
- `pota-plan`: 관련 메모리 노트와 관련 완료 계획(최대 3개)을 재활용한 뒤 `docs/plan/` 아래에 decision-complete plan을 만듭니다.
- `pota-work`: 현재 `PLAN.md`의 다음 모듈 작업을 실행하고 두 검증 게이트를 확보합니다.
- `pota-review`: 계획, memory, 증거를 기준으로 완료된 작업을 검토합니다.
- `dag`: [DAG 패널](#dag-panel)만 엽니다. 계획·편집·goal 상태 변경은 하지 않습니다.

모든 `UserPromptSubmit`에서 Pota는 구현 또는 계속 실행 요청 자체가 goal 생성 권한이며 사용자가 “goal”을 직접 말할 필요가 없다는 모델 가시 지침을 주입합니다. 에이전트는 먼저 트리아지를 active task로 둔 초기 저장소 계획을 작성하고, 탐색·트리아지 전에 가능한 경우 Codex `update_plan`과 `create_goal`로 같은 roadmap을 UI에 표시한 뒤 저장소 Pota goal을 시작합니다. 트리아지 결과로 두 계획을 decision-complete 구현 계획으로 갱신한 뒤에만 구현합니다. 활성 goal은 전체 순서형 roadmap, 각 상태, 현재 task를 hook 컨텍스트에 유지하므로 곁가지 질문 뒤 원래 작업으로 돌아갈 수 있습니다. 상담·설명·계획 전용 요청은 goal 없이 처리합니다.

토큰 효율 실행에서는 구현보다 먼저 요구사항·불변식·경계·실패 모드로 집중 실행 test contract를 설계하는 데 추론을 배분합니다. 구현에는 실패 계약과 제한된 파일 범위만 전달하고 통과에 필요한 최소 변경을 요구합니다. 성공 여부는 도구 exit code와 기계적 요약으로 판정하며 성공 출력은 축약하고 실패할 때만 컨텍스트를 확장합니다. 명시적 `--watch`가 없으면 Git fingerprint는 ignored file을 제외하므로 주장에 필요한 ignored artifact는 각각 `--watch <path>` 또는 명시적인 상위 디렉터리로 지정해야 합니다. package 검증 전 lifecycle script를 검사하고 기본적으로 정상 `npm pack --dry-run`을 실행합니다. content-producing 또는 미분류 script에는 `--ignore-scripts`를 사용하면 안 되며, script가 없거나 content-neutral임을 입증했고 전체 검사 증거가 여전히 유효할 때만 사용할 수 있습니다. 성공한 상태 변경은 `--quiet`를 지원하므로 커지는 goal JSON이 대화 토큰을 소모하지 않습니다.

Pota는 `POTA_HOME`(기본 `~/.pota`) 아래에만 쓰고 자기 플러그인 사본 안에는 쓰지 않습니다. Codex는 hook 승인을 플러그인 내용에 묶기 때문에, 스스로 바뀐 사본은 승인을 잃습니다. 호스트의 플러그인 파일은 호스트 자신의 플러그인 명령으로만 설치·업데이트·제거됩니다.

## Pota Home And Settings

Pota는 데이터를 `POTA_HOME`(기본 `~/.pota`) 아래에 두고, 모든 호스트의 플러그인 사본이 함께 씁니다.

```text
~/.pota/
  projects/                 goal 상태
  config.json               사용자 설정 ("commentChecker", "modelCeiling")
  tools/comment-checker/    comment-checker 바이너리(고정 release)
  migration/                1.x 설치본 제거의 보고서와 상태
  hosts/antigravity/        Antigravity 세션 파일(다음 프롬프트를 기다리는 hook 메시지)
  hosts/antigravity-dag/    workspaces.json: DAG MCP App이 쓰는 최근 활성 워크스페이스(Antigravity, Codex)
  install/, update/         1.x npm 설치본이 남긴 것. 제거가 끝나면 없어짐
```

- 1.x 설정: `config.json`의 `"autoUpgrade"`는 무시합니다. Pota는 더 이상 스스로 업그레이드하지 않습니다.
- 주석 검사: 편집이 성공하면(Claude Code `Write`/`Edit`/`MultiEdit`, Codex `apply_patch`와 편집 도구) PostToolUse hook이 바뀐 내용을 [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker)(MIT)로 검사합니다. 불필요한 주석이 보고되면 `decision: "block"`을 돌려줘 에이전트가 주석을 지우거나 필요한 이유를 설명하게 합니다. npm 의존성은 추가하지 않습니다. 호스트 hook의 세션 시작이 분리 프로세스로 현재 플랫폼(darwin/linux x64·arm64, windows x64)용 고정 v0.8.2 release를 내려받고, 고정된 SHA256을 검증해 OS `tar`로 `~/.pota/tools/comment-checker/`에 풉니다. 다운로드가 실패하면 이후 세션 시작에서 backoff를 두고 다시 시도합니다. 다운로드가 성공하기 전까지 편집은 검사 없이 통과하며, 검사기 오류나 7초를 넘는 검사도 통과합니다. `pota doctor`가 상태를 한 줄로 보여 주고, `POTA_COMMENT_CHECKER=0`(`false`, `off`, `no`도 가능) 또는 `~/.pota/config.json`의 `"commentChecker": false`는 검사와 다운로드를 모두 끕니다.
- main 모델 확인: 세션의 main 모델이 stronger tier 미만이면 `SessionStart`가 `Pota main model:` 줄과 1회 알림을 추가합니다. 이때 계획·트리아지와 최종 리뷰는 stronger tier 이상으로 위임하고 기록해야 하며(리뷰는 `goal assign … --kind review`), 기록이 없으면 `triage-plan` 완료와 `goal finish`가 거부됩니다. 우회는 `--allow-main-model <reason>`입니다. 모델 값이 없거나 인식되지 않으면 동작하지 않습니다. `POTA_MAIN_MODEL_GATE=0`으로 끕니다.
- 모델 상한: 계정에서 상위 tier를 쓸 수 없거나 쓰지 않을 때(구독 등급, 조직 정책, usage credits) `POTA_MODEL_CEILING=stronger`(또는 `balanced`, `opus`·`sonnet` 같은 모델 이름도 가능)를 설정하거나 `~/.pota/config.json`에 `"modelCeiling": "stronger"`를 적습니다. 환경변수가 우선이고, `config.json`은 모든 hook과 CLI 호출이 똑같이 읽는 위치입니다. 설정하면 `SessionStart`가 `Pota model ceiling:` 줄을 추가하고, 상한보다 높은 tier는 상한 tier의 모델을 쓰며, Heavy 설계 게이트가 그 모델을 통과시키고, main 모델 확인은 상한이 적용된 stronger tier를 기준으로 합니다. 설정이 없으면 동작은 그대로이고, 잘못된 값은 상한 없이 알림만 냅니다.
- 요청 계약과 스티어링: Light·Heavy Path 계획은 `## Request Brief`(원문 요청, 해석한 결과, 범위, 과거 기록 참고(`Prior records`, `pota plan steering`), 가정, 암묵 요구사항, 열린 질문, 스티어링 기록)를 담고, 채우기 전에는 `--allow-no-request-brief <reason>`을 주지 않는 한 `triage-plan` 완료가 거부됩니다. 사용자의 정정·추가·방향 전환은 `goal steer --kind <correction|addition|redirect> --reason <text>`로, task가 바뀌면 `goal replan --steer <correction|addition|redirect|none> --reason <text>`로 기록하며, 두 번째 스티어링이나 redirect에는 다시 쓴 `Current request (as of S<n>)`도 필요합니다.
- 완료 주장 대조: 목표가 활성인 동안 Stop gate가 종료를 막을 때(또는 loop guard가 종료를 허용할 때) 마지막 답변이 완료나 검사 통과를 주장하면, hook이 그 주장을 짚는 한 문장을 덧붙여 agent가 사용자에게 정정하거나 증거를 기록하게 합니다. 종료 결정은 바꾸지 않고, 코드 블록·인라인 코드·인용 줄은 무시하며, 호스트의 `last_assistant_message` 필드만 읽습니다(Claude Code, Codex는 문서 기준, Antigravity는 넘기지 않음). `POTA_CLAIM_RECEIPT=0`으로 끕니다.
- 메모리 경로: `docs/memory` 노트는 `Summary:` 줄 아래에 `Paths: <쉼표로 나눈 저장소 상대 경로 접두사 또는 glob>`을 둘 수 있습니다(최대 8개, `*`는 경로 한 구간, `**`는 여러 구간). 편집이 성공한 뒤 PostToolUse hook이 편집한 파일과 경로가 맞는 노트를 한 번에 최대 3개까지, 세션·노트당 한 번 알리고 나머지는 다음 편집에서 알립니다. `pota memory check`는 잘못된 항목을 `paths-invalid`로 보고합니다.
- Heavy 계획 리뷰: Heavy Path에서는 `heavy-design` task도 `planReview` 증거가 필요합니다. 더 강한 tier의 별도 읽기 전용 리뷰어가 기본적으로 승인하고, 저장소 파일로 확인한 blocker가 있을 때만 반려하며, 재검토는 한 번이고 그 뒤에는 blocker로 기록합니다.
- 승격과 학습: 자기 tier로 끝낼 수 없는 worker는 final report를 `ESCALATE: <reason>`으로 시작하고, orchestrator가 한 tier 위로 다시 dispatch합니다(모델 상한에서 멈춤). worker는 보고를 `LEARNINGS:`로 마치고, orchestrator가 이를 계획의 `## Learnings`에 덧붙여 뒤 task에 전달하며 메모리 승격 결정에 씁니다.

## DAG Panel

모든 호스트가 현재 Pota goal을 wave별 열로 나눈 DAG 패널로 보여 줍니다. Claude Code는 자체 mod pane으로 그리고, 2.3.0부터 Antigravity와 Codex / ChatGPT Desktop은 플러그인의 로컬 `pota-dag` MCP 서버가 제공하는 MCP App으로 같은 패널을 보여 줍니다. 패널 구성은 세 호스트가 같습니다.

- 탭 4개: DAG(wave 그래프. 보기는 이전, 현재, 다음, 전체이고 기본은 전체), Diff, Plan, 에이전트·통계.
- Diff는 작업 트리에서 바뀐 파일과 추가·삭제 줄 수를 보여 줍니다. 읽기 전용 Git 명령만 실행하고 파일 내용은 보여 주지 않습니다. 비밀정보로 보이는 경로(`.env*`, `service-account*.json`, 키·인증서 파일 등)는 민감 표시를 하고 링크를 걸지 않습니다.
- Plan은 활성 계획의 개요(제목, goal, 현재 요청, 체크리스트 진행률)를 보여 줍니다.
- 에이전트·통계는 task별로 기록된 agent, model, effort와 저장소의 최근 goal을 보여 줍니다. Antigravity에서는 세션 트랜스크립트로 실제 model, effort, 토큰 수를 보강합니다.
- 노드를 선택하면 그 task의 증거 receipt와 `writeScope`의 diff 통계를 담은 인스펙터가 열립니다.
- 컨트롤로 goal을 일시정지·재개하고 task의 수동 승인 게이트를 켜고 끕니다([Commands](#commands)의 `pota goal gate` 참고).
- 막힌(`blocked`) task의 인스펙터에는 재시도 버튼이 있습니다. 누르면 `goal retry --task <id>`(MCP App은 app 전용 `pota_dag_action`의 `retry_task`)가 실행되어 task가 `pending`으로 돌아가고 영수증이 지워집니다. 패널은 worker를 직접 띄우지 않으며, orchestrator가 재시도된 task를 새 worker로 dispatch하고 `goal assign`을 다시 기록합니다.

### Claude Code (mod)

mod 기능이 있는 Claude Code가 필요합니다(Claude Code 2.1.325의 mod API 기준으로 작성). 터미널에는 그래픽이 없어서 wave를 위에서 아래로 박스 문자 박스로 그리며 움직이는 점은 없습니다. pane 폭이 24칸보다 좁으면 글자 목록으로 표시합니다.

- `/dag [previous|current|next|all|dag|diff|plan|stats|refresh|close]`로 해당 보기나 탭으로 패널을 엽니다. 완료된 연결은 실선, 진행 중인 연결은 점선과 이동하는 점입니다.
- `pota goal start`와 `pota goal replan` 뒤에 자동으로 한 번 열립니다. 닫으면 같은 goal에서는 다시 열지 않습니다.
- goal 명령이 실행될 때와 30초마다 goal 상태를 다시 읽어 갱신합니다.
- 실행 중인 task를 선택하면 그 task를 맡은 subagent의 대화가 열립니다. main 세션이 직접 하는 task와, 전환할 main view가 없는 화면(데스크톱 앱)의 모든 task는 pane 안의 인스펙터가 대신 열립니다.
- 세션 root의 goal을 읽습니다. goal 명령이 다른 worktree에서 실행되면 패널이 그 worktree를 따라가고 제목 아래에 그 사실을 표시합니다. 세션이 옮겨지거나, 그 goal이 끝나고 세션 root에 goal이 있으면 돌아옵니다.

### Antigravity and Codex / ChatGPT Desktop (MCP App)

- `pota-dag` 서버는 플러그인이 등록하며(Antigravity: 루트 `mcp_config.json`, Codex / ChatGPT Desktop: `.codex-plugin/mcp.json`), 의존성 없이 `scripts/pota-dag-mcp.mjs`를 stdio로 실행합니다.
- 에이전트는 `goal start` 직후와 활성 goal을 재개할 때 `open_pota_dag` 도구를 호출합니다. 직접 열려면 `dag` skill을 씁니다: Antigravity는 `/dag`, Codex는 `$dag`(Codex 플러그인은 슬래시 명령을 등록할 수 없습니다). Antigravity는 패널을 사이드바 항목과 보조 패널로도 제공합니다.
- `open_pota_dag`는 모델에게 작은 요약만 돌려주고, 화면 데이터는 패널이 직접 불러옵니다. 일시정지·재개·게이트 컨트롤은 Pota hook이 최근 활성으로 기록한 워크스페이스(`~/.pota/hosts/antigravity-dag/workspaces.json`)에서만 동작합니다.
- 인스펙터에서 에이전트에게 task 검토를 요청하는 후속 메시지를 대화로 보낼 수 있습니다.
- Antigravity에서 서버가 내려가 있으면 에이전트가 `node "<pluginRoot>/scripts/pota-dag-mcp.mjs" ensure`를 실행하고 한 번 다시 시도합니다. 패널을 쓸 수 없어도 작업은 막지 않습니다.

## Antigravity Compatibility

Pota는 Antigravity CLI(`agy`)를 지원하고 Antigravity IDE는 지원하지 않습니다. 플러그인 manifest는 루트 `plugin.json`, hook은 루트 `hooks.json`이며, hook은 플러그인 폴더에서 `scripts/pota-state-antigravity.mjs`를 실행합니다. 이 어댑터가 Antigravity 이벤트를 Pota hook에 대응시킵니다.

- `SessionStart`는 세션 캡슐과 `Pota CLI:` 줄을 넣습니다.
- Antigravity에는 프롬프트 이벤트가 없어서 프롬프트마다 첫 `PreInvocation`이 프롬프트 컨텍스트를 넣습니다.
- `write_to_file`, `replace_file_content`, `multi_replace_file_content`의 `PostToolUse`는 comment checker와 goal 알림을 실행하고, 결과는 다음 `PreInvocation`에 들어갑니다.
- `Stop`은 활성 goal에 끝나지 않은 task가 있으면 에이전트가 작업을 계속하게 합니다. `SubagentStop`은 없습니다.

skill은 `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory`, `/dag`로 호출합니다. workflow는 Antigravity 플러그인의 구성요소가 아닙니다. 루트 `mcp_config.json`은 [DAG 패널](#dag-panel)용 `pota-dag` MCP 서버를 등록합니다. 어댑터는 Antigravity hook 문서를 따른 것이며, 실제 `agy` 세션 안에서의 동작은 아직 확인하지 않았습니다.

## Locale Policy

Pota의 재사용 지침은 전역 사용을 위해 영어로 작성됩니다. 사용자에게 보이는 출력과 생성 또는 갱신되는 문서, 계획, 메모리 산출물은 사용자가 다른 언어를 명시하지 않는 한 설정된 OS locale을 따릅니다. 여기에는 `MEMORY.md`, `PLAN.md`, `docs/memory`, `docs/plan` 내용이 포함됩니다. CLI는 `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de`, `pt`의 일반 메시지를 현지화하고, 지원하지 않는 locale은 영어로 fallback합니다. Codex hook `statusMessage` 텍스트는 정적 영어로 유지하고, hook command output은 영어 또는 한국어입니다.

## Delegation

- `explorer`: 가능한 경우 read-only codebase discovery, impact analysis, pattern search, read-only verification을 처리합니다.
- `worker`: 명확한 file ownership이 있는 실제 implementation edit 또는 verification task를 처리합니다.
- Main session: orchestrate, verify, evidence 기록을 맡으며, 다음 단계가 즉시 결과에 의존하는 urgent non-implementation blocking work만 로컬에서 처리합니다. 다만 subagent 도구가 없으면 main agent가 implementation을 직접 인계합니다.

모든 delegation prompt는 TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT 여섯 섹션을 사용합니다.
