import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { requestApproval } from "../src/approval/gate.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { RateLimitError, WriteUncertainError } from "../src/core/errors.js";
import { type WriteRequest, createHttp } from "../src/core/http.js";
import type { PlannedWrite } from "../src/core/ticket.js";
import { autoApprove } from "./approvers.js";
import { fakeClock, memorySession, response, scriptedFetch, sessionFixture, silentLogger } from "./helpers.js";

const NOTES = "/platform/tree/persons/AAAA-AAA/notes";
const planned = (over: Partial<PlannedWrite> = {}): PlannedWrite => ({
  method: "POST",
  path: NOTES,
  label: "add note",
  summary: "adiciona nota",
  ...over,
});
const req = (over: Partial<WriteRequest> = {}): WriteRequest => ({
  method: "POST",
  path: NOTES,
  body: { notes: [{ text: "oi" }] },
  reason: "corrigir a data de batismo",
  label: "add note",
  ...over,
});

async function ticketFor(writes: PlannedWrite[]) {
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: mkdtempSync(join(tmpdir(), "fs-hw-")) }), {
    approver: autoApprove(),
    now: () => 1_757_000_000_000,
  });
  return requestApproval(ctx, {
    tool: "t",
    reason: "corrigir a data de batismo",
    headline: "h",
    details: "d",
    writes,
  });
}

function setup(script: Parameters<typeof scriptedFetch>[0], reauth?: () => Promise<string | null>) {
  const clock = fakeClock();
  const fetch = scriptedFetch(script);
  const session = memorySession(sessionFixture());
  const http = createHttp(
    {
      session,
      baseUrl: "https://www.familysearch.org",
      minIntervalMs: 400,
      writeIntervalMs: 2000,
      jitterMs: 200,
      timeoutMs: 30_000,
      log: silentLogger(),
      ...(reauth ? { reauth } : {}),
    },
    { fetch, sleep: clock.sleep, now: clock.now, random: () => 0.5 },
  );
  return { http, fetch, clock, session };
}

const created = () => response({ status: 201, headers: { location: `${NOTES}/N1` } });

describe("http.write", () => {
  test("a write without a covering ticket sends nothing", async () => {
    const { http, fetch } = setup([created()]);
    const ticket = await ticketFor([planned({ path: "/platform/tree/persons/OTHER-123/notes" })]);
    await expect(http.write(req(), ticket)).rejects.toThrow(/não aprovada/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("sends X-Reason, the fs content type and the JSON body", async () => {
    const { http, fetch } = setup([created()]);
    const res = await http.write(req(), await ticketFor([planned()]));
    expect(res.status).toBe(201);
    const call = fetch.calls[0];
    expect(call?.url).toBe(`https://www.familysearch.org${NOTES}`);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers["x-reason"]).toBe("corrigir a data de batismo");
    expect(call?.init.headers["content-type"]).toBe("application/x-fs-v1+json");
    expect(call?.init.body).toBe(JSON.stringify({ notes: [{ text: "oi" }] }));
  });

  test("a ticket entry is consumed: the same write twice needs a new approval", async () => {
    const { http, fetch } = setup([created(), created()]);
    const ticket = await ticketFor([planned()]);
    await http.write(req(), ticket);
    await expect(http.write(req(), ticket)).rejects.toThrow(/já usada/);
    expect(fetch.calls).toHaveLength(1);
  });

  test("a ticket approved for a note cannot merge someone else", async () => {
    const { http, fetch } = setup([created()]);
    const ticket = await ticketFor([planned()]);
    const merge = req({ path: "/platform/tree/persons/AAAA-AAA/merges/BBBB-BBB", label: "merge" });
    await expect(http.write(merge, ticket)).rejects.toThrow(/não aprovada/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("a request whose query differs from the approved one is refused with no fetch", async () => {
    const { http, fetch } = setup([created()]);
    const ticket = await ticketFor([planned({ query: { a: "1" } })]);
    await expect(http.write(req({ query: { a: "2" } }), ticket)).rejects.toThrow(/parâmetros diferentes/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("sends the approved query", async () => {
    const { http, fetch } = setup([created()]);
    await http.write(req(), await ticketFor([planned({ query: { a: "1" } })]));
    expect(fetch.calls[0]?.url).toBe(`https://www.familysearch.org${NOTES}?a=1`);
  });

  test("waits writeIntervalMs before a write", async () => {
    const { http, clock } = setup([created(), created()]);
    const ticket = await ticketFor([planned(), planned()]);
    await http.write(req(), ticket);
    await http.write(req(), ticket);
    expect(clock.slept).toEqual([2100]); // 2000 write gap + jitter 200 * 0.5
  });

  test("a network failure after sending is WriteUncertainError and is not retried", async () => {
    const { http, fetch } = setup([
      () => {
        throw new Error("socket hang up");
      },
    ]);
    const error = await http.write(req(), await ticketFor([planned()])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteUncertainError);
    expect((error as Error).message).toContain("pode ter sido aplicada");
    expect(fetch.calls).toHaveLength(1);
  });

  test("a 503 is WriteUncertainError, a 429 is RateLimitError, neither retried", async () => {
    const a = setup([response({ status: 503 })]);
    await expect(a.http.write(req(), await ticketFor([planned()]))).rejects.toBeInstanceOf(WriteUncertainError);
    expect(a.fetch.calls).toHaveLength(1);
    const b = setup([response({ status: 429 })]);
    const error = await b.http.write(req(), await ticketFor([planned()])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as Error).message).toContain("Nada foi aplicado");
    expect(b.fetch.calls).toHaveLength(1);
  });

  test("a 401 re-imports once and retries the same write", async () => {
    let reauths = 0;
    const holder: { session?: ReturnType<typeof memorySession> } = {};
    const s = setup([response({ status: 401 }), created()], async () => {
      reauths += 1;
      holder.session?.save(sessionFixture({ token: "p0-new-token-0002" }));
      return null;
    });
    holder.session = s.session;
    const res = await s.http.write(req(), await ticketFor([planned()]));
    expect(res.status).toBe(201);
    expect(reauths).toBe(1);
    expect(s.fetch.calls).toHaveLength(2);
    expect(s.fetch.calls[1]?.init.headers.authorization).toBe("Bearer p0-new-token-0002");
    expect(s.fetch.calls[1]?.init.body).toBe(s.fetch.calls[0]?.init.body);
  });

  test("a query hidden in the path is refused with no fetch", async () => {
    const { http, fetch } = setup([created()]);
    const ticket = await ticketFor([planned()]);
    await expect(http.write(req({ path: `${NOTES}?evil=1` }), ticket)).rejects.toThrow(/query/);
    expect(fetch.calls).toHaveLength(0);
    expect(ticket.remaining()).toBe(1);
  });

  test("a body that fails to read after a 2xx is WriteUncertainError", async () => {
    const broken = { ...response({ status: 201 }), text: async () => Promise.reject(new Error("socket closed")) };
    const { http, fetch } = setup([broken]);
    const error = await http.write(req(), await ticketFor([planned()])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteUncertainError);
    expect(fetch.calls).toHaveLength(1);
  });

  test("an unserializable body is a plain error, nothing sent, ticket still unused", async () => {
    const { http, fetch } = setup([created()]);
    const ticket = await ticketFor([planned()]);
    const error = await http.write(req({ body: { n: 1n } }), ticket).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(WriteUncertainError);
    expect(fetch.calls).toHaveLength(0);
    expect(ticket.remaining()).toBe(1);
  });

  test("x-reason is sent as ASCII", async () => {
    const { http, fetch } = setup([created()]);
    await http.write(req({ reason: "Mesclagem — avó confirmada\nok" }), await ticketFor([planned()]));
    expect(fetch.calls[0]?.init.headers["x-reason"]).toBe("Mesclagem ? avo confirmada ok");
  });

  test("reads still refuse POST and DELETE", async () => {
    const { http, fetch } = setup([created()]);
    // biome-ignore lint/suspicious/noExplicitAny: proving the runtime guard
    await expect(http.send({ method: "POST", path: NOTES, label: "x" } as any)).rejects.toThrow(/recusado/);
    expect(fetch.calls).toHaveLength(0);
  });
});
