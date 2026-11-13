# Pota Work: Verification Detail

Reference for `pota-work`. Read when a gate needs more than the evidence rules in `SKILL.md`: watch sets, timeouts, freshness, defect investigation, missing tools, or external-state dry-runs, and before `goal finish` for the memory promotion decision.

## Goal Verify Semantics

- `goal verify --task "<task-id>" --kind "<kind>[|<kind>]" [--watch "<path|path>"] [--timeout-ms N] -- <argv>` executes the argv without a shell and records exit code, bounded tool output, output digest, and watched-workspace fingerprint. With several kinds, one run records one receipt per kind.
- Evidence scopes are only `task` and `goal`. Goal scope is normally recorded by `goal finish`; the long form is `goal task --status completed` → `goal verify --scope goal --kind finalReview -- <argv>` → `goal complete`.
- Verification defaults to 600,000 ms (10 minutes), accepts a shorter `--timeout-ms`, and is capped at 3,600,000 ms (1 hour).
- The external command never holds the state lock. A receipt is committed only when the starting goal/task identity and the pre/post watched fingerprint still match.
- Choose the watch set and verification command at the semantic boundary that proves the claimed behavior. With no explicit watch, Git-ignored files are excluded; pass each ignored artifact required by the claim with `--watch <path>` or watch its containing directory.
- The legacy `goal receipt` command imports declared evidence for compatibility; declared evidence does not satisfy a default tool-bound goal.

## Freshness

- A task's required evidence must be fresh when that task is completed. Any relevant mutation after a gate makes that result stale evidence: rerun the affected focused gate and, when integration could change, the full gate.
- At goal completion, task evidence fingerprints are not rechecked when a fresh goal-scope receipt for every goal requiredEvidence kind was recorded after every task receipt. Do not rerun earlier tasks' checks after later edits; run one final goal-level check instead (`goal finish`).
- If goal requiredEvidence is empty, task freshness is still rechecked at goal completion.
- `goal stats` prints JSON with verify receipt counts (total, by kind), reruns (repeated scope+task+kind), and currently stale receipts. Use it to measure verification overhead.
- The PostToolUse evidence reminder is emitted once per goal/task/session, not after every edit; its absence is not evidence.

## Token-Efficient Test Contract

1. Run the focused contract tests.
2. Implement the minimum change and rerun only those tests while diagnosing.
3. Run the full repository check once after the final change.
4. Before package verification, inspect lifecycle scripts such as `prepack`, `prepare`, and `prepublishOnly` and classify whether they produce package contents.
5. Run normal `npm pack --dry-run` by default. Content-producing or unknown lifecycle scripts must never be skipped with `--ignore-scripts`; their generated contents are part of the package contract.
6. Only when lifecycle scripts are absent or proven content-neutral, the full check is still fresh, and the dry-run only checks the file list may package verification use `npm pack --dry-run --ignore-scripts`.

On success retain only the command, exit code, and pass count needed for evidence. Do not reread unrelated files or replay successful output.

## Verification Integrity

- The implementer must not be able to change the judge. Never edit, weaken, skip, or delete existing tests, fixtures, snapshots, or recorded verification commands to make a gate pass. When a contract genuinely changes, record the reason in `docs/plan/<topic>.md` before that edit; review rejects any judge change without a recorded reason.
- Prefer executable checks (test, lint, script, hook) for machine-checkable rules; keep prose only for rules that need judgment.

## Memory Promotion

Decide once per goal, before `goal finish`, whether the goal produced repository knowledge the next agent should reuse, and record the decision in the plan's `## Evidence` as exactly one of:

- `Memory promotion: docs/memory/<domain>.md`: the note written or updated for this goal.
- `Memory promotion: none: <reason>`: nothing worth promoting, with the reason.

The decision line is required; the note is optional. When nothing qualifies, do not create a note; record `none: <reason>`.

- Promote: non-obvious constraints or invariants the next task would have to rediscover, decisions with their rejected alternatives, recurring failures and their fixes, and verification recipes.
- Do not promote: what the code or tests already state, details that apply only to this task, or a restatement of the plan.
- When promoting, write or update `docs/memory/<domain>.md` with its `Summary:` line (`pota-memory`), then run `node "<pluginRoot>/scripts/pota.mjs" memory index --root "<repoRoot>"` and `memory check --root "<repoRoot>"`.
- The `Memory promotion:` key and the `none` value are fixed English tokens. When a goal completes through `goal finish` or `goal complete` and its plan file has no filled `Memory promotion:` line, Pota prints a one-line reminder on stderr; exit code and stdout are unchanged and completion is never blocked. `goal stats --history` counts the decisions across goals.

## Defect Investigation

- Reproduce a reported defect with repository tools before fixing it; do not wait for more detail when a local reproduction is possible.
- For unclear or non-reproducible failures, test one hypothesis at a time and close it with a measurement before changing code. Never fix on speculation.
- Answer feasibility questions with a bounded experiment or measurement instead of an unverified "not possible". Stop and ask only when the experiment would bypass a security policy or mutate external state without approval.
- After fixing a defect, search the repository for other implementations of the same rule or pattern. Fix them within the assigned scope or record them as follow-up in the plan.

## Two Verification Gates

- Module acceptance: targeted unit, typecheck, lint, parser, schema, or command that proves the module contract.
- Surface integration: HTTP, browser, CLI, tmux, desktop, or parsed artifact evidence proving behavior through the real surface.
- Heavy Path test gate: an explicit automated test command recorded as `Tests:` evidence, even when module acceptance uses a broader check.

## Tool Readiness Policy

- Run the tool readiness command recorded in the plan before implementation; if none is recorded, run the runtime's `toolcheck --root "<repoRoot>"`.
- Missing LSP, typecheck, lint, dry-run, or verification tools must be reported with an install proposal. Installation requires explicit user approval and a pinned/supported installer (`toolcheck --install --yes`) or an approved repository-native command.
- After installation, rerun the exact tool command and record evidence. If installation fails, stop the task and record the blocker rather than silently falling back to less precise exploration.

## Dry-Run Policy

Run the closest available dry-run or check mode before commands that mutate external state.

- Migrations and database changes: `--pretend`, dry-run, schema diff, rollback feasibility check, or equivalent.
- Package and release work: inspect lifecycle scripts, then run normal `npm pack --dry-run`, publish dry-run, build check, or equivalent. Use `--ignore-scripts` only for absent or proven content-neutral lifecycle scripts while prior full-check evidence remains fresh.
- Infrastructure and deployment: plan, diff, validate, check, or equivalent.
- Code generation and formatting: check mode before write mode when available.
- If no dry-run mode exists, record that fact in `docs/plan/<topic>.md` before continuing.
