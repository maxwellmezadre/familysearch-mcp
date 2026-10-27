# Segurança

## O modelo de ameaça

O token da sessão é a conta inteira. Quem o tiver lê a árvore como você,
inclusive os parentes vivos que só você enxerga, e escreve na árvore
compartilhada em seu nome, sem senha e sem segundo fator. Por isso a sessão
fica cifrada e fora de toda saída, e toda escrita deste projeto depende de uma
resposta sua na tela.

| Proteção | Como |
| --- | --- |
| Sessão em repouso | AES-256-GCM, um arquivo por ambiente (`session.production.enc`, `session.beta.enc`), `0600`, escrita atômica. A chave vem de `FAMILYSEARCH_SESSION_KEY` ou de um `session.key` `0600` |
| Sessão em log | O token é redigido em toda linha de log, por um provedor que acompanha uma reimportação. Cabeçalhos nunca são logados |
| Sessão em resposta de tool | `auth_status` devolve ambiente, origem, usuário e idade, nunca o token |
| Destino do token | Só o host do ambiente configurado, por https. Links de outras origens são recusados e redirecionamentos não são seguidos |
| Escrita na conta | Só depois da sua aprovação: elicitation no MCP, diálogo nativo do macOS no CLI. A aprovação vira um ticket de uso único que cobre exatamente as escritas aprovadas; a camada HTTP recusa qualquer outra |
| Repetição de escrita | Nunca automática. Timeout, erro de rede e 5xx voltam como "pode ter sido aplicada"; só um 401 (prova de que nada foi aplicado) é repetido, depois de reimportar a sessão |
| Mesclagem | Comparação antes, fingerprint contra alterações no meio do caminho, o id da duplicata digitado na pergunta, snapshot das duas pessoas antes do envio, releitura depois. Pessoa viva nunca é mesclada |
| Registro local | `audit/` (`0700`) guarda cada tentativa de escrita, o texto de cada pergunta e os snapshots, em arquivos `0600` que nunca saem da máquina |
| Cache | `cache.<env>.db` `0600`, com o `umask` forçado na criação. Contém a sua linhagem, inclusive parentes vivos |
| Escrita em disco | `export` só escreve dentro de `FAMILYSEARCH_EXPORT_DIR`, e pessoas vivas saem mascaradas a menos que você peça o contrário |
| Escape hatch | `raw_get` faz só GET, e só em `/platform/...` e `/service/search/...`, com os segmentos `..` resolvidos antes da conferência |
| Modo somente leitura | `FAMILYSEARCH_READ_ONLY=1` não registra nenhuma tool que grava algo |
| Fixtures | Capturas de uma figura pública morta há mais de um século, anonimizadas com guarda de vazamento, e um teste que procura os dados da família de quem mantém o projeto em todo arquivo versionado |

### O que a trava de aprovação protege

Nenhuma escrita acontece pelas tools do MCP ou pelos comandos do CLI deste
projeto sem uma resposta à pergunta na tela. Isso segura o erro e o excesso de
iniciativa do modelo: a chamada de tool não tem como se aprovar, porque a
elicitation vai do servidor para o cliente e volta, e o diálogo nativo do macOS
não lê a entrada padrão. Sessões sem interface (`claude -p`, CLI fora do macOS
ou sem sessão gráfica) cancelam a pergunta, e nada é escrito. Nenhuma variável
de ambiente e nenhuma opção desligam a trava.

### O que ela não protege

A trava tira a resposta do caminho do modelo, mas não da máquina. Se o modelo
tem Bash livre e o aplicativo de terminal tem permissão de Acessibilidade
(Ajustes do Sistema, Privacidade e Segurança, Acessibilidade), um `osascript`
com System Events consegue clicar em "Aprovar" no diálogo do macOS e digitar o
id da duplicata. Teclas enviadas do mesmo jeito à janela do terminal podem
preencher o formulário de elicitation do Claude Code. A trava não segura um
modelo decidido a contorná-la. Se isso importa para você, tire a permissão de
Acessibilidade do terminal onde o Claude Code roda, ou não deixe o Bash livre
nas sessões que escrevem.

Quem tem acesso livre à sua máquina pode ler a sessão (o arquivo cifrado e a
chave ao lado) e chamar a API do FamilySearch direto, sem passar por este
projeto. Nenhuma tool consegue impedir isso. Um hook de `Elicitation` ou
`ElicitationResult` configurado no Claude Code também pode responder à pergunta
no seu lugar. O `doctor` procura esses hooks em `~/.claude/settings.json`, no
`.claude/` da pasta atual, em
`/Library/Application Support/ClaudeCode/managed-settings.json` e no
`hooks/hooks.json` de cada plugin em `~/.claude/plugins`, e avisa quando acha
algum. Hooks declarados em outro lugar ficam fora dessa busca.

### Termos de uso

Usar o token da sessão do navegador na API, sem uma aplicação registrada no
FamilySearch, é zona cinza. Uso pessoal, sobre a sua própria conta e em ritmo
humano, reduz o risco, mas não o elimina: o FamilySearch pode bloquear a conta
ou o caminho de autenticação.

## Nunca faça

- Não cole `session.*.enc`, `session.key`, `cache.*.db`, o conteúdo de `audit/`
  nem um cabeçalho `Authorization` numa issue, num log ou num prompt.
- Não configure hooks que respondam à elicitation sozinhos.
- Não commite nada de `task/`: é onde ficam as capturas cruas, o salt e a lista
  de valores privados.
- Não rode este projeto contra a conta de outra pessoa.

## Revogando uma sessão

```sh
rm ~/.config/familysearch-mcp/session.production.enc
rm ~/.config/familysearch-mcp/session.beta.enc
```

Isso apaga a cópia local. O token é o próprio cookie de sessão do navegador de
onde ele veio, então, para encerrá-lo do lado do FamilySearch, saia da conta
nesse navegador (no Dia, ou na janela do perfil dedicado). Sem isso, ele vale
até o FamilySearch expirar a sessão.

## Reportando

Não abra uma issue pública para uma vulnerabilidade. Reporte por
[GitHub Security Advisories](https://github.com/maxwellmezadre/familysearch-mcp/security/advisories/new),
com passos de reprodução.
