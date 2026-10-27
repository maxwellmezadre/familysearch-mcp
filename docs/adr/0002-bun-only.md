# ADR-0002: Bun como runtime único, com `bun:sqlite`

Status: Aceito

## Contexto

O cache da linhagem precisa de SQLite, e a importação da sessão lê o banco de
cookies do navegador, que também é SQLite. As opções em Node custam uma
dependência nativa que compila na instalação. O projeto também quer virar um
binário só, que rode o login sem nada instalado além do Chrome.

## Decisão

Bun ≥ 1.3 como único runtime. `bun:sqlite` (embutido, síncrono, zero
dependência), `bun test` como runner, `bun build --compile` para o binário.
Quatro dependências de runtime no total: o SDK do MCP, TypeBox, commander e
`playwright-core` (este embutido no binário, para o `login` pela janela).

## Consequências

Não roda em Node: `bun:sqlite` não existe lá. Para quem não tem Bun, a
distribuição é o binário compilado. Some também a etapa de build no
desenvolvimento: o Bun executa TypeScript direto.
