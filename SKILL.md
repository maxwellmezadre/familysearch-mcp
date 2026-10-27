---
name: familysearch-mcp
description: >-
  Árvore genealógica da conta do usuário no FamilySearch via MCP `familysearch`:
  pessoas, pais, cônjuges, filhos, ancestrais, descendentes, histórico de
  alterações, registros históricos, lugares, sugestões e possíveis duplicatas,
  comparação lado a lado, mesclagem de duplicatas e escritas na árvore (fatos,
  relacionamentos, fontes, notas), sempre com aprovação do usuário na tela, além
  de cache local da linhagem, lacunas e exportação em GEDCOM. Use para perguntas
  como "quem são meus bisavós", "essas duas pessoas são a mesma", "junta as duas
  versões da minha avó", "o que falta pesquisar na minha árvore", "tem registro
  do casamento dele". Triggers: FamilySearch, árvore genealógica, árvore,
  genealogia, antepassado, ancestral, bisavô, bisavó, trisavô, avô, avó,
  sobrenome, registro de batismo, certidão, casamento, óbito, censo, duplicata,
  mesclar, juntar pessoas, linhagem, GEDCOM.
---

# FamilySearch — árvore genealógica

MCP `familysearch` (`mcp__familysearch__*`), 30 tools. Referência completa de
parâmetros em `TOOLS.md`, ao lado deste arquivo.

## Leia antes de responder

1. Comece por `auth_status`. Sem `verify` ele não usa a rede e diz se há
   sessão, em qual ambiente (produção ou beta), de quem é e há quanto tempo foi
   salva. O `user.personId` dele é a pessoa do usuário na árvore, o ponto de
   partida de "meus avós", "meus bisavós". Com `verify: true` gasta 1
   requisição e confirma que o FamilySearch ainda aceita a sessão.
2. Para juntar duplicatas, sempre `compare_persons` antes. Mostre ao usuário os
   sinais de alerta (`redFlags`) e os conflitos (`conflicts`), explique o que
   cada lado tem e pergunte o que ele escolhe. `merge_persons` só recebe o
   `fingerprint` que essa comparação devolveu.
3. Toda escrita vai primeiro com `preview: true`. Mostre o plano ao usuário no
   chat e só depois faça a chamada real. A pergunta de aprovação na tela (no
   MCP e no CLI) corta o texto: ela mostra o título e o começo dos detalhes.
   Por isso a comparação e a prévia completas precisam aparecer no chat antes
   da chamada real: a pergunta só confirma o que o usuário já leu ali.
4. Nunca escolha sozinho o que só o usuário pode decidir: qual versão fica em
   cada conflito (`take_from_duplicate`), o que deixar de copiar (`skip_copy`),
   criar uma pessoa mesmo havendo parecidas, o texto do motivo. Pergunte.
5. Pessoa viva nunca é mesclada. Quando `compare_persons` devolve
   `path: "relink"`, o caminho é ligar os filhos direto à versão pública
   (`link_parents`) e remover a ligação antiga (`remove_relationship`), cada
   escrita com a sua prévia.
6. Uma mesclagem por vez. Depois de cada uma, mostre o resultado da releitura
   (`readBack.checks`) e espere o usuário conferir antes da próxima.
7. `sync` antes de `find_gaps` e de `export`: os dois leem só o cache local.
   `sync` trabalha em blocos e devolve `done: false` enquanto houver pessoas a
   detalhar; chame de novo até `done: true`. Cada pessoa custa 4 requisições.
8. A árvore é compartilhada com o mundo todo. Na dúvida, não escreva: mostre o
   que encontrou e deixe o usuário decidir.
9. O resultado de uma escrita tem `status`. `preview`: nada foi enviado.
   `applied`: aplicado, e `readBack` diz se a releitura bateu. `refused`: nada
   foi escrito, e o `message` diz por quê. `exists` e `already_attached`: já
   estava lá, nada foi escrito. `partial` e `uncertain`: algo pode ter sido
   aplicado. Nunca repita uma escrita `uncertain`: releia a pessoa antes.
   `refused`, `partial` e `uncertain` chegam como erro de tool (`isError`), com
   o resultado completo no texto.
10. Datas genealógicas vêm com `original` (como foi escrita) e `formal` (a forma
    padronizada do FamilySearch, ou `null`). Mostre o `original`; use o
    `formal` para comparar. Não invente dia nem mês que não estão lá.
11. Sessão caída ("Rode `familysearch login`"): peça ao usuário para abrir o
    FamilySearch no navegador e rodar `familysearch login` no terminal. Nunca
    tente adivinhar o token.
12. HTTP 403 em `doctor`, ou 429: pare. É o FamilySearch pedindo calma.
    Responda com o que já tem e sugira tentar de novo em alguns minutos.
13. `doctor` quando algo falhar de um jeito estranho: ele diz qual camada
    quebrou e quais escritas ainda não foram provadas em produção.

## Tools ↔ CLI

| Tool | CLI | Para quê |
| --- | --- | --- |
| `auth_status` | `familysearch status [--verify]` | Tem sessão? De quem, em qual ambiente? |
| `login` | `familysearch login [--from-browser dia]` | Obter ou renovar a sessão |
| `doctor` | `familysearch doctor` | Qual camada quebrou |
| `sync` | `familysearch sync [--full]` | Baixar a linhagem para o cache (em blocos) |
| `search_persons` | `familysearch search --given --surname …` | Achar alguém na árvore |
| `get_person` | `familysearch person <id> [--sources --notes --memories]` | Fatos, datas, fontes de uma pessoa |
| `get_family` | `familysearch family <id>` | Pais, cônjuges, filhos e os ids dos relacionamentos |
| `get_ancestors` | `familysearch ancestors <id> [--generations]` | Avós, bisavós, até 8 gerações |
| `get_descendants` | `familysearch descendants <id> [--generations]` | Filhos e netos, até 4 gerações |
| `get_change_history` | `familysearch changes <id>` | Quem mexeu e quando |
| `search_records` | `familysearch records --surname …` | Registros históricos |
| `get_record` | `familysearch record <id>` | Todas as pessoas de um registro |
| `get_hints` | `familysearch hints <id>` | Registros que o FamilySearch sugere |
| `get_possible_duplicates` | `familysearch duplicates <id>` | Duplicatas que o FamilySearch sugere |
| `search_places` | `familysearch places <nome>` | O lugar padronizado certo |
| `compare_persons` | `familysearch compare <a> <b>` | São a mesma pessoa? Qual fica? |
| `find_gaps` | `familysearch gaps` | O que falta pesquisar (do cache) |
| `export` | `familysearch export --format gedcom` | GEDCOM, JSON ou CSV da linhagem |
| `create_person` | `familysearch create-person` | Criar alguém que não existe na árvore |
| `update_person` | `familysearch update-person <id>` | Acrescentar, corrigir ou remover fatos |
| `add_note` | `familysearch add-note` | Nota numa pessoa ou relacionamento |
| `link_parents` | `familysearch link-parents <filho>` | Ligar filho a pai e mãe |
| `link_spouses` | `familysearch link-spouses <a> <b>` | Ligar um casal |
| `remove_relationship` | `familysearch unlink <id> --kind` | Desfazer uma ligação errada |
| `add_source` | `familysearch add-source <pessoa>` | Anexar uma fonte livre |
| `attach_record` | `familysearch attach-record <pessoa> <registro>` | Anexar um registro histórico |
| `resolve_suggestion` | `familysearch resolve <pessoa>` | Aceitar ou rejeitar uma sugestão |
| `merge_persons` | `familysearch merge <sobrevivente> <duplicata>` | Mesclar duplicatas (uma por vez) |
| `restore_person` | `familysearch restore <id>` | Desfazer uma mesclagem |
| `raw_get` | `familysearch raw <caminho>` | Redescoberta quando a API mudar |

Todo comando do CLI aceita `--json`. Os que escrevem aceitam `--preview`.

## Receitas

- "Quem são meus bisavós?" → `auth_status` → `get_ancestors {person_id:
  user.personId, generations: 3}`. O número 1 é o usuário, 2 e 3 os pais, 4 a 7
  os avós, 8 a 15 os bisavós; o pai de N é 2N e a mãe, 2N+1.
- "Essas duas são a mesma pessoa?" → `compare_persons {person_a, person_b}` →
  mostre `redFlags`, `conflicts`, `onlyA`, `onlyB`, `path` e `suggestion`.
- "Junta as duas versões da minha avó" → `get_possible_duplicates` ou
  `search_persons` para achar a outra → `compare_persons` → converse sobre cada
  conflito → `merge_persons {survivor_id, duplicate_id, fingerprint, reason,
  preview: true}` → mostre `details` → `merge_persons` igual, sem `preview` (o
  usuário digita o id da duplicata na pergunta) → mostre `readBack.checks`, o
  `snapshot` e o `undo`.
- "Desfaz essa mesclagem" → `restore_person {preview: true}` → mostre →
  chamada real. Avise que o que foi copiado para a sobrevivente continua lá.
- "O que falta pesquisar na minha árvore?" → `sync` até `done: true` →
  `find_gaps`. Para um tipo só: `find_gaps {kinds: ["missing_father",
  "missing_mother"]}`.
- "Tem registro do casamento dele?" → `get_person` para nomes e datas →
  `search_records` → `get_record` do melhor candidato → se o usuário quiser,
  `attach_record {preview: true}` → chamada real.
- "Coloca a data de falecimento dela" → `get_person` → `search_places` se houver
  lugar → `update_person {add_facts: [{type: "Death", date, place}], reason,
  preview: true}` → chamada real.
- "Liga o filho aos pais" → `get_family` do filho (para ver o que já existe) →
  `link_parents {child_id, parent1_id, parent2_id, reason, preview: true}` →
  chamada real.
- "Cria o meu trisavô" → `search_persons` antes → `create_person {preview:
  true}`; se a prévia avisar pessoas parecidas, mostre-as e pergunte se é
  alguma delas.
- "Exporta a árvore em GEDCOM" → `sync` até `done: true` → `export {format:
  "gedcom"}` e informe o caminho devolvido.

## Avisos

- As escritas são reais e vão para a árvore compartilhada, com o motivo no
  histórico público da pessoa. Nenhuma foi provada ainda num uso real em
  produção (a descrição de cada uma diz isso); conte ao usuário antes da
  primeira.
- Sem uma pergunta na tela, nada é escrito: num cliente sem elicitation, ou numa
  sessão sem interface, toda escrita volta `refused`. Não existe forma de
  contornar, e não tente.
- Ritmo: uma requisição por vez, com intervalo, e mais devagar nas escritas.
  Não paralelize nada que vá à rede.
- Dados sensíveis: parentes vivos aparecem só para quem os cadastrou. Não
  exporte com `include_living: true` nem repita dados de vivos sem o usuário
  pedir.
- Uma escrita não atualiza o cache, só marca como desatualizadas as pessoas que
  ela tocou (e uma mesclagem aplicada marca a duplicata como mesclada). Depois
  de escrever, `find_gaps` e `export` só refletem a mudança após um `sync`, que
  relê a linhagem e essas pessoas.
- `get_possible_duplicates` vazio não prova que não existe duplicata: o
  FamilySearch nem sempre sugere. Procure também com `search_persons`.
- Com `FAMILYSEARCH_READ_ONLY=1`, as 14 tools que gravam algo (escritas,
  `login`, `sync`, `export`) não existem. Explique que escrever, atualizar o
  cache e exportar ficam fora do agente nesse modo.
