# Plan: Pota 0.4.0 릴리스

## Goal

[dispatch 시 추론 강도 실제 적용과 검증](dispatch-effort-enforcement.md)과 [작업별 모델 결정](per-task-model-routing.md)을 `0.4.0`으로 커밋하고, 기능 브랜치 → `dev` PR, `dev` → `main` PR을 CI 통과 후 병합한 뒤, exact merged main에서 만든 tarball 하나만 npm `@comento/pota-harness@0.4.0` latest로 게시합니다.

- Plan ID: `docs/plan/release-0.4.0.md`
- Completion criteria: dev·main PR CI 성공과 병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치 CLI 동작.
- 버전: `0.4.0`(새 CLI 옵션과 Heavy 완료 게이트, 모델 정책 변경). `0.3.0`은 이미 게시되어 재사용 불가.
- Safety: 사용자 Pota 설치, HOME, 전역 npm prefix/cache는 변경하지 않습니다. `.omo/`와 기존 stash는 손대지 않습니다.

## Triage

- 경로: 릴리스/배포 작업이며 추가 코드 변경은 버전 문자열뿐입니다. `release-0.3.0.md`의 exact-tarball 원칙을 따릅니다.
- 브랜치: `dev` 직접 push는 보호 규칙 우회이므로 `feat/dispatch-effort-model-routing` → `dev` PR로 진행합니다.
- 사전 확인(2026-11-09): npm `latest`는 `0.3.0`이고 `0.4.0`은 없습니다. `npm whoami`는 401이라 publish 전에 사용자의 npm 재로그인이 필요합니다.

## Tasks

1. `release-commit`: 버전 0.4.0, `npm run check`, 커밋, push.
2. `dev-pr`: 기능 브랜치 → `dev` PR, exact head CI 성공 후 head 고정 병합.
3. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
4. `npm-publish`: exact merged main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run과 publish → registry digest 대조. 응답이 모호하면 재시도하지 않고 registry부터 조회합니다.
5. `release-verify`: 격리 prefix에 registry 0.4.0을 설치하고 `goal assign --effort`와 Heavy 완료 게이트를 확인합니다.

## Evidence

- `release-commit`: 커밋 `15a882e`. Windows CI에서 `skills/pota-plan/SKILL.md`가 CRLF로 9066바이트가 되어 예산 테스트가 실패했고, `736f066`에서 tier 작업 설명을 `delegation.md`로 넘겨 CRLF 기준 plan 8967, work 8979바이트로 줄였습니다.
- `dev-pr`: https://github.com/comento/pota-harness/pull/69 CI 7개 통과 후 head `736f066` 고정 병합(merge `518fe7f`).
- `main-pr`: https://github.com/comento/pota-harness/pull/70 CI 7개 통과 후 head `518fe7f` 고정 병합(merge `a56ab4a`). 생성 직후 BEHIND로 표시되어 동기화 PR https://github.com/comento/pota-harness/pull/71 을 열었으나, #70이 CLEAN으로 바뀌어 #70을 먼저 병합하고 #71을 이어서 병합했습니다(merge `b224984`).
- `npm-publish`: `a56ab4a`의 clean detached worktree에서 pack 1회(prepack 212/212). tarball `comento-pota-harness-0.4.0.tgz`, 139,965 bytes, 95 files, sha1 `79a810a5957eef8f4a51a6a15657005f0e61728b`, integrity `sha512-03izi9+roMSLRWdJZpuRQW9O9AmDt/zta5AzCkTUidbO/S3//dkA5Ux0Wnllai1G8XWxFgpQTd4Oncb8F4rP1Q==`. 같은 파일로 dry-run 후 게시 시도는 EOTP로 실패했고, 실제 publish는 브라우저 2FA로 사용자가 같은 tarball을 직접 실행했습니다. 레지스트리 반영 약 3분 후 shasum·integrity·`latest`=`0.4.0` 일치를 확인했습니다.
- `release-verify`: 격리된 prefix, cache, HOME, `POTA_HOME`에 레지스트리 0.4.0을 설치해 Heavy task effort 미지정 시 stderr 경고, 완료 실패, `goal assign --effort high` 후 stats `host-option`, 완료 성공을 확인했습니다.
- 후속: `main`의 머지 커밋 `a56ab4a`가 `dev`에 없어 다음 승격 때 다시 동기화가 필요할 수 있습니다. 실제 Heavy Path 실행의 Agent 호출 transcript 확인은 로컬 Pota upgrade 후 가능합니다.
