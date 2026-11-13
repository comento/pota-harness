# Pota Harness

Pota Harness ist ein token-effizientes Multi-Agent-Harness-Plugin für Codex, Claude Code und Antigravity.

[English](README.md)

Die Grundidee ist, nützliches agent-harness-Verhalten beizubehalten: hooks, persistent state, explicit planning, focused delegation und stop-time guards. Pota macht wiederholte TDD verification loops nicht zum Standard. Stattdessen teilt es Arbeit in kleine module tasks und belegt jeden task mit zwei verification gates.

1. Module acceptance verification: belegt den geänderten module contract.
2. Surface integration verification: belegt Verhalten über die echte surface, etwa CLI, HTTP, browser oder file artifacts.

Bevor ein task externen Zustand verändert, zeichnet Pota den nächstliegenden dry-run oder check mode auf und führt ihn aus. Verification ist begrenzt: Jeder task erhält standardmäßig zwei verification passes; danach zeichnet der agent einen blocker auf oder teilt den task, statt eine offene Schleife fortzusetzen.

Pota behandelt tool readiness ebenfalls als Teil der Arbeit. LSP, typecheck, lint, dry-run und verification tools werden gegen den repository stack geprüft. Installation erfolgt nur mit ausdrücklicher Zustimmung und einem gepinnten unterstützten installer; andernfalls wird ein blocker gemeldet.

## Complexity Triage

Jede implementation task durchläuft zuerst complexity triage, bevor agent, plugin oder delegated workflow guidance angewendet werden. Triage wird aus repository exploration, erwartetem Änderungsumfang und risk signals entschieden, ohne den user nach auffindbaren Fakten zu fragen.

- Light Path: schmale Änderungen innerhalb existing architecture layers. Das ist der Standard. Direkt implementieren oder einen begrenzten `worker` verwenden, danach bleibt das verification gate bestehen.
- Heavy Path: new directory/module/layer, new domain model/service/abstraction, security/session/auth, external API/message queue/payment, DB schema/migration, concurrency/transaction/cache changes, cross-domain refactor oder explicit extra-care request.

Der gewählte path und die Begründung werden in `docs/plan/<topic>.md` festgehalten, wenn ein plan artifact existiert. Auch auf Light Path bleiben die zwei verification gates bestehen.

## Tool Readiness

`pota toolcheck` untersucht das aktuelle repository auf JavaScript-, TypeScript-, Python-, PHP-, Java-, Kotlin-, Swift-, Go- und Rust-stacks und prüft die passenden LSP- und verification tools.

```sh
pota toolcheck --root .
pota toolcheck --install --yes --root .
```

- `toolcheck` meldet detected stacks und missing tools.
- `toolcheck --install` erfordert ausdrückliche Zustimmung und `--yes`; ein nicht unterstützter installer liefert das kanonische Ergebnis `installer-unavailable` und wird nicht ausgeführt.
- Pota plans erfassen detected stack, required tools, install commands und blockers.
- Ein fehlender LSP server ist kein gültiger Grund, precise codebase exploration zu überspringen, bevor installation oder ein gleichwertiger symbol-aware fallback versucht wurde.

## Dry-Run And Loop Policy

- Migrations und database changes verwenden vor write/apply commands `--pretend`, dry-run, schema diff, rollback feasibility checks oder das nächstliegende repository-native equivalent.
- Package, release, infrastructure, deployment, code generation und formatting work verwenden, wenn verfügbar, check, plan, diff, validate oder dry-run modes, bevor Zustand verändert wird.
- Wenn kein dry-run existiert, hält der plan dies fest und wählt den kleinsten reversiblen command oder test artifact.
- Wenn ein verification gate fehlschlägt, diagnostiziert Pota einmal, verkleinert oder teilt den task und führt beide gates erneut aus.
- Nach zwei fehlgeschlagenen verification passes für denselben task zeichnet Pota den blocker in `docs/plan/<topic>.md` auf, statt eine wiederholte Schleife fortzusetzen.

## Model Guidance

Pota wendet model-specific adjustment nur auf Claude-family und Codex-family models an.

- Claude-family: geeignet für long context, policy interpretation und plan/evidence review.
- Codex-family: geeignet für small implementation tasks, explicit file edits, command-based verification und bounded `worker` tasks.

Details stehen im installierten Plugin unter `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md` und `pota://docs/model-guidance/codex.md`.

## Repository Artifacts

Das harness erstellt und pflegt diese files im Ziel-repository root.

- `MEMORY.md`: kurzer Index persistent domain knowledge: eine Zeile pro Notiz unter `## Domain Knowledge` (`- [<name>](docs/memory/<name>.md): <summary>`) plus die `## Policy` des Repositorys.
- `docs/memory/*.md`: detailliertes Wissen je domain. Jede Notiz beginnt mit einer einzeiligen `Summary:` (höchstens 120 Zeichen), die Index und Hook anzeigen.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json`: user-home Active-Goal/Task/Evidence-State, getrennt nach Projekt und Worktree, für Wiederaufnahme und scoped stop gates. Der Working Tree besitzt keinen Runtime-State.
- `PLAN.md`: kurzer Index der Arbeitspläne: eine Zeile mit höchstens 200 Zeichen pro Plan unter `## Active Plans` und `## Completed Plans`. Planungsregeln stehen im Skill `pota-plan`, nicht in `PLAN.md`.
- `docs/plan/*.md`: detailed execution plans.
- `docs/plan/ARCHIVE.md`: ältere abgeschlossene Einträge, die `pota plan index --archive` aus `PLAN.md` verschoben hat, neueste zuerst, dazu der Inhalt eines legacy Abschnitts `## Planning Rules` unter `## Legacy Planning Rules`. Listenzeilen vor der ersten `## `-Überschrift gelten weiterhin als indexiert.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl`: ein Zusammenfassungsdatensatz pro abgeschlossenem oder abgebrochenem goal (die neuesten 200 je Worktree) für `goal stats --history`.

Halten Sie `## Completed Plans` neueste zuerst. `pota plan index --archive` behält die ersten 20 Einträge und verschiebt den Rest, ohne etwas zu löschen, nach `docs/plan/ARCHIVE.md`; eine älteste-zuerst geführte Liste würde daher die neuesten Pläne archivieren. Prüfen Sie vorher mit `--dry-run`. Bestehende `MEMORY.md`/`PLAN.md` funktionieren ohne Migration: `init` schreibt sie nie um, und `check` meldet das alte Format nur als warning.

Bei `SessionStart` teilt der Hook dem Agenten mit, welche Memory-Notizen existieren (Name und `Summary:`, bei langen Listen eine Zeile nur mit Namen), und ergänzt ohne aktives goal eine Zeile zum Plan-Index: Anzahl der Pläne, aktive Pläne, die zuletzt abgeschlossenen Pläne und `docs/plan/ARCHIVE.md`, falls vorhanden. Bei einem active, paused, blocked oder einer anderen Session gehörenden goal kommt nur die Memory-Liste hinzu, und die Kapsel einer fremden Session zeigt nie Plan-Namen. Ein `UserPromptSubmit` ohne goal ergänzt einen Satz mit der Anzahl der Notizen. Der Hook liest nur Indexdateien und Verzeichnislisten, nie Notizinhalte, und schreibt nichts; ein Repository ohne Notizen und Pläne erhält dieselbe Ausgabe wie bisher.

Vor `goal finish` hält `pota-work` pro goal einmal eine memory promotion Entscheidung in der Evidence des Plans fest: `Memory promotion: docs/memory/<domain>.md`, wenn das goal wiederverwendbares Repository-Wissen ergeben hat, sonst `Memory promotion: none: <reason>`. Die Entscheidung ist Pflicht, eine Notiz zu schreiben ist optional. Wenn ein goal abgeschlossen wird und seine Plan-Datei keine ausgefüllte Zeile `Memory promotion:` hat, geben `goal finish` und `goal complete` eine einzeilige Erinnerung auf stderr aus, ohne exit code oder stdout zu ändern.

Root files bleiben kurz, Details wandern unter `docs/`, damit agents nur den benötigten context lesen.

Für geringe Tokenkosten entsteht zuerst ein test contract aus Anforderungen, Invarianten, Grenzen und Fehlermodi. Der tool exit code von `goal verify -- <argv>` ist maßgeblich; Erfolge bleiben kurz, nur Fehler erweitern den Kontext. Package lifecycle scripts werden geprüft; standardmäßig läuft ein normales `npm pack --dry-run`. Content-producing oder unbekannte scripts dürfen `--ignore-scripts` nie verwenden; es ist nur bei fehlenden oder nachweislich content-neutral scripts und frischer full-check evidence erlaubt.

## Commands

Das veröffentlichte package kann mit `bunx` oder global installierten `pota` commands ausgeführt werden.

```sh
bunx @comento/pota-harness@latest install
bunx @comento/pota-harness@latest upgrade
bunx @comento/pota-harness@latest doctor
bunx @comento/pota-harness@latest uninstall
bunx @comento/pota-harness@latest toolcheck
```

Nach globaler installation sind auch kurze commands verfügbar.

```sh
bun add -g @comento/pota-harness
pota install
pota upgrade
pota doctor
pota uninstall
pota toolcheck
pota auto-upgrade status
```

- `pota install [--hosts all|codex,claude,antigravity]`: installiert transaktional custom marketplace source, versioned runtime, Pota-eigene config sections und aktuelle host mirrors. Die canonical runtime liegt unter `~/.pota/install/`; der Rest wird nur für die gewählten hosts installiert. Ohne `--hosts` fragt die erste Installation in einem Terminal nach den hosts; nicht interaktive Läufe und CI installieren alle hosts.
- `pota upgrade [--hosts all|codex,claude,antigravity]`: ersetzt nur unveränderte Einträge des ownership manifest nach staged validation und nutzt rollback bei Fehlern. Behält die aufgezeichneten hosts, sofern `--hosts` sie nicht ändert, und aktualisiert einen Claude Code plugin cache, der noch eine andere Version enthält. Ist die installierte Version neuer als diese CLI, verweigern `install` und `upgrade` ohne Änderung; `--allow-downgrade` installiert trotzdem die Version dieser CLI.
- `pota doctor`: prüft ownership digests, effektive Codex features, den tatsächlichen plugin status und runtime locators ohne Reparatur. Gibt zuerst `Hosts: <ids>` aus und prüft nur die gewählten hosts (einschließlich `Claude plugin cache version`).
- `pota uninstall`: prüft zuerst jeden Nicht-config-Eintrag des ownership manifest gegen seinen installed digest und verweigert das ganze uninstall ohne Änderung, wenn ein managed artifact verändert oder entfernt wurde. Andernfalls entfernt es die verwalteten Einträge und retained runtimes bzw. stellt sie wieder her, räumt leere managed scaffolds auf, bewahrt unmanaged Ziele und ihre übergeordneten Verzeichnisse und nutzt rollback bei Fehlern vor dem commit. Entfernt auch `~/.pota/update/` und behält `~/.pota/config.json` und `~/.pota/projects/`. Eine Installation im legacy layout wird ohne Migration an Ort und Stelle entfernt.
- `pota auto-upgrade status|on|off|run`: `status` gibt Einstellung, installierte Version, letzte Prüfung und ausstehende Meldung als JSON aus; `on`/`off` schreiben `autoUpgrade` in `~/.pota/config.json` und geben denselben Bericht aus; `run` prüft npm sofort, ohne 24-Stunden-Intervall und backoff abzuwarten. Exit 0 bedeutet Erfolg, 1 einen Ausführungsfehler oder fehlgeschlagenen Lauf, 2 einen Verwendungsfehler.
- `pota toolcheck`: erkennt repository stacks und prüft required tools; Installation läuft nur für einen genehmigten unterstützten installer, sonst gilt `installer-unavailable`.
- `pota cleanup --root <repo>`: meldet standardmäßig read-only legacy projektlokale `.pota`-Reste. `--yes` migriert/gleicht gültigen active state mit dem user-home store ab, entfernt nur bekannte state/lock/tool-Reste, bewahrt unbekannte Dateien und entfernt das Verzeichnis nur, wenn es leer ist.
- `pota memory check|index [--root <repo>]`: `check` gleicht `MEMORY.md` mit `docs/memory/*.md` ab und gibt einen JSON-Bericht aus; bei nicht indexierten Notizen, dead links, Duplikaten, veralteten Zusammenfassungen, Steuerzeichen in Zusammenfassungen oder unsicheren Pfaden endet es mit exit 1, warnings schlagen nur mit `--strict` fehl. Einträge sind Listenzeilen unter `## Domain Knowledge` (in einer älteren Datei ohne diesen Abschnitt alle Listenzeilen); ein Notizlink in einem anderen Abschnitt ist eine Erwähnung, die `index` nie umschreibt. `index` ergänzt fehlende Notizen und ersetzt bei geändertem `Summary:` nur die Zusammenfassung nach dem Link (eine Zeile mit mehreren Links bleibt unverändert); es entfernt nur exakt passende Pota-Platzhalterzeilen in diesem Abschnitt, löscht nie Einträge oder dead links und erhält den Rest Byte für Byte. `--dry-run` zeigt eine Vorschau. Liegt die Einfügestelle in einem nicht geschlossenen Codeblock, schreibt `index` nichts und endet mit exit 1 und `unclosed-fence`. Usage-Fehler enden mit exit 2; `pota memory` ohne Unterbefehl gibt weiterhin den Hinweis aus.
- `pota plan check|index [--archive] [--root <repo>]`: dasselbe für `PLAN.md` und `docs/plan/*.md`, deren Einträge Listenzeilen unter `## `-Überschriften sind, die auf `Plans` enden (etwa `## Superseded Plans`). `index` setzt einen Plan, dessen Checkboxen alle abgehakt sind, an den Anfang von `## Completed Plans` und jeden anderen unter `## Active Plans`; nur `--archive` verschiebt Zeilen nach `docs/plan/ARCHIVE.md`: abgeschlossene Einträge jenseits der neuesten 20 samt eingerückten Absätzen und den Inhalt eines legacy Abschnitts `## Planning Rules`. `check` warnt, wenn `## Completed Plans` mehr als 20 Einträge hat oder ein legacy Abschnitt `## Planning Rules` übrig ist.
- `pota goal ...`: verwaltet das Repository-goal (`pota goal --help`). `goal stats --history [--limit N]` fasst die beendeten goals des Repositorys über alle Worktrees zusammen: Anzahl completed/cancelled, Median und p90 der Dauer, Mediane von tasks und receipts, Rerun-Rate, memory promotion Entscheidungen, einen older/newer `trend` ab 4 abgeschlossenen goals und die letzten goals; ohne Historie gibt es `{"schemaVersion":1,"scope":"repository","goals":0}` aus. `completionCriteria` (`goal start --criteria`) ist `advisory`: Pota zeichnet es auf, erzwingt es aber nicht, und der Abschluss hängt nur von der erforderlichen Evidence ab.
- `pota-memory`: erkundet domain knowledge und aktualisiert `MEMORY.md`.
- `pota-plan`: erstellt einen decision-complete plan unter `docs/plan/`.
- `pota-work`: führt den nächsten module task im aktuellen `PLAN.md` mit zwei verification gates aus.
- `pota-review`: prüft completed tasks gegen plan, memory und evidence.

Der custom marketplace lifecycle hält source und versioned runtime getrennt. Staged validation geht jedem commit voraus, das ownership manifest bindet alle managed digests, und ein Fehler führt zu reverse-order rollback. Modified oder unmanaged artifacts werden preserved und als conflict gemeldet. Pota ändert nur eigene TOML sections und erzwingt keine öffentlichen feature/agent settings.

Clean uninstall entfernt `~/.pota/install/` und den Codex cache root `$CODEX_HOME/plugins/cache/pota` nur, wenn alle managed scaffold directories leer sind; unmanaged Inhalte bleiben erhalten. Source repository, repository `MEMORY.md`/`PLAN.md` und user-home Pota goal state, das globale `@comento/pota-harness` package, package-manager caches sowie legacy backups/settings außerhalb des aktuellen ownership manifest werden nicht automatisch gelöscht.

Codex verwendet `skills/` und `commands/`. Claude Code verwendet gespiegelte commands und agent definitions unter `.claude/`. Antigravity verwendet `.agents/workflows` und globale skills mirrors.

## Install Layout And Auto-Upgrade

Pota legt seine Installation unter `POTA_HOME` (Standard `~/.pota`) ab. Die Pfade der einzelnen hosts setzen weiterhin getrennt `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME` und `CODEX_CONFIG_PATH`.

```text
~/.pota/
  install/                  vom lifecycle verwaltete Dateien
    lifecycle.json          ownership manifest (schema 2: hosts, origin, retained runtimes)
    lifecycle.lock, transaction.json, transactions/
    runtime/<version>/      canonical runtime für alle runtime locators und die Claude Code hooks
    codex/                  Codex local marketplace source
    claude/                 Claude Code local marketplace
  projects/                 goal state
  config.json               Benutzereinstellungen ("autoUpgrade")
  update/                   auto-upgrade-Zustand
$CODEX_HOME/plugins/cache/pota/pota/<version>/   Kopie im Codex plugin cache (nur wenn Codex gewählt ist)
```

- Hosts: Nur `install` und `upgrade` akzeptieren `--hosts`, mit `all` oder einer Kommaliste aus `codex`, `claude` und `antigravity`. Die Auswahl steht im ownership manifest, und `upgrade`, `doctor` und `uninstall` folgen ihr. Geändert wird sie mit `pota upgrade --hosts <list>`; eine veränderte verwaltete Datei eines abgewählten hosts führt zur Ablehnung. Der interaktive prompt (alle als Standard, nur Claude Code, nur Codex, nur Antigravity oder eine Liste) erscheint nur, wenn noch nichts installiert ist.
- Aufbewahrung: Ein upgrade mit Versionswechsel behält die vorherige canonical runtime und die Kopie im Codex cache 3 Tage lang (höchstens 3 je Art), damit vorher gestartete sessions weiterlaufen. Das nächste install oder upgrade entfernt abgelaufene, uninstall entfernt alle. Eine Codex-cache-Kopie gleich oder über der neuen Version wird nie behalten, weil Codex die höchste Version im cache lädt.
- Claude Code plugin cache: Enthält er noch eine andere Version, aktualisiert `pota upgrade` ihn mit `claude plugin marketplace update pota` und `claude plugin update pota@pota --scope user`. Schlägt das fehl, bleibt die aktualisierte Installation bestehen, die Befehle zum manuellen Abschluss werden ausgegeben und der Exit-Code ist 1.
- Auto-upgrade: standardmäßig an. Höchstens einmal alle 24 Stunden (und nicht in den 24 Stunden nach einem install oder upgrade) startet `SessionStart` einen abgetrennten Prozess, der die neueste `@comento/pota-harness`-Version von npm liest, genau diese Version mit `--ignore-scripts` nach `~/.pota/update/stage/` installiert, sie prüft und ihr `pota-lifecycle.mjs upgrade --auto` ausführt. Jede neuere Version wird angewendet, auch major, und es gibt nie ein downgrade. Der nächste `SessionStart` meldet das Ergebnis (`updated`, `failed` oder `manual`) einmal in einer Zeile. Für Installationen aus einem git checkout (`origin: "checkout"`) und Läufe aus einem source checkout läuft es nicht.
- Abschalten: `pota auto-upgrade off`, `POTA_AUTO_UPGRADE=0` (auch `false`, `off` oder `no`) oder `"autoUpgrade": false` in `~/.pota/config.json`. Eine unlesbare `config.json` schaltet es ebenfalls ab. Zustand und Log des letzten Laufs liegen in `~/.pota/update/`.

## Antigravity Compatibility

Antigravity unterstützt `SKILL.md`-basierte Agent Skills und Workflows, die als `/workflow-name` aufgerufen werden. Pota installiert für diese Oberfläche die folgenden paths.

- Antigravity IDE: `~/.gemini/config/skills/pota-*/SKILL.md`.
- Antigravity CLI: flache Skill-Dateien unter `~/.gemini/antigravity-cli/skills/pota-*.md`.

Codex-only hooks werden nicht nach Antigravity portiert. Stattdessen laufen dieselben planning-, memory-, complexity triage- und two-gate verification procedures über Skills und Workflows. Setze `ANTIGRAVITY_HOME` oder `ANTIGRAVITY_CLI_HOME`, um paths zu überschreiben.

## Locale Policy

Potas reusable instructions sind für global use auf Englisch geschrieben. User-visible output sowie erstellte oder aktualisierte documentation, plans und memory artifacts folgen der konfigurierten OS locale, sofern der user nicht ausdrücklich eine andere Sprache verlangt. Das umfasst Inhalte in `MEMORY.md`, `PLAN.md`, `docs/memory` und `docs/plan`. Die CLI lokalisiert common messages für `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de` und `pt` und fällt bei unsupported locales auf English zurück. Codex hook `statusMessage` text bleibt static English, während hook command output English oder Korean ist.

## Delegation

- `explorer`: erledigt read-only codebase discovery, impact analysis, pattern searches und read-only verification, wenn verfügbar.
- `worker`: erledigt bounded implementation oder verification tasks mit klarem file ownership.
- Main session: hält urgent blocking work lokal, wenn der nächste Schritt sofort vom Ergebnis abhängt.

Jeder delegation prompt verwendet sechs sections: TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
