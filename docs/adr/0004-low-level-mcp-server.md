# ADR-0004: `Server` de baixo nível do SDK do MCP

Status: Aceito

## Contexto

`McpServer.registerTool` espera um schema Zod ou Standard Schema. O projeto tem
TypeBox (ADR-0003). E a trava de aprovação precisa perguntar ao usuário pelo
cliente (elicitation), o que exige acesso ao objeto do servidor de dentro da
execução de uma tool.

## Decisão

Usar o `Server` de baixo nível com `setRequestHandler`, passando o objeto
TypeBox direto como `inputSchema`. Todo uso do SDK fica em `src/mcp/`:
`server.ts` registra as tools e `elicit.ts` transforma `elicitInput` num
`Approver`, que o servidor põe no contexto depois de criado.

## Consequências

Nenhuma ponte de schema e uma fonte só de verdade. Em troca, acoplamento à API
de baixo nível do SDK, mitigado pelo pin de versão e pelo isolamento em dois
arquivos pequenos. O `ListTools` publica `annotations` (`readOnlyHint`,
`destructiveHint`), e as escritas que podem apagar ou sobrescrever dados
(`update_person`, `remove_relationship`, `merge_persons`, `restore_person`) vão
marcadas como destrutivas.
