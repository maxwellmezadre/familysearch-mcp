## O que muda

<!-- A mudança e o porquê. Referencie issues (#123) se houver. -->

## Checklist

- [ ] `bun run verify` verde (typecheck + testes + invariantes do servidor MCP)
- [ ] Teste escrito antes da implementação (falhou, depois passou)
- [ ] Migração nova em `src/cache/db.ts` se o esquema do cache mudou (nunca editar uma já lançada)
- [ ] `bun run docs:tools` rodado se uma tool mudou
- [ ] Escrita nova ou alterada passa por `runWritePlan`, tem `preview` e releitura
- [ ] Documentação atualizada quando o comportamento muda (`README`, `docs/`, `SKILL.md`)
- [ ] Commits em [Conventional Commits](https://www.conventionalcommits.org)
      (inglês, sem escopo, uma linha, até 72 caracteres)
- [ ] Nenhum dado pessoal (ids, nomes, lugares de família real) em fixtures, logs ou exemplos
