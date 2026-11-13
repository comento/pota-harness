# pota-review

Use the `pota-review` skill.

Prerequisite: resolve Pota from its installed runtime locator. If the shared runtime or locator is missing, unreadable, or inconsistent, stop every dependent mirror; run published/global `pota doctor`, then `pota upgrade` to recover it. Never repair through another mirror or look for Pota runtime files in the target repository.

Goal: review completed work against plan, memory, policy, and evidence.

Procedure:

1. Every agent reads project-root `MEMORY.md` when present and continues without repository memory when absent before review work, then reads the plan task and available memory inputs.
2. Check changed files, tool readiness evidence, and verification evidence. Inspect test, fixture, and verification-command diffs and reject any weakening without a recorded plan reason. For defect fixes, confirm the same-rule sweep was performed and its result recorded. Confirm the plan's Evidence has a filled `Memory promotion:` line (`docs/memory/<domain>.md` or `none: <reason>`) and that the installed Pota CLI's `memory check --root <repoRoot>` and `plan check --root <repoRoot>` exit 0. A `none: <reason>` decision is acceptable: do not create a note or demand one; flag a missing or placeholder line, or a named note that does not exist.
3. Delegate independent read-only review to `explorer` when it materially improves speed or quality; use `worker` only for scoped verification reruns or QA artifacts. When subagent tools are available, each agent may recursively delegate bounded sub-tasks to subagents. Tell every delegated agent and child subagent to read the project-root `MEMORY.md` before work, keep scope, and preserve others' edits.
4. Report findings first, ordered by severity, with file and line references. If no issues are found, say so clearly and mention remaining test gaps or residual risk.
5. Record review evidence in `docs/plan/<topic>.md` and as the goal-level final review evidence record before completing the goal.
6. Use the OS locale for user-visible responses and generated or updated documentation, plans, and memory artifacts unless the user asks for another language.
