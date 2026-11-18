# Plan: Claude Code DAG 패널

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-18 작성)
- Finalized: decision-complete for implementation after planned triage. (2026-11-18)
- Codex UI synchronization: Claude 데스크탑의 `update_plan`으로 표시함. `create_goal`은 이 호스트에 없음.

## Goal

Claude Code 데스크탑 오른쪽 패널에 현재 Pota goal의 task를 DAG로 보여 준다. 서브에이전트 동작에 따라 갱신되고, `/dag`로 열 수 있으며, 플랜을 세운 직후 자동으로 열린다.

- Goal ID: `goal-a0016cfe-dfaa-4f15-953e-39ecb10c4275`
- Plan ID: `docs/plan/claude-dag-panel.md`
- Runtime resources: 설치된 Pota 버전이 해석하는 `pota://` 리소스.
- Completion criteria (advisory): 설치된 Claude 플러그인에 패널 mod가 포함되고, goal 상태가 바뀌면 패널이 다시 그려지며, `npm run check`가 통과한다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, `cancelled`.

## Whole Work

- Outcome: Pota의 얇은 Claude 플러그인이 hooks 모듈(mod)을 함께 설치한다. mod는 goal 상태를 읽어 wave별 DAG를 SVG로 그린다.
- 사용자 요구사항(2026-11-18 대화):
  - 보기 4개: 이전에 진행한 위치, 현재 진행 중인 위치, 다음에 진행하는 위치, 전체 보기.
  - 간선: 완료는 실선, 진행 중은 점선과 왼쪽에서 오른쪽으로 이동하는 점(참고 화면: omo desktop의 wave 그래프).
  - `/dag` 슬래시 명령으로 패널을 연다.
  - 플랜을 세운 뒤(`goal start`·`goal replan`) 자동으로 연다.
  - 정적 화면이 아니라 서브에이전트 동작에 따라 갱신한다.
  - 보기 좋게 만들고, 함께 보면 좋은 정보도 표시한다. 후보: goal 제목·상태, `wave n/m · x/y done · z running`, task별 route·model·effort·agent, 증거 진행(`moduleAcceptance`·`surfaceIntegration` 수집 여부), blocker 사유, 경과 시간, 서브에이전트의 마지막 도구 호출, 실행 중 task 목록.
- Affected surfaces:
  - 새 디렉터리 `claude-mod/` (mod 소스. 그 자체로 `claude plugin validate`가 통과하는 플러그인 폴더).
  - `scripts/pota-lifecycle-claude.mjs` (`stageClaudePlugin`이 mod 파일을 얇은 플러그인에 넣고 `hooks/hooks.json`에 `modules`를 추가).
  - `package.json` `files`, lifecycle·packed-install·docs-package 테스트.
  - README(8개 locale), `docs/memory/lifecycle-install.md`.
- Out of scope: 버전 올림과 npm 릴리스, Codex·Antigravity 화면, 설치본(`~/.pota/install`) 직접 수정.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/goal-state.md`
- `docs/memory/delegation-model-routing.md`
- `docs/memory/lifecycle-install.md`
- `docs/memory/policy-surfaces.md`
- Related completed plans: `docs/plan/pota-overhead-reduction.md` (task `dependsOn`·`writeScope`), `docs/plan/auto-upgrade-pota-home.md` (Claude 플러그인 설치 경로)

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- Rationale: 호스트가 Claude Code이고 mod API도 Claude Code 전용이다.
- User-visible response and artifact locale: 한국어. 코드·주석은 저장소 관례대로 영어.

## Reasoning Effort Profile

- Heavy Path: design `fable`/`high`, implementation `opus`/`high`, final verification main inline.
- Light task(`docs`): `sonnet`/`medium`.
- 모든 dispatch는 Agent `model`·`effort`로 넘기고 `fork`는 쓰지 않는다.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: 새 디렉터리와 새 UI 모듈(Claude mod)이 생기고 설치 lifecycle이 바뀐다.
- Checkpoint ledger:
  - Request checkpoint: Heavy 잠정. 근거는 새 디렉터리·새 모듈, 설치 lifecycle 변경.
  - Planning checkpoint: Heavy 확정. 조사 결과는 아래 "Triage findings".
  - Code checkpoint: pending. 각 worker가 첫 수정 직전에 대상 파일·호출자·테스트를 확인하고 최종 보고에 적는다.
- Heavy Path signals checked:
  - New directory/module/layer: 있음 (`claude-mod/`).
  - New domain model/service/abstraction: 있음 (DAG 뷰 모델, SVG 렌더러).
  - Security/auth/session: 없음.
  - External API/message queue/payment: 없음.
  - DB schema/migration: 없음.
  - Concurrency/transaction/cache invalidation: 없음. lifecycle 트랜잭션 단계는 그대로 두고 `claude-plugin` target의 내용만 늘린다.
  - Cross-domain refactor: 없음.
  - Explicit extra-care signal: 없음.
- Pre-implementation decisions (design이 정하고 main이 검토):
  - mod가 goal 상태를 얻는 방법.
  - 좁은 패널 폭에서의 배치와 보기 4개의 정의.
  - 상태가 바뀔 때 SVG 교체로 애니메이션이 끊기는 문제의 처리.
  - 설치본에 넣을 파일 목록과 runtime 경로 전달 방법.

### Triage findings

- mod 형식: `.claude-plugin/plugin.json`, `hooks/hooks.json`의 `modules`(경로 1개), hooks 모듈 `register.tsx`, `$.state` 계약 `types/index.d.ts`. 모듈과 그 import는 `.ts`·`.tsx`·`.js`·`.mjs`만 로드된다. 모듈에는 DOM·Node가 없고 모든 외부 접근은 `$`를 거친다. 출처: plugin-authoring 스킬 `SKILL.md`, `reference.md`, `examples/pane.tsx`.
- 패널: `$.ui.open({ id, title })`과 `ui.render` hook(`{ component: 'Pane', requestId }`). 데스크탑 surface는 `Svg`(`source` 최대 131,072자, `isInteractive`면 SMIL·CSS 애니메이션과 hover 동작, 스크립트 불가)를 지원한다. 값은 `atom`·`read`·`update`로 두고 쓰면 다시 그려진다. 출처: `types/claude-code.d.ts` `SvgProps`.
- 명령·이벤트: `$.command.register`와 `command.run`, `tool.call`(서브에이전트 호출은 `agentId`), `session.start`. 프로세스는 `$.process.run([...])`, 파일은 `$.fs.read`.
- goal 상태: `node <runtime>/scripts/pota.mjs goal status --root <cwd>`가 `state.json` 전체(JSON, schema v3)를 낸다. task 필드는 `id`, `title`, `status`, `dependsOn`, `assignedAgentId`, `route`, `kind`, `effort`, `model`, `effectiveModel`, `requiredEvidence`, `blocker`, `createdAt`, `updatedAt`이고 `receipts`가 증거다. 상태 디렉터리 이름은 git dir 경로의 SHA-256이라 mod 안에서 직접 계산하기 어렵다. 출처: `scripts/pota-paths.mjs:25-36`, 이 goal의 `goal start` 출력.
- 설치: `stageClaudePlugin`(`scripts/pota-lifecycle-claude.mjs:10-45`)이 얇은 플러그인의 `plugin.json`, `hooks/hooks.json`, `skills/`를 만든다. target id는 `claude-plugin` 하나(tree)라 파일을 더해도 트랜잭션 target 목록은 바뀌지 않는다. 패키지 소스 `hooks/hooks.json`은 Codex와 공유하므로 `modules`는 Claude용 사본에만 넣는다.
- 이 저장소에는 `claude` CLI 2.1.326이 있고 `claude plugin validate`·`claude plugin test`를 쓸 수 있다. CI에는 없으므로 저장소 테스트(`node --test`)는 `claude` 없이 돌아야 한다.

## Heavy Design

- 작성: `heavy-design` subagent, 모델 ID `claude-fable-5-2` (시스템 프롬프트 표기 그대로), effort high. 읽기 전용으로 수행했고 파일은 수정하지 않았다.
- 근거 표기: `d.ts` = `/private/tmp/claude-501/bundled-skills/2.1.325/92a647dd8da53b7ed87cf2953d2b3a97/plugin-authoring/types/claude-code.d.ts` (Claude Code 2.1.325가 쓴 선언, 24,144줄), `ref` = 같은 폴더의 `reference.md`. 폴더는 존재한다. 로컬 `claude`는 2.1.326이다.
- 부수 효과 1건: mod 폴더 규칙을 확인하려고 `plugin-authoring` 스킬을 Skill 도구로 로드했다. 스킬 설명상 이 로드가 `~/.claude/dev-mods/<session>/` 폴더 감시를 시작한다. 그 폴더에 쓴 것은 없다.
- 실행해 본 것: `claude plugin validate --help`, `claude plugin test --help`, `node scripts/pota.mjs goal status|ready|stats [--history]` (모두 읽기 전용). 파일을 만들 수 없어 `claude plugin validate`를 실제 mod에 돌려 보지는 못했다. 아래에서 "가정"이라고 적은 항목은 그래서 미검증이다.

### 0. 조사에서 나온 사실 (설계를 바꾼 것만)

| 사실 | 근거 |
| --- | --- |
| 한 `hooks/hooks.json`에 command hook(`hooks`)과 `modules`가 함께 있는 Anthropic 공식 플러그인이 이 기기에 설치돼 있다. API 문서는 공존을 금지하지도 명시하지도 않는다. | `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/code-modernization/hooks/hooks.json` (키 `description`, `hooks`, `modules`; 71-73행 `"modules": ["./register.ts"]`), `ref:11-14` |
| `assignedAgentId`는 엔진의 agent id가 아니다. 현재 goal에서 `heavy-design.assignedAgentId`는 `"design-fable"`(main이 붙인 별칭)이다. `tool.call`의 `agentId`와 직접 대응되지 않는다. | `goal status` 실측, `d.ts:213-223`(`AgentLoop.agentId`는 `$.agent.list()`의 `id`) |
| `agent.spawn` 이벤트가 `prompt`·`description`·`name`·`model`·`parentAgentId`를 주고, `next(e)`가 시작 직후 `{ model, agentId }`로 끝난다. 이 `agentId`가 그 서브에이전트 `tool.call`의 `agentId`다. | `d.ts:281-420`, `d.ts:442-460` |
| terminal 전이(completed·cancelled)는 `state.json`을 삭제한다. 그 뒤 `goal status`는 `null`이다. 종료 결과는 `goal stats --history`의 `recent[]`(`goalId`, `status`, `endedAt`, `durationMs`)에 남는다. | `scripts/pota-goal-state-validation.mjs:10-18`, `docs/memory/goal-state.md` "전이와 종료", `goal stats --history --limit 2` 실측 |
| `goal status --root <path>`는 `--root`를 그대로 쓰고 `.git` 탐색을 하지 않는다. cwd만 주면 가장 가까운 `.git` 조상을 찾는다. | `scripts/pota-paths.mjs:98-112` |
| render hook에는 밝은·어두운 테마를 알려 주는 필드가 없다. `Text`·`Box`의 색은 테마 키(`success`, `error`, …)로 따라가지만 `Svg` 안쪽은 mod가 책임진다. | `d.ts:11503-11573`(`Pane` props), `d.ts:11673-11699`(`RenderViewport`), `d.ts:14390`(`ThemeKey`) |
| `Svg`는 `desktop`·`mobile`·`vscode`에 있고 `terminal`에는 없다. vscode는 항상 이미지로 그린다(애니메이션은 돌 수 있고 hover는 안 됨). | `d.ts:4101-4184`, `d.ts:13810-13840` |
| mod 없이 연 pane은 엔진이 폭 기준으로 막는다(터미널 144열 미만이면 `isPlaced: false`). 사람의 명령으로 연 것은 폭과 무관하게 놓인다. | `d.ts:2574-2598`, `d.ts:8003-8011` |
| 설치된 플러그인 폴더에는 엔진이 `.claude-plugin/types/`를 쓰지 않는다고 문서에 적혀 있다. 개발 중 로드 폴더에는 쓴다. | `ref:41-53` |
| CI는 Node 18과 current, ubuntu·windows·macos다. `node --test`는 `test/` 아래 `.mjs`를 전부 로드한다. | `.github/workflows/ci.yml:16-28`, `test/fixtures/fake-claude.mjs:9-10` |

### 1. 파일 배치

플러그인 이름은 `pota`로 고정한다. `$.state`는 소유 플러그인만 쓸 수 있고 ref의 `plugin`은 소스에 리터럴이어야 하는데(`d.ts:3640-3660`), 설치되는 얇은 플러그인의 이름이 `pota`이기 때문이다(`scripts/pota-lifecycle-claude.mjs:25-27`).

```
claude-mod/
  .claude-plugin/plugin.json   {"name":"pota","version":"0.0.0","description":"Pota goal DAG pane (dev manifest; the installed manifest is generated by pota install)","types":"./types/index.d.ts"}
  hooks/hooks.json             {"modules":["./register.tsx"]}
  hooks/register.tsx           이벤트 배선, `$` 호출, JSX 트리. 로직 없음
  hooks/dag-model.mjs          상태 정규화, wave, 간선 축약, 보기 4개, 요약
  hooks/dag-layout.mjs         글자 폭 추정, 말줄임, 좌표 계산
  hooks/dag-text.mjs           문구(ko·en), 카드 4줄, 하단 목록, 터미널 대체 표시
  hooks/dag-svg.mjs            SVG 문자열 생성, XML escape, 한도 축소
  hooks/dag-events.mjs         명령 감지, 도구 호출 요약, agent↔task 연결, 상태 reducer, 자동 열림·갱신 간격 정책
  types/index.d.ts             `$.state` 계약 (PluginState `pota`)
  tests/pane.test.tsx          `claude plugin test claude-mod`용 (로컬 전용)
  tsconfig.json                d.ts 머리말의 권장 옵션 + `"allowJs": true`
  .gitignore                   `.claude-plugin/types/`
test/claude-mod.test.mjs       순수 모듈과 소스 제약 검사 (`node --test`)
```

- `version`을 `0.0.0`으로 고정하는 이유: 설치본 manifest는 `stageClaudePlugin`이 `package.json`에서 생성하므로 이 파일의 version은 쓰이지 않는다. 릴리스 버전 표면을 하나 더 만들지 않는다.
- 디렉터리 이름 제약: `claude-mod/` 아래에 `test/` 디렉터리나 `*.test.mjs`·`*.test.ts` 파일을 두지 않는다. `node --test`가 집어 간다. kit 테스트는 `tests/*.test.tsx`만 쓴다(Node는 `.tsx`를 집지 않는다).
- 순수 모듈 규칙: `.mjs` 5개는 import가 서로의 상대 경로뿐이고 `node:`·`process`·`Buffer`·`require`·`import()`·`Intl`·`Date.now()`·타이머를 쓰지 않는다. 시간·locale·폭은 전부 인자로 받는다. Node 18에서 돌아야 한다.
- import 방향: `dag-model` ← `dag-events`, `dag-layout` ← `dag-text` ← `dag-svg`. 순환 없음.

#### 타입 (`types/index.d.ts`가 export, `.mjs`는 JSDoc typedef로 같은 모양을 적는다)

```ts
export type DagTask = {
  id: string; title: string; status: 'pending'|'active'|'blocked'|'completed';
  dependsOn: string[]; assignedAgentId: string|null;
  route: 'light'|'heavy'|null; kind: 'design'|null; effort: string|null;
  model: string|null; effectiveModel: string|null;
  requiredEvidence: string[]; evidence: string[];   // evidence = receipt가 있는 kind
  writeScope: string[]|null; blocker: string|null; createdAt: number; updatedAt: number
}
export type DagSnapshot = {
  goalId: string; title: string; planId: string;
  status: 'active'|'paused'|'blocked'|'cancelled'|'completed'; blocker: string|null;
  revision: number; createdAt: number; requiredEvidence: string[]; evidence: string[]; tasks: DagTask[]
}
export type DagState = {
  seq: number;                       // snapshot 내용이 바뀔 때만 +1
  snapshot: DagSnapshot|null;
  ended: { status: 'completed'|'cancelled'|'unknown'; endedAt: number|null }|null;
  error: string|null; fetchedAt: number; root: string|null;
  timeline: Record<string, { activeAt?: number; completedAt?: number }>
}
export type DagUi = { view: 'previous'|'current'|'next'|'all'; epoch: number; minute: number;
  autoOpenedPlanKey: string|null; closedGoalId: string|null }
export type DagAgent = { id: string; name: string|null; description: string; model: string|null;
  parentId: string|null; mentions: string[]; status: 'running'|'done';
  activity: string; activityAt: number; calls: number }
declare module 'claude-code' {
  interface PluginState { pota: { dag: Shaped<DagState>; dagUi: Shaped<DagUi>; dagAgents: Shaped<DagAgent[]> } }
}
```

atom은 `register.tsx` 상단에 `{ plugin: 'pota', key: 'dag' } as const` 형태로 3개만 둔다. shape 태그는 `dag-1`, `ui-1`, `agents-1`이다.

#### 순수 모듈 export

`hooks/dag-model.mjs`

| 함수 | 입력 → 출력 |
| --- | --- |
| `parseGoalStatus(stdout)` | `string` → `{ snapshot: DagSnapshot\|null, error: string\|null }`. `"null"`이면 둘 다 null. JSON이 아니거나 `goal.id`·`tasks[]`가 없으면 `error`. 모르는 필드는 무시, 모르는 status는 `pending`, 없는 id를 가리키는 `dependsOn`은 버린다. timestamp는 ms 숫자로 바꾼다. |
| `computeWaves(tasks)` | `{id, dependsOn}[]` → `{ waveOf: Record<string, number>, waves: string[][] }` |
| `reduceEdges(tasks)` | → `{ from: string, to: string }[]` (transitive reduction) |
| `taskState(task, byId)` | → `'completed'\|'active'\|'blocked'\|'ready'\|'waiting'` |
| `focusIds(snapshot)` | → `string[]` |
| `buildDagModel(snapshot, view)` | → `DagModel` |
| `summarize(snapshot)` | → `{ waveCurrent, waveTotal, done, total, running, blocked, ready, models: string[], allDone: boolean }` |
| `planKey(snapshot)` | → `string` (`goalId` + 각 task의 `id<dependsOn`) |

```ts
type DagModel = {
  view: ViewId;
  nodes: { id: string; wave: number; role: 'focus'|'context'; state: TaskState; task: DagTask }[];
  edges: { from: string; to: string; state: 'done'|'flow'|'wait'|'blocked' }[];
  waves: { index: number; total: number; completed: number; active: number; blocked: number }[]; // 보이는 wave만, 오름차순
  empty: null|'no-completed'|'no-next'; hiddenAfter: number
}
```

`hooks/dag-layout.mjs`

| 함수 | 입력 → 출력 |
| --- | --- |
| `textWidth(text, fontSize)` | → px 추정값 |
| `truncateText(text, maxWidth, fontSize)` | → 넘치면 끝을 `…`로 바꾼 문자열 |
| `panelWidth(bodyColumns)` | → `max(240, min(1600, floor(bodyColumns*8/20)*20))` |
| `layoutDag(model, { width, density })` | → `{ orientation: 'row'\|'column', width, height, card: {w,h}, headers: {wave, x, y, w}[], boxes: {id,x,y,w,h}[], paths: {from,to,state,d}[] }` |

`hooks/dag-text.mjs`

| 함수 | 입력 → 출력 |
| --- | --- |
| `pickLocale(values)` | `(string\|undefined)[]` → `'ko'\|'en'` (`ko`로 시작하면 ko, 그 밖은 en) |
| `formatElapsed(ms, locale)` | → `"1분 미만"`, `"12분"`, `"1시간 12분"` |
| `formatSummary(summary, ctx)` | → `"wave 3/5 · 3/10 done · 3 running · 2 models · 23분"` |
| `cardLines(node, ctx)` | → `{ title, status, meta, progress, tooltip }` (문자열, 말줄임 전) |
| `runningRows(snapshot, agentTask, agents, ctx)` | → `Row[]` (하단 목록) |
| `textRows(model, ctx, columns)` | → `Row[]` (터미널 대체 표시, 각 행 폭 ≤ `columns`) |

`Row = { text: string; tone: 'plain'|'dim'|'ok'|'run'|'ready'|'bad'; bold?: boolean }`, `ctx = { locale, minute, timeline, snapshot }`.

`hooks/dag-svg.mjs`

| 함수 | 입력 → 출력 |
| --- | --- |
| `escapeXml(text)` | → `& < > " '` 치환, XML 1.0에 없는 제어 문자와 짝 없는 surrogate 제거 |
| `renderDagSvg(model, { width, epoch, ctx })` | → `{ source: string, alt: string, density: 0\|1\|2, omitted: number }`, `source.length <= 131072` 보장 |

`hooks/dag-events.mjs`

| 함수 | 입력 → 출력 |
| --- | --- |
| `parsePotaGoalCommand(command)` | → `{ subs: string[], mutates: boolean, planned: boolean, root: string\|null }\|null` |
| `describeToolCall(e)` | `{ tool, ...args }` → 40자 이하 한 줄 |
| `extractTaskMentions(text, taskIds)` | → `string[]` |
| `reduceAgents(prev, event)` | `DagAgent[]`, `{type:'spawn'\|'call'\|'done'\|'sync', …}` → `DagAgent[]` (최대 16개) |
| `resolveAgentTasks(agents, tasks)` | → `Record<agentId, taskId>` |
| `reduceDagState(prev, { snapshot, error, now, recent })` | → `DagState` (seq, timeline, ended 처리) |
| `shouldAutoOpen({ planned, snapshot, ui, paneOpen })` | → `boolean` |
| `nextRefreshDelay({ now, lastRunAt, failures, reason })` | → ms |

### 2. 상태 수집과 갱신

**결정: `$.process.run`으로 `goal status`를 실행한다.** `$.fs.read`로 `state.json`을 직접 읽지 않는다.

- 근거: 상태 경로는 `POTA_HOME`, git common dir·git dir의 realpath, worktree 파일 해석, SHA-256으로 정해진다(`scripts/pota-paths.mjs:24-57`). mod 안에서 `crypto.subtle`로 흉내 낼 수는 있으나 그 규칙을 두 군데에 두게 된다. `goal status`는 migration·검증을 거친 schema v3를 내는 기존 계약이다(`scripts/pota-goal-cli.mjs:60-64`).
- 비용: 갱신 1회에 node 프로세스 1개. 아래 간격 규칙으로 묶는다.

**runtime CLI 경로.** `session.start`에서 한 번 찾아 모듈 변수에 둔다. null이면 다음 갱신 때 다시 찾는다.

1. `${$.plugin.root}/pota-runtime.json`을 `$.fs.read`로 읽어 `entrypoints.cli`를 쓴다. 이 파일은 설치 때 `writeLocator`가 만든다(7절). `$.plugin.root`는 `d.ts:2395-2404`.
2. 없으면 `${$.plugin.root}/../scripts/pota.mjs`가 `$.fs.exists`일 때 그것을 쓴다. 저장소에서 `claude --plugin-dir claude-mod`로 띄운 경우다.
3. 둘 다 없으면 null. 패널에 "Pota runtime을 찾지 못했습니다. `pota doctor`를 실행하세요."를 띄운다.

**실행 형태.** `$.process.run(["node", cli, "goal", "status"], { cwd: root, timeoutMs: 10000 })`. `--root`는 넘기지 않는다. `root`는 마지막으로 관찰한 goal 명령의 `--root` 값(절대 경로일 때), 없으면 `await $.session.root()`다. cwd로 주면 CLI가 `.git` 조상을 찾으므로 세션이 하위 디렉터리에서 시작해도 hook과 같은 상태를 본다.

**다시 읽는 시점.**

| 이벤트 | 조건 | 동작 |
| --- | --- | --- |
| `tool.call` (`tool === "Bash"`, 모든 loop) | `parsePotaGoalCommand(e.command)?.mutates`이고 결과가 `isError`가 아님 | `next(e)`가 끝난 뒤 갱신 예약. `planned`면 자동 열림 후보로 표시 |
| `command.run` (`/dag`) | 항상 | 즉시 갱신 예약 후 패널 열기 |
| `turn.complete` | 패널이 열려 있을 때 | 갱신 예약. `e.agentId`가 있으면 그 agent를 `done`으로 |
| `agent.spawn` | `next(e)`가 `agentId`를 줬을 때 | agent 기록 추가 (프로세스 실행 없음) |
| 타이머 30초 | 패널이 `isPlaced`일 때만 | 갱신 예약, `minute` 갱신 |
| `session.start` | `$.ui.panes()`에 패널이 이미 있을 때(리로드) | 갱신 예약, 타이머 재시작 |

- `mutates`인 하위 명령: `start`, `replan`, `task`, `claim`, `assign`, `receipt`, `verify`, `finish`, `pause`, `resume`, `block`, `cancel`, `complete` (`scripts/pota-goal-cli.mjs:6`). `status`, `ready`, `stats`는 제외한다.
- 패널이 닫혀 있고 `planned`도 아니면 갱신하지 않는다. `/dag`가 열 때 읽는다.
- 30초 타이머는 다른 터미널·세션에서 바뀐 상태를 잡기 위한 것이다. 패널을 열 때 `$.clock.every(30000, …)`로 만들고 `ui.close`에서 `cancel()`한다. 매 tick에 `$.ui.panes()`로 `isPlaced`를 확인한다(`d.ts:16325-16350`). headless 실행에서 패널이 그려지지 않으면 프로세스를 띄우지 않는다.

**과도한 실행을 막는 규칙** (`nextRefreshDelay`).

- 예약은 `$.clock.after(delay, run)` 하나만 둔다. 이미 예약돼 있으면 새로 만들지 않는다. 실행 중에 요청이 오면 `dirty`만 세우고 끝난 뒤 한 번 더 돈다.
- `delay = max(300, lastRunAt + 1000 - now)`. 디바운스 300ms, 프로세스 시작 사이 최소 1000ms.
- 연속 실패 3회부터 `poll` 사유의 갱신은 120초 간격으로 줄인다. goal 명령과 `/dag`는 backoff를 무시한다. 성공하면 실패 횟수를 0으로 돌린다.
- hook 안에서는 `next(e)` 앞에 `await`하는 `$` 호출을 두지 않는다. 도구 호출이 mod 때문에 늦어지지 않는다. 오래 사는 작업은 타이머로 돌린다(`ref:253-261`).

**`tool.call` hook 형태.** 관찰만 한다. 본문은 `const ran = await next(e)` 앞뒤로 try/catch에 싼 동기 코드와 예약 호출뿐이고 항상 `ran`을 그대로 반환한다. `.catch(($, e, next) => next(e))`를 붙인다(`ref:126-127`). `agent.spawn`, `ui.close`, `turn.complete`도 같은 규칙이다.

**실패와 빈 상태.**

| 상황 | 화면 |
| --- | --- |
| stdout이 `null`이고 이전 snapshot도 없음 | "활성 Pota goal이 없습니다. `pota-plan`으로 계획을 세우면 여기에 DAG가 표시됩니다." |
| stdout이 `null`이고 이전 snapshot이 있음 | `goal stats --history --limit 5`를 1회 실행해 `recent`에서 같은 `goalId`를 찾는다. `completed`면 마지막 snapshot의 task를 전부 완료로 바꿔 고정 표시, `cancelled`면 그대로 고정, 못 찾으면 `unknown`. 머리말에 "종료됨" 표시. 이후 polling 중단 |
| 실행 거부·timeout·exit≠0·파싱 실패 | 마지막 정상 snapshot을 유지하고 그 아래에 dim 한 줄 "상태 갱신 실패: <stderr 첫 줄 200자>" |
| CLI 경로 없음 | 위 3번 문구 |

**`hooks.json` 공존.** 설치본 `hooks/hooks.json`은 `{ "hooks": {…기존 5개 이벤트…}, "modules": ["./register.tsx"] }` 한 파일로 만든다. 근거는 0절 첫 행이다. **가정**: 모듈 로드가 실패하거나 mod 기능이 꺼진 빌드에서도 같은 파일의 command hook은 그대로 돈다(`ref:94` "none of its hooks run, though its plugin's `commands/` and `skills/` files still load"는 command hook을 직접 말하지 않는다). 대안: `claude plugin validate`가 이 조합을 거부하면 `hooks/hooks.json`은 지금 모양 그대로 두고 `hooks/mod.json`에 `{"modules":["./register.tsx"]}`를 넣어 `plugin.json`의 `"hooks": "./hooks/mod.json"`으로 추가한다. Claude Code는 기본 `hooks/hooks.json`과 manifest의 hooks를 합친다(`scripts/pota-lifecycle-claude.mjs:6-9` 주석).

### 3. 뷰 모델

**wave.** `wave(t) = 0` (`dependsOn`이 비었을 때), 아니면 `1 + max(wave(dep))`. 표시는 `Wave ${index+1}`. 같은 wave 안의 순서는 `tasks[]` 순서. 검증을 통과한 상태에는 cycle이 없지만(`scripts/pota-goal-state-validation.mjs:235-258`) `computeWaves`는 방문 중인 노드로 돌아오는 간선을 무시해서 반드시 끝난다.

**task 상태.** `completed`, `active`, `blocked`는 status 그대로. `pending`은 선행이 모두 completed면 `ready`, 아니면 `waiting`.

**간선.** `reduceEdges`로 다른 경로가 있는 간선을 지운 것만 그린다. `u → v`의 상태: `v`가 completed면 `done`, active면 `flow`, blocked면 `blocked`, 그 밖은 `wait`. active task의 선행은 전부 completed이므로(`assertCanBeActive`, 같은 파일 262-266행) `flow`의 출발점은 항상 완료 노드다.

**초점 집합 F** (`focusIds`).

1. active task 전부와, 선행이 모두 completed인 blocked task.
2. 1이 비면 ready task 전부.
3. 2도 비면(전부 completed) 마지막 wave의 task.

**보기 4개.**

| 보기 | focus 노드 | context 노드(흐리게) | 비었을 때 |
| --- | --- | --- | --- |
| `previous` 이전 | completed task 전부 | 없음 | `no-completed`: "아직 완료된 task가 없습니다." |
| `current` 현재 (기본값) | F | 축약 간선으로 F에 바로 들어오는 선행 중 F가 아닌 것 | 비지 않는다 |
| `next` 다음 | N1 = 미완료이고 F가 아니며 모든 `dependsOn`이 completed이거나 F인 task | 축약 간선으로 N1에 바로 들어오는 F 노드 | `no-next`: "다음 task가 없습니다." `hiddenAfter` = 미완료 − F − N1 개수. 0보다 크면 "+N개는 전체 보기에서" 한 줄 |
| `all` 전체 | 모든 task | 없음 | 비지 않는다 |

- 보이는 wave는 노드가 하나라도 있는 wave만, 전역 번호를 유지한 채 붙여서 배치한다. wave 머리말의 개수(`0/3 완료 · 3 실행 중`)는 그 wave 전체 기준이다.
- 요약의 `wave n/m`에서 `n`은 미완료 task가 있는 가장 낮은 wave + 1, 전부 완료면 `m`.

**경계 사례.**

| 사례 | previous | current | next | 요약 |
| --- | --- | --- | --- | --- |
| 전부 완료 (goal은 `finish` 전) | 전부 | 마지막 wave + 그 선행 | `no-next` | `wave m/m · t/t done` + "goal finish 대기" |
| 전부 pending | `no-completed` | wave 1의 ready task | wave 2 중 조건 맞는 것 | `wave 1/m · 0/t done · 0 running` |
| blocked (선행 완료) | 완료분 | blocked task가 F에 포함, 간선 `blocked` | blocked 뒤 task는 N1 | `· 1 blocked` |
| 병렬 active (최대 4, `MAX_ACTIVE_TASKS`) | 완료분 | active 전부. wave가 달라도 각자 wave 열에 | 조건 맞는 것 | `· 4 running` |
| task 1개 | 완료면 1개, 아니면 `no-completed` | 그 1개, 간선 없음 | `no-next` | `wave 1/1` |

**좁은 패널.** 폭은 `e.props.bodyColumns`에서 얻는다(`d.ts:11520-11527`, `ref:201`). `e.viewport.columns`는 쓰지 않는다. 원격 surface에서 cell은 코드 글꼴 advance 기준이라(`d.ts:11673-11680`) px는 `bodyColumns × 8`로 추정하고 20px 단위로 내린다(`panelWidth`). SVG는 루트에 `width`·`height`·`viewBox`를 그 값으로 적고 `Svg`의 `width`·`height` prop은 주지 않는다. 그러면 slot보다 넓을 때만 비율을 유지한 채 줄어든다(`d.ts:13822-13830`).

- 상수: `PAD 12`, `CARD_MIN_W 140`, `CARD_MAX_W 260`, `GAP_MAIN 40`(간선 공간), `GAP_CROSS 10`, `HEADER_H 22`, 카드 높이 `[78, 46, 28]`(density 0·1·2).
- `row` 배치(wave가 열, 왼쪽→오른쪽): `cols*140 + (cols-1)*40 + 24 <= width`일 때. 카드 폭은 남는 폭을 열 수로 나눠 140~260으로 자른다. 열 안의 순서는 선행 노드 y의 평균으로 정렬한다(교차 감소, 동률은 입력 순서).
- `column` 배치(wave가 가로 띠, 위→아래): 그 밖. 띠 안에서 한 줄에 `max(1, floor((width-24+10)/150))`개씩 놓는다. 간선은 출발 카드 아래 가운데에서 도착 카드 위 가운데로 간다.
- 계산 예: 48열 dock이면 width 380. `current`·`next`(2열, 344 필요)는 `row`, wave 5개인 `all`(884 필요)은 `column`이 된다.
- **요구사항과의 차이**: 이동 점이 왼쪽→오른쪽으로 가는 것은 `row` 배치일 때다. `column` 배치에서는 위→아래로 간다. Pane에는 가로 스크롤이 없어서(스크롤은 엔진 소유, `d.ts:11553-11564`) 좁은 패널에서 "전체 보기"를 가로로 유지할 방법이 없다. main이 이 차이를 받아들일지 확인해야 한다.

### 4. 시각 설계

**SVG에 넣는 것과 빼는 것.** SVG는 그래프만 그린다. 상단 요약, 보기 버튼, 하단 실행 목록은 `Text`·`Button`·`Box`로 그린다. 이유: 서브에이전트의 마지막 도구 호출은 몇 초마다 바뀌는데 `Svg`는 `source` 문자열이 통째로 데이터라(`d.ts:13802-13809`) 바뀔 때마다 frame이 새로 로드되고 애니메이션이 처음부터 돈다. 자주 바뀌는 글자를 SVG 밖에 두면 SVG는 task 상태가 바뀔 때와 분 단위 경과 시간이 바뀔 때만 교체된다.

**문서 골격.**

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H" role="img"
     font-family="system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif">
<title>ALT</title>
<style>
:root{--fg:#1f2328;--mut:#6e7781;--card:#f6f8fa;--line:#d0d7de;--ok:#1a7f37;--run:#0969da;--rdy:#9a6700;--bad:#cf222e;--idle:#8c959f}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--mut:#8b949e;--card:#22272e;--line:#444c56;--ok:#3fb950;--run:#58a6ff;--rdy:#d29922;--bad:#f85149;--idle:#6e7681}}
text{font-size:11px;fill:var(--mut)} .t{font-size:12px;font-weight:600;fill:var(--fg)} .h{fill:#8b949e}
.c{fill:var(--card);stroke:var(--line)} .n:hover .c{stroke:var(--run)} .ctx{opacity:.55}
.e{fill:none;stroke-width:1.5;stroke-linecap:round}
.done{stroke:var(--ok)}
.flow{stroke:var(--run);stroke-dasharray:6 5;animation:m .8s linear infinite;animation-delay:-PHASE8s}
.wait{stroke:var(--idle);stroke-dasharray:1 5;opacity:.7}
.blk{stroke:var(--bad);stroke-dasharray:4 4}
.dot{fill:var(--run)}
@keyframes m{to{stroke-dashoffset:-11}}
@media (prefers-reduced-motion:reduce){.flow{animation:none}.dot,.pulse{display:none}}
</style>
<g>간선 path, 이동 점</g>
<g>wave 머리말 text</g>
카드마다 <svg x y width height class="n"> … </svg>
</svg>
```

그리는 순서는 간선, 머리말, 카드다. 카드는 불투명이라 여러 wave를 건너는 간선이 카드 뒤로 지나간다.

**노드 카드** (density 0, 높이 78). 카드마다 중첩 `<svg x y width height>`를 써서 넘치는 글자를 잘라 낸다.

| 줄 | 내용 | 예 |
| --- | --- | --- |
| 1 | 상태 점(반지름 4) + 제목 (`.t`) | `● claude-mod DAG 패널 구현` |
| 2 | 상태 + 시간 | `실행 중 · 12분` / `완료 · 4분` / `준비됨` / `대기 · 선행 2개` / `막힘` |
| 3 | 역할·모델 | `heavy · fable · high · @design-fable` (design task는 앞에 `design ·`, 배정 없는 active는 `main`) |
| 4 | 진행 문구 | `증거 ●○ 1/2` (requiredEvidence 순서대로 수집 ●, 미수집 ○). blocked면 blocker 사유 |

- 카드 안 `<title>`에 말줄임 전 전체 정보를 넣는다: id, 전체 제목, `dependsOn`, 증거 kind 이름, `writeScope` 앞 3개, `effectiveModel`. `isInteractive`면 hover tooltip으로 보인다.
- density 1(높이 46)은 1·2줄, density 2(높이 28)는 점과 제목만.

**상태별 표시.**

| 상태 | 점 | 테두리 | 그 밖 |
| --- | --- | --- | --- |
| completed | `--ok` 채움 | `--ok` | |
| active | `--run` 채움 + 퍼지는 원 | `--run` 1.5px | 퍼지는 원: `<circle class="pulse">` 안에 `<animate attributeName="r" values="4;9" dur="1.6s" begin="-PHASE16s" repeatCount="indefinite"/>`와 `opacity` `.5;0` |
| ready | `--rdy` 빈 원 | `--rdy` | |
| waiting | `--idle` 빈 원 | `--line` 점선 `3 3` | 글자 `--mut` |
| blocked | `--bad` 채움 | `--bad` | 4줄에 사유 |
| context | 위와 같음 | 위와 같음 | 카드 전체 `class="ctx"` |

**간선.**

- `row`: `M x1 y1 C x1+k y1, x2-k y2, x2 y2`. `(x1,y1)`은 출발 카드 오른쪽 변 가운데, `(x2,y2)`는 도착 카드 왼쪽 변 가운데, `k = max(18, (x2-x1)/2)`.
- `column`: `M x1 y1 C x1 y1+k, x2 y2-k, x2 y2`. 출발 카드 아랫변 가운데 → 도착 카드 윗변 가운데, `k = max(16, (y2-y1)/2)`.
- `done`: `<path class="e done" d="…"/>` 실선.
- `flow`: `<path class="e flow" d="…"/>` 점선이 진행 방향으로 흐르고, 그 뒤에 `<circle class="dot" r="3"><animateMotion dur="1.6s" begin="-PHASE16s" repeatCount="indefinite" path="…같은 d…"/></circle>`. `mpath href`를 쓰지 않고 `path` 속성에 같은 `d`를 다시 적는다. 엔진의 scrub이 `href`를 지울 가능성을 피한다(`d.ts:13836-13839`는 script와 이벤트 속성만 말한다).
- `wait`: 옅은 점선(`1 5`), 움직임 없음. `blocked`: `--bad` 점선, 움직임 없음.
- task가 완료되면 다음 갱신에서 `flow`가 `done`으로 바뀌어 실선이 된다.

**테마.** API가 테마를 주지 않으므로 SVG 안의 `@media (prefers-color-scheme: dark)`로 팔레트를 바꾼다. frame의 scheme이 앱 테마와 다를 때를 대비해 두 가지를 지킨다. 카드는 불투명한 자기 배경을 가져 글자 대비가 카드 안에서 완결된다. 카드 밖에 직접 놓이는 것(간선, wave 머리말 `#8b949e`)은 밝은·어두운 배경 모두에서 읽히는 중간 톤만 쓴다. 배경 `rect`는 그리지 않는다.

**한글 폭과 말줄임.** DOM이 없어 측정할 수 없으므로 추정한다. `textWidth`는 code point 단위로 폭 계수를 더해 `fontSize × 1.05`를 곱한다: 한글·한자·가나·전각 1.0, astral(이모지 등) 1.1, ASCII 대문자와 `MW@%` 0.7, `iIl.,:;'|! ` 0.3, 그 밖의 ASCII 0.56, 나머지 0.6. `truncateText`는 입력을 NFC로 바꾸고 `Array.from`으로 잘라 surrogate 쌍을 쪼개지 않으며 끝에 `…`를 붙인다. 추정이 틀려도 중첩 `<svg>`가 잘라 내므로 카드 밖으로 나가지 않는다.

**교체 시 애니메이션 끊김 완화.**

1. SVG 문자열은 `(DagState.seq, view, width, minute, epoch, locale)`의 순수 함수다. 하단 목록만 바뀌는 다시 그리기에서는 같은 문자열이 나온다. `register.tsx`는 직전 key와 결과를 모듈 변수 하나에 memo한다.
2. 위상 유지: `PHASE16 = (epoch % 1600) / 1000`, `PHASE8 = (epoch % 800) / 1000`을 `begin`·`animation-delay`에 음수로 넣는다. `epoch`는 SVG 내용이 바뀌는 쓰기(seq 증가, 보기 전환, minute 변경)에서 `await $.clock.now()`로 갱신한다. 새 문서가 로드되는 시각이 `epoch`와 거의 같으므로 점이 이전 위치에서 이어진다. 모든 애니메이션의 주기는 1.6초 또는 그 절반이다.
3. render hook은 상태를 쓰지 못하므로(`d.ts:3650-3655`, `ref:202`) `epoch`·`minute`는 타이머, 갱신, 버튼 handler에서만 쓴다. 폭이 바뀌는 경우는 쓰기 지점이 없어 위상이 한 번 튄다. 받아들인다.
4. 분 단위 경과 시간 때문에 active task가 있는 동안 SVG가 1분에 한 번 교체된다.

**131,072자 한도.** `renderDagSvg`는 120,000자를 목표로 단계를 올린다.

1. density 0으로 만든다.
2. 넘으면 density 1, 다시 넘으면 density 2. 카드 `<title>`은 density 2에서 뺀다.
3. 그래도 넘으면 노드를 줄인다. 우선순위는 active, blocked, ready, waiting(낮은 wave 먼저), completed(높은 wave 먼저). 들어가는 개수를 절반씩 줄여 가며 맞추고, 양끝이 모두 남은 간선만 그린다. 마지막 줄에 "+N개 task 생략"을 넣고 `omitted`로 돌려준다.

`alt`는 `"Pota goal DAG. wave 3/5, 3/10 완료, 3 실행 중. 실행 중: a, b, c"` 형태로 항상 채운다(필수, `d.ts:13815-13819`).

### 5. 표시 정보

**넣는 것.**

| 위치 | 내용 | 이유 |
| --- | --- | --- |
| 머리말 (`Text`) | goal 제목, goal status(`active` 외일 때), goal blocker, 종료 표시 | 무엇의 그래프인지와 멈춘 이유 |
| 요약 (`Text` dim) | `wave n/m · x/y done · z running [· b blocked] [· k models] · 경과` | 참고 화면의 상단 줄. `models`는 task의 `model` 고유 개수, 0이면 생략. 경과는 goal `createdAt`부터 |
| 보기 버튼 (`Button` 4개 + 새로고침) | 이전 / 현재 / 다음 / 전체, hotkey `1`~`4`, 선택된 것만 `variant="primary"`, key `view-previous` 등 | 요구사항 |
| 그래프 (`Svg`) | 4절의 카드와 간선 | |
| 하단 "실행 중" | active task마다 2행: `● 제목` / `  @agent · 마지막 도구 호출 · 호출 수 · 경과` | 참고 화면의 하단 목록 + 서브에이전트 동작 |
| 하단 그 밖 | blocked: `! 제목 — 사유`. ready: `○ 준비됨: a, b`. 연결 못 한 실행 중 agent: `◦ 이름 · 마지막 도구 호출` | 다음에 손댈 곳 |
| 맨 아래 | 갱신 실패 한 줄(있을 때만) | 화면이 낡았는지 알 수 있게 |
| widget 배치 | 요약 한 줄 + `Progress`(`value = done`, `max = total`) | `placement === "widget"`에서는 클릭이 닿지 않을 수 있다(`d.ts:11528-11545`) |

**빼는 것.** receipt의 명령·digest(양이 많고 판단에 안 쓰임), 증거 freshness(`goal stats`를 한 번 더 돌려야 하고 git fingerprint 계산이 따라온다), `completionCriteria`(advisory), 이력 통계, 토큰·비용(`$.session.usage()`는 세션 단위라 task에 나눌 수 없다), `effortSource`·`modelSource`·waiver(감사용).

**서브에이전트 ↔ task 연결.** `assignedAgentId === agentId` 대응만으로는 안 된다(0절). `agent.spawn`에서 `{ id: agentId, name, description, model, parentId: parentAgentId, mentions }`를 기록하고 `resolveAgentTasks`가 매 계산 때 아래 순서로 정한다. `goal assign`은 dispatch 뒤에 기록되므로(`docs/memory/delegation-model-routing.md` Policy) spawn 시점이 아니라 그릴 때마다 다시 푼다.

1. `task.assignedAgentId`가 agent의 `id` 또는 `name`과 같다.
2. 부모 agent(`parentId`)가 연결돼 있으면 그 task.
3. `mentions`가 정확히 1개면 그 task. 여러 개면 그중 active가 1개일 때만 그 task. `mentions`는 spawn 때 `extractTaskMentions(prompt + description, taskIds)`로 구한다. id가 backtick·따옴표로 감싸였거나 `--task ` 바로 뒤에 온 경우만 센다. `` `docs/plan/x.md` ``는 task `docs`로 세지 않는다.
4. 1~3으로 연결된 agent가 없는 active task(`assignedAgentId`가 있음)가 정확히 1개이고, 연결 안 된 실행 중 agent(부모 없음)가 정확히 1개면 둘을 잇는다.
5. 그 밖은 연결하지 않고 하단 "기타 에이전트"에 둔다.

main loop의 도구 호출(`agentId` 없음)은 `assignedAgentId`가 null인 active task가 정확히 1개일 때 그 task의 `main` 행에 붙인다.

`describeToolCall`은 인자를 그대로 싣지 않는다. Bash는 앞의 `VAR=…`와 `cd … &&`를 건너뛰고 토큰 3개까지(경로는 basename), pota goal 명령은 `pota goal <sub>`, 파일 도구는 `<tool> <basename>`, `Grep`·`Glob`은 `<tool> <pattern>`, `Agent`는 `Agent: <description>`, `mcp__a__b`는 `a:b`, 40자에서 자른다. 토큰·비밀번호가 든 명령줄이 `$.state`와 화면에 남지 않게 하기 위해서다. 활동 기록은 모듈 변수 버퍼에 모아 1초에 한 번만 `dagAgents`에 쓴다.

### 6. 명령과 자동 열림

**`/dag`.** `session.start`에서 `await $.command.register({ name: "dag", description: "Show the Pota goal task graph in a pane", argumentHint: "[previous|current|next|all|refresh|close]", immediate: true })`. `immediate`를 주는 이유는 goal 실행이 긴 turn이라 turn 도중에 열 수 있어야 하기 때문이다(`d.ts:1976-1986`). `command.run` hook은 `{ command: "dag" }` matcher로 자기 명령만 답하고 `next`를 읽지 않는다(`ref:66`의 "answers its own command").

| 인자 | 동작 |
| --- | --- |
| 없음 | 열기 + 갱신 |
| `previous` `current` `next` `all` (`이전` `현재` `다음` `전체`도 받음) | 보기 변경 + 열기 |
| `refresh` | 갱신만 |
| `close` | `$.ui.close({ id })` |

열 때 `closedGoalId`를 null로 되돌린다. 답은 `{ text }` 한 줄이다. `isPlaced`가 false면 `reason`과 `formatSummary` 결과를 text에 넣어 패널 없이도 현재 위치를 알 수 있게 한다.

**패널.** id `pota-dag`, `$.ui.open({ id: "pota-dag", title: "Pota DAG" })`. `focus`, `closeOnEscape`, `holdToasts`는 주지 않는다(계속 열어 두는 패널, `d.ts:8035-8062`). 이미 `$.ui.panes()`에 있으면 다시 열지 않는다.

**자동 열림 조건** (`shouldAutoOpen`). 아래가 모두 참일 때 갱신 직후 타이머 콜백에서 연다.

1. 직전 Bash 명령이 `planned`였다. `parsePotaGoalCommand`가 찾은 하위 명령에 `start` 또는 `replan`이 있고 그 호출 결과가 `isError`가 아니다.
2. 갱신 결과 snapshot이 있다.
3. `planKey(snapshot) !== ui.autoOpenedPlanKey`. 같은 계획으로는 한 번만 연다.
4. `ui.closedGoalId !== snapshot.goalId`.
5. 패널이 지금 열려 있지 않다.

**명령 감지 규칙.** 명령 문자열 전체에서 `/(?:^|[\s"'\/\\;&|(])pota(?:\.mjs)?["']?\s+goal\s+([a-z]+)\b/g`의 모든 일치를 모은다. `node "/…/scripts/pota.mjs" goal start …`, `pota goal replan …`, `cd x && node scripts/pota.mjs goal task …`가 잡힌다. `--root`는 `/--root(?:=|\s+)("[^"]+"|'[^']+'|\S+)/`로 뽑아 따옴표를 벗긴다. 문자열 안에 문구만 있는 명령(`grep "pota goal start" README.md`)도 잡히지만 조건 2~4가 걸러서, 이미 있는 goal을 한 번 여는 것 이상은 일어나지 않는다.

**닫은 뒤의 정책.** `ui.close` hook(`{ id: "pota-dag" }`)에서 `e.origin.kind === "person"`이면 `closedGoalId = snapshot?.goalId`를 쓴다(`d.ts:7975-8000`). hook은 항상 `next(e)`를 반환한다. 반환하지 않으면 패널이 닫히지 않는다. 결과: 사람이 닫으면 같은 goal의 `replan`으로는 다시 열리지 않고, 새 goal(`goal start`, 새 `goalId`)에서는 다시 열린다. `/dag`는 언제나 연다. 세션 시작 때는 열지 않는다(요구사항이 "플랜을 세운 뒤"이므로). 폭이 좁을 때 unasked open을 미루는 것은 엔진이 한다(`d.ts:8003-8011`).

**`Svg`가 없는 surface.** `e.surface`가 `desktop`·`mobile`·`vscode`가 아니면 `textRows` 결과를 `Text`로 그린다. 색은 테마 키로 준다: `ok → success`, `run → suggestion`, `ready → warning`, `bad → error`, `dim → dimColor`. 같은 보기 4개와 버튼을 쓴다.

```
wave 2/5 · 1/6 done · 1 running
Wave 1 · 1/1 완료
  ✓ triage-plan  Run planned triage…
Wave 2 · 0/1 완료 · 1 실행 중
  ● heavy-design  Heavy design: DAG 패널 설계  heavy·fable·high  ← triage-plan
```

각 행은 `e.props.bodyColumns` 폭으로 자른다. 문구 locale은 `$.env.get("LC_ALL")`, `"LC_MESSAGES"`, `"LANG"` 순으로 읽고(이름은 리터럴이어야 한다, `d.ts:3881-3890`) 비어 있으면 `Intl`이 있을 때 그 locale, 없으면 `en`이다. CLI와 같은 순서다(`scripts/pota.mjs:108-111`). ko와 en만 둔다.

### 7. 설치 배선

**얇은 플러그인에 추가되는 파일** (`<install>/claude/pota/`).

| 파일 | 출처 |
| --- | --- |
| `hooks/register.tsx`, `hooks/dag-*.mjs` | `runtimeStage/claude-mod/hooks/`를 복사. `hooks.json`만 제외 |
| `hooks/hooks.json` | 기존 `claudeHooks()` 결과에 `modules`를 더한다. 값은 `claude-mod/hooks/hooks.json`에서 읽는다 |
| `types/index.d.ts` | `runtimeStage/claude-mod/types/index.d.ts` 복사 |
| `pota-runtime.json` | `writeLocator(join(pluginDir, "pota-runtime.json"), runtimeRoot)` |
| `.claude-plugin/plugin.json` | 기존 생성 내용 + `"types": "./types/index.d.ts"` |

`tests/`, `tsconfig.json`, `.gitignore`, dev manifest는 넣지 않는다.

**`scripts/pota-lifecycle-claude.mjs` `stageClaudePlugin` 변경.**

1. `claude-mod/.claude-plugin/plugin.json`을 읽어 `name !== pluginName`이면 `throw new Error("Claude mod manifest name must match the plugin name")`. `$.state` 소유 이름이 어긋나는 것을 설치 시점에 막는다.
2. 생성하는 `plugin.json`에 `types`를 추가한다.
3. `claudeHooks()`가 `{ hooks, modules }`를 반환한다.
4. `stageClaudeMod(runtimeStage, pluginDir, runtimeRoot)`를 새로 두어 위 표의 복사와 locator 쓰기를 한다. `cp`의 `filter`로 `hooks.json`을 뺀다.
5. `export const CLAUDE_MOD_ENTRY = "register.tsx"`를 두어 doctor가 쓴다.

**`scripts/pota-lifecycle-staging.mjs` `shouldCopyPluginPath`.** `claude-mod`를 허용 목록에 넣되 `package.json` `files`와 같은 범위만 통과시킨다: `claude-mod`, `claude-mod/.claude-plugin`, `claude-mod/.claude-plugin/plugin.json`, `claude-mod/hooks`와 그 아래, `claude-mod/types`와 그 아래. checkout 설치에서 엔진이 깔아 둔 `claude-mod/.claude-plugin/types/`(약 900KB)와 `tests/`가 runtime에 들어가지 않게 한다. 결과로 `runtime`, `codex-source`, `codex-runtime` 트리에도 `claude-mod/`가 들어간다. Codex는 루트의 `.codex-plugin`·`hooks/hooks.json`만 읽으므로 영향이 없다고 본다(가정, Codex 쪽 테스트로 확인).

**`package.json` `files`.** `"claude-mod/.claude-plugin/plugin.json"`, `"claude-mod/hooks/"`, `"claude-mod/types/"` 3개를 추가한다. `"claude-mod/"`로 통째로 넣지 않는다. `scripts.check`는 바꾸지 않는다(`npm test`가 순수 모듈을 import한다).

**doctor `Claude plugin files`** (`scripts/pota-lifecycle-commands.mjs:339-342`). 기존 조건에 아래를 AND로 붙인다.

```
modExpected = installedVersion === releaseVersion || Array.isArray(hooksJson.modules)
modOk = !modExpected || (
  hooksJson.modules is ["./register.tsx"]
  && manifest.types === "./types/index.d.ts"
  && exists(hooks/register.tsx) && exists(types/index.d.ts)
  && validRuntimeLocator(<plugin>/pota-runtime.json, runtimeRoot))
```

`modExpected`를 두는 이유: doctor는 설치본 버전 기준으로 검사하고(`docs/memory/lifecycle-install.md` 26행), 새 CLI가 mod 없는 옛 설치본을 볼 때 FAIL이 나면 안 된다.

**무결성.** `claude-plugin`은 tree target 하나라 새 파일이 digest에 자동으로 들어간다(`scripts/pota-lifecycle-integrity.mjs:205-217`). target id, `requiredOwnershipTargets`, journal 허용 목록은 그대로다. 기존 설치본의 upgrade는 기록된 digest와 현재 값을 비교하는 기존 경로를 탄다.

**깨질 수 있는 기존 테스트.** 읽어 본 범위에서 기대값이 바뀌어 실패할 테스트는 찾지 못했다. `hooks.json`을 읽는 테스트는 `.hooks` 키만 본다(`test/lifecycle.test.mjs:491-497`, `test/lifecycle-transaction.test.mjs:139-142`). 저장소를 복사하는 fixture는 트리 전체를 복사한다(`test/lifecycle-transaction.test.mjs:1309-1322`). 주의할 곳은 아래다.

| 테스트 | 위험 | 대응 |
| --- | --- | --- |
| `test/packed-install.test.mjs` "packed install remains self-contained…" | `files`에 `claude-mod`가 빠지면 `stageClaudePlugin`이 ENOENT로 실패 | `files` 3개 추가. 이 테스트가 통합 게이트다 |
| `test/lifecycle.test.mjs` "install registers a Claude Code plugin…" (472-530행) | 깨지지 않음. `commands` 부재 단언은 유지 | mod 단언 추가 (8절) |
| `test/lifecycle.test.mjs` "plugin copy filtering…" (270-275행) | 깨지지 않음 | `claude-mod` 허용·제외 단언 추가 |
| `test/lifecycle-transaction.test.mjs` "every runtime locator and Claude hook points at the canonical runtime" (112-137행) | 깨지지 않음 | locator 목록에 `<claude>/pota/pota-runtime.json` 추가 |
| `test/docs-package-hardening.test.mjs` | `install-wiring` write scope 밖이다 | pack 내용 단언은 `test/packed-install.test.mjs`에 둔다 |
| `test/auto-upgrade.test.mjs` | runner용 부분 복사(636-637행)가 claude 단계를 타는지 확인하지 않았다 | worker가 code checkpoint에서 확인 |

### 8. 테스트 계약

**요구사항 (R).** R1 보기 4개가 3절 표대로 노드를 고른다. R2 완료 간선은 실선, 진행 간선은 점선 + 이동 점, 완료되면 실선. R3 `/dag`가 등록되고 연다. R4 `goal start`·`goal replan` 뒤에만 자동으로 연다. R5 goal 명령과 서브에이전트 호출에 따라 상태가 바뀐다. R6 `Svg`가 없는 surface에서도 같은 정보가 글자로 나온다. R7 설치된 얇은 플러그인에 mod가 들어가고 doctor가 본다.

**불변식 (I).**

- I1 `renderDagSvg(...).source.length <= 131072`이고 `alt`는 비어 있지 않다.
- I2 `source`에 `<script`, `on[a-z]+=`, `href=`, `javascript:`, 외부 URL(`xmlns` 값 제외)이 없다.
- I3 같은 입력이면 `source`가 바이트 단위로 같다. `DagAgent[]`만 다른 두 입력의 `source`도 같다.
- I4 모든 box가 `[0, width]` 안에 있고 서로 겹치지 않는다. `row`에서 모든 path는 `x1 < x2`, `column`에서는 `y1 < y2`.
- I5 `computeWaves`는 cycle·없는 id가 있어도 끝나고, 모든 간선에서 `waveOf[from] < waveOf[to]`(무시된 역방향 간선 제외).
- I6 `flow` 간선의 출발 task는 completed다. active가 없으면 `animateMotion`이 없다.
- I7 순수 모듈 5개에 `node:`, `process`, `require(`, `import(`, `Date.now`, `setTimeout`, `Intl`이 없다. `register.tsx`에 `import(`가 없고 상대 import는 `claude-mod/hooks`의 실재 파일(`.ts .tsx .js .mjs`)이나 `../types`만 가리킨다.
- I8 `describeToolCall`의 결과는 40자 이하이고 입력 명령의 4번째 토큰 이후를 담지 않는다.
- I9 `tool.call`·`agent.spawn`·`ui.close`·`turn.complete` hook은 `next(e)`의 결과를 그대로 반환한다(kit 테스트).

**경계 (B).** 전부 완료, 전부 pending, blocked(선행 완료 / 선행 미완료), 병렬 active 4개(다른 wave 포함), task 1개, 다이아몬드와 건너뛰는 간선, 폭 240·380·900, task 400개, 제목이 한글 60자·이모지·`</text><script>`·제어 문자, goal `null`, 종료 뒤 `null`, `--root`의 세 가지 표기.

**실패 모드 (F).** stdout이 JSON이 아님, exit≠0, 실행 거부, CLI 경로 없음, 연속 실패 backoff, agent 연결 모호(연결하지 않음), 사람이 닫은 뒤 `replan`.

**처음에 실패해야 하는 테스트.**

`test/claude-mod.test.mjs` (`mod-panel`):

1. manifest와 `hooks.json` 모양: name `pota`, `types`, `{"modules":["./register.tsx"]}`. 계약 파일에 `PluginState`의 `pota` 키 3개.
2. I7 소스 제약.
3. `computeWaves`: 직선, 다이아몬드, 독립 root, 이 계획의 6개 task → `[[triage-plan],[heavy-design],[mod-panel],[install-wiring,docs],[verify]]`.
4. `computeWaves` cycle·없는 id (I5).
5. `reduceEdges`: `a→b→c`와 `a→c`에서 `a→c` 제거.
6. `taskState`, `focusIds`: 3절의 3단계와 blocked 두 경우.
7. `buildDagModel`: 보기 4개 × 경계 5개의 노드 id·role·`empty`·`hiddenAfter`.
8. 간선 상태 4가지.
9. `summarize`, `formatSummary`: `wave n/m`, `models` 생략 규칙.
10. `layoutDag`: 폭에 따른 `row`/`column` 전환과 I4.
11. `textWidth`, `truncateText`: 한글, surrogate, 결과 폭 ≤ 한도, 짧은 문자열은 그대로.
12. `renderDagSvg` 구조: `<svg`로 시작, 태그 균형, `flow`에 `stroke-dasharray`와 `animateMotion`, `done`에는 없음, 전부 완료면 `animateMotion` 없음 (R2, I6).
13. escape와 I2.
14. 결정성과 위상: I3, `epoch`만 바꾸면 `begin`·`animation-delay` 값만 달라짐.
15. 한도: task 400개에서 I1, `density >= 1`, `omitted` 보고. 30개는 density 0.
16. `textRows`: 행 폭 ≤ columns, wave 머리말, 보기 필터 (R6).
17. `parsePotaGoalCommand`: 양성 4종, 음성(`git status`, `pota memory check`, `npm run goal`), 읽기 전용 하위 명령은 `mutates: false`, `planned`는 `start`·`replan`만, `--root` 세 표기.
18. `extractTaskMentions`, `resolveAgentTasks`: 5단계 각각과 모호한 경우.
19. `describeToolCall` (I8).
20. `parseGoalStatus`: `null`, 깨진 JSON, 모르는 필드, receipt → `evidence`.
21. `reduceDagState`: 내용이 같으면 `seq` 유지, timeline 전이 기록, 종료 3가지(`completed`면 task 전부 완료 처리).
22. `shouldAutoOpen`: 새 goal, 같은 planKey, 바뀐 replan, 닫은 goal, 닫은 뒤 새 goal, snapshot 없음.
23. `nextRefreshDelay`: 300ms 하한, 1000ms 간격, 실패 3회 뒤 poll 120초, goal 명령은 backoff 무시.

`claude-mod/tests/pane.test.tsx` (로컬, `claude plugin test claude-mod`): `process.run`을 고정 JSON으로 답하게 하고 (a) desktop에서 `Svg`가, terminal에서 `Text` 행이 나온다, (b) `goal start`가 든 Bash `tool.call` 뒤 `ui.open`이 1회 불리고 같은 명령을 다시 보내면 불리지 않는다, (c) `ui.close`(origin person) 뒤 `goal replan`에는 열리지 않는다, (d) `tool.call`의 반환값이 아래 hook의 답과 같다 (I9).

lifecycle 추가분 (`install-wiring`):

1. `test/lifecycle.test.mjs` "install registers…": 얇은 플러그인 `hooks.json`의 `modules`가 `["./register.tsx"]`이고 `hooks` 5개 이벤트가 그대로다. `hooks/register.tsx`, `hooks/dag-model.mjs`, `types/index.d.ts`가 있다. `plugin.json`의 `types`. `pota-runtime.json`의 `entrypoints.cli`가 canonical runtime을 가리킨다. `tests/`, `tsconfig.json`은 없다. 캐시 사본(`installPath`)에도 `register.tsx`가 있다.
2. 같은 파일: `register.tsx`의 상대 import가 설치된 `hooks/` 안에서 모두 해석된다.
3. 같은 파일: doctor가 `OK Claude plugin files`. `hooks/register.tsx`를 지우면 `FAIL Claude plugin files`(이때 `ownership digests`도 FAIL).
4. "plugin copy filtering…": `claude-mod/hooks/register.tsx` true, `claude-mod/.claude-plugin/types/claude-code/index.d.ts` false, `claude-mod/tests/pane.test.tsx` false.
5. `test/lifecycle-transaction.test.mjs` locator 목록에 `<claude>/pota/pota-runtime.json`.
6. `test/packed-install.test.mjs`: 설치된 npm 패키지에 `claude-mod/hooks/register.tsx`, `claude-mod/types/index.d.ts`, `claude-mod/.claude-plugin/plugin.json`이 있고 `claude-mod/tests`는 없다. 패키지 소스를 지운 뒤에도 `<POTA_HOME>/install/claude/pota/hooks/register.tsx`가 있다.

### 9. 위험과 미확인 사항

실제 패널이나 `claude plugin validate`로만 알 수 있는 것이다. `verify` task에서 확인하고, 틀렸을 때의 대응을 함께 적는다.

| # | 가정 | 확인 방법 | 틀렸을 때 |
| --- | --- | --- | --- |
| 1 | `hooks`와 `modules`가 한 `hooks.json`에서 함께 로드되고, 모듈 로드 실패가 command hook을 막지 않는다 | 임시 HOME 설치본에 `claude plugin validate`, 실제 세션에서 SessionStart hook 출력과 패널을 함께 확인 | 2절의 `hooks/mod.json` 대안 |
| 2 | `modules`·`types` 키를 모르는 옛 Claude Code가 이 파일을 거부하지 않는다 (`validate --strict` 도움말은 런타임이 모르는 필드를 허용한다고 적는다) | 확인 수단 없음 | README에 최소 버전을 적는다(`docs` task). 2.1.325에서 쓴 선언 기준 |
| 3 | 설치된 플러그인 폴더에 엔진이 `.claude-plugin/types/`를 쓰지 않는다 (`ref:50-53`) | 실제 로드 뒤 `pota doctor`의 `ownership digests`가 OK인지 | 쓴다면 digest가 깨져 upgrade가 거부된다. `targetDigest`에서 `claude-plugin`의 그 폴더를 제외하는 변경이 필요하고 계획에 기록해야 한다 |
| 4 | `Svg`의 `source`가 같으면 frame이 다시 로드되지 않고, 바뀔 때의 교체가 눈에 거슬리지 않는다 | 패널에서 하단 목록만 바뀔 때와 분이 바뀔 때 관찰 | 카드 2줄의 경과 시간을 빼고 하단 목록에만 둔다(`cardLines` 한 곳) |
| 5 | frame 배경이 투명하고 `prefers-color-scheme`이 앱 테마를 따른다 | 밝은·어두운 테마에서 각각 확인 | 카드가 불투명이라 읽을 수는 있다. 어긋남이 크면 `/dag light\|dark` 강제 옵션을 후속으로 |
| 6 | sandbox frame에서 `animateMotion`의 `path` 속성, 음수 `begin`, CSS `animation-delay`가 동작한다 | 패널에서 점 이동과 리로드 뒤 이어짐 확인 | CSS `offset-path` 애니메이션으로 바꾼다 |
| 7 | cell 1개가 약 8px이다 | 패널 폭과 SVG 폭 비교 | `panelWidth`의 계수만 고친다. 틀려도 SVG는 slot에 맞춰 줄어든다 |
| 8 | desktop이 호스트하는 세션에서 `$.process.run`이 `node`를 PATH로 찾는다 (`d.ts:3765-3768`은 "CLI only"라고만 적는다) | 패널에 "상태 갱신 실패"가 뜨는지 | locator에서 node 경로를 얻을 방법이 없으므로 계획에 blocker로 올린다. 기존 command hook도 `node`를 PATH로 부른다 |
| 9 | `$.command.register`로 만든 `/dag`가 데스크탑 입력창에서 실행된다 | 데스크탑에서 `/dag` 입력 | 자동 열림과 버튼은 그대로 동작한다. 명령이 안 되면 사용자 요구 미충족이므로 계획에 기록 |
| 10 | `register.tsx`가 `.mjs`를 import해도 `claude plugin validate`가 타입 오류를 내지 않는다 | `claude plugin validate claude-mod` (`mod-panel`의 surfaceIntegration) | `.mjs` 옆에 `.d.mts` 선언 파일을 둔다 |
| 11 | dev-mods에 이름이 `pota`인 사본을 올려도 설치된 `pota@pota`(1.0.0, mod 없음)와 충돌하지 않는다 | `verify`에서 로드 메시지 확인 | 사본에서만 이름을 바꾼다: `plugin.json`의 name, `types/index.d.ts`의 키, `register.tsx` 상단 ref 3개 |
| 12 | Claude 플러그인 캐시는 버전이 달라질 때만 갱신된다 | 기존 동작 (`scripts/pota-lifecycle-claude.mjs:136-137`) | 같은 버전으로 다시 설치해 시험할 때는 `claude plugin update pota@pota --scope user`를 직접 실행해야 한다. 버전 올림은 범위 밖 |
| 13 | agent↔task 연결의 3·4단계는 휴리스틱이다 | 병렬 dispatch에서 하단 목록 확인 | 틀리게 잇지 않도록 모호하면 "기타 에이전트"로 둔다. 정확도를 올리려면 `goal assign --agent`에 엔진 `agentId`를 쓰도록 위임 문서를 바꿔야 하는데 이 계획의 범위 밖이다 |

**증거 요구사항.**

- `mod-panel`: `node --test test/claude-mod.test.mjs` 통과, `claude plugin validate claude-mod` exit 0. validate 출력에서 hook 목록(`session.start`, `command.run`의 "answers its own command: dag", `tool.call`·`agent.spawn`의 "gating hook with .catch", `turn.complete`, `ui.close`, `ui.render`)과 state 키 3개를 보고에 붙인다.
- `install-wiring`: 계획의 두 명령 통과. 임시 HOME 설치본 `<POTA_HOME>/install/claude/pota`에 `claude plugin validate` exit 0.
- `verify`: `claude plugin test claude-mod` 통과(계획의 검증 명령에 추가 권장), 위 표 1·3·4·5·6·8·9·11의 관찰 결과를 계획 Evidence에 한 줄씩.

**main이 정해야 하는 것.** 3절의 "좁은 패널에서는 점이 위→아래로 이동"을 받아들일지. 받아들이지 않으면 좁은 폭에서 "전체 보기"를 포기하고 보이는 wave 수를 폭에 맞춰 자르는 설계로 바꿔야 한다.

### Critical Files for Implementation

- `/Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-claude.mjs`
- `/Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-staging.mjs`
- `/Users/wknam/workspace/pota-harness/scripts/pota-lifecycle-commands.mjs`
- `/Users/wknam/workspace/pota-harness/package.json`
- `/Users/wknam/workspace/pota-harness/test/lifecycle.test.mjs`
- 새로 만들 파일: `/Users/wknam/workspace/pota-harness/claude-mod/hooks/register.tsx`, `/Users/wknam/workspace/pota-harness/claude-mod/hooks/dag-model.mjs`, `/Users/wknam/workspace/pota-harness/test/claude-mod.test.mjs`
- API 근거: `/private/tmp/claude-501/bundled-skills/2.1.325/92a647dd8da53b7ed87cf2953d2b3a97/plugin-authoring/types/claude-code.d.ts`, 같은 폴더 `reference.md`
- 공존 근거: `/Users/wknam/.claude/plugins/marketplaces/claude-plugins-official/plugins/code-modernization/hooks/hooks.json`

### Main review (pre-implementation)

- 설계를 그대로 채택한다. 검토자: main session (`claude-fable-5-2`), 2026-11-18.
- 좁은 패널의 `column` 배치(점이 위에서 아래로 이동)를 받아들인다. Pane에 가로 스크롤이 없어 전체 보기를 가로로 유지할 수 없기 때문이다. 폭이 충분하면 `row` 배치로 왼쪽에서 오른쪽으로 이동한다. 사용자에게 최종 보고에서 알린다.
- `verify` task의 검증에 `claude plugin test claude-mod`를 추가한다(로컬 전용).
- 9절의 가정 1·3·4·5·6·8·9·11은 `verify`에서 실제 패널로 확인하고 Evidence에 기록한다.
- Code checkpoint는 각 worker가 첫 수정 직전에 수행하고 최종 보고에 적는다.

### Post-design changes (실제 패널 확인 뒤, main inline)

사용자가 이 세션의 dev-mods 사본으로 패널을 직접 확인하며 요청한 수정이다. 범위가 작아 main이 직접 고쳤다.

- `isInteractive` 제거: Claude Code Desktop 2.1.326에서 `isInteractive` Svg는 내용과 무관하게 빈 상자로 나왔다(진단 pane에서 9개 변형 모두 interactive는 빈 칸, image는 정상). 이미지 방식으로 그린다. 카드 `<title>` tooltip과 hover 강조는 쓰이지 않는다. 9절 #4·#6의 가정 중 sandbox frame 부분은 해당 없음이 됐다.
- locale: 데스크탑 앱에 `LANG`이 없어 영어로 나왔다. env가 비면 `defaults read -g AppleLocale`을 먼저 본다.
- `/dag`는 `$.ui.panes()`의 `isPlaced`를 믿지 않고 매번 `$.ui.open`을 부른다. 앱이 패널을 숨긴 뒤 `/dag`가 "열었습니다"만 답하고 열리지 않은 일이 있었다. kit 테스트의 open 횟수 기대값을 2에서 3으로 바꿨다(계약 변경).
- `column` 배치: 한 줄의 카드가 띠 폭을 나눠 쓴다(최대 440px). 카드가 1개인 wave는 제목이 잘리지 않는다. tooltip이 없어진 것을 보완한다.
- 새로고침 버튼: label을 `↻`로 줄이고 hotkey 표시를 뺐다. 버튼 5개가 dock 폭에서 한 줄에 들어간다.
- 보기 버튼의 숫자 hotkey(`1`~`4`)를 뺐다(사용자 요청). 약 290px 폭에서 버튼이 두 줄로 넘어갔기 때문이다. 5절 표의 hotkey 항목은 이 변경으로 대체된다.
- 하단 목록 보강(사용자 요청): 실행 중 task 아래에 아직 없는 증거 kind 이름을 적고, `준비됨: id` 한 줄을 "다음 차례" 목록(제목과 기다리는 선행 task, 최대 5개)으로 바꿨다.
- `$.ui.open`에 `columns: 56`을 요청한다(사용자 요청). 요청일 뿐이라 surface가 무시할 수 있고 사용자가 드래그한 폭이 우선한다. Claude Code Desktop 2.1.326에서는 폭이 바뀌지 않았다(사용자 확인).
- `node "$P" goal start`처럼 CLI 경로가 셸 변수에 있는 goal 명령도 감지한다. 실제 세션에서 자동 열림이 동작하지 않은 원인이었다. 고친 뒤 임시 저장소의 `goal start`로 자동 열림을 확인했다(사용자 확인).

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | heavy | main session | inherited (main inline) |
| `heavy-design` | general-purpose (read-only) | heavy | `fable` | `high` |
| `mod-panel` | worker | heavy | `opus` | `high` |
| `install-wiring` | worker | heavy | `opus` | `high` |
| `docs` | worker | light | `sonnet` | `medium` |
| `verify` | main | heavy | main session | inherited (main inline, waiver 기록) |

- 위임 규칙: 모든 worker는 `MEMORY.md`를 읽고, 범위를 지키고, 다른 작업자의 수정을 되돌리지 않고, host task-list 도구를 호출하지 않으며, 최종 보고에 자기 시스템 프롬프트의 정확한 모델 ID를 적는다(없으면 `unreported`). 완료된 subagent의 보고와 증거는 main이 검토한 뒤 task를 완료한다.

## Tool Readiness

- Detected stack: javascript (Node, npm, lockfile 없음).
- Toolcheck command: `pota toolcheck --root <repoRoot>` → `OK node`, `OK npm`.
- Required typecheck/lint/verification tools: `node --test`, `npm run check`, `claude plugin validate`(로컬 전용).
- Missing tools: 없음. `tsc`는 저장소 의존성이 아니므로 설치하지 않고, mod 타입 확인은 `claude plugin validate`로 한다.
- Install approval: not needed.

## Execution Guardrails

- Test contract first: 순수 로직(wave 계산, 보기 필터, SVG 생성)은 `.mjs`로 두고 `node --test`로 검증한다. `register.tsx`는 얇게 유지한다.
- 기존 테스트·fixture는 약화하거나 지우지 않는다. 얇은 플러그인의 내용이 늘어나 기존 기대값이 달라지면 계약 변경으로 이 계획에 기록한 뒤 고친다.
- Verification ladder: task별 focused test, 마지막에 `npm run check` 1회, 이어서 `npm pack --dry-run`.
- 외부 상태 변경 없음: 실제 `~/.pota`, `~/.claude` 설치본에는 쓰지 않는다. lifecycle 테스트는 임시 HOME으로 격리한다. 실제 패널 확인은 이 세션의 dev-mods 폴더에 복사해서 한다.
- Verification loop budget: task당 2회.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Requested model: main session / Effective model: `fable (claude-fable-5-2)` main inline
- Requested reasoning effort: inherited / Effective: inherited (main inline)
- Required evidence records: `planArtifact`, `triageDecision`.

### Task 1: Heavy design

- Task ID: `heavy-design` (`kind: "design"`, `route: "heavy"`)
- Requested model: `fable` / Effective model:
- Requested reasoning effort: `high` / Effective reasoning effort:
- Contract: 읽기 전용. 아래 "Heavy Design" 절에 들어갈 설계를 반환한다.
  - 파일 배치(`claude-mod/` 안의 파일과 각 책임), 순수 모듈의 함수 시그니처.
  - goal 상태 수집 방법과 갱신 시점(어떤 `tool.call`에 반응하는지, 과도한 호출을 막는 방법).
  - wave 계산, 보기 4개의 정의, 좁은 패널에서의 배치.
  - SVG 시각 설계: 노드 카드, 간선(실선·점선·이동 점), 색(밝은·어두운 테마), 애니메이션 끊김 처리.
  - 함께 표시할 정보의 선정과 배치.
  - `/dag` 명령, 자동 열림 조건, goal이 없을 때의 화면.
  - 설치 배선: 얇은 플러그인에 넣는 파일, `hooks.json` `modules`, runtime 경로 전달, `plugin.json` `types`.
  - 테스트 계약: 요구사항, 불변식, 경계, 실패 모드.
- Depends on: `triage-plan`
- Write scope: 없음 (main이 결과를 이 파일에 병합).
- Required evidence records: `designRecord` — `grep -q "^## Heavy Design" docs/plan/claude-dag-panel.md`, watch `docs/plan/claude-dag-panel.md`.

### Task 2: mod 패널 구현

- Task ID: `mod-panel` (`route: "heavy"`)
- Requested model: `opus` / Effective model:
- Requested reasoning effort: `high` / Effective reasoning effort:
- Contract: "Heavy Design"대로 `claude-mod/`에 mod를 구현하고 순수 로직 테스트를 쓴다.
- Files: `claude-mod/**`, `test/claude-mod.test.mjs`
- Depends on: `heavy-design`
- Write scope: `claude-mod`, `test/claude-mod.test.mjs`
- Handoff files: `claude-mod/` 파일 목록(설계에 고정).
- Module acceptance verification: `node --test test/claude-mod.test.mjs`
- Surface integration verification: `claude plugin validate claude-mod`
- Tests: `node --test test/claude-mod.test.mjs`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: 설치 배선

- Task ID: `install-wiring` (`route: "heavy"`)
- Requested model: `opus` / Effective model:
- Requested reasoning effort: `high` / Effective reasoning effort:
- Contract: `pota install`·`upgrade`가 만드는 얇은 Claude 플러그인에 mod가 들어가고, npm 패키지에 `claude-mod/`가 포함된다. doctor의 `Claude plugin files` 검사가 mod 파일을 포함한다.
- Files: `scripts/pota-lifecycle-claude.mjs`와 필요한 lifecycle 스크립트, `package.json`, lifecycle 관련 테스트.
- Depends on: `mod-panel`
- Write scope: `scripts`, `package.json`, `test/lifecycle.test.mjs`, `test/lifecycle-transaction.test.mjs`, `test/lifecycle-hardening.test.mjs`, `test/installed-plugin.test.mjs`, `test/packed-install.test.mjs`
- Module acceptance verification: `node --test test/lifecycle.test.mjs test/lifecycle-transaction.test.mjs test/lifecycle-hardening.test.mjs test/installed-plugin.test.mjs`
- Surface integration verification: `node --test test/packed-install.test.mjs test/docs-package-hardening.test.mjs`
- Tests: 위 두 명령.
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 4: 문서

- Task ID: `docs` (`route: "light"`)
- Requested model: `sonnet` / Effective model:
- Requested reasoning effort: `medium` / Effective reasoning effort:
- Contract: README 8개 locale에 DAG 패널(`/dag`, 자동 열림, Claude Code 데스크탑 전용)을 같은 위치에 짧게 추가하고, `docs/memory/lifecycle-install.md`에 얇은 플러그인의 mod 구성을 기록한다.
- Files: `README.md`, `README.*.md`, `docs/memory/lifecycle-install.md`
- Depends on: `mod-panel`
- Write scope: `README.md`, `README.de.md`, `README.es.md`, `README.fr.md`, `README.ja.md`, `README.ko.md`, `README.pt.md`, `README.zh.md`, `docs/memory/lifecycle-install.md`
- Module acceptance verification: `node --test test/docs-package-hardening.test.mjs test/token-efficiency.test.mjs`
- Surface integration verification: `node scripts/pota.mjs memory check --root .`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`.

### Task 5: 검증과 리뷰

- Task ID: `verify` (`route: "heavy"`)
- Requested model: main session / Requested reasoning effort: inherited (main inline, `--allow-inherited-effort` 사유 기록)
- Contract: 전체 검사, 임시 HOME 설치본의 `claude plugin validate`, 이 세션 dev-mods 폴더에서 실제 패널 동작 확인, diff 리뷰.
- Depends on: `install-wiring`, `docs`
- Module acceptance verification: `npm run check`
- Surface integration verification: `claude plugin validate claude-mod`
- Goal final review: `goal finish -- npm pack --dry-run`
- Required evidence records: `moduleAcceptance`, `surfaceIntegration`, goal `finalReview`.

## Evidence

- Tool readiness: `pota toolcheck` → `OK node`, `OK npm`.
- Tests: `node --test test/claude-mod.test.mjs` 24개 통과. `claude plugin test claude-mod` 5개 통과(로컬 전용). `npm run check` exit 0.
- Module acceptance: `mod-panel` `node --test test/claude-mod.test.mjs`, `install-wiring` lifecycle 4개 파일, `docs` docs-package·token-efficiency, `verify` `npm run check`. 모두 `goal verify`로 기록.
- Surface integration: `mod-panel`·`verify` `claude plugin validate claude-mod`, `install-wiring` packed-install·docs-package, `docs` `pota memory check`. 임시 HOME 설치본 `<POTA_HOME>/install/claude/pota`의 `claude plugin validate`도 exit 0(worker 보고).
- 실제 패널 확인(이 세션의 dev-mods 사본, Claude Code Desktop 2.1.326, 사용자 확인):
  - 9절 #1: 설치본 validate에서 command hook 5개와 `modules`가 함께 인식됨. 실제 설치본 세션 로드는 미확인(설치본을 건드리지 않았다).
  - #3: validate 뒤 doctor `ownership digests` OK(worker 보고). 엔진이 설치 폴더에 types를 쓰는지는 실제 로드로 확인하지 못함.
  - #4·#6: `isInteractive` Svg는 빈 상자. 이미지 방식에서 점 이동과 점선 흐름 동작(사용자 확인).
  - #5: 밝은·어두운 테마 모두 읽힘(사용자 확인).
  - #8: `$.process.run`의 `node` 실행 동작(요약과 task 상태가 실제와 일치).
  - #9: `/dag`가 데스크탑 입력창에서 동작.
  - #11: 이름이 `pota`인 dev 사본이 설치된 `pota@pota` 1.0.0과 충돌 없이 로드됨.
  - 자동 열림(`goal start`·`goal replan`)은 kit 테스트로만 확인했다. 패널이 이미 열려 있어 실제 세션에서는 시험하지 못했다.
- Agent 기록: `heavy-design` fable (`claude-fable-5-2`)/high, `mod-panel`·`install-wiring` opus (`claude-opus-5-5`)/high, `docs` sonnet (`claude-sonnet-5-5`)/medium. 모두 host option으로 전달.
- Goal final review evidence record: `goal finish -- npm pack --dry-run`.
- Memory promotion: docs/memory/lifecycle-install.md
- Verification pass count: task마다 1회.

## Status

- [x] Planned
- [x] Implemented
- [x] Module acceptance passed
- [x] Surface integration passed
- [x] Reviewed
- [x] Goal completed
