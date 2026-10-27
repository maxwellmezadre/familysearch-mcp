import type { Command } from "commander";
import { compactObject, runTool } from "../../tools/define.js";
import { formatHuman, resolveTool, withContext, write } from "../output.js";

export function registerExportCommands(command: (signature: string) => Command): void {
  command("export")
    .description("Exporta o cache local para GEDCOM, JSON ou CSV")
    .requiredOption("--format <formato>", "gedcom, json ou csv")
    .option("--scope <escopo>", "lineage (padrão) ou all")
    .option("--include-living", "inclui dados de pessoas vivas")
    .action(async (options) => {
      try {
        await withContext(async (ctx) => {
          const tool = resolveTool(ctx.config.readOnly, "export");
          const args = compactObject({
            format: options.format,
            scope: options.scope,
            include_living: options.includeLiving,
          });
          const result = await runTool(tool, args, ctx);
          await write(options.json ? JSON.stringify(result, null, 2) : formatHuman(result));
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
