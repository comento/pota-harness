# pota-toolcheck

Goal: detect repository stacks and check required LSP, typecheck, lint, dry-run, and verification tools.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Invoke Node directly with the absolute `entrypoints.cli` value, `toolcheck`, and an explicit `--root` argument for the target repository; do not build a shell-interpolated command from the path.

If required tools are missing, follow the installed command policy before any explicitly approved installation attempt.

Record detected stacks, missing tools, install attempts, and blockers in the related `docs/plan/<topic>.md`.
