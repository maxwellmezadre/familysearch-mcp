import { describe, expect, test } from "bun:test";
import type { GxDocument, GxFeed } from "../src/familysearch/gedcomx.js";
import {
  toChanges,
  toFamily,
  toNumbered,
  toPersonDetail,
  toPersonSummary,
  toSearchHits,
} from "../src/domain/normalize.js";
import { fixture } from "./helpers.js";

const body = <T>(name: string) => (fixture(name) as { body: T }).body;

// Ids below come from the committed, anonymized fixtures.
const FOCUS = "X8MM-G4S";
const SPOUSE = "ZMCV-S02";

describe("person", () => {
  const person = body<GxDocument>("person").persons![0]!;

  test("summary prefers the facts (formal date) and falls back to display", () => {
    const summary = toPersonSummary(person);
    expect(summary).toMatchObject({
      id: FOCUS,
      name: "Rui Lia Fausto",
      gender: "male",
      living: false,
      lifespan: "1809-1865",
    });
    expect(summary.birth).toEqual({
      date: { original: "12 February 1809", formal: "+1809-02-12" },
      place: "Hardin, Kentucky, United States",
    });
    expect(summary.death?.date?.formal).toBe("+1865-04-15");
  });

  test("detail lists every fact with a short type, custom types decoded", () => {
    const detail = toPersonDetail(person);
    expect(detail.names).toEqual(["Rui Lia Fausto"]);
    expect(detail.facts.map((fact) => fact.type)).toEqual([
      "Birth",
      "Death",
      "Residence",
      "Residence",
      "Residence",
      "Burial",
      "Occupation",
      "Address of location of death",
      "Address of Cemetery",
    ]);
    expect(detail.facts[2]).toMatchObject({ date: { original: "1840", formal: "+1840" }, value: null });
  });

  test("a person without names or facts does not throw", () => {
    const summary = toPersonSummary({ id: "AAAA-AAA" });
    expect(summary).toEqual({
      id: "AAAA-AAA",
      name: null,
      gender: "unknown",
      living: false,
      lifespan: null,
      birth: null,
      death: null,
    });
    expect(toPersonDetail({ id: "AAAA-AAA" }).facts).toEqual([]);
  });

  test("every name form is kept, non-latin scripts included", () => {
    const detail = toPersonDetail({
      id: "AAAA-AAA",
      names: [
        { nameForms: [{ fullText: "Giuseppe Rossi" }, { fullText: "ジュゼッペ" }] },
        { nameForms: [{ fullText: "José Rossi" }] },
        { nameForms: [{ fullText: "Giuseppe Rossi" }] },
      ],
    });
    expect(detail.names).toEqual(["Giuseppe Rossi", "ジュゼッペ", "José Rossi"]);
    expect(detail.name).toBe("Giuseppe Rossi");
  });
});

describe("family", () => {
  const family = toFamily(body<GxDocument>("families"), FOCUS);

  test("both parents come from one child-and-parents relationship", () => {
    expect(family.parents).toHaveLength(1);
    expect(family.parents[0]).toMatchObject({
      relationshipId: "RNNZ-LF8",
      parent1: { id: "R0PS-M65" },
      parent2: { id: "SH88-N7M" },
    });
  });

  test("spouses carry the marriage and the children they had together", () => {
    const marriage = family.spouses.find((entry) => entry.spouse?.id === SPOUSE);
    expect(marriage?.relationshipId).toBe("R9NJ-PP4");
    expect(marriage?.marriage?.date?.original).toBe("4 November 1842");
    expect(marriage?.children.map((child) => child.id).sort()).toEqual(
      ["70CN-RXW", "BN5M-W2H", "D24P-M3D", "NN96-LKX"].sort(),
    );
  });
});

describe("feeds", () => {
  test("ancestry keeps the ascendancy number", () => {
    const people = toNumbered(body<GxDocument>("ancestry"), "ascendancyNumber");
    expect(people[0]).toMatchObject({ number: "1", id: FOCUS });
    expect(people.find((person) => person.number === "2")?.id).toBe("R0PS-M65");
  });

  test("descendancy keeps the descendancy number", () => {
    const people = toNumbered(body<GxDocument>("descendancy"), "descendancyNumber");
    expect(people.find((person) => person.number === "1.1")?.id).toBe("D24P-M3D");
  });

  test("changes: when, who, what", () => {
    const changes = toChanges(body<GxFeed>("changes"));
    expect(changes[0]).toEqual({
      id: "58ce84d0-a843-11f0-a38b-f75680295105_0_0",
      at: new Date(1760366765469).toISOString(),
      who: "FamilySearch",
      what: "Person Source Reference Removed",
    });
  });

  test("search hits pick the matched person out of each entry's family", () => {
    const hits = toSearchHits(body<GxFeed>("tree-search"));
    expect(hits[0]).toMatchObject({ id: FOCUS, confidence: 4, name: "Rui Lia Fausto" });
    expect(hits[0]!.score).toBeCloseTo(4.1236);
  });
});
