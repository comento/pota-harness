# pota-upgrade

Goal: update the Pota installation from the current source.

Run from the published or global package, not from the installed cache copy:

```sh
bunx @comento/pota-harness@latest upgrade
bunx @comento/pota-harness@latest upgrade --hosts codex,claude
```

The current custom marketplace lifecycle remains in use. An installed copy (`~/.pota/install/` or the Codex plugin cache) is a replacement target and must not upgrade itself.

Actions:

- Replace only files tracked by the ownership manifest whose current digest still matches the installed digest.
- Recompute Pota-owned hook trust state without rewriting public feature or agent settings.
- Replace owned Claude Code and Antigravity mirror files with the latest content.
- Refresh runtime locators for every installed surface.
- Stage and validate all candidates before commit; rollback committed phases in reverse order on failure.
- Preserve and report a conflict for modified or unmanaged artifacts.
- Keep the recorded hosts unless `--hosts` (`all` or a comma list of `codex`, `claude`, `antigravity`) changes them; deselected hosts are removed, and a modified artifact of a deselected host refuses the upgrade.
- After a version change, keep the previous canonical runtime and Codex cache copy for 3 days (at most 3 of each); expired ones are removed by the next install or upgrade. A Codex cache copy at or above the new version is never kept, because Codex loads the highest cached version.
- When the Claude Code plugin cache holds a different version, run `claude plugin marketplace update pota` and `claude plugin update pota@pota --scope user`. If that fails, keep the upgraded files, print those commands, and exit 1.
- Refuse, changing nothing, when the installed version is newer than this CLI; `--allow-downgrade` moves the installation to this CLI's version anyway.
- `upgrade --auto` is reserved for the auto-upgrade runner; it keeps the recorded hosts, never downgrades (it cannot be combined with `--allow-downgrade`), and refuses to run without an existing installation.
