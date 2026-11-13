# pota-uninstall

Goal: remove the Codex, Claude Code, and Antigravity entries installed by Pota.

Run from the published or global package:

```sh
bunx @comento/pota-harness@latest uninstall
```

The custom marketplace ownership manifest is authoritative. Uninstall first compares every non-config managed destination with its recorded installed digest and refuses the whole uninstall, changing nothing, if any managed artifact was modified or removed. Otherwise it removes or restores the managed destinations; unmanaged targets and their parent directories are preserved. A failure rolls back the transaction.

Managed items:

- Pota marketplace, plugin, and hook trust state blocks in `~/.codex/config.toml`.
- `~/.pota/install/` (ownership manifest, canonical and retained runtimes, Codex marketplace source, Claude Code marketplace).
- `$CODEX_HOME/plugins/cache/pota` (Codex versioned runtime cache and retained copies).
- The Claude Code plugin `pota@pota` registration.
- Auto-upgrade state in `~/.pota/update/`.
- Claude Code `pota-*` commands and agents mirror files.
- Antigravity IDE/CLI `pota-*` skills and workflows mirror files.

Only the hosts recorded in the ownership manifest are touched.

After the transaction commits, Pota removes empty managed scaffold directories bottom-up and removes `~/.pota/install/` and `$CODEX_HOME/plugins/cache/pota` only when empty, after releasing its own lifecycle lock. `~/.pota/update/` loses its known state files and is removed when empty. A directory containing any unmanaged child is preserved; pruning never uses recursive deletion.

The source work folder, repository `MEMORY.md`, `PLAN.md`, `docs/`, and user-home Pota goal state (`~/.pota/projects/`) and settings (`~/.pota/config.json`) are not deleted. The globally installed `@comento/pota-harness` package, package-manager download caches, legacy backup files, and legacy shared settings not recorded by the current ownership manifest are also outside this command's scope and require a separate, explicit cleanup decision.
