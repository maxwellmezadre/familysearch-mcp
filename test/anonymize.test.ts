import { expect, test } from "bun:test";
import { idsIn, replaceIds, setSalt } from "../scripts/anonymize-fixture.js";

// The fixture anonymizer's id rule: every FamilySearch id goes, whatever its
// first block looks like; year ranges stay.

test("ids with an all-digit first block are anonymized too", () => {
  setSalt("test-salt");
  const text = '"uri": "https://www.familysearch.org/platform/users/agents/1234-5BC", "id": "X8MM-G4S"';
  const output = replaceIds(text);
  expect(output).not.toContain("1234-5BC");
  expect(output).not.toContain("X8MM-G4S");
  expect(idsIn(text).sort()).toEqual(["1234-5BC", "X8MM-G4S"]);
});

test("year ranges and ISO dates are not ids", () => {
  setSalt("test-salt");
  const text = '"lifespan": "1809-1865", "formal": "+1809-02-12", "range": "1840-1850"';
  expect(replaceIds(text)).toBe(text);
  expect(idsIn(text)).toEqual([]);
});

test("the mapping is deterministic for a given salt", () => {
  setSalt("test-salt");
  const first = replaceIds("1234-5BC");
  setSalt("test-salt");
  expect(replaceIds("1234-5BC")).toBe(first);
});
