# pota-doctor

Goal: diagnose Pota installation status.

Run from the published or global package:

```sh
bunx @comento/pota-harness@latest doctor
```

The doctor validates the custom marketplace installation and ownership manifest without repairing it. Diagnostics are read-only; rollback is performed only by lifecycle transaction recovery.

The first line is `Hosts: <ids>`; only the selected hosts are checked and only their host CLIs are run.

Checks:

- Source plugin manifest.
- Canonical runtime under `~/.pota/install/runtime/<version>/`.
- Codex cached installation.
- Marketplace file.
- Hook manifest link in the installed copy.
- ownership manifest presence and managed destination digests.
- `pota@pota` installed/enabled/version from the actual Codex CLI.
- effective Codex plugin/hook/multi-agent feature state (reported, never forced).
- hook trust state.
- Claude Code commands and agents mirror files, plugin files, and `pota@pota` registered/enabled state and `Claude plugin cache version`.
- Antigravity IDE/CLI skills and workflows mirror files.
- Installed runtime locators and their referenced scripts, templates, and model guidance.
