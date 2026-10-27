import { describe, expect, test } from "bun:test";
import { openCache } from "../src/cache/db.js";
import { type PersonInput } from "../src/cache/repo.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { runTool } from "../src/tools/define.js";
import { activeTools, toolByName } from "../src/tools/registry.js";
import { scriptedFetch, silentLogger } from "./helpers.js";

const input = (ascendancy: string, generation: number): PersonInput => ({
  id: `P-${ascendancy}`, name: `Pessoa ${ascendancy}`, given: null, surname: null, gender: "male", living: false,
  lifespan: null, birthDate: "1800", birthFormal: null, birthPlace: "Lugar", deathDate: "1870", deathFormal: null,
  deathPlace: "Lugar", ascendancy, generation, raw: "{}",
});

function setup() {
  const fetch = scriptedFetch([]);
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: "/nonexistent/fs" }), {
    fetch,
    db: openCache(":memory:"),
    log: silentLogger(),
  });
  return { ctx, fetch, repo: ctx.cache() };
}
const find = (ctx: ReturnType<typeof setup>["ctx"], args: unknown) => runTool(toolByName("find_gaps")!, args, ctx) as Promise<any>;

describe("find_gaps", () => {
  test("is read-only, registered after compare_persons", () => {
    expect(toolByName("find_gaps")?.readOnly).toBe(true);
    const names = activeTools({ readOnly: true }).map((t) => t.name);
    expect(names).toContain("find_gaps");
    expect(names.indexOf("find_gaps")).toBe(names.indexOf("compare_persons") + 1);
  });

  test("empty cache points to sync", async () => {
    const { ctx, fetch } = setup();
    expect(await find(ctx, {})).toEqual({ gaps: [], note: "Rode sync primeiro: o cache está vazio." });
    expect(fetch.calls).toHaveLength(0);
  });

  test("reports gaps from the cache, filters by kind, limits, never uses the network", async () => {
    const { ctx, fetch, repo } = setup();
    for (const [n, g] of [["1", 0], ["2", 1], ["3", 1]] as const) {
      repo.upsertPerson(input(n, g));
      repo.markDetails(`P-${n}`, { sources: n === "2" ? 0 : 1, hints: n === "3" ? 2 : 0, duplicates: 0 });
    }
    repo.setMeta("generations", "2");
    const all = await find(ctx, {});
    expect(all.note).toBeUndefined();
    // Gen 1 people lack both parents (max 2); 1 has both of its own.
    expect(all.gaps.map((g: any) => g.number)).toEqual(["3", "2"]);
    expect(all.gaps[0].labels).toContain("2 sugestões de registro pendentes");
    expect(all.gaps[0].url).toBe(`${ctx.config.baseUrl}/tree/person/details/P-3`);
    const filtered = await find(ctx, { kinds: ["no_sources"] });
    expect(filtered.gaps.map((g: any) => g.number)).toEqual(["2"]);
    expect((await find(ctx, { limit: 1 })).gaps).toHaveLength(1);
    expect(fetch.calls).toHaveLength(0);
  });

  test("falls back to the deepest generation and warns about pending details", async () => {
    const { ctx, repo } = setup();
    repo.upsertPerson(input("1", 0));
    repo.upsertPerson(input("2", 1));
    repo.upsertPerson(input("3", 1));
    const result = await find(ctx, {});
    // Max generation 1: nobody lacks parents; neither person was detailed.
    expect(result.gaps).toEqual([]);
    expect(result.note).toContain("3 pessoas ainda não foram detalhadas");
  });

  test("rejects invalid arguments", async () => {
    const { ctx } = setup();
    await expect(find(ctx, { limit: 0 })).rejects.toThrow();
    await expect(find(ctx, { kinds: ["nope"] })).rejects.toThrow();
  });
});
