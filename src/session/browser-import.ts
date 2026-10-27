import { Database } from "bun:sqlite";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_URLS, type Config, type FsEnv, type ImportBrowser } from "../config.js";
import { LoginError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { type FsUser, probeUser as realProbeUser } from "../familysearch/user.js";
import type { SessionData, SessionStore } from "./store.js";

// The normal way in: reuse the FamilySearch session of a Chromium-based browser
// the user is ALREADY logged in with (Dia, Arc, Chrome, …). Chromium on macOS
// encrypts cookie values with AES-128-CBC using a key derived from a
// per-browser password kept in the Keychain ("<Browser> Safe Storage"); the
// user grants access once through the macOS dialog. Only the `fssessionid`
// value is kept, encrypted like any other session.
//
// Caveat: production and beta share ONE `fssessionid` on `.familysearch.org`,
// so a browser is logged into one environment at a time. The token is probed
// against the configured environment, and the other one only to explain a
// mismatch.

const LOCATIONS: Record<ImportBrowser, { label: string; dir: string; service: string }> = {
  dia: { label: "Dia", dir: "Dia/User Data", service: "Dia Safe Storage" },
  arc: { label: "Arc", dir: "Arc/User Data", service: "Arc Safe Storage" },
  chrome: { label: "Google Chrome", dir: "Google/Chrome", service: "Chrome Safe Storage" },
  chromium: { label: "Chromium", dir: "Chromium", service: "Chromium Safe Storage" },
  brave: { label: "Brave", dir: "BraveSoftware/Brave-Browser", service: "Brave Safe Storage" },
  edge: { label: "Microsoft Edge", dir: "Microsoft Edge", service: "Microsoft Edge Safe Storage" },
};

const APP_SUPPORT = "Library/Application Support";
const COOKIE_HOST = "familysearch.org";
const TOKEN_COOKIE = "fssessionid";
/** Used only when the browser's "Last Version" file is missing. */
const FALLBACK_CHROMIUM_VERSION = "140.0.0.0";

export const browserLabel = (browser: ImportBrowser): string => LOCATIONS[browser].label;
export const keychainService = (browser: ImportBrowser): string => LOCATIONS[browser].service;
export const cookieDbPath = (browser: ImportBrowser, home = homedir()): string =>
  join(home, APP_SUPPORT, LOCATIONS[browser].dir, "Default", "Cookies");
export const lastVersionPath = (browser: ImportBrowser, home = homedir()): string =>
  join(home, APP_SUPPORT, LOCATIONS[browser].dir, "Last Version");

/** Chromium/macOS: PBKDF2-SHA1(password, "saltysalt", 1003 iterations, 16 bytes). */
export function deriveKey(password: string): Buffer {
  return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

/**
 * "v10" + AES-128-CBC with a 16-space IV. Cookie DB v24+ prepends
 * SHA256(host_key) to the plaintext; it is stripped only when it matches.
 */
export function decryptCookieValue(encrypted: Buffer, key: Buffer, hostKey: string): string {
  const version = encrypted.subarray(0, 3).toString("latin1");
  if (version !== "v10") {
    throw new LoginError(
      `Formato de cookie desconhecido ("${version}"): só o formato v10 do Chromium no macOS é suportado.`,
    );
  }
  let plain: Buffer;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  } catch {
    throw new LoginError(
      "Não foi possível decifrar os cookies do navegador: a chave lida do Keychain não confere.",
    );
  }
  if (
    plain.length >= 32 &&
    plain.subarray(0, 32).equals(createHash("sha256").update(hostKey).digest())
  ) {
    plain = plain.subarray(32);
  }
  return plain.toString("utf8");
}

/** Chrome ≥ 101 sends a reduced UA: only the major version is real. */
export function userAgentFor(chromiumVersion: string): string {
  const major = chromiumVersion.split(".")[0] || FALLBACK_CHROMIUM_VERSION.split(".")[0];
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

const inFamilySearch = (hostKey: string): boolean => {
  const host = hostKey.replace(/^\./, "").toLowerCase();
  return host === COOKIE_HOST || host.endsWith(`.${COOKIE_HOST}`);
};

/** Reads `fssessionid` from a copy of the browser's cookie database (the browser keeps it locked). */
function readTokenCookie(dbPath: string, key: Buffer): string | null {
  if (!existsSync(dbPath)) {
    throw new LoginError(
      `Banco de cookies não encontrado em ${dbPath}. O navegador está instalado e já foi aberto alguma vez?`,
    );
  }
  const scratch = mkdtempSync(join(tmpdir(), "familysearch-cookies-"));
  try {
    const copy = join(scratch, "Cookies");
    copyFileSync(dbPath, copy);
    for (const suffix of ["-wal", "-journal"]) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, copy + suffix);
    }
    const db = new Database(copy, { readonly: true });
    try {
      const rows = db
        .query("SELECT host_key, value, encrypted_value FROM cookies WHERE name = ? AND host_key LIKE ?")
        .all(TOKEN_COOKIE, `%${COOKIE_HOST}`) as Array<{
        host_key: string;
        value: string;
        encrypted_value: Uint8Array | null;
      }>;
      const row = rows.find((candidate) => inFamilySearch(candidate.host_key));
      if (!row) return null;
      return row.encrypted_value && row.encrypted_value.length > 0
        ? decryptCookieValue(Buffer.from(row.encrypted_value), key, row.host_key)
        : row.value;
    } finally {
      db.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `security` pops the macOS dialog the first time; the user clicks "Permitir". */
export async function readKeychainPassword(service: string): Promise<string> {
  const proc = Bun.spawn(["security", "find-generic-password", "-w", "-s", service], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0 || out.trim() === "") {
    throw new LoginError(
      `Não consegui ler a chave "${service}" do Keychain. Clique em "Permitir" na janela do macOS e tente de novo.\nDetalhe: ${err.trim() || `exit ${code}`}`,
    );
  }
  return out.trim();
}

export type ImportDeps = {
  platform?: string;
  readKeychainPassword?: (service: string) => Promise<string>;
  dbPath?: string;
  lastVersionPath?: string;
  probeUser?: (baseUrl: string, token: string, userAgent: string) => Promise<FsUser | null>;
};

export async function readBrowserToken(
  browser: ImportBrowser,
  deps: ImportDeps = {},
): Promise<{ token: string; userAgent: string }> {
  const label = browserLabel(browser);
  if ((deps.platform ?? process.platform) !== "darwin") {
    throw new LoginError(
      "Importar a sessão do navegador só funciona no macOS (a chave fica no Keychain). Use `familysearch login`, que abre o Chrome.",
    );
  }
  const password = await (deps.readKeychainPassword ?? readKeychainPassword)(
    keychainService(browser),
  );
  const token = readTokenCookie(deps.dbPath ?? cookieDbPath(browser), deriveKey(password));
  if (!token) {
    throw new LoginError(
      `O ${label} não está logado no FamilySearch (não há cookie ${TOKEN_COOKIE} de familysearch.org). Entre em https://www.familysearch.org no ${label} e tente de novo.`,
    );
  }
  const versionFile = deps.lastVersionPath ?? lastVersionPath(browser);
  const chromiumVersion = existsSync(versionFile)
    ? readFileSync(versionFile, "utf8").trim()
    : FALLBACK_CHROMIUM_VERSION;
  return { token, userAgent: userAgentFor(chromiumVersion) };
}

export type LoginResult = {
  env: FsEnv;
  user: FsUser;
  source: SessionData["source"];
  savedAt: string;
};

/** The slice of the context the import needs; the full `Ctx` satisfies it. */
export type ImportCtx = {
  config: Pick<Config, "env" | "baseUrl">;
  session: SessionStore;
  now: () => number;
  log: Logger;
};

export async function importFromBrowser(
  ctx: ImportCtx,
  opts: { browser: ImportBrowser; report?: (message: string) => void },
  deps: ImportDeps = {},
): Promise<LoginResult> {
  const report = opts.report ?? ((message: string) => ctx.log.info(message));
  const label = browserLabel(opts.browser);
  report(`Lendo a sessão do FamilySearch no ${label} (o macOS pode pedir acesso ao Keychain)…`);
  const { token, userAgent } = await readBrowserToken(opts.browser, deps);

  const probe = deps.probeUser ?? ((base, value, ua) => realProbeUser(base, value, ua));
  const user = await probe(ctx.config.baseUrl, token, userAgent);
  if (!user) {
    const other: FsEnv = ctx.config.env === "production" ? "beta" : "production";
    const otherUser = await probe(BASE_URLS[other], token, userAgent);
    throw new LoginError(
      otherUser
        ? `O ${label} está logado no ${other}, não no ${ctx.config.env}. O FamilySearch usa um cookie só para os dois. Entre em ${ctx.config.baseUrl} no ${label}, ou use FAMILYSEARCH_ENV=${other}.`
        : `A sessão do FamilySearch no ${label} expirou. Entre de novo em ${ctx.config.baseUrl} no ${label} e tente outra vez.`,
    );
  }

  const savedAt = ctx.now();
  ctx.session.save({
    version: 1,
    env: ctx.config.env,
    token,
    userAgent,
    user,
    source: opts.browser,
    savedAt,
  });
  report(`Sessão importada do ${label}: ${user.displayName} (${ctx.config.env}).`);
  return { env: ctx.config.env, user, source: opts.browser, savedAt: new Date(savedAt).toISOString() };
}
