# Pota Harness

Pota Harness は Claude Code、Codex / ChatGPT Desktop、Antigravity CLI のためのトークン効率の高いマルチエージェント harness plugin です。

[English](README.md)

Pota の基本方針は、hooks、永続状態、明示的な planning、focused delegation、stop-time guards といった有用な agent harness の動作を残すことです。Pota は反復的な TDD verification loop を既定にしません。代わりに作業を小さな module task に分け、2 つの verification gate で証明します。

1. Module acceptance verification: 変更された module contract を証明します。
2. Surface integration verification: CLI、HTTP、browser、file artifacts など実際の surface を通して動作を証明します。

task が外部状態を変更する前に、Pota は最も近い dry-run または check mode を記録して実行します。verification は制限されます。既定では各 task は 2 回の verification pass を持ち、その後は反復 loop を続けず blocker を記録するか task を分割します。

Pota は tool readiness も作業の一部として扱います。LSP、typecheck、lint、dry-run、verification tools を repository stack に照らして確認します。installation は明示的な承認と固定された対応 installer がある場合だけ実行し、それ以外は blocker を報告します。

## Install

Pota は Claude Code、Codex(ChatGPT Desktop を含む)、Antigravity CLI の plugin です。この repository の root が plugin で、`main` branch がリリース版です。各 host は自分の plugin command で自分の copy を install・update・削除し、その copy がその host の runtime になります。hooks、skills、CLI はすべてその copy から実行されます。host ごとに version が違っていてもよく、Pota は version を互いに比較しません。`~/.pota/projects/` の goal state はすべての host で共有されます。

### Claude Code

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
```

session 内では `/plugin marketplace add comento/pota-harness` と `/plugin install pota@pota-harness` で同じことができます。Claude Code は third-party marketplace を既定では自動更新しないため、手動で update して session を再起動します。

```sh
claude plugin marketplace update pota-harness
claude plugin update pota@pota-harness
```

削除:

```sh
claude plugin uninstall pota@pota-harness
claude plugin marketplace remove pota-harness
```

### Codex

```sh
codex plugin marketplace add comento/pota-harness
```

続いて Codex TUI で:

1. `/plugins` を開き、`pota-harness` marketplace から `pota` を install して新しい session を始めます。
2. `/hooks` を開き、Pota の 5 つの hook を承認します。Codex は承認するまで plugin hook を実行せず、承認は hook の内容に結び付くため、update のたびに `/hooks` で承認し直す必要があります。承認しないと session に `Pota CLI:` 行が出ず、Pota skills が Pota hooks が無効だと伝えます。

plugin は local の `pota-dag` MCP server(`.codex-plugin/mcp.json`)も登録し、これが Codex と ChatGPT Desktop に [DAG パネル](#dag-panel)を表示します。

update は `codex plugin marketplace upgrade pota-harness` の後、`/hooks` で再び承認します。削除は `/plugins` で plugin を開き "Uninstall plugin" を選びます。この Codex の手順は Codex の文書と source に基づくもので、実際の Codex install ではまだ実行していません。

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

update は同じ command をもう一度実行します。Antigravity の文書では、再 install は install 済みの copy を置き換えると説明されています。削除は `agy plugin uninstall pota` です。`agy` 1.5.6 以上を推奨します。対応するのは Antigravity CLI だけで、Antigravity IDE には対応しません。plugin は local の `pota-dag` MCP server(root の `mcp_config.json`)も登録し、これが [DAG パネル](#dag-panel)を表示します。

### What each host gets

| | Claude Code | Codex / ChatGPT Desktop | Antigravity CLI |
| --- | --- | --- | --- |
| Skills | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory`, `$dag` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory`, `/dag` |
| Hooks | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | 同じ 5 つ(`/hooks` で承認した後) | SessionStart, PreInvocation(prompt context), PostToolUse, Stop。SubagentStop なし |
| Agents `explorer`, `worker` | あり(plugin agents `pota:explorer`, `pota:worker`) | role files(`skills/pota-work/roles/`)を orchestrator が dispatch prompt の先頭に入れる(Codex plugin は agent を登録できないため) | あり(plugin の `agents/`) |
| DAG パネル | mod pane。mod コマンド `/dag` で開く | MCP App(`pota-dag` server)。`$dag` で開く | MCP App(`pota-dag` server)。`/dag` で開く |

Antigravity の `invoke_subagent` での agent 名と Codex の role file 方式は、まだ実際の session で実行していません。確認したのは `agy plugin validate` が agent 2 つを処理することだけです。

### Coming from the npm install (1.x)

Pota 2.x は npm に公開せず、global な `pota` command もありません。npm package `@comento/pota-harness` はこの install 案内だけを表示する 1.5.0 が最後で、package は deprecated です。

1. Claude Code のみ: 先に `claude plugin uninstall pota@pota --scope user` で 1.x の plugin を削除します。
2. **使うすべての host に plugin を install します。** 下の削除は host ごとに行われ、1.x の install のまま残った host は、別の host の分が削除されたあとは upgrade(自動 upgrade を含む)が "Managed artifact was modified" で拒否され、更新できなくなります。
3. session を始めます。plugin の session start が 1.x の ownership manifest(`~/.pota/install/lifecycle.json`)を見つけると、その host の分の 1.x install を background process で削除し、そのことを知らせます。session を一度再起動してください。次の session が結果を一度だけ知らせます。共有の 1.x runtime、`~/.pota/update/`、manifest は、どの host の分も残っていなくなってから削除されます。

削除するのは、1.x manifest に記録され digest が変わっていない files・directories と、Codex の `config.toml` にある Pota 自身の sections だけです。`~/.pota/projects/`(goal state)、`~/.pota/config.json`、`~/.pota/tools/comment-checker/`、利用者が変更した files(残した項目として報告)、manifest にないもの、global npm package(`npm uninstall -g @comento/pota-harness` で削除)は残します。次の場合はその host で何も削除せず、理由を知らせます。

- host の path 上の directory が symlink の場合(`symlinked-path`。報告された path を手で削除します)
- host の登録を安全に解除できない場合(`host-unregister-failed`): `claude` CLI がない・失敗する場合、または Codex の `config.toml` で Pota の sections を安全に特定できない、書き直すと他の sections が変わる場合
- manifest が不正、schema が未対応、想定外の path を指す、または 1.x の install transaction が中断している場合(`manifest-invalid`、`manifest-unsupported-schema`、`target-outside-allowlist`、`transaction-pending`)。1.x を `CODEX_HOME`、`CLAUDE_HOME`、`ANTIGRAVITY_HOME`、`ANTIGRAVITY_CLI_HOME`、`CODEX_CONFIG_PATH` を指定して install した場合は、host にも同じ値を設定します。それ以外は、まだどの host の分も削除されていない間に限り `npx @comento/pota-harness@1.5.0 uninstall` を実行してから再起動します。

いずれかの host の分が削除されたあとは manifest を書き換えないため、1.x の uninstall は "Refusing to uninstall modified managed artifacts" で拒否します。その場合、拒否の通知は `doctor` が示す手動の項目を片付けてから、その host について `node "<pluginRoot>/scripts/pota.mjs" migrate run --host <host>` を実行するよう案内します。

拒否された削除は 24 時間後に再試行し、通知は 7 日に 1 回までです。1.3 より前の install には ownership manifest がなく触れないため、plugin を install する前に `npx @comento/pota-harness@1.5.0 uninstall` で削除します。状態を見る、または削除を手動で実行するには(`<pluginRoot>` は下で説明):

```sh
node "<pluginRoot>/scripts/pota.mjs" doctor
node "<pluginRoot>/scripts/pota.mjs" migrate status
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude --dry-run
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude
```

`POTA_LEGACY_MIGRATION=0`(`false`、`off`、`no` も可)で自動削除を無効にできます。1.x の名前は 2.x で次のとおりです。

| 1.x | 2.x |
| --- | --- |
| `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` | 上の表の host ごとの skill 名 |
| `/pota-toolcheck` | agent に `pota toolcheck` の実行を頼む |
| `/pota-doctor` | `pota doctor` |
| CLI の `install`、`upgrade`、`uninstall` command と自動 upgrade | 上の host plugin command。CLI はこの節への案内を出力して exit 2 で終わります |

### Running the Pota CLI

session が始まるたびに、その host の plugin copy にある `scripts/pota.mjs` の絶対 path を含む `Pota CLI:` 行が出て、agent はその path で Pota command を実行します。`<pluginRoot>` はその `scripts` directory の親で、host が新しい version を install すると path が変わります。この README の `pota <command>` は `node "<pluginRoot>/scripts/pota.mjs" <command>` を意味します。

## Complexity Triage

すべての implementation task は、agent、plugin、delegated workflow guidance を適用する前に complexity triage を通ります。triage は user に質問せず、repository exploration、想定される変更範囲、risk signals から決定します。

- Light Path: 既存 architecture layer 内の狭い変更です。既定値であり、直接実装するか 1 つの bounded `worker` を使い、その後 verification gate を維持します。
- Heavy Path: new directory/module/layer、new domain model/service/abstraction、security/session/auth、external API/message queue/payment、DB schema/migration、concurrency/transaction/cache changes、cross-domain refactor、または extra-care request です。

選択した path と理由は plan artifact がある場合に `docs/plan/<topic>.md` に記録します。Light Path でも 2 つの verification gate は維持されます。

Pota は各 task の model をその性質に応じて選びます。tier は 4 つで、host ごとに 1 つの値があり、reasoning effort も routing します。`MEMORY.md` または plan の `Model routing: inherited` は task ごとの model 選択を無効にします。

| Tier | 用途 | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- | --- |
| fast | read-only の探索と要約 | `haiku` | `gpt-6-luna` | `flash_lite` |
| balanced | Light の実装と通常の verification | `sonnet` | `gpt-6.1-terra` | `flash` |
| stronger | planning、triage、Heavy の実装、review、最終 verification | `opus` | `gpt-6-sol` | `pro` |
| strongest | Heavy の設計のみ | `fable` | `gpt-6-astra` | `pro` |

Antigravity では、既定の delegation ツール `invoke_subagent` は tier の値だけを受け取り effort option がないため、effort は `inherited` と記録されます。`swarm` ツールがある場合は、effort suffix を付けた具体的な model を任意で dispatch できます。Pota は実際の Antigravity session と `swarm` の model ID(Gemini、GPT-OSS、Claude の各 family)も gate のために同じ 4 つの tier に分類します。effort が適用されないまま(`inherited`、`not-applied`、または記録なし)assign された Heavy task は、`--allow-inherited-effort <reason>` を渡さない限り `goal task --status completed` でも `goal finish` でも完了できません。

delegate された subagent は、終了する前に final report を提出します。orchestrator がその final report と evidence を受け取った後、完了した subagent は、host に非破壊的な手段があれば close または release され、なければ kill せず idle のまま残します(Antigravity の `manage_subagents(kill)` を使うと `Cancelled` と表示されます)。その後 orchestrator は final report と evidence を review してから作業を完了とします。

## Tool Readiness

`pota toolcheck` は現在の repository から JavaScript、TypeScript、Python、PHP、Java、Kotlin、Swift、Go、Rust stacks を検出し、対応する LSP と verification tools を確認します。

```sh
pota toolcheck --root .
pota toolcheck --install --yes --root .
```

- `toolcheck` は detected stacks と missing tools を報告します。missing tool ごとに提案インストールコマンドまたは自動インストールできない理由を出力し、agent はインストールするかを一度だけ確認します。拒否された場合や非対話実行では blocker として記録します。
- `toolcheck --install` は明示的な承認と `--yes` を必要とし、非対応 installer は実行せず canonical `installer-unavailable` を返します。
- Pota plans は detected stack、required tools、install commands、blockers を記録します。
- LSP server がないことだけでは precise codebase exploration を省略できません。installation または同等の symbol-aware fallback を先に試す必要があります。

## Dry-Run And Loop Policy

- Migrations と database changes は write/apply commands の前に `--pretend`、dry-run、schema diff、rollback feasibility checks、または最も近い repository-native equivalent を使います。
- Package、release、infrastructure、deployment、code generation、formatting work は可能な場合、状態変更の前に check、plan、diff、validate、dry-run modes を使います。
- dry-run がない場合、plan はその事実を記録し、最小で reversible な command または test artifact を選びます。
- verification gate が失敗した場合、Pota は一度診断し、task を縮小または分割して両方の gate を再実行します。
- 同じ task で 2 回の verification pass が失敗した場合、反復 loop を続けず `docs/plan/<topic>.md` に blocker を記録します。

## Model Guidance

Pota は Claude-family と Codex-family models にのみ model-specific adjustment を適用します。

- Claude-family: long context、policy interpretation、plan/evidence review に有用です。
- Codex-family: small implementation tasks、explicit file edits、command-based verification、bounded `worker` tasks に有用です。

詳細はインストール済みプラグインの `pota://docs/model-guidance/README.md`、`pota://docs/model-guidance/claude.md`、`pota://docs/model-guidance/codex.md` にあります。

## Repository Artifacts

harness は対象 repository root に次の files を作成して維持します。

- `MEMORY.md`: persistent domain knowledge の短い index。`## Domain Knowledge` の下に note ごとに 1 行(`- [<name>](docs/memory/<name>.md): <summary>`)を置き、repository の `## Policy` も含みます。
- `docs/memory/*.md`: domain ごとの詳細 knowledge。各 note は H1 の下に 1 行の `Summary:`(120 文字以内)を置き、index と hook がそれを表示します。 note は `Summary:` の後に任意の `Paths:` 行を置けます。
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json`: 中断復旧と scoped stop gate に使う user-home の project/worktree 別 active goal/task/evidence 状態。project working tree は runtime state を所有しません。
- `PLAN.md`: work plans の短い index。`## Active Plans` と `## Completed Plans` の下に plan ごとに 200 文字以内の 1 行を置きます。planning rules は `PLAN.md` ではなく `pota-plan` skill にあります。
- `docs/plan/*.md`: detailed execution plans。
- `docs/plan/ARCHIVE.md`: `pota plan index --archive` が `PLAN.md` から移した古い completed entries を新しい順に保持し、legacy `## Planning Rules` section の本文を `## Legacy Planning Rules` の下に置きます。最初の `## ` 見出しより前の list 行は index 済みとして扱われます。
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl`: completed/cancelled goal ごとの要約 record(worktree ごとに最新 200 件)。`goal stats --history` が読みます。

`## Completed Plans` は新しい順に保ちます。`pota plan index --archive` は先頭 20 件を残し、残りを何も削除せずに `docs/plan/ARCHIVE.md` へ移すため、古い順に並べた list では最新の plans が archive されます。先に `--dry-run` で確認してください。既存の `MEMORY.md`/`PLAN.md` は migration なしで動作します。`init` は既存 file を書き換えず、`check` は古い形式を warning としてのみ報告します。

`SessionStart` で hook は、どの memory notes があるか(name と `Summary:`、list が長い場合は name だけの 1 行)を agent に知らせ、active goal がなければ plan index の 1 行(plan 数、active plans、最新の completed plans、存在すれば `docs/plan/ARCHIVE.md`)を追加します。active・paused・blocked goal や別 session が所有する goal がある場合は memory list だけを載せ、別 session の capsule に plan 名は出しません。goal がないときの `UserPromptSubmit` は note 数を伝える 1 文だけを追加します。hook は index files と directory listing だけを読み、note 本文は読まず、何も書き込みません。notes と plans がない repository の hook 出力は以前と同じです。

`pota-work` は `goal finish` の前に goal ごとに 1 回、memory promotion の決定を plan の Evidence に記録します。再利用できる repository knowledge ができた場合は `Memory promotion: docs/memory/<domain>.md`、そうでなければ `Memory promotion: none: <reason>` です。決定の記録は必須で、note の作成は任意です。goal が完了したのに plan file に記入済みの `Memory promotion:` 行がない場合、`goal finish` と `goal complete` は stderr に 1 行の reminder を出しますが、exit code と stdout は変わりません。

root files は短く保ち、詳細は `docs/` に移すことで、agents が必要な context だけを読めるようにします。

トークン効率のため、実装前に要件・不変条件・境界・失敗モードを test contract にします。`goal verify -- <argv>` の tool exit code を判定基準にし、成功は短く、失敗時だけ context を広げます。package lifecycle を確認し、通常の `npm pack --dry-run` を既定にします。content-producing または不明な script では `--ignore-scripts` を使わず、script がないか content-neutral と証明され、full-check evidence が新鮮な場合だけ使用します。

## Commands

以下の `pota <command>` は、session start の `Pota CLI:` 行に出た path で実行する `node "<pluginRoot>/scripts/pota.mjs" <command>` です([Running the Pota CLI](#running-the-pota-cli) を参照)。

- `pota doctor [--json]`: この plugin copy と `~/.pota` を読むだけの診断です。version、`pluginRoot`、Node.js(18 以上)、`POTA_HOME` に書き込めるか、この copy の 4 つの version surface が一致するか、必須 files、1.x install(`none`、`present <version>`、`blocked <reason>`)、host ごとの最後の削除 report(残した path と手動 command を含む)、comment-checker の状態を表示します。他の host の copy とは比較しません。check が失敗すると exit 1、usage error は exit 2 です。
- `pota migrate status|run [--host claude|codex|antigravity] [--all] [--dry-run] [--json]`: 1.x install の削除を手動で実行します。`status` は実行した場合の内容と最後の report を表示します。`run` には `--host <host>` か `--all`(plugin をまだ入れていない host も含むすべての host)が必要で、`--dry-run` は何も変えずに計画だけを表示します。削除が拒否されると exit 1、usage error は exit 2 です。
- `pota toolcheck`: repository stacks と required tools を確認し、承認済み supported installer だけを実行します。それ以外は `installer-unavailable` です。
- `pota cleanup --root <repo>`: 既定では legacy project-local `.pota` residue を read-only で報告します。`--yes` は valid active state を user-home store に移行・調整し、known state/lock/tool residue のみ削除し、unknown files を保持して空の場合だけ directory を削除します。
- `pota memory check|index [--root <repo>]`: `check` は `MEMORY.md` と `docs/memory/*.md` を照合して JSON report を 1 つ出力します。unindexed notes、dead links、duplicates、stale summaries、summary 内の制御文字、unsafe paths があれば exit 1 で、warnings は `--strict` のときだけ失敗します。entries は `## Domain Knowledge` の下の list 行です(その section がない古い file ではすべての list 行)。他の section の note link は言及であり、`index` は書き換えません。`index` は抜けている notes を追加し、`Summary:` が変わると link の後ろの summary 部分だけを置き換えます(link が複数ある行はそのまま)。その section 内で完全に一致する Pota placeholder 行だけを削除し、entries や dead links は削除せず、それ以外は byte 単位で保持します。`--dry-run` で事前確認できます。挿入位置が閉じていない code fence の中なら、`index` は何も書かず `unclosed-fence` で exit 1 になります。usage error は exit 2 で、subcommand なしの `pota memory` は従来の案内を出力します。
- `pota plan check|index [--archive] [--root <repo>]`: `PLAN.md` と `docs/plan/*.md` に同じ check と index を適用し、entries は見出しが `Plans` で終わる `## ` section(`## Superseded Plans` など)の list 行です。`index` は checkbox がすべて checked の plan を `## Completed Plans` の先頭に、それ以外を `## Active Plans` に追加します。行を移動するのは `--archive` だけで、最新 20 件を超える completed entries(インデントされた段落を含む)と legacy `## Planning Rules` section の本文を `docs/plan/ARCHIVE.md` へ移します。`check` は `## Completed Plans` が 20 件を超えるか legacy `## Planning Rules` section が残っていると warning を出します。
- `pota goal ...`: repository goal を管理します(`pota goal --help`)。`goal stats --history [--limit N]` は repository のすべての worktree で終了した goals を集計します。completed/cancelled 数、所要時間の median と p90、task と receipt の median、rerun rate、memory promotion の決定数、completed goal が 4 件以上のときの older/newer `trend`、最近の goals です。history がなければ `{"schemaVersion":1,"scope":"repository","goals":0}` を出力します。`completionCriteria`(`goal start --criteria`)は `advisory` です。Pota は記録するだけで強制せず、完了は required evidence だけで判定されます。`goal gate --task <id> --on|--off [--reason <text>]` は、active でも completed でもない task に手動の承認 gate を設定または解除します。gate の付いた task は自動では開始されず、続ける作業としても提示されません。`goal ready` はその task を `ready` ではなく `gated`(gate があるときだけ現れる key)の下に出力し、gate の付いた task しか残っていない場合、hook context は goal が user の承認を待っていると伝えます。gate を解除できるのは user だけで、`goal gate --off`、`goal task --task <id> --status active --approve-gate`、または DAG パネルから解除します。gate は共有の goal state に保存されるため、その repository で作業するすべての host が 2.3.0 以上を実行している場合にだけ強制されます。 `goal retry --task <id>` は `blocked` の task を `pending` に戻し、blocker、dispatch 記録(agent, effort, model, effective model, host)、その task の receipt を消して(完了には 2 つの検証を記録し直す必要があります)、orchestrator が新しい worker に dispatch できるようにします。route、kind、承認 gate、必須 evidence、他の task の receipt、completed の task は変わりません。その task の blocker で blocked になっていた goal は再び `active` になり、active な task がなければ準備できた最初の task が activate されます(gate 付きの task は待機のまま)。実行できる task がなければ、残った blocked task の理由で再び blocked になります。`goal block` で手動で blocked にした goal は retry では解除されず(`goal resume` が必要)、`paused` の goal は paused のままです。他の状態の task は拒否されます。
- `pota-memory`: domain knowledge を探索し `MEMORY.md` を更新します。
- `pota-plan`: `docs/plan/` に decision-complete plan を作成します。
- `pota-work`: 現在の `PLAN.md` の次の module task を実行し、2 つの verification gates を取得します。
- `pota-review`: plan、memory、evidence に照らして completed tasks を review します。
- `dag`: [DAG パネル](#dag-panel)を開くだけです。plan の作成、編集、goal state の変更は行いません。

Pota は `POTA_HOME`(既定 `~/.pota`)の下にだけ書き込み、自分の plugin copy の中には書き込みません。Codex は hook の承認を plugin の内容に結び付けるため、自分自身を変更した copy は承認を失います。host の plugin files は host 自身の plugin command だけが install・update・削除します。

## Pota Home And Settings

Pota は data を `POTA_HOME`(既定 `~/.pota`)の下に置き、すべての host の plugin copy が共有します。

```text
~/.pota/
  projects/                 goal state
  config.json               user settings ("commentChecker", "modelCeiling")
  tools/comment-checker/    comment-checker バイナリ(固定 release)
  migration/                1.x install 削除の report と状態
  hosts/antigravity/        Antigravity の session files(次の prompt を待つ hook message)
  hosts/antigravity-dag/    workspaces.json: DAG MCP App 用の最近 active だった workspace(Antigravity と Codex)
  install/, update/         1.x の npm install が残したもの。削除が終わるとなくなる
```

- 1.x の設定: `config.json` の `"autoUpgrade"` は無視します。Pota はもう自分で upgrade しません。
- コメントチェック: 編集が成功すると(Claude Code `Write`/`Edit`/`MultiEdit`、Codex `apply_patch` と編集ツール)、PostToolUse hook が変更内容を [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker)(MIT)で検査します。不要なコメントが報告されると `decision: "block"` を返し、エージェントにコメントの削除か必要な理由の説明を求めます。npm 依存は追加しません。host hook の session start が分離プロセスで現在のプラットフォーム(darwin/linux x64・arm64、windows x64)用の固定 v0.8.2 release をダウンロードし、固定 SHA256 を検証して OS の `tar` で `~/.pota/tools/comment-checker/` に展開します。ダウンロードに失敗すると、後の session start が backoff を置いて再試行します。ダウンロードが成功するまで編集は検査なしで通過し、チェッカーのエラーや 7 秒を超える検査も通過します。`pota doctor` が状態を 1 行で表示し、`POTA_COMMENT_CHECKER=0`(`false`、`off`、`no` も可)または `~/.pota/config.json` の `"commentChecker": false` で検査とダウンロードを両方無効にします。
- main model チェック: セッションの main model が stronger tier 未満の場合、`SessionStart` は `Pota main model:` 行と 1 回の通知を追加します。このとき計画・トリアージと最終レビューは stronger tier 以上に委任して記録する必要があり(レビューは `goal assign … --kind review`)、記録がなければ `triage-plan` の完了と `goal finish` は拒否されます。回避は `--allow-main-model <reason>` です。model 値がない、または認識できない場合は動作しません。`POTA_MAIN_MODEL_GATE=0` で無効にできます。
- model ceiling: アカウントで上位 tier を使えない、または使わない場合(サブスクリプション、組織ポリシー、usage credits)は `POTA_MODEL_CEILING=stronger`(または `balanced`。`opus` や `sonnet` などの model 名も可)を設定するか、`~/.pota/config.json` に `"modelCeiling": "stronger"` を書きます。環境変数が優先され、`config.json` はすべての hook と CLI 呼び出しが同じ値を読む場所です。設定すると `SessionStart` が `Pota model ceiling:` 行を追加し、ceiling より上の tier は ceiling tier の model を使い、Heavy 設計ゲートはその model を通し、main model チェックは ceiling 適用後の stronger tier を基準にします。設定がなければ動作は変わらず、無効な値は ceiling なしとして通知されます。
- 要求ブリーフとステアリング: Light・Heavy Path の計画は `## Request Brief`(元の要求、解釈した成果、スコープ、過去記録の参照(`Prior records`、`pota plan steering`)、前提、暗黙の要件、未解決の質問、ステアリング記録)を持ち、埋めるまでは `--allow-no-request-brief <reason>` を渡さない限り `triage-plan` の完了が拒否されます。ユーザーの訂正・追加・方向転換は `goal steer --kind <correction|addition|redirect> --reason <text>` で、task が変わる場合は `goal replan --steer <correction|addition|redirect|none> --reason <text>` で記録し、2 回目のステアリングまたは redirect では書き直した `Current request (as of S<n>)` も必要です。
- Claim receipt: goal が active の間に Stop gate が停止を block したとき(または loop guard が停止を通したとき)、最後の回答が完了や check の通過を主張していれば、hook はその主張を指す 1 文を追加し、agent がユーザーに訂正するか evidence を記録するようにします。停止の判断は変えず、code block、inline code、引用行は無視し、host の `last_assistant_message` field だけを読みます(Claude Code。Codex は documentation 上。Antigravity は渡しません)。`POTA_CLAIM_RECEIPT=0` で無効にします。
- Memory paths: `docs/memory` の note は `Summary:` 行の下に `Paths: <カンマ区切りのリポジトリ相対 path prefix または glob>` を置けます(最大 8 件。`*` は path の 1 区間、`**` は複数区間)。編集が成功した後、PostToolUse hook は編集した file に path が合う note を一度に最大 3 件、session・note ごとに 1 回通知し、残りは次の編集で通知します。`pota memory check` は不正な項目を `paths-invalid` と報告します。
- Heavy plan review: Heavy Path では `heavy-design` task も `planReview` evidence を必要とします。より強い tier の別の読み取り専用 reviewer は既定で承認し、repository の file で確認した blocker がある場合だけ差し戻します。再 review は 1 回で、その後は blocker とします。
- Escalation と learnings: 自分の tier で終えられない worker は final report を `ESCALATE: <reason>` で始め、orchestrator が 1 tier 上へ再 dispatch します(model ceiling で止まる)。worker は report を `LEARNINGS:` で終え、orchestrator はそれを plan の `## Learnings` に追記し、後続 task に渡し、memory promotion の判断に使います。

## DAG Panel

すべての host が、現在の Pota goal を wave ごとの列に分けた DAG パネルで表示します。Claude Code は独自の mod pane で描画します。2.3.0 以降、Antigravity と Codex / ChatGPT Desktop は、plugin の local `pota-dag` MCP server が提供する MCP App として同じパネルを表示します。パネルの構成は 3 つの host で共通です。

- 4 つのタブ: DAG(wave のグラフ。表示は前、現在、次、全体で、既定は全体)、Diff、Plan、Agents & Stats。
- Diff は working tree の変更 file を、追加・削除された行数とともに一覧表示します。read-only の Git コマンドだけを実行し、file の内容は表示しません。secret らしい path(`.env*`、`service-account*.json`、key や certificate の file など)は sensitive と表示され、link になりません。
- Plan は active plan の概要(title、goal、現在の要求、checklist の進捗)を表示します。
- Agents & Stats は、各 task に記録された agent、model、effort と、repository の最近の goals を表示します。Antigravity では session transcript から実際の model、effort、token 数が加わります。
- node を選ぶと inspector が開き、その task の evidence receipt と `writeScope` の diff stat を表示します。
- コントロールで goal を pause・resume でき、task の手動の承認 gate を on/off できます([Commands](#commands) の `pota goal gate` を参照)。
- blocked な task の inspector には Retry ボタンがあります。押すと `goal retry --task <id>`(MCP App は app 専用の `pota_dag_action` の `retry_task`)が実行され、task が `pending` に戻り、receipt が消えます。パネルは worker を直接起動せず、orchestrator が再試行された task を新しい worker に dispatch して `goal assign` を記録し直します。

### Claude Code (mod)

mod 機能のある Claude Code が必要です(Claude Code 2.1.325 の mod API を基準に作成)。ターミナルのようにグラフを描けない surface では文字の一覧で表示します。

- `/dag [previous|current|next|all|dag|diff|plan|stats|refresh|close]` で、その表示またはタブでパネルを開きます。完了した接続は実線、進行中の接続は点線と移動する点です。
- `pota goal start` と `pota goal replan` の後に自動で一度だけ開きます。閉じると、同じ goal では再び開きません。
- goal コマンドの実行時と 30 秒ごとに goal の状態を読み直して更新します。
- 実行中の task を選ぶと、その task を担当する subagent の会話が開きます。main session が自分で行う task と、切り替える main view がない surface(デスクトップアプリ)のすべての task では、代わりに pane 内の inspector が開きます。

### Antigravity and Codex / ChatGPT Desktop (MCP App)

- `pota-dag` server は plugin が登録し(Antigravity: root の `mcp_config.json`、Codex / ChatGPT Desktop: `.codex-plugin/mcp.json`)、依存なしで `scripts/pota-dag-mcp.mjs` を stdio で実行します。
- agent は `goal start` の直後と active goal を再開するときに `open_pota_dag` ツールを呼び出します。自分でパネルを開くには `dag` skill を使います。Antigravity では `/dag`、Codex では `$dag` です(Codex plugin は slash command を登録できません)。Antigravity はパネルを sidebar の項目と補助 pane としても提供します。
- `open_pota_dag` が model に返すのは小さな要約だけで、パネルは data を自分で読み込みます。pause、resume、gate のコントロールは、Pota hooks が最近 active だったと記録した workspace(`~/.pota/hosts/antigravity-dag/workspaces.json`)でだけ動作します。
- inspector は、agent に task の review を依頼する follow-up message を会話に送れます。
- Antigravity で server が停止している場合、agent は `node "<pluginRoot>/scripts/pota-dag-mcp.mjs" ensure` を実行して一度だけ再試行します。パネルが使えなくても作業は妨げられません。

## Antigravity Compatibility

Pota は Antigravity CLI(`agy`)に対応し、Antigravity IDE には対応しません。plugin の manifest は root の `plugin.json`、hooks は root の `hooks.json` で、hook は plugin folder で `scripts/pota-state-antigravity.mjs` を実行します。この adapter が Antigravity の events を Pota の hooks に対応させます。

- `SessionStart` は session capsule と `Pota CLI:` 行を追加します。
- Antigravity には prompt event がないため、prompt ごとの最初の `PreInvocation` が prompt context を追加します。
- `write_to_file`、`replace_file_content`、`multi_replace_file_content` の `PostToolUse` は comment checker と goal reminder を実行し、結果は次の `PreInvocation` で追加されます。
- `Stop` は active goal に未完了の task があれば agent に作業を続けさせます。`SubagentStop` はありません。

skills は `/pota-plan`、`/pota-work`、`/pota-review`、`/pota-memory`、`/dag` で呼び出します。workflows は Antigravity plugin の構成要素ではありません。root の `mcp_config.json` は [DAG パネル](#dag-panel)用の `pota-dag` MCP server を登録します。adapter は Antigravity の hook 文書に基づくもので、実際の `agy` session 内での動作はまだ確認していません。

## Locale Policy

Pota の reusable instructions は global use のため英語で書かれています。user-visible output と生成または更新される documentation、plans、memory artifacts は、user が別の language を指定しない限り configured OS locale に従います。これには `MEMORY.md`、`PLAN.md`、`docs/memory`、`docs/plan` の内容が含まれます。CLI は `en`、`ko`、`ja`、`zh`、`es`、`fr`、`de`、`pt` の common messages を localize し、unsupported locales は English に fallback します。Codex hook `statusMessage` text は static English のまま、hook command output は English または Korean です。

## Delegation

- `explorer`: 利用可能な場合、read-only codebase discovery、impact analysis、pattern search、read-only verification を処理します。
- `worker`: 明確な file ownership を持つ bounded implementation または verification task を処理します。
- Main session: 次の step が結果に即座に依存する urgent blocking work を local で処理します。

すべての delegation prompt は TASK、EXPECTED OUTCOME、REQUIRED TOOLS、MUST DO、MUST NOT DO、CONTEXT の 6 sections を使います。
