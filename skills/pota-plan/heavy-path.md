# Pota Plan: Heavy Path and Route Changes

Reference for `pota-plan`. Read only when a Heavy Path signal is present or a route change is being considered. Quick Path and Light Path never need this file.

## Heavy Path Flow

Heavy Path flow: plan -> Heavy design task -> pre-implementation review -> bounded `worker` implementation -> verification worker or read-only review.

- On a Heavy route, `goal replan` adds a `kind: "design"` task (`heavy-design`, `route: "heavy"`, `requiredEvidence: ["designRecord"]`) after `triage-plan`, and implementation tasks depend on it. The main agent never does this design inline: dispatch it read-only to the strongest tier (Claude Code Agent `model: "fable"`, `effort: "high"`, never `fork`), record `goal assign heavy-design --model <value> --model-source host-option --host <claude-code|codex|antigravity>`, merge the result into the plan's `## Heavy Design`, and bind that plan with `goal verify --kind designRecord`. A design model that is not the host's strongest tier (`--host claude-code` `fable`, `codex` `gpt-6-astra`, `antigravity` `pro`; any of the three when `--host` is omitted) fails completion unless `--allow-no-design-model <reason>`. This is the only bypass.
- Record the pre-implementation decisions that review must resolve before any mutation.
- Every Heavy Path task includes an explicit automated test command and a `Tests:` evidence line; completion cannot rely on generic verification wording without test evidence.
- Planning, review, and implementation request `high` reasoning effort; final verification and review request `xhigh` (see `pota://skills/pota-plan/delegation.md`).

## Complexity Checkpoints

Use three mandatory checkpoints and record each result, evidence, newly discovered Heavy Path signals, and current route in the plan artifact:

1. **Request checkpoint:** before exploration, make a provisional classification from the request and `MEMORY.md`; uncertainty stays explicit and this result is not implementation authority.
2. **Planning checkpoint:** after repository exploration, affected-surface analysis, and test design, re-evaluate the provisional route and finalize the implementation plan.
3. **Code checkpoint:** during `pota-work`, inspect the exact files, callers, and tests, then record one final re-evaluation immediately before the first edit. A pending or missing code checkpoint blocks mutation.

## Route Changes

- Before the first edit, the planning or code checkpoint may change Light Path to Heavy Path or Heavy Path to Light Path when the evidence supports it.
- Every route change rebuilds and synchronizes the plan artifact, the repository goal task roadmap through `goal replan`, and the native UI plan, including assignments, reviews, required evidence, and the reasoning effort profile. Do not mutate until all agree.
- After editing starts, only promote Light Path to Heavy Path: stop further edits, mark affected evidence stale, revise and synchronize all roadmaps, run newly required Heavy Path review, and repeat the code checkpoint before resuming.
- A subagent's model and effort are fixed at dispatch; any re-dispatch that changes either (one tier up, Light → Heavy promotion, route-change recalculation) MUST be a new dispatch (Claude Code: a new Agent call), never `SendMessage` to the existing subagent.
- A Quick Path change that meets any failed Quick Path criterion escalates to Light Path first (plan + goal) before further edits; a Heavy signal then follows this file.
