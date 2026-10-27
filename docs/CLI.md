# CLI

Um comando por tool, resolvido no mesmo registry e executado pelo mesmo
`runTool` do servidor MCP. Todo comando de tool aceita `--json`. Os comandos
que escrevem exigem `--reason` (mínimo de 10 caracteres, vai para o histórico
do FamilySearch) e aceitam `--preview`, que mostra o plano sem perguntar nem
escrever.

## Sessão e diagnóstico

| Comando | O que faz |
| --- | --- |
| `familysearch status [--verify]` | A sessão salva. `--verify` gasta 1 requisição para confirmar |
| `familysearch login [--from-browser <nav>] [--fresh] [--timeout <min>]` | Importa a sessão de um navegador (`dia`, `arc`, `chrome`, `chromium`, `brave`, `edge`; macOS, só produção) ou abre o Chrome dedicado. `--fresh` apaga o perfil antes; `--timeout` em minutos (padrão 5, de 1 a 15) |
| `familysearch doctor` | Diagnóstico camada a camada, até 3 requisições |

## Cache

| Comando | O que faz |
| --- | --- |
| `familysearch sync` | Continua de onde parou e repete os blocos até terminar |
| `familysearch sync --full` | Relê a linhagem e refaz o detalhe de todos |
| `familysearch sync --generations <n>` | Gerações da linhagem, de 1 a 8 (padrão 8) |
| `familysearch sync --max-requests <n>` | Orçamento de requisições por bloco (padrão 60) |

O progresso de cada bloco sai no stderr. O CLI para quando termina ou quando um
bloco não consegue detalhar ninguém; nesse caso o resultado traz uma `note`
dizendo em quem parou.

## Árvore

| Comando | O que faz |
| --- | --- |
| `familysearch search` | Busca pessoas. `--given --surname --gender --birth --birth-place --death --death-place --father --mother --spouse --limit` |
| `familysearch person <id>` | Nomes, fatos e link. `--sources --notes --memories` acrescentam essas seções (1 requisição cada) |
| `familysearch family <id>` | Pais, cônjuges e filhos, com os ids dos relacionamentos |
| `familysearch ancestors <id> [--generations <n>]` | Ancestrais com o número de ascendência, de 1 a 8 gerações (padrão 4) |
| `familysearch descendants <id> [--generations <n>]` | Descendentes com o número de descendência, de 1 a 4 gerações (padrão 2) |
| `familysearch changes <id> [--limit <n>]` | Histórico de alterações (padrão 20) |

## Pesquisa

| Comando | O que faz |
| --- | --- |
| `familysearch records` | Registros históricos. `--given --surname --birth --birth-place --death --death-place --collection --limit` |
| `familysearch record <id>` | Um registro e todas as pessoas citadas nele |
| `familysearch hints <id>` | Registros que o FamilySearch sugere para a pessoa |
| `familysearch duplicates <id>` | Possíveis duplicatas segundo o FamilySearch |
| `familysearch places <nome> [--limit <n>]` | Lugares padronizados |

## Análise

| Comando | O que faz |
| --- | --- |
| `familysearch compare <a> <b>` | Lado a lado de duas pessoas, só lê. Termina com o `fingerprint` que `merge` exige e, quando a mesclagem é permitida, com os ids que `--take` e `--skip` aceitam |
| `familysearch gaps [--limit <n>] [--kind <tipos...>]` | O que falta na linhagem, do cache. Tipos: `missing_father`, `missing_mother`, `missing_birth`, `missing_birth_date`, `missing_birth_place`, `missing_death`, `no_sources`, `pending_hints`, `possible_duplicates` |
| `familysearch export --format gedcom\|json\|csv [--scope lineage\|all] [--include-living]` | Arquivo dentro de `FAMILYSEARCH_EXPORT_DIR`, a partir do cache |

## Escrita

Cada um abre o diálogo de aprovação do macOS antes de enviar. Fora do macOS, ou
sem sessão gráfica, a escrita é recusada.

| Comando | O que faz |
| --- | --- |
| `familysearch create-person --given --surname --gender male\|female\|unknown` | Cria uma pessoa. `--living` ou `--deceased`, `--birth-date --birth-place --death-date --death-place` |
| `familysearch update-person <id>` | `--add-fact "Tipo\|data\|lugar\|valor"`, `--update-fact "id\|Tipo\|data\|lugar\|valor"` (parte vazia mantém), `--remove-fact <id>` (os três repetíveis), `--gender`, `--add-name "Prenome\|Sobrenome"` |
| `familysearch add-note --subject --text` | Nota numa pessoa (`--person <id>`) ou num relacionamento (`--relationship <id> --kind couple\|parents`) |
| `familysearch link-parents <filho> [--father <id>] [--mother <id>]` | Liga o filho ao pai, à mãe ou aos dois num relacionamento só |
| `familysearch link-spouses <a> <b> [--marriage-date] [--marriage-place]` | Liga um casal |
| `familysearch unlink <relacionamento> --kind couple\|parents` | Remove uma ligação; as pessoas continuam na árvore |
| `familysearch add-source <pessoa> --title [--citation] [--url]` | Cria uma fonte e a anexa |
| `familysearch attach-record <pessoa> <registro>` | Anexa um registro histórico como fonte |
| `familysearch resolve <pessoa> --kind record\|duplicate --target <id> --decision accept\|reject` | Responde a uma sugestão; duplicata só aceita `reject` |

## Mesclagem

| Comando | O que faz |
| --- | --- |
| `familysearch merge <sobrevivente> <duplicata> --fingerprint <f> --reason <texto>` | Mescla a duplicata na sobrevivente. `--take <id>` (conflito em que fica a versão da duplicata) e `--skip <id>` (item da duplicata que não deve ser copiado), ambos repetíveis. O diálogo exige digitar o id da duplicata |
| `familysearch restore <id> --reason <texto>` | Restaura uma pessoa mesclada ou apagada |

## Redescoberta

| Comando | O que faz |
| --- | --- |
| `familysearch raw <caminho> [--accept <tipo>] [--max-bytes <n>]` | GET direto em `/platform/...` ou `/service/search/...`. Sempre imprime JSON |

## Servidor

| Comando | O que faz |
| --- | --- |
| `familysearch mcp` | Sobe o servidor MCP em stdio |
| `familysearch-mcp` | O mesmo, sem subcomando (o segundo binário do pacote npm) |

## Saída

O resultado vai para o stdout; erros, avisos e progresso vão para o stderr,
então `familysearch gaps --json | jq` funciona. Sem `--json`, os comandos
imprimem tabelas ou texto legível. Um erro sai com código 1. Uma escrita que
não aconteceu por inteiro também sai com código 1: recusada por você, sem como
perguntar, aplicada só em parte ou com resultado incerto. O resultado é impresso
mesmo assim, com o `status` (`refused`, `partial` ou `uncertain`) e o motivo.

## Exemplos

```sh
# o fingerprint de uma comparação, para a mesclagem
familysearch compare KWCB-AAA KWCB-BBB --json | jq -r .fingerprint

# a prévia de uma mesclagem, com os ids que --take e --skip aceitam
familysearch merge KWCB-AAA KWCB-BBB --fingerprint "<f>" --reason "Mesma pessoa: mesmos pais e mesmo batismo" --preview

# só as pessoas sem pai ou sem mãe na árvore
familysearch gaps --kind missing_father missing_mother

# um fato novo, com lugar padronizado
familysearch places "Treviso"
familysearch update-person KWCB-AAA --add-fact "Death|12 mar 1950|Treviso, Vêneto, Itália" --reason "Atestado de óbito encontrado" --preview

# a linhagem inteira em GEDCOM, sem dados de vivos
familysearch export --format gedcom
```
