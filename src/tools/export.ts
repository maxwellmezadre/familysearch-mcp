import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Type } from "@sinclair/typebox";
import { toCsv } from "../export/csv.js";
import { type ExportData, toExportPerson, toGedcom } from "../export/gedcom.js";
import { defineTool } from "./define.js";

const EXT = { gedcom: "ged", json: "json", csv: "csv" } as const;

export const exportTool = defineTool({
  name: "export",
  description:
    "Exporta o cache local (rode sync antes) para um arquivo em GEDCOM 5.5.1, JSON ou CSV, na pasta de " +
    "exportação (FAMILYSEARCH_EXPORT_DIR). Por padrão exporta a linhagem; scope=all exporta todo o cache. " +
    "Pessoas vivas saem sem datas nem lugares, com o nome 'Pessoa viva', a menos que include_living=true. " +
    "Não usa a rede.",
  readOnly: false,
  input: Type.Object({
    format: Type.Union([Type.Literal("gedcom"), Type.Literal("json"), Type.Literal("csv")], {
      description: "gedcom, json ou csv",
    }),
    scope: Type.Optional(
      Type.Union([Type.Literal("lineage"), Type.Literal("all")], {
        description: "lineage (padrão) ou all",
      }),
    ),
    include_living: Type.Optional(Type.Boolean({ description: "Inclui dados de pessoas vivas (default false)" })),
  }),
  run: (args, ctx) => {
    const repo = ctx.cache();
    const cached = args.scope === "all" ? repo.allPersons() : repo.lineage();
    if (cached.length === 0) throw new Error("O cache está vazio. Rode sync primeiro.");

    const maskedLiving = args.include_living ? 0 : cached.filter((p) => p.living).length;
    const persons = cached.map((p) => toExportPerson(p, !args.include_living));
    const ids = new Set(persons.map((p) => p.id));
    const relationships = repo
      .relationships()
      .filter((r) => [r.person1, r.person2, r.child].every((id) => id === null || ids.has(id)));
    const at = new Date(ctx.now());
    const data: ExportData = { rootId: repo.getMeta("root_id") ?? cached[0]?.id ?? "", persons, relationships };

    const content =
      args.format === "gedcom"
        ? toGedcom(data, at)
        : args.format === "csv"
          ? toCsv(persons, ctx.config.baseUrl)
          : `${JSON.stringify(data, null, 2)}\n`;

    const dir = resolve(ctx.config.exportDir);
    const path = resolve(join(dir, `familysearch-${data.rootId}-${at.toISOString().slice(0, 10)}.${EXT[args.format]}`));
    if (!path.startsWith(dir + sep)) throw new Error(`Caminho fora da pasta de exportação: ${path}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(path, content, { mode: 0o600 });
    chmodSync(path, 0o600);
    return { path, persons: persons.length, relationships: relationships.length, maskedLiving };
  },
});

export const exportTools = [exportTool];
