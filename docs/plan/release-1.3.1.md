# Plan: Pota 1.3.1 릴리스

## Goal

[main 모델 게이트, 테스트 시간 단축, DAG 기본 보기](main-model-gate-and-test-time.md)와 [구독 등급에 맞춘 모델 상한](available-model-ceiling.md)을 `1.3.1`로 올려 기능 브랜치 → `dev`, `dev` → `main` PR을 CI 통과 후 병합하고, 병합된 main에서 만든 tarball 하나만 npm `@comento/pota-harness@1.3.1` latest로 게시한다.

- Plan ID: `docs/plan/release-1.3.1.md`
- Completion criteria (advisory): 두 PR의 CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치에서 `POTA_MODEL_CEILING` 동작 확인.
- 버전: `1.3.1`. 사용자가 정했다(2026-11-19): "dev pr 머지, main pr 머지, npm 릴리즈까지 이어가줘. 버전은 1.3.1이네".
- Safety: npm 게시는 되돌릴 수 없다. 로컬 설치본 업그레이드는 처음 요청 범위가 아니었고, 게시 뒤 사용자가 따로 요청했다.

## Memory Inputs

- `MEMORY.md`, `docs/memory/release-process.md`
- Related completed plans: `docs/plan/release-1.3.0.md`(같은 절차)

## Triage

- Selected path: Light Path. 이 계획의 코드 변경은 버전 문자열뿐이다(`package.json`, `.codex-plugin/plugin.json`, `test/contract-parity.test.mjs`). Heavy Path signals checked: 없음(기능의 Heavy 설계는 두 기능 계획에서 끝났다).
- 저장소 상황: 기능 변경은 `origin/dev`(`f6e5757`)의 로컬 `dev` 작업 트리에 커밋 없이 있다. 기능 브랜치 `feat/main-model-gate-ceiling`을 만들어 기능 커밋과 버전 커밋을 올리고 `dev` PR 하나로 보낸다.
- npm 인증: `npm publish`는 대화형 인증이 필요해 사용자 터미널에서 실행한다.
- 위험: 새 테스트(`test/main-model-gate.test.mjs`, `test/model-ceiling.test.mjs`, 분할된 `test/lifecycle-transaction-*.test.mjs`)는 Windows에서 처음 실행된다. Windows CI 결과를 먼저 본다.
- Delegation: 버전 문자열 3곳과 외부 명령 실행뿐이라 main이 직접 한다(subagent 생략).

## Tasks

1. `release-commit`: 버전 1.3.1, `npm run check`, 커밋, 브랜치 push. 두 검사: `npm run check`, 버전 표면 grep.
2. `dev-pr`: 기능 브랜치 → `dev` PR, exact head CI 성공 후 head 고정 병합. 두 검사: PR checks, 병합 상태 조회.
3. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합. 두 검사: PR checks, 병합 상태 조회.
4. `npm-publish`: 병합된 main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run → 사용자 터미널에서 publish → registry digest 대조.
5. `release-verify`: 격리 prefix·cache·HOME·`POTA_HOME`에 registry 1.3.1을 설치해 `pota --version`과 모델 상한 동작을 확인하고, 기록을 `dev`에 되돌린다.

## Evidence

- `release-commit`: 기능 커밋 `5a98d56`, 버전 1.3.1 커밋 `1f351fa`(`feat/main-model-gate-ceiling`). `goal verify -- npm run check` exit 0, 버전 표면과 원격 head 일치 확인.
- `dev-pr`: https://github.com/comento/pota-harness/pull/10. CI 7개 통과 후 head `1f351fa` 고정으로 병합, merge commit `fd89f6f`. 새 테스트가 Windows(Node 18·current)에서 처음 통과했다.
- `main-pr`: https://github.com/comento/pota-harness/pull/11 (head `fd89f6f`). CI 7개 통과 후 head 고정 병합, merge commit `ee91a2f`.
- `npm-publish`: `ee91a2f`의 clean detached worktree에서 pack 1회(prepack의 `npm run check` 통과). tarball `comento-pota-harness-1.3.1.tgz`, 268,512 bytes, 118 files, sha1 `c18ff5938347a0a9b922fdad84a84b79ccaf4738`, integrity `sha512-mKC1UosOrvPCKAOJ70QcHOAz5gnT50hZHGDeeHtzT3M6Q/fbV12TinleOrHWmh+hFtt6GDZ2+F1Nn9NBE8S7pA==`. 같은 tarball로 `npm publish --dry-run` exit 0 뒤 사용자가 터미널에서 게시했다. registry 조회는 처음 몇 분간 404였고, 이후 `dist.shasum`·`dist.integrity`가 tarball과 일치하고 `latest`가 1.3.1이다.
- `release-verify`: 격리된 prefix·cache·HOME·`POTA_HOME`·호스트 env(`POTA_CLAUDE_CLI=none`, `POTA_AUTO_UPGRADE=0`)에 registry 1.3.1을 설치했다. `pota --version` → `pota 1.3.1`, `pota install --hosts claude` exit 0, runtime에 `scripts/pota-model-ceiling.mjs`·`scripts/pota-model-tier.mjs`가 있다. 설치된 runtime의 SessionStart hook: `POTA_MODEL_CEILING=stronger`는 `Pota model ceiling: stronger` 줄, `Pro`는 무효 알림, 미설정은 상한 줄 없이 "below the stronger tier" 알림(main 모델 sonnet), `config.json`의 `"modelCeiling": "balanced"`는 `Pota model ceiling: balanced` 줄.
- `release-record`: `main` merge commit `ee91a2f`에서 만든 브랜치 `chore/release-1.3.1-record`에 이 기록을 커밋해 `dev` PR로 되돌린다.
- 로컬 설치본: 게시 뒤 사용자가 요청해(2026-11-19) `npm install -g @comento/pota-harness@1.3.1` → `pota upgrade` → `pota doctor`를 실행했다. `pota --version` → `pota 1.3.1`, doctor는 `Hosts: claude,antigravity`와 모든 항목 OK.
- pack 직전 `npm whoami`가 한 번 401이었으나 몇 분 뒤 재조회에서는 정상이었다. 한 번의 401로 토큰 만료라고 단정하지 않는다.
- Memory promotion: 없음. 절차는 `docs/memory/release-process.md`대로였고 새로 드러난 사실이 없다.

## Status

- [x] Planned
- [x] Released
- [x] Verified
