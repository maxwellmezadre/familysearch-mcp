import { mkdirSync, rmSync } from "node:fs";
import type { BrowserChannel, Config } from "../config.js";
import { LoginError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { type FsUser, probeUser as realProbeUser } from "../familysearch/user.js";
import type { LoginResult } from "./browser-import.js";
import type { SessionStore } from "./store.js";

// Interactive login in a dedicated Chrome profile, one per environment. It is
// the only way into beta (the everyday browser holds the production cookie;
// FamilySearch has one `fssessionid` for both) and the fallback for
// production. The user types the password in a real window; this code never
// sees a credential and keeps only the resulting token.
//
// "Logged in" is decided by ASKING THE API (`users/current` with the cookie as
// a bearer token), not by matching a URL or a selector: a cookie can exist
// before the login finishes, and only the API knows when it is real.

export type PageLike = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
  url(): string;
};
export type BrowserContextLike = {
  newPage(): Promise<PageLike>;
  cookies(): Promise<Array<{ name: string; value: string; domain: string }>>;
  close(): Promise<void>;
};
export type PlaywrightLike = {
  chromium: {
    launchPersistentContext(
      profileDir: string,
      options: Record<string, unknown>,
    ): Promise<BrowserContextLike>;
  };
};

export type LoginDeps = {
  importPlaywright?: () => Promise<PlaywrightLike>;
  sleep?: (ms: number) => Promise<void>;
  probeUser?: (baseUrl: string, token: string, userAgent: string) => Promise<FsUser | null>;
};

export type LoginCtx = {
  config: Pick<Config, "env" | "baseUrl" | "browserProfileDir" | "browserChannel">;
  session: SessionStore;
  now: () => number;
  log: Logger;
};

export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 2_000;
const REPORT_EVERY_MS = 30_000;

export const PLAYWRIGHT_HINT =
  "O `login` abre o Google Chrome pelo playwright-core. Instale o Google Chrome, ou rode " +
  "`bunx playwright install chromium` e use FAMILYSEARCH_BROWSER_CHANNEL=chromium. Na produção, " +
  "`familysearch login --from-browser dia` importa a sessão do Dia sem abrir janela nenhuma.";

export function launchOptions(channel: BrowserChannel): Record<string, unknown> {
  return {
    channel,
    headless: false,
    locale: "pt-BR",
    viewport: null,
    // Chrome reports navigator.webdriver=true unless this is set, and the
    // anti-bot layer in front of FamilySearch reads it.
    args: ["--disable-blink-features=AutomationControlled"],
    // Drops the "controlled by automated software" banner from the window.
    ignoreDefaultArgs: ["--enable-automation"],
  };
}

async function loadPlaywright(deps: LoginDeps): Promise<PlaywrightLike> {
  if (deps.importPlaywright) return deps.importPlaywright();
  try {
    // Dynamic: the MCP path must never load playwright-core.
    return (await import("playwright-core")) as unknown as PlaywrightLike;
  } catch (error) {
    throw new LoginError(
      `Não consegui carregar o playwright-core. ${PLAYWRIGHT_HINT}\nDetalhe: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function browserLogin(
  ctx: LoginCtx,
  options: { timeoutMs?: number; fresh?: boolean; report?: (message: string) => void } = {},
  deps: LoginDeps = {},
): Promise<LoginResult> {
  const { config } = ctx;
  const report = options.report ?? ((message: string) => ctx.log.info(message));
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const sleep = deps.sleep ?? realSleep;
  const probe = deps.probeUser ?? ((base, token, ua) => realProbeUser(base, token, ua));

  if (options.fresh) rmSync(config.browserProfileDir, { recursive: true, force: true });
  mkdirSync(config.browserProfileDir, { recursive: true, mode: 0o700 });

  const playwright = await loadPlaywright(deps);
  let context: BrowserContextLike;
  try {
    context = await playwright.chromium.launchPersistentContext(
      config.browserProfileDir,
      launchOptions(config.browserChannel),
    );
  } catch (error) {
    throw new LoginError(
      `Não consegui abrir o navegador (canal: ${config.browserChannel}). ${PLAYWRIGHT_HINT}\nDetalhe: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const page = await context.newPage();
    // The tree requires a login, so the site sends the user straight to the sign-in form.
    await page.goto(`${config.baseUrl}/pt/tree/`);
    report(`Faça login no FamilySearch (${config.env}) na janela do navegador. Aguardando…`);
    const userAgent = String(await page.evaluate("navigator.userAgent"));

    const startedAt = ctx.now();
    const deadline = startedAt + timeoutMs;
    let lastReport = startedAt;
    for (;;) {
      const token = (await context.cookies()).find(
        (cookie) => cookie.name === "fssessionid" && /(^|\.)familysearch\.org$/.test(cookie.domain),
      )?.value;
      const user = token ? await probe(config.baseUrl, token, userAgent).catch(() => null) : null;
      if (token && user) {
        const savedAt = ctx.now();
        ctx.session.save({ version: 1, env: config.env, token, userAgent, user, source: "login", savedAt });
        report(`Login concluído: ${user.displayName} (${config.env}).`);
        return { env: config.env, user, source: "login", savedAt: new Date(savedAt).toISOString() };
      }
      if (ctx.now() >= deadline) {
        throw new LoginError(
          `Login não concluído em ${Math.round(timeoutMs / 60_000)} minuto(s). Rode \`familysearch login\` de novo.`,
        );
      }
      if (ctx.now() - lastReport >= REPORT_EVERY_MS) {
        report(`Ainda aguardando o login… (${Math.round((ctx.now() - startedAt) / 1000)} s)`);
        lastReport = ctx.now();
      }
      await sleep(POLL_MS);
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}
