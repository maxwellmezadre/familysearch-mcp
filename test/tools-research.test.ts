import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
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

type Capture = { status: number; body: unknown };
const replay = (name: string) => {
  const { status, body } = fixture(name) as Capture;
  return body === null ? response({ status }) : jsonResponse(body, { status });
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
  const run = (name: string, args: Record<string, unknown>) =>
    runTool(toolByName(name) as never, args, ctx) as Promise<Record<string, unknown>>;
  return { run, fetch };
}

const FOCUS = "X8MM-G4S";
const RECORD = "LHQL-RJL2";

describe("get_possible_duplicates", () => {
  test("asks for the atom feed and returns each candidate with its confidence", async () => {
    // A matches feed has the same atom person-entry shape as a tree search.
    const { run, fetch } = setup([replay("tree-search")]);
    const result = (await run("get_possible_duplicates", { person_id: FOCUS })) as {
      candidates: Array<{ id: string; confidence: number; url: string }>;
    };
    expect(fetch.calls[0]!.url).toEndWith(`/platform/tree/persons/${FOCUS}/matches`);
    expect(fetch.calls[0]!.init.headers.accept).toBe("application/x-gedcomx-atom+json");
    expect(result.candidates[0]).toMatchObject({ confidence: 4 });
    expect(result.candidates[0]!.url).toStartWith("https://www.familysearch.org/tree/person/details/");
  });

  test("204 is an empty list with a note, not an error", async () => {
    const { run } = setup([replay("matches")]);
    const result = await run("get_possible_duplicates", { person_id: FOCUS });
    expect(result.candidates).toEqual([]);
    expect(String(result.note)).toMatch(/nenhuma sugestão/);
  });
});

describe("get_hints", () => {
  test("asks for record matches and treats 204 as no hints", async () => {
    const { run, fetch } = setup([response({ status: 204 })]);
    const result = await run("get_hints", { person_id: FOCUS });
    const url = new URL(fetch.calls[0]!.url);
    expect(url.pathname).toBe(`/platform/tree/persons/${FOCUS}/matches`);
    expect(url.searchParams.get("collection")).toBe("https://familysearch.org/platform/collections/records");
    expect(result.hints).toEqual([]);
  });
});

describe("search_records", () => {
  test("normalizes dates and returns the collection and event of each record", async () => {
    const { run, fetch } = setup([replay("record-search")]);
    const result = (await run("search_records", {
      given_name: "Lia",
      surname: "Fausto",
      birth_date: "cerca de 1809",
    })) as { total: number; records: Array<{ id: string; collection: string; url: string; event: unknown }> };
    const params = new URL(fetch.calls[0]!.url).searchParams;
    expect(params.get("q.birthLikeDate.from")).toBe("1809");
    expect(fetch.calls[0]!.init.headers.accept).toBe("application/json");
    expect(result.total).toBeGreaterThan(3);
    expect(result.records[0]).toMatchObject({
      id: RECORD,
      collection: "United States, GenealogyBank Historical Newspaper Obituaries, 1815-2013",
      url: `https://www.familysearch.org/ark:/61903/1:1:${RECORD}`,
    });
    expect(result.records[0]!.event).not.toBeNull();
  });

  test("no search field at all is refused without a request", async () => {
    const { run, fetch } = setup([]);
    await expect(run("search_records", {})).rejects.toThrow(/pelo menos/);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("get_record", () => {
  test("lists the people in the record, the principal first, with the collection", async () => {
    const { run, fetch } = setup([replay("record")]);
    const record = (await run("get_record", { record_id: RECORD })) as {
      id: string;
      collection: string;
      url: string;
      persons: Array<{ principal: boolean; name: string }>;
    };
    expect(fetch.calls[0]!.url).toEndWith(`/platform/records/personas/${RECORD}`);
    expect(record.url).toBe(`https://www.familysearch.org/ark:/61903/1:1:${RECORD}`);
    expect(record.collection).toBe("United States, GenealogyBank Historical Newspaper Obituaries, 1815-2013");
    expect(record.persons[0]!.principal).toBe(true);
  });
});

describe("search_places", () => {
  test("keeps the API's order and the full place name", async () => {
    const { run, fetch } = setup([replay("places")]);
    const result = (await run("search_places", { name: "Springfield" })) as {
      places: Array<{ id: string; name: string; fullName: string; type: string | null }>;
    };
    expect(new URL(fetch.calls[0]!.url).searchParams.get("q")).toBe('name:"Springfield"');
    expect(result.places[0]).toEqual({
      id: "12243341",
      name: "Springfield",
      fullName: "Springfield, Kingston, Jamaica",
      type: "Neighborhood or suburb",
    });
  });
});
