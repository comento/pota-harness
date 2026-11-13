# Pota Work: Recovery

Reference for `pota-work`. Read only when a gate fails twice, a goal must be paused, blocked, or cancelled, another session owns the goal, or state and plan disagree.

## Bounded Loop Policy

- Run at most two verification passes per task by default.
- If a gate fails, diagnose the cause once, shrink the task or split it into sub-tasks, then rerun both gates.
- After two failed passes, stop implementation for the task, record the blocker in `docs/plan/<topic>.md`, and transition the task or goal to `blocked` with a concrete reason instead of continuing automatically.
- Do not imitate repeated red-green loops unless the plan explicitly records a risk-based reason.

## Truthful Goal States

```sh
node "<pluginRoot>/scripts/pota.mjs" goal task --quiet --root "<repoRoot>" --task "<task-id>" --status blocked --reason "<concrete blocker>"
node "<pluginRoot>/scripts/pota.mjs" goal block --quiet --root "<repoRoot>" --reason "<concrete blocker>"
node "<pluginRoot>/scripts/pota.mjs" goal pause --quiet --root "<repoRoot>"
node "<pluginRoot>/scripts/pota.mjs" goal resume --quiet --root "<repoRoot>"
node "<pluginRoot>/scripts/pota.mjs" goal cancel --quiet --root "<repoRoot>"
```

- `active` is not a completion state. Successful completion or cancellation removes the user-home active state because completed evidence already lives in the plan document; paused and blocked state remains resumable.
- Resume a paused or blocked goal before folding new work into it with `goal replan`. Start a separate goal only when the user explicitly switches work.

## Ownership and State Conflicts

- When a hook reports that another session owns the goal and this session continues that same work, take ownership with `goal claim --quiet --root "<repoRoot>" --session "<session-id-shown-by-hook>"`. Never guess or invent a session ID.
- If the plan task, persisted current task, and worker assignment disagree, or a required reference is missing, unreadable, or inconsistent, do not edit, delegate, record completion evidence, or complete work; report a blocker to the orchestrator.
- If the shared runtime or locator is missing, unreadable, or inconsistent, stop every dependent mirror and recover with published/global `pota doctor` followed by `pota upgrade`; do not use another mirror as a repair source.
