import type { Command } from "commander";
import { invoke } from "../output.js";

// link-parents / link-spouses / unlink: thin argv -> tool-args mappers. The
// approval question (macOS dialog) is the only way a write goes through.

type Outcome = { status: string; headline?: string; message: string; readBack?: { checks: Array<{ what: string; ok: boolean; detail: string }> } | null };

const format = (result: unknown): string => {
  const out = result as Outcome;
  const checks = (out.readBack?.checks ?? []).map((c) => `  ${c.ok ? "ok" : "FALHOU"}: ${c.what} (${c.detail})`);
  return [out.headline, `${out.status}: ${out.message}`, ...checks].filter(Boolean).join("\n");
};

export function registerRelationshipWriteCommands(command: (signature: string) => Command): void {
  command("link-parents <child>")
    .description("Liga uma criança ao pai e/ou à mãe (pergunta antes de escrever)")
    .option("--father <id>", "id do pai")
    .option("--mother <id>", "id da mãe")
    .requiredOption("--reason <text>", "motivo (mínimo 10 caracteres), vai para o histórico")
    .option("--preview", "mostra o plano sem perguntar nem escrever")
    .action((child: string, options) =>
      invoke(
        "link_parents",
        { child_id: child, parent1_id: options.father, parent2_id: options.mother, reason: options.reason, preview: options.preview },
        { json: options.json ?? false, format },
      ),
    );

  command("link-spouses <a> <b>")
    .description("Liga duas pessoas como casal (pergunta antes de escrever)")
    .option("--marriage-date <date>", "data do casamento")
    .option("--marriage-place <place>", "lugar do casamento")
    .requiredOption("--reason <text>", "motivo (mínimo 10 caracteres), vai para o histórico")
    .option("--preview", "mostra o plano sem perguntar nem escrever")
    .action((a: string, b: string, options) =>
      invoke(
        "link_spouses",
        {
          person1_id: a,
          person2_id: b,
          marriage: options.marriageDate || options.marriagePlace ? { date: options.marriageDate, place: options.marriagePlace } : undefined,
          reason: options.reason,
          preview: options.preview,
        },
        { json: options.json ?? false, format },
      ),
    );

  command("unlink <relationshipId>")
    .description("Remove uma ligação de casal ou de pais e filho (pergunta antes de apagar)")
    .requiredOption("--kind <kind>", "couple ou parents")
    .requiredOption("--reason <text>", "motivo (mínimo 10 caracteres), vai para o histórico")
    .option("--preview", "mostra o plano sem perguntar nem escrever")
    .action((relationshipId: string, options) =>
      invoke(
        "remove_relationship",
        { relationship_id: relationshipId, kind: options.kind, reason: options.reason, preview: options.preview },
        { json: options.json ?? false, format },
      ),
    );
}
