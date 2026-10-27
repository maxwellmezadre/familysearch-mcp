# Tools

> Gerado por `bun run docs:tools` a partir de `src/tools/registry.ts`. Não edite à mão.

O servidor expõe **25 tools**. Com `FAMILYSEARCH_READ_ONLY=1` as 10 que escrevem algo (conta, sessão, cache, arquivo) não são registradas.

| Tool | Tipo | O que faz |
| --- | --- | --- |
| [`auth_status`](#authstatus) | leitura | Diz se há uma sessão do FamilySearch salva, em qual ambiente (produção ou beta), de onde veio (Dia ou login no… |
| [`login`](#login) | escrita | Entra no FamilySearch e guarda a sessão cifrada (a senha nunca passa por aqui). Na produção, importa a sessão … |
| [`doctor`](#doctor) | leitura | Diagnóstico camada a camada: configuração, arquivo de sessão, token (ambiente certo), API (users/current), lei… |
| [`search_persons`](#searchpersons) | leitura | Busca pessoas na árvore compartilhada do FamilySearch por nome, sexo, datas, lugares e nomes de pai, mãe ou cô… |
| [`get_person`](#getperson) | leitura | Lê uma pessoa da árvore: nomes, sexo, se está viva, todos os fatos (nascimento, morte, residência...) com a da… |
| [`get_family`](#getfamily) | leitura | Família direta de uma pessoa: pais (com o id do relacionamento pai/mãe e filho), cônjuges (com o casamento) e … |
| [`get_ancestors`](#getancestors) | leitura | Ancestrais de uma pessoa até 8 gerações, cada um com o número de ascendência do FamilySearch (1 é a pessoa, 2 … |
| [`get_descendants`](#getdescendants) | leitura | Descendentes de uma pessoa até 4 gerações, cada um com o número de descendência do FamilySearch (1.1 é o prime… |
| [`get_change_history`](#getchangehistory) | leitura | Histórico de alterações de uma pessoa na árvore, do mais recente ao mais antigo: quando, quem e o quê. Serve p… |
| [`search_records`](#searchrecords) | leitura | Busca registros históricos indexados no FamilySearch (nascimentos, casamentos, óbitos, censos, jornais...). De… |
| [`get_record`](#getrecord) | leitura | Lê um registro histórico: a coleção, todas as pessoas citadas nele (a principal primeiro, com nomes e fatos), … |
| [`get_hints`](#gethints) | leitura | Sugestões de registros do próprio FamilySearch para uma pessoa da árvore (os 'hints' da página), com a confian… |
| [`get_possible_duplicates`](#getpossibleduplicates) | leitura | Possíveis duplicatas de uma pessoa na árvore, segundo o FamilySearch, com a confiança (1 a 5) e o link de cada… |
| [`search_places`](#searchplaces) | leitura | Busca lugares padronizados do FamilySearch pelo nome e devolve o nome completo (com município, estado e país),… |
| [`compare_persons`](#comparepersons) | leitura | Compara duas pessoas da árvore lado a lado para decidir se são a mesma: fatos só de um lado, conflitos (ex.: d… |
| [`create_person`](#createperson) | escrita | Cria uma pessoa nova na árvore compartilhada do FamilySearch, com nome, sexo e, se houver, nascimento e faleci… |
| [`update_person`](#updateperson) | escrita, destrutiva | Altera uma pessoa: acrescenta fatos (add_facts), altera fatos existentes (update_facts, por fact_id; o que não… |
| [`add_note`](#addnote) | escrita | Acrescenta uma nota a uma pessoa (person_id) ou a um relacionamento (relationship_id com relationship_kind): e… |
| [`link_parents`](#linkparents) | escrita | Liga uma criança a um pai, uma mãe ou aos dois. Se já existe um relacionamento com exatamente esses pais, avis… |
| [`link_spouses`](#linkspouses) | escrita | Liga duas pessoas como casal, com data e lugar do casamento se informados. Se o casal já existe, avisa e não e… |
| [`remove_relationship`](#removerelationship) | escrita, destrutiva | Remove uma ligação de casal ou de pais e filho (pelo id do relacionamento, que get_family mostra). As pessoas … |
| [`add_source`](#addsource) | escrita | Cria uma fonte (título, citação e endereço opcionais) e a anexa a uma pessoa. Pergunta ao usuário numa pergunt… |
| [`attach_record`](#attachrecord) | escrita | Anexa um registro histórico a uma pessoa como fonte (título: nome principal e coleção; endereço: o link do reg… |
| [`resolve_suggestion`](#resolvesuggestion) | escrita | Responde a uma sugestão do FamilySearch: aceita ou rejeita um registro sugerido (kind record) ou marca uma dup… |
| [`raw_get`](#rawget) | leitura | Faz um GET direto na API do FamilySearch (mesma sessão, mesmo ritmo), para redescobrir um endpoint quando o fo… |

## `auth_status`

Diz se há uma sessão do FamilySearch salva, em qual ambiente (produção ou beta), de onde veio (Dia ou login no navegador), de quem é e há quanto tempo foi salva. Não usa a rede por padrão; com verify=true gasta 1 requisição para confirmar que o FamilySearch ainda aceita a sessão. Comece por aqui quando outra tool reclamar de sessão. Nunca mostra o token.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `verify` | boolean | — | Também faz 1 chamada ao FamilySearch para confirmar a sessão |

## `login`

Entra no FamilySearch e guarda a sessão cifrada (a senha nunca passa por aqui). Na produção, importa a sessão do navegador já logado (from_browser, ou FAMILYSEARCH_IMPORT_BROWSER, ex.: dia); sem navegador configurado, abre uma janela do Chrome e espera o login (até 15 minutos). No beta, sempre abre a janela. Prefira o comando `familysearch login` quando o cliente MCP tiver timeout curto.

**Tipo:** escrita

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `from_browser` | `dia` \| `arc` \| `chrome` \| `chromium` \| `brave` \| `edge` | — | Importa a sessão de um navegador já logado (só macOS, só produção) |
| `fresh` | boolean | — | Apaga o perfil do navegador dedicado antes de abrir (login do zero) |
| `timeout_seconds` | integer (≥ 60, ≤ 900) | — | Tempo máximo esperando o login na janela (default 300) |

## `doctor`

Diagnóstico camada a camada: configuração, arquivo de sessão, token (ambiente certo), API (users/current), leitura da árvore e busca. Para na primeira camada que falha e diz o que fazer. Use quando qualquer outra tool falhar de um jeito inesperado. Até 3 requisições.

**Tipo:** leitura

Sem parâmetros.

## `search_persons`

Busca pessoas na árvore compartilhada do FamilySearch por nome, sexo, datas, lugares e nomes de pai, mãe ou cônjuge. Devolve cada resultado com a confiança do FamilySearch (1 a 5; 3 ou mais costuma ser a mesma pessoa) e o score. Datas aproximadas ('abt 1850', '3 de março de 1921') viram o ano; intervalos e décadas são ignorados. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `given_name` | string (min 1 chars) | — | Prenome(s) |
| `surname` | string (min 1 chars) | — | Sobrenome |
| `gender` | `male` \| `female` | — | Sexo |
| `birth_date` | string (min 1 chars) | — | Data ou ano de nascimento |
| `birth_place` | string (min 1 chars) | — | Lugar de nascimento |
| `death_date` | string (min 1 chars) | — | Data ou ano de falecimento |
| `death_place` | string (min 1 chars) | — | Lugar de falecimento |
| `father_name` | string (min 1 chars) | — | Nome completo do pai |
| `mother_name` | string (min 1 chars) | — | Nome completo da mãe |
| `spouse_name` | string (min 1 chars) | — | Nome completo do cônjuge |
| `limit` | integer (≥ 1, ≤ 50) | — | Máximo de itens (default 10) |

## `get_person`

Lê uma pessoa da árvore: nomes, sexo, se está viva, todos os fatos (nascimento, morte, residência...) com a data como foi escrita e a padronizada, e o link da página. Com include, também as fontes, notas e memórias. 1 requisição, mais 1 por item de include. Se o id foi mesclado, o erro diz em qual pessoa.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `include` | array | — | Seções extras: sources, notes, memories |

## `get_family`

Família direta de uma pessoa: pais (com o id do relacionamento pai/mãe e filho), cônjuges (com o casamento) e os filhos de cada casal. Filhos registrados sem o outro genitor aparecem num casal sem cônjuge. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |

## `get_ancestors`

Ancestrais de uma pessoa até 8 gerações, cada um com o número de ascendência do FamilySearch (1 é a pessoa, 2 o pai, 3 a mãe, 4 e 5 os avós paternos; '-S' é cônjuge). Bom para achar quem está sem pai ou sem mãe. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `generations` | integer (≥ 1, ≤ 8) | — | Gerações (1 a 8, default 4) |

## `get_descendants`

Descendentes de uma pessoa até 4 gerações, cada um com o número de descendência do FamilySearch (1.1 é o primeiro filho, 1.1.1 o primeiro neto; '-S1' é cônjuge). 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `generations` | integer (≥ 1, ≤ 4) | — | Gerações (1 a 4, default 2) |

## `get_change_history`

Histórico de alterações de uma pessoa na árvore, do mais recente ao mais antigo: quando, quem e o quê. Serve para saber se alguém mexeu na pessoa recentemente antes de editar ou mesclar. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `limit` | integer (≥ 1, ≤ 100) | — | Máximo de itens (default 20) |

## `search_records`

Busca registros históricos indexados no FamilySearch (nascimentos, casamentos, óbitos, censos, jornais...). Devolve, para cada registro, o nome principal, a coleção, o evento com data e lugar, a confiança e o link. Datas aproximadas viram o ano. Use get_record para ver todas as pessoas de um registro. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `given_name` | string (min 1 chars) | — | Prenome(s) |
| `surname` | string (min 1 chars) | — | Sobrenome |
| `birth_date` | string (min 1 chars) | — | Data ou ano de nascimento |
| `birth_place` | string (min 1 chars) | — | Lugar de nascimento |
| `death_date` | string (min 1 chars) | — | Data ou ano de falecimento |
| `death_place` | string (min 1 chars) | — | Lugar de falecimento |
| `collection_id` | string (min 1 chars) | — | Id de uma coleção específica (o número no link da coleção) |
| `limit` | integer (≥ 1, ≤ 50) | — | Máximo de itens (default 10) |

## `get_record`

Lê um registro histórico: a coleção, todas as pessoas citadas nele (a principal primeiro, com nomes e fatos), o link da imagem quando existe e o link do registro. O id é o que aparece em search_records ou no link ark:/61903/1:1:<id>. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `record_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id do registro (ex.: Q5SN-NK1T) |

## `get_hints`

Sugestões de registros do próprio FamilySearch para uma pessoa da árvore (os 'hints' da página), com a confiança de cada uma. Lista vazia quando não há sugestão pendente. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |

## `get_possible_duplicates`

Possíveis duplicatas de uma pessoa na árvore, segundo o FamilySearch, com a confiança (1 a 5) e o link de cada uma. Lista vazia não prova que não exista duplicata: o FamilySearch nem sempre sugere. Para conferir um par suspeito, use compare_persons. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |

## `search_places`

Busca lugares padronizados do FamilySearch pelo nome e devolve o nome completo (com município, estado e país), o tipo e o id, na ordem de relevância da API. Útil para escrever fatos com o lugar certo. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `name` | string (min 2 chars) | sim | Nome do lugar (ex.: Garibaldi, Bento Gonçalves) |
| `limit` | integer (≥ 1, ≤ 50) | — | Máximo de itens (default 10) |

## `compare_persons`

Compara duas pessoas da árvore lado a lado para decidir se são a mesma: fatos só de um lado, conflitos (ex.: duas datas de nascimento), sinais de que NÃO são a mesma pessoa (sexo, anos, pais ou cônjuges diferentes), se o FamilySearch permite mesclar e em que ordem, qual deveria ficar e o que a mesclagem levaria. Só lê. Custa 10 requisições, 11 quando a mesclagem é permitida, 8 quando alguém está vivo. Mostre os sinais de alerta ao usuário antes de qualquer decisão.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_a` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `person_b` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |

## `create_person`

Cria uma pessoa nova na árvore compartilhada do FamilySearch, com nome, sexo e, se houver, nascimento e falecimento. Informe death (ou deceased: true) para falecida, ou living: true para viva. Antes de planejar, busca pessoas parecidas: se achar candidatas fortes, a pergunta avisa e exige digitar 'criar'. Pergunta ao usuário numa pergunta na tela; nada é escrito sem aprovação. Custa 1 requisição de busca antes da escrita, mais 1 de releitura depois. Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `given_name` | string (min 1 chars) | sim | Prenome(s) |
| `surname` | string (min 1 chars) | sim | Sobrenome |
| `gender` | `male` \| `female` \| `unknown` | sim | Sexo |
| `living` | boolean | — | true se a pessoa está viva (fica privada) |
| `deceased` | boolean | — | true se faleceu mas a data não é conhecida |
| `birth` | object | — |  |
| `death` | object | — |  |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `update_person`

Altera uma pessoa: acrescenta fatos (add_facts), altera fatos existentes (update_facts, por fact_id; o que não for dito é mantido), remove fatos (remove_fact_ids), muda o sexo ou acrescenta um nome. Lê a pessoa antes e recusa ids de fato que não existem. Pergunta ao usuário numa pergunta na tela; nada é escrito sem aprovação. Custa 1 requisição de leitura antes, 1 escrita para tudo que é adição ou alteração, 1 por remoção, e 1 de releitura depois. Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita, destrutiva

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `add_facts` | array | — | Fatos novos |
| `update_facts` | array | — | Fatos existentes a alterar; só os campos dados mudam |
| `remove_fact_ids` | array | — | Ids dos fatos a remover |
| `gender` | `male` \| `female` | — | Novo sexo |
| `add_name` | object | — | Nome alternativo a acrescentar |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `add_note`

Acrescenta uma nota a uma pessoa (person_id) ou a um relacionamento (relationship_id com relationship_kind): exatamente um alvo. Pergunta ao usuário numa pergunta na tela; nada é escrito sem aprovação. Custa 1 requisição de leitura antes (só para pessoa) e 1 de releitura depois. Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | — | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `relationship_id` | string (`^[A-Za-z0-9][A-Za-z0-9._-]*$`) | — | Id do relacionamento (use com relationship_kind) |
| `relationship_kind` | `couple` \| `parents` | — | couple (casal) ou parents (pais e filho) |
| `subject` | string (min 1 chars) | sim | Título da nota |
| `text` | string (min 1 chars) | sim | Texto da nota |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `link_parents`

Liga uma criança a um pai, uma mãe ou aos dois. Se já existe um relacionamento com exatamente esses pais, avisa e não escreve. Pergunta ao usuário numa janela na tela antes de escrever. Custa 1 requisição de leitura da família, até 2 para os nomes dos pais, 1 de escrita e 1 de releitura. Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `child_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `parent1_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | — | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `parent2_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | — | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `link_spouses`

Liga duas pessoas como casal, com data e lugar do casamento se informados. Se o casal já existe, avisa e não escreve. Pergunta ao usuário numa janela na tela antes de escrever. Custa 1 requisição de leitura da família, 1 para o nome da segunda pessoa, 1 de escrita e 1 de releitura. Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person1_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `person2_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `marriage` | object | — |  |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `remove_relationship`

Remove uma ligação de casal ou de pais e filho (pelo id do relacionamento, que get_family mostra). As pessoas continuam na árvore. Pergunta ao usuário numa janela na tela antes de apagar. Custa 1 requisição para ler o relacionamento, até 2 para os nomes, 1 de escrita e 1 de releitura (que deve dar 404 ou 410). Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita, destrutiva

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `relationship_id` | string (`^[A-Za-z0-9][A-Za-z0-9._-]*$`) | sim |  |
| `kind` | `couple` \| `parents` | sim | couple (casal) ou parents (pais e filho) |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `add_source`

Cria uma fonte (título, citação e endereço opcionais) e a anexa a uma pessoa. Pergunta ao usuário numa pergunta na tela antes de escrever. Custa 2 escritas, mais 1 requisição de releitura. Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `title` | string (min 1 chars) | sim | Título da fonte |
| `citation` | string (min 1 chars) | — | Citação da fonte |
| `url` | string | — | Endereço (https://) onde a fonte está |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `attach_record`

Anexa um registro histórico a uma pessoa como fonte (título: nome principal e coleção; endereço: o link do registro). Se o registro já está anexado, avisa e não escreve. Pergunta ao usuário numa pergunta na tela antes de escrever. Custa 2 requisições de leitura antes, 2 escritas e 1 releitura. Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `record_id` | string (`^[A-Za-z0-9][A-Za-z0-9._-]*$`) | sim | Id do registro (de search_records ou get_possible_record_matches) |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `resolve_suggestion`

Responde a uma sugestão do FamilySearch: aceita ou rejeita um registro sugerido (kind record) ou marca uma duplicata sugerida como pessoa diferente (kind duplicate, só rejeitar). Para juntar duplicatas use compare_persons e merge_persons. Pergunta ao usuário numa pergunta na tela antes de escrever. Custa 1 escrita e 1 releitura. Com preview: true mostra o plano sem perguntar nem escrever. Ainda não provada em produção.

**Tipo:** escrita

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `person_id` | string (`^[A-Z0-9]{4}-[A-Z0-9]{3,4}$`) | sim | Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX) |
| `kind` | `record` \| `duplicate` | sim | record = registro sugerido; duplicate = possível duplicata |
| `target_id` | string (`^[A-Za-z0-9][A-Za-z0-9._-]*$`) | sim | Id do registro (kind record) ou da outra pessoa (kind duplicate) |
| `decision` | `accept` \| `reject` | sim |  |
| `reason` | string (min 10 chars) | sim | Motivo da alteração, fica no histórico do FamilySearch |
| `preview` | boolean | — | Mostra o que mudaria sem perguntar nem escrever |

## `raw_get`

Faz um GET direto na API do FamilySearch (mesma sessão, mesmo ritmo), para redescobrir um endpoint quando o formato muda. Só caminhos /platform/... e /service/search/..., ou links do FamilySearch que apontem para eles; qualquer outro caminho é recusado, e o método é sempre GET. Use com parcimônia. 1 requisição.

**Tipo:** leitura

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `path` | string (min 2 chars) | sim | Ex.: /platform/tree/persons/KWCB-XXX/parents |
| `accept` | string | — | Accept (default application/x-fs-v1+json; buscas usam application/x-gedcomx-atom+json) |
| `max_bytes` | integer (≥ 1024, ≤ 65536) | — | Corta a resposta neste tamanho (default 65536) |
