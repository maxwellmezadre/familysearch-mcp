# ADR-0012: Aprovação automática, só quando a pessoa liga

Status: Aceito. Altera a ADR-0009 no ponto "nenhuma variável de ambiente ou
opção desliga a trava".

## Contexto

No uso real, uma sessão de trabalho na árvore tem dezenas de escritas seguidas:
mesclar um casal, os filhos repetidos, os pais repetidos, corrigir lugares. A
pessoa já revisou cada uma no chat, na tabela da comparação e na prévia, e a
pergunta na tela virou só cliques repetidos, com a escolha do id da duplicata
a cada mesclagem. Quem mantém o projeto pediu para escrever sem perguntar.

## Decisão

`FAMILYSEARCH_AUTO_APPROVE=1` troca o `Approver` do servidor MCP e do CLI por
`autoApprover` (`src/approval/gate.ts`), que responde sim a todo plano,
inclusive aos que pedem confirmação. O padrão é desligado.

Todo o resto da ADR-0009 continua valendo: o motivo é obrigatório; o ticket é
de uso único e cobre só as escritas do plano; o plano completo vai para
`audit/approvals/`; cada escrita entra em `audit/writes.<env>.jsonl`, com a
resposta "aprovado automaticamente (FAMILYSEARCH_AUTO_APPROVE=1)"; a mesclagem
salva o snapshot antes e relê o resultado depois; e nenhuma escrita é repetida
sozinha. O `doctor` mostra um aviso na camada de aprovação enquanto o modo
estiver ligado.

## Consequências

Com o modo ligado, a trava deixa de segurar o excesso de iniciativa do modelo.
Qualquer sessão que tenha a variável escreve na árvore compartilhada sem a
pessoa ver antes. Sobram o registro local, o histórico público do FamilySearch
e o desfazer: `restore_person` para mesclagens, e uma nova escrita para os
fatos. Ligue o modo só onde você acompanha o chat. No MCP, coloque a variável
apenas na configuração que deve ser automática.
