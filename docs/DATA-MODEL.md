# Modelo de dados

As tools devolvem o vocabulário do projeto (`src/domain/types.ts`), nunca o
GEDCOM X cru. Só `raw_get` mostra a resposta como o FamilySearch a mandou.

## Pessoa

| Campo | O que é |
| --- | --- |
| `id` | O id da árvore, como aparece no link da página: 4 caracteres, hífen, 3 ou 4 (ex.: `KWCB-AAA`) |
| `name` | O nome de exibição do FamilySearch; `null` quando não há nenhum |
| `gender` | `male`, `female` ou `unknown` |
| `living` | `true` quando a pessoa está marcada como viva. Pessoa viva fica no espaço privado de quem a cadastrou |
| `lifespan` | O intervalo de vida que o site mostra ("1890-1962", "Living") |
| `birth`, `death` | `{ date, place }`: do fato quando existe (é ele que tem a data padronizada), senão do bloco de exibição |
| `names` | Todos os nomes; o primeiro é o preferido |
| `facts` | Cada fato com `id`, `type` curto (`Birth`, `Residence`, ou o rótulo de um fato personalizado), `date`, `place` e `value` |

O `place` de um fato vem na forma padronizada quando o FamilySearch tem uma,
senão como foi escrito. O `id` de cada fato é o que `update_person` aceita em
`update_facts` e `remove_fact_ids`.

## Datas

Data genealógica raramente é exata: "abt 1850", "1921", "março de 1922",
"entre 1880 e 1885". Por isso toda data é um `GenDate`:

| Campo | Exemplo | O que é |
| --- | --- | --- |
| `original` | `"3 de março de 1921"` | O texto como foi escrito por quem cadastrou |
| `formal` | `"+1921-03-03"`, `"+1840"`, `"A+1850"` | A forma padronizada do FamilySearch, ou `null` quando o site não padronizou |

Regras que valem em todo o projeto:

- Nenhuma data vira um `Date`. Um `Date` exigiria dia e mês que não existem, e
  inventaria precisão.
- Mostre o `original`; compare pelo `formal`. `compare_persons` usa o ano do
  `formal` e, sem ele, um ano de quatro dígitos encontrado no `original`.
- As buscas (`search_persons`, `search_records`) só aceitam um ano ou uma data
  ISO. Uma data escrita por extenso ou aproximada vira o ano; um intervalo ou
  uma década é ignorado, porque mandar um ano só estreitaria a busca em vez de
  alargá-la.
- Na exportação GEDCOM, um `formal` vira data GEDCOM (`3 MAR 1921`, `ABT 1850`);
  o resto vira frase de data, entre parênteses.

## Família e relacionamentos

`get_family` devolve `parents` (cada par de pais com o `relationshipId` do
relacionamento pai/mãe e filho) e `spouses` (cada casal com o
`relationshipId`, o casamento e os filhos daquele casal). Filhos registrados sem
o outro genitor aparecem num casal com `spouse: null`.

Na API há dois tipos de relacionamento, e cada um tem o seu id:

| Tipo | `kind` nas tools | O que liga |
| --- | --- | --- |
| Casal | `couple` | Duas pessoas, com o casamento como fato |
| Pais e filho | `parents` | Um filho a um pai, a uma mãe ou aos dois, num relacionamento só |

## Numeração

`get_ancestors` usa o número de ascendência do FamilySearch: 1 é a pessoa, 2 o
pai, 3 a mãe, e o pai de N é 2N e a mãe 2N+1. Um sufixo `-S` marca o cônjuge
(`5-S`). `get_descendants` usa o número de descendência: `1.1` é o primeiro
filho, `1.1.1` o primeiro neto, `-S1` o cônjuge.

## Busca e sugestões

Resultados de busca e sugestões trazem `confidence`, a confiança do próprio
FamilySearch de 1 a 5 (3 ou mais costuma ser a mesma pessoa), e `score`.
`get_hints` são registros históricos que o FamilySearch sugere para a pessoa;
`get_possible_duplicates` são pessoas da árvore que ele acha que são a mesma.

## Comparação e mesclagem

`compare_persons` devolve:

| Campo | O que é |
| --- | --- |
| `a`, `b` | Cada pessoa com a família, o número de fontes, o número de alterações e a última alteração |
| `onlyA`, `onlyB` | Fatos que só um lado tem |
| `conflicts` | Fatos vitais (nascimento, morte, batismo, sepultamento, casamento) que os dois têm com valores diferentes |
| `redFlags` | Sinais de que não são a mesma pessoa: sexo diferente, anos de nascimento ou falecimento a mais de 5 anos, países de nascimento diferentes, pais ou cônjuges sem nenhum nome parecido (primeiro nome com até uma letra de diferença e, quando os dois têm, um sobrenome em comum; sobrenome de casada não atrapalha) |
| `path` | `merge` (o FamilySearch aceita), `relink` (alguém está vivo) ou `blocked` (o FamilySearch recusa) |
| `suggestion` | Qual fica: a única ordem aceita, ou a mais completa (fontes x3 + relacionamentos x2 + alterações) |
| `analysis` | A análise de mesclagem do FamilySearch: o que já está na sobrevivente, o que só existe na duplicata, os conflitos |
| `fingerprint` | As últimas alterações das duas, que `merge_persons` exige para provar que nada mudou desde a comparação |

Na análise, cada item é a URI de um recurso: uma conclusão (nome, sexo, fato),
uma referência de fonte ou um relacionamento. Os relacionamentos da duplicata
também são recursos: se não forem copiados, a ligação com filhos, pais ou
cônjuge some. Por isso `merge_persons` copia por padrão tudo o que só existe na
duplicata, e `skip_copy` é a exceção explícita.

## O cache

`cache.<env>.db`, SQLite, preenchido só pelo `sync`. Uma escrita que chegou ao
FamilySearch (aplicada, em parte ou incerta) não grava dados no cache: apaga a
data da linhagem e a marca de "detalhada" das pessoas que tocou, para o próximo
`sync` reler a linhagem e essas pessoas. Uma mesclagem aplicada também marca a
duplicata como mesclada na sobrevivente. Se o cache ainda não existe, a escrita
não o cria.

| Tabela | Conteúdo |
| --- | --- |
| `persons` | Nome, partes do nome, sexo, se está viva, intervalo de vida, nascimento e falecimento (`original`, `formal` e lugar), número de ascendência e geração (só para quem está na linhagem), contagens de fontes, sugestões de registros e possíveis duplicatas, quando foi detalhada, em quem foi mesclada, e o GEDCOM X cru (`raw`) |
| `relationships` | Id, `kind` (`couple` ou `parents`), `person1`, `person2` e `child` |
| `meta` | Versão do esquema, pessoa raiz, gerações pedidas, data da linhagem e do último sync |

A linhagem é quem tem número de ascendência e não foi mesclado. Pais, cônjuges
e filhos que aparecem nas famílias também entram em `persons`, sem número. Uma
contagem `null` quer dizer "ainda não detalhada", que é diferente de zero. As
migrações são só acrescentadas; uma já lançada nunca muda.

## O que não existe

Para ninguém inventar:

- Não há tool que apague uma pessoa, nem pelo `raw_get`, que só faz GET.
- Não há mesclagem em lote nem automática: uma por chamada, com pergunta.
- Desfazer uma mesclagem é parcial. `restore_person` traz a duplicata de volta,
  mas o que foi copiado para a sobrevivente continua lá.
- Lista vazia de `get_possible_duplicates` não prova que não há duplicata. O
  FamilySearch nem sempre sugere, inclusive entre duas versões claras da mesma
  pessoa.
- O beta, pelo que outros projetos relatam, não gera sugestões de registro nem
  de duplicata: `get_hints` e `get_possible_duplicates` voltam vazios lá.
- Pessoas vivas cadastradas por outros usuários não aparecem para você.
- O cache não guarda fatos além de nascimento e falecimento, nem casamento,
  fontes ou notas: para isso, as leituras ao vivo. O GEDCOM exportado traz nome,
  sexo, nascimento, falecimento, o id do FamilySearch (`_FSFTID`) e as famílias.
- As escritas não atualizam o cache, só o marcam como desatualizado. Depois de
  escrever, `sync`.
- Memórias são só leitura: não há upload de fotos nem de documentos.
- Não existe refresh do token: quando a sessão expira, é preciso um login novo
  (ou a reimportação do navegador).
