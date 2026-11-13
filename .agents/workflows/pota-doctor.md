# pota-doctor

Goal: diagnose Pota installation status.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Invoke Node directly with the absolute `entrypoints.cli` value and `["doctor"]`; do not build a shell-interpolated command from the path.

The first output line is `Hosts: <ids>`; only the selected hosts are checked.

Checks:

- Canonical runtime under `~/.pota/install/runtime/<version>/`.
- Codex plugin, marketplace, hook trust state.
- Claude Code commands and agents mirror files, plugin registration, and `Claude plugin cache version`.
- Antigravity skills and workflows mirror files.
- Antigravity CLI skills and workflows mirror files.
- Installed runtime locators and the referenced scripts, templates, and model guidance.
