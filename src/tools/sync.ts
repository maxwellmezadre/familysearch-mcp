import { Type } from "@sinclair/typebox";
import { runSyncChunk } from "../cache/sync.js";
import { compactObject, defineTool } from "./define.js";
import { generationsField } from "./fields.js";

export const sync = defineTool({
  name: "sync",
  description:
    "Preenche o cache local com a sua linhagem (ancestrais e cônjuges até 8 gerações) e, para cada pessoa, " +
    "a família, o número de fontes, de sugestões de registros e de possíveis duplicatas. Retoma de onde parou: " +
    "cada chamada gasta no máximo max_requests requisições (1 para a linhagem, 4 por pessoa); repita até " +
    "done=true. Com full=true relê a linhagem e refaz o detalhe de todos. Grava só no seu computador.",
  readOnly: false,
  input: Type.Object({
    max_requests: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 200, description: "Requisições por chamada (1 a 200, default 60)" }),
    ),
    generations: generationsField(8, 8),
    full: Type.Optional(Type.Boolean({ description: "Relê a linhagem e o detalhe de todos (default false)" })),
  }),
  run: (args, ctx) =>
    runSyncChunk(ctx, compactObject({ maxRequests: args.max_requests, generations: args.generations, full: args.full })),
});
