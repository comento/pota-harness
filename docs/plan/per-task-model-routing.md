# Plan: 작업별 모델 결정

## Plan Phase

- Finalized: decision-complete for implementation (사용자 결정 2026-11-09: 모델은 상속 고정이 아니라 작업에 따라 결정).

## Goal

"Models always inherit" 정책을 작업별 모델 결정으로 바꾼다. effort와 같은 방식으로 dispatch마다 host 옵션으로 넘기고 Requested/Effective를 기록한다.

- Plan ID: `per-task-model-routing`
- Completion criteria: 모든 정책 표면(skills, templates, model guidance, agents, README.md/README.ko.md, CLI 정책 문자열)이 같은 모델 라우팅 규칙을 말하고, `npm run check` 통과.
- Required goal evidence: `finalReview`

## 정책 (canonical)

- 계획이 task 성격에 따라 task별 모델을 정하고 `Requested model`/`Effective model`을 기록한다. 항상 상속하지 않는다.
- 기본 tier:
  - fast: 읽기 전용 탐색, 검색, 목록화, 요약 → Claude Code `haiku`
  - balanced: Light Path 구현과 일상 검증 → Claude Code `sonnet`
  - stronger: 계획 수립, complexity triage, Heavy Path 구현, 리뷰, 최종 검증·리뷰 → Claude Code `opus`
  - strongest: Heavy Path 설계 → Claude Code `fable`
  - (2026-11-09 사용자 결정: 최상위 tier를 stronger/strongest로 분리, Claude Code는 Opus/Fable)
- Codex tier 대응(2026-11-09 사용자 지정 "gpt 6 luna/terra/sol/astra"를 `~/.codex/models_cache.json` slug로 확인): fast `gpt-6-luna`, balanced `gpt-6.1-terra`(`gpt-6-terra` slug는 없고 GPT-6 계열 Terra는 이것뿐), stronger `gpt-6-sol`, strongest `gpt-6-astra`.
- Antigravity tier 대응(2026-11-09 확인): `invoke_subagent`의 `Model`은 구체 모델 ID가 아닌 tier enum(`inherit`, `flash_lite`, `flash`, `pro`)만 받고 effort 파라미터가 없다(google-antigravity/antigravity-cli#1237, 공식 subagents 문서). fast `flash_lite`, balanced `flash`, stronger `pro`, strongest `pro`(더 높은 tier 없음). effort는 host 옵션이 없으므로 Effective `inherited`.
- 모든 새 task/worker dispatch는 정한 모델을 host 옵션으로 넘긴다(Claude Code: Agent `model`; `fork`는 model을 무시하므로 쓰지 않음). Codex: host가 노출한 model 옵션에 tier를 대응, 없으면 `inherited`.
- Effective: 넘겼고 거부 없음 → 그 값, 넘기지 않음 → `not-applied: <reason>`, host에 옵션 없음 → `inherited`.
- 하위 tier 워커가 gate에 실패하면 blocker 기록 전에 한 tier 올려 재dispatch한다.
- 모델·전역/사용자 설정 파일은 바꾸지 않는다(dispatch 단위만). 사용자나 저장소가 `MEMORY.md` 또는 계획에 `Model routing: inherited`를 적으면 작업별 선택을 끈다.
- 범위 외: goal 상태에 model 필드 저장(이번엔 계획서 기록만).

## Complexity Triage

- Selected path: Light Path (기존 문서·정책 문자열 수정, 새 모듈·상태 없음).
- Heavy Path signals checked: 없음(스키마 변경 없음, 정책 문구 교체).

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `implement` | `worker` | light | `sonnet` | `medium` |
| `verify` | main | light | session | session |

## Module Tasks

### Task 1: 정책 표면 교체

- Task ID: `implement`
- Requested model: `sonnet` / Requested reasoning effort: `medium`
- Files: `skills/pota-plan/{SKILL.md,delegation.md}`, `skills/pota-work/{SKILL.md,delegation.md}`, `templates/{work-plan.md,PLAN.md}`, `docs/model-guidance/{README.md,claude.md,codex.md}`, `agents/worker.md`, `README.md`, `README.ko.md`, `scripts/pota.mjs`, `scripts/pota-state-init.mjs`, `test/lifecycle.test.mjs`, `test/token-efficiency.test.mjs`
- Constraints: SKILL.md 9000 bytes 예산, hook 문자열 예산 테스트 유지. 옛 "model inherit" 정규식 2개(`test/lifecycle.test.mjs:148`, `test/token-efficiency.test.mjs:291`)는 정책 변경에 따라 새 규칙 검사로 교체.
- Module acceptance: `node --test test/lifecycle.test.mjs test/token-efficiency.test.mjs test/contract-parity.test.mjs`
- Surface integration: `npm run check`

## Evidence

- Effective model/effort: `implement`는 Claude Code Agent 호출에 `model: "sonnet"`, `effort: "medium"` 전달, 거부 없음. `verify`는 main 세션이 직접 수행(not-applied: 별도 dispatch 없음).
- 범위 추가: 옛 문구가 남아 있던 `commands/pota-{plan,work}.md`, `.agents/workflows/pota-{plan,work}.md` 정렬.
- 테스트 계약 갱신: `test/lifecycle.test.mjs`, `test/token-efficiency.test.mjs`의 옛 상속 정책 정규식을 새 정책 검사로 교체.
- 검토 중 수정: 워커가 예산 때문에 지운 "This skill explicitly instructs the effort level for delegated work." 문장을 SKILL.md 2곳과 delegation.md 2곳에 원문대로 복원(SKILL.md 9000 bytes 이내).
- 검증: `npm run check` 통과, `npm pack --dry-run`.
