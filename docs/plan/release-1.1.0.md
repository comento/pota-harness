# Plan: Pota 1.1.0 릴리스

## Goal

[편집 후 comment-checker 검사](comment-checker-hook.md)를 `1.1.0`으로 올려 `dev` → `main` PR을 CI 통과 후 병합하고, 병합된 main에서 만든 tarball 하나만 npm `@comento/pota-harness@1.1.0` latest로 게시한다.

- Plan ID: `docs/plan/release-1.1.0.md`
- Completion criteria (advisory): main PR CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치에서 install 출력의 comment-checker 줄과 doctor 줄 확인.
- 버전: `1.1.0`. 새 기능(PostToolUse 주석 검사, install/upgrade 다운로드, `POTA_COMMENT_CHECKER` 설정)을 추가한 minor 릴리스라 main이 정했다. 사용자 요청(2026-11-18): main PR 머지 후 npm 배포.
- Safety: npm 게시는 되돌릴 수 없다. 로컬 설치본 업그레이드는 요청 범위가 아니다.

## Memory Inputs

- `MEMORY.md`, `docs/memory/release-process.md`
- Related completed plans: `docs/plan/release-0.7.0.md`(같은 절차)

## Triage

- Selected path: Light Path. 코드 변경은 버전 문자열뿐이다(`package.json`, `.codex-plugin/plugin.json`, `test/contract-parity.test.mjs`). Heavy Path signals checked: 없음.
- 저장소 상황: `comento/pota-harness`에는 원격 `main`만 있고 `dev`가 없다. 로컬 `dev`(main + 기능 커밋 `cfc9d5e`)를 push해 원격 `dev`를 만들고 `dev` → `main` PR로 승격한다. 기능 브랜치 → dev 단계는 기능 커밋이 이미 dev에 있어 생략한다.
- npm 인증: 사전 확인에서 `npm whoami`가 401이라, `npm login --auth-type=web`과 `npm publish <tarball>`은 사용자 터미널에서 실행한다.
- 위험: 새 테스트가 POSIX 전용(`skip: !posix`)이고 Windows 경로는 `systemTar`만 다르다. Windows CI 결과를 먼저 본다.

## Tasks

1. `release-commit`: 버전 1.1.0, `npm run check`, 커밋, `dev` push.
2. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
3. `npm-publish`: 병합된 main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run → 사용자 터미널에서 publish → registry digest 대조.
4. `release-verify`: 격리 prefix·cache·HOME·`POTA_HOME`에 registry 1.1.0을 설치해 `pota --version`, `install` 출력의 `comment-checker:` 줄, `doctor` 줄을 확인한다.

## Evidence

- `release-commit`: 버전 1.1.0 커밋 `74d385c`(`dev`). `plan index`가 체크박스가 모두 체크된 새 계획을 Completed에 넣어 Active로 옮기고 미완료 체크박스를 추가했다. `goal verify -- npm run check` exit 0. `origin/dev` 신규 생성, head가 로컬 HEAD와 같음을 기록.
- `main-pr`: https://github.com/comento/pota-harness/pull/2 (head `74d385c`). CI run `44218789440`: macOS·ubuntu 4개 통과, Windows 2개(Node 18·current) 실패. 둘 다 `test/comment-checker.test.mjs` "Claude Code and Codex edit payloads map to checker tool inputs" 하나였다. 상대 경로 기대값을 `/repo/src/b.js`로 고정해, Windows에서 `path.resolve`가 `D:\repo\src\b.js`를 내는 것과 달랐다. 제품 코드는 맞고 테스트 기대값만 `resolve(cwd, …)`로 바꿨다.

## Status

- [x] Planned
- [ ] Released
- [ ] Verified
