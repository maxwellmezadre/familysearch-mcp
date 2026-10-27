import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { recordUrl, toRecordDetail } from "../src/domain/normalize.js";
import { runTool } from "../src/tools/define.js";
import { toolByName } from "../src/tools/registry.js";
import { autoApprove, fakeApprover } from "./approvers.js";
import { fakeClock, fixture, jsonResponse, memorySession, response, scriptedFetch, sessionFixture, silentLogger } from "./helpers.js";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const PERSON = "X8MM-G4S";
const RECORD = "LHQL-RJL2";
const OTHER = "KWCB-XXX";
const doc = (name: string) => jsonResponse((fixture(name) as { body: unknown }).body);

function setup(script: Parameters<typeof scriptedFetch>[0], approver = autoApprove()) {
  const dir = mkdtempSync(join(tmpdir(), "fs-src-"));
  dirs.push(dir);
  const clock = fakeClock();
  const fetch = scriptedFetch(script);
  const config = loadConfig({ FAMILYSEARCH_CONFIG_DIR: dir });
  const ctx = createContext(config, { fetch, session: memorySession(sessionFixture()), log: silentLogger(), now: clock.now, sleep: clock.sleep, approver, reauth: async () => "sem navegador" });
  const run = (name: string, args: Record<string, unknown>) => runTool(toolByName(name) as never, args, ctx) as Promise<Record<string, any>>;
  return { run, fetch, approver, config };
}
const reason = "fonte encontrada na pesquisa";
// The person fixture, as every question must name it: name, dates and id.
const WHO = `Rui Lia Fausto (1809-1865) [${PERSON}]`;
const body = (call: { init: { body?: unknown } }) => JSON.parse(String(call.init.body));

describe("attach_record", () => {
  const record = toRecordDetail((fixture("record") as { body: never }).body, RECORD, "https://www.familysearch.org");
  const title = `${record.persons[0]!.name}, ${record.collection}`;
  const about = recordUrl("https://www.familysearch.org", RECORD);
  const attachedSources = jsonResponse({ sourceDescriptions: [{ id: "S1", titles: [{ value: title }], about }] });

  test("titles the source with the principal name and the collection", async () => {
    const { run, fetch, approver } = setup([
      doc("person"),
      doc("record"),
      response({ status: 204 }),
      response({ status: 201, headers: { location: "https://api.familysearch.org/platform/sources/descriptions/S1" } }),
      response({ status: 201 }),
      attachedSources,
    ]);
    const out = await run("attach_record", { person_id: PERSON, record_id: RECORD, reason });
    expect(record.collection).toBeTruthy();
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    expect(approver.prompts).toHaveLength(1);
    expect(approver.prompts[0]!.headline.split("\n")[0]).toBe(`Anexar o registro ${RECORD} a ${WHO}`);
    const writes = fetch.calls.filter((c) => c.init.method === "POST");
    expect(writes).toHaveLength(2);
    expect(body(writes[0]!).sourceDescriptions[0]).toMatchObject({ about, titles: [{ value: title }] });
    expect(body(writes[1]!).persons[0].sources[0].description).toBe("https://api.familysearch.org/platform/sources/descriptions/S1");
  });

  test("an already attached record is not attached twice", async () => {
    const { run, fetch, approver } = setup([doc("person"), doc("record"), attachedSources]);
    const out = await run("attach_record", { person_id: PERSON, record_id: RECORD, reason });
    expect(out.status).toBe("already_attached");
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls.every((c) => c.init.method === "GET")).toBe(true);
  });

  test("preview never asks and never writes", async () => {
    const { run, fetch, approver } = setup([doc("person"), doc("record"), response({ status: 204 })]);
    const out = await run("attach_record", { person_id: PERSON, record_id: RECORD, reason, preview: true });
    expect(out.status).toBe("preview");
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls.every((c) => c.init.method === "GET")).toBe(true);
  });
});

describe("add_source", () => {
  test("rejects a non-https url before asking", async () => {
    const { run, fetch, approver } = setup([]);
    await expect(run("add_source", { person_id: PERSON, title: "Livro", url: "http://x.org", reason })).rejects.toThrow(/https/);
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls).toHaveLength(0);
  });

  test("creates and attaches with the url as about, then reads back", async () => {
    const { run, fetch, approver } = setup([
      doc("person"),
      response({ status: 201, headers: { location: "https://api.familysearch.org/platform/sources/descriptions/S2" } }),
      response({ status: 201 }),
      jsonResponse({ sourceDescriptions: [{ id: "S2", titles: [{ value: "Livro" }], about: "https://x.org/a" }] }),
    ]);
    const out = await run("add_source", { person_id: PERSON, title: "Livro", citation: "p. 3", url: "https://x.org/a", reason });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    expect(approver.prompts[0]!.headline.split("\n")[0]).toBe(`Anexar a fonte "Livro" a ${WHO}`);
    expect(body(fetch.calls[1]!).sourceDescriptions[0]).toMatchObject({ about: "https://x.org/a", citations: [{ value: "p. 3" }] });
  });

  test("preview never asks and never writes", async () => {
    const { run, fetch, approver } = setup([doc("person")]);
    const out = await run("add_source", { person_id: PERSON, title: "Livro", reason, preview: true });
    expect(out.status).toBe("preview");
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls.every((c) => c.init.method === "GET")).toBe(true);
  });
});

describe("resolve_suggestion", () => {
  test("accepting a duplicate points to merge_persons instead of writing", async () => {
    const { run, fetch, approver } = setup([]);
    await expect(run("resolve_suggestion", { person_id: PERSON, kind: "duplicate", target_id: OTHER, decision: "accept", reason })).rejects.toThrow(/merge_persons/);
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls).toHaveLength(0);
  });

  test("rejecting a duplicate posts not-a-match with the other id", async () => {
    const { run, fetch, approver } = setup([doc("person"), response({ status: 201 }), jsonResponse({ persons: [{ id: OTHER }] })]);
    const out = await run("resolve_suggestion", { person_id: PERSON, kind: "duplicate", target_id: OTHER, decision: "reject", reason });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    expect(approver.prompts[0]!.headline.split("\n")[0]).toBe(`Marcar ${WHO} e ${OTHER} como pessoas diferentes`);
    expect(fetch.calls[1]!.url).toContain(`/persons/${PERSON}/not-a-match`);
    expect(body(fetch.calls[1]!)).toEqual({ persons: [{ id: OTHER }] });
    expect(fetch.calls[2]!.url).toContain(`/persons/${PERSON}/not-a-match`);
  });

  test("a failed not-a-match read-back is reported, not thrown", async () => {
    const { run } = setup([doc("person"), response({ status: 201 }), response({ status: 500 })]);
    const out = await run("resolve_suggestion", { person_id: PERSON, kind: "duplicate", target_id: OTHER, decision: "reject", reason });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(false);
    expect(out.readBack.checks[0].detail).toMatch(/não foi possível conferir/);
  });

  test("accepting a record posts the documented identifier and reads the hints back", async () => {
    const { run, fetch, approver } = setup([doc("person"), response({ status: 201 }), response({ status: 204 })]);
    const out = await run("resolve_suggestion", { person_id: PERSON, kind: "record", target_id: RECORD, decision: "accept", reason });
    expect(out.readBack.ok).toBe(true);
    expect(approver.prompts[0]!.headline.split("\n")[0]).toBe(`Aceitar o registro ${RECORD} para ${WHO}`);
    const call = fetch.calls[1]!;
    expect(call.url).toContain("status=accepted");
    expect(body(call).persons[0].identifiers.$[0]).toBe(`https://familysearch.org/ark:/61903/1:1:${RECORD}`);
  });

  test("a refused approval writes nothing", async () => {
    const { run, fetch } = setup([doc("person")], fakeApprover([{ approved: false, reason: "não" }]));
    const out = await run("resolve_suggestion", { person_id: PERSON, kind: "record", target_id: RECORD, decision: "reject", reason });
    expect(out.status).toBe("refused");
    expect(fetch.calls.every((c) => c.init.method === "GET")).toBe(true);
  });
});
