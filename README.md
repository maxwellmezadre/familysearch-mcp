# familysearch-mcp

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3-black.svg)](https://bun.sh)
[![TypeScript: strict](https://img.shields.io/badge/typescript-strict-3178c6.svg)](tsconfig.json)
[![CI](https://github.com/maxwellmezadre/familysearch-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/maxwellmezadre/familysearch-mcp/actions/workflows/ci.yml)

CLI + servidor MCP para a árvore da sua conta no FamilySearch: ler pessoas,
famílias, ancestrais, descendentes e o histórico de alterações; pesquisar
registros históricos, lugares e as sugestões que o próprio FamilySearch faz;
comparar duas pessoas lado a lado e mesclar duplicatas; corrigir fatos, ligar
pais e cônjuges, anexar fontes e escrever notas. A sua linhagem vai para um
cache local, de onde saem a lista do que falta pesquisar e a exportação em
GEDCOM, sem bater no FamilySearch a cada pergunta.

Por dentro, ele fala a API documentada do FamilySearch
(`https://www.familysearch.org/platform/...`), autenticado pelo token da sua
sessão no navegador (o cookie `fssessionid`, enviado como `Bearer`), sem chave
de desenvolvedor. A árvore do FamilySearch é uma só, compartilhada pelo mundo
todo, então este projeto escreve nela de verdade. Por isso toda escrita passa
por uma pergunta na tela que só você responde: sem a sua aprovação, nada é
enviado.

## Sumário

- [Instalação](#instalação)
- [Login](#login)
- [Uso — CLI](#uso--cli)
- [Uso — MCP](#uso--mcp)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Tools](#tools)
- [Como funciona](#como-funciona)
- [Troubleshooting](#troubleshooting)
- [Documentação](#documentação)
- [Licença](#licença)

## Instalação

Requer [Bun](https://bun.sh) ≥ 1.3 (o cache usa `bun:sqlite`) e macOS para as
escritas pelo CLI e para importar a sessão do navegador. O login pela janela
usa o Google Chrome.

### Tudo de uma vez (Claude Code)

```sh
git clone https://github.com/maxwellmezadre/familysearch-mcp.git
cd familysearch-mcp
bun install
bun run setup
```

`setup` compila o binário para `~/.local/bin/familysearch`, registra o servidor
MCP `familysearch` no escopo de usuário do seu `~/.claude.json` e instala a
Skill em `~/.claude/skills/familysearch-mcp/`. Se o Dia estiver instalado, o
registro já leva `FAMILYSEARCH_IMPORT_BROWSER=dia`; outro navegador vai por
`bun run setup --import-browser=chrome`. `--dry-run` mostra o que seria feito
sem alterar nada.

### npm

```sh
npm i -g @maxwellmezadre/familysearch-mcp   # instala `familysearch` e `familysearch-mcp` no PATH
familysearch --version
```

O pacote roda com o Bun (`bun:sqlite`), então o Bun precisa estar instalado. Ele
fica disponível no npm a partir da primeira versão publicada.

### Binário único

```sh
bun run build:binary   # gera ./familysearch, sem precisar de runtime instalado
./familysearch --version
```

O binário roda tudo, inclusive o `login`: o `playwright-core` vai embutido e o
Chrome vem do sistema.

## Login

A senha nunca passa por aqui. Na produção, o caminho normal é importar a sessão
do navegador em que você já usa o FamilySearch:

```sh
familysearch login --from-browser dia   # dia, arc, chrome, chromium, brave ou edge (macOS)
familysearch login                      # usa FAMILYSEARCH_IMPORT_BROWSER, ou abre o Chrome
```

A importação lê o cookie `fssessionid` do banco de cookies do navegador, com a
chave que ele guarda no Keychain (o macOS pede permissão uma vez), e confere o
token com `GET /platform/users/current` antes de gravar. Sem navegador
configurado, `familysearch login` abre uma janela do Chrome num perfil dedicado
e espera você entrar.

O ambiente beta (`FAMILYSEARCH_ENV=beta`) entra sempre pela janela do Chrome
dedicado. Produção e beta usam o mesmo cookie no domínio `.familysearch.org`,
então entrar no beta pelo navegador do dia a dia desconectaria a produção.

A sessão fica cifrada com AES-256-GCM em
`~/.config/familysearch-mcp/session.production.enc` (ou `session.beta.enc`),
modo 0600. Detalhes, o que é gravado e como revogar:
[`docs/LOGIN.md`](docs/LOGIN.md).

## Uso — CLI

```sh
familysearch status --verify              # a sessão ainda vale?
familysearch doctor                       # o que quebrou, camada a camada

familysearch search --given Giulia --surname Rossi --birth 1890
familysearch person KWCB-AAA --sources    # fatos, datas e fontes
familysearch family KWCB-AAA              # pais, cônjuges e filhos
familysearch ancestors KWCB-AAA --generations 4
familysearch duplicates KWCB-AAA          # o que o FamilySearch acha que é duplicata
familysearch records --surname Rossi --birth-place "Treviso, Itália"

familysearch compare KWCB-AAA KWCB-BBB    # lado a lado, só lê
familysearch sync                         # baixa a sua linhagem para o cache
familysearch gaps                         # o que falta pesquisar
familysearch export --format gedcom

familysearch link-parents KWCB-CCC --father KWCB-AAA --reason "Certidão de nascimento de 1921" --preview
familysearch merge KWCB-AAA KWCB-BBB --fingerprint "<do compare>" --reason "Mesma pessoa, mesmos pais" --preview
```

Todo comando de tool aceita `--json` e imprime exatamente o que o cliente MCP
receberia. Os comandos que escrevem aceitam `--preview`, que mostra o plano sem
perguntar nem escrever. Referência completa em [`docs/CLI.md`](docs/CLI.md).

## Uso — MCP

O `setup` já registra o servidor. Manualmente:

```sh
claude mcp add -s user familysearch --env FAMILYSEARCH_IMPORT_BROWSER=dia -- /Users/você/.local/bin/familysearch mcp
```

Ou, à mão, em `~/.claude.json`:

```json
{
  "mcpServers": {
    "familysearch": {
      "type": "stdio",
      "command": "/Users/você/.local/bin/familysearch",
      "args": ["mcp"],
      "env": { "FAMILYSEARCH_IMPORT_BROWSER": "dia" }
    }
  }
}
```

Use o caminho absoluto: clientes MCP não herdam o `PATH` do seu shell. As
escritas precisam de um cliente com suporte a elicitation (a pergunta na tela);
o Claude Code tem. Num cliente sem esse suporte, as leituras funcionam e toda
escrita é recusada. Depois é só perguntar: "quem são os meus bisavós?", "essas
duas pessoas são a mesma?", "o que falta pesquisar na minha árvore?".

## Variáveis de ambiente

Todas opcionais. A tabela completa está em
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

| Variável | Default | Para quê |
| --- | --- | --- |
| `FAMILYSEARCH_CONFIG_DIR` | `~/.config/familysearch-mcp` | Onde ficam sessão, chave, cache e registro de escritas |
| `FAMILYSEARCH_ENV` | `production` | `production` (a árvore real) ou `beta` (a cópia isolada de testes) |
| `FAMILYSEARCH_SESSION_KEY` | — | Chave AES em base64 de 32 bytes; sem ela, uma é gerada em `session.key` |
| `FAMILYSEARCH_EXPORT_DIR` | `~/Downloads/familysearch-export` | O único diretório onde `export` escreve |
| `FAMILYSEARCH_READ_ONLY` | `0` | Não registra as 14 tools que gravam algo (escritas, `login`, `sync`, `export`) |
| `FAMILYSEARCH_IMPORT_BROWSER` | — | `dia` \| `arc` \| `chrome` \| `chromium` \| `brave` \| `edge` |
| `FAMILYSEARCH_BROWSER_CHANNEL` | `chrome` | `chrome`, `chromium` ou `msedge`, para o login pela janela |
| `FAMILYSEARCH_MIN_INTERVAL_MS` | `400` | Intervalo mínimo entre requisições |
| `FAMILYSEARCH_JITTER_MS` | `200` | Variação aleatória somada ao intervalo |
| `FAMILYSEARCH_WRITE_INTERVAL_MS` | `2000` | Intervalo mínimo antes de cada escrita |

Nenhuma variável desliga a trava de aprovação. Sem sessão, os comandos falham na
hora da chamada com uma mensagem que diz o que fazer, não no boot.

## Tools

São 30, iguais no MCP e no CLI. Referência gerada:
[`docs/TOOLS.md`](docs/TOOLS.md).

| Tool | Comando | Rede |
| --- | --- | --- |
| `auth_status` | `familysearch status [--verify]` | 0 (1 com `--verify`) |
| `login` | `familysearch login [--from-browser] [--fresh]` | — |
| `doctor` | `familysearch doctor` | até 3 |
| `sync` | `familysearch sync [--full]` | em blocos (1 + 4 por pessoa) |
| `search_persons` | `familysearch search` | 1 |
| `get_person` | `familysearch person <id>` | 1 (+1 por seção extra) |
| `get_family` | `familysearch family <id>` | 1 |
| `get_ancestors` | `familysearch ancestors <id>` | 1 |
| `get_descendants` | `familysearch descendants <id>` | 1 |
| `get_change_history` | `familysearch changes <id>` | 1 |
| `search_records` | `familysearch records` | 1 |
| `get_record` | `familysearch record <id>` | 1 |
| `get_hints` | `familysearch hints <id>` | 1 |
| `get_possible_duplicates` | `familysearch duplicates <id>` | 1 |
| `search_places` | `familysearch places <nome>` | 1 |
| `compare_persons` | `familysearch compare <a> <b>` | 10 (11 se der para mesclar, 8 com pessoa viva) |
| `find_gaps` | `familysearch gaps` | 0 |
| `export` | `familysearch export --format …` | 0 |
| `create_person` | `familysearch create-person` | 1 + 1 escrita + 1 |
| `update_person` | `familysearch update-person <id>` | 1 + escritas + 1 |
| `add_note` | `familysearch add-note` | até 1 + 1 escrita + 1 |
| `link_parents` | `familysearch link-parents <filho>` | até 3 + 1 escrita + 1 |
| `link_spouses` | `familysearch link-spouses <a> <b>` | 2 + 1 escrita + 1 |
| `remove_relationship` | `familysearch unlink <relacionamento>` | até 3 + 1 escrita + 1 |
| `add_source` | `familysearch add-source <pessoa>` | 2 escritas + 1 |
| `attach_record` | `familysearch attach-record <pessoa> <registro>` | 2 + 2 escritas + 1 |
| `resolve_suggestion` | `familysearch resolve <pessoa>` | 1 escrita + 1 |
| `merge_persons` | `familysearch merge <sobrevivente> <duplicata>` | 14 + 1 escrita + até 2 |
| `restore_person` | `familysearch restore <id>` | 1 + 1 escrita + 1 |
| `raw_get` | `familysearch raw <caminho>` | 1 |

Nas escritas, a conta é: leituras antes da pergunta, as escritas aprovadas e a
releitura que confere o resultado. Nenhuma delas foi provada ainda num uso real
em produção, e a descrição de cada uma avisa isso.

## Como funciona

1. O login guarda só o token `fssessionid` e o User-Agent do navegador que o
   gerou, cifrados. Toda requisição vai para o host do ambiente configurado,
   uma por vez, com intervalo e variação aleatória, e espera mais antes de cada
   escrita. Num 401 na produção, se `FAMILYSEARCH_IMPORT_BROWSER` estiver
   definido, a sessão é reimportada do navegador uma vez, em silêncio. Escritas
   nunca são repetidas sozinhas.
2. As leituras da árvore são sempre ao vivo, porque outras pessoas editam a
   árvore o tempo todo. O cache local serve à análise: `sync` baixa a linhagem
   (ancestrais e cônjuges até 8 gerações) e, para cada pessoa, a família e as
   contagens de fontes, sugestões e possíveis duplicatas. Ele trabalha em blocos
   e retoma de onde parou. `find_gaps` e `export` leem só dali, sem rede.
3. Datas genealógicas são guardadas como foram escritas, ao lado da forma
   padronizada do FamilySearch quando ela existe. Nenhuma vira um `Date`.
4. Antes de qualquer mesclagem vem `compare_persons`: fatos de cada lado,
   conflitos, sinais de que não são a mesma pessoa, a ordem que o FamilySearch
   aceita e o que a mesclagem levaria. A mesclagem confere que nada mudou desde
   a comparação, exige digitar o id da duplicata, salva as duas pessoas num
   snapshot local logo antes de enviar e relê o resultado.

### A trava de aprovação

Toda escrita monta um plano, pergunta e só então envia. No servidor MCP a
pergunta é uma elicitation: o cliente mostra um formulário a você e a resposta
volta para o servidor, sem passar pelo modelo. No CLI é um diálogo nativo do
macOS, com "Cancelar" como botão padrão, que não aceita resposta pela entrada
padrão. A aprovação vira um ticket de uso único que cobre exatamente as escritas
do plano, e a camada HTTP recusa qualquer escrita que não esteja nele.

O que ela protege: nenhuma escrita acontece pelas tools do MCP ou pelos comandos
do CLI deste projeto sem você responder à pergunta na tela, nem por excesso de
iniciativa do modelo. Sessões sem interface (`claude -p`, um CLI fora do macOS
ou sem sessão gráfica) cancelam a pergunta, e nada é escrito. Não existe
variável nem opção que desligue a trava.

O que ela não protege: quem tem acesso livre à sua máquina pode ler a sessão e
chamar a API direto, sem passar por este projeto. Nenhuma tool consegue impedir
isso. Hooks de `Elicitation` no Claude Code também poderiam responder no seu
lugar; o `doctor` avisa quando encontra algum.

### O risco de termos de uso

Usar o token da sessão do navegador na API, sem uma aplicação registrada no
FamilySearch, é zona cinza. O FamilySearch não dá chave de desenvolvedor para
projeto pessoal, e este é o caminho que sobra. Uso pessoal, sobre a sua própria
conta e em ritmo humano, reduz o risco, mas não o elimina. Se o FamilySearch
bloquear ou mudar o caminho de autenticação, o projeto para de funcionar.

Arquitetura em detalhe: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). O que a
API não expõe: [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md).

## Troubleshooting

| Sintoma | O que fazer |
| --- | --- |
| `Nenhuma sessão do FamilySearch salva` | `familysearch login` |
| `A sessão do FamilySearch expirou ou foi rejeitada` | Abra o FamilySearch no navegador e rode `familysearch login` de novo. Com `FAMILYSEARCH_IMPORT_BROWSER`, o servidor reimporta sozinho uma vez |
| `O Dia está logado no beta, não no production` | O navegador guarda um cookie só para os dois ambientes. Entre em `www.familysearch.org` no navegador, ou use `FAMILYSEARCH_ENV=beta` |
| `Não consegui ler a chave "... Safe Storage" do Keychain` | Clique em "Permitir" na janela do macOS e tente de novo |
| Escrita volta com `status: "refused"` e `o cliente MCP não suporta perguntas ao usuário` | O cliente não tem elicitation. Use o Claude Code numa sessão interativa, ou o CLI no macOS |
| Escrita volta `refused` com `cancelado pelo usuário` sem você ter visto pergunta | A sessão não tem interface (`claude -p`, SSH). Rode numa sessão interativa, na frente do Mac |
| `status: "uncertain"` ou `pode ter sido aplicada` | A escrita pode ter acontecido. Releia a pessoa antes de tentar de novo; nada é repetido sozinho |
| `alguém alterou uma das duas desde a comparação` | Rode `compare_persons` de novo e use o fingerprint novo |
| `O FamilySearch só permite mesclar na ordem inversa` | Inverta sobrevivente e duplicata e confira a prévia de novo |
| `está marcada como viva: pessoa viva não é mesclada` | Ligue os filhos à versão pública com `link_parents` e remova a ligação antiga com `remove_relationship` |
| `doctor` acusa HTTP 403 em `api` | Costuma ser bloqueio anti-bot. Abra o FamilySearch no navegador, espere alguns minutos e tente de novo |
| `O FamilySearch pediu para diminuir o ritmo (HTTP 429)` | Pare e espere alguns minutos |
| `sync` devolve `done: false` | É o esperado: ele trabalha em blocos. Chame de novo até `done: true` (o CLI já faz isso) |
| `find_gaps` diz `Rode sync primeiro` | `familysearch sync` |
| Chrome não abre no login | Instale o Google Chrome, ou `bunx playwright install chromium` e `FAMILYSEARCH_BROWSER_CHANNEL=chromium` |
| Algo mudou na API | `familysearch doctor` diz qual camada quebrou; [`docs/REDISCOVERY.md`](docs/REDISCOVERY.md) diz como remapear |

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Camadas, fluxo de leitura e de escrita, as regras que as separam |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | Todas as variáveis e os arquivos em disco |
| [`docs/USAGE.md`](docs/USAGE.md) | Do zero à primeira resposta |
| [`docs/CLI.md`](docs/CLI.md) | Todos os comandos |
| [`docs/TOOLS.md`](docs/TOOLS.md) | Referência das tools (gerada) |
| [`docs/LOGIN.md`](docs/LOGIN.md) | Como o login funciona, o que grava, como revogar |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | O modelo, as regras de datas, o cache e o que não existe |
| [`docs/INTERNAL-API.md`](docs/INTERNAL-API.md) | Os endpoints usados, os cabeçalhos e as armadilhas |
| [`docs/REDISCOVERY.md`](docs/REDISCOVERY.md) | O que fazer quando o FamilySearch mudar |
| [`docs/adr/`](docs/adr) | As decisões de projeto e por quê |

## Licença

[MIT](LICENSE). Uso pessoal, sobre a sua própria conta e em ritmo humano. Não
use isto como serviço multiusuário nem para escrever em massa na árvore
compartilhada.
