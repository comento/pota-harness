# Pota Harness

Pota Harness est un plugin de harness multi-agent économe en tokens pour Claude Code, Codex / ChatGPT Desktop et la CLI Antigravity.

[English](README.md)

L'idée centrale est de conserver des comportements utiles d'agent harness : hooks, état persistant, planification explicite, délégation ciblée et gardes au moment de l'arrêt. Pota ne fait pas des boucles répétées de vérification TDD le comportement par défaut. Il découpe plutôt le travail en petits module tasks et prouve chaque task avec deux verification gates.

1. Module acceptance verification : prouve le contrat du module modifié.
2. Surface integration verification : prouve le comportement via une surface réelle, comme CLI, HTTP, navigateur ou artefacts de fichiers.

Avant qu'un task ne modifie un état externe, Pota enregistre et exécute le dry-run ou check mode disponible le plus proche. La vérification est bornée : chaque task reçoit deux verification passes par défaut, puis l'agent enregistre un blocker ou divise le task au lieu de continuer une boucle ouverte.

Pota traite aussi la préparation des outils comme une partie du travail. LSP, typecheck, lint, dry-run et verification tools sont vérifiés par rapport au stack du repository. Une installation exige une approbation explicite et un installer pris en charge et épinglé ; sinon un blocker est signalé.

## Install

Pota est un plugin pour Claude Code, Codex (y compris ChatGPT Desktop) et la CLI Antigravity. La racine de ce dépôt est le plugin, et la branche `main` est la version publiée. Chaque host installe, met à jour et supprime sa propre copie avec ses propres commandes de plugin, et cette copie est le runtime du host : ses hooks, ses skills et la CLI s'exécutent depuis elle. Les copies de différents hosts peuvent avoir des versions différentes ; Pota ne les compare pas. Le goal state de `~/.pota/projects/` est partagé par tous les hosts.

### Claude Code

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
```

Dans une session, les mêmes étapes sont `/plugin marketplace add comento/pota-harness` puis `/plugin install pota@pota-harness`. Par défaut, Claude Code ne met pas à jour automatiquement les marketplaces tiers : mettez à jour à la main, puis redémarrez la session.

```sh
claude plugin marketplace update pota-harness
claude plugin update pota@pota-harness
```

Désinstaller :

```sh
claude plugin uninstall pota@pota-harness
claude plugin marketplace remove pota-harness
```

### Codex

```sh
codex plugin marketplace add comento/pota-harness
```

Ensuite, dans la TUI de Codex :

1. Ouvrez `/plugins`, choisissez le marketplace `pota-harness`, installez `pota` et démarrez une nouvelle session.
2. Ouvrez `/hooks` et approuvez les cinq hooks de Pota. Codex n'exécute pas les hooks d'un plugin avant leur approbation, et l'approbation est liée au contenu des hooks : il faut donc les approuver de nouveau dans `/hooks` après chaque mise à jour. Sans approbation, aucune session ne reçoit la ligne `Pota CLI:`, et les skills de Pota vous signalent que les hooks de Pota sont inactifs.

Le plugin enregistre aussi le serveur MCP local `pota-dag` (`.codex-plugin/mcp.json`), qui affiche le [panneau DAG](#dag-panel) dans Codex et ChatGPT Desktop.

Pour mettre à jour, lancez `codex plugin marketplace upgrade pota-harness`, puis approuvez de nouveau les hooks dans `/hooks`. Pour désinstaller, ouvrez le plugin dans `/plugins` et choisissez "Uninstall plugin". Ces étapes Codex suivent la documentation et le code source de Codex ; elles n'ont pas encore été exécutées sur une vraie installation de Codex.

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

Relancez la même commande pour mettre à jour ; la documentation d'Antigravity indique qu'une réinstallation remplace la copie installée. Désinstallez avec `agy plugin uninstall pota`. `agy` 1.5.6 ou plus récent est recommandé. Seule la CLI Antigravity est prise en charge ; l'IDE Antigravity ne l'est pas. Le plugin enregistre aussi le serveur MCP local `pota-dag` (`mcp_config.json` à la racine), qui affiche le [panneau DAG](#dag-panel).

### What each host gets

| | Claude Code | Codex / ChatGPT Desktop | Antigravity CLI |
| --- | --- | --- | --- |
| Skills | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory`, `$dag` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory`, `/dag` |
| Hooks | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | les mêmes cinq, après approbation dans `/hooks` | SessionStart, PreInvocation (contexte du prompt), PostToolUse, Stop ; pas de SubagentStop |
| Agents `explorer`, `worker` | oui (plugin agents `pota:explorer`, `pota:worker`) | fichiers de rôle (`skills/pota-work/roles/`) que l'orchestrator place au début du prompt de dispatch, car un plugin Codex ne peut pas enregistrer d'agents | oui (`agents/` dans le plugin) |
| Panneau DAG | volet mod, ouvert avec la commande mod `/dag` | MCP App (serveur `pota-dag`), ouverte avec `$dag` | MCP App (serveur `pota-dag`), ouverte avec `/dag` |

Les noms d'agent de `invoke_subagent` côté Antigravity et l'approche par fichiers de rôle de Codex n'ont pas encore été exécutés dans une session réelle ; seul le traitement des deux agents par `agy plugin validate` a été vérifié.

### Coming from the npm install (1.x)

Pota 2.x n'est pas publié sur npm et n'a pas de commande globale `pota`. Le paquet npm `@comento/pota-harness` s'arrête à 1.5.0, qui affiche seulement ces instructions d'installation, et le paquet est marqué deprecated.

1. Claude Code uniquement : supprimez d'abord le plugin 1.x avec `claude plugin uninstall pota@pota --scope user`.
2. **Installez le plugin sur chaque host que vous utilisez.** La suppression ci-dessous se fait host par host, et un host resté sur l'installation 1.x ne peut plus se mettre à jour une fois la part d'un autre host supprimée : ses mises à jour, automatiques comprises, sont refusées avec « Managed artifact was modified ».
3. Démarrez une session. Quand le démarrage de session du plugin trouve l'ownership manifest 1.x (`~/.pota/install/lifecycle.json`), il supprime la partie de ce host de l'installation 1.x dans un processus en arrière-plan et le signale ; redémarrez la session une fois. La session suivante indique le résultat une fois. Le runtime 1.x partagé, `~/.pota/update/` et le manifest ne sont supprimés qu'une fois qu'il ne reste plus la partie d'aucun host.

La suppression efface seulement les fichiers et répertoires que le manifest 1.x enregistre et dont le digest n'a pas changé, ainsi que les sections propres à Pota du `config.toml` de Codex. Elle conserve `~/.pota/projects/` (goal state), `~/.pota/config.json`, `~/.pota/tools/comment-checker/`, chaque fichier que vous avez modifié (signalé comme conservé), tout ce que le manifest n'enregistre pas, et le paquet npm global (supprimez-le avec `npm uninstall -g @comento/pota-harness`). Elle refuse, ne supprime rien pour ce host et en donne la raison quand :

- un répertoire sur l'un des chemins du host est un symlink (`symlinked-path` ; supprimez à la main les chemins indiqués) ;
- l'enregistrement du host ne peut pas être retiré sans risque (`host-unregister-failed`) : la CLI `claude` est absente ou échoue, ou le `config.toml` de Codex contient des sections Pota impossibles à identifier sans risque ou dont la réécriture modifierait d'autres sections ;
- le manifest est invalide, a un schema non pris en charge, pointe hors des chemins attendus, ou une transaction d'installation 1.x a été interrompue (`manifest-invalid`, `manifest-unsupported-schema`, `target-outside-allowlist`, `transaction-pending`). Si vous avez installé 1.x avec `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME` ou `CODEX_CONFIG_PATH`, définissez les mêmes valeurs pour le host. Sinon, tant que la part d'aucun host n'a encore été supprimée, lancez `npx @comento/pota-harness@1.5.0 uninstall`, puis redémarrez.

Dès que la part d'un host a été supprimée, l'uninstall de 1.x refuse (« Refusing to uninstall modified managed artifacts ») car le manifest n'est jamais réécrit. L'avis de refus vous demande alors de régler les éléments manuels listés par `doctor`, puis de lancer `node "<pluginRoot>/scripts/pota.mjs" migrate run --host <host>` pour ce host.

Une suppression refusée est retentée après 24 heures et signalée au plus une fois tous les 7 jours. Une installation antérieure à 1.3 n'a pas d'ownership manifest et n'est jamais touchée ; supprimez-la avec `npx @comento/pota-harness@1.5.0 uninstall` avant d'installer le plugin. Pour voir l'état ou lancer vous-même la suppression (`<pluginRoot>` est expliqué plus bas) :

```sh
node "<pluginRoot>/scripts/pota.mjs" doctor
node "<pluginRoot>/scripts/pota.mjs" migrate status
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude --dry-run
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude
```

`POTA_LEGACY_MIGRATION=0` (ou `false`, `off`, `no`) désactive la suppression automatique. Les noms 1.x correspondent en 2.x à :

| 1.x | 2.x |
| --- | --- |
| `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` | les noms de skill de chaque host dans le tableau ci-dessus |
| `/pota-toolcheck` | demander à l'agent de lancer `pota toolcheck` |
| `/pota-doctor` | `pota doctor` |
| les commandes `install`, `upgrade` et `uninstall` de la CLI et les mises à jour automatiques | les commandes de plugin du host ci-dessus ; la CLI affiche maintenant un renvoi vers cette section et se termine avec exit 2 |

### Running the Pota CLI

Chaque démarrage de session affiche une ligne `Pota CLI:` avec le chemin absolu de `scripts/pota.mjs` dans la copie du plugin de ce host, et l'agent lance les commandes Pota avec ce chemin. `<pluginRoot>` est le parent de ce répertoire `scripts` ; le chemin change quand le host installe une nouvelle version. Dans ce README, `pota <command>` signifie `node "<pluginRoot>/scripts/pota.mjs" <command>`.

## Complexity Triage

Chaque implementation task passe d'abord par complexity triage, avant d'appliquer agent, plugin ou delegated workflow guidance. Le triage est décidé à partir de l'exploration du repository, de la portée attendue du changement et des signaux de risque, sans demander à l'utilisateur les faits découvrables.

- Light Path : changements étroits dans les existing architecture layers. C'est le comportement par défaut. Implémentez directement ou utilisez un `worker` borné, puis conservez le verification gate.
- Heavy Path : new directory/module/layer, new domain model/service/abstraction, security/session/auth, external API/message queue/payment, DB schema/migration, concurrency/transaction/cache changes, cross-domain refactor ou explicit extra-care request.

Le path choisi et sa justification sont enregistrés dans `docs/plan/<topic>.md` quand un plan artifact existe. Même en Light Path, les deux verification gates restent.

Pota choisit le model de chaque task selon sa nature, en quatre tiers avec une valeur par host, et route le reasoning effort ; `Model routing: inherited` dans `MEMORY.md` ou dans le plan désactive la sélection du model par task.

| Tier | Utilisé pour | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- | --- |
| fast | exploration en lecture seule et résumés | `haiku` | `gpt-6-luna` | `flash_lite` |
| balanced | implémentation Light et vérification de routine | `sonnet` | `gpt-6.1-terra` | `flash` |
| stronger | planification, triage, implémentation Heavy, revue, vérification finale | `opus` | `gpt-6-sol` | `pro` |
| strongest | conception Heavy uniquement | `fable` | `gpt-6-astra` | `pro` |

Sur Antigravity, l'outil de délégation par défaut `invoke_subagent` ne prend que la valeur du tier et n'a pas d'option d'effort : l'effort est donc enregistré comme `inherited` ; là où l'outil `swarm` existe, il peut au besoin dispatcher un model concret avec un suffixe d'effort. Pota classe aussi les vrais identifiants de model des sessions Antigravity et de `swarm` (les familles Gemini, GPT-OSS et Claude) dans les mêmes quatre tiers pour ses gates. Un task Heavy assigné sans effort appliqué (`inherited`, `not-applied` ou aucun) ne peut pas être terminé par `goal task --status completed` ni par `goal finish`, sauf avec `--allow-inherited-effort <reason>`.

Quand un subagent délégué a terminé et que l'orchestrator a recueilli son rapport final et ses preuves, il est fermé ou libéré lorsque le host dispose d'une action non destructive pour cela ; sinon il est laissé inactif plutôt que tué (le `manage_subagents(kill)` d'Antigravity l'afficherait comme `Cancelled`).

## Tool Readiness

`pota toolcheck` inspecte le repository courant pour les stacks JavaScript, TypeScript, Python, PHP, Java, Kotlin, Swift, Go et Rust, puis vérifie les LSP et verification tools correspondants.

```sh
pota toolcheck --root .
pota toolcheck --install --yes --root .
```

- `toolcheck` signale les detected stacks et missing tools. Pour chaque missing tool, il affiche une commande d'installation suggérée ou la raison pour laquelle l'installation automatique est indisponible, et l'agent demande une seule fois s'il faut installer ; en cas de refus, ou si l'exécution n'est pas interactive, il enregistre un blocker.
- `toolcheck --install` exige une approbation explicite et `--yes` ; un installer non pris en charge renvoie le résultat canonique `installer-unavailable` sans s'exécuter.
- Les plans Pota enregistrent detected stack, required tools, install commands et blockers.
- Un LSP server manquant n'est pas une raison valable pour ignorer precise codebase exploration tant qu'une installation ou un fallback symbol-aware équivalent n'a pas été tenté.

## Dry-Run And Loop Policy

- Migrations et database changes utilisent `--pretend`, dry-run, schema diff, rollback feasibility checks ou l'équivalent repository-native le plus proche avant les commandes write/apply.
- Package, release, infrastructure, deployment, code generation et formatting work utilisent check, plan, diff, validate ou dry-run modes avant de modifier l'état quand c'est disponible.
- Si aucun dry-run n'existe, le plan l'enregistre et choisit la plus petite commande réversible ou le test artifact disponible.
- Si une verification gate échoue, Pota diagnostique une fois, réduit ou divise le task, puis relance les deux gates.
- Après deux verification passes échouées pour le même task, Pota enregistre le blocker dans `docs/plan/<topic>.md` au lieu de continuer une boucle répétée.

## Model Guidance

Pota applique des ajustements spécifiques uniquement aux modèles Claude-family et Codex-family.

- Claude-family : utile pour long context, policy interpretation et plan/evidence review.
- Codex-family : utile pour small implementation tasks, explicit file edits, command-based verification et bounded `worker` tasks.

Les détails se trouvent dans le plugin installé sous `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md` et `pota://docs/model-guidance/codex.md`.

## Repository Artifacts

Le harness crée et maintient ces fichiers à la racine du repository cible.

- `MEMORY.md` : index court de persistent domain knowledge : une ligne par note sous `## Domain Knowledge` (`- [<name>](docs/memory/<name>.md): <summary>`), plus la `## Policy` du dépôt.
- `docs/memory/*.md` : connaissances détaillées par domaine. Chaque note commence par une ligne `Summary:` (120 caractères au maximum) que l'index et le hook affichent. Une note peut ajouter une ligne facultative `Paths:` après `Summary:`.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json` : état active goal/task/evidence dans user-home, isolé par projet et worktree, pour la reprise et les scoped stop gates. Le working tree ne possède pas le runtime state.
- `PLAN.md` : index court des plans de travail : une ligne de 200 caractères au plus par plan sous `## Active Plans` et `## Completed Plans`. Les règles de planification vivent dans le skill `pota-plan`, pas dans `PLAN.md`.
- `docs/plan/*.md` : detailed execution plans.
- `docs/plan/ARCHIVE.md` : anciennes entrées terminées déplacées hors de `PLAN.md` par `pota plan index --archive`, de la plus récente à la plus ancienne, plus le corps d'une section legacy `## Planning Rules` sous `## Legacy Planning Rules`. Les lignes de liste avant son premier titre `## ` comptent toujours comme indexées.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl` : un enregistrement de synthèse par goal terminé ou annulé (les 200 plus récents par worktree) pour `goal stats --history`.

Gardez `## Completed Plans` de la plus récente à la plus ancienne. `pota plan index --archive` conserve les 20 premières entrées et déplace le reste vers `docs/plan/ARCHIVE.md` sans rien supprimer ; une liste tenue de la plus ancienne à la plus récente archiverait donc les plans les plus récents. Vérifiez d'abord avec `--dry-run`. Les `MEMORY.md`/`PLAN.md` existants fonctionnent sans migration : `init` ne les réécrit jamais et `check` signale l'ancien format uniquement par des warnings.

Au `SessionStart`, le hook indique à l'agent quelles notes de mémoire existent (nom et `Summary:`, ou une seule ligne de noms quand la liste est longue) et, sans goal actif, ajoute une ligne sur l'index des plans : nombre de plans, plans actifs, derniers plans terminés et `docs/plan/ARCHIVE.md` s'il existe. Avec un goal active, paused, blocked ou détenu par une autre session, seule la liste de mémoire est ajoutée, et la capsule d'une autre session n'affiche jamais de noms de plans. Un `UserPromptSubmit` sans goal ajoute une phrase avec le nombre de notes. Le hook lit uniquement les fichiers d'index et les listes de répertoires, jamais le corps des notes, et n'écrit rien ; un dépôt sans notes ni plans reçoit la même sortie qu'avant.

Avant `goal finish`, `pota-work` consigne une décision de memory promotion par goal dans l'Evidence du plan : `Memory promotion: docs/memory/<domain>.md` quand le goal a produit une connaissance réutilisable du dépôt, sinon `Memory promotion: none: <reason>`. La décision est obligatoire ; écrire une note est facultatif. Quand un goal se termine et que son fichier de plan n'a pas de ligne `Memory promotion:` renseignée, `goal finish` et `goal complete` affichent un rappel d'une ligne sur stderr sans changer l'exit code ni stdout.

Les fichiers racine restent courts et les détails vont sous `docs/`, afin que les agents ne lisent que le contexte nécessaire.

Pour économiser les tokens, définissez d'abord un test contract couvrant exigences, invariants, limites et modes d'échec. Prenez le tool exit code de `goal verify -- <argv>` comme autorité, résumez les succès et n'élargissez le contexte qu'en cas d'échec. Inspectez le package lifecycle et exécutez normalement `npm pack --dry-run`. Les scripts content-producing ou inconnus ne doivent jamais utiliser `--ignore-scripts`; utilisez-le seulement si les scripts sont absents ou prouvés content-neutral et si la preuve du full check reste valide.

## Commands

Ci-dessous, `pota <command>` signifie `node "<pluginRoot>/scripts/pota.mjs" <command>`, avec le chemin de la ligne `Pota CLI:` du démarrage de session (voir [Running the Pota CLI](#running-the-pota-cli)).

- `pota doctor [--json]` : diagnostic en lecture seule de cette copie du plugin et de `~/.pota` : version, `pluginRoot`, Node.js (18 ou plus récent), écriture possible dans `POTA_HOME`, accord des quatre surfaces de version de cette copie, fichiers requis, installation 1.x (`none`, `present <version>` ou `blocked <reason>`), dernier rapport de suppression par host avec les chemins conservés et les commandes manuelles, et état de comment-checker. Il ne compare jamais les copies des autres hosts. Exit 1 si un contrôle échoue, 2 pour une erreur d'usage.
- `pota migrate status|run [--host claude|codex|antigravity] [--all] [--dry-run] [--json]` : lance à la main la suppression de l'installation 1.x. `status` montre ce que ferait une exécution et les derniers rapports ; `run` exige `--host <host>` ou `--all` (tous les hosts, y compris ceux qui n'ont pas encore le plugin), et `--dry-run` montre le plan sans rien changer. Exit 1 si la suppression est refusée, 2 pour une erreur d'usage.
- `pota toolcheck` : détecte repository stacks et vérifie required tools ; seul un installer approuvé et pris en charge s'exécute, sinon `installer-unavailable`.
- `pota cleanup --root <repo>` : signale par défaut, en lecture seule, les résidus legacy `.pota` locaux au projet. `--yes` migre/réconcilie le valid active state vers le stockage user-home, supprime uniquement les résidus connus state/lock/tool, préserve les fichiers inconnus et ne supprime le répertoire que s'il est vide.
- `pota memory check|index [--root <repo>]` : `check` compare `MEMORY.md` à `docs/memory/*.md` et affiche un rapport JSON ; il sort avec 1 en cas de notes non indexées, dead links, doublons, résumés périmés, caractères de contrôle dans les résumés ou chemins non sûrs, et les warnings n'échouent qu'avec `--strict`. Les entrées sont les lignes de liste sous `## Domain Knowledge` (ou toutes les lignes de liste d'un ancien fichier sans cette section) ; un lien vers une note dans une autre section est une mention que `index` ne réécrit jamais. `index` ajoute les notes manquantes et, si le `Summary:` a changé, remplace seulement le résumé après le lien (une ligne à plusieurs liens reste telle quelle) ; il ne supprime que les lignes placeholder de Pota exactement identiques dans cette section, jamais d'entrées ni de dead links, et conserve le reste octet pour octet. `--dry-run` donne un aperçu. Si le point d'insertion est dans un bloc de code non fermé, `index` n'écrit rien et sort avec 1 avec `unclosed-fence`. Les erreurs d'usage sortent avec 2 ; `pota memory` sans sous-commande affiche toujours le guide.
- `pota plan check|index [--archive] [--root <repo>]` : la même chose pour `PLAN.md` et `docs/plan/*.md`, dont les entrées sont les lignes de liste sous les titres `## ` finissant par `Plans` (comme `## Superseded Plans`). `index` place un plan dont toutes les cases sont cochées en tête de `## Completed Plans` et tout autre plan dans `## Active Plans` ; seul `--archive` déplace des lignes vers `docs/plan/ARCHIVE.md` : les entrées terminées au-delà des 20 plus récentes, avec leurs paragraphes indentés, et le corps d'une section legacy `## Planning Rules`. `check` avertit quand `## Completed Plans` dépasse 20 entrées ou qu'une section legacy `## Planning Rules` subsiste.
- `pota goal ...` : gère le goal du dépôt (`pota goal --help`). `goal stats --history [--limit N]` agrège les goals terminés du dépôt sur tous ses worktrees : nombres completed/cancelled, médiane et p90 de durée, médianes de tasks et de receipts, taux de reruns, décisions de memory promotion, un `trend` older/newer dès 4 goals terminés et les goals récents ; sans historique il affiche `{"schemaVersion":1,"scope":"repository","goals":0}`. `completionCriteria` (`goal start --criteria`) est `advisory` : Pota l'enregistre sans l'imposer, et la complétion dépend uniquement des preuves requises. `goal gate --task <id> --on|--off [--reason <text>]` pose ou lève une porte d'approbation manuelle sur un task qui n'est ni active ni completed. Un task gated n'est jamais démarré automatiquement ni présenté comme le travail à poursuivre : `goal ready` le liste sous `gated` (une clé qui n'apparaît que lorsqu'une porte existe) au lieu de `ready`, et lorsqu'il ne reste que des tasks gated, le contexte du hook indique que le goal attend l'approbation de l'utilisateur. Seul l'utilisateur lève une porte, avec `goal gate --off`, avec `goal task --task <id> --status active --approve-gate` ou depuis le panneau DAG. Les portes vivent dans le goal state partagé : elles ne sont donc appliquées que si chaque host qui travaille sur le dépôt exécute la version 2.3.0 ou plus récente. `goal retry --task <id>` remet un task `blocked` à `pending` et efface son blocker, son enregistrement de dispatch (agent, effort, model, effective model, host) et ses receipts (il faut réenregistrer les deux vérifications pour le terminer) pour que l'orchestrator l'envoie à un nouveau worker ; route, kind, porte d'approbation, evidence requise, receipts des autres tasks et tasks terminés restent inchangés. Un goal bloqué par le blocker de ce task redevient `active` et, s'il n'y a aucun task actif, le premier task prêt est activé (ceux avec une porte attendent toujours) ; si rien ne peut s'exécuter, le goal est de nouveau bloqué avec le motif d'un task bloqué restant. Un goal bloqué à la main avec `goal block` n'est pas débloqué par retry (`goal resume` est nécessaire) ; un goal `paused` reste en pause. Tout autre statut de task est refusé.
- `pota-memory` : explore domain knowledge et met à jour `MEMORY.md`.
- `pota-plan` : crée un decision-complete plan sous `docs/plan/`.
- `pota-work` : exécute le prochain module task du `PLAN.md` courant avec deux verification gates.
- `pota-review` : relit completed tasks par rapport au plan, memory et evidence.
- `dag` : ouvre seulement le [panneau DAG](#dag-panel) ; elle ne planifie pas, n'édite pas et ne modifie jamais le goal state.

Pota n'écrit que sous `POTA_HOME` (par défaut `~/.pota`) et jamais dans sa copie du plugin. Codex lie l'approbation des hooks au contenu du plugin : une copie qui se modifierait elle-même perdrait son approbation. Les fichiers de plugin d'un host ne sont installés, mis à jour et supprimés que par les commandes de plugin de ce host.

## Pota Home And Settings

Pota garde ses données sous `POTA_HOME` (par défaut `~/.pota`), partagé par les copies du plugin de tous les hosts.

```text
~/.pota/
  projects/                 goal state
  config.json               user settings ("commentChecker", "modelCeiling")
  tools/comment-checker/    binaire comment-checker (release fixée)
  migration/                rapports et état de la suppression de l'installation 1.x
  hosts/antigravity/        fichiers de session Antigravity (messages de hooks en attente du prochain prompt)
  hosts/antigravity-dag/    workspaces.json : workspaces récemment actifs pour la MCP App DAG (Antigravity et Codex)
  install/, update/         laissés par l'installation npm 1.x jusqu'à la fin de sa suppression
```

- Réglages 1.x : `"autoUpgrade"` dans `config.json` est ignoré ; Pota ne se met plus à jour lui-même.
- Vérification des commentaires : après une édition réussie (Claude Code `Write`/`Edit`/`MultiEdit`, Codex `apply_patch` et outils d'édition), le hook PostToolUse exécute [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker) (MIT) sur le texte modifié et, s'il signale des commentaires inutiles, renvoie `decision: "block"` pour que l'agent les supprime ou explique pourquoi ils sont nécessaires. Aucune dépendance npm n'est ajoutée : le démarrage de session d'un hook du host télécharge dans un processus séparé la release fixée v0.8.2 pour la plateforme courante (darwin/linux x64 et arm64, windows x64), vérifie son SHA256 fixé et l'extrait avec le `tar` du système dans `~/.pota/tools/comment-checker/`. Un téléchargement échoué est retenté à un démarrage de session ultérieur avec un backoff. Tant qu'un téléchargement n'a pas réussi, les éditions passent sans vérification ; une erreur du vérificateur ou une vérification de plus de 7 secondes passe aussi. `pota doctor` affiche son état sur une ligne, et `POTA_COMMENT_CHECKER=0` (ou `false`, `off`, `no`) ou `"commentChecker": false` dans `~/.pota/config.json` désactive à la fois la vérification et le téléchargement.
- Vérification du main model : lorsque le main model de la session est inférieur au tier stronger, `SessionStart` ajoute une ligne `Pota main model:` et un avis unique. Uniquement pour un goal ayant une task Heavy Path (Quick et Light Path continuent avec le main model), la planification/le triage et la revue finale doivent alors être délégués au tier stronger ou supérieur et enregistrés (la revue avec `goal assign … --kind review`) ; sans cet enregistrement, la complétion de `triage-plan` et `goal finish` sont refusés, sauf avec `--allow-main-model <reason>`. Une valeur de model absente ou non reconnue ne la déclenche jamais. Elle se désactive avec `POTA_MAIN_MODEL_GATE=0`.
- Model ceiling : lorsque le compte ne peut pas ou ne doit pas utiliser les tiers supérieurs (abonnement, politique de l'organisation, usage credits), définissez `POTA_MODEL_CEILING=stronger` (ou `balanced` ; un nom de model tel que `opus` ou `sonnet` convient aussi) ou `"modelCeiling": "stronger"` dans `~/.pota/config.json`. La variable d'environnement est prioritaire, et `config.json` est l'emplacement unique lu de la même façon par tous les hooks et appels de la CLI. `SessionStart` ajoute alors une ligne `Pota model ceiling:`, les tiers au-dessus du ceiling utilisent le model du tier du ceiling, la porte de conception Heavy accepte ce model et la vérification du main model utilise le tier stronger plafonné. Sans réglage, rien ne change ; une valeur invalide n'applique aucun ceiling et est signalée.
- Request brief et steering : un plan Light ou Heavy Path contient un `## Request Brief` (demande d'origine, résultat interprété, périmètre, enregistrements antérieurs (`Prior records`, via `pota plan steering`), hypothèses, exigences implicites, questions ouvertes, journal de steering), et la complétion de `triage-plan` est refusée tant qu'il n'est pas rempli, sauf avec `--allow-no-request-brief <reason>`. Les corrections, ajouts et redirections de l'utilisateur s'enregistrent avec `goal steer --kind <correction|addition|redirect> --reason <text>`, ou avec `goal replan --steer <correction|addition|redirect|none> --reason <text>` quand les tasks changent ; le deuxième steering ou un redirect exige aussi de réécrire `Current request (as of S<n>)`.
- Claim receipt : quand le Stop gate bloque (ou que le loop guard laisse passer un arrêt) alors que le goal est encore actif, et que la dernière réponse affirme avoir terminé ou que les vérifications passent, le hook ajoute une phrase nommant cette affirmation pour que l'agent la corrige auprès de l'utilisateur ou enregistre la preuve. Il ne change jamais la décision d'arrêt, ignore les blocs de code, le code en ligne et les lignes citées, et lit uniquement le champ `last_assistant_message` de l'hôte (Claude Code ; Codex selon sa documentation ; Antigravity ne le transmet pas). `POTA_CLAIM_RECEIPT=0` le désactive.
- Memory paths : une note de `docs/memory` peut porter `Paths: <préfixes de chemin relatifs au dépôt ou globs, séparés par des virgules>` sous sa ligne `Summary:` (8 entrées au maximum ; `*` correspond à un segment de chemin, `**` à plusieurs). Après une modification réussie, le hook PostToolUse nomme jusqu'à 3 notes dont les chemins correspondent au fichier modifié, une fois par note et par session ; les autres sont nommées lors des modifications suivantes. `pota memory check` signale les entrées invalides avec `paths-invalid`.
- Heavy plan review : sur le Heavy Path, la task `heavy-design` exige aussi une preuve `planReview`. Un reviewer distinct en lecture seule, sur le tier supérieur, approuve par défaut et ne rejette que pour des blockers confirmés dans les fichiers du dépôt ; une seule nouvelle revue, puis un blocker.
- Escalation et learnings : un worker qui ne peut pas terminer sur son tier commence son rapport final par `ESCALATE: <reason>` et l'orchestrator refait un dispatch un tier au-dessus (en s'arrêtant au model ceiling). Les workers terminent leurs rapports par `LEARNINGS:` ; l'orchestrator les ajoute à `## Learnings` du plan, les transmet aux tasks suivantes et s'en sert pour la décision de promotion en mémoire.

## DAG Panel

Chaque host affiche le goal Pota courant sous forme de panneau DAG, une colonne par wave. Claude Code le dessine avec son propre volet mod ; depuis 2.3.0, Antigravity et Codex / ChatGPT Desktop affichent le même panneau sous forme de MCP App servie par le serveur MCP local `pota-dag` du plugin. Le panneau a les mêmes parties sur les trois hosts :

- Quatre onglets : DAG (le graphe des waves, avec les vues précédent, courant, suivant et tout ; tout est la vue par défaut), Diff, Plan et Agents & Stats.
- Diff liste les fichiers modifiés du working tree avec le nombre de lignes ajoutées et supprimées. Il exécute des commandes Git en lecture seule et n'affiche jamais le contenu des fichiers ; les chemins qui ressemblent à des secrets (`.env*`, `service-account*.json`, fichiers de clés et de certificats, et similaires) sont marqués comme sensibles et ne sont pas liés.
- Plan affiche un aperçu du plan actif : titre, goal, demande courante et progression de la checklist.
- Agents & Stats affiche l'agent, le model et l'effort enregistrés pour chaque task ainsi que les goals récents du dépôt. Sur Antigravity, les transcripts de session ajoutent le model réel, l'effort et le nombre de tokens.
- Sélectionner un nœud ouvre un inspecteur avec les evidence receipts du task et le diff stat de son `writeScope`.
- Des contrôles mettent le goal en pause et le reprennent, et activent ou désactivent la porte d'approbation manuelle d'un task (voir `pota goal gate` sous [Commands](#commands)).
- L'inspecteur d'un task bloqué (`blocked`) a un bouton Retry : il exécute `goal retry --task <id>` (MCP App : l'action `retry_task` de `pota_dag_action`, réservée à l'app), qui remet le task à `pending` et efface ses receipts. Le panneau ne lance jamais de worker ; l'orchestrator fait un dispatch du task relancé vers un nouveau worker et réenregistre `goal assign`.

### Claude Code (mod)

Il faut un Claude Code avec prise en charge des mods (écrit pour l'API de mods de Claude Code 2.1.325). Sur une surface sans graphique, comme le terminal, une liste texte est affichée à la place.

- `/dag [previous|current|next|all|dag|diff|plan|stats|refresh|close]` ouvre le panneau sur cette vue ou cet onglet. Un lien terminé est un trait plein ; un lien en cours est en pointillés avec un point qui se déplace.
- Il s'ouvre une fois automatiquement après `pota goal start` et `pota goal replan`. Si vous le fermez, il ne se rouvre pas pour le même goal.
- Il relit l'état du goal à chaque exécution d'une commande goal et toutes les 30 secondes.
- Sélectionner un task en cours ouvre la conversation du subagent qui y travaille. Un task que la main session réalise elle-même, et tout task sur une surface sans vue principale à basculer (l'application de bureau), ouvre à la place l'inspecteur intégré au volet.
- Il lit le goal de la racine de la session. Quand une commande goal s'exécute dans un autre worktree, le panneau suit ce worktree et l'indique sous le titre, puis revient quand la session se déplace ou que ce goal se termine alors que la racine de la session en a un.

### Antigravity and Codex / ChatGPT Desktop (MCP App)

- Le serveur `pota-dag` est enregistré par le plugin (Antigravity : `mcp_config.json` à la racine ; Codex / ChatGPT Desktop : `.codex-plugin/mcp.json`) et exécute `scripts/pota-dag-mcp.mjs` sur stdio, sans dépendances.
- L'agent appelle l'outil `open_pota_dag` juste après `goal start` et quand il reprend un goal actif. Pour ouvrir le panneau vous-même, utilisez la skill `dag` : `/dag` sur Antigravity, `$dag` sur Codex (un plugin Codex ne peut pas enregistrer de slash command). Antigravity propose aussi le panneau comme entrée de la barre latérale et comme volet auxiliaire.
- `open_pota_dag` ne renvoie au model qu'un petit résumé ; le panneau charge lui-même ses données. Les contrôles de pause, de reprise et de porte ne fonctionnent que sur les workspaces que les hooks de Pota ont enregistrés comme récemment actifs (`~/.pota/hosts/antigravity-dag/workspaces.json`).
- L'inspecteur peut envoyer à la conversation un message de suivi qui demande à l'agent de relire un task.
- Si le serveur est arrêté sur Antigravity, l'agent lance `node "<pluginRoot>/scripts/pota-dag-mcp.mjs" ensure` et réessaie une fois ; un panneau indisponible ne bloque jamais le travail.

## Antigravity Compatibility

Pota prend en charge la CLI Antigravity (`agy`) ; l'IDE Antigravity n'est pas pris en charge. Le manifest du plugin est le `plugin.json` à la racine, et ses hooks sont le `hooks.json` à la racine, qui lance `scripts/pota-state-antigravity.mjs` depuis le dossier du plugin. Cet adaptateur fait correspondre les événements d'Antigravity aux hooks de Pota :

- `SessionStart` ajoute la capsule de session et la ligne `Pota CLI:`.
- Antigravity n'a pas d'événement de prompt : le premier `PreInvocation` de chaque prompt ajoute le contexte du prompt.
- `PostToolUse` sur `write_to_file`, `replace_file_content` et `multi_replace_file_content` lance le comment checker et le rappel du goal ; le résultat est ajouté au `PreInvocation` suivant.
- `Stop` fait continuer l'agent tant que le goal actif a une task inachevée. Il n'y a pas de `SubagentStop`.

Les skills s'appellent avec `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` et `/dag` ; les workflows ne font pas partie des plugins Antigravity. Le `mcp_config.json` à la racine enregistre le serveur MCP `pota-dag` pour le [panneau DAG](#dag-panel). L'adaptateur suit la documentation des hooks d'Antigravity ; son comportement dans une vraie session `agy` n'a pas encore été vérifié.

## Locale Policy

Les instructions réutilisables de Pota sont écrites en anglais pour un usage global. La sortie visible par l'utilisateur ainsi que la documentation, les plans et les artifacts mémoire générés ou mis à jour doivent suivre l'OS locale configurée, sauf si l'utilisateur demande explicitement une autre langue. Cela inclut le contenu de `MEMORY.md`, `PLAN.md`, `docs/memory` et `docs/plan`. La CLI localise les messages communs pour `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de` et `pt`, puis revient à English pour les locales non prises en charge. Le texte `statusMessage` des Codex hooks reste en anglais statique, tandis que hook command output est English ou Korean.

## Delegation

- `explorer` : gère read-only codebase discovery, impact analysis, pattern searches et read-only verification quand disponible.
- `worker` : gère des bounded implementation ou verification tasks avec file ownership clair.
- Main session : garde local l'urgent blocking work quand l'étape suivante dépend immédiatement du résultat.

Chaque delegation prompt utilise six sections : TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
