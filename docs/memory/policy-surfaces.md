# Domain: policy-surfaces

Summary: 정책 문구를 바꿀 때 함께 고칠 표면 지도(skill·agent·template·manifest·defaultPrompt·README)와 바이트 예산. 문구 변경 전에 읽는다.

## Scope

에이전트가 읽는 정책 문구 전체. 정본은 `skills/`이고 나머지는 같은 규칙의 파생 표면이다. 2.0.0에서 command·workflow·mirror 표면(`commands/`, `.agents/workflows/`, `.claude/commands/`, `.claude/agents/`)은 지웠다. hook 캡슐 문구는 `hook-context.md`, 모델·effort 규칙의 내용은 `delegation-model-routing.md`, 플러그인 배치는 `lifecycle-install.md`.

## Facts

### 표면 지도

| 표면 | 파일 | 비고 |
| --- | --- | --- |
| 스킬 본문 | `skills/pota-{memory,plan,work,review}/SKILL.md` | 정본. 세 호스트가 같은 파일을 읽는다(Claude `/pota:pota-plan`, Codex `$pota-plan`, Antigravity `/pota-plan`) |
| 스킬 참조 | `skills/pota-plan/{planning-rules,delegation,heavy-path,request-brief}.md`, `skills/pota-work/{delegation,heavy-path,recovery,verification}.md` | 긴 절차는 여기에 둔다 |
| agent | `claude/agents/{explorer,worker}.md` | Claude Code만 읽는다(`.claude-plugin/plugin.json` `agents`) |
| 템플릿 | `templates/{MEMORY,PLAN,domain-memory,work-plan}.md` | `MEMORY.md`·`PLAN.md`는 `INDEX_TEMPLATES`(en)와 바이트 동일 |
| 모델 가이드 | `docs/model-guidance/{README,claude,codex}.md` | `pota://docs/model-guidance/…`로 참조 |
| Codex 커널 | `.codex-plugin/plugin.json`의 `interface.defaultPrompt` | 매 대화 반복 주입 |
| 플러그인 설명 | `.claude-plugin/plugin.json`·`.codex-plugin/plugin.json`·루트 `plugin.json`의 `description`, `plugin.json` `suggestedPrompts`, `.codex-plugin/plugin.json` `interface` | 호스트 플러그인 목록에 보인다 |
| hook 상태 문구 | `hooks/hooks.json`, `hooks/codex.json`의 `statusMessage` | 두 파일은 변수·호스트 토큰 외에 같아야 한다. Codex 쪽을 바꾸면 사용자가 hook을 다시 승인해야 하므로 릴리스 노트에 적는다 |
| CLI 안내문 | `scripts/pota.mjs`의 `messages` | en, ko, ja, zh, es, fr, de, pt |
| README | `README.md`와 `README.{ko,ja,zh,es,fr,de,pt}.md` | 8개. 구조를 나란히 유지하고 제목은 영문 고정 |

출처: `test/docs-package-hardening.test.mjs` "plugin inventory covers two Claude agents and five skills and no command or workflow surfaces", `test/contract-parity.test.mjs`, `test/plugin-manifests.test.mjs` "Claude and Codex hooks run pota-state.mjs with the event and host tokens, and Codex reads only its own file".

### 예산(테스트가 강제)

- `skills/pota-plan/SKILL.md`와 `skills/pota-work/SKILL.md`는 각 9000바이트 이하다(`test/token-efficiency.test.mjs` "plan and work skills stay slim and load detailed procedures on demand"). 2.0.0 기준 8991, 8979바이트라 여유가 9, 21바이트다. 측정: `wc -c skills/*/SKILL.md`.
- `defaultPrompt`는 정확히 7줄, 1600자 이하다. 2.0.0 기준 1114자다. 회복 순서·증거·외부 상태 문장 정규식이 고정돼 있고, `update_plan`·`--ignore-scripts` 같은 단어는 금지다. 출처: `test/token-efficiency.test.mjs` "recurring Codex instructions are a small stable recovery kernel".
- skill·agent·모델 가이드에는 대상 저장소 기준 상대 참조를 둘 수 없다: `node scripts/…`, `commands/pota-…`, `agents/(explorer|worker).md`, `templates/…`, `docs/model-guidance/…`. Pota 파일은 `pluginRoot`(session-start `Pota CLI:` 줄의 `scripts` 상위)나 `pota://` ID로 가리킨다. 명령 예시는 `node "<pluginRoot>/scripts/pota.mjs" memory index --root <repoRoot>`처럼 쓴다. 출처: `test/plugin-manifests.test.mjs` "skills, agents, and model guidance never resolve Pota files against the target repository".
- 추적 파일(`docs/plan/`, `test/` 제외)에는 1.x의 runtime locator placeholder와 locator 파일 이름을 쓰지 않는다. 출처: `test/plugin-manifests.test.mjs` "no shipped file carries the runtime locator".

### 문구 계약(테스트가 강제)

- memory 표면(`skills/pota-memory/SKILL.md`)은 `Summary:` 줄과 `pota memory index`/`check`를 요구한다. plan 표면은 관련 노트와 완료 계획(최대 3개) 재사용, `Related completed plans:` 기록, `PLAN.md` 한 줄 항목을 요구한다. work·review 표면(`skills/pota-work/verification.md`, `skills/pota-review/SKILL.md`)은 `Memory promotion:` 결정(`docs/memory/<domain>.md` 또는 `none: <reason>`)을 요구하고 노트 작성을 강요하지 않는다. 출처: `test/contract-parity.test.mjs` "memory surfaces require a Summary line and pota memory index/check", "plan surfaces require reuse of related notes and completed plans and the PLAN.md one-line entry", "work and review surfaces require the Memory promotion decision and forbid forced notes".
- 두 `delegation.md`의 위임 프롬프트 `CONTEXT:`에는 고른 노트 경로가 들어간다. `claude/agents/*.md`는 `MEMORY.md` 항목으로 노트를 고르라고 지시한다. 출처: 같은 파일 "delegation prompts carry the selected memory note paths", "Claude agents point to MEMORY.md entries for relevant notes".
- README 8개는 `pota memory check|index`, `pota plan check|index [--archive]`, `docs/plan/ARCHIVE.md`, `## Completed Plans`, SessionStart, `goal stats --history`, advisory `completionCriteria`, `Memory promotion:`을 담고 옛 Claude marketplace 경로 `~/.codex/plugins/cache/pota/claude`는 담지 않는다. cleanup lock 문장은 en·ko에만 있다. 출처: `test/docs-package-hardening.test.mjs`.
- README 8개의 `## Install`(영문 제목 고정, CLI의 제거된 명령 안내가 `#install`로 링크)은 세 호스트의 설치·업데이트·제거 명령, Codex `/hooks` 승인(설치 뒤와 업데이트 뒤), 호스트별 기능 표(`### What each host gets`), 1.x에서 옮겨 오기(`claude plugin uninstall pota@pota --scope user`, 유지·거부 조건, `symlinked-path`, `host-unregister-failed`, `migrate status`·`run --dry-run`, `POTA_LEGACY_MIGRATION=0`, `npx @comento/pota-harness@1.5.0 uninstall`), `Pota CLI:` 줄로 CLI를 찾는 법을 담는다. 제거된 npm 설치 프로그램의 명령·옵션(`pota install|upgrade|uninstall`, `--hosts`, `--allow-downgrade`, `bunx`/`@latest`, 자동 업그레이드)은 담지 않는다. 미검증 동작(Codex 실제 실행, 실제 `agy` 세션의 hook)은 "문서 기준, 아직 실행하지 않음"으로 적는다. 출처: `test/readme-plugin-install.test.mjs`.
- 8 locale 안내문은 같은 영문 정책 상수(`tokenEfficientWorkPolicy`, `reasoningEffortPolicy`, `memoryIndexPolicy`, `planIndexPolicy` 등)를 붙인다. ko는 일부 상수의 한국어 판을 쓴다. usage 줄은 `pota doctor|migrate|cleanup|init|memory|plan|work|review|toolcheck|goal|task`다. 출처: `scripts/pota.mjs` `messages`, `test/token-efficiency.test.mjs` "every supported locale exposes the token-efficient work contract", `test/cli-contract-hardening.test.mjs` "every locale's usage names the 2.0.0 command list".
- 누락 도구 질문 규칙: main 에이전트가 설치 여부를 한 번 묻고(누락 도구별 제안 명령 또는 자동 설치 불가 사유 포함), 기다리는 동안 도구가 필요 없는 작업을 계속하며, 거부·비대화형 실행이면 묻지 않고 blocker를 기록한다. 질문은 세션당 한 번이고, 이전 세션이 남긴 blocker는 새 세션의 질문을 막지 않는다. subagent는 묻지 않고 orchestrator에 보고한다. 정본은 `skills/pota-plan/planning-rules.md`와 `skills/pota-work/verification.md`의 `## Tool Readiness Policy`이고, 파생 표면은 두 `delegation.md`, `claude/agents/worker.md`, `templates/work-plan.md`, `docs/model-guidance/README.md`, README 8개의 Tool Readiness bullet이다. toolcheck는 2.0.0부터 skill·command가 없고 `pota-plan` 절차와 CLI(`pota toolcheck`)로만 실행한다. 질문에 쓰는 데이터는 `toolcheck` 결과의 `installCommand`, `install.suggestedCommand`, `install.unavailableReason`이다. 출처: `test/contract-parity.test.mjs` "tool readiness surfaces tell the agent to ask the user once before installing missing tools", "all readmes say toolcheck prints install question data and the agent asks once", `test/toolcheck.test.mjs`.
- main 모델 게이트: 정본은 두 `delegation.md`의 `## Main Model Gate`다. 파생 표면은 `skills/pota-review/SKILL.md` Procedure 4 하위 bullet, `templates/work-plan.md` `- Model:` bullet, `docs/model-guidance/{README,claude,codex}.md` bullet 1개씩, README 8개의 "Comment checker" 다음 bullet이다. `skills/pota-{plan,work}/SKILL.md`는 바이트 예산 때문에 고치지 않고 캡슐 줄이 `delegation.md`를 가리킨다. 출처: `test/token-efficiency.test.mjs` "main-model gate surfaces name the capsule line, the review kind, and the bypass flag".
- 모델 상한: 정본은 두 `delegation.md`의 `## Model Ceiling`(같은 절을 바이트 동일하게 둔다)과 설계 게이트 문장·Main Model Gate 문장·`CONTEXT:` 줄 보강이다. 파생 표면은 `skills/pota-{plan,work}/heavy-path.md` 설계 bullet, `templates/work-plan.md` `- Model:` bullet, `docs/model-guidance/{README,claude,codex}.md` bullet 1개씩, README 8개의 "Main model check" 다음 bullet이다. `skills/pota-{plan,work}/SKILL.md`, `claude/agents/*.md`, `skills/pota-review/SKILL.md`는 고치지 않는다(캡슐 줄 "This overrides tier values in skill text"와 `CONTEXT:`로 전달). 출처: `test/token-efficiency.test.mjs` "model ceiling surfaces name the capsule line, the setting, and the user-only rule".
- 요청 계약과 스티어링(1.4.0): 정본은 `skills/pota-plan/request-brief.md`(계약 작성, `## Prior records`, 빈틈 3분류, 암묵 요구사항, 스티어링 분류, CLI 강제 항목)다. 파생 표면은 `templates/work-plan.md`의 `## Request Brief` 섹션(`## Goal` 다음), `skills/pota-plan/SKILL.md` Reference Files 포인터, `skills/pota-plan/planning-rules.md` bullet 2개, `skills/pota-work/SKILL.md`의 replan 예시(`--steer`·`--reason`)와 Procedure 2번 포인터, `skills/pota-work/recovery.md`, README 8개의 "Model ceiling" 다음 bullet이다. 계획 라벨과 명령·플래그는 모든 locale에서 영문 고정이다. 템플릿의 Request Brief에는 `S1 (`로 시작하는 목록 줄을 두지 않는다(CLI 순번 검사가 실제 기록으로 볼 수 있다). 게이트 동작은 `goal-state.md`. 출처: `test/contract-parity.test.mjs` "request brief and steering surfaces name the template section, the commands, and the bypass flag".
- `pluginRoot` 문장(`skills/pota-plan/SKILL.md` 16행, `skills/pota-work/SKILL.md` 18행)과 `skills/pota-work/recovery.md` 30행(경로가 사라지면 세션 재시작, Codex에서 `Pota CLI:` 줄이 없으면 `/hooks` 승인 요청)은 세 호스트가 같은 문장을 쓴다. 같은 뜻의 문장이 `skills/pota-memory/SKILL.md`, `skills/pota-review/SKILL.md`, `docs/model-guidance/README.md`에도 있다.
- 메모리 승격 절차 본문은 `skills/pota-work/verification.md` `## Memory Promotion`, 계획 재활용 절차는 `skills/pota-plan/planning-rules.md` `## Reuse Before Planning`에 있다. 옛 `PLAN.md`의 Planning Rules 정본도 이 파일이다.
- `open_pota_dag` 표면 규칙(2.3.0): Antigravity와 Codex/ChatGPT Desktop에서 `open_pota_dag`가 노출될 때만 `goal start` 직후·활성 goal 재개 시 호출하고, 자체 mod를 쓰는 Claude Code에서는 건너뛴다(`ensure` 복구는 Antigravity 전용). 정본은 `skills/pota-plan/planning-rules.md`와 `docs/model-guidance/README.md`, 요약은 `skills/pota-{plan,work}/SKILL.md`이며 `test/token-efficiency.test.mjs`가 강제한다.
- 수동 승인 게이트(`approvalGate`) 복구 규칙: `pota goal task --status active`가 수동 승인 게이트로 실패하면 사용자 확인 없이 우회하지 말고 대기한 뒤 `pota goal gate --task <id> --off` 또는 `pota goal task --task <id> --status active --approve-gate`로 해제·승인하도록 `skills/pota-work/recovery.md`에 둔다. 게이트 task만 남았을 때(`goal ready`가 `gated`에만 id를 내고 `active`·`ready`가 빔)는 사용자에게 보고하고 기다린다는 규칙도 같은 파일에 있고, `goal ready`의 `gated` 키 설명은 `skills/pota-work/delegation.md` "Parallel Tasks"에 있다. 사용자가 대화에서 말하거나 DAG 패널에서 승인하기 전에는 `--approve-gate`·`goal gate --off`를 실행하지 않는다. `test/token-efficiency.test.mjs` "work guidance keeps gated ready tasks for the user to approve"가 강제한다.

## Policy

- 새 규칙은 정본 스킬이나 참조 파일에 먼저 쓰고, 위 표의 파생 표면에 같은 의미로 옮긴다. 기계로 검사할 수 있는 규칙은 문구를 늘리지 말고 테스트로 고정한다.
- SKILL.md에 문장을 더해야 하면 같은 바이트만큼 줄이거나 참조 파일로 옮긴다.
- 고유명사·명령·식별자는 locale과 무관하게 영문 그대로 둔다. `## Domain Knowledge`와 README의 `##`·`###` 제목도 영문 고정이다.
- README 8개는 같은 절 구조를 유지하고, 각 언어로 자연스럽게 쓰되 명령·식별자는 바꾸지 않는다.

## References

- `node --test test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/token-efficiency.test.mjs test/plugin-manifests.test.mjs test/readme-plugin-install.test.mjs`
