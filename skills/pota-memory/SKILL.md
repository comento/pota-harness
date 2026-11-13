---
name: pota-memory
description: Create and maintain repository MEMORY.md and docs/memory domain notes for token-efficient Codex, Claude Code, and Antigravity agent work.
---

# Pota Memory

Use this when domain knowledge, repository policy, or pre-plan context compression is needed.

## Purpose

The root `MEMORY.md` is an index, not detailed knowledge. Record details in `docs/memory/<domain>.md`.

Every delegated agent reads project-root `MEMORY.md` when present and continues when absent before doing its assigned discovery, evidence, or update task.

When subagent tools are available, each agent may recursively delegate bounded sub-tasks to subagents. Every child subagent reads project-root `MEMORY.md` when present and continues when absent, keeps the assigned scope, and preserves others' edits.

## Runtime Location

Resolve Pota's read-only runtime from `references/pota-runtime.json` next to this `SKILL.md`. Its `pluginRoot` contains Pota's `scripts/`, `templates/`, commands, agents, and model guidance. In a source checkout where the locator does not exist, resolve the plugin root from this `SKILL.md` location (`../..`). Never look for Pota runtime files in the target repository or derive the plugin root from the current working directory. If the shared runtime or locator is missing, unreadable, or inconsistent, stop every dependent mirror and recover from the published/global package with `pota doctor` followed by `pota upgrade`; do not use another mirror as a repair source.

Keep the target repository root separate. Pass it explicitly with `--root <repoRoot>` when invoking the installed runtime. Repository artifacts include `MEMORY.md`, `PLAN.md`, `docs/memory/`, and `docs/plan/`; runtime goal state lives only under the user-home Pota directory.

## Procedure

1. Run `node "<pluginRoot>/scripts/pota.mjs" init --root "<repoRoot>"` through the resolved Pota runtime. If the runtime is unavailable, ensure `MEMORY.md`, `PLAN.md`, `docs/memory`, and `docs/plan` directly and report that `pota doctor` or `pota upgrade` is required.
2. Explore the repository before asking the user.
3. Delegate when it materially improves speed or quality instead of asking the user.
   - `explorer`: read-only domain discovery, boundaries, invariants, policies, contradictions, and stale facts when available.
   - `worker`: exact file paths, commands, schemas, references, and bounded evidence capture.
   - Recursive subagent delegation is allowed only for bounded sub-tasks when the current surface supports it.
4. Write detailed facts to `docs/memory/<domain>.md` from `pota://templates/domain-memory.md`. Put a `Summary:` line under the H1: one line of at most 120 characters stating what the note answers and when to read it. The index and the session-start hook show that line, so agents can pick notes without opening them.
5. Keep only one-line entries in `MEMORY.md` under `## Domain Knowledge` (`- [<name>](docs/memory/<name>.md): <summary>`); a note link in another section is a mention that `index` never rewrites. Run `node "<pluginRoot>/scripts/pota.mjs" memory index --root "<repoRoot>"` to add unlisted notes and replace the summary after the link when `Summary:` changed (`--dry-run` previews; it removes only exact Pota placeholder lines in that section, never deletes entries or dead links, and writes nothing when the insertion point is inside an unclosed code fence), then `memory check --root "<repoRoot>"`: exit 1 lists unindexed notes, dead links, duplicates, stale summaries, and control characters to fix; warnings fail only with `--strict`.
6. When a lesson or correction recurs and is machine-checkable, encode it as a test, lint rule, script, or hook instead of more prose; memory keeps judgment rules and a pointer to the enforcing check.
7. Write user-visible responses and generated or updated documentation, plans, and memory artifacts in the OS locale unless the user asks for another language.

## Delegation Prompt Format

```text
TASK: Explore persistent domain knowledge for <domain>.
EXPECTED OUTCOME: Return facts, source paths, and proof commands concisely.
REQUIRED TOOLS: Read-only file search, LSP/symbol tools, command checks.
MUST DO: Read the project-root `MEMORY.md` before doing assigned work. Preserve proper nouns exactly. Cite local paths. Separate facts from inference. Use the OS locale for user-visible responses and generated or updated documentation, plans, and memory artifacts.
MUST NOT DO: Edit files. Ask the user. Guess missing names.
CONTEXT: Current task, repository root, existing MEMORY.md entries.
```

## Completion Criteria

- `MEMORY.md` links to detailed notes, one line each, and `memory check` exits 0.
- Each note starts with a `Summary:` line and has clear scope and sources, and is shorter than reading the original files wholesale.
- Long explanations are not duplicated in the root index.
