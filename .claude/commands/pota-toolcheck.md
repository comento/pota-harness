# pota-toolcheck

Detect repository stacks and check required LSP, typecheck, lint, dry-run, and verification tools.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Invoke Node directly with the absolute `entrypoints.cli` value, `toolcheck`, and an explicit `--root` pointing at the target repository; do not build a shell-interpolated command from the path.

If required tools are missing, ask the user once whether to install them, listing each missing tool with its proposed command or the reason no automatic installer exists (both are in the report); continue work that does not need those tools while waiting. Only after explicit approval add `--install --yes` for a pinned/supported installer or use the approved repository-native command. If the user declines, or the run cannot ask the user (non-interactive), do not ask and record a blocker.
