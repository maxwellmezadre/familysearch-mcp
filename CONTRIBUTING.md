# Contribuindo

## Ambiente

```sh
bun install
bun run verify     # tsc --noEmit + bun test + as invariantes do servidor MCP
```

`bun run verify` é o portão. Ele roda o typecheck e os testes e depois sobe o
servidor MCP de verdade, por stdio, com um diretório de configuração
descartável e sem sessão: confere que o stdout é só JSON-RPC, que `tools/list`
bate com o registry, que erros viram `isError` sem derrubar o servidor, que
`raw_get` recusa caminhos fora da API, que uma escrita sem aprovação não
acontece e que o modo somente leitura registra exatamente as tools de leitura.
Se ele passa, o PR passa.

## Convenções

- Código, comentários, testes e commits em inglês. Documentação, descrições de
  tools, help do CLI e mensagens de erro em pt-BR: quem lê essas é o usuário.
- Sem linter. O gate é `tsc` estrito mais os testes.
- Nenhum arquivo de lógica acima de ~450 linhas.
- Comentários explicam por quê, não o quê. Uma simplificação deliberada leva um
  comentário que diz qual é o teto e qual seria a saída.
- Conventional Commits, sem escopo, uma linha, até 72 caracteres.

## Regras de arquitetura

Estas regras mantêm o projeto consertável quando o FamilySearch mudar e seguro
enquanto ele escreve numa árvore compartilhada (veja
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

1. Nenhuma rede fora de `src/core/http.ts`. A única exceção é `probeUser`, em
   `src/familysearch/user.ts`, que prova um token antes de existir sessão.
2. Ler GEDCOM X é trabalho de `src/domain/normalize.ts`, com os tipos de fio em
   `src/familysearch/gedcomx.ts`. Montar o corpo de uma escrita é trabalho de
   `src/familysearch/writes.ts`.
3. SDK do MCP só em `src/mcp/`; commander só em `src/cli/`; `playwright-core`
   só em `src/session/login.ts`, por import dinâmico (ele vai embutido no
   binário, mas o caminho do servidor MCP nunca o carrega).
4. Data genealógica é texto original mais a forma padronizada do FamilySearch,
   nunca um `Date` (ADR-0007).
5. stdout é do JSON-RPC. Log só no stderr.
6. Falha de tool vira `isError`, nunca crash.
7. Toda escrita na conta passa por `runWritePlan` (`src/approval/run.ts`), que
   pede a aprovação e só então chama `Http.write` com o ticket emitido. Só
   `src/approval/gate.ts` emite tickets (`test/architecture.test.ts` garante), e
   `Http.send` recusa qualquer método além de GET, HEAD e OPTIONS.
8. Escrita nunca é repetida sozinha. O que pode ser recusado é recusado antes
   da pergunta, a partir de uma leitura, e toda escrita aplicada é conferida
   por uma releitura.

## Testes

Escreva testes que teriam pego um bug de verdade: regra de negócio, segurança,
regressão. Não escreva testes que reafirmam estruturas estáticas.

- Injete `fetch`, relógio, `sleep` e `random`. Nada de esperar de verdade nem
  de timers falsos globais.
- Para escritas, use os aprovadores de teste de `test/approvers.ts`; nenhum
  teste chama o diálogo do macOS nem um cliente MCP real.
- Use as fixtures reais anonimizadas. Para recapturar, `bun run
  scripts/capture-fixtures.ts` grava as respostas cruas em `task/captures/`
  (fora do git) com a sessão salva, e `bun run scripts/anonymize-fixture.ts`
  gera `test/fixtures/` a partir delas. Nunca commite dado cru.
- Mudou o esquema do cache? Acrescente uma migração em `src/cache/db.ts`; uma
  já lançada nunca é editada.
- Mudou uma tool? `bun run docs:tools`.
- O teste ao vivo (`test/integration/live.real.test.ts`) só lê, e só roda com
  `FAMILYSEARCH_LIVE=1` e uma sessão de produção salva. Fora disso ele se pula.

Uma escrita só sai do aviso "Ainda não provada em produção" quando entra em
`PRODUCTION_PROVEN` (`src/tools/write-status.ts`), depois de rodar ao vivo com a
releitura conferida.

## Publicando

A tag `vX.Y.Z` dispara o release: binários para Linux x64, macOS arm64 e
Windows x64 e o publish no npm por OIDC (trusted publishing, sem token).

Uma ressalva do npm: a primeira versão de um pacote novo não sai por OIDC. O
npmjs exige que o pacote exista para você configurar o trusted publisher, e
exige o trusted publisher para publicar ([npm/cli#8544](https://github.com/npm/cli/issues/8544)).
Então a primeira versão é publicada à mão (`npm publish --access public`) e o
trusted publisher é configurado depois. O workflow pula a publicação quando a
versão já está no registro, em vez de falhar.

## Dado pessoal

O repositório é público e trata de família, inclusive de gente viva.
`test/fixtures.test.ts` falha se as fixtures carregarem e-mail, token de sessão
ou o nome real da figura pública capturada. Onde existe `task/anonymize.secrets`
(fora do git, uma linha por valor), o mesmo teste também procura cada um desses
valores em todo arquivo versionado. `task/` é gitignored e é onde ficam as
capturas cruas, o salt e essa lista. Não tire nada de lá: nos exemplos e na
documentação, use nomes e ids inventados.
