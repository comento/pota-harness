# Pota Harness

**Pota 已改为通过宿主插件安装。** `@comento/pota-harness` 1.5.0 是最后一个 npm 版本，请改用各宿主的插件命令安装。Claude Code：`claude plugin uninstall pota@pota --scope user`、`claude plugin marketplace add comento/pota-harness`、`claude plugin install pota@pota-harness`。Codex：先运行 `codex plugin marketplace add comento/pota-harness`，再在 `/plugins` 中安装 pota，并在 `/hooks` 中批准其 hooks。Antigravity：`agy plugin install https://github.com/comento/pota-harness`。详见 https://github.com/comento/pota-harness#install。

Pota Harness 是面向 Codex、Claude Code 和 Antigravity 的高 token 效率 multi-agent harness plugin。

[English](README.md)

Pota 的核心思路是保留有用的 agent harness 行为：hooks、persistent state、explicit planning、focused delegation 和 stop-time guards。Pota 不把重复的 TDD verification loops 作为默认流程，而是把工作拆成小的 module tasks，并用两个 verification gates 证明每个 task。

1. Module acceptance verification: 证明被修改的 module contract。
2. Surface integration verification: 通过 CLI、HTTP、browser 或 file artifacts 等真实 surface 证明行为。

在 task 修改外部状态之前，Pota 会记录并运行最接近的 dry-run 或 check mode。verification 是有边界的：默认每个 task 有两次 verification pass，然后 agent 会记录 blocker 或拆分 task，而不是继续开放式循环。

Pota 也把 tool readiness 视为工作的一部分。它会根据 repository stack 检查 LSP、typecheck、lint、dry-run 和 verification tools。只有在获得明确批准且存在固定版本的受支持 installer 时才安装，否则报告 blocker。

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

发布后的 package 可以通过 `bunx` 或全局安装的 `pota` commands 执行。

```sh
bunx @comento/pota-harness@latest install
bunx @comento/pota-harness@latest upgrade
bunx @comento/pota-harness@latest doctor
bunx @comento/pota-harness@latest uninstall
bunx @comento/pota-harness@latest toolcheck
```

全局安装后也可以使用短命令。

```sh
bun add -g @comento/pota-harness
pota install
pota upgrade
pota doctor
pota uninstall
pota toolcheck
pota auto-upgrade status
```

- `pota install [--hosts all|codex,claude,antigravity]`: 以事务方式安装 custom marketplace source、versioned runtime、Pota-owned config sections 和当前 host mirrors。 canonical runtime 位于 `~/.pota/install/`，其余内容只为所选 host 安装。未提供 `--hosts` 时，在 terminal 中首次安装会询问 host，非交互运行和 CI 会安装所有 host。
- `pota upgrade [--hosts all|codex,claude,antigravity]`: staged validation 后只替换 ownership manifest 中未修改的 entry，失败时 rollback。 除非用 `--hosts` 修改，否则沿用已记录的 hosts，并更新仍为其他版本的 Claude Code plugin cache。 已安装版本比当前 CLI 更新时，`install` 和 `upgrade` 不做任何更改并拒绝；如仍要安装当前 CLI 的版本，加 `--allow-downgrade`。
- `pota doctor`: 只读验证 ownership digests、effective Codex features、真实 plugin status 和 runtime locators。 第一行输出 `Hosts: <ids>`，只检查所选 host(包括 `Claude plugin cache version`)。
- `pota uninstall`: 先将 config 以外的所有 ownership manifest entry 与 installed digest 对照，只要有任何 managed artifact 被修改或删除，就不做任何更改并拒绝整个 uninstall。否则删除或恢复 managed entry 和 retained runtimes，清理空的 managed scaffold，preserve unmanaged target 及其父目录，并 rollback commit 前的失败。 同时删除 `~/.pota/update/`，保留 `~/.pota/config.json` 和 `~/.pota/projects/`。legacy layout 的安装不经迁移直接原地删除。
- `pota auto-upgrade status|on|off|run`: `status` 以 JSON 输出设置、已安装版本、上次检查时间和待显示的 notice；`on`/`off` 将 `autoUpgrade` 写入 `~/.pota/config.json` 并输出同样的报告；`run` 忽略 24 小时周期和 backoff，立即检查 npm。exit 0 表示成功，1 表示执行错误或运行失败，2 表示用法错误。
- `pota toolcheck`: 检测 repository stacks 和 required tools；只执行已批准的 supported installer，否则返回 `installer-unavailable`。
- `pota cleanup --root <repo>`: 默认只读报告 legacy project-local `.pota` residue。`--yes` 将 valid active state 迁移/协调到 user-home store，只删除 known state/lock/tool residue，保留 unknown files，并且仅在目录为空时清理目录。
- `pota memory check|index [--root <repo>]`: `check` 对照 `MEMORY.md` 与 `docs/memory/*.md` 并输出一个 JSON 报告；存在 unindexed notes、dead links、duplicates、stale summaries、summary 中的控制字符或 unsafe paths 时 exit 1，warnings 仅在 `--strict` 下失败。条目是 `## Domain Knowledge` 下的列表行(没有该 section 的旧文件则为所有列表行)；其他 section 中的 note 链接只是提及，`index` 不会改写。`index` 添加缺失的 notes，`Summary:` 变化时只替换链接后的 summary 部分(含多个链接的行保持原样)；只删除该 section 内完全匹配的 Pota placeholder 行，不删除条目或 dead links，其余内容逐字节保留。可用 `--dry-run` 预览。插入位置位于未闭合的 code fence 内时，`index` 不写入任何内容，并以 `unclosed-fence` exit 1。用法错误 exit 2；不带子命令的 `pota memory` 仍输出原有指引。
- `pota plan check|index [--archive] [--root <repo>]`: 对 `PLAN.md` 和 `docs/plan/*.md` 执行相同的检查和索引，条目是标题以 `Plans` 结尾的 `## ` section(如 `## Superseded Plans`)中的列表行。`index` 把 checkbox 全部勾选的 plan 放到 `## Completed Plans` 顶部，其他 plan 放到 `## Active Plans`；只有 `--archive` 会移动行：把超出最新 20 条的 completed 条目(连同缩进段落)和 legacy `## Planning Rules` section 的正文移到 `docs/plan/ARCHIVE.md`。`## Completed Plans` 超过 20 条或仍有 legacy `## Planning Rules` section 时，`check` 会给出 warning。
- `pota goal ...`: 管理 repository goal(`pota goal --help`)。`goal stats --history [--limit N]` 汇总 repository 所有 worktree 中已结束的 goals：completed/cancelled 数量、耗时的中位数和 p90、task 与 receipt 的中位数、rerun rate、memory promotion 决定数、completed goal 达到 4 个后的 older/newer `trend`，以及最近的 goals；没有历史时输出 `{"schemaVersion":1,"scope":"repository","goals":0}`。`completionCriteria`(`goal start --criteria`)是 `advisory`：Pota 只记录不强制，完成只由 required evidence 判定。
- `pota-memory`: 探索 domain knowledge 并更新 `MEMORY.md`。
- `pota-plan`: 在 `docs/plan/` 下创建 decision-complete plan。
- `pota-work`: 执行当前 `PLAN.md` 中的下一个 module task，并收集两个 verification gates。
- `pota-review`: 根据 plan、memory 和 evidence review completed tasks。

custom marketplace lifecycle 将 source 与 versioned runtime 分离。每次 commit 前执行 staged validation，ownership manifest 绑定全部 managed digests，失败时执行 reverse-order rollback。modified 或 unmanaged artifacts 会 preserve 并报告 conflict。Pota 只修改自身 TOML sections，不强制 public feature/agent settings。

Clean uninstall 仅在所有 managed scaffold directory 均为空时删除 `~/.pota/install/` 和 Codex cache root `$CODEX_HOME/plugins/cache/pota`，并保留任何 unmanaged content。它不会自动删除 source repository、repository `MEMORY.md`/`PLAN.md`、user-home Pota goal state、全局 `@comento/pota-harness` package、package-manager cache，或当前 ownership manifest 之外的 legacy backup/settings。

Codex 使用 `skills/` 和 `commands/`。Claude Code 使用 `.claude/` 下的 mirrored commands 和 agent definitions。Antigravity 使用 `.agents/workflows` 和 global skills mirrors。

## Install Layout And Auto-Upgrade

Pota 将安装内容放在 `POTA_HOME`(默认 `~/.pota`)下。各 host 的路径仍分别由 `CODEX_HOME`、`CLAUDE_HOME`、`ANTIGRAVITY_HOME`、`ANTIGRAVITY_CLI_HOME`、`CODEX_CONFIG_PATH` 决定。

```text
~/.pota/
  install/                  lifecycle 管理的文件
    lifecycle.json          ownership manifest (schema 2: hosts, origin, retained runtimes)
    lifecycle.lock, transaction.json, transactions/
    runtime/<version>/      所有 runtime locator 和 Claude Code hooks 使用的 canonical runtime
    codex/                  Codex local marketplace source
    claude/                 Claude Code local marketplace
  projects/                 goal state
  config.json               用户设置 ("autoUpgrade", "commentChecker", "modelCeiling")
  update/                   auto-upgrade 状态
  tools/comment-checker/    comment-checker 二进制(固定 release)
$CODEX_HOME/plugins/cache/pota/pota/<version>/   Codex plugin cache copy (仅在选择 Codex 时)
```

- Hosts: 只有 `install` 和 `upgrade` 接受 `--hosts`，值为 `all` 或 `codex`、`claude`、`antigravity` 的逗号列表。选择会记录在 ownership manifest 中，`upgrade`、`doctor`、`uninstall` 都遵循它。用 `pota upgrade --hosts <list>` 修改；被移除 host 的 managed file 若已被修改则拒绝。交互式 prompt(全部(默认)、仅 Claude Code、仅 Codex、仅 Antigravity、逗号列表)只在尚未安装任何内容时出现。
- 保留期: 改变版本的 upgrade 会把上一个 canonical runtime 和 Codex cache copy 保留 3 天(每类最多 3 个)，让 upgrade 前启动的 session 继续工作。过期的由下一次 install/upgrade 删除，uninstall 会全部删除。不低于新版本的 Codex cache copy 不会保留，因为 Codex 会加载 cache 中最高的版本。
- Claude Code plugin cache: 若仍为其他版本，`pota upgrade` 会用 `claude plugin marketplace update pota` 和 `claude plugin update pota@pota --scope user` 更新。更新失败时保留已升级的安装，输出手动完成的命令并以 exit 1 结束。
- Auto-upgrade: 默认开启。`SessionStart` 每 24 小时最多一次(install 或 upgrade 后 24 小时内不检查)启动一个 detached process：从 npm 读取最新的 `@comento/pota-harness` 版本，以该确切版本加 `--ignore-scripts` 安装到 `~/.pota/update/stage/` 并验证，然后运行该 package 的 `pota-lifecycle.mjs upgrade --auto`。包括 major 在内的所有新版本都会应用，从不降级。下一个 `SessionStart` 用一行只提示一次结果(`updated`、`failed`、`manual`)。从 git checkout 安装(`origin: "checkout"`)或从 source checkout 运行时不会执行。
- 关闭: `pota auto-upgrade off`、`POTA_AUTO_UPGRADE=0`(也可用 `false`、`off`、`no`)，或在 `~/.pota/config.json` 中设置 `"autoUpgrade": false`。无法读取的 `config.json` 也视为关闭。状态和上次运行日志位于 `~/.pota/update/`。
- 注释检查: 编辑成功后(Claude Code `Write`/`Edit`/`MultiEdit`、Codex `apply_patch` 和编辑工具)，PostToolUse hook 用 [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker)(MIT)检查改动内容。报告多余注释时返回 `decision: "block"`，让代理删除注释或说明保留的理由。不新增 npm 依赖: `pota install` 和 `pota upgrade`(包括自动升级)在安装 commit 之后下载当前平台(darwin/linux x64 与 arm64、windows x64)的固定 v0.8.2 release，校验固定的 SHA256，用系统 `tar` 解压到 `~/.pota/tools/comment-checker/`，并用一行输出结果。下载失败时安装和 exit code 保持不变，已安装 runtime 的 `SessionStart` 会在分离进程中按 backoff 重试。下载成功之前编辑不经检查直接通过，检查器出错或检查超过 7 秒也会通过。`pota doctor` 用一行显示其状态，`pota uninstall` 会删除它。`POTA_COMMENT_CHECKER=0`(也可用 `false`、`off`、`no`)或 `~/.pota/config.json` 中的 `"commentChecker": false` 同时关闭检查和下载。
- main model 检查: 当会话的 main model 低于 stronger tier 时,`SessionStart` 会添加一行 `Pota main model:` 和一次性通知。此时计划/分诊和最终评审必须委派给 stronger tier 或更高并记录(评审使用 `goal assign … --kind review`),否则 `triage-plan` 的完成和 `goal finish` 会被拒绝;绕过方式是 `--allow-main-model <reason>`。model 值缺失或无法识别时不生效。设置 `POTA_MAIN_MODEL_GATE=0` 可关闭。
- model ceiling: 当账户不能或不打算使用更高的 tier 时(订阅等级、组织策略、usage credits),设置 `POTA_MODEL_CEILING=stronger`(或 `balanced`;也可以写 `opus`、`sonnet` 等 model 名),或在 `~/.pota/config.json` 中写入 `"modelCeiling": "stronger"`。环境变量优先,`config.json` 是所有 hook 和 CLI 调用都会读取的同一位置。设置后 `SessionStart` 会添加一行 `Pota model ceiling:`,高于 ceiling 的 tier 使用 ceiling tier 的 model,Heavy 设计门禁接受该 model,main model 检查以应用 ceiling 后的 stronger tier 为准。未设置时行为不变;无效值不应用 ceiling 并给出提示。
- 请求契约与 steering: Light 和 Heavy Path 计划包含 `## Request Brief`(原始请求、解读的结果、范围、过往记录参考(`Prior records`,`pota plan steering`)、假设、隐含需求、未决问题、steering 记录),填写完成之前,除非传入 `--allow-no-request-brief <reason>`,否则 `triage-plan` 的完成会被拒绝。用户的更正、补充和方向变更用 `goal steer --kind <correction|addition|redirect> --reason <text>` 记录,task 发生变化时用 `goal replan --steer <correction|addition|redirect|none> --reason <text>` 记录;第二次 steering 或 redirect 还需要重写 `Current request (as of S<n>)`。

## Claude Code DAG Panel

Claude Code 桌面版会把当前 Pota goal 显示为按 wave 分列的 DAG 面板。它仅适用于 Claude Code,Codex 和 Antigravity 没有此功能。需要支持 mod 功能的 Claude Code(基于 Claude Code 2.1.325 的 mod API 编写);在终端等无法绘制图形的 surface 上改为文字列表。

- 用 `/dag [previous|current|next|all|refresh|close]` 打开面板。视图有上一个、当前、下一个、全部。默认是全部(all)视图,其余为可选项。已完成的连线为实线,进行中的连线为虚线并带移动的点。
- 在 `pota goal start` 和 `pota goal replan` 之后自动打开一次。关闭后,同一个 goal 不会再自动打开。
- 每次执行 goal 命令时以及每 30 秒重新读取 goal 状态并刷新。

## Antigravity Compatibility

Antigravity 支持通过 `/workflow-name` 调用的 `SKILL.md` based Agent Skills and Workflows。Pota 会为该 surface 安装这些 paths。

- Antigravity IDE: `~/.gemini/config/skills/pota-*/SKILL.md`。
- Antigravity CLI: `~/.gemini/antigravity-cli/skills/pota-*.md` 下的扁平 skill 文件。

Codex-only hooks 不会移植到 Antigravity。相同的 planning、memory、complexity triage 和 two-gate verification procedures 会通过 Skills 和 Workflows 运行。设置 `ANTIGRAVITY_HOME` 或 `ANTIGRAVITY_CLI_HOME` 可以覆盖 paths。

## Locale Policy

Pota 的 reusable instructions 为了 global use 使用英文编写。除非用户明确要求其他语言，user-visible output 以及生成或更新的 documentation、plans、memory artifacts 应遵循 configured OS locale。这包括 `MEMORY.md`、`PLAN.md`、`docs/memory` 和 `docs/plan` 内容。CLI 会本地化 `en`、`ko`、`ja`、`zh`、`es`、`fr`、`de` 和 `pt` 的 common messages，不支持的 locales fallback 到 English。Codex hook `statusMessage` text 保持 static English，而 hook command output 为 English 或 Korean。

## Delegation

- `explorer`: 可用时处理 read-only codebase discovery、impact analysis、pattern search 和 read-only verification。
- `worker`: 处理具有明确 file ownership 的 bounded implementation 或 verification task。
- Main session: 当下一步立即依赖结果时，本地处理 urgent blocking work。

每个 delegation prompt 都使用六个 sections: TASK、EXPECTED OUTCOME、REQUIRED TOOLS、MUST DO、MUST NOT DO、CONTEXT。
