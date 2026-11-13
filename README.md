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

- `toolcheck` reports detected stacks and missing tools.
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

Runtime scripts, templates, commands, agents, and model guidance stay in the installed canonical runtime, `~/.pota/install/runtime/<version>/`. Runtime locator files let Codex, Claude Code, and Antigravity share that installed copy without copying Pota internals into the target repository. If the shared runtime or a locator is missing, unreadable, or inconsistent, stop using every mirror that points to it. Run `bunx @comento/pota-harness@latest doctor` from the published package, then `bunx @comento/pota-harness@latest upgrade` to recover it; do not repair one host from another mirror or search the target repository for runtime files.

## Commands

The published package can be executed with `bunx` or globally installed `pota` commands.

```sh
bunx @comento/pota-harness@latest install
bunx @comento/pota-harness@latest upgrade
bunx @comento/pota-harness@latest doctor
bunx @comento/pota-harness@latest uninstall
bunx @comento/pota-harness@latest toolcheck
```

After global installation, short commands are also available.

```sh
bun add -g @comento/pota-harness
pota install
pota upgrade
pota doctor
pota uninstall
pota toolcheck
pota auto-upgrade status
```

- `pota install [--hosts all|codex,claude,antigravity]`: transactionally installs the canonical runtime under `~/.pota/install/` and, for the selected hosts, the Codex marketplace source, versioned Codex runtime cache, and Pota-owned config sections, the Claude Code mirrors and plugin, and the current Antigravity IDE/CLI skill surfaces. Without `--hosts`, a first install at a terminal asks which hosts to use; non-interactive runs and CI install every host.
- `pota upgrade [--hosts all|codex,claude,antigravity]`: replaces only ownership-manifest entries whose installed digests still match, with staged validation and reverse-order rollback on failure. It keeps the recorded hosts unless `--hosts` changes them and refreshes a Claude Code plugin cache that still holds another version. When the installed version is newer than this CLI, `install` and `upgrade` refuse without changing anything; `--allow-downgrade` installs this CLI's version anyway.
- `pota doctor`: prints `Hosts: <ids>` first, then validates the ownership manifest, managed digests, effective Codex features, actual installed/enabled/version plugin state (including `Claude plugin cache version`), and mirror/runtime locators of the selected hosts without repairing them.
- `pota uninstall`: verifies every non-config ownership-manifest entry against its installed digest first and refuses the whole uninstall, changing nothing, if any managed artifact was modified or removed. Otherwise it removes or restores the managed entries and retained runtimes, prunes empty managed scaffolds, preserves unmanaged targets and their parent directories, and rolls back pre-commit failures. It also removes `~/.pota/update/` and keeps `~/.pota/config.json` and `~/.pota/projects/`. A legacy-layout installation is removed in place without migrating.
- `pota auto-upgrade status|on|off|run`: `status` prints the setting, installed version, last check, and pending notice as JSON; `on` and `off` write `autoUpgrade` to `~/.pota/config.json` and print the same report; `run` checks npm now, ignoring the daily interval and backoff, and prints the result. Exit 0 is success, 1 an execution error or a failed run, 2 a usage error.
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

Install and upgrade keep the custom marketplace lifecycle; they do not invoke `codex plugin add`. Candidates are staged and validated before commit, every current managed destination and digest is recorded in an ownership manifest, and committed phases roll back in reverse order on failure. Artifacts that are modified or not recorded in the ownership manifest are preserved and rejected. Pota edits only its own TOML sections and never forces public feature or agent settings. The source plugin manifest stays validator-friendly; only the installed copies get a `hooks` field. Lifecycle commands must run from the published/global package, not from an installed copy under `~/.pota/install/` or the Codex plugin cache that they replace.

Clean uninstall removes `~/.pota/install/` and the Codex cache root `$CODEX_HOME/plugins/cache/pota` only when every managed scaffold is empty, using empty-directory removal rather than recursive deletion. It does not delete the source repository, repository `MEMORY.md`/`PLAN.md`, user-home Pota goal state, the global `@comento/pota-harness` package, package-manager download caches, legacy backups, or legacy shared settings outside the current ownership manifest; those require a separate explicit cleanup decision.

Codex uses `skills/` and `commands/`. Claude Code uses mirrored commands and agent definitions under `~/.claude/` plus a Claude Code plugin, `pota@pota`. Antigravity uses `.agents/workflows` and global skills mirrors.

The Claude Code plugin is generated in a Pota-owned local marketplace at `~/.pota/install/claude` and carries the four Pota skills and the SessionStart, UserPromptSubmit, PostToolUse, Stop, and SubagentStop hooks, which call the canonical runtime by absolute path. After the files commit, `pota install`/`upgrade` registers it through `claude plugin marketplace add` and `claude plugin install pota@pota --scope user`, so it appears in the Claude Code terminal, desktop app, and IDE plugin lists from the next session. Registration is skipped with a manual command when the `claude` CLI is missing, and a different marketplace already named `pota` is never touched. `pota uninstall` unregisters only Pota's own marketplace before removing files, and re-registers it if the uninstall rolls back. When the Claude Code plugin cache holds a different version, `pota upgrade` refreshes it with `claude plugin marketplace update pota` and `claude plugin update pota@pota --scope user`; if the refresh fails, the upgrade stays installed, prints those commands to finish by hand, and exits 1. `pota doctor` reports `Claude plugin files`, `Claude plugin registered`, `Claude plugin enabled`, and `Claude plugin cache version`.

## Install Layout And Auto-Upgrade

Pota keeps its installation under `POTA_HOME` (default `~/.pota`). `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME`, and `CODEX_CONFIG_PATH` still set the host paths independently.

```text
~/.pota/
  install/                  lifecycle-managed files
    lifecycle.json          ownership manifest (schema 2: hosts, origin, retained runtimes)
    lifecycle.lock, transaction.json, transactions/
    runtime/<version>/      canonical runtime used by every runtime locator and the Claude Code hooks
    codex/                  Codex local marketplace source
    claude/                 Claude Code local marketplace
  projects/                 goal state
  config.json               user settings ("autoUpgrade")
  update/                   auto-upgrade state
$CODEX_HOME/plugins/cache/pota/pota/<version>/   Codex plugin cache copy (only when Codex is selected)
```

- Hosts: `--hosts` takes `all` or a comma list of `codex`, `claude`, and `antigravity`, on `install` and `upgrade` only. The selection is recorded in the ownership manifest, and `upgrade`, `doctor`, and `uninstall` follow it; `pota upgrade --hosts <list>` adds hosts and removes deselected ones (a modified artifact of a deselected host is refused). The interactive prompt offers all hosts (default), Claude Code only, Codex only, Antigravity only, or a comma list, and appears only when nothing is installed yet.
- Retention: an upgrade that changes the version keeps the previous canonical runtime and Codex cache copy for 3 days (at most 3 of each) so sessions started before it keep working. The next install or upgrade removes expired ones, and uninstall removes all of them. A Codex cache copy at or above the new version is never kept, because Codex loads the highest cached version.
- Auto-upgrade: on by default. At most once every 24 hours (and not within 24 hours of an install or upgrade), `SessionStart` starts a detached process that reads the latest `@comento/pota-harness` version from npm, installs that exact version into `~/.pota/update/stage/` with `--ignore-scripts`, verifies the staged package, and runs its `pota-lifecycle.mjs upgrade --auto`. Every newer release is applied, major versions included, and it never downgrades. The next `SessionStart` shows one line, once: `updated`, `failed`, or `manual` (installed, but the Claude Code plugin cache still needs `claude plugin update pota@pota`). npm lookup and install failures back off silently; a failed upgrade backs off and is announced once per version. It never runs for an installation from a git checkout (`origin: "checkout"`) or from a source checkout.
- Turning it off: `pota auto-upgrade off`, `POTA_AUTO_UPGRADE=0` (also `false`, `off`, or `no`), or `"autoUpgrade": false` in `~/.pota/config.json`. A `config.json` that cannot be read also turns it off. State and the last run's output live in `~/.pota/update/` (`state.json`, `notice.json`, `last-run.log`, `update.lock`, `stage/`).

## Antigravity Compatibility

Antigravity supports `SKILL.md`-based Agent Skills and Workflows invoked as `/workflow-name`. Pota installs these paths for that surface.

- Antigravity IDE: `~/.gemini/config/skills/pota-*/SKILL.md`.
- Antigravity CLI: flat `~/.gemini/antigravity-cli/skills/pota-*.md` skill files.

Codex-only hooks are not ported to Antigravity. Instead, the same planning, memory, complexity triage, and two-gate verification procedures run through Skills and Workflows. Set `ANTIGRAVITY_HOME` or `ANTIGRAVITY_CLI_HOME` to override paths.

## Locale Policy

Pota's reusable instructions are written in English for global use. User-visible output and generated or updated documentation, plans, and memory artifacts should follow the configured OS locale unless the user explicitly asks for another language. This includes `MEMORY.md`, `PLAN.md`, `docs/memory`, and `docs/plan` content. The CLI localizes common messages for `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de`, and `pt`, and falls back to English for unsupported locales. Codex hook `statusMessage` text remains static English, while hook command output is English or Korean.

## Delegation

- `explorer`: handles read-only codebase discovery, impact analysis, pattern searches, and read-only verification when available.
- `worker`: handles actual implementation edits or verification tasks with clear file ownership.
- Main session: orchestrates, verifies, and records evidence; it keeps only urgent non-implementation blocking work local when the next step depends immediately on the result, except that unavailable subagent tools make the main agent take over implementation directly.

Every delegation prompt uses six sections: TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
