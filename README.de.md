# Pota Harness

Pota Harness ist ein token-effizientes Multi-Agent-Harness-Plugin für Claude Code, Codex / ChatGPT Desktop und die Antigravity-CLI.

[English](README.md)

Die Grundidee ist, nützliches agent-harness-Verhalten beizubehalten: hooks, persistent state, explicit planning, focused delegation und stop-time guards. Pota macht wiederholte TDD verification loops nicht zum Standard. Stattdessen teilt es Arbeit in kleine module tasks und belegt jeden task mit zwei verification gates.

1. Module acceptance verification: belegt den geänderten module contract.
2. Surface integration verification: belegt Verhalten über die echte surface, etwa CLI, HTTP, browser oder file artifacts.

Bevor ein task externen Zustand verändert, zeichnet Pota den nächstliegenden dry-run oder check mode auf und führt ihn aus. Verification ist begrenzt: Jeder task erhält standardmäßig zwei verification passes; danach zeichnet der agent einen blocker auf oder teilt den task, statt eine offene Schleife fortzusetzen.

Pota behandelt tool readiness ebenfalls als Teil der Arbeit. LSP, typecheck, lint, dry-run und verification tools werden gegen den repository stack geprüft. Installation erfolgt nur mit ausdrücklicher Zustimmung und einem gepinnten unterstützten installer; andernfalls wird ein blocker gemeldet.

## Install

Pota ist ein Plugin für Claude Code, Codex (einschließlich ChatGPT Desktop) und die Antigravity-CLI. Die Wurzel dieses Repositorys ist das Plugin, und der Branch `main` ist die veröffentlichte Version. Jeder Host installiert, aktualisiert und entfernt seine eigene Kopie mit seinen eigenen Plugin-Befehlen, und diese Kopie ist die Runtime des Hosts: Hooks, Skills und CLI laufen aus ihr. Kopien auf verschiedenen Hosts dürfen unterschiedliche Versionen haben; Pota vergleicht sie nicht. Der goal state in `~/.pota/projects/` wird von allen Hosts geteilt.

### Claude Code

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
```

In einer Sitzung sind dieselben Schritte `/plugin marketplace add comento/pota-harness` und `/plugin install pota@pota-harness`. Claude Code aktualisiert Marketplaces von Drittanbietern standardmäßig nicht automatisch; aktualisieren Sie daher von Hand und starten Sie die Sitzung neu:

```sh
claude plugin marketplace update pota-harness
claude plugin update pota@pota-harness
```

Deinstallieren:

```sh
claude plugin uninstall pota@pota-harness
claude plugin marketplace remove pota-harness
```

### Codex

```sh
codex plugin marketplace add comento/pota-harness
```

Danach in der Codex-TUI:

1. `/plugins` öffnen, den Marketplace `pota-harness` wählen, `pota` installieren und eine neue Sitzung starten.
2. `/hooks` öffnen und die fünf Hooks von Pota freigeben. Codex führt Plugin-Hooks erst nach der Freigabe aus, und die Freigabe ist an den Hook-Inhalt gebunden; nach jedem Update müssen Sie die Hooks daher in `/hooks` erneut freigeben. Ohne Freigabe erhält keine Sitzung die Zeile `Pota CLI:`, und die Pota-Skills melden, dass die Hooks von Pota inaktiv sind.

Das Plugin registriert außerdem den lokalen MCP-Server `pota-dag` (`.codex-plugin/mcp.json`), der das [DAG-Panel](#dag-panel) in Codex und ChatGPT Desktop anzeigt.

Zum Aktualisieren `codex plugin marketplace upgrade pota-harness` ausführen und die Hooks in `/hooks` erneut freigeben. Zum Deinstallieren das Plugin in `/plugins` öffnen und "Uninstall plugin" wählen. Diese Codex-Schritte folgen der Codex-Dokumentation und dem Quellcode; sie wurden noch nicht an einer echten Codex-Installation ausgeführt.

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

Zum Aktualisieren denselben Befehl erneut ausführen; laut Antigravity-Dokumentation ersetzt eine Neuinstallation die installierte Kopie. Deinstallieren mit `agy plugin uninstall pota`. Empfohlen ist `agy` 1.5.6 oder neuer. Unterstützt wird nur die Antigravity-CLI, nicht die Antigravity-IDE. Das Plugin registriert außerdem den lokalen MCP-Server `pota-dag` (`mcp_config.json` im Wurzelverzeichnis), der das [DAG-Panel](#dag-panel) anzeigt.

### What each host gets

| | Claude Code | Codex / ChatGPT Desktop | Antigravity CLI |
| --- | --- | --- | --- |
| Skills | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory`, `$dag` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory`, `/dag` |
| Hooks | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | dieselben fünf, nach Freigabe in `/hooks` | SessionStart, PreInvocation (Prompt-Kontext), PostToolUse, Stop; kein SubagentStop |
| Agents `explorer`, `worker` | ja (Plugin-Agents `pota:explorer`, `pota:worker`) | Rollendateien (`skills/pota-work/roles/`), die der orchestrator an den Anfang des Dispatch-Prompts setzt, weil ein Codex-Plugin keine Agents registrieren kann | ja (`agents/` im Plugin) |
| DAG-Panel | mod-Pane, geöffnet mit dem mod-Befehl `/dag` | MCP App (`pota-dag`-Server), geöffnet mit `$dag` | MCP App (`pota-dag`-Server), geöffnet mit `/dag` |

Die Agent-Namen von `invoke_subagent` in Antigravity und der Rollendatei-Ansatz von Codex wurden noch nicht in einer echten Sitzung ausgeführt; geprüft wurde nur, dass `agy plugin validate` die beiden Agents verarbeitet.

### Coming from the npm install (1.x)

Pota 2.x wird nicht auf npm veröffentlicht und hat keinen globalen Befehl `pota`. Das npm-Paket `@comento/pota-harness` endet mit 1.5.0, das nur diese Installationsanleitung anzeigt, und das Paket ist als deprecated markiert.

1. Nur Claude Code: zuerst das 1.x-Plugin mit `claude plugin uninstall pota@pota --scope user` entfernen.
2. **Das Plugin auf jedem Host installieren, den Sie nutzen.** Das Entfernen unten geschieht pro Host, und ein Host, der auf der 1.x-Installation bleibt, kann nicht mehr aktualisieren, sobald der Teil eines anderen Hosts entfernt ist: seine Upgrades, auch die automatischen, werden mit "Managed artifact was modified" abgelehnt.
3. Eine Sitzung starten. Findet der Sitzungsstart des Plugins das 1.x-ownership manifest (`~/.pota/install/lifecycle.json`), entfernt er den Teil dieses Hosts an der 1.x-Installation in einem Hintergrundprozess und meldet das; starten Sie die Sitzung einmal neu. Die nächste Sitzung meldet das Ergebnis einmal. Die gemeinsame 1.x-Runtime, `~/.pota/update/` und das Manifest werden erst entfernt, wenn von keinem Host mehr ein Teil übrig ist.

Entfernt werden nur Dateien und Verzeichnisse, die das 1.x-Manifest verzeichnet und deren Digest unverändert ist, sowie die eigenen Pota-Abschnitte der Codex-`config.toml`. Erhalten bleiben `~/.pota/projects/` (goal state), `~/.pota/config.json`, `~/.pota/tools/comment-checker/`, jede von Ihnen geänderte Datei (als behalten gemeldet), alles, was das Manifest nicht verzeichnet, und das globale npm-Paket (entfernen mit `npm uninstall -g @comento/pota-harness`). In diesen Fällen wird für den Host nichts entfernt, und der Grund wird gemeldet:

- ein Verzeichnis auf einem der Host-Pfade ist ein Symlink (`symlinked-path`; die gemeldeten Pfade von Hand entfernen);
- die Host-Registrierung lässt sich nicht sicher entfernen (`host-unregister-failed`): die `claude`-CLI fehlt oder schlägt fehl, oder die Codex-`config.toml` enthält Pota-Abschnitte, die sich nicht sicher erkennen lassen, oder das Umschreiben würde andere Abschnitte ändern;
- das Manifest ist ungültig, hat ein nicht unterstütztes Schema, zeigt außerhalb der erwarteten Pfade, oder eine 1.x-Installationstransaktion wurde unterbrochen (`manifest-invalid`, `manifest-unsupported-schema`, `target-outside-allowlist`, `transaction-pending`). Wurde 1.x mit `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME` oder `CODEX_CONFIG_PATH` installiert, setzen Sie dieselben Werte für den Host. Andernfalls, solange noch von keinem Host der Teil entfernt wurde, `npx @comento/pota-harness@1.5.0 uninstall` ausführen und neu starten.

Sobald der Teil eines Hosts entfernt ist, verweigert das 1.x-Uninstall ("Refusing to uninstall modified managed artifacts"), weil das Manifest nie neu geschrieben wird. Die Ablehnungsmeldung fordert Sie dann auf, die manuellen Punkte aus `doctor` zu erledigen und für diesen Host `node "<pluginRoot>/scripts/pota.mjs" migrate run --host <host>` auszuführen.

Ein abgelehntes Entfernen wird nach 24 Stunden erneut versucht und höchstens alle 7 Tage gemeldet. Eine Installation vor 1.3 hat kein ownership manifest und wird nie angefasst; entfernen Sie sie mit `npx @comento/pota-harness@1.5.0 uninstall`, bevor Sie das Plugin installieren. Zustand ansehen oder das Entfernen selbst ausführen (`<pluginRoot>` wird unten erklärt):

```sh
node "<pluginRoot>/scripts/pota.mjs" doctor
node "<pluginRoot>/scripts/pota.mjs" migrate status
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude --dry-run
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude
```

`POTA_LEGACY_MIGRATION=0` (auch `false`, `off` oder `no`) schaltet das automatische Entfernen ab. 1.x-Namen entsprechen in 2.x:

| 1.x | 2.x |
| --- | --- |
| `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` | die Skill-Namen des Hosts in der Tabelle oben |
| `/pota-toolcheck` | den Agenten bitten, `pota toolcheck` auszuführen |
| `/pota-doctor` | `pota doctor` |
| die CLI-Befehle `install`, `upgrade` und `uninstall` und automatische Upgrades | die Plugin-Befehle des Hosts oben; die CLI gibt jetzt einen Verweis auf diesen Abschnitt aus und endet mit exit 2 |

### Running the Pota CLI

Jeder Sitzungsstart gibt eine Zeile `Pota CLI:` mit dem absoluten Pfad von `scripts/pota.mjs` in der Plugin-Kopie dieses Hosts aus, und der Agent führt Pota-Befehle mit diesem Pfad aus. `<pluginRoot>` ist das übergeordnete Verzeichnis dieses `scripts`-Verzeichnisses; der Pfad ändert sich, wenn der Host eine neue Version installiert. In diesem README steht `pota <command>` für `node "<pluginRoot>/scripts/pota.mjs" <command>`.

## Complexity Triage

Jede implementation task durchläuft zuerst complexity triage, bevor agent, plugin oder delegated workflow guidance angewendet werden. Triage wird aus repository exploration, erwartetem Änderungsumfang und risk signals entschieden, ohne den user nach auffindbaren Fakten zu fragen.

- Light Path: schmale Änderungen innerhalb existing architecture layers. Das ist der Standard. Direkt implementieren oder einen begrenzten `worker` verwenden, danach bleibt das verification gate bestehen.
- Heavy Path: new directory/module/layer, new domain model/service/abstraction, security/session/auth, external API/message queue/payment, DB schema/migration, concurrency/transaction/cache changes, cross-domain refactor oder explicit extra-care request.

Der gewählte path und die Begründung werden in `docs/plan/<topic>.md` festgehalten, wenn ein plan artifact existiert. Auch auf Light Path bleiben die zwei verification gates bestehen.

Pota wählt das model jedes task nach dessen Art, in vier tiers mit je einem Wert pro Host, und steuert den reasoning effort; `Model routing: inherited` in `MEMORY.md` oder im Plan schaltet die model-Auswahl pro task ab.

| Tier | Verwendet für | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- | --- |
| fast | read-only exploration und Zusammenfassungen | `haiku` | `gpt-6-luna` | `flash_lite` |
| balanced | Light implementation und routinemäßige verification | `sonnet` | `gpt-6.1-terra` | `flash` |
| stronger | Planung, Triage, Heavy implementation, Review, abschließende verification | `opus` | `gpt-6-sol` | `pro` |
| strongest | nur Heavy design | `fable` | `gpt-6-astra` | `pro` |

Auf Antigravity nimmt das Standard-Delegationswerkzeug `invoke_subagent` nur den tier-Wert entgegen und hat keine effort-Option, daher wird der effort als `inherited` aufgezeichnet; wo das Tool `swarm` existiert, kann es optional ein konkretes model mit effort-Suffix beauftragen. Pota ordnet außerdem die echten model-IDs der Antigravity-Sitzung und von `swarm` (die Familien Gemini, GPT-OSS und Claude) für seine gates denselben vier tiers zu. Ein Heavy task, der ohne angewendeten effort zugewiesen wurde (`inherited`, `not-applied` oder keiner), kann mit `goal task --status completed` oder `goal finish` nur abgeschlossen werden, wenn `--allow-inherited-effort <reason>` übergeben wird.

Wenn ein delegierter subagent fertig ist, liefert er einen Abschlussbericht, bevor er endet. Nachdem der orchestrator diesen Abschlussbericht und die Evidence erfasst hat, wird der fertige subagent geschlossen oder freigegeben, wenn der Host dafür eine nicht destruktive Aktion hat; andernfalls bleibt er im Leerlauf, statt beendet zu werden (`manage_subagents(kill)` von Antigravity würde ihn als `Cancelled` anzeigen). Der orchestrator prüft danach Abschlussbericht und Evidence, bevor er die Arbeit als abgeschlossen markiert.

## Tool Readiness

`pota toolcheck` untersucht das aktuelle repository auf JavaScript-, TypeScript-, Python-, PHP-, Java-, Kotlin-, Swift-, Go- und Rust-stacks und prüft die passenden LSP- und verification tools.

```sh
pota toolcheck --root .
pota toolcheck --install --yes --root .
```

- `toolcheck` meldet detected stacks und missing tools. Für jedes missing tool gibt es einen vorgeschlagenen Installationsbefehl oder den Grund aus, warum keine automatische Installation möglich ist, und der agent fragt einmal, ob installiert werden soll; bei Ablehnung oder nicht interaktiver Ausführung wird ein blocker festgehalten.
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
- `docs/memory/*.md`: detailliertes Wissen je domain. Jede Notiz beginnt mit einer einzeiligen `Summary:` (höchstens 120 Zeichen), die Index und Hook anzeigen. Eine Notiz kann nach `Summary:` eine optionale `Paths:`-Zeile ergänzen.
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

Unten steht `pota <command>` für `node "<pluginRoot>/scripts/pota.mjs" <command>` mit dem Pfad aus der Zeile `Pota CLI:` des Sitzungsstarts (siehe [Running the Pota CLI](#running-the-pota-cli)).

- `pota doctor [--json]`: schreibgeschützte Diagnose dieser Plugin-Kopie und von `~/.pota`: Version, `pluginRoot`, Node.js (18 oder neuer), ob `POTA_HOME` beschreibbar ist, ob die vier Versionsflächen dieser Kopie übereinstimmen, Pflichtdateien, die 1.x-Installation (`none`, `present <version>` oder `blocked <reason>`), der letzte Entfernungsbericht pro Host mit behaltenen Pfaden und manuellen Befehlen sowie der comment-checker-Zustand. Kopien anderer Hosts werden nie verglichen. Exit 1, wenn eine Prüfung fehlschlägt, 2 bei einem Bedienungsfehler.
- `pota migrate status|run [--host claude|codex|antigravity] [--all] [--dry-run] [--json]`: führt das Entfernen der 1.x-Installation von Hand aus. `status` zeigt, was ein Lauf tun würde, und die letzten Berichte; `run` braucht `--host <host>` oder `--all` (alle Hosts, auch solche ohne Plugin), und `--dry-run` zeigt den Plan, ohne etwas zu ändern. Exit 1, wenn das Entfernen abgelehnt wird, 2 bei einem Bedienungsfehler.
- `pota toolcheck`: erkennt repository stacks und prüft required tools; Installation läuft nur für einen genehmigten unterstützten installer, sonst gilt `installer-unavailable`.
- `pota cleanup --root <repo>`: meldet standardmäßig read-only legacy projektlokale `.pota`-Reste. `--yes` migriert/gleicht gültigen active state mit dem user-home store ab, entfernt nur bekannte state/lock/tool-Reste, bewahrt unbekannte Dateien und entfernt das Verzeichnis nur, wenn es leer ist.
- `pota memory check|index [--root <repo>]`: `check` gleicht `MEMORY.md` mit `docs/memory/*.md` ab und gibt einen JSON-Bericht aus; bei nicht indexierten Notizen, dead links, Duplikaten, veralteten Zusammenfassungen, Steuerzeichen in Zusammenfassungen oder unsicheren Pfaden endet es mit exit 1, warnings schlagen nur mit `--strict` fehl. Einträge sind Listenzeilen unter `## Domain Knowledge` (in einer älteren Datei ohne diesen Abschnitt alle Listenzeilen); ein Notizlink in einem anderen Abschnitt ist eine Erwähnung, die `index` nie umschreibt. `index` ergänzt fehlende Notizen und ersetzt bei geändertem `Summary:` nur die Zusammenfassung nach dem Link (eine Zeile mit mehreren Links bleibt unverändert); es entfernt nur exakt passende Pota-Platzhalterzeilen in diesem Abschnitt, löscht nie Einträge oder dead links und erhält den Rest Byte für Byte. `--dry-run` zeigt eine Vorschau. Liegt die Einfügestelle in einem nicht geschlossenen Codeblock, schreibt `index` nichts und endet mit exit 1 und `unclosed-fence`. Usage-Fehler enden mit exit 2; `pota memory` ohne Unterbefehl gibt weiterhin den Hinweis aus.
- `pota plan check|index [--archive] [--root <repo>]`: dasselbe für `PLAN.md` und `docs/plan/*.md`, deren Einträge Listenzeilen unter `## `-Überschriften sind, die auf `Plans` enden (etwa `## Superseded Plans`). `index` setzt einen Plan, dessen Checkboxen alle abgehakt sind, an den Anfang von `## Completed Plans` und jeden anderen unter `## Active Plans`; nur `--archive` verschiebt Zeilen nach `docs/plan/ARCHIVE.md`: abgeschlossene Einträge jenseits der neuesten 20 samt eingerückten Absätzen und den Inhalt eines legacy Abschnitts `## Planning Rules`. `check` warnt, wenn `## Completed Plans` mehr als 20 Einträge hat oder ein legacy Abschnitt `## Planning Rules` übrig ist.
- `pota goal ...`: verwaltet das Repository-goal (`pota goal --help`). `goal stats --history [--limit N]` fasst die beendeten goals des Repositorys über alle Worktrees zusammen: Anzahl completed/cancelled, Median und p90 der Dauer, Mediane von tasks und receipts, Rerun-Rate, memory promotion Entscheidungen, einen older/newer `trend` ab 4 abgeschlossenen goals und die letzten goals; ohne Historie gibt es `{"schemaVersion":1,"scope":"repository","goals":0}` aus. `completionCriteria` (`goal start --criteria`) ist `advisory`: Pota zeichnet es auf, erzwingt es aber nicht, und der Abschluss hängt nur von der erforderlichen Evidence ab. `goal gate --task <id> --on|--off [--reason <text>]` setzt oder löst ein manuelles approval gate auf einem task, der weder active noch completed ist. Ein gated task wird nie automatisch gestartet oder als fortzusetzende Arbeit angezeigt: `goal ready` führt ihn unter `gated` (ein Schlüssel, der nur erscheint, wenn ein gate existiert) statt unter `ready`, und wenn nur noch gated tasks übrig sind, sagt der Hook-Kontext, dass das goal auf die Freigabe des Nutzers wartet. Nur der Nutzer löst ein gate: mit `goal gate --off`, mit `goal task --task <id> --status active --approve-gate` oder über das DAG-Panel. Gates liegen im gemeinsamen goal state und werden daher nur durchgesetzt, wenn jeder Host, der am Repository arbeitet, 2.3.0 oder neuer ausführt. `goal retry --task <id>` setzt einen `blocked` task auf `pending` zurück und löscht seinen blocker, seinen dispatch-Eintrag (agent, effort, model, effective model, host) und seine receipts (zum Abschließen müssen beide Verifikationen neu erfasst werden), damit der orchestrator ihn an einen neuen worker dispatcht; route, kind, approval gate, erforderliche evidence, receipts anderer tasks und abgeschlossene tasks bleiben unverändert. Ein durch den blocker dieses task blockiertes goal wird wieder `active`, und wenn kein task aktiv ist, wird der erste bereite task aktiviert (tasks mit gate warten weiter); kann nichts laufen, wird das goal erneut mit dem Grund eines verbliebenen blocked task blockiert. Ein per `goal block` von Hand blockiertes goal wird durch retry nicht gelöst (`goal resume` nötig); ein `paused` goal bleibt pausiert. Jeder andere task-Status wird abgelehnt.
- `pota-memory`: erkundet domain knowledge und aktualisiert `MEMORY.md`.
- `pota-plan`: erstellt einen decision-complete plan unter `docs/plan/`.
- `pota-work`: führt den nächsten module task im aktuellen `PLAN.md` mit zwei verification gates aus.
- `pota-review`: prüft completed tasks gegen plan, memory und evidence.
- `dag`: öffnet nur das [DAG-Panel](#dag-panel); es plant nie, bearbeitet nichts und ändert den goal state nicht.

Pota schreibt nur unter `POTA_HOME` (Standard `~/.pota`) und nie in seine Plugin-Kopie. Codex bindet die Hook-Freigabe an den Plugin-Inhalt; eine Kopie, die sich selbst änderte, verlöre ihre Freigabe. Die Plugin-Dateien eines Hosts werden nur von dessen eigenen Plugin-Befehlen installiert, aktualisiert und entfernt.

## Pota Home And Settings

Pota legt seine Daten unter `POTA_HOME` (Standard `~/.pota`) ab; die Plugin-Kopien aller Hosts teilen sie.

```text
~/.pota/
  projects/                 goal state
  config.json               user settings ("commentChecker", "modelCeiling")
  tools/comment-checker/    comment-checker-Binary (fixierter Release)
  migration/                Berichte und Zustand des Entfernens der 1.x-Installation
  hosts/antigravity/        Antigravity-Sitzungsdateien (Hook-Meldungen, die auf den nächsten Prompt warten)
  hosts/antigravity-dag/    workspaces.json: zuletzt aktive Workspaces für die DAG MCP App (Antigravity und Codex)
  install/, update/         Reste der npm-Installation 1.x, bis ihr Entfernen abgeschlossen ist
```

- 1.x-Einstellungen: `"autoUpgrade"` in `config.json` wird ignoriert; Pota aktualisiert sich nicht mehr selbst.
- Kommentarprüfung: Nach einer erfolgreichen Bearbeitung (Claude Code `Write`/`Edit`/`MultiEdit`, Codex `apply_patch` und Bearbeitungswerkzeuge) führt der PostToolUse-Hook [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker) (MIT) auf dem geänderten Text aus und gibt bei überflüssigen Kommentaren `decision: "block"` zurück, damit der Agent sie entfernt oder begründet. Es kommt keine npm-Abhängigkeit hinzu: Der Sitzungsstart eines Host-Hooks lädt in einem getrennten Prozess den fixierten Release v0.8.2 für die aktuelle Plattform (darwin/linux x64 und arm64, windows x64) herunter, prüft dessen fixierten SHA256 und entpackt ihn mit dem `tar` des Systems nach `~/.pota/tools/comment-checker/`. Ein fehlgeschlagener Download wird bei einem späteren Sitzungsstart mit Backoff wiederholt. Bis ein Download gelingt, gehen Bearbeitungen ungeprüft durch; ein Fehler des Prüfers oder eine Prüfung über 7 Sekunden geht ebenfalls durch. `pota doctor` zeigt den Zustand in einer Zeile, und `POTA_COMMENT_CHECKER=0` (auch `false`, `off` oder `no`) oder `"commentChecker": false` in `~/.pota/config.json` schaltet Prüfung und Download ab.
- Main-model-Prüfung: Liegt das main model der Sitzung unter dem stronger tier, fügt `SessionStart` eine Zeile `Pota main model:` und einen einmaligen Hinweis hinzu. Nur bei einem goal mit einer Heavy-Path-task (Quick und Light Path laufen mit dem main model weiter) müssen Planung/Triage und das abschließende Review dann an den stronger tier oder höher delegiert und aufgezeichnet werden (das Review mit `goal assign … --kind review`); ohne diesen Eintrag werden der Abschluss von `triage-plan` und `goal finish` abgelehnt, außer mit `--allow-main-model <reason>`. Ein fehlender oder nicht erkannter model-Wert löst sie nie aus. Mit `POTA_MAIN_MODEL_GATE=0` lässt sie sich abschalten.
- Model ceiling: Wenn das Konto die höheren tiers nicht nutzen kann oder soll (Abonnement, Organisationsrichtlinie, usage credits), setze `POTA_MODEL_CEILING=stronger` (oder `balanced`; ein model-Name wie `opus` oder `sonnet` geht ebenfalls) oder `"modelCeiling": "stronger"` in `~/.pota/config.json`. Die Umgebungsvariable hat Vorrang, und `config.json` ist der eine Ort, den alle hooks und CLI-Aufrufe gleich lesen. `SessionStart` fügt dann eine Zeile `Pota model ceiling:` hinzu, tiers über dem ceiling verwenden das model des ceiling-tier, das Heavy-Design-Gate akzeptiert dieses model, und die Main-model-Prüfung verwendet den gedeckelten stronger tier. Ohne Einstellung ändert sich nichts; ein ungültiger Wert wendet kein ceiling an und wird gemeldet.
- Request Brief und Steering: Ein Light- oder Heavy-Path-Plan enthält einen `## Request Brief` (ursprüngliche Anfrage, interpretiertes Ergebnis, Umfang, frühere Aufzeichnungen (`Prior records`, über `pota plan steering`), Annahmen, implizite Anforderungen, offene Fragen, Steering-Protokoll); der Abschluss von `triage-plan` wird abgelehnt, bis er ausgefüllt ist, es sei denn, `--allow-no-request-brief <reason>` wird übergeben. Korrekturen, Ergänzungen und Richtungswechsel des Nutzers werden mit `goal steer --kind <correction|addition|redirect> --reason <text>` erfasst, oder mit `goal replan --steer <correction|addition|redirect|none> --reason <text>`, wenn sich tasks ändern; ab dem zweiten Steering oder bei einem redirect muss zudem `Current request (as of S<n>)` neu geschrieben werden.
- Claim receipt: Blockiert das Stop gate (oder lässt der loop guard einen Stopp durch), solange das goal aktiv ist, und behauptet die letzte Antwort Abschluss oder bestandene Prüfungen, hängt der Hook einen Satz an, der diese Behauptung benennt, damit der Agent sie gegenüber dem Nutzer korrigiert oder die Evidenz festhält. Er ändert nie die Stopp-Entscheidung, ignoriert Codeblöcke, Inline-Code und zitierte Zeilen und liest nur das Feld `last_assistant_message` des Hosts (Claude Code; Codex laut Dokumentation; Antigravity übergibt es nicht). `POTA_CLAIM_RECEIPT=0` schaltet es ab.
- Memory paths: Eine Notiz in `docs/memory` kann unter ihrer `Summary:`-Zeile `Paths: <kommagetrennte repo-relative Pfadpräfixe oder Globs>` tragen (höchstens 8 Einträge; `*` passt auf ein Pfadsegment, `**` auf mehrere). Nach einer erfolgreichen Änderung nennt der PostToolUse-Hook bis zu 3 Notizen, deren Pfade zur geänderten Datei passen, einmal pro Notiz und Sitzung; die übrigen folgen bei späteren Änderungen. `pota memory check` meldet ungültige Einträge als `paths-invalid`.
- Heavy plan review: Auf dem Heavy Path verlangt die task `heavy-design` zusätzlich `planReview`-Evidenz. Ein separater schreibgeschützter Reviewer auf dem stärkeren tier genehmigt standardmäßig und lehnt nur bei Blockern ab, die an Repository-Dateien bestätigt sind; eine erneute Prüfung, danach ein Blocker.
- Escalation und learnings: Ein worker, der auf seinem tier nicht fertig werden kann, beginnt seinen Abschlussbericht mit `ESCALATE: <reason>`, und der orchestrator dispatcht einen tier höher neu (Halt am model ceiling). Worker beenden Berichte mit `LEARNINGS:`; der orchestrator hängt sie an `## Learnings` des Plans an, gibt sie an spätere tasks weiter und nutzt sie für die Entscheidung zur Memory-Promotion.

## DAG Panel

Jeder Host zeigt das aktuelle Pota-goal als DAG-Panel mit einer Spalte pro wave. Claude Code zeichnet es mit seinem eigenen mod-Pane; seit 2.3.0 zeigen Antigravity und Codex / ChatGPT Desktop dasselbe Panel als MCP App, die der lokale MCP-Server `pota-dag` des Plugins bereitstellt. Das Panel hat auf allen drei Hosts dieselben Teile:

- Vier Tabs: DAG (der wave-Graph mit den Ansichten vorherige, aktuelle, nächste und alle; alle ist der Standard), Diff, Plan und Agents & Stats.
- Diff listet die geänderten Dateien des Working Tree mit der Anzahl hinzugefügter und gelöschter Zeilen. Es führt nur lesende Git-Befehle aus und zeigt nie Dateiinhalte; Pfade, die nach Geheimnissen aussehen (`.env*`, `service-account*.json`, Schlüssel- und Zertifikatsdateien und Ähnliches), werden als sensibel markiert und nicht verlinkt.
- Plan zeigt eine Übersicht des aktiven Plans: Titel, goal, aktuelle Anfrage und Checklisten-Fortschritt.
- Agents & Stats zeigt agent, model und effort, die für jeden task aufgezeichnet sind, und die letzten goals des Repositorys. Auf Antigravity ergänzen die Sitzungstranskripte das tatsächliche model, den effort und die Token-Zahlen.
- Die Auswahl eines Knotens öffnet einen Inspector mit den evidence receipts des task und dem diff stat seines `writeScope`.
- Bedienelemente pausieren das goal und setzen es fort und schalten das manuelle approval gate eines task ein oder aus (siehe `pota goal gate` unter [Commands](#commands)).
- Der Inspector eines blockierten (`blocked`) task hat einen Retry-Button: Er führt `goal retry --task <id>` aus (MCP App: die nur für die App bestimmte Aktion `retry_task` von `pota_dag_action`) und setzt den task auf `pending` zurück und löscht seine receipts. Das Panel startet nie selbst einen worker; der orchestrator dispatcht den wiederholten task an einen neuen worker und erfasst `goal assign` erneut.

### Claude Code (mod)

Nötig ist ein Claude Code mit mod-Unterstützung (geschrieben für die mod-API von Claude Code 2.1.325). Auf einer surface ohne Grafik, etwa dem Terminal, erscheint stattdessen eine Textliste.

- `/dag [previous|current|next|all|dag|diff|plan|stats|refresh|close]` öffnet das Panel in dieser Ansicht oder diesem Tab. Eine abgeschlossene Verbindung ist eine durchgezogene Linie; eine laufende ist gestrichelt mit einem wandernden Punkt.
- Es öffnet sich nach `pota goal start` und `pota goal replan` automatisch einmal. Wenn Sie es schließen, öffnet es sich für dasselbe goal nicht erneut.
- Es liest den goal-Zustand bei jedem goal-Befehl und alle 30 Sekunden neu.
- Die Auswahl eines laufenden task öffnet die Konversation des subagent, der daran arbeitet. Ein task, den die Main session selbst erledigt, und jeder task auf einer surface ohne umschaltbare Hauptansicht (die Desktop-App) öffnet stattdessen den Inspector im Pane.

### Antigravity and Codex / ChatGPT Desktop (MCP App)

- Der Server `pota-dag` wird vom Plugin registriert (Antigravity: `mcp_config.json` im Wurzelverzeichnis; Codex / ChatGPT Desktop: `.codex-plugin/mcp.json`) und führt `scripts/pota-dag-mcp.mjs` über stdio ohne Abhängigkeiten aus.
- Der Agent ruft das Tool `open_pota_dag` direkt nach `goal start` auf und wenn er ein aktives goal wieder aufnimmt. Um das Panel selbst zu öffnen, verwenden Sie die skill `dag`: `/dag` auf Antigravity, `$dag` auf Codex (ein Codex-Plugin kann keinen Slash-Befehl registrieren). Antigravity bietet das Panel außerdem als Seitenleisten-Eintrag und als zusätzliches Pane an.
- `open_pota_dag` gibt dem model nur eine kleine Zusammenfassung zurück; das Panel lädt seine Daten selbst. Die Bedienelemente für Pausieren, Fortsetzen und gate funktionieren nur in Workspaces, die die Pota-Hooks als zuletzt aktiv verzeichnet haben (`~/.pota/hosts/antigravity-dag/workspaces.json`).
- Der Inspector kann eine Folgenachricht an die Konversation senden, die den Agenten bittet, einen task zu prüfen.
- Ist der Server auf Antigravity nicht erreichbar, führt der Agent `node "<pluginRoot>/scripts/pota-dag-mcp.mjs" ensure` aus und versucht es einmal erneut; ein nicht verfügbares Panel blockiert die Arbeit nie.

## Antigravity Compatibility

Pota unterstützt die Antigravity-CLI (`agy`); die Antigravity-IDE wird nicht unterstützt. Das Manifest des Plugins ist die `plugin.json` im Wurzelverzeichnis, seine Hooks sind die `hooks.json` im Wurzelverzeichnis, die `scripts/pota-state-antigravity.mjs` aus dem Plugin-Ordner ausführt. Dieser Adapter bildet die Ereignisse von Antigravity auf die Hooks von Pota ab:

- `SessionStart` fügt die Sitzungskapsel und die Zeile `Pota CLI:` hinzu.
- Antigravity hat kein Prompt-Ereignis, daher fügt das erste `PreInvocation` jedes Prompts den Prompt-Kontext hinzu.
- `PostToolUse` auf `write_to_file`, `replace_file_content` und `multi_replace_file_content` führt den comment checker und die Goal-Erinnerung aus; das Ergebnis kommt mit dem nächsten `PreInvocation`.
- `Stop` lässt den Agenten weiterarbeiten, solange das aktive Goal eine unfertige Task hat. Es gibt kein `SubagentStop`.

Skills werden als `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` und `/dag` aufgerufen; Workflows sind kein Bestandteil von Antigravity-Plugins. Die `mcp_config.json` im Wurzelverzeichnis registriert den MCP-Server `pota-dag` für das [DAG-Panel](#dag-panel). Der Adapter folgt der Hook-Dokumentation von Antigravity; sein Verhalten in einer echten `agy`-Sitzung wurde noch nicht geprüft.

## Locale Policy

Potas reusable instructions sind für global use auf Englisch geschrieben. User-visible output sowie erstellte oder aktualisierte documentation, plans und memory artifacts folgen der konfigurierten OS locale, sofern der user nicht ausdrücklich eine andere Sprache verlangt. Das umfasst Inhalte in `MEMORY.md`, `PLAN.md`, `docs/memory` und `docs/plan`. Die CLI lokalisiert common messages für `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de` und `pt` und fällt bei unsupported locales auf English zurück. Codex hook `statusMessage` text bleibt static English, während hook command output English oder Korean ist.

## Delegation

- `explorer`: erledigt read-only codebase discovery, impact analysis, pattern searches und read-only verification, wenn verfügbar.
- `worker`: erledigt bounded implementation oder verification tasks mit klarem file ownership.
- Main session: hält urgent blocking work lokal, wenn der nächste Schritt sofort vom Ergebnis abhängt.

Jeder delegation prompt verwendet sechs sections: TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
