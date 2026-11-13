# Plan: Pota 0.4.1 릴리스

## Goal

[Heavy Path 설계 모델 위임](heavy-design-model-routing.md)을 `0.4.1`로 커밋하고, 기능 브랜치 → `dev` PR, `dev` → `main` PR을 CI 통과 후 병합한 뒤, exact merged main에서 만든 tarball 하나만 npm `@comento/pota-harness@0.4.1` latest로 게시합니다.

- Plan ID: `docs/plan/release-0.4.1.md`
- Completion criteria: dev·main PR CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치 CLI 동작.
- 버전: `0.4.1`(사용자 지정, 2026-11-09). npm `latest`는 `0.4.0`이고 `0.4.1`은 미게시.
- Safety: 사용자 Pota 설치, HOME, 전역 npm prefix/cache는 변경하지 않습니다. `.omo/`와 기존 stash는 손대지 않습니다.

## Triage

- 경로: 릴리스/배포 작업이며 추가 코드 변경은 버전 문자열뿐입니다. `release-0.4.0.md`의 exact-tarball 원칙을 따릅니다.
- Selected path: Light Path. Heavy Path signals checked: 없음(버전 문자열과 기록만 변경).
- Request/Planning/Code checkpoint: Light Path 유지. 버전 표면은 `package.json`, `.codex-plugin/plugin.json`, 테스트의 현재 버전 기대값뿐임을 grep으로 확인.
- 브랜치: `dev` 직접 push는 보호 규칙 우회이므로 `feat/heavy-design-fable-routing` → `dev` PR로 진행합니다. `main` 보호 규칙이 strict이므로 `origin/main`을 먼저 이 브랜치에 합쳤습니다.
- 위임: 버전 문자열 치환은 기계적 변경이라 main이 직접 수행합니다.
- 사전 확인: `npm whoami`는 `wonkyoo.nam`. 게시 시 OTP/브라우저 승인이 필요할 수 있으며 그 경우 사용자 승인을 받습니다.

## Tasks

1. `release-commit`: 버전 0.4.1, `npm run check`, 커밋, push.
2. `dev-pr`: 기능 브랜치 → `dev` PR, exact head CI 성공 후 head 고정 병합.
3. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
4. `npm-publish`: exact merged main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run과 publish → registry digest 대조. 응답이 모호하면 재시도하지 않고 registry부터 조회합니다.
5. `release-verify`: 격리 prefix에 registry 0.4.1을 설치하고 설계 task 게이트를 확인합니다.

## Evidence

- 사전 정리: PR https://github.com/comento/pota-harness/pull/73 병합(merge `7f5aa8f`).
- `release-commit`: 커밋 `c04bb8a`, `goal verify -- npm run check` exit 0.
- `dev-pr`: https://github.com/comento/pota-harness/pull/74 CI 7개 통과 후 head `c04bb8a` 고정 병합(merge `73a7186`).
- `main-pr`: https://github.com/comento/pota-harness/pull/75 CI 7개 통과 후 head `73a7186` 고정 병합(merge `c450b6c`).
- `npm-publish`: `c450b6c`의 clean detached worktree에서 pack 1회(prepack의 `npm run check` 통과). tarball `comento-pota-harness-0.4.1.tgz`, 141,254 bytes, 95 files, sha1 `cb65fe578634dc1b5f0814f6a93b2353507b4948`, integrity `sha512-WQdgUETxIcYLZApaQ5/NgeBhCwCh8PuqTPfRHzy6iFjwKCUwQ3t0I2WH/2BH9x/0swoX05a4UnvnyTH7OlS7gw==`. 같은 파일로 dry-run 통과 후 첫 게시 시도는 EOTP로 실패했고, 실제 게시는 사용자가 브라우저 인증으로 수행. registry shasum·integrity·`latest` 일치를 `goal verify`로 확인. 게시 직후 registry 조회는 잠시 404였고 재게시 없이 반영을 기다림.
- `release-verify`: 격리된 prefix, cache, HOME, `POTA_HOME`에 registry 0.4.1을 설치해 설계 없는 Heavy 완료 거부, 모델 미기록 설계 완료 거부, 기록 후 완료, replan 후 설계 유지를 확인. 최종 `goal finish` exit 0.
- 후속: `main`의 머지 커밋 `c450b6c`가 `dev`에 없어 다음 승격 전 동기화가 필요합니다(`main` 보호 규칙 strict). 로컬 Pota 설치본은 0.4.0이며 변경하지 않았습니다.
