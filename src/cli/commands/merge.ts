import type { Command } from "commander";
import type { WriteOutcome } from "../../approval/run.js";
import { invoke } from "../output.js";

// `merge` and `restore`: thin argv -> tool-args mappers, like every command.

const collect = (value: string, previous: string[]) => [...previous, value];

export const formatMergeOutcome = (result: unknown): string => {
  const out = result as WriteOutcome & { details?: string; snapshot?: string; undo?: string };
  const lines = [out.headline, "", out.message];
  if (out.status === "preview" && out.details) lines.push("", out.details);
  for (const check of out.readBack?.checks ?? []) lines.push(`${check.ok ? "  ok " : "  ERR"} ${check.what}: ${check.detail}`);
  if (out.snapshot) lines.push("", `snapshot: ${out.snapshot}`);
  if (out.undo) lines.push(out.undo);
  return lines.join("\n");
};

export function registerMergeCommands(command: (signature: string) => Command): void {
  command("merge <sobrevivente> <duplicata>")
    .description("Mescla a duplicata na sobrevivente: pergunta antes e exige digitar o id da duplicata")
    .requiredOption("--fingerprint <f>", "o fingerprint devolvido por compare")
    .requiredOption("--reason <texto>", "motivo, fica no histórico do FamilySearch")
    .option("--take <id>", "conflito em que fica a versão da duplicata (repetível)", collect, [])
    .option("--skip <id>", "item só da duplicata que não deve ser copiado (repetível)", collect, [])
    .option("--preview", "mostra o plano sem perguntar nem escrever")
    .action((survivor: string, duplicate: string, options) =>
      invoke(
        "merge_persons",
        {
          survivor_id: survivor,
          duplicate_id: duplicate,
          fingerprint: options.fingerprint,
          reason: options.reason,
          take_from_duplicate: options.take,
          skip_copy: options.skip,
          preview: options.preview,
        },
        { json: options.json ?? false, format: formatMergeOutcome },
      ),
    );

  command("restore <id>")
    .description("Restaura uma pessoa mesclada ou apagada (desfaz merge): pergunta antes")
    .requiredOption("--reason <texto>", "motivo, fica no histórico do FamilySearch")
    .option("--preview", "mostra o plano sem perguntar nem escrever")
    .action((id: string, options) =>
      invoke(
        "restore_person",
        { person_id: id, reason: options.reason, preview: options.preview },
        { json: options.json ?? false, format: formatMergeOutcome },
      ),
    );
}
