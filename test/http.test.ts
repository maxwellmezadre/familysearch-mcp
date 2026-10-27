import { describe, expect, test } from "bun:test";
import { AuthError, HttpError, RateLimitError } from "../src/core/errors.js";
import { type HttpRequest, createHttp, toPath } from "../src/core/http.js";
import type { SessionStore } from "../src/session/store.js";
import {
  TEST_TOKEN,
  fakeClock,
  jsonResponse,
  memorySession,
  response,
  scriptedFetch,
  sessionFixture,
  silentLogger,
} from "./helpers.js";

const BASE = "https://www.familysearch.org";
const get = (path = "/platform/users/current"): HttpRequest => ({ method: "GET", path, label: "test" });

function setup(
  script: Parameters<typeof scriptedFetch>[0],
  opts: { session?: SessionStore; reauth?: () => Promise<boolean>; fallback?: Parameters<typeof scriptedFetch>[1] } = {},
) {
  const clock = fakeClock();
  const fetch = scriptedFetch(script, opts.fallback);
  const log = silentLogger();
  const session = opts.session ?? memorySession(sessionFixture());
  const http = createHttp(
    {
      session,
      baseUrl: BASE,
      minIntervalMs: 400,
      jitterMs: 200,
      timeoutMs: 30_000,
      log,
      ...(opts.reauth ? { reauth: opts.reauth } : {}),
    },
    { fetch, sleep: clock.sleep, now: clock.now, random: () => 0.5 },
  );
  return { http, fetch, clock, log, session };
}

describe("requests", () => {
  test("sends the bearer token, the browser user agent and the default accept", async () => {
    const { http, fetch } = setup([jsonResponse({ users: [] })]);
    await http.send(get());
    const { url, init } = fetch.calls[0]!;
    expect(url).toBe(`${BASE}/platform/users/current`);
    expect(init.method).toBe("GET");
    expect(init.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(init.headers["user-agent"]).toContain("Chrome/140");
    expect(init.headers.accept).toBe("application/x-fs-v1+json");
    expect(init.redirect).toBe("manual");
  });

  test("appends the query and skips undefined values", async () => {
    const { http, fetch } = setup([jsonResponse({})]);
    await http.send({
      method: "GET",
      path: "/platform/tree/ancestry",
      query: { person: "AAAA-AAA", generations: 4, missing: undefined },
      accept: "application/x-gedcomx-atom+json",
      label: "ancestry",
    });
    const { url, init } = fetch.calls[0]!;
    expect(url).toBe(`${BASE}/platform/tree/ancestry?person=AAAA-AAA&generations=4`);
    expect(init.headers.accept).toBe("application/x-gedcomx-atom+json");
  });

  test("is serial and paces requests by minIntervalMs plus jitter", async () => {
    const { http, fetch, clock } = setup([], { fallback: jsonResponse({}) });
    await Promise.all([http.send(get()), http.send(get()), http.send(get())]);
    expect(fetch.maxInFlight).toBe(1);
    // random() = 0.5 → 400 + 100 between requests; the first one waits nothing.
    expect(clock.slept.filter((ms) => ms > 0)).toEqual([500, 500]);
  });

  test("returns non-transient statuses to the caller, redirects included", async () => {
    const { http } = setup([response({ status: 301, headers: { location: `${BASE}/platform/tree/persons/BBBB-BBB` } })]);
    const result = await http.send(get("/platform/tree/persons/AAAA-AAA"));
    expect(result.status).toBe(301);
    expect(result.headers.get("location")).toContain("BBBB-BBB");
  });
});

describe("retries", () => {
  test("429 honours Retry-After and gives up after 4 attempts", async () => {
    const tooMany = response({ status: 429, headers: { "retry-after": "7" } });
    const { http, fetch, clock } = setup([tooMany, tooMany, tooMany, tooMany]);
    await expect(http.send(get())).rejects.toThrow(RateLimitError);
    expect(fetch.calls).toHaveLength(4);
    expect(clock.slept).toContain(7000);
  });

  test("5xx backs off 2s, 4s, 8s and then fails", async () => {
    const down = response({ status: 503 });
    const { http, clock } = setup([down, down, down, down]);
    await expect(http.send(get())).rejects.toThrow(HttpError);
    expect(clock.slept.filter((ms) => ms >= 2000)).toEqual([2000, 4000, 8000]);
  });

  test("a 5xx followed by success returns the success", async () => {
    const { http } = setup([response({ status: 502 }), jsonResponse({ ok: true })]);
    expect((await http.send(get())).status).toBe(200);
  });
});

describe("authentication", () => {
  test("401 calls reauth once and retries the same request with the new token", async () => {
    const session = memorySession(sessionFixture());
    let reauths = 0;
    const reauth = async () => {
      reauths += 1;
      session.save(sessionFixture({ token: "p0-fresh-token-after-reimport" }));
      return true;
    };
    const { http, fetch } = setup([response({ status: 401 }), jsonResponse({})], { session, reauth });
    expect((await http.send(get())).status).toBe(200);
    expect(reauths).toBe(1);
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[1]!.init.headers.authorization).toBe("Bearer p0-fresh-token-after-reimport");
    expect(http.state().reauths).toBe(1);
  });

  test("401 with a failed reauth is an AuthError with the login hint", async () => {
    const { http, fetch } = setup([response({ status: 401 })], { reauth: async () => false });
    await expect(http.send(get())).rejects.toThrow(/familysearch login/);
    expect(fetch.calls).toHaveLength(1);
  });

  test("a dead token is not retried by later calls until the session changes", async () => {
    const session = memorySession(sessionFixture());
    const { http, fetch } = setup([response({ status: 401 }), jsonResponse({})], { session });
    await expect(http.send(get())).rejects.toThrow(AuthError);
    await expect(http.send(get())).rejects.toThrow(AuthError);
    expect(fetch.calls).toHaveLength(1);
    session.save(sessionFixture({ token: "p0-new-token-from-login" }));
    expect((await http.send(get())).status).toBe(200);
  });

  test("no session is an AuthError before any request", async () => {
    const { http, fetch } = setup([], { session: memorySession(null) });
    await expect(http.send(get())).rejects.toThrow(AuthError);
    expect(fetch.calls).toHaveLength(0);
  });

  test("the token never reaches the log", async () => {
    const { http, log } = setup([response({ status: 401 })]);
    await http.send(get()).catch(() => undefined);
    expect(log.lines.join("\n")).not.toContain(TEST_TOKEN);
  });
});

describe("read-only guard", () => {
  test("refuses any method that is not GET, HEAD or OPTIONS", async () => {
    const { http, fetch } = setup([]);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      await expect(
        http.send({ method: method as never, path: "/platform/tree/persons", label: "x" }),
      ).rejects.toThrow(/só lê/);
    }
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("toPath", () => {
  test("keeps relative paths", () => {
    expect(toPath("/platform/tree/persons/AAAA-AAA")).toBe("/platform/tree/persons/AAAA-AAA");
  });

  test("re-roots FamilySearch links on the configured host", () => {
    expect(toPath("https://api.familysearch.org/platform/tree/persons/X?flag=fsh")).toBe(
      "/platform/tree/persons/X?flag=fsh",
    );
    expect(toPath("https://familysearch.org/ark:/61903/4:1:AAAA-AAA")).toBe("/ark:/61903/4:1:AAAA-AAA");
  });

  test("refuses to send the session anywhere else", () => {
    expect(() => toPath("https://evil.example/platform")).toThrow(/Recusando/);
    expect(() => toPath("https://familysearch.org.evil.example/platform")).toThrow(/Recusando/);
    expect(() => toPath("http://www.familysearch.org/platform")).toThrow(/Recusando/);
  });
});

describe("createContext wiring", () => {
  test("re-imports from the configured browser only in production", async () => {
    const { createContext } = await import("../src/context.js");
    const { loadConfig } = await import("../src/config.js");
    const fetch = scriptedFetch([response({ status: 401 })]);
    const beta = createContext(loadConfig({ FAMILYSEARCH_ENV: "beta", FAMILYSEARCH_IMPORT_BROWSER: "dia" }), {
      fetch,
      session: memorySession(sessionFixture({ env: "beta" })),
      log: silentLogger(),
      sleep: async () => undefined,
    });
    await expect(beta.http.send(get())).rejects.toThrow(AuthError);
    expect(beta.http.state().reauths).toBe(0);
  });
});
