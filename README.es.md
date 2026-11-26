# Pota Harness

Pota Harness es un plugin de harness multi-agente eficiente en tokens para Claude Code, Codex / ChatGPT Desktop y la CLI de Antigravity.

[English](README.md)

La idea central es conservar comportamientos útiles de agent harness: hooks, estado persistente, planificación explícita, delegación enfocada y guardas al detenerse. Pota no hace que los bucles repetidos de verificación TDD sean el comportamiento predeterminado. En su lugar, divide el trabajo en pequeños module tasks y prueba cada task con dos verification gates.

1. Module acceptance verification: prueba el contrato del módulo modificado.
2. Surface integration verification: prueba el comportamiento a través de una superficie real, como CLI, HTTP, navegador o artefactos de archivo.

Antes de que un task modifique estado externo, Pota registra y ejecuta el dry-run o check mode más cercano disponible. La verificación está acotada: cada task tiene dos verification passes por defecto; después, el agente registra un blocker o divide el task en lugar de continuar un bucle abierto.

Pota también trata la preparación de herramientas como parte del trabajo. LSP, typecheck, lint, dry-run y verification tools se revisan contra el stack del repositorio. Solo se instala con aprobación explícita y un installer compatible y fijado; de lo contrario se registra un blocker.

## Install

Pota es un plugin para Claude Code, Codex (incluido ChatGPT Desktop) y la CLI de Antigravity. La raíz de este repositorio es el plugin y la rama `main` es la versión publicada. Cada host instala, actualiza y elimina su propia copia con sus propios comandos de plugin, y esa copia es el runtime de ese host: sus hooks, skills y CLI se ejecutan desde ella. Las copias de distintos hosts pueden tener versiones distintas; Pota no las compara. El goal state de `~/.pota/projects/` lo comparten todos los hosts.

### Claude Code

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
```

Dentro de una sesión los mismos pasos son `/plugin marketplace add comento/pota-harness` y `/plugin install pota@pota-harness`. Claude Code no actualiza automáticamente los marketplaces de terceros por defecto, así que actualiza a mano y reinicia la sesión:

```sh
claude plugin marketplace update pota-harness
claude plugin update pota@pota-harness
```

Desinstalar:

```sh
claude plugin uninstall pota@pota-harness
claude plugin marketplace remove pota-harness
```

### Codex

```sh
codex plugin marketplace add comento/pota-harness
```

Después, en la TUI de Codex:

1. Abre `/plugins`, elige el marketplace `pota-harness`, instala `pota` e inicia una sesión nueva.
2. Abre `/hooks` y aprueba los cinco hooks de Pota. Codex no ejecuta hooks de plugins hasta que los apruebas, y la aprobación está ligada al contenido de los hooks, así que hay que aprobarlos de nuevo en `/hooks` después de cada actualización. Sin aprobación ninguna sesión recibe la línea `Pota CLI:`, y las skills de Pota te avisan de que los hooks de Pota están inactivos.

El plugin también registra el servidor MCP local `pota-dag` (`.codex-plugin/mcp.json`), que muestra el [panel DAG](#dag-panel) en Codex y ChatGPT Desktop.

Para actualizar, ejecuta `codex plugin marketplace upgrade pota-harness` y vuelve a aprobar los hooks en `/hooks`. Para desinstalar, abre el plugin en `/plugins` y elige "Uninstall plugin". Estos pasos de Codex siguen la documentación y el código fuente de Codex; todavía no se han ejecutado en una instalación real de Codex.

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

Para actualizar, ejecuta de nuevo el mismo comando; la documentación de Antigravity indica que reinstalar reemplaza la copia instalada. Para desinstalar, `agy plugin uninstall pota`. Se recomienda `agy` 1.5.6 o posterior. Solo se admite la CLI de Antigravity; el IDE de Antigravity no. El plugin también registra el servidor MCP local `pota-dag` (`mcp_config.json` de la raíz), que muestra el [panel DAG](#dag-panel).

### What each host gets

| | Claude Code | Codex / ChatGPT Desktop | Antigravity CLI |
| --- | --- | --- | --- |
| Skills | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory`, `$dag` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory`, `/dag` |
| Hooks | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | los mismos cinco, tras aprobarlos en `/hooks` | SessionStart, PreInvocation (contexto del prompt), PostToolUse, Stop; sin SubagentStop |
| Agents `explorer`, `worker` | sí (plugin agents `pota:explorer`, `pota:worker`) | archivos de rol (`skills/pota-work/roles/`) que el orchestrator pone al principio del prompt de dispatch, porque un plugin de Codex no puede registrar agents | sí (`agents/` en el plugin) |
| Panel DAG | panel mod, se abre con el comando mod `/dag` | MCP App (servidor `pota-dag`), se abre con `$dag` | MCP App (servidor `pota-dag`), se abre con `/dag` |

Los nombres de agent de `invoke_subagent` en Antigravity y el enfoque de archivos de rol de Codex aún no se han ejecutado en una sesión real; solo se comprobó que `agy plugin validate` procesa los dos agents.

### Coming from the npm install (1.x)

Pota 2.x no se publica en npm y no tiene comando global `pota`. El paquete npm `@comento/pota-harness` termina en 1.5.0, que solo muestra estas instrucciones de instalación, y el paquete está marcado como deprecated.

1. Solo Claude Code: elimina primero el plugin 1.x con `claude plugin uninstall pota@pota --scope user`.
2. **Instala el plugin en todos los hosts que uses.** La eliminación de abajo funciona host por host, y un host que se queda con la instalación 1.x ya no puede actualizarse cuando se elimina la parte de otro host: sus actualizaciones, también las automáticas, se rechazan con "Managed artifact was modified".
3. Inicia una sesión. Cuando el inicio de sesión del plugin encuentra el ownership manifest de 1.x (`~/.pota/install/lifecycle.json`), elimina la parte de ese host de la instalación 1.x en un proceso en segundo plano y lo avisa; reinicia la sesión una vez. La sesión siguiente informa del resultado una vez. El runtime 1.x compartido, `~/.pota/update/` y el manifest solo se eliminan cuando ya no queda la parte de ningún host.

La eliminación borra solo los archivos y directorios que el manifest 1.x registra y cuyo digest no ha cambiado, además de las secciones propias de Pota en el `config.toml` de Codex. Conserva `~/.pota/projects/` (goal state), `~/.pota/config.json`, `~/.pota/tools/comment-checker/`, cada archivo que hayas modificado (se informa como conservado), todo lo que el manifest no registra y el paquete npm global (elimínalo con `npm uninstall -g @comento/pota-harness`). No elimina nada de ese host, y explica el motivo, cuando:

- un directorio en una de las rutas del host es un symlink (`symlinked-path`; elimina a mano las rutas indicadas);
- el registro del host no se puede quitar de forma segura (`host-unregister-failed`): falta la CLI `claude` o falla, o el `config.toml` de Codex tiene secciones de Pota que no se pueden identificar con seguridad o reescribirlo cambiaría otras secciones;
- el manifest no es válido, tiene un schema no admitido, apunta fuera de las rutas esperadas o se interrumpió una transacción de instalación 1.x (`manifest-invalid`, `manifest-unsupported-schema`, `target-outside-allowlist`, `transaction-pending`). Si instalaste 1.x con `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME` o `CODEX_CONFIG_PATH`, define los mismos valores para el host. Si no, y mientras no se haya eliminado aún la parte de ningún host, ejecuta `npx @comento/pota-harness@1.5.0 uninstall` y reinicia.

Cuando ya se eliminó la parte de algún host, el uninstall de 1.x se niega ("Refusing to uninstall modified managed artifacts") porque el manifest nunca se reescribe. Entonces el aviso de rechazo te pide resolver los elementos manuales que lista `doctor` y ejecutar `node "<pluginRoot>/scripts/pota.mjs" migrate run --host <host>` para ese host.

Una eliminación rechazada se reintenta a las 24 horas y se avisa como mucho una vez cada 7 días. Una instalación anterior a 1.3 no tiene ownership manifest y nunca se toca; elimínala con `npx @comento/pota-harness@1.5.0 uninstall` antes de instalar el plugin. Para ver el estado o ejecutar tú mismo la eliminación (`<pluginRoot>` se explica abajo):

```sh
node "<pluginRoot>/scripts/pota.mjs" doctor
node "<pluginRoot>/scripts/pota.mjs" migrate status
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude --dry-run
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude
```

`POTA_LEGACY_MIGRATION=0` (también `false`, `off` o `no`) desactiva la eliminación automática. Los nombres de 1.x corresponden en 2.x a:

| 1.x | 2.x |
| --- | --- |
| `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` | los nombres de skill de cada host en la tabla de arriba |
| `/pota-toolcheck` | pide al agente que ejecute `pota toolcheck` |
| `/pota-doctor` | `pota doctor` |
| los comandos `install`, `upgrade` y `uninstall` de la CLI y las actualizaciones automáticas | los comandos de plugin del host de arriba; la CLI ahora muestra una indicación hacia esta sección y termina con exit 2 |

### Running the Pota CLI

Cada inicio de sesión imprime una línea `Pota CLI:` con la ruta absoluta de `scripts/pota.mjs` en la copia del plugin de ese host, y el agente ejecuta los comandos de Pota con esa ruta. `<pluginRoot>` es el directorio padre de ese `scripts`; la ruta cambia cuando el host instala una versión nueva. En este README, `pota <command>` significa `node "<pluginRoot>/scripts/pota.mjs" <command>`.

## Complexity Triage

Cada implementation task pasa primero por complexity triage, antes de aplicar agent, plugin o delegated workflow guidance. El triage se decide a partir de la exploración del repositorio, el alcance esperado del cambio y señales de riesgo, sin preguntar al usuario por hechos que se puedan descubrir.

- Light Path: cambios estrechos dentro de existing architecture layers. Es el valor predeterminado. Implementa directamente o usa un `worker` acotado, y conserva el verification gate.
- Heavy Path: new directory/module/layer, new domain model/service/abstraction, security/session/auth, external API/message queue/payment, DB schema/migration, concurrency/transaction/cache changes, cross-domain refactor o una explicit extra-care request.

El path seleccionado y su justificación se registran en `docs/plan/<topic>.md` cuando existe un plan artifact. Incluso en Light Path, se mantienen los dos verification gates.

Pota elige el model de cada task según su naturaleza, en cuatro tiers con un valor por host, y enruta el reasoning effort; `Model routing: inherited` en `MEMORY.md` o en el plan desactiva la selección de model por task.

| Tier | Se usa para | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- | --- |
| fast | exploración de solo lectura y resúmenes | `haiku` | `gpt-6-luna` | `flash_lite` |
| balanced | implementación Light y verificación rutinaria | `sonnet` | `gpt-6.1-terra` | `flash` |
| stronger | planificación, triaje, implementación Heavy, revisión, verificación final | `opus` | `gpt-6-sol` | `pro` |
| strongest | solo diseño Heavy | `fable` | `gpt-6-astra` | `pro` |

En Antigravity, la herramienta de delegación predeterminada `invoke_subagent` solo recibe el valor del tier y no tiene opción de effort, así que el effort se registra como `inherited`; donde existe la herramienta `swarm`, esta puede opcionalmente despachar un model concreto con un sufijo de effort. Pota también clasifica los IDs de model reales de la sesión de Antigravity y de `swarm` (las familias Gemini, GPT-OSS y Claude) en los mismos cuatro tiers para sus gates. Una task Heavy que se asignó sin un effort aplicado (`inherited`, `not-applied` o ninguno) no se puede completar con `goal task --status completed` ni con `goal finish`, salvo que se pase `--allow-inherited-effort <reason>`.

Cuando un subagent delegado termina y el orquestador ha capturado su informe final y su evidencia, el subagent completado se cierra o se libera si el host tiene una acción no destructiva para ello; de lo contrario se deja inactivo en lugar de matarlo (el `manage_subagents(kill)` de Antigravity lo mostraría como `Cancelled`).

## Tool Readiness

`pota toolcheck` inspecciona el repositorio actual para stacks JavaScript, TypeScript, Python, PHP, Java, Kotlin, Swift, Go y Rust, y luego revisa los LSP y verification tools correspondientes.

```sh
pota toolcheck --root .
pota toolcheck --install --yes --root .
```

- `toolcheck` reporta detected stacks y missing tools. Para cada missing tool imprime un comando de instalación sugerido o el motivo por el que la instalación automática no está disponible, y el agent pregunta una sola vez si debe instalar; si se rechaza, o la ejecución no es interactiva, registra un blocker.
- `toolcheck --install` exige aprobación explícita y `--yes`; un installer no compatible devuelve el resultado canónico `installer-unavailable` y no se ejecuta.
- Los planes de Pota registran detected stack, required tools, install commands y blockers.
- Que falte un LSP server no es razón válida para saltarse precise codebase exploration hasta intentar installation o un fallback symbol-aware equivalente.

## Dry-Run And Loop Policy

- Migrations y database changes usan `--pretend`, dry-run, schema diff, rollback feasibility checks o el equivalente repository-native más cercano antes de comandos write/apply.
- Package, release, infrastructure, deployment, code generation y formatting work usan check, plan, diff, validate o dry-run modes antes de mutar estado cuando están disponibles.
- Si no existe dry-run, el plan registra ese hecho y elige el comando reversible más pequeño o el artefacto de prueba disponible.
- Si falla un verification gate, Pota diagnostica una vez, reduce o divide el task y vuelve a ejecutar ambos gates.
- Después de dos verification passes fallidos para el mismo task, Pota registra el blocker en `docs/plan/<topic>.md` en lugar de continuar un bucle repetido.

## Model Guidance

Pota solo aplica ajustes específicos de modelo a modelos Claude-family y Codex-family.

- Claude-family: útil para long context, policy interpretation y plan/evidence review.
- Codex-family: útil para small implementation tasks, explicit file edits, command-based verification y bounded `worker` tasks.

La guía detallada vive en el plugin instalado y se referencia como `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md` y `pota://docs/model-guidance/codex.md`.

## Repository Artifacts

El harness crea y mantiene estos archivos en la raíz del repositorio objetivo.

- `MEMORY.md`: índice corto de conocimiento persistente del dominio: una línea por nota bajo `## Domain Knowledge` (`- [<name>](docs/memory/<name>.md): <summary>`) más la `## Policy` del repositorio.
- `docs/memory/*.md`: conocimiento detallado por dominio. Cada nota empieza con una línea `Summary:` (120 caracteres como máximo) que muestran el índice y el hook. Una nota puede añadir una línea opcional `Paths:` tras `Summary:`.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json`: estado active goal/task/evidence en user-home, aislado por proyecto y worktree, para recuperación y scoped stop gates. El working tree no posee runtime state.
- `PLAN.md`: índice corto de planes de trabajo: una línea de 200 caracteres o menos por plan bajo `## Active Plans` y `## Completed Plans`. Las reglas de planificación viven en el skill `pota-plan`, no en `PLAN.md`.
- `docs/plan/*.md`: planes de ejecución detallados.
- `docs/plan/ARCHIVE.md`: entradas completadas antiguas que `pota plan index --archive` movió desde `PLAN.md`, de la más nueva a la más antigua, más el cuerpo de una sección legacy `## Planning Rules` bajo `## Legacy Planning Rules`. Las líneas de lista antes de su primer encabezado `## ` siguen contando como indexadas.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl`: un registro resumen por goal completado o cancelado (los 200 más recientes por worktree) para `goal stats --history`.

Mantén `## Completed Plans` de la más nueva a la más antigua. `pota plan index --archive` conserva las primeras 20 entradas y mueve el resto a `docs/plan/ARCHIVE.md` sin borrar nada, así que una lista ordenada de la más antigua a la más nueva archivaría los planes más recientes; revisa antes con `--dry-run`. Los `MEMORY.md`/`PLAN.md` existentes funcionan sin migración: `init` nunca los reescribe y `check` solo avisa del formato antiguo con warnings.

En `SessionStart`, el hook indica al agente qué notas de memoria existen (nombre y `Summary:`, o una sola línea con nombres cuando la lista es larga) y, sin goal activo, añade una línea sobre el índice de planes: número de planes, planes activos, los últimos planes completados y `docs/plan/ARCHIVE.md` si existe. Con un goal active, paused, blocked o de otra sesión solo se añade la lista de memoria, y la cápsula de otra sesión nunca muestra nombres de planes. Un `UserPromptSubmit` sin goal añade una frase con el número de notas. El hook solo lee los archivos índice y los listados de directorio, nunca el cuerpo de las notas, y no escribe nada; un repositorio sin notas ni planes recibe la misma salida que antes.

Antes de `goal finish`, `pota-work` registra una decisión de memory promotion por goal en la Evidence del plan: `Memory promotion: docs/memory/<domain>.md` cuando el goal produjo conocimiento reutilizable del repositorio, o `Memory promotion: none: <reason>` en caso contrario. La decisión es obligatoria; escribir una nota es opcional. Si un goal se completa y su archivo de plan no tiene una línea `Memory promotion:` rellenada, `goal finish` y `goal complete` imprimen un recordatorio de una línea en stderr sin cambiar el exit code ni stdout.

Los archivos raíz se mantienen cortos y los detalles pasan a `docs/`, para que los agentes lean solo el contexto que necesitan.

Para ahorrar tokens, define primero un test contract con requisitos, invariantes, límites y modos de fallo. Usa el tool exit code de `goal verify -- <argv>` como autoridad, resume el éxito y amplía el contexto solo al fallar. Inspecciona el package lifecycle y ejecuta normalmente `npm pack --dry-run`. Los scripts content-producing o desconocidos nunca deben usar `--ignore-scripts`; úsalo solo si no hay scripts o son content-neutral demostrados y la evidencia del full check sigue vigente.

## Commands

`pota <command>` significa abajo `node "<pluginRoot>/scripts/pota.mjs" <command>`, con la ruta de la línea `Pota CLI:` del inicio de sesión (ver [Running the Pota CLI](#running-the-pota-cli)).

- `pota doctor [--json]`: diagnóstico de solo lectura de esta copia del plugin y de `~/.pota`: versión, `pluginRoot`, Node.js (18 o posterior), si `POTA_HOME` admite escritura, si coinciden las cuatro superficies de versión de esta copia, los archivos requeridos, la instalación 1.x (`none`, `present <version>` o `blocked <reason>`), el último informe de eliminación por host con las rutas conservadas y los comandos manuales, y el estado de comment-checker. Nunca compara las copias de otros hosts. Exit 1 si falla una comprobación, 2 si hay un error de uso.
- `pota migrate status|run [--host claude|codex|antigravity] [--all] [--dry-run] [--json]`: ejecuta a mano la eliminación de la instalación 1.x. `status` muestra lo que haría una ejecución y los últimos informes; `run` necesita `--host <host>` o `--all` (todos los hosts, también los que aún no tienen el plugin), y `--dry-run` muestra el plan sin cambiar nada. Exit 1 si la eliminación se rechaza, 2 si hay un error de uso.
- `pota toolcheck`: detecta repository stacks y revisa required tools; solo ejecuta un installer compatible aprobado, o devuelve `installer-unavailable`.
- `pota cleanup --root <repo>`: por defecto informa en modo read-only el residuo legacy `.pota` local al proyecto. `--yes` migra/reconcilia active state válido al almacén user-home, elimina solo residuos conocidos de state/lock/tool, conserva archivos desconocidos y poda el directorio solo si queda vacío.
- `pota memory check|index [--root <repo>]`: `check` compara `MEMORY.md` con `docs/memory/*.md` e imprime un informe JSON; sale con 1 ante notas sin indexar, dead links, duplicados, resúmenes desactualizados, caracteres de control en resúmenes o rutas inseguras, y los warnings solo fallan con `--strict`. Las entradas son líneas de lista bajo `## Domain Knowledge` (o todas las líneas de lista en un archivo antiguo sin esa sección); un enlace a una nota en otra sección es una mención que `index` nunca reescribe. `index` añade las notas que faltan y, si el `Summary:` cambió, reemplaza solo el resumen tras el enlace (una línea con varios enlaces queda como está); solo elimina líneas placeholder de Pota que coinciden exactamente dentro de esa sección, nunca borra entradas ni dead links y conserva el resto byte a byte. `--dry-run` muestra una vista previa. Si el punto de inserción está dentro de un bloque de código sin cerrar, `index` no escribe nada y sale con 1 con `unclosed-fence`. Los errores de uso salen con 2; `pota memory` sin subcomando sigue mostrando la guía.
- `pota plan check|index [--archive] [--root <repo>]`: lo mismo para `PLAN.md` y `docs/plan/*.md`, cuyas entradas son líneas de lista bajo encabezados `## ` que terminan en `Plans` (como `## Superseded Plans`). `index` coloca un plan con todas sus casillas marcadas al principio de `## Completed Plans` y cualquier otro en `## Active Plans`; solo `--archive` mueve líneas a `docs/plan/ARCHIVE.md`: las entradas completadas más allá de las 20 más nuevas, con sus párrafos sangrados, y el cuerpo de una sección legacy `## Planning Rules`. `check` avisa cuando `## Completed Plans` supera 20 entradas o queda una sección legacy `## Planning Rules`.
- `pota goal ...`: gestiona el goal del repositorio (`pota goal --help`). `goal stats --history [--limit N]` agrega los goals terminados del repositorio en todos sus worktrees: recuentos completed/cancelled, mediana y p90 de duración, medianas de tasks y receipts, tasa de reruns, decisiones de memory promotion, un `trend` older/newer desde 4 goals completados y los goals recientes; sin historial imprime `{"schemaVersion":1,"scope":"repository","goals":0}`. `completionCriteria` (`goal start --criteria`) es `advisory`: Pota lo registra pero no lo hace cumplir, y la finalización depende solo de la evidencia requerida. `goal gate --task <id> --on|--off [--reason <text>]` activa o libera un gate de aprobación manual en una task que no está activa ni completada. Una task con gate nunca se inicia automáticamente ni se presenta como el trabajo a continuar: `goal ready` la lista bajo `gated` (una clave que solo aparece cuando existe un gate) en lugar de `ready`, y cuando solo quedan tasks con gate el contexto del hook indica que el goal está a la espera de la aprobación del usuario. Solo el usuario libera un gate, con `goal gate --off`, con `goal task --task <id> --status active --approve-gate` o desde el panel DAG. Los gates viven en el goal state compartido, así que solo se hacen cumplir cuando todos los hosts que trabajan en el repositorio ejecutan 2.3.0 o posterior. `goal retry --task <id>` devuelve una task `blocked` a `pending` y borra su blocker, su registro de dispatch (agent, effort, model, effective model, host) y sus receipts (hay que volver a registrar las dos verificaciones para completarla) para que el orchestrator la envíe a un worker nuevo; route, kind, gate de aprobación, evidence requerida, los receipts de otras tasks y las tasks completadas no cambian. Un goal bloqueado por el blocker de esa task vuelve a `active` y, si no hay ninguna task activa, se activa la primera task lista (las que tienen gate siguen esperando); si nada puede ejecutarse, el goal vuelve a bloquearse con el motivo de una task bloqueada restante. Un goal bloqueado a mano con `goal block` no se libera con retry (hace falta `goal resume`); un goal `paused` sigue en pausa. Cualquier otro estado de task se rechaza.
- `pota-memory`: explora domain knowledge y actualiza `MEMORY.md`.
- `pota-plan`: crea un decision-complete plan bajo `docs/plan/`.
- `pota-work`: ejecuta el siguiente module task del `PLAN.md` actual con dos verification gates.
- `pota-review`: revisa completed tasks contra plan, memory y evidence.
- `dag`: solo abre el [panel DAG](#dag-panel); nunca planifica, edita ni cambia el goal state.

Pota escribe solo bajo `POTA_HOME` (por defecto `~/.pota`) y nunca dentro de su copia del plugin. Codex liga la aprobación de los hooks al contenido del plugin, así que una copia que se modificara a sí misma perdería su aprobación. Los archivos de plugin del host solo los instalan, actualizan y eliminan los propios comandos de plugin del host.

## Pota Home And Settings

Pota guarda sus datos bajo `POTA_HOME` (por defecto `~/.pota`), compartido por las copias del plugin de todos los hosts.

```text
~/.pota/
  projects/                 goal state
  config.json               user settings ("commentChecker", "modelCeiling")
  tools/comment-checker/    binario de comment-checker (release fijada)
  migration/                informes y estado de la eliminación de la instalación 1.x
  hosts/antigravity/        archivos de sesión de Antigravity (mensajes de hooks a la espera del siguiente prompt)
  hosts/antigravity-dag/    workspaces.json: workspaces activos recientemente para la MCP App del DAG (Antigravity y Codex)
  install/, update/         restos de la instalación npm 1.x hasta que termine su eliminación
```

- Ajustes de 1.x: `"autoUpgrade"` en `config.json` se ignora; Pota ya no se actualiza a sí mismo.
- Comprobación de comentarios: tras una edición correcta (Claude Code `Write`/`Edit`/`MultiEdit`, Codex `apply_patch` y herramientas de edición), el hook PostToolUse ejecuta [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker) (MIT) sobre el texto cambiado y, si informa de comentarios innecesarios, devuelve `decision: "block"` para que el agente los elimine o explique por qué son necesarios. No se añade ninguna dependencia de npm: el inicio de sesión de un hook del host descarga en un proceso separado la release fijada v0.8.2 para la plataforma actual (darwin/linux x64 y arm64, windows x64), verifica su SHA256 fijado y la extrae con el `tar` del sistema en `~/.pota/tools/comment-checker/`. Una descarga fallida se reintenta en un inicio de sesión posterior con backoff. Hasta que la descarga funcione, las ediciones pasan sin comprobar; un error del comprobador o una comprobación de más de 7 segundos también pasan. `pota doctor` muestra su estado en una línea, y `POTA_COMMENT_CHECKER=0` (también `false`, `off` o `no`) o `"commentChecker": false` en `~/.pota/config.json` desactivan tanto la comprobación como la descarga.
- Comprobación del main model: cuando el main model de la sesión está por debajo del tier stronger, `SessionStart` añade una línea `Pota main model:` y un aviso único. La planificación/triaje y la revisión final deben entonces delegarse al tier stronger o superior y registrarse (la revisión con `goal assign … --kind review`); sin ese registro se rechazan la finalización de `triage-plan` y `goal finish`, salvo con `--allow-main-model <reason>`. Un valor de model ausente o no reconocido nunca la activa. Se desactiva con `POTA_MAIN_MODEL_GATE=0`.
- Model ceiling: cuando la cuenta no puede o no debe usar los tiers superiores (suscripción, política de la organización, usage credits), define `POTA_MODEL_CEILING=stronger` (o `balanced`; también vale un nombre de model como `opus` o `sonnet`) o `"modelCeiling": "stronger"` en `~/.pota/config.json`. La variable de entorno tiene prioridad, y `config.json` es el único lugar que leen por igual todos los hooks y llamadas de la CLI. `SessionStart` añade entonces una línea `Pota model ceiling:`, los tiers por encima del ceiling usan el model del tier del ceiling, la puerta de diseño Heavy acepta ese model y la comprobación del main model usa el tier stronger limitado. Sin configuración nada cambia; un valor no válido no aplica ningún ceiling y se notifica.
- Request brief y steering: un plan de Light o Heavy Path lleva un `## Request Brief` (solicitud original, resultado interpretado, alcance, registros previos (`Prior records`, con `pota plan steering`), supuestos, requisitos implícitos, preguntas abiertas, registro de steering), y completar `triage-plan` se rechaza hasta que esté relleno, salvo que se pase `--allow-no-request-brief <reason>`. Las correcciones, adiciones y redirecciones del usuario se registran con `goal steer --kind <correction|addition|redirect> --reason <text>`, o con `goal replan --steer <correction|addition|redirect|none> --reason <text>` cuando cambian las tasks; el segundo steering o un redirect también exige reescribir `Current request (as of S<n>)`.
- Claim receipt: cuando el Stop gate bloquea (o el loop guard deja pasar una parada) mientras el goal sigue activo, y la última respuesta afirma haber terminado o que las comprobaciones pasan, el hook añade una frase que nombra esa afirmación para que el agent la corrija ante el usuario o registre la evidencia. Nunca cambia la decisión de parada, ignora bloques de código, código en línea y líneas citadas, y lee solo el campo `last_assistant_message` del host (Claude Code; Codex según su documentación; Antigravity no lo pasa). Con `POTA_CLAIM_RECEIPT=0` se desactiva.
- Memory paths: una nota de `docs/memory` puede llevar `Paths: <prefijos de ruta relativos al repositorio o globs, separados por comas>` bajo su línea `Summary:` (máximo 8 entradas; `*` coincide con un segmento de ruta, `**` con varios). Tras una edición correcta, el hook PostToolUse nombra hasta 3 notas cuyas rutas coinciden con el archivo editado, una vez por nota y sesión; el resto se nombra en ediciones posteriores. `pota memory check` informa de las entradas no válidas como `paths-invalid`.
- Heavy plan review: en el Heavy Path la task `heavy-design` también exige evidencia `planReview`. Un reviewer de solo lectura distinto, en el tier más fuerte, aprueba por defecto y rechaza solo por blockers confirmados con archivos del repositorio; una nueva revisión y después un blocker.
- Escalation y learnings: un worker que no puede terminar en su tier empieza su informe final con `ESCALATE: <reason>` y el orchestrator vuelve a hacer dispatch un tier más arriba (se detiene en el model ceiling). Los workers terminan sus informes con `LEARNINGS:`; el orchestrator los añade a `## Learnings` del plan, los pasa a las tasks posteriores y los usa para decidir la promoción a memoria.

## DAG Panel

Todos los hosts muestran el goal actual de Pota como un panel DAG con una columna por wave. Claude Code lo dibuja con su propio panel mod; desde 2.3.0, Antigravity y Codex / ChatGPT Desktop muestran el mismo panel como una MCP App servida por el servidor MCP local `pota-dag` del plugin. El panel tiene las mismas partes en los tres hosts:

- Cuatro pestañas: DAG (el grafo de waves, con las vistas anterior, actual, siguiente y todo; todo es la predeterminada), Diff, Plan y Agents & Stats.
- Diff lista los archivos modificados del working tree con el número de líneas añadidas y eliminadas. Ejecuta comandos Git de solo lectura y nunca muestra el contenido de los archivos; las rutas que parecen secretos (`.env*`, `service-account*.json`, archivos de claves y certificados, y similares) se marcan como sensibles y no se enlazan.
- Plan muestra un resumen del plan activo: título, goal, solicitud actual y progreso de la checklist.
- Agents & Stats muestra el agent, el model y el effort registrados para cada task y los goals recientes del repositorio. En Antigravity, las transcripciones de la sesión añaden el model real, el effort y los recuentos de tokens.
- Al seleccionar cualquier nodo se abre un inspector con los evidence receipts de la task y el diff stat de su `writeScope`.
- Los controles pausan y reanudan el goal y activan o desactivan el gate de aprobación manual de una task (ver `pota goal gate` en [Commands](#commands)).
- El inspector de una task bloqueada (`blocked`) tiene un botón Retry: ejecuta `goal retry --task <id>` (MCP App: la acción `retry_task` de `pota_dag_action`, solo para la app), que devuelve la task a `pending` y borra sus receipts. El panel nunca lanza un worker; el orchestrator hace dispatch de la task reintentada a un worker nuevo y vuelve a registrar `goal assign`.

### Claude Code (mod)

Requiere un Claude Code con soporte de mods (escrito para la API de mods de Claude Code 2.1.325). En una surface sin gráficos, como la terminal, muestra una lista de texto.

- `/dag [previous|current|next|all|dag|diff|plan|stats|refresh|close]` abre el panel en esa vista o pestaña. Un enlace terminado es una línea continua; uno en curso es una línea discontinua con un punto que se mueve.
- Se abre una vez automáticamente después de `pota goal start` y `pota goal replan`. Si lo cierras, no se vuelve a abrir para el mismo goal.
- Vuelve a leer el estado del goal cuando se ejecuta un comando de goal y cada 30 segundos.
- Al seleccionar una task en ejecución se abre la conversación del subagent que trabaja en ella. Una task que la sesión principal hace por sí misma, y toda task en una surface sin vista principal que cambiar (la app de escritorio), abre en su lugar el inspector dentro del panel.

### Antigravity and Codex / ChatGPT Desktop (MCP App)

- El plugin registra el servidor `pota-dag` (Antigravity: `mcp_config.json` de la raíz; Codex / ChatGPT Desktop: `.codex-plugin/mcp.json`), que ejecuta `scripts/pota-dag-mcp.mjs` sobre stdio sin dependencias.
- El agente llama a la herramienta `open_pota_dag` justo después de `goal start` y cuando reanuda un goal activo. Para abrir el panel tú mismo, usa la skill `dag`: `/dag` en Antigravity, `$dag` en Codex (un plugin de Codex no puede registrar un slash command). Antigravity también ofrece el panel como una entrada de la barra lateral y como un panel auxiliar.
- `open_pota_dag` devuelve al model solo un resumen pequeño; el panel carga sus datos por sí mismo. Los controles de pausa, reanudación y gate solo funcionan en los workspaces que los hooks de Pota han registrado como activos recientemente (`~/.pota/hosts/antigravity-dag/workspaces.json`).
- El inspector puede enviar a la conversación un mensaje de seguimiento que pide al agente revisar una task.
- Si el servidor está caído en Antigravity, el agente ejecuta `node "<pluginRoot>/scripts/pota-dag-mcp.mjs" ensure` y reintenta una vez; un panel no disponible nunca bloquea el trabajo.

## Antigravity Compatibility

Pota admite la CLI de Antigravity (`agy`); el IDE de Antigravity no está admitido. El manifest del plugin es el `plugin.json` de la raíz y sus hooks son el `hooks.json` de la raíz, que ejecuta `scripts/pota-state-antigravity.mjs` desde la carpeta del plugin. Ese adaptador asigna los eventos de Antigravity a los hooks de Pota:

- `SessionStart` añade la cápsula de sesión y la línea `Pota CLI:`.
- Antigravity no tiene evento de prompt, así que el primer `PreInvocation` de cada prompt añade el contexto del prompt.
- `PostToolUse` sobre `write_to_file`, `replace_file_content` y `multi_replace_file_content` ejecuta el comment checker y el recordatorio del goal; su resultado se añade en el siguiente `PreInvocation`.
- `Stop` mantiene al agente trabajando mientras el goal activo tenga una task sin terminar. No hay `SubagentStop`.

Las skills se llaman con `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` y `/dag`; los workflows no forman parte de los plugins de Antigravity. El `mcp_config.json` de la raíz registra el servidor MCP `pota-dag` para el [panel DAG](#dag-panel). El adaptador sigue la documentación de hooks de Antigravity; su comportamiento dentro de una sesión real de `agy` todavía no se ha verificado.

## Locale Policy

Las instrucciones reutilizables de Pota están escritas en inglés para uso global. El output visible para el usuario y la documentation, los plans y los memory artifacts generados o actualizados deben seguir el OS locale configurado, salvo que el usuario pida otro idioma explícitamente. Esto incluye el contenido de `MEMORY.md`, `PLAN.md`, `docs/memory` y `docs/plan`. La CLI localiza mensajes comunes para `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de` y `pt`, y vuelve a English para locales no soportados. El texto `statusMessage` de Codex hooks permanece en inglés estático, mientras que hook command output es English o Korean.

## Delegation

- `explorer`: maneja read-only codebase discovery, impact analysis, pattern searches y read-only verification cuando está disponible.
- `worker`: maneja bounded implementation o verification tasks con file ownership claro.
- Main session: mantiene local el urgent blocking work cuando el siguiente paso depende inmediatamente del resultado.

Cada delegation prompt usa seis secciones: TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
