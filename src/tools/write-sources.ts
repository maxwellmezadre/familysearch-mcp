import { Type } from "@sinclair/typebox";
import type { ReadBack } from "../approval/run.js";
import { runWritePlan } from "../approval/run.js";
import { recordUrl, toRecordDetail, toSources } from "../domain/normalize.js";
import { getJson, readRecordHints, readRecordPersona, readSources } from "../familysearch/api.js";
import type { GxDocument } from "../familysearch/gedcomx.js";
import { attachSourceWrite, createSourceWrite, matchResolutionWrite, notAMatchWrite } from "../familysearch/writes.js";
import { defineTool } from "./define.js";
import { personIdField } from "./fields.js";
import { describeWrite } from "./write-status.js";

// Sources and suggestions: attach a source to a person, attach a historical
// record as a source, and answer FamilySearch's own suggestions (record hints
// and "not the same person"). Merging duplicates is NOT here: see merge_persons.

const reasonField = Type.String({ minLength: 10, description: "Motivo da alteração, fica no histórico do FamilySearch" });
const previewField = Type.Optional(Type.Boolean({ description: "Mostra o que mudaria sem perguntar nem escrever" }));
const idField = (description: string) => Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$", description });

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const addSource = defineTool({
  name: "add_source",
  description: describeWrite(
    "add_source",
    "Cria uma fonte (título, citação e endereço opcionais) e a anexa a uma pessoa. Pergunta ao usuário numa " +
      "pergunta na tela antes de escrever. Custa 2 escritas, mais 1 requisição de releitura. " +
      "Com preview: true mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  input: Type.Object({
    person_id: personIdField,
    title: Type.String({ minLength: 1, description: "Título da fonte" }),
    citation: Type.Optional(Type.String({ minLength: 1, description: "Citação da fonte" })),
    url: Type.Optional(Type.String({ description: "Endereço (https://) onde a fonte está" })),
    reason: reasonField,
    preview: previewField,
  }),
  run: async (args, ctx) => {
    if (args.url !== undefined && !/^https:\/\/\S+$/.test(args.url)) {
      throw new Error(`O endereço da fonte precisa começar com https://: "${args.url}".`);
    }
    const create = createSourceWrite({ title: args.title, citation: args.citation, about: args.url });
    const plan = {
      tool: "add_source",
      reason: args.reason,
      headline: `Anexar a fonte "${args.title}" a ${args.person_id}\nCria uma fonte nova e a liga à pessoa.`,
      details: [
        `Pessoa: ${args.person_id}`,
        `Título: ${args.title}`,
        args.citation ? `Citação: ${args.citation}` : null,
        args.url ? `Endereço: ${args.url}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      writes: [create, attachSourceWrite(args.person_id)],
    };
    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async () => {
        const sources = toSources(await readSources(ctx.http, args.person_id));
        const found = sources.some((s) => s.title === args.title && (args.url === undefined || s.url === args.url));
        return {
          ok: found,
          checks: [
            {
              what: "fonte anexada",
              ok: found,
              detail: found ? `"${args.title}" aparece nas fontes de ${args.person_id}` : "a fonte não apareceu na releitura",
            },
          ],
        };
      },
    });
  },
});

export const attachRecord = defineTool({
  name: "attach_record",
  description: describeWrite(
    "attach_record",
    "Anexa um registro histórico a uma pessoa como fonte (título: nome principal e coleção; endereço: o link do " +
      "registro). Se o registro já está anexado, avisa e não escreve. Pergunta ao usuário numa pergunta na tela " +
      "antes de escrever. Custa 2 requisições de leitura antes, 2 escritas e 1 releitura. " +
      "Com preview: true mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  input: Type.Object({
    person_id: personIdField,
    record_id: idField("Id do registro (de search_records ou get_possible_record_matches)"),
    reason: reasonField,
    preview: previewField,
  }),
  run: async (args, ctx) => {
    const about = recordUrl(ctx.config.baseUrl, args.record_id);
    const record = toRecordDetail(await readRecordPersona(ctx.http, args.record_id), args.record_id, ctx.config.baseUrl);
    const already = toSources(await readSources(ctx.http, args.person_id)).some((s) => s.url === about);
    if (already) {
      return { status: "already_attached", message: `O registro ${args.record_id} já está anexado a ${args.person_id}; nada foi escrito.` };
    }
    const principal = record.persons[0]?.name ?? "Registro";
    const title = record.collection ? `${principal}, ${record.collection}` : principal;
    const plan = {
      tool: "attach_record",
      reason: args.reason,
      headline: `Anexar o registro ${args.record_id} a ${args.person_id}\nFonte: "${title}"`,
      details: [`Pessoa: ${args.person_id}`, `Registro: ${about}`, `Título da fonte: ${title}`].join("\n"),
      writes: [createSourceWrite({ title, about }), attachSourceWrite(args.person_id)],
    };
    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async () => {
        const found = toSources(await readSources(ctx.http, args.person_id)).some((s) => s.url === about);
        return {
          ok: found,
          checks: [
            {
              what: "registro anexado",
              ok: found,
              detail: found ? `${about} aparece nas fontes de ${args.person_id}` : "a fonte não apareceu na releitura",
            },
          ],
        };
      },
    });
  },
});

export const resolveSuggestion = defineTool({
  name: "resolve_suggestion",
  description: describeWrite(
    "resolve_suggestion",
    "Responde a uma sugestão do FamilySearch: aceita ou rejeita um registro sugerido (kind record) ou marca uma " +
      "duplicata sugerida como pessoa diferente (kind duplicate, só rejeitar). Para juntar duplicatas use " +
      "compare_persons e merge_persons. Pergunta ao usuário numa pergunta na tela antes de escrever. " +
      "Custa 1 escrita e 1 releitura. Com preview: true mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  input: Type.Object({
    person_id: personIdField,
    kind: Type.Union([Type.Literal("record"), Type.Literal("duplicate")], { description: "record = registro sugerido; duplicate = possível duplicata" }),
    target_id: idField("Id do registro (kind record) ou da outra pessoa (kind duplicate)"),
    decision: Type.Union([Type.Literal("accept"), Type.Literal("reject")]),
    reason: reasonField,
    preview: previewField,
  }),
  run: async (args, ctx) => {
    if (args.kind === "duplicate" && args.decision === "accept") {
      throw new Error("Para juntar duplicatas use compare_persons e merge_persons; resolve_suggestion só marca duplicatas como pessoas diferentes.");
    }
    const accept = args.decision === "accept";
    const write =
      args.kind === "record"
        ? // The match-resolution identifier is the documented form, without "www".
          matchResolutionWrite(args.person_id, `https://familysearch.org/ark:/61903/1:1:${args.target_id}`, accept ? "accepted" : "rejected")
        : notAMatchWrite(args.person_id, args.target_id);
    const plan = {
      tool: "resolve_suggestion",
      reason: args.reason,
      headline:
        args.kind === "record"
          ? `${accept ? "Aceitar" : "Rejeitar"} o registro ${args.target_id} para ${args.person_id}\nResolve a sugestão de registro.`
          : `Marcar ${args.person_id} e ${args.target_id} como pessoas diferentes\nA sugestão de duplicata deixa de aparecer.`,
      details: `${write.summary}\nMotivo: ${args.reason}`,
      writes: [write],
    };
    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async (): Promise<ReadBack> => {
        if (args.kind === "record") {
          const feed = await readRecordHints(ctx.http, args.person_id);
          const pending = (feed?.entries ?? []).some((e) => e.id === args.target_id);
          return {
            ok: !pending,
            checks: [{ what: "sugestão resolvida", ok: !pending, detail: pending ? "o registro ainda aparece como sugestão" : "o registro não aparece mais como sugestão" }],
          };
        }
        try {
          const doc = await getJson<GxDocument>(ctx.http, {
            method: "GET",
            path: `/platform/tree/persons/${encodeURIComponent(args.person_id)}/not-a-match`,
            label: "not a match",
          });
          const listed = (doc?.persons ?? []).some((p) => p.id === args.target_id);
          return {
            ok: listed,
            checks: [{ what: "marcada como diferente", ok: listed, detail: listed ? `${args.target_id} consta na lista de pessoas diferentes` : `${args.target_id} não consta na lista de pessoas diferentes` }],
          };
        } catch (error) {
          return { ok: false, checks: [{ what: "marcada como diferente", ok: false, detail: `não foi possível conferir: ${errorText(error)}` }] };
        }
      },
    });
  },
});

export const sourceWriteTools = [addSource, attachRecord, resolveSuggestion];
