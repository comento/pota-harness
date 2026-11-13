# Pota Harness

Pota Harness는 Codex, Claude Code, Antigravity를 위한 토큰 효율적인 멀티에이전트 하네스 플러그인입니다.

[English](README.md)

핵심 아이디어는 hooks, 지속 상태, 명시적 계획, 집중 위임, 종료 시점 가드 같은 유용한 에이전트 하네스 동작을 유지하는 것입니다. Pota는 반복적인 TDD 검증 루프를 기본값으로 삼지 않습니다. 대신 작업을 작은 모듈 작업으로 나누고 두 가지 검증 게이트로 증명합니다.

1. 모듈 수용 검증: 변경된 모듈 계약을 증명합니다.
2. 표면 통합 검증: CLI, HTTP, 브라우저, 파일 산출물 같은 실제 표면을 통해 동작을 증명합니다.

외부 상태를 변경할 수 있는 작업은 실행 전에 가장 가까운 dry-run 또는 check 모드를 기록하고 실행합니다. 검증은 제한됩니다. 기본적으로 각 작업은 두 번의 검증 패스를 가지며, 이후에는 반복 루프를 계속하지 않고 blocker를 기록하거나 작업을 sub-task로 나눕니다.

Pota는 도구 준비 상태도 작업의 일부로 다룹니다. LSP, typecheck, lint, dry-run, 검증 도구를 저장소 스택 기준으로 확인합니다. 누락 도구는 명시적 승인과 고정된 지원 installer가 모두 있을 때만 설치하고, 그렇지 않으면 blocker로 보고합니다.

## Complexity Triage

모든 구현 작업은 agent, plugin, delegated workflow 지침을 적용하기 전에 먼저 complexity triage를 거칩니다. triage는 사용자에게 묻지 않고 저장소 탐색, 예상 변경 범위, 위험 신호를 기준으로 결정합니다.

- Light Path: 기존 아키텍처 레이어 안의 좁은 변경입니다. 기본값이지만, 사용자가 호출한 main agent는 여전히 orchestration을 맡고 subagent 도구가 있으면 구현 편집을 하나의 제한된 `worker`에 위임한 뒤 검증 게이트를 유지합니다.
- Heavy Path: 새 디렉터리/모듈/레이어, 새 도메인 모델/서비스/추상화, 보안/세션/인증, 외부 API/message queue/payment, DB schema/migration, concurrency/transaction/cache 변경, 여러 도메인 리팩터링, 또는 사용자의 extra-care 요청입니다.

선택된 path와 근거는 계획 산출물이 있을 때 `docs/plan/<topic>.md`에 기록합니다. Light Path에서도 두 검증 게이트는 유지됩니다. subagent 도구가 없으면 main agent가 implementation을 직접 인계하고, 그 takeover를 evidence에 기록합니다.

Pota는 task 성격에 따라 task별 model(fast `haiku`, balanced `sonnet`, stronger `opus`, strongest `fable`)을 정하고 reasoning effort도 라우팅합니다. `MEMORY.md`나 계획에 `Model routing: inherited`를 적으면 작업별 model 선택이 꺼집니다. Light 계획·구현·검증은 `medium`, Heavy 계획·검토·구현은 `high`, 최종 검증·검토는 `xhigh`를 요청합니다. Requested는 Pota가 원하는 profile이고 Effective는 dispatch 결과가 확인한 적용값입니다. 새 task/worker dispatch마다 정한 model과 요청 effort를 host option으로 반드시 넘깁니다(Claude Code: Agent `model`/`effort`, `fork` 금지). Effective는 넘긴 값이고, 넘기지 않았으면 `not-applied: <사유>`, host에 option이 없을 때만 `inherited`입니다. Host capability는 노출된 interface 또는 dispatch 응답으로만 판단하고, Pota가 option을 통합/사용하지 않기로 한 선택과 host 미지원은 구분합니다. path가 바뀌면 plan artifact, 저장소 goal task roadmap, native UI plan, effort profile을 함께 동기화하고 완료 profile은 보존하며 미완료 profile은 재계산합니다.

subagent 도구가 progress-reporting channel을 제공하면 subagent는 작업 시작, 방향 결정/확인, 주기적 진행, 완료 시점에 orchestrator에게 상태를 보고합니다. orchestrator는 받은 status event를 즉시 사용자에게 전달합니다. mid-run reporting channel이 없으면 orchestrator는 할당, 대기, 최종 완료처럼 관측 가능한 event를 사용자에게 전달합니다.

위임받은 subagent는 작업을 마치면 퇴근 전에 final report를 남깁니다. orchestrator가 final report와 evidence를 회수한 뒤 완료된 subagent를 close/release합니다. 그 다음 orchestrator가 final report와 evidence를 검토한 뒤 작업 완료 여부를 판단합니다.

## Tool Readiness

`pota toolcheck`는 현재 저장소에서 JavaScript, TypeScript, Python, PHP, Java, Kotlin, Swift, Go, Rust 스택을 감지하고, 해당 LSP와 검증 도구를 확인합니다.

```sh
pota toolcheck --root .
# 명시적 승인을 받은 경우에만:
pota toolcheck --install --yes --root .
```

- `toolcheck`는 감지된 스택과 누락 도구를 보고합니다.
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
- `docs/memory/*.md`: 도메인별 상세 지식. 각 노트는 H1 아래에 한 줄 `Summary:`(120자 이하)를 두며, 색인과 hook이 이 줄을 보여 줍니다.
- `PLAN.md`: 작업 계획의 짧은 색인. `## Active Plans`와 `## Completed Plans` 아래에 계획당 200자 이하 한 줄을 둡니다. 계획 규칙은 `PLAN.md`가 아니라 `pota-plan` 스킬에 있습니다.
- `docs/plan/*.md`: 상세 실행 계획.
- `docs/plan/ARCHIVE.md`: `pota plan index --archive`가 `PLAN.md`에서 옮긴 오래된 완료 항목을 최신순으로 보관하고, 예전 `## Planning Rules` 절의 본문은 `## Legacy Planning Rules` 아래에 둡니다. 첫 `## ` 제목 앞의 목록 줄은 색인된 것으로 셉니다.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json`: 중단 재개와 범위가 제한된 종료 게이트에 쓰는 사용자 홈의 프로젝트/워크트리별 활성 goal/task/증거 상태입니다. 프로젝트 작업 트리는 런타임 상태를 소유하지 않습니다.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl`: 완료·취소된 goal마다 요약 레코드 하나를 남기며(worktree당 최신 200개), `goal stats --history`가 읽습니다.

`## Completed Plans`는 최신 항목이 위에 오도록 유지합니다. `pota plan index --archive`는 앞의 20개 항목을 남기고 나머지를 아무것도 지우지 않고 `docs/plan/ARCHIVE.md`로 옮기므로, 오래된 순으로 쌓은 목록에서는 최신 계획이 보관됩니다. 먼저 `--dry-run`으로 확인하세요. 기존 `MEMORY.md`/`PLAN.md`는 마이그레이션 없이 동작합니다. `init`은 기존 파일을 다시 쓰지 않고, `check`는 예전 형식을 경고로만 알립니다.

`SessionStart`에서 hook은 어떤 메모리 노트가 있는지(이름과 `Summary:`, 목록이 길면 이름만 나열한 한 줄)를 에이전트에게 알리고, 활성 goal이 없으면 계획 색인 한 줄(계획 수, 진행 중 계획, 최근 완료 계획, 있으면 `docs/plan/ARCHIVE.md`)을 덧붙입니다. 활성·일시정지·차단 goal이나 다른 session이 소유한 goal이 있으면 메모리 목록만 싣고, 다른 session의 캡슐에는 계획 이름을 넣지 않습니다. goal이 없을 때의 `UserPromptSubmit`은 노트 개수를 알리는 한 문장만 더합니다. hook은 색인 파일과 디렉터리 목록만 읽고 노트 본문은 읽지 않으며 아무것도 쓰지 않습니다. 노트와 계획이 없는 저장소의 hook 출력은 이전과 같습니다.

`pota-work`는 `goal finish` 전에 goal마다 한 번 메모리 승격 결정을 계획의 Evidence에 기록합니다. 다시 쓸 저장소 지식이 생겼으면 `Memory promotion: docs/memory/<domain>.md`, 아니면 `Memory promotion: none: <reason>`입니다. 결정 기록은 필수이고 노트 작성은 선택입니다. goal이 완료됐는데 계획 파일에 채워진 `Memory promotion:` 줄이 없으면 `goal finish`와 `goal complete`가 stderr에 한 줄 알림을 내며, exit code와 stdout은 바뀌지 않습니다.

런타임 script, template, command, agent, model guidance는 설치된 canonical runtime `~/.pota/install/runtime/<version>/`에 유지합니다. 각 표면의 locator가 같은 설치본을 가리키므로 대상 저장소에 Pota 내부 파일을 복사하지 않습니다. 공유 런타임 또는 locator가 없거나 읽을 수 없거나 불일치하면 이를 가리키는 모든 mirror 사용을 중단하고 게시 패키지에서 `bunx @comento/pota-harness@latest doctor` 후 `bunx @comento/pota-harness@latest upgrade`를 실행해 복구합니다. 다른 host mirror나 대상 저장소를 복구 원본으로 사용하지 않습니다.

## Commands

게시된 패키지는 `bunx` 또는 전역 설치된 `pota` 명령으로 실행할 수 있습니다.

```sh
bunx @comento/pota-harness@latest install
bunx @comento/pota-harness@latest upgrade
bunx @comento/pota-harness@latest doctor
bunx @comento/pota-harness@latest uninstall
bunx @comento/pota-harness@latest toolcheck
```

전역 설치 후에는 짧은 명령도 사용할 수 있습니다.

```sh
bun add -g @comento/pota-harness
pota install
pota upgrade
pota doctor
pota uninstall
pota toolcheck
pota auto-upgrade status
```

- `pota install [--hosts all|codex,claude,antigravity]`: canonical runtime을 `~/.pota/install/` 아래에 설치하고, 선택한 호스트에 대해 Codex marketplace source, versioned Codex runtime cache, Pota-owned config section, Claude Code mirror와 플러그인, 현재 Antigravity IDE/CLI skill 표면을 transaction으로 설치합니다. `--hosts`가 없으면 터미널에서 처음 설치할 때 호스트를 묻고, 비대화형 실행과 CI는 모든 호스트를 설치합니다.
- `pota upgrade [--hosts all|codex,claude,antigravity]`: ownership manifest의 installed digest와 현재 값이 같은 항목만 교체하며, staged validation과 역순 rollback을 적용합니다. `--hosts`로 바꾸지 않으면 기록된 호스트를 유지하고, 다른 버전을 담은 Claude Code 플러그인 캐시를 갱신합니다. 설치본 버전이 이 CLI보다 높으면 `install`과 `upgrade`는 아무것도 바꾸지 않고 거부하며, 그래도 이 CLI 버전으로 내리려면 `--allow-downgrade`를 붙입니다.
- `pota doctor`: 첫 줄에 `Hosts: <ids>`를 출력한 뒤 선택된 호스트의 ownership manifest, managed digest, 유효 Codex feature, 실제 plugin installed/enabled/version(`Claude plugin cache version` 포함), mirror/runtime locator를 수정 없이 진단합니다.
- `pota uninstall`: 먼저 config 외 모든 ownership manifest 항목을 설치 digest와 대조하고, 수정되거나 삭제된 managed artifact가 하나라도 있으면 아무것도 바꾸지 않고 uninstall 전체를 거부합니다. 그렇지 않으면 managed 항목과 유예 중인 runtime을 제거·복원하고 빈 managed scaffold를 정리하며, unmanaged target과 그 상위 디렉터리는 보존하고 commit 전 실패는 rollback합니다. `~/.pota/update/`도 지우며 `~/.pota/config.json`과 `~/.pota/projects/`는 남깁니다. legacy 레이아웃 설치는 이전하지 않고 그 자리에서 제거합니다.
- `pota auto-upgrade status|on|off|run`: `status`는 설정, 설치 버전, 마지막 확인, 대기 중인 알림을 JSON으로 출력합니다. `on`과 `off`는 `~/.pota/config.json`에 `autoUpgrade`를 쓰고 같은 보고를 출력합니다. `run`은 하루 주기와 backoff를 무시하고 지금 npm을 확인해 결과를 출력합니다. exit 0은 성공, 1은 실행 오류 또는 실패한 실행, 2는 사용법 오류입니다.
- `pota toolcheck`: 저장소 스택과 필요한 LSP·검증 도구를 확인하며, 승인된 지원 installer만 실행합니다.
- `pota cleanup --root <repo>`: 기본값은 legacy 프로젝트 로컬 `.pota` 잔여물을 읽기 전용으로 보고합니다. `--yes`는 유효한 활성 상태를 사용자 홈 저장소로 조정·이관하고 알려진 상태/lock/tool 잔여물만 제거하며, 알 수 없는 파일은 보존하고 비었을 때만 디렉터리를 정리합니다. `state.lock`은 이 host에서 owner 프로세스가 종료된 유효한 lock 레코드일 때만 삭제하고, 격리된 `state.lock.stale.*` 파일은 유효한 레코드의 nonce가 파일 이름과 일치할 때만 삭제합니다. owner가 살아 있거나 다른 host의 lock, 파싱할 수 없는 lock은 보존하고 `preservedReasons`에 사유를 남깁니다. `--help`와 `--version`은 exit 0, 사용법 오류는 exit 2, 실행 오류는 `Pota cleanup error:` 한 줄과 exit 1입니다.
- `pota goal ...`: 저장소의 영속 goal을 시작·조회·일시정지·재개·차단·취소·완료합니다. `goal claim --session <id>`는 같은 작업을 이어받는 session(재개·압축·handoff·fork)에 미완료 goal의 소유권을 넘기며, 미완료 goal 중에 들어온 새 작업은 goal을 취소하지 않고 `goal replan`으로 합칩니다. 기본 tool-bound 정책은 `goal verify -- <argv>`가 명령을 직접 실행해 성공 증거를 기록합니다. `goal receipt`는 기존 선언 증거를 가져오는 호환 명령입니다. 모든 `goal` 하위 명령에서 `--root`는 선택이며, 생략하면 `HARNESS_REPO_ROOT`, 없으면 cwd에서 가장 가까운 `.git` 상위 디렉터리로 결정됩니다. `goal verify --kind "moduleAcceptance|surfaceIntegration" -- <argv>`는 한 번 실행으로 kind마다 receipt를 기록하며, evidence scope는 `task`와 `goal`뿐입니다. `goal finish [--watch "<path|path>"] [--timeout-ms N] -- <argv>`는 active task를 완료하고(필수 증거가 fresh여야 함) argv를 한 번 실행해 goal requiredEvidence의 모든 kind(기본 `finalReview`)를 goal scope로 기록한 뒤 goal을 완료합니다. 이 goal scope 증거가 모든 task receipt 이후에 기록되면 이전 task 검사를 다시 실행하지 않습니다. `goal stats`는 현재 goal의 receipt 수, 재실행, stale receipt를 JSON으로 출력합니다. `goal stats --history [--limit N]`은 저장소의 모든 worktree에서 끝난 goal을 집계합니다: 완료·취소 수, 소요 시간 중앙값과 p90, task·receipt 중앙값, 재실행 비율, 메모리 승격 결정 수, 완료 goal이 4개 이상일 때의 이전/최근 `trend`, 최근 goal 목록입니다. 이력이 없으면 `{"schemaVersion":1,"scope":"repository","goals":0}`을 출력합니다. `completionCriteria`(`goal start --criteria`)는 `advisory`입니다. Pota는 이를 기록만 하고 강제하지 않으며, 완료는 필수 증거로만 판정합니다. task는 `dependsOn`(생략 시 이전 task)과 `writeScope`를 선언하고, `goal ready`는 active/ready/blocked task id를 출력하며, write scope가 겹치지 않는 ready task는 같은 worktree에서 최대 4개까지 병렬로 active가 될 수 있습니다.
- `pota memory check|index [--root <repo>]`: `check`는 `MEMORY.md`와 `docs/memory/*.md`를 대조해 JSON 보고서 하나를 출력합니다. 미색인 노트, 죽은 링크, 중복, 오래된 요약, 요약의 제어문자, 안전하지 않은 경로가 있으면 exit 1이고, 경고는 `--strict`에서만 실패합니다. 항목은 `## Domain Knowledge` 아래의 목록 줄입니다(그 절이 없는 예전 파일은 모든 목록 줄). 다른 절의 노트 링크는 언급이며 `index`가 다시 쓰지 않습니다. `index`는 빠진 노트를 추가하고 `Summary:`가 바뀌면 링크 뒤의 요약 부분만 바꾸며(링크가 여럿인 줄은 그대로 둠), 그 절 안에서 Pota placeholder 줄만 정확히 일치할 때 제거하고 항목이나 죽은 링크는 지우지 않으며 나머지 내용은 바이트 단위로 보존합니다. `--dry-run`으로 미리 볼 수 있습니다. 삽입 지점이 닫히지 않은 코드 펜스 안이면 `index`는 아무것도 쓰지 않고 `unclosed-fence`로 exit 1입니다. 사용법 오류는 exit 2이고, 하위 명령 없는 `pota memory`는 기존 안내문을 출력합니다.
- `pota plan check|index [--archive] [--root <repo>]`: `PLAN.md`와 `docs/plan/*.md`에 같은 검사와 색인을 적용하며, 항목은 제목이 `Plans`로 끝나는 `## ` 절(`## Superseded Plans` 등)의 목록 줄입니다. `index`는 체크박스가 모두 체크된 계획을 `## Completed Plans` 맨 위에, 그 밖의 계획을 `## Active Plans`에 넣습니다. 줄을 옮기는 것은 `--archive`뿐이며, 최신 20개를 넘는 완료 항목(들여쓴 문단 포함)과 예전 `## Planning Rules` 절의 본문을 `docs/plan/ARCHIVE.md`로 옮깁니다. `check`는 `## Completed Plans`가 20개를 넘거나 예전 `## Planning Rules` 절이 남아 있으면 경고합니다.
- `pota-memory`: 도메인 지식을 탐색하고 `Summary:` 줄이 있는 노트를 쓰며 `MEMORY.md` 색인을 유지합니다.
- `pota-plan`: 관련 메모리 노트와 관련 완료 계획(최대 3개)을 재활용한 뒤 `docs/plan/` 아래에 decision-complete plan을 만듭니다.
- `pota-work`: 현재 `PLAN.md`의 다음 모듈 작업을 실행하고 두 검증 게이트를 확보합니다.
- `pota-review`: 계획, memory, 증거를 기준으로 완료된 작업을 검토합니다.

모든 `UserPromptSubmit`에서 Pota는 구현 또는 계속 실행 요청 자체가 goal 생성 권한이며 사용자가 “goal”을 직접 말할 필요가 없다는 모델 가시 지침을 주입합니다. 에이전트는 먼저 트리아지를 active task로 둔 초기 저장소 계획을 작성하고, 탐색·트리아지 전에 가능한 경우 Codex `update_plan`과 `create_goal`로 같은 roadmap을 UI에 표시한 뒤 저장소 Pota goal을 시작합니다. 트리아지 결과로 두 계획을 decision-complete 구현 계획으로 갱신한 뒤에만 구현합니다. 활성 goal은 전체 순서형 roadmap, 각 상태, 현재 task를 hook 컨텍스트에 유지하므로 곁가지 질문 뒤 원래 작업으로 돌아갈 수 있습니다. 상담·설명·계획 전용 요청은 goal 없이 처리합니다.

토큰 효율 실행에서는 구현보다 먼저 요구사항·불변식·경계·실패 모드로 집중 실행 test contract를 설계하는 데 추론을 배분합니다. 구현에는 실패 계약과 제한된 파일 범위만 전달하고 통과에 필요한 최소 변경을 요구합니다. 성공 여부는 도구 exit code와 기계적 요약으로 판정하며 성공 출력은 축약하고 실패할 때만 컨텍스트를 확장합니다. 명시적 `--watch`가 없으면 Git fingerprint는 ignored file을 제외하므로 주장에 필요한 ignored artifact는 각각 `--watch <path>` 또는 명시적인 상위 디렉터리로 지정해야 합니다. package 검증 전 lifecycle script를 검사하고 기본적으로 정상 `npm pack --dry-run`을 실행합니다. content-producing 또는 미분류 script에는 `--ignore-scripts`를 사용하면 안 되며, script가 없거나 content-neutral임을 입증했고 전체 검사 증거가 여전히 유효할 때만 사용할 수 있습니다. 성공한 상태 변경은 `--quiet`를 지원하므로 커지는 goal JSON이 대화 토큰을 소모하지 않습니다.

`install`과 `upgrade`는 custom marketplace lifecycle을 유지하며 `codex plugin add`를 호출하지 않습니다. candidate를 staging에서 검증한 뒤 commit하고, 현재 managed destination과 digest를 ownership manifest에 기록하며 실패 시 완료된 phase를 역순 rollback합니다. 수정되었거나 ownership manifest에 기록되지 않은 artifact는 보존한 채 거부합니다. Pota-owned TOML section만 편집하고 public feature/agent 설정은 강제하지 않습니다. lifecycle command는 교체 대상인 `~/.pota/install/` 아래 설치본이나 Codex plugin cache가 아니라 게시/전역 package에서 실행해야 합니다.

Clean uninstall은 모든 managed scaffold가 비었을 때만 recursive 삭제 없이 빈 디렉터리 제거로 `~/.pota/install/`과 Codex cache root `$CODEX_HOME/plugins/cache/pota`를 정리합니다. 소스 저장소와 저장소의 `MEMORY.md`/`PLAN.md`, 사용자 홈 Pota goal 상태, 전역 `@comento/pota-harness` package, package-manager download cache, legacy backup, 현재 ownership manifest 밖의 legacy shared setting은 지우지 않으며 별도의 명시적 정리 판단이 필요합니다.

Codex는 `skills/`와 `commands/`를 사용합니다. Claude Code는 `~/.claude/` 아래의 mirror command·agent definition과 Claude Code 플러그인 `pota@pota`를 사용합니다. Antigravity는 `.agents/workflows`와 global skills mirror를 사용합니다.

Claude Code 플러그인은 Pota가 소유한 로컬 marketplace `~/.pota/install/claude`에 생성되며, Pota skill 4개와 SessionStart·UserPromptSubmit·PostToolUse·Stop·SubagentStop hook을 담습니다. hook은 canonical runtime을 절대경로로 호출합니다. 파일 commit 뒤 `pota install`/`upgrade`가 `claude plugin marketplace add`와 `claude plugin install pota@pota --scope user`로 등록하므로 다음 세션부터 Claude Code 터미널·데스크톱 앱·IDE 플러그인 목록에 표시됩니다. `claude` CLI가 없으면 등록을 건너뛰고 수동 명령을 안내하며, 이미 `pota`라는 다른 marketplace가 있으면 건드리지 않습니다. `pota uninstall`은 파일 제거 전에 Pota 소유 marketplace만 등록 해제하고, uninstall이 rollback되면 다시 등록합니다. Claude Code 플러그인 캐시에 다른 버전이 있으면 `pota upgrade`가 `claude plugin marketplace update pota`와 `claude plugin update pota@pota --scope user`로 갱신합니다. 갱신에 실패하면 업그레이드된 설치는 그대로 두고 수동으로 마칠 명령을 출력하며 exit 1입니다. `pota doctor`는 `Claude plugin files`, `Claude plugin registered`, `Claude plugin enabled`, `Claude plugin cache version`을 보고합니다.

## Install Layout And Auto-Upgrade

Pota는 설치본을 `POTA_HOME`(기본 `~/.pota`) 아래에 둡니다. `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`, `CODEX_CONFIG_PATH`는 여전히 각 호스트 경로를 따로 정합니다.

```text
~/.pota/
  install/                  lifecycle 관리 파일
    lifecycle.json          ownership manifest (schema 2: hosts, origin, 유예 runtime)
    lifecycle.lock, transaction.json, transactions/
    runtime/<version>/      모든 runtime locator와 Claude Code hook이 쓰는 canonical runtime
    codex/                  Codex 로컬 marketplace source
    claude/                 Claude Code 로컬 marketplace
  projects/                 goal 상태
  config.json               사용자 설정 ("autoUpgrade")
  update/                   자동 업그레이드 상태
$CODEX_HOME/plugins/cache/pota/pota/<version>/   Codex 플러그인 캐시 사본 (Codex를 선택했을 때만)
```

- 호스트: `--hosts`는 `install`과 `upgrade`에서만 받으며 값은 `all` 또는 `codex`, `claude`, `antigravity`의 쉼표 목록입니다. 선택은 ownership manifest에 기록되고 `upgrade`, `doctor`, `uninstall`이 따릅니다. `pota upgrade --hosts <list>`는 호스트를 추가하고 빠진 호스트를 제거합니다(빠지는 호스트의 관리 파일이 수정됐으면 거부). 대화형 prompt는 전체(기본), Claude Code만, Codex만, Antigravity만, 쉼표 목록을 제시하며 아직 아무것도 설치되지 않았을 때만 나옵니다.
- 유예: 버전이 바뀌는 업그레이드는 직전 canonical runtime과 Codex 캐시 사본을 3일 동안(종류별 최대 3개) 남겨, 업그레이드 전에 시작한 세션이 계속 동작하게 합니다. 기간이 지난 것은 다음 install이나 upgrade가 제거하고, uninstall은 모두 제거합니다. 새 버전과 같거나 높은 Codex 캐시 사본은 남기지 않습니다. Codex는 캐시에서 가장 높은 버전을 로드하기 때문입니다.
- 자동 업그레이드: 기본으로 켜져 있습니다. 24시간에 한 번 이하로(설치·업그레이드 직후 24시간은 제외) `SessionStart`가 분리 프로세스를 시작합니다. 이 프로세스는 npm에서 `@comento/pota-harness` 최신 버전을 읽고, 그 정확한 버전을 `--ignore-scripts`로 `~/.pota/update/stage/`에 설치해 검증한 뒤, 그 패키지의 `pota-lifecycle.mjs upgrade --auto`를 실행합니다. major를 포함한 모든 새 버전을 적용하며 다운그레이드하지 않습니다. 다음 `SessionStart`는 결과를 한 줄로 한 번만 알립니다: `updated`, `failed`, `manual`(설치됐지만 Claude Code 플러그인 캐시에 `claude plugin update pota@pota`가 필요함). npm 조회·설치 실패는 알림 없이 backoff하고, 업그레이드 실패는 backoff하며 버전마다 한 번 알립니다. git 체크아웃에서 설치한 설치본(`origin: "checkout"`)과 소스 체크아웃 실행에서는 동작하지 않습니다.
- 끄기: `pota auto-upgrade off`, `POTA_AUTO_UPGRADE=0`(`false`, `off`, `no`도 가능), 또는 `~/.pota/config.json`의 `"autoUpgrade": false`. 읽을 수 없는 `config.json`도 자동 업그레이드를 끕니다. 상태와 마지막 실행 출력은 `~/.pota/update/`(`state.json`, `notice.json`, `last-run.log`, `update.lock`, `stage/`)에 있습니다.

## Antigravity Compatibility

Antigravity는 `/workflow-name`으로 호출되는 `SKILL.md` 기반 Agent Skills와 Workflows를 지원합니다. Pota는 해당 표면에 다음 경로를 설치합니다.

- Antigravity IDE: `~/.gemini/config/skills/pota-*/SKILL.md`.
- Antigravity CLI: flat `~/.gemini/antigravity-cli/skills/pota-*.md` skill 파일.

Codex 전용 hooks는 Antigravity로 포팅하지 않습니다. 대신 같은 planning, memory, complexity triage, two-gate verification 절차가 Skills와 Workflows를 통해 실행됩니다. 경로를 바꾸려면 `ANTIGRAVITY_HOME` 또는 `ANTIGRAVITY_CLI_HOME`을 설정하세요.

## Locale Policy

Pota의 재사용 지침은 전역 사용을 위해 영어로 작성됩니다. 사용자에게 보이는 출력과 생성 또는 갱신되는 문서, 계획, 메모리 산출물은 사용자가 다른 언어를 명시하지 않는 한 설정된 OS locale을 따릅니다. 여기에는 `MEMORY.md`, `PLAN.md`, `docs/memory`, `docs/plan` 내용이 포함됩니다. CLI는 `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de`, `pt`의 일반 메시지를 현지화하고, 지원하지 않는 locale은 영어로 fallback합니다. Codex hook `statusMessage` 텍스트는 정적 영어로 유지하고, hook command output은 영어 또는 한국어입니다.

## Delegation

- `explorer`: 가능한 경우 read-only codebase discovery, impact analysis, pattern search, read-only verification을 처리합니다.
- `worker`: 명확한 file ownership이 있는 실제 implementation edit 또는 verification task를 처리합니다.
- Main session: orchestrate, verify, evidence 기록을 맡으며, 다음 단계가 즉시 결과에 의존하는 urgent non-implementation blocking work만 로컬에서 처리합니다. 다만 subagent 도구가 없으면 main agent가 implementation을 직접 인계합니다.

모든 delegation prompt는 TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT 여섯 섹션을 사용합니다.
