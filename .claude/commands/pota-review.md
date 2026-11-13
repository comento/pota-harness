# pota-review

Review completed tasks against memory, plan, policy, tool readiness, and evidence.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Resolve `resources.commands` from that JSON object and follow `pota-review.md` in that directory. Do not resolve Pota command files from the target project. If the shared runtime or locator is missing, unreadable, or inconsistent, stop all dependent mirrors and recover with published/global `pota doctor` followed by `pota upgrade`; do not repair through another mirror.
