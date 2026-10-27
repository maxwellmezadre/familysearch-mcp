import { expect, test } from "bun:test";
import { normalizeSearchDate } from "../src/domain/dates.js";

// FamilySearch search accepts only a bare year or an ISO date and answers 400
// to anything else; a range or a decade would wrongly NARROW the search to one
// year, so those drop the parameter instead.

test("a bare year and a valid ISO date pass through", () => {
  expect(normalizeSearchDate("1846")).toBe("1846");
  expect(normalizeSearchDate(" 1846-12-25 ")).toBe("1846-12-25");
});

test("an approximate or written-out date becomes its year", () => {
  expect(normalizeSearchDate("abt 1850")).toBe("1850");
  expect(normalizeSearchDate("cerca de 1850")).toBe("1850");
  expect(normalizeSearchDate("25 December 1846")).toBe("1846");
  expect(normalizeSearchDate("3 de março de 1921")).toBe("1921");
});

test("ranges, decades, invalid dates and no year drop the parameter", () => {
  expect(normalizeSearchDate("1850s")).toBeUndefined();
  expect(normalizeSearchDate("between 1840 and 1850")).toBeUndefined();
  expect(normalizeSearchDate("entre 1840 e 1850")).toBeUndefined();
  expect(normalizeSearchDate("after 1840")).toBeUndefined();
  expect(normalizeSearchDate("antes de 1840")).toBeUndefined();
  expect(normalizeSearchDate("1846-02-30")).toBeUndefined();
  expect(normalizeSearchDate("sem data")).toBeUndefined();
  expect(normalizeSearchDate("")).toBeUndefined();
});
