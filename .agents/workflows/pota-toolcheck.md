# pota-toolcheck

Goal: detect repository stacks and check required LSP, typecheck, lint, dry-run, and verification tools.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Invoke Node directly with the absolute `entrypoints.cli` value, `toolcheck`, and an explicit `--root` argument for the target repository; do not build a shell-interpolated command from the path.

If required tools are missing, ask the user once whether to install them, listing each missing tool with its proposed command or the reason no automatic installer exists (both are in the report); continue work that does not need those tools while waiting. Install only after explicit approval, following the installed command policy. If the user declines, or the run cannot ask the user (non-interactive), do not ask and record a blocker.

Record detected stacks, missing tools, the install question and its answer, install attempts, and blockers in the related `docs/plan/<topic>.md`.
