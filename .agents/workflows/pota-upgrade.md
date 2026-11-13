# pota-upgrade

Goal: update the current Pota installation from the latest source.

Run:

```sh
bunx @comento/pota-harness@latest upgrade
```

Upgrade keeps the recorded hosts unless `--hosts` changes them, keeps the previous runtime for 3 days, and refreshes a stale Claude Code plugin cache. If the installed version is newer than this CLI, upgrade refuses without changes; add `--allow-downgrade` to move back to this version anyway.

Upgrade must run from the package/global source because the installed copy (`~/.pota/install/` or the Codex plugin cache) is replaced. Do not invoke upgrade from a cached plugin locator.

After upgrade, check status with the `pota-doctor` workflow.
