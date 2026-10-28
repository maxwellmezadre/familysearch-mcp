# A API do FamilySearch

O que este projeto chama, como autentica e o que já se provou na prática. Os
ids abaixo são inventados. A referência oficial é
`https://developers.familysearch.org/main/llms.txt`, que indexa uma página por
endpoint. Quando algo mudar, [`REDISCOVERY.md`](REDISCOVERY.md) diz como
remapear.

## Por que não existe caminho oficial

A API do FamilySearch (`/platform/...`) é documentada e estável, mas o acesso
oficial a ela passa por uma aplicação registrada, com chave de desenvolvedor e
OAuth. O FamilySearch não dá essa chave para projeto pessoal. O que existe para
quem só quer trabalhar na própria árvore é o site, e o site usa a mesma API
com o token da sessão do navegador.

Este projeto usa esse token. É zona cinza nos termos de uso: uso pessoal e em
ritmo humano reduzem o risco, mas não o eliminam (veja o
[`SECURITY.md`](../SECURITY.md)). A busca de registros históricos é a única
chamada fora da `/platform`: ela está no serviço do site
`/service/search/hr/v2/personas`, com o mesmo token.

## Autenticação

| Cabeçalho | Valor | Quando |
| --- | --- | --- |
| `Authorization` | `Bearer <fssessionid>` | Sempre |
| `User-Agent` | O do navegador de onde veio a sessão | Sempre |
| `Accept` | `application/x-fs-v1+json` | Padrão das leituras |
| `Accept` | `application/x-gedcomx-atom+json` | Busca na árvore, histórico de alterações, sugestões (`matches`), lugares |
| `Accept` | `application/json` | Busca de registros (`/service/search/...`) |
| `Content-Type` | `application/x-fs-v1+json` | Escritas com corpo |
| `X-Reason` | O motivo da alteração, em ASCII | Toda escrita; vai para o histórico da pessoa |

O token é o valor do cookie `fssessionid` do domínio `.familysearch.org`.
`GET /platform/users/current` é a chamada mais barata que prova que ele vale e
diz de quem ele é (`id`, `displayName`, `personId`).

| Ambiente | Host |
| --- | --- |
| `production` | `https://www.familysearch.org` |
| `beta` | `https://beta.familysearch.org` |

## Endpoints

### Leitura

| Chamada | Accept | Usado por |
| --- | --- | --- |
| `GET /platform/users/current` | fs-v1 | `login`, `auth_status --verify`, `doctor` |
| `GET /platform/tree/persons/{id}` | fs-v1 | `get_person`, `compare_persons`, releituras |
| `GET /platform/tree/persons/{id}/families` | fs-v1 | `get_family`, `compare_persons`, `sync`, releituras |
| `GET /platform/tree/persons/{id}/sources` | fs-v1 | `get_person`, `compare_persons`, `sync`, `attach_record` |
| `GET /platform/tree/persons/{id}/notes` | fs-v1 | `get_person`, releitura de `add_note` |
| `GET /platform/tree/persons/{id}/memories` | fs-v1 | `get_person` |
| `GET /platform/tree/persons/{id}/changes` | atom | `get_change_history`, `compare_persons`, `merge_persons` |
| `GET /platform/tree/persons/{id}/matches` | atom | `get_possible_duplicates`, `sync` |
| `GET /platform/tree/persons/{id}/matches?collection=https://familysearch.org/platform/collections/records` | atom | `get_hints`, `sync`, releitura de `resolve_suggestion` |
| `GET /platform/tree/persons/{id}/not-a-match` | fs-v1 | Releitura de `resolve_suggestion` |
| `GET /platform/tree/ancestry?person={id}&generations={n}` | fs-v1 | `get_ancestors`, `sync` |
| `GET /platform/tree/descendancy?person={id}&generations={n}` | fs-v1 | `get_descendants` |
| `GET /platform/tree/search?q.givenName=…&q.surname=…&count=…` | atom | `search_persons`, `create_person`, `doctor` |
| `GET /platform/tree/couple-relationships/{id}` | fs-v1 | `remove_relationship` |
| `GET /platform/tree/child-and-parents-relationships/{id}` | fs-v1 | `remove_relationship` |
| `GET /platform/tree/{couple-relationships\|child-and-parents-relationships}/{id}/notes` | fs-v1 | Releitura de `add_note` |
| `GET /service/search/hr/v2/personas?q.surname=…&count=…` | json | `search_records` |
| `GET /platform/records/personas/{id}` | fs-v1 | `get_record`, `attach_record` |
| `GET /platform/places/search?q=name:"…"&count=…` | atom | `search_places` |
| `OPTIONS /platform/tree/persons/{sobrevivente}/merges/{duplicata}` | fs-v1 | `compare_persons`, `merge_persons` |
| `GET /platform/tree/persons/{sobrevivente}/merges/{duplicata}` | fs-v1 | `compare_persons`, `merge_persons` |

Parâmetros da busca na árvore: `q.givenName`, `q.surname`, `q.sex`,
`q.birthLikeDate`, `q.birthLikePlace`, `q.deathLikeDate`, `q.deathLikePlace`,
`q.fatherGivenName`, `q.fatherSurname`, `q.motherGivenName`,
`q.motherSurname`, `q.spouseGivenName`, `q.spouseSurname`, `count`. Na busca
de registros: `q.givenName`, `q.surname`, `q.birthLikeDate.from`,
`q.birthLikePlace`, `q.deathLikeDate.from`, `q.deathLikePlace`,
`f.collectionId`, `count`.

### Escrita

Todas com `X-Reason`, e só depois da aprovação.

| Chamada | Corpo | Usado por |
| --- | --- | --- |
| `POST /platform/tree/persons` | `persons[0]` com `gender`, `living`, `names` (com `parts` Given e Surname) e `facts` | `create_person`; o id novo volta em `X-Entity-Id` |
| `POST /platform/tree/persons/{id}` | `persons[0]` com `id` e os `facts`, `names` ou `gender` a acrescentar ou alterar (um fato com `id` é alterado) | `update_person`. Um fato `Death` numa pessoa viva a torna falecida (`living: false`) e visível a todos, com o mesmo id |
| `DELETE /platform/tree/persons/{id}/conclusions/{fatoId}` | — | `update_person` (remoção) |
| `POST /platform/tree/relationships` | `childAndParentsRelationships[0]` com `parent1`, `parent2` e `child` | `link_parents` |
| `POST /platform/tree/relationships` | `relationships[0]` do tipo `Couple`, com `person1`, `person2` e o casamento em `facts` | `link_spouses` |
| `DELETE /platform/tree/couple-relationships/{id}` | — | `remove_relationship` |
| `DELETE /platform/tree/child-and-parents-relationships/{id}` | — | `remove_relationship` |
| `POST /platform/sources/descriptions` | `sourceDescriptions[0]` com `titles`, `citations` e `about` | `add_source`, `attach_record`; o endereço da fonte volta em `Location` |
| `POST /platform/tree/persons/{id}` | `persons[0].sources[0].description` com o `Location` acima | `add_source`, `attach_record` |
| `POST /platform/tree/{persons\|couple-relationships\|child-and-parents-relationships}/{id}/notes` | A nota (`subject`, `text`) no objeto do alvo | `add_note` |
| `POST /platform/tree/persons/{id}/matches?status=accepted\|rejected&collection=…records` | `persons[0].identifiers` com o ark do registro | `resolve_suggestion` (registro) |
| `POST /platform/tree/persons/{id}/not-a-match` | `persons[0].id` da outra pessoa | `resolve_suggestion` (duplicata) |
| `POST /platform/tree/persons/{sobrevivente}/merges/{duplicata}` | `merges[0]` com `resourcesToCopy` e `resourcesToDelete` | `merge_persons` |
| `POST /platform/tree/persons/{id}/restore` | — | `restore_person` |

Os corpos de escrita seguem a documentação oficial e o que outros projetos
provaram no beta. Nenhum deles rodou ainda em produção por este projeto.

## Armadilhas confirmadas

Provadas contra a API real, no spike e durante a construção:

- Um token vale num ambiente só. Na produção, `users/current` responde 200; o
  mesmo token no beta responde 401 com
  `Warning: 400 FamilySearch "Failure in upstream call: 401 Unauthorized ..."`.
  É assim que o login diz em qual ambiente o navegador está.
- Produção e beta guardam o token no mesmo cookie `fssessionid` de
  `.familysearch.org`, e ele é um cookie de sessão (sem data de expiração).
  Um navegador fica logado em um ambiente por vez.
- Pessoa inexistente responde 404 com
  `Warning: "Unable to read Person (upstream 404)"`; id malformado responde 400
  com `Warning: "Invalid entity id: ..."`. Os dois viram "não encontrado".
- Pessoa mesclada responde 301 com `Location` apontando para a sobrevivente
  (a resposta está nas fixtures). Seguir o redirecionamento esconderia a
  mesclagem; a camada HTTP não segue, e o id da sobrevivente é lido do
  `Location`.
- `notes`, `memories` e `matches` respondem 204, sem corpo, quando não há nada.
- A busca na árvore responde HTTP 400 (`Failure in upstream call`) a qualquer
  data que não seja um ano ou uma data ISO. A busca de registros recebe o mesmo
  tratamento, por precaução.
- A busca de registros devolve `{results, index, links, entries}`, e cada
  entrada traz `id`, `score`, `confidence` e o GEDCOM X em `content.gedcomx`. A
  coleção vem no primeiro `sourceDescriptions` (título e citação).
  `/platform/records/personas/{id}` é o mesmo registro que
  `/ark:/61903/1:1:{id}` no site.
- `OPTIONS .../merges/{duplicata}` diz se a mesclagem é possível no cabeçalho
  `Allow`: com `POST`, é (`Allow: OPTIONS, HEAD, GET, POST`).
- Na análise de mesclagem, os relacionamentos são recursos como os fatos. Um
  relacionamento de pais e filho que só existe na duplicata precisa ir em
  `resourcesToCopy`, senão o filho perde a ligação com a pessoa que fica.
- O FamilySearch pode não sugerir duas versões claras da mesma pessoa uma como
  duplicata da outra (`matches` 204 nas duas).
- O cabeçalho `X-Reason` só aceita ASCII no Bun (caracteres acima de U+00FF são
  recusados antes do envio). O motivo vai sem acentos no cabeçalho e completo
  no registro local.

Conhecidas da documentação e de outros projetos, e respeitadas pelo código,
mas ainda não provadas aqui:

- Sem um User-Agent de navegador, a borda do FamilySearch responde 403. O
  projeto sempre manda o do navegador de onde a sessão veio.
- Quando só a ordem inversa de mesclagem é aceita, o `OPTIONS` traz um
  `Warning` com `Can merge, but must switch order`.
- Um nome sem `parts` (Given e Surname) cria uma pessoa sem id, em silêncio.
- Ligar pai ou mãe com um relacionamento `ParentChild` cria um casal por
  engano. O certo é `childAndParentsRelationships`, com os dois pais numa
  requisição só.
- Acrescentar fato e anexar fonte são `POST` no próprio recurso da pessoa.
- Alterar um fato pelo id substitui a conclusão inteira. Por isso
  `update_person` junta os campos atuais aos novos antes de enviar.
- Pessoas recém-criadas demoram a aparecer na busca.
- O beta responde 204 vazio para um id desconhecido, e não gera sugestões de
  registro nem de duplicata.
