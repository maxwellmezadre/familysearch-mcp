import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { ToolInputError, runTool } from "../src/tools/define.js";
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

type Capture = { status: number; location: string | null; body: unknown };
const capture = (name: string) => fixture(name) as Capture;
const replay = (name: string) => {
  const { status, location, body } = capture(name);
  return body === null
    ? response({ status, ...(location ? { headers: { location } } : {}) })
    : jsonResponse(body, { status, ...(location ? { headers: { location } } : {}) });
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
    reauth: async () => false,
  });
  const run = (name: string, args: Record<string, unknown>) =>
    runTool(toolByName(name) as never, args, ctx) as Promise<Record<string, unknown>>;
  return { run, fetch };
}

const FOCUS = "X8MM-G4S";

describe("get_person", () => {
  test("reads the person and links to its page", async () => {
    const { run, fetch } = setup([replay("person")]);
    const person = await run("get_person", { person_id: FOCUS });
    expect(person).toMatchObject({ id: FOCUS, name: "Rui Lia Fausto", living: false });
    expect(person.url).toBe(`https://www.familysearch.org/tree/person/details/${FOCUS}`);
    expect(fetch.calls[0]!.url).toEndWith(`/platform/tree/persons/${FOCUS}`);
  });

  test("include adds sources, and an empty 204 list is just empty", async () => {
    const { run, fetch } = setup([replay("person"), replay("sources"), response({ status: 204 })]);
    const person = await run("get_person", { person_id: FOCUS, include: ["sources", "notes"] });
    expect((person.sources as unknown[]).length).toBeGreaterThan(0);
    expect((person.sources as Array<{ title: string | null }>)[0]!.title).toBeString();
    expect(person.notes).toEqual([]);
    expect(fetch.calls).toHaveLength(3);
  });

  test("a merged id says who it was merged into", async () => {
    const { run } = setup([replay("person-merged")]);
    await expect(run("get_person", { person_id: "AAAA-AAA" })).rejects.toThrow(
      /AAAA-AAA foi mesclada em T2SD-CF4/,
    );
  });

  test("404, 400 and 204 are all 'not found', never an empty person", async () => {
    for (const status of [404, 400, 204]) {
      const { run } = setup([response({ status })]);
      await expect(run("get_person", { person_id: "ZZZZ-ZZZ" })).rejects.toThrow(/não encontrad/);
    }
  });

  test("410 says the person was deleted", async () => {
    const { run } = setup([response({ status: 410 })]);
    await expect(run("get_person", { person_id: "ZZZZ-ZZZ" })).rejects.toThrow(/apagada/);
  });

  test("a malformed id is refused before any request", async () => {
    const { run, fetch } = setup([]);
    await expect(run("get_person", { person_id: "nope" })).rejects.toThrow(ToolInputError);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("get_family", () => {
  test("parents and spouses with children", async () => {
    const { run } = setup([replay("families")]);
    const family = (await run("get_family", { person_id: FOCUS })) as {
      person: { id: string };
      parents: unknown[];
      spouses: Array<{ children: unknown[] }>;
    };
    expect(family.person.id).toBe(FOCUS);
    expect(family.parents).toHaveLength(1);
    expect(family.spouses.some((spouse) => spouse.children.length === 4)).toBe(true);
  });
});

describe("ancestors and descendants", () => {
  test("ancestors default to 4 generations and number every person", async () => {
    const { run, fetch } = setup([replay("ancestry")]);
    const result = (await run("get_ancestors", { person_id: FOCUS })) as { people: Array<{ number: string }> };
    expect(new URL(fetch.calls[0]!.url).searchParams.get("generations")).toBe("4");
    expect(result.people[0]!.number).toBe("1");
  });

  test("more than 8 generations is refused by the schema", async () => {
    const { run } = setup([]);
    await expect(run("get_ancestors", { person_id: FOCUS, generations: 9 })).rejects.toThrow(ToolInputError);
  });

  test("descendants default to 2 generations", async () => {
    const { run, fetch } = setup([replay("descendancy")]);
    await run("get_descendants", { person_id: FOCUS });
    expect(new URL(fetch.calls[0]!.url).searchParams.get("generations")).toBe("2");
  });
});

describe("get_change_history", () => {
  test("lists changes newest first, limited", async () => {
    const { run } = setup([replay("changes")]);
    const result = (await run("get_change_history", { person_id: FOCUS, limit: 3 })) as {
      changes: Array<{ what: string }>;
    };
    expect(result.changes).toHaveLength(3);
    expect(result.changes[0]!.what).toBe("Person Source Reference Removed");
  });
});

describe("search_persons", () => {
  test("sends normalized dates, the atom accept and returns scored hits", async () => {
    const { run, fetch } = setup([replay("tree-search")]);
    const result = (await run("search_persons", {
      given_name: "Rui",
      surname: "Fausto",
      birth_date: "abt 1809",
      death_date: "1860s",
      father_name: "Mauro Fausto",
    })) as { people: Array<{ id: string; confidence: number }> };
    const { url, init } = fetch.calls[0]!;
    const params = new URL(url).searchParams;
    expect(init.headers.accept).toBe("application/x-gedcomx-atom+json");
    expect(params.get("q.birthLikeDate")).toBe("1809");
    expect(params.has("q.deathLikeDate")).toBe(false);
    expect(params.get("q.fatherGivenName")).toBe("Mauro");
    expect(params.get("q.fatherSurname")).toBe("Fausto");
    expect(result.people[0]).toMatchObject({ id: FOCUS, confidence: 4 });
  });

  test("no search field at all is refused without a request", async () => {
    const { run, fetch } = setup([]);
    await expect(run("search_persons", {})).rejects.toThrow(/pelo menos/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("204 means no results", async () => {
    const { run } = setup([response({ status: 204 })]);
    const result = await run("search_persons", { surname: "Inexistente" });
    expect(result.people).toEqual([]);
  });
});
