import type { Command } from "commander";
import { runTool } from "../../tools/define.js";
import { compactObject } from "../../tools/define.js";
import { formatHuman, resolveTool, withContext, write } from "../output.js";

// The one command that loops: it calls the `sync` tool chunk after chunk, in
// one context, until nothing is pending (or a chunk makes no progress).
const MAX_CHUNKS = 100;

export function registerSyncCommands(command: (signature: string) => Command): void {
  command("sync")
    .description("Preenche o cache local com a sua linhagem (repete os blocos até terminar)")
    .option("--generations <n>", "1 a 8 (default 8)")
    .option("--full", "relê a linhagem e refaz o detalhe de todos")
    .option("--max-requests <n>", "orçamento de requisições por bloco (default 60)")
    .action(async (options) => {
      try {
        await withContext(async (ctx) => {
          const tool = resolveTool(ctx.config.readOnly, "sync");
          const args = compactObject({
            generations: options.generations ? Number(options.generations) : undefined,
            max_requests: options.maxRequests ? Number(options.maxRequests) : undefined,
            full: options.full,
          });
          let last: Record<string, unknown> = {};
          for (let chunk = 1; chunk <= MAX_CHUNKS; chunk += 1) {
            last = (await runTool(tool, chunk === 1 ? args : { ...args, full: undefined }, ctx)) as Record<string, unknown>;
            // Progress goes to stderr so stdout stays parseable.
            console.error(
              `bloco ${chunk}: ${last.requests} req, ${last.detailed} pessoas, ${last.pending} pendentes${last.done ? ", pronto" : ""}`,
            );
            // A chunk that detailed nobody and is not done is stuck (see `note`).
            if (last.done === true || last.detailed === 0) break;
          }
          await write(options.json ? JSON.stringify(last, null, 2) : formatHuman(last));
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
