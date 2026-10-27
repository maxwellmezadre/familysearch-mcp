import { Type } from "@sinclair/typebox";
import {
  toChanges,
  toFamily,
  toMemories,
  toNotes,
  toNumbered,
  toPersonDetail,
  toPersonSummary,
  toSearchHits,
  toSources,
} from "../domain/normalize.js";
import type { TreeQuery } from "../domain/types.js";
import {
  readAncestry,
  readChanges,
  readDescendancy,
  readFamilies,
  readMemories,
  readNotes,
  readPerson,
  readSources,
  searchTree,
} from "../familysearch/api.js";
import { compactObject, defineTool } from "./define.js";
import { generationsField, limitField, personIdField } from "./fields.js";

// Reads of the shared Family Tree. Every tool is live (the tree is edited by
// other people all the time) and costs the number of requests its description
// states.

export const personUrl = (baseUrl: string, id: string): string => `${baseUrl}/tree/person/details/${id}`;

const textField = (description: string) => Type.Optional(Type.String({ minLength: 1, description }));

export const searchPersons = defineTool({
  name: "search_persons",
  description:
    "Busca pessoas na árvore compartilhada do FamilySearch por nome, sexo, datas, lugares e nomes de pai, mãe " +
    "ou cônjuge. Devolve cada resultado com a confiança do FamilySearch (1 a 5; 3 ou mais costuma ser a mesma " +
    "pessoa) e o score. Datas aproximadas ('abt 1850', '3 de março de 1921') viram o ano; intervalos e " +
    "décadas são ignorados. 1 requisição.",
  readOnly: true,
  input: Type.Object({
    given_name: textField("Prenome(s)"),
    surname: textField("Sobrenome"),
    gender: Type.Optional(Type.Union([Type.Literal("male"), Type.Literal("female")], { description: "Sexo" })),
    birth_date: textField("Data ou ano de nascimento"),
    birth_place: textField("Lugar de nascimento"),
    death_date: textField("Data ou ano de falecimento"),
    death_place: textField("Lugar de falecimento"),
    father_name: textField("Nome completo do pai"),
    mother_name: textField("Nome completo da mãe"),
    spouse_name: textField("Nome completo do cônjuge"),
    limit: limitField(50, 10),
  }),
  run: async (args, ctx) => {
    const query: TreeQuery = compactObject({
      givenName: args.given_name,
      surname: args.surname,
      gender: args.gender,
      birthDate: args.birth_date,
      birthPlace: args.birth_place,
      deathDate: args.death_date,
      deathPlace: args.death_place,
      fatherName: args.father_name,
      motherName: args.mother_name,
      spouseName: args.spouse_name,
      limit: args.limit,
    });
    if (Object.keys(query).every((key) => key === "limit")) {
      throw new Error("Informe pelo menos um campo de busca (nome, sobrenome, datas, lugares ou parentes).");
    }
    const feed = await searchTree(ctx.http, query);
    const people = feed ? toSearchHits(feed) : [];
    return { total: feed?.results ?? people.length, people };
  },
});

const INCLUDE = ["sources", "notes", "memories"] as const;

export const getPerson = defineTool({
  name: "get_person",
  description:
    "Lê uma pessoa da árvore: nomes, sexo, se está viva, todos os fatos (nascimento, morte, residência...) com a " +
    "data como foi escrita e a padronizada, e o link da página. Com include, também as fontes, notas e " +
    "memórias. 1 requisição, mais 1 por item de include. Se o id foi mesclado, o erro diz em qual pessoa.",
  readOnly: true,
  input: Type.Object({
    person_id: personIdField,
    include: Type.Optional(
      Type.Array(Type.Union(INCLUDE.map((item) => Type.Literal(item))), {
        uniqueItems: true,
        description: "Seções extras: sources, notes, memories",
      }),
    ),
  }),
  run: async (args, ctx) => {
    const document = await readPerson(ctx.http, args.person_id);
    const person = document.persons?.find((candidate) => candidate.id === args.person_id) ?? document.persons?.[0];
    const detail = toPersonDetail(person ?? { id: args.person_id });
    const include = new Set(args.include ?? []);
    return compactObject({
      ...detail,
      url: personUrl(ctx.config.baseUrl, detail.id),
      sources: include.has("sources") ? toSources(await readSources(ctx.http, args.person_id)) : undefined,
      notes: include.has("notes") ? toNotes(await readNotes(ctx.http, args.person_id)) : undefined,
      memories: include.has("memories") ? toMemories(await readMemories(ctx.http, args.person_id)) : undefined,
    });
  },
});

export const getFamily = defineTool({
  name: "get_family",
  description:
    "Família direta de uma pessoa: pais (com o id do relacionamento pai/mãe e filho), cônjuges (com o " +
    "casamento) e os filhos de cada casal. Filhos registrados sem o outro genitor aparecem num casal sem " +
    "cônjuge. 1 requisição.",
  readOnly: true,
  input: Type.Object({ person_id: personIdField }),
  run: async (args, ctx) => {
    const document = await readFamilies(ctx.http, args.person_id);
    const focus = document.persons?.find((candidate) => candidate.id === args.person_id);
    return { person: toPersonSummary(focus ?? { id: args.person_id }), ...toFamily(document, args.person_id) };
  },
});

export const getAncestors = defineTool({
  name: "get_ancestors",
  description:
    "Ancestrais de uma pessoa até 8 gerações, cada um com o número de ascendência do FamilySearch (1 é a " +
    "pessoa, 2 o pai, 3 a mãe, 4 e 5 os avós paternos; '-S' é cônjuge). Bom para achar quem está sem pai ou " +
    "sem mãe. 1 requisição.",
  readOnly: true,
  input: Type.Object({ person_id: personIdField, generations: generationsField(8, 4) }),
  run: async (args, ctx) => {
    const generations = args.generations ?? 4;
    const document = await readAncestry(ctx.http, args.person_id, generations);
    return { person_id: args.person_id, generations, people: toNumbered(document, "ascendancyNumber") };
  },
});

export const getDescendants = defineTool({
  name: "get_descendants",
  description:
    "Descendentes de uma pessoa até 4 gerações, cada um com o número de descendência do FamilySearch " +
    "(1.1 é o primeiro filho, 1.1.1 o primeiro neto; '-S1' é cônjuge). 1 requisição.",
  readOnly: true,
  input: Type.Object({ person_id: personIdField, generations: generationsField(4, 2) }),
  run: async (args, ctx) => {
    const generations = args.generations ?? 2;
    const document = await readDescendancy(ctx.http, args.person_id, generations);
    return { person_id: args.person_id, generations, people: toNumbered(document, "descendancyNumber") };
  },
});

export const getChangeHistory = defineTool({
  name: "get_change_history",
  description:
    "Histórico de alterações de uma pessoa na árvore, do mais recente ao mais antigo: quando, quem e o quê. " +
    "Serve para saber se alguém mexeu na pessoa recentemente antes de editar ou mesclar. 1 requisição.",
  readOnly: true,
  input: Type.Object({ person_id: personIdField, limit: limitField(100, 20) }),
  run: async (args, ctx) => {
    const changes = toChanges(await readChanges(ctx.http, args.person_id));
    return { person_id: args.person_id, changes: changes.slice(0, args.limit ?? 20) };
  },
});
