# Fixtures

Respostas reais da API do FamilySearch, capturadas por `scripts/capture-fixtures.ts` e
anonimizadas deterministicamente por `scripts/anonymize-fixture.ts` antes de entrar no
repositório (que é público).

A pessoa capturada é uma figura pública morta há mais de um século, de propósito: as
fixtures nunca carregam a família de quem usa o projeto. Mesmo assim, tudo passa pela
anonimização.

| Arquivo | Origem |
|---|---|
| `person.json` | `GET /platform/tree/persons/{id}` |
| `person-merged.json` | o mesmo, para um id já mesclado: `301` com `Location` |
| `families.json` | `GET /platform/tree/persons/{id}/families` |
| `ancestry.json` | `GET /platform/tree/ancestry?person={id}&generations=3` |
| `descendancy.json` | `GET /platform/tree/descendancy?person={id}&generations=2` |
| `changes.json` | `GET /platform/tree/persons/{id}/changes` (atom, cortado em 12 entradas) |
| `sources.json` | `GET /platform/tree/persons/{id}/sources` |
| `tree-search.json` | `GET /platform/tree/search` (atom, 3 resultados) |
| `matches.json` | `GET /platform/tree/persons/{id}/matches` (atom; `204`, sem sugestões) |
| `record-search.json` | `GET /service/search/hr/v2/personas` (3 resultados) |
| `places.json` | `GET /platform/places/search` (atom) |

Cada arquivo é `{ status, location, body }`: o corpo como veio, mais o status e o
`Location`, para os testes reproduzirem também os casos de erro.

## O que a anonimização faz

- **Ids** de pessoa, relacionamento, registro e colaborador (4 caracteres, hífen, 3 ou 4,
  com pelo menos uma letra) trocados por ids falsos do mesmo formato, por HMAC com
  `task/anonymize.salt`. O mapa é determinístico, então as relações entre os arquivos
  continuam valendo. Intervalos de vida ("1809-1865") não têm letra e ficam como estão.
- **Nomes** de pessoas e de colaboradores: cada palavra vira uma palavra de uma lista
  fixa, mantendo maiúsculas. As mesmas palavras são trocadas em títulos e citações.
- **Texto livre** escrito por usuários (motivos de alteração, notas) substituído.
- **Pessoas vivas** perdem datas e lugares.
- **Atribuições** (quem alterou o quê) e blocos volumosos (`evidence`, `fields`) removidos.
- **Guarda de vazamento:** o script falha se algum id original sobrar, ou se aparecer
  qualquer valor de `task/anonymize.secrets` (um por linha, fora do repositório).

`test/fixtures.test.ts` é a guarda permanente no repositório.

## Recapturar

```bash
familysearch login --from-browser dia
bun run scripts/capture-fixtures.ts     # grava em task/captures/ (fora do git)
bun run scripts/anonymize-fixture.ts    # grava em test/fixtures/
bun test
```
