import type { GxDocument, GxPerson } from "../familysearch/gedcomx.js";
import { shortType, toFact, toFamily, toPersonSummary } from "./normalize.js";
import type { Family, MergeAnalysis, PersonSummary } from "./types.js";

// What a merge sends, and how to describe each resource of FamilySearch's
// merge analysis to the user. Pure. The default is the one the pilot taught:
// everything that only exists on the duplicate (a child link included) comes
// along, unless the user says otherwise.

export type MergeChoices = {
  /** Conflicts where the duplicate's version wins: the URI or its trailing id, of either side. */
  takeFromDuplicate: string[];
  /** Duplicate-only resources NOT to copy: the URI or its trailing id. */
  skipCopy: string[];
};

/** The last path segment: the id a user types for a resource. */
export const resourceId = (uri: string): string => uri.split(/[?#]/)[0]!.split("/").filter(Boolean).at(-1) ?? uri;

const matches = (choice: string, uri: string): boolean => uri !== "" && (choice === uri || choice === resourceId(uri));

export type MergeRequest = {
  resourcesToCopy: string[];
  resourcesToDelete: string[];
  /** The conflicts taken from the duplicate: the question lists exactly these as swaps. */
  chosen: MergeAnalysis["conflicts"];
};

export function buildMergeRequest(analysis: MergeAnalysis, choices: MergeChoices): MergeRequest {
  const taken = choices.takeFromDuplicate.map((choice) => {
    const conflict = analysis.conflicts.find((pair) => matches(choice, pair.duplicate) || matches(choice, pair.survivor));
    if (!conflict) throw new Error(`"${choice}" não é um conflito desta mesclagem: confira os ids em take_from_duplicate.`);
    // FamilySearch left one side out: there is nothing to swap, and "" must never be sent.
    if (!conflict.survivor || !conflict.duplicate) {
      throw new Error(`"${choice}": a análise do FamilySearch traz esse conflito com um lado vazio; não dá para trocar.`);
    }
    return conflict;
  });
  const chosen = [...new Set(taken)]; // either side's id names the same conflict
  const skipped = choices.skipCopy.map((choice) => {
    const resource = analysis.duplicateResources.find((uri) => matches(choice, uri));
    if (!resource) throw new Error(`"${choice}" não é um item só da duplicata nesta mesclagem: confira os ids em skip_copy.`);
    return resource;
  });
  return {
    resourcesToCopy: [
      ...analysis.duplicateResources.filter((uri) => uri !== "" && !skipped.includes(uri)),
      ...new Set(chosen.map((pair) => pair.duplicate)),
    ],
    resourcesToDelete: [...new Set(chosen.map((pair) => pair.survivor))],
    chosen,
  };
}

/**
 * The family of every person in these `/families` documents, keyed by person
 * id. Children get their own entry so a parent-child link is found by its id
 * even when the merged person is the parent.
 */
export function familiesOf(documents: GxDocument[]): Record<string, Family> {
  const families: Record<string, Family> = {};
  for (const document of documents) {
    for (const { id } of document.persons ?? []) {
      if (!id) continue;
      const family = toFamily(document, id);
      const seen = families[id];
      families[id] = seen
        ? { parents: [...seen.parents, ...family.parents], spouses: [...seen.spouses, ...family.spouses] }
        : family;
    }
  }
  return families;
}

type FoundRelationship =
  | { kind: "parents"; child: string; parents: PersonSummary[] }
  | { kind: "couple"; persons: [string, PersonSummary | null] };

/** A parent-child or couple relationship by its id, as these families saw it. */
export function findRelationship(families: Record<string, Family>, id: string): FoundRelationship | null {
  for (const [focus, family] of Object.entries(families)) {
    const parents = family.parents.find((entry) => entry.relationshipId === id);
    if (parents) {
      const found = [parents.parent1, parents.parent2].filter((parent): parent is PersonSummary => parent !== null);
      return { kind: "parents", child: focus, parents: found };
    }
    const couple = family.spouses.find((entry) => entry.relationshipId === id);
    if (couple) return { kind: "couple", persons: [focus, couple.spouse] };
  }
  return null;
}

const who = (id: string, person: PersonSummary | null | undefined): string =>
  person?.name ? `${person.name} [${id}]` : id;

type Conclusion = { id?: string; nameForms?: Array<{ fullText?: string }>; type?: string };

/** What one conclusion of a person is: a name, the sex or a fact; null when the person has no such id. */
export function conclusionText(person: GxPerson, conclusionId: string): string | null {
  const byId = (item: Conclusion | undefined) => item?.id === conclusionId;
  const name = (person.names as Conclusion[] | undefined)?.find(byId);
  if (name) return `nome "${name.nameForms?.[0]?.fullText ?? "?"}"`;
  if (byId(person.gender as Conclusion | undefined)) {
    const sex = { male: "masculino", female: "feminino" }[shortType(person.gender?.type).toLowerCase()] ?? "desconhecido";
    return `sexo ${sex}`;
  }
  const fact = person.facts?.find(byId);
  if (fact) {
    const { type, date, place, value } = toFact(fact);
    return `${type}: ${[date?.original, place, value].filter(Boolean).join(", ") || "-"}`;
  }
  return null;
}

/** Every conclusion of a person (names, sex, facts) as id and text: what a merge read-back compares. */
export function conclusionsOf(person: GxPerson): Array<{ id: string; text: string | null }> {
  const all = [...((person.names ?? []) as Conclusion[]), person.gender as Conclusion | undefined, ...(person.facts ?? [])];
  return all.flatMap((item) => (item?.id ? [{ id: item.id, text: conclusionText(person, item.id) }] : []));
}

/**
 * One merge-analysis resource in words, ending with the id the user can pass
 * to take_from_duplicate or skip_copy. Unknown shapes come back as the URI.
 */
export function labelResource(uri: string, people: GxPerson[], families: Record<string, Family>): string {
  const id = resourceId(uri);
  const summary = (personId: string) => {
    const person = people.find((candidate) => candidate.id === personId);
    return person ? toPersonSummary(person) : null;
  };
  const [, personId = "", kind] = /\/persons\/([^/]+)\/(conclusions|source-references)\//.exec(uri) ?? [];
  if (kind) {
    const person = people.find((candidate) => candidate.id === personId);
    const what = kind === "source-references" ? "fonte" : ((person && conclusionText(person, id)) ?? "dado");
    return `${what}, de ${who(personId, summary(personId))} (${id})`;
  }
  if (!/\/(child-and-parents-relationships|couple-relationships|relationships)\//.test(uri)) return uri;
  const found = findRelationship(families, id);
  if (found?.kind === "parents") {
    const parents = found.parents.map((parent) => who(parent.id, parent)).join(" e ");
    return `filiação: ${who(found.child, summary(found.child))} é filho(a) de ${parents || "?"} (${id})`;
  }
  if (found?.kind === "couple") {
    const [focus, spouse] = found.persons;
    return `casal: ${who(focus, summary(focus))} e ${spouse ? who(spouse.id, spouse) : "?"} (${id})`;
  }
  return uri;
}
