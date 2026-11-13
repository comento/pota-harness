# pota-memory

Use the `pota-memory` skill.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Pota scripts and policy resources must be resolved through that locator, not from the target project. If the shared runtime or locator is missing, unreadable, or inconsistent, stop all dependent mirrors and recover with published/global `pota doctor` followed by `pota upgrade`; do not repair through another mirror.

Goal: create or update repository memory without asking the user for discoverable facts.

Procedure:

1. Ensure `MEMORY.md`, `PLAN.md`, `docs/memory`, and `docs/plan`.
2. Every agent reads project-root `MEMORY.md` when present and continues without repository memory when absent before assigned discovery or update work.
3. Explore repository facts with focused tools.
4. Use `explorer` for read-only domain discovery and contradiction checks when available; use `worker` for exact references, command checks, and bounded evidence capture. When subagent tools are available, each agent may recursively delegate bounded sub-tasks to subagents. Tell every delegated agent and child subagent to read the project-root `MEMORY.md` before work, keep scope, and preserve others' edits.
5. Write details to `docs/memory/<domain>.md` with a `Summary:` line under the H1 (one line, at most 120 characters: what the note answers and when to read it). When a lesson or correction recurs and is machine-checkable, encode it as a test, lint rule, script, or hook instead of more prose; memory keeps judgment rules and a pointer to the enforcing check.
6. Keep `MEMORY.md` as a short index: one line per note under `## Domain Knowledge`; a note link in another section is a mention that `index` never rewrites. Run the installed Pota CLI with `memory index --root <repoRoot>` to add unlisted notes and refresh changed summaries (`--dry-run` previews; it never deletes entries and writes nothing when the insertion point is inside an unclosed code fence), then `memory check --root <repoRoot>` and fix the unindexed notes, dead links, duplicates, stale summaries, or control characters it reports.
7. Use the OS locale for user-visible responses and generated or updated documentation, plans, and memory artifacts unless the user asks for another language.
