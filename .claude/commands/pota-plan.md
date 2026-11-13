# pota-plan

Start by reading the project-root `MEMORY.md`, write an initial `PLAN.md` and `docs/plan/<topic>.md` with a planned triage task, persist the goal before exploration, then update the same plan after Light/Heavy Path triage and tool readiness checks before implementation. Quick Path work (criteria in `pota-plan.md`) needs no plan or goal and escalates to Light Path before further edits when any criterion fails.

Read the installed Pota runtime locator at `{{POTA_RUNTIME_LOCATOR_JSON}}`. Resolve `resources.commands` from that JSON object and follow `pota-plan.md` in that directory. Resolve model guidance and templates through the same locator. Do not resolve Pota runtime resources from the target project. If the shared runtime or locator is missing, unreadable, or inconsistent, stop all dependent mirrors and recover with published/global `pota doctor` followed by `pota upgrade`; do not repair through another mirror.
