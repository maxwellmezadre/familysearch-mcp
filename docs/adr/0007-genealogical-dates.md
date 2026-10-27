# ADR-0007: Datas genealógicas, texto original mais forma padronizada

Status: Aceito

## Contexto

Os outros projetos da casa guardam dinheiro em centavos inteiros, porque é ali
que o arredondamento erra. Aqui não há dinheiro; o dado que mente com facilidade
é a data. Data genealógica raramente é exata ("abt 1850", "1921", "março de
1922", "entre 1880 e 1885"), e cada pessoa que cadastra escreve de um jeito. O
FamilySearch guarda o texto original e, quando consegue, uma forma padronizada
(`+1921-03-03`, `+1840`, `A+1850`). Converter isso num `Date` inventaria dia e
mês que ninguém registrou.

## Decisão

Toda data do projeto é um `GenDate`: `{ original, formal }`, o texto como foi
escrito e a forma padronizada do FamilySearch ou `null`. Nenhuma vira `Date`.
Mostrar usa o `original`; comparar usa o ano do `formal` e, sem ele, um ano de
quatro dígitos do `original`. Para as buscas, que só aceitam ano ou data ISO,
`normalizeSearchDate` reduz uma data aproximada ao ano e descarta intervalos e
décadas, que estreitariam a busca em vez de alargá-la. As escritas mandam a data
como o usuário a escreveu, em `original`. Na exportação GEDCOM, um `formal`
vira data GEDCOM e o resto vira frase de data.

## Consequências

Nada de precisão inventada, e a comparação entre duas pessoas não acusa
conflito só porque uma escreveu "3 mar 1921" e a outra "03 March 1921", quando
as duas têm o mesmo `formal`. Em troca, quem consome as tools precisa lidar com dois campos e com
`formal: null`. O cache guarda os dois (`birth_date` e `birth_formal`).
