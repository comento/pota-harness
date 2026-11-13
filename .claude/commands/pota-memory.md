# pota-memory

Create or update `MEMORY.md` and `docs/memory/<domain>.md`.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Resolve `resources.commands` from that JSON object and follow `pota-memory.md` in that directory. Do not resolve Pota command files from the target project. If the shared runtime or locator is missing, unreadable, or inconsistent, stop all dependent mirrors and recover with published/global `pota doctor` followed by `pota upgrade`; do not repair through another mirror.
