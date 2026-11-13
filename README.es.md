# Pota

Pota es un plugin de harness multi-agente eficiente en tokens para Codex, Claude Code y Antigravity.

[English](README.md)

La idea central es conservar comportamientos útiles de agent harness: hooks, estado persistente, planificación explícita, delegación enfocada y guardas al detenerse. Pota no hace que los bucles repetidos de verificación TDD sean el comportamiento predeterminado. En su lugar, divide el trabajo en pequeños module tasks y prueba cada task con dos verification gates.

1. Module acceptance verification: prueba el contrato del módulo modificado.
2. Surface integration verification: prueba el comportamiento a través de una superficie real, como CLI, HTTP, navegador o artefactos de archivo.

Antes de que un task modifique estado externo, Pota registra y ejecuta el dry-run o check mode más cercano disponible. La verificación está acotada: cada task tiene dos verification passes por defecto; después, el agente registra un blocker o divide el task en lugar de continuar un bucle abierto.

Pota también trata la preparación de herramientas como parte del trabajo. LSP, typecheck, lint, dry-run y verification tools se revisan contra el stack del repositorio. Solo se instala con aprobación explícita y un installer compatible y fijado; de lo contrario se registra un blocker.

## Complexity Triage

Cada implementation task pasa primero por complexity triage, antes de aplicar agent, plugin o delegated workflow guidance. El triage se decide a partir de la exploración del repositorio, el alcance esperado del cambio y señales de riesgo, sin preguntar al usuario por hechos que se puedan descubrir.

- Light Path: cambios estrechos dentro de existing architecture layers. Es el valor predeterminado. Implementa directamente o usa un `worker` acotado, y conserva el verification gate.
- Heavy Path: new directory/module/layer, new domain model/service/abstraction, security/session/auth, external API/message queue/payment, DB schema/migration, concurrency/transaction/cache changes, cross-domain refactor o una explicit extra-care request.

El path seleccionado y su justificación se registran en `docs/plan/<topic>.md` cuando existe un plan artifact. Incluso en Light Path, se mantienen los dos verification gates.

## Tool Readiness

`pota toolcheck` inspecciona el repositorio actual para stacks JavaScript, TypeScript, Python, PHP, Java, Kotlin, Swift, Go y Rust, y luego revisa los LSP y verification tools correspondientes.

```sh
pota toolcheck --root .
pota toolcheck --install --yes --root .
```

- `toolcheck` reporta detected stacks y missing tools.
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
- `docs/memory/*.md`: conocimiento detallado por dominio. Cada nota empieza con una línea `Summary:` (120 caracteres como máximo) que muestran el índice y el hook.
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

El paquete publicado puede ejecutarse con `bunx` o con comandos `pota` instalados globalmente.

```sh
bunx @comento/pota-harness@latest install
bunx @comento/pota-harness@latest upgrade
bunx @comento/pota-harness@latest doctor
bunx @comento/pota-harness@latest uninstall
bunx @comento/pota-harness@latest toolcheck
```

Después de una instalación global, también están disponibles comandos cortos.

```sh
bun add -g @comento/pota-harness
pota install
pota upgrade
pota doctor
pota uninstall
pota toolcheck
pota auto-upgrade status
```

- `pota install [--hosts all|codex,claude,antigravity]`: instala de forma transaccional custom marketplace source, versioned runtime, secciones config propias de Pota y mirrors actuales. El canonical runtime vive en `~/.pota/install/` y el resto se instala solo para los hosts elegidos. Sin `--hosts`, la primera instalación en una terminal pregunta los hosts; las ejecuciones no interactivas y CI instalan todos.
- `pota upgrade [--hosts all|codex,claude,antigravity]`: reemplaza solo entradas sin modificar del ownership manifest tras staged validation y usa rollback al fallar. Mantiene los hosts registrados salvo que `--hosts` los cambie y actualiza un Claude Code plugin cache que aún tenga otra versión. Si la versión instalada es más nueva que esta CLI, `install` y `upgrade` se niegan sin cambiar nada; `--allow-downgrade` instala de todos modos la versión de esta CLI.
- `pota doctor`: valida ownership digests, features efectivos de Codex, el estado real del plugin y runtime locators sin reparar. Imprime primero `Hosts: <ids>` y solo revisa los hosts elegidos (incluido `Claude plugin cache version`).
- `pota uninstall`: primero compara cada entrada no config del ownership manifest con su installed digest y rechaza todo el uninstall, sin cambiar nada, si algún managed artifact fue modificado o eliminado. Si no, elimina o restaura las entradas gestionadas y los retained runtimes, limpia los managed scaffolds vacíos, preserva los objetivos unmanaged y sus directorios padre, y aplica rollback a los fallos anteriores al commit. También elimina `~/.pota/update/`, y conserva `~/.pota/config.json` y `~/.pota/projects/`. Una instalación con layout legacy se elimina en su sitio sin migrarla.
- `pota auto-upgrade status|on|off|run`: `status` imprime en JSON la configuración, la versión instalada, la última comprobación y el aviso pendiente; `on`/`off` escriben `autoUpgrade` en `~/.pota/config.json` e imprimen el mismo informe; `run` consulta npm ahora, sin esperar el intervalo de 24 horas ni el backoff. Exit 0 es éxito, 1 un error de ejecución o una ejecución fallida y 2 un error de uso.
- `pota toolcheck`: detecta repository stacks y revisa required tools; solo ejecuta un installer compatible aprobado, o devuelve `installer-unavailable`.
- `pota cleanup --root <repo>`: por defecto informa en modo read-only el residuo legacy `.pota` local al proyecto. `--yes` migra/reconcilia active state válido al almacén user-home, elimina solo residuos conocidos de state/lock/tool, conserva archivos desconocidos y poda el directorio solo si queda vacío.
- `pota memory check|index [--root <repo>]`: `check` compara `MEMORY.md` con `docs/memory/*.md` e imprime un informe JSON; sale con 1 ante notas sin indexar, dead links, duplicados, resúmenes desactualizados, caracteres de control en resúmenes o rutas inseguras, y los warnings solo fallan con `--strict`. Las entradas son líneas de lista bajo `## Domain Knowledge` (o todas las líneas de lista en un archivo antiguo sin esa sección); un enlace a una nota en otra sección es una mención que `index` nunca reescribe. `index` añade las notas que faltan y, si el `Summary:` cambió, reemplaza solo el resumen tras el enlace (una línea con varios enlaces queda como está); solo elimina líneas placeholder de Pota que coinciden exactamente dentro de esa sección, nunca borra entradas ni dead links y conserva el resto byte a byte. `--dry-run` muestra una vista previa. Si el punto de inserción está dentro de un bloque de código sin cerrar, `index` no escribe nada y sale con 1 con `unclosed-fence`. Los errores de uso salen con 2; `pota memory` sin subcomando sigue mostrando la guía.
- `pota plan check|index [--archive] [--root <repo>]`: lo mismo para `PLAN.md` y `docs/plan/*.md`, cuyas entradas son líneas de lista bajo encabezados `## ` que terminan en `Plans` (como `## Superseded Plans`). `index` coloca un plan con todas sus casillas marcadas al principio de `## Completed Plans` y cualquier otro en `## Active Plans`; solo `--archive` mueve líneas a `docs/plan/ARCHIVE.md`: las entradas completadas más allá de las 20 más nuevas, con sus párrafos sangrados, y el cuerpo de una sección legacy `## Planning Rules`. `check` avisa cuando `## Completed Plans` supera 20 entradas o queda una sección legacy `## Planning Rules`.
- `pota goal ...`: gestiona el goal del repositorio (`pota goal --help`). `goal stats --history [--limit N]` agrega los goals terminados del repositorio en todos sus worktrees: recuentos completed/cancelled, mediana y p90 de duración, medianas de tasks y receipts, tasa de reruns, decisiones de memory promotion, un `trend` older/newer desde 4 goals completados y los goals recientes; sin historial imprime `{"schemaVersion":1,"scope":"repository","goals":0}`. `completionCriteria` (`goal start --criteria`) es `advisory`: Pota lo registra pero no lo hace cumplir, y la finalización depende solo de la evidencia requerida.
- `pota-memory`: explora domain knowledge y actualiza `MEMORY.md`.
- `pota-plan`: crea un decision-complete plan bajo `docs/plan/`.
- `pota-work`: ejecuta el siguiente module task del `PLAN.md` actual con dos verification gates.
- `pota-review`: revisa completed tasks contra plan, memory y evidence.

El custom marketplace lifecycle mantiene separados source y versioned runtime. Staged validation precede cada commit, el ownership manifest vincula todos los managed digests y un fallo aplica reverse-order rollback. Los artifacts modified o unmanaged se preservan y se reportan como conflict. Pota modifica solo sus propias TOML sections y no fuerza feature/agent settings públicos.

Clean uninstall elimina `~/.pota/install/` y el Codex cache root `$CODEX_HOME/plugins/cache/pota` solo cuando todos los managed scaffold directories están vacíos; cualquier contenido unmanaged se conserva. No elimina el source repository, los `MEMORY.md`/`PLAN.md` del repository ni el Pota goal state de user-home, el paquete global `@comento/pota-harness`, los package-manager caches ni legacy backups/settings fuera del ownership manifest actual.

Codex usa `skills/` y `commands/`. Claude Code usa comandos reflejados y definiciones de agentes bajo `.claude/`. Antigravity usa `.agents/workflows` y mirrors globales de skills.

## Install Layout And Auto-Upgrade

Pota guarda la instalación bajo `POTA_HOME` (por defecto `~/.pota`). Las rutas de cada host siguen definiéndose por separado con `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME` y `CODEX_CONFIG_PATH`.

```text
~/.pota/
  install/                  archivos gestionados por el lifecycle
    lifecycle.json          ownership manifest (schema 2: hosts, origin, retained runtimes)
    lifecycle.lock, transaction.json, transactions/
    runtime/<version>/      canonical runtime que usan todos los runtime locators y los hooks de Claude Code
    codex/                  Codex local marketplace source
    claude/                 Claude Code local marketplace
  projects/                 goal state
  config.json               ajustes del usuario ("autoUpgrade")
  update/                   estado de auto-upgrade
$CODEX_HOME/plugins/cache/pota/pota/<version>/   copia en el Codex plugin cache (solo si se elige Codex)
```

- Hosts: solo `install` y `upgrade` aceptan `--hosts`, con `all` o una lista separada por comas de `codex`, `claude` y `antigravity`. La selección queda en el ownership manifest y `upgrade`, `doctor` y `uninstall` la siguen. Se cambia con `pota upgrade --hosts <list>`; si un archivo gestionado de un host retirado fue modificado, se rechaza. El prompt interactivo (todos por defecto, solo Claude Code, solo Codex, solo Antigravity o una lista) aparece solo cuando aún no hay nada instalado.
- Retención: un upgrade que cambia de versión conserva el canonical runtime anterior y la copia del Codex cache durante 3 días (como máximo 3 de cada tipo) para que las sesiones iniciadas antes sigan funcionando. El siguiente install o upgrade elimina las vencidas y uninstall las elimina todas. Nunca se conserva una copia del Codex cache igual o superior a la nueva versión, porque Codex carga la versión más alta del cache.
- Claude Code plugin cache: si aún tiene otra versión, `pota upgrade` lo actualiza con `claude plugin marketplace update pota` y `claude plugin update pota@pota --scope user`. Si falla, la instalación actualizada se mantiene, se imprimen los comandos para terminar a mano y sale con exit 1.
- Auto-upgrade: activado por defecto. Como máximo una vez cada 24 horas (y no en las 24 horas siguientes a un install o upgrade), `SessionStart` lanza un proceso separado que lee la última versión de `@comento/pota-harness` en npm, instala esa versión exacta con `--ignore-scripts` en `~/.pota/update/stage/`, la verifica y ejecuta su `pota-lifecycle.mjs upgrade --auto`. Aplica todas las versiones nuevas, incluidas las major, y nunca hace downgrade. El siguiente `SessionStart` muestra el resultado (`updated`, `failed` o `manual`) en una línea, una sola vez. No funciona en instalaciones desde un git checkout (`origin: "checkout"`) ni al ejecutar desde un source checkout.
- Desactivar: `pota auto-upgrade off`, `POTA_AUTO_UPGRADE=0` (también `false`, `off` o `no`) o `"autoUpgrade": false` en `~/.pota/config.json`. Un `config.json` ilegible también lo desactiva. El estado y el log de la última ejecución están en `~/.pota/update/`.

## Antigravity Compatibility

Antigravity soporta Agent Skills y Workflows basados en `SKILL.md` invocados como `/workflow-name`. Pota instala estas rutas para esa superficie.

- Antigravity IDE: `~/.gemini/config/skills/pota-*/SKILL.md`.
- Antigravity CLI: archivos skill planos en `~/.gemini/antigravity-cli/skills/pota-*.md`.

Los hooks exclusivos de Codex no se portan a Antigravity. En su lugar, los mismos procedimientos de planning, memory, complexity triage y two-gate verification se ejecutan mediante Skills y Workflows. Define `ANTIGRAVITY_HOME` o `ANTIGRAVITY_CLI_HOME` para sobrescribir las rutas.

## Locale Policy

Las instrucciones reutilizables de Pota están escritas en inglés para uso global. El output visible para el usuario y la documentation, los plans y los memory artifacts generados o actualizados deben seguir el OS locale configurado, salvo que el usuario pida otro idioma explícitamente. Esto incluye el contenido de `MEMORY.md`, `PLAN.md`, `docs/memory` y `docs/plan`. La CLI localiza mensajes comunes para `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de` y `pt`, y vuelve a English para locales no soportados. El texto `statusMessage` de Codex hooks permanece en inglés estático, mientras que hook command output es English o Korean.

## Delegation

- `explorer`: maneja read-only codebase discovery, impact analysis, pattern searches y read-only verification cuando está disponible.
- `worker`: maneja bounded implementation o verification tasks con file ownership claro.
- Main session: mantiene local el urgent blocking work cuando el siguiente paso depende inmediatamente del resultado.

Cada delegation prompt usa seis secciones: TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
