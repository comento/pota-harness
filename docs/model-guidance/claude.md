# Claude Model Guidance

Claude-family models are strong at long-context retention, policy interpretation, and plan consistency review. In Pota, use those strengths for planning, policy interpretation, and evidence review.

## Use Strengths

- Read policies across multiple documents and summarize conflicts.
- Judge domain boundaries, risk, rollback ability, and user impact.
- Check whether required LSP, typecheck, lint, dry-run, and verification tools were discovered and bootstrapped.
- Check whether `docs/plan/<topic>.md` is decision-complete.
- After implementation, confirm that evidence actually satisfies the plan's completion criteria.

## Adjustment Rules

- Do not bloat plans with long explanations. Keep decisions, rationale, and evidence.
- Preserve frequency words such as "all", "each", and "required". Do not handle only the first item and stop.
- Do not accept "tool missing" as a reason to skip precise codebase exploration until install or bootstrap has been attempted.
- Do not skip the two verification gates even on Light Path.
- Do not approve a plan that lacks dry-run or check evidence for external-state-changing work.
- Do not allow open-ended verification loops. Require a blocker or sub-task split after two failed passes.
- Choose the model per task (fast `haiku`, balanced `sonnet`, stronger `opus`: planning, triage, Heavy implementation, review, final verification/review; strongest `fable`: Heavy design only, as a separate `kind: "design"` task dispatched to that tier rather than part of planning) and record `Requested model`/`Effective model`; Effective is the passed value plus the exact model ID the worker reports from its own system prompt (`<value> (unreported)` when absent, never guess), `not-applied: <reason>`, or `inherited` when the host has no model option. Re-dispatch one tier up (fast, balanced, stronger, strongest) if a lower-tier worker fails a gate. A subagent's model and effort are fixed at dispatch; any re-dispatch that changes either (one tier up, Light → Heavy promotion, route-change recalculation) MUST be a new dispatch (Claude Code: a new Agent call), never `SendMessage` to the existing subagent. A design model that is not the host's strongest tier (`--host claude-code` `fable`, `codex` `gpt-6-astra`, `antigravity` `pro`; any of the three when `--host` is omitted) fails completion unless `--allow-no-design-model <reason>`. `Model routing: inherited` disables this. `Requested reasoning effort` is Pota's desired profile; `Effective reasoning effort` is what the dispatch response confirms. Every new task/worker dispatch MUST pass the task's requested effort through the host option together with the chosen model; recording without passing is a defect. Effective is the requested value when the dispatch passed it and the host did not reject it, `not-applied: <reason>` when it was not passed, and `inherited` only when the host exposes no effort option. Infer capability only from the exposed interface or dispatch response, distinguish Pota non-integration from host non-support, and change no global/user configuration.
- In Claude Code, pass model with the Agent tool `model` parameter (`haiku|sonnet|opus|fable`) and effort with `effort` (`low|medium|high|xhigh|max`, same as Pota values), for example `{"description": "Implement task-1", "subagent_type": "general-purpose", "model": "sonnet", "effort": "medium", "prompt": "..."}`. `subagent_type: "fork"` ignores `model` and `effort`; never dispatch routed work as a fork.
- On Heavy Path, check plan gaps before implementation.
- Review all three complexity records: the provisional request checkpoint, post-exploration planning checkpoint, and code checkpoint after exact file/caller/test inspection immediately before the first edit. Before editing, evidence may change either route. Every change must synchronize the plan artifact, repository goal task roadmap through `goal replan`, and native UI plan, including reviews and required evidence. After editing begins, a new Heavy signal promotes Light Path to Heavy Path: stop further edits, mark affected evidence stale, synchronize all three roadmaps, and repeat the code checkpoint.
- Before asking the user, use repository evidence and available `explorer`/`worker` delegation when it materially improves speed or quality.
- Write user-visible responses and generated or updated documentation, plans, and memory artifacts in the OS locale unless the user asks for another language.

## Path Guidance

### Policy And Risk

- Summarize domain boundaries and risk from repository evidence.
- If policy is unclear, propose candidates to record in `docs/memory/<domain>.md`.
- Clearly name risk signals that require Heavy Path.

### Planning

- Keep the plan short and executable.
- Always record complexity triage and the selected Light/Heavy Path.
- Always record tool readiness and blockers.
- Each module task must include files, contract, dry-run or check command when applicable, module acceptance verification, and surface integration verification.

### Review

- Lead with findings.
- Do not approve without evidence.
- Check that missing tools have install-attempt evidence before approving a fallback.
- Check that dry-run or check evidence exists when external state could change.
- Prioritize proper noun preservation, plan scope drift, and missing verification.
