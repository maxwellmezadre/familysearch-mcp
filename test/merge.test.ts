import { describe, expect, test } from "bun:test";
import { buildMergeRequest, familiesOf, labelResource } from "../src/domain/merge.js";
import type { MergeAnalysis } from "../src/domain/types.js";

// buildMergeRequest decides what a merge sends: these tests pin its fixed rules.

const API = "https://api.familysearch.org/platform/tree";
const CHILD_LINK = `${API}/child-and-parents-relationships/RRRR-111`;
const SOURCE = `${API}/persons/BBBB-BBB/source-references/sr-dup-1`;
const BIRTH = { survivor: `${API}/persons/AAAA-AAA/conclusions/birth-a`, duplicate: `${API}/persons/BBBB-BBB/conclusions/birth-b` };
const DEATH = { survivor: `${API}/persons/AAAA-AAA/conclusions/death-a`, duplicate: `${API}/persons/BBBB-BBB/conclusions/death-b` };

const analysis: MergeAnalysis = {
  survivorResources: [`${API}/persons/AAAA-AAA/source-references/sr-1`],
  duplicateResources: [CHILD_LINK, SOURCE],
  conflicts: [BIRTH, DEATH],
};

describe("buildMergeRequest", () => {
  test("copies every duplicate-only resource by default", () => {
    expect(buildMergeRequest(analysis, { takeFromDuplicate: [], skipCopy: [] })).toEqual({
      resourcesToCopy: [CHILD_LINK, SOURCE],
      resourcesToDelete: [],
      chosen: [],
    });
  });

  test("skipCopy accepts the trailing id", () => {
    const request = buildMergeRequest(analysis, { takeFromDuplicate: [], skipCopy: ["RRRR-111"] });
    expect(request.resourcesToCopy).toEqual([SOURCE]);
    expect(buildMergeRequest(analysis, { takeFromDuplicate: [], skipCopy: [SOURCE] }).resourcesToCopy).toEqual([CHILD_LINK]);
  });

  test("a conflict taken from the duplicate copies its side and deletes the survivor's", () => {
    const request = buildMergeRequest(analysis, { takeFromDuplicate: ["birth-b"], skipCopy: [] });
    expect(request).toEqual({
      resourcesToCopy: [CHILD_LINK, SOURCE, BIRTH.duplicate],
      resourcesToDelete: [BIRTH.survivor],
      chosen: [BIRTH],
    });
    // The conflict not chosen (death) keeps the survivor's: nothing is sent for it.
    expect(JSON.stringify(request)).not.toContain("death");
  });

  test("two conflicts sharing the survivor's side: only the chosen one is swapped", () => {
    const shared = { ...analysis, conflicts: [BIRTH, { survivor: BIRTH.survivor, duplicate: DEATH.duplicate }] };
    const request = buildMergeRequest(shared, { takeFromDuplicate: ["birth-b"], skipCopy: [] });
    expect(request.chosen).toEqual([BIRTH]);
    expect(request.resourcesToCopy).toEqual([CHILD_LINK, SOURCE, BIRTH.duplicate]);
    expect(request.resourcesToDelete).toEqual([BIRTH.survivor]);
  });

  test("a one-sided conflict cannot be taken, and nothing empty is ever sent", () => {
    const oneSided = { ...analysis, duplicateResources: [CHILD_LINK, ""], conflicts: [{ survivor: "", duplicate: DEATH.duplicate }] };
    expect(() => buildMergeRequest(oneSided, { takeFromDuplicate: ["death-b"], skipCopy: [] })).toThrow(/death-b/);
    const request = buildMergeRequest(oneSided, { takeFromDuplicate: [], skipCopy: [] });
    expect([...request.resourcesToCopy, ...request.resourcesToDelete]).not.toContain("");
  });

  test("an unknown choice is an error naming it", () => {
    expect(() => buildMergeRequest(analysis, { takeFromDuplicate: ["nope-1"], skipCopy: [] })).toThrow(/nope-1/);
    expect(() => buildMergeRequest(analysis, { takeFromDuplicate: [], skipCopy: ["nope-2"] })).toThrow(/nope-2/);
    // A conflict is not a duplicate-only resource, and the other way round.
    expect(() => buildMergeRequest(analysis, { takeFromDuplicate: [], skipCopy: ["birth-b"] })).toThrow(/birth-b/);
    expect(() => buildMergeRequest(analysis, { takeFromDuplicate: ["RRRR-111"], skipCopy: [] })).toThrow(/RRRR-111/);
  });
});

describe("labelResource", () => {
  const people = [
    {
      id: "BBBB-BBB",
      display: { name: "Giulia Rossi" },
      names: [{ id: "name-b", nameForms: [{ fullText: "Giulia Rosi" }] }],
      gender: { id: "gender-b", type: "http://gedcomx.org/Female" },
      facts: [{ id: "birth-b", type: "http://gedcomx.org/Birth", date: { original: "1890" }, place: { original: "Treviso" } }],
    },
    { id: "CCCC-CCC", display: { name: "Luca Rossi" } },
  ];
  const ref = (id: string) => ({ resource: `#${id}`, resourceId: id });
  const families = familiesOf([
    {
      persons: people,
      childAndParentsRelationships: [{ id: "RRRR-111", parent1: ref("BBBB-BBB"), child: ref("CCCC-CCC") }],
      relationships: [{ id: "CPLE-222", type: "http://gedcomx.org/Couple", person1: ref("DDDD-DDD"), person2: ref("BBBB-BBB") }],
    },
  ]);

  test("says what each resource is, whose, and its id", () => {
    expect(labelResource(BIRTH.duplicate, people, families)).toBe("Birth: 1890, Treviso, de Giulia Rossi [BBBB-BBB] (birth-b)");
    expect(labelResource(`${API}/persons/BBBB-BBB/conclusions/name-b`, people, families)).toBe(
      'nome "Giulia Rosi", de Giulia Rossi [BBBB-BBB] (name-b)',
    );
    expect(labelResource(`${API}/persons/BBBB-BBB/conclusions/gender-b`, people, families)).toBe(
      "sexo feminino, de Giulia Rossi [BBBB-BBB] (gender-b)",
    );
    expect(labelResource(CHILD_LINK, people, families)).toBe(
      "filiação: Luca Rossi [CCCC-CCC] é filho(a) de Giulia Rossi [BBBB-BBB] (RRRR-111)",
    );
    expect(labelResource(`${API}/couple-relationships/CPLE-222`, people, families)).toBe(
      "casal: Giulia Rossi [BBBB-BBB] e DDDD-DDD (CPLE-222)",
    );
    expect(labelResource(SOURCE, people, families)).toBe("fonte, de Giulia Rossi [BBBB-BBB] (sr-dup-1)");
    expect(labelResource(`${API}/something/else/x-1`, people, families)).toBe(`${API}/something/else/x-1`);
  });
});
