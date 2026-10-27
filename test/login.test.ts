import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FsEnv, loadConfig } from "../src/config.js";
import { LoginError } from "../src/core/errors.js";
import {
  type BrowserContextLike,
  type PageLike,
  browserLogin,
  launchOptions,
} from "../src/session/login.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { fakeClock, silentLogger } from "./helpers.js";

// No browser is launched: the Playwright slice we depend on is injected.

const root = mkdtempSync(join(tmpdir(), "fs-login-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const USER = { id: "cis.user.AAAA-0000", displayName: "Fulano", personId: "AAAA-AAA" };

function fakePlaywright(opts: { tokenAfterPolls?: number; failLaunch?: boolean } = {}) {
  let polls = 0;
  const visited: string[] = [];
  const launches: Array<{ dir: string; options: Record<string, unknown> }> = [];
  let closed = false;
  const page: PageLike = {
    goto: async (url) => {
      visited.push(url);
      return null;
    },
    evaluate: async (script) => (script === "navigator.userAgent" ? "Mozilla/5.0 Chrome/141.0.0.0" : null),
    url: () => visited.at(-1) ?? "",
  };
  const context: BrowserContextLike = {
    newPage: async () => page,
    cookies: async () => {
      polls += 1;
      const cookies = [{ name: "reese84", value: "x", domain: ".familysearch.org" }];
      if (polls > (opts.tokenAfterPolls ?? 0)) {
        cookies.push({ name: "fssessionid", value: "p0-token-from-login", domain: ".familysearch.org" });
      }
      return cookies;
    },
    close: async () => {
      closed = true;
    },
  };
  return {
    playwright: {
      chromium: {
        launchPersistentContext: async (dir: string, options: Record<string, unknown>) => {
          launches.push({ dir, options });
          if (opts.failLaunch) throw new Error("Executable doesn't exist");
          return context;
        },
      },
    },
    visited,
    launches,
    isClosed: () => closed,
  };
}

let counter = 0;
function ctxFor(env: FsEnv = "production") {
  const clock = fakeClock();
  const config = loadConfig({ FAMILYSEARCH_CONFIG_DIR: join(root, `case-${++counter}`), FAMILYSEARCH_ENV: env });
  return {
    clock,
    ctx: { config, session: createMemorySessionStore(), now: clock.now, log: silentLogger() },
  };
}

describe("browserLogin", () => {
  test("opens the configured environment in its own profile and saves the session", async () => {
    const { ctx, clock } = ctxFor("beta");
    const fake = fakePlaywright({ tokenAfterPolls: 2 });
    const result = await browserLogin(ctx, {}, {
      importPlaywright: async () => fake.playwright,
      sleep: clock.sleep,
      probeUser: async (baseUrl) => (baseUrl === "https://beta.familysearch.org" ? USER : null),
    });
    expect(fake.launches[0]!.dir).toBe(ctx.config.browserProfileDir);
    expect(fake.launches[0]!.dir.endsWith("browser-profile-beta")).toBe(true);
    expect(fake.launches[0]!.options.channel).toBe("chrome");
    expect(fake.visited[0]!.startsWith("https://beta.familysearch.org/pt/")).toBe(true);
    expect(result).toMatchObject({ env: "beta", source: "login", user: USER });
    expect(ctx.session.data).toMatchObject({
      env: "beta",
      token: "p0-token-from-login",
      source: "login",
      userAgent: "Mozilla/5.0 Chrome/141.0.0.0",
    });
    expect(fake.isClosed()).toBe(true);
  });

  test("a cookie the API still rejects is not a login: keeps waiting", async () => {
    const { ctx, clock } = ctxFor();
    const fake = fakePlaywright();
    let probes = 0;
    await browserLogin(ctx, {}, {
      importPlaywright: async () => fake.playwright,
      sleep: clock.sleep,
      probeUser: async () => (++probes >= 3 ? USER : null),
    });
    expect(probes).toBe(3);
  });

  test("fresh wipes only the current environment's profile", async () => {
    const { ctx, clock } = ctxFor("production");
    const other = join(ctx.config.configDir, "browser-profile-beta");
    mkdirSync(ctx.config.browserProfileDir, { recursive: true });
    mkdirSync(other, { recursive: true });
    writeFileSync(join(ctx.config.browserProfileDir, "marker"), "x");
    await browserLogin(ctx, { fresh: true }, {
      importPlaywright: async () => fakePlaywright().playwright,
      sleep: clock.sleep,
      probeUser: async () => USER,
    });
    expect(existsSync(join(ctx.config.browserProfileDir, "marker"))).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  test("times out with a LoginError and closes the browser", async () => {
    const { ctx, clock } = ctxFor();
    const fake = fakePlaywright({ tokenAfterPolls: 10_000 });
    await expect(
      browserLogin(ctx, { timeoutMs: 10_000 }, {
        importPlaywright: async () => fake.playwright,
        sleep: clock.sleep,
        probeUser: async () => USER,
      }),
    ).rejects.toThrow(LoginError);
    expect(fake.isClosed()).toBe(true);
    expect(ctx.session.data).toBeNull();
  });

  test("a browser that cannot start points to the Dia import", async () => {
    const { ctx, clock } = ctxFor();
    await expect(
      browserLogin(ctx, {}, {
        importPlaywright: async () => fakePlaywright({ failLaunch: true }).playwright,
        sleep: clock.sleep,
        probeUser: async () => USER,
      }),
    ).rejects.toThrow(/--from-browser dia/);
  });
});

describe("launchOptions", () => {
  test("hides the automation flags anti-bot scripts read", () => {
    const options = launchOptions("chrome");
    expect(options.headless).toBe(false);
    expect(options.ignoreDefaultArgs).toEqual(["--enable-automation"]);
    expect(options.args).toEqual(["--disable-blink-features=AutomationControlled"]);
  });
});
