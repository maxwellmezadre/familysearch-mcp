import type { Approver } from "./approval/gate.js";
import { type Config, loadConfig } from "./config.js";
import { type FetchLike, type Http, createHttp } from "./core/http.js";
import { type Logger, createLogger } from "./core/logger.js";
import { importFromBrowser } from "./session/browser-import.js";
import { type SessionStore, createSessionStore } from "./session/store.js";

// Explicit DI container. Everything a tool needs hangs off `Ctx`, and every
// temporal/IO collaborator can be replaced in tests. No singletons, no
// framework: `createContext(loadConfig())` is the whole wiring.

export type ContextDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  session?: SessionStore;
  log?: Logger;
  /** Overrides the browser re-import used on a 401 (null = re-imported, string = why not). */
  reauth?: () => Promise<string | null>;
  /** Asks the user to approve a write plan; absent = no write is ever made. */
  approver?: Approver;
};

export type Ctx = {
  config: Config;
  log: Logger;
  now: () => number;
  session: SessionStore;
  http: Http;
  /** Mutable: the entry points (MCP server, CLI) fill it once they know how to ask. */
  approver: Approver | null;
  /** Closes what was opened. Safe to call more than once. */
  dispose: () => void;
};

export function createContext(config: Config, deps: ContextDeps = {}): Ctx {
  const now = deps.now ?? (() => Date.now());
  const session = deps.session ?? createSessionStore(config);
  // The logger reads the token through a provider, so redaction keeps working
  // after a re-import replaces it mid-session.
  const log =
    deps.log ??
    createLogger({
      ...(config.logFile ? { logFile: config.logFile } : {}),
      secrets: () => session.peekSecrets(),
    });

  // Silent re-import only in production: the browser cookie is shared by both
  // environments and the design keeps the browser on production.
  const browser = config.importBrowser;
  const reauth =
    deps.reauth ??
    (config.env === "production" && browser
      ? async () => {
          try {
            await importFromBrowser(ctx, { browser, report: (message) => log.debug(message) });
            return null;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        }
      : undefined);

  const http = createHttp(
    {
      session,
      baseUrl: config.baseUrl,
      minIntervalMs: config.minIntervalMs,
      writeIntervalMs: config.writeIntervalMs,
      jitterMs: config.jitterMs,
      timeoutMs: config.httpTimeoutMs,
      log,
      ...(reauth ? { reauth } : {}),
    },
    {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.random ? { random: deps.random } : {}),
      now,
    },
  );

  const ctx: Ctx = { config, log, now, session, http, approver: deps.approver ?? null, dispose: () => undefined };
  return ctx;
}

/** Convenience for the entry points: load the env config and wire everything. */
export const contextFromEnv = (): Ctx => createContext(loadConfig());
