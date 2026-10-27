import { expect, test } from "bun:test";
import { RECORDS_COLLECTION } from "../src/familysearch/api.js";
import {
  attachSourceWrite, createPersonWrite, createSourceWrite, deleteConclusionWrite, deleteRelationshipWrite,
  factType, linkParentsWrite, linkSpousesWrite, matchResolutionWrite, mergeWrite, noteWrite, notAMatchWrite,
  personUpdateWrite, personUri, restoreWrite,
} from "../src/familysearch/writes.js";

const BASE = "https://beta.familysearch.org";
const GX = "http://gedcomx.org/";

test("personUri builds the tree URL", () => {
  expect(personUri(BASE, "AAAA-AAA")).toBe(`${BASE}/platform/tree/persons/AAAA-AAA`);
});

test("factType knows a GEDCOM X type in any case", () => {
  expect(factType("birth")).toBe("http://gedcomx.org/Birth");
  expect(factType("MILITARYSERVICE")).toBe("http://gedcomx.org/MilitaryService");
  expect(factType(" Residence ")).toBe("http://gedcomx.org/Residence");
});

test("factType maps GEDCOM X types and encodes custom ones", () => {
  expect(factType("Birth")).toBe("http://gedcomx.org/Birth");
  expect(factType("Apelido de família")).toBe("data:,Apelido%20de%20fam%C3%ADlia");
});

test("createPersonWrite always sends name parts", () => {
  const w = createPersonWrite({ givenName: "Ana", surname: "Silva", gender: "female", living: false, facts: [{ type: "Birth", date: "1900", place: "Recife" }] });
  expect([w.method, w.path]).toEqual(["POST", "/platform/tree/persons"]);
  expect(w.body).toEqual({
    persons: [{
      gender: { type: `${GX}Female` },
      living: false,
      names: [{ type: `${GX}BirthName`, preferred: true, nameForms: [{ fullText: "Ana Silva", parts: [{ type: `${GX}Given`, value: "Ana" }, { type: `${GX}Surname`, value: "Silva" }] }] }],
      facts: [{ type: `${GX}Birth`, date: { original: "1900" }, place: { original: "Recife" } }],
    }],
  });
});

test("personUpdateWrite adds, updates by id, sets gender and name", () => {
  const w = personUpdateWrite("AAAA-AAA", {
    addFacts: [{ type: "Death", date: "1980" }],
    updateFacts: [{ factId: "F1", type: "Birth", date: "1901" }],
    gender: "male",
    addName: { givenName: "Jo", surname: "Lima" },
  });
  expect([w.method, w.path]).toEqual(["POST", "/platform/tree/persons/AAAA-AAA"]);
  const p = (w.body as any).persons[0];
  expect(p.id).toBe("AAAA-AAA");
  expect(p.facts).toEqual([{ type: `${GX}Death`, date: { original: "1980" } }, { id: "F1", type: `${GX}Birth`, date: { original: "1901" } }]);
  expect(p.gender).toEqual({ type: `${GX}Male` });
  expect(p.names[0].nameForms[0].parts).toHaveLength(2);
});

test("deleteConclusionWrite deletes a fact", () => {
  const w = deleteConclusionWrite("AAAA-AAA", "F1");
  expect([w.method, w.path, w.body]).toEqual(["DELETE", "/platform/tree/persons/AAAA-AAA/conclusions/F1", undefined]);
});

test("linkParentsWrite sends both parents in one relationship and refuses none", () => {
  const w = linkParentsWrite(BASE, "CHLD-001", "DAD-001", "MOM-001");
  expect([w.method, w.path]).toEqual(["POST", "/platform/tree/relationships"]);
  expect(w.body).toEqual({
    childAndParentsRelationships: [{
      parent1: { resource: `${BASE}/platform/tree/persons/DAD-001`, resourceId: "DAD-001" },
      parent2: { resource: `${BASE}/platform/tree/persons/MOM-001`, resourceId: "MOM-001" },
      child: { resource: `${BASE}/platform/tree/persons/CHLD-001`, resourceId: "CHLD-001" },
    }],
  });
  expect(() => linkParentsWrite(BASE, "CHLD-001")).toThrow();
  expect((linkParentsWrite(BASE, "C", undefined, "M").body as any).childAndParentsRelationships[0].parent1).toBeUndefined();
});

test("linkSpousesWrite sends a couple with optional marriage", () => {
  const w = linkSpousesWrite(BASE, "A-1", "B-1", { type: "Marriage", date: "1920" });
  const r = (w.body as any).relationships[0];
  expect(r.type).toBe(`${GX}Couple`);
  expect(r.person1.resourceId).toBe("A-1");
  expect(r.facts).toEqual([{ type: `${GX}Marriage`, date: { original: "1920" } }]);
  expect((linkSpousesWrite(BASE, "A-1", "B-1").body as any).relationships[0].facts).toBeUndefined();
});

test("deleteRelationshipWrite picks the path by kind", () => {
  expect(deleteRelationshipWrite("couple", "R1").path).toBe("/platform/tree/couple-relationships/R1");
  expect(deleteRelationshipWrite("parents", "R2").path).toBe("/platform/tree/child-and-parents-relationships/R2");
  expect(deleteRelationshipWrite("couple", "R1").method).toBe("DELETE");
});

test("source writes: create, then attach with the earlier Location", () => {
  const c = createSourceWrite({ title: "Certidão", citation: "Livro 1", about: "https://x.test/a" });
  expect([c.method, c.path]).toEqual(["POST", "/platform/sources/descriptions"]);
  expect(c.body).toEqual({ sourceDescriptions: [{ about: "https://x.test/a", titles: [{ value: "Certidão" }], citations: [{ value: "Livro 1" }] }] });
  const a = attachSourceWrite("AAAA-AAA");
  expect(a.path).toBe("/platform/tree/persons/AAAA-AAA");
  const body = a.body as (prior: any[]) => unknown;
  expect(body([{ label: "create source", status: 201, entityId: null, location: "https://fs/sd/1" }])).toEqual({
    persons: [{ id: "AAAA-AAA", sources: [{ description: "https://fs/sd/1" }] }],
  });
  expect(() => body([])).toThrow();
});

test("noteWrite targets person, couple and parents", () => {
  const n = { subject: "S", text: "T" };
  const p = noteWrite({ kind: "person", id: "P1" }, n);
  expect(p.path).toBe("/platform/tree/persons/P1/notes");
  expect(p.body).toEqual({ persons: [{ id: "P1", notes: [n] }] });
  const c = noteWrite({ kind: "couple", id: "R1" }, n);
  expect(c.path).toBe("/platform/tree/couple-relationships/R1/notes");
  expect(c.body).toEqual({ relationships: [{ id: "R1", notes: [n] }] });
  const r = noteWrite({ kind: "parents", id: "R2" }, n);
  expect(r.path).toBe("/platform/tree/child-and-parents-relationships/R2/notes");
  expect(r.body).toEqual({ childAndParentsRelationships: [{ id: "R2", notes: [n] }] });
});

test("matchResolutionWrite puts status and collection in the query", () => {
  const w = matchResolutionWrite("P1", "https://ark/1", "accepted");
  expect(w.path).toBe("/platform/tree/persons/P1/matches");
  expect(w.query).toEqual({ status: "accepted", collection: RECORDS_COLLECTION });
  expect(w.body).toEqual({ persons: [{ identifiers: { $: ["https://ark/1"] } }] });
});

test("notAMatchWrite, mergeWrite and restoreWrite", () => {
  const n = notAMatchWrite("P1", "P2");
  expect([n.path, n.body]).toEqual(["/platform/tree/persons/P1/not-a-match", { persons: [{ id: "P2" }] }]);
  const m = mergeWrite("S-1", "D-1", { resourcesToCopy: ["a"], resourcesToDelete: ["b"] });
  expect(m.path).toBe("/platform/tree/persons/S-1/merges/D-1");
  expect(m.body).toEqual({ merges: [{ resourcesToCopy: [{ resource: "a" }], resourcesToDelete: [{ resource: "b" }] }] });
  const r = restoreWrite("P1");
  expect([r.method, r.path, r.body]).toEqual(["POST", "/platform/tree/persons/P1/restore", undefined]);
});

test("ids that could escape their path segment are refused by every builder", () => {
  for (const bad of ["..", ".", "%2e%2e", "../persons/X", "a/b", "x?y", "x#y", ""]) {
    expect(() => deleteConclusionWrite("KWCB-AAA", bad)).toThrow();
    expect(() => deleteConclusionWrite(bad, "F1")).toThrow();
    expect(() => deleteRelationshipWrite("couple", bad)).toThrow();
    expect(() => deleteRelationshipWrite("parents", bad)).toThrow();
    expect(() => personUpdateWrite(bad, { gender: "male" })).toThrow();
    expect(() => linkParentsWrite(BASE, bad, "D-1")).toThrow();
    expect(() => linkSpousesWrite(BASE, "A-1", bad)).toThrow();
    expect(() => noteWrite({ kind: "person", id: bad }, { subject: "s", text: "t" })).toThrow();
    expect(() => matchResolutionWrite(bad, "u", "accepted")).toThrow();
    expect(() => notAMatchWrite("P1", bad)).toThrow();
    expect(() => mergeWrite("S-1", bad, { resourcesToCopy: [], resourcesToDelete: [] })).toThrow();
    expect(() => restoreWrite(bad)).toThrow();
    expect(() => attachSourceWrite(bad)).toThrow();
  }
});
