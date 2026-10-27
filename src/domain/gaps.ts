import type { CachedPerson } from "../cache/repo.js";

// Offline analysis of the cached lineage: what is missing, ranked by how
// worthwhile it is to research. Pure: no network, no database.

export type GapKind =
  | "missing_father"
  | "missing_mother"
  | "missing_birth"
  | "missing_birth_date"
  | "missing_birth_place"
  | "missing_death"
  | "no_sources"
  | "pending_hints"
  | "possible_duplicates";

export const GAP_KINDS: GapKind[] = [
  "missing_father",
  "missing_mother",
  "missing_birth",
  "missing_birth_date",
  "missing_birth_place",
  "missing_death",
  "no_sources",
  "pending_hints",
  "possible_duplicates",
];

export type Gap = {
  personId: string;
  name: string | null;
  number: string;
  generation: number;
  kinds: GapKind[];
  labels: string[];
  score: number;
  url: string;
};

const WEIGHT: Record<GapKind, number> = {
  missing_father: 10,
  missing_mother: 10,
  pending_hints: 6,
  possible_duplicates: 5,
  no_sources: 4,
  missing_birth: 3,
  missing_birth_date: 2,
  missing_birth_place: 2,
  missing_death: 1,
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function findGaps(people: CachedPerson[], maxGeneration: number, baseUrl: string): Gap[] {
  // Spouses ("5-S") and anyone outside the lineage are not analyzed.
  const lineage = people.filter((p) => p.ascendancy !== null && /^\d+$/.test(p.ascendancy) && p.generation !== null);
  const numbers = new Set(lineage.map((p) => p.ascendancy));
  const gaps: Gap[] = [];

  for (const p of lineage) {
    const number = p.ascendancy as string;
    const generation = p.generation as number;
    const n = Number(number);
    const found: Array<[GapKind, string]> = [];
    if (generation < maxGeneration) {
      if (!numbers.has(String(2 * n))) found.push(["missing_father", "sem pai na árvore"]);
      if (!numbers.has(String(2 * n + 1))) found.push(["missing_mother", "sem mãe na árvore"]);
    }
    if (!p.birthDate && !p.birthPlace) found.push(["missing_birth", "sem nascimento"]);
    else if (!p.birthDate) found.push(["missing_birth_date", "sem data de nascimento"]);
    else if (!p.birthPlace) found.push(["missing_birth_place", "sem lugar de nascimento"]);
    if (!p.living && !p.deathDate && !p.deathPlace) found.push(["missing_death", "sem data nem lugar de falecimento"]);
    // null means "not synced yet", which is not a gap.
    if (p.sourceCount === 0) found.push(["no_sources", "sem fontes"]);
    if (p.hintCount) found.push(["pending_hints", plural(p.hintCount, "sugestão de registro pendente", "sugestões de registro pendentes")]);
    if (p.duplicateCount) found.push(["possible_duplicates", plural(p.duplicateCount, "possível duplicata", "possíveis duplicatas")]);
    if (found.length === 0) continue;

    const raw = found.reduce((sum, [kind]) => sum + WEIGHT[kind], 0);
    gaps.push({
      personId: p.id,
      name: p.name,
      number,
      generation,
      kinds: found.map(([kind]) => kind),
      labels: found.map(([, label]) => label),
      score: Math.round(((raw * (maxGeneration + 1 - generation)) / (maxGeneration + 1)) * 100) / 100,
      url: `${baseUrl}/tree/person/details/${p.id}`,
    });
  }
  return gaps.sort((a, b) => b.score - a.score || Number(a.number) - Number(b.number));
}
