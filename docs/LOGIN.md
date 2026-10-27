# Login

## Por que precisa de um navegador

A API do FamilySearch autentica por OAuth, e o OAuth exige uma aplicação
registrada, com chave de desenvolvedor, que o FamilySearch não dá para projeto
pessoal. O que sobra é o token que o próprio site usa: o cookie `fssessionid`,
criado quando você entra no navegador, que a API aceita como
`Authorization: Bearer`. A senha nunca passa por aqui; só o token, depois do
seu login no navegador.

O FamilySearch tem dois ambientes isolados, cada um com as próprias contas:
`www.familysearch.org` (a árvore real) e `beta.familysearch.org` (uma cópia
vazia para testes). Um token vale em um deles só. E os dois usam o mesmo nome de
cookie no mesmo domínio, `.familysearch.org`, então um navegador fica logado em
um ambiente por vez.

## O caminho normal

Na produção, o caminho normal é importar a sessão do navegador em que você já
usa o FamilySearch:

```sh
familysearch login --from-browser dia
```

Com `FAMILYSEARCH_IMPORT_BROWSER=dia` (o instalador já registra assim quando o
Dia está instalado), basta `familysearch login`. Sem navegador configurado, o
mesmo comando abre a janela do Chrome dedicado, descrita abaixo.

### Pela janela do Chrome dedicado

```sh
familysearch login                       # produção sem navegador configurado
FAMILYSEARCH_ENV=beta familysearch login # o beta entra sempre por aqui
```

1. Abre o Google Chrome num perfil só deste projeto
   (`~/.config/familysearch-mcp/browser-profile-<env>/`), com os sinais de
   automação desligados, e navega para a árvore.
2. Você faz o login: senha e o que mais o FamilySearch pedir. A ferramenta
   nunca vê credencial.
3. A cada 2 segundos ela procura o cookie `fssessionid` e pergunta à API
   (`GET /platform/users/current`) se ele já vale. Um cookie pode existir antes
   de o login terminar; só a API sabe quando ele é de verdade.
4. Grava o token e o User-Agent da janela, cifrados, e fecha o navegador.

Opções: `--timeout <minutos>` (padrão 5, de 1 a 15) e `--fresh` (apaga o
perfil e começa do zero).

O beta entra sempre pela janela, mesmo com `FAMILYSEARCH_IMPORT_BROWSER`
definido, e `--from-browser` é recusado no beta: entrar no beta pelo navegador
do dia a dia trocaria o cookie e desconectaria a produção.

## Importando de um navegador já logado (macOS)

```sh
familysearch login --from-browser dia   # dia | arc | chrome | chromium | brave | edge
```

1. Lê a senha que o navegador guarda no Keychain ("Dia Safe Storage", "Chrome
   Safe Storage"...). O macOS pede a sua permissão uma vez.
2. Copia o banco de cookies do navegador para uma pasta temporária (o navegador
   o mantém travado), lê o `fssessionid` de `familysearch.org` e o decifra
   (formato `v10` do Chromium no macOS).
3. Confere o token em `users/current` no ambiente configurado. Se ele não valer
   ali, confere no outro ambiente só para explicar: "o Dia está logado no beta,
   não no production".
4. Grava o token, um User-Agent com a versão do navegador e o usuário, cifrados.

Nada é automatizado no navegador e nenhuma senha de conta é lida. A sessão
passa a ser a mesma do navegador: sair da conta lá encerra também a cópia
daqui.

## O que é gravado, e onde

| Arquivo | Conteúdo |
| --- | --- |
| `~/.config/familysearch-mcp/session.production.enc` | Token, User-Agent, usuário (id, nome, pessoa na árvore), origem e data, em AES-256-GCM, modo 0600 |
| `~/.config/familysearch-mcp/session.beta.enc` | O mesmo, para o beta |
| `~/.config/familysearch-mcp/session.key` | A chave, se você não definiu `FAMILYSEARCH_SESSION_KEY`. Uma para os dois ambientes |
| `~/.config/familysearch-mcp/browser-profile-<env>/` | Perfil do Chrome dedicado, para não pedir login toda vez |

Formato do arquivo: `[0] versão | IV 12B | tag GCM 16B | ciphertext`. A
escrita é atômica (`.tmp` + rename), porque o servidor MCP pode estar gravando
uma reimportação no mesmo instante em que você roda `familysearch login` no
terminal.

O User-Agent é gravado junto e reenviado em toda requisição, porque a borda do
FamilySearch recusa clientes que não se parecem com um navegador.

## Ciclo de vida

| Evento | O que acontece |
| --- | --- |
| Outro processo faz login | A sessão é relida do disco a cada requisição: o servidor MCP usa a nova sem reiniciar |
| 401 na produção, com `FAMILYSEARCH_IMPORT_BROWSER` | Reimporta do navegador uma vez, em silêncio, e repete a leitura. Uma escrita só é repetida nesse caso, porque o 401 prova que nada foi aplicado |
| 401 sem reimportação possível | Erro acionável: abra o FamilySearch no navegador e rode `familysearch login`. O token recusado nunca é reenviado |
| Sessão de um ambiente com `FAMILYSEARCH_ENV` do outro | O `doctor` acusa na camada `token` |

O token é um cookie de sessão: vale enquanto o FamilySearch mantiver a sessão
aberta. Pelo que a documentação da API e outros projetos descrevem, isso é
cerca de uma hora sem uso e um dia no máximo, e não há como renovar sem as
credenciais de uma aplicação registrada. Manter o FamilySearch
aberto no navegador e deixar `FAMILYSEARCH_IMPORT_BROWSER` configurado faz a
reimportação resolver a maioria das expirações sem você perceber.

## Revogando

```sh
rm ~/.config/familysearch-mcp/session.production.enc
```

Isso apaga a cópia local. Para encerrar o token do lado do FamilySearch, saia da
conta no navegador de onde ele veio (o Dia, ou a janela do perfil dedicado).
