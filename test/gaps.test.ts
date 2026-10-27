import { describe, expect, test } from "bun:test";
import type { CachedPerson } from "../src/cache/repo.js";
import { findGaps } from "../src/domain/gaps.js";

const base = "https://x.test";
// A complete person: nothing missing except what a test removes.
const p = (ascendancy: string, generation: number, over: Partial<CachedPerson> = {}): CachedPerson => ({
  id: `P-${ascendancy}`, name: `Pessoa ${ascendancy}`, given: null, surname: null, gender: "male", living: false,
  lifespan: null, birthDate: "1800", birthFormal: null, birthPlace: "Lugar", deathDate: "1870", deathFormal: null,
  deathPlace: "Lugar", ascendancy, generation, sourceCount: 2, hintCount: 0, duplicateCount: 0, detailsAt: "t",
  mergedInto: null, raw: "{}", updatedAt: "t", ...over,
});
// Max generation 0, so parents are not expected.
const kinds = (person: CachedPerson) => findGaps([person], 0, base)[0]?.kinds ?? [];

describe("findGaps", () => {
  test("each kind in isolation", () => {
    expect(kinds(p("1", 0))).toEqual([]);
    expect(kinds(p("1", 0, { birthDate: null, birthPlace: null }))).toEqual(["missing_birth"]);
    expect(kinds(p("1", 0, { birthDate: null }))).toEqual(["missing_birth_date"]);
    expect(kinds(p("1", 0, { birthPlace: null }))).toEqual(["missing_birth_place"]);
    expect(kinds(p("1", 0, { deathDate: null, deathPlace: null }))).toEqual(["missing_death"]);
    expect(kinds(p("1", 0, { deathDate: null, deathPlace: null, living: true }))).toEqual([]);
    expect(kinds(p("1", 0, { sourceCount: 0 }))).toEqual(["no_sources"]);
    expect(kinds(p("1", 0, { sourceCount: null }))).toEqual([]);
    expect(kinds(p("1", 0, { hintCount: 3 }))).toEqual(["pending_hints"]);
    expect(kinds(p("1", 0, { duplicateCount: 1 }))).toEqual(["possible_duplicates"]);
  });

  test("labels in pt-BR with singular and plural", () => {
    const [gap] = findGaps([p("1", 0, { hintCount: 1, duplicateCount: 2, sourceCount: 0 })], 0, base);
    expect(gap?.labels).toEqual(["sem fontes", "1 sugestão de registro pendente", "2 possíveis duplicatas"]);
    expect(findGaps([p("1", 0, { hintCount: 3, duplicateCount: 1 })], 0, base)[0]?.labels).toEqual([
      "3 sugestões de registro pendentes",
      "1 possível duplicata",
    ]);
  });

  test("father and mother missing only below the max generation", () => {
    const gaps = findGaps([p("1", 0), p("2", 1), p("5", 2)], 2, base);
    const byNumber = Object.fromEntries(gaps.map((g) => [g.number, g]));
    // 1 has father (2) but no mother (3); 2 has mother (5) but no father (4); 5 sits at max generation.
    expect(byNumber["1"]?.kinds).toEqual(["missing_mother"]);
    expect(byNumber["1"]?.labels).toEqual(["sem mãe na árvore"]);
    expect(byNumber["2"]?.kinds).toEqual(["missing_father"]);
    expect(byNumber["2"]?.labels).toEqual(["sem pai na árvore"]);
    expect(byNumber["5"]).toBeUndefined();
  });

  test("spouses are ignored", () => {
    expect(findGaps([p("1-S", 0, { sourceCount: 0 })], 0, base)).toEqual([]);
    // A spouse never counts as a parent either.
    expect(findGaps([p("1", 0), p("2-S", 1)], 1, base)[0]?.kinds).toEqual(["missing_father", "missing_mother"]);
  });

  test("score is weighted by generation and sorted, ties by number", () => {
    // Full pedigree (1..7, max generation 2), so only the chosen gaps count.
    const people = [
      p("3", 1, { sourceCount: 0 }), // 4 * 2/3
      p("1", 0, { sourceCount: 0 }), // 4 * 3/3
      p("2", 1, { sourceCount: 0 }), // same as 3
      p("4", 2, { hintCount: 1 }), // 6 * 1/3
      p("5", 2),
      p("6", 2),
      p("7", 2),
    ];
    const gaps = findGaps(people, 2, base);
    expect(gaps.map((g) => g.number)).toEqual(["1", "2", "3", "4"]);
    expect(gaps.map((g) => g.score)).toEqual([4, 2.67, 2.67, 2]);
    expect(gaps[0]?.url).toBe(`${base}/tree/person/details/P-1`);
  });
});
