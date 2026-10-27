import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The repository is public and these fixtures come from real responses. This
// test is the standing guard: it fails if anything private ever gets committed.

const DIR = join(import.meta.dir, "fixtures");
const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));
const blob = files.map((name) => readFileSync(join(DIR, name), "utf8")).join("\n");
const SECRETS = join(import.meta.dir, "..", "task", "anonymize.secrets");

describe("committed fixtures", () => {
  test("the expected captures are all present", () => {
    expect(files.sort()).toEqual([
      "ancestry.json",
      "changes.json",
      "descendancy.json",
      "families.json",
      "matches.json",
      "person-merged.json",
      "person.json",
      "places.json",
      "record-search.json",
      "record.json",
      "sources.json",
      "tree-search.json",
    ]);
  });

  test("carry no session, e-mail or contributor attribution", () => {
    expect(blob).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    for (const marker of ["fssessionid", "Bearer", "\"attribution\"", "cis.user."]) {
      expect(blob).not.toContain(marker);
    }
  });

  test("were anonymized: the public subject's real id and name are gone", () => {
    for (const real of ["LZJW-C31", "LZJW-C61", "Lincoln", "Abraham"]) expect(blob).not.toContain(real);
  });

  test.skipIf(!existsSync(SECRETS))("contain none of the values in task/anonymize.secrets", () => {
    const secrets = readFileSync(SECRETS, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
    for (const secret of secrets) expect(blob).not.toContain(secret);
  });
});
