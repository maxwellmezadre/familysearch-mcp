import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { requestApproval } from "../../src/approval/gate.js";
import { loadConfig } from "../../src/config.js";
import { type Ctx, createContext } from "../../src/context.js";
import { DeletedError, MergedError, NotFoundError } from "../../src/core/errors.js";
import type { PlannedWrite } from "../../src/core/ticket.js";
import { resourceId } from "../../src/domain/merge.js";
import { getJson, readPerson } from "../../src/familysearch/api.js";
import { runTool } from "../../src/tools/define.js";
import { toolByName } from "../../src/tools/registry.js";
import { autoApprove } from "../approvers.js";

// Proves every write tool on FamilySearch's BETA environment (an isolated copy
// with its own accounts and an empty tree). Never touches production: it aborts
// before any request unless the config says beta. Everything it creates is named
// "fsmcp-teste-<run>" and removed in afterAll. Run it by hand, never in CI:
//   FAMILYSEARCH_ENV=beta familysearch login
//   FAMILYSEARCH_LIVE=1 FAMILYSEARCH_ENV=beta bun test test/integration/beta.real.test.ts

const BETA_URL = "https://beta.familysearch.org";
const PREFIX = "fsmcp-teste-";
const TIMEOUT = 120_000; // the http layer paces writes at 2 s and a step can write several times

const config = (() => {
  try {
    return loadConfig();
  } catch {
    return null;
  }
})();

const enabled =
  process.env.FAMILYSEARCH_LIVE === "1" &&
  config !== null &&
  config.env === "beta" &&
  existsSync(config.sessionPath);
const gated = enabled ? describe : describe.skip;

if (!enabled) {
  console.error(
    "suíte beta pulada: primeiro `FAMILYSEARCH_ENV=beta familysearch login`, depois " +
      "`FAMILYSEARCH_LIVE=1 FAMILYSEARCH_ENV=beta bun test test/integration/beta.real.test.ts`",
  );
}

type Outcome = { status: string; readBack: { ok: boolean; checks: unknown[] } | null; message: string; person_id?: string | null };
type Family = {
  parents: Array<{ relationshipId: string; parent1: { id: string } | null; parent2: { id: string } | null }>;
  spouses: Array<{ relationshipId: string | null; spouse: { id: string } | null; children: Array<{ id: string }> }>;
};
type Person = { id: string; facts: Array<{ id: string | null; type: string; date: { original: string; formal: string | null } | null }> };

gated("beta: every write", () => {
  const ctx: Ctx = createContext(loadConfig(), { approver: autoApprove() });
  const run = Date.now().toString(36);
  const tag = `${PREFIX}${run}`;
  const created = new Set<string>();

  const call = async <T = any>(name: string, args: unknown): Promise<T> => {
    const tool = toolByName(name);
    if (!tool) throw new Error(`tool ${name} não existe`);
    return (await runTool(tool, args, ctx)) as T;
  };
  /** A write tool that applied and whose own read-back matched. */
  const write = async (name: string, args: Record<string, unknown>): Promise<Outcome> => {
    const out = await call<Outcome>(name, { reason: `${tag} prova da suíte beta`, ...args });
    // Track a created person BEFORE asserting: a failed read-back must not leak it.
    if (name === "create_person" && out.person_id) created.add(out.person_id);
    expect(out.message).toContain("conferid");
    expect(out.status).toBe("applied");
    expect(out.readBack?.ok).toBe(true);
    return out;
  };
  const person = (id: string) => call<Person>("get_person", { person_id: id });
  const family = (id: string) => call<Family>("get_family", { person_id: id });
  const childrenOf = (f: Family) => f.spouses.flatMap((s) => s.children.map((c) => c.id));
  const create = async (given: string, surname: string, gender: "male" | "female", extra: Record<string, unknown> = {}) => {
    const out = await write("create_person", {
      given_name: given,
      surname,
      gender,
      birth: { date: "1 January 1900" },
      death: { date: "1 January 1970" },
      ...extra,
    });
    expect(out.person_id).toBeTruthy();
    return out.person_id as string;
  };

  // ids filled in order by the tests below
  const mergedAway = new Set<string>(); // ids known to redirect after a proven merge
  let a = "", b = "", c = "", s = "", d = "", e = "";

  const isGone = async (id: string): Promise<boolean> => {
    try {
      await readPerson(ctx.http, id);
      return false;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof DeletedError) return true;
      if (error instanceof MergedError) return true; // redirected: nothing to delete under this id
      throw error;
    }
  };

  // Before ANY network call: refuse to run against anything but beta.
  beforeAll(() => {
    if (ctx.config.env !== "beta" || ctx.config.baseUrl !== BETA_URL) {
      throw new Error(`suíte beta abortada: env=${ctx.config.env} baseUrl=${ctx.config.baseUrl}; só roda em ${BETA_URL}`);
    }
  });

  test("1. create two identical deceased people and a deceased child", async () => {
    a = await create(tag, "Duplicata", "female");
    b = await create(tag, "Duplicata", "female");
    c = await create(`${tag}-filho`, "Duplicata", "male");
    for (const id of [a, b, c]) expect((await person(id)).id).toBe(id);
    expect((await person(a)).facts.map((f) => f.type)).toEqual(expect.arrayContaining(["Birth", "Death"]));
  }, TIMEOUT);

  test("2. update_person adds, corrects and removes a Residence", async () => {
    const residence = async () => (await person(a)).facts.find((f) => f.type === "Residence");
    await write("update_person", { person_id: a, add_facts: [{ type: "Residence", date: "1 January 1950", place: "Salt Lake City, Utah" }] });
    const added = await residence();
    expect(added?.date?.original).toBe("1 January 1950");
    expect(added?.date?.formal).toBeTruthy(); // standardized by FamilySearch, not left as free text

    await write("update_person", { person_id: a, update_facts: [{ fact_id: added?.id, date: "1 January 1951" }] });
    expect((await residence())?.date?.original).toBe("1 January 1951");

    await write("update_person", { person_id: a, remove_fact_ids: [added?.id] });
    expect(await residence()).toBeUndefined();
  }, TIMEOUT);

  test("3. link_parents and link_spouses", async () => {
    await write("link_parents", { child_id: c, parent1_id: a });
    expect((await family(c)).parents.some((p) => p.parent1?.id === a || p.parent2?.id === a)).toBe(true);
    expect(childrenOf(await family(a))).toContain(c);

    s = await create(`${tag}-conjuge`, "Duplicata", "male");
    await write("link_spouses", { person1_id: a, person2_id: s });
    expect((await family(a)).spouses.some((x) => x.spouse?.id === s && x.relationshipId)).toBe(true);
  }, TIMEOUT);

  test("4. add_note on the person and on the couple", async () => {
    await write("add_note", { person_id: a, subject: `${tag} nota`, text: "nota de teste da pessoa" });
    const notes = ((await call("get_person", { person_id: a, include: ["notes"] })) as { notes?: Array<{ subject: string | null }> }).notes ?? [];
    expect(notes.some((n) => n.subject === `${tag} nota`)).toBe(true);

    const couple = (await family(a)).spouses.find((x) => x.spouse?.id === s)?.relationshipId;
    expect(couple).toBeTruthy();
    await write("add_note", { relationship_id: couple, relationship_kind: "couple", subject: `${tag} nota do casal`, text: "nota de teste do casal" });
    const doc = await getJson<{ relationships?: Array<{ notes?: Array<{ subject?: string }> }> }>(
      ctx.http,
      { method: "GET", path: `/platform/tree/couple-relationships/${couple}/notes`, label: "couple notes" },
      couple as string,
    );
    expect((doc?.relationships?.[0]?.notes ?? []).some((n) => n.subject === `${tag} nota do casal`)).toBe(true);
  }, TIMEOUT);

  test("5. add_source and attach_record", async () => {
    await write("add_source", { person_id: a, title: `${tag} fonte`, citation: "citação de teste", url: "https://example.org/fsmcp-teste" });
    const sources = ((await call("get_person", { person_id: a, include: ["sources"] })) as { sources?: Array<{ title: string | null }> }).sources ?? [];
    expect(sources.some((x) => x.title === `${tag} fonte`)).toBe(true);

    const found = await call<{ records: Array<{ id: string; url: string }> }>("search_records", { given_name: "John", surname: "Smith", limit: 5 });
    const record = found.records[0];
    if (!record) {
      console.error("ATENÇÃO: beta sem registros em search_records; attach_record NÃO foi provado nesta execução");
      return;
    }
    await write("attach_record", { person_id: a, record_id: record.id });
    const after = ((await call("get_person", { person_id: a, include: ["sources"] })) as { sources?: Array<{ url: string | null }> }).sources ?? [];
    expect(after.some((x) => x.url === record.url)).toBe(true);
  }, TIMEOUT);

  test("6. compare_persons then merge_persons of the second into the first", async () => {
    const cmp = await call<{ fingerprint: string; path: string }>("compare_persons", { person_a: a, person_b: b });
    expect(cmp.path).toBe("merge");
    await write("merge_persons", { survivor_id: a, duplicate_id: b, fingerprint: cmp.fingerprint });
    // independent: the duplicate's id now redirects (301) and the child is still linked
    await expect(person(b)).rejects.toBeInstanceOf(MergedError);
    expect(childrenOf(await family(a))).toContain(c);
  }, TIMEOUT);

  test("7. reverse merge: the duplicate's own child moves (no skip_copy)", async () => {
    d = await create(tag, "Duplicata", "female");
    e = await create(`${tag}-neto`, "Duplicata", "male");
    await write("link_parents", { child_id: e, parent1_id: d });
    expect(childrenOf(await family(d))).toContain(e);

    const cmp = await call<{ fingerprint: string; path: string }>("compare_persons", { person_a: a, person_b: d });
    expect(cmp.path).toBe("merge");
    await write("merge_persons", { survivor_id: a, duplicate_id: d, fingerprint: cmp.fingerprint });
    await expect(person(d)).rejects.toBeInstanceOf(MergedError);
    mergedAway.add(d);
    const kids = childrenOf(await family(a));
    expect(kids).toContain(e);
    expect(kids).toContain(c);
  }, TIMEOUT);

  test("8. merge with take_from_duplicate: the survivor ends with the duplicate's birth", async () => {
    const first = await create(`${tag}-conflito`, "Duplicata", "female", { birth: { date: "1 January 1900" } });
    const second = await create(`${tag}-conflito`, "Duplicata", "female", { birth: { date: "2 February 1901" } });
    const cmp = await call<{
      fingerprint: string;
      path: string;
      suggestion: { survivorId: string; duplicateId: string } | null;
      analysis: { conflicts: Array<{ survivor: string; duplicate: string }> } | null;
    }>("compare_persons", { person_a: first, person_b: second });
    expect(cmp.path).toBe("merge");
    // FamilySearch decides the order it allows; the analysis is for that order.
    const survivor = cmp.suggestion?.survivorId as string;
    const duplicate = cmp.suggestion?.duplicateId as string;
    const birthOf = async (id: string) => (await person(id)).facts.filter((f) => f.type === "Birth");
    const [duplicateBirth] = await birthOf(duplicate);
    expect(duplicateBirth?.id).toBeTruthy();
    const conflict = cmp.analysis?.conflicts.find((pair) => resourceId(pair.duplicate) === duplicateBirth?.id);
    expect(conflict).toBeTruthy();

    await write("merge_persons", {
      survivor_id: survivor,
      duplicate_id: duplicate,
      fingerprint: cmp.fingerprint,
      take_from_duplicate: [duplicateBirth?.id],
    });
    await expect(person(duplicate)).rejects.toBeInstanceOf(MergedError);
    mergedAway.add(duplicate);
    // independent: only the duplicate's birth is left on the survivor
    expect((await birthOf(survivor)).map((f) => f.date?.original)).toEqual([duplicateBirth?.date?.original as string]);
  }, TIMEOUT);

  test("9. restore_person brings the step-6 duplicate back", async () => {
    await write("restore_person", { person_id: b });
    expect((await person(b)).id).toBe(b);
  }, TIMEOUT);

  test("10. remove_relationship on every relationship created", async () => {
    const couple = (await family(a)).spouses.find((x) => x.spouse?.id === s)?.relationshipId;
    expect(couple).toBeTruthy();
    const gone = async (kind: "couple" | "parents", id: string) => {
      const path = kind === "couple" ? "couple-relationships" : "child-and-parents-relationships";
      const res = await ctx.http.send({ method: "GET", path: `/platform/tree/${path}/${encodeURIComponent(id)}`, label: "removed relationship" });
      expect([404, 410]).toContain(res.status);
    };
    await write("remove_relationship", { relationship_id: couple, kind: "couple" });
    await gone("couple", couple as string);
    for (const child of [c, e]) {
      for (const rel of (await family(child)).parents) {
        await write("remove_relationship", { relationship_id: rel.relationshipId, kind: "parents" });
        await gone("parents", rel.relationshipId);
      }
      expect((await family(child)).parents).toHaveLength(0);
    }
    const after = await family(a);
    expect(after.spouses.some((x) => x.spouse?.id === s)).toBe(false);
    expect(childrenOf(after)).not.toContain(c);
  }, TIMEOUT);

  // 11. cleanup: always runs, even when a step above failed
  afterAll(async () => {
    const leftovers: string[] = [];
    try {
      for (const id of created) {
        try {
          try {
            await readPerson(ctx.http, id); // must exist before cleanup
          } catch (error) {
            if (error instanceof MergedError && mergedAway.has(id)) continue; // expected: its survivor is in the set
            throw new Error(`pessoa ${id} deveria existir antes da limpeza: ${error instanceof Error ? error.message : error}`);
          }
          // leftover relationships first, through the tool
          const fam = await family(id);
          const rels = [
            ...fam.parents.map((p) => ({ relationship_id: p.relationshipId, kind: "parents" })),
            ...fam.spouses.filter((x) => x.relationshipId).map((x) => ({ relationship_id: x.relationshipId, kind: "couple" })),
          ];
          for (const rel of rels) await write("remove_relationship", rel);

          // a ticket for the one DELETE this suite is allowed to make, approved by the test auto-approver
          const del: PlannedWrite = {
            method: "DELETE",
            path: `/platform/tree/persons/${encodeURIComponent(id)}`,
            label: "delete test person",
            summary: `Apagar a pessoa de teste ${id}`,
          };
          const reason = `${tag} limpeza da suíte beta`;
          const ticket = await requestApproval(ctx, { tool: "beta_cleanup", reason, headline: del.summary, details: del.summary, writes: [del] });
          await ctx.http.write({ method: "DELETE", path: del.path, reason, label: del.label }, ticket);
          if (!(await isGone(id))) leftovers.push(id);
        } catch (error) {
          console.error(`limpeza de ${id} falhou:`, error);
          leftovers.push(id);
        }
      }
    } finally {
      ctx.dispose();
    }
    if (leftovers.length > 0) {
      console.error(`ATENÇÃO: pessoas de teste que ficaram no beta (apague à mão): ${leftovers.join(", ")}`);
    }
    expect(leftovers).toEqual([]);
  }, TIMEOUT * 4);
});
