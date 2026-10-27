import { Type } from "@sinclair/typebox";
import { GAP_KINDS, findGaps } from "../domain/gaps.js";
import { defineTool } from "./define.js";
import type { ToolDef } from "./define.js";

export const findGapsTool = defineTool({
  name: "find_gaps",
  description:
    "Aponta o que falta na sua linhagem, lendo só o cache local (rode sync antes; não usa a rede): " +
    "pai ou mãe fora da árvore, nascimento ou falecimento sem data e lugar, pessoas sem fontes, " +
    "sugestões de registros pendentes e possíveis duplicatas. Ordena por prioridade, " +
    "com as gerações mais próximas de você primeiro.",
  readOnly: true,
  input: Type.Object({
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Quantas pessoas devolver (1 a 200, default 30)" })),
    kinds: Type.Optional(
      Type.Array(Type.Union(GAP_KINDS.map((kind) => Type.Literal(kind))), {
        minItems: 1,
        description: "Só estes tipos de lacuna (default: todos)",
      }),
    ),
  }),
  run: (args, ctx) => {
    const repo = ctx.cache();
    const stats = repo.stats();
    if (stats.lineage === 0) return { gaps: [], note: "Rode sync primeiro: o cache está vazio." };
    const lineage = repo.lineage();
    // The depth the last sync asked for; otherwise the deepest generation seen.
    const asked = Number(repo.getMeta("generations"));
    const maxGeneration = asked > 0 ? asked : Math.max(...lineage.map((p) => p.generation ?? 0));
    const wanted = args.kinds ? new Set<string>(args.kinds) : null;
    const all = findGaps(lineage, maxGeneration, ctx.config.baseUrl)
      .filter((gap) => !wanted || gap.kinds.some((kind) => wanted.has(kind)));
    const gaps = all.slice(0, args.limit ?? 30);
    const notes: string[] = [];
    if (stats.pending > 0)
      notes.push(`${stats.pending} ${stats.pending === 1 ? "pessoa ainda não foi detalhada" : "pessoas ainda não foram detalhadas"} (fontes, sugestões e duplicatas); rode sync para completar.`);
    if (all.length > gaps.length) notes.push(`Mostrando ${gaps.length} de ${all.length} pessoas com lacunas.`);
    return { gaps, ...(notes.length ? { note: notes.join(" ") } : {}) };
  },
});

export const analysisTools: ToolDef[] = [findGapsTool];
