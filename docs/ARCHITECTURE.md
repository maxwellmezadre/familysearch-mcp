# Arquitetura

```
        ┌──────────────────────────────────────────────────────┐
        │  Transporte / entradas                                │
        │  src/bin.ts · src/mcp-bin.ts · src/cli/ · src/mcp/    │
        └───────────────┬──────────────────────────────────────┘
                        │ usa
        ┌───────────────▼──────────────────────────────────────┐
        │  Aplicação — src/tools/ · src/context.ts              │
        │  Aprovação — src/approval/                            │
        └───────────────┬──────────────────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────────────────┐
        │  Domínio — src/domain/ · src/cache/ · src/export/     │
        │  (não conhece MCP, CLI nem HTTP)                      │
        └───────────────┬──────────────────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────────────────┐
        │  FamilySearch — src/familysearch/                     │
        └───────────────┬──────────────────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────────────────┐
        │  Infra — src/core/ · src/session/ · src/config.ts     │
        └──────────────────────────────────────────────────────┘
```

## Fluxo de uma pergunta

1. `bin.ts` decide entre servidor MCP e CLI (import preguiçoso por modo: o
   caminho MCP nunca carrega o commander).
2. `tools/define.ts` valida os argumentos contra o schema TypeBox da tool.
3. A tool chama uma leitura de `familysearch/api.ts`, que monta o caminho
   documentado e entrega a requisição a `core/http.ts`.
4. `core/http.ts` relê a sessão do disco, espera o intervalo, envia com o
   token e o User-Agent do navegador, e trata 401 (uma reimportação), 429, 5xx
   e falha de rede. Não segue redirecionamentos: um 301 quer dizer "mesclada
   em".
5. `familysearch/api.ts` traduz os status em erros do projeto (`MergedError`,
   `NotFoundError`, `DeletedError`...), e `domain/normalize.ts` converte o
   GEDCOM X no vocabulário do projeto (`PersonDetail`, `Family`, `GenDate`).
6. A resposta sai em JSON pelo MCP ou formatada pelo CLI (`cli/format.ts`).

`find_gaps` e `export` pulam os passos 3 a 5: leem só o cache
(`cache/repo.ts`), que o `sync` preenche em blocos (`cache/sync.ts`).

### Quando a pergunta vira escrita

1. A tool lê o estado atual e recusa o que dá para recusar antes de perguntar:
   ids de fato que não existem, relacionamento que já existe, pessoa viva numa
   mesclagem, fingerprint desatualizado.
2. Monta um `WritePlan`: título, detalhes, motivo e a lista exata de escritas,
   cada uma construída em `familysearch/writes.ts`. Com `preview: true`, para
   aqui e devolve o plano.
3. `approval/gate.ts` grava o plano completo em `audit/approvals/` e pergunta
   pelo `Approver` do contexto: elicitation (`mcp/elicit.ts`) no servidor MCP,
   diálogo do macOS (`cli/dialog.ts`) no CLI. Sem resposta afirmativa, nada é
   enviado e a recusa vai para o registro.
4. Com o "sim", o gate emite um `WriteTicket` (`core/ticket.ts`) com as
   escritas aprovadas. `approval/run.ts` envia uma por uma por `Http.write`,
   que consome uma entrada do ticket por requisição e recusa qualquer escrita
   fora dele.
5. Uma falha para a execução e diz o que aconteceu. Nada é repetido sozinho.
6. Se tudo foi aplicado, a tool relê o estado por outra leitura e devolve cada
   conferência. O resultado vai para `audit/writes.<env>.jsonl`.

## Regras

1. Dependências só para dentro. O SDK do MCP só existe em `src/mcp/`, o
   commander só em `src/cli/`, o `playwright-core` só em
   `src/session/login.ts` (import dinâmico).
2. Toda rede passa por `src/core/http.ts`, uma requisição por vez. A única
   exceção é `probeUser` (`src/familysearch/user.ts`), que prova um token antes
   de existir sessão.
3. `src/domain/normalize.ts` lê o GEDCOM X; `src/familysearch/writes.ts` monta
   os corpos de escrita. Se o formato mudar, é ali que quebra.
4. Os caminhos da API são os documentados, fixos no código (ADR-0011).
5. Data genealógica é texto original mais forma padronizada, nunca um `Date`
   (ADR-0007).
6. Toda escrita passa pelo gate e por um ticket de uso único (ADR-0009). Só
   `src/approval/gate.ts` emite tickets, e `test/architecture.test.ts` garante.
   `Http.send` recusa qualquer método que não seja GET, HEAD ou OPTIONS.
7. stdout é do JSON-RPC. Log só no stderr, com o token redigido.
8. Falha de tool vira `isError`, nunca crash. Um argumento ruim não pode
   derrubar o servidor.
9. Nenhum arquivo de lógica passa de ~450 linhas.

## O que cada diretório faz

| Diretório | Responsabilidade |
| --- | --- |
| `src/core/` | Erros tipados, logger com redação, cliente HTTP serial, ticket de escrita, helper de SQLite |
| `src/session/` | Sessão cifrada por ambiente, importação de navegador no macOS, login pela janela do Chrome |
| `src/familysearch/` | Uma função por leitura, os construtores de escrita, os tipos de fio do GEDCOM X e a prova do token |
| `src/domain/` | Vocabulário do projeto, normalização, datas de busca, comparação, plano de mesclagem e lacunas |
| `src/cache/` | Esquema e migrações, consultas e o `sync` em blocos |
| `src/export/` | GEDCOM 5.5.1 e CSV |
| `src/approval/` | O gate, o executor de planos e o registro local |
| `src/tools/` | Uma tool por assunto; o registry é compartilhado com o CLI |
| `src/cli/` | Um comando por tool, formatação legível e o diálogo do macOS |
| `src/mcp/` | O `Server` de baixo nível e a elicitation |

## Testes

- Unitários com fixtures reais anonimizadas: `fetch`, relógio, `sleep` e
  `random` são injetados, então backoff, ritmo e reimportação são verificados
  sem esperar de verdade e sem rede.
- As escritas são testadas com aprovadores falsos (`test/approvers.ts`) e um
  `fetch` falso, que confere método, caminho, cabeçalhos e corpo.
- `test/fixtures.test.ts` impede dado pessoal em fixtures e, onde existe
  `task/anonymize.secrets`, em qualquer arquivo versionado.
- `test/integration/live.real.test.ts` faz leituras reais, só com
  `FAMILYSEARCH_LIVE=1` e uma sessão de produção salva.
- `scripts/verify.ts` é o portão: typecheck, testes e as invariantes que só
  aparecem com o servidor MCP rodando de verdade, inclusive que uma escrita sem
  aprovação não acontece.
