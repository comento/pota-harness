# Plan: Pota 0.7.0 릴리스

## Goal

[자동 업그레이드와 `~/.pota` 설치 루트](auto-upgrade-pota-home.md)를 `0.7.0`으로 올려 기능 브랜치 → `dev` PR, `dev` → `main` PR을 CI 통과 후 병합하고, exact merged main에서 만든 tarball 하나만 npm `@comento/pota-harness@0.7.0` latest로 게시합니다.

- Plan ID: `docs/plan/release-0.7.0.md`
- Completion criteria (advisory text; Pota does not enforce it — completion is gated only by required evidence): dev·main PR CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치에서 새 레이아웃·호스트 선택·`auto-upgrade` CLI 동작.
- 버전: `0.7.0`. 설치 레이아웃 변경, 새 CLI(`pota auto-upgrade`, `--hosts`, `--allow-downgrade`), 자동 업그레이드가 추가된 minor 릴리스라 main이 정했습니다. 사용자가 버전 올림, dev PR 병합, main PR 병합, npm 배포를 요청했습니다(2026-11-12).
- Safety: 로컬 Pota 설치본 업그레이드(0.6.0 → 새 레이아웃 이전)는 처음 요청 범위가 아니었고, 게시 뒤 사용자가 요청해 실행했습니다(Evidence). `.omo/`와 기존 stash는 손대지 않습니다. npm 게시는 되돌릴 수 없습니다.

## Memory Inputs

- `MEMORY.md`, `docs/memory/release-process.md`(버전 표면, exact-main tarball 절차, npm 대화형 인증, Windows 위험).
- Related completed plans: `docs/plan/release-0.6.0.md`(같은 절차와 Windows CI 실패 기록).

## Triage

- Selected path: Light Path. 추가 코드 변경은 버전 문자열뿐이며 `release-0.6.0.md`의 exact-tarball 절차를 따릅니다. Heavy Path signals checked: 없음(릴리스할 기능은 이미 Heavy Path로 구현·리뷰됨).
- Request/Planning checkpoint: Light Path. 실제 버전 표면은 `package.json`, `.codex-plugin/plugin.json`, `test/contract-parity.test.mjs`의 기대값입니다. 나머지 테스트는 `package.json`에서 버전을 읽고, `0.6.0` literal은 published legacy 트리와 문서의 "0.6.0 이하" 서술이라 바꾸지 않습니다(`grep -rn '0\.6\.0' package.json .codex-plugin test`로 확인, 2026-11-12).
- Code checkpoint: 버전 치환 직전에 위 grep으로 확인.
- 위임: 버전 문자열 치환과 Git/GitHub/npm 조작은 기계적이라 main이 직접 수행합니다. `npm publish`는 대화형 인증이 필요해 사용자의 터미널에서 실행합니다.
- 위험: 이번 변경은 lifecycle·lock·경로 테스트가 크게 늘어 Windows CI 실패 가능성이 있습니다(`release-process.md` 알려진 위험). 실패하면 원인을 고쳐 같은 PR에 올립니다.

## Tasks

1. `release-commit`: 기능 브랜치 생성, 버전 0.7.0, `npm run check`, 커밋, push.
2. `dev-pr`: 기능 브랜치 → `dev` PR, exact head CI 성공 후 head 고정 병합.
3. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
4. `npm-publish`: exact merged main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run과 publish → registry digest 대조. 응답이 모호하면 재시도하지 않고 registry부터 조회합니다.
5. `release-verify`: 격리 prefix·cache·HOME·`POTA_HOME`·호스트 env에 registry 0.7.0을 설치해 `pota --version`, `install --hosts claude`의 레이아웃과 manifest, `doctor`의 `Hosts:` 줄, `pota auto-upgrade status`를 확인합니다.
6. `release-record`: 증거를 이 계획에 기록하고 `main`의 병합 커밋을 `dev`에 다시 합치는 기록 PR을 병합합니다.

## Evidence

- `release-commit`: 브랜치 `feat/auto-upgrade-pota-home`, 커밋 `227b9d7`. 첫 `npm run check`는 `test/repo-index.test.mjs`(저장소 `PLAN.md` 엄격 검사)에서 실패했다. 원인은 기능 계획을 완료 목록으로 옮기며 쓴 요약이 120자를 넘고 완료 항목이 21개가 된 것. 요약을 줄이고 `pota plan index --archive`를 실행한 뒤 `goal verify -- npm run check` exit 0.
- `dev-pr`: https://github.com/comento/pota-harness/pull/83 (head `227b9d7`). CI 진행 중. 저장소가 GitHub auto-merge를 허용하지 않아 CI 통과 후 수동으로 head 고정 병합한다.
  - head `23c5588`에서 Windows 두 job이 실패했다(macOS·Linux 4개는 통과). 실패는 모두 `test/auto-upgrade.test.mjs`의 테스트 쪽 문제였고 제품 코드는 고치지 않았다.
    - "the runner upgrades an older installation…": stage 경로를 8.3 짧은 임시 경로(`RUNNER~1`)와 realpath 긴 경로로 비교했다. 부모 디렉터리를 양쪽 모두 realpath로 비교하도록 고쳤다.
    - "an installed runtime's SessionStart starts the runner…": 구버전 설치를 만드는 helper가 JSON 안의 경로를 raw 문자열로만 치환해, Windows의 escape된 백슬래시 경로가 바뀌지 않았다. 옛 runtime의 locator가 새 버전 경로를 가리켜 hook이 runner를 띄우지 않았다. escape된 형태도 치환하도록 고쳤다.
    - "an error after the upgrade commits…"(Node 18만): 두 번째 runner가 npm을 호출하지 않고 끝났다. 처음에는 `update.lock` 잔류로 추정해 helper에 `locked` 재시도를 넣었지만 head `3dd9a13`에서 다시 실패했고, 단언 메시지에 넣어 둔 runner 출력으로 원인을 확정했다: `reason: "checkout"`. 대역 `test/fixtures/fake-npm.mjs`의 `cpSync` filter가 Windows Node 18에서 `.git`을 걸러내지 못해 stage 패키지에 `.git`이 복사됐고 lifecycle이 `origin: "checkout"`으로 기록했다. filter 대신 항목별 복사로 바꾸고, runner 업그레이드 테스트에 `origin === "package"` 단언을 추가했다. 제품 코드의 origin 판정(`pluginRoot/.git`)은 의도된 동작이라 고치지 않았다.
  - head `51ff7f4`에서 CI 6개 매트릭스와 요약 `check`가 통과해 head 고정 병합(merge `31f8ec0`).
- `main-pr`: https://github.com/comento/pota-harness/pull/84 head `31f8ec0` CI 통과 후 head 고정 병합(merge `fd58b0d`).
- `npm-publish`: `fd58b0d`의 clean detached worktree에서 pack 1회(prepack의 `npm run check` 통과). tarball `comento-pota-harness-0.7.0.tgz`, 213,275 bytes, 101 files, sha1 `a12d1de79b5eb911de512f7bddc7dee2089ce1f6`, integrity `sha512-1J0slPb1rv3TvK5IR+u39S0BhGT9RroL1RlYs08sw3GvKFvnCTYJc22FGKpjyvvSevbfuSrhz8sfTSeCheAU1g==`. 같은 파일로 dry-run 통과. `npm whoami`가 실패해 사용자가 터미널에서 `npm login --auth-type=web`을 마쳤고, 같은 tarball 경로로 `npm publish`를 사용자 터미널에서 실행해 `+ @comento/pota-harness@0.7.0`을 받았다. 직후 조회는 404였고 수 분 뒤 `npm view @comento/pota-harness@0.7.0`의 shasum·integrity가 tarball과 일치, `latest`는 `0.7.0`.
- `release-verify`: 격리된 prefix, cache, HOME, `POTA_HOME`, 호스트 env(`POTA_CLAUDE_CLI=none`)에 registry 0.7.0을 설치해 확인했다. `pota --version` 0.7.0. `pota install --hosts claude` → manifest schema 2, `hosts: ["claude"]`, `origin: "package"`, phase는 `core`·`claude`만, `install/`에 `claude`·`runtime/0.7.0`·`lifecycle.json`, `CODEX_HOME`은 생성되지 않음. `pota doctor` 첫 줄 `Hosts: claude`. `pota auto-upgrade status` → `enabled: true`, `source: "default"`. `pota upgrade --hosts all` → `hosts` 전체, Codex 캐시 `pota/0.7.0` 생성, `config.toml`의 `source`가 `<POTA_HOME>/install/codex`. `pota uninstall` 뒤 `POTA_HOME`이 비었다. 실제 `~/.pota`에는 `projects`만 있다.
- `release-record`: 이 기록 브랜치(`docs/release-0.7.0-record`)는 `main`의 머지 커밋 `fd58b0d`를 포함한 `dev`에서 시작해 증거를 기록한다.
- 로컬 설치본 upgrade(게시 뒤 사용자 요청, 2026-11-12): `npm install -g @comento/pota-harness@0.7.0` → `pota upgrade` exit 0. 실제 0.6.0 legacy 설치가 한 번에 이전됐다: `~/.pota/install/`에 `claude`·`codex`·`runtime/0.7.0`·`lifecycle.json`(schema 2, `hosts` 전체, `origin: "package"`, `retained: []`), `~/.codex/plugins/cache/pota`에는 `pota/0.7.0`만 남음, `config.toml`의 `source`가 `~/.pota/install/codex`, Claude 마켓플레이스가 `~/.pota/install/claude`로 재등록되고 플러그인 캐시가 `0.7.0`으로 갱신됨. `pota doctor` 전 항목 OK(exit 0), `pota auto-upgrade status` → `enabled: true`.
- 확인하지 못한 것: 실제 registry를 상대로 한 자동 업그레이드 runner는 다음 릴리스가 나와야 확인된다.
- Memory promotion: docs/memory/release-process.md

## Status

- [x] Planned
- [x] Dry-run or check passed, or not applicable was recorded
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed, or an explicit paused/blocked/cancelled reason was recorded
