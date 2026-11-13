# Domain: policy-surfaces

Summary: 정책 문구를 바꿀 때 함께 고칠 표면 지도(skill·command·미러·agent·template·defaultPrompt·README)와 바이트 예산. 문구 변경 전에 읽는다.

## Scope

에이전트가 읽는 정책 문구 전체. 정본은 `skills/`이고 나머지는 같은 규칙의 파생 표면이다. hook 캡슐 문구는 `hook-context.md`, 모델·effort 규칙의 내용은 `delegation-model-routing.md`.

## Facts

### 표면 지도

| 표면 | 파일 | 비고 |
| --- | --- | --- |
| 스킬 본문 | `skills/pota-{memory,plan,work,review}/SKILL.md` | 정본 |
| 스킬 참조 | `skills/pota-plan/{planning-rules,delegation,heavy-path}.md`, `skills/pota-work/{delegation,heavy-path,recovery,verification}.md` | 긴 절차는 여기에 둔다 |
| 명령 | `commands/pota-*.md` 9개 | install·upgrade·doctor·uninstall·memory·plan·work·review·toolcheck |
| Antigravity 미러 | `.agents/workflows/pota-*.md` 9개 | 같은 규칙을 locator 문구로 다시 쓴 별도 파일(동일 복사본 아님) |
| Claude 명령 미러 | `.claude/commands/pota-*.md` 9개 | `{{POTA_RUNTIME_LOCATOR_JSON}}`로 runtime의 `commands/`를 가리키는 포인터. 정책 문구 없음 |
| agent | `agents/{explorer,worker}.md`, `.claude/agents/{explorer,worker}.md` | `.claude/agents`는 축약판이라 둘 다 고친다 |
| 템플릿 | `templates/{MEMORY,PLAN,domain-memory,work-plan}.md` | `MEMORY.md`·`PLAN.md`는 `INDEX_TEMPLATES`(en)와 바이트 동일 |
| Codex 커널 | `.codex-plugin/plugin.json`의 `interface.defaultPrompt` | 매 대화 반복 주입 |
| CLI 안내문 | `scripts/pota.mjs`의 `messages` | en, ko, ja, zh, es, fr, de, pt |
| README | `README.md`와 `README.{ko,ja,zh,es,fr,de,pt}.md` | 8개 |

출처: `test/docs-package-hardening.test.mjs` 50·59행(명령 9개, agent 2개, skill 4개 인벤토리), `test/contract-parity.test.mjs` 28~135행.

### 예산(테스트가 강제)

- `skills/pota-plan/SKILL.md`와 `skills/pota-work/SKILL.md`는 각 9000바이트 이하다(`test/token-efficiency.test.mjs:349-354`). 현재 8999, 8962바이트라 plan은 여유가 1바이트다. 측정: `wc -c skills/*/SKILL.md`.
- `defaultPrompt`는 정확히 7줄, 1600자 이하다. 현재 1118자다. 회복 순서·증거·외부 상태 문장 정규식이 고정돼 있고, `update_plan`·`--ignore-scripts` 같은 단어는 금지다. 출처: `test/token-efficiency.test.mjs:23-38`, 설치본 검사 `test/lifecycle.test.mjs:357-365`.
- 설치된 미러에는 대상 저장소 기준 상대 참조를 둘 수 없다: `node scripts/…`, `commands/pota-…`, `agents/(explorer|worker).md`, `templates/…`, `docs/model-guidance/…`, 렌더링 전 placeholder. 출처: `test/installed-plugin.test.mjs:229-236`. 명령 예시는 `memory index --root <repoRoot>`처럼 쓴다.

### 문구 계약(테스트가 강제)

- memory 표면(skill, command, workflow)은 `Summary:` 줄과 `pota memory index`/`check`를 요구한다. plan 표면은 관련 노트와 완료 계획(최대 3개) 재사용, `Related completed plans:` 기록, `PLAN.md` 한 줄 항목을 요구한다. work·review 표면은 `Memory promotion:` 결정(`docs/memory/<domain>.md` 또는 `none: <reason>`)을 요구하고 노트 작성을 강요하지 않는다. 출처: `test/contract-parity.test.mjs` 34·48·76행.
- 두 `delegation.md`의 위임 프롬프트 `CONTEXT:`에는 고른 노트 경로가 들어간다. agent와 Claude 미러는 `MEMORY.md` 항목으로 노트를 고르라고 지시한다. 출처: 같은 파일 109·117행.
- README 8개는 `pota memory check|index`, `pota plan check|index [--archive]`, `docs/plan/ARCHIVE.md`, `## Completed Plans`, SessionStart, `goal stats --history`, advisory `completionCriteria`, `Memory promotion:`, `--hosts`, `pota auto-upgrade status|on|off|run`, `POTA_AUTO_UPGRADE=0`, `~/.pota/install/`을 모두 담고 옛 Claude marketplace 경로 `~/.codex/plugins/cache/pota/claude`는 담지 않는다. cleanup lock 문장은 en·ko에만 있다. 출처: `test/docs-package-hardening.test.mjs:89-126`.
- 8 locale 안내문은 같은 영문 정책 상수(`tokenEfficientWorkPolicy`, `reasoningEffortPolicy`, `memoryIndexPolicy`, `planIndexPolicy` 등)를 붙인다. ko는 일부 상수의 한국어 판을 쓴다. 출처: `scripts/pota.mjs:117-185`, `test/token-efficiency.test.mjs:450`.
- 메모리 승격 절차 본문은 `skills/pota-work/verification.md` `## Memory Promotion`, 계획 재활용 절차는 `skills/pota-plan/planning-rules.md` `## Reuse Before Planning`에 있다. 옛 `PLAN.md`의 Planning Rules 정본도 이 파일이다.

## Policy

- 새 규칙은 정본 스킬이나 참조 파일에 먼저 쓰고, 위 표의 파생 표면에 같은 의미로 옮긴다. 기계로 검사할 수 있는 규칙은 문구를 늘리지 말고 테스트로 고정한다.
- SKILL.md에 문장을 더해야 하면 같은 바이트만큼 줄이거나 참조 파일로 옮긴다.
- 고유명사·명령·식별자는 locale과 무관하게 영문 그대로 둔다. `## Domain Knowledge` 같은 인덱스 섹션 제목도 영문 고정이다.

## References

- `node --test test/contract-parity.test.mjs test/docs-package-hardening.test.mjs test/token-efficiency.test.mjs test/installed-plugin.test.mjs`
