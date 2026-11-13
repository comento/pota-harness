# Plan: 경로별 추론 강도 변경 보존 및 PR 게시

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation. Heavy Path 실행 순서, 보존·충돌·검증·게시 계약과 GitHub 인증을 확정했습니다.
- Codex UI synchronization: 초기 roadmap을 `update_plan`과 `create_goal`에 동기화했으며, 최종 roadmap도 같은 순서로 유지합니다.

## Goal

현재 `dev` 작업 트리의 변경을 복구 가능한 형태로 보존하고 최신 `origin/dev`에서 새 브랜치를 만든 뒤 변경을 재적용·검증하여 원격 브랜치와 `dev` 대상 PR로 게시합니다.

- Goal ID: `goal-a681b5d2-4948-457b-b4c7-ba3b7a363dcc`
- Plan ID: `docs/plan/publish-path-reasoning-effort-routing.md`
- Runtime resources: `pota://` resources resolved by the installed Pota version.
- Completion criteria: 기존 변경의 보존 증거, 최신 `origin/dev` 기반 새 브랜치, 의도한 변경의 무손실 재적용, 로컬 검증 성공, 원격 push와 `dev` 대상 PR 생성 및 read-back 확인.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome: dirty `dev`의 변경을 잃지 않고 최신 upstream 기반 feature branch와 검증된 PR로 전환합니다.
- Affected surfaces: Git worktree/index/stash 또는 안전 백업, local/remote refs, current Pota plan/state, repository tests, GitHub pull request.
- Task classification: `triage-plan` → `preserve-and-rebase` → `verify` → `push-pr` → `final-review`.
- Sub-tasks: 변경 목록·diff·untracked 보존 확인, fetch 전 dry-run/read-only 검사, 새 브랜치 생성, 변경 재적용 및 충돌 판정, 검증, push dry-run, push/PR, read-back.

## Memory Inputs

- `MEMORY.md`
- triage에서 Git/release 관련 `docs/memory/*.md`가 있을 때 필요한 파일만 읽습니다.

## Model Guidance

- Applied model family: Codex.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/codex.md`.
- Rationale: Git 상태 보존과 외부 상태 변경을 증거 기반으로 순차 처리해야 합니다.
- Role-specific adjustment: main session이 단일 Git worktree의 보존·브랜치 전환과 외부 변경을 직접 조율합니다. 현재 상위 정책상 사용자 요청 없는 subagent 위임은 하지 않습니다.
- User-visible response and artifact locale: 한국어.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: dirty worktree 보존, 기준 브랜치 교체, 원격 push 및 GitHub PR 생성이 포함됩니다.
- Heavy Path signals checked:
  - New directory/module/layer: 없음.
  - New domain model/service/abstraction: 없음.
  - Security/auth/session: 없음.
  - External API/message queue/payment: Git remote push와 GitHub PR 생성이 해당합니다.
  - DB schema/migration: 없음.
  - Concurrency/transaction/cache invalidation: Git worktree/stash/ref 전환의 순서 의존성이 있습니다.
  - Cross-domain refactor: 현재 변경 자체는 여러 Pota 정책·runtime·test 표면을 수정합니다.
  - Explicit extra-care signal: 변경 보존부터 PR까지 순서를 사용자가 명시했습니다.
- Heavy Path trigger: external state mutation and explicit extra-care workflow.
- Pre-implementation decisions:
  - backup: 추적 변경은 `git diff --binary --output=<backup>/tracked.patch`, 미추적 plan 3개는 tar archive로 보존하고 SHA-256을 기록합니다.
  - Git preservation: backup digest 확인 후 `git stash push -u`를 사용하고, 재적용은 `git stash apply`로 수행하여 검증 완료 전 stash를 삭제하지 않습니다.
  - Branch: `agent/path-reasoning-effort-routing`, base=`origin/dev`. 생성 직전 local/remote ref 부재를 다시 확인합니다.
  - Conflict gate: apply 후 unmerged entry가 있으면 먼저 편집·검증·push를 중단하고 backup/stash 위치와 충돌 목록을 보고합니다. 계속 실행 신호를 받은 뒤에만 upstream과 stash 양쪽 계약을 대조한 bounded 3-way 해소를 plan에 기록하고 재개합니다.
  - Scope: 재적용·충돌 해소 후 `origin/dev` 대비 22개 추적 파일과 `docs/plan/path-reasoning-effort-routing.md`, `docs/plan/staged-complexity-reassessment.md`, 이 게시 plan을 포함합니다. `.codex-plugin/plugin.json`은 upstream compact kernel을 그대로 유지해 최종 diff가 없으며 다른 파일은 stage하지 않습니다.
  - Validation: `git diff --check`, 집중 Node tests, `npm run check`, normal `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
  - Publication: explicit path stage, commit `Route reasoning effort by Pota path`, `git push --dry-run`, push, GitHub App으로 draft PR 생성, base/head/body read-back.

## Agent Assignments

- Main session: 상태 일관성, 보존/브랜치 전환, external-state dry-run, push/PR 및 최종 검증.
- Explorer/reviewer: 현재 지침상 별도 위임은 사용하지 않고 main session이 read-only triage와 review를 수행합니다.
- Worker: 이번 task는 Git worktree 소유권이 단일 세션에 있어 위임하지 않습니다.

## Tool Readiness

- Detected stack: JavaScript(Node.js 18+, ESM), Markdown/JSON 정책 산출물.
- Toolcheck command: installed Pota `toolcheck --root /Users/wknam/workspace/pota-harness` — Node/npm OK.
- Required LSP/symbol tools: 새 코드 구현이 아닌 기존 변경 게시이므로 기존 Node parser/test와 diff 검토를 사용합니다.
- Required verification tools: git, Node/npm repository checks, GitHub CLI prerequisite, GitHub App PR creation.
- Missing tools: 없음. 샌드박스 내부 `gh auth status`는 keyring 접근 제한으로 실패했지만, 샌드박스 밖 재검증에서 `dspaudio` 계정과 `repo`/`workflow` scope가 정상임을 확인했습니다.
- Install approval: not needed unless a required tool is missing; 설치는 별도 승인 전 수행하지 않습니다.
- Tool blockers: 없음.

## Execution Guardrails

- 보존 artifact와 digest를 확인하기 전 checkout/switch/reset/stash 적용을 하지 않습니다.
- `origin/dev` fetch 후 새 브랜치가 정확히 fetch된 ref에서 시작하는지 확인합니다.
- stash를 사용할 경우 `apply` 후 검증이 끝날 때까지 원본 stash를 삭제하지 않습니다.
- 충돌·누락·예상 밖 diff가 있으면 push/PR을 중단합니다.
- 외부 상태 변경 전 `git push --dry-run`과 GitHub compare/read-only 확인을 수행합니다.
- upstream overlap: 현재 `origin/dev`의 9개 선행 commit은 변경 파일 다수와 겹치므로 3-way 재적용을 사용하고 자동 충돌 해결을 가정하지 않습니다.
- Conflict-resolution checkpoint: 최초 apply에서 6개 충돌을 보고한 뒤 continuation hook을 받았습니다. `preserve-and-rebase`를 active로 복구하고 `verify`를 pending으로 되돌렸습니다. compact prompt/cache 복원력과 reasoning/staged-triage 계약을 함께 보존하는 수동 합집합 해소를 승인합니다.
- Verification loop budget: two passes per task.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Initial status: `active`
- Contract: 현재 branch/diff/untracked/upstream, plan/state, stack/check 명령, remote/PR 상태를 read-only로 조사하고 보존·재적용·검증·게시 절차를 implementation-ready로 확정합니다.
- Result: 조사와 절차 확정이 완료됐고 샌드박스 밖 `gh auth status`가 성공했습니다.
- Required evidence: `planArtifact`, `triageDecision`.

### Task 1: preserve changes and create current branch

- Task ID: `preserve-and-rebase`
- Initial status: `pending`
- Contract: 현재 변경을 복구 가능한 artifact와 Git 보존 상태로 보존하고 최신 `origin/dev`에서 새 브랜치를 만든 뒤 변경을 재적용합니다.
- Dry-run/check: 변경 파일·untracked manifest·binary patch digest, branch ref 부재, stash 목록을 기록합니다.
- Module acceptance: backup patch/archive digest와 stash가 존재하고 stash 후 worktree가 clean이어야 합니다.
- Surface integration: fetch 후 새 branch HEAD가 최신 `origin/dev`와 같고 apply 후 unmerged entry가 없어야 합니다.
- Conflict resolution scope: `.codex-plugin/plugin.json`, `PLAN.md`, `docs/model-guidance/README.md`, `scripts/pota-goal.mjs`, `scripts/pota-state.mjs`, `test/lifecycle.test.mjs`만 해소합니다.
- Resolution invariants: upstream 0.2.5 compact 7문장 prompt·fail-closed hook·task assignment identity 검사를 유지하고, reasoning effort/staged triage 정책·완료 plan 기록·설치 surface 검증을 함께 보존합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 2: verify reapplied changes

- Task ID: `verify`
- Initial status: `pending`
- Contract: 재적용 diff의 완전성과 repository 검사를 확인합니다.
- Module acceptance: `git diff --check`와 `node --test test/goal-state.test.mjs test/contract-parity.test.mjs test/lifecycle.test.mjs test/token-efficiency.test.mjs test/packed-install.test.mjs`.
- Surface integration: `npm run check`와 normal `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: push branch and create PR

- Task ID: `push-pr`
- Initial status: `pending`
- Contract: dry-run 성공 후 명시적 scope로 commit/push하고 `dev` 대상 PR을 생성하여 내용을 read-back합니다.
- Dry-run/check: explicit staged diff, `git push --dry-run -u origin agent/path-reasoning-effort-routing`, GitHub compare.
- Module acceptance: local commit과 remote branch head SHA 일치.
- Surface integration: draft PR의 repository=`comento/pota-harness`, base=`dev`, head=`agent/path-reasoning-effort-routing`, title/body/checks read-back.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 4: final read-only review

- Task ID: `final-review`
- Initial status: `pending`
- Contract: local head, remote head, PR head/base, 변경 범위와 검사 결과를 대조합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`, `finalReview`.

## Evidence

- Dry-run or check: 최초 `git diff --check` 통과, local/remote candidate branch 부재 확인. backup/stash 후 최신 `origin/dev`에서 branch를 만들었고 stash apply가 6개 충돌을 보고했습니다. 외부 변경 dry-run은 해소·검증 뒤 수행합니다.
- Tool readiness: Node/npm/git/GitHub App 준비. `gh` 2.96.0과 샌드박스 밖 인증 계정 `dspaudio` 및 `repo`/`workflow` scope 확인.
- Tests: conflict marker 검사, Node 구문 검사 3개, plugin JSON/7문장 prompt, 합집합 정책 문자열 검사 후 관련 5개 Node test file이 통과했습니다.
- Module acceptance: backup digest, stash `7d7245f7ef37eaac0d9e038ca406c3154c56e54e`, branch/base SHA, unmerged entry 부재를 검사했습니다. 최초 결속 `receipt-0899ffc4-f765-4897-95ee-b3ebe46d493f`; plan 갱신 후 재결속합니다.
- Surface integration: `git diff --check`, Node 구문, JSON parse, conflict marker 부재, `Prompt Cache Shape`와 `Reasoning Effort Routing` 합집합을 검사했습니다. 최초 결속 `receipt-e4bc5539-de69-4b84-b70c-e10ac3409b4a`; plan 갱신 후 재결속합니다.
- Verify module acceptance: 관련 5개 Node test file 통과, 최신 결속 `receipt-5ef3429b-15f1-412a-bcc6-cee69fb32dfd`.
- Verify surface integration: normal `npm --cache /private/tmp/pota-npm-cache pack --dry-run`이 prepack 전체 `npm run check`와 package file 검사를 포함해 통과, 최신 결속 `receipt-6507cf70-7341-4e2d-bb23-0c69aac2466e`.
- Publication scope check: `origin/dev` 대비 22개 추적 변경과 3개 plan 파일만 존재하며 staged/unstaged `git diff --check`가 통과했습니다.
- Publication commit: `cbd7baad412f369ce02950e1d855c02a00296990` (`Route reasoning effort by Pota path`)을 `agent/path-reasoning-effort-routing`에 만들고 `git push --dry-run` 성공 후 origin에 push했습니다.
- Pull request: GitHub App으로 `dev` 대상 draft [#55](https://github.com/comento/pota-harness/pull/55)를 생성했습니다. title, Markdown body, base/head, draft 상태와 initial head SHA를 `gh pr view`로 read-back했습니다. 이 plan evidence commit을 push한 뒤 final head를 다시 결속합니다.
- Final read-only review: correctness·scope finding 없음. `origin/dev...HEAD`는 계획된 25개 파일과 2개 commit만 포함하고 worktree/remote tracking이 clean입니다. conflict marker·whitespace 오류가 없고 compact prompt 7문장, prompt-cache guidance, reasoning-effort guidance가 함께 보존됐습니다.
- CI checkpoint: PR #55의 initial final-review 시점에는 6개 matrix job 중 Ubuntu 2개와 macOS current가 성공했고 Windows 2개와 macOS Node 18이 실행 중이었습니다. 아래 completion evidence commit을 push한 최종 head에서 상태를 다시 조회합니다.
- Residual risk: draft PR CI가 최종 head에서 완료되기 전까지 원격 OS matrix 결과는 미확정입니다. 로컬 관련 suite와 prepack 전체 check/package dry-run은 통과했습니다.
- State recovery: blocked `preserve-and-rebase`와 잘못 active가 된 `verify`가 공존한 상태를 발견했습니다. `verify=pending`, `preserve-and-rebase=active`로 최소 복구하고 active task가 하나뿐임을 검사했습니다.
- Goal final review evidence record: 이 완료 artifact commit을 push한 최종 head에서 task-level 및 goal-level `finalReview`를 결속합니다.
- Verification pass count: preserve/rebase 두 gate 통과. verify 두 gate 최초 통과 후 plan 기록으로 재실행해 최신 코드·정책·테스트·package watch set에 결속했습니다.
- Blocker after two failed passes: 없음.

## Status

- [x] Planned
- [x] Changes preserved
- [x] Latest `origin/dev` branch created
- [x] Changes reapplied
- [x] Verification passed
- [x] Branch pushed and PR created
- [x] Reviewed
- [ ] Goal completion ready; final head evidence 결속 직후 repository/UI goal을 완료합니다.
