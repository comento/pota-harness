# pota-install

Goal: install Pota into Codex, Claude Code, and Antigravity.

Run:

```sh
bunx @comento/pota-harness@latest install
```

Add `--hosts all` or a comma list of `codex`, `claude`, `antigravity` to choose hosts; without it a first install at a terminal asks once, and non-interactive runs install every host. The canonical runtime goes to `~/.pota/install/runtime/<version>/` (`POTA_HOME` overrides `~/.pota`), and automatic upgrades are on by default (`pota auto-upgrade status|on|off|run`). If the installed version is newer than this CLI, install refuses without changes; add `--allow-downgrade` to install this version anyway.

Installation must run from the package/global source because the installed copy (`~/.pota/install/` or the Codex plugin cache) is the destination. Do not copy Pota runtime files into the target project and do not invoke install from a cached plugin locator.

After installation, check status with the `pota-doctor` workflow.
