import { Type } from "@sinclair/typebox";
import { personUrl, toPlaces, toRecordDetail, toRecordHits, toSearchHits } from "../domain/normalize.js";
import type { RecordQuery } from "../domain/types.js";
import {
  readRecordHints,
  readRecordPersona,
  readTreeMatches,
  searchPlaces as searchPlacesApi,
  searchRecords as searchRecordsApi,
} from "../familysearch/api.js";
import { compactObject, defineTool } from "./define.js";
import { limitField, personIdField } from "./fields.js";

// Research: historical records, FamilySearch's own suggestions (record hints
// and possible duplicates) and standardized places. All live, all read-only.

const textField = (description: string) => Type.Optional(Type.String({ minLength: 1, description }));

export const searchRecords = defineTool({
  name: "search_records",
  description:
    "Busca registros históricos indexados no FamilySearch (nascimentos, casamentos, óbitos, censos, jornais...). " +
    "Devolve, para cada registro, o nome principal, a coleção, o evento com data e lugar, a confiança e o link. " +
    "Datas aproximadas viram o ano. Use get_record para ver todas as pessoas de um registro. 1 requisição.",
  readOnly: true,
  input: Type.Object({
    given_name: textField("Prenome(s)"),
    surname: textField("Sobrenome"),
    birth_date: textField("Data ou ano de nascimento"),
    birth_place: textField("Lugar de nascimento"),
    death_date: textField("Data ou ano de falecimento"),
    death_place: textField("Lugar de falecimento"),
    collection_id: textField("Id de uma coleção específica (o número no link da coleção)"),
    limit: limitField(50, 10),
  }),
  run: async (args, ctx) => {
    const query: RecordQuery = compactObject({
      givenName: args.given_name,
      surname: args.surname,
      birthDate: args.birth_date,
      birthPlace: args.birth_place,
      deathDate: args.death_date,
      deathPlace: args.death_place,
      collectionId: args.collection_id,
      limit: args.limit,
    });
    if (Object.keys(query).every((key) => key === "limit" || key === "collectionId")) {
      throw new Error("Informe pelo menos um campo de busca (nome, sobrenome, datas ou lugares).");
    }
    const feed = await searchRecordsApi(ctx.http, query);
    const records = feed ? toRecordHits(feed, ctx.config.baseUrl) : [];
    return { total: feed?.results ?? records.length, records };
  },
});

export const getRecord = defineTool({
  name: "get_record",
  description:
    "Lê um registro histórico: a coleção, todas as pessoas citadas nele (a principal primeiro, com nomes e " +
    "fatos), o link da imagem quando existe e o link do registro. O id é o que aparece em search_records ou no " +
    "link ark:/61903/1:1:<id>. 1 requisição.",
  readOnly: true,
  input: Type.Object({
    record_id: Type.String({
      pattern: "^[A-Z0-9]{4}-[A-Z0-9]{3,4}$",
      description: "Id do registro (ex.: Q5SN-NK1T)",
    }),
  }),
  run: async (args, ctx) =>
    toRecordDetail(await readRecordPersona(ctx.http, args.record_id), args.record_id, ctx.config.baseUrl),
});

export const getHints = defineTool({
  name: "get_hints",
  description:
    "Sugestões de registros do próprio FamilySearch para uma pessoa da árvore (os 'hints' da página), com a " +
    "confiança de cada uma. Lista vazia quando não há sugestão pendente. 1 requisição.",
  readOnly: true,
  input: Type.Object({ person_id: personIdField }),
  run: async (args, ctx) => {
    const feed = await readRecordHints(ctx.http, args.person_id);
    const hints = feed ? toRecordHits(feed, ctx.config.baseUrl) : [];
    return compactObject({
      person_id: args.person_id,
      hints,
      note: hints.length === 0 ? "O FamilySearch não tem nenhuma sugestão de registro pendente para esta pessoa." : undefined,
    });
  },
});

export const getPossibleDuplicates = defineTool({
  name: "get_possible_duplicates",
  description:
    "Possíveis duplicatas de uma pessoa na árvore, segundo o FamilySearch, com a confiança (1 a 5) e o link de " +
    "cada uma. Lista vazia não prova que não exista duplicata: o FamilySearch nem sempre sugere. Para conferir " +
    "um par suspeito, use compare_persons. 1 requisição.",
  readOnly: true,
  input: Type.Object({ person_id: personIdField }),
  run: async (args, ctx) => {
    const feed = await readTreeMatches(ctx.http, args.person_id);
    const candidates = (feed ? toSearchHits(feed) : []).map((hit) => ({
      ...hit,
      url: personUrl(ctx.config.baseUrl, hit.id),
    }));
    return compactObject({
      person_id: args.person_id,
      candidates,
      note:
        candidates.length === 0
          ? "O FamilySearch não tem nenhuma sugestão de duplicata para esta pessoa. Isso não prova que não exista: busque com search_persons."
          : undefined,
    });
  },
});

export const searchPlaces = defineTool({
  name: "search_places",
  description:
    "Busca lugares padronizados do FamilySearch pelo nome e devolve o nome completo (com município, estado e " +
    "país), o tipo e o id, na ordem de relevância da API. Útil para escrever fatos com o lugar certo. 1 requisição.",
  readOnly: true,
  input: Type.Object({
    name: Type.String({ minLength: 2, description: "Nome do lugar (ex.: Garibaldi, Bento Gonçalves)" }),
    limit: limitField(50, 10),
  }),
  run: async (args, ctx) => {
    const feed = await searchPlacesApi(ctx.http, args.name, args.limit ?? 10);
    return { places: feed ? toPlaces(feed) : [] };
  },
});
