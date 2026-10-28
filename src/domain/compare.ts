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

// "fu" is Italian for "the late", as in "fu Pietro Ferrazzin" in a child's record.
const PARTICLES = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "fu"]);

/** Letters to add, drop or change to turn `a` into `b` (Levenshtein). */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

/** Two spellings of one word: one letter off, two for words of 8+ letters read from handwriting. */
const close = (a: string, b: string): boolean => editDistance(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1);

/**
 * Could two names be the same person, as far as a red flag cares: first names at most one
 * letter apart and, when both have more, a later word in common, spelled close enough (`close`).
 * A married surname or a misread still matches ("Élida de Moura Prado", "Elda de Moura";
 * "Zanettin", "Zanetin"; "Bortoluzzi", "Mortoluzzo"); a shared surname alone does not ("João da
 * Silva", "Pedro da Silva").
 */
function sameName(left: string, right: string): boolean {
  const words = (name: string) => fold(name).split(" ").filter((word) => !PARTICLES.has(word));
  const [first = "", ...later] = words(left);
  const [firstB = "", ...laterB] = words(right);
  if (!close(first, firstB)) return false;
  return later.length === 0 || laterB.length === 0 || laterB.some((word) => later.some((other) => close(word, other)));
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

/** Portuguese and English spellings of the countries a Brazilian tree meets most. */
const COUNTRY_ALIASES: Record<string, string> = {
  brasil: "brazil",
  italia: "italy",
  alemanha: "germany",
  espanha: "spain",
  "estados unidos": "united states",
  eua: "united states",
  usa: "united states",
  uruguai: "uruguay",
  paraguai: "paraguay",
  polonia: "poland",
  "austria-hungria": "austria",
  libano: "lebanon",
  japao: "japan",
};

/**
 * The country of a standardized place ("Town, State, Country"). Only places
 * with at least three parts count: a bare town name says nothing about the country.
 */
function countryOf(place: string | null | undefined): string | null {
  const parts = place?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  if (parts.length < 3) return null;
  const country = fold(parts.at(-1)!);
  return COUNTRY_ALIASES[country] ?? country;
}

function birthPlace(bundle: PersonBundle): string | null {
  return bundle.person.facts.find((fact) => fact.type === "Birth")?.place ?? bundle.person.birth?.place ?? null;
}

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
  const [countryA, countryB] = [countryOf(birthPlace(a)), countryOf(birthPlace(b))];
  if (countryA && countryB && countryA !== countryB) {
    const label = (place: string | null) => place?.split(",").at(-1)?.trim() ?? "";
    flags.push(`Nasceram em países diferentes (${label(birthPlace(a))} e ${label(birthPlace(b))}).`);
  }
  const names = (people: Array<{ name: string | null } | null>) =>
    people.map((person) => person?.name?.trim() ?? "").filter(Boolean);
  const disjoint = (left: string[], right: string[]) =>
    left.length > 0 && right.length > 0 && !left.some((name) => right.some((other) => sameName(name, other)));
  const parents = (bundle: PersonBundle) =>
    names(bundle.family.parents.flatMap((entry) => [entry.parent1, entry.parent2]));
  const spouses = (bundle: PersonBundle) => names(bundle.family.spouses.map((entry) => entry.spouse));
  if (disjoint(parents(a), parents(b))) {
    flags.push(`Os pais não batem: nenhum nome de pai ou mãe em comum (${parents(a).join(", ")} contra ${parents(b).join(", ")}).`);
  }
  if (disjoint(spouses(a), spouses(b))) {
    flags.push(`Os cônjuges não batem: nenhum nome em comum (${spouses(a).join(", ")} contra ${spouses(b).join(", ")}).`);
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
