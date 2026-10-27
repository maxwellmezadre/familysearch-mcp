import { Type } from "@sinclair/typebox";
import { saveSnapshot } from "../approval/audit.js";
import type { WritePlan } from "../approval/gate.js";
import { type ReadBack, runWritePlan } from "../approval/run.js";
import type { Ctx } from "../context.js";
import { DeletedError, MergedError } from "../core/errors.js";
import { buildComparison } from "../domain/compare.js";
import {
  type MergeRequest,
  buildMergeRequest,
  conclusionText,
  conclusionsOf,
  familiesOf,
  findRelationship,
  labelResource,
  resourceId,
} from "../domain/merge.js";
import { toFamily } from "../domain/normalize.js";
import type { Family, PersonBundle } from "../domain/types.js";
import type { GxPerson } from "../familysearch/gedcomx.js";
import { readFamilies, readMergeAnalysis, readMergeConstraint, readPerson } from "../familysearch/api.js";
import { mergeWrite, restoreWrite } from "../familysearch/writes.js";
import { loadBundle } from "./compare.js";
import { type ToolDef, defineTool } from "./define.js";
import { errorText, personIdField, previewField, reasonField } from "./fields.js";
import { describeWrite } from "./write-status.js";

// The most dangerous operation in the project: a wrong merge damages other
// families' research on a shared public tree. Everything that can refuse does
// so BEFORE the question, the question makes the user type the duplicate's id,
// and the two persons are saved locally right before the POST.

const idList = (description: string) => Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description }));

const nameOf = (bundle: PersonBundle) => `${bundle.person.name ?? "(sem nome)"} [${bundle.person.id}]`;
/** One line, at most 50 characters: the headline's second line (the warning) must survive any name. */
const shortName = (bundle: PersonBundle) => {
  const name = (bundle.person.name ?? "(sem nome)").replace(/\s+/g, " ").trim();
  return `${name.length > 50 ? `${name.slice(0, 49)}…` : name} [${bundle.person.id}]`;
};
const signs = (count: number) => `${count} ${count === 1 ? "sinal" : "sinais"} de que não são a mesma pessoa`;
const bullets = (title: string, items: string[]) => (items.length > 0 ? ["", title, ...items.map((item) => `- ${item}`)] : []);

/**
 * The duplicate now redirects to the survivor, every chosen swap left the
 * duplicate's version on the survivor (and took the survivor's away), and every
 * relationship copied from the duplicate (as its family was before) shows up on
 * the survivor.
 */
async function readBackMerge(
  ctx: Ctx,
  survivor: string,
  duplicate: string,
  request: MergeRequest,
  before: { duplicatePerson: GxPerson; duplicateFamily: Record<string, Family> },
): Promise<ReadBack> {
  const checks: ReadBack["checks"] = [];
  const redirect = `${duplicate} redireciona para ${survivor}`;
  try {
    await readPerson(ctx.http, duplicate);
    checks.push({ what: redirect, ok: false, detail: "ainda responde 200: a duplicata continua existindo" });
  } catch (error) {
    const merged = error instanceof MergedError;
    checks.push({
      what: redirect,
      ok: merged && error.survivorId === survivor,
      detail: merged ? `301 para ${error.survivorId ?? "uma pessoa não informada"}` : errorText(error),
    });
  }

  if (request.chosen.length > 0) {
    const document = await readPerson(ctx.http, survivor);
    const now = conclusionsOf(document.persons?.find((person) => person.id === survivor) ?? { id: survivor });
    for (const pair of request.chosen) {
      // Compared by text: the copy may get a new id on the survivor.
      const wanted = conclusionText(before.duplicatePerson, resourceId(pair.duplicate));
      const arrived = wanted !== null && now.some((conclusion) => conclusion.text === wanted);
      checks.push({
        what: `${wanted ?? resourceId(pair.duplicate)} da duplicata em ${survivor}`,
        ok: arrived,
        detail: arrived ? "presente" : wanted === null ? "não deu para saber que dado era na duplicata" : "não aparece na sobrevivente",
      });
      const old = resourceId(pair.survivor);
      const gone = !now.some((conclusion) => conclusion.id === old);
      checks.push({ what: `${old} saiu de ${survivor}`, ok: gone, detail: gone ? "removido" : "continua na sobrevivente" });
    }
  }

  const links = request.resourcesToCopy.filter((uri) => /relationships\//.test(uri)).map(resourceId);
  if (links.length === 0) return { ok: checks.every((check) => check.ok), checks };
  const after = toFamily(await readFamilies(ctx.http, survivor), survivor);
  const parents = new Set(after.parents.flatMap((entry) => [entry.parent1?.id, entry.parent2?.id]));
  const children = new Set(after.spouses.flatMap((entry) => entry.children.map((child) => child.id)));
  const spouses = new Set(after.spouses.map((entry) => entry.spouse?.id));
  for (const id of links) {
    const found = findRelationship(before.duplicateFamily, id);
    if (!found) {
      checks.push({ what: `relacionamento ${id}`, ok: false, detail: "não estava na família da duplicata antes da mesclagem" });
    } else if (found.kind === "parents" && found.child !== duplicate) {
      const ok = children.has(found.child);
      checks.push({ what: `${found.child} filho(a) de ${survivor}`, ok, detail: ok ? "ligado" : "não aparece entre os filhos" });
    } else if (found.kind === "parents") {
      const missing = found.parents.filter((parent) => !parents.has(parent.id)).map((parent) => parent.id);
      const what = `pais de ${survivor}: ${found.parents.map((parent) => parent.id).join(" e ")}`;
      checks.push({ what, ok: missing.length === 0, detail: missing.length === 0 ? "ligados" : `faltam ${missing.join(", ")}` });
    } else {
      const [focus, spouse] = found.persons;
      const other = focus === duplicate ? spouse?.id : focus;
      const ok = other !== undefined && spouses.has(other);
      checks.push({ what: `${other ?? "?"} cônjuge de ${survivor}`, ok, detail: ok ? "ligado" : "não aparece entre os cônjuges" });
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}

export const mergePersons = defineTool({
  name: "merge_persons",
  description: describeWrite(
    "merge_persons",
    "Mescla duas pessoas da árvore: a duplicata deixa de existir e o id dela passa a apontar para a sobrevivente. " +
      "Use só depois de compare_persons, com o fingerprint que ele devolveu, e depois de mostrar os sinais de alerta ao usuário. " +
      "Por padrão copia tudo o que só existe na duplicata (inclusive filhos, pais e cônjuges); take_from_duplicate escolhe, " +
      "em cada conflito, a versão da duplicata, e skip_copy deixa itens de fora (os ids estão nos detalhes da prévia). " +
      "Recusa pessoa viva, fingerprint desatualizado e a ordem que o FamilySearch não permite. Pede aprovação ao usuário " +
      "numa pergunta na tela, que exige digitar o id da duplicata. Custa 14 requisições antes da pergunta. Logo antes de " +
      "enviar, salva as duas pessoas num snapshot local; restore_person desfaz. preview: true mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  destructive: true,
  input: Type.Object({
    survivor_id: personIdField,
    duplicate_id: personIdField,
    fingerprint: Type.String({ minLength: 1, description: "O fingerprint devolvido por compare_persons para este par" }),
    reason: reasonField,
    take_from_duplicate: idList(
      "Conflitos em que fica a versão da duplicata: id do recurso (ou a URI) de qualquer um dos lados; se o id aparece em mais de um conflito, use o do outro lado",
    ),
    skip_copy: idList("Itens só da duplicata que NÃO devem ser copiados: id do recurso ou a URI"),
    preview: previewField,
  }),
  run: async (args, ctx) => {
    const { survivor_id: survivor, duplicate_id: duplicate } = args;
    if (survivor === duplicate) {
      throw new Error("Sobrevivente e duplicata são a mesma pessoa (mesmo id): não há o que mesclar.");
    }
    const s = await loadBundle(ctx.http, survivor);
    const d = await loadBundle(ctx.http, duplicate);
    const living = [s, d].find((bundle) => bundle.person.living);
    if (living) {
      throw new Error(`${nameOf(living)} está marcada como viva: pessoa viva não é mesclada; use link_parents e remove_relationship.`);
    }
    const [a, b] = [s.lastChangeId, d.lastChangeId];
    // compare_persons writes "null" for an empty history, which would always match: refuse instead.
    const unread = a === null ? survivor : b === null ? duplicate : null;
    if (unread) {
      throw new Error(
        `Mesclagem recusada: não consegui ler o histórico de alterações de ${unread}; não dá para garantir que nada mudou desde a comparação.`,
      );
    }
    if (args.fingerprint !== `${a}|${b}` && args.fingerprint !== `${b}|${a}`) {
      throw new Error("Mesclagem recusada: alguém alterou uma das duas desde a comparação: rode compare_persons de novo.");
    }
    const check = await readMergeConstraint(ctx.http, survivor, duplicate);
    if (check.constraint === "other-order-only") {
      throw new Error(
        `O FamilySearch só permite mesclar na ordem inversa${check.reason ? ` ("${check.reason}")` : ""}: ` +
          `inverta os ids, sobrevivente ${duplicate} e duplicata ${survivor}, e confira a prévia de novo.`,
      );
    }
    if (check.constraint !== "allowed") {
      throw new Error(`O FamilySearch não permite mesclar ${duplicate} em ${survivor}: ${check.reason ?? "sem motivo informado"}.`);
    }
    const analysis = await readMergeAnalysis(ctx.http, survivor, duplicate);
    if (!analysis) throw new Error("O FamilySearch não devolveu a análise desta mesclagem; nada foi feito.");
    const request = buildMergeRequest(analysis, {
      takeFromDuplicate: args.take_from_duplicate ?? [],
      skipCopy: args.skip_copy ?? [],
    });

    // Raw documents: they name each resource now and become the snapshot later.
    const before = {
      survivor: { person: await readPerson(ctx.http, survivor), families: await readFamilies(ctx.http, survivor) },
      duplicate: { person: await readPerson(ctx.http, duplicate), families: await readFamilies(ctx.http, duplicate) },
    };
    const people = [before.survivor.person, before.duplicate.person, before.survivor.families, before.duplicate.families]
      .flatMap((document) => document.persons ?? []);
    const families = familiesOf([before.survivor.families, before.duplicate.families]);
    const label = (uri: string) => labelResource(uri, people, families);
    const flags = buildComparison(s, d, { aSurvives: check, bSurvives: check }, analysis).redFlags;

    const swapped = request.chosen;
    const kept = analysis.conflicts.filter((pair) => !swapped.includes(pair));
    const copied = analysis.duplicateResources.filter((uri) => request.resourcesToCopy.includes(uri));
    const skipped = analysis.duplicateResources.filter((uri) => !copied.includes(uri));
    const counts = `Copia ${copied.length}, troca ${swapped.length}.`;
    const undo = `Para desfazer: restore_person(${duplicate}). O que foi copiado continua em ${survivor}.`;
    const headline = [
      `Mesclar ${shortName(d)} em ${shortName(s)}`,
      flags.length > 0 ? `ATENÇÃO: ${signs(flags.length)}.` : `Fica ${survivor}; ${duplicate} deixa de existir. ${counts}`,
    ].join("\n");
    const details = [
      `Fica: ${nameOf(s)}, ${s.person.lifespan ?? "-"}.`,
      `Deixa de existir: ${nameOf(d)}, ${d.person.lifespan ?? "-"}; o id dela passa a apontar para ${survivor}.`,
      ...bullets(`ATENÇÃO: ${signs(flags.length)}:`, flags),
      "",
      counts,
      ...bullets("Copia da duplicata (só existe nela):", copied.map(label)),
      ...bullets("NÃO copia (skip_copy):", skipped.map(label)),
      ...bullets(
        "Troca, fica a versão da duplicata (take_from_duplicate):",
        swapped.map((pair) => `${label(pair.duplicate)}, no lugar de ${label(pair.survivor)}`),
      ),
      ...bullets(
        "Conflitos em que fica a versão da sobrevivente:",
        kept.map((pair) => {
          // A side shared with a chosen swap moves anyway: say so instead of "fica" or "não copia".
          const survivorSide = request.resourcesToDelete.includes(pair.survivor)
            ? `${resourceId(pair.survivor)} sai pela troca acima`
            : `fica ${label(pair.survivor)}`;
          const duplicateSide = request.resourcesToCopy.includes(pair.duplicate)
            ? `${resourceId(pair.duplicate)} entra pela troca acima`
            : `não copia ${label(pair.duplicate)}`;
          return `${survivorSide}; ${duplicateSide}`;
        }),
      ),
      ...bullets("Já está na sobrevivente:", analysis.survivorResources.map(label)),
      "",
      `Logo antes de enviar, as duas pessoas são salvas num snapshot local. ${undo}`,
    ].join("\n");

    let snapshot = null as string | null;
    const write = mergeWrite(survivor, duplicate, request);
    const plan: WritePlan = {
      tool: "merge_persons",
      reason: args.reason,
      headline,
      details,
      confirm: { title: `Digite o id da duplicata (${duplicate}) para confirmar`, expected: duplicate },
      touches: [survivor, duplicate],
      merged: { duplicate, survivor },
      writes: [
        {
          ...write,
          // Runs only after the "yes", right before the POST.
          body: () => {
            snapshot = saveSnapshot(ctx.config, `${survivor}-${duplicate}`, before, ctx.now());
            return write.body;
          },
        },
      ],
    };
    const duplicatePerson = before.duplicate.person.persons?.find((person) => person.id === duplicate) ?? { id: duplicate };
    const duplicateFamily = familiesOf([before.duplicate.families]);
    const outcome = await runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: () => readBackMerge(ctx, survivor, duplicate, request, { duplicatePerson, duplicateFamily }),
    });
    // The undo hint only where the merge may have happened (a refused POST merged nothing).
    const mayHaveMerged = snapshot !== null && outcome.status !== "refused";
    return { ...outcome, details, request, ...(snapshot ? { snapshot } : {}), ...(mayHaveMerged ? { undo } : {}) };
  },
});

export const restorePerson = defineTool({
  name: "restore_person",
  description: describeWrite(
    "restore_person",
    "Restaura uma pessoa mesclada ou apagada: ela volta a existir separada, com o próprio id (desfaz merge_persons). " +
      "O que a mesclagem copiou para a sobrevivente continua lá. Pede aprovação ao usuário numa pergunta na tela. " +
      "Custa 1 requisição antes da pergunta. preview: true mostra o plano sem perguntar nem escrever.",
  ),
  readOnly: false,
  destructive: true,
  input: Type.Object({ person_id: personIdField, reason: reasonField, preview: previewField }),
  run: async (args, ctx) => {
    const id = args.person_id;
    const touches = [id];
    const state = await readPerson(ctx.http, id).then(
      () => null,
      (error: unknown) => {
        if (error instanceof MergedError) {
          if (error.survivorId) touches.push(error.survivorId);
          const into = error.survivorId ?? "outra pessoa";
          return `Foi mesclada em ${into}; volta a existir separada, e o que foi copiado para ${into} continua lá.`;
        }
        if (error instanceof DeletedError) return "Foi apagada da árvore; volta a existir.";
        throw error;
      },
    );
    if (!state) throw new Error(`A pessoa ${id} não está mesclada nem apagada: não há o que restaurar.`);
    const plan: WritePlan = {
      tool: "restore_person",
      reason: args.reason,
      headline: `Restaurar ${id}\n${state}`,
      details: `${state}\nDepois, confira as duas pessoas e remova o que não for de cada uma.`,
      writes: [restoreWrite(id)],
      touches,
    };
    return runWritePlan(ctx, plan, {
      preview: args.preview,
      readBack: async () => {
        const what = `${id} existe de novo`;
        try {
          await readPerson(ctx.http, id);
          return { ok: true, checks: [{ what, ok: true, detail: "200" }] };
        } catch (error) {
          return { ok: false, checks: [{ what, ok: false, detail: errorText(error) }] };
        }
      },
    });
  },
});

export const mergeTools: ToolDef[] = [mergePersons, restorePerson];
