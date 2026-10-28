import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Approver } from "../src/approval/gate.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { factChange } from "../src/cli/commands/write-person.js";
import { runTool } from "../src/tools/define.js";
import { addNote, createPerson, updatePerson } from "../src/tools/write-person.js";
import { allTools } from "../src/tools/registry.js";
import { autoApprove, fakeApprover } from "./approvers.js";
import { fakeClock, jsonResponse, memorySession, response, scriptedFetch, sessionFixture, silentLogger } from "./helpers.js";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function setup(script: Parameters<typeof scriptedFetch>[0], approver: Approver = autoApprove()) {
  const dir = mkdtempSync(join(tmpdir(), "fs-wp-"));
  dirs.push(dir);
  const clock = fakeClock();
  const fetch = scriptedFetch(script);
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: dir }), {
    fetch, session: memorySession(sessionFixture()), log: silentLogger(), now: clock.now, sleep: clock.sleep,
    approver, reauth: async () => "sem navegador",
  });
  return { ctx, fetch };
}

const REASON = "corrigir dados com base na certidão";
const person = (facts: unknown[] = [], over = {}) =>
  jsonResponse({ persons: [{ id: "KWCB-XXX", display: { name: "Giulia Rossi", lifespan: "1921-1990" }, names: [{ nameForms: [{ fullText: "Giulia Rossi" }] }], gender: { type: "http://gedcomx.org/Female" }, facts, ...over }] });
const fact = (id: string, type: string, date?: string, place?: string) => ({ id, type: `http://gedcomx.org/${type}`, ...(date ? { date: { original: date } } : {}), ...(place ? { place: { original: place } } : {}) });
const noMatches = () => jsonResponse({ results: 0, entries: [] });
const hit = (id: string, confidence: number) => ({ id, confidence, content: { gedcomx: { persons: [{ id, display: { name: "Giulia Rossi", lifespan: "1921-1990" } }] } } });
const created = (id: string) => response({ status: 201, headers: { "X-ENTITY-ID": id } });
const body = (c: { init: { body?: string } } | undefined) => JSON.parse(c?.init.body ?? "null");

const create = { given_name: "Giulia", surname: "Rossi", gender: "female" as const, reason: REASON };

describe("create_person", () => {
  test("refuses when living or deceased is not said", async () => {
    const { ctx, fetch } = setup([]);
    await expect(runTool(createPerson, { ...create }, ctx)).rejects.toThrow(/living|deceased/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("strong candidates add a warning line and require typing 'criar'", async () => {
    const approver = fakeApprover([{ approved: false, reason: "não" }]);
    const { ctx, fetch } = setup([jsonResponse({ results: 2, entries: [hit("AAAA-111", 4), hit("AAAA-222", 2)] })], approver);
    const out = (await runTool(createPerson, { ...create, deceased: true, birth: { date: "1921" } }, ctx)) as { status: string };
    expect(out.status).toBe("refused");
    const prompt = approver.prompts[0]!;
    expect(prompt.headline.split("\n")[0]).toBe("Criar Giulia Rossi (1921-?)");
    expect(prompt.headline.split("\n")[1]).toBe("ATENÇÃO: 1 pessoas parecidas já existem (maior confiança 4)");
    expect(prompt.confirm).toEqual({ title: "Para criar mesmo assim, confirme: criar", expected: "criar", choices: ["não criar", "criar"] });
    expect(prompt.details).toContain("AAAA-111");
    expect(fetch.calls.filter((c) => c.init.method === "POST")).toHaveLength(0);
  });

  test("create_person reads the new person back by X-ENTITY-ID", async () => {
    const approver = autoApprove();
    const { ctx, fetch } = setup([noMatches(), created("NEWP-001"), person([fact("f1", "Birth", "1921")], { id: "NEWP-001" })], approver);
    const out = (await runTool(createPerson, { ...create, deceased: true, birth: { date: "1921" } }, ctx)) as { status: string; person_id: string; readBack: { ok: boolean } };
    expect(out).toMatchObject({ status: "applied", person_id: "NEWP-001" });
    expect(out.readBack.ok).toBe(true);
    expect(approver.prompts[0]!.confirm).toBeNull();
    const post = fetch.calls[1]!;
    expect(post.init.method).toBe("POST");
    expect(body(post).persons[0]).toMatchObject({ living: false, facts: [{ type: "http://gedcomx.org/Birth", date: { original: "1921" } }] });
    expect(fetch.calls[2]!.url).toContain("/persons/NEWP-001");
  });

  test("living person is created living; preview never asks or writes", async () => {
    const approver = fakeApprover([]);
    const { ctx, fetch } = setup([noMatches()], approver);
    const out = (await runTool(createPerson, { ...create, living: true, preview: true }, ctx)) as { status: string; headline: string };
    expect(out.status).toBe("preview");
    expect(out.headline).toContain("viva");
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls).toHaveLength(1);
  });
});

describe("update_person", () => {
  const base = { person_id: "KWCB-XXX", reason: REASON };

  test("update_person sends adds in one POST and one DELETE per removal", async () => {
    const before = person([fact("f1", "Residence", "1950", "Roma"), fact("f2", "Occupation"), fact("f3", "Baptism", "1921")]);
    const after = person([fact("f1", "Residence", "1960", "Roma"), fact("f9", "Burial", "1990")]);
    const { ctx, fetch } = setup([before, response({ status: 204 }), response({ status: 204 }), response({ status: 204 }), after]);
    const out = (await runTool(updatePerson, {
      ...base,
      add_facts: [{ type: "Burial", date: "1990" }],
      update_facts: [{ fact_id: "f1", date: "1960" }],
      remove_fact_ids: ["f2", "f3"],
    }, ctx)) as { status: string; headline: string; readBack: { ok: boolean } };
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    expect(out.headline.split("\n")[0]).toBe("Alterar 4 fatos de Giulia Rossi [KWCB-XXX] 1921-1990");
    // The removal warning leads, and the other changes are still named.
    expect(out.headline.split("\n")[1]).toBe("ATENÇÃO: remove 2 fato(s); também 1 novo(s), 1 alterado(s). Removidos: Occupation (f2), Baptism (f3)");
    const writes = fetch.calls.slice(1, 4);
    expect(writes.map((c) => c.init.method)).toEqual(["POST", "DELETE", "DELETE"]);
    expect(writes[1]!.url).toContain("/persons/KWCB-XXX/conclusions/f2");
    expect(writes[2]!.url).toContain("/conclusions/f3");
    // the update keeps the place of the current fact
    expect(body(writes[0]).persons[0].facts).toEqual([
      { type: "http://gedcomx.org/Burial", date: { original: "1990" } },
      { id: "f1", type: "http://gedcomx.org/Residence", date: { original: "1960" }, place: { original: "Roma" } },
    ]);
  });

  test("update merges the raw place, not the standardized one", async () => {
    const raw = { id: "f1", type: "http://gedcomx.org/Residence", date: { original: "1950" }, place: { original: "Vila Nova", normalized: [{ value: "Vila Nova, Estado, País" }] } };
    const { ctx, fetch } = setup([person([raw]), response({ status: 204 }), person([fact("f1", "Residence", "1960")])]);
    await runTool(updatePerson, { ...base, update_facts: [{ fact_id: "f1", date: "1960" }] }, ctx);
    expect(body(fetch.calls[1]).persons[0].facts[0].place).toEqual({ original: "Vila Nova" });
  });

  test.each(["http://familysearch.org/types/facts/Foo", "data:,Apelido+de+fam%C3%ADlia"])("update keeps the raw type %s", async (type) => {
    const raw = { id: "f1", type, date: { original: "1950" } };
    const { ctx, fetch } = setup([person([raw]), response({ status: 204 }), person([raw])]);
    await runTool(updatePerson, { ...base, update_facts: [{ fact_id: "f1", date: "1960" }] }, ctx);
    expect(body(fetch.calls[1]).persons[0].facts[0].type).toBe(type);
  });

  test("read-back reports a fact that was not removed", async () => {
    const { ctx } = setup([person([fact("f2", "Occupation")]), response({ status: 204 }), person([fact("f2", "Occupation")])]);
    const out = (await runTool(updatePerson, { ...base, remove_fact_ids: ["f2"] }, ctx)) as { headline: string; readBack: { ok: boolean } };
    expect(out.headline.split("\n")[1]).toBe("ATENÇÃO: remove 1 fato(s): Occupation (f2)");
    expect(out.readBack.ok).toBe(false);
  });

  test("update_person with nothing to change is refused before asking", async () => {
    const approver = fakeApprover([]);
    const { ctx, fetch } = setup([], approver);
    await expect(runTool(updatePerson, base, ctx)).rejects.toThrow(/Nada para alterar/);
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls).toHaveLength(0);
  });

  test("unknown fact ids are refused before asking", async () => {
    const approver = fakeApprover([]);
    const { ctx, fetch } = setup([person([fact("f1", "Birth")])], approver);
    await expect(runTool(updatePerson, { ...base, update_facts: [{ fact_id: "zzz", date: "1900" }] }, ctx)).rejects.toThrow(/zzz/);
    await expect(runTool(updatePerson, { ...base, remove_fact_ids: ["zzz"] }, ctx)).rejects.toThrow();
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls.every((c) => c.init.method === "GET")).toBe(true);
  });

  test("preview never asks and never writes", async () => {
    const approver = fakeApprover([]);
    const { ctx, fetch } = setup([person([fact("f2", "Occupation")])], approver);
    const out = (await runTool(updatePerson, { ...base, remove_fact_ids: ["f2"], preview: true }, ctx)) as { status: string };
    expect(out.status).toBe("preview");
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls).toHaveLength(1);
  });
});

describe("add_note", () => {
  const note = { subject: "Fonte oral", text: "Contado pela neta.", reason: REASON };
  const notes = jsonResponse({ persons: [{ id: "KWCB-XXX", notes: [{ id: "n1", subject: "Fonte oral", text: "Contado pela neta." }] }] });

  test("add_note needs exactly one target", async () => {
    const { ctx, fetch } = setup([]);
    await expect(runTool(addNote, note, ctx)).rejects.toThrow(/alvo/);
    await expect(runTool(addNote, { ...note, person_id: "KWCB-XXX", relationship_id: "r1", relationship_kind: "couple" }, ctx)).rejects.toThrow(/um alvo só/);
    await expect(runTool(addNote, { ...note, relationship_id: "r1" }, ctx)).rejects.toThrow(/relationship_kind/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("a person note is posted and read back from the notes", async () => {
    const approver = autoApprove();
    const { ctx, fetch } = setup([person(), response({ status: 201 }), notes], approver);
    const out = (await runTool(addNote, { ...note, person_id: "KWCB-XXX" }, ctx)) as { status: string; readBack: { ok: boolean } };
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    expect(approver.prompts[0]!.headline.split("\n")[0]).toBe("Nota em Giulia Rossi [KWCB-XXX] 1921-1990");
    expect(fetch.calls[1]!.url).toContain("/persons/KWCB-XXX/notes");
    expect(body(fetch.calls[1])).toEqual({ persons: [{ id: "KWCB-XXX", notes: [{ subject: "Fonte oral", text: "Contado pela neta." }] }] });
  });

  test("a relationship note is read back from the relationship", async () => {
    const rel = jsonResponse({ relationships: [{ id: "r1", notes: [{ subject: "Fonte oral", text: "Contado pela neta." }] }] });
    const { ctx, fetch } = setup([response({ status: 201 }), rel]);
    const out = (await runTool(addNote, { ...note, relationship_id: "r1", relationship_kind: "couple" }, ctx)) as { readBack: { ok: boolean } };
    expect(out.readBack.ok).toBe(true);
    expect(fetch.calls[0]!.url).toContain("/couple-relationships/r1/notes");
    expect(fetch.calls[1]!.url).toContain("/couple-relationships/r1/notes");
  });

  test("preview never asks and never writes", async () => {
    const approver = fakeApprover([]);
    const { ctx, fetch } = setup([person()], approver);
    const out = (await runTool(addNote, { ...note, person_id: "KWCB-XXX", preview: true }, ctx)) as { status: string };
    expect(out.status).toBe("preview");
    expect(approver.prompts).toHaveLength(0);
    expect(fetch.calls).toHaveLength(1);
  });
});

test("only the write tools not yet proven in production say so", () => {
  for (const tool of [createPerson, updatePerson, addNote]) expect(tool.readOnly).toBe(false);
  for (const tool of [createPerson, addNote]) expect(tool.description).toContain("Ainda não provada em produção.");
  expect(updatePerson.description).not.toContain("Ainda não provada em produção.");
  expect(updatePerson.destructive).toBe(true);
  expect(allTools.map((t) => t.name)).toEqual(expect.arrayContaining(["create_person", "update_person", "add_note"]));
});

describe("update-person --update-fact", () => {
  test("an empty type keeps the current one instead of sending an empty type", () => {
    expect(factChange("F1||1 January 1951")).toEqual({ fact_id: "F1", type: undefined, date: "1 January 1951", place: undefined, value: undefined });
    expect(factChange("F1|Burial|1951|Lugar|x")).toEqual({ fact_id: "F1", type: "Burial", date: "1951", place: "Lugar", value: "x" });
  });
});
