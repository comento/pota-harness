# Plan: `--tasks` 쉼표 목록 거부와 Pota 1.3.2 릴리스

## Goal

`goal start`·`goal replan`의 `--tasks`에 JSON이 아닌 쉼표 목록(`triage-plan,server-tree,client-tree,verify`)이나 깨진 JSON을 넘기면 조용히 task 1개짜리 goal이 만들어지는 문제를 오류로 바꾸고, `1.3.2`로 올려 기능 브랜치 → `dev`, `dev` → `main` PR을 CI 통과 후 병합한 뒤 병합된 main의 tarball 하나만 npm `@comento/pota-harness@1.3.2` latest로 게시한다.

- Plan ID: `docs/plan/release-1.3.2.md`
- Completion criteria (advisory): 수정과 테스트, 두 PR의 CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치에서 쉼표 목록 거부 확인.
- 버전: `1.3.2`. 사용자가 정했다(2026-11-19): "이 문제도 고쳐서 1.3.2로 배포까지 쭉 가자".
- 추가 요청(2026-11-19, "claude mod에 버전이 0.0.0으로 기록된 거 같던데 그것도 고쳐줘"): 저장소의 개발용 manifest `claude-mod/.claude-plugin/plugin.json`의 `version`이 `0.0.0`이었다(설치본은 `pota install`이 릴리스 버전으로 생성해 정상). 이 값을 릴리스 버전으로 맞추고 `test/contract-parity.test.mjs`가 `package.json`과의 일치를 검사하게 한다. main이 `release-commit`에서 직접 처리한다.
- Safety: npm 게시는 되돌릴 수 없다.

## Memory Inputs

- `MEMORY.md`, `docs/memory/release-process.md`, `docs/memory/goal-state.md`
- Related completed plans: `docs/plan/release-1.3.1.md`(같은 절차)

## Triage

- 발견 경위: `collabo` worktree의 goal이 task 1개(id `task-1`, title `triage-plan,server-tree,client-tree,verify`)로 만들어져 DAG 패널이 노드 하나만 그렸다. 패널은 상태를 그대로 그린 것이다.
- 원인: `scripts/pota-goal-cli.mjs` `parseTasks`가 JSON 파싱에 실패하면 오류 없이 `|`로만 나눠 제목으로 쓴다. 쉼표는 구분자가 아니라 문자열 전체가 제목 하나가 된다.
- Selected path: Light Path. 기존 레이어 안의 함수 하나와 테스트. Heavy Path signals checked: 없음.
- Pre-implementation decisions:
  1. JSON이 아닌 `--tasks` 문자열에서 `|`가 없고, 쉼표로 나눈 조각이 2개 이상이며 모든 조각이 id 모양(`^[A-Za-z0-9._-]+$`, trim 후)이면 오류로 거부한다. 오류 문구는 JSON 배열 예시와 `|` 구분을 안내한다.
  2. trim한 값이 `[` 또는 `{`로 시작하는데 JSON 파싱에 실패하면(깨진 JSON) 제목으로 쓰지 않고 오류로 거부한다.
  3. 그 밖은 기존 동작 유지: `|` 구분 제목, 쉼표가 들어간 일반 문장 제목(`Fix a, b`), positional 제목 배열, 정상 JSON.
  4. `start`와 `replan` 둘 다 같은 함수를 쓰므로 한 곳만 고친다. 상태 schema, hook, skill 문구는 바꾸지 않는다.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `fix-tasks-parse` | `worker` | light | `sonnet` | `medium` |
| 릴리스 task들 | main | light | - | - |

## Tasks

1. `fix-tasks-parse`: `scripts/pota-goal-cli.mjs` `parseTasks` 수정과 `test/goal-state.test.mjs`(또는 CLI 계약 테스트)에 테스트 추가. Write scope: `scripts/pota-goal-cli.mjs`, `test/`. 두 검사: 새 테스트를 포함한 goal CLI 테스트, 저장소 소스 CLI로 쉼표 목록이 exit 1인지 직접 실행.
2. `release-commit`: 버전 1.3.2, `npm run check`, 커밋, 브랜치 push.
3. `dev-pr`: 기능 브랜치 → `dev` PR, exact head CI 성공 후 head 고정 병합.
4. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
5. `npm-publish`: 병합된 main의 clean detached worktree에서 pack 1회 → publish dry-run → 사용자 터미널에서 publish → registry digest 대조.
6. `release-verify`: 격리 설치에서 `pota --version`과 쉼표 목록 거부를 확인하고 기록을 `dev`에 되돌린다.

## Evidence

- Memory promotion:

## Status

- [x] Planned
- [ ] Implemented
- [ ] Released
- [ ] Verified
