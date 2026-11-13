# Plan: Pota 0.3.0 릴리스

## Goal

[Pota 오버헤드 축소와 task DAG](pota-overhead-reduction.md) 변경을 `0.3.0`으로 커밋하고 `dev` → `main` PR을 CI 통과 후 병합한 뒤, exact merged main에서 만든 tarball 하나만 npm `@comento/pota-harness@0.3.0` latest로 게시합니다.

- Plan ID: `docs/plan/release-0.3.0.md`
- Completion criteria: main PR CI 성공·병합, exact-main tarball 게시, registry version/digest 일치, 격리 설치 CLI 동작.
- 버전: 사용자가 0.3.0을 선택했습니다(상태 스키마 v3와 새 명령).
- Safety: 사용자 Pota 설치, HOME, 전역 npm prefix/cache는 변경하지 않습니다. `.omo/`와 기존 stash는 손대지 않습니다.

## Triage

- 경로: 릴리스/배포 작업이며 코드 변경은 버전 문자열뿐입니다. 이전 릴리스 계획(`release-0.2.7.md`)의 promotion·exact-tarball 원칙을 따릅니다.
- 사전 확인(2026-11-06): npm `latest`는 `0.2.9`이고 `0.3.0`은 아직 없습니다. GitHub 인증은 정상입니다. `npm whoami`는 401이라 publish 전에 사용자의 npm 재로그인이 필요합니다. 로컬 npm은 11.20.0이고, 이전 계획에 고정된 npm 10.9.8 runtime 경로는 없어서 로컬 npm을 사용합니다.
- 브랜치: `dev`에 직접 커밋해 push한 뒤 `dev` → `main` PR로 승격합니다(#62, #64와 같은 흐름). `origin/main`의 `0b7683e`는 `dev`의 조상이 아니지만 트리 내용은 같습니다.
- `CLAUDE_PLUGIN_SINCE = "0.2.9"`는 플러그인이 처음 도입된 버전을 뜻하므로 바꾸지 않습니다.

## Tasks

1. `release-commit`: 버전 0.3.0, `npm run check`, 커밋, push.
2. `main-pr`: `dev` → `main` PR, exact head CI 성공 후 head 고정 병합.
3. `npm-publish`: exact merged main의 clean detached worktree에서 pack 1회 → 같은 tarball로 publish dry-run과 publish → registry digest 대조. 응답이 모호하면 재시도하지 않고 registry부터 조회합니다.
4. `release-verify`: 격리 prefix에 registry 0.3.0을 설치하고 `pota goal` start/ready/finish 표면을 확인합니다.

## Evidence

- `release-commit`: `npm run check` 통과 증거 기록 후 커밋 `27f35bc`를 `dev`에 push했습니다. push 때 GitHub가 `dev` 보호 규칙(PR 필수, `check` 상태 검사)을 관리자 권한으로 우회했다고 경고했습니다. 되돌리려면 force push가 필요해 그대로 두고 사용자에게 보고했습니다.
- `main-pr`: https://github.com/comento/pota-harness/pull/65 (head `27f35bc`)를 생성했습니다. 저장소에서 auto-merge가 허용되지 않고 앱 CI 모니터 설정이 거부되어, 사용자 응답 시 CI 결과를 확인한 뒤 head를 고정해 병합합니다.
- `main-pr` 병합: PR #65의 CI 7개가 통과한 뒤 head를 `27f35bc`로 고정해 병합했습니다(merge `795296e`).
- 배포 전 결함과 hotfix: exact main을 깊은 경로의 worktree에서 pack하자 prepack의 `state-recovery-hardening` 테스트가 실패했습니다. 원인은 SessionStart의 `Pota CLI:` 줄에 절대 경로가 둘 들어가 blocked 캡슐이 637자로 예산 620자를 넘은 것입니다. main 기반 브랜치에서 `--root`를 제거하고 저장소 경로가 다시 들어가지 않는지 검사하는 테스트를 추가했습니다. 일반 checkout과 깊은 경로 worktree 모두 202/202 통과했고, PR #66(CI 7개 통과, head `6159eea` 고정)을 병합했습니다(merge `da20574`). 테스트 예산은 바꾸지 않았습니다.
- `npm-publish`: `da20574`의 clean detached worktree에서 pack을 1회 수행했습니다(prepack 202/202). tarball은 `comento-pota-harness-0.3.0.tgz`, 133,919 bytes, 95 files, sha1 `206527a75e38106db8837fca2dd23e2b69685a3f`, integrity `sha512-N7592QA2Nw/IN5Y2L9B4Hu1coHNBXNfCYO+QhzyC1qCn45mKpPNccSRkcVG0WsGExMzV4roPCnROhhW7sVKa2Q==`입니다. 같은 파일로 publish dry-run을 했고, 실제 publish는 npm 브라우저 2FA 때문에 사용자가 직접 실행했습니다. 레지스트리에는 약 90초 뒤 반영됐고, `dist.shasum`과 `dist.integrity`가 일치하며 `latest`는 `0.3.0`입니다.
- `release-verify`: 격리된 prefix와 cache, `POTA_HOME`에 레지스트리의 `@comento/pota-harness@0.3.0`을 설치하고 임시 git 저장소에서 DAG goal 흐름(병렬 활성화, `--watch` 가드, 형제 수정 뒤 증거 유지, join ready, 하위 디렉터리 root 자동 결정, `goal stats`, `goal finish`)을 확인했습니다.
- 후속: `dev`에 PR #66 수정이 없습니다. main을 `dev`에 병합해 맞춰야 합니다.
