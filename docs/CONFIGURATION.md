# Configuração

Tudo vem do ambiente (12-factor). Nenhum arquivo `.env` é lido. Valores
malformados falham no boot, com todos os problemas listados de uma vez; valores
ausentes nunca falham no boot: falham na hora da chamada, com uma mensagem que
diz o que fazer.

## Variáveis

| Variável | Default | O que faz |
| --- | --- | --- |
| `FAMILYSEARCH_CONFIG_DIR` | `~/.config/familysearch-mcp` | Raiz de tudo que é gravado. `~/` é expandido à mão, porque config de cliente MCP é JSON, não shell |
| `FAMILYSEARCH_ENV` | `production` | `production` (`https://www.familysearch.org`, a árvore real) ou `beta` (`https://beta.familysearch.org`, cópia isolada com contas próprias). Sessão, cache e perfil do navegador são separados por ambiente |
| `FAMILYSEARCH_SESSION_KEY` | — | Chave AES em base64 de 32 bytes (`openssl rand -base64 32`). Sem ela, uma é gerada em `session.key`. Vale para os dois ambientes |
| `FAMILYSEARCH_EXPORT_DIR` | `~/Downloads/familysearch-export` | Único diretório em que o `export` pode escrever |
| `FAMILYSEARCH_READ_ONLY` | `0` | Não registra as 14 tools que gravam algo: as 11 escritas na árvore, `login`, `sync` e `export` |
| `FAMILYSEARCH_AUTO_APPROVE` | `0` | Aprova toda escrita sem perguntar (ADR-0012). Desligado por padrão |
| `FAMILYSEARCH_IMPORT_BROWSER` | — | `dia`, `arc`, `chrome`, `chromium`, `brave` ou `edge`. Na produção, o `login` importa a sessão daí, e um 401 dispara uma reimportação silenciosa |
| `FAMILYSEARCH_BROWSER_CHANNEL` | `chrome` | `chrome`, `chromium` ou `msedge`, para o login pela janela |
| `FAMILYSEARCH_MIN_INTERVAL_MS` | `400` | Intervalo mínimo entre duas requisições |
| `FAMILYSEARCH_JITTER_MS` | `200` | Variação aleatória somada ao intervalo |
| `FAMILYSEARCH_WRITE_INTERVAL_MS` | `2000` | Intervalo mínimo antes de uma escrita (mínimo aceito: 1000). Vale o maior entre este e o anterior |
| `FAMILYSEARCH_HTTP_TIMEOUT_MS` | `30000` | Timeout de cada requisição (mínimo aceito: 1000) |
| `FAMILYSEARCH_LOG_FILE` | — | Espelha os logs num arquivo. Eles sempre vão para o stderr também, com o token redigido |
| `FAMILYSEARCH_LIVE` | — | `=1` destrava `test/integration/live.real.test.ts` (só leituras, só com sessão de produção salva) |

Aceita como booleano: `1/0`, `true/false`, `yes/no`, `on/off`. Qualquer outra
coisa é erro, não um default silencioso.

Só `FAMILYSEARCH_AUTO_APPROVE=1` desliga a pergunta de aprovação das escritas. Com
ela, toda escrita vai para a árvore compartilhada sem pergunta; o motivo, o
registro em `audit/`, o snapshot da mesclagem e a releitura continuam, e o
`doctor` avisa enquanto ela estiver ligada (ADR-0012).

## Arquivos em disco

Tudo dentro de `FAMILYSEARCH_CONFIG_DIR`. `<env>` é `production` ou `beta`.

| Arquivo | Modo | Conteúdo |
| --- | --- | --- |
| `session.<env>.enc` | `0600` | Token, User-Agent, usuário e origem da sessão, cifrados com AES-256-GCM |
| `session.key` | `0600` | Chave gerada no primeiro login, se `FAMILYSEARCH_SESSION_KEY` não existir |
| `cache.<env>.db` (+ `-wal`, `-shm`) | `0600` | A linhagem, as famílias e as contagens que o `sync` baixou |
| `browser-profile-<env>/` | `0700` | Perfil persistente do Chrome usado no login pela janela |
| `audit/writes.<env>.jsonl` | `0600` | Uma linha por tentativa de escrita: quando, tool, motivo, se foi aprovada, as respostas e o resultado |
| `audit/approvals/` | `0700`, arquivos `0600` | O plano completo de cada pergunta de aprovação, em Markdown |
| `audit/snapshots/` | `0700`, arquivos `0600` | O JSON das duas pessoas (e das famílias delas) salvo logo antes de cada mesclagem |

Os diretórios são criados com `0700` e o `umask` é forçado na criação do banco,
para que nenhum desses arquivos fique legível por outros usuários da máquina.
Os arquivos de `export` também são `0600`.

## Registro no Claude Code

```sh
claude mcp add -s user familysearch --env FAMILYSEARCH_IMPORT_BROWSER=dia -- /Users/você/.local/bin/familysearch mcp
```

Sempre com caminho absoluto: clientes MCP não herdam o `PATH` do shell. Uma
entrada com o mesmo nome no escopo do projeto tem precedência sobre a de
usuário; `scripts/install.ts` remove essas entradas justamente por isso.

Variante somente leitura, para um agente que não deve nem pedir para escrever:

```sh
claude mcp add -s user familysearch --env FAMILYSEARCH_READ_ONLY=1 -- /Users/você/.local/bin/familysearch mcp
```

Para trabalhar no beta sem mexer no registro da produção, registre um segundo
servidor com outro nome e `FAMILYSEARCH_ENV=beta`.

Outros clientes (Claude Desktop e afins) leem o mesmo bloco `mcpServers`, com
`command`, `args` e, se precisar, `env`. As escritas só funcionam em clientes
que implementam elicitation em formulário; nos outros, toda escrita é recusada
com o motivo.

## Ritmo e anti-bot

Uma requisição por vez, sempre, mesmo quando duas tools rodam ao mesmo tempo.
O padrão é uma leitura a cada 400 a 600 ms e uma escrita a cada 2 a 2,2
segundos. Um 429, um 5xx ou uma falha de rede numa leitura espera e tenta de novo, até 4 tentativas,
com espera dobrando a partir de 2 segundos (no máximo 60) e respeitando
`Retry-After`. Escrita nunca é repetida sozinha: um 429 volta como "nada foi
aplicado, espere", e timeout, falha de rede ou 5xx voltam como "pode ter sido
aplicada".

A árvore é compartilhada, e volume é o que chama atenção. Um 403 no `doctor`
costuma ser a proteção anti-bot do site: abra o FamilySearch no navegador,
espere alguns minutos e tente de novo, sem insistir.
