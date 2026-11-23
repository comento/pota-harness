# Pota Harness

Pota Harness is a token-efficient multi-agent harness plugin for Codex, Claude Code, and Antigravity.

## Translations

- [한국어](README.ko.md)
- [日本語](README.ja.md)
- [中文](README.zh.md)
- [Español](README.es.md)
- [Français](README.fr.md)
- [Deutsch](README.de.md)
- [Português](README.pt.md)

The core idea is to keep useful agent-harness behavior: hooks, persistent state, explicit planning, focused delegation, and stop-time guards. Pota does not make repeated TDD verification loops the default. Instead, it splits work into small module tasks and proves each task with two verification gates.

1. Module acceptance verification: proves the changed module contract.
2. Surface integration verification: proves behavior through the real surface, such as CLI, HTTP, browser, or file artifacts.

Before a task mutates external state, Pota records and runs the closest available dry-run or check mode. Verification is bounded: each task gets two verification passes by default, then the agent records a blocker or splits it into sub-tasks instead of continuing an open-ended loop.

Pota also treats tool readiness as part of the work. LSP, typecheck, lint, dry-run, and verification tools are checked against the repository stack. A missing tool is installed only after explicit approval and only when a pinned, supported installer exists; otherwise Pota reports a blocker.

## Install

Pota is a plugin for Claude Code, Codex, and the Antigravity CLI. The root of this repository is the plugin, and the `main` branch is the released version. Each host installs, updates, and removes its own copy with its own plugin commands, and that copy is the host's runtime: its hooks, skills, and CLI run from it. Copies on different hosts may be at different versions; Pota does not compare them. Goal state in `~/.pota/projects/` is shared by every host.

### Claude Code

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
```

Inside a session the same steps are `/plugin marketplace add comento/pota-harness` and `/plugin install pota@pota-harness`. Claude Code does not auto-update third-party marketplaces by default, so update by hand and restart the session:

```sh
claude plugin marketplace update pota-harness
claude plugin update pota@pota-harness
```

Uninstall:

```sh
claude plugin uninstall pota@pota-harness
claude plugin marketplace remove pota-harness
```

### Codex

```sh
codex plugin marketplace add comento/pota-harness
```

Then, in the Codex TUI:

1. Open `/plugins`, pick the `pota-harness` marketplace, install `pota`, and start a new session.
2. Open `/hooks` and approve Pota's five hooks. Codex does not run plugin hooks until you approve them, and the approval is bound to the hook content, so approve them again in `/hooks` after every update. Without approval no session gets the `Pota CLI:` line, and the Pota skills tell you that Pota's hooks are inactive.

Update with `codex plugin marketplace upgrade pota-harness`, then approve the hooks in `/hooks` again. To uninstall, open the plugin in `/plugins` and choose "Uninstall plugin". These Codex steps follow the Codex documentation and source; they have not yet been run against a real Codex installation.

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

Run the same command again to update; the Antigravity documentation describes a reinstall as replacing the installed copy. Uninstall with `agy plugin uninstall pota`. `agy` 1.5.6 or later is recommended. Only the Antigravity CLI is supported; the Antigravity IDE is not.

### What each host gets

| | Claude Code | Codex | Antigravity CLI |
| --- | --- | --- | --- |
| Skills | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` |
| Hooks | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | the same five, after approval in `/hooks` | SessionStart, PreInvocation (prompt context), PostToolUse, Stop; no SubagentStop |
| Agents `explorer`, `worker` | yes | no | no |
| DAG panel (mod) | yes | no | no |

### Coming from the npm install (1.x)

Pota 2.x is not published to npm and has no global `pota` command. The npm package `@comento/pota-harness` ends at 1.5.0, which only shows these install instructions, and the package is deprecated.

1. Claude Code only: remove the 1.x plugin first with `claude plugin uninstall pota@pota --scope user`.
2. Install the plugin on every host you use. The removal below works one host at a time, so a host without the plugin keeps running the 1.x install until you install the plugin there.
3. Start a session. When the plugin's session start finds the 1.x ownership manifest (`~/.pota/install/lifecycle.json`), it removes that host's part of the 1.x install in a background process and says so; restart the session once. The next session reports the result once. The shared 1.x runtime, `~/.pota/update/`, and the manifest go only after no host's part is left.

The removal deletes only files and directories that the 1.x manifest records and whose digest is unchanged, plus Pota's own sections of Codex's `config.toml`. It keeps `~/.pota/projects/` (goal state), `~/.pota/config.json`, `~/.pota/tools/comment-checker/`, every file you changed (listed as kept), anything the manifest does not record, and the global npm package (remove it with `npm uninstall -g @comento/pota-harness`). It refuses, removes nothing for that host, and tells you why when:

- a directory on one of the host's paths is a symlink (`symlinked-path`; remove the listed paths by hand);
- the host registration cannot be removed safely (`host-unregister-failed`): the `claude` CLI is missing or fails, or Codex's `config.toml` has Pota sections that cannot be identified safely or a rewrite would change other sections;
- the manifest is invalid, has an unsupported schema, points outside the expected paths, or a 1.x install transaction was interrupted (`manifest-invalid`, `manifest-unsupported-schema`, `target-outside-allowlist`, `transaction-pending`). If you installed 1.x with `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`, or `CODEX_CONFIG_PATH` set, set the same values for the host. Otherwise run `npx @comento/pota-harness@1.5.0 uninstall`, then restart.

A refused removal is retried after 24 hours and announced at most once every 7 days. An install from before 1.3 has no ownership manifest and is never touched; remove it with `npx @comento/pota-harness@1.5.0 uninstall` before you install the plugin. To see the state, or to run the removal yourself (`<pluginRoot>` is explained below):

```sh
node "<pluginRoot>/scripts/pota.mjs" doctor
node "<pluginRoot>/scripts/pota.mjs" migrate status
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude --dry-run
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude
```

`POTA_LEGACY_MIGRATION=0` (also `false`, `off`, or `no`) turns the automatic removal off. 1.x names map to 2.x as follows:

| 1.x | 2.x |
| --- | --- |
| `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` | the host's skill names in the table above |
| `/pota-toolcheck` | ask the agent to run `pota toolcheck` |
| `/pota-doctor` | `pota doctor` |
| the CLI's `install`, `upgrade`, and `uninstall` commands and automatic upgrades | the host plugin commands above; the CLI now prints a pointer to this section and exits 2 |

### Running the Pota CLI

Each session start prints a `Pota CLI:` line with the absolute path of `scripts/pota.mjs` in that host's plugin copy, and the agent runs Pota commands with that path. `<pluginRoot>` is the parent of that `scripts` directory; the path changes when the host installs a new version. In this README, `pota <command>` means `node "<pluginRoot>/scripts/pota.mjs" <command>`.

## Complexity Triage

Every implementation task passes complexity triage first, before agent, plugin, or delegated workflow guidance. Triage is decided from repository exploration, expected change scope, and risk signals without asking the user.

- Light Path: narrow changes inside existing architecture layers. This is the default. The user-called/main agent still orchestrates and delegates implementation edits to one bounded `worker` whenever subagent tools are available, then keeps the verification gate.
- Heavy Path: new directory/module/layer, new domain model/service/abstraction, security/session/auth, external API/message queue/payment, DB schema/migration, concurrency/transaction/cache changes, cross-domain refactor, or explicit extra-care request.

The selected path and rationale are recorded in `docs/plan/<topic>.md` when a plan artifact exists. Even on Light Path, the two verification gates remain. If subagent tools are unavailable, the main agent takes over implementation directly and records that takeover in evidence.

Pota chooses each task's model by its nature (fast `haiku`, balanced `sonnet`, stronger `opus`, strongest `fable`) and routes reasoning effort; `Model routing: inherited` in `MEMORY.md` or the plan disables per-task model selection. Light planning, implementation, and verification request `medium`; Heavy planning, review, and implementation request `high`; final verification/review requests `xhigh`. `Requested` is Pota's desired profile; `Effective` records what the dispatch actually applied. Every new task/worker dispatch must pass the chosen model and requested effort through the host option (Claude Code: Agent `model`/`effort`, never `fork`); `Effective` is the passed value, `not-applied: <reason>` when it was not passed, and `inherited` only when the host has no option. Host capability may be claimed only from an exposed interface or dispatch result; Pota choosing not to integrate or use an option is a separate decision. Only a newly dispatched task/worker may receive a supported effort option. When the path changes, the plan artifact, repository goal task roadmap, native UI plan, and effort profile are synchronized together; completed profiles are preserved and incomplete profiles are recalculated.

When the subagent tool provides a progress-reporting channel, subagents report status to the orchestrator when starting work, when deciding or confirming direction, during periodic progress, and when finishing. The orchestrator immediately relays received status events to the user. If no mid-run reporting channel exists, the orchestrator relays observable events such as assignment, waiting, and final completion.

When a delegated subagent finishes, it provides a final report before leaving. After the orchestrator captures that final report and evidence, the completed subagent is closed or released. The orchestrator then reviews the final report and evidence before marking the work complete.

## Tool Readiness

`pota toolcheck` inspects the current repository for JavaScript, TypeScript, Python, PHP, Java, Kotlin, Swift, Go, and Rust stacks, then checks the matching LSP and verification tools.

```sh
pota toolcheck --root .
# After explicit approval only:
pota toolcheck --install --yes --root .
```

- `toolcheck` reports detected stacks and missing tools. For each missing tool it prints a suggested install command or the reason automatic installation is unavailable, and the agent asks you once whether to install; if you decline, or the run is non-interactive, it records a blocker.
- Default checks are read-only, bounded by a timeout, and do not execute repository-local wrappers merely to discover them.
- `toolcheck --install` requires both `--yes` and explicit user approval. Unpinned or checksum-free installers return the canonical `installer-unavailable` refusal rather than silently downloading `latest`.
- Pota plans record detected stack, required tools, install commands, and blockers.
- A missing LSP server is not a valid reason to skip precise codebase exploration until installation or an equivalent symbol-aware fallback has been attempted.

## Dry-Run And Loop Policy

- Migrations and database changes use `--pretend`, dry-run, schema diff, rollback feasibility checks, or the closest repository-native equivalent before write/apply commands.
- Package, release, infrastructure, deployment, code generation, and formatting work use check, plan, diff, validate, or dry-run modes before mutating state when available.
- If no dry-run exists, the plan records that fact and selects the smallest reversible command or test artifact available.
- If a verification gate fails, Pota diagnoses once, shrinks the task or splits it into sub-tasks, and reruns both gates.
- After two failed verification passes for the same task, Pota records the blocker in `docs/plan/<topic>.md` instead of continuing a repeated loop.

## Verification Integrity

- The implementer must not change the judge: existing tests, fixtures, snapshots, and recorded verification commands are never edited, weakened, skipped, or deleted to make a gate pass unless the plan records the contract change first. Review inspects those diffs and rejects unexplained weakening.
- Reported defects are reproduced with tools before fixing. Unclear failures are narrowed one hypothesis at a time, each closed by a measurement, and feasibility questions are answered with a bounded experiment rather than an unverified "not possible".
- After a defect fix, the repository is searched for other implementations of the same rule or pattern; they are fixed in scope or recorded as follow-up.
- Recurring, machine-checkable lessons are encoded as tests, lint rules, scripts, or hooks instead of more memory prose.

## Model Guidance

Pota only applies model-specific adjustment to Claude-family and Codex-family models.

- Claude-family: useful for long context, policy interpretation, and plan/evidence review.
- Codex-family: useful for small implementation tasks, explicit file edits, command-based verification, and bounded `worker` tasks.

Detailed guidance lives in the installed plugin and is referenced as `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md`, and `pota://docs/model-guidance/codex.md`.

## Repository Artifacts

The harness creates and maintains these files at the target repository root.

- `MEMORY.md`: short index of persistent domain knowledge: one line per note under `## Domain Knowledge` (`- [<name>](docs/memory/<name>.md): <summary>`) plus the repository `## Policy`.
- `docs/memory/*.md`: detailed knowledge by domain. Each note starts with a one-line `Summary:` (at most 120 characters) that the index and the hook show.
- `PLAN.md`: short index of work plans: one line of 200 characters or fewer per plan under `## Active Plans` and `## Completed Plans`. Planning rules live in the `pota-plan` skill, not in `PLAN.md`.
- `docs/plan/*.md`: detailed execution plans.
- `docs/plan/ARCHIVE.md`: older completed plan entries moved out of `PLAN.md` by `pota plan index --archive`, newest first, plus the body of a legacy `## Planning Rules` section under `## Legacy Planning Rules`. List lines before its first `## ` heading still count as indexed.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json`: user-home, project/worktree-scoped active goal/task/evidence state used for interruption recovery and scoped stop gates. The project working tree does not own runtime state.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl`: one summary record per completed or cancelled goal (newest 200 per worktree) for `goal stats --history`.

Keep `## Completed Plans` newest first. `pota plan index --archive` keeps the first 20 entries and moves the rest to `docs/plan/ARCHIVE.md` without deleting anything, so a list kept oldest first would archive the newest plans; preview with `--dry-run`. Existing `MEMORY.md`/`PLAN.md` files work without migration: `init` never rewrites them, and `check` only warns about the old layout.

At `SessionStart`, the hook tells the agent which memory notes exist (name and `Summary:`, or a names-only line when the list is long) and, when no goal is active, adds one line on the plan index: plan count, active plans, the latest completed plans, and `docs/plan/ARCHIVE.md` when present. Sessions with an active, paused, blocked, or foreign-owned goal get only the memory list, and a foreign capsule never shows plan names. An idle `UserPromptSubmit` adds one sentence with the note count. The hook reads only the index files and directory listings, never note bodies, and writes nothing; a repository without notes or plans gets the same hook output as before.

Before `goal finish`, `pota-work` records one memory promotion decision per goal in the plan's Evidence: `Memory promotion: docs/memory/<domain>.md` when the goal produced reusable repository knowledge, otherwise `Memory promotion: none: <reason>`. The decision is required; writing a note is optional. When a goal completes and its plan file has no filled `Memory promotion:` line, `goal finish` and `goal complete` print a one-line reminder on stderr without changing the exit code or stdout.

Scripts, templates, agents, and model guidance stay in the host's plugin copy; nothing of Pota is copied into the target repository. If that copy is missing or unreadable, reinstall or update it with the host's plugin command; do not repair it from another host's copy or search the target repository for Pota files.

## Commands

`pota <command>` below means `node "<pluginRoot>/scripts/pota.mjs" <command>`, with the path from the session-start `Pota CLI:` line (see [Running the Pota CLI](#running-the-pota-cli)).

- `pota doctor [--json]`: read-only diagnostics of this plugin copy and `~/.pota`: version, `pluginRoot`, Node.js (18 or later), whether `POTA_HOME` is writable, whether the four version surfaces of this copy agree, required files, the 1.x install (`none`, `present <version>`, or `blocked <reason>`), the last removal report per host with kept paths and manual commands, and the comment-checker state. It never compares the copies of other hosts. Exit 1 when a check fails, 2 for a usage error.
- `pota migrate status|run [--host claude|codex|antigravity] [--all] [--dry-run] [--json]`: runs the 1.x install removal by hand. `status` shows what a run would do and the last reports; `run` needs `--host <host>` or `--all` (every host, including hosts that do not have the plugin yet), and `--dry-run` shows the plan without changing anything. Exit 1 when the removal is refused, 2 for a usage error.
- `pota toolcheck`: detects repository stacks and checks required LSP and verification tools; installation runs only for an approved supported installer.
- `pota cleanup --root <repo>`: reports legacy project-local `.pota` residue without changing it; `--yes` migrates/reconciles valid active state into the user-home store, removes only known Pota state/lock/tool residue, preserves unknown files, and prunes the directory only when empty. A `state.lock` is removed only when it holds a valid lock record whose owner process on this host is dead, and a quarantined `state.lock.stale.*` file only when its valid record's nonce matches its name; live-owner, foreign-host, and unparsable locks are preserved and listed with a reason in `preservedReasons`. `--help` and `--version` exit 0; usage errors exit 2 and runtime errors exit 1 with one `Pota cleanup error:` line.
- `pota goal ...`: starts, inspects, pauses, resumes, blocks, cancels, and completes a persisted repository goal. `goal claim --session <id>` hands an unfinished goal to the session that continues the same work (resume, compaction, handoff, fork); new work that arrives during an unfinished goal is folded in with `goal replan` instead of cancelling it. State lives under user-home `.pota`, separated by repository and Git worktree; state without `worktreeId` and state copied from another worktree are stale and removed on the next hook/goal start. Successful completion or cancellation removes active state because completed evidence already lives in the plan document, while paused/blocked state remains resumable. The default tool-bound policy records successful evidence by executing `goal verify -- <argv>`. The legacy `goal receipt` command imports declared evidence only. `--root` is optional for every `goal` subcommand (it resolves via `HARNESS_REPO_ROOT`, else the nearest ancestor containing `.git`). `goal verify --kind "moduleAcceptance|surfaceIntegration" -- <argv>` records one receipt per kind from one run; evidence scopes are `task` and `goal`. `goal finish [--watch "<path|path>"] [--timeout-ms N] -- <argv>` completes the active task (its evidence must be fresh), runs the argv once, records every goal requiredEvidence kind (default `finalReview`) at goal scope, and completes the goal; once that goal-scope evidence is recorded after every task receipt, earlier task checks are not rerun. `goal stats` prints JSON receipt counts, reruns, and stale receipts for the current goal. `goal stats --history [--limit N]` aggregates the repository's finished goals across worktrees: completed/cancelled counts, median and p90 duration, task and receipt medians, rerun rate, memory promotion decisions, an older/newer `trend` once 4 goals have completed, and the most recent goals; with no history it prints `{"schemaVersion":1,"scope":"repository","goals":0}`. `completionCriteria` (`goal start --criteria`) is `advisory`: Pota records it but does not enforce it, and completion is gated only by required evidence. Tasks declare `dependsOn` (omitted = previous task) and `writeScope`; `goal ready` prints active/ready/blocked task ids, and up to 4 ready tasks with disjoint write scopes can be active in parallel in the same worktree.
- `pota memory check|index [--root <repo>]`: `check` compares `MEMORY.md` with `docs/memory/*.md` and prints one JSON report; it exits 1 for unindexed notes, dead links, duplicates, stale summaries, control characters in summaries, or unsafe paths, and warnings fail only with `--strict`. Entries are list lines under `## Domain Knowledge` (or every list line in an older file without that section); a note link in another section is a mention that `index` never rewrites. `index` adds unlisted notes, replaces only the summary after the link when `Summary:` changed (a line with several links stays as written), removes only exact Pota placeholder lines in that section, never deletes entries or dead links, keeps the rest of the file byte-for-byte, and previews with `--dry-run`. If the insertion point is inside an unclosed code fence, `index` writes nothing and exits 1 with `unclosed-fence`. Usage errors exit 2; `pota memory` alone still prints guidance.
- `pota plan check|index [--archive] [--root <repo>]`: the same for `PLAN.md` and `docs/plan/*.md`, whose entries are list lines under `## ` headings ending in `Plans` (such as `## Superseded Plans`). `index` adds a plan whose checkboxes are all checked to the top of `## Completed Plans` and any other plan to `## Active Plans`; only `--archive` moves lines, to `docs/plan/ARCHIVE.md`: completed entries beyond the newest 20 with their indented paragraphs, and the body of a legacy `## Planning Rules` section. `check` warns when `## Completed Plans` has more than 20 entries or a legacy `## Planning Rules` section remains.
- `pota-memory`: explores domain knowledge, writes notes with a `Summary:` line, and keeps `MEMORY.md` indexed.
- `pota-plan`: reuses related memory notes and at most 3 related completed plans, then creates a decision-complete plan under `docs/plan/`.
- `pota-work`: executes the next module task in the current `PLAN.md` with two verification gates.
- `pota-review`: reviews completed tasks against plan, memory, and evidence.

On every `UserPromptSubmit`, Pota injects model-visible guidance that non-trivial implementation or continuation of planned work authorizes goal creation even if the user never says “goal.” Routine known-target Git/GitHub operations—status, fetch, checkout, branch, merge, push, and PR management—stay plan/goal-free unless they require code edits, conflict resolution, destructive recovery, release/deploy, or design. For planned work, the agent first writes an initial repository plan with triage as the active task, synchronizes the roadmap before exploration, and updates it to a decision-complete revision before implementation. An active goal keeps the ordered roadmap and current task in hook context so a side question returns to the original work. Consultation, explanation, and plan-only requests also remain goal-free.

For token-efficient execution, Pota puts reasoning into a focused executable test contract—requirements, invariants, boundaries, and failure modes—before implementation. Implementation receives the failing contract and bounded file scope, then makes the minimum passing change. Tool exit codes and machine summaries decide success; successful output stays concise and only failures expand context. Verification climbs from focused tests to one final full check. With no explicit `--watch`, a Git workspace fingerprint covers tracked and non-ignored untracked files; ignored artifacts are excluded. Any ignored artifact needed by the claim must be named with an explicit `--watch <path>` (or an explicit containing directory). Before package verification, inspect lifecycle scripts and run normal `npm pack --dry-run` by default: content-producing or unknown scripts must never use `--ignore-scripts`; only absent or proven content-neutral scripts may use it while the full-check evidence remains fresh. Successful state mutations support `--quiet` so growing goal JSON does not consume the conversation budget.

Pota writes only under `POTA_HOME` (default `~/.pota`) and never inside its plugin copy. Codex binds hook approval to the plugin's content, so a copy that changed itself would lose its approval. Host plugin files are installed, updated, and removed only by the host's own plugin commands.

## Pota Home And Settings

Pota keeps its data under `POTA_HOME` (default `~/.pota`), shared by the plugin copies of every host.

```text
~/.pota/
  projects/                 goal state
  config.json               user settings ("commentChecker", "modelCeiling")
  tools/comment-checker/    comment-checker binary (pinned release)
  migration/                reports and state of the 1.x install removal
  hosts/antigravity/        Antigravity session files (hook messages waiting for the next prompt)
  install/, update/         left by the 1.x npm install until its removal finishes
```

- 1.x settings: `"autoUpgrade"` in `config.json` is ignored; Pota no longer upgrades itself.
- Comment checker: after a successful edit (Claude Code `Write`/`Edit`/`MultiEdit`, Codex `apply_patch` and edit tools), the PostToolUse hook runs [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker) (MIT) on the changed text and, when it reports needless comments, returns `decision: "block"` so the agent removes them or explains why they are needed. No npm dependency is added: a session start of a host hook downloads the pinned v0.8.2 release for the current platform (darwin/linux x64 and arm64, windows x64) in a detached process, verifies its pinned SHA256, and extracts it with the OS `tar` into `~/.pota/tools/comment-checker/`. A failed download is retried at a later session start with a backoff. Until a download succeeds, edits pass unchecked; a checker error or a check over 7 seconds also passes. `pota doctor` prints its state on one line, and `POTA_COMMENT_CHECKER=0` (also `false`, `off`, or `no`) or `"commentChecker": false` in `~/.pota/config.json` turns off both the check and the download.
- Main model check: when the session's main model is below the stronger tier, `SessionStart` adds a `Pota main model:` line and a one-time notice. Planning/triage and the final review must then be dispatched to the stronger tier or above and recorded (`goal assign … --kind review` for the review); otherwise completing `triage-plan` and `goal finish` are refused unless `--allow-main-model <reason>` is passed. An absent or unrecognized model value never triggers this. Set `POTA_MAIN_MODEL_GATE=0` to turn it off.
- Model ceiling: when the account cannot or should not use the higher tiers (subscription, organization policy, usage credits), set `POTA_MODEL_CEILING=stronger` (or `balanced`; a model name such as `opus` or `sonnet` also works), or `"modelCeiling": "stronger"` in `~/.pota/config.json`. The environment variable wins, and `config.json` is the one place every hook and CLI call reads. `SessionStart` then adds a `Pota model ceiling:` line, tiers above the ceiling use the ceiling tier's model, the Heavy design gate accepts that model, and the main model check uses the capped stronger tier. Without a setting nothing changes; an invalid value applies no ceiling and is reported.
- Request brief and steering: a Light or Heavy Path plan carries a `## Request Brief` (original request, interpreted outcome, scope, prior records (`Prior records`, from `pota plan steering`), assumptions, implicit requirements, open questions, steering log), and completing `triage-plan` is refused until it is filled unless `--allow-no-request-brief <reason>` is passed. User corrections, additions, and redirects are recorded with `goal steer --kind <correction|addition|redirect> --reason <text>`, or with `goal replan --steer <correction|addition|redirect|none> --reason <text>` when tasks change; the second steering or a redirect also needs a rewritten `Current request (as of S<n>)`.

## Claude Code DAG Panel

Claude Code desktop shows the current Pota goal as a DAG panel, one column per wave. It is Claude Code only; Codex and Antigravity do not have it. It needs a Claude Code with mod support (written against the Claude Code 2.1.325 mod API); the terminal has no graphics, so there it draws the waves top to bottom as boxes made of box-drawing characters, without the moving dot, and falls back to a text list when the pane is narrower than 24 columns.

- `/dag [previous|current|next|all|refresh|close]` opens the panel. The views are previous, current, next, and all. The default is the all view; the others are options. A finished link is a solid line; a link in progress is dashed with a moving dot.
- It opens once automatically after `pota goal start` and `pota goal replan`. If you close it, it does not open again for the same goal.
- It re-reads the goal state whenever a goal command runs and every 30 seconds.
- It reads the goal of the session's root. When a goal command runs in another worktree, the panel follows that worktree and says so under the title, and returns when the session moves or that goal ends while the session's root has one.

## Antigravity Compatibility

Pota supports the Antigravity CLI (`agy`); the Antigravity IDE is not supported. The plugin's manifest is the root `plugin.json`, and its hooks are the root `hooks.json`, which runs `scripts/pota-state-antigravity.mjs` from the plugin folder. That adapter maps Antigravity's events onto Pota's hooks:

- `SessionStart` adds the session capsule and the `Pota CLI:` line.
- Antigravity has no prompt event, so the first `PreInvocation` of each prompt adds the prompt context.
- `PostToolUse` on `write_to_file`, `replace_file_content`, and `multi_replace_file_content` runs the comment checker and the goal reminder; its result is added at the next `PreInvocation`.
- `Stop` keeps the agent working while the active goal has an unfinished task. There is no `SubagentStop`.

Skills are called as `/pota-plan`, `/pota-work`, `/pota-review`, and `/pota-memory`; workflows are not part of Antigravity plugins. The adapter follows the Antigravity hook documentation; its behaviour inside a real `agy` session has not been verified yet.

## Locale Policy

Pota's reusable instructions are written in English for global use. User-visible output and generated or updated documentation, plans, and memory artifacts should follow the configured OS locale unless the user explicitly asks for another language. This includes `MEMORY.md`, `PLAN.md`, `docs/memory`, and `docs/plan` content. The CLI localizes common messages for `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de`, and `pt`, and falls back to English for unsupported locales. Codex hook `statusMessage` text remains static English, while hook command output is English or Korean.

## Delegation

- `explorer`: handles read-only codebase discovery, impact analysis, pattern searches, and read-only verification when available.
- `worker`: handles actual implementation edits or verification tasks with clear file ownership.
- Main session: orchestrates, verifies, and records evidence; it keeps only urgent non-implementation blocking work local when the next step depends immediately on the result, except that unavailable subagent tools make the main agent take over implementation directly.

Every delegation prompt uses six sections: TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
