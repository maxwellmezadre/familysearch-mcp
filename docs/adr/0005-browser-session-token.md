# ADR-0005: O token da sessão do navegador na API documentada

Status: Aceito

## Contexto

O FamilySearch tem uma API documentada (`/platform/...`), mas o acesso oficial
exige uma aplicação registrada, com chave de desenvolvedor e OAuth, e essa
chave não é dada a projeto pessoal. Os projetos públicos avaliados ou exigiam a
chave, ou falavam os serviços internos do site, menos estáveis que a API
documentada. O site, por sua vez, guarda a sessão no cookie `fssessionid`, e a
API aceita esse valor como token OAuth.

## Decisão

Autenticar na API documentada com `Authorization: Bearer <fssessionid>` e o
User-Agent do navegador de onde a sessão veio. O token vem de um navegador em
que o usuário já está logado (importado do banco de cookies no macOS) ou de um
login interativo num perfil dedicado do Chrome. A ferramenta nunca vê a senha.
Um login só termina quando `GET /platform/users/current` aceita o token.

A busca de registros históricos é a única chamada fora da `/platform`: ela está
no serviço do site `/service/search/hr/v2/personas`, com o mesmo token.

## Consequências

Funciona sem chave de desenvolvedor, sobre a API mais estável que existe. Em
troca, o caminho de autenticação não é oficial e fica em zona cinza nos termos
de uso: o README e o `SECURITY.md` dizem isso. Não há refresh do token: quando a
sessão expira, a ferramenta reimporta do navegador (uma vez, na produção, se
configurado) ou devolve um erro que diz o que fazer, e nunca tenta logar
sozinha. O token equivale à conta inteira, daí a cifragem em repouso
(ADR-0006).
