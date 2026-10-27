import type { Command } from "commander";
import { invoke } from "../output.js";

const common = (c: Command) =>
  c
    .requiredOption("--reason <text>", "motivo da alteração (mínimo 10 caracteres), fica no histórico")
    .option("--preview", "mostra o que mudaria sem perguntar nem escrever");

export function registerSourceWriteCommands(command: (signature: string) => Command): void {
  common(command("add-source <personId>").description("Cria uma fonte e a anexa à pessoa (pede aprovação)"))
    .requiredOption("--title <title>", "título da fonte")
    .option("--citation <citation>", "citação")
    .option("--url <url>", "endereço https:// da fonte")
    .action((personId: string, o) =>
      invoke("add_source", { person_id: personId, title: o.title, citation: o.citation, url: o.url, reason: o.reason, preview: o.preview }, { json: o.json ?? false }),
    );

  common(command("attach-record <personId> <recordId>").description("Anexa um registro histórico à pessoa como fonte (pede aprovação)")).action(
    (personId: string, recordId: string, o) =>
      invoke("attach_record", { person_id: personId, record_id: recordId, reason: o.reason, preview: o.preview }, { json: o.json ?? false }),
  );

  common(command("resolve <personId>").description("Aceita/rejeita um registro sugerido ou marca uma duplicata como pessoa diferente (pede aprovação)"))
    .requiredOption("--kind <kind>", "record ou duplicate")
    .requiredOption("--target <id>", "id do registro ou da outra pessoa")
    .requiredOption("--decision <decision>", "accept ou reject")
    .action((personId: string, o) =>
      invoke("resolve_suggestion", { person_id: personId, kind: o.kind, target_id: o.target, decision: o.decision, reason: o.reason, preview: o.preview }, { json: o.json ?? false }),
    );
}
