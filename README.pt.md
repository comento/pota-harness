# Pota Harness

Pota Harness e um plugin de harness multiagente eficiente em tokens para Codex, Claude Code e Antigravity.

[English](README.md)

A ideia central e manter comportamentos uteis de agent harness: hooks, estado persistente, planejamento explicito, delegacao focada e guardas no momento de parada. Pota nao torna loops repetidos de verificacao TDD o padrao. Em vez disso, divide o trabalho em pequenos module tasks e prova cada task com dois verification gates.

1. Module acceptance verification: prova o contrato do modulo alterado.
2. Surface integration verification: prova o comportamento por uma superficie real, como CLI, HTTP, navegador ou artefatos de arquivo.

Antes que um task altere estado externo, Pota registra e executa o dry-run ou check mode mais proximo disponivel. A verificacao e limitada: cada task recebe duas verification passes por padrao; depois, o agente registra um blocker ou divide o task em vez de continuar um loop aberto.

Pota tambem trata tool readiness como parte do trabalho. LSP, typecheck, lint, dry-run e verification tools sao verificados contra o stack do repositorio. A instalacao ocorre apenas com aprovacao explicita e um installer suportado e fixado; caso contrario, um blocker e informado.

## Install

Pota é um plugin para Claude Code, Codex e a CLI do Antigravity. A raiz deste repositório é o plugin, e o branch `main` é a versão publicada. Cada host instala, atualiza e remove a sua própria cópia com os seus próprios comandos de plugin, e essa cópia é o runtime do host: hooks, skills e a CLI rodam a partir dela. Cópias em hosts diferentes podem ter versões diferentes; o Pota não as compara. O goal state em `~/.pota/projects/` é compartilhado por todos os hosts.

### Claude Code

```sh
claude plugin marketplace add comento/pota-harness
claude plugin install pota@pota-harness
```

Dentro de uma sessão, os mesmos passos são `/plugin marketplace add comento/pota-harness` e `/plugin install pota@pota-harness`. Por padrão, o Claude Code não atualiza automaticamente marketplaces de terceiros; atualize manualmente e reinicie a sessão:

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

Depois, na TUI do Codex:

1. Abra `/plugins`, escolha o marketplace `pota-harness`, instale `pota` e inicie uma nova sessão.
2. Abra `/hooks` e aprove os cinco hooks do Pota. O Codex não executa hooks de plugins antes da aprovação, e a aprovação fica vinculada ao conteúdo dos hooks; por isso aprove-os de novo em `/hooks` após cada atualização. Sem aprovação nenhuma sessão recebe a linha `Pota CLI:`, e as skills do Pota avisam que os hooks do Pota estão inativos.

Para atualizar, rode `codex plugin marketplace upgrade pota-harness` e aprove os hooks de novo em `/hooks`. Para desinstalar, abra o plugin em `/plugins` e escolha "Uninstall plugin". Estes passos do Codex seguem a documentação e o código-fonte do Codex; ainda não foram executados numa instalação real do Codex.

### Antigravity CLI

```sh
agy plugin install https://github.com/comento/pota-harness
```

Para atualizar, rode o mesmo comando de novo; a documentação do Antigravity diz que reinstalar substitui a cópia instalada. Para desinstalar, `agy plugin uninstall pota`. Recomenda-se `agy` 1.5.6 ou mais recente. Só a CLI do Antigravity é suportada; o IDE do Antigravity não.

### What each host gets

| | Claude Code | Codex | Antigravity CLI |
| --- | --- | --- | --- |
| Skills | `/pota:pota-plan`, `/pota:pota-work`, `/pota:pota-review`, `/pota:pota-memory` | `$pota-plan`, `$pota-work`, `$pota-review`, `$pota-memory` | `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` |
| Hooks | SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop | os mesmos cinco, após aprovação em `/hooks` | SessionStart, PreInvocation (contexto do prompt), PostToolUse, Stop; sem SubagentStop |
| Agents `explorer`, `worker` | sim | não | não |
| Painel DAG (mod) | sim | não | não |

### Coming from the npm install (1.x)

O Pota 2.x não é publicado no npm e não tem comando global `pota`. O pacote npm `@comento/pota-harness` termina na 1.5.0, que só mostra estas instruções de instalação, e o pacote está marcado como deprecated.

1. Só Claude Code: remova primeiro o plugin 1.x com `claude plugin uninstall pota@pota --scope user`.
2. Instale o plugin em todos os hosts que você usa. A remoção abaixo acontece host a host, então um host sem o plugin continua usando a instalação 1.x até você instalar o plugin nele.
3. Inicie uma sessão. Quando o início de sessão do plugin encontra o ownership manifest da 1.x (`~/.pota/install/lifecycle.json`), ele remove a parte desse host da instalação 1.x num processo em segundo plano e avisa; reinicie a sessão uma vez. A sessão seguinte informa o resultado uma vez. O runtime 1.x compartilhado, `~/.pota/update/` e o manifest só são removidos quando não resta a parte de nenhum host.

A remoção apaga só arquivos e diretórios que o manifest 1.x registra e cujo digest não mudou, além das seções próprias do Pota no `config.toml` do Codex. Ela mantém `~/.pota/projects/` (goal state), `~/.pota/config.json`, `~/.pota/tools/comment-checker/`, cada arquivo que você alterou (informado como mantido), tudo o que o manifest não registra e o pacote npm global (remova-o com `npm uninstall -g @comento/pota-harness`). Ela recusa, não remove nada desse host e informa o motivo quando:

- um diretório em um dos caminhos do host é um symlink (`symlinked-path`; remova manualmente os caminhos indicados);
- o registro do host não pode ser removido com segurança (`host-unregister-failed`): a CLI `claude` falta ou falha, ou o `config.toml` do Codex tem seções do Pota que não podem ser identificadas com segurança ou cuja reescrita mudaria outras seções;
- o manifest é inválido, tem um schema não suportado, aponta para fora dos caminhos esperados, ou uma transação de instalação 1.x foi interrompida (`manifest-invalid`, `manifest-unsupported-schema`, `target-outside-allowlist`, `transaction-pending`). Se você instalou a 1.x com `CODEX_HOME`, `CLAUDE_HOME`, `ANTIGRAVITY_HOME`, `ANTIGRAVITY_CLI_HOME` ou `CODEX_CONFIG_PATH`, defina os mesmos valores para o host. Caso contrário, rode `npx @comento/pota-harness@1.5.0 uninstall` e reinicie.

Uma remoção recusada é tentada de novo após 24 horas e avisada no máximo uma vez a cada 7 dias. Uma instalação anterior à 1.3 não tem ownership manifest e nunca é tocada; remova-a com `npx @comento/pota-harness@1.5.0 uninstall` antes de instalar o plugin. Para ver o estado ou rodar a remoção você mesmo (`<pluginRoot>` é explicado abaixo):

```sh
node "<pluginRoot>/scripts/pota.mjs" doctor
node "<pluginRoot>/scripts/pota.mjs" migrate status
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude --dry-run
node "<pluginRoot>/scripts/pota.mjs" migrate run --host claude
```

`POTA_LEGACY_MIGRATION=0` (ou `false`, `off`, `no`) desliga a remoção automática. Os nomes da 1.x correspondem na 2.x a:

| 1.x | 2.x |
| --- | --- |
| `/pota-plan`, `/pota-work`, `/pota-review`, `/pota-memory` | os nomes de skill de cada host na tabela acima |
| `/pota-toolcheck` | pedir ao agente que rode `pota toolcheck` |
| `/pota-doctor` | `pota doctor` |
| os comandos `install`, `upgrade` e `uninstall` da CLI e as atualizações automáticas | os comandos de plugin do host acima; a CLI agora mostra uma indicação para esta seção e termina com exit 2 |

### Running the Pota CLI

Cada início de sessão imprime uma linha `Pota CLI:` com o caminho absoluto de `scripts/pota.mjs` na cópia do plugin desse host, e o agente roda os comandos do Pota com esse caminho. `<pluginRoot>` é o diretório pai desse `scripts`; o caminho muda quando o host instala uma nova versão. Neste README, `pota <command>` significa `node "<pluginRoot>/scripts/pota.mjs" <command>`.

## Complexity Triage

Cada implementation task passa primeiro por complexity triage, antes de aplicar agent, plugin ou delegated workflow guidance. O triage e decidido a partir da exploracao do repositorio, do escopo esperado da mudanca e de sinais de risco, sem perguntar ao usuario por fatos descobriveis.

- Light Path: mudancas estreitas dentro de existing architecture layers. E o padrao. Implemente diretamente ou use um `worker` limitado, depois mantenha o verification gate.
- Heavy Path: new directory/module/layer, new domain model/service/abstraction, security/session/auth, external API/message queue/payment, DB schema/migration, concurrency/transaction/cache changes, cross-domain refactor ou explicit extra-care request.

O path escolhido e sua justificativa sao registrados em `docs/plan/<topic>.md` quando houver um plan artifact. Mesmo no Light Path, os dois verification gates permanecem.

## Tool Readiness

`pota toolcheck` inspeciona o repositorio atual para stacks JavaScript, TypeScript, Python, PHP, Java, Kotlin, Swift, Go e Rust, depois verifica os LSP e verification tools correspondentes.

```sh
pota toolcheck --root .
pota toolcheck --install --yes --root .
```

- `toolcheck` informa detected stacks e missing tools. Para cada missing tool ele imprime um comando de instalacao sugerido ou o motivo pelo qual a instalacao automatica nao esta disponivel, e o agent pergunta uma unica vez se deve instalar; se for recusado, ou a execucao nao for interativa, registra um blocker.
- `toolcheck --install` exige aprovacao explicita e `--yes`; um installer sem suporte retorna o resultado canonico `installer-unavailable` sem ser executado.
- Os planos Pota registram detected stack, required tools, install commands e blockers.
- Um LSP server ausente nao e motivo valido para pular precise codebase exploration antes de tentar installation ou um fallback symbol-aware equivalente.

## Dry-Run And Loop Policy

- Migrations e database changes usam `--pretend`, dry-run, schema diff, rollback feasibility checks ou o equivalente repository-native mais proximo antes de write/apply commands.
- Package, release, infrastructure, deployment, code generation e formatting work usam check, plan, diff, validate ou dry-run modes antes de alterar estado quando disponiveis.
- Se nao houver dry-run, o plan registra esse fato e escolhe o menor command reversivel ou test artifact disponivel.
- Se um verification gate falhar, Pota diagnostica uma vez, reduz ou divide o task e executa novamente os dois gates.
- Depois de duas verification passes falhas para o mesmo task, Pota registra o blocker em `docs/plan/<topic>.md` em vez de continuar um loop repetido.

## Model Guidance

Pota aplica model-specific adjustment apenas a modelos Claude-family e Codex-family.

- Claude-family: util para long context, policy interpretation e plan/evidence review.
- Codex-family: util para small implementation tasks, explicit file edits, command-based verification e bounded `worker` tasks.

A orientação detalhada fica no plugin instalado em `pota://docs/model-guidance/README.md`, `pota://docs/model-guidance/claude.md` e `pota://docs/model-guidance/codex.md`.

## Repository Artifacts

O harness cria e mantem estes arquivos na raiz do repositorio alvo.

- `MEMORY.md`: indice curto de persistent domain knowledge: uma linha por nota em `## Domain Knowledge` (`- [<name>](docs/memory/<name>.md): <summary>`) mais a `## Policy` do repositorio.
- `docs/memory/*.md`: conhecimento detalhado por dominio. Cada nota comeca com uma linha `Summary:` (no maximo 120 caracteres) que o indice e o hook exibem.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/state.json`: active goal/task/evidence state no user-home, isolado por projeto e worktree, para retomada e scoped stop gates. O working tree nao possui runtime state.
- `PLAN.md`: indice curto de planos de trabalho: uma linha de ate 200 caracteres por plano em `## Active Plans` e `## Completed Plans`. As regras de planejamento ficam no skill `pota-plan`, nao em `PLAN.md`.
- `docs/plan/*.md`: detailed execution plans.
- `docs/plan/ARCHIVE.md`: entradas concluidas antigas movidas de `PLAN.md` por `pota plan index --archive`, da mais nova para a mais antiga, mais o corpo de uma secao legacy `## Planning Rules` sob `## Legacy Planning Rules`. Linhas de lista antes do seu primeiro titulo `## ` continuam contando como indexadas.
- `~/.pota/projects/<project-id>/worktrees/<worktree-id>/history.jsonl`: um registro resumido por goal concluido ou cancelado (os 200 mais recentes por worktree) para `goal stats --history`.

Mantenha `## Completed Plans` da mais nova para a mais antiga. `pota plan index --archive` mantem as primeiras 20 entradas e move o restante para `docs/plan/ARCHIVE.md` sem apagar nada; uma lista mantida da mais antiga para a mais nova arquivaria os planos mais recentes. Confira antes com `--dry-run`. `MEMORY.md`/`PLAN.md` existentes funcionam sem migracao: `init` nunca os reescreve e `check` apenas avisa sobre o formato antigo com warnings.

No `SessionStart`, o hook informa ao agente quais notas de memoria existem (nome e `Summary:`, ou uma linha so com nomes quando a lista e longa) e, sem goal ativo, adiciona uma linha sobre o indice de planos: quantidade de planos, planos ativos, os ultimos planos concluidos e `docs/plan/ARCHIVE.md` quando existe. Com um goal active, paused, blocked ou de outra sessao, so a lista de memoria e adicionada, e a capsula de outra sessao nunca mostra nomes de planos. Um `UserPromptSubmit` sem goal adiciona uma frase com a quantidade de notas. O hook le apenas os arquivos de indice e listagens de diretorio, nunca o corpo das notas, e nao escreve nada; um repositorio sem notas nem planos recebe a mesma saida de antes.

Antes de `goal finish`, `pota-work` registra uma decisao de memory promotion por goal na Evidence do plano: `Memory promotion: docs/memory/<domain>.md` quando o goal gerou conhecimento reutilizavel do repositorio, ou `Memory promotion: none: <reason>` caso contrario. A decisao e obrigatoria; escrever uma nota e opcional. Quando um goal e concluido e o arquivo do plano nao tem uma linha `Memory promotion:` preenchida, `goal finish` e `goal complete` imprimem um lembrete de uma linha no stderr sem alterar o exit code nem o stdout.

Arquivos raiz ficam curtos e os detalhes vao para `docs/`, para que agentes leiam apenas o contexto necessario.

Para economizar tokens, crie primeiro um test contract com requisitos, invariantes, limites e modos de falha. Use o tool exit code de `goal verify -- <argv>` como autoridade, resuma o sucesso e expanda o contexto apenas em falhas. Inspecione o package lifecycle e execute normalmente `npm pack --dry-run`. Scripts content-producing ou desconhecidos nunca devem usar `--ignore-scripts`; use-o apenas quando os scripts estiverem ausentes ou comprovadamente content-neutral e a evidencia do full check continuar atual.

## Commands

Abaixo, `pota <command>` significa `node "<pluginRoot>/scripts/pota.mjs" <command>`, com o caminho da linha `Pota CLI:` do início de sessão (veja [Running the Pota CLI](#running-the-pota-cli)).

- `pota doctor [--json]`: diagnóstico somente leitura desta cópia do plugin e de `~/.pota`: versão, `pluginRoot`, Node.js (18 ou mais recente), se `POTA_HOME` aceita escrita, se as quatro superfícies de versão desta cópia coincidem, arquivos obrigatórios, a instalação 1.x (`none`, `present <version>` ou `blocked <reason>`), o último relatório de remoção por host com os caminhos mantidos e os comandos manuais, e o estado do comment-checker. Nunca compara as cópias de outros hosts. Exit 1 quando uma verificação falha, 2 para erro de uso.
- `pota migrate status|run [--host claude|codex|antigravity] [--all] [--dry-run] [--json]`: roda manualmente a remoção da instalação 1.x. `status` mostra o que uma execução faria e os últimos relatórios; `run` precisa de `--host <host>` ou `--all` (todos os hosts, inclusive os que ainda não têm o plugin), e `--dry-run` mostra o plano sem mudar nada. Exit 1 quando a remoção é recusada, 2 para erro de uso.
- `pota toolcheck`: detecta repository stacks e verifica required tools; apenas um installer suportado e aprovado e executado, caso contrario `installer-unavailable`.
- `pota cleanup --root <repo>`: por padrao relata em modo read-only residuos legacy `.pota` locais do projeto. `--yes` migra/reconcilia valid active state para o user-home store, remove apenas residuos conhecidos de state/lock/tool, preserva arquivos desconhecidos e remove o diretorio somente quando vazio.
- `pota memory check|index [--root <repo>]`: `check` compara `MEMORY.md` com `docs/memory/*.md` e imprime um relatorio JSON; sai com 1 para notas nao indexadas, dead links, duplicatas, resumos desatualizados, caracteres de controle em resumos ou caminhos inseguros, e warnings so falham com `--strict`. Entradas sao linhas de lista sob `## Domain Knowledge` (ou todas as linhas de lista num arquivo antigo sem essa secao); um link de nota em outra secao e uma mencao que `index` nunca reescreve. `index` adiciona notas ausentes e, quando o `Summary:` muda, troca so o resumo apos o link (uma linha com varios links fica como esta); remove apenas linhas placeholder do Pota que coincidem exatamente nessa secao, nunca apaga entradas nem dead links e preserva o restante byte a byte. `--dry-run` mostra uma previa. Se o ponto de insercao estiver dentro de um bloco de codigo nao fechado, `index` nao escreve nada e sai com 1 com `unclosed-fence`. Erros de uso saem com 2; `pota memory` sem subcomando continua imprimindo a orientacao.
- `pota plan check|index [--archive] [--root <repo>]`: o mesmo para `PLAN.md` e `docs/plan/*.md`, cujas entradas sao linhas de lista sob titulos `## ` que terminam em `Plans` (como `## Superseded Plans`). `index` coloca um plano com todas as caixas marcadas no topo de `## Completed Plans` e qualquer outro em `## Active Plans`; so `--archive` move linhas para `docs/plan/ARCHIVE.md`: entradas concluidas alem das 20 mais novas, com seus paragrafos recuados, e o corpo de uma secao legacy `## Planning Rules`. `check` avisa quando `## Completed Plans` passa de 20 entradas ou resta uma secao legacy `## Planning Rules`.
- `pota goal ...`: gerencia o goal do repositorio (`pota goal --help`). `goal stats --history [--limit N]` agrega os goals encerrados do repositorio em todos os worktrees: contagens completed/cancelled, mediana e p90 de duracao, medianas de tasks e receipts, taxa de reruns, decisoes de memory promotion, um `trend` older/newer a partir de 4 goals concluidos e os goals recentes; sem historico imprime `{"schemaVersion":1,"scope":"repository","goals":0}`. `completionCriteria` (`goal start --criteria`) e `advisory`: o Pota registra mas nao o impoe, e a conclusao depende apenas da evidencia exigida.
- `pota-memory`: explora domain knowledge e atualiza `MEMORY.md`.
- `pota-plan`: cria um decision-complete plan em `docs/plan/`.
- `pota-work`: executa o proximo module task no `PLAN.md` atual com dois verification gates.
- `pota-review`: revisa completed tasks contra plan, memory e evidence.

O Pota escreve só sob `POTA_HOME` (padrão `~/.pota`) e nunca dentro da sua cópia do plugin. O Codex vincula a aprovação dos hooks ao conteúdo do plugin, então uma cópia que se alterasse perderia a aprovação. Os arquivos de plugin de um host só são instalados, atualizados e removidos pelos próprios comandos de plugin do host.

## Pota Home And Settings

O Pota guarda os seus dados sob `POTA_HOME` (padrão `~/.pota`), compartilhado pelas cópias do plugin de todos os hosts.

```text
~/.pota/
  projects/                 goal state
  config.json               user settings ("commentChecker", "modelCeiling")
  tools/comment-checker/    binário do comment-checker (release fixada)
  migration/                relatórios e estado da remoção da instalação 1.x
  hosts/antigravity/        arquivos de sessão do Antigravity (mensagens de hooks esperando o próximo prompt)
  install/, update/         deixados pela instalação npm 1.x até a remoção terminar
```

- Configurações da 1.x: `"autoUpgrade"` em `config.json` é ignorado; o Pota não se atualiza mais sozinho.
- Verificação de comentários: após uma edição bem-sucedida (Claude Code `Write`/`Edit`/`MultiEdit`, Codex `apply_patch` e ferramentas de edição), o hook PostToolUse executa o [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker) (MIT) sobre o texto alterado e, quando ele aponta comentários desnecessários, devolve `decision: "block"` para que o agente os remova ou explique por que são necessários. Nenhuma dependência npm é adicionada: o início de sessão de um hook do host baixa, num processo separado, a release fixada v0.8.2 para a plataforma atual (darwin/linux x64 e arm64, windows x64), verifica o SHA256 fixado e a extrai com o `tar` do sistema em `~/.pota/tools/comment-checker/`. Um download que falhou é tentado de novo num início de sessão posterior, com backoff. Até um download dar certo, as edições passam sem verificação; um erro do verificador ou uma verificação acima de 7 segundos também passa. `pota doctor` mostra o estado numa linha, e `POTA_COMMENT_CHECKER=0` (ou `false`, `off`, `no`) ou `"commentChecker": false` em `~/.pota/config.json` desliga a verificação e o download.
- Verificação do main model: quando o main model da sessão está abaixo do tier stronger, `SessionStart` adiciona uma linha `Pota main model:` e um aviso único. O planejamento/triagem e a revisão final devem então ser delegados ao tier stronger ou superior e registrados (a revisão com `goal assign … --kind review`); sem esse registro, a conclusão de `triage-plan` e `goal finish` são recusados, salvo com `--allow-main-model <reason>`. Um valor de model ausente ou não reconhecido nunca a aciona. Desativa-se com `POTA_MAIN_MODEL_GATE=0`.
- Model ceiling: quando a conta não pode ou não deve usar os tiers superiores (assinatura, política da organização, usage credits), defina `POTA_MODEL_CEILING=stronger` (ou `balanced`; um nome de model como `opus` ou `sonnet` também serve) ou `"modelCeiling": "stronger"` em `~/.pota/config.json`. A variável de ambiente tem prioridade, e `config.json` é o único lugar lido da mesma forma por todos os hooks e chamadas da CLI. `SessionStart` então adiciona uma linha `Pota model ceiling:`, os tiers acima do ceiling usam o model do tier do ceiling, o gate de design Heavy aceita esse model e a verificação do main model usa o tier stronger limitado. Sem configuração nada muda; um valor inválido não aplica nenhum ceiling e é informado.
- Request brief e steering: um plano Light ou Heavy Path carrega um `## Request Brief` (pedido original, resultado interpretado, escopo, registros anteriores (`Prior records`, via `pota plan steering`), premissas, requisitos implícitos, perguntas em aberto, registro de steering), e a conclusão de `triage-plan` é recusada até que esteja preenchido, a menos que `--allow-no-request-brief <reason>` seja passado. Correções, adições e redirecionamentos do usuário são registrados com `goal steer --kind <correction|addition|redirect> --reason <text>`, ou com `goal replan --steer <correction|addition|redirect|none> --reason <text>` quando as tasks mudam; o segundo steering ou um redirect também exige reescrever `Current request (as of S<n>)`.

## Claude Code DAG Panel

O Claude Code desktop mostra o goal atual do Pota como um painel DAG, com uma coluna por wave. É exclusivo do Claude Code; Codex e Antigravity não o têm. Exige um Claude Code com suporte a mods (escrito para a API de mods do Claude Code 2.1.325); em uma surface sem gráficos, como o terminal, mostra uma lista de texto.

- `/dag [previous|current|next|all|refresh|close]` abre o painel. As visões são anterior, atual, próxima e tudo. A visão padrão é tudo (all); as outras são opcionais. Uma ligação concluída é uma linha contínua; uma em andamento é tracejada, com um ponto que se move.
- Ele abre uma vez automaticamente depois de `pota goal start` e `pota goal replan`. Se você o fechar, não reabre para o mesmo goal.
- Ele relê o estado do goal quando um comando de goal é executado e a cada 30 segundos.

## Antigravity Compatibility

O Pota suporta a CLI do Antigravity (`agy`); o IDE do Antigravity não é suportado. O manifest do plugin é o `plugin.json` da raiz, e os hooks são o `hooks.json` da raiz, que executa `scripts/pota-state-antigravity.mjs` a partir da pasta do plugin. Esse adaptador associa os eventos do Antigravity aos hooks do Pota:

- `SessionStart` adiciona a cápsula da sessão e a linha `Pota CLI:`.
- O Antigravity não tem evento de prompt, então o primeiro `PreInvocation` de cada prompt adiciona o contexto do prompt.
- `PostToolUse` em `write_to_file`, `replace_file_content` e `multi_replace_file_content` executa o comment checker e o lembrete do goal; o resultado entra no próximo `PreInvocation`.
- `Stop` mantém o agente trabalhando enquanto o goal ativo tiver uma task inacabada. Não há `SubagentStop`.

As skills são chamadas como `/pota-plan`, `/pota-work`, `/pota-review` e `/pota-memory`; workflows não fazem parte dos plugins do Antigravity. O adaptador segue a documentação de hooks do Antigravity; o seu comportamento numa sessão real do `agy` ainda não foi verificado.

## Locale Policy

As instrucoes reutilizaveis do Pota sao escritas em English para global use. User-visible output e documentation, plans e memory artifacts gerados ou atualizados devem seguir o OS locale configurado, a menos que o usuario peca explicitamente outro idioma. Isso inclui conteudo em `MEMORY.md`, `PLAN.md`, `docs/memory` e `docs/plan`. A CLI localiza mensagens comuns para `en`, `ko`, `ja`, `zh`, `es`, `fr`, `de` e `pt`, e volta para English em unsupported locales. O texto `statusMessage` dos Codex hooks permanece static English, enquanto hook command output e English ou Korean.

## Delegation

- `explorer`: lida com read-only codebase discovery, impact analysis, pattern searches e read-only verification quando disponivel.
- `worker`: lida com bounded implementation ou verification tasks com file ownership claro.
- Main session: mantem urgent blocking work local quando o proximo passo depende imediatamente do resultado.

Todo delegation prompt usa seis sections: TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT.
