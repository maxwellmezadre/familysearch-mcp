# ADR-0006: Sessão cifrada em repouso, uma por ambiente

Status: Aceito

## Contexto

O token lê a árvore como o usuário, inclusive os parentes vivos que só ele
enxerga, e escreve na árvore compartilhada em nome dele. O FamilySearch tem dois
ambientes isolados, produção e beta, com contas próprias, e um token vale em um
só. Os dois ambientes usam o mesmo cookie `fssessionid` no domínio
`.familysearch.org`, então um navegador fica logado em um deles por vez.

## Decisão

Um arquivo por ambiente, `session.production.enc` e `session.beta.enc`, com
AES-256-GCM, modo 0600, layout `[0] versão | IV 12B | tag 16B | ciphertext` e
escrita atômica (`.tmp` + rename). Uma chave para os dois, de
`FAMILYSEARCH_SESSION_KEY` ou de um `session.key` gerado (0600). O token entra
na redação de toda linha de log. Cache e perfil do navegador também são
separados por ambiente.

A produção vem do navegador do dia a dia (o instalador registra o Dia quando
ele está instalado). O beta entra sempre pelo perfil dedicado do Chrome
(`browser-profile-beta/`), e `--from-browser` é recusado no beta: entrar no
beta pelo navegador do dia a dia trocaria o cookie e desconectaria a produção.

## Consequências

Um `cat` no arquivo não entrega nada, e trocar de ambiente não apaga a sessão do
outro. A chave ao lado não protege contra quem já tem a sua conta de usuário na
máquina; protege contra backup, sincronização e um `grep -r` distraído. Perder
a chave custa um login novo. A reimportação silenciosa num 401 só acontece na
produção, porque o navegador do dia a dia fica nela.
