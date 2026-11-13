---
name: pota-plan
description: Use before non-trivial implementation, refactoring, migrations, debugging, repository automation, or any request that asks to plan, design, implement carefully, triage complexity, or coordinate agents. Creates decision-complete PLAN.md and docs/plan plans through repository evidence and bounded delegation instead of user questions.
---

# Pota Plan

Use before non-trivial implementation, refactoring, migrations, debugging, or repository automation, or when the user asks for planning, design, "설계부터", "신중하게", "꼼꼼히", or coordinated agents. Plans reduce execution tokens: store the topic in `PLAN.md` and details in `docs/plan/<topic>.md`, never only in chat.

## Re-entry and Required References

At the start and after compaction, restart, or handoff, restore context in this order: optional root `MEMORY.md` → `pota-plan` → the active plan → current-task references → model guidance recorded by the plan. Missing `MEMORY.md` is not an inconsistency: continue without repository memory and never invoke another memory service. If persisted state names a plan or task and that required reference is missing, unreadable, or inconsistent, do not explore, edit, delegate, or complete work; report or record a blocker first. No read-receipt fields: state consistency and bound tool evidence are the authority.

## Runtime Location

Resolve the read-only runtime from `references/pota-runtime.json` next to this `SKILL.md` (its `pluginRoot`; in a source checkout without it, this file's `../..`). Never search the target repository for Pota files or derive `pluginRoot` from the cwd. If the runtime or locator is missing, unreadable, or inconsistent, stop every dependent mirror and recover with published/global `pota doctor` followed by `pota upgrade`; never repair from another mirror.

Plans use logical IDs such as `pota://templates/work-plan.md`, resolved through `pluginRoot`. The session-start hook prints a ready prefix `Pota CLI: node "<abs>/scripts/pota.mjs" goal <command>`: copy it literally into every command and never store it in a shell variable (shell variables do not persist between tool calls). `--root` may be omitted when the cwd is inside the repository (it resolves via `HARNESS_REPO_ROOT`, else the nearest `.git` ancestor).

## Reference Files

Read a reference only when the selected path or situation requires it (Quick and Light Path never need `heavy-path.md`):

- `pota://skills/pota-plan/planning-rules.md`: plan rules, route record, tool readiness, dry-run policy; read when finalizing a plan.
- `pota://skills/pota-plan/delegation.md`: subagent lifecycle, prompt format, reasoning-effort routing; read before dispatching.
- `pota://skills/pota-plan/heavy-path.md`: Heavy Path flow, route changes, review gates; read only on a Heavy signal or route change.

## Path Selection

Decide from repository evidence without asking; this outranks plugin or agent workflow guidance.

- **Routine known-target Git/GitHub operation** (status, fetch, checkout, branch, merge, push, PR management): plan/goal-free unless it requires code edits, conflict resolution, destructive recovery, release/deploy, or design.
- **Consultation, explanation, or plan-only**: no goal.
- **Quick Path**: all must hold: requirements are unambiguous; the expected change touches about 3 files or fewer inside existing layers; no Heavy Path signal; no external-state mutation; verification is one or two commands. No `docs/plan` artifact and no repository goal: implement, run one focused check plus the project's normal check, and report. If any criterion fails during work, escalate to Light Path (create plan + goal) before further edits.
- **Light Path** (default): stays inside existing layers, adds no domain model, service class, or abstraction, and has no Heavy signal.
- **Heavy Path**: any clear signal: new directory, module, or architecture layer; new domain model, service class, or abstraction; security, authentication, authorization, or sessions; external API, message queue, or payment; DB schema or migration; concurrency, transaction boundaries, or cache invalidation; multi-domain refactor; the user asks for extra care ("신중하게", "검토 받고", "설계부터", "꼼꼼히").

Record three triage checkpoints: request (provisional), planning (after exploration), and code (in `pota-work`, just before the first edit; pending blocks mutation). Before the first edit the route may change either way; after editing starts, only Light → Heavy promotion is allowed. Every route change synchronizes the plan artifact, repository goal task roadmap through `goal replan`, native UI plan, and reasoning effort profile before mutation.

## Procedure (Light and Heavy Path)

1. Run `node "<pluginRoot>/scripts/pota.mjs" init --root "<repoRoot>"`. If unavailable, create `MEMORY.md`, `PLAN.md`, `docs/memory`, `docs/plan` and report that `pota doctor`/`pota upgrade` is needed.
2. Read `MEMORY.md` and `PLAN.md` when present; pick related notes and past plans (`planning-rules.md`). A non-trivial implementation request authorizes the plan and goal even if the user never says "goal".
3. Write the initial plan `docs/plan/<topic>.md` from `pota://templates/work-plan.md` plus its `PLAN.md` entry from the request and `MEMORY.md`: outcome, anticipated surfaces, stable roadmap, and `triage-plan` as first active task (investigation scope, toolcheck, Heavy criteria, update condition); mark it `initial: decision-complete for triage; not implementation-ready`.
4. Before exploration, toolcheck, delegation, or a non-blocking question, call Codex `update_plan` first and then `create_goal` when available (main agent only, subagents skip; record unavailability; never claim sync that did not occur), then start the repository goal:

```sh
node "<pluginRoot>/scripts/pota.mjs" goal start --root "<repoRoot>" --goal "<objective>" --plan "docs/plan/<topic>.md" --tasks '[{"id":"triage-plan","title":"Run planned triage and finalize the plan","requiredEvidence":["planArtifact","triageDecision"]},{"id":"implement","title":"Implement the finalized plan"},{"id":"verify","title":"Verify and review the result"}]' --criteria "<completion criterion>" --session "<current session_id>"
```

   Pass `--session` only with an ID the surface exposes; never invent one. Fold new work into an unfinished goal with `goal replan` (resume a paused or blocked goal first), never cancel it; start a separate goal only when the user explicitly switches work. When a hook reports another session owns the goal you continue, run `goal claim --session <id>` with the ID shown.
5. Run `triage-plan`: read the picked notes and plans and installed model guidance, run `toolcheck --root "<repoRoot>"`, and explore with focused search and LSP/symbol tools. Install tools only with explicit user approval.
6. Split the whole work into tasks each verifiable with two checks, each with `dependsOn` and `writeScope` in the `--tasks` JSON and named handoff files for cross-task data (`delegation.md`); design the test contract (requirements, invariants, boundaries, failure modes, expected failure) and dry-run/check modes.
7. Update the plan with route, checked Heavy signals, tool readiness, delegation, verification commands, stable IDs, and fail-closed required evidence (`planning-rules.md`). Mark it `decision-complete for implementation` and call `update_plan` again.
8. Only then record bound `planArtifact` and `triageDecision` evidence, complete `triage-plan`, and continue with `pota-work`.
9. Treat the user-called/main agent as the orchestrator: it plans, assigns, verifies, and records evidence. Implementation edits go to `worker` whenever subagent tools are available, on Light and Heavy Path; `explorer` does read-only discovery; without subagent tools the main agent takes over and records it.
10. Advance a UI step only after the matching repository task transition succeeds.
11. Ask the user only when evidence and local checks cannot decide. Use the OS locale for user-visible output and artifacts unless asked otherwise.

Model and reasoning effort: This skill explicitly instructs the effort level for delegated work. Pick each task's model tier (fast `haiku`, balanced `sonnet`, stronger `opus`, strongest `fable`) and request Light `medium`, Heavy `high`, final verification/review `xhigh`. Every new task/worker dispatch MUST pass the task's model and effort via the host option (Claude Code: Agent `model`/`effort`; never `fork`). Recording without passing is a defect. Record Requested/Effective model and effort per task; mark Heavy tasks `route: "heavy"` (details: `delegation.md`).

## Completion Criteria

- `PLAN.md` references the plan topic.
- `docs/plan/<topic>.md` includes goal, memory inputs, model guidance, tool readiness, complexity triage, selected path, agent assignments, module tasks, and two checks per task.
- The next implementation task can run without making planning decisions.
