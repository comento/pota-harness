# Pota Harness

Pota Harness 是面向 Codex、Claude Code 和 Antigravity 的高 token 效率 multi-agent harness plugin。

[English](README.md)

Pota 的核心思路是保留有用的 agent harness 行为：hooks、persistent state、explicit planning、focused delegation 和 stop-time guards。Pota 不把重复的 TDD verification loops 作为默认流程，而是把工作拆成小的 module tasks，并用两个 verification gates 证明每个 task。

1. Module acceptance verification: 证明被修改的 module contract。
2. Surface integration verification: 通过 CLI、HTTP、browser 或 file artifacts 等真实 surface 证明行为。

在 task 修改外部状态之前，Pota 会记录并运行最接近的 dry-run 或 check mode。verification 是有边界的：默认每个 task 有两次 verification pass，然后 agent 会记录 blocker 或拆分 task，而不是继续开放式循环。

Pota 也把 tool readiness 视为工作的一部分。它会根据 repository stack 检查 LSP、typecheck、lint、dry-run 和 verification tools。只有在获得明确批准且存在固定版本的受支持 installer 时才安装，否则报告 blocker。

## Install

Pota 是 Claude Code、Codex 和 Antigravity CLI 的 plugin。本 repository 的根目录就是 plugin，`main` branch 就是发布版本。每个 host 用自己的 plugin 命令安装、更新和删除自己的副本，这个副本就是该 host 的 runtime：hooks、skills 和 CLI 都从它运行。不同 host 上的版本可以不同，Pota 不会互相比较。`~/.pota/projects/` 中的 goal state 由所有 host 共享。

### Claude Code

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
```

在 session 内，相同的步骤是 `/plugin marketplace add comento/pota-harness` 和 `/plugin install pota@pota-harness`。Claude Code 默认不会自动更新第三方 marketplace，因此需要手动更新并重启 session：

```sh
claude plugin marketplace update pota-harness
claude plugin update pota@pota-harness
```

删除：

```sh
claude plugin uninstall pota@pota-harness
claude plugin marketplace remove pota-harness
```

### Codex

```sh
codex plugin marketplace add comento/pota-harness
```

然后在 Codex TUI 中：

1. 打开 `/plugins`，从 `pota-harness` marketplace 安装 `pota`，然后开始新的 session。
2. 打开 `/hooks`，批准 Pota 的 5 个 hook。Codex 在批准之前不会运行 plugin hook，而且批准与 hook 内容绑定，所以每次更新后都要在 `/hooks` 中重新批准。未批准时 session 中不会出现 `Pota CLI:` 行，Pota skills 会告诉你 Pota hooks 未生效。

更新：运行 `codex plugin marketplace upgrade pota-harness`，然后在 `/hooks` 中重新批准。删除：在 `/plugins` 中打开该 plugin，选择 "Uninstall plugin"。这些 Codex 步骤依据 Codex 文档和源码，尚未在真实的 Codex 安装上运行过。

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

更新时再次运行同一命令；Antigravity 文档说明重新安装会替换已安装的副本。删除用 `agy plugin uninstall pota`。建议使用 `agy` 1.5.6 或更高版本。只支持 Antigravity CLI，不支持 Antigravity IDE。

### What each host gets

| | Claude Code | Codex | Antigravity CLI |
| --- | --- | --- | --- |
| Skills | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` |
| Hooks | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | 同样 5 个(在 `/hooks` 中批准后) | SessionStart, PreInvocation(prompt context), PostToolUse, Stop；没有 SubagentStop |
| Agents `explorer`, `worker` | 有 | 无 | 无 |
| DAG 面板(mod) | 有 | 无 | 无 |

### Coming from the npm install (1.x)

Pota 2.x 不发布到 npm，也没有全局 `pota` 命令。npm package `@comento/pota-harness` 的最后版本是只显示这些安装说明的 1.5.0，该 package 已标记为 deprecated。

1. 仅 Claude Code：先用 `claude plugin uninstall pota@pota --scope user` 删除 1.x plugin。
2. **在你使用的每个 host 上安装 plugin。** 下面的删除按 host 进行，留在 1.x 安装上的 host 在其他 host 的部分被删除后无法再升级：它的升级(包括自动升级)会以 "Managed artifact was modified" 拒绝。
3. 开始一个 session。plugin 的 session start 找到 1.x ownership manifest(`~/.pota/install/lifecycle.json`)时，会在后台进程中删除该 host 那一部分 1.x 安装，并给出提示；请重启一次 session。下一个 session 会报告一次结果。共享的 1.x runtime、`~/.pota/update/` 和 manifest 只在所有 host 的部分都删除后才删除。

删除只针对 1.x manifest 记录且 digest 未变的文件和目录，以及 Codex `config.toml` 中 Pota 自己的 sections。保留 `~/.pota/projects/`(goal state)、`~/.pota/config.json`、`~/.pota/tools/comment-checker/`、你修改过的文件(作为保留项报告)、manifest 未记录的一切，以及全局 npm package(用 `npm uninstall -g @comento/pota-harness` 删除)。以下情况不会删除该 host 的任何内容，并说明原因：

- host 路径上的某个目录是 symlink(`symlinked-path`；手动删除报告中列出的路径)；
- 无法安全地注销 host 注册(`host-unregister-failed`)：`claude` CLI 不存在或失败，或 Codex `config.toml` 中的 Pota sections 无法安全识别、重写会改变其他 sections；
- manifest 无效、schema 不受支持、指向预期路径之外，或 1.x 安装 transaction 被中断(`manifest-invalid`、`manifest-unsupported-schema`、`target-outside-allowlist`、`transaction-pending`)。如果安装 1.x 时设置了 `CODEX_HOME`、`CLAUDE_HOME`、`ANTIGRAVITY_HOME`、`ANTIGRAVITY_CLI_HOME` 或 `CODEX_CONFIG_PATH`，请为 host 设置相同的值。否则，仅在还没有任何 host 的部分被删除时，运行 `npx @comento/pota-harness@1.5.0 uninstall` 后重启。

只要有一个 host 的部分已被删除，由于 manifest 不会被改写，1.x 的 uninstall 会以 "Refusing to uninstall modified managed artifacts" 拒绝。这时拒绝提示会让你先处理 `doctor` 列出的手动项，再为该 host 运行 `node "<pluginRoot>/scripts/pota.mjs" migrate run --host <host>`。

被拒绝的删除会在 24 小时后重试，提示最多每 7 天一次。1.3 之前的安装没有 ownership manifest，不会被处理；请在安装 plugin 之前用 `npx @comento/pota-harness@1.5.0 uninstall` 删除它。查看状态或手动执行删除(`<pluginRoot>` 见下文)：

```sh
node "<pluginRoot>/scripts/pota.mjs" doctor
node "<pluginRoot>/scripts/pota.mjs" migrate status
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude --dry-run
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude
```

`POTA_LEGACY_MIGRATION=0`(也可用 `false`、`off`、`no`)关闭自动删除。1.x 名称在 2.x 中对应如下：

| 1.x | 2.x |
| --- | --- |
| `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` | 上表中各 host 的 skill 名称 |
| `/pota-toolcheck` | 请 agent 运行 `pota toolcheck` |
| `/pota-doctor` | `pota doctor` |
| CLI 的 `install`、`upgrade`、`uninstall` 命令和自动升级 | 上面的 host plugin 命令；CLI 现在输出指向本节的提示并以 exit 2 结束 |

### Running the Pota CLI

每次 session 开始时都会输出一行 `Pota CLI:`，其中是该 host plugin 副本里 `scripts/pota.mjs` 的绝对路径，agent 用这个路径运行 Pota 命令。`<pluginRoot>` 是那个 `scripts` 目录的上级目录；host 安装新版本时路径会改变。本 README 中的 `pota <command>` 指 `node "<pluginRoot>/scripts/pota.mjs" <command>`。

## Complexity Triage

每个 implementation task 都先经过 complexity triage，然后才应用 agent、plugin 或 delegated workflow guidance。triage 根据 repository exploration、expected change scope 和 risk signals 判断，不向用户询问可发现的信息。

- Light Path: existing architecture layers 内的窄范围修改。这是默认路径。可以直接实现，或使用一个 bounded `worker`，然后保留 verification gate。
- Heavy Path: new directory/module/layer、new domain model/service/abstraction、security/session/auth、external API/message queue/payment、DB schema/migration、concurrency/transaction/cache changes、cross-domain refactor，或明确的 extra-care request。

选中的 path 和理由会在存在 plan artifact 时记录在 `docs/plan/<topic>.md`。即使是 Light Path，也保留两个 verification gates。

## Tool Readiness

`pota toolcheck` 会检查当前 repository 中的 JavaScript、TypeScript、Python、PHP、Java、Kotlin、Swift、Go 和 Rust stacks，然后检查匹配的 LSP 和 verification tools。

```sh
pota toolcheck --root .
pota toolcheck --install --yes --root .
```

- `toolcheck` 报告 detected stacks 和 missing tools。它会为每个 missing tool 输出建议的安装命令或无法自动安装的原因，agent 会询问一次是否安装；如果被拒绝或处于非交互运行，则记录为 blocker。
- `toolcheck --install` 要求明确批准和 `--yes`；不受支持的 installer 不会执行，并返回 canonical `installer-unavailable`。
- Pota plans 会记录 detected stack、required tools、install commands 和 blockers。
- 缺少 LSP server 不能作为跳过 precise codebase exploration 的理由，除非已尝试 installation 或等价的 symbol-aware fallback。

## Dry-Run And Loop Policy

- Migrations 和 database changes 在 write/apply commands 前使用 `--pretend`、dry-run、schema diff、rollback feasibility checks 或最接近的 repository-native equivalent。
- Package、release、infrastructure、deployment、code generation 和 formatting work 在可用时，先使用 check、plan、diff、validate 或 dry-run modes，再修改状态。
- 如果没有 dry-run，plan 会记录该事实，并选择最小且可逆的 command 或 test artifact。
- 如果 verification gate 失败，Pota 会诊断一次，缩小或拆分 task，然后重新运行两个 gates。
- 同一 task 两次 verification pass 失败后，Pota 会在 `docs/plan/<topic>.md` 中记录 blocker，而不是继续重复循环。

## Model Guidance

Pota 只对 Claude-family 和 Codex-family models 应用 model-specific adjustment。

- Claude-family: 适合 long context、policy interpretation 和 plan/evidence review。
- Codex-family: 适合 small implementation tasks、explicit file edits、command-based verification 和 bounded `worker` tasks。

详细指南位于已安装插件的 `pota://docs/model-guidance/README.md`、`pota://docs/model-guidance/claude.md` 和 `pota://docs/model-guidance/codex.md`。

## Repository Artifacts

harness 会在目标 repository root 创建并维护这些文件。

- `MEMORY.md`: persistent domain knowledge 的短索引。在 `## Domain Knowledge` 下每个 note 一行(`- [<name>](docs/memory/<name>.md): <summary>`)，并包含 repository 的 `## Policy`。
- `docs/memory/*.md`: 按 domain 记录的详细 knowledge。每个 note 在 H1 下有一行 `Summary:`(不超过 120 个字符)，索引和 hook 会显示它。
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json`: user-home 中按 project/worktree 隔离的 active goal/task/evidence 状态，用于中断恢复和 scoped stop gate。project working tree 不拥有 runtime state。
- `PLAN.md`: work plans 的短索引。在 `## Active Plans` 和 `## Completed Plans` 下每个 plan 一行，不超过 200 个字符。planning rules 位于 `pota-plan` skill，而不在 `PLAN.md` 中。
- `docs/plan/*.md`: detailed execution plans。
- `docs/plan/ARCHIVE.md`: 按从新到旧保存 `pota plan index --archive` 从 `PLAN.md` 移出的较旧 completed 条目，并把 legacy `## Planning Rules` section 的正文放在 `## Legacy Planning Rules` 下。第一个 `## ` 标题之前的列表行仍视为已索引。
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl`: 每个 completed 或 cancelled goal 一条摘要记录(每个 worktree 保留最新 200 条)，供 `goal stats --history` 读取。

`## Completed Plans` 保持从新到旧排列。`pota plan index --archive` 保留前 20 条，把其余条目移到 `docs/plan/ARCHIVE.md` 且不删除任何内容；如果列表按从旧到新排列，被归档的会是最新的 plans。请先用 `--dry-run` 预览。现有 `MEMORY.md`/`PLAN.md` 无需迁移即可使用：`init` 不会重写已有文件，`check` 只以 warning 报告旧格式。

在 `SessionStart`，hook 会告诉 agent 有哪些 memory notes(name 和 `Summary:`，列表过长时改为只列 name 的一行)；没有 active goal 时，还会添加一行 plan 索引摘要(plan 数量、active plans、最近 completed plans，以及存在时的 `docs/plan/ARCHIVE.md`)。存在 active、paused、blocked 或其他 session 拥有的 goal 时，只附加 memory 列表，其他 session 的 capsule 绝不显示 plan 名称。没有 goal 时的 `UserPromptSubmit` 只增加一句 note 数量提示。hook 只读取索引文件和目录列表，不读取 note 正文，也不写入任何内容；没有 notes 和 plans 的 repository，hook 输出与以前相同。

`pota-work` 在 `goal finish` 之前，每个 goal 在 plan 的 Evidence 中记录一次 memory promotion 决定：产生了可复用的 repository knowledge 时写 `Memory promotion: docs/memory/<domain>.md`，否则写 `Memory promotion: none: <reason>`。记录决定是必需的，编写 note 是可选的。goal 完成但 plan 文件中没有已填写的 `Memory promotion:` 行时，`goal finish` 和 `goal complete` 会在 stderr 输出一行提醒，exit code 和 stdout 不变。

root files 保持简短，细节移到 `docs/` 下，让 agents 只读取当前任务需要的 context。

为节省 token，先把需求、不变量、边界和失败模式写成 test contract。以 `goal verify -- <argv>` 的 tool exit code 为判定依据，成功时保持简短，只在失败时扩展 context。检查 package lifecycle，并默认运行正常的 `npm pack --dry-run`。content-producing 或未知 script 不得使用 `--ignore-scripts`；只有 script 不存在或已证明为 content-neutral，且 full-check evidence 仍然新鲜时才可使用。

## Commands

下面的 `pota <command>` 指用 session start 的 `Pota CLI:` 行中的路径运行的 `node "<pluginRoot>/scripts/pota.mjs" <command>`(见 [Running the Pota CLI](#running-the-pota-cli))。

- `pota doctor [--json]`: 对此 plugin 副本和 `~/.pota` 的只读诊断：版本、`pluginRoot`、Node.js(18 或更高)、`POTA_HOME` 是否可写、此副本的 4 个版本表面是否一致、必需文件、1.x 安装(`none`、`present <version>` 或 `blocked <reason>`)、每个 host 的最后一次删除报告(含保留路径和手动命令)以及 comment-checker 状态。不与其他 host 的副本比较。检查失败时 exit 1，用法错误 exit 2。
- `pota migrate status|run [--host claude|codex|antigravity] [--all] [--dry-run] [--json]`: 手动执行 1.x 安装的删除。`status` 显示运行时会做什么以及最后的报告；`run` 需要 `--host <host>` 或 `--all`(所有 host，包括尚未安装 plugin 的 host)，`--dry-run` 只显示计划而不做任何改变。删除被拒绝时 exit 1，用法错误 exit 2。
- `pota toolcheck`: 检测 repository stacks 和 required tools；只执行已批准的 supported installer，否则返回 `installer-unavailable`。
- `pota cleanup --root <repo>`: 默认只读报告 legacy project-local `.pota` residue。`--yes` 将 valid active state 迁移/协调到 user-home store，只删除 known state/lock/tool residue，保留 unknown files，并且仅在目录为空时清理目录。
- `pota memory check|index [--root <repo>]`: `check` 对照 `MEMORY.md` 与 `docs/memory/*.md` 并输出一个 JSON 报告；存在 unindexed notes、dead links、duplicates、stale summaries、summary 中的控制字符或 unsafe paths 时 exit 1，warnings 仅在 `--strict` 下失败。条目是 `## Domain Knowledge` 下的列表行(没有该 section 的旧文件则为所有列表行)；其他 section 中的 note 链接只是提及，`index` 不会改写。`index` 添加缺失的 notes，`Summary:` 变化时只替换链接后的 summary 部分(含多个链接的行保持原样)；只删除该 section 内完全匹配的 Pota placeholder 行，不删除条目或 dead links，其余内容逐字节保留。可用 `--dry-run` 预览。插入位置位于未闭合的 code fence 内时，`index` 不写入任何内容，并以 `unclosed-fence` exit 1。用法错误 exit 2；不带子命令的 `pota memory` 仍输出原有指引。
- `pota plan check|index [--archive] [--root <repo>]`: 对 `PLAN.md` 和 `docs/plan/*.md` 执行相同的检查和索引，条目是标题以 `Plans` 结尾的 `## ` section(如 `## Superseded Plans`)中的列表行。`index` 把 checkbox 全部勾选的 plan 放到 `## Completed Plans` 顶部，其他 plan 放到 `## Active Plans`；只有 `--archive` 会移动行：把超出最新 20 条的 completed 条目(连同缩进段落)和 legacy `## Planning Rules` section 的正文移到 `docs/plan/ARCHIVE.md`。`## Completed Plans` 超过 20 条或仍有 legacy `## Planning Rules` section 时，`check` 会给出 warning。
- `pota goal ...`: 管理 repository goal(`pota goal --help`)。`goal stats --history [--limit N]` 汇总 repository 所有 worktree 中已结束的 goals：completed/cancelled 数量、耗时的中位数和 p90、task 与 receipt 的中位数、rerun rate、memory promotion 决定数、completed goal 达到 4 个后的 older/newer `trend`，以及最近的 goals；没有历史时输出 `{"schemaVersion":1,"scope":"repository","goals":0}`。`completionCriteria`(`goal start --criteria`)是 `advisory`：Pota 只记录不强制，完成只由 required evidence 判定。
- `pota-memory`: 探索 domain knowledge 并更新 `MEMORY.md`。
- `pota-plan`: 在 `docs/plan/` 下创建 decision-complete plan。
- `pota-work`: 执行当前 `PLAN.md` 中的下一个 module task，并收集两个 verification gates。
- `pota-review`: 根据 plan、memory 和 evidence review completed tasks。

Pota 只在 `POTA_HOME`(默认 `~/.pota`)下写入，从不写入自己的 plugin 副本。Codex 把 hook 批准绑定到 plugin 内容，修改了自身的副本会失去批准。host 的 plugin 文件只由 host 自己的 plugin 命令安装、更新和删除。

## Pota Home And Settings

Pota 把数据放在 `POTA_HOME`(默认 `~/.pota`)下，由所有 host 的 plugin 副本共享。

```text
~/.pota/
  projects/                 goal state
  config.json               user settings ("commentChecker", "modelCeiling")
  tools/comment-checker/    comment-checker 二进制(固定 release)
  migration/                1.x 安装删除的报告和状态
  hosts/antigravity/        Antigravity session 文件(等待下一个 prompt 的 hook 消息)
  install/, update/         1.x npm 安装留下的内容，删除完成后消失
```

- 1.x 设置: 忽略 `config.json` 中的 `"autoUpgrade"`；Pota 不再自行升级。
- 注释检查: 编辑成功后(Claude Code `Write`/`Edit`/`MultiEdit`、Codex `apply_patch` 和编辑工具)，PostToolUse hook 用 [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker)(MIT)检查改动内容；报告不必要的注释时返回 `decision: "block"`，让 agent 删除注释或说明其必要性。不添加 npm 依赖: host hook 的 session start 在分离进程中下载当前平台(darwin/linux x64 和 arm64、windows x64)的固定 v0.8.2 release，校验固定的 SHA256，并用系统 `tar` 解压到 `~/.pota/tools/comment-checker/`。下载失败时，之后的 session start 会按 backoff 重试。下载成功前编辑不经检查直接通过，检查器出错或检查超过 7 秒也会通过。`pota doctor` 用一行显示其状态；`POTA_COMMENT_CHECKER=0`(也可用 `false`、`off`、`no`)或 `~/.pota/config.json` 中的 `"commentChecker": false` 同时关闭检查和下载。
- main model 检查: 当会话的 main model 低于 stronger tier 时,`SessionStart` 会添加一行 `Pota main model:` 和一次性通知。此时计划/分诊和最终评审必须委派给 stronger tier 或更高并记录(评审使用 `goal assign … --kind review`),否则 `triage-plan` 的完成和 `goal finish` 会被拒绝;绕过方式是 `--allow-main-model <reason>`。model 值缺失或无法识别时不生效。设置 `POTA_MAIN_MODEL_GATE=0` 可关闭。
- model ceiling: 当账户不能或不打算使用更高的 tier 时(订阅等级、组织策略、usage credits),设置 `POTA_MODEL_CEILING=stronger`(或 `balanced`;也可以写 `opus`、`sonnet` 等 model 名),或在 `~/.pota/config.json` 中写入 `"modelCeiling": "stronger"`。环境变量优先,`config.json` 是所有 hook 和 CLI 调用都会读取的同一位置。设置后 `SessionStart` 会添加一行 `Pota model ceiling:`,高于 ceiling 的 tier 使用 ceiling tier 的 model,Heavy 设计门禁接受该 model,main model 检查以应用 ceiling 后的 stronger tier 为准。未设置时行为不变;无效值不应用 ceiling 并给出提示。
- 请求契约与 steering: Light 和 Heavy Path 计划包含 `## Request Brief`(原始请求、解读的结果、范围、过往记录参考(`Prior records`,`pota plan steering`)、假设、隐含需求、未决问题、steering 记录),填写完成之前,除非传入 `--allow-no-request-brief <reason>`,否则 `triage-plan` 的完成会被拒绝。用户的更正、补充和方向变更用 `goal steer --kind <correction|addition|redirect> --reason <text>` 记录,task 发生变化时用 `goal replan --steer <correction|addition|redirect|none> --reason <text>` 记录;第二次 steering 或 redirect 还需要重写 `Current request (as of S<n>)`。

## Claude Code DAG Panel

Claude Code 桌面版会把当前 Pota goal 显示为按 wave 分列的 DAG 面板。它仅适用于 Claude Code,Codex 和 Antigravity 没有此功能。需要支持 mod 功能的 Claude Code(基于 Claude Code 2.1.325 的 mod API 编写);在终端等无法绘制图形的 surface 上改为文字列表。

- 用 `/dag [previous|current|next|all|refresh|close]` 打开面板。视图有上一个、当前、下一个、全部。默认是全部(all)视图,其余为可选项。已完成的连线为实线,进行中的连线为虚线并带移动的点。
- 在 `pota goal start` 和 `pota goal replan` 之后自动打开一次。关闭后,同一个 goal 不会再自动打开。
- 每次执行 goal 命令时以及每 30 秒重新读取 goal 状态并刷新。

## Antigravity Compatibility

Pota 支持 Antigravity CLI(`agy`)，不支持 Antigravity IDE。plugin 的 manifest 是根目录的 `plugin.json`，hooks 是根目录的 `hooks.json`，hook 在 plugin 目录中运行 `scripts/pota-state-antigravity.mjs`。这个 adapter 把 Antigravity 的 events 对应到 Pota 的 hooks：

- `SessionStart` 加入 session capsule 和 `Pota CLI:` 行。
- Antigravity 没有 prompt event，因此每个 prompt 的第一个 `PreInvocation` 加入 prompt context。
- `write_to_file`、`replace_file_content`、`multi_replace_file_content` 的 `PostToolUse` 运行 comment checker 和 goal 提醒，结果在下一个 `PreInvocation` 加入。
- 活动 goal 还有未完成的 task 时，`Stop` 让 agent 继续工作。没有 `SubagentStop`。

skills 以 `/pota-plan`、`/pota-work`、`/pota-review`、`/pota-memory` 调用；workflows 不是 Antigravity plugin 的组成部分。adapter 依据 Antigravity 的 hook 文档实现，在真实 `agy` session 中的行为尚未验证。

## Locale Policy

Pota 的 reusable instructions 为了 global use 使用英文编写。除非用户明确要求其他语言，user-visible output 以及生成或更新的 documentation、plans、memory artifacts 应遵循 configured OS locale。这包括 `MEMORY.md`、`PLAN.md`、`docs/memory` 和 `docs/plan` 内容。CLI 会本地化 `en`、`ko`、`ja`、`zh`、`es`、`fr`、`de` 和 `pt` 的 common messages，不支持的 locales fallback 到 English。Codex hook `statusMessage` text 保持 static English，而 hook command output 为 English 或 Korean。

## Delegation

- `explorer`: 可用时处理 read-only codebase discovery、impact analysis、pattern search 和 read-only verification。
- `worker`: 处理具有明确 file ownership 的 bounded implementation 或 verification task。
- Main session: 当下一步立即依赖结果时，本地处理 urgent blocking work。

每个 delegation prompt 都使用六个 sections: TASK、EXPECTED OUTCOME、REQUIRED TOOLS、MUST DO、MUST NOT DO、CONTEXT。
