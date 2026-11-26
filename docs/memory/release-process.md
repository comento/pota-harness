# Domain: release-process

Summary: 버전 표면 4개, dev→main PR 승격(main 병합이 배포), 병합 뒤 호스트별 확인, 1.5.0 안내 릴리스와 npm 인증. 릴리스 전에 읽는다.
Paths: package.json, .github/workflows

## Scope

Pota 릴리스. 2.0.0부터 배포본은 `main` 브랜치이고 npm에는 게시하지 않는다. 플러그인 배치와 설치 명령은 `lifecycle-install.md`. 개별 릴리스의 PR 번호·SHA는 각 `docs/plan/release-*.md`에, 2.0.0과 1.5.0의 결정은 `docs/plan/plugin-native-install.md` §6.2·§8에 있다.

## Facts

### 버전 표면과 검사

- 버전 문자열은 `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, 루트 `plugin.json`(Antigravity) 네 곳과 `test/contract-parity.test.mjs`의 기대값에 있다. marketplace 파일 두 개(`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`)에는 버전을 적지 않는다. 확인: `grep -rn '"version"' package.json .claude-plugin/plugin.json .codex-plugin/plugin.json plugin.json`. 출처: `test/contract-parity.test.mjs` "package and the three host manifests expose the same version", `test/plugin-manifests.test.mjs` "the nine plugin JSON files parse and the four version surfaces agree". `pota doctor`도 설치된 사본의 네 표면이 같은지 본다.
- `package.json`은 `private: true`이고 `bin`·`files`·`prepack`이 없다(실수로 `npm publish`하면 npm이 거부한다). 파일은 `scripts/pota.mjs`가 버전을 읽고 `npm run check`를 담기 위해 남긴다. `npm pack`은 어디에서도 실행하지 않는다. 출처: `package.json`, `test/contract-parity.test.mjs`.
- `npm run check`는 남은 진입 스크립트의 `node --check`와 `npm test`(`node --test`)다. manifest JSON 유효성은 `test/plugin-manifests.test.mjs`가 본다.
- `test/repo-index.test.mjs`가 이 저장소의 `PLAN.md`·`MEMORY.md`를 `--strict`로 검사한다. 계획을 완료 목록으로 옮길 때 요약은 120자 이하로 쓰고, 완료 항목이 20개를 넘으면 `pota plan index --archive`를 실행한다(0.7.0에서 `npm run check` 실패).
- CI(`.github/workflows/ci.yml`) `check`: ubuntu·windows·macos × Node 18·current 매트릭스에서 `npm run check`, CLI smoke(`node scripts/pota.mjs`), `toolcheck --json`. 브랜치 보호의 필수 상태는 요약 job `check` 하나다. `npm pack --dry-run` 단계는 2.0.0에서 지웠다.
- CI는 `toolcheck --json` 전에 `npm install --global typescript@5.9.3 typescript-language-server@4.4.1`을 실행한다. mod의 TypeScript 파일(`hooks/register.tsx`, `types/`, `tests/`) 때문에 toolcheck가 두 도구를 요구하기 때문이다. `typescript-language-server` 5.x는 Node 20, 6.x는 Node 22 이상이라 Node 18 job이 있는 동안 4.4.1에 고정한다. 새 언어의 파일을 추가했다면 push 전에 `node scripts/pota.mjs toolcheck --json`을 깨끗한 checkout 기준으로 생각해 본다(1.2.0 dev PR에서 전 job 실패). 출처: `docs/plan/release-1.2.0.md` Evidence `dev-pr`.
- CI `host-validate`(필수 아님, `check-summary`의 `needs`에 없음): `@anthropic-ai/claude-code@2.1.327`로 `claude plugin validate .`, `@openai/codex@0.171.0`으로 `codex plugin marketplace add "$GITHUB_WORKSPACE"` → `codex plugin add pota@pota-harness` → `codex plugin list --json` → `$CODEX_HOME/plugins/cache/pota-harness/pota/*/hooks/codex.json` 확인. Codex를 실제로 설치해 보는 유일한 곳이고, 인증 없이 도는지는 확인하지 않았다. 실패하면 빨갛게 보이지만 병합은 막지 않으므로 결과를 직접 읽는다. 출처: `.github/workflows/ci.yml`, `test/docs-package-hardening.test.mjs` "CI is least-privilege, bounded, SHA-pinned, and keeps host validation out of the required check".

### 절차 (2.x)

1. 기능 브랜치에서 플러그인 내용이 바뀌었으면 버전 표면 네 곳을 같이 올리고 `npm run check`를 통과시킨 뒤 커밋·push한다. Claude Code는 `plugin.json`의 버전 문자열이 바뀌어야 업데이트로 본다.
2. 기능 브랜치 → `dev` PR. exact head의 CI가 통과하면 head SHA를 고정해 병합한다.
3. `dev` → `main` PR도 같은 방식이다. `dev`·`main`은 PR 필수와 `check` 상태 검사로 보호된다(관리자 직접 push는 우회 경고가 남는다, `docs/plan/release-0.3.0.md`). **`main` 병합이 배포다**: Claude·Codex marketplace와 `agy plugin install <repo URL>`이 기본 브랜치 `main`을 읽는다(저장소는 public).
4. 병합 커밋에 `v<version>` 태그를 단다(특정 버전에 고정하거나 되돌릴 때 쓴다).
5. `hooks/codex.json`의 선언을 바꿨다면 릴리스 노트에 Codex hook 재승인을 적는다. Codex는 업데이트마다 재승인이 필요할 수 있다(내용 해시 신뢰, 소스 기준).
6. 병합 뒤 확인(사용자가 요청한 경우에만 이 컴퓨터의 설치본을 바꾼다): `claude plugin marketplace update pota-harness && claude plugin update pota@pota-harness` 뒤 `claude plugin list --json`의 버전, `agy plugin install https://github.com/comento/pota-harness` 뒤 `agy plugin list`, 각 호스트에서 `node "<pluginRoot>/scripts/pota.mjs" doctor`. 격리해서 볼 때는 `CLAUDE_CONFIG_DIR`(Claude)와 `HOME`(agy)을 임시 경로로 둔다.
7. `main`의 병합 커밋을 `dev`에 다시 합친다. 빠뜨리면 hotfix가 `dev`에 없게 된다(`docs/plan/release-0.3.0.md` 후속).

- 1.1.0(`comento/pota-harness` 첫 릴리스): 원격 `dev`가 없어 로컬 `dev`를 push해 원격 `dev`를 만들고 `dev` → `main` PR로 바로 승격했다. 출처: `docs/plan/release-1.1.0.md`.
- 1.x까지의 절차(exact-main tarball을 한 번 pack, 같은 tarball로 `npm publish --dry-run`과 publish, `npm view … dist --json`의 shasum·integrity 대조, 격리 prefix 설치 검증)는 `docs/plan/release-0.5.0.md`, `docs/plan/release-0.4.1.md`, `docs/plan/release-0.2.7.md` "Execution Contracts"에 있다. 2.x에서는 쓰지 않는다.

### 1.5.0 안내 릴리스 (1회, `release/1.x`)

- 목적: 1.x npm 설치본 사용자를 플러그인 설치로 안내하는 마지막 npm 버전. 1.x 코드에서 SessionStart 안내만 더하고 스스로 제거하지 않는다(제거는 2.x 플러그인의 첫 SessionStart가 한다). 1.4.0의 자동 업그레이드 runner가 `npm view …@latest`로 1.5.0을 받아 `pota-lifecycle.mjs upgrade --auto`를 실행하므로 runner 계약은 그대로다.
- 브랜치: `origin/main`의 `122b031`(1.4.0)에서 `release/1.x`를 만들고 작업 브랜치 `chore/plugin-notice-1.5.0` → `release/1.x` PR로 넣는다(`ci.yml`의 `pull_request`는 base를 가리지 않아 CI가 돈다). `dev`·`main`에 병합하지 않고 `release/1.x`는 지우지 않는다. 기록은 `dev`의 이 노트와 계획 문서에만 둔다.
- 안내: `systemMessage`에 호스트별 설치 명령(Claude 줄은 `claude plugin uninstall pota@pota --scope user`를 첫 줄로 따로), 모델 컨텍스트에는 "설치 명령을 요청 없이 실행하지 말라"는 160자 이하 한 줄. 7일에 한 번, 배타적 생성 또는 rename으로 한 세션만. 1.x Antigravity 설치본은 hook이 없어 이 안내가 뜨지 않으므로 Claude·Codex 안내에 Antigravity 줄을 같이 넣는다.
- 게시 순서: ① 2.0.0을 `main`에 병합(플러그인이 설치 가능해진 뒤에 안내한다) → ② `release/1.x`의 정확한 SHA에서 tarball을 한 번 만들어 `npm publish --dry-run` 뒤 사용자가 자기 터미널에서 `npm publish <tarball>` → ③ 1.4.0 → 1.5.0 자동 업그레이드와 안내 확인 → ④ 플러그인 설치와 1.x 설치본 제거 확인 → ⑤ 사용자가 `npm deprecate @comento/pota-harness "Pota moved to host plugins: https://github.com/comento/pota-harness#install"`. deprecate를 마지막에 두는 이유는 ③이 deprecate와 무관하게 통과하는 것을 먼저 보기 위해서다. deprecate 뒤에도 1.4.0 runner의 `npm view`·`npm install`이 동작하는지는 확인하지 않았다(문제가 보이면 `npm deprecate … ""`로 푼다). 출처: 계획 §6.2, §12 U16.

### npm 인증(1.5.0 게시에 해당, 사용자 메모로 확인된 사실)

- `npm publish`, `npm login`, `npm deprecate`는 대화형 인증(OTP·브라우저 승인)이 필요하다. 에이전트의 비대화형 셸에서 실행하면 EOTP로 실패한다(0.4.1, 0.5.0에서 발생). 토큰이 만료되면 `npm whoami`가 401이고, publish는 PUT E404로 보인다.
- 그래서 `npm login --auth-type=web`과 `npm publish <정확한 tarball 경로>`는 사용자의 터미널에서 실행한다. pack 전에 `npm whoami`를 먼저 확인한다. 1.5.0의 `prepack`(1.x)은 `npm run check`이므로 pack이 전체 테스트를 돌린다. 로컬 pack 검증에 `--ignore-scripts`를 쓰지 않는다.
- 게시 직후 registry 조회는 수 분간 404일 수 있다. 재게시하지 말고 반영을 기다린다. 출처: `docs/plan/release-0.5.0.md` Evidence `npm-publish`.

### 알려진 위험

- Windows + Node current에서 lock 테스트 "a stale observer never displaces a confirmed live owner"(1.x에서는 `test/lifecycle-transaction-commit.test.mjs`, 2.0.0부터 `test/lifecycle-lock.test.mjs`)가 1회 실패한 적이 있다(lock 대기 1초에 1018ms). lock 코드를 건드리지 않았다면 실패 job만 재실행한다. 출처: `docs/plan/release-0.5.0.md` Evidence `dev-pr`.
- Windows 체크아웃은 `.gitattributes`(`* text=auto eol=lf`)로 LF에 고정돼 있다. 이 파일이 없으면 CRLF 때문에 SKILL.md 바이트 예산과 템플릿 동일성 테스트가 Windows에서만 실패한다(0.6.0 dev PR에서 발생). 예산에 가까운 문서를 고쳤다면 Windows job 결과를 먼저 본다. 출처: `docs/plan/release-0.6.0.md` Evidence `dev-pr`.
- Windows CI의 임시 경로는 8.3 짧은 이름(`RUNNER~1`)이다. git이 기록하는 긴 경로와 달라 worktree를 쓰는 테스트는 임시 root를 `realpathSync.native`로 풀어야 한다. `repositoryId`는 경로 해시라 같은 문제가 실제 사용에서도 날 수 있다(미수정). 출처: `test/goal-history.test.mjs` "goal stats --history aggregates across worktree directories of the same repository".
- Windows에서만 깨지는 테스트 helper 패턴 두 가지(0.7.0 dev PR): JSON 파일 안의 경로는 백슬래시가 escape돼 있어 raw 문자열 치환으로 바뀌지 않는다. `cpSync`의 `filter`가 받는 경로 형태가 Windows Node 18에서 달라 제외가 듣지 않는다(항목별 복사를 쓴다). 출처: `docs/plan/release-0.7.0.md` Evidence `dev-pr`.
- 2.x의 Windows 동작(이전, hook, mod)은 CI 매트릭스의 단위 테스트 외에는 확인하지 않았다.
- 깊은 경로 worktree나 설치 경로에서는 hook 예산 테스트가 경로 길이에 걸릴 수 있다(0.3.0 hotfix). 캡슐에 절대 경로를 하나(`Pota CLI:` 줄)만 넣는 규칙이 이 사고에서 나왔다(`hook-context.md`).

## Policy

- 2.x는 npm에 게시하지 않는다. 배포는 `main` 병합이고, 플러그인 내용이 바뀐 `main` PR은 버전 표면 네 곳을 같이 올린다.
- 게시된 npm 버전은 되돌릴 수 없다. unpublish, dist-tag 이동, 맹목적 재게시로 복구하지 않는다. 문제가 있으면 증거를 보존하고 새 corrective 버전을 계획한다(`docs/plan/release-0.2.7.md`).
- publish 응답이 모호하면 재시도하기 전에 registry부터 조회한다.
- 커밋·push·PR·게시·태그·설치본 교체는 사용자가 요청한 범위에서만 한다.

## References

- `npm run check`, `node scripts/pota.mjs doctor`, `claude plugin validate .`, `HOME=<임시> agy plugin validate .`(`--strict` 없이)
