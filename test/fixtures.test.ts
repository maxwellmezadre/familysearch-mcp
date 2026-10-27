import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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
      "changes-b.json",
      "changes.json",
      "descendancy.json",
      "families-b.json",
      "families.json",
      "matches.json",
      "merge-analysis.json",
      "merge-options-reverse.json",
      "merge-options.json",
      "person-b.json",
      "person-merged.json",
      "person.json",
      "places.json",
      "record-search.json",
      "record.json",
      "sources-b.json",
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
    for (const real of ["LZJW-C31", "LZJW-C61", "G1CF-DLV", "Lincoln", "Abraham"]) expect(blob).not.toContain(real);
  });

});

// task/anonymize.secrets (outside the repo) lists the user's own family: ids,
// names, places. None of it may appear in ANY tracked file, code and tests
// included, not just the fixtures.
describe.skipIf(!existsSync(SECRETS))("tracked files", () => {
  test("contain none of the values in task/anonymize.secrets", () => {
    const root = join(import.meta.dir, "..");
    const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).stdout.split("\0").filter(Boolean);
    const secrets = readFileSync(SECRETS, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
    const leaks: string[] = [];
    for (const file of tracked) {
      const text = readFileSync(join(root, file), "utf8");
      for (const secret of secrets) if (text.includes(secret)) leaks.push(`${file}: ${secret}`);
    }
    expect(leaks).toEqual([]);
  });
});
