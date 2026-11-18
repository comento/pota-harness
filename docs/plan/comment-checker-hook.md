# Plan: comment-checker-hook

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation after planned triage.
- Codex UI synchronization: Claude Code 호스트라 Codex `update_plan`/`create_goal`은 없음. Claude Code 앱 task list(`update_plan`)에 같은 순서로 표시.

## Goal

편집 도구(Write/Edit/MultiEdit/apply_patch)가 성공한 직후 `comment-checker`로 AI식 불필요 주석을 검사한다. 문제가 있으면 PostToolUse `decision: "block"` 피드백을 돌려줘 모델이 주석을 고치거나 필요한 이유를 설명하게 한다. 사용자가 따로 설치하지 않아도 동작하도록, Pota가 고정 버전 GitHub release 바이너리를 SHA256 검증 후 내려받는다. npm 의존성은 추가하지 않는다.

- Goal ID: `goal-d249fa47-e125-426c-b373-a1b60e1491c9`
- Plan ID: `docs/plan/comment-checker-hook.md`
- Completion criteria (advisory): `npm run check` 통과, 실제 바이너리로 Claude Edit·Codex apply_patch 검사 block 확인.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome: SessionStart(설치된 canonical runtime에서만)가 바이너리가 없으면 분리 프로세스로 내려받는다. PostToolUse는 바이너리가 있으면 검사하고, 없으면 같은 다운로드를 띄우고 이번에는 통과한다.
- Affected surfaces: 새 `scripts/pota-comment-checker.mjs`(검사·다운로드·runner 진입점), `scripts/pota-state.mjs`(session-start·post-tool-use 연결), `scripts/pota-paths.mjs`(runtime 진입점 목록), `scripts/pota-lifecycle.mjs`(uninstall 정리), `scripts/pota-lifecycle-commands.mjs`(doctor 정보 줄), `package.json` check 목록, 테스트, README·`docs/memory`.
- Task classification: `triage-plan` → `implement`(모듈 1개 + 연결) → `verify`(전체 check, 실제 바이너리 smoke, 리뷰).

## 설계 결정

1. **고정 release:** upstream `code-yeongyu/go-claude-code-comment-checker` `v0.8.2`(MIT). 자산과 SHA256은 release `checksums.txt` 값을 소스에 고정한다.
   - darwin_amd64 `b3a32a90be5cd2712caffb045b89fbc09d65c264297b607957f83302f1c7c1f5`
   - darwin_arm64 `57e0eea96b74a02bd6ed40f7078fda71c8807419ed039d33bc6a4b6db8d4d13c`
   - linux_amd64 `62493f1561de3d53e0bb447b16166c8d88be6f86ae6ef5c5fc0016ed2435b8f6`
   - linux_arm64 `022d4092794034303d021cd33f1b42a8c57d04c963ba66065ff3f844bfedd8e8`
   - windows_amd64(zip) `26ac648ceb8bfbc6f9039fd59fc8bf1671939a223fbaf1aac646e98f80cb9d20`
   - 그 밖의 플랫폼은 미지원: 다운로드하지 않고 검사하지 않는다.
2. **저장 위치:** `<POTA_HOME>/tools/comment-checker/v0.8.2/comment-checker[.exe]`. lifecycle 관리 대상(`install/`)이 아니라 `update/`처럼 비관리 캐시다. 그래서 manifest·journal·digest 계약을 바꾸지 않는다. uninstall은 lock 해제 뒤 `tools/comment-checker`를 지우고 빈 `tools/`를 제거한다.
3. **다운로드 시점(최초 제안에서 변경):** install/upgrade 트랜잭션 안에서 받지 않는다. lifecycle에 네트워크 실패 경로가 생기고, lifecycle 테스트 수십 개가 네트워크에 의존하게 되기 때문이다. 대신 자동 업그레이드 runner와 같은 패턴을 쓴다. 설치된 canonical runtime의 SessionStart가 `pota-comment-checker.mjs fetch`를 분리 프로세스(`detached`, `stdio: "ignore"`)로 띄운다. 설치 직후 첫 세션 시작에서 바로 받기 시작하므로 사용자 입장에서는 같다.
4. **다운로드 절차:** Node 18 내장 `fetch` → 크기 상한 32 MiB → SHA256 비교 → 임시 디렉터리에 OS `tar`로 해제(`tar -xzf`, Windows zip은 `tar -xf`) → 실행 파일이 일반 파일인지 확인·`chmod 755` → 버전 디렉터리로 rename(원자적 배치). 동시 실행은 `fetch.lock`(O_EXCL, pid 기록, 죽은 pid 회수)으로 막는다. 실패하면 `state.json`에 `nextAttemptAt`(1시간부터 2배, 최대 24시간)을 기록하고 그 전에는 다시 띄우지 않는다.
5. **훅 연결:** Claude 얇은 플러그인 생성기(`pota-lifecycle-claude.mjs` `claudeHooks`)가 `pota-state.mjs <event>` 명령만 받고, Codex hook trust hash도 hooks.json 항목 단위다. 그래서 새 hook 항목을 만들지 않고 기존 `pota-state.mjs post-tool-use` 안에서 검사한다. hooks.json의 matcher·timeout(10초)은 그대로 둔다. 검사기 timeout은 7초, 넘으면 통과다.
6. **입력 변환:** 검사기는 `<bin> check`에 Claude Code PostToolUse 형식 JSON(`tool_name`, `tool_input.file_path`, `content` | `old_string`/`new_string` | `edits`)을 stdin으로 받고 exit 0=통과, 2=문제(stderr가 메시지)다.
   - Claude `Write`/`Edit`/`MultiEdit`, Codex `write`/`edit`/`multi_edit`/`multiedit`: 필드 이름(`filePath`/`file_path`/`path`, `oldString`/`old_string` 등)을 정규화한다.
   - Codex `apply_patch`: `tool_input.command`(또는 `input`/`patch`) 텍스트를 파싱한다. Add→`Write`(content=`+` 줄), Update→`Edit`(old=문맥+`-` 줄, new=문맥+`+` 줄, `Move to`면 새 경로), Delete 무시.
   - 상대 경로는 payload `cwd` 기준으로 절대화한다.
   - `tool_response`가 실패(`is_error: true`, `success: false`)면 건너뛴다.
7. **출력 결합:** 검사에서 문제가 나오면 `{decision:"block", reason}`을 낸다. reason은 파일별 메시지를 합쳐 4000자로 자른다. 같은 호출에서 goal 알림이 나오면 `hookSpecificOutput.additionalContext`를 함께 싣는다. 검사기 오류(그 밖의 exit, spawn 실패, timeout)는 출력하지 않는다. 훅의 exit code·goal 상태 실패 처리는 바꾸지 않는다.
8. **끄기:** `POTA_COMMENT_CHECKER=0|false|off|no` 또는 `<POTA_HOME>/config.json`의 `"commentChecker": false`. 끄면 검사·다운로드 모두 하지 않는다. 읽을 수 없는 config는 자동 업그레이드와 달리 "켜짐"으로 본다(검사는 읽기 전용이라 위험이 낮다).
9. **소스 체크아웃:** locator가 없는 실행은 다운로드를 띄우지 않는다. 바이너리가 이미 있으면 검사는 한다.
10. **doctor:** 통과/실패 목록에 넣지 않는다. 판정을 바꾸지 않는 정보 줄 하나를 출력한다: `comment-checker: ready <version>` | `not downloaded yet (fetched in the background at the next session start)` | `disabled` | `unsupported platform <platform>-<arch>`.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/hook-context.md`, `docs/memory/lifecycle-install.md`
- Related completed plans: `docs/plan/auto-upgrade-pota-home.md`(분리 runner, update 상태 정리 패턴)

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- Rationale: 설계와 구현이 한 모듈에 밀접하게 묶여 있어 main 세션이 직접 구현한다(아래 Agent Assignments).
- User-visible response and artifact locale: ko.

## Reasoning Effort Profile

- Heavy Path: planning/review=`high`, implementation=`high`, final verification/review=`xhigh`.
- 설계 모델: 별도 strongest 설계 task 없이 main(Opus) 세션이 설계를 이 문서에 기록했다. 완료 게이트는 `--allow-no-design-model`에 사유를 남긴다.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: 새 모듈, 외부 다운로드, 실행 파일 무결성 검증, 동시 다운로드 lock.
- Checkpoint ledger:
  - Request checkpoint: Heavy(외부 다운로드·새 모듈).
  - Planning checkpoint: Heavy 유지. lifecycle 트랜잭션은 바꾸지 않는 것으로 범위를 줄였다.
  - Code checkpoint: 아래 파일 범위로 확정.
- Heavy Path signals checked:
  - New directory/module/layer: 새 스크립트 모듈 1개(디렉터리 없음).
  - New domain model/service/abstraction: 없음.
  - Security/auth/session: 실행 파일 다운로드 무결성(SHA256 고정).
  - External API/message queue/payment: GitHub release 다운로드.
  - DB schema/migration: 없음.
  - Concurrency/transaction/cache invalidation: fetch lock, 원자적 rename.
  - Cross-domain refactor: 없음.
  - Explicit extra-care signal: 없음.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | heavy | opus(세션) | high(세션) |
| `implement` | main(takeover) | heavy | opus(세션) | high(세션) |
| `verify` | main + 리뷰 subagent | heavy | opus | xhigh |

- main takeover 사유: 설계 결정이 구현 세부(출력 결합, 입력 정규화)에 바로 이어져 있고 쓰기 범위가 한 사람에게 모인다.

## Tool Readiness

- Detected stack: Node.js ESM(`.mjs`), `node --test`, 의존성 없음.
- Verification tools: `node --check`, `npm run check`, `npm pack --dry-run`, 실제 바이너리(`gh release download`로 받은 v0.8.2 darwin_arm64).
- Missing tools: 없음. Install approval: not needed.

## Execution Guardrails

- 실제 `~/.pota`·`~/.codex`·설치본에 쓰지 않는다. 테스트는 임시 `POTA_HOME`으로 격리한다.
- 다운로드 단위 테스트는 로컬 HTTP 서버와 테스트 전용 자산 표(함수 옵션)를 쓴다. 네트워크에 의존하지 않는다.
- 검사 테스트는 임시 `POTA_HOME`의 기대 경로에 가짜 실행 파일(셸 스크립트)을 둔다.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Contract: 조사 범위(lifecycle 레이아웃, 자동 업그레이드 runner, doctor, hook 생성기·trust hash, upstream 입출력 계약)를 확인하고 이 문서를 구현 가능한 상태로 확정한다.
- Required evidence records: `planArtifact`, `triageDecision`.

### Task 1: 구현

- Task ID: `implement`
- Files: `scripts/pota-comment-checker.mjs`(신규), `scripts/pota-state.mjs`, `scripts/pota-paths.mjs`, `scripts/pota-lifecycle.mjs`, `scripts/pota-lifecycle-commands.mjs`, `package.json`, `test/comment-checker.test.mjs`(신규).
- Test contract:
  - 입력 변환: Claude Write/Edit/MultiEdit, Codex apply_patch(Add/Update/Move/Delete), 상대 경로, 실패 응답 건너뜀.
  - 검사: 가짜 바이너리 exit 2 → `decision: block` + 파일 경로·메시지 포함. exit 0 → 출력 없음. exit 1·timeout·바이너리 없음 → 출력 없음.
  - goal 알림과 결합: active goal + 문제 → block과 additionalContext가 함께 나온다.
  - 끄기: env·config로 꺼지면 바이너리가 있어도 검사하지 않는다.
  - 다운로드: 로컬 서버의 올바른 tar.gz → 설치. SHA 불일치 → 설치 안 함 + backoff 기록. lock이 잡혀 있으면 종료. 소스 체크아웃 SessionStart는 spawn하지 않는다.
  - uninstall이 `tools/comment-checker`를 지운다.
- Module acceptance verification: `node --test test/comment-checker.test.mjs`
- Surface integration verification: `node --test test/token-efficiency.test.mjs test/goal-state.test.mjs test/lifecycle.test.mjs test/installed-plugin.test.mjs test/packed-install.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 2: 검증과 리뷰

- Task ID: `verify`
- Contract: `npm run check` 전체 통과. 실제 v0.8.2 바이너리로 Claude Edit·Codex apply_patch payload가 block을 내는지 smoke. 실제 fetch 경로를 임시 `POTA_HOME`에서 GitHub에 대해 1회 실행. 독립 리뷰 1회.
- Module acceptance verification: `npm run check`
- Surface integration verification: 실제 바이너리 smoke 스크립트(scratchpad)
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`, goal `finalReview`.

## Evidence

- Tool readiness: 의존성 없음, 추가 설치 없음.
- Tests: `node --test test/comment-checker.test.mjs` 8개 통과. `npm run check` 387개 중 384 통과·3 skip(기존 Codex CLI gate)·실패 0.
- Module acceptance: `implement` — comment-checker 테스트. `verify` — `npm run check` exit 0(리뷰 반영 뒤 재기록).
- Surface integration: `implement` — token-efficiency·goal-state·lifecycle·installed-plugin·packed-install·auto-upgrade 테스트. `verify` — 실제 smoke(`scratchpad/smoke.mjs`, 사용자 승인): 임시 `POTA_HOME`에서 GitHub v0.8.2 darwin_arm64를 고정 SHA256 검증 후 설치, Claude `Edit`·Codex `apply_patch` 주석 추가는 `decision: "block"`, 주석 없는 편집은 `{}`.
- 리뷰(opus, xhigh, 독립 subagent): 치명·높음 없음. 중간 1·낮음 5 모두 반영.
  1. Windows에서 PATH의 GNU tar(Git Bash) → `%SystemRoot%\System32\tar.exe`를 직접 사용.
  2. 자체 O_EXCL lock의 TOCTOU → `createLifecycleLock` 재사용.
  3. pid 재사용 시 영구 lock → 10분 넘은 lock 폐기.
  4. timeout 뒤 stderr 파이프가 훅 종료를 늦춤 → 파이프 destroy(테스트 파일 5.5초 → 1초).
  5. lock 이전 실패에 backoff 없음 → 모든 실패를 `recordFailure`로.
  6. goal 상태 읽기 실패 시 findings 유실 → findings가 있으면 유지.
  - 참고 항목(유예 runtime도 fetch를 띄움) → 설치 버전과 같은 runtime만 띄우도록 반영.
- 검증 한계: Windows·Linux 실제 바이너리와 Codex 호스트의 `decision: "block"` 처리는 실행해 보지 않았다(OmO Codex판이 같은 출력 형식을 쓴다).
- 설계 변경 기록: 최초 제안의 "install/upgrade 중 다운로드"는 SessionStart 분리 프로세스로 바꿨다(설계 결정 3).
- Memory promotion: `docs/memory/hook-context.md`, `docs/memory/lifecycle-install.md`

## Status

- [x] Planned
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed

## 후속 변경: install/upgrade 중 다운로드

- 사용자 요청(2026-11-18): 설치 직후 바로 검사가 동작하고, 다운로드가 설치 출력에 보이도록 install/upgrade에서 받는다. 설계 결정 3을 다음처럼 바꾼다.
- Goal ID: `goal-comment-checker-install-fetch`(goal CLI가 발급한 id는 Evidence에 기록)
- Selected path: Light Path. 기존 모듈 함수 재사용, lifecycle `afterRelease` 단계에 연결만 한다. 새 모듈·스키마·트랜잭션 변경 없음.
- 동작: install/upgrade(`--auto` 포함)가 commit·lock 해제 뒤 `afterRelease`에서 `fetchCommentChecker`를 실행하고 결과를 한 줄 출력한다. 트랜잭션 밖이라 실패해도 설치는 유지되고 exit code도 바뀌지 않는다. 끄여 있으면 아무것도 출력하지 않는다. SessionStart 분리 다운로드는 대체 경로로 남는다.
- 출력: `comment-checker: installed 0.8.2` | `ready 0.8.2` | `download failed (<error>); edits pass unchecked until a later background retry succeeds` | `unsupported platform <p>-<a>` | `another download is in progress`.
- 테스트 격리: lifecycle을 실행하는 모든 테스트 env에 `POTA_COMMENT_CHECKER: "0"`. 누락은 임시 canary(꺼지지 않은 fetch 호출을 파일에 기록)로 전체 suite에서 확인한 뒤 canary를 제거한다.
- Tasks: `implement`(module: `node --test test/comment-checker.test.mjs`, surface: lifecycle 테스트 묶음), `verify`(module: `npm run check`, surface: 임시 HOME에서 실제 `pota-lifecycle.mjs install` smoke).
- Evidence (goal `goal-0176bda8-2194-483c-af17-e0f597c0a32b`):
  - 테스트 격리: canary로 측정한 결과 guard 추가 전에는 테스트 중 실제 다운로드가 47회 일어났다(lifecycle·hardening·hosts·claude-*·packed-install env). `test/lifecycle.test.mjs`(env 3곳), `test/lifecycle-hardening.test.mjs`, `test/packed-install.test.mjs`에 guard를 넣은 뒤 재측정에서 0회였고, canary는 제거했다.
  - `node --test test/comment-checker.test.mjs` 9개 통과. `npm run check` exit 0. PLAN Completed가 21개가 되어 `pota plan index --archive`로 가장 오래된 1개를 `docs/plan/ARCHIVE.md`로 옮겼다.
  - 실제 smoke(`scratchpad/install-smoke.mjs`, 임시 HOME, `--hosts antigravity`): install 출력 `comment-checker: installed 0.8.2`, doctor `ready 0.8.2`, upgrade `ready 0.8.2`, 받은 바이너리가 주석 있는 Write에 exit 2, uninstall 뒤 `tools/` 없음.
