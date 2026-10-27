import { describe, expect, test } from "bun:test";
import { buildComparison, suggestSurvivor } from "../src/domain/compare.js";
import type { Fact, MergeCheck, PersonBundle, PersonSummary } from "../src/domain/types.js";

// buildComparison is pure: these tests pin every rule the design fixes.

const ALLOWED: MergeCheck = { constraint: "allowed", reason: null };
const BOTH = { aSurvives: ALLOWED, bSurvives: ALLOWED };

const fact = (type: string, original: string | null, place: string | null = null, formal: string | null = null): Fact => ({
  id: null,
  type,
  date: original ? { original, formal } : null,
  place,
  value: null,
});

const stub = (id: string, name: string): PersonSummary => ({
  id,
  name,
  gender: "unknown",
  living: false,
  lifespan: null,
  birth: null,
  death: null,
});

type BundleInput = {
  id?: string;
  name?: string;
  gender?: PersonSummary["gender"];
  living?: boolean;
  facts?: Fact[];
  parents?: Array<[string, string]>;
  spouses?: string[];
  children?: number;
  sourceCount?: number;
  changeCount?: number;
};

function bundle(input: BundleInput = {}): PersonBundle {
  const id = input.id ?? "AAAA-AAA";
  const children = Array.from({ length: input.children ?? 0 }, (_, i) => stub(`CH0${i}-AAA`, `Filho ${i}`));
  const spouses = input.spouses ?? [];
  return {
    person: {
      ...stub(id, input.name ?? "Giulia Rossi"),
      gender: input.gender ?? "female",
      living: input.living ?? false,
      names: [input.name ?? "Giulia Rossi"],
      facts: input.facts ?? [],
    },
    family: {
      parents: (input.parents ?? []).map(([father, mother], index) => ({
        relationshipId: `PR0${index}-AAA`,
        parent1: stub(`PF0${index}-AAA`, father),
        parent2: stub(`PM0${index}-AAA`, mother),
      })),
      spouses:
        spouses.length > 0
          ? spouses.map((spouse, index) => ({
              relationshipId: `SP0${index}-AAA`,
              spouse: stub(`SS0${index}-AAA`, spouse),
              marriage: null,
              children: index === 0 ? children : [],
            }))
          : children.length > 0
            ? [{ relationshipId: null, spouse: null, marriage: null, children }]
            : [],
    },
    sourceCount: input.sourceCount ?? 0,
    changeCount: input.changeCount ?? 1,
    lastChangeId: `${id}-change`,
  };
}

describe("red flags", () => {
  test("none for the same person written two ways", () => {
    const a = bundle({ id: "AAAA-AAA", name: "José Rossi", parents: [["José Rossi", "Maria Bertolini"]] });
    const b = bundle({ id: "BBBB-BBB", name: "Jose Rossi", parents: [["Jose Rossi", "MARIA Bertolini"]] });
    expect(buildComparison(a, b, BOTH, null).redFlags).toEqual([]);
  });

  test("different known genders", () => {
    const flags = buildComparison(bundle({ gender: "female" }), bundle({ id: "BBBB-BBB", gender: "male" }), BOTH, null).redFlags;
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/sexo/i);
  });

  test("an unknown gender is not a conflict", () => {
    expect(buildComparison(bundle({ gender: "unknown" }), bundle({ id: "BBBB-BBB", gender: "male" }), BOTH, null).redFlags).toEqual([]);
  });

  test("birth years more than 5 apart", () => {
    const a = bundle({ facts: [fact("Birth", "1921", null, "+1921")] });
    const b = bundle({ id: "BBBB-BBB", facts: [fact("Birth", "about 1934")] });
    expect(buildComparison(a, b, BOTH, null).redFlags[0]).toMatch(/nascimento.*13/);
  });

  test("birth years up to 5 apart are a conflict, not a red flag", () => {
    const a = bundle({ facts: [fact("Birth", "3 March 1921", "Garibaldi", "+1921-03-03")] });
    const b = bundle({ id: "BBBB-BBB", facts: [fact("Birth", "March 1922", null, "+1922-03")] });
    const comparison = buildComparison(a, b, BOTH, null);
    expect(comparison.redFlags).toEqual([]);
    expect(comparison.conflicts).toHaveLength(1);
    expect(comparison.conflicts[0]!.type).toBe("Birth");
  });

  test("death years more than 5 apart", () => {
    const a = bundle({ facts: [fact("Death", "2018", null, "+2018")] });
    const b = bundle({ id: "BBBB-BBB", facts: [fact("Death", "1990", null, "+1990")] });
    expect(buildComparison(a, b, BOTH, null).redFlags[0]).toMatch(/morte|falecimento/i);
  });

  test("both have parents and none in common", () => {
    const a = bundle({ parents: [["João Rossi", "Ana Bertolini"]] });
    const b = bundle({ id: "BBBB-BBB", parents: [["Pedro Silva", "Rosa Lima"]] });
    expect(buildComparison(a, b, BOTH, null).redFlags[0]).toMatch(/pais/i);
  });

  test("parents on one side only is not a red flag", () => {
    const a = bundle({ parents: [["João Rossi", "Ana Bertolini"]] });
    expect(buildComparison(a, bundle({ id: "BBBB-BBB" }), BOTH, null).redFlags).toEqual([]);
  });

  test("both have spouses and none in common", () => {
    const a = bundle({ spouses: ["Pietro Conti"] });
    const b = bundle({ id: "BBBB-BBB", spouses: ["Carlos Souza"] });
    expect(buildComparison(a, b, BOTH, null).redFlags[0]).toMatch(/cônjuge/i);
  });
});

describe("facts", () => {
  test("equal facts are neither only-one-side nor conflicts", () => {
    const a = bundle({ facts: [fact("Death", "2018", "Garibaldi", "+2018")] });
    const b = bundle({ id: "BBBB-BBB", facts: [fact("Death", "2018", "garibaldi", "+2018")] });
    const comparison = buildComparison(a, b, BOTH, null);
    expect(comparison.onlyA).toEqual([]);
    expect(comparison.onlyB).toEqual([]);
    expect(comparison.conflicts).toEqual([]);
  });

  test("a fact on one side only", () => {
    const a = bundle({ facts: [fact("Residence", "1960", "Garibaldi")] });
    const comparison = buildComparison(a, bundle({ id: "BBBB-BBB" }), BOTH, null);
    expect(comparison.onlyA.map((item) => item.type)).toEqual(["Residence"]);
    expect(comparison.onlyB).toEqual([]);
  });

  test("a non-vital fact that differs goes to each side, not to conflicts", () => {
    const a = bundle({ facts: [fact("Residence", "1960", "Garibaldi")] });
    const b = bundle({ id: "BBBB-BBB", facts: [fact("Residence", "1970", "Taquara")] });
    const comparison = buildComparison(a, b, BOTH, null);
    expect(comparison.conflicts).toEqual([]);
    expect(comparison.onlyA).toHaveLength(1);
    expect(comparison.onlyB).toHaveLength(1);
  });
});

describe("path and suggestion", () => {
  test("a living person means relink, never merge", () => {
    const comparison = buildComparison(bundle({ living: true }), bundle({ id: "BBBB-BBB" }), BOTH, null);
    expect(comparison.path).toBe("relink");
    expect(comparison.suggestion).toBeNull();
  });

  test("no allowed order means blocked, with FamilySearch's reason", () => {
    const refused: MergeCheck = { constraint: "not-allowed", reason: "Neither person being merged can be restricted" };
    const comparison = buildComparison(bundle(), bundle({ id: "BBBB-BBB" }), { aSurvives: refused, bSurvives: refused }, null);
    expect(comparison.path).toBe("blocked");
    expect(comparison.pathReason).toContain("restricted");
    expect(comparison.suggestion).toBeNull();
  });

  test("the more complete person survives: sources x3, relationships x2, changes", () => {
    const a = bundle({ id: "AAAA-AAA", sourceCount: 0, spouses: ["Pietro"], children: 1, changeCount: 2 });
    const b = bundle({ id: "BBBB-BBB", sourceCount: 1, parents: [["João", "Ana"]], changeCount: 5 });
    // a: 0*3 + 2*2 + 2 = 6; b: 1*3 + 2*2 + 5 = 12
    const suggestion = suggestSurvivor(a, b, BOTH);
    expect(suggestion).toMatchObject({ survivorId: "BBBB-BBB", duplicateId: "AAAA-AAA" });
    expect(suggestion?.why).toContain("12");
  });

  test("a single allowed order wins over the score", () => {
    const a = bundle({ id: "AAAA-AAA", sourceCount: 0 });
    const b = bundle({ id: "BBBB-BBB", sourceCount: 9 });
    const order = { aSurvives: ALLOWED, bSurvives: { constraint: "other-order-only", reason: null } as MergeCheck };
    expect(suggestSurvivor(a, b, order)?.survivorId).toBe("AAAA-AAA");
  });

  test("a tie keeps the first person", () => {
    expect(suggestSurvivor(bundle(), bundle({ id: "BBBB-BBB" }), BOTH)?.survivorId).toBe("AAAA-AAA");
  });

  test("the fingerprint ties the comparison to the last change of each person", () => {
    expect(buildComparison(bundle(), bundle({ id: "BBBB-BBB" }), BOTH, null).fingerprint).toBe(
      "AAAA-AAA-change|BBBB-BBB-change",
    );
  });
});
