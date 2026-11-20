# Domain: goal-state

Summary: goal 상태 파일 위치·전이·lock·증거 freshness·요청 계약 게이트·스티어링 기록·이력과 cleanup 규칙. goal CLI나 완료 게이트를 바꿀 때 읽는다.

## Scope

`scripts/pota-goal-*.mjs`, `scripts/pota-paths.mjs`, `scripts/pota-safe-fs.mjs`의 state lock, `scripts/pota-cleanup.mjs`. 모델·effort 게이트는 `delegation-model-routing.md`, hook 출력은 `hook-context.md`.

## Facts

### 위치와 결속

- 상태 디렉터리는 `$POTA_HOME`(기본 `~/.pota`)`/projects/<repositoryId>/worktrees/<worktreeId>/`다. repositoryId는 git common dir, worktreeId는 git dir의 해시다. git이 아니면 root 경로를 쓴다. 출처: `pota-paths.mjs:9-40`.
- 그 안의 파일: `state.json`(schema v3, `GOAL_STATE_VERSION`), `history.jsonl`, `stop-guard.json`, `reminder-guard.json`, `steering.json`(goal의 스티어링 기록), 세션마다 1개인 `main-model-<sha256(sessionKey) hex 앞 16자>.json`(`{"schemaVersion":1,"sessionKey","model","tier","host","at"}`, 낮은 tier 세션만, lock 없이 씀), `.pota/state.lock`. 저장소 안에는 goal 상태를 두지 않는다.
- task `kind`는 `TASK_KINDS`(`design`, `review`) 중 하나이거나 없다. `review`를 더해도 schema 버전은 3이다. 구버전 runtime은 `kind: "review"` 상태를 읽지 못한다. 출처: `pota-goal-state-validation.mjs` `TASK_KINDS`.
- 예전 위치 `<repo>/.pota/state.json`은 읽을 때 lock 안에서 새 위치로 옮기고 지운다. 출처: `pota-goal-state.mjs:100-113`.
- 읽기 전용 경로(hook, `stats --history`)는 상태가 없으면 디렉터리를 만들지 않는다. 출처: `test/goal-state.test.mjs` "hook failures emit JSON and read-only hooks create no user-home state", `test/goal-history.test.mjs` "… creates no state directory".
- 유일한 예외: SessionStart·UPS payload의 main 모델이 stronger 미만일 때 hook이 worktree 상태 디렉터리를 만들고 그 세션의 `main-model-<hash>.json`만 쓴다. SessionStart 시점엔 goal이 없어 디렉터리가 없을 수 있기 때문이다. `POTA_MAIN_MODEL_GATE`가 `0|false|off|no`면 이 기록도 하지 않는다. 출처: `test/main-model-gate.test.mjs` "only a below-stronger payload creates the worktree state directory, holding only per-session main-model files", "POTA_MAIN_MODEL_GATE off makes a below-stronger hook payload identical to one without a model and writes nothing".
- main 모델 기록은 세션마다 다른 파일이라 세션끼리 같은 파일을 읽고 다시 쓰지 않는다. 한 파일에 모든 세션을 두면 lock 없는 동시 쓰기가 지운 기록을 되살려 stronger 세션을 잘못 막는다(fail-open이 아니다). 지우기는 그 세션 파일만 삭제하고, 기록할 때 `main-model-*.json`이 8개를 넘으면 자기 파일을 빼고 mtime이 오래된 것부터 지운다. 저장된 `sessionKey`가 조회 키와 다르거나 파일이 symlink·디렉터리·손상이면 기록이 없는 것으로 본다. 출처: `scripts/pota-goal-state.mjs` `syncMainModelRecord`, `test/main-model-gate.test.mjs` "a concurrent clear and record for different sessions never resurrects the cleared record", "recording a ninth session removes the oldest session file by mtime", "a record file whose stored sessionKey differs from the lookup key is not accepted".
- goal은 `worktreeId`를 저장한다. 다른 worktree의 상태를 만나면 hook과 `goal start`가 그 파일을 지운다. 이때 이력은 남기지 않는다. 출처: `pota-goal-operations.mjs:37-43,79-91`, `test/goal-history.test.mjs` "stale-worktree state removal records no history".
- 모델 상한(`POTA_MODEL_CEILING`·`config.json` `"modelCeiling"`)은 상태·이력·`goal stats`에 저장하지 않는다. CLI가 게이트 명령마다 읽고, schema는 3 그대로다. 출처: `scripts/pota-model-ceiling.mjs`, `delegation-model-routing.md` "모델 상한".
- `ownerSessionId`가 다른 session은 foreign으로 본다. payload에 session id가 없으면 소유로 간주한다. 이어받을 때는 `goal claim --session`을 쓴다. 출처: `pota-goal-policy.mjs:12-17`.

### 전이와 종료

- goal 전이: active → paused·blocked·cancelled·completed, paused → active·blocked·cancelled, blocked → active·paused·cancelled. task 전이: pending → active·blocked, active → pending·blocked·completed, blocked → pending·active. 출처: `pota-goal-operations.mjs:18-30`.
- terminal(completed·cancelled) 전이는 lock 안에서 이력을 먼저 기록하고 `state.json`을 삭제한다. 반환값은 terminal 스냅샷이고, 이후 `goal status`는 상태 없음이다. 출처: `pota-goal-operations.mjs:93-114`, `GOAL_STATE_CONTRACT.terminal`(`pota-goal-state-validation.mjs:10-18`).
- 예전 버전이 남긴 terminal `state.json` 위에서 `goal start`를 하면 `recordedBy: "start"`로 기록한 뒤 덮어쓴다. 미완료 goal이 있으면 start를 거부하고 `goal replan`을 안내한다.
- `history.jsonl`: goal당 1줄(같은 goalId는 교체), 최근 200개만 유지, 임시 파일 + rename으로 쓴다. 기록 실패는 전이를 막지 않고 stderr `Pota warning: goal history was not recorded: …`만 낸다. 레코드에는 id와 개수만 있고 절대 경로는 없다. 출처: `scripts/pota-goal-history.mjs:8-140`, `test/goal-history.test.mjs` 1~7번 케이스.
- `goal stats`(플래그 없음)는 현재 goal만 보고, goal이 없으면 `null`이다. `goal stats --history [--limit 1..200]`는 같은 repositoryId의 모든 worktree 이력을 합친다. 중앙값·p90·rerunRate는 completed만 대상이고, completed가 4개 이상이면 `trend`(older/newer 절반 비교)를 낸다. 이력이 없으면 `{"schemaVersion":1,"scope":"repository","goals":0}`이다. `--limit`은 `--history`와 함께만 허용된다. 출처: `pota-goal-history.mjs:208-290`, `pota-goal-cli.mjs:188-192`.
- `Memory promotion:` 알림: `goal finish`/`goal complete`가 completed로 끝났고, planId가 저장소 안 일반 파일(512 KiB 이하)인데 채워진 `Memory promotion:` 줄이 없으면 stderr에 1줄을 낸다. stdout과 exit code는 그대로다. 값이 `none`/`없음`으로 시작하면 none, 그 밖은 note다. planId가 파일이 아니면 unknown이며 조용하다. cancel에는 내지 않는다. 출처: `pota-goal-history.mjs:23-52`, `pota-goal-cli.mjs:41-44`.

### 증거와 완료 게이트

- 기본 `evidencePolicy`는 `tool-bound`다. `goal verify -- <argv>`가 명령을 직접 실행하고 exit 0일 때만 receipt(source `tool`)를 남긴다. 한 번 실행으로 여러 kind를 기록할 수 있다. 실패는 기록하지 않는다. 출처: `test/goal-state.test.mjs` "tool-bound goals execute verification…", "goal verify records one receipt per kind from a single run".
- receipt는 workspace fingerprint에 묶여 파일이 바뀌면 stale이 된다. 기본 fingerprint는 `git ls-files --cached --others --exclude-standard`에서 `PLAN.md`, `MEMORY.md`, `docs/plan/`, `docs/memory/`를 뺀 것이다. 증거를 기록하는 파일이기 때문이다. 이 파일들에 대한 주장은 `--watch`로 명시한다. 출처: `scripts/pota-goal-evidence.mjs:80-93`.
- 기본 required evidence는 task가 `moduleAcceptance`·`surfaceIntegration`, goal이 `finalReview`다. 출처: `pota-goal-state-validation.mjs:20-21`.
- goal 완료에는 모든 task completed와 fresh goal evidence가 필요하다. goal evidence가 마지막 task receipt보다 뒤에 기록됐으면 task 증거는 존재만 확인하고, 아니면 task freshness를 다시 검사한다. 출처: `scripts/pota-goal-operations-mutations.mjs:20-34`.
- `goal finish`는 active task 완료, goal evidence 1회 기록, goal 완료를 한 번에 한다. stale task 증거면 거부한다. 출처: `test/goal-state.test.mjs` "goal finish …" 2개 케이스.
- `completionCriteria`(`--criteria`)는 advisory이며 강제하지 않는다. 완료는 required evidence로만 막는다. 출처: `GOAL_STATE_CONTRACT.completionCriteria`, `goal --help` 둘째 줄(`pota-goal-cli.mjs:7-10`).
- 한도: planId 128자, taskId 64자, planId+taskId 160자, 동시 active task 4개. 병렬 task는 `dependsOn`과 겹치지 않는 `writeScope`가 필요하다. 출처: `pota-goal-state-validation.mjs:4-9`, `test/goal-dag.test.mjs`.

### 요청 계약 게이트와 스티어링 기록(1.4.0)

- 계획 파일 판정은 `readPlanText`(`scripts/pota-goal-steering.mjs`)가 한다: 저장소 안 일반 파일, symlink 구성요소 없음, 512 KiB 이하. 그렇지 않은 plan id(`plan-status` 같은 식별자)는 검사할 수 없으므로 아래 게이트를 모두 건너뛴다. 기존 테스트 대부분이 이 경로라 출력이 그대로다.
- 요청 계약 게이트: `requiredEvidence`에 `triageDecision`이 있는 task를 완료할 때(`goal task --status completed`, `goal finish`) 계획의 `## Request Brief`에 `REQUEST_BRIEF_LABELS` 5개(`Original request`, `Interpreted outcome`, `Prior records`, `Assumptions`, `Implicit requirements`)가 채워져 있어야 한다. "채워짐"은 같은 줄 값이 있고 `<...>` placeholder가 아니거나, 더 깊게 들여쓴 목록 줄 중 placeholder가 아닌 것이 있는 경우다. 코드 펜스 안은 무시한다. 우회는 `--allow-no-request-brief <reason>`(완료 전이에서만, stderr 보고)이다. 출처: `requestBriefGateError`, `setTaskStatus`, `test/request-brief.test.mjs`.
- 스티어링 기록: `goal steer --kind <correction|addition|redirect> --reason`(roadmap 불변, active goal만, `state.json`을 다시 쓰지 않아 revision이 오르지 않음)과 `goal replan --steer <kind|none> --reason`. 계획이 파일이면 replan에 두 플래그가 필수이고, 파일이 아니면 선택이지만 한쪽만 주면 오류다.
- 순번 검사: n번째 스티어링(`none` 제외)은 Request Brief 섹션에 `- S<n> (<명령과 같은 kind>): <placeholder 아닌 text>` 줄이 있어야 하고, n이 2 이상이거나 `redirect`면 `Current request (as of S<n>)`가 채워져 있어야 한다. 거부되면 상태와 기록이 바뀌지 않는다. 출처: `steeringBriefError`, `prepareSteeringEntry`.
- 저장: 상태 디렉터리의 `steering.json` `{schemaVersion:1, goalId, entries:[{seq, kind, reason, at, replan}]}`. `none`은 `seq: null`이고 순번에 세지 않는다. reason은 제어문자를 공백으로 바꾸고 500자에서 자른다. goalId가 다르거나 symlink·손상이면 빈 기록으로 읽는다. state lock 안에서 임시 파일 + rename으로 쓰고, terminal 전이가 이력을 기록한 뒤 지운다. `state.json` schema는 3 그대로다.
- 이력 레코드와 `goal stats`에 `steering: {total, correction, addition, redirect}` 개수가 붙는다(원문 없음).
- `pota plan steering [--limit 1..200]`은 `docs/plan/*.md`의 Request Brief에서 `S<n> (kind): text` 줄을 모아 JSON으로 낸다(읽기 전용, mtime 최신순, 기본 20개 계획, text 200자 clip). 출처: `planSteeringReport`, `scripts/pota-index.mjs` `parseIndexArgs`.

### lock과 cleanup

- state lock 레코드는 `{schemaVersion:1, pid, hostname, nonce, acquiredAt}`, 기본 대기 5초다. 유효 레코드는 같은 host이고 pid가 죽었을 때만 회수한다. 깨진 레코드는 mtime 30초 뒤 회수한다. 회수는 `state.lock.stale.<nonce|malformed>.<uuid>`로 rename한 뒤 삭제한다. 출처: `pota-safe-fs.mjs:81-200,239-260`.
- `pota cleanup`은 예전 `<repo>/.pota`만 다룬다. 기본은 분류만 하고 `--yes`일 때 삭제한다. known은 `state.json`, `tools/`, 같은 host의 죽은 owner `state.lock`, 이름의 nonce와 레코드 nonce가 같은 quarantine이다. 나머지는 보존하고 `preservedReasons`(`live-lock-owner`, `foreign-host-lock`, `invalid-lock-record`)에 이유를 적는다. `--yes`는 삭제 직전에 다시 판정한다. 출처: `pota-cleanup.mjs:15-133`, `test/cleanup-hardening.test.mjs`.

## Policy

- 상태 schema나 `GOAL_STATE_CONTRACT`를 바꾸면 `test/state-recovery-hardening.test.mjs`의 `deepEqual`이 깨진다. 새 정보는 이력 레코드나 별도 파일에 두는 편이 싸다.
- lock fixture는 유효한 죽은 owner 레코드로 만든다. 임의 텍스트 lock은 이제 보존 대상이다.
- 계획·메모리 파일만 고친 뒤에는 증거를 다시 돌릴 필요가 없다. 그 파일이 검증 대상이면 `--watch`를 쓴다.

## References

- `node --test test/goal-state.test.mjs test/goal-history.test.mjs test/goal-dag.test.mjs test/cleanup-hardening.test.mjs`
