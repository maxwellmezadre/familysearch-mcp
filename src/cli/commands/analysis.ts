import type { Command } from "commander";
import type { Gap } from "../../domain/gaps.js";
import { invoke, printTable } from "../output.js";

const formatGaps = (result: unknown): string => {
  const { gaps, note } = result as { gaps: Gap[]; note?: string };
  const table = printTable(gaps, [
    ["Nº", (g) => g.number],
    ["ID", (g) => g.personId],
    ["NOME", (g) => g.name ?? ""],
    ["O QUE FALTA", (g) => g.labels.join("; ")],
    ["PONTOS", (g) => String(g.score)],
  ]);
  return note ? `${table}\n\n${note}` : table;
};

export function registerAnalysisCommands(command: (signature: string) => Command): void {
  command("gaps")
    .description("Lista o que falta na sua linhagem, a partir do cache local (rode sync antes)")
    .option("--limit <n>", "quantas pessoas mostrar (1 a 200, default 30)")
    .option("--kind <kinds...>", "só estes tipos (ex.: missing_father no_sources)")
    .action((options) =>
      invoke(
        "find_gaps",
        { limit: options.limit ? Number(options.limit) : undefined, kinds: options.kind },
        { json: options.json ?? false, format: formatGaps },
      ),
    );
}
