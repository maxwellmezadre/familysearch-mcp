import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { createCipheriv } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_URLS, type FsEnv } from "../src/config.js";
import { LoginError } from "../src/core/errors.js";
import {
  cookieDbPath,
  deriveKey,
  importFromBrowser,
  keychainService,
  readBrowserToken,
} from "../src/session/browser-import.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { silentLogger } from "./helpers.js";

const root = mkdtempSync(join(tmpdir(), "fs-import-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PASSWORD = "keychain-password";
const TOKEN = "p0-token-from-dia-browser";

function encryptValue(value: string): Buffer {
  const cipher = createCipheriv("aes-128-cbc", deriveKey(PASSWORD), Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), cipher.update(value), cipher.final()]);
}

let counter = 0;
/** A Chromium cookie database with the columns the importer reads. */
function cookieDb(rows: Array<{ host: string; name: string; value: string }>): string {
  const dir = join(root, `db-${++counter}`);
  rmSync(dir, { recursive: true, force: true });
  const path = join(dir, "Cookies");
  mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.run(
    "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)",
  );
  for (const row of rows) {
    db.run("INSERT INTO cookies VALUES (?, ?, '', ?, '/', 0, 1, 1, 0)", [
      row.host,
      row.name,
      encryptValue(row.value),
    ]);
  }
  db.close();
  const versionFile = join(dir, "Last Version");
  writeFileSync(versionFile, "140.0.7339.80");
  return path;
}

const deps = (dbPath: string) => ({
  platform: "darwin",
  readKeychainPassword: async () => PASSWORD,
  dbPath,
  lastVersionPath: join(dbPath, "..", "Last Version"),
});

/** probeUser stand-in: answers a user only for the environment that owns the token. */
const probeFor = (owner: FsEnv | null) => async (baseUrl: string) =>
  owner && baseUrl === BASE_URLS[owner]
    ? { id: "cis.user.AAAA-0000", displayName: "Fulano", personId: "AAAA-AAA" }
    : null;

function ctxFor(env: FsEnv) {
  return {
    config: { env, baseUrl: BASE_URLS[env] },
    session: createMemorySessionStore(),
    now: () => 1_757_000_000_000,
    log: silentLogger(),
  };
}

describe("browser locations", () => {
  test("dia lives under Dia/User Data with its own Keychain entry", () => {
    expect(cookieDbPath("dia", "/h")).toBe(
      "/h/Library/Application Support/Dia/User Data/Default/Cookies",
    );
    expect(keychainService("dia")).toBe("Dia Safe Storage");
  });
});

describe("readBrowserToken", () => {
  test("picks fssessionid among the familysearch.org cookies", async () => {
    const db = cookieDb([
      { host: ".familysearch.org", name: "reese84", value: "bot-protection" },
      { host: ".familysearch.org", name: "fssessionid", value: TOKEN },
      { host: ".example.com", name: "fssessionid", value: "not-this-one" },
    ]);
    const result = await readBrowserToken("dia", deps(db));
    expect(result.token).toBe(TOKEN);
    expect(result.userAgent).toContain("Chrome/140.0.0.0");
  });

  test("no fssessionid means the browser is not logged in", async () => {
    const db = cookieDb([{ host: ".familysearch.org", name: "reese84", value: "x" }]);
    await expect(readBrowserToken("dia", deps(db))).rejects.toThrow(/Dia.*familysearch\.org/);
  });

  test("outside macOS it explains the limitation", async () => {
    const db = cookieDb([]);
    await expect(readBrowserToken("dia", { ...deps(db), platform: "linux" })).rejects.toThrow(
      LoginError,
    );
  });
});

describe("importFromBrowser", () => {
  test("saves the session with environment, user and source", async () => {
    const ctx = ctxFor("production");
    const db = cookieDb([{ host: ".familysearch.org", name: "fssessionid", value: TOKEN }]);
    const result = await importFromBrowser(ctx, { browser: "dia" }, {
      ...deps(db),
      probeUser: probeFor("production"),
    });
    expect(result.env).toBe("production");
    expect(result.source).toBe("dia");
    expect(result.user.personId).toBe("AAAA-AAA");
    expect(ctx.session.data?.token).toBe(TOKEN);
    expect(ctx.session.data?.env).toBe("production");
    expect(ctx.session.data?.source).toBe("dia");
  });

  test("a token that only works on beta is refused, naming beta", async () => {
    const ctx = ctxFor("production");
    const db = cookieDb([{ host: ".familysearch.org", name: "fssessionid", value: TOKEN }]);
    await expect(
      importFromBrowser(ctx, { browser: "dia" }, { ...deps(db), probeUser: probeFor("beta") }),
    ).rejects.toThrow(/logado no beta/);
    expect(ctx.session.data).toBeNull();
  });

  test("a token rejected everywhere tells the user to log in again", async () => {
    const ctx = ctxFor("production");
    const db = cookieDb([{ host: ".familysearch.org", name: "fssessionid", value: TOKEN }]);
    await expect(
      importFromBrowser(ctx, { browser: "dia" }, { ...deps(db), probeUser: probeFor(null) }),
    ).rejects.toThrow(/expirou|entre de novo/i);
  });
});
