import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { runWritePlan } from "../src/approval/run.js";
import type { WritePlan } from "../src/approval/gate.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import type { Approver } from "../src/approval/gate.js";
import { autoApprove, fakeApprover } from "./approvers.js";
import { fakeClock, memorySession, response, scriptedFetch, sessionFixture, silentLogger } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function setup(script: Parameters<typeof scriptedFetch>[0], approver: Approver = autoApprove()) {
  const dir = mkdtempSync(join(tmpdir(), "fs-run-"));
  dirs.push(dir);
  const clock = fakeClock();
  const fetch = scriptedFetch(script);
  const config = loadConfig({ FAMILYSEARCH_CONFIG_DIR: dir });
  const ctx = createContext(config, { fetch, session: memorySession(sessionFixture()), log: silentLogger(), now: clock.now, sleep: clock.sleep, approver, reauth: async () => "no" });
  const audit = () => { try { return readFileSync(join(config.auditDir, `writes.${config.env}.jsonl`), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return { ctx, fetch, audit };
}

const plan = (writes: WritePlan["writes"]): WritePlan => ({ tool: "test_tool", reason: "corrigir um dado errado", headline: "Alterar", details: "d", writes });
const w = (path: string, over = {}) => ({ method: "POST" as const, path, label: `w ${path}`, summary: `faz ${path}`, ...over });
const okRead = async () => ({ ok: true, checks: [] });

test("preview never asks and never writes", async () => {
  const approver = fakeApprover([]);
  const { ctx, fetch, audit } = setup([], approver);
  const out = await runWritePlan(ctx, plan([w("/platform/a"), w("/platform/b")]), { preview: true, readBack: okRead });
  expect(out.status).toBe("preview");
  expect(out.message).toContain("faz /platform/a");
  expect(out.message).toContain("faz /platform/b");
  expect(approver.prompts).toHaveLength(0);
  expect(fetch.calls).toHaveLength(0);
  expect(audit()).toHaveLength(0);
});

test("a refusal writes nothing and is audited once", async () => {
  const { ctx, fetch, audit } = setup([], fakeApprover([{ approved: false, reason: "não" }]));
  const out = await runWritePlan(ctx, plan([w("/platform/a")]), { readBack: okRead });
  expect(out.status).toBe("refused");
  expect(out.message).toContain("não");
  expect(fetch.calls).toHaveLength(0);
  expect(audit()).toHaveLength(1);
});

test("applies in order, reads back and audits one entry", async () => {
  const { ctx, fetch, audit } = setup([
    response({ status: 201, headers: { "X-ENTITY-ID": "NEW-001" } }),
    response({ status: 204 }),
  ]);
  const out = await runWritePlan(ctx, plan([w("/platform/a", { body: { x: 1 } }), w("/platform/b")]), {
    readBack: async (r) => ({ ok: r[0]?.entityId === "NEW-001", checks: [] }),
  });
  expect(out.status).toBe("applied");
  expect(out.writes.map((r) => r.status)).toEqual([201, 204]);
  expect(out.writes[0]?.entityId).toBe("NEW-001");
  expect(fetch.calls[0]?.init.body).toBe('{"x":1}');
  const lines = audit();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ approved: true, outcome: "applied", tool: "test_tool" });
});

test("calling the same plan twice asks twice", async () => {
  const approver = autoApprove();
  const { ctx } = setup([response({ status: 204 }), response({ status: 204 })], approver);
  const p = plan([w("/platform/a")]);
  await runWritePlan(ctx, p, { readBack: okRead });
  await runWritePlan(ctx, p, { readBack: okRead });
  expect(approver.prompts).toHaveLength(2);
});

test("stops at the first failing write and reports partial", async () => {
  const { ctx, fetch, audit } = setup([response({ status: 201 }), response({ status: 409, headers: { Warning: "199 - conflito" } })]);
  const out = await runWritePlan(ctx, plan([w("/platform/a"), w("/platform/b"), w("/platform/c")]), { readBack: okRead });
  expect(out.status).toBe("partial");
  expect(out.message).toContain("conflito");
  expect(fetch.calls).toHaveLength(2);
  expect(audit()[0]).toMatchObject({ outcome: "partial" });
});

test("a failing first write is refused and carries the Warning", async () => {
  const { ctx } = setup([response({ status: 400, headers: { Warning: "199 - nome inválido" } })]);
  const out = await runWritePlan(ctx, plan([w("/platform/a")]), { readBack: okRead });
  expect(out.status).toBe("refused");
  expect(out.message).toContain("nome inválido");
});

test("a later write's body receives the earlier Location", async () => {
  const { ctx, fetch } = setup([response({ status: 201, headers: { Location: "https://fs/sd/9" } }), response({ status: 204 })]);
  await runWritePlan(ctx, plan([w("/platform/a"), w("/platform/b", { body: (prior: any[]) => ({ d: prior[0].location }) })]), { readBack: okRead });
  expect(fetch.calls[1]?.init.body).toBe('{"d":"https://fs/sd/9"}');
});

test("an uncertain write is reported as uncertain, nothing after it is sent", async () => {
  const { ctx, fetch, audit } = setup([response({ status: 503 })]);
  const out = await runWritePlan(ctx, plan([w("/platform/a"), w("/platform/b")]), { readBack: okRead });
  expect(out.status).toBe("uncertain");
  expect(out.message).toContain("pode ter sido aplicada");
  expect(fetch.calls).toHaveLength(1);
  expect(audit()[0]).toMatchObject({ outcome: "uncertain" });
});

test("read-back failure keeps status applied and explains the mismatch", async () => {
  const { ctx } = setup([response({ status: 204 })]);
  const out = await runWritePlan(ctx, plan([w("/platform/a")]), {
    readBack: async () => ({ ok: false, checks: [{ what: "nascimento", ok: false, detail: "veio 1901" }] }),
  });
  expect(out.status).toBe("applied");
  expect(out.message).toContain("nascimento");
  expect(out.message).toContain("Nada foi refeito");
});

test("a 3xx is not applied: refused, no read-back, nothing after it sent", async () => {
  const { ctx, fetch } = setup([response({ status: 301, headers: { Warning: "199 - movido" } })]);
  let read = false;
  const out = await runWritePlan(ctx, plan([w("/platform/a"), w("/platform/b")]), {
    readBack: async () => { read = true; return { ok: true, checks: [] }; },
  });
  expect(out.status).toBe("refused");
  expect(out.message).toContain("301");
  expect(out.message).toContain("movido");
  expect(read).toBe(false);
  expect(fetch.calls).toHaveLength(1);
});

// DESIGN §11: a write makes the cached copies of the people it touched stale.
const cached = (id: string) => ({
  id, name: id, given: null, surname: null, gender: "female", living: false, lifespan: null,
  birthDate: null, birthFormal: null, birthPlace: null, deathDate: null, deathFormal: null, deathPlace: null,
  ascendancy: "1", generation: 0, raw: "{}",
});
function withCache(ctx: ReturnType<typeof setup>["ctx"]) {
  const repo = ctx.cache(); // creates the file, as a sync would
  for (const id of ["AAAA-AAA", "BBBB-BBB", "CCCC-CCC"]) {
    repo.upsertPerson(cached(id));
    repo.markDetails(id, { sources: 1, hints: 0, duplicates: 0 });
  }
  repo.setMeta("pedigree_at", "2026-01-01T00:00:00.000Z");
  return repo;
}
const touching = (extra: Partial<WritePlan> = {}): WritePlan => ({ ...plan([w("/platform/a")]), touches: ["AAAA-AAA", "BBBB-BBB"], ...extra });

test("a write never creates the cache file", async () => {
  const { ctx } = setup([response({ status: 204 })]);
  await runWritePlan(ctx, touching(), { readBack: okRead });
  expect(existsSync(ctx.config.dbPath)).toBe(false);
});

test("preview and refusals leave the cache as it was", async () => {
  const { ctx } = setup([], fakeApprover([{ approved: false, reason: "não" }]));
  const repo = withCache(ctx);
  await runWritePlan(ctx, touching(), { preview: true, readBack: okRead });
  await runWritePlan(ctx, touching(), { readBack: okRead });
  expect(repo.getMeta("pedigree_at")).not.toBeNull();
  expect(repo.pendingDetails(10)).toEqual([]);
});

test("applied and uncertain writes send the touched people back to the next sync", async () => {
  for (const answer of [response({ status: 204 }), response({ status: 503 })]) {
    const { ctx } = setup([answer]);
    const repo = withCache(ctx);
    const out = await runWritePlan(ctx, touching(), { readBack: okRead });
    expect(["applied", "uncertain"]).toContain(out.status);
    expect(repo.getMeta("pedigree_at")).toBeNull();
    expect(repo.pendingDetails(10).sort()).toEqual(["AAAA-AAA", "BBBB-BBB"]);
  }
});

test("an applied merge marks the duplicate merged; an uncertain one leaves that to sync", async () => {
  const merged = { duplicate: "BBBB-BBB", survivor: "AAAA-AAA" };
  const applied = setup([response({ status: 204 })]);
  const repo = withCache(applied.ctx);
  await runWritePlan(applied.ctx, touching({ merged }), { readBack: okRead });
  expect(repo.person("BBBB-BBB")?.mergedInto).toBe("AAAA-AAA");

  const uncertain = setup([response({ status: 503 })]);
  const other = withCache(uncertain.ctx);
  await runWritePlan(uncertain.ctx, touching({ merged }), { readBack: okRead });
  expect(other.person("BBBB-BBB")?.mergedInto).toBeNull();
  expect(other.pendingDetails(10)).toContain("BBBB-BBB");
});

test("the outcome and the audit entry point at the approval details", async () => {
  const { ctx, audit } = setup([response({ status: 204 })]);
  const out = await runWritePlan(ctx, plan([w("/platform/a")]), { readBack: okRead });
  expect(out.detailsPath).toStartWith(join(ctx.config.auditDir, "approvals"));
  expect(existsSync(out.detailsPath as string)).toBe(true);
  expect(audit()[0].detailsPath).toBe(out.detailsPath);
});

test("a snapshot is saved after the yes, recorded in the audit, and without it nothing is sent", async () => {
  const snapshot = { name: "AAAA-AAA-BBBB-BBB", data: { before: true } };
  const { ctx, audit } = setup([response({ status: 204 })]);
  const out = await runWritePlan(ctx, { ...plan([w("/platform/a")]), snapshot }, { readBack: okRead });
  expect(out.snapshot).toStartWith(join(ctx.config.auditDir, "snapshots"));
  expect(JSON.parse(readFileSync(out.snapshot as string, "utf8"))).toEqual({ before: true });
  expect(audit()[0].snapshot).toBe(out.snapshot);

  // A snapshot that cannot be saved stops the run before the first write.
  const broken = setup([]);
  mkdirSync(broken.ctx.config.auditDir, { recursive: true });
  writeFileSync(join(broken.ctx.config.auditDir, "snapshots"), "not a directory");
  const refused = await runWritePlan(broken.ctx, { ...plan([w("/platform/a")]), snapshot }, { readBack: okRead });
  expect(refused.status).toBe("refused");
  expect(refused.message).toContain("snapshot");
  expect(broken.fetch.calls).toHaveLength(0);
});
