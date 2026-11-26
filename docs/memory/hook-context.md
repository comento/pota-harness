# Domain: hook-context

Summary: hook 캡슐의 상태별 내용·문자 예산, 호스트별 hook 배선, SessionStart 이전 알림, MEMORY.md/PLAN.md 인덱스 형식·검사. hook 문구나 인덱스 CLI를 바꿀 때 읽는다.
Paths: scripts/pota-state*.mjs, scripts/pota-index.mjs, hooks/hooks.json, hooks/codex.json, hooks.json

## Scope

hook 진입점 `scripts/pota-state.mjs`, Antigravity 어댑터 `scripts/pota-state-antigravity.mjs`, 순수 렌더링 `scripts/pota-state-context.mjs`, 인덱스 검사·재생성·hook snapshot `scripts/pota-index.mjs`, 등록 `hooks/hooks.json`(Claude), `hooks/codex.json`(Codex), 루트 `hooks.json`(Antigravity). goal 상태 자체는 `goal-state.md`, 플러그인 배치와 1.x 설치본 이전 runner는 `lifecycle-install.md`.

## Facts

### 이벤트와 캡슐

- Claude·Codex hook은 5개다: SessionStart, UserPromptSubmit(UPS), PostToolUse(편집 도구 matcher), Stop, SubagentStop. 모두 `pota-state.mjs <event> <claude|codex>`, timeout 10초. 두 파일은 `modules`, 루트 변수(`${CLAUDE_PLUGIN_ROOT}`/`${PLUGIN_ROOT}`), 끝 토큰만 다르다. Antigravity는 `SessionStart`·`PreInvocation`·`PostToolUse`·`Stop` 4개가 어댑터를 부르고, UPS 캡슐은 `invocationNum === 0`인 `PreInvocation`이 `injectSteps`로 넣으며 SubagentStop은 없다. 출처: `hooks/hooks.json`, `hooks/codex.json`, `hooks.json`, `test/plugin-manifests.test.mjs`, `test/antigravity-hooks.test.mjs`.
- 모든 캡슐은 `Pota kernel: root MEMORY.md is optional; read it when present.`(ko 판 있음)로 시작한다. 이 문장은 테스트가 고정한다. 출처: `pota-state-context.mjs:96-98`, `test/token-efficiency.test.mjs` "hook context is a compact phase capsule without dropping recovery state", `test/goal-state.test.mjs` "automatic context hooks do not initialize an uninitialized repository".
- 상태별 본문(`pota-state-context.mjs:34-131`):
  - idle: pota-plan 로드 지침. UPS에는 대상이 확정된 Git/GitHub 작업과 상담은 goal 없이 처리한다는 문장이 붙는다.
  - active: plan id, task roadmap(3개 이하면 전부, 넘으면 개수 요약과 현재 위치), current task. UPS에만 곁가지 질문 뒤 복귀 문장이 붙는다.
  - active인데 실행 중 task가 없고 ready task가 모두 수동 승인 게이트(`approvalGate`)에 걸린 경우(2.3.0): `Current:` 줄과 UPS 복귀 문장을 싣지 않고 `Awaiting user approval: <ids>. Do not release the gate yourself; …` 한 줄을 붙인다(ko `사용자 승인 대기: …`). 해제 명령은 캡슐에 넣지 않는다. 예산이 모자라면 id 목록을 `+N more`로 줄인다. 출처: `pota-state-context.mjs` `approvalGateLine`, `test/goal-state.test.mjs` "gated ready tasks are never presented as work to continue and the capsule leaves the gate to the user".
  - paused/blocked: plan·task·blocker와 "자동으로 상태를 바꾸지 말고 `goal resume`".
  - foreign(다른 session 소유): goal·plan·task 상세 없이 fail-closed 문장과 `goal claim --session` 안내. 2.6.0부터 그 goal과 무관한 새 요청은 goal을 건드리지 않고 Quick Path로 처리할 수 있다는 문장을 함께 싣는다(끝나지 않은 goal이 새 대화의 작은 요청까지 막던 문제).
- SessionStart 끝에는 `Pota CLI: node "<이 플러그인 사본의 scripts/pota.mjs>" goal <command>` 한 줄이 붙는다. 경로는 hook이 실행될 때마다 `import.meta.url`로 계산하고 어디에도 저장하지 않는다(`cliPrefixLine`). skill은 이 줄에서 `pluginRoot`를 얻으므로 줄이 없으면 hook이 꺼진 것으로 본다(Codex에서 `/hooks` 승인 전이 대표적). 저장소 경로는 넣지 않는다. 0.3.0 배포 전, 깊은 경로 worktree에서 절대 경로 2개 때문에 blocked 캡슐이 637자로 620 예산을 넘은 적이 있다. 출처: `scripts/pota-state.mjs` `cliPrefixLine`, `test/session-start-migration.test.mjs` "the hook CLI names the pota.mjs beside it and starts nothing without a known host argument", `docs/plan/release-0.3.0.md` Evidence.
- SessionStart 이전 알림: 캡슐을 만든 뒤 `withMigrationNotice`가 1.x npm 설치본 감지(`sessionStartMigration`)를 부르고, 알림이 있으면 캡슐 맨 끝에 한 줄을 붙이고 같은 줄을 `systemMessage`에도 넣는다(`appendNotice`). 종류는 "제거 중"(runner를 띄운 세션), "제거함"(보고서당 한 번), `blocked`(7일에 한 번), `symlinked-path`이고 en·ko 판이 있다. host 인자가 `claude|codex`(어댑터는 `antigravity`)일 때만 동작하고 UPS에는 싣지 않는다. Antigravity는 `systemMessage` 통로가 확인되지 않아 같은 줄을 주입 문장에 한 번 합친다(`contextText`). 출처: `scripts/pota-state.mjs` `withMigrationNotice`, `test/session-start-migration.test.mjs`, `test/antigravity-hooks.test.mjs` "SessionStart injects the legacy-migration notice for the antigravity host". 감지·실행 조건은 `lifecycle-install.md`.
- 이 단계의 오류는 모두 삼켜서 캡슐·exit code·"could not read goal state" 실패 결과를 바꾸지 않는다. manifest가 없으면 캡슐은 바이트 단위로 같고 아무것도 쓰지 않는다. 출처: `test/session-start-migration.test.mjs` "without a legacy manifest SessionStart keeps the capsule and writes nothing", "an error in the migration step leaves the capsule and status unchanged".
- SessionStart main 모델 줄: payload `model`이 stronger 미만(fast·balanced)으로 분류될 때만 `Pota CLI:` 줄 뒤, 이전 알림 줄 앞에 `Pota main model: <model> (<tier> tier, …)` 1줄을 붙인다(접두는 두 locale 공통 영문, model 40자 clip). 사용자 `systemMessage` 알림은 기록이 새로 쓰이거나 모델이 바뀐 때 1회이고, 세션 키가 없으면 매번이다. 이전 알림과 겹치면 `systemMessage`는 `"<main 모델 알림>\n<이전 알림 줄>"`이다(`appendNotice`가 기존 값을 합친다). UPS는 캡슐에 싣지 않고 기록만 동기화하며 알림만 1회 낸다. stronger 이상·미지의 값·필드 없음·`agent_id` payload는 출력이 바이트 단위로 같고 낮은 tier일 때만 worktree 상태 디렉터리를 만든다. 이 단계의 오류는 삼킨다. `POTA_MAIN_MODEL_GATE`가 `0|false|off|no`면 이 단계 전체를 건너뛰어 출력이 `model` 없는 payload와 같고 쓰기가 없다. 다만 `model`이 있는 UPS는 게이트와 무관하게 진입점에서 상한을 해석하므로 `config.json`을 읽기만 한다. 출처: `scripts/pota-state.mjs` `withObservedMainModel`, `pota-state-context.mjs` `mainModelLine`·`mainModelNotice`·`appendNotice`, `test/main-model-gate.test.mjs` "SessionStart with a below-stronger model adds the main-model line after the Pota CLI line, mirrors a notice, and records the session", "SessionStart with a stronger, strongest, unknown, or absent model is byte-identical and creates no Pota home", "a repeated SessionStart keeps the line but notifies once; a later stronger model clears the record", "UserPromptSubmit never adds main-model context and syncs the record from a Codex model field", "subagent payloads and payloads without a session id never record", "POTA_MAIN_MODEL_GATE off makes a below-stronger hook payload identical to one without a model and writes nothing". 게이트는 `delegation-model-routing.md`.
- SessionStart 모델 상한 줄: 상한이 설정돼 있으면 `Pota CLI:` 줄 뒤, `Pota main model:` 줄 앞에 `Pota model ceiling: <tier> (Claude Code …, Codex …, Antigravity …). …` 1줄을 붙인다(접두는 두 locale 공통 영문, 세 호스트 값을 함께 적는다). 순서는 `Pota CLI:` → `Pota model ceiling:` → `Pota main model:` → 이전 알림이고 idle·active·paused·blocked·foreign 모두 같다. `POTA_MAIN_MODEL_GATE`가 꺼져 있어도 나온다. 무효 값이면 캡슐은 그대로 두고 SessionStart마다 `systemMessage`에 `Pota: model ceiling "<값 40자 clip>" (<POTA_MODEL_CEILING|config.json "modelCeiling">) is not valid; …`(ko 판 있음)를 넣는다. main 모델 알림과 겹치면 무효 알림이 먼저다. UPS에는 줄도 알림도 싣지 않는다. 상한이 있으면 main 모델 줄·알림의 기준이 `below <floor>`(상한 `balanced`면 `balanced`와 `sonnet`)가 된다. 상한이 없으면 출력은 바이트 단위로 같다. 출처: `scripts/pota-state.mjs` `withModelCeiling`, `pota-state-context.mjs` `modelCeilingLine`·`modelCeilingInvalidNotice`, `test/model-ceiling.test.mjs`.
- 상한은 hook 진입점에서만 읽는다: `session-start`, 그리고 payload에 `model`이 있는 `user-prompt-submit`(main 모델 floor용)에서 `resolveModelCeiling()`(env → `config.json` 읽기 1회, 쓰기 없음)을 넘긴다. `runStateResult`의 기본값은 `NO_MODEL_CEILING`이라 in-process 테스트에 개발자 환경의 상한이 새지 않는다. `POTA_MODEL_CEILING`을 export한 채 이 저장소 테스트를 돌리는 것은 지원하지 않는다(spawn하는 hook 테스트가 줄을 하나 더 받는다).
- 다른 worktree의 stale 상태를 지운 경우 캡슐 앞에 점검 문장 1줄이 붙는다. 출처: `pota-state.mjs:126-130`.
- PostToolUse는 소유 session의 active goal에서만 나오고, (goalId, 활성 taskId, sessionId) 조합당 1회다(guard `reminder-guard.json`). 출처: `pota-state.mjs:57-90`.
- PostToolUse는 goal 알림 전에 comment-checker 검사를 먼저 한다(`scripts/pota-comment-checker.mjs` `checkPostToolUse`). goal 상태와 무관하게 편집 도구 payload(Claude `Write`/`Edit`/`MultiEdit`, Codex `write`/`edit`/`multi_edit`/`multiedit`/`apply_patch`)마다 돈다. 검사기가 exit 2를 내면 `{decision:"block", reason}`(파일별 메시지, 4000자 clip)이고, 같은 호출의 goal 알림은 `hookSpecificOutput.additionalContext`로 함께 싣는다. 발견이 없거나 검사기 오류·7초 예산 초과·바이너리 없음·끔이면 기존 출력과 같다. 새 hook 항목을 만들지 않은 이유: Codex의 hook 승인이 선언에 묶여 hook 항목을 바꾸면 사용자가 다시 승인해야 한다(`lifecycle-install.md`). Antigravity는 어댑터가 편집 도구 3개를 Claude 모양으로 바꿔 같은 경로를 타고, 결과는 block이 아니라 다음 `PreInvocation`의 주입 문장으로 간다. 출처: `scripts/pota-state.mjs` `withCommentFindings`, `test/comment-checker.test.mjs`.
- SessionStart는 이전 알림 단계 뒤에 comment-checker 다운로드를 분리 프로세스로 띄운다(`startFetchWhenNeeded`, 진입점이 `autoFetch`를 넘김(host `claude|codex`, 어댑터)·바이너리 없음·backoff 아님·살아 있는 lock 없음일 때만). 캡슐 내용은 바뀌지 않는다. 출처: `scripts/pota-state.mjs`, `docs/plan/comment-checker-hook.md`.
- Stop/SubagentStop은 active goal에 미완료 task가 있으면 block한다. `stop_hook_active`인데 상태 진척이 없으면 통과시킨다(loop guard). SubagentStop은 그 agent에 배정된 task만 본다. 출처: `scripts/pota-goal-policy.mjs:19-51`, `scripts/pota-state-hook.mjs`.
- 완료 주장 대조(2.4.0): `detectCompletionClaim`(`scripts/pota-state-hook.mjs`)이 payload의 `last_assistant_message`에서 완료·통과를 주장하는 문장(60자 이하, 코드 포인트 기준 clip)을 찾는다. 패턴은 `tests pass(ed)`, `is/are (now) complete|done|finished`, `fully implemented`, `successfully completed|implemented|verified`, `all done`, `implementation (is) complete`와 한국어 `완료했습니다`·`작업 완료`·`모두 완료`·`모두 통과` 등이다. 단독 `implemented`·`verified`·`구현했습니다`는 조언·진행 보고 오탐이 많아 뺐고, `now …ing`·`next`·`moving on`·`starting`·`unverified`·`이제`·`다음`·`중입니다`가 든 문장은 제외한다. `scripts/pota-state.mjs`는 `gate.block`일 때만 이를 계산하고 reason 끝에 한 문장을 붙이며, loop guard 허용 경로에서는 같은 문장을 `systemMessage`에 넣는다. 종료 결정은 바꾸지 않는다. transcript 파일은 읽지 않고 `last_assistant_message` 문자열만 본다. `POTA_CLAIM_RECEIPT`가 `0|false|off|no`면 끈다(CLI 진입부가 `claimReceipt: {enabled:false}`를 넘기고 라이브러리 기본값은 환경 변수를 읽지 않는다). Antigravity 어댑터는 이 필드를 넘기지 않아 조용히 건너뛴다. 출처: `test/claim-receipt.test.mjs`.
- 메모리 `Paths:` 알림(2.4.0): `extractNotePaths`·`matchNotePath`·`notesForPath`(`scripts/pota-index.mjs`)가 노트 머리의 `Paths:` 줄을 해석하고, `scripts/pota-state.mjs` `memoryPathsNotice`가 PostToolUse에서 goal 유무와 무관하게 편집한 파일과 맞는 노트를 세션·노트당 한 번 알린다(guard `memory-paths`, 최대 64개 기록). 편집 파일은 comment-checker의 `extractCheckRequests`로 구해(Claude `Write`/`Edit`/`MultiEdit`, Codex `apply_patch`와 편집 도구, 상대 경로는 `payload.cwd` 기준) 성공한 편집에서만 동작하고, `docs/memory/` 편집은 제외한다. 한 번에 노트 최대 3개이며 이미 알린 노트를 먼저 걸러(`notesForPath`의 `exclude`) 나머지는 다음 편집에서 알린다. `docs/memory`가 symlink이면 알리지 않는다. 한계: 저장소 root가 symlink 별칭으로 열려 있으면 경로가 맞지 않아 알림이 나오지 않을 수 있다(미수정). goal이 없으면 상태 디렉터리가 아직 없고 `writeHookGuard`는 부모 디렉터리가 없을 때 조용히 실패하므로, guard를 쓰기 전에 상태 디렉터리를 만든다. `pota memory check`는 잘못된 항목을 `paths-invalid` 경고로 보고한다. 출처: `test/memory-paths.test.mjs`.
- hook 내부 오류는 `systemMessage` JSON으로 알리고 exit 0이다. 자동 hook은 저장소를 init하지 않는다. 출처: `pota-state.mjs:203-207`, `test/goal-state.test.mjs` "automatic context hooks do not initialize an uninitialized repository".

### 문자 예산(테스트가 강제)

| 대상 | 상한 | 강제 지점 |
| --- | --- | --- |
| UPS idle (노트 9999개 포함, 2.6.3부터 결함 판정 문장 포함) | 820 | `test/token-efficiency.test.mjs:48`, `test/index-context.test.mjs` "idle UserPromptSubmit … 620" |
| UPS active (20 task, 최대 id 포함) | 700 | `test/token-efficiency.test.mjs:73,197` |
| paused/blocked SessionStart (노트 없음) | 620 | `test/state-recovery-hardening.test.mjs:50,83` |
| 병렬 active hook / 병렬 줄 | 820 / 160 | `test/goal-dag.test.mjs:256-257` |
| memory 블록 / plan 줄 | 640 / 320 | `contextLimits`(`pota-state-context.mjs:1-14`), `test/index-context.test.mjs` |
| SessionStart 이전 알림 줄 (en·ko × 제거 중·제거함·blocked·symlinked) | 240 | `test/legacy-migration.test.mjs` "notice lines stay within 240 characters in English and Korean" |
| Antigravity 주입 문장 (UPS 캡슐 + pending) | UPS 예산과 같음 | `test/antigravity-hooks.test.mjs` "injected text keeps the prompt capsule budgets and folds in user notices once" |
| main 모델 줄 / 알림 (model 40자 clip, en·ko × fast·balanced × 3 host) | 340 / 240 | `test/main-model-gate.test.mjs` "main-model lines stay within 340 and 240 characters…" |
| 모델 상한 줄 / 무효 알림·CLI 경고 (값 40자 clip, 짝 없는 surrogate는 U+FFFD, en·ko × 2 상한 × 2 출처) | 380 / 240 | `test/model-ceiling.test.mjs` "model ceiling lines stay within 380 and 240 characters…", "invalid ceiling notices and CLI warnings stay within 240 characters…"(현재 최대 359 / 235, 알림 최대는 따옴표·백슬래시만인 값, CLI 경고 최대 209) |

### 인덱스 주입

- SessionStart idle은 memory 블록과 plan 줄을 싣는다. SessionStart active·paused·blocked·foreign은 memory 블록만 싣는다. UPS idle은 노트가 1개 이상일 때 개수 문장 1개만 싣는다. 그 밖의 UPS는 디스크를 읽지 않는다. 출처: `pota-state.mjs:153-157`.
- memory 블록: 항목이 8개 이하이고 640자 이하면 `- name: summary` 줄(줄 84자, 이름 32자 clip)로 싣는다. 넘치면 이름만 쉼표로 이어 싣고 ` +N more in MEMORY.md`를 붙인다. 미색인 노트는 이름만 싣고 `(index out of date: run pota memory index)`를 붙인다.
- hook이 보여 주는 summary는 `MEMORY.md` 줄의 문구다. 노트 본문은 읽지 않는다. 노트 이름·summary·plan 이름의 제어문자와 줄 구분자(C0, DEL, C1, U+2028, U+2029)는 렌더링 때 공백으로 바뀌어 한 항목이 한 줄에 머문다. clip은 서로게이트 쌍을 자르지 않는다. 출처: `pota-index.mjs` `memorySnapshot`, `pota-state-context.mjs` `plainText`·`clipText`, `test/index-context.test.mjs` "SessionStart replaces control characters …".
- plan 줄: 파일 수, Active 이름 최대 3개, Completed 앞 3개, `ARCHIVE.md`가 있으면 `older:` 구. 320자를 넘으면 최근 완료 이름을 뒤에서부터 뺀다. foreign에는 plan 이름을 싣지 않는다(소유자 작업 노출 금지). 출처: `pota-state-context.mjs:198-222`, `test/index-context.test.mjs` "foreign SessionStart … never plan names".
- 노트·계획이 없는 저장소의 출력은 0.5.0과 바이트 단위로 같다. `hookIndexSnapshot`은 throw하지 않고 쓰지 않는다. symlink, FIFO, 256 KiB를 넘는 인덱스는 해당 블록만 뺀다. 출처: `test/index-context.test.mjs` 1·11·12번 케이스, `pota-index.mjs:293-310`.

### 인덱스 형식과 CLI

- 한 줄 형식: `- [<name>](docs/<memory|plan>/<name>.md): <summary>`. 상한은 summary 120자, 줄 200자, name 64자, 루트 120줄/16384바이트, 인덱스 읽기 256 KiB, Completed 20개다. 출처: `INDEX_LIMITS`(`pota-index.mjs:10-21`).
- memory summary 원천: 노트 첫 20줄(4096바이트) 안의 `Summary:` 줄 → 기존 인덱스 문구 → `## Scope` 첫 줄 → 첫 본문 줄 → H1. `Summary:`가 없으면 `summary-missing` 경고가 난다.
- `pota memory|plan check [--strict]`, `pota memory index [--dry-run]`, `pota plan index [--dry-run] [--archive]`는 JSON 보고 1개를 낸다. exit 0은 오류 없음(`--strict`면 경고도 없음), 1은 오류, 2는 사용법 오류다. 출처: `scripts/pota.mjs:34-54`, `test/index.test.mjs`.
- 오류: `index-missing`, `unindexed`, `dead-link`, `duplicate`, `stale-summary`, `control-character`(인덱스 항목 summary에 제어문자·줄 구분자), `unsafe-name`(공백·`()[]<>`·백틱·C0·DEL·C1·U+2028/2029가 든 이름이나 64자 초과), `unsafe-path`, `unclosed-fence`(`index`만: 삽입 지점이 닫히지 않은 코드 펜스 안이면 아무것도 쓰지 않음). 경고(`--strict`에서만 실패): `summary-missing`, `summary-too-long`, `entry-too-long`, `root-too-long`, `nested-ignored`, `skipped-non-regular`, `completed-overflow`, `legacy-planning-rules`.
- 항목은 인덱스 섹션의 목록 줄이다: memory는 `## Domain Knowledge`, plan은 제목이 `Plans`로 끝나는 섹션(`Active`·`Superseded`·`Completed Plans` 등). 그런 섹션이 없는 예전 파일만 파일 전체 목록 줄을 항목으로 본다. 다른 섹션(`## Policy` 등)의 참조와 한 줄의 두 번째 이후 참조는 "언급"이다. 언급은 `unindexed`를 막기만 하고 `duplicate`·`dead-link`·`stale-summary` 대상도, `index`가 고치는 대상도 아니다. 출처: `pota-index.mjs` `indexReferences`, `test/index.test.mjs` "… treat note references outside ## Domain Knowledge as mentions …".
- 코드 펜스는 연 문자(백틱/틸드)와 길이를 기억하고, 같은 문자로 같거나 긴 줄에서만 닫힌다.
- `index`는 새 항목 추가, 바뀐 `Summary:` 반영, 인덱스 섹션 안의 Pota placeholder 줄 제거만 한다. `Summary:` 반영은 참조 뒤 summary 부분만 바꾸고(앞의 라벨과 구분자 유지), 참조가 둘 이상인 줄은 건드리지 않는다. 생성하는 summary의 제어문자는 공백으로 바꾼다. `--archive`일 때만 Completed 21번째 이후 항목(빈 줄 뒤 들여쓴 문단 포함)과 `## Planning Rules` 본문을 `docs/plan/ARCHIVE.md`로 원문 이동한다. 규칙 본문은 원래 제목 줄 없이 `## Legacy Planning Rules` 아래에 들어간다. 죽은 링크는 지우지 않는다. `docs/plan/ARCHIVE.md`는 첫 `## ` 제목 앞의 항목만 색인된 것으로 보고, 상대 링크(`(<name>.md)`)도 그 영역에서만 plan 항목이다.
- `plan index`는 새 계획을 체크박스로 배치한다. 체크박스가 있고 전부 체크됐으면 Completed 맨 위, 아니면 Active 끝이다. 상태 체크박스를 갱신하지 않은 완료 계획은 Active로 들어가므로 손으로 옮긴다. 출처: `pota-index.mjs:791-807`.

## Policy

- UPS는 프롬프트마다 누적된다. 새 문구는 SessionStart나 참조 파일에 넣고, active UPS에는 싣지 않는다. 0.5.0 기준 en active UPS는 691자로 여유가 없었다(설계 기록 `docs/plan/memory-plan-index-reuse.md` 0절).
- hook의 노트 줄은 `- name: ` 포함 84자에서 잘린다. `Summary:`는 핵심을 앞에 쓴다. 이 저장소 노트 6개는 SessionStart에서 모두 뒷부분("…때 읽는다")이 잘린다(ko 실측 1056자).
- 노트의 `Summary:`를 고치면 `pota memory index`를 실행한다. 실행하지 않으면 hook이 옛 문구를 계속 보여 준다.
- 예산 테스트를 바꿔야 하면 계획에 계약 변경 사유를 먼저 기록한다.

## References

- `node --test test/token-efficiency.test.mjs test/index-context.test.mjs test/index.test.mjs test/session-start-migration.test.mjs test/antigravity-hooks.test.mjs`
- `printf '{"cwd":"<repo>","session_id":"x"}' | POTA_HOME=<임시 경로> node scripts/pota-state.mjs session-start`
