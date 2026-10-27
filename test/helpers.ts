import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchInit, FetchLike, FetchResponse } from "../src/core/http.js";
import type { Logger } from "../src/core/logger.js";
import { type SessionData, createMemorySessionStore } from "../src/session/store.js";

// Test doubles for every seam the production code injects. Nothing global is
// patched: the fakes are plain objects typed like the real collaborators.

export type FakeClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Every sleep duration requested, in order — asserts pacing without waiting. */
  slept: number[];
  advance: (ms: number) => void;
};

export function fakeClock(start = 1_757_000_000_000): FakeClock {
  let current = start;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      slept.push(ms);
      current += Math.max(0, ms);
    },
    slept,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

export function silentLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (message: string) => lines.push(`[${level}] ${message}`);
  return {
    lines,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
}

type ResponseInit = { status?: number; headers?: Record<string, string>; body?: string };

export function response(init: ResponseInit = {}): FetchResponse {
  const status = init.status ?? 200;
  const headers = Object.fromEntries(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => init.body ?? "",
  };
}

export const jsonResponse = (payload: unknown, init: ResponseInit = {}): FetchResponse =>
  response({
    ...init,
    headers: { "content-type": "application/x-fs-v1+json", ...init.headers },
    body: JSON.stringify(payload),
  });

export type ScriptedFetch = FetchLike & {
  calls: Array<{ url: string; init: FetchInit }>;
  /** Requests still in flight — proves the queue is serial. */
  inFlight: number;
  maxInFlight: number;
};

/**
 * Replays a script of responses in order. A function entry is called with the
 * request so a test can branch. Running out of entries throws — a test that
 * meant to allow more calls passes an explicit `fallback`.
 */
export function scriptedFetch(
  script: Array<FetchResponse | ((url: string, init: FetchInit) => FetchResponse)>,
  fallback?: FetchResponse | ((url: string, init: FetchInit) => FetchResponse),
): ScriptedFetch {
  const calls: Array<{ url: string; init: FetchInit }> = [];
  let index = 0;
  const fetchImpl = (async (url: string, init: FetchInit) => {
    calls.push({ url, init });
    fetchImpl.inFlight += 1;
    fetchImpl.maxInFlight = Math.max(fetchImpl.maxInFlight, fetchImpl.inFlight);
    try {
      // A microtask turn so overlapping callers would actually overlap.
      await Promise.resolve();
      const entry = script[index++] ?? fallback;
      if (entry === undefined) throw new Error(`scriptedFetch ran out of responses at call ${index}`);
      return typeof entry === "function" ? entry(url, init) : entry;
    } finally {
      fetchImpl.inFlight -= 1;
    }
  }) as ScriptedFetch;
  fetchImpl.calls = calls;
  fetchImpl.inFlight = 0;
  fetchImpl.maxInFlight = 0;
  return fetchImpl;
}

export const TEST_TOKEN = "p0-test-session-token-0001";

export function sessionFixture(overrides: Partial<SessionData> = {}): SessionData {
  return {
    version: 1,
    env: "production",
    token: TEST_TOKEN,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36",
    user: { id: "cis.user.AAAA-0000", displayName: "Fulano", personId: "AAAA-AAA" },
    source: "dia",
    savedAt: 1_757_000_000_000,
    ...overrides,
  };
}

export const memorySession = createMemorySessionStore;

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dir, "fixtures", `${name}.json`), "utf8"));
}
