# Pota Work: Heavy Path and Route Changes

Reference for `pota-work`. Read only when the recorded route is Heavy Path, a new Heavy Path signal appears, or a route change is being considered. Quick Path and Light Path never need this file.

## Heavy Path Execution

- Follow the full planning and review pipeline recorded in the plan without role-mapping shortcuts: pre-implementation review before mutation, bounded `worker` implementation, then verification worker or read-only review after evidence exists.
- Heavy implementation cannot complete until a completed `kind: "design"` task exists (record it with `--host <claude-code|codex|antigravity>`). A design model that is not the host's strongest tier (`--host claude-code` `fable`, `codex` `gpt-6-astra`, `antigravity` `pro`; any of the three when `--host` is omitted) fails completion unless `--allow-no-design-model <reason>`. This is the only bypass.
- Run the recorded automated test command and record explicit `Tests:` evidence in the plan before claiming completion. This is required even when module acceptance uses a broader check command.
- Planning, review, and implementation request `high` reasoning effort; final verification and review request `xhigh`.

## Route Changes During Work

1. Confirm the request checkpoint and planning checkpoint, inspect the exact files, callers, and tests, then record the code checkpoint immediately before the first edit. Missing or pending checkpoints block mutation.
2. Before the first edit, evidence may change Light Path to Heavy Path or Heavy Path to Light Path. On every route change, update the plan artifact first, replace the incomplete repository goal task roadmap with `goal replan`, update the native UI plan to the same stable task order, and synchronize assignments, reviews, required evidence, and the reasoning effort profile. Do not mutate until all agree.
3. After editing starts, only promote Light Path to Heavy Path. On a new Heavy Path signal, stop further edits, mark affected evidence stale, revise and synchronize the plan artifact, repository goal task roadmap, and native UI plan, run newly required Heavy Path review, and repeat the code checkpoint before resuming.
4. A subagent's model and effort are fixed at dispatch; any re-dispatch that changes either (one tier up, Light → Heavy promotion, route-change recalculation) MUST be a new dispatch (Claude Code: a new Agent call), never `SendMessage` to the existing subagent.
5. Quick Path work that hits any failed Quick Path criterion first escalates to Light Path (create plan + goal) before further edits; a Heavy signal then follows step 3.
