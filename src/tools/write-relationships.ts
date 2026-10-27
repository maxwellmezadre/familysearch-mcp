import { Type } from "@sinclair/typebox";
import type { WritePlan } from "../approval/gate.js";
import { type ReadBack, runWritePlan } from "../approval/run.js";
import type { Ctx } from "../context.js";
import { DeletedError, HttpError, NotFoundError } from "../core/errors.js";
import { toFamily, toPersonSummary } from "../domain/normalize.js";
import { getJson, readFamilies, readPerson } from "../familysearch/api.js";
import type { GxDocument } from "../familysearch/gedcomx.js";
import { deleteRelationshipWrite, linkParentsWrite, linkSpousesWrite } from "../familysearch/writes.js";
import { defineTool } from "./define.js";
import { idField, personIdField, previewField, reasonField } from "./fields.js";
import { describeWrite } from "./write-status.js";

// Writes that connect or disconnect people: parents <-> child, spouses, and
// removing either kind of relationship. Every one reads first (to refuse
// duplicates and to name the people in the question), asks, writes, and reads
// back through an independent request.

const label = (name: string | null, id: string) => `${name ?? "(sem nome)"} [${id}]`;

/** Name of `id` in a document that carries persons, or null. */
function nameIn(document: GxDocument, id: string): string | null {
  const found = document.persons?.find((p) => p.id === id);
  return found ? toPersonSummary(found).name : null;
}

async function nameOf(ctx: Ctx, id: string): Promise<string> {
  const document = await readPerson(ctx.http, id);
  return label(nameIn(document, id) ?? toPersonSummary(document.persons?.[0] ?? { id }).name, id);
}

const sameIds = (a: Array<string | undefined>, b: Array<string | undefined>) => {
  const x = a.filter(Boolean).sort().join("|");
  return x === b.filter(Boolean).sort().join("|");
};

const refresh = (what: string, ok: boolean, detail: string) => ({ what, ok, detail });
const done = (checks: ReadBack["checks"]): ReadBack => ({ ok: checks.every((c) => c.ok), checks });

export const linkParents = defineTool({
  name: "link_parents",
  description: describeWrite(
    "link_parents",
    "Liga uma criança a um pai, uma mãe ou aos dois. Se já existe um relacionamento com exatamente esses pais, " +
      "avisa e não escreve. Pergunta ao usuário numa janela na tela antes de escrever. Custa 1 requisição de " +
      "leitura da família, até 2 para os nomes dos pais, 1 de escrita e 1 de releitura. Com preview: true " +
      "mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  input: Type.Object({
    child_id: personIdField,
    parent1_id: Type.Optional(personIdField),
    parent2_id: Type.Optional(personIdField),
    reason: reasonField,
    preview: previewField,
  }),
  run: async (args, ctx) => {
    const { child_id: child, parent1_id: p1, parent2_id: p2 } = args;
    if (!p1 && !p2) throw new Error("Informe pelo menos um pai ou mãe para ligar ao filho.");
    if (child === p1 || child === p2) throw new Error("Uma pessoa não pode ser o próprio pai ou a própria mãe.");
    if (p1 && p1 === p2) throw new Error("O pai e a mãe informados são a mesma pessoa.");

    const family = await readFamilies(ctx.http, child);
    const existing = toFamily(family, child).parents.find((p) =>
      sameIds([p.parent1?.id, p.parent2?.id], [p1, p2]),
    );
    if (existing) {
      return { status: "exists", relationship_id: existing.relationshipId, message: `Esse relacionamento já existe (${existing.relationshipId}); nada foi escrito.` };
    }

    const names = await Promise.all([p1, p2].filter((id): id is string => !!id).map((id) => nameOf(ctx, id)));
    const childLabel = label(nameIn(family, child), child);
    const plan: WritePlan = {
      tool: "link_parents",
      reason: args.reason,
      headline: `Ligar ${childLabel} como filho(a) de ${names.join(" e ")}\nO FamilySearch passa a mostrar essa família na árvore de todos os usuários.`,
      details: `Criar um relacionamento pais-filho.\nFilho(a): ${childLabel}\nPais: ${names.join(" e ")}\nMotivo: ${args.reason}`,
      writes: [linkParentsWrite(ctx.config.baseUrl, child, p1, p2)],
    };
    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async () => {
        const after = toFamily(await readFamilies(ctx.http, child), child);
        const found = after.parents.some((p) => sameIds([p.parent1?.id, p.parent2?.id], [p1, p2]));
        return done([refresh("pais do filho", found, found ? "os pais aparecem na família do filho" : "os pais não aparecem na família do filho")]);
      },
    });
  },
});

export const linkSpouses = defineTool({
  name: "link_spouses",
  description: describeWrite(
    "link_spouses",
    "Liga duas pessoas como casal, com data e lugar do casamento se informados. Se o casal já existe, avisa " +
      "e não escreve. Pergunta ao usuário numa janela na tela antes de escrever. Custa 1 requisição de leitura " +
      "da família, 1 para o nome da segunda pessoa, 1 de escrita e 1 de releitura. Com preview: true mostra " +
      "o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  input: Type.Object({
    person1_id: personIdField,
    person2_id: personIdField,
    marriage: Type.Optional(
      Type.Object({
        date: Type.Optional(Type.String({ minLength: 1, description: "Data do casamento, como está no documento" })),
        place: Type.Optional(Type.String({ minLength: 1, description: "Lugar do casamento" })),
      }),
    ),
    reason: reasonField,
    preview: previewField,
  }),
  run: async (args, ctx) => {
    const { person1_id: a, person2_id: b } = args;
    if (a === b) throw new Error("Não dá para casar a mesma pessoa com ela mesma.");

    const family = await readFamilies(ctx.http, a);
    const existing = toFamily(family, a).spouses.find((s) => s.relationshipId && s.spouse?.id === b);
    if (existing) {
      return { status: "exists", relationship_id: existing.relationshipId, message: `Esse casal já existe (${existing.relationshipId}); nada foi escrito.` };
    }

    const { date, place } = args.marriage ?? {};
    const marriage = date || place ? { type: "Marriage", date, place } : undefined;
    const first = label(nameIn(family, a), a);
    const second = await nameOf(ctx, b);
    const when = marriage ? ` (casamento${date ? ` ${date}` : ""}${place ? ` em ${place}` : ""})` : "";
    const plan: WritePlan = {
      tool: "link_spouses",
      reason: args.reason,
      headline: `Ligar ${first} e ${second} como casal${when}\nO FamilySearch passa a mostrar esse casal na árvore de todos os usuários.`,
      details: `Criar um relacionamento de casal.\nPessoa 1: ${first}\nPessoa 2: ${second}${when ? `\nCasamento:${when}` : ""}\nMotivo: ${args.reason}`,
      writes: [linkSpousesWrite(ctx.config.baseUrl, a, b, marriage)],
    };
    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async () => {
        const found = toFamily(await readFamilies(ctx.http, a), a).spouses.some((s) => s.relationshipId && s.spouse?.id === b);
        return done([refresh("casal", found, found ? "o cônjuge aparece na família da primeira pessoa" : "o cônjuge não aparece na família da primeira pessoa")]);
      },
    });
  },
});

// api.ts has no reader for a single relationship, so the two this tool needs live here.
const RELATIONSHIP_PATH = { couple: "couple-relationships", parents: "child-and-parents-relationships" } as const;
const readRelationship = (ctx: Ctx, kind: keyof typeof RELATIONSHIP_PATH, id: string) =>
  getJson<GxDocument>(
    ctx.http,
    { method: "GET", path: `/platform/tree/${RELATIONSHIP_PATH[kind]}/${encodeURIComponent(id)}`, label: "relationship" },
    id,
  );

export const removeRelationship = defineTool({
  name: "remove_relationship",
  description: describeWrite(
    "remove_relationship",
    "Remove uma ligação de casal ou de pais e filho (pelo id do relacionamento, que get_family mostra). As " +
      "pessoas continuam na árvore. Pergunta ao usuário numa janela na tela antes de apagar. Custa 1 " +
      "requisição para ler o relacionamento, até 2 para os nomes, 1 de escrita e 1 de releitura (que deve " +
      "dar 404 ou 410). Com preview: true mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  destructive: true,
  input: Type.Object({
    relationship_id: idField(),
    kind: Type.Union([Type.Literal("couple"), Type.Literal("parents")], { description: "couple (casal) ou parents (pais e filho)" }),
    reason: reasonField,
    preview: previewField,
  }),
  run: async (args, ctx) => {
    const { relationship_id: id, kind } = args;
    const document = await readRelationship(ctx, kind, id);
    const rel = kind === "couple" ? document?.relationships?.[0] : document?.childAndParentsRelationships?.[0];
    if (!document || !rel) throw new Error(`Não achei o relacionamento ${id} (${kind}).`);

    const ids = (kind === "couple"
      ? [(rel as { person1?: { resourceId?: string } }).person1?.resourceId, (rel as { person2?: { resourceId?: string } }).person2?.resourceId]
      : [(rel as { parent1?: { resourceId?: string } }).parent1?.resourceId, (rel as { parent2?: { resourceId?: string } }).parent2?.resourceId, (rel as { child?: { resourceId?: string } }).child?.resourceId]
    ).filter((x): x is string => !!x);
    // At most 2 extra reads for names the relationship document does not carry.
    let reads = 0;
    const labels: string[] = [];
    for (const personId of ids) {
      const known = nameIn(document, personId);
      labels.push(known || reads >= 2 ? label(known, personId) : (reads++, await nameOf(ctx, personId)));
    }
    const text = kind === "couple" ? `o casal ${labels.join(" e ")}` : `os pais ${labels.slice(0, -1).join(" e ")} do(a) filho(a) ${labels.at(-1)}`;
    const plan: WritePlan = {
      tool: "remove_relationship",
      reason: args.reason,
      headline: `Remover a ligação de ${text}\nATENÇÃO: as pessoas continuam na árvore, mas deixam de estar ligadas.`,
      details: `Apagar o relacionamento ${id} (${kind === "couple" ? "casal" : "pais e filho"}).\nPessoas: ${labels.join("; ")}\nMotivo: ${args.reason}`,
      writes: [deleteRelationshipWrite(kind, id)],
    };
    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async () => {
        try {
          await readRelationship(ctx, kind, id);
          return done([refresh("relacionamento removido", false, "o relacionamento ainda responde 200")]);
        } catch (error) {
          // getJson only maps 404/410 to these when the subject looks like an id; a plain HttpError carries the same status.
          const gone = error instanceof NotFoundError || error instanceof DeletedError || (error instanceof HttpError && (error.status === 404 || error.status === 410));
          if (gone) return done([refresh("relacionamento removido", true, "o FamilySearch responde 404 ou 410")]);
          throw error;
        }
      },
    });
  },
});

export const relationshipWriteTools = [linkParents, linkSpouses, removeRelationship];
