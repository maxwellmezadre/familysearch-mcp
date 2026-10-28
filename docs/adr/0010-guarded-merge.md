# ADR-0010: Mesclagem guardada

Status: Aceito

## Contexto

Mesclar é a operação mais perigosa do projeto e o motivo de ele existir. Na
árvore compartilhada, mesclar duas pessoas que só têm o mesmo nome estraga a
pesquisa de outras famílias, e desfazer é parcial: `restore` traz a duplicata
de volta, mas o que foi copiado para a sobrevivente continua lá. A análise de
mesclagem do FamilySearch trata relacionamentos como recursos, como os fatos: um
filho ligado só à duplicata perde a ligação se esse relacionamento não for
copiado. E uma pessoa marcada como viva fica no espaço privado de quem a
cadastrou e não se mescla com a versão pública.

## Decisão

A mesclagem é feita em dois passos e uma por chamada; não há mesclagem em lote
nem por regra.

1. `compare_persons` só lê: fatos de cada lado, conflitos, sinais de que não
   são a mesma pessoa, a ordem que o FamilySearch aceita (`OPTIONS` nos dois
   sentidos), a sugestão de qual fica, a análise de mesclagem e um
   `fingerprint` com a última alteração de cada uma. Com alguém vivo, nem
   pergunta sobre mesclagem e indica o caminho de religar (`link_parents` e
   `remove_relationship`).
2. `merge_persons` exige esse `fingerprint` e, antes de perguntar, relê tudo:
   recusa pessoa viva, histórico ilegível, fingerprint desatualizado (alguém
   mexeu desde a comparação) e a ordem que o `OPTIONS` não aceita. Refaz a
   análise e monta o pedido: copia por padrão tudo o que só existe na
   duplicata, relacionamentos inclusive; `take_from_duplicate` escolhe, conflito
   a conflito, a versão da duplicata; `skip_copy` deixa itens de fora. Escolhas
   que não batem com a análise são recusadas, e também as ambíguas: um id que
   aparece em mais de um conflito pede o id do outro lado.

A pergunta mostra no título quantos sinais de alerta há, lista nos detalhes o
que é copiado, o que fica de fora, o que é trocado e o que já está na
sobrevivente, e exige confirmar o id da duplicata: digitado na elicitation, escolhido
numa lista no diálogo do macOS, que não recebe o teclado quando aberto por um
processo em segundo plano. Depois do "sim" e logo antes do
`POST`, a pessoa e a família das duas são salvas em `audit/snapshots/`. Depois
do envio, a releitura confere que a duplicata responde 301 para a sobrevivente e
que cada relacionamento copiado aparece nela. `restore_person` é o desfazer
parcial, também atrás da pergunta.

## Consequências

Mesclar custa 14 requisições antes da pergunta e exige uma comparação recente,
o que é lento de propósito. O snapshot local é o que permite reconstruir à mão
o que a restauração não desfaz. Em troca da cópia por padrão, quem decide
deixar algo para trás precisa dizer isso explicitamente, e a pergunta mostra.
