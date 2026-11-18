# Plan: toolcheck-install-question

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready.
- Finalized: decision-complete for implementation after planned triage.
- Codex UI synchronization: Claude Code 호스트라 Codex `update_plan`/`create_goal`은 없음. Claude Code 앱 task list(`update_plan`)에 같은 순서로 표시.

## Goal

`pota toolcheck`가 필요한 도구의 누락을 보고하면 에이전트가 사용자에게 설치 여부를 한 번 묻는다. 지금은 "승인이 필요하다"와 "blocker로 기록한다"만 있어 묻지 않고 blocker만 남길 수 있다.

- Goal ID: `goal-b1526577-50af-4afa-aa6b-9194fe0c62ed`
- Plan ID: `docs/plan/toolcheck-install-question.md`
- Completion criteria (advisory): `npm run check` 통과, 누락 도구 fixture에서 `toolcheck` 출력에 질문용 정보가 나오는 테스트, 스킬 문구가 "묻는다"를 명시.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, or `cancelled`.

## Whole Work

- Outcome: (1) 스킬·명령·미러·agent·template·model guidance·README가 "누락 시 한 번 묻는다, 답을 기다리는 동안 도구가 필요 없는 작업은 계속한다, 거부·비대화형이면 blocker"를 같은 의미로 말한다. (2) `toolcheck`가 누락 도구마다 제안 명령 또는 자동 설치 불가 사유를 사람용 출력과 `--json`에 싣는다.
- Affected surfaces: `scripts/pota-toolcheck.mjs`, `scripts/pota-toolcheck-detect.mjs`, `skills/pota-plan/{SKILL,planning-rules,delegation}.md`, `skills/pota-work/{SKILL,verification,delegation}.md`, `commands/pota-{toolcheck,plan,work}.md`, `.agents/workflows/pota-{toolcheck,plan,work}.md`, `.claude/commands/pota-toolcheck.md`, `agents/worker.md`, `templates/work-plan.md`, `docs/model-guidance/README.md`, README 8개, `docs/memory/policy-surfaces.md`, `test/toolcheck.test.mjs`, `test/contract-parity.test.mjs`, `test/fixtures/toolcheck/typescript-missing/`.
- 건드리지 않는 파일: `claude-mod/`, `scripts/pota-lifecycle-claude.mjs`, `docs/memory/lifecycle-install.md`(다른 세션의 DAG 패널 작업). README는 Tool Readiness 구역의 bullet 한 줄만 바꾼다.
- Task classification: `triage-plan` → `toolcheck-output` → `policy-wording` → `verify`.

## 설계 결정

1. **질문 주체와 횟수:** main 에이전트가 누락 목록 전체를 한 메시지로 한 번 묻는다. 호스트에 질문 도구가 있으면 그것을 쓴다. subagent는 묻지 않고 orchestrator에 보고한다(기존 `MUST NOT: Ask the user`와 일치시킨다). 같은 도구를 같은 세션에서 다시 묻지 않는다. 범위는 세션이다: 이전 세션이 남긴 blocker(거부·미질문)는 질문을 막지 않으며, 새 세션에서도 도구가 누락돼 있으면 한 번 다시 묻는다(한 번 blocked되면 영영 묻지 않는 문제를 피한다).
2. **기다리는 동안:** 누락 도구가 필요 없는 작업은 계속한다. 그 도구에 의존하는 작업은 시작하지 않는다.
3. **묻지 않는 경우:** 사용자가 거부했거나, 설치가 불가능하거나, 사용자에게 물을 수 없는 실행(비대화형·headless·CI·예약 실행)이면 묻지 않고 지금처럼 blocker를 기록한다.
4. **출력 계약(추가만):** 결과마다 `install.suggestedCommand`(누락일 때만 문자열, 아니면 `null`)를 더하고, 자동 installer가 없는 도구는 `install.unavailableReason`이 항상 채워지게 한다. 최상위 report 모양은 그대로 둔다(`test/cli-contract-hardening.test.mjs`의 빈 report 계약 유지). 사람용 출력은 누락 도구 아래에 `suggested command (manual, unpinned; toolcheck never runs it): …` 줄과, 맨 끝에 질문을 지시하는 한 줄을 더한다.
5. **안전 규칙 유지:** `requirement.install`은 계속 `null`이다. 제안 명령은 별도 필드(`suggestedInstall`)라 `--install --yes`가 실행하지 않고 `installer-unavailable`을 돌려준다. 이를 테스트로 고정한다. 제안 명령은 사용자가 승인한 "repository-native command"로만 에이전트가 직접 실행한다.
6. **제안 명령 범위:** 저장소의 패키지 매니저로 표현할 수 있는 것만 제안한다. TypeScript(`installDev`), Python(`pythonInstall`, `uv.lock`이 있으면 uv), PHP(`composer.json`이 있을 때 `composerInstall`), `gopls`, Rust(`rustup component add`). 런타임·toolchain(`node`, `php`, `java`, `swift` 등)과 `jdtls`, `golangci-lint`는 제안 명령 없이 사유만 낸다.
7. **바이트 예산:** `skills/pota-plan/SKILL.md` 여유 24바이트, `skills/pota-work/SKILL.md` 여유 68바이트. SKILL.md에는 짧은 한 구절만 넣고 절차는 `planning-rules.md`·`verification.md`에 둔다.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/policy-surfaces.md`
- Related completed plans: none related

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- Rationale: 문구 표면이 서로 같은 의미를 유지해야 해서 한 세션이 일관되게 쓴다.
- User-visible response and artifact locale: ko. 정책 문구는 저장소의 기존 언어(영문, README는 locale별)를 따른다.

## Reasoning Effort Profile

- Light Path: planning=`medium`, implementation=`medium`, verification=`medium`.
- Requested/Effective model·effort: `inherited`(위임 없음, main 세션 직접 수행).

## Complexity Triage

- Selected path: Light Path.
- Selection rationale: 기존 모듈 안의 출력 필드 추가와 문구 변경. 새 디렉터리·모듈·추상화가 없다.
- Checkpoint ledger:
  - Request checkpoint: Light. 파일 수가 3개를 넘어 Quick Path는 아니다.
  - Planning checkpoint: Light. 표면 지도와 테스트를 읽은 뒤에도 Heavy 신호 없음.
  - Code checkpoint: Light. `scripts/pota-toolcheck*.mjs`와 호출 테스트를 확인한 뒤 첫 편집 직전에 기록.
- Heavy Path signals checked: 새 디렉터리/모듈/레이어 없음(fixture 디렉터리만 추가), 새 도메인 모델 없음, 보안·인증 없음, 외부 API 없음, DB 없음, 동시성 없음, 다중 도메인 리팩터 없음, 추가 주의 요청 없음.
- Omitted delegation in Light Path: `worker` 위임을 생략한다. 사용자 전역 지침이 "다음 단계가 결과에 의존하는 작은 작업은 직접 처리"를 정하고, 문구 표면 20여 개가 같은 의미를 유지해야 한다. main 세션이 직접 구현하고 이 줄이 그 기록이다.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | `light` | inherited | inherited |
| `toolcheck-output` | main | `light` | inherited | inherited |
| `policy-wording` | main | `light` | inherited | inherited |
| `verify` | main | `light` | inherited | inherited |

## Tool Readiness

- Detected stack: javascript
- Toolcheck command: `node scripts/pota.mjs toolcheck --root .`
- Required typecheck/lint/verification tools: `node`, `npm`
- Missing tools: 없음
- Install approval: not needed.
- Tool blockers: 없음

## Module Tasks

### `toolcheck-output`

- writeScope: `scripts/pota-toolcheck.mjs`, `scripts/pota-toolcheck-detect.mjs`, `test/toolcheck.test.mjs`, `test/fixtures/toolcheck/typescript-missing/`
- Test contract: 누락 fixture에서 (a) 결과마다 제안 명령 또는 불가 사유가 있다, (b) 사람용 출력에 제안 줄과 질문 지시 줄이 있다, (c) 누락이 없으면 질문 지시 줄이 없다, (d) `--install --yes`가 제안 명령을 실행하지 않는다. 구현 전에는 (a)(b)(d)의 새 필드 단언이 실패한다.
- Module acceptance: `node --test test/toolcheck.test.mjs`
- Surface integration: `node --test test/cli-contract-hardening.test.mjs test/packed-install.test.mjs`

### `policy-wording`

- writeScope: Whole Work의 문구 표면, `test/contract-parity.test.mjs`
- Test contract: 정본·명령·미러 표면이 "ask the user once"와 비대화형 blocker 규칙을 담고, README 8개가 제안 명령 출력을 언급한다.
- Module acceptance: `node --test test/contract-parity.test.mjs test/token-efficiency.test.mjs`
- Surface integration: `node --test test/docs-package-hardening.test.mjs test/installed-plugin.test.mjs`

### `verify`

- Final check: `npm run check`

## Evidence

- Goal ID: `goal-b1526577-50af-4afa-aa6b-9194fe0c62ed`
- `toolcheck-output`: `node --test test/toolcheck.test.mjs` 23개 통과(새 테스트 6개), `node --test test/cli-contract-hardening.test.mjs test/packed-install.test.mjs` 통과. 빈 report의 JSON 모양 계약은 그대로다.
- `policy-wording`: `node --test test/contract-parity.test.mjs test/token-efficiency.test.mjs` 통과(새 테스트 2개), `node --test test/docs-package-hardening.test.mjs test/installed-plugin.test.mjs` 통과. `skills/pota-plan/SKILL.md` 8993바이트, `skills/pota-work/SKILL.md` 8975바이트(상한 9000).
- `verify`: `npm run check` exit 0.
- 위임: 없음. main 세션이 직접 구현했다(Complexity Triage의 생략 사유).
- 후속(goal 종료 뒤 Quick Path): 질문 범위를 "세션당 한 번"으로 명시하고 계약 테스트에 단언 3개를 추가했다. `npm run check` exit 0.
- 커밋·푸시는 요청 범위 밖이라 하지 않았다.
- Memory promotion: docs/memory/policy-surfaces.md
