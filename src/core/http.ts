import type { SessionData, SessionStore } from "../session/store.js";
import { AuthError, HttpError, RateLimitError, WriteUncertainError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { WriteMethod, WriteTicket } from "./ticket.js";

// The single funnel to FamilySearch. It exists to enforce, in ONE place:
//   - strictly serial requests, even from concurrent tool calls;
//   - a minimum gap plus random jitter between requests (human pace: the
//     tree is shared, and volume is what gets an account noticed);
//   - backoff on 429 (honouring Retry-After), 5xx and network failures;
//   - one silent re-import of the browser session on a 401, then a clear
//     AuthError carrying the reason; a token already rejected is never sent
//     again, but every later call tries the re-import first (the user may
//     have logged in on the browser in the meantime);
//   - the token goes to FamilySearch hosts only;
//   - `send` is read-only: any method other than GET/HEAD/OPTIONS is refused.
//     `write` is the only way to POST/DELETE and needs a WriteTicket: the
//     request must match an approved write, is never retried on its own
//     (timeout, network error and 5xx are "may have been applied"), and only
//     a 401 (proof nothing was applied) is retried, after a re-import.
// Redirects are not followed: a 301 is how FamilySearch says "merged into",
// and the caller has to see it. Every temporal collaborator is injectable.

export type FetchResponse = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
export type FetchInit = {
  method: string;
  headers: Record<string, string>;
  redirect: "manual";
  body?: string;
  signal?: AbortSignal;
};
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export type HttpDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export type ReadMethod = "GET" | "HEAD" | "OPTIONS";

export type HttpRequest = {
  method: ReadMethod;
  /** `/platform/...`, or an absolute link from a FamilySearch response (see {@link toPath}). */
  path: string;
  query?: Record<string, string | number | undefined>;
  accept?: string;
  /** Short label for logs and error messages. */
  label: string;
};

export type WriteRequest = {
  method: WriteMethod;
  path: string;
  /** Must equal the approved write's query when given; the approved one is what is sent. */
  query?: Record<string, string | number | undefined>;
  /** The resolved body (a plan's body function has already run). */
  body?: unknown;
  accept?: string;
  /** Sent as X-Reason. */
  reason: string;
  label: string;
};

export type HttpResponse = {
  status: number;
  headers: { get(name: string): string | null };
  body: string;
};

export type HttpState = { requests: number; authDead: boolean; reauths: number };

export type Http = {
  send(request: HttpRequest): Promise<HttpResponse>;
  write(request: WriteRequest, ticket: WriteTicket): Promise<HttpResponse>;
  state(): HttpState;
  /** Forget a rejected token, e.g. after an in-process login. */
  resetSession(): void;
};

export type HttpOptions = {
  session: SessionStore;
  baseUrl: string;
  minIntervalMs: number;
  /** Minimum gap before a write; the larger of this and minIntervalMs applies. */
  writeIntervalMs: number;
  jitterMs: number;
  timeoutMs: number;
  log: Logger;
  /** Re-imports the session from the browser: null when a new session was saved, else why it failed. */
  reauth?: () => Promise<string | null>;
};

export const DEFAULT_ACCEPT = "application/x-fs-v1+json";
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
export const MAX_ATTEMPTS = 4;

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const realFetch: FetchLike = (url, init) =>
  globalThis.fetch(url, init as RequestInit) as unknown as Promise<FetchResponse>;

export const backoffMs = (attempt: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);

const isFamilySearchHost = (host: string): boolean =>
  host === "familysearch.org" || host.endsWith(".familysearch.org");

/**
 * Turns a link from a FamilySearch response into a path on the configured
 * host. Responses carry links on `api.familysearch.org` or `familysearch.org`;
 * the session is only valid on the configured one, so the origin is dropped.
 * Anything that is not https on a FamilySearch host is refused: the token must
 * never leave.
 */
export function toPath(href: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new Error(`Recusando o link "${href}": não é uma URL válida.`);
  }
  if (url.protocol !== "https:" || !isFamilySearchHost(url.hostname.toLowerCase())) {
    throw new Error(
      `Recusando enviar a sessão para ${url.protocol}//${url.host}: só hosts https do FamilySearch.`,
    );
  }
  return url.pathname + url.search;
}

export function createHttp(opts: HttpOptions, deps: HttpDeps = {}): Http {
  const fetchImpl = deps.fetch ?? realFetch;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const { session, log } = opts;

  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let requests = 0;
  let reauths = 0;
  /** The token FamilySearch last rejected; never sent again. */
  let deadToken: string | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /** Why the last re-import failed; goes into the AuthError so the model sees it, not just stderr. */
  let reauthFailure: string | null = null;

  const authError = (): AuthError =>
    new AuthError(
      `A sessão do FamilySearch expirou ou foi rejeitada.${
        reauthFailure ? ` A reimportação do navegador falhou: ${reauthFailure}` : ""
      }`,
    );

  /** Re-read on every request: a `familysearch login` in another process is picked up at once. */
  function loadSession(): SessionData {
    const data = session.load();
    if (data === null) throw new AuthError("Nenhuma sessão do FamilySearch salva.");
    return data;
  }

  /** One re-import attempt; true when it produced a token that was not already rejected. */
  async function reimport(label: string): Promise<boolean> {
    if (!opts.reauth) return false;
    reauths += 1;
    log.info(`${label}: sessão rejeitada, reimportando do navegador`);
    reauthFailure = await opts.reauth().catch((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    );
    return reauthFailure === null && loadSession().token !== deadToken;
  }

  async function gap(minIntervalMs = opts.minIntervalMs): Promise<void> {
    const wait = lastRequestAt + minIntervalMs + random() * opts.jitterMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
  }

  const origin = new URL(opts.baseUrl).origin;

  function buildUrl(request: Pick<HttpRequest, "path" | "query">): string {
    const url = new URL(toPath(request.path), opts.baseUrl);
    // The last word on where the token goes: URL parsing turns paths like
    // "/\\host" into another host, so the resolved origin is checked, not the string.
    if (url.origin !== origin) {
      throw new Error(`Recusando enviar a sessão para ${url.origin}: só ${origin}.`);
    }
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.append(key, String(value));
    }
    return url.toString();
  }

  /** The session to use now; a token already rejected is replaced by a re-import first. */
  async function freshSession(label: string): Promise<{ current: SessionData; reauthed: boolean }> {
    const current = loadSession();
    if (current.token !== deadToken) return { current, reauthed: false };
    if (!(await reimport(label))) throw authError();
    return { current: loadSession(), reauthed: true };
  }

  async function sendOnce(request: HttpRequest): Promise<HttpResponse> {
    if (!READ_METHODS.has(request.method)) {
      throw new Error(
        `Método ${request.method} recusado: neste ponto o familysearch-mcp só lê a árvore. Escritas passam pela trava de aprovação.`,
      );
    }
    let { current, reauthed } = await freshSession(request.label);
    const url = buildUrl(request);
    const started = now();

    for (let attempt = 1; ; attempt += 1) {
      await gap();
      let response: FetchResponse;
      try {
        response = await fetchImpl(url, {
          method: request.method,
          headers: {
            authorization: `Bearer ${current.token}`,
            "user-agent": current.userAgent,
            accept: request.accept ?? DEFAULT_ACCEPT,
          },
          redirect: "manual",
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (error) {
        requests += 1;
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt < MAX_ATTEMPTS) {
          log.warn(`${request.label} network error on attempt ${attempt}: ${reason}`);
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new HttpError(0, `Falha de rede ao chamar o FamilySearch em ${request.label}: ${reason}`);
      }
      requests += 1;
      const { status } = response;

      if (status === 401) {
        deadToken = current.token;
        if (!reauthed) {
          reauthed = true;
          if (await reimport(request.label)) {
            current = loadSession();
            attempt -= 1; // the retry with the new token is not a backoff attempt
            continue;
          }
        }
        throw authError();
      }

      if (status === 429 || status >= 500) {
        if (attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const wait = Math.max(
            Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
            backoffMs(attempt),
          );
          log.warn(`${request.label} HTTP ${status} on attempt ${attempt}; waiting ${wait}ms`);
          await sleep(wait);
          continue;
        }
        if (status === 429) {
          throw new RateLimitError(
            attempt,
            `O FamilySearch pediu para diminuir o ritmo (HTTP 429) em ${request.label}, mesmo depois de ${attempt} tentativas. Espere alguns minutos.`,
          );
        }
        throw new HttpError(
          status,
          `O FamilySearch respondeu HTTP ${status} em ${request.label} após ${attempt} tentativas.`,
        );
      }

      const body = await response.text();
      log.debug(`${request.label} ${status} ${now() - started}ms`);
      return { status, headers: response.headers, body };
    }
  }

  const sameQuery = (a: WriteRequest["query"], b: WriteRequest["query"]): boolean => {
    const norm = (q: WriteRequest["query"]) =>
      JSON.stringify(
        Object.entries(q ?? {})
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
          .sort(([x], [y]) => (x as string).localeCompare(y as string)),
      );
    return norm(a) === norm(b);
  };

  async function writeOnce(request: WriteRequest, ticket: WriteTicket): Promise<HttpResponse> {
    // Before anything else: no cover, no request. The entry is consumed once;
    // the 401 retry below reuses this same resolved request.
    const approved = ticket.take(request.method, request.path);
    if (request.query !== undefined && !sameQuery(request.query, approved.query)) {
      throw new Error(
        `Escrita não aprovada: ${request.method} ${request.label} usa parâmetros diferentes dos que o usuário aprovou.`,
      );
    }
    let { current, reauthed } = await freshSession(request.label);
    const url = buildUrl({ path: request.path, ...(approved.query ? { query: approved.query } : {}) });
    const hasBody = request.body !== undefined;
    const started = now();

    for (;;) {
      await gap(Math.max(opts.minIntervalMs, opts.writeIntervalMs));
      let response: FetchResponse;
      try {
        response = await fetchImpl(url, {
          method: request.method,
          headers: {
            authorization: `Bearer ${current.token}`,
            "user-agent": current.userAgent,
            accept: request.accept ?? DEFAULT_ACCEPT,
            "x-reason": request.reason,
            ...(hasBody ? { "content-type": DEFAULT_ACCEPT } : {}),
          },
          redirect: "manual",
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (error) {
        requests += 1;
        throw new WriteUncertainError(request.label, error instanceof Error ? error.message : String(error));
      }
      requests += 1;
      const { status } = response;

      if (status === 401) {
        deadToken = current.token;
        if (!reauthed) {
          reauthed = true;
          if (await reimport(request.label)) {
            current = loadSession();
            continue; // a 401 proves nothing was applied, so this is the one safe retry
          }
        }
        throw authError();
      }
      if (status === 429) {
        throw new RateLimitError(
          1,
          `O FamilySearch pediu para diminuir o ritmo (HTTP 429) em ${request.label}. Nada foi aplicado; espere e tente de novo.`,
        );
      }
      if (status >= 500) throw new WriteUncertainError(request.label, `HTTP ${status}`);

      const body = await response.text();
      log.debug(`${request.label} ${status} ${now() - started}ms`);
      return { status, headers: response.headers, body };
    }
  }

  return {
    write: (request, ticket) => serial(() => writeOnce(request, ticket)),
    send: (request) => serial(() => sendOnce(request)),
    state: () => ({ requests, authDead: deadToken !== null, reauths }),
    resetSession: () => {
      deadToken = null;
    },
  };
}
