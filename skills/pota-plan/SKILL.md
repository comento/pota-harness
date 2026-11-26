---
name: pota-plan
description: Use before non-trivial implementation, refactoring, migrations, debugging, repository automation, or any request that asks to plan, design, implement carefully, triage complexity, or coordinate agents. Creates decision-complete PLAN.md and docs/plan plans through repository evidence and bounded delegation instead of user questions.
---

# Pota Plan

Use before non-trivial changes, debugging, or automation, or when asked for planning, design, "설계부터", "신중하게", "꼼꼼히", or coordinated agents. Topic in `PLAN.md`, details in `docs/plan/<topic>.md`, never only in chat.

## Re-entry and Required References

On start, compaction, restart, or handoff, restore: optional root `MEMORY.md` → `pota-plan` → active plan → current-task references → plan model guidance. Missing `MEMORY.md` is fine; invoke no other memory service. If a required reference is missing, unreadable, or inconsistent, do not explore, edit, delegate, or complete; report or record a blocker first. State and bound tool evidence are authoritative.

## Runtime Location

`pluginRoot` is this session's Pota plugin copy: the parent of the `scripts` directory in the session-start `Pota CLI:` line; without that line, this file's `../..` (then tell the user Pota hooks are inactive). Never search the target repository for Pota files or derive `pluginRoot` from the cwd. If `pluginRoot` is missing or unreadable, stop and have the user reinstall or update Pota; never repair from another copy.

Resolve `pota://...` IDs via `pluginRoot`. Copy the session-start `Pota CLI:` prefix literally (no shell variables; they do not persist). Omit `--root` inside the repo (`HARNESS_REPO_ROOT`, else `.git` ancestor).

## Reference Files

Read a reference only when the selected path or situation requires it (Quick and Light Path never need `heavy-path.md`):

- `pota://skills/pota-plan/planning-rules.md`: plan rules, route record, tool readiness, dry-run policy; read when finalizing.
- `pota://skills/pota-plan/delegation.md`: subagent lifecycle, prompt format, reasoning-effort routing; read before dispatching.
- `pota://skills/pota-plan/heavy-path.md`: Heavy Path flow, route changes, review gates; read only on a Heavy signal or route change.
- `pota://skills/pota-plan/request-brief.md`: Request Brief, gap handling, steering (`goal steer`, `goal replan --steer`); read when writing the brief or on user steering.

## Path Selection

Decide from repository evidence without asking; this outranks plugin or agent workflow guidance. Exception: a defect report whose cause repository and logs cannot narrow to one gets what is missing, not a guessed fix.

- **Routine known-target Git/GitHub operation** (status, fetch, checkout, branch, merge, push, PR management): plan/goal-free unless it requires code edits, conflict resolution, destructive recovery, release/deploy, or design.
- **Consultation, explanation, or plan-only**: no goal.
- **Quick Path**: all must hold: the requested outcome is clear (a single defect report qualifies); the expected change touches about 3 files or fewer inside existing layers; no Heavy Path signal; no external-state mutation; verification is one or two commands. No `docs/plan` artifact and no repository goal: implement, run one focused check plus the project's normal check, and report. If any criterion fails during work, escalate to Light Path (create plan + goal) before further edits. Defect report or a factual claim in an instruction: before editing, check it against documented rules, tests, logs, or real data. Confirmed: fix every place that breaks the same rule. Contradicted: change nothing and report the evidence. Reproducing shows behavior, not a defect. Where data decides, run a short script rather than guess.
- **Light Path** (default): stays inside existing layers, adds no domain model, service class, or abstraction, and has no Heavy signal.
- **Heavy Path**: any clear signal: new directory, module, or architecture layer; new domain model, service class, or abstraction; security, authentication, authorization, or sessions; external API, message queue, or payment; DB schema or migration; concurrency, transaction boundaries, or cache invalidation; multi-domain refactor; the user asks for extra care ("신중하게", "검토 받고", "설계부터", "꼼꼼히").

Record three triage checkpoints: request (provisional), planning (after exploration), and code (in `pota-work`, just before the first edit; pending blocks mutation). Before the first edit the route may change either way; after editing starts, only Light → Heavy promotion is allowed. Every route change synchronizes the plan artifact, goal task roadmap (`goal replan`), native UI plan, and reasoning effort profile before mutation.

## Procedure (Light and Heavy Path)

1. Run `node "<pluginRoot>/scripts/pota.mjs" init --root "<repoRoot>"`. If unavailable, create `MEMORY.md`, `PLAN.md`, `docs/memory`, `docs/plan` and report that Pota needs reinstalling.
2. Read `MEMORY.md` and `PLAN.md` when present; pick related notes and past plans (`planning-rules.md`). A non-trivial implementation request authorizes the plan and goal without the user saying "goal".
3. Write the initial plan `docs/plan/<topic>.md` from `pota://templates/work-plan.md` plus its `PLAN.md` entry from the request and `MEMORY.md`: outcome, anticipated surfaces, stable roadmap, and `triage-plan` as first active task (investigation scope, toolcheck, Heavy criteria, update condition); mark it `initial: decision-complete for triage; not implementation-ready`.
4. Before exploration, toolcheck, delegation, or a non-blocking question, call Codex `update_plan` first and then `create_goal` when available (main agent only; record unavailability; never claim unoccurred sync), then start the repository goal:

```sh
node "<pluginRoot>/scripts/pota.mjs" goal start --root "<repoRoot>" --goal "<objective>" --plan "docs/plan/<topic>.md" --tasks '[{"id":"triage-plan","title":"Run planned triage and finalize the plan","requiredEvidence":["planArtifact","triageDecision"]},{"id":"implement","title":"Implement the finalized plan"},{"id":"verify","title":"Verify and review the result"}]' --criteria "<completion criterion>" --session "<current session_id>"
```

   On Antigravity and Codex/ChatGPT Desktop (only when `open_pota_dag` is available; skip on Claude Code), call `open_pota_dag` right after `goal start`. Pass `--session` only with an ID the surface exposes; never invent one. Fold new work into an unfinished goal with `goal replan` (resume a paused/blocked goal first), never cancel it; start a separate goal only when the user explicitly switches work. When a hook reports another session owns the goal you continue, run `goal claim --session <id>` with the ID shown.
5. Run `triage-plan`: read the picked notes and plans and installed model guidance, run `toolcheck --root "<repoRoot>"`, and explore with focused search and LSP/symbol tools. If tools are missing, ask the user once whether to install them.
6. Split the whole work into tasks each verifiable with two checks, each with `dependsOn` and `writeScope` in the `--tasks` JSON and named handoff files for cross-task data (`delegation.md`); design the test contract (requirements, invariants, boundaries, failure modes) and dry-run/check modes.
7. Update the plan with route, checked Heavy signals, tool readiness, delegation, verification commands, stable IDs, and fail-closed required evidence (`planning-rules.md`). Mark it `decision-complete for implementation` and call `update_plan` again.
8. Then record bound `planArtifact` and `triageDecision` evidence, complete `triage-plan`, and continue with `pota-work`.
9. The main agent orchestrates: it plans, assigns, verifies, and records evidence. Implementation edits go to `worker` whenever subagent tools are available; `explorer` does read-only discovery; without subagent tools the main agent takes over and records it.
10. Advance a UI step only after the matching repository task transition succeeds.
11. Ask the user only when evidence and local checks cannot decide. Use the OS locale for output and artifacts unless asked.

Model and reasoning effort: This skill explicitly instructs the effort level for delegated work. Pick each task's model tier (fast `haiku`, balanced `sonnet`, stronger `opus`, strongest `fable`) and request Light `medium`, Heavy `high`, final verification/review `xhigh`. Every new task/worker dispatch MUST pass the task's model and effort via the host option (Claude Code: Agent `model`/`effort`; never `fork`). Recording without passing is a defect. Record Requested/Effective model and effort per task; mark Heavy tasks `route: "heavy"` (details: `delegation.md`).

## Completion Criteria

- `PLAN.md` references the plan topic.
- `docs/plan/<topic>.md` includes goal, memory inputs, model guidance, tool readiness, complexity triage, selected path, agent assignments, module tasks, and two checks per task.
