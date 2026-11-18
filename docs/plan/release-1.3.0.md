# Plan: Pota 1.3.0 릴리스

## Goal

[DAG 패널 터미널 그래프와 worktree 대응](dag-terminal-graph.md)을 `1.3.0`으로 올려 기능 브랜치 → `dev`, `dev` → `main` PR을 CI 통과 후 병합하고, 병합된 main에서 만든 tarball 하나만 npm `@comento/pota-harness@1.3.0` latest로 게시한다.

- Plan ID: `docs/plan/release-1.3.0.md`
- Completion criteria (advisory): 두 PR의 CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치에서 얇은 Claude 플러그인의 `hooks/dag-term.mjs` 확인.
- 버전: `1.3.0`. 터미널 박스 그래프라는 새 기능과 worktree 수정을 담은 minor 릴리스라 main이 정했다. 사용자 요청(2026-11-18): "dev pr 머지, main pr 머지, npm 릴리즈까지 해줘".
- Safety: npm 게시는 되돌릴 수 없다. 로컬 설치본 업그레이드는 요청 범위가 아니다.

## Memory Inputs

- `MEMORY.md`, `docs/memory/release-process.md`
- Related completed plans: `docs/plan/release-1.2.0.md`(같은 절차)

## Triage

- Selected path: Light Path. 이 계획의 코드 변경은 버전 문자열뿐이다(`package.json`, `.codex-plugin/plugin.json`, `test/contract-parity.test.mjs`). Heavy Path signals checked: 없음(기능의 Heavy 설계는 `dag-terminal-graph.md`에서 끝났다).
- 저장소 상황: 기능 변경은 `origin/dev`(`9b70c35`)에서 갈라진 `feat/dag-terminal-graph`에 커밋 없이 있다. 기능 커밋과 버전 커밋을 같은 브랜치에 올려 `dev` PR 하나로 보낸다.
- npm 인증: `npm whoami` 통과(2026-11-18). `npm publish`는 대화형 인증이 필요해 사용자 터미널에서 실행한다.
- 위험: 새 순수 모듈과 테스트(`test/claude-mod-term.test.mjs`, `test/claude-mod-root.test.mjs`)는 Windows에서 처음 실행된다. Windows CI 결과를 먼저 본다.
- Delegation: 버전 문자열 3곳과 외부 명령 실행뿐이라 main이 직접 한다(subagent 생략).
- Tool readiness: `gh` 로그인 확인, `npm` 인증 확인.

## Tasks

1. `release-commit`: 버전 1.3.0, `npm run check`, 커밋, 브랜치 push. 두 검사: `npm run check`, `claude plugin validate claude-mod`.
2. `dev-pr`: `feat/dag-terminal-graph` → `dev` PR, exact head CI 성공 후 head 고정 병합. 두 검사: PR checks, 병합 상태 조회.
3. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합. 두 검사: PR checks, 병합 상태 조회.
4. `npm-publish`: 병합된 main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run → 사용자 터미널에서 publish → registry digest 대조.
5. `release-verify`: 격리 prefix·cache·HOME·`POTA_HOME`에 registry 1.3.0을 설치해 `pota --version`과 얇은 Claude 플러그인의 `hooks/dag-term.mjs`를 확인하고, 기록을 `dev`에 되돌린다.

## Evidence

- `release-commit`: 기능 커밋 `6a07fce`, 버전 1.3.0 커밋 `3d04ede`(`feat/dag-terminal-graph`). `goal verify -- npm run check` exit 0, `claude plugin validate claude-mod` exit 0.
- `dev-pr`: https://github.com/comento/pota-harness/pull/7. CI 7개 통과 후 head `3d04ede` 고정으로 병합, merge commit `9f5e73a`.
- `main-pr`: https://github.com/comento/pota-harness/pull/8 (head `9f5e73a`). CI 통과 후 head 고정 병합, merge commit `2e8e33c`.
- `npm-publish`: `2e8e33c`의 clean detached worktree에서 pack 1회(prepack의 `npm run check` 448개 중 445 통과·0 실패·3 skip). tarball `comento-pota-harness-1.3.0.tgz`, 252,910 bytes, 116 files, sha1 `76598c6d632a22fac769a0a2e3b2efb7ba3cca59`, integrity `sha512-A+kkYggNcC86G2dMw5Z4/hyCQp9m6I5TQ6NQR9Vb2UT6ZryeLpSJBlTQIY3C+/E6oCG0IvP3yN0yNtzKzuSh0w==`. 같은 tarball로 `npm publish --dry-run` exit 0 뒤 사용자가 터미널에서 게시했다. registry 조회는 처음 몇 분간 404였고, 이후 `dist.shasum`·`dist.integrity`가 tarball과 일치하고 `latest`가 1.3.0이다.
- `release-verify`: 격리된 prefix·cache·HOME·`POTA_HOME`·호스트 env(`POTA_CLAUDE_CLI=none`, `POTA_AUTO_UPGRADE=0`)에 registry 1.3.0을 설치했다. `pota --version` → `pota 1.3.0`, `pota install --hosts claude` exit 0. 얇은 Claude 플러그인과 runtime에 `hooks/dag-term.mjs`가 있다. doctor는 `OK ownership digests`, `OK Claude runtime locator`, `OK Claude plugin files`이고, `FAIL Claude plugin registered`는 Claude CLI를 끈 격리 환경이라 나온다.
- `release-record`: `main` merge commit `2e8e33c`에서 만든 브랜치 `chore/release-1.3.0-record`에 이 기록을 커밋해 `dev` PR로 되돌린다. 로컬 설치본 업그레이드는 요청 범위가 아니라 하지 않았다.
- Memory promotion: 없음. 절차는 `docs/memory/release-process.md`대로였고 새로 드러난 사실이 없다.

## Status

- [x] Planned
- [x] Released
- [x] Verified
