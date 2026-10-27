import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { runTool } from "../src/tools/define.js";
import { toolByName } from "../src/tools/registry.js";
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

function ctxWith(opts: { env?: Record<string, string>; session?: ReturnType<typeof memorySession>; script?: Parameters<typeof scriptedFetch>[0] } = {}) {
  const clock = fakeClock(1_757_000_000_000 + 30 * 60_000);
  const fetch = scriptedFetch(opts.script ?? []);
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: "/nonexistent/fs", ...opts.env }), {
    fetch,
    session: opts.session ?? memorySession(sessionFixture()),
    log: silentLogger(),
    now: clock.now,
    sleep: clock.sleep,
    reauth: async () => false,
  });
  return { ctx, fetch };
}

const run = (ctx: ReturnType<typeof ctxWith>["ctx"], name: string, args: Record<string, unknown> = {}) =>
  runTool(toolByName(name) as never, args, ctx) as Promise<Record<string, unknown>>;

describe("auth_status", () => {
  test("without a session it says how to log in and spends no request", async () => {
    const { ctx, fetch } = ctxWith({ session: memorySession(null) });
    const status = await run(ctx, "auth_status");
    expect(status.loggedIn).toBe(false);
    expect(String(status.hint)).toContain("familysearch login");
    expect(fetch.calls).toHaveLength(0);
  });

  test("with a session it reports env, source, user and age, never the token", async () => {
    const { ctx, fetch } = ctxWith();
    const status = await run(ctx, "auth_status");
    expect(status).toMatchObject({ loggedIn: true, env: "production", source: "dia", ageMinutes: 30 });
    expect((status.user as { personId: string }).personId).toBe("AAAA-AAA");
    expect(JSON.stringify(status)).not.toContain(TEST_TOKEN);
    expect(fetch.calls).toHaveLength(0);
  });

  test("verify spends exactly one request on users/current", async () => {
    const { ctx, fetch } = ctxWith({ script: [jsonResponse({ users: [{ id: "cis.user.AAAA-0000" }] })] });
    const status = await run(ctx, "auth_status", { verify: true });
    expect(status.verified).toBe(true);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.url).toEndWith("/platform/users/current");
  });

  test("verify with a rejected token is a status, not a crash", async () => {
    const { ctx } = ctxWith({ script: [response({ status: 401 })] });
    const status = await run(ctx, "auth_status", { verify: true });
    expect(status).toMatchObject({ loggedIn: false, verified: false });
    expect(String(status.error)).toContain("familysearch login");
  });
});

describe("login", () => {
  test("refuses a browser import on beta and explains the shared cookie", async () => {
    const { ctx } = ctxWith({ env: { FAMILYSEARCH_ENV: "beta" } });
    await expect(run(ctx, "login", { from_browser: "dia" })).rejects.toThrow(/cookie/);
  });
});
