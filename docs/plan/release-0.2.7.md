# Plan: Pota 0.2.7 릴리스

## Plan Phase

- Initial: decision-complete for release execution.
- Finalized: release branch, PR promotion, publish, registry, and isolated lifecycle QA evidence recorded.
- Completed: exact main tarball, registry digest, and final review are all bound to the same release.

## Goal

state/lifecycle 계약 hardening과 contract-preserving module split을 Pota `0.2.7`로 dev와 main에 순차 승격한 뒤, exact merged main 산출물 하나만 npm `@comento/pota-harness@0.2.7` latest로 게시합니다.

- Plan ID: `docs/plan/release-0.2.7.md`
- Completion criteria: P0/P1 atomic commit series 보존, dev/main PR CI 성공 및 병합, exact-main 단일 tarball 게시, registry digest 일치, 완전 격리 install/upgrade/doctor/uninstall QA 성공.
- Required goal evidence: `finalReview`.
- Safety: 사용자 Pota 설치, 사용자 HOME, 기존 npm prefix/cache, 원격 branch/history는 되돌리거나 직접 변경하지 않습니다.

## Whole Work

1. `triage-plan`: branch/commit, clean worktree, GitHub/npm 인증, 0.2.7 registry 부재, required check와 publish 도구를 확인합니다.
2. `release-prepare`: P0/P1 atomic commit series와 0.2.7 manifest, legacy 0.2.2 integrity/adoption semantics를 검증하고 release-plan commit을 추가합니다.
3. `dev-pr`: release branch의 exact head를 `dev` PR로 승격하고 해당 head의 required CI 성공 후 병합합니다.
4. `main-pr`: exact merged `dev` head만 `main` PR로 승격하고 해당 head의 required CI 성공 후 병합합니다.
5. `npm-publish`: exact merged `main` SHA의 clean detached worktree에서 tarball을 한 번 만들고, 그 동일 tarball만 dry-run과 실제 npm publish에 사용합니다.
6. `release-complete`: registry digest와 격리 lifecycle QA, PR/merge ancestry를 독립 재검토합니다.

## Triage Result

- Base state: release 시작 기준 `origin/dev`와 `origin/main`은 모두 `d489c01`입니다. local `dev` head `d8af8b3`는 `d489c01`의 descendant이며 아래 release scope commit을 포함합니다.
- Version surfaces: `package.json`과 `.codex-plugin/plugin.json`은 모두 `0.2.7`입니다. release preparation은 두 manifest가 계속 정확히 `0.2.7`인지 확인하며 package metadata를 다시 변경하지 않습니다.
- Release branch: `release/0.2.7-state-lifecycle-contracts`를 fresh `origin/dev`에서 만들고, 아래 atomic series와 이 plan의 단일 docs commit만 포함합니다. release 실행 중 series를 squash, reorder, amend하지 않습니다.
- Tags: 최근 tag는 release 전제조건이 아닙니다. fresh `origin/dev`/`origin/main` SHA와 PR/CI evidence만 사용하며, 이 계획은 tag 생성 또는 최근 tag 조회를 요구하지 않습니다.
- Package lifecycle: `prepack`은 `npm run check`을 실행하므로 pack/publish에는 `--ignore-scripts`를 쓰지 않습니다. pack과 publish는 `/private/tmp/pota-npm-runtime/node_modules/npm/bin/npm-cli.js`의 검증된 npm 10.9.8 CLI로 고정합니다.
- Legacy boundary: `scripts/release-integrity-0.2.2.json`의 pinned SHA-256 allowlist와 exact 0.2.2 adoption semantics는 변경하지 않습니다. 0.2.2 tree가 정확히 일치할 때만 adoption하고 변경되거나 extra file이 있는 legacy tree는 fail closed 및 untouched여야 합니다.

## Release Scope and Atomic Commits

### P0: state/lifecycle contract hardening

- `9baa11b` `fix: harden Pota state and lifecycle contracts`: state recovery, lifecycle ownership/config, cleanup, CLI/package/docs contract와 regression coverage를 harden합니다.
- `dd30429` `fix: prevent stale lock reclaim races`: stale lifecycle lock reclaim race를 방지하고 verification contract를 고정합니다.
- `d8af8b3` `fix: restore goal CLI executable mode`: `scripts/pota-goal.mjs` executable mode를 `100755`로 복구합니다.

### P1: observable contract를 보존하는 module split

- `cfb543e` `refactor: split toolcheck detection and runtime`.
- `e515340` `refactor: split state rendering and initialization`.
- `c23cf71` `refactor: split lifecycle recovery and integrity`.
- `2e98d87` `refactor: split goal state and operations`.

P1은 public CLI, package contents, lifecycle transaction/rollback, ownership digest, legacy 0.2.2 adoption의 observable semantics를 바꾸지 않습니다. P0/P1 밖의 code, package metadata, documentation 변경은 release branch에 넣지 않습니다.

## Required Checks

- `git fetch origin --prune`, `git status --short`, `git diff --check`, `git merge-base --is-ancestor d489c01 HEAD`, 그리고 seven scope commit이 release head의 ancestry에 존재하는지 확인합니다.
- `node -e "const fs=require('node:fs'); for (const f of ['package.json','.codex-plugin/plugin.json']) { const v=JSON.parse(fs.readFileSync(f,'utf8')).version; if (v !== '0.2.7') throw new Error(f + ': ' + v); }"`.
- `npm run check`, `node /private/tmp/pota-npm-runtime/node_modules/npm/bin/npm-cli.js pack --dry-run --json`, `node /private/tmp/pota-npm-runtime/node_modules/npm/bin/npm-cli.js publish --dry-run --access public --tag latest --json`.
- `npm whoami`과 `npm view @comento/pota-harness@0.2.7 version dist --json`을 publish 직전에 실행합니다. latter는 반드시 E404여야 합니다. `@comento/pota-harness@0.2.7`이 이미 존재하면 publish하지 않고 중단합니다.
- `gh auth status`, exact PR head의 required workflow/check 성공, merge 직전 base/head SHA 재조회. required check 이름이나 count는 live repository policy에서 조회하며 과거 CI 결과나 미관찰 SHA를 가정하지 않습니다.

## Execution Contracts

### Task 0: triage-plan

- Status: ready.
- Contract: fresh fetch 뒤 release branch base, clean worktree, npm/GitHub auth, 0.2.7 E404, package lifecycle, required CI policy를 read-only로 확정합니다.
- Failure boundary: dirty tracked worktree, base drift, auth failure, npm 10.9.8 부재, 또는 0.2.7 registry 존재는 이후 mutation 전에 중단합니다.

### Task 1: release-prepare

- Status: ready.
- Contract: fresh `origin/dev`에서 release branch를 만들고 `git cherry-pick 9baa11b cfb543e e515340 dd30429 c23cf71 2e98d87 d8af8b3`로 seven P0/P1 commits를 observed order 그대로 적용한 뒤 `docs/plan/release-0.2.7.md`만 별도 release-plan commit으로 추가합니다. atomic series의 subject/order/mode를 유지하고 0.2.2 integrity JSON과 adoption checks가 unchanged인지 확인합니다.
- Tests: required checks 전체와 `git diff --check`를 통과합니다. `test/lifecycle-transaction.test.mjs`의 exact 0.2.2 adoption, modified/extra legacy tree fail-closed, 0.2.2→0.2.7 upgrade/rollback coverage가 `npm run check`에서 통과해야 합니다.
- Failure boundary: legacy allowlist 또는 semantics 변경, manifest version mismatch, check/dry-run failure는 commit/push 전에 중단합니다.

### Task 2: dev-pr

- Status: ready.
- Contract: clean release head를 push하고 base `dev` PR을 만듭니다. exact PR head SHA의 live required checks가 모두 성공한 뒤, merge 직전 head/base를 재조회하고 그 SHA를 `--match-head-commit` 또는 equivalent expected-head guard로 고정해 merge commit 방식으로 병합합니다.
- Failure boundary: head/base drift, unrelated commit, required check failure/pending/missing, or expected-head rejection이면 merge하지 않습니다. fix가 필요하면 release branch의 bounded atomic fix commit과 required checks 전체를 새 head에서 다시 실행합니다.

### Task 3: main-pr

- Status: ready.
- Contract: fresh fetch한 exact `origin/dev` merge head만 head로 하여 `dev` → `main` PR을 만듭니다. same exact head의 live required checks가 성공하고 base `main`이 최신임을 확인한 뒤 expected-head guard로 merge commit을 수행합니다.
- Failure boundary: dev에 unrelated change가 추가되었거나 main base/head/CI evidence가 달라지면 main merge를 중단합니다. release branch를 다시 main에 직접 PR하지 않습니다.

### Task 4: npm-publish

- Status: ready.
- Preconditions: freshly fetched `origin/main` SHA, main PR merge SHA, detached worktree `HEAD`가 모두 동일하고 clean입니다; two manifests are `0.2.7`; npm 10.9.8 `whoami` succeeds; `npm view @comento/pota-harness@0.2.7 version dist --json` is E404 immediately before publish.
- Contract: `artifact_root="$(mktemp -d /private/tmp/pota-0.2.7-artifact.XXXXXX)"`를 만들고 exact merged main SHA의 detached clean worktree에서 `npm10=(node /private/tmp/pota-npm-runtime/node_modules/npm/bin/npm-cli.js); pack_json="$("${npm10[@]}" pack --json --pack-destination "$artifact_root")"; tarball="$artifact_root/$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(p[0].filename)' "$pack_json")"`를 정확히 한 번 실행합니다. 생성된 `tarball` absolute path, SHA-1 shasum, SHA-512 integrity, size를 기록합니다. 작업 tree를 재pack하거나 다른 tarball을 만들지 않고, `"${npm10[@]}" publish --dry-run --access public --tag latest "$tarball"`와 `"${npm10[@]}" publish --access public --tag latest "$tarball"`에 그 같은 absolute `.tgz`를 전달합니다.
- Invariant: npm에 게시하는 것은 exact merged main SHA에서 한 번 만든 동일 tarball 하나입니다. publish dry-run, actual publish, registry `dist.shasum`과 `dist.integrity`가 그 artifact와 정확히 같아야 합니다.
- Registry verification: publish 뒤 `npm view @comento/pota-harness@0.2.7 version dist --json`과 `npm view @comento/pota-harness dist-tags --json`을 조회합니다. `version=0.2.7`, `latest=0.2.7`, registry tarball URL, shasum, integrity가 recorded artifact와 일치해야 합니다.
- Failure boundary: publish timeout, connection loss, or ambiguous response에는 blind retry하지 않습니다. 먼저 registry version/dist를 조회합니다. version이 있고 both digest가 fixed tarball과 일치하면 success로 진행하고, version이 없거나 digest가 다르면 publish를 재시도하지 않고 blocked로 기록합니다.

### Task 5: isolated install, upgrade, doctor, and uninstall QA

- Status: ready.
- Contract: one fresh temporary root 아래 `HOME`, `CODEX_HOME`, `CODEX_CONFIG_PATH`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`, npm cache, npm prefix를 모두 명시합니다. 사용자 home, global prefix, cache와 current Pota installation은 읽거나 변경하지 않습니다.
- QA sequence: isolated prefix에 registry `@comento/pota-harness@0.2.2`를 설치해 exact legacy install을 수행하고, same isolated prefix를 registry `@comento/pota-harness@0.2.7`로 upgrade합니다. `pota install`, `pota upgrade`, `pota doctor`, `pota uninstall`을 그 isolated environment에서 순서대로 실행합니다. install/upgrade/uninstall은 zero exit이고 upgrade ownership version은 `0.2.7`, previous 0.2.2 runtime removal, 0.2.2 pinned-integrity adoption, and `doctor` all-OK output을 확인합니다. uninstall 뒤 ownership/managed runtime removal과 unrelated user fixture preservation을 확인합니다.
- Failure boundary: install/upgrade/doctor/uninstall failure, ownership digest mismatch, modified legacy tree adoption, or user-path write는 release completion을 중단합니다. published npm version은 immutable이므로 unpublish, dist-tag retarget, history rewrite를 rollback으로 사용하지 않습니다; exact evidence를 보존하고 corrective patch release를 준비합니다.

### Task 6: release-complete

- Status: ready.
- Contract: release→dev and dev→main PR head/merge ancestry, exact main SHA, all required CI receipts, fixed tarball digest, registry metadata, and isolated lifecycle QA receipt를 read-only로 대조합니다. 모든 evidence가 동일 release SHA/version/digest를 가리킬 때만 completed로 기록합니다.

## Rollback and Stop Conditions

- Publish 전 check/CI/base/head/registry-absence failure는 push/merge/publish를 진행하지 않습니다. unmerged release PR은 close할 수 있으나 merged `dev`/`main` history는 rewrite하지 않습니다.
- lifecycle transaction failure는 isolated fixture의 journal/backup rollback contract로만 복구를 검증합니다. 사용자 filesystem에는 rollback을 시도하지 않습니다.
- npm publish 뒤 digest, latest, or isolated QA가 실패하면 release 완료를 선언하지 않습니다. npm version을 삭제하거나 blind republish하지 않고, registry evidence와 isolated artifact를 보존한 뒤 새 corrective version의 bounded release plan으로 처리합니다.

## Status

- [x] Initial plan created
- [ ] Triage finalized
- [ ] Release prepared
- [ ] dev PR merged
- [ ] main PR merged
- [ ] npm 0.2.7 published and verified
- [ ] Isolated lifecycle QA completed
- [ ] Final review completed
