import type { Command } from "commander";
import { invoke } from "../output.js";

// create-person, update-person, add-note. List options repeat and use a
// pipe-separated value, "Tipo|data|lugar|valor" (empty parts are skipped).

const collect = (value: string, previous: string[] = []) => [...previous, value];
const parts = (value: string) => value.split("|").map((part) => part.trim());
const orUndefined = (value: string | undefined) => (value ? value : undefined);

const fact = (value: string) => {
  const [type = "", date, place, text] = parts(value);
  return { type, date: orUndefined(date), place: orUndefined(place), value: orUndefined(text) };
};
/** "id|Tipo|data|lugar|valor": an empty part keeps the fact's current value, the type included. */
export const factChange = (value: string) => {
  const [fact_id = "", ...rest] = parts(value);
  const changed = fact(rest.join("|"));
  return { fact_id, ...changed, type: orUndefined(changed.type) };
};
const event = (date?: string, place?: string) => (date || place ? { date, place } : undefined);

export function formatWrite(result: unknown): string {
  const out = result as {
    status: string;
    headline: string;
    message: string;
    person_id?: string | null;
    readBack: { checks: Array<{ what: string; ok: boolean; detail: string }> } | null;
  };
  return [
    out.headline,
    `${out.status}: ${out.message}`,
    ...(out.person_id ? [`pessoa criada: ${out.person_id}`] : []),
    ...(out.readBack?.checks ?? []).map((c) => `  ${c.ok ? "ok" : "ERRO"} ${c.what} (${c.detail})`),
  ].join("\n");
}

export function registerPersonWriteCommands(command: (signature: string) => Command): void {
  const run = (tool: string, args: Record<string, unknown>, json: boolean | undefined) =>
    invoke(tool, args, { json: json ?? false, format: formatWrite });

  command("create-person")
    .description("Cria uma pessoa na árvore (pergunta antes de escrever)")
    .requiredOption("--given <name>", "prenome(s)")
    .requiredOption("--surname <name>", "sobrenome")
    .requiredOption("--gender <gender>", "male, female ou unknown")
    .option("--living", "a pessoa está viva")
    .option("--deceased", "a pessoa faleceu (sem data conhecida)")
    .option("--birth-date <date>", "data de nascimento")
    .option("--birth-place <place>", "lugar de nascimento")
    .option("--death-date <date>", "data de falecimento")
    .option("--death-place <place>", "lugar de falecimento")
    .requiredOption("--reason <text>", "motivo (mínimo 10 caracteres), vai para o histórico do FamilySearch")
    .option("--preview", "mostra o plano sem perguntar nem escrever")
    .action((o) =>
      run(
        "create_person",
        {
          given_name: o.given,
          surname: o.surname,
          gender: o.gender,
          living: o.living,
          deceased: o.deceased,
          birth: event(o.birthDate, o.birthPlace),
          death: event(o.deathDate, o.deathPlace),
          reason: o.reason,
          preview: o.preview,
        },
        o.json,
      ),
    );

  command("update-person <id>")
    .description("Altera uma pessoa: fatos, sexo, nome (pergunta antes de escrever)")
    .option("--add-fact <fact>", 'fato novo "Tipo|data|lugar|valor" (repetível)', collect)
    .option("--update-fact <fact>", 'altera um fato "id|Tipo|data|lugar|valor"; vazio mantém (repetível)', collect)
    .option("--remove-fact <id>", "remove o fato com este id (repetível)", collect)
    .option("--gender <gender>", "male ou female")
    .option("--add-name <name>", 'nome alternativo "Prenome|Sobrenome"')
    .requiredOption("--reason <text>", "motivo (mínimo 10 caracteres), vai para o histórico do FamilySearch")
    .option("--preview", "mostra o plano sem perguntar nem escrever")
    .action((id: string, o) => {
      const name = o.addName ? parts(o.addName) : undefined;
      return run(
        "update_person",
        {
          person_id: id,
          add_facts: o.addFact?.map(fact),
          update_facts: o.updateFact?.map(factChange),
          remove_fact_ids: o.removeFact,
          gender: o.gender,
          add_name: name ? { given_name: name[0], surname: name[1] ?? "" } : undefined,
          reason: o.reason,
          preview: o.preview,
        },
        o.json,
      );
    });

  command("add-note")
    .description("Acrescenta uma nota a uma pessoa ou relacionamento (pergunta antes de escrever)")
    .option("--person <id>", "id da pessoa")
    .option("--relationship <id>", "id do relacionamento (use com --kind)")
    .option("--kind <kind>", "couple ou parents")
    .requiredOption("--subject <text>", "título da nota")
    .requiredOption("--text <text>", "texto da nota")
    .requiredOption("--reason <text>", "motivo (mínimo 10 caracteres), vai para o histórico do FamilySearch")
    .option("--preview", "mostra o plano sem perguntar nem escrever")
    .action((o) =>
      run(
        "add_note",
        {
          person_id: o.person,
          relationship_id: o.relationship,
          relationship_kind: o.kind,
          subject: o.subject,
          text: o.text,
          reason: o.reason,
          preview: o.preview,
        },
        o.json,
      ),
    );
}
