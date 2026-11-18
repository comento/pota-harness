# Plan: Pota 1.2.0 릴리스

## Goal

[Claude Code DAG 패널](claude-dag-panel.md)과 [toolcheck 누락 도구 설치 질문](toolcheck-install-question.md)을 `1.2.0`으로 올려 기능 브랜치 → `dev`, `dev` → `main` PR을 CI 통과 후 병합하고, 병합된 main에서 만든 tarball 하나만 npm `@comento/pota-harness@1.2.0` latest로 게시한다.

- Plan ID: `docs/plan/release-1.2.0.md`
- Completion criteria (advisory): 두 PR의 CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치에서 얇은 Claude 플러그인의 mod 파일과 doctor `Claude plugin files` 확인.
- 버전: `1.2.0`. 새 기능(Claude Code DAG 패널, toolcheck 설치 질문)을 추가한 minor 릴리스라 main이 정했다. 사용자 요청(2026-11-18): 커밋과 PR, 이어서 main PR 병합과 npm 배포.
- Safety: npm 게시는 되돌릴 수 없다. 로컬 설치본 업그레이드는 요청 범위가 아니다.

## Memory Inputs

- `MEMORY.md`, `docs/memory/release-process.md`, `docs/memory/lifecycle-install.md`
- Related completed plans: `docs/plan/release-1.1.0.md`, `docs/plan/release-0.7.0.md`(같은 절차)

## Triage

- Selected path: Light Path. 이 계획의 코드 변경은 버전 문자열뿐이다(`package.json`, `.codex-plugin/plugin.json`, `test/contract-parity.test.mjs`). Heavy Path signals checked: 없음(기능 자체의 Heavy 설계는 `claude-dag-panel.md`에서 끝났다).
- 저장소 상황: 기능 커밋 `051d066`이 브랜치 `feat/claude-dag-panel`에 있고 `origin/dev`(`f8905e6`, toolcheck PR #3 포함)를 충돌 없이 병합했다. 버전 커밋을 같은 브랜치에 올려 `dev` PR 하나로 보낸다.
- npm 인증: `npm publish`는 대화형 인증이 필요해 사용자 터미널에서 실행한다. pack 전에 `npm whoami`를 확인한다.
- 위험: mod 파일 복사와 `shouldCopyPluginPath`의 `claude-mod` 범위는 Windows에서 처음 실행된다. Windows CI 결과를 먼저 본다. README 8개에 절이 추가돼 바이트 예산 테스트에 가깝다면 Windows job에서 드러난다.
- Delegation: 버전 문자열 3곳과 외부 명령 실행뿐이라 main이 직접 한다(subagent 생략).

## Tasks

1. `release-commit`: 버전 1.2.0, `npm run check`, 커밋, 브랜치 push.
2. `dev-pr`: `feat/claude-dag-panel` → `dev` PR, exact head CI 성공 후 head 고정 병합.
3. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
4. `npm-publish`: 병합된 main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run → 사용자 터미널에서 publish → registry digest 대조.
5. `release-verify`: 격리 prefix·cache·HOME·`POTA_HOME`에 registry 1.2.0을 설치해 `pota --version`, 얇은 Claude 플러그인의 `hooks/register.tsx`와 `hooks.json` `modules`, doctor `Claude plugin files`를 확인하고, `main` 병합 커밋을 `dev`에 다시 합친다.

## Evidence

- `release-commit`: 버전 1.2.0 커밋 `6185cc9`(`feat/claude-dag-panel`). `goal verify -- npm run check` exit 0. 앞선 두 번의 실행은 검증 도중 파일을 고쳐 Pota가 기록을 거부했다(테스트 실패 아님).
- `dev-pr`: https://github.com/comento/pota-harness/pull/4. 첫 CI run `44243733888`은 5개 job이 `node scripts/pota.mjs toolcheck --json` 단계에서 실패했다(`npm run check`는 통과). `claude-mod/`의 `register.tsx`·`types/index.d.ts` 때문에 저장소가 TypeScript로 감지돼 `typescript-language-server`·`tsc`가 누락으로 나온 것이다. CI에 `npm install --global typescript@5.9.3 typescript-language-server@4.4.1` 단계를 추가했다(커밋 `1dade1e`. 6.1.0은 Node 22 이상이라 Node 18 job에서 쓸 수 없다). 다시 돈 CI 7개 통과 후 head `1dade1e` 고정으로 병합, merge commit `e461612`.
- `main-pr`: https://github.com/comento/pota-harness/pull/5 (head `e461612`). CI 7개 통과 후 head 고정 병합, merge commit `2aa5ef6`.
- `npm-publish`: `2aa5ef6`의 clean detached worktree에서 pack 1회(prepack의 `npm run check` 422개 중 419 통과·0 실패·3 skip). tarball `comento-pota-harness-1.2.0.tgz`, 245,811 bytes, 114 files, sha1 `9dda1dde4eebff80d852c3090a76956eb2d7d5b6`, integrity `sha512-D+b5hTK3RnMK2OXdyVJtgXsQkK+/Z3+nIdwVxub6Y8ou/+5j9L5Ce0rm1eaKohGOT3Hr5bid9xfCJQTyqOFiJw==`. 같은 tarball로 `npm publish --dry-run` 뒤 사용자가 터미널에서 게시했다(브라우저 인증). registry 조회는 약 3분간 404였고, 이후 `dist.shasum`·`dist.integrity`가 tarball과 일치하고 `latest`가 1.2.0이다.
- `release-verify`: 격리된 prefix·cache·HOME·`POTA_HOME`·호스트 env(`POTA_CLAUDE_CLI=none`, `POTA_AUTO_UPGRADE=0`)에 registry 1.2.0을 설치했다. `pota --version` → `pota 1.2.0`, `pota install --hosts claude` exit 0. 얇은 Claude 플러그인에 `hooks/register.tsx`, `hooks/dag-model.mjs`, `hooks/dag-model.d.mts`, `types/index.d.ts`, `pota-runtime.json`이 있고 `hooks.json`은 `modules: ["./register.tsx"]`와 command hook 5개 이벤트를 함께 담는다. doctor는 `OK ownership digests`, `OK Claude runtime locator`, `OK Claude plugin files`. 설치본의 `claude plugin validate` exit 0.
- `release-record`: `main` merge commit `2aa5ef6`에서 만든 브랜치에 이 기록을 커밋해 `dev` PR로 되돌린다. 로컬 설치본 업그레이드는 요청 범위가 아니라 하지 않았다.
- Memory promotion: `docs/memory/release-process.md`(CI의 toolcheck 단계와 TypeScript 도구 고정 버전, `npm run check`가 toolcheck를 돌리지 않는다는 점)

## Status

- [x] Planned
- [x] Released
- [x] Verified
