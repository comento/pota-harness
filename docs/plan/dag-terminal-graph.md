# Plan: DAG 패널 터미널 그래프와 worktree 대응

## Plan Phase

- Initial: decision-complete for `triage-plan`; not implementation-ready. (2026-11-18 작성)
- Finalized: decision-complete for implementation after planned triage. 세부 설계는 `heavy-design` task가 `## Heavy Design`에 채운다. (2026-11-18)
- Codex UI synchronization: 이 CLI 세션에는 `update_plan`·`create_goal`이 없다. 저장소 goal만 쓴다.

## Goal

Claude Code CLI(터미널)의 DAG 패널이 텍스트 목록이 아니라 박스 문자로 wave 열과 간선을 그린 그래프를 보여 준다. 화면에서 확인된 문구·목록 문제를 고치고, git worktree에서 패널이 틀린 goal을 보이거나 비는 경우를 찾아 모두 고친다.

- Goal ID: `goal-9f822a7f-feb3-442e-96cf-336b29e511a7`
- Plan ID: `docs/plan/dag-terminal-graph.md`
- Runtime resources: 설치된 Pota 버전이 해석하는 `pota://` 리소스.
- Completion criteria (advisory): 터미널 pane에 박스 문자 그래프가 나오고, worktree 시나리오 테스트가 통과하며, `npm run check`가 통과한다.
- Required goal evidence: `finalReview`
- Terminal state: `completed`, `paused`, `blocked`, `cancelled`.

## Whole Work

- Outcome: `claude-mod`의 터미널 surface 렌더링 개선과 worktree 대응.
- 사용자 요구사항(2026-11-18 대화):
  - 박스 문자로 wave 열과 간선까지 그린다("박스 문자까지 다 해야지").
  - worktree에서 발생할 수 있는 문제까지 모두 수정한다.
  - 터미널 화면(사용자 스크린샷)에서 확인된 문제: 둘째 줄 `1/5 done · 2 running`은 영어인데 wave 줄은 한국어다. "현재" 보기의 `Wave 2 · 0/3 완료`는 행이 2개뿐이라 하나가 빠진 것처럼 읽힌다. 의존 관계가 `← triage` 표기뿐이다.
- Anticipated surfaces: `claude-mod/hooks/dag-text.mjs`, `claude-mod/hooks/register.tsx`, `claude-mod/hooks/dag-model.*`(있다면), `claude-mod/tests/`, `test/`의 mod 관련 테스트, 필요하면 `scripts/pota-paths.mjs` 주변과 README.
- Out of scope: 버전 올림과 릴리스, 데스크탑 SVG 그래프의 모양 변경, Codex·Antigravity 화면.

## Triage Findings

조사한 파일: `claude-mod/hooks/register.tsx`, `dag-text.mjs`, `dag-events.mjs`, `dag-model.d.mts`, `dag-layout.mjs`(앞부분), `scripts/pota-paths.mjs`, `test/claude-mod.test.mjs`(테스트 목록·소스 제약), mod API 선언(`claude-code.d.ts`, Claude Code 2.1.326).

### 터미널 그래프

- 터미널 surface에는 `Svg`가 없다. `register.tsx:448`이 desktop·mobile·vscode만 SVG로 그리고, 터미널은 `textRows`(`dag-text.mjs:312`)의 줄 목록을 쓴다.
- 터미널에서 쓸 수 있는 것은 `Box`·`Text`와 `e.props.bodyColumns`다. `Row`는 줄 하나에 tone 하나라서, 한 줄에 색이 다른 박스 둘을 놓으려면 줄 안의 구간(span) 표현이 필요하다.
- 전각 폭 계산은 이미 있다: `cellWidth`·`truncateCells`(`dag-text.mjs:277-300`), `isWide`(`dag-layout.mjs`).
- pane 폭 요청은 56컬럼(`PANE_COLUMNS`)이고 사용자가 바꿀 수 있다. 사용자 화면은 약 58컬럼이었다.
- 화면에서 확인된 문구 문제: `formatSummary`(`dag-text.mjs:125-134`)가 locale과 무관하게 `done`·`running`·`blocked`·`model(s)`를 영어로 쓴다. `waveHeader`는 wave 전체 수(`0/3`)를 쓰는데 "현재" 보기는 focus 노드만 그려 행 수와 맞지 않는다.
- 시각 기준(사용자 지정, 2026-11-18): `https://github.com/jc01rho/omo-herdr-dag`의 `docs/screenshots/workflow-in-progress.png`. 다른 제품이지만 박스 형태를 참고한다. 가져올 것: 테두리 있는 노드 박스(1줄 id/제목, 2줄 상태 글리프+상태, 3줄 역할 또는 `← 선행`), 폭이 되면 같은 wave의 박스를 나란히 놓고 안 되면 세로로 쌓기, wave 사이의 `│`·`▼` 연결, 그래프 아래의 `의존 관계` 목록(`a → b`). 코드는 가져오지 않는다.
- 사용자 요구(2026-11-18 이전 대화): 완료 간선은 실선, 진행 중 간선은 점선과 움직이는 점. 터미널 pane은 초당 30회까지 다시 그릴 수 있다(`d.ts:2686`).

### worktree

근거: `$.session.root()`는 세션의 project root이고 `/cd`·호스트의 디렉터리 변경·worktree 이동을 따라간다. 셸 `cd`는 따라가지 않는다(`d.ts:3248-3254`). `$.session.cwd()`를 hook 안에서 읽으면 그 hook의 디렉터리(서브에이전트의 worktree)다(`d.ts:3241-3246`). Pota goal 상태는 `repositoryId/worktreeId`별로 따로 있다(`pota-paths.mjs:24-34`). `--root`가 없으면 CLI는 `HARNESS_REPO_ROOT`, 그다음 cwd의 가장 가까운 `.git` 조상을 쓴다(`pota-paths.mjs:98-112`).

| # | 문제 | 근거 |
| --- | --- | --- |
| W1 | 한 번 읽은 root가 굳는다. `observedRoot ?? prev.root ?? $.session.root()`라서 `prev.root`가 생긴 뒤로는 세션 root를 다시 묻지 않는다. EnterWorktree·ExitWorktree·`/cd` 뒤에도 예전 worktree의 goal을 보여 준다. | `register.tsx:206,210` |
| W2 | 절대 `--root`를 한 번 본 뒤 `--root` 없는 goal 명령이 오면 `observedRoot`는 null이 되지만 `prev.root`에 예전 값이 남아 계속 그 root를 읽는다. 주석("an earlier root does not stick")과 동작이 다르다. | `register.tsx:344-345,206` |
| W3 | worktree가 지워진 뒤(ExitWorktree remove)에는 `cwd: root`의 `goal status`가 계속 실패해 "상태 갱신 실패"에 머문다. W1 때문에 복구되지 않는다. | `register.tsx:117,206` |
| W4 | goal 명령이 실제로 실행된 디렉터리를 모른다. 서브에이전트가 worktree(`isolation: "worktree"`)에서 `--root` 없이 실행했거나, 명령이 `cd <dir> &&`로 시작했거나, `--root`가 상대 경로면 세션 root를 읽어 다른 worktree의 상태를 보거나 아무것도 못 본다. | `register.tsx:345`, `dag-events.mjs:12,29-31` |
| W5 | `planned`(자동 열림)가 root와 묶여 있지 않다. 다른 worktree에서 실행된 `goal start`가 세션 root의 goal로 패널을 연다. | `register.tsx:346,216-221` |
| W6 | root가 바뀌어도 이전 goal의 `snapshot`·`timeline`·`ended`가 이어진다. 새 root에 goal이 없으면 이전 goal이 "종료됨"으로 표시된다. | `dag-events.mjs:256-271` |
| W7 | 패널이 어느 worktree의 goal을 보여 주는지 표시가 없다. | `register.tsx:472-481` |

설계가 답할 질문: 패널이 따라갈 root의 규칙(세션 root 기준, 관찰한 goal 명령의 root를 따라가는 조건과 되돌아오는 조건), 경로 비교 방법(순수 모듈에는 `node:`가 없다), root 전환 때 상태 초기화, 표시 문구.

## Heavy Design

`d.ts`는 `/private/tmp/claude-501/bundled-skills/2.1.326/8933bb75ea073a094e7255a61de368ec/plugin-authoring/types/claude-code.d.ts`다.

### 확인한 사실

- 터미널 element 표는 `Box, Text, Button, Input, Select, Link, Code, Markdown, Progress, Client, Raster, Image`이고 `Svg`가 없다(`d.ts:4567-4594`).
- `Text`는 문자열과 inline element를 자식으로 가진다(`d.ts:15556-15560`). `size`·`weight` 설명이 "Absent, the enclosing Text's"라서 `Text` 안의 `Text`를 전제한다(`d.ts:15915,15922`). `wrap="truncate-end"`가 있다(`d.ts:15966`).
- `Pane` props에는 `bodyColumns`(`d.ts:13009`)와 `scroll.bodyRows`(`d.ts:13042-13046`)가 있다. 넘치면 pane이 스크롤하므로 행 수는 설계에 쓰지 않는다.
- redraw 한도는 초당 10회, 터미널의 보이는 pane은 30회다(`d.ts:2686`). `$.state` 쓰기는 그 값을 읽은 site를 다시 그린다(`d.ts:4049-4050,4820`). `$.ui.invalidate("ui.render")`도 다시 그린다(`d.ts:2682-2684`).
- `$.session.cwd()`: hook보다 오래 사는 timer는 세션 디렉터리를 읽으므로, hook의 값(서브에이전트 자신의 것)이 필요하면 hook 안에서 읽어 둔다(`d.ts:3241-3246`).
- `$.session.root()`는 `/cd`, 호스트의 디렉터리 변경, worktree 이동을 따라가고 셸 `cd`는 따라가지 않는다(`d.ts:3247-3254`).
- Bash의 `tool.call` 입력은 `command, timeout, description, run_in_background, dangerouslyDisableSandbox`뿐이고 cwd가 없다(`d.ts:20877-20888`). 서브에이전트 호출에는 `agentId`가 붙는다(`d.ts:396-406`).
- 세션 root 변경을 알리는 engine event는 없다. `session.*` event는 start, receive, append, send, compact, attach, detach, measure, stop, end뿐이다(`d.ts:5212-5325`). classic `CwdChanged`는 있으나(`d.ts:4385-4389`) 언제 발생하는지 문서에 없어 쓰지 않는다.
- CLI의 root 결정 순서는 `--root`(cwd 기준 resolve), `HARNESS_REPO_ROOT`, cwd에서 가장 가까운 `.git` 조상, cwd다(`scripts/pota-paths.mjs:98-112`).
- `package.json:32`가 `claude-mod/hooks/` 디렉터리 전체를 배포하므로 새 모듈에 목록 수정이 필요 없다.

### A. 터미널 그래프 (`claude-mod/hooks/dag-term.mjs`, `dag-term.d.mts`)

#### A1. 자료 구조와 시그니처

```ts
// dag-term.d.mts
import type { DagModel } from "./dag-model.mjs";
import type { TextContext, Tone } from "./dag-text.mjs";
export type TermSpan = { text: string; tone: Tone; bold?: boolean };
export type TermRow = TermSpan[];                       // one terminal line; [] is a blank line
export type TermGraph = { mode: "boxes" | "list"; rows: TermRow[] };
export declare const BOX_MIN_W: 24;
export declare const BOX_MAX_W: 40;
export declare const BOX_GAP: 2;
export declare const EDGE_ROWS_MAX: 12;
export declare function termBoxLayout(columns: number, widestWave: number): { per: number; boxWidth: number } | null;
export declare function hasFlowEdge(model: DagModel): boolean;
export declare function termGraph(model: DagModel, ctx: TextContext, options: { columns: number; phase: number | null }): TermGraph;
```

행 불변식:
- 한 행의 span `cellWidth` 합은 `columns` 이하다.
- 빈 text span은 없다.
- tone과 bold가 같은 이웃 span은 합친다.
- 같은 입력은 같은 출력을 낸다.

import는 `./dag-text.mjs`만 쓴다(`cellWidth, truncateCells, messages, cardLines, roleLine, waveHeader, textRows, STATE_GLYPH, STATE_TONE`).

`dag-text.mjs` 변경:
- 지금 private인 `GLYPH`·`TONE`을 `STATE_GLYPH`·`STATE_TONE`으로 export한다.
- `waveHeader(wave, locale, shown?)`에 셋째 인자를 추가한다.
- `formatSummary`를 locale에 맞춘다(A6).
- `messages`에 `summaryModels`, `waveShown`, `dependencies`, `otherRoot`를 추가한다.
- `textRows`는 그대로 두고 `waveHeader`에 표시 노드 수만 넘긴다.

배선: 행 하나는 `<Text wrap="truncate-end">{spans.map(s => <Text bold={s.bold === true} {...toneProps(s.tone)}>{s.text}</Text>)}</Text>`로 그린다. 빈 행은 `<Text> </Text>`다. 줄 전체가 한 문자열로 측정되어 박스 사이 공백이 잘리지 않고, 폭 계산이 Ink와 어긋나도 줄바꿈이 아니라 `…`로 잘린다.

#### A2. 배치 규칙

- `columns`는 `Math.floor`한다. 유한하지 않으면 80으로 본다(`textRows`와 같다).
- `perMax = max(1, floor((columns + 2) / 26))`, `per = min(perMax, 보이는 wave 중 최대 노드 수)`, `boxWidth = min(40, floor((columns - 2*(per-1)) / per))`.
- 그래프 안의 모든 박스는 같은 폭이고 왼쪽 정렬이다.

| columns | 가장 넓은 wave | per | boxWidth |
| --- | --- | --- | --- |
| 56 | 1 | 1 | 40 |
| 56 | 2, 3, 5+ | 2 | 27 |
| 58 | 3 | 2 | 28 |
| 80 | 5 | 3 | 25 |
| 50 | 2 | 2 | 24 |
| 49 | 2 | 1 | 40 |
| 24 | 임의 | 1 | 24 |
| 23 이하 | 임의 | 없음(null) | 목록 대체 |

- wave의 노드는 `per`개씩 끊어 줄을 만든다. 마지막 줄은 왼쪽부터 채운다. 56컬럼에서 3개면 2+1, 5개면 2+2+1이다.
- 박스는 5행이다: `╭─…─╮`, 내용 3줄 `│ <내용을 iw칸으로 채움> │`(`iw = boxWidth - 4`), `╰─…─╯`.
  - 1줄: `title === id`면 `id`, 아니면 `` `${id} · ${title}` ``. `truncateCells(…, iw)`로 자르고 bold다.
  - 2줄: `` `${STATE_GLYPH[state]} ${cardLines(node, ctx).status}` ``. 예: `● 실행 중 · 12분`, `· 대기 · 선행 3개`.
  - 3줄: 보이는 간선의 부모가 있으면 `← p1, p2`, 없으면 `roleLine(task, "·")`, 그것도 없으면 빈 줄. tone은 dim이다.
- 테두리와 1·2줄의 tone은 `STATE_TONE[state]`다. `role === "context"`인 노드는 전부 dim이고 bold가 없다.
- 한글 등 전각 문자는 `truncateCells`로 자르고 남는 칸을 공백으로 채워 오른쪽 테두리를 맞춘다.
- 24컬럼 미만이면 `mode: "list"`다. `textRows(model, ctx, columns)`의 각 줄을 span 하나짜리 행으로 돌려준다. 기존 표시와 16번 테스트가 그대로 산다.
- `model.empty`면 `words.empty[...]` dim 한 줄이다. `hiddenAfter > 0`이면 박스 뒤에 `words.hiddenAfter(n)` dim 한 줄이다.

#### A3. 간선

노드별 간선 경로는 그리지 않는다. 이유는 셋이다.
- 56컬럼에서는 한 줄에 박스가 2개라 3개 이상인 wave는 여러 줄로 쌓인다. 윗줄 박스에서 내린 직선은 아랫줄 박스를 지나간다.
- 돌아가는 차선을 두면 박스 폭(최소 24)이 모자란다.
- 가로 bus 하나로 합치면 완전 이분 그래프가 아닐 때 없는 의존을 그리게 된다.

대신 뜻이 정확한 두 가지를 그린다.

1. **wave 연결선.** 보이는 wave 블록 사이의 2행이다. 화살표 행이 wave 머리글을 겸하므로 "wave에서 wave로"로만 읽힌다. 상태는 그 wave로 들어오는 보이는 간선(wave를 건너뛴 간선 포함)을 합친 것이고, 우선순위는 flow, blocked, wait, done 순이다.

| 합친 상태 | 줄기 | 머리 | tone |
| --- | --- | --- | --- |
| done(전부 done) | `│` | `▼` | ok |
| flow(하나라도 flow) | `┆` | `▼` | run |
| blocked | `┆` | `▽` | bad |
| wait | `┆` | `▽` | dim |

   - 화살표 행은 `[{머리+" ", tone}, {waveHeader 문구, dim, bold}]`다.
   - 들어오는 보이는 간선이 없는 wave와 첫 wave는 줄기 없이 머리글만 0열에 쓴다.
   - 줄기는 움직이지 않는다.

2. **의존 관계 목록.** 그래프 아래에 빈 행, 제목(`의존 관계` / `Dependencies`, dim bold), 간선마다 한 줄을 쓴다. 건너뛴 간선도 같은 한 줄이라 누가 누구에 의존하는지 간선 단위로 정확하다.
   - 형식: `"  " + from + " " + 선 + " " + to`. id는 각각 `max(4, floor((columns - 8) / 2))`칸으로 자른다. id는 plain이고 선은 상태 tone이다.
   - 선(4칸): done `───▶`(ok), flow `╌╌╌▶`(run, 점 `●`이 `phase mod 3` 자리의 `╌`를 대신함), wait `╌╌╌▷`(dim), blocked `╌✕╌▷`(bad).
   - `phase === null`이면 점이 없다.
   - `model.edges` 순서대로 최대 12줄이고 넘치면 `words.more(n)` dim 한 줄이다. 간선이 없으면 제목도 없다.

박스 3줄의 `← 부모`도 노드별 의존을 박스 안에서 말한다.

#### A4. 움직이는 점

- 구동은 `register.tsx`의 `animTimer = $.clock.every(500, …)`다. tick은 pane을 확인하고 `$.ui.invalidate("ui.render")`를 부른다. state는 쓰지 않는다.
- 렌더 hook의 터미널 분기는 `phase = Math.floor((await $.clock.now()) / 500)`을 계산해 `termGraph`에 넘긴다. goal이 `active`가 아니거나 `ended`면 `null`을 넘긴다.
- 주기는 2Hz다. 점은 1.5초에 선 하나를 지난다. 한도 30Hz(`d.ts:2686`)보다 한참 낮다.
- 시작 조건(`syncAnim($)`, `runRefresh` 끝·`setView`·`openPane`·30초 `tick`에서 호출)은 다음을 모두 만족할 때다.
  - pane이 있고 `isPlaced && isShown`이다.
  - `(await $.session.surfaces()).includes("terminal")`이다.
  - `snapshot.status === "active" && ended === null`이다.
  - `hasFlowEdge(buildDagModel(snapshot, ui.view))`가 참이다.
- 하나라도 아니면 timer를 cancel한다. `ui.close`에서도 cancel한다. tick도 pane이 없거나 놓이지 않았거나 보이지 않으면 스스로 멈춘다. 다시 보이면 늦어도 다음 30초 poll에서 재개된다.
- 비용: 활성 task가 있는 동안 초당 2회 렌더 hook이 돈다(state 읽기 3회, 순수 계산). 데스크탑도 붙어 있으면 그쪽 pane도 다시 그려지지만 `svgMemo`가 SVG 재생성을 막는다.
- 버린 대안:
  - `dagUi`에 phase를 쓰는 방식: 초당 2회 영속 state 쓰기가 생긴다.
  - `Client` surface module: hook 왕복은 없지만 write scope 밖 새 파일과 별도 상태가 필요하다.
  - 1Hz: 비용은 절반이지만 움직임으로 읽히기 어렵다.

#### A5. 보기별 내용과 머리글 수정

- 이전: 완료 노드만 박스로, 그 사이 간선은 실선.
- 현재: focus 노드와 그 부모(context, dim 박스).
- 다음: 다음 차례 노드와 그 부모인 focus(context), 끝에 `+N개는 전체 보기에서`.
- 전체: 모든 노드.
- 머리글: `waveHeader(wave, locale, shown)`은 `shown < wave.total`일 때 끝에 `words.waveShown(shown)`을 붙인다. 예: `Wave 2 · 0/3 완료 · 2 실행 중 · 2개만 표시`. 수치는 wave 전체 기준 그대로다. `dag-svg.mjs:112`는 셋째 인자 없이 호출하므로 데스크탑은 바뀌지 않는다.

#### A6. 문구

`formatSummary`의 영어 출력은 지금과 글자 하나 다르지 않다. 한국어만 바뀐다.

| 부분 | ko | en(변경 없음) |
| --- | --- | --- |
| wave | `wave 3/5` | `wave 3/5` |
| 완료 | `2/6 완료` | `2/6 done` |
| 실행 | `1 실행 중` | `1 running` |
| 막힘 | `1 막힘` | `1 blocked` |
| 모델 | `모델 2개` | `2 models` / `1 model` |
| 경과·대기 | `1시간 23분`, `goal finish 대기` | `23m`, `awaiting goal finish` |

- 예(ko): `wave 3/5 · 2/6 완료 · 1 실행 중 · 모델 2개 · 1시간 23분`, `wave 5/5 · 6/6 완료 · 0 실행 중 · goal finish 대기`.
- 구현은 `words.waveDone`, `waveRunning`, `waveBlocked`와 새 `summaryModels`를 쓴다.

새 message 키:

| 키 | ko | en |
| --- | --- | --- |
| `summaryModels(n)` | `` `모델 ${n}개` `` | `` `${n} ${n === 1 ? "model" : "models"}` `` |
| `waveShown(n)` | `` `${n}개만 표시` `` | `` `showing ${n}` `` |
| `dependencies` | `의존 관계` | `Dependencies` |
| `otherRoot(label)` | `` `다른 root를 보는 중: ${label}` `` | `` `Reading another root: ${label}` `` |

#### A7. 목업 (56컬럼, ko)

데모 goal: `triage` 완료, `api`·`ui` 실행 중, `docs` pending, `integrate`가 셋에 의존. `api`만 제목이 id와 다르다.

전체 보기:

```
Wave 1 · 1/1 완료
╭─────────────────────────╮
│ triage                  │
│ ✓ 완료 · 4분            │
│                         │
╰─────────────────────────╯
┆
▼ Wave 2 · 0/3 완료 · 2 실행 중
╭─────────────────────────╮  ╭─────────────────────────╮
│ api · API 엔드포인트와… │  │ ui                      │
│ ● 실행 중 · 12분        │  │ ● 실행 중 · 3분         │
│ ← triage                │  │ ← triage                │
╰─────────────────────────╯  ╰─────────────────────────╯
╭─────────────────────────╮
│ docs                    │
│ ○ 준비됨                │
│ ← triage                │
╰─────────────────────────╯
┆
▽ Wave 3 · 0/1 완료
╭─────────────────────────╮
│ integrate               │
│ · 대기 · 선행 3개       │
│ ← api, ui, docs         │
╰─────────────────────────╯

의존 관계
  triage ╌●╌▶ api
  triage ╌●╌▶ ui
  triage ╌╌╌▷ docs
  api ╌╌╌▷ integrate
  ui ╌╌╌▷ integrate
  docs ╌╌╌▷ integrate
```

현재 보기(`triage`는 context라 dim):

```
Wave 1 · 1/1 완료
╭─────────────────────────╮
│ triage                  │
│ ✓ 완료 · 4분            │
│                         │
╰─────────────────────────╯
┆
▼ Wave 2 · 0/3 완료 · 2 실행 중 · 2개만 표시
╭─────────────────────────╮  ╭─────────────────────────╮
│ api · API 엔드포인트와… │  │ ui                      │
│ ● 실행 중 · 12분        │  │ ● 실행 중 · 3분         │
│ ← triage                │  │ ← triage                │
╰─────────────────────────╯  ╰─────────────────────────╯

의존 관계
  triage ╌●╌▶ api
  triage ╌●╌▶ ui
```

다음 보기(가장 넓은 wave가 1개라 박스 폭 40):

```
Wave 2 · 0/3 완료 · 2 실행 중 · 1개만 표시
╭──────────────────────────────────────╮
│ docs                                 │
│ ○ 준비됨                             │
│                                      │
╰──────────────────────────────────────╯
+1개는 전체 보기에서
```

### B. worktree

#### B1. 용어와 규칙

- **root**: CLI의 `resolveRepoRoot`가 낼 절대 경로. pane은 항상 `["node", runtime, "goal", "status", "--root", root]`를 `cwd: root`로 실행한다. `--root`를 명시하므로 CLI가 다시 추측하지 않는다. `goal stats --history`도 같다.
- **home**: 세션 root(`$.session.root()`)에서 구한 root. refresh마다 다시 묻는다.
- pane이 읽는 root는 기본이 home이다. main loop의 goal 명령이 다른 root에서 성공하면 그 root를 따라간다.
- home으로 돌아오는 조건(하나라도):
  - 세션이 이동해 home이 바뀌었다.
  - 따라간 root에 살아 있는 goal이 없다(snapshot 없음 또는 `ended`).
  - 따라간 디렉터리가 없어졌다.
  - main loop의 다음 goal 명령이 다른 root(home 포함)에서 실행됐다.
- 서브에이전트·teammate(`e.agentId` 있음)의 goal 명령은 root를 옮기지 않는다. 그 명령의 root가 지금 보는 root와 같을 때만 새로 고침과 자동 열림에 쓴다. 병렬 worktree 에이전트가 pane을 번갈아 끌고 가지 않게 하려는 결정이다.

#### B2. 순수 함수 (`dag-events.mjs`, `node:` 없이 문자열만)

```ts
export declare function isAbsolutePath(path: string): boolean;          // "/x", "C:\x", "C:/x", "\\srv\share"
export declare function joinPath(base: string, path: string): string;   // absolute `path` wins; "." and ".." resolved; no trailing separator
export declare function samePath(a: string | null | undefined, b: string | null | undefined): boolean;
export declare function ancestorPaths(path: string): string[];          // the path, then each parent up to the root
export declare function rootLabel(root: string): string;                // "…/parent/name", "/" separators, whole path when two segments or fewer
export declare function goalCommandTarget(command: string, cwd: string): { dir: string; explicitRoot: string | null } | null;
export type Observation = { root: string; planned: boolean };
export declare function observeGoalCommand(input: {
  pending: Observation | null; shown: string; root: string | null; planned: boolean; isSubagent: boolean;
}): Observation | null;                                                  // null: ignore the command
export declare function pickRoot(input: {
  observed: string | null; prev: Pick<DagState, "root" | "home" | "snapshot" | "ended"> | null; home: string;
}): string;
export declare function rebaseDagState(prev: DagState | null, at: { root: string; home: string }): DagState;
```

경로 규칙:
- `/`와 `\` 둘 다 구분자로 읽는다.
- 접두어는 `/`, `X:`+구분자, `\\`다. `..`은 접두어 위로 올라가지 않는다.
- 출력 구분자는 기준 경로에 `\`만 있으면 `\`, 아니면 `/`다.
- `samePath`는 정규화하고 구분자를 `/`로 통일한 뒤 비교한다. 드라이브 경로는 대소문자를 무시한다. 한쪽이 null이면 false다.

`goalCommandTarget`:
1. 처음 나오는 변경 goal 호출의 위치를 찾는다(`GOAL_COMMAND`, 없으면 `VARIABLE_GOAL_COMMAND`). 없거나 `cwd`가 절대 경로가 아니면 null이다.
2. 그 앞 텍스트에서 명령 구간의 시작(`^`, `&&`, `;`, `(`, 줄바꿈 뒤)에 있는 `cd <arg>`·`pushd <arg>`를 차례로 `joinPath`한다. 결과가 `dir`이다.
3. `--root`는 goal 호출부터 다음 구분자(`&&`, `||`, `;`, `|`, 줄바꿈)까지에서만 찾는다. 없으면 호출 앞의 마지막 `HARNESS_REPO_ROOT=<값>`을 쓴다. `explicitRoot = joinPath(dir, 값)`이다.
4. 정적으로 풀 수 없는 값(`$`, 백틱, `*`, `?` 포함, `~`로 시작, `-`, cwd가 `/`로 시작하는데 따옴표 없는 값에 `\`)이면 null을 돌려준다. 틀린 root를 추측하지 않는다.

`parsePotaGoalCommand`는 바꾸지 않는다(17번 테스트 유지).

`observeGoalCommand`(현재 대상 `current = pending?.root ?? shown`):
- `root === null`(디렉터리 불명): `{ root: current, planned: isSubagent ? false : planned }`.
- main loop이거나 `samePath(root, current)`: `{ root, planned }`. `pending`과 root가 같으면 `planned`를 OR한다.
- 그 밖(다른 root의 서브에이전트): null.

`pickRoot`:
- `observed`가 있으면 그것.
- 아니면 `prev.root`가 있고 `samePath(prev.home, home)`이고 (`samePath(prev.root, home)`이거나 `prev.snapshot !== null && prev.ended === null`)이면 `prev.root`.
- 그 밖에는 `home`.

`rebaseDagState`:
- `prev`가 null이거나 `prev.root`가 null이거나 root가 같으면 `{ ...(prev ?? initialDagState()), root, home }`. `seq`는 그대로다.
- root가 다르면 `{ ...initialDagState(), seq: prev.seq + 1, root, home }`. snapshot, timeline, ended, error, fetchedAt을 버리고 `seq`를 올려 다시 그리게 한다. `svgMemo` 키도 `seq`로 무효화된다.

`reduceDagState`는 바꾸지 않는다(21번 테스트 유지). `initialDagState()`에 `home: null`이 추가된다.

#### B3. 배선 (`register.tsx`)

- 모듈 변수 `planned`, `observedRoot`를 없애고 `pending: Observation | null` 하나를 둔다. `isAbsolutePath`는 순수 모듈 것을 import한다.
- `rootOf($, target)`:
  - `target.explicitRoot`가 있으면 그것.
  - 없고 `$.env.get("HARNESS_REPO_ROOT")`가 있으면 `joinPath(target.dir, 값)`.
  - 그 밖에는 `ancestorPaths(target.dir)` 중 `$.fs.exists(joinPath(p, ".git"))`가 처음 참인 `p`, 없으면 `target.dir`.
  - `scripts/pota-paths.mjs:98-121`과 같은 순서다. git 프로세스를 쓰지 않아 realpath 차이가 없다.
- `homeOf($) = rootOf($, { dir: await $.session.root(), explicitRoot: null })`.
- `tool.call` hook:
  - Bash의 변경 goal 명령이면 `next(e)` 전에 `cwd = await $.session.cwd()`를 읽는다. 실패하면 null이다.
  - 성공한 뒤 `target = cwd === null ? null : goalCommandTarget(e.command, cwd)`, `root = target === null ? null : await rootOf($, target)`, `shown = (await read($, dag)).root ?? (await homeOf($))`를 구한다.
  - `observeGoalCommand({ pending, shown, root, planned: goal.planned, isSubagent: e.agentId !== undefined })`가 null이 아니면 `pending`에 넣고 `requestRefresh($, "goal")`을 부른다.
  - main loop의 `EnterWorktree`·`ExitWorktree` 호출이 성공하면 `requestRefresh($, "goal")`을 부른다. 세션 root 이동을 바로 반영한다.
- `runRefresh`:
  - `pending`을 꺼내고 비운다. `home`을 구한다.
  - `root = pickRoot({ observed, prev, home })`. `root`가 home이 아니고 `$.fs.exists(root)`가 거짓이면 `home`으로 바꾼다.
  - `base = rebaseDagState(prev, { root, home })`. root가 바뀌었으면 `failures = 0`이다.
  - `needsEnding`은 `base` 기준으로 계산하고 `next = reduceDagState(base, …)`다.
  - 자동 열림은 `observation?.planned === true && samePath(observation.root, root)`일 때만 판단한다.
- `tick`: `ended !== null`이어도 `!samePath(state.home, await homeOf($))`이면 refresh한다.
- state: `dag` atom 초기값에 `home: null`을 넣고 shape를 `dag-2`로 올린다. `ui-1`, `agents-1`은 그대로다(필드 변화 없음, phase는 시계에서 계산).
- `types/index.d.ts`: `DagState`에 `/** The root the snapshot was read from. */ root`와 `/** The root of the session's own project root at that fetch. */ home: string | null`.
- 표시(W7): `state.root`와 `state.home`이 둘 다 있고 `samePath`가 아니면 제목 아래에 `<Text color="warning" wrap="truncate-end">{words.otherRoot(rootLabel(state.root))}</Text>`를 그린다. goal이 없는 화면에도 그린다. widget에는 그리지 않는다. 같을 때는 그리지 않는다. 흔한 경우에 행을 쓰지 않고, pane이 세션 디렉터리가 아닌 곳을 볼 때만 눈에 띄게 하려는 결정이다.

#### B4. W1~W7 대응

| # | 수정 |
| --- | --- |
| W1 | refresh마다 `homeOf`를 다시 구한다. `pickRoot`가 `prev.home`과 다르면 home으로 돌아간다. `EnterWorktree`·`ExitWorktree` 뒤에 바로 refresh한다. |
| W2 | `--root` 없는 명령도 실제 실행 디렉터리의 root로 관찰된다. 그 값이 `pickRoot`의 `observed`가 되어 예전 root를 대체한다. |
| W3 | home이 세션을 따라 바뀐다. 따라간 root의 디렉터리가 없으면 home으로 돌아간다. root가 바뀌면 `rebaseDagState`가 error를 지운다. |
| W4 | hook cwd, 앞선 `cd`/`pushd`, 상대·절대 `--root`, 인라인·환경 `HARNESS_REPO_ROOT`로 실행 root를 계산한다. 풀 수 없으면 root를 옮기지 않는다. |
| W5 | `planned`가 `Observation.root`에 묶인다. 다른 root의 서브에이전트 명령은 무시된다. 자동 열림은 읽은 root와 같을 때만 판단한다. |
| W6 | root가 바뀌면 snapshot, timeline, ended를 버린다. 새 root에 goal이 없으면 "goal 없음"이 나오고 "종료됨"은 나오지 않는다. |
| W7 | 다른 root를 볼 때 `다른 root를 보는 중: …/parent/name`을 표시한다. |

#### B5. W1~W7 밖에서 찾은 것

mod 안의 실제 문제:
- **W8.** 30초 poll이 `ended !== null`이면 refresh를 건너뛴다(`register.tsx:161`). 끝난 goal을 보인 채 세션이 worktree를 옮기면 갱신되지 않는다. B3의 `tick`에서 고친다.
- **W9.** `ROOT_FLAG`가 명령 줄 전체에서 첫 `--root`를 잡는다(`dag-events.mjs:12,29`). `pota toolcheck --root /x && pota goal task …`에서 goal과 무관한 root를 관찰한다. `goalCommandTarget`이 goal 호출 구간에서만 찾는다.
- **W10.** pane의 `goal status`가 `--root` 없이 `cwd`만 준다(`register.tsx:117`). `--root /repo/sub`처럼 `.git`이 없는 명시 root로 만든 goal을 CLI가 `/repo`에서 다시 찾아 못 본다. 항상 `--root`를 넘긴다.
- **W11.** 연속 실패 backoff(`failures`)가 root 전환 뒤에도 남아 새 root의 첫 poll이 120초까지 밀릴 수 있다(`dag-events.mjs:294-297`). 전환 때 0으로 되돌린다.

문제 아님으로 확인한 것:
- `closedGoalId`·`autoOpenedPlanKey`는 goalId가 worktree마다 달라 root에 묶을 필요가 없다.
- `goal stats --history`는 저장소 단위로 합쳐지지만 goalId로 찾으므로 정확하다(`docs/memory/goal-state.md:26`).
- `dagAgents`는 세션 단위라 root 전환과 무관하다.

`scripts/` 범위 밖(이번에 고치지 않음):
- `goal status`는 다른 worktree에 묶인 상태를 정리하지 않고 그대로 출력한다(`scripts/pota-goal-state.mjs:12-17`). 정리는 hook과 `goal start`만 한다(`pota-goal-operations.mjs:37-43,79-91`). 상태 디렉터리와 `worktreeId`가 같은 해시(`pota-paths.mjs:28-34`)라 예전 `<repo>/.pota/state.json` 이전 경로에서만 생길 수 있다. 재현하지 않았다.

### C. 테스트 계약

#### C1. `term-graph`: `test/claude-mod-term.test.mjs` (새 파일)

`task`/`snapshot` helper는 `test/claude-mod.test.mjs`와 같은 모양으로 둔다. `demo()`는 triage(completed), api·ui(active, [triage]), docs(pending, [triage]), integrate(pending, [api, ui, docs])이고 title은 id와 같다. `text(row)`는 span text를 이은 것이다.

1. `termBoxLayout`:
   - (56,3)→`{per:2,boxWidth:27}`, (56,1)→`{1,40}`, (58,3)→`{2,28}`, (80,5)→`{3,25}`.
   - (50,2)→`{2,24}`, (49,2)→`{1,40}`, (24,2)→`{1,24}`, (200,2)→`{2,40}`.
   - (23,1)→`null`, (NaN,1)→`{1,40}`.
2. 데모, 전체 보기, `en`, `minute: 0`, `timeline: {}`, `columns: 56`, `phase: 0`의 `rows.map(text)`가 아래와 정확히 같다(빈 행은 `""`).
   ```
   Wave 1 · 1/1 done
   ╭─────────────────────────╮
   │ triage                  │
   │ ✓ done                  │
   │                         │
   ╰─────────────────────────╯
   ┆
   ▼ Wave 2 · 0/3 done · 2 running
   ╭─────────────────────────╮  ╭─────────────────────────╮
   │ api                     │  │ ui                      │
   │ ● running               │  │ ● running               │
   │ ← triage                │  │ ← triage                │
   ╰─────────────────────────╯  ╰─────────────────────────╯
   ╭─────────────────────────╮
   │ docs                    │
   │ ○ ready                 │
   │ ← triage                │
   ╰─────────────────────────╯
   ┆
   ▽ Wave 3 · 0/1 done
   ╭─────────────────────────╮
   │ integrate               │
   │ · waiting · 3 deps      │
   │ ← api, ui, docs         │
   ╰─────────────────────────╯
   (빈 행)
   Dependencies
     triage ●╌╌▶ api
     triage ●╌╌▶ ui
     triage ╌╌╌▷ docs
     api ╌╌╌▷ integrate
     ui ╌╌╌▷ integrate
     docs ╌╌╌▷ integrate
   ```
3. 폭: columns 24, 30, 56, 58, 80, 120과 네 보기 전부에서, 제목이 `` `${id} 한글 제목 ${"가".repeat(30)}` ``인 snapshot의 모든 행이 `cellWidth(text(row)) <= columns`다. `mode`는 `"boxes"`다. `╭`로 시작하는 행부터 5행은 `cellWidth`가 서로 같다. 잘린 1줄은 `…`를 포함한다.
4. wave 노드 5개, 56컬럼: 그 wave의 박스 행은 15행(2+2+1)이다. 80컬럼: 10행(3+2)이다.
5. tone:
   - 전체 보기에서 `api` 박스의 테두리 span은 `run`, `triage`는 `ok`, `docs`는 `ready`, `integrate`는 `dim`이다. blocked task는 `bad`다.
   - 1줄 내용 span은 `bold: true`다. 3줄 span은 `dim`이다.
   - 현재 보기의 `triage`(context)는 모든 span이 `dim`이고 bold가 없다.
6. 연결선:
   - 전부 완료된 선형 goal은 줄기 `│`, 머리 `▼`, tone `ok`다.
   - 데모의 wave 2 앞은 `┆`와 `▼`(`run`), wave 3 앞은 `┆`와 `▽`(`dim`)다.
   - 들어오는 간선이 blocked뿐이면 `┆`와 `▽`(`bad`)다. flow와 blocked가 함께면 `run`이다.
   - 이전 보기처럼 들어오는 보이는 간선이 없는 wave는 줄기 행이 없고 머리글이 `Wave`로 시작한다.
7. 머리글:
   - 데모 현재 보기 `ko`에 `Wave 2 · 0/3 완료 · 2 실행 중 · 2개만 표시`가 있다. `en`은 `Wave 2 · 0/3 done · 2 running · showing 2`다.
   - 전체 보기에는 `표시`와 `showing`이 없다.
   - `waveHeader(wave, "ko")`(인자 2개)는 지금과 같다.
8. 의존 목록:
   - phase 0, 1, 2의 flow 선이 `●╌╌▶`, `╌●╌▶`, `╌╌●▶`다. phase 3은 0과, -1은 2와 `deepEqual`이다. `phase: null`이면 `╌╌╌▶`다.
   - phase만 다른 두 결과는 flow 선 span만 다르다.
   - done `───▶`(`ok`), wait `╌╌╌▷`(`dim`), blocked `╌✕╌▷`(`bad`). `ko` 제목은 `의존 관계`다.
   - 간선 없는 model은 제목과 빈 행이 없다.
   - 간선 14개면 간선 12줄과 `+2 more` 한 줄이다.
   - 건너뛴 간선(`a`, `b`, `c[b]`, `d[a,c]`)에서 `a … d` 줄이 있고, wave 3 연결선 상태가 두 간선을 합친 값이다.
9. 대체 표시: `columns: 23`이면 `mode === "list"`이고, `rows.map(text)`가 `textRows(model, ctx, 23).map(r => r.text)`와 같다. 각 행은 span 하나이고 tone과 bold가 같다.
10. 빈 보기: 새 goal의 이전 보기 `ko`는 `[[{ text: "아직 완료된 task가 없습니다.", tone: "dim" }]]`이다. 다음 보기 끝 행은 `+1개는 전체 보기에서`(데모)다.
11. `hasFlowEdge`: 데모 전체·현재는 true, 데모 이전과 전부 완료는 false다.
12. span 위생: 빈 text가 없다. 이웃 span은 tone이나 bold가 다르다. 같은 입력의 두 호출은 `deepEqual`이다.

`test/claude-mod.test.mjs` 수정:
- 2번: `pureModules`에 `"dag-term.mjs"`를 추가한다(검사 대상 추가, 강화).
- 9번:
  - 277행 기대값을 `"wave 3/5 · 2/6 완료 · 1 실행 중 · 모델 2개 · 1시간 23분"`으로 바꾼다.
  - 287행 기대값을 `"wave 5/5 · 6/6 완료 · 0 실행 중 · goal finish 대기"`로 바꾼다.
  - 둘 다 계약 변경 1이다. 영어 기대값 4개는 그대로다.
  - 추가: 막힘 `ko`는 `"wave 2/5 · 1/6 완료 · 0 실행 중 · 1 막힘"`, 모델 1개 `ko`는 `모델 1개`를 포함한다.
- 16·17·21·22번과 12번(alt 문구)은 바꾸지 않아도 통과해야 한다.

#### C2. `worktree-root`: `test/claude-mod-root.test.mjs` (새 파일)

1. `isAbsolutePath`: `"/a"`, `"C:\\a"`, `"c:/a"`, `"\\\\srv\\share"`는 true. `"a/b"`, `"./a"`, `""`, `"~/a"`는 false.
2. `joinPath`:
   - `("/repo","sub")`→`"/repo/sub"`, `("/repo/a","../b")`→`"/repo/b"`, `("/repo","/abs/x/")`→`"/abs/x"`.
   - `("/repo",".")`→`"/repo"`, `("/","..")`→`"/"`, `("/repo//a/","./b/./c")`→`"/repo/a/b/c"`.
   - `("C:\\repo","sub\\x")`→`"C:\\repo\\sub\\x"`, `("C:\\repo","..\\wt")`→`"C:\\wt"`, `("C:\\repo","../../..")`→`"C:\\"`.
   - `("C:/repo","sub")`→`"C:/repo/sub"`, `("C:\\repo","D:/x")`→`"D:/x"`.
3. `samePath`: `("/repo","/repo/")`, `("/repo/a/..","/repo")`, `("C:\\Repo","c:/repo")`는 true. `("/Repo","/repo")`, `(null,"/repo")`, `(null,null)`은 false.
4. `ancestorPaths`: `"/a/b/c"`→`["/a/b/c","/a/b","/a","/"]`, `"C:\\a\\b"`→`["C:\\a\\b","C:\\a","C:\\"]`, `"/"`→`["/"]`.
5. `rootLabel`: `"/Users/x/wt/feature-a"`→`"…/wt/feature-a"`, `"C:\\work\\wt\\a"`→`"…/wt/a"`, `"/a/b"`→`"/a/b"`, `"/repo"`→`"/repo"`.
6. `goalCommandTarget`(cwd `"/repo"`, 따로 적지 않으면 `explicitRoot: null`):
   - `pota goal task --task a --status completed`→dir `/repo`.
   - `cd wt/feat && node scripts/pota.mjs goal task --task a`→dir `/repo/wt/feat`.
   - `cd "/abs/my wt" && pota goal start --plan p.md`→dir `/abs/my wt`.
   - `cd a; cd ../b && pota goal finish`→dir `/repo/b`.
   - `(cd sub && pota goal verify -- npm test)`→dir `/repo/sub`.
   - `pushd wt && pota goal task --task a`→dir `/repo/wt`.
   - cwd `/repo/main`, `pota goal replan --root ../other`→dir `/repo/main`, explicitRoot `/repo/other`.
   - `cd pkg && pota goal task --root=. --task a`→dir와 explicitRoot 모두 `/repo/pkg`.
   - `pota goal assign --root "/a b/c"`→explicitRoot `/a b/c`.
   - `HARNESS_REPO_ROOT=/elsewhere pota goal task --task a`→explicitRoot `/elsewhere`.
   - `export HARNESS_REPO_ROOT=wt/x; pota goal start --plan p`→explicitRoot `/repo/wt/x`.
   - `HARNESS_REPO_ROOT=/e pota goal task --root /r`→explicitRoot `/r`.
   - `pota toolcheck --root /tools && pota goal task --task a`→explicitRoot null (W9).
   - `pota goal task --task a && git log --root /x`→explicitRoot null.
   - `pota goal status --root /ro && cd wt && pota goal task --task a`→dir `/repo/wt`, explicitRoot null.
   - `pota goal task --task a && cd /elsewhere`→dir `/repo`.
   - `P=/x/pota.mjs; cd wt && node "$P" goal start --plan a.md`→dir `/repo/wt`.
   - cwd `C:\\repo`, `cd wt\\a && pota goal task --task a`→dir `C:\\repo\\wt\\a`.
   - null: `cd "$WT" && pota goal task --task a`, `cd ~/x && pota goal task --task a`, `cd - && pota goal task --task a`, `pota goal task --root $ROOT`, `pota goal task --root ~/r`, `cd my\\ dir && pota goal task --task a`, `git status`, `pota goal status`, 그리고 cwd `"repo"`(상대).
7. `observeGoalCommand`(`shown: "/repo"`):
   - main, root `/wt`, planned true, pending null→`{root:"/wt",planned:true}`.
   - main, root null, planned true→`{root:"/repo",planned:true}`.
   - 서브에이전트, root `/wt`→null (W5).
   - 서브에이전트, root `/repo/`, planned true→planned true이고 root는 `/repo`와 `samePath`.
   - 서브에이전트, root null, planned true→`{root:"/repo",planned:false}`.
   - pending `{root:"/repo",planned:true}` + main `/repo` planned false→planned true.
   - pending `{root:"/a",planned:true}` + main `/b` planned false→`{root:"/b",planned:false}`.
   - pending `{root:"/wt",planned:false}` + 서브에이전트 `/wt` planned true→`{root:"/wt",planned:true}`.
8. `pickRoot`(`S`는 snapshot):
   - prev null→home.
   - observed `/wt`→`/wt`.
   - prev `{root:"/wt",home:"/repo",snapshot:S,ended:null}`, home `/repo`→`/wt`.
   - 같은 prev, home `/repo2`→`/repo2` (W1).
   - prev snapshot null→`/repo`.
   - prev `ended` 있음→`/repo`.
   - prev `{root:"/repo",home:"/repo",ended:{…}}`→`/repo`.
   - prev root `/abs`를 따라가던 중 observed `/repo`→`/repo` (W2).
9. `rebaseDagState`:
   - null→`{...initialDagState(), root, home}`. `initialDagState()`는 `home: null`을 가진다.
   - 같은 root(`/repo`와 `/repo/`)→`seq`와 `snapshot` 참조가 그대로다.
   - `prev.root === null`→reset이 없다.
   - 다른 root→`{seq: prev.seq+1, snapshot:null, ended:null, error:null, fetchedAt:0, timeline:{}, root, home}`.
   - 그 결과에 `reduceDagState(…, {snapshot:null,error:null,now})`→`ended === null` (W6).
   - `error:"boom"`→`snapshot === null`이고 error가 남는다 (W3).
   - 새 snapshot→`seq === prev.seq + 2`이고, timeline에 이전 root의 `activeAt`이 없다(task id가 같아도).
10. 소스 제약: `dag-events.mjs`에 금지 문자열이 없다(기존 2번이 이미 검사한다. 이 파일에서 다시 확인해도 된다).

#### C3. `wire-pane`: `claude-mod/tests/pane.test.tsx`

`engine()`에 선택 인자를 추가한다: 세션 root를 돌려주는 함수, `session.cwd` 값, `fs.exists` 판정 함수, `session.surfaces` 값. `process.run`의 `argv`와 `cwd`를 `world.calls`에 기록하고, `status(root)`가 `--root` 값에 따라 답하게 한다. 기본값은 지금과 같아야 하고 기존 테스트 4개는 수정 없이 통과해야 한다.

1. **(기대 변경, 계약 변경 2)** 첫 테스트의 터미널 부분(95-99행). 제목을 "…and a box graph on the terminal"로 바꾼다. `bodyColumns: 60`에서:
   - `Svg`가 없다. `await terminal.drawn()`이 거부 없이 끝난다.
   - `Text` `/╭─+╮/`, `/Wave 2 · 0\/1 done · 1 running/`, `/b · Task b/`, `/● running/`, `/Dependencies/`, `/[╌●]{3}▶/`가 각각 있다.
   - 같은 테스트에서 `bodyColumns: 20`으로 다시 mount하면 예전 기대 `/^Wave 2 · 0\/1 done · 1 running/`와 `/● b/`가 그대로 성립한다(목록 대체).
   - 데스크탑 부분(87-93행)은 그대로다.
2. 점: `session.surfaces`가 `["terminal"]`이고 pane이 열린 상태에서 `/[╌●]{3}▶/` Text의 `text`를 읽는다. `clock.advance(500)` 뒤 다시 읽으면 다르다. 상태가 전부 completed로 바뀌고 refresh된 뒤에는 `advance(500)` 전후가 같다.
3. `goal status` 실행의 `argv`가 `--root`, `/repo`를 포함하고 `cwd === "/repo"`다.
4. W1: 세션 root가 `/repo`에서 `/repo/.claude/worktrees/x`로 바뀌고 두 root의 goal 제목이 다르다. `clock.advance(30_000)` 뒤 새 제목이 보이고, 이전 제목과 `ended` 문구가 없다.
5. W2·W4·W7: main loop의 `cd /wt/b && node /pota/scripts/pota.mjs goal start --plan p`(`session.cwd`는 `/repo`).
   - `--root /wt/b`로 실행되고 pane이 열린다.
   - `Text` `/Reading another root: …\/wt\/b/`가 있다.
   - 이어서 `cd` 없는 goal 명령을 실행하면 `--root /repo`로 읽고 그 문구가 없다.
6. W4: `session.cwd`가 `/repo/main`일 때 `goal task --root ../other …`→`--root /repo/other`로 실행된다.
7. W5: `agentId: "a1"`, `session.cwd`가 `/wt/agent`인 `goal start`→`world.opens === 0`이고 `/wt/agent`로 실행한 기록이 없다. `session.cwd`가 `/repo`인 서브에이전트의 `goal start`는 pane을 연다.
8. W3: 5번처럼 `/wt/b`를 따라간 뒤 `fs.exists("/wt/b")`가 false가 된다. 다음 refresh가 `/repo`를 읽고 `Refresh failed` Text가 없다.
9. W6: 세션 root가 goal 없는 root(`status`가 `"null"`)로 바뀐다. `No active Pota goal…`이 보이고 `ended`가 없다.
10. W8: `/repo`의 goal이 끝난 상태(`status` `"null"`, `recent`에 completed)에서 세션 root가 goal이 있는 root로 바뀐다. `advance(30_000)` 뒤 새 goal이 보인다.

기존 기대값 변경 정리:
- 9번 테스트 2줄(계약 변경 1).
- `pane.test.tsx` 95-99행(계약 변경 2).
- 계약 변경 3으로 바뀌는 기존 기대값은 없다(`observedRoot`를 직접 검사하는 테스트가 없다).
- 허용 목록 밖은 2번의 `pureModules` 추가 하나이고, 검사를 넓히는 방향이다.

#### C4. write scope

세 task의 범위는 계획대로 겹치지 않는다. 범위 밖 파일은 필요 없다. 주의할 순서 하나:
- `rebaseDagState`가 돌려주는 `home` 필드의 타입은 `wire-pane`이 `types/index.d.ts`에 추가한다. `worktree-root` 단계의 `dag-events.d.mts`는 `DagState`를 그대로 쓴다. `.mjs`는 타입 검사 대상이 아니라 그 사이에 깨지는 것은 없다.

### 확인하지 못한 가정

1. main loop의 hook에서 `$.session.cwd()`가 이전 Bash 호출의 `cd`가 남긴 디렉터리를 돌려주는지 문서에 없다. 아니면 "이전 호출에서 cd한 뒤 `--root` 없이 실행"한 경우를 놓치고 세션 디렉터리로 본다(같은 명령 안의 `cd`는 파싱으로 처리된다).
2. `Text` 안의 `Text`는 타입과 문서 문구로만 확인했다. `claude plugin test`의 `drawn()`이 거부하면 행을 `<Box flexDirection="row">`와 형제 `Text`로 바꾼다. `TermRow` 구조는 그대로 쓸 수 있다.
3. 테스트 kit의 `find({ text })`가 바깥 `Text`의 text에 안쪽 span 문자열을 포함하는지 모른다(`d.ts:19553-19556`). 계약의 정규식은 어느 쪽이든 맞도록 앵커 없이 썼다(1번의 폭 20 대체 표시만 span 하나라 `^`를 쓴다).
4. `EnterWorktree`·`ExitWorktree` 직후 `$.session.root()`가 이미 바뀌어 있는지는 문서 문구("a worktree move took it")에 기댄다. 늦더라도 turn 종료와 30초 poll이 잡는다.
5. kit에서 mock하지 않은 `session.cwd`·`session.surfaces`·`env.get`이 던지는지 값을 주는지 모른다. 배선은 셋 다 try로 감싸고 실패를 "모름"으로 처리한다.
6. `$.process.run`의 환경이 Bash 도구와 같은 `HARNESS_REPO_ROOT`를 보는지 모른다. 그래서 pane은 환경에 기대지 않고 `--root`를 명시한다.

### 위험

- 박스 문자와 `●▼▶`는 East Asian Ambiguous 폭이다. 이 문자를 2칸으로 그리는 터미널 설정에서는 오른쪽 테두리가 어긋난다. `truncate-end` 덕분에 줄바꿈으로 무너지지는 않는다. 기존 표시(`●`, `✓`)와 Ink 테두리도 같은 조건이다.
- 전체 보기는 길다(데모 33행). pane 스크롤에 맡긴다. 기본 보기인 "현재"는 짧다.
- 2Hz redraw가 활성 task 동안 계속된다. 실제 화면에서 깜박임이나 스크롤 간섭이 보이면 `ANIM_MS`를 1000으로 올린다(상수 하나).
- `goalCommandTarget`은 셸을 실행하지 않는다. `(cd x && y); pota goal …`처럼 서브셸 밖에서 실행되는 경우 `x`를 잘못 따라갈 수 있다. main loop 명령에만 영향이 있고, 디렉터리가 없으면 home으로 돌아온다.
- Windows에서 Git Bash식 `/c/…` 경로는 `C:\…`와 같은 곳으로 보지 않는다. 그런 root는 존재 검사에서 떨어져 home을 읽는다.
- hot reload로 `pending`이 사라지면 그 한 번의 관찰을 놓친다. 따라가던 root는 `dag` state의 `root`·`home`에 남아 유지된다.
- `dag-2`로 올리면 이전 버전이 저장한 `dag` 값은 초기값으로 읽힌다. 첫 refresh가 다시 채운다.

### 설계 변경 1: 연결 화살표를 박스 가운데로 (2026-11-18, 사용자 요청)

사용자가 56컬럼 렌더 결과를 보고 "화살표가 박스 가운데에 있어야 하는데"라고 했다. A3의 "화살표 행이 wave 머리글을 겸한다"와 A2의 "왼쪽 정렬"을 아래로 바꾼다. 참고 스크린샷도 이 배치다.

- 그래프 폭 `W = per * boxWidth + BOX_GAP * (per - 1)`.
- 박스가 `per`개보다 적은 줄(`k`개)은 `floor((W - (k * boxWidth + BOX_GAP * (k - 1))) / 2)`칸을 왼쪽에 채워 가운데에 놓는다.
- 연결선은 줄기 행과 머리 행 두 줄이고, 둘 다 `floor((W - 1) / 2)`칸을 왼쪽에 채운다. 문자·tone 규칙은 A3 표 그대로다.
- wave 머리글은 머리 행 다음의 독립된 행이다(0열, dim bold). 들어오는 보이는 간선이 없는 wave와 첫 wave는 머리글만 쓴다.
- 채움 공백 span의 tone은 `plain`이다. 목록 대체(`mode: "list"`)와 의존 관계 목록은 바뀌지 않는다.
- task `term-arrow`가 구현한다(`opus`/`high`). Write scope: `claude-mod/hooks/dag-term.mjs`, `claude-mod/hooks/dag-term.d.mts`, `test/claude-mod-term.test.mjs`. 검증: `node --test test/claude-mod-term.test.mjs test/claude-mod.test.mjs`, `claude plugin validate claude-mod`.
- `wire-pane`의 write scope에 `claude-mod/hooks/dag-events.d.mts`(임시 별칭 `RootedDagState` 제거만)를 추가했다.

### 설계 변경 2: 박스 제목을 별도 줄로 (2026-11-18, 사용자 요청)

사용자가 실제 goal 화면(제목 `Run planned triage and finalize the plan`)을 보이며 "이 박스안에 들어갈 수 있어?"라고 물었다. A2의 1줄(`id · title`을 한 줄에 쓰고 자름)은 폭 40 박스에서도 `triage-plan · Run planned triage an…`으로 잘린다. 아래로 바꾼다.

- 박스 내용 줄: (1) `id`(bold), (2) 제목 줄 0~2개, (3) 상태 줄, (4) `← 부모` 또는 역할 줄. (3)(4)는 A2 그대로다.
- 제목 줄은 `title !== id`일 때만 있다. `iw`칸에 맞춰 공백에서 줄을 나누고, 한 단어가 `iw`보다 길면 칸 수로 끊는다. 최대 2줄이고 그래도 남으면 둘째 줄을 `truncateCells`로 `…` 처리한다. 폭은 `cellWidth` 기준이다(한글 2칸).
- 제목 줄의 tone은 상태 tone이고 bold가 아니다. context 노드는 dim이다.
- 같은 줄에 나란히 놓인 박스는 높이를 가장 높은 박스에 맞춘다. 낮은 박스는 아래 테두리 앞에 빈 내용 줄을 채운다. 박스 높이는 5~7행이다.
- task `box-title`이 구현한다(`opus`/`high`). Write scope: `claude-mod/hooks/dag-term.mjs`, `claude-mod/hooks/dag-term.d.mts`, `test/claude-mod-term.test.mjs`, `claude-mod/tests/pane.test.tsx`(C3.1의 `/b · Task b/` 기대만). 검증: `node --test test/claude-mod-term.test.mjs test/claude-mod.test.mjs`, `claude plugin test claude-mod`, `claude plugin validate claude-mod`.

### 설계 변경 3: 의존 관계 섹션과 움직이는 점 제거 (2026-11-18, 사용자 요청)

사용자가 "의존관계 섹션이 꼭 필요해?"라고 물었고, 박스의 `← 선행` 줄과 중복이라는 설명 뒤 "움직임은 없어도 될 것 같아"라고 답했다. A3의 2번(의존 관계 목록)과 A4(움직이는 점) 전체를 뺀다. 이전 대화의 "진행 중 간선의 움직이는 점" 요구는 터미널에 한해 사용자가 철회했다. 데스크탑 SVG는 바뀌지 않는다.

- `termGraph(model, ctx, { columns })`: `phase` 옵션을 없앤다. 그래프는 wave 블록과 연결선, `hiddenAfter` 줄에서 끝난다.
- `hasFlowEdge`, `EDGE_ROWS_MAX`, `messages().dependencies`를 없앤다.
- `register.tsx`: `ANIM_MS`, `animTimer`, `syncAnim`, `stopAnim`, `animTick`과 `phase` 계산을 없앤다. 500 ms redraw가 사라진다.
- wave 연결선의 실선/점선·tone(A3 표)은 그대로다.
- 테스트: C1의 8·11번과 2번의 의존 목록 부분, C3.1의 `/Dependencies/`·`/[╌●]{3}▶/`, C3.2를 뺀다. 없어진 기능의 테스트이므로 삭제가 맞다.
- task `drop-deps`가 구현한다(`opus`/`high`).

### 리뷰 반영 (2026-11-18, `final-review` 결과와 사용자 지시 "고쳐")

읽기 전용 리뷰(`opus`/`xhigh`, 모델 `claude-opus-5-5`)는 차단 0, 중요 2, 사소 7을 냈다. task `review-fixes`가 아래를 고친다(`opus`/`high`).

| # | 문제 | 수정 |
| --- | --- | --- |
| R1 | root를 모르는 goal 명령이 `shown`(마지막으로 읽은 root)을 관찰값으로 넣어, 세션이 옮겨진 뒤에도 예전 root에 고정된다(W1 재발). 재현: scratchpad `review/pin.mjs`. | `Observation.root`를 `string \| null`로 바꾼다. root를 모르면 `{ root: pending?.root ?? null, planned }`. 자동 열림 조건은 `observation.root === null \|\| samePath(observation.root, root)`. C2.7의 root null 기대 두 개를 바꾼다. |
| R3 | 따옴표 안의 `--root`를 root로 읽는다(`--note "see --root /x"` → `/x"`). | `value()`가 짝이 맞지 않거나 따옴표가 섞인 값을 null로 돌린다. |
| R4 | `cd -P wt`를 `/repo/-P`로, 다른 명령에만 붙은 `HARNESS_REPO_ROOT=/a echo hi; pota goal …`를 `/a`로 읽는다. | `-`로 시작하는 `cd`/`pushd` 인자는 null. `HARNESS_REPO_ROOT`는 goal 호출과 같은 명령 구간(직전 구분자 이후)이나 `export`된 것만 쓴다. |
| R5 | `runRefresh`에서 예외가 나면 꺼낸 관찰을 잃는다. | 실패 때 `pending ??= observation`. |
| R7 | 따라간 worktree에서 goal이 끝나면 "완료" 표시가 다음 refresh에서 "goal 없음"으로 바뀐다. home에서 끝난 goal은 표시가 남아 일관되지 않다. | 따라간 root의 goal이 끝났으면 home도 읽는다. home에 살아 있는 goal이 있으면 home으로 옮기고, 없으면 따라간 root의 종료 표시를 유지한다. 세션 이동과 새 관찰은 지금처럼 우선한다. |
| R8 | 변경 goal 명령마다 결과를 넘기기 전에 `rootOf`·`homeOf`의 파일 검사를 기다린다. | `next(e)` 뒤의 관찰 블록을 결과 반환과 분리한다(`cwd`는 지금처럼 `next` 전에 읽는다). |
| R9 | UNC 경로에서 `..`이 share 위로 올라가고(`\\\\srv\\share\\x` + `..\\..` → `\\\\srv`), `samePath`가 대소문자를 구분한다. | UNC 접두어를 `\\\\server\\share`까지로 보고, UNC 비교도 대소문자를 무시한다. |
| 추가 | `test/verification-contracts.test.mjs`의 PostToolUse 테스트가 OS locale이 한국어면 실패한다(영어 문구 기대). 이번 변경과 무관한 기존 문제지만 사용자 지시로 함께 고친다. | 그 테스트가 띄우는 프로세스의 locale을 영어로 고정한다. 기대 문구는 바꾸지 않는다. |

고치지 않는 것:
- R2(확인하지 못한 가정): 이전 Bash 호출의 `cd`가 `$.session.cwd()`에 남는지 모른다. 남지 않으면 "앞 호출에서 `cd`한 뒤 `--root` 없이 실행"한 goal 명령을 세션 디렉터리에서 실행한 것으로 본다. 테스트 kit로 확인할 수 없어 알려진 한계로 둔다. 같은 명령 안의 `cd`와 `--root`는 처리된다.
- R4의 `if cd wt; then …; fi`, `bash -c "cd wt && …"`: 셸 구문 해석이 필요하다. 드문 형태라 두고, 틀리면 다음 관찰이나 goal 종료 때 home으로 돌아온다.
- R6(폭 20 테스트 기대): C3.1의 `/^Wave 2 · 0\/1 done · 1 running/`은 목록이 20칸에서 잘려 성립할 수 없다. 테스트는 `/^Wave 2 · 0\/1 done/`을 쓴다. 설계 문서의 오류였고 테스트가 맞다.

## Memory Inputs

- `MEMORY.md`
- `docs/memory/goal-state.md` (worktreeId 결속, stale-worktree 상태 삭제)
- `docs/memory/lifecycle-install.md` (mod 설치 경로)
- Related completed plans: `docs/plan/claude-dag-panel.md`

## Model Guidance

- Applied model family: Claude.
- Referenced guidance: `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`
- User-visible response and artifact locale: 한국어. 코드·주석은 영어.

## Complexity Triage

- Selected path: Heavy Path.
- Selection rationale: 새 순수 모듈(터미널 그래프 배치·렌더러)이라는 새 추상화가 생기고, 패널이 읽는 root의 규칙(상태 무효화 포함)이 바뀐다.
- Checkpoint ledger:
  - Request checkpoint: Heavy 잠정. 근거는 새 렌더러와 범위가 열린 worktree 조사.
  - Planning checkpoint: Heavy 확정. 근거는 위 "Triage Findings". 새 모듈 `dag-term.mjs`, root 규칙 변경(W1~W7).
  - Code checkpoint: pending. 각 worker가 첫 수정 직전에 대상 파일·호출자·테스트를 확인하고 최종 보고에 적는다.
- Heavy Path signals checked:
  - New directory/module/layer: 새 모듈 있음(`claude-mod/hooks/dag-term.mjs`). 새 디렉터리는 없음.
  - New domain model/service/abstraction: 있음(터미널 셀 격자 배치, root 결정 규칙).
  - Security/auth/session: 없음.
  - External API/message queue/payment: 없음.
  - DB schema/migration: 없음.
  - Concurrency/transaction/cache invalidation: 있음(root 전환 때 저장된 `dag` 상태 무효화, 애니메이션 타이머).
  - Cross-domain refactor: 없음.
  - Explicit extra-care signal: 없음.
- Pre-implementation decisions (design이 정하고 main이 검토): 박스 배치 규칙과 최소 폭, 간선 문자와 애니메이션 방식·주기, 줄 안 구간 색 표현, 보기별 wave 머리글 수치, root 규칙, `$.state` shape 태그 변경 여부.

## Reasoning Effort Profile

- Heavy Path: design `fable`/`high`, implementation `opus`/`high`, final review `opus`/`xhigh`.
- 모든 dispatch는 Agent `model`·`effort`로 넘기고 `fork`는 쓰지 않는다.

## Agent Assignments

| Task | Agent | Route | model | dispatch effort |
| --- | --- | --- | --- | --- |
| `triage-plan` | main | heavy | 세션 모델 | 해당 없음(inline) |
| `heavy-design` | general-purpose (읽기 전용) | heavy | `fable` | `high` |
| `term-graph` | general-purpose (worker) | heavy | `opus` | `high` |
| `worktree-root` | general-purpose (worker) | heavy | `opus` | `high` |
| `wire-pane` | general-purpose (worker) | heavy | `opus` | `high` |
| `term-arrow` | general-purpose (worker) | heavy | `opus` | `high` |
| `box-title` | general-purpose (worker) | heavy | `opus` | `high` |
| `drop-deps` | general-purpose (worker) | heavy | `opus` | `high` |
| `review-fixes` | general-purpose (worker) | heavy | `opus` | `high` |
| `verify` | main + 읽기 전용 리뷰 agent | heavy | `opus` | `xhigh` |

Effective model: `heavy-design` `claude-fable-5-2`; `term-graph`, `worktree-root`, `box-title`, `drop-deps`, `review-fixes`, 리뷰 agent `claude-opus-5-5`; `term-arrow`, `wire-pane`은 agent가 모델 ID를 보고하지 않았다(`opus` 요청, unreported). 모든 dispatch는 Agent `model`·`effort`로 넘겼다.

## Tool Readiness

- Detected stack: javascript, typescript.
- Toolcheck command: `pota toolcheck --root <repo>` → node, npm, typescript-language-server, tsc 모두 OK (2026-11-18).
- Required verification tools: `node --test`, `npm run check`, `claude plugin validate claude-mod`, `claude plugin test claude-mod`(뒤 둘은 로컬 전용, CI에 없음).
- Missing tools: 없음.
- Install approval: not needed.

## Execution Guardrails

- Test contract first: 순수 로직은 `.mjs`에 두고 `node --test`로 검증한다. `register.tsx`는 배선만 한다.
- `claude-mod/` 아래에는 `test/` 디렉터리나 `*.test.mjs`를 두지 않는다(`node --test`가 집어 간다). 순수 모듈 테스트는 `test/claude-mod*.test.mjs`, 패널 테스트는 `claude-mod/tests/pane.test.tsx`.
- 순수 모듈 제약(`test/claude-mod.test.mjs` 2번): `node:`, `process`, `require(`, `import(`, `Date.now`, `setTimeout`, `Intl` 금지. import는 `./dag-*.mjs`만.
- 기존 테스트는 약화하거나 지우지 않는다. 계약 변경은 아래에 적은 것만 허용한다.
  - 계약 변경 1: `formatSummary`가 locale에 맞는 단어를 쓴다(ko에서 `완료`·`실행 중` 등). 9번 테스트의 ko 기대값이 바뀐다.
  - 계약 변경 2: 터미널 surface의 그래프가 `textRows` 줄 목록에서 박스 그래프로 바뀐다. `pane.test.tsx` "text rows on the terminal" 기대값이 바뀐다. 폭이 너무 좁을 때의 대체 표시는 설계가 정한다.
  - 계약 변경 3: root 규칙(W1~W6). `observedRoot` 관련 기대가 바뀔 수 있다.
- 외부 상태 변경 없음. dry-run 해당 없음.
- Verification loop budget: task당 2회.

## Module Tasks

### Task 0: planned triage and plan finalization

- Task ID: `triage-plan`
- Requested model / effort: 세션 모델 / inline
- Required evidence records: `planArtifact`, `triageDecision` (`pota plan check`로 묶는다).

### Task 1: Heavy 설계

- Task ID: `heavy-design` (kind `design`, route `heavy`)
- Requested model: `fable` / Requested reasoning effort: `high`
- Contract: 위 "Pre-implementation decisions"와 W1~W7의 수정 방법을 정해 함수 시그니처·자료 구조·테스트 계약 수준으로 반환한다. 읽기 전용. main이 `## Heavy Design`에 합친다.
- Depends on: `triage-plan`
- Write scope: `docs/plan/dag-terminal-graph.md`
- Required evidence records: `designRecord`

### Task 2: 터미널 박스 그래프 (순수 모듈)

- Task ID: `term-graph` (route `heavy`)
- Requested model: `opus` / Requested reasoning effort: `high`
- Contract: `## Heavy Design`의 터미널 그래프 절을 구현한다. 새 `dag-term.mjs`(+`.d.mts`), `dag-text.mjs`의 문구 수정.
- Depends on: `heavy-design`
- Write scope: `claude-mod/hooks/dag-term.mjs`, `claude-mod/hooks/dag-term.d.mts`, `claude-mod/hooks/dag-text.mjs`, `claude-mod/hooks/dag-text.d.mts`, `test/claude-mod-term.test.mjs`, `test/claude-mod.test.mjs`
- Module acceptance verification: `node --test test/claude-mod-term.test.mjs test/claude-mod.test.mjs`
- Surface integration verification: `claude plugin validate claude-mod`
- Tests: `node --test test/claude-mod-term.test.mjs test/claude-mod.test.mjs`

### Task 3: root 결정 규칙 (순수 모듈)

- Task ID: `worktree-root` (route `heavy`)
- Requested model: `opus` / Requested reasoning effort: `high`
- Contract: `## Heavy Design`의 worktree 절 중 순수 함수(goal 명령의 실행 root 계산, root 전환 때 상태 접기)를 구현한다.
- Depends on: `heavy-design`
- Write scope: `claude-mod/hooks/dag-events.mjs`, `claude-mod/hooks/dag-events.d.mts`, `test/claude-mod-root.test.mjs`
- Module acceptance verification: `node --test test/claude-mod-root.test.mjs`
- Surface integration verification: `claude plugin validate claude-mod`
- Tests: `node --test test/claude-mod-root.test.mjs`

### Task 4: 패널 배선

- Task ID: `wire-pane` (route `heavy`)
- Requested model: `opus` / Requested reasoning effort: `high`
- Contract: `register.tsx`가 터미널에서 박스 그래프를 그리고 새 root 규칙을 쓴다. 상태 계약(`types/index.d.ts`)과 패널 테스트를 맞춘다.
- Depends on: `term-graph`, `worktree-root`
- Write scope: `claude-mod/hooks/register.tsx`, `claude-mod/types/index.d.ts`, `claude-mod/tests/pane.test.tsx`
- Module acceptance verification: `claude plugin test claude-mod`
- Surface integration verification: `claude plugin validate claude-mod`
- Tests: `claude plugin test claude-mod`

### Task 4a–4d: 실행 중 추가된 task

`goal replan`으로 추가했다. 규칙은 위 `설계 변경 1`–`3`과 `리뷰 반영`에 있다. 두 게이트는 모두 `node --test test/claude-mod-term.test.mjs test/claude-mod.test.mjs test/claude-mod-root.test.mjs`(module acceptance)와 `claude plugin test claude-mod`(surface integration)다.

- `term-arrow`: 연결 화살표를 그래프 폭 가운데로, wave 제목을 별도 줄로.
- `box-title`: id와 제목을 다른 줄에 두고 제목을 최대 두 줄로 나눈다.
- `drop-deps`: 의존 관계 목록과 움직이는 점(500 ms 타이머)을 뺀다.
- `review-fixes`: 리뷰 지적 R1·R3·R4·R5·R7·R8·R9와 locale 의존 테스트 세 개. module acceptance에 `test/verification-contracts.test.mjs`, `test/cli-contract-hardening.test.mjs`를 더했다.

### Task 5: 검증과 리뷰

- Task ID: `verify`
- Contract: 전체 검사, diff 리뷰(읽기 전용 agent, `opus`/`xhigh`), 실제 터미널 pane 확인(사용자 화면), 필요한 문서·메모리 갱신.
- Depends on: `wire-pane`
- Write scope: `docs/plan/dag-terminal-graph.md`, `PLAN.md`, `docs/memory`, `README.md`, `README.ko.md`
- Module acceptance verification: `npm run check`
- Surface integration verification: `claude plugin validate claude-mod`
- Goal final check: `goal finish -- npm run check`

## Evidence

- Tool readiness: toolcheck 통과(위).
- Code checkpoint: route `heavy` 유지. 첫 편집 전에 `register.tsx`, `dag-text.mjs`, `dag-events.mjs`, `tests/pane.test.tsx`, `test/claude-mod.test.mjs`와 mod API d.ts를 확인했다.
- Tests: `node --test test/claude-mod-term.test.mjs test/claude-mod.test.mjs test/claude-mod-root.test.mjs` 50 pass, `claude plugin test claude-mod` 16 pass (2026-11-18, `review-fixes` 뒤).
- Module acceptance: 각 task에서 `goal verify`로 exit 0 기록.
- Surface integration: 각 task에서 `goal verify`로 exit 0 기록. `claude plugin validate claude-mod` exit 0(기존 author·icon 경고만).
- 리뷰: 읽기 전용 agent(`opus`/`xhigh`, `claude-opus-5-5`). 차단 0, 중요 2, 사소 7. `리뷰 반영` 표대로 고쳤고 R2는 알려진 한계로 남겼다. 박스 렌더러는 무작위 goal 3,000개, 폭 24~200에서 폭 초과·테두리 어긋남 없음.
- 기존 실패(이번 변경과 무관): 한국어 OS locale에서 `test/verification-contracts.test.mjs`, `test/cli-contract-hardening.test.mjs`, `test/packed-install.test.mjs`의 테스트 하나씩이 영어 문구를 기대해 실패했다. 테스트가 띄우는 프로세스에 `LC_ALL: "en_US.UTF-8"`을 주어 고쳤다(기대 문구와 `scripts/`는 그대로).
- 확인하지 못한 것: 실제 터미널 pane 화면(모호폭 문자 정렬), `$.session.cwd()`가 이전 Bash 호출의 `cd`를 따르는지(R2), `EnterWorktree` 직후 root 시점. 사용자 화면 확인이 남았다.
- 전체 검사: `npm run check` exit 0 (448 tests, `verify` task 증거). 첫 실행은 `PLAN.md` 완료 항목이 21개가 되어 색인 검사 1개가 실패했고, `pota plan index --archive`로 한 줄을 `docs/plan/ARCHIVE.md`로 옮긴 뒤 통과했다.
- Goal final review evidence record: `goal finish -- npm pack --dry-run` (`prepack`이 `npm run check`를 다시 실행한다).
- Memory promotion: 하지 않음. root 규칙과 터미널 배치는 코드 주석과 README에 있고, 다른 작업에서 다시 쓸 저장소 규칙이 새로 생기지 않았다.
- Verification pass count: task마다 1.

## Status

- [x] Planned
- [x] Implemented
- [x] Verified
