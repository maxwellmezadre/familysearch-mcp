import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Approver } from "../src/approval/gate.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import type { FetchInit, FetchResponse } from "../src/core/http.js";
import { runTool } from "../src/tools/define.js";
import { toolByName } from "../src/tools/registry.js";
import { autoApprove, fakeApprover } from "./approvers.js";
import { fakeClock, jsonResponse, memorySession, response, scriptedFetch, sessionFixture, silentLogger } from "./helpers.js";

// merge_persons and restore_person against a fake FamilySearch that routes by
// method and path. Invented people only: Giulia Rossi in two copies, the
// duplicate with a son of her own (the case where the child must come along).

const SURVIVOR = "AAAA-AAA";
const DUPLICATE = "BBBB-BBB";
const CHILD = "CCCC-CCC";
const CHILD_LINK = "RRRR-111";
const API = "https://api.familysearch.org/platform/tree";
const FINGERPRINT = "chg-a|chg-b";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

type Who = { name?: string; gender?: "Male" | "Female"; living?: boolean; birth?: string; birthId?: string };
const personDoc = (id: string, name: string, who: Who = {}) => ({
  persons: [
    {
      id,
      living: who.living ?? false,
      display: { name: who.name ?? name, gender: who.gender ?? "Female", lifespan: "1890-1950" },
      gender: { id: `gender-${id}`, type: `http://gedcomx.org/${who.gender ?? "Female"}` },
      names: [{ id: `name-${id}`, nameForms: [{ fullText: name }] }],
      facts: [{ id: who.birthId ?? `birth-${id}`, type: "http://gedcomx.org/Birth", date: { original: who.birth ?? "1890", formal: `+${who.birth ?? "1890"}` } }],
    },
  ],
});
const ref = (id: string) => ({ resource: `#${id}`, resourceId: id });
const mother = (id: string) => ({
  persons: [personDoc(id, "Giulia Rossi").persons[0], personDoc(CHILD, "Luca Rossi", { gender: "Male", birth: "1915" }).persons[0]],
  childAndParentsRelationships: [{ id: CHILD_LINK, parent1: ref(id), child: ref(CHILD) }],
});
const analysis = {
  mergeAnalyses: [
    {
      survivorResources: [{ resource: `${API}/persons/${SURVIVOR}/source-references/sr-1` }],
      duplicateResources: [{ resource: `${API}/child-and-parents-relationships/${CHILD_LINK}` }],
      conflictingResources: [
        {
          survivorResource: { resource: `${API}/persons/${SURVIVOR}/conclusions/birth-${SURVIVOR}` },
          duplicateResource: { resource: `${API}/persons/${DUPLICATE}/conclusions/birth-${DUPLICATE}` },
        },
      ],
    },
  ],
};

type World = {
  survivor?: Who;
  duplicate?: Who;
  analysis?: typeof analysis;
  /** A person whose change history comes back empty. */
  emptyHistory?: string;
  options?: FetchResponse;
  /** Answers the POST; the duplicate turns into a 301 only when it is 2xx. */
  merge?: () => FetchResponse;
  /** Whether the survivor gained the duplicate's son after the merge. */
  childMoves?: boolean;
  /** The survivor as it reads after the merge (a take_from_duplicate swap shows up here). */
  survivorAfter?: Who;
};

/** A fake FamilySearch: before the merge both exist; after it the duplicate redirects to the survivor. */
function world(w: World = {}) {
  let merged = false;
  return (url: string, init: FetchInit): FetchResponse => {
    const path = new URL(url).pathname.replace("/platform/tree/persons/", "");
    const [id, ...rest] = path.split("/");
    const sub = rest.join("/");
    if (init.method === "OPTIONS") return w.options ?? response({ status: 200, headers: { allow: "OPTIONS, HEAD, GET, POST" } });
    if (init.method === "POST" && sub === `merges/${DUPLICATE}`) {
      const answer = w.merge?.() ?? response({ status: 201 });
      merged = answer.status < 300;
      return answer;
    }
    if (sub === `merges/${DUPLICATE}`) return jsonResponse(w.analysis ?? analysis);
    if (merged && id === DUPLICATE) {
      return response({ status: 301, headers: { location: `https://www.familysearch.org/platform/tree/persons/${SURVIVOR}` } });
    }
    if (sub === "" && merged && w.survivorAfter && id === SURVIVOR) return jsonResponse(personDoc(id, "Giulia Rossi", w.survivorAfter));
    if (sub === "") return jsonResponse(personDoc(id!, "Giulia Rossi", id === DUPLICATE ? w.duplicate : w.survivor));
    if (sub === "families") {
      if (id === DUPLICATE) return jsonResponse(mother(DUPLICATE));
      return jsonResponse(merged && (w.childMoves ?? true) ? mother(SURVIVOR) : personDoc(id!, "Giulia Rossi"));
    }
    if (sub === "sources") return response({ status: 204 });
    if (sub === "changes") {
      if (id === w.emptyHistory) return jsonResponse({ entries: [] });
      return jsonResponse({ entries: [{ id: id === SURVIVOR ? "chg-a" : "chg-b", title: "Birth Added" }] });
    }
    throw new Error(`rota não prevista: ${init.method} ${url}`);
  };
}

function setup(route: (url: string, init: FetchInit) => FetchResponse, approver: Approver & { prompts: unknown[] } = autoApprove()) {
  const dir = mkdtempSync(join(tmpdir(), "fs-merge-"));
  dirs.push(dir);
  const clock = fakeClock();
  const fetch = scriptedFetch([], route);
  const config = loadConfig({ FAMILYSEARCH_CONFIG_DIR: dir });
  const ctx = createContext(config, {
    fetch,
    session: memorySession(sessionFixture()),
    log: silentLogger(),
    now: clock.now,
    sleep: clock.sleep,
    reauth: async () => "sem navegador",
    approver,
  });
  const run = (tool: string, args: Record<string, unknown>) =>
    runTool(toolByName(tool) as never, args, ctx) as Promise<Record<string, any>>;
  const writes = () => fetch.calls.filter((call) => call.init.method === "POST" || call.init.method === "DELETE");
  const snapshots = () => {
    const at = join(config.auditDir, "snapshots");
    return existsSync(at) ? readdirSync(at).map((name) => join(at, name)) : [];
  };
  return { run, fetch, approver, writes, snapshots, ctx };
}

const merge = (extra: Record<string, unknown> = {}) => ({
  survivor_id: SURVIVOR,
  duplicate_id: DUPLICATE,
  fingerprint: FINGERPRINT,
  reason: "As duas são a mesma Giulia: mesmos pais e mesmo filho",
  ...extra,
});

describe("merge_persons", () => {
  test("a living person is refused before any question", async () => {
    const { run, approver, writes } = setup(world({ duplicate: { living: true } }));
    await expect(run("merge_persons", merge())).rejects.toThrow(/pessoa viva não é mesclada; use link_parents e remove_relationship/);
    expect(approver.prompts).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  test("a stale fingerprint is refused before any question", async () => {
    const { run, approver, writes } = setup(world());
    await expect(run("merge_persons", merge({ fingerprint: "chg-a|chg-old" }))).rejects.toThrow(
      /alguém alterou uma das duas desde a comparação: rode compare_persons de novo/,
    );
    expect(approver.prompts).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  test("the fingerprint is accepted in either order", async () => {
    const { run } = setup(world(), fakeApprover([]));
    const out = await run("merge_persons", merge({ fingerprint: "chg-b|chg-a", preview: true }));
    expect(out.status).toBe("preview");
  });

  test("the same id on both sides is refused before any request", async () => {
    const { run, fetch } = setup(world());
    await expect(run("merge_persons", merge({ duplicate_id: SURVIVOR }))).rejects.toThrow(/mesma pessoa/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("other-order-only says to swap the ids", async () => {
    const options = response({ status: 200, headers: { allow: "OPTIONS", warning: '450 FamilySearch "Can merge, but must switch order"' } });
    const { run, approver, writes } = setup(world({ options }));
    const error = await run("merge_persons", merge()).catch((caught: Error) => caught);
    expect(String(error)).toContain("Can merge, but must switch order");
    expect(String(error)).toContain(`sobrevivente ${DUPLICATE} e duplicata ${SURVIVOR}`);
    expect(approver.prompts).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  test("preview shows the plan without asking, writing or saving a snapshot", async () => {
    const { run, approver, writes, snapshots } = setup(world(), fakeApprover([]));
    const out = await run("merge_persons", merge({ preview: true }));
    expect(out.status).toBe("preview");
    expect(out.request.resourcesToCopy).toEqual([`${API}/child-and-parents-relationships/${CHILD_LINK}`]);
    expect(out.details).toContain(`filiação: Luca Rossi [${CHILD}] é filho(a) de Giulia Rossi [${DUPLICATE}] (${CHILD_LINK})`);
    expect(approver.prompts).toHaveLength(0);
    expect(writes()).toHaveLength(0);
    expect(snapshots()).toHaveLength(0);
  });

  test("the question asks to type the duplicate id and leads with who into whom", async () => {
    const approver = fakeApprover([{ approved: false, reason: "não" }]);
    const { run, writes, fetch } = setup(world(), approver);
    const out = await run("merge_persons", merge());
    expect(out.status).toBe("refused");
    expect(writes()).toHaveLength(0);
    // 8 for the two bundles, OPTIONS, the analysis, and the 4 raw documents.
    expect(fetch.calls).toHaveLength(14);
    const prompt = approver.prompts[0]!;
    expect(prompt.confirm).toEqual({ title: `Digite o id da duplicata (${DUPLICATE}) para confirmar`, expected: DUPLICATE });
    expect(prompt.headline.split("\n")).toEqual([
      `Mesclar Giulia Rossi [${DUPLICATE}] em Giulia Rossi [${SURVIVOR}]`,
      `Fica ${SURVIVOR}; ${DUPLICATE} deixa de existir. Copia 1, troca 0.`,
    ]);
    expect(prompt.details).toContain(`restore_person(${DUPLICATE})`);
  });

  test("red flags replace the second headline line with a warning", async () => {
    const approver = fakeApprover([{ approved: false, reason: "não" }]);
    const { run } = setup(world({ duplicate: { gender: "Male", birth: "1850" } }), approver);
    await run("merge_persons", merge());
    const prompt = approver.prompts[0]!;
    expect(prompt.headline.split("\n")[1]).toBe("ATENÇÃO: 2 sinais de que não são a mesma pessoa.");
    expect(prompt.details).toContain("Sexo diferente");
    expect(prompt.details).toContain("Copia 1, troca 0.");
  });

  test("long names never push the warning out of the headline", async () => {
    const approver = fakeApprover([{ approved: false, reason: "não" }]);
    const long = (first: string) => `${first} ${"Maria ".repeat(20)}`.trim().slice(0, 120);
    const { run } = setup(
      world({ survivor: { name: long("Giulia") }, duplicate: { name: `Giulia\n${long("Rossi")}`, gender: "Male", birth: "1850" } }),
      approver,
    );
    await run("merge_persons", merge());
    const [first, second] = approver.prompts[0]!.headline.split("\n");
    expect(second).toStartWith("ATENÇÃO:");
    expect(first).toContain(`… [${DUPLICATE}] em Giulia`);
    expect(first).toEndWith(`… [${SURVIVOR}]`);
  });

  test("an empty change history is refused before any question", async () => {
    const { run, approver, writes } = setup(world({ emptyHistory: DUPLICATE }));
    // "null" is what compare_persons puts in the fingerprint for an empty history: it must not pass.
    await expect(run("merge_persons", merge({ fingerprint: "chg-a|null" }))).rejects.toThrow(
      `não consegui ler o histórico de alterações de ${DUPLICATE}; não dá para garantir que nada mudou desde a comparação`,
    );
    expect(approver.prompts).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  test("two conflicts sharing the survivor's side: the question counts what is sent", async () => {
    const shared = structuredClone(analysis);
    const birthA = { resource: `${API}/persons/${SURVIVOR}/conclusions/birth-${SURVIVOR}` };
    shared.mergeAnalyses[0]!.conflictingResources.push({
      survivorResource: birthA,
      duplicateResource: { resource: `${API}/persons/${DUPLICATE}/conclusions/name-${DUPLICATE}` },
    });
    const approver = autoApprove();
    const { run, writes } = setup(world({ analysis: shared }), approver);
    await run("merge_persons", merge({ take_from_duplicate: [`birth-${DUPLICATE}`] }));
    const body = JSON.parse(String(writes()[0]!.init.body)).merges[0];
    expect(body.resourcesToCopy).toHaveLength(2); // the child link and the chosen birth
    expect(body.resourcesToDelete).toEqual([birthA]);
    const prompt = approver.prompts[0]!;
    expect(prompt.headline.split("\n")[1]).toEndWith("Copia 1, troca 1.");
    expect(prompt.details.match(/no lugar de/g)).toHaveLength(1);
  });

  test("two conflicts sharing the duplicate's side: an ambiguous choice is refused, the unchosen one says it comes in", async () => {
    const shared = structuredClone(analysis);
    const birthB = `${API}/persons/${DUPLICATE}/conclusions/birth-${DUPLICATE}`;
    shared.mergeAnalyses[0]!.conflictingResources.push({
      survivorResource: { resource: `${API}/persons/${SURVIVOR}/conclusions/name-${SURVIVOR}` },
      duplicateResource: { resource: birthB },
    });
    const refused = setup(world({ analysis: shared }), fakeApprover([]));
    await expect(refused.run("merge_persons", merge({ take_from_duplicate: [`birth-${DUPLICATE}`] }))).rejects.toThrow(
      `birth-${SURVIVOR}, name-${SURVIVOR}`,
    );
    expect(refused.writes()).toHaveLength(0);

    const approver = fakeApprover([{ approved: false, reason: "não" }]);
    const { run } = setup(world({ analysis: shared }), approver);
    await run("merge_persons", merge({ take_from_duplicate: [`birth-${SURVIVOR}`] }));
    const details = approver.prompts[0]!.details;
    // The duplicate's birth is sent by the swap: the conflict left as is must not say it is not copied.
    expect(details).not.toContain(`não copia Birth: 1890, de Giulia Rossi [${DUPLICATE}]`);
    expect(details).toContain(`fica nome "Giulia Rossi", de Giulia Rossi [${SURVIVOR}] (name-${SURVIVOR}); birth-${DUPLICATE} entra pela troca acima`);
  });

  test("the snapshot is saved only after approval, before the POST", async () => {
    let atQuestion = null as string[] | null;
    let atPost = null as string[] | null;
    const route = world({ merge: () => ((atPost = snapshots()), response({ status: 201 })) });
    const approver = {
      kind: "test" as const,
      prompts: [] as unknown[],
      async ask(prompt: unknown) {
        approver.prompts.push(prompt);
        atQuestion = snapshots();
        return { approved: true, reason: "ok" };
      },
    };
    const { run, snapshots } = setup(route, approver);
    const out = await run("merge_persons", merge());
    expect(atQuestion!).toEqual([]);
    expect(atPost!).toHaveLength(1);
    expect(atPost![0]).toEndWith(`-${SURVIVOR}-${DUPLICATE}.json`);
    expect(out.snapshot).toBe(atPost![0]);
    const saved = JSON.parse(readFileSync(out.snapshot, "utf8"));
    expect(saved.duplicate.person.persons[0].id).toBe(DUPLICATE);
    expect(saved.duplicate.families.childAndParentsRelationships[0].id).toBe(CHILD_LINK);
    expect(saved.survivor.person.persons[0].id).toBe(SURVIVOR);

    // A "no" saves nothing.
    const refused = setup(world(), fakeApprover([{ approved: false, reason: "não" }]));
    await refused.run("merge_persons", merge());
    expect(refused.snapshots()).toHaveLength(0);
  });

  test("read-back confirms the 301, the copied children and the chosen birth", async () => {
    const { run, writes } = setup(world({ duplicate: { birth: "1891" }, survivorAfter: { birth: "1891", birthId: "birth-copied" } }));
    const out = await run("merge_persons", merge({ take_from_duplicate: [`birth-${DUPLICATE}`] }));
    expect(writes()).toHaveLength(1);
    const post = writes()[0]!;
    expect(post.url).toEndWith(`/platform/tree/persons/${SURVIVOR}/merges/${DUPLICATE}`);
    expect(JSON.parse(String(post.init.body))).toEqual({
      merges: [
        {
          resourcesToCopy: [
            { resource: `${API}/child-and-parents-relationships/${CHILD_LINK}` },
            { resource: `${API}/persons/${DUPLICATE}/conclusions/birth-${DUPLICATE}` },
          ],
          resourcesToDelete: [{ resource: `${API}/persons/${SURVIVOR}/conclusions/birth-${SURVIVOR}` }],
        },
      ],
    });
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
    expect(out.readBack.checks.map((check: { detail: string }) => check.detail).join("\n")).toContain(`301 para ${SURVIVOR}`);
    expect(out.readBack.checks.some((check: { what: string }) => check.what.includes(CHILD))).toBe(true);
    const whats = out.readBack.checks.map((check: { what: string }) => check.what);
    expect(whats).toContain(`Birth: 1891 da duplicata em ${SURVIVOR}`);
    expect(whats).toContain(`birth-${SURVIVOR} saiu de ${SURVIVOR}`);
    expect(out.undo).toContain(`restore_person(${DUPLICATE})`);
    expect(out.undo).toContain("continua");
  });

  test("read-back fails when a chosen swap did not land on the survivor", async () => {
    // FamilySearch answered 2xx, but the survivor still has its own birth and not the duplicate's.
    const { run } = setup(world({ duplicate: { birth: "1891" } }));
    const out = await run("merge_persons", merge({ take_from_duplicate: [`birth-${DUPLICATE}`] }));
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(false);
    expect(out.message).toContain(`Birth: 1891 da duplicata em ${SURVIVOR} (não aparece na sobrevivente)`);
    expect(out.message).toContain(`birth-${SURVIVOR} saiu de ${SURVIVOR} (continua na sobrevivente)`);
  });

  test("read-back fails a swap whose old value is gone but the new one never arrived", async () => {
    // The survivor comes back with a birth that is neither its old one nor the duplicate's.
    const { run } = setup(world({ duplicate: { birth: "1891" }, survivorAfter: { birth: "1777", birthId: "birth-other" } }));
    const out = await run("merge_persons", merge({ take_from_duplicate: [`birth-${DUPLICATE}`] }));
    expect(out.readBack.ok).toBe(false);
    expect(out.message).toContain("não aparece na sobrevivente");
  });

  test("an applied merge sends both people back to sync and marks the duplicate merged", async () => {
    const { run, ctx } = setup(world());
    const repo = ctx.cache(); // an existing cache, as after a sync
    for (const [id, ascendancy] of [[SURVIVOR, "1"], [DUPLICATE, "2"]] as const) {
      repo.upsertPerson({
        id, name: "Giulia Rossi", given: null, surname: null, gender: "female", living: false, lifespan: null,
        birthDate: null, birthFormal: null, birthPlace: null, deathDate: null, deathFormal: null, deathPlace: null,
        ascendancy, generation: Number(ascendancy) - 1, raw: "{}",
      });
      repo.markDetails(id, { sources: 0, hints: 0, duplicates: 1 });
    }
    repo.setMeta("pedigree_at", "2026-01-01T00:00:00.000Z");
    await run("merge_persons", merge());
    expect(repo.person(DUPLICATE)?.mergedInto).toBe(SURVIVOR);
    expect(repo.pendingDetails(10)).toEqual([SURVIVOR]);
    expect(repo.getMeta("pedigree_at")).toBeNull();
  });

  test("read-back reports a child that did not come along", async () => {
    const { run } = setup(world({ childMoves: false }));
    const out = await run("merge_persons", merge());
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(false);
    expect(out.message).toContain(CHILD);
  });
});

describe("restore_person", () => {
  const restoreWorld = (states: FetchResponse[]) => {
    const reads = [...states];
    return (url: string, init: FetchInit): FetchResponse => {
      if (init.method === "POST" && url.endsWith(`/persons/${DUPLICATE}/restore`)) return response({ status: 204 });
      if (init.method === "GET" && new URL(url).pathname.endsWith(`/persons/${DUPLICATE}`)) return reads.shift()!;
      throw new Error(`rota não prevista: ${init.method} ${url}`);
    };
  };
  const mergedAway = () => response({ status: 301, headers: { location: `https://www.familysearch.org/platform/tree/persons/${SURVIVOR}` } });
  const restore = { person_id: DUPLICATE, reason: "A mesclagem juntou duas pessoas diferentes" };

  test("restore_person reads the person back as 200", async () => {
    const approver = autoApprove();
    const { run, writes } = setup(restoreWorld([mergedAway(), jsonResponse(personDoc(DUPLICATE, "Giulia Rossi"))]), approver);
    const out = await run("restore_person", restore);
    expect(approver.prompts[0]!.headline.split("\n")[0]).toBe(`Restaurar ${DUPLICATE}`);
    expect(approver.prompts[0]!.headline).toContain(`mesclada em ${SURVIVOR}`);
    expect(writes().map((call) => [call.init.method, new URL(call.url).pathname])).toEqual([
      ["POST", `/platform/tree/persons/${DUPLICATE}/restore`],
    ]);
    expect(out.status).toBe("applied");
    expect(out.readBack.ok).toBe(true);
  });

  test("a person still merged after the restore is a failed check", async () => {
    const { run } = setup(restoreWorld([mergedAway(), mergedAway()]));
    const out = await run("restore_person", restore);
    expect(out.readBack.ok).toBe(false);
  });

  test("preview never asks and never writes; a person that is not merged or deleted is refused", async () => {
    const preview = setup(restoreWorld([mergedAway()]), fakeApprover([]));
    expect((await preview.run("restore_person", { ...restore, preview: true })).status).toBe("preview");
    expect(preview.writes()).toHaveLength(0);
    const alive = setup(restoreWorld([jsonResponse(personDoc(DUPLICATE, "Giulia Rossi"))]), fakeApprover([]));
    await expect(alive.run("restore_person", restore)).rejects.toThrow(/não há o que restaurar/);
    expect(alive.writes()).toHaveLength(0);
  });
});
