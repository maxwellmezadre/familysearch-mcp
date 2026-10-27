import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import type { Approver } from "../src/approval/gate.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { runTool } from "../src/tools/define.js";
import { toolByName } from "../src/tools/registry.js";
import { autoApprove, fakeApprover } from "./approvers.js";
import { fakeClock, jsonResponse, memorySession, response, scriptedFetch, sessionFixture, silentLogger } from "./helpers.js";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function setup(script: Parameters<typeof scriptedFetch>[0], approver: Approver = autoApprove()) {
  const dir = mkdtempSync(join(tmpdir(), "fs-rel-"));
  dirs.push(dir);
  const clock = fakeClock();
  const fetch = scriptedFetch(script);
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: dir }), {
    fetch, session: memorySession(sessionFixture()), log: silentLogger(), now: clock.now, sleep: clock.sleep,
    reauth: async () => "sem navegador", approver,
  });
  const run = (name: string, args: Record<string, unknown>) =>
    runTool(toolByName(name) as never, args, ctx) as Promise<Record<string, any>>;
  return { run, fetch, approver };
}

const CHILD = "AAAA-111";
const DAD = "BBBB-222";
const MOM = "CCCC-333";
const ref = (id: string) => ({ resourceId: id });
const person = (id: string, name: string) => ({ id, display: { name } });
const families = (over: Record<string, unknown> = {}) =>
  jsonResponse({ persons: [person(CHILD, "Rui Lia"), person(DAD, "Pai Lia")], ...over });
const personDoc = (id: string, name: string) => jsonResponse({ persons: [person(id, name)] });
const withParents = (...ids: string[]) =>
  families({ childAndParentsRelationships: [{ id: "R-1", parent1: ref(ids[0]!), ...(ids[1] ? { parent2: ref(ids[1]) } : {}), child: ref(CHILD) }] });
const writes = (f: ReturnType<typeof setup>["fetch"]) => f.calls.filter((c) => c.init.method !== "GET");
const reason = "ligação confirmada pela certidão";

describe("link_parents", () => {
  test("refuses no parent and a child that is its own parent, without asking or reading", async () => {
    const { run, fetch, approver } = setup([]);
    await expect(run("link_parents", { child_id: CHILD, reason })).rejects.toThrow(/pai ou mãe/);
    await expect(run("link_parents", { child_id: CHILD, parent1_id: CHILD, reason })).rejects.toThrow(/próprio/);
    expect(fetch.calls).toHaveLength(0);
    expect((approver as any).prompts).toHaveLength(0);
  });

  test("an existing identical relationship is reported, not duplicated", async () => {
    const { run, fetch, approver } = setup([withParents(MOM, DAD)]);
    const out = await run("link_parents", { child_id: CHILD, parent1_id: DAD, parent2_id: MOM, reason });
    expect(out.status).toBe("exists");
    expect(out.message).toContain("R-1");
    expect(fetch.calls).toHaveLength(1);
    expect((approver as any).prompts).toHaveLength(0);
  });

  test("preview shows the plan, never asks and never writes", async () => {
    const { run, fetch, approver } = setup([families(), personDoc(DAD, "Pai Lia")]);
    const out = await run("link_parents", { child_id: CHILD, parent1_id: DAD, reason, preview: true });
    expect(out.status).toBe("preview");
    expect(out.headline).toContain("Rui Lia");
    expect(out.headline).toContain("Pai Lia");
    expect((approver as any).prompts).toHaveLength(0);
    expect(writes(fetch)).toHaveLength(0);
  });

  test("a refusal by the user sends no write", async () => {
    const { run, fetch } = setup([families(), personDoc(DAD, "Pai Lia")], fakeApprover([{ approved: false, reason: "não" }]));
    const out = await run("link_parents", { child_id: CHILD, parent1_id: DAD, reason });
    expect(out.status).toBe("refused");
    expect(writes(fetch)).toHaveLength(0);
  });

  test("link_parents reads the child's family back", async () => {
    const { run, fetch, approver } = setup([
      families(), personDoc(DAD, "Pai Lia"), personDoc(MOM, "Mãe Lia"),
      response({ status: 201, headers: { "X-ENTITY-ID": "R-9" } }),
      withParents(DAD, MOM),
    ]);
    const out = await run("link_parents", { child_id: CHILD, parent1_id: DAD, parent2_id: MOM, reason });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    expect((approver as any).prompts).toHaveLength(1);
    const [w] = writes(fetch);
    expect(w!.init.method).toBe("POST");
    expect(w!.url).toEndWith("/platform/tree/relationships");
    const rel = JSON.parse(w!.init.body as string).childAndParentsRelationships[0];
    expect(rel.parent1.resourceId).toBe(DAD);
    expect(rel.parent2.resourceId).toBe(MOM);
    expect(rel.child.resourceId).toBe(CHILD);
    expect(fetch.calls.at(-1)!.url).toEndWith(`/platform/tree/persons/${CHILD}/families`);
  });

  test("a read-back that does not find the parents is reported, not thrown", async () => {
    const { run } = setup([families(), personDoc(DAD, "Pai Lia"), response({ status: 201 }), families()]);
    const out = await run("link_parents", { child_id: CHILD, parent1_id: DAD, reason });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(false);
  });
});

describe("link_spouses", () => {
  const A = "AAAA-111";
  const B = "BBBB-222";
  const couple = (id: string) => ({ id: "C-1", type: "http://gedcomx.org/Couple", person1: ref(A), person2: ref(id) });

  test("refuses the same person twice", async () => {
    const { run, fetch } = setup([]);
    await expect(run("link_spouses", { person1_id: A, person2_id: A, reason })).rejects.toThrow(/mesma pessoa/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("an existing couple is reported, not duplicated", async () => {
    const { run, approver } = setup([families({ relationships: [couple(B)] })]);
    const out = await run("link_spouses", { person1_id: A, person2_id: B, reason });
    expect(out.status).toBe("exists");
    expect((approver as any).prompts).toHaveLength(0);
  });

  test("writes the couple with the marriage and reads person1's family back", async () => {
    const { run, fetch } = setup([
      families(), personDoc(B, "Esposa Lia"), response({ status: 201 }), families({ relationships: [couple(B)] }),
    ]);
    const out = await run("link_spouses", { person1_id: A, person2_id: B, marriage: { date: "1950", place: "Recife" }, reason });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    const rel = JSON.parse(writes(fetch)[0]!.init.body as string).relationships[0];
    expect(rel.person1.resourceId).toBe(A);
    expect(rel.facts[0].date.original).toBe("1950");
    expect(rel.facts[0].place.original).toBe("Recife");
  });

  test("read-back does not count a co-parent without a couple relationship", async () => {
    const { run } = setup([
      families(), personDoc(B, "Esposa Lia"), response({ status: 201 }),
      families({ childAndParentsRelationships: [{ id: "R-2", parent1: ref(A), parent2: ref(B), child: ref("DDDD-444") }] }),
    ]);
    const out = await run("link_spouses", { person1_id: A, person2_id: B, reason });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(false);
  });

  test("preview never asks or writes", async () => {
    const { run, fetch, approver } = setup([families(), personDoc(B, "Esposa Lia")]);
    const out = await run("link_spouses", { person1_id: A, person2_id: B, reason, preview: true });
    expect(out.status).toBe("preview");
    expect((approver as any).prompts).toHaveLength(0);
    expect(writes(fetch)).toHaveLength(0);
  });
});

describe("remove_relationship", () => {
  const REL = "AAAA-REL";
  const notFound = () => response({ status: 404 });

  test("is destructive", () => {
    expect(toolByName("remove_relationship")!.destructive).toBe(true);
  });

  test("names both people in the headline and checks 404/410 after", async () => {
    const { run, fetch, approver } = setup([
      jsonResponse({ relationships: [{ id: REL, type: "http://gedcomx.org/Couple", person1: ref(CHILD), person2: ref(DAD) }] }),
      personDoc(CHILD, "Rui Lia"), personDoc(DAD, "Ana Lia"),
      response({ status: 204 }),
      notFound(),
    ]);
    const out = await run("remove_relationship", { relationship_id: REL, kind: "couple", reason });
    const prompt = (approver as any).prompts[0];
    expect(prompt.headline).toContain("Rui Lia");
    expect(prompt.headline).toContain("Ana Lia");
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    const [w] = writes(fetch);
    expect(w!.init.method).toBe("DELETE");
    expect(w!.url).toEndWith(`/platform/tree/couple-relationships/${REL}`);
    expect(fetch.calls.at(-1)!.url).toEndWith(`/platform/tree/couple-relationships/${REL}`);
  });

  test("a 410 after the delete is also success, a 200 is a failed check", async () => {
    const rel = jsonResponse({ childAndParentsRelationships: [{ id: REL, parent1: ref(DAD), child: ref(CHILD) }], persons: [person(CHILD, "Rui Lia"), person(DAD, "Pai Lia")] });
    const gone = setup([rel, response({ status: 204 }), response({ status: 410 })]);
    expect((await gone.run("remove_relationship", { relationship_id: REL, kind: "parents", reason })).readBack.ok).toBe(true);
    const still = setup([rel, response({ status: 204 }), rel]);
    const out = await still.run("remove_relationship", { relationship_id: REL, kind: "parents", reason });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(false);
  });

  test("preview never asks or deletes", async () => {
    const { run, fetch, approver } = setup([
      jsonResponse({ childAndParentsRelationships: [{ id: REL, parent1: ref(DAD), child: ref(CHILD) }], persons: [person(CHILD, "Rui Lia"), person(DAD, "Pai Lia")] }),
    ]);
    const out = await run("remove_relationship", { relationship_id: REL, kind: "parents", reason, preview: true });
    expect(out.status).toBe("preview");
    expect((approver as any).prompts).toHaveLength(0);
    expect(writes(fetch)).toHaveLength(0);
  });
});
