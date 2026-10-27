import { type Static, Type } from "@sinclair/typebox";
import type { Ctx } from "../context.js";
import type { WritePlan } from "../approval/gate.js";
import { type ReadBack, runWritePlan } from "../approval/run.js";
import { toPersonDetail, toSearchHits } from "../domain/normalize.js";
import type { Fact, PersonDetail } from "../domain/types.js";
import type { GxFact } from "../familysearch/gedcomx.js";
import { getJson, readNotes, readPerson, searchTree } from "../familysearch/api.js";
import {
  type FactInput,
  deleteConclusionWrite,
  noteWrite,
  personUpdateWrite,
  createPersonWrite,
} from "../familysearch/writes.js";
import { defineTool } from "./define.js";
import { personIdField } from "./fields.js";
import { describeWrite } from "./write-status.js";

// Writes on people and notes. Everything that can be refused (bad arguments,
// unknown fact ids) is refused BEFORE the approval question, from a read.

const reasonField = Type.String({ minLength: 10, description: "Motivo da alteração, fica no histórico do FamilySearch" });
const previewField = Type.Optional(Type.Boolean({ description: "Mostra o que mudaria sem perguntar nem escrever" }));
const idField = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" });
const text = (description: string) => Type.Optional(Type.String({ minLength: 1, description }));

const eventField = (what: string) =>
  Type.Optional(Type.Object({ date: text(`Data de ${what}, como escrita`), place: text(`Lugar de ${what}`) }));

const factFields = {
  date: text("Data como escrita (ex.: 3 de março de 1921)"),
  place: text("Lugar"),
  value: text("Valor (ex.: a profissão)"),
};
const newFact = Type.Object({ type: Type.String({ minLength: 1, description: "Tipo do fato: Residence, Occupation, Baptism..." }), ...factFields });
const factChange = Type.Object({
  fact_id: idField,
  type: text("Novo tipo; omitido mantém o atual"),
  ...factFields,
});

const year = (date?: string) => /\d{4}/.exec(date ?? "")?.[0];
const fullName = (given: string, surname: string) => `${given} ${surname}`.trim();
const nameOf = (person: PersonDetail) => person.name ?? "(sem nome)";
const same = (a: string | undefined | null, b: string | undefined | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const factText = (f: FactInput) => [f.type, f.date, f.place, f.value].filter(Boolean).join(", ");
const check = (what: string, ok: boolean, detail: string) => ({ what, ok, detail });

/** A fact of the re-read person with this type and original date (the date only when one was written). */
const hasFact = (facts: Fact[], f: { type: string; date?: string }) =>
  facts.some((c) => same(c.type, f.type) && (!f.date || same(c.date?.original, f.date)));

async function loadPerson(ctx: Ctx, id: string): Promise<PersonDetail> {
  const document = await readPerson(ctx.http, id);
  return toPersonDetail(document.persons?.find((p) => p.id === id) ?? document.persons?.[0] ?? { id });
}

// ---- create_person ----------------------------------------------------------

const createInput = Type.Object({
  given_name: Type.String({ minLength: 1, description: "Prenome(s)" }),
  surname: Type.String({ minLength: 1, description: "Sobrenome" }),
  gender: Type.Union([Type.Literal("male"), Type.Literal("female"), Type.Literal("unknown")], { description: "Sexo" }),
  living: Type.Optional(Type.Boolean({ description: "true se a pessoa está viva (fica privada)" })),
  deceased: Type.Optional(Type.Boolean({ description: "true se faleceu mas a data não é conhecida" })),
  birth: eventField("nascimento"),
  death: eventField("falecimento"),
  reason: reasonField,
  preview: previewField,
});

export const createPerson = defineTool({
  name: "create_person",
  description: describeWrite(
    "create_person",
    "Cria uma pessoa nova na árvore compartilhada do FamilySearch, com nome, sexo e, se houver, nascimento e " +
      "falecimento. Informe death (ou deceased: true) para falecida, ou living: true para viva. Antes de planejar, " +
      "busca pessoas parecidas: se achar candidatas fortes, a pergunta avisa e exige digitar 'criar'. Pergunta ao " +
      "usuário numa pergunta na tela; nada é escrito sem aprovação. Custa 1 requisição de busca antes da escrita, " +
      "mais 1 de releitura depois. Com preview: true mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  input: createInput,
  run: async (args: Static<typeof createInput>, ctx: Ctx) => {
    const living = args.death ? false : args.living ? true : args.deceased ? false : undefined;
    if (living === undefined) {
      throw new Error("Diga se a pessoa está viva (living: true) ou falecida (deceased: true, ou informe death).");
    }
    const facts: FactInput[] = [
      ...(args.birth && (args.birth.date || args.birth.place) ? [{ type: "Birth", ...args.birth }] : []),
      ...(args.death ? [{ type: "Death", ...args.death }] : []),
    ];
    const name = fullName(args.given_name, args.surname);

    const feed = await searchTree(ctx.http, {
      givenName: args.given_name,
      surname: args.surname,
      ...(args.gender !== "unknown" ? { gender: args.gender } : {}),
      ...(args.birth?.date ? { birthDate: args.birth.date } : {}),
      limit: 10,
    });
    const strong = (feed ? toSearchHits(feed) : []).filter((hit) => (hit.confidence ?? 0) >= 3);
    const top = Math.max(0, ...strong.map((hit) => hit.confidence ?? 0));

    const b = year(args.birth?.date);
    const d = year(args.death?.date);
    const span = b || d ? ` (${b ?? "?"}-${d ?? "?"})` : "";
    const lines = [
      `Criar ${name}${span}`,
      strong.length > 0
        ? `ATENÇÃO: ${strong.length} pessoas parecidas já existem (maior confiança ${top})`
        : living
          ? "Pessoa viva: o registro fica privado no FamilySearch"
          : "Cria uma pessoa nova na árvore compartilhada",
    ];
    const plan: WritePlan = {
      tool: "create_person",
      reason: args.reason,
      headline: lines.join("\n"),
      details: [
        `Criar ${name}, sexo ${args.gender}, ${living ? "viva" : "falecida"}.`,
        ...facts.map((f) => `- ${factText(f)}`),
        ...(strong.length > 0
          ? [
              "",
              "Pessoas parecidas que já existem (confira antes de criar uma duplicata):",
              ...strong.map((h) => `- ${h.name ?? "(sem nome)"} [${h.id}] ${h.lifespan ?? ""} confiança ${h.confidence}`),
            ]
          : []),
      ].join("\n"),
      writes: [createPersonWrite({ givenName: args.given_name, surname: args.surname, gender: args.gender, living, facts })],
      ...(strong.length > 0 ? { confirm: { title: "Digite criar para criar mesmo assim", expected: "criar" } } : {}),
    };

    let personId: string | null = null;
    const outcome = await runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async (results): Promise<ReadBack> => {
        personId = results[0]?.entityId ?? null;
        if (!personId) return { ok: false, checks: [check("id da nova pessoa", false, "o FamilySearch não devolveu X-ENTITY-ID")] };
        const person = await loadPerson(ctx, personId);
        const checks = [
          check("nome", same(person.name, name), `lido: ${person.name ?? "(sem nome)"}`),
          ...facts.map((f) => check(`fato ${f.type}`, hasFact(person.facts, f), factText(f))),
        ];
        return { ok: checks.every((c) => c.ok), checks };
      },
    });
    return { ...outcome, person_id: personId };
  },
});

// ---- update_person ----------------------------------------------------------

const updateInput = Type.Object({
  person_id: personIdField,
  add_facts: Type.Optional(Type.Array(newFact, { description: "Fatos novos" })),
  update_facts: Type.Optional(Type.Array(factChange, { description: "Fatos existentes a alterar; só os campos dados mudam" })),
  remove_fact_ids: Type.Optional(Type.Array(idField, { description: "Ids dos fatos a remover" })),
  gender: Type.Optional(Type.Union([Type.Literal("male"), Type.Literal("female")], { description: "Novo sexo" })),
  add_name: Type.Optional(Type.Object({ given_name: Type.String({ minLength: 1 }), surname: Type.String({ minLength: 1 }) }, { description: "Nome alternativo a acrescentar" })),
  reason: reasonField,
  preview: previewField,
});

export const updatePerson = defineTool({
  name: "update_person",
  description: describeWrite(
    "update_person",
    "Altera uma pessoa: acrescenta fatos (add_facts), altera fatos existentes (update_facts, por fact_id; o que " +
      "não for dito é mantido), remove fatos (remove_fact_ids), muda o sexo ou acrescenta um nome. Lê a pessoa " +
      "antes e recusa ids de fato que não existem. Pergunta ao usuário numa pergunta na tela; nada é escrito sem " +
      "aprovação. Custa 1 requisição de leitura antes, 1 escrita para tudo que é adição ou alteração, 1 por " +
      "remoção, e 1 de releitura depois. Com preview: true mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  destructive: true,
  input: updateInput,
  run: async (args: Static<typeof updateInput>, ctx: Ctx) => {
    const adds: FactInput[] = args.add_facts ?? [];
    const changes = args.update_facts ?? [];
    const removes = args.remove_fact_ids ?? [];
    if (adds.length + changes.length + removes.length === 0 && !args.gender && !args.add_name) {
      throw new Error("Nada para alterar: informe add_facts, update_facts, remove_fact_ids, gender ou add_name.");
    }

    const document = await readPerson(ctx.http, args.person_id);
    const raw = document.persons?.find((p) => p.id === args.person_id) ?? document.persons?.[0] ?? { id: args.person_id };
    const person = toPersonDetail(raw);
    const byId = new Map(person.facts.flatMap((f) => (f.id ? [[f.id, f] as const] : [])));
    const unknown = [...changes.map((c) => c.fact_id), ...removes].filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new Error(`Fato(s) que ${person.id} não tem: ${unknown.join(", ")}. Nada foi alterado; leia a pessoa para ver os ids.`);
    }

    // An update replaces the whole conclusion on FamilySearch: start from the RAW current
    // fact (original date/place as the contributor wrote them), never the normalized one.
    // ponytail: a custom type is rebuilt from its decoded label, so it may be re-encoded differently.
    const rawFacts = new Map((raw.facts ?? []).flatMap((f) => (f.id ? [[f.id, f] as const] : [])));
    const merged = changes.map((c) => {
      const cur = rawFacts.get(c.fact_id) as GxFact;
      const date = c.date ?? cur.date?.original;
      const place = c.place ?? cur.place?.original;
      const value = c.value ?? cur.value;
      return {
        factId: c.fact_id,
        type: c.type ?? (byId.get(c.fact_id) as Fact).type,
        ...(date ? { date } : {}),
        ...(place ? { place } : {}),
        ...(value ? { value } : {}),
      };
    });

    const writes = [
      ...(adds.length + merged.length > 0 || args.gender || args.add_name
        ? [
            personUpdateWrite(args.person_id, {
              addFacts: adds,
              updateFacts: merged,
              ...(args.gender ? { gender: args.gender } : {}),
              ...(args.add_name ? { addName: { givenName: args.add_name.given_name, surname: args.add_name.surname } } : {}),
            }),
          ]
        : []),
      ...removes.map((id) => deleteConclusionWrite(args.person_id, id)),
    ];

    const count = adds.length + changes.length + removes.length;
    const who = `${nameOf(person)} [${person.id}]${person.lifespan ? ` ${person.lifespan}` : ""}`;
    const extra = [args.gender ? "muda o sexo" : "", args.add_name ? "acrescenta um nome" : ""].filter(Boolean);
    const line2 =
      removes.length > 0
        ? `ATENÇÃO: remove ${removes.length} fato(s): ${removes.map((id) => `${byId.get(id)?.type} (${id})`).join(", ")}`
        : [`${adds.length} novo(s), ${changes.length} alterado(s)`, ...extra].join("; ");
    const plan: WritePlan = {
      tool: "update_person",
      reason: args.reason,
      headline: `${count > 0 ? `Alterar ${count} fato${count > 1 ? "s" : ""} de` : "Alterar dados de"} ${who}\n${line2}`,
      details: [
        `Pessoa: ${who}`,
        ...adds.map((f) => `+ adicionar ${factText(f)}`),
        ...merged.map((m) => {
          const cur = byId.get(m.factId) as Fact;
          return `~ ${m.factId}: de "${factText({ type: cur.type, date: cur.date?.original, place: cur.place ?? undefined, value: cur.value ?? undefined })}" para "${factText(m)}"`;
        }),
        ...removes.map((id) => `- remover ${id}: ${factText({ type: byId.get(id)?.type ?? "", date: byId.get(id)?.date?.original, place: byId.get(id)?.place ?? undefined })}`),
        ...(args.gender ? [`* sexo: ${args.gender}`] : []),
        ...(args.add_name ? [`* acrescentar o nome ${fullName(args.add_name.given_name, args.add_name.surname)}`] : []),
      ].join("\n"),
      writes,
    };

    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async (): Promise<ReadBack> => {
        const after = await loadPerson(ctx, args.person_id);
        const checks = [
          ...adds.map((f) => check(`fato ${f.type} presente`, hasFact(after.facts, f), factText(f))),
          ...merged.map((m) => {
            const now = after.facts.find((f) => f.id === m.factId);
            return check(`fato ${m.factId} alterado`, !!now && same(now.type, m.type) && (!m.date || same(now.date?.original, m.date)), factText(m));
          }),
          ...removes.map((id) => check(`fato ${id} removido`, !after.facts.some((f) => f.id === id), id)),
        ];
        return { ok: checks.every((c) => c.ok), checks };
      },
    });
  },
});

// ---- add_note ---------------------------------------------------------------

const KIND_PATH = { couple: "couple-relationships", parents: "child-and-parents-relationships" } as const;

const noteInput = Type.Object({
  person_id: Type.Optional(personIdField),
  relationship_id: Type.Optional(Type.String({ pattern: idField.pattern, description: "Id do relacionamento (use com relationship_kind)" })),
  relationship_kind: Type.Optional(Type.Union([Type.Literal("couple"), Type.Literal("parents")], { description: "couple (casal) ou parents (pais e filho)" })),
  subject: Type.String({ minLength: 1, description: "Título da nota" }),
  text: Type.String({ minLength: 1, description: "Texto da nota" }),
  reason: reasonField,
  preview: previewField,
});

export const addNote = defineTool({
  name: "add_note",
  description: describeWrite(
    "add_note",
    "Acrescenta uma nota a uma pessoa (person_id) ou a um relacionamento (relationship_id com relationship_kind): " +
      "exatamente um alvo. Pergunta ao usuário numa pergunta na tela; nada é escrito sem aprovação. Custa 1 " +
      "requisição de leitura antes (só para pessoa) e 1 de releitura depois. Com preview: true mostra o plano " +
      "sem perguntar nem escrever.",
  ),
  readOnly: false,
  input: noteInput,
  run: async (args: Static<typeof noteInput>, ctx: Ctx) => {
    const relationship = args.relationship_id !== undefined || args.relationship_kind !== undefined;
    if (args.person_id !== undefined && relationship) {
      throw new Error("Informe um alvo só: person_id ou relationship_id com relationship_kind.");
    }
    if (args.person_id === undefined && !relationship) {
      throw new Error("Informe o alvo da nota: person_id, ou relationship_id com relationship_kind.");
    }
    if (relationship && (args.relationship_id === undefined || args.relationship_kind === undefined)) {
      throw new Error("Para um relacionamento, informe relationship_id e relationship_kind (couple ou parents).");
    }

    let headline: string;
    let target: { kind: "person" | "couple" | "parents"; id: string };
    if (args.person_id !== undefined) {
      const person = await loadPerson(ctx, args.person_id);
      target = { kind: "person", id: person.id };
      headline = `Nota em ${nameOf(person)} [${person.id}]${person.lifespan ? ` ${person.lifespan}` : ""}`;
    } else {
      target = { kind: args.relationship_kind as "couple" | "parents", id: args.relationship_id as string };
      headline = `Nota no relacionamento ${target.id} (${target.kind === "couple" ? "casal" : "pais e filho"})`;
    }
    const plan: WritePlan = {
      tool: "add_note",
      reason: args.reason,
      headline: `${headline}\nAssunto: ${args.subject}`,
      details: `${headline}\n\nAssunto: ${args.subject}\n\n${args.text}`,
      writes: [noteWrite(target, { subject: args.subject, text: args.text })],
    };

    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async (): Promise<ReadBack> => {
        const notes =
          target.kind === "person"
            ? ((await readNotes(ctx.http, target.id))?.persons?.[0]?.notes ?? [])
            : await relationshipNotes(ctx, target.kind, target.id);
        const found = notes.some((n) => same(n.subject, args.subject) && same(n.text, args.text));
        return { ok: found, checks: [check("nota presente", found, `${notes.length} nota(s) lida(s)`)] };
      },
    });
  },
});

async function relationshipNotes(ctx: Ctx, kind: "couple" | "parents", id: string) {
  const document = await getJson<{ relationships?: Array<{ notes?: Note[] }>; childAndParentsRelationships?: Array<{ notes?: Note[] }> }>(
    ctx.http,
    { method: "GET", path: `/platform/tree/${KIND_PATH[kind]}/${encodeURIComponent(id)}/notes`, label: "relationship notes" },
    id,
  );
  return (document?.relationships ?? document?.childAndParentsRelationships ?? []).flatMap((r) => r.notes ?? []);
}
type Note = { subject?: string; text?: string };

export const personWriteTools = [createPerson, updatePerson, addNote];
