# pota-toolcheck

Goal: detect repository stacks and check required LSP, typecheck, lint, dry-run, and verification tools.

From a globally installed package:

```sh
bunx @comento/pota-harness@latest toolcheck --root /path/to/repository
```

From the installed plugin runtime (resolve `pluginRoot` from its locator, not the target repository):

```sh
node "<pluginRoot>/scripts/pota.mjs" toolcheck --root "/path/to/repository"
```

Default toolcheck is read-only. When a required tool is missing, the main agent asks the user once whether to install, in one message listing every missing tool with its proposed command or the reason no automatic installer exists (the report's `install:`, `suggested command`, and `install unavailable:` lines; `installCommand`, `install.suggestedCommand`, and `install.unavailableReason` in `--json`). While the question is open, continue work that does not need those tools and do not ask again in this session; a blocker recorded by an earlier session does not suppress the question in a new one. Only after explicit approval use `--install --yes` or run the approved suggested command; unpinned or unsupported installers remain unavailable to `--install`. If the user declines, or the run cannot ask the user (non-interactive or headless execution, CI, a scheduled run), do not ask and record a blocker. Record detected stacks, missing tools, approvals, install attempts, timeouts, and blockers in the related `docs/plan/<topic>.md`.
