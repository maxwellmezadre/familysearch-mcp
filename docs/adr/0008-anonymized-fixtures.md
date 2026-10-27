# ADR-0008: Fixtures de uma figura pública, anonimizadas

Status: Aceito

## Contexto

Testes contra payloads inventados provam pouco: as armadilhas reais (um 301 de
pessoa mesclada, 204 sem corpo, o formato atom das buscas, os números de
ascendência) só aparecem no que o FamilySearch realmente devolve. Mas o
repositório é público, e uma árvore genealógica tem parentes vivos.

## Decisão

As respostas são capturadas de uma figura pública morta há mais de um século,
nunca da família de quem usa o projeto, por `scripts/capture-fixtures.ts`, em
`task/captures/` (fora do git). `scripts/anonymize-fixture.ts` gera
`test/fixtures/` a partir delas:

- todo id do FamilySearch vira um id falso do mesmo formato, por HMAC com
  `task/anonymize.salt`, de forma determinística, para que as relações entre os
  arquivos continuem valendo;
- nomes viram palavras de uma lista fixa, e texto livre escrito por usuários é
  substituído;
- pessoas vivas perdem datas e lugares, e atribuições somem;
- o script falha se um id original sobrar ou se aparecer qualquer valor de
  `task/anonymize.secrets`, a lista de valores privados da família de quem
  mantém o projeto, fora do git.

`test/fixtures.test.ts` é a guarda permanente: falha se as fixtures carregarem
e-mail, token de sessão ou o nome real da figura capturada, e, onde
`task/anonymize.secrets` existe, procura cada valor dela em todo arquivo
versionado, código e documentação inclusive.

## Consequências

Os testes rodam sobre respostas reais, e as relações entre fixtures sobrevivem:
o id da pessoa em `person.json` é o mesmo em `families.json` e em
`ancestry.json`. O salt fica fora do git, então o mapa não é reversível por
quem clona. A guarda de arquivos versionados só roda na máquina onde está a
lista de segredos; no CI ela se pula.
