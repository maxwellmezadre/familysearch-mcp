import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, openCache } from "../src/cache/db.js";
import { type PersonInput, createCacheRepo } from "../src/cache/repo.js";
import { loadConfig } from "../src/config.js";

const person = (id: string, over: Partial<PersonInput> = {}): PersonInput => ({
  id,
  name: `Pessoa ${id}`,
  given: "Pessoa",
  surname: id,
  gender: "male",
  living: false,
  lifespan: "1800-1870",
  birthDate: "1800",
  birthFormal: "+1800",
  birthPlace: "Lugar",
  deathDate: null,
  deathFormal: null,
  deathPlace: null,
  ascendancy: null,
  generation: null,
  raw: "{}",
  ...over,
});

const repoOf = () => createCacheRepo(openCache(":memory:"), () => 1_757_000_000_000);

describe("cache", () => {
  test("migrations record the schema version", () => {
    const db = openCache(":memory:");
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
    expect(createCacheRepo(db, Date.now).getMeta("schema_version")).toBe("1");
  });

  test("cache files are 0600 and one per environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "fs-cache-"));
    const prod = loadConfig({ FAMILYSEARCH_CONFIG_DIR: dir });
    const beta = loadConfig({ FAMILYSEARCH_CONFIG_DIR: dir, FAMILYSEARCH_ENV: "beta" });
    expect(prod.dbPath).toBe(join(dir, "cache.production.db"));
    expect(beta.dbPath).toBe(join(dir, "cache.beta.db"));
    openCache(prod.dbPath).close();
    expect(statSync(prod.dbPath).mode & 0o777).toBe(0o600);
    const nested = join(dir, "novo", "cache.db");
    openCache(nested).close();
    expect(statSync(join(dir, "novo")).mode & 0o777).toBe(0o700);
  });

  test("upsert keeps counts and a known ascendancy; pending orders by generation", () => {
    const repo = repoOf();
    repo.upsertPerson(person("AAAA-AA1", { ascendancy: "3", generation: 1 }));
    repo.upsertPerson(person("AAAA-AA2", { ascendancy: "1", generation: 0 }));
    repo.upsertPerson(person("AAAA-AA3"));
    expect(repo.pendingDetails(10)).toEqual(["AAAA-AA2", "AAAA-AA1"]);
    repo.markDetails("AAAA-AA2", { sources: 2, hints: 1, duplicates: 0 });
    repo.upsertPerson(person("AAAA-AA2", { name: "Novo" }));
    expect(repo.person("AAAA-AA2")).toMatchObject({ name: "Novo", ascendancy: "1", sourceCount: 2, hintCount: 1 });
    expect(repo.pendingDetails(10)).toEqual(["AAAA-AA1"]);
    expect(repo.stats()).toMatchObject({ persons: 3, lineage: 2, pending: 1 });
  });

  test("merged persons leave the lineage", () => {
    const repo = repoOf();
    repo.upsertPerson(person("AAAA-AA1", { ascendancy: "1", generation: 0 }));
    repo.markMerged("AAAA-AA1", "BBBB-BB1");
    expect(repo.lineage()).toEqual([]);
    expect(repo.person("AAAA-AA1")?.mergedInto).toBe("BBBB-BB1");
  });

  test("relationships upsert by id", () => {
    const repo = repoOf();
    repo.upsertRelationship({ id: "R1", kind: "parents", person1: "A", person2: "B", child: "C", updatedAt: "" });
    repo.upsertRelationship({ id: "R1", kind: "parents", person1: "A", person2: null, child: "C", updatedAt: "" });
    expect(repo.relationships()).toHaveLength(1);
    expect(repo.relationships()[0]?.person2).toBeNull();
  });
});
