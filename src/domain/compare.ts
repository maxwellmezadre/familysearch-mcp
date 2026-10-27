import type {
  Comparison,
  Fact,
  Family,
  GenDate,
  MergeAnalysis,
  MergeCheck,
  PersonBundle,
  Suggestion,
} from "./types.js";

// Side-by-side comparison of two tree persons, pure. The rules are the
// design's (task/DESIGN.md, section 7) and every one of them is pinned by
// test/compare.test.ts. Above all this module exists to say when two people
// are probably NOT the same one: a wrong merge damages other families' work.

/** Facts whose disagreement is a conflict to resolve, not two separate events. */
const VITAL = new Set(["Birth", "Death", "Christening", "Burial", "Marriage"]);
/** More than this many years apart and they are probably two people. */
const MAX_YEAR_GAP = 5;

type Order = { aSurvives: MergeCheck; bSurvives: MergeCheck };

const fold = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "Giulia Maria Rossi" and "giulia rossi" share the key "giulia rossi". */
function nameKey(name: string | null): string | null {
  const words = name ? fold(name).split(" ").filter(Boolean) : [];
  if (words.length === 0) return null;
  return words.length === 1 ? words[0]! : `${words[0]} ${words.at(-1)}`;
}

function yearOf(date: GenDate | null | undefined): number | null {
  const match = /(\d{4})/.exec(date?.formal ?? "") ?? /(?<!\d)(\d{4})(?!\d)/.exec(date?.original ?? "");
  return match ? Number(match[1]) : null;
}

/** The year of a birth or death: the fact first, the summary (display) as fallback. */
function eventYear(bundle: PersonBundle, type: "Birth" | "Death"): number | null {
  const fact = bundle.person.facts.find((candidate) => candidate.type === type);
  const event = type === "Birth" ? bundle.person.birth : bundle.person.death;
  return yearOf(fact?.date ?? event?.date);
}

const dateKey = (fact: Fact): string | null => (fact.date ? fold(fact.date.formal ?? fact.date.original) : null);
const sameFact = (a: Fact, b: Fact): boolean =>
  a.type === b.type &&
  dateKey(a) === dateKey(b) &&
  (a.place ? fold(a.place) : null) === (b.place ? fold(b.place) : null) &&
  (a.value ? fold(a.value) : null) === (b.value ? fold(b.value) : null);

export function relationshipCount(family: Family): number {
  const parents = family.parents.flatMap((entry) => [entry.parent1, entry.parent2]).filter(Boolean).length;
  const spouses = family.spouses.filter((entry) => entry.spouse !== null).length;
  const children = family.spouses.reduce((total, entry) => total + entry.children.length, 0);
  return parents + spouses + children;
}

export const completeness = (bundle: PersonBundle): number =>
  bundle.sourceCount * 3 + relationshipCount(bundle.family) * 2 + bundle.changeCount;

function canSurvive(order: Order): { a: boolean; b: boolean } {
  return {
    a: order.aSurvives.constraint === "allowed" || order.bSurvives.constraint === "other-order-only",
    b: order.bSurvives.constraint === "allowed" || order.aSurvives.constraint === "other-order-only",
  };
}

/** Which one should stay: the order FamilySearch allows, else the more complete one (tie: a). */
export function suggestSurvivor(a: PersonBundle, b: PersonBundle, order: Order): Suggestion | null {
  const can = canSurvive(order);
  if (!can.a && !can.b) return null;
  const pick = (survivor: PersonBundle, duplicate: PersonBundle, why: string): Suggestion => ({
    survivorId: survivor.person.id,
    duplicateId: duplicate.person.id,
    why,
  });
  if (can.a !== can.b) {
    const [survivor, duplicate] = can.a ? [a, b] : [b, a];
    return pick(survivor, duplicate, "É a única ordem que o FamilySearch permite para este par.");
  }
  const describe = (bundle: PersonBundle): string =>
    `${bundle.person.id}: ${bundle.sourceCount} fontes, ${relationshipCount(bundle.family)} relacionamentos, ` +
    `${bundle.changeCount} alterações (pontuação ${completeness(bundle)})`;
  const [survivor, duplicate] = completeness(b) > completeness(a) ? [b, a] : [a, b];
  return pick(
    survivor,
    duplicate,
    `Fica a mais completa (fontes x3 + relacionamentos x2 + alterações). ${describe(survivor)}; ${describe(duplicate)}.`,
  );
}

function compareFacts(a: Fact[], b: Fact[]): Pick<Comparison, "onlyA" | "onlyB" | "conflicts"> {
  const restB = [...b];
  const restA = a.filter((fact) => {
    const index = restB.findIndex((other) => sameFact(fact, other));
    if (index === -1) return true;
    restB.splice(index, 1);
    return false;
  });
  const conflicts: Comparison["conflicts"] = [];
  for (const type of VITAL) {
    const left = restA.findIndex((fact) => fact.type === type);
    const right = restB.findIndex((fact) => fact.type === type);
    if (left === -1 || right === -1) continue;
    conflicts.push({ type, a: restA[left]!, b: restB[right]! });
    restA.splice(left, 1);
    restB.splice(right, 1);
  }
  return { onlyA: restA, onlyB: restB, conflicts };
}

function redFlags(a: PersonBundle, b: PersonBundle): string[] {
  const flags: string[] = [];
  const label = { male: "masculino", female: "feminino", unknown: "desconhecido" };
  if (a.person.gender !== "unknown" && b.person.gender !== "unknown" && a.person.gender !== b.person.gender) {
    flags.push(`Sexo diferente: ${a.person.id} é ${label[a.person.gender]}, ${b.person.id} é ${label[b.person.gender]}.`);
  }
  for (const [type, word] of [["Birth", "nascimento"], ["Death", "falecimento"]] as const) {
    const left = eventYear(a, type);
    const right = eventYear(b, type);
    if (left !== null && right !== null && Math.abs(left - right) > MAX_YEAR_GAP) {
      flags.push(`Anos de ${word} diferem em ${Math.abs(left - right)} anos (${left} e ${right}).`);
    }
  }
  const names = (people: Array<{ name: string | null } | null>) =>
    new Set(people.map((person) => nameKey(person?.name ?? null)).filter((key): key is string => key !== null));
  const disjoint = (left: Set<string>, right: Set<string>) =>
    left.size > 0 && right.size > 0 && ![...left].some((key) => right.has(key));
  const parents = (bundle: PersonBundle) =>
    names(bundle.family.parents.flatMap((entry) => [entry.parent1, entry.parent2]));
  const spouses = (bundle: PersonBundle) => names(bundle.family.spouses.map((entry) => entry.spouse));
  if (disjoint(parents(a), parents(b))) {
    flags.push(`Os pais não batem: nenhum nome de pai ou mãe em comum (${[...parents(a)].join(", ")} contra ${[...parents(b)].join(", ")}).`);
  }
  if (disjoint(spouses(a), spouses(b))) {
    flags.push(`Os cônjuges não batem: nenhum nome em comum (${[...spouses(a)].join(", ")} contra ${[...spouses(b)].join(", ")}).`);
  }
  return flags;
}

export function buildComparison(
  a: PersonBundle,
  b: PersonBundle,
  order: Order,
  analysis: MergeAnalysis | null,
): Comparison {
  const living = a.person.living || b.person.living;
  const can = canSurvive(order);
  const path: Comparison["path"] = living ? "relink" : !can.a && !can.b ? "blocked" : "merge";
  const reason = order.aSurvives.reason ?? order.bSurvives.reason;
  const pathReason =
    path === "relink"
      ? "Uma das pessoas está marcada como viva: o FamilySearch não mescla pessoa viva com a versão pública. " +
        "O caminho é ligar os filhos direto à versão pública e remover a ligação antiga."
      : path === "blocked"
        ? `O FamilySearch não permite mesclar este par${reason ? `: ${reason}` : "."}`
        : "O FamilySearch permite mesclar este par.";
  return {
    a,
    b,
    ...compareFacts(a.person.facts, b.person.facts),
    redFlags: redFlags(a, b),
    path,
    pathReason,
    suggestion: path === "merge" ? suggestSurvivor(a, b, order) : null,
    analysis,
    fingerprint: `${a.lastChangeId}|${b.lastChangeId}`,
  };
}
