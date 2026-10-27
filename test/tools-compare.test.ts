import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { formatComparison } from "../src/cli/format.js";
import { createContext } from "../src/context.js";
import { runTool } from "../src/tools/define.js";
import { toolByName } from "../src/tools/registry.js";
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

type Capture = { status: number; location: string | null; allow?: string | null; warning?: string | null; body: unknown };
const replay = (name: string) => {
  const { status, location, allow, warning, body } = fixture(name) as Capture;
  const headers = Object.fromEntries(
    Object.entries({ location, allow, warning }).filter(([, value]) => value) as Array<[string, string]>,
  );
  return body === null ? response({ status, headers }) : jsonResponse(body, { status, headers });
};

function setup(script: Parameters<typeof scriptedFetch>[0]) {
  const clock = fakeClock();
  const fetch = scriptedFetch(script);
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: "/nonexistent/fs" }), {
    fetch,
    session: memorySession(sessionFixture()),
    log: silentLogger(),
    now: clock.now,
    sleep: clock.sleep,
    reauth: async () => "nenhum navegador configurado",
  });
  const run = (args: Record<string, unknown>) =>
    runTool(toolByName("compare_persons") as never, args, ctx) as Promise<Record<string, unknown>>;
  return { run, fetch };
}

const A = "X8MM-G4S";
const BIRTH = "a61d2b1e-1814-4ba3-a036-d42350080eb4"; // the birth fact in the person fixture
const B = "1HH8-PZG";
const bundles = () => [
  replay("person"),
  replay("families"),
  replay("sources"),
  replay("changes"),
  replay("person-b"),
  replay("families-b"),
  replay("sources-b"),
  replay("changes-b"),
];

describe("compare_persons", () => {
  test("a restricted pair: 10 read requests, path blocked, no analysis", async () => {
    const { run, fetch } = setup([...bundles(), replay("merge-options"), replay("merge-options-reverse")]);
    const comparison = await run({ person_a: A, person_b: B });
    expect(fetch.calls).toHaveLength(10);
    expect(fetch.calls.every((call) => call.init.method === "GET" || call.init.method === "OPTIONS")).toBe(true);
    expect(fetch.calls[8]!.url).toEndWith(`/platform/tree/persons/${A}/merges/${B}`);
    expect(fetch.calls[9]!.url).toEndWith(`/platform/tree/persons/${B}/merges/${A}`);
    expect(comparison.path).toBe("blocked");
    expect(String(comparison.pathReason)).toContain("restricted");
    expect(comparison.analysis).toBeNull();
    expect((comparison.a as { sourceCount: number }).sourceCount).toBe(28);
  });

  test("an allowed pair: the 11th request is the analysis of the suggested order", async () => {
    const allowed = response({ status: 200, headers: { allow: "OPTIONS, HEAD, GET, POST" } });
    // Shape from the official "Read Person Merge Analysis" example.
    const analysis = jsonResponse({
      mergeAnalyses: [
        {
          survivorResources: [{ resource: `https://api.familysearch.org/platform/tree/persons/${A}/conclusions/S1` }],
          duplicateResources: [{ resource: "https://api.familysearch.org/platform/tree/child-and-parents-relationships/CPR1" }],
          conflictingResources: [
            {
              survivorResource: { resource: `https://api.familysearch.org/platform/tree/persons/${A}/conclusions/${BIRTH}` },
              duplicateResource: { resource: `https://api.familysearch.org/platform/tree/persons/${B}/conclusions/C2` },
            },
          ],
        },
      ],
    });
    const { run, fetch } = setup([...bundles(), allowed, allowed, analysis]);
    const comparison = (await run({ person_a: A, person_b: B })) as {
      path: string;
      suggestion: { survivorId: string; duplicateId: string };
      analysis: { duplicateResources: string[]; conflicts: unknown[] };
    };
    expect(fetch.calls).toHaveLength(11);
    expect(comparison.path).toBe("merge");
    // A has 28 sources against 1: A survives.
    expect(comparison.suggestion).toMatchObject({ survivorId: A, duplicateId: B });
    expect(fetch.calls[10]!.url).toEndWith(`/platform/tree/persons/${A}/merges/${B}`);
    expect(comparison.analysis.duplicateResources).toEqual([
      "https://api.familysearch.org/platform/tree/child-and-parents-relationships/CPR1",
    ]);
    expect(comparison.analysis.conflicts).toHaveLength(1);

    // The human output carries what `merge` needs: the fingerprint and every id --take/--skip accept.
    const text = formatComparison(comparison);
    expect(text).toContain(`fingerprint: ${(comparison as unknown as { fingerprint: string }).fingerprint}`);
    expect(text).toContain("(CPR1)");
    expect(text).toContain(`Birth: 12 February 1809, Hardin, Kentucky, United States, de ${A} (${BIRTH})`);
    expect(text).toContain(`de ${B} (C2)`);
  });

  test("a living person: 8 requests, no merge questions, path relink", async () => {
    const living = structuredClone((fixture("person") as { body: { persons: Array<{ living: boolean }> } }).body);
    living.persons[0]!.living = true;
    const script = bundles();
    script[0] = jsonResponse(living);
    const { run, fetch } = setup(script);
    const comparison = await run({ person_a: A, person_b: B });
    expect(fetch.calls).toHaveLength(8);
    expect(fetch.calls.some((call) => call.init.method === "OPTIONS")).toBe(false);
    expect(comparison.path).toBe("relink");
    expect(comparison.analysis).toBeNull();
  });

  test("a merged id says who it was merged into", async () => {
    const { run } = setup([replay("person-merged")]);
    await expect(run({ person_a: "AAAA-AAA", person_b: B })).rejects.toThrow(/mesclada em/);
  });

  test("comparing a person with itself is refused before any request", async () => {
    const { run, fetch } = setup([]);
    await expect(run({ person_a: A, person_b: A })).rejects.toThrow(/mesma pessoa/);
    expect(fetch.calls).toHaveLength(0);
  });
});
