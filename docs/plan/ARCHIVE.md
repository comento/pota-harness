# Plan Archive

Older completed plan entries moved from `PLAN.md` by `pota plan index --archive`. Newest first.

- [편집 후 comment-checker 검사](comment-checker-hook.md): PostToolUse에서 고정 v0.8.2 바이너리(SHA256 검증, SessionStart 분리 다운로드)로 주석을 검사해 block; npm 의존성 없음, 실제 바이너리 smoke 통과.
- [Pota 0.7.0 릴리스](release-0.7.0.md): dev·main PR을 CI 통과 후 병합하고 exact main tarball을 npm `latest` 0.7.0으로 게시해 digest와 격리 설치를 확인했습니다.
- [자동 업그레이드와 `~/.pota` 설치 루트](auto-upgrade-pota-home.md): `~/.pota/install` 이전, Claude 캐시 갱신, runtime 3일 유예, `--hosts` 호스트 선택, SessionStart 자동 업그레이드.
- [Pota 0.6.0 릴리스](release-0.6.0.md): dev·main PR을 CI 통과 후 병합하고 exact main tarball을 npm `latest` 0.6.0으로 게시해 digest와 격리 설치를 확인했습니다.
- [메모리·계획 인덱스 재활용과 측정·감사 잔여 수정](memory-plan-index-reuse.md): 메모리·계획 인덱스 CLI와 hook 주입, goal 이력 집계, 감사 잔여 F6·F10·F11 수정, 이 저장소 `docs/memory` 노트 6개.
- [Pota 0.5.0 릴리스](release-0.5.0.md): dev·main PR을 CI 통과 후 병합하고 exact main tarball을 npm `latest` 0.5.0으로 게시해 digest·격리 설치를 확인한 뒤 로컬 설치본을 올렸습니다.
- [모델 위임 규칙 4가지 개선](delegation-model-identity-rules.md): 실제 모델 ID 기록(`--effective-model`), 모델·effort 변경 시 새 dispatch, task list main 전담, 설계 strongest 게이트(`--host`)를 반영.
- [Pota 0.4.1 릴리스](release-0.4.1.md): dev·main PR을 CI 통과 후 병합하고 exact main tarball을 npm `latest` 0.4.1로 게시해 registry digest와 격리 설치를 확인했습니다.
- [Heavy Path 설계 모델 위임](heavy-design-model-routing.md): Heavy Path 설계를 strongest 모델 위임 task로 분리하고 모델 기록 누락을 완료 게이트로 차단; `npm run check` 통과.
- [Pota 0.4.0 릴리스](release-0.4.0.md): dev·main PR을 CI 통과 후 병합하고 exact main tarball을 npm `latest` 0.4.0으로 게시해 digest와 격리 설치의 Heavy effort 게이트를 검증했습니다.
- [작업별 모델 결정](per-task-model-routing.md): 모델 상속 고정을 fast/balanced/stronger/strongest 4-tier 작업별 결정으로 바꾸고 호스트별 매핑과 host 옵션 전달 규칙을 반영했습니다.
- [dispatch 시 추론 강도 실제 적용과 검증](dispatch-effort-enforcement.md): host 옵션으로 effort를 넘기는 규칙·Effective 판정, `goal assign --effort`, Heavy 완료 게이트, stats·Stop 경고를 구현했습니다.
- [Pota 0.3.0 릴리스](release-0.3.0.md): SessionStart 캡슐 예산 hotfix와 함께 main에 병합하고 exact main tarball을 npm `latest` 0.3.0으로 게시해 digest와 격리 설치를 검증했습니다.
- [Pota 오버헤드 축소와 task DAG](pota-overhead-reduction.md): goal 증거로 task 재검증 면제, `goal finish`/`stats`/`ready`, PostToolUse 1회 알림, SKILL.md 축소, `dependsOn`/`writeScope` 병렬 task.
- [Pota 0.2.7 릴리스](release-0.2.7.md): state/lifecycle 계약 hardening과 module split을 dev·main에 승격하고 exact main tarball을 npm `latest` 0.2.7로 게시했습니다.
- [경로별 추론 강도 변경 보존 및 PR 게시](publish-path-reasoning-effort-routing.md): dirty `dev` 변경을 backup·stash로 보존하고 최신 `origin/dev` 기반 브랜치에 3-way 재적용·검증한 뒤 draft PR을 만들었습니다.
- [Pota 0.2.5 hotfix 릴리스](release-0.2.5.md): dev·main PR을 exact head CI 성공 후 병합하고 exact main tarball을 npm `latest` 0.2.5로 게시해 digest와 격리 설치/CLI를 검증했습니다.
- [Pota 0.2.5 공용 설정 upgrade hotfix](upgrade-shared-config-ownership.md): 공유 `config.toml`을 mutable merge surface로 바꾸고 boundary trivia·concurrent edit·crash recovery·0.2.4→0.2.5 upgrade를 검증.
- [Pota 0.2.4 릴리스](release-0.2.4.md): dev·main PR을 exact head CI 성공 후 병합하고 exact main tarball을 npm `latest` 0.2.4로 게시해 digest와 격리 설치/CLI를 검증했습니다.
- [clean uninstall과 프롬프트 캐시 복원력](clean-uninstall-prompt-cache-resilience.md): 빈 managed cache root 정리, unmanaged 보존, completed-task evidence 갱신, 7문장 recovery kernel과 bounded reference 복원.
- [Pota 0.2.3 릴리스](release-0.2.3.md): dev/main PR 승격, npm 배포, npm 설치본 재설치와 실제 upgrade smoke 증거를 갱신하고 goal을 명시적으로 완료했습니다.
- [경로별 추론 강도 라우팅](path-reasoning-effort-routing.md): 모델은 상속하고 Light=`medium`, Heavy=`high`, 최종 검토=`xhigh`를 task별로 적용하며 경로 변경 시 effort profile 등을 재계산합니다.
- [단계별 복잡도 재평가](staged-complexity-reassessment.md): 요청·계획·코드 체크포인트에서 경로를 재평가하고 변경 시 plan artifact·goal task roadmap·Codex UI plan을 `goal replan`으로 동기화합니다.
- [Pota 하네스 신뢰성 개선](harness-reliability-remediation.md): 상태 lock·검증 결속, lifecycle transaction과 교차 버전 rollback, 호스트 호환성, toolcheck·문서 계약을 보강(공식 plugin 경로 전환 제외).
- [Pota 0.2.2 릴리스](release-0.2.2.md): PR #39를 `dev`, PR #40을 `main`에 CI 통과 후 병합하고 `@comento/pota-harness@0.2.2`를 npm `latest`로 게시했습니다.
- [토큰 효율 방법론 검토 findings 전체 수정](fix-token-methodology-review-findings.md): inline 값 보존, 직접 실행된 tool-bound evidence와 stale fingerprint, lifecycle 분류 기반 package 검증, 700자 bounded roadmap, 8개 locale·증거 용어·상태 일관성을 실패 테스트부터 수정하고 전체 검사와 package dry-run으로 검증했습니다.
- [토큰 효율과 신뢰성을 함께 보장하는 Pota 방법론](token-efficient-reliable-harness.md): 테스트 계약 우선·최소 구현·도구 결과 권위·실패 시에만 컨텍스트 확장·신선한 증거 재사용을 하네스에 반영했고, default prompt 2,549자, idle hook 277자, 3-task active hook 434자와 전체 39/39 테스트, 62-file package content 검증으로 확인했습니다.
- [계획 중단에도 goal/task를 보존하는 2단계 계획](goal-before-planning-interruption.md): 초기 계획과 Codex UI plan/goal을 트리아지 전에 생성하고, 증거 기반 저장소 task 전환 뒤에만 UI 단계를 동기화하도록 정책을 정렬했으며 전체 35개 테스트와 package dry-run으로 검증했습니다.
- [Pota 0.2.1 goal 작업 컨텍스트 릴리스](release-0.2.1-goal-task-context.md): PR #35를 `dev`, PR #36을 `main`에 CI 통과 후 병합하고 `@comento/pota-harness@0.2.1`을 npm `latest`로 게시했습니다.
- [goal 작업 단계와 복귀 컨텍스트](goal-task-roadmap-context.md): 활성 goal의 전체 순서형 task roadmap, 각 상태, 현재 task와 곁가지 질문 뒤 복귀 지침을 영문·한국어 및 실제 tarball 설치 경로에서 검증했습니다.
- [구현 요청의 자동 goal 설정 지침](automatic-goal-on-implementation-request.md): goal 미언급 구현/계속 실행 요청도 `UserPromptSubmit`의 모델 가시 지침으로 goal 생성 권한이 되며, 영문·한국어 hook과 실제 tarball 설치를 포함한 전체 34개 테스트 및 package dry-run으로 검증했습니다.
- [설치본 경로 독립성과 목표 완주 런타임](installed-runtime-goal-completion.md): 현재 lifecycle을 유지하면서 설치본 기준 리소스 locator, 저장소별 영속 목표/task/증거 기록, 범위가 제한된 Stop 게이트, 안전한 toolcheck를 구현했으며 `npm run check`와 실제 tarball 설치 E2E, `npm pack --dry-run`으로 검증했습니다.
- [Release 0.1.11 locale artifacts](release-0.1.11-locale-artifacts.md): PR #29 merged to `dev`, PR #30 merged to `main`, and `@comento/pota-harness@0.1.11` published to npm.
- [Release 0.1.10 subagent lifecycle](release-0.1.10-subagent-lifecycle.md): PR #25 merged to `dev`, PR #26 merged to `main`, and `@comento/pota-harness@0.1.10` published to npm.
- [Pota subagent close on completion](pota-subagent-close-on-completion.md): required delegated subagents to provide a final report before leaving, then close/release after evidence capture, then have the orchestrator review the final report and evidence before completion; verified with `node --test test/lifecycle.test.mjs`, `npm run check`, and `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
- [Pota subagent unavailable main fallback](pota-subagent-unavailable-main-fallback.md): corrected unavailable-subagent fallback to main-agent takeover and made subagent progress reporting conditional on tool channel support; verified with `node --test test/lifecycle.test.mjs`, `npm run check`, and `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
- [Pota orchestrator-worker execution policy](pota-orchestrator-worker-execution-policy.md): required main-agent orchestration, worker implementation delegation, subagent status reporting, and immediate user relay; verified with `node --test test/lifecycle.test.mjs`, `npm run check`, and `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
- [Pota stop gate plan index recheck](pota-stop-gate-plan-index-recheck.md): stop hook now rechecks active, completed, and unindexed plan files; verified with `node --test test/lifecycle.test.mjs`, `npm run check`, and `npm --cache /private/tmp/pota-npm-cache pack --dry-run`.
- [Release 0.1.9 Codex multi-agent settings](release-0.1.9-codex-multi-agent-settings.md): PR #22 merged to main, `@comento/pota-harness@0.1.9` published to npm, and local Pota installation upgraded.
- [Release 0.1.8 Pota policy updates](release-0.1.8-pota-policy-updates.md): PR #19 merged to main, `@comento/pota-harness@0.1.8` published to npm, and local Pota installation upgraded.
- [Pota recursive subagent policy](pota-recursive-subagent-policy.md): allowed recursive bounded sub-task delegation in plugin, skills, commands, workflows, and agent definitions; verified with `npm test`, `npm run check`, and `npm pack --dry-run`.
- [Pota planner decomposition policy](pota-planner-decomposition-policy.md): required whole-work planning before task/sub-task classification; verified with `npm test`, `npm run check`, and `npm pack --dry-run`.
- [Pota task terminology](pota-task-terminology.md): renamed user-facing module slice terminology to task/sub-task and verified with `npm test`, `npm run check`, and `npm pack --dry-run`.
- [Pota interruption resume policy](pota-interruption-resume-policy.md): added side-question resume guidance to plugin/work surfaces and verified with `npm test`, `npm run check`, and `npm pack --dry-run`.
- [Pota plugin model settings and Heavy Path test gate](pota-plugin-model-settings-heavy-path-tests.md): removed Claude-only agent model pins, added Heavy Path test evidence stop gate, and verified with `npm test`, `npm run check`, and `npm pack --dry-run`.
- [Pota verification infrastructure](pota-verification-infrastructure.md): lifecycle/toolcheck regression tests, fixtures, CI, and packaging dry-run evidence.
- [Release 0.1.7 stop gate](release-0.1.7-stop-gate.md): PR #17 merged to main, `@comento/pota-harness@0.1.7` published to npm, and local Pota installation upgraded.

## Legacy Planning Rules

- Plans must be decision-complete before implementation.
- Split implementation into small module slices.
- Detect repository stack and required LSP/check tools before implementation.
- Install or bootstrap missing required tools before declaring them unavailable.
- Each slice normally passes exactly two gates.
  - Module acceptance verification.
  - Surface integration verification.
- Run dry-run or check mode before external-state mutation when available.
- Use at most two verification passes per slice by default.
- If a gate fails, diagnose once, shrink or split the slice, and rerun both gates.
- After two failed passes, record the blocker in `docs/plan/<topic>.md`.
