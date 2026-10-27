# ADR-0009: Escritas atrás de uma aprovação que o modelo não responde

Status: Aceito

## Contexto

Os outros projetos da casa são somente leitura. Este escreve, porque completar
a árvore é o objetivo, e escreve numa árvore compartilhada com o mundo todo,
onde um erro estraga a pesquisa de outras famílias. O Claude Code de quem usa o
projeto roda com as permissões liberadas, então o aviso normal de permissão não
aparece numa chamada de tool. O modelo também tem Bash livre: um prompt no
terminal pode ser respondido por ele, simulando um TTY. A aprovação precisa vir
por um caminho que só a pessoa responde.

## Decisão

Toda escrita monta um `WritePlan` (título, detalhes, motivo e a lista exata de
escritas) e passa por `requestApproval` em `src/approval/gate.ts`, que pergunta
pelo `Approver` do contexto:

- no servidor MCP, uma elicitation em formulário (`src/mcp/elicit.ts`): o
  servidor pede ao cliente uma pergunta direta ao usuário, e a resposta volta
  para o servidor, sem passar pelo modelo. Só `action: "accept"` com
  `approve: true` aprova; recusa, cancelamento, 10 minutos sem resposta ou um
  cliente sem suporte a elicitation valem como "não";
- no CLI, um diálogo nativo do macOS (`osascript display dialog`,
  `src/cli/dialog.ts`), com "Cancelar" como botão padrão. Ele não aceita
  resposta pela entrada padrão. Fora do macOS, ou sem sessão gráfica, a escrita
  é recusada.

Um "sim" vira um `WriteTicket` (`src/core/ticket.ts`) que cobre exatamente as
escritas do plano, uma vez cada. Só `gate.ts` emite tickets
(`test/architecture.test.ts` garante). `Http.write` consome uma entrada do
ticket por requisição e recusa método, caminho ou parâmetros que não estejam
nele; `Http.send` recusa qualquer método além de GET, HEAD e OPTIONS. O corpo
e o cabeçalho do motivo são montados antes de consumir o ticket, para que um
pedido malformado não gaste a aprovação.

Toda escrita exige um motivo de pelo menos 10 caracteres, enviado em `X-Reason`
(em ASCII, porque o Bun recusa cabeçalhos com caracteres acima de U+00FF) e
guardado completo no registro local. Toda escrita tem `preview: true`, que
devolve o plano sem perguntar. O plano completo vai para
`audit/approvals/` antes da pergunta, e cada tentativa, aprovada ou não, vai
para `audit/writes.<env>.jsonl`. Escrita nunca é repetida sozinha: só um 401,
que prova que nada foi aplicado, é repetido depois de reimportar a sessão.
Depois de aplicar, a tool relê o estado por outra leitura.

Nenhuma variável de ambiente ou opção desliga a trava.

## Consequências

O que a trava protege: nenhuma escrita acontece pelas tools do MCP ou pelos
comandos do CLI deste projeto sem a pessoa responder à pergunta na tela,
inclusive por excesso de iniciativa do modelo. Sessões sem interface
(`claude -p` responde `cancel` à elicitation na hora) nunca aprovam.

O que ela não protege: a resposta sai do caminho do modelo, mas não da
máquina. Com Bash livre e um terminal com permissão de Acessibilidade no macOS,
um `osascript` com System Events clica em "Aprovar" no diálogo e digita o id
pedido, e teclas enviadas ao terminal preenchem o formulário de elicitation do
Claude Code. A trava segura erro e excesso de iniciativa, não um modelo decidido
a contorná-la. Quem tem acesso livre à máquina também pode ler a sessão e
chamar a API direto, e nenhuma tool consegue impedir isso. Um hook de
`Elicitation` no Claude Code poderia responder no lugar da pessoa; o `doctor`
procura esses hooks nas configurações do usuário, da pasta atual, nas
configurações gerenciadas do macOS e no `hooks/hooks.json` dos plugins
instalados, e avisa.

A pergunta é curta: o Claude Code corta mensagens longas, então ela leva um
título de até 2 linhas e 200 caracteres, o caminho do plano completo e os
detalhes, que começam pelo motivo que vai para o histórico público. O diálogo
do macOS mostra até 900 caracteres de detalhe. Por isso a Skill manda mostrar a
prévia no chat antes da chamada real. Clientes MCP sem
elicitation ficam, na prática, somente leitura. Uma escrita que não aconteceu
por inteiro (`status` `refused`, `partial` ou `uncertain`) volta como erro de
tool (`isError`) no MCP e sai com código 1 no CLI, e o texto continua sendo o
resultado completo, com o motivo e o que foi enviado.
