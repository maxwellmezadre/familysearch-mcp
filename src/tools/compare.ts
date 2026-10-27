import { Type } from "@sinclair/typebox";
import { buildComparison, suggestSurvivor } from "../domain/compare.js";
import { toChanges, toFamily, toPersonDetail, toSources } from "../domain/normalize.js";
import type { PersonBundle } from "../domain/types.js";
import type { Http } from "../core/http.js";
import {
  readChanges,
  readFamilies,
  readMergeAnalysis,
  readMergeConstraint,
  readPerson,
  readSources,
} from "../familysearch/api.js";
import { defineTool } from "./define.js";
import { personIdField } from "./fields.js";

// The read-only half of a merge: everything the user needs to decide whether
// two tree persons are the same one, and which should stay. Nothing here
// writes; the merge itself lives behind the approval gate.

/** Person, family, source count and change history of one side: 4 requests. */
async function loadBundle(http: Http, id: string): Promise<PersonBundle> {
  const document = await readPerson(http, id);
  const person = document.persons?.find((candidate) => candidate.id === id) ?? document.persons?.[0];
  const family = toFamily(await readFamilies(http, id), id);
  const sourceCount = toSources(await readSources(http, id)).length;
  const changes = toChanges(await readChanges(http, id));
  return {
    person: toPersonDetail(person ?? { id }),
    family,
    sourceCount,
    changeCount: changes.length,
    lastChangeId: changes[0]?.id ?? null,
  };
}

export const comparePersons = defineTool({
  name: "compare_persons",
  description:
    "Compara duas pessoas da árvore lado a lado para decidir se são a mesma: fatos só de um lado, conflitos " +
    "(ex.: duas datas de nascimento), sinais de que NÃO são a mesma pessoa (sexo, anos, pais ou cônjuges " +
    "diferentes), se o FamilySearch permite mesclar e em que ordem, qual deveria ficar e o que a mesclagem " +
    "levaria. Só lê. Custa 10 requisições, 11 quando a mesclagem é permitida. Mostre os sinais de alerta ao " +
    "usuário antes de qualquer decisão.",
  readOnly: true,
  input: Type.Object({ person_a: personIdField, person_b: personIdField }),
  run: async (args, ctx) => {
    if (args.person_a === args.person_b) {
      throw new Error("As duas são a mesma pessoa (mesmo id): não há o que comparar.");
    }
    const a = await loadBundle(ctx.http, args.person_a);
    const b = await loadBundle(ctx.http, args.person_b);
    const order = {
      aSurvives: await readMergeConstraint(ctx.http, args.person_a, args.person_b),
      bSurvives: await readMergeConstraint(ctx.http, args.person_b, args.person_a),
    };
    const living = a.person.living || b.person.living;
    const suggestion = living ? null : suggestSurvivor(a, b, order);
    const analysis = suggestion
      ? await readMergeAnalysis(ctx.http, suggestion.survivorId, suggestion.duplicateId)
      : null;
    return buildComparison(a, b, order, analysis);
  },
});
