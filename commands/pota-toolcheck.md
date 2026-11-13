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

Default toolcheck is read-only. When a required tool is missing, report the proposed change and obtain explicit user approval. Only then use `--install --yes`; unpinned or unsupported installers remain unavailable. Record detected stacks, missing tools, approvals, install attempts, timeouts, and blockers in the related `docs/plan/<topic>.md`.
