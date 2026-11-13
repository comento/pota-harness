# pota-toolcheck

Detect repository stacks and check required LSP, typecheck, lint, dry-run, and verification tools.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Invoke Node directly with the absolute `entrypoints.cli` value, `toolcheck`, and an explicit `--root` pointing at the target repository; do not build a shell-interpolated command from the path.

If required tools are missing, report the proposed install and obtain explicit user approval. Only then add `--install --yes` for a pinned/supported installer or use the approved repository-native command.
