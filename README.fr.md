# Pota Harness

Pota Harness est un plugin de harness multi-agent économe en tokens pour Codex, Claude Code et Antigravity.

[English](README.md)

L'idée centrale est de conserver des comportements utiles d'agent harness : hooks, état persistant, planification explicite, délégation ciblée et gardes au moment de l'arrêt. Pota ne fait pas des boucles répétées de vérification TDD le comportement par défaut. Il découpe plutôt le travail en petits module tasks et prouve chaque task avec deux verification gates.

1. Module acceptance verification : prouve le contrat du module modifié.
2. Surface integration verification : prouve le comportement via une surface réelle, comme CLI, HTTP, navigateur ou artefacts de fichiers.

Avant qu'un task ne modifie un état externe, Pota enregistre et exécute le dry-run ou check mode disponible le plus proche. La vérification est bornée : chaque task reçoit deux verification passes par défaut, puis l'agent enregistre un blocker ou divise le task au lieu de continuer une boucle ouverte.

Pota traite aussi la préparation des outils comme une partie du travail. LSP, typecheck, lint, dry-run et verification tools sont vérifiés par rapport au stack du repository. Une installation exige une approbation explicite et un installer pris en charge et épinglé ; sinon un blocker est signalé.

## Install

Pota est un plugin pour Claude Code, Codex et la CLI Antigravity. La racine de ce dépôt est le plugin, et la branche `main` est la version publiée. Chaque host installe, met à jour et supprime sa propre copie avec ses propres commandes de plugin, et cette copie est le runtime du host : ses hooks, ses skills et la CLI s'exécutent depuis elle. Les copies de différents hosts peuvent avoir des versions différentes ; Pota ne les compare pas. Le goal state de `~/.pota/projects/` est partagé par tous les hosts.

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

Pour mettre à jour, lancez `codex plugin marketplace upgrade pota-harness`, puis approuvez de nouveau les hooks dans `/hooks`. Pour désinstaller, ouvrez le plugin dans `/plugins` et choisissez "Uninstall plugin". Ces étapes Codex suivent la documentation et le code source de Codex ; elles n'ont pas encore été exécutées sur une vraie installation de Codex.

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

Relancez la même commande pour mettre à jour ; la documentation d'Antigravity indique qu'une réinstallation remplace la copie installée. Désinstallez avec `agy plugin uninstall pota`. `agy` 1.5.6 ou plus récent est recommandé. Seule la CLI Antigravity est prise en charge ; l'IDE Antigravity ne l'est pas.

### What each host gets

| | Claude Code | Codex | Antigravity CLI |
| --- | --- | --- | --- |
| Skills | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` |
| Hooks | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | les mêmes cinq, après approbation dans `/hooks` | SessionStart, PreInvocation (contexte du prompt), PostToolUse, Stop ; pas de SubagentStop |
| Agents `explorer`, `worker` | oui | non | non |
| Panneau DAG (mod) | oui | non | non |

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
- `docs/memory/*.md` : connaissances détaillées par domaine. Chaque note commence par une ligne `Summary:` (120 caractères au maximum) que l'index et le hook affichent.
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
- `pota goal ...` : gère le goal du dépôt (`pota goal --help`). `goal stats --history [--limit N]` agrège les goals terminés du dépôt sur tous ses worktrees : nombres completed/cancelled, médiane et p90 de durée, médianes de tasks et de receipts, taux de reruns, décisions de memory promotion, un `trend` older/newer dès 4 goals terminés et les goals récents ; sans historique il affiche `{"schemaVersion":1,"scope":"repository","goals":0}`. `completionCriteria` (`goal start --criteria`) est `advisory` : Pota l'enregistre sans l'imposer, et la complétion dépend uniquement des preuves requises.
- `pota-memory` : explore domain knowledge et met à jour `MEMORY.md`.
- `pota-plan` : crée un decision-complete plan sous `docs/plan/`.
- `pota-work` : exécute le prochain module task du `PLAN.md` courant avec deux verification gates.
- `pota-review` : relit completed tasks par rapport au plan, memory et evidence.

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
  install/, update/         laissés par l'installation npm 1.x jusqu'à la fin de sa suppression
```

- Réglages 1.x : `"autoUpgrade"` dans `config.json` est ignoré ; Pota ne se met plus à jour lui-même.
- Vérification des commentaires : après une édition réussie (Claude Code `Write`/`Edit`/`MultiEdit`, Codex `apply_patch` et outils d'édition), le hook PostToolUse exécute [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker) (MIT) sur le texte modifié et, s'il signale des commentaires inutiles, renvoie `decision: "block"` pour que l'agent les supprime ou explique pourquoi ils sont nécessaires. Aucune dépendance npm n'est ajoutée : le démarrage de session d'un hook du host télécharge dans un processus séparé la release fixée v0.8.2 pour la plateforme courante (darwin/linux x64 et arm64, windows x64), vérifie son SHA256 fixé et l'extrait avec le `tar` du système dans `~/.pota/tools/comment-checker/`. Un téléchargement échoué est retenté à un démarrage de session ultérieur avec un backoff. Tant qu'un téléchargement n'a pas réussi, les éditions passent sans vérification ; une erreur du vérificateur ou une vérification de plus de 7 secondes passe aussi. `pota doctor` affiche son état sur une ligne, et `POTA_COMMENT_CHECKER=0` (ou `false`, `off`, `no`) ou `"commentChecker": false` dans `~/.pota/config.json` désactive à la fois la vérification et le téléchargement.
- Vérification du main model : lorsque le main model de la session est inférieur au tier stronger, `SessionStart` ajoute une ligne `Pota main model:` et un avis unique. La planification/le triage et la revue finale doivent alors être délégués au tier stronger ou supérieur et enregistrés (la revue avec `goal assign … --kind review`) ; sans cet enregistrement, la complétion de `triage-plan` et `goal finish` sont refusés, sauf avec `--allow-main-model <reason>`. Une valeur de model absente ou non reconnue ne la déclenche jamais. Elle se désactive avec `POTA_MAIN_MODEL_GATE=0`.
- Model ceiling : lorsque le compte ne peut pas ou ne doit pas utiliser les tiers supérieurs (abonnement, politique de l'organisation, usage credits), définissez `POTA_MODEL_CEILING=stronger` (ou `balanced` ; un nom de model tel que `opus` ou `sonnet` convient aussi) ou `"modelCeiling": "stronger"` dans `~/.pota/config.json`. La variable d'environnement est prioritaire, et `config.json` est l'emplacement unique lu de la même façon par tous les hooks et appels de la CLI. `SessionStart` ajoute alors une ligne `Pota model ceiling:`, les tiers au-dessus du ceiling utilisent le model du tier du ceiling, la porte de conception Heavy accepte ce model et la vérification du main model utilise le tier stronger plafonné. Sans réglage, rien ne change ; une valeur invalide n'applique aucun ceiling et est signalée.
- Request brief et steering : un plan Light ou Heavy Path contient un `## Request Brief` (demande d'origine, résultat interprété, périmètre, enregistrements antérieurs (`Prior records`, via `pota plan steering`), hypothèses, exigences implicites, questions ouvertes, journal de steering), et la complétion de `triage-plan` est refusée tant qu'il n'est pas rempli, sauf avec `--allow-no-request-brief <reason>`. Les corrections, ajouts et redirections de l'utilisateur s'enregistrent avec `goal steer --kind <correction|addition|redirect> --reason <text>`, ou avec `goal replan --steer <correction|addition|redirect|none> --reason <text>` quand les tasks changent ; le deuxième steering ou un redirect exige aussi de réécrire `Current request (as of S<n>)`.

## Claude Code DAG Panel

Claude Code Desktop affiche le goal Pota courant sous forme de panneau DAG, une colonne par wave. Il est propre à Claude Code ; Codex et Antigravity ne l'ont pas. Il faut un Claude Code avec prise en charge des mods (écrit pour l'API de mods de Claude Code 2.1.325) ; sur une surface sans graphique, comme le terminal, une liste texte est affichée à la place.

- `/dag [previous|current|next|all|refresh|close]` ouvre le panneau. Les vues sont précédent, courant, suivant et tout. La vue par défaut est tout (all) ; les autres sont facultatives. Un lien terminé est un trait plein ; un lien en cours est en pointillés avec un point qui se déplace.
- Il s'ouvre une fois automatiquement après `pota goal start` et `pota goal replan`. Si vous le fermez, il ne se rouvre pas pour le même goal.
- Il relit l'état du goal à chaque exécution d'une commande goal et toutes les 30 secondes.

## Antigravity Compatibility

Pota prend en charge la CLI Antigravity (`agy`) ; l'IDE Antigravity n'est pas pris en charge. Le manifest du plugin est le `plugin.json` à la racine, et ses hooks sont le `hooks.json` à la racine, qui lance `scripts/pota-state-antigravity.mjs` depuis le dossier du plugin. Cet adaptateur fait correspondre les événements d'Antigravity aux hooks de Pota :

- `SessionStart` ajoute la capsule de session et la ligne `Pota CLI:`.
- Antigravity n'a pas d'événement de prompt : le premier `PreInvocation` de chaque prompt ajoute le contexte du prompt.
- `PostToolUse` sur `write_to_file`, `replace_file_content` et `multi_replace_file_content` lance le comment checker et le rappel du goal ; le résultat est ajouté au `PreInvocation` suivant.
- `Stop` fait continuer l'agent tant que le goal actif a une task inachevée. Il n'y a pas de `SubagentStop`.

Les skills s'appellent avec `/pota-plan`, `/pota-work`, `/pota-review` et `/pota-memory` ; les workflows ne font pas partie des plugins Antigravity. L'adaptateur suit la documentation des hooks d'Antigravity ; son comportement dans une vraie session `agy` n'a pas encore été vérifié.

## Locale Policy

Les instructions réutilisables de Pota sont écrites en anglais pour un usage global. La sortie visible par l'utilisateur ainsi que la documentation, les plans et les artifacts mémoire générés ou mis à jour doivent suivre l'OS locale configurée, sauf si l'utilisateur demande explicitement une autre langue. Cela inclut le contenu de `MEMORY.md`, `PLAN.md`, `docs/memory` et `docs/plan`. La CLI localise les messages communs pour `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de` et `pt`, puis revient à English pour les locales non prises en charge. Le texte `statusMessage` des Codex hooks reste en anglais statique, tandis que hook command output est English ou Korean.

## Delegation

- `explorer` : gère read-only codebase discovery, impact analysis, pattern searches et read-only verification quand disponible.
- `worker` : gère des bounded implementation ou verification tasks avec file ownership clair.
- Main session : garde local l'urgent blocking work quand l'étape suivante dépend immédiatement du résultat.

Chaque delegation prompt utilise six sections : TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
