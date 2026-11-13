# Plan: Pota 0.6.0 릴리스

## Goal

[메모리·계획 인덱스 재활용과 측정·감사 잔여 수정](memory-plan-index-reuse.md)을 `0.6.0`으로 올려 기능 브랜치 → `dev` PR, `dev` → `main` PR을 CI 통과 후 병합하고, exact merged main에서 만든 tarball 하나만 npm `@comento/pota-harness@0.6.0` latest로 게시합니다.

- Plan ID: `docs/plan/release-0.6.0.md`
- Completion criteria (advisory text; Pota does not enforce it — completion is gated only by required evidence): dev·main PR CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치에서 새 CLI와 hook 주입 동작.
- 버전: `0.6.0`. 새 CLI 하위 명령(`pota memory|plan check|index`, `goal stats --history`)과 hook 주입이 추가된 minor 릴리스라 main이 정했습니다. 사용자가 dev PR 병합, main PR 병합, npm 배포를 요청했습니다(2026-11-11).
- Safety: 로컬 Pota 설치본 업그레이드는 요청 범위가 아니라 하지 않습니다. `.omo/`와 기존 stash는 손대지 않습니다. npm 게시는 되돌릴 수 없습니다.

## Memory Inputs

- `MEMORY.md`, `docs/memory/release-process.md`(버전 표면, exact-main tarball 절차, npm 대화형 인증).
- Related completed plans: `docs/plan/release-0.5.0.md`(같은 절차와 Windows lock 테스트 플레이크 기록).

## Triage

- Selected path: Light Path. 추가 코드 변경은 버전 문자열뿐이며 `release-0.5.0.md`의 exact-tarball 절차를 따릅니다. Heavy Path signals checked: 없음(릴리스할 기능은 이미 Heavy Path로 구현·리뷰됨).
- Request/Planning checkpoint: Light Path. 버전 표면은 `package.json`, `.codex-plugin/plugin.json`, 테스트 5개 파일의 기대값(`docs/memory/release-process.md`).
- Code checkpoint: 버전 치환 직전에 `grep -rn '0\.5\.0' package.json .codex-plugin test`로 확인.
- 위임: 버전 문자열 치환과 Git/GitHub/npm 조작은 기계적이라 main이 직접 수행합니다. `npm publish`는 대화형 인증이 필요해 사용자의 터미널에서 실행합니다.

## Tasks

1. `release-commit`: 기능 브랜치 생성, 버전 0.6.0, `npm run check`, 커밋, push.
2. `dev-pr`: 기능 브랜치 → `dev` PR, exact head CI 성공 후 head 고정 병합.
3. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
4. `npm-publish`: exact merged main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run과 publish → registry digest 대조. 응답이 모호하면 재시도하지 않고 registry부터 조회합니다.
5. `release-verify`: 격리 prefix·cache·HOME·`POTA_HOME`에 registry 0.6.0을 설치해 `memory check`/`index`, hook의 메모리 블록, `goal stats --history`를 확인합니다.
6. `release-record`: 증거를 이 계획에 기록하고 `main`의 병합 커밋을 `dev`에 다시 합치는 기록 PR을 병합합니다.

## Evidence

- `release-commit`: 브랜치 `feat/memory-plan-index-reuse`, 커밋 `6918926`. `goal verify -- npm run check` exit 0(302 pass).
- `dev-pr`: https://github.com/comento/pota-harness/pull/80. 첫 head `6918926`에서 Windows 두 job이 실패했다(macOS·Linux는 통과). 원인은 두 가지였다.
  - CRLF 체크아웃: `skills/pota-plan/SKILL.md`가 9065바이트로 측정돼 9000 예산을 넘었고 템플릿 동일성 테스트가 깨졌다. `.gitattributes`(`* text=auto eol=lf`)를 추가했다.
  - 8.3 짧은 임시 경로(`RUNNER~1`): worktree 간 이력 집계 테스트에서 두 checkout의 `repositoryId`가 달라졌다. 테스트가 임시 root를 `realpathSync.native`로 풀도록 고쳤다. `repositoryId` 계산 자체는 0.5.0부터의 동작이라 바꾸지 않았다(짧은 경로명으로 연 Windows 저장소에서는 worktree 간 집계가 갈릴 수 있다).
  - 수정 커밋 `008d36f`에서 CI 6개 매트릭스와 요약 `check`가 통과해 head 고정 병합(merge `a6ee93d`).
- `main-pr`: https://github.com/comento/pota-harness/pull/81 head `a6ee93d` CI 통과 후 head 고정 병합(merge `9e2e137`).
- `npm-publish`: `9e2e137`의 clean detached worktree에서 pack 1회(prepack의 `npm run check` 통과). tarball `comento-pota-harness-0.6.0.tgz`, 176,718 bytes, 97 files, sha1 `d7dae8ee035bf3de520f7cde48f328c1d0ff6716`, integrity `sha512-OFvI1a1Kwq43KFoShgPcY4raP+MFvHdKdMw+fngvmLAKlFXrdIw635130aveNT24+NRZDUsnbTnqpB22XdmwiQ==`. 같은 파일로 dry-run 통과. npm 토큰이 만료돼(`npm whoami` 401) 사용자가 `npm login --auth-type=web`으로 다시 로그인했고, publish는 사용자 터미널에서 브라우저 인증으로 실행해 `+ @comento/pota-harness@0.6.0`을 받았다. registry 조회는 약 2분간 404였다가 반영됐고, version·shasum·integrity·`latest`가 tarball과 일치했다(재게시 없음).
- `release-verify`: 격리된 prefix, cache, HOME, `POTA_HOME`에 registry 0.6.0을 설치해 확인했다. `pota --version` 0.6.0, `init`이 만든 `PLAN.md`에 Planning Rules 없음, 노트 추가 뒤 `memory check` 실패 → `memory index` → `memory check --strict`·`plan check --strict` exit 0, 설치본 hook의 SessionStart에 노트 이름과 요약, UserPromptSubmit에 노트 개수 문장, `goal stats --history`의 `goals: 0`, `goal --help`의 advisory 고지, `init --help`가 파일을 만들지 않음.
- `release-record`: 이 기록 브랜치(`docs/release-0.6.0-record`)에서 `main`의 머지 커밋 `9e2e137`을 `dev`에 합치고 증거를 기록한다.
- 하지 않은 것: 로컬 Pota 설치본 upgrade(요청 범위 아님). 이 PC의 hook은 `pota upgrade` 전까지 0.5.0이다.
- Memory promotion: docs/memory/release-process.md

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
