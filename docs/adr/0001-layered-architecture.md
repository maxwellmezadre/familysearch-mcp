# ADR-0001: Arquitetura em camadas, pragmática

Status: Aceito

## Contexto

O projeto fala uma API externa que pode mudar, guarda uma sessão que equivale à
conta, escreve numa árvore compartilhada com o mundo todo e serve duas
interfaces, MCP e CLI. Sem separação, uma mudança no formato do FamilySearch
espalha edição por todo lado e uma escrita pode escapar da trava por um caminho
lateral. Com separação demais, um projeto pessoal vira cerimônia.

## Decisão

Camadas com dependência só para dentro: entradas (`src/bin.ts`, `src/cli/`,
`src/mcp/`), aplicação (`src/tools/`, `src/approval/`), domínio
(`src/domain/`, `src/cache/`, `src/export/`), FamilySearch
(`src/familysearch/`) e infra (`src/core/`, `src/session/`, `src/config.ts`).
Sem container de injeção, sem repositório genérico: `createContext(loadConfig())`
é a fiação inteira, e tudo que é tempo ou IO pode ser trocado nos testes.

Duas regras carregam o peso: toda rede passa por `src/core/http.ts` (a exceção
é `probeUser`, que prova um token antes de existir sessão), e o GEDCOM X é lido
em `src/domain/normalize.ts`. O MCP e o CLI resolvem as tools do mesmo array em
`src/tools/registry.ts`, então as duas superfícies não divergem.

## Consequências

Uma mudança de formato quebra um arquivo, e o `doctor` diz qual camada. Uma
escrita só chega ao FamilySearch por `Http.write`, que exige o ticket do gate.
Em troca, é preciso disciplina: nada de importar o SDK do MCP fora de
`src/mcp/` nem o commander fora de `src/cli/`.
