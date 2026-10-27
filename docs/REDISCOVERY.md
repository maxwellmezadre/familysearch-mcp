# Quando o FamilySearch mudar

A API documentada muda devagar, mas muda, e o caminho de autenticação (o token
do navegador) não é oficial. Este é o roteiro para achar o que quebrou e
remapear.

## 1. Pergunte ao doctor primeiro

```sh
familysearch doctor
```

Ele testa camada a camada e para na primeira que falha. Cada camada só roda se
a de baixo passou, então a primeira falha é a resposta.

| Camada que falhou | Onde olhar |
| --- | --- |
| `config` | Só informa o ambiente e o caminho da sessão. Uma variável malformada falha antes, ao carregar a configuração, com a lista de problemas (`src/config.ts`) |
| `session_file` | Não há sessão: `familysearch login`. Chave errada: `FAMILYSEARCH_SESSION_KEY` ou `session.key` |
| `token` | A sessão salva é de outro ambiente: `familysearch login` neste |
| `api` | `users/current` não respondeu 200. 401: sessão expirada. 403: anti-bot. Outro status: `src/familysearch/user.ts` e `src/core/http.ts` |
| `tree_read` | A leitura de pessoa veio sem pessoas: o formato mudou. `src/familysearch/api.ts` e `src/domain/normalize.ts` |
| `search` | A busca na árvore não devolveu nada: o caminho, os parâmetros ou o `Accept` mudaram. `treeSearchParams` em `src/familysearch/api.ts` |

As camadas `approval` e `writes` são informativas: dizem como as escritas vão
ser perguntadas (e se há hooks que poderiam responder por você) e quais
escritas ainda não foram provadas em produção.

Se o `doctor` passa e uma tool específica falha, o erro dela costuma dizer o
status e o `Warning` que o FamilySearch mandou. Um `ParseError` quer dizer que a
resposta veio num formato que o parser não reconhece.

## 2. Leia a documentação do endpoint

`https://developers.familysearch.org/main/llms.txt` indexa uma página `.md`
por endpoint, com os parâmetros, os tipos de mídia e exemplos de resposta. Os
caminhos do projeto são os de lá, fixos em `src/familysearch/api.ts` e
`src/familysearch/writes.ts` (ADR-0011). Compare o caminho, o `Accept` e os
nomes de parâmetro com o que o código manda.

## 3. Veja a resposta crua

```sh
familysearch raw /platform/tree/persons/KWCB-AAA
familysearch raw "/platform/tree/persons/KWCB-AAA/matches" --accept application/x-gedcomx-atom+json
familysearch raw "/platform/tree/search?q.surname=Rossi&count=2" --accept application/x-gedcomx-atom+json
```

`raw_get` usa a mesma sessão, o mesmo ritmo e o mesmo funil HTTP das outras
tools. Ele devolve o status, o `Location`, o `Warning` e o corpo (JSON quando
der), cortado em 64 KB. Só aceita GET em `/platform/...` e
`/service/search/...`, ou um link do FamilySearch que aponte para eles.

Os links de uma resposta (`links` em pessoas e coleções) mostram o caminho que o
próprio FamilySearch indica hoje. Eles não são seguidos pelo código, mas são a
pista mais rápida quando um caminho fixo deixa de funcionar.

## 4. Olhe o que o site faz

Com o FamilySearch aberto no navegador, a aba de rede das ferramentas de
desenvolvedor mostra as chamadas que o próprio site faz para `/platform/...` e
`/service/...`, com os cabeçalhos e os parâmetros. Foi por aí que a busca de
registros em `/service/search/hr/v2/personas` apareceu.

## 5. Ajuste o normalizador ou o construtor

- Formato de leitura mudou: `src/domain/normalize.ts` (e os tipos em
  `src/familysearch/gedcomx.ts`). O resto do projeto só vê o vocabulário de
  `src/domain/types.ts`.
- Caminho ou parâmetro de leitura mudou: a função em `src/familysearch/api.ts`.
- Corpo de escrita mudou: o construtor em `src/familysearch/writes.ts`, com um
  teste novo que confere o corpo.

## 6. Prove escritas no beta

Uma escrita alterada nunca é provada primeiro na árvore real.

```sh
FAMILYSEARCH_ENV=beta familysearch login     # janela do Chrome dedicado, conta do beta
FAMILYSEARCH_ENV=beta familysearch doctor
FAMILYSEARCH_ENV=beta familysearch create-person --given Teste --surname Rossi --gender male --deceased --reason "Teste de escrita no beta" --preview
```

O beta é uma cópia isolada, com contas próprias e árvore vazia. Crie pessoas de
teste, escreva, confira pela releitura da tool e por uma leitura separada, e
limpe o que criou.

## 7. Recapture as fixtures

```sh
familysearch login --from-browser dia
bun run scripts/capture-fixtures.ts       # grava em task/captures/ (fora do git)
bun run scripts/anonymize-fixture.ts      # gera test/fixtures/ para o repo público
bun test
```

As capturas são de uma figura pública morta há mais de um século, nunca da sua
família. O anonimizador falha se um id original ou qualquer valor de
`task/anonymize.secrets` sobreviver.

## Nunca automatize

O login é seu, na janela do navegador: senha, verificação, captcha. Um 403 da
proteção anti-bot se resolve abrindo o site no navegador e esperando, não
insistindo. E nenhuma escrita, nem para testar um corpo novo, sai sem a sua
aprovação na tela: na produção, só depois de provada no beta.
