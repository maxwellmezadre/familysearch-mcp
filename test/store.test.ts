import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionError } from "../src/core/errors.js";
import {
  createMemorySessionStore,
  createSessionStore,
  type SessionData,
} from "../src/session/store.js";

const root = mkdtempSync(join(tmpdir(), "fs-store-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
function paths(env: "production" | "beta" = "production", configDir = join(root, `case-${++counter}`)) {
  return {
    configDir,
    sessionPath: join(configDir, `session.${env}.enc`),
    keyPath: join(configDir, "session.key"),
    sessionKey: undefined as string | undefined,
  };
}

const TOKEN = "p0-super-secret-session-token";

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    version: 1,
    env: "production",
    token: TOKEN,
    userAgent: "Mozilla/5.0 (Macintosh) Chrome/140",
    user: { id: "cis.user.AAAA-0000", displayName: "Fulano", personId: "AAAA-AAA" },
    source: "dia",
    savedAt: 1_757_000_000_000,
    ...overrides,
  };
}

const mode = (path: string) => statSync(path).mode & 0o777;

describe("createSessionStore", () => {
  test("returns null before the first login", () => {
    expect(createSessionStore(paths()).load()).toBeNull();
  });

  test("round trips the session", () => {
    const store = createSessionStore(paths());
    store.save(session());
    expect(store.load()).toEqual(session());
  });

  test("encrypts at rest: the token never appears in the file", () => {
    const p = paths();
    createSessionStore(p).save(session());
    expect(readFileSync(p.sessionPath).toString("latin1")).not.toContain(TOKEN);
  });

  test("writes the session and the key 0600", () => {
    const p = paths();
    createSessionStore(p).save(session());
    expect(mode(p.sessionPath)).toBe(0o600);
    expect(mode(p.keyPath)).toBe(0o600);
  });

  test("production and beta sessions live in separate files", () => {
    const dir = join(root, `shared-${++counter}`);
    const production = createSessionStore(paths("production", dir));
    const beta = createSessionStore(paths("beta", dir));
    production.save(session());
    expect(beta.load()).toBeNull();
    beta.save(session({ env: "beta", token: "beta-token-value" }));
    expect(production.load()?.token).toBe(TOKEN);
    expect(beta.load()?.token).toBe("beta-token-value");
  });

  test("a different key cannot decrypt the file", () => {
    const p = paths();
    createSessionStore(p).save(session());
    writeFileSync(p.keyPath, `${randomBytes(32).toString("base64")}\n`);
    expect(() => createSessionStore(p).load()).toThrow(SessionError);
  });

  test("a file with no key is a SessionError, not a silent logout", () => {
    const p = paths();
    createSessionStore(p).save(session());
    rmSync(p.keyPath);
    expect(() => createSessionStore(p).load()).toThrow(SessionError);
  });

  test("an unsupported payload is a SessionError", () => {
    const p = paths();
    const store = createSessionStore(p);
    store.save(session());
    // Same key, valid encryption, wrong shape.
    store.save({ ...session(), version: 2 } as unknown as SessionData);
    expect(() => createSessionStore(p).load()).toThrow(SessionError);
  });

  test("clear removes the session but keeps the key", () => {
    const p = paths();
    const store = createSessionStore(p);
    store.save(session());
    store.clear();
    expect(existsSync(p.sessionPath)).toBe(false);
    expect(existsSync(p.keyPath)).toBe(true);
    expect(store.load()).toBeNull();
  });

  test("peekSecrets exposes the token for log redaction", () => {
    const store = createSessionStore(paths());
    expect(store.peekSecrets()).toEqual([]);
    store.save(session());
    expect(store.peekSecrets()).toEqual([TOKEN]);
  });

  test("an env session key wins over the key file", () => {
    const p = { ...paths(), sessionKey: Buffer.alloc(32, 9).toString("base64") };
    createSessionStore(p).save(session());
    expect(existsSync(p.keyPath)).toBe(false);
    expect(createSessionStore(p).load()?.token).toBe(TOKEN);
  });
});

describe("createMemorySessionStore", () => {
  test("same contract in memory", () => {
    const store = createMemorySessionStore();
    expect(store.load()).toBeNull();
    store.save(session());
    expect(store.load()?.token).toBe(TOKEN);
    expect(store.peekSecrets()).toEqual([TOKEN]);
    store.clear();
    expect(store.load()).toBeNull();
  });
});
