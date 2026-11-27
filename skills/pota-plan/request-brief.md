# Pota Plan: Request Brief and Steering

Reference for `pota-plan` and `pota-work`. Read when writing a Light or Heavy Path plan's `## Request Brief`, or when the user corrects, adds to, or redirects the request mid-goal. Quick Path work has no plan; see the Quick Path rule below.

## Write the Request Brief

- Fill the plan's `## Request Brief` (template: `pota://templates/work-plan.md`) before finalizing triage: `Original request` verbatim, `Interpreted outcome`, `End state`, `Scope`, `Non-scope`, `Prior records`, `Assumptions`, `Implicit requirements`, `Open questions`, and `Current request (as of S0)`.
- Label every assumption `A<n> (evidence|inferred|confirmed): <assumption and source>`.
- The labels are English in every locale. `Steering log` stays empty until the first steering.

## End state

`End state` is the last step the request asks for: a local change, a commit, a push, an open PR, a merge to a named branch, a tag or release, a deploy, or a local install. The work goes exactly that far: stopping earlier leaves the request unfinished, and going further does what was not asked.

- Take it from the request's own words ("…까지", "through merge", "ship it", "only up to the dev merge"). When the request names none, use the follow-up that `Prior records` show always happens for this kind of work and record it as an `inferred` assumption; with no such record the end state is the verified local change.
- When the end state is past the local check, end the task roadmap with a `deliver` task that depends on the last implementation task and requires `endState` evidence: `{"id":"deliver","title":"<the end state>","requiredEvidence":["endState"],"dependsOn":["<last task>"]}`. The goal cannot finish while it is open, so the session is held until the end state is reached.
- Run the full repository check as a gate of the task before `deliver`, not after the release. Record `endState` with a command that reads the outside state and fails when it is not reached (`git merge-base --is-ancestor <commit> origin/<branch>`, `gh pr view <n> --json state --jq '.state=="MERGED" or error("open")'`, a version or health check of the deployed or installed copy), then run `goal finish` with the same reading.
- A later user message that moves the end state ("배포까지", "main은 하지 마") is steering: update `End state` and add or drop the `deliver` task with `goal replan`.
- The `deliver` steps are the user's authorization only as far as the request states them; a destructive or unrequested step still needs the user.

## Prior records

Before settling the brief, consult past records:

- Run `pota plan steering --root <repoRoot>` to see steering recorded in earlier plans.
- Read the notes and at most 3 completed plans picked in `## Memory Inputs`.
- In `PLAN.md`, look at what followed similar plans (for example a release plan after each feature plan).
- A recurring follow-up or repeated steering that repository evidence shows always happens goes under `Implicit requirements`; otherwise under `Open questions`.
- Write what you consulted and found under `Prior records` (`none: <reason>` when nothing applies).
- When a goal ends, a steering that recurred twice or more, or a single `correction` that states a standing rule ("always …", "never …", "… too"), is a rule candidate: record it under `Rule candidates` in the plan's `## Evidence` and name it in the final report with the home you propose (`docs/memory`, or the project instruction file). Write `docs/memory` yourself; edit a project instruction file only when the user says so.

## Gaps in the request

- Checkable in the repository: check it without asking and record an `evidence` assumption.
- Wrong but cheap to reverse: declare an `inferred` assumption, proceed, and tell the user in one line.
- Changes the outcome and is hard to reverse: write it under `Open questions` and ask once, as one batched multiple-choice question. Record the answer as a `confirmed` assumption.

## Implicit requirements

When the change surface touches a Heavy Path signal (security, authentication, authorization, sessions, external API, DB schema, concurrency), check input validation, permission boundaries, secrets, external transmission, and destructive actions, then list them under `Implicit requirements`. Otherwise write `none: <reason>`.

Companion artifacts are implicit requirements too. From project instructions and from what earlier plans for the same surface changed, find what the repository keeps in step with a change (API documentation, changelog, PR body, session log, memory notes, the other implementations of the same rule) and list each one under `Implicit requirements`. Each listed item is done or explicitly reported as not done before the goal completes; the user should not have to ask for it a second time.

## Steering

Classify each user message that changes an active request, record it as `S<n> (correction|addition|redirect): <original text> -> <changed assumption or task>` in `Steering log`, and apply the matching command:

- `correction` replaces an assumption and keeps the tasks: `goal steer --kind correction --reason <text>`.
- `addition` adds tasks: `goal replan --steer addition --reason <text> --tasks '[...]'`.
- `redirect` invalidates the affected assumptions and tasks: `goal replan --steer redirect --reason <text> --tasks '[...]'`. If a completed task rests on a changed assumption, add a re-verification task.
- A re-plan that is not user steering (triage result, route change) uses `goal replan --steer none --reason <text>`.
- An unrelated request is a separate goal, as before.

Multi-step steering:

- The latest instruction wins. If it conflicts with an earlier instruction or the original request, tell the user "S<n> replaces X".
- From the second steering on, or for any `redirect`, rewrite `Current request (as of S<n>)` and show it to the user.

## Quick Path

There is no plan, so if any assumption exists, state the interpretation and assumptions in one or two chat lines before editing.

## Enforced by the CLI

- Completing a task that requires `triageDecision` is refused until `Original request`, `Interpreted outcome`, `End state`, `Prior records`, `Assumptions`, and `Implicit requirements` are filled; bypass: `--allow-no-request-brief <reason>`.
- `goal replan` against a plan file requires `--steer` and `--reason`.
- The n-th steering needs an `S<n> (<kind>): <text>` line in `Steering log` whose kind equals the command's kind and whose text is not a placeholder; the second steering or a `redirect` also needs a filled `Current request (as of S<n>)`. Otherwise the command is refused and nothing changes.
