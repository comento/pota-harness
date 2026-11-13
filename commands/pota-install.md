# pota-install

Goal: install Pota into Codex, Claude Code, and Antigravity.

Run from the published or global package, not from the installed cache copy:

```sh
bunx @comento/pota-harness@latest install
bunx @comento/pota-harness@latest install --hosts claude
```

The current custom marketplace lifecycle remains in use; this is not a migration to `codex plugin add`. Do not invoke lifecycle install/upgrade from an installed copy (`~/.pota/install/` or the Codex plugin cache) because that copy is the replacement target.

Hosts: `--hosts all` or a comma list of `codex`, `claude`, `antigravity` (also `--hosts=<list>`). Without it, a first install at a terminal asks once (all hosts is the default); non-interactive runs and CI install every host. The selection is recorded in the ownership manifest and followed by upgrade, doctor, and uninstall.

Actions:

- Stage and validate the Pota installation, then transactionally commit the canonical runtime `~/.pota/install/runtime/<version>/` (`POTA_HOME` overrides `~/.pota`) and, for Codex, the marketplace source `~/.pota/install/codex/` and the versioned runtime cache `$CODEX_HOME/plugins/cache/pota/pota/<version>/`.
- Add the `hooks/hooks.json` link to the installed manifests.
- Register only Pota-owned marketplace, plugin, and hook trust sections in `~/.codex/config.toml`; do not rewrite public feature or agent settings.
- Install `pota-*` commands and agents mirror files for Claude Code.
- Generate the Claude Code plugin `pota@pota` (four skills plus hooks that call the canonical runtime) in the Pota-owned local marketplace `~/.pota/install/claude/`, then register it with `claude plugin marketplace add` and `claude plugin install pota@pota --scope user` after the files commit. Skip with a manual command when the `claude` CLI is missing, and never touch a different marketplace named `pota`.
- Install `pota-*` skills and workflows mirror files for Antigravity IDE/CLI.
- Write runtime locators so all mirrors resolve scripts, templates, and model guidance from the installed plugin root.
- Install only the surfaces of the selected hosts; the canonical runtime is always installed.
- Record every current managed destination and digest, the host selection, and the install origin in the ownership manifest `~/.pota/install/lifecycle.json`, and rollback committed phases in reverse order on failure.
- Automatic upgrades are on by default for a package install; see `pota auto-upgrade status|on|off|run`.
- Preserve and reject artifacts that are modified or not recorded in the ownership manifest.
- Refuse, changing nothing, when the installed version is newer than this CLI; `--allow-downgrade` installs this CLI's version anyway.
