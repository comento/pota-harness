# Plan: Pota 0.5.0 릴리스

## Goal

[모델 위임 규칙 4가지 개선](delegation-model-identity-rules.md)을 `0.5.0`으로 올려 기능 브랜치 → `dev` PR, `dev` → `main` PR을 CI 통과 후 병합하고, exact merged main에서 만든 tarball 하나만 npm `@comento/pota-harness@0.5.0` latest로 게시한 뒤 로컬 Pota 설치본을 0.5.0으로 업그레이드합니다.

- Plan ID: `docs/plan/release-0.5.0.md`
- Completion criteria: dev·main PR CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치 CLI 동작, 로컬 설치본 0.5.0 확인.
- 버전: `0.5.0`(사용자 지정, 2026-11-10). 병합, 게시, 설치본 업그레이드까지 사용자가 요청했습니다.
- Safety: 설치본 업그레이드 외에는 HOME, 전역 설정을 변경하지 않습니다. `.omo/`와 기존 stash는 손대지 않습니다.

## Triage

- Selected path: Light Path. 추가 코드 변경은 버전 문자열뿐이며 `release-0.4.1.md`의 exact-tarball 절차를 따릅니다. Heavy Path signals checked: 없음.
- Request/Planning/Code checkpoint: Light Path 유지. 버전 표면은 `package.json`, `.codex-plugin/plugin.json`, 테스트 5개 파일의 현재 버전 기대값뿐임을 grep으로 확인.
- 위임: 버전 문자열 치환과 Git/GitHub/npm 조작은 기계적이라 main이 직접 수행합니다.

## Tasks

1. `release-commit`: 버전 0.5.0, `npm run check`, 커밋, push.
2. `dev-pr`: PR #77 exact head CI 성공 후 head 고정 병합.
3. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
4. `npm-publish`: exact merged main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run과 publish → registry digest 대조. 응답이 모호하면 재시도하지 않고 registry부터 조회합니다.
5. `release-verify`: 격리 prefix에 registry 0.5.0을 설치해 strongest tier 게이트와 `effectiveModel` 노출을 확인합니다.
6. `local-upgrade`: 로컬 Pota 설치본을 0.5.0으로 업그레이드하고 `pota doctor`로 확인합니다.

## Evidence

- `release-commit`: 커밋 `13ef9e4`, `goal verify -- npm run check` exit 0(225 pass).
- `dev-pr`: https://github.com/comento/pota-harness/pull/77 head `13ef9e4` CI 7개 통과 후 head 고정 병합(merge `2b7137e`). 첫 실행에서 Windows + Node current의 `a stale lifecycle observer never displaces a confirmed live lifecycle owner`가 1회 실패했다(1초 lock 타임아웃에 1018ms). 이번 변경은 lifecycle lock 코드를 건드리지 않았고, 실패 job만 재실행해 통과했다. 최근 CI 이력에는 같은 테스트의 실패가 없었다.
- `main-pr`: https://github.com/comento/pota-harness/pull/78 head `2b7137e` CI 7개 통과 후 head 고정 병합(merge `0c55a78`).
- `npm-publish`: `0c55a78`의 clean detached worktree에서 pack 1회(prepack의 `npm run check` 통과). tarball `comento-pota-harness-0.5.0.tgz`, 143,115 bytes, 95 files, sha1 `6a56d04b0ee189a373274a4e403f0db24ee54290`, integrity `sha512-aPNYsJQGDfkc0Stbb/PNBCCelzNTu0iJN+0LsVnhX7jWUlCsJ+jXNjvjYQQNPu4eb53VGxq9Op0TUwqsnVM89w==`. 같은 파일로 dry-run 통과. 첫 게시 시도는 npm 토큰 만료(E404 PUT, `npm whoami` 401)로, 재로그인 뒤 두 번째 시도는 EOTP로 거부됐고 두 번 모두 registry에 반영된 것이 없음을 확인했다. 실제 게시는 같은 tarball로 사용자가 터미널에서 브라우저 인증을 거쳐 수행(`+ @comento/pota-harness@0.5.0`). 게시 직후 registry 조회는 수 분간 404였고 재게시 없이 반영을 기다린 뒤 registry version·shasum·integrity·`latest` 일치를 `goal verify`로 확인.
- `release-verify`: 격리된 prefix, cache, HOME, `POTA_HOME`에 registry 0.5.0을 설치해 host 미선언 `opus` 설계 완료 거부와 waiver 완료, `--host claude-code` `fable` 완료와 `goal stats`의 `modelHost`·`effectiveModel` 노출, `--host claude-code` `pro` 완료 거부를 확인.
- `local-upgrade`: `/opt/homebrew` 전역 패키지를 `npm install -g @comento/pota-harness@0.5.0`으로 올리고 `pota upgrade` 실행. versioned runtime은 `0.5.0`만 남았고 `pota doctor` 29개 항목이 모두 OK. Claude runtime locator가 0.5.0을 가리킨다. 최종 `goal finish` exit 0(0.5.0 CLI로 실행).
- 후속: 이 기록 브랜치에서 `main`의 머지 커밋 `0c55a78`을 `dev`에 합쳤다. 업그레이드 전에 시작한 세션은 훅이 0.4.1 경로를 가리키므로 새 세션부터 0.5.0 훅이 적용된다. Windows + Node current에서 1회 실패한 lifecycle lock 동시성 테스트는 타이밍 여유(1초)가 작아 재발할 수 있다.
