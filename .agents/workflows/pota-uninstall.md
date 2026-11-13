# pota-uninstall

Goal: remove the Codex, Claude Code, and Antigravity entries installed by Pota.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Invoke Node directly with the absolute `entrypoints.cli` value and `["uninstall"]`; do not build a shell-interpolated command from the path.

Uninstall removes the managed entries of the recorded hosts and retained runtimes, then removes `~/.pota/install/` only when it is empty. It removes the auto-upgrade state files in `~/.pota/update/`, removes `update/stage/` only when no auto-upgrade runner holds `update/update.lock`, and removes `~/.pota/update/` only when it is empty. An installation made by Pota 0.6.0 or earlier is removed in place without migrating.

The source work folder, user-created `MEMORY.md`, `PLAN.md`, `docs/memory`, and `docs/plan` files, goal state in `~/.pota/projects/`, and `~/.pota/config.json` are not deleted.
