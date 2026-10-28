# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added

- CLI `familysearch` e servidor MCP `familysearch-mcp` sobre um núcleo
  compartilhado, com 30 tools. Todo comando de tool aceita `--json`.
- Sessão: importação do token `fssessionid` de um navegador Chromium já logado
  no macOS (`dia`, `arc`, `chrome`, `chromium`, `brave`, `edge`), pelo Keychain,
  e login interativo num perfil dedicado do Chrome, um por ambiente. A sessão é
  conferida em `users/current` antes de ser gravada e fica cifrada com
  AES-256-GCM, um arquivo por ambiente (`session.production.enc`,
  `session.beta.enc`).
- `FAMILYSEARCH_ENV` (`production` ou `beta`). O beta entra sempre pelo perfil
  dedicado, porque produção e beta dividem um cookie no navegador.
- Camada HTTP serial com intervalo e variação aleatória, backoff em 429, 5xx e
  falha de rede (respeitando `Retry-After`), token enviado só ao host
  configurado, redirecionamentos não seguidos (um 301 é "mesclada em") e uma
  reimportação silenciosa da sessão do navegador num 401 na produção.
- `auth_status`, `login` e `doctor`. O `doctor` testa camada a camada
  (configuração, arquivo de sessão, token, aprovação, escritas ainda não
  provadas, API, leitura da árvore, busca) e avisa sobre hooks de
  `Elicitation` que poderiam responder à pergunta de aprovação sozinhos.
- Leitura da árvore: `search_persons`, `get_person` (com fontes, notas e
  memórias opcionais), `get_family`, `get_ancestors` (até 8 gerações),
  `get_descendants` (até 4) e `get_change_history`.
- Pesquisa: `search_records`, `get_record`, `get_hints`,
  `get_possible_duplicates` e `search_places`. Datas aproximadas viram o ano
  nas buscas; intervalos e décadas são ignorados em vez de estreitar a busca.
- `compare_persons`: lado a lado de duas pessoas com fatos de um lado só,
  conflitos, sinais de que não são a mesma pessoa (sexo, anos de nascimento ou
  falecimento, país de nascimento, pais ou cônjuges sem nome parecido), a ordem
  de mesclagem que o FamilySearch aceita, a sugestão de qual fica, a análise da
  mesclagem e um fingerprint das últimas alterações. Detecta pessoa viva e
  indica o caminho de religar em vez de mesclar.
- Trava de aprovação para toda escrita: elicitation no servidor MCP, diálogo
  nativo do macOS no CLI, ticket de uso único que cobre exatamente as escritas
  aprovadas, motivo obrigatório (mínimo de 10 caracteres, enviado em
  `X-Reason`), `preview: true` em todas as escritas e registro local em
  `CONFIG_DIR/audit/` (tentativas, texto de cada pergunta e snapshots).
  Só `FAMILYSEARCH_AUTO_APPROVE=1`, ligada por você, desliga a pergunta
  (ADR-0012): o resto da trava continua e o `doctor` avisa. Onde a pergunta exige um texto (o id da
  duplicata, "criar"), a elicitation pede para digitar e o diálogo do macOS
  pede para escolher numa lista: o macOS não entrega o teclado a um diálogo
  aberto por um processo em segundo plano.
- Escritas: `create_person` (busca parecidas antes e exige confirmar "criar" se
  achar candidatas fortes), `update_person`, `add_note`, `link_parents`,
  `link_spouses`, `remove_relationship`, `add_source`, `attach_record` e
  `resolve_suggestion`. Cada uma relê o resultado depois de aplicar, e nenhuma é
  repetida sozinha depois de um timeout, erro de rede ou 5xx.
- `merge_persons` e `restore_person`: uma mesclagem por chamada, recusada para
  pessoa viva, para fingerprint desatualizado e na ordem que o FamilySearch não
  aceita; copia por padrão tudo o que só existe na duplicata (relacionamentos
  inclusive), com `take_from_duplicate` e `skip_copy` para os conflitos e as
  exceções; exige digitar o id da duplicata na pergunta; salva as duas pessoas
  num snapshot local logo antes do envio e relê o redirecionamento e os
  relacionamentos copiados.
- `FAMILYSEARCH_WRITE_INTERVAL_MS` (padrão 2000 ms): intervalo mínimo antes de
  cada escrita.
- Cache SQLite por ambiente (`cache.production.db`, `cache.beta.db`) e `sync`
  em blocos e retomável: a linhagem (ancestrais e cônjuges até 8 gerações) e,
  para cada pessoa, a família e as contagens de fontes, sugestões de registros
  e possíveis duplicatas. Pessoas mescladas no meio do caminho são trocadas
  pela sobrevivente. O CLI repete os blocos até terminar.
- `find_gaps`: o que falta na linhagem (pai ou mãe fora da árvore, nascimento
  ou falecimento sem data e lugar, sem fontes, sugestões pendentes, possíveis
  duplicatas), ordenado por prioridade, com as gerações mais próximas primeiro.
  Lê só o cache.
- `export` em GEDCOM 5.5.1, JSON ou CSV, só dentro de `FAMILYSEARCH_EXPORT_DIR`
  e com arquivos `0600`. Pessoas vivas saem como "Pessoa viva", sem datas nem
  lugares, a menos que `include_living: true`.
- `raw_get`: GET em `/platform/...` e `/service/search/...`, para redescoberta.
  Recusa qualquer outro caminho e qualquer outro host.
- `FAMILYSEARCH_READ_ONLY=1` deixa de registrar as 14 tools que gravam algo.
- Fixtures reais de uma figura pública morta há mais de um século,
  anonimizadas por HMAC, e um teste que procura os valores privados da família
  de quem mantém o projeto em todo arquivo versionado.
- `bun run verify`, `bun run docs:tools` (gera `docs/TOOLS.md`), `bun run setup`
  (instalador com `--prefix=`, `--skip-build`, `--dry-run` e
  `--import-browser=`, que registra `dia` quando o Dia está instalado), CI,
  release com binários e publish no npm, e um teste ao vivo de leitura que só
  roda com `FAMILYSEARCH_LIVE=1`.
- README, SKILL, guias em `docs/` e as ADRs 0001 a 0012.

### Notas

- Provadas em produção: `merge_persons` (piloto real, com troca de conflito e
  releitura conferida) e `update_person` (um falecimento numa pessoa viva, que
  passou a falecida e pública com o mesmo id). As outras escritas foram
  provadas só no beta; a descrição delas avisa isso, e o `doctor` lista quais
  são.
- Uma escrita marca as pessoas que tocou como desatualizadas no cache local;
  o próximo `sync` relê essas pessoas.

[Unreleased]: https://github.com/maxwellmezadre/familysearch-mcp/commits/HEAD
