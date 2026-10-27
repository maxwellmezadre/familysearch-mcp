# Do zero à primeira resposta

## 1. Instalar

```sh
git clone https://github.com/maxwellmezadre/familysearch-mcp.git
cd familysearch-mcp
bun install
bun run setup
```

Compila o binário, instala em `~/.local/bin/familysearch`, registra o servidor
MCP no escopo de usuário do Claude Code e copia a Skill. Se o Dia estiver
instalado, o registro já leva `FAMILYSEARCH_IMPORT_BROWSER=dia`.

## 2. Entrar na conta

Abra o FamilySearch no navegador em que você já usa o site e confira que está
logado. Depois:

```sh
familysearch login --from-browser dia
```

O macOS pede acesso ao Keychain ("Dia Safe Storage") na primeira vez. Clique em
"Permitir". Sem navegador logado, `familysearch login` abre uma janela do Chrome
para você entrar. Quando terminar:

```sh
familysearch status --verify
```

```
env: production
sessionFile: /Users/você/.config/familysearch-mcp/session.production.enc
loggedIn: true
source: dia
user: {"id":"XXXXXXXX","displayName":"Giulia Rossi","personId":"KWCB-AAA"}
savedAt: 2026-10-27T12:00:00.000Z
ageMinutes: 0
verified: true
```

`personId` é você na árvore. É dali que partem a linhagem do `sync` e os
"meus avós" das perguntas.

## 3. Baixar a linhagem

```sh
familysearch sync
```

Ele baixa os seus ancestrais e os cônjuges deles até 8 gerações e, para cada
pessoa, a família e quantas fontes, sugestões de registros e possíveis
duplicatas ela tem. Trabalha em blocos de até 60 requisições e repete sozinho
até terminar, mostrando o progresso no stderr:

```
bloco 1: 57 req, 14 pessoas, 46 pendentes
bloco 2: 60 req, 15 pessoas, 31 pendentes
bloco 3: 60 req, 15 pessoas, 16 pendentes
bloco 4: 60 req, 15 pessoas, 1 pendentes
bloco 5: 4 req, 1 pessoas, 0 pendentes, pronto
```

Cada pessoa custa 4 requisições. No ritmo padrão (400 a 600 ms entre uma e
outra), uma linhagem de 100 pessoas leva uns três a quatro minutos. Se parar no
meio, o próximo `sync` continua de onde parou.

## 4. Perguntar

```sh
$ familysearch gaps --limit 3
Nº  ID        NOME            O QUE FALTA                                            PONTOS
--  --------  --------------  -----------------------------------------------------  ------
5   KWCB-EEE  Giulia Bianchi  sem pai na árvore; sem mãe na árvore; sem fontes       18.67
4   KWCB-DDD  Pietro Rossi    sem pai na árvore; 2 sugestões de registro pendentes   12.44
9   KWCB-JJJ  Anna Ferraro    sem mãe na árvore; sem data de nascimento              8
```

```sh
$ familysearch ancestors KWCB-AAA --generations 2
Nº  ID        NOME            VIDA
--  --------  --------------  ---------
1   KWCB-AAA  Giulia Rossi    Living
2   KWCB-BBB  Marco Rossi     1950-2010
3   KWCB-CCC  Lucia Conti     1952-2019
4   KWCB-DDD  Pietro Rossi    1921-1990
…
```

```sh
$ familysearch duplicates KWCB-DDD
$ familysearch compare KWCB-DDD KWCB-XXX
$ familysearch records --given Pietro --surname Rossi --birth 1921
$ familysearch export --format gedcom
```

Nada disso escreve na árvore. As escritas vêm com `--preview` primeiro:

```sh
familysearch link-parents KWCB-EEE --father KWCB-FFF --reason "Registro de batismo de 1898" --preview
```

Sem `--preview`, o mesmo comando abre um diálogo do macOS com o resumo. Só
"Aprovar" envia; "Cancelar" é o botão padrão.

## 5. Pelo Claude

Reinicie o Claude Code e pergunte em português:

- "quem são os meus bisavós?"
- "o que falta pesquisar na minha árvore?"
- "essas duas pessoas são a mesma? KWCB-DDD e KWCB-XXX"
- "tem algum registro do casamento do Pietro Rossi?"
- "junta as duas versões do meu bisavô"

O Claude usa `auth_status`, depois `sync` se precisar e então a tool certa. A
Skill em `~/.claude/skills/familysearch-mcp/` já ensina as regras que evitam
estrago numa árvore compartilhada: comparar antes de mesclar, mostrar a prévia
no chat antes de qualquer escrita e nunca decidir um conflito pelo usuário.
Cada escrita aparece como uma pergunta na tela do Claude Code, e só a sua
resposta libera o envio.

## Manutenção

```sh
familysearch sync              # continua o que ficou pendente
familysearch sync --full       # relê a linhagem e o detalhe de todos (depois de escrever, por exemplo)
familysearch doctor            # quando algo falhar de um jeito estranho
familysearch login             # quando a sessão expirar
```
