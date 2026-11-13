---
name: pota-review
description: Review completed Pota tasks against MEMORY.md, PLAN.md, domain policy, and two-gate evidence.
---

# Pota Review

Use this after meaningful implementation with Pota.

## Purpose

Review is not another implementation loop. Confirm that the completed task satisfies the plan and that memory and plan artifacts are useful to the next agent.

Every review run and delegated review agent reads project-root `MEMORY.md` when present. If it is absent, continue without repository memory and do not invoke another memory service.

At the start and after compaction, restart, delegation, or handoff, restore context in this order: optional root `MEMORY.md` → `pota-review` → the active plan → completed/current-task references → model guidance recorded by the plan. Missing `MEMORY.md` is not an inconsistency. Confirm the remaining references agree with persisted goal state before reviewing. If any required reference is missing, unreadable, or inconsistent, do not approve, delegate, record final review, or complete the goal; report a blocker. Do not use a read-receipt field as evidence that a model understood a reference. Delegation means the delegated agent restores on its own entry; the orchestrator does not re-read this chain after dispatching or collecting a subagent, and within one unbroken context it rereads only references that changed, which keeps the cached prompt prefix stable.

When subagent tools are available, each agent may recursively delegate bounded review sub-tasks to subagents. Every child subagent reads project-root `MEMORY.md` when present and continues when absent, keeps the assigned scope, and preserves others' edits.

Resolve any `pota://...` resource through `references/pota-runtime.json` next to this `SKILL.md` (or this skill's `../..` source root during development). Never look for Pota runtime resources in the target repository. If the shared runtime or locator is missing, unreadable, or inconsistent, stop every dependent mirror and recover from the published/global package with `pota doctor` followed by `pota upgrade`; do not use another mirror as a repair source.

## Procedure

1. Read the completed task in `docs/plan/<topic>.md`.
2. Read `MEMORY.md` when present and relevant `docs/memory/*.md`; continue when repository memory is absent.
3. Check changed files, tool readiness evidence, and evidence paths. Inspect test, fixture, and verification-command diffs and reject any weakening without a recorded plan reason. For defect fixes, confirm the same-rule sweep was performed and its result recorded.
   - Confirm the plan's Evidence has a filled `Memory promotion:` line (`docs/memory/<domain>.md` or `none: <reason>`) and that `node "<pluginRoot>/scripts/pota.mjs" memory check --root "<repoRoot>"` and `plan check --root "<repoRoot>"` exit 0. A `none: <reason>` decision is acceptable: do not create a note or demand one; flag a missing or placeholder line, or a named note that does not exist.
4. Delegate independent review when it materially improves speed or quality and the current tool policy allows it.
   - Use `explorer` for read-only impact analysis, pattern checks, and independent diff inspection.
   - Use `worker` for scoped verification command re-runs or QA artifact capture.
   - Recursive subagent delegation is allowed only for bounded sub-tasks when the current surface supports it.
   - Keep blocking review work local when the next step depends immediately on the result.
5. Report findings first, ordered by severity, with file and line references. If there are no issues, say so clearly and record remaining test gaps or residual risk.
6. Write user-visible responses and generated or updated documentation, plans, and memory artifacts in the OS locale unless the user asks for another language.

## Reviewer Prompt Format

```text
TASK: Review correctness, scope, and evidence for task <task-id>.
EXPECTED OUTCOME: Findings ordered by severity with file and line references, or an explicit no-issue result with residual risk.
REQUIRED TOOLS: Read-only diff inspection, tool readiness checks, verification command execution, plan/memory reading.
MUST DO: Read the project-root `MEMORY.md` before doing assigned work. Check tool readiness and install-attempt evidence. Check dry-run or check evidence when external state could change. Check both module evidence and surface evidence. Check the `Memory promotion:` decision line and the `memory check` and `plan check` results. Preserve proper nouns exactly. Use the OS locale for user-visible responses and generated or updated documentation, plans, and memory artifacts.
MUST NOT DO: Edit files. Ask the user. Approve skipped LSP/typecheck/lint without install evidence. Approve weakened, skipped, or deleted tests or verification commands without a recorded plan reason. Approve missing evidence or open-ended verification loops.
CONTEXT: docs/plan/<topic>.md, MEMORY.md, relevant docs/memory notes, changed files.
```

## Completion Criteria

- Findings are resolved or recorded as residual risk.
- Tool readiness evidence is present for required LSP/check/verification tools.
- Dry-run or check evidence is present when required, or the plan records why no dry-run exists.
- Failed gates followed the bounded loop policy and did not continue past two verification passes without a recorded blocker.
- Review evidence exists in `docs/plan/<topic>.md`.
- The plan records its `Memory promotion:` decision, and `memory check` and `plan check` pass.
- Goal-level final review evidence is stored as a successful structured evidence record before the goal is marked `completed`.
- The next agent can understand verification without rereading the full conversation.
