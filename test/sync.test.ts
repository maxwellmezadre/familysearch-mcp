import { describe, expect, test } from "bun:test";
import { openCache } from "../src/cache/db.js";
import { ascendancyGeneration, runSyncChunk } from "../src/cache/sync.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { AuthError } from "../src/core/errors.js";
import { runTool } from "../src/tools/define.js";
import { activeTools, toolByName } from "../src/tools/registry.js";
import {
  fakeClock,
  fixture,
  jsonResponse,
  memorySession,
  response,
  scriptedFetch,
  sessionFixture,
  silentLogger,
} from "./helpers.js";

type Capture = { status: number; location: string | null; body: unknown };
const replay = (name: string) => {
  const { status, body } = fixture(name) as Capture;
  return body === null ? response({ status }) : jsonResponse(body, { status });
};

const ROOT = "X8MM-G4S";
type Route = (url: string) => ReturnType<typeof replay> | undefined;

/** Answers by endpoint, like the real API; `override` can replace an answer. */
function setup(override: Route = () => undefined, personId: string | null = ROOT) {
  const clock = fakeClock();
  const fetch = scriptedFetch([], (url) => {
    const custom = override(url);
    if (custom) return custom;
    if (url.includes("/ancestry")) return replay("ancestry");
    if (url.endsWith("/families")) return replay("families");
    if (url.endsWith("/sources")) return replay("sources");
    if (url.includes("collection=")) return replay("matches");
    if (url.endsWith("/matches")) return jsonResponse((fixture("tree-search") as Capture).body);
    return response({ status: 404 });
  });
  const db = openCache(":memory:");
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: "/nonexistent/fs" }), {
    fetch,
    db,
    session: memorySession(sessionFixture({ user: { id: "cis.user.X", displayName: "F", personId } })),
    log: silentLogger(),
    now: clock.now,
    sleep: clock.sleep,
    reauth: async () => "nenhum navegador configurado",
  });
  return { ctx, fetch, db };
}

describe("ascendancyGeneration", () => {
  test("maps numbers and spouses", () => {
    expect(ascendancyGeneration("1")).toBe(0);
    expect(ascendancyGeneration("3")).toBe(1);
    expect(ascendancyGeneration("7")).toBe(2);
    expect(ascendancyGeneration("1-S")).toBe(0);
    expect(ascendancyGeneration("5-S")).toBe(2);
  });
});

describe("runSyncChunk", () => {
  test("no personId: error before any request", async () => {
    const { ctx, fetch } = setup(() => undefined, null);
    await expect(runSyncChunk(ctx)).rejects.toThrow("não tem uma pessoa ligada na árvore");
    expect(fetch.calls).toHaveLength(0);
  });

  test("first chunk reads the pedigree once and details within the budget", async () => {
    const { ctx, fetch } = setup();
    const report = await runSyncChunk(ctx, { maxRequests: 9 });
    expect(fetch.calls).toHaveLength(9);
    expect(fetch.calls.filter((call) => call.url.includes("/ancestry"))).toHaveLength(1);
    expect(report).toMatchObject({ done: false, rootId: ROOT, requests: 9, detailed: 2 });
    expect(report.pending).toBeGreaterThan(0);
    const repo = ctx.cache();
    expect(repo.stats()).toMatchObject({ rootId: ROOT, lineage: 16 });
    const root = repo.person(ROOT);
    expect(root).toMatchObject({ ascendancy: "1", generation: 0, name: "Rui Lia Fausto", given: "Lia", surname: "Fausto" });
    expect(root?.detailsAt).not.toBeNull();
    expect(root?.raw).toContain(ROOT);
    expect(root?.sourceCount).toBeGreaterThan(0);
    expect(root?.hintCount).toBe(0);
    expect(repo.relationships().length).toBeGreaterThan(0);
  });

  test("a failure in the middle of a person leaves it pending and keeps the others", async () => {
    let sourceReads = 0;
    const { ctx } = setup((url) => (url.endsWith("/sources") && ++sourceReads === 2 ? response({ status: 404 }) : undefined));
    const report = await runSyncChunk(ctx, { maxRequests: 60 });
    expect(report.detailed).toBe(1);
    expect(report.done).toBe(false);
    expect(report.note).toContain("Parei em");
    const repo = ctx.cache();
    expect(repo.lineage().filter((p) => p.detailsAt !== null)).toHaveLength(1);
    expect(report.pending).toBe(15);
  });

  test("the next chunk resumes without duplicating rows", async () => {
    const { ctx, fetch, db } = setup();
    await runSyncChunk(ctx, { maxRequests: 9 });
    const before = ctx.cache().stats();
    const second = await runSyncChunk(ctx, { maxRequests: 8 });
    expect(fetch.calls.filter((call) => call.url.includes("/ancestry"))).toHaveLength(1);
    expect(second).toMatchObject({ requests: 8, detailed: 2 });
    const after = ctx.cache().stats();
    expect(after.pending).toBe(before.pending - 2);
    expect(after.lineage).toBe(before.lineage);
    expect(after.relationships).toBe(before.relationships);
    const dup = db.query("SELECT COUNT(*) AS n FROM persons").get() as { n: number };
    expect(dup.n).toBe(after.persons);
  });

  test("runs to done and then costs nothing", async () => {
    const { ctx, fetch } = setup();
    const report = await runSyncChunk(ctx, { maxRequests: 200 });
    expect(report).toMatchObject({ done: true, pending: 0, detailed: 16 });
    const again = await runSyncChunk(ctx);
    expect(again).toMatchObject({ done: true, requests: 0, detailed: 0 });
    expect(fetch.calls).toHaveLength(1 + 16 * 4);
  });

  test("a merged person is recorded and its survivor takes its place in the lineage", async () => {
    let families = 0;
    const { ctx } = setup((url) =>
      url.endsWith("/families") && ++families === 2
        ? response({ status: 301, headers: { location: "https://www.familysearch.org/platform/tree/persons/MRG1-AAA/families" } })
        : undefined,
    );
    const report = await runSyncChunk(ctx, { maxRequests: 13 });
    expect(report.merged).toHaveLength(1);
    const { from, to } = report.merged[0]!;
    expect(to).toBe("MRG1-AAA");
    const repo = ctx.cache();
    const old = repo.person(from);
    expect(old?.mergedInto).toBe("MRG1-AAA");
    const survivor = repo.person("MRG1-AAA");
    expect(survivor?.ascendancy).toBe(old?.ascendancy);
    expect(survivor?.generation).toBe(old?.generation);
    expect(repo.lineage().map((p) => p.id)).toContain("MRG1-AAA");
    expect(repo.lineage().map((p) => p.id)).not.toContain(from);
  });

  test("full clears details and re-reads the pedigree", async () => {
    const { ctx, fetch } = setup();
    await runSyncChunk(ctx, { maxRequests: 9 });
    const report = await runSyncChunk(ctx, { maxRequests: 5, full: true });
    expect(fetch.calls.filter((call) => call.url.includes("/ancestry"))).toHaveLength(2);
    expect(report.detailed).toBe(1);
    expect(report.pending).toBe(15);
  });

  test("an auth failure stops the chunk and keeps what was written", async () => {
    let sources = 0;
    const { ctx } = setup((url) => (url.endsWith("/sources") && ++sources === 2 ? response({ status: 401 }) : undefined));
    await expect(runSyncChunk(ctx, { maxRequests: 60 })).rejects.toThrow(AuthError);
    expect(ctx.cache().stats().lineage).toBe(16);
    expect(ctx.cache().lineage().filter((p) => p.detailsAt !== null)).toHaveLength(1);
  });
});

describe("sync tool", () => {
  test("is registered after doctor and absent in read-only mode", () => {
    const names = activeTools({ readOnly: false }).map((tool) => tool.name);
    expect(names.indexOf("sync")).toBe(names.indexOf("doctor") + 1);
    expect(activeTools({ readOnly: true }).map((tool) => tool.name)).not.toContain("sync");
  });

  test("runs through runTool", async () => {
    const { ctx } = setup();
    const report = (await runTool(toolByName("sync") as never, { max_requests: 5 }, ctx)) as { detailed: number };
    expect(report.detailed).toBe(1);
  });
});
