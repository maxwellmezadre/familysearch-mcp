import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCache } from "../src/cache/db.js";
import type { PersonInput } from "../src/cache/repo.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { runTool } from "../src/tools/define.js";
import { toolByName } from "../src/tools/registry.js";
import { fakeClock, memorySession, scriptedFetch, sessionFixture, silentLogger } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const input = (id: string, over: Partial<PersonInput> = {}): PersonInput => ({
  id, name: "Giulia Rossi", given: "Giulia", surname: "Rossi", gender: "female", living: false, lifespan: null,
  birthDate: "1937", birthFormal: "+1937", birthPlace: "Torino", deathDate: null, deathFormal: null,
  deathPlace: null, ascendancy: null, generation: null, raw: "{}", ...over,
});

function setup(seed = true) {
  const exportDir = join(mkdtempSync(join(tmpdir(), "fs-export-")), "out");
  dirs.push(join(exportDir, ".."));
  const fetch = scriptedFetch([]);
  const clock = fakeClock();
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: "/nonexistent/fs", FAMILYSEARCH_EXPORT_DIR: exportDir }), {
    fetch, db: openCache(":memory:"), session: memorySession(sessionFixture()), log: silentLogger(), now: clock.now, sleep: clock.sleep,
  });
  if (seed) {
    const repo = ctx.cache();
    repo.setMeta("root_id", "AAAA-AA1");
    repo.upsertPerson(input("AAAA-AA1", { ascendancy: "1", generation: 0 }));
    repo.upsertPerson(input("AAAA-AA2", { name: "ジュゼッペ Rossi", given: "ジュゼッペ", gender: "male", ascendancy: "2", generation: 1 }));
    repo.upsertPerson(input("AAAA-AA3", { name: "Anna Bianchi", living: true, ascendancy: "3", generation: 1 }));
    repo.upsertPerson(input("AAAA-AA9", { name: "Fora Daqui" }));
    repo.upsertRelationship({ id: "r1", kind: "parents", person1: "AAAA-AA2", person2: "AAAA-AA3", child: "AAAA-AA1" });
    repo.upsertRelationship({ id: "r2", kind: "couple", person1: "AAAA-AA9", person2: "AAAA-AA2", child: null });
  }
  return { ctx, fetch, exportDir };
}
const run = (ctx: ReturnType<typeof setup>["ctx"], args: unknown) => runTool(toolByName("export")!, args, ctx) as Promise<any>;

describe("export tool", () => {
  test("gedcom: 0600 file inside exportDir, living masked, no network", async () => {
    const { ctx, fetch, exportDir } = setup();
    const r = await run(ctx, { format: "gedcom" });
    expect(r.path).toBe(join(exportDir, "familysearch-AAAA-AA1-2025-09-04.ged"));
    expect(statSync(r.path).mode & 0o777).toBe(0o600);
    expect(statSync(exportDir).mode & 0o777).toBe(0o700);
    expect(r).toMatchObject({ persons: 3, relationships: 1, maskedLiving: 1 });
    const text = readFileSync(r.path, "utf8");
    expect(text).toContain("1 NAME ジュゼッペ /Rossi/");
    expect(text).toContain("1 NAME Pessoa /viva/");
    expect(text).not.toContain("Bianchi");
    expect(text).toContain("1 _FSFTID AAAA-AA3");
    expect(text).toContain("1 HUSB @I2@\n1 WIFE @I3@\n1 CHIL @I1@");
    expect(fetch.calls.length).toBe(0);
  });

  test("include_living shows the living person; scope all exports the whole cache", async () => {
    const { ctx } = setup();
    const r = await run(ctx, { format: "json", scope: "all", include_living: true });
    expect(r).toMatchObject({ persons: 4, relationships: 2, maskedLiving: 0 });
    const data = JSON.parse(readFileSync(r.path, "utf8"));
    expect(data.rootId).toBe("AAAA-AA1");
    expect(data.persons.find((p: any) => p.id === "AAAA-AA3").name).toBe("Anna Bianchi");
    expect(data.persons[0].raw).toBeUndefined();
  });

  test("csv masks living fields", async () => {
    const { ctx } = setup();
    const r = await run(ctx, { format: "csv" });
    const text = readFileSync(r.path, "utf8");
    expect(text).toContain("AAAA-AA3,Pessoa viva,female,true,,,,,3,1,");
  });

  test("empty cache asks for sync", async () => {
    const { ctx } = setup(false);
    await expect(run(ctx, { format: "gedcom" })).rejects.toThrow("Rode sync primeiro");
  });
});
