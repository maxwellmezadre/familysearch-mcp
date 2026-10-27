# ADR-0003: TypeBox como fonte única do schema

Status: Aceito

## Contexto

Cada tool precisa de três coisas: o tipo estático dos argumentos, um validador
em runtime e o JSON Schema anunciado ao cliente MCP. Manter os três à mão
diverge; usar Zod exige uma ponte para JSON Schema. A configuração tem o mesmo
problema: o ambiente chega como texto e o resto do código quer números,
booleanos e caminhos absolutos.

## Decisão

Um `Type.Object({...})` por tool é as três coisas: `Static<S>` dá o tipo,
`Value.Check` valida em `runTool`, e o objeto é um JSON Schema válido, anunciado
como está. `ConfigSchema` descreve a configuração já convertida e confere o
resultado de `loadConfig`. Fragmentos repetidos (o id de pessoa com o seu
padrão, os limites, as gerações) vivem em `src/tools/fields.ts`.

## Consequências

Zero divergência entre o que o modelo vê e o que o código aceita: um id fora do
padrão `XXXX-XXX` é recusado antes de qualquer requisição. `defineTool` apaga o
genérico na fronteira para que tools de schemas diferentes convivam num mesmo
array, com o `run` ainda tipado por dentro. `docs/TOOLS.md` é gerado do mesmo
schema.
