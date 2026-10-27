# ADR-0011: Caminhos documentados fixos, sem descoberta por links

Status: Aceito

## Contexto

A API do FamilySearch é hipermídia: `GET /platform/collections/tree` e cada
pessoa devolvem mapas de `links` (persons, relationships, person-search,
matches, merge, change-history...). Resolver cada caminho por esses links
deixaria o código imune a uma mudança de URL, ao custo de uma requisição a
mais por chamada, numa API em que o ritmo é deliberadamente lento.

## Decisão

Os caminhos são os documentados em `developers.familysearch.org`, fixos no
código: uma função por leitura em `src/familysearch/api.ts` e um construtor por
escrita em `src/familysearch/writes.ts`. Nenhum link de resposta é seguido
automaticamente. Ids que entram num caminho de escrita são conferidos contra um
padrão que não deixa `/`, `?`, `#`, `%` nem segmentos de ponto, para que um
caminho nunca resolva em outro lugar.

## Consequências

Nenhuma requisição extra, e os testes fixam o caminho exato de cada leitura e de
cada escrita. O plano que a pessoa aprova tem os caminhos exatos que serão
enviados, e o ticket os confere um a um. Quando um caminho deixa de funcionar,
o `doctor` aponta a camada, `raw_get` mostra a resposta crua e os `links` que o
FamilySearch indica, e `docs/REDISCOVERY.md` diz como remapear.
