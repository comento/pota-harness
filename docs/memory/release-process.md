# Domain: release-process

Summary: 버전 표면, dev→main PR 승격, exact-main tarball 게시와 npm 대화형 인증, 게시 후 검증·로컬 업그레이드 절차. 릴리스 전에 읽는다.

## Scope

`@comento/pota-harness` npm 패키지 릴리스. 설치·업그레이드 내부 동작은 `lifecycle-install.md`. 개별 릴리스의 PR 번호·digest는 각 `docs/plan/release-*.md`에 있다.

## Facts

### 버전 표면과 검사

- 버전 문자열은 `package.json`, `.codex-plugin/plugin.json`, `test/contract-parity.test.mjs`의 기대값 세 곳에 있다(0.7.0부터 나머지 테스트는 `package.json`에서 읽는다). `test/index-context.test.mjs`의 `0.5.0`은 baseline 주석이다. 확인: `grep -rn '<현재 버전>' package.json .codex-plugin test`. 출처: `docs/plan/release-0.7.0.md` Triage.
- `test/repo-index.test.mjs`가 이 저장소의 `PLAN.md`·`MEMORY.md`를 `--strict`로 검사한다. 계획을 완료 목록으로 옮길 때 요약은 120자 이하로 쓰고, 완료 항목이 20개를 넘으면 `pota plan index --archive`를 실행한다(0.7.0에서 `npm run check` 실패).
- `npm run check`는 핵심 스크립트 `node --check`, JSON 파싱, `npm test`(`node --test`)를 실행한다. `prepack`이 `npm run check`라서 `npm pack`·`npm publish`도 전체 테스트를 돌린다. 로컬 pack 검증에 `--ignore-scripts`를 쓰지 않는다. 출처: `package.json` `scripts`.
- CI(`.github/workflows/ci.yml`)는 ubuntu·windows·macos × Node 18·current 매트릭스에서 `npm run check`, CLI smoke, `toolcheck --json`, `npm pack --dry-run --ignore-scripts`를 실행한다. 여기서 `--ignore-scripts`는 같은 job에서 check가 이미 돌았기 때문이다. 브랜치 보호의 필수 상태는 요약 job `check` 하나다.
- 배포 파일은 `package.json` `files`가 정한다. 저장소의 `docs/memory`, `docs/plan`, `MEMORY.md`, `PLAN.md`는 패키지에 들어가지 않는다.

### 절차(0.4.x~0.5.0에서 반복된 형태)

1. 기능 브랜치에서 버전을 올리고 `npm run check`를 통과시킨 뒤 커밋·push한다.
2. 기능 브랜치 → `dev` PR. exact head의 CI가 통과하면 head SHA를 고정해 병합한다.
3. `dev` → `main` PR도 같은 방식이다. `dev`·`main`은 PR 필수와 `check` 상태 검사로 보호된다(관리자 직접 push는 우회 경고가 남는다, `docs/plan/release-0.3.0.md`).
4. 병합된 `main` SHA의 clean detached worktree에서 `npm pack`을 한 번만 한다. 같은 tarball로 `npm publish --dry-run`과 실제 publish를 한다.
5. 게시 뒤 `npm view @comento/pota-harness@<v> dist --json`의 shasum·integrity와 `latest`를 tarball과 대조한다.
6. 격리된 prefix·cache·HOME·`POTA_HOME`에 registry 버전을 설치해 새 기능을 확인한다.
7. 사용자가 요청한 경우에만 로컬 설치본을 올린다: `npm install -g @comento/pota-harness@<v>` → `pota upgrade` → `pota doctor`(첫 줄 `Hosts:`). 자동 업그레이드가 켜진 package 설치본은 게시 뒤 24시간 안에 SessionStart가 스스로 올리므로 먼저 `pota auto-upgrade status`로 확인한다(`lifecycle-install.md` 자동 업그레이드).
8. `main`의 병합 커밋을 `dev`에 다시 합친다. 빠뜨리면 hotfix가 `dev`에 없게 된다(`docs/plan/release-0.3.0.md` 후속).

출처: `docs/plan/release-0.5.0.md`, `docs/plan/release-0.4.1.md`, `docs/plan/release-0.2.7.md` "Execution Contracts".

### npm 인증(사용자 메모로 확인된 사실)

- `npm publish`와 `npm login`은 대화형 인증(OTP·브라우저 승인)이 필요하다. 에이전트의 비대화형 셸에서 실행하면 EOTP로 실패한다(0.4.1, 0.5.0에서 발생). 토큰이 만료되면 `npm whoami`가 401이고, publish는 PUT E404로 보인다.
- 그래서 `npm login --auth-type=web`과 `npm publish <정확한 tarball 경로>`는 사용자의 터미널에서 실행한다. pack 전에 `npm whoami`를 먼저 확인한다.
- 게시 직후 registry 조회는 수 분간 404일 수 있다. 재게시하지 말고 반영을 기다린다. 출처: `docs/plan/release-0.5.0.md` Evidence `npm-publish`.

### 알려진 위험

- Windows + Node current에서 `test/lifecycle-transaction.test.mjs` "a stale lifecycle observer never displaces a confirmed live lifecycle owner"가 1회 실패한 적이 있다(lock 대기 1초에 1018ms). lock 코드를 건드리지 않았다면 실패 job만 재실행한다. 출처: `docs/plan/release-0.5.0.md` Evidence `dev-pr`.
- Windows 체크아웃은 `.gitattributes`(`* text=auto eol=lf`)로 LF에 고정돼 있다. 이 파일이 없으면 CRLF 때문에 SKILL.md 바이트 예산과 템플릿 동일성 테스트가 Windows에서만 실패한다(0.6.0 dev PR에서 발생). 예산에 가까운 문서를 고쳤다면 Windows job 결과를 먼저 본다. 출처: `docs/plan/release-0.6.0.md` Evidence `dev-pr`.
- Windows CI의 임시 경로는 8.3 짧은 이름(`RUNNER~1`)이다. git이 기록하는 긴 경로와 달라 worktree를 쓰는 테스트는 임시 root를 `realpathSync.native`로 풀어야 한다. `repositoryId`는 경로 해시라 같은 문제가 실제 사용에서도 날 수 있다(미수정). 출처: `test/goal-history.test.mjs` "goal stats --history aggregates across worktree directories of the same repository".
- Windows에서만 깨지는 테스트 helper 패턴 두 가지(0.7.0 dev PR): JSON 파일 안의 경로는 백슬래시가 escape돼 있어 raw 문자열 치환으로 바뀌지 않는다. `cpSync`의 `filter`가 받는 경로 형태가 Windows Node 18에서 달라 제외가 듣지 않는다(항목별 복사를 쓴다). 출처: `docs/plan/release-0.7.0.md` Evidence `dev-pr`, `test/fixtures/fake-npm.mjs`.
- 깊은 경로 worktree에서 pack하면 hook 예산 테스트가 경로 길이에 걸릴 수 있다(0.3.0 hotfix). 캡슐에 절대 경로를 넣지 않는 규칙이 이 사고에서 나왔다(`hook-context.md`).

## Policy

- 게시된 npm 버전은 되돌릴 수 없다. unpublish, dist-tag 이동, 맹목적 재게시로 복구하지 않는다. 문제가 있으면 증거를 보존하고 새 corrective 버전을 계획한다(`docs/plan/release-0.2.7.md`).
- publish 응답이 모호하면 재시도하기 전에 registry부터 조회한다.
- 커밋·push·PR·게시·설치본 업그레이드는 사용자가 요청한 범위에서만 한다.

## References

- `npm run check`, `npm pack --dry-run`, `npm view @comento/pota-harness@<v> version dist --json`
