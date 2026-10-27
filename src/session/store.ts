import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  type Config,
  type FsEnv,
  FsEnvSchema,
  type ImportBrowser,
  ImportBrowserSchema,
  SESSION_KEY_BYTES,
} from "../config.js";
import { LOGIN_HINT, SessionError } from "../core/errors.js";
import type { FsUser } from "../familysearch/user.js";

// The session token IS the account (it reads and, later, writes the shared
// tree as the user), so it is encrypted at rest with AES-256-GCM and written
// 0600. Key: FAMILYSEARCH_SESSION_KEY wins; otherwise a random key lives next
// to the file (0600) so the tool works with zero configuration. One file per
// environment, one key for both. File layout, all binary:
//   [0] format version (1) | [1..12] IV | [13..28] GCM tag | [29..] ciphertext

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

const SessionSchema = Type.Object({
  version: Type.Literal(1),
  env: FsEnvSchema,
  /** The `fssessionid` value, sent as `Authorization: Bearer`. */
  token: Type.String({ minLength: 1 }),
  /** The browser's own User-Agent: FamilySearch's edge rejects non-browser ones. */
  userAgent: Type.String({ minLength: 1 }),
  user: Type.Object({
    id: Type.String(),
    displayName: Type.String(),
    personId: Type.Union([Type.String(), Type.Null()]),
  }),
  /** How the token was obtained: the dedicated browser login, or which browser it was imported from. */
  source: Type.Union([Type.Literal("login"), ImportBrowserSchema]),
  /** Unix ms of the save. */
  savedAt: Type.Number(),
});

export type SessionData = {
  version: 1;
  env: FsEnv;
  token: string;
  userAgent: string;
  user: FsUser;
  source: "login" | ImportBrowser;
  savedAt: number;
};

export type SessionStore = {
  /** `null` before the first login. Throws {@link SessionError} when unreadable. */
  load(): SessionData | null;
  save(data: SessionData): void;
  /** Removes the session file; the key file stays so a re-login reuses it. */
  clear(): void;
  /** The token of the last loaded/saved session — feeds log redaction. */
  peekSecrets(): readonly string[];
  readonly paths: { sessionPath: string; keyPath: string };
};

export function encrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < HEADER_BYTES || blob[0] !== FORMAT_VERSION) {
    throw new SessionError(`Arquivo de sessão corrompido ou em formato desconhecido. ${LOGIN_HINT}`);
  }
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(1 + IV_BYTES, HEADER_BYTES);
  const ciphertext = blob.subarray(HEADER_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SessionError(
      `Não foi possível decifrar a sessão: a chave mudou (FAMILYSEARCH_SESSION_KEY ou session.key). ${LOGIN_HINT}`,
    );
  }
}

type KeySource = Pick<Config, "sessionKey" | "keyPath">;

/**
 * Key precedence: env → key file → (only when saving) a freshly generated one.
 * Returns null when nothing exists and creation was not requested.
 */
export function resolveKey(source: KeySource, createIfMissing: boolean): Buffer | null {
  if (source.sessionKey) return Buffer.from(source.sessionKey, "base64");
  if (existsSync(source.keyPath)) {
    const key = Buffer.from(readFileSync(source.keyPath, "utf8").trim(), "base64");
    if (key.length !== SESSION_KEY_BYTES) {
      throw new SessionError(
        `${source.keyPath} inválida: esperado base64 de ${SESSION_KEY_BYTES} bytes. Apague o arquivo e rode \`familysearch login\`.`,
      );
    }
    return key;
  }
  if (!createIfMissing) return null;
  const key = randomBytes(SESSION_KEY_BYTES);
  mkdirSync(dirname(source.keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(source.keyPath, `${key.toString("base64")}\n`, { mode: 0o600 });
  chmodSync(source.keyPath, 0o600); // `mode` is ignored when the file already exists
  return key;
}

export function createSessionStore(
  config: Pick<Config, "configDir" | "sessionPath" | "keyPath" | "sessionKey">,
): SessionStore {
  let secrets: readonly string[] = [];

  return {
    paths: { sessionPath: config.sessionPath, keyPath: config.keyPath },

    load() {
      if (!existsSync(config.sessionPath)) return null;
      const key = resolveKey(config, false);
      if (!key) {
        throw new SessionError(
          `${config.sessionPath} existe, mas não há chave para decifrá-lo (FAMILYSEARCH_SESSION_KEY ou ${config.keyPath}). ${LOGIN_HINT}`,
        );
      }
      const plaintext = decrypt(key, readFileSync(config.sessionPath));
      let parsed: unknown;
      try {
        parsed = JSON.parse(plaintext.toString("utf8"));
      } catch {
        throw new SessionError(`Sessão decifrada, mas com conteúdo inválido. ${LOGIN_HINT}`);
      }
      if (!Value.Check(SessionSchema, parsed)) {
        throw new SessionError(`Sessão em versão não suportada. ${LOGIN_HINT}`);
      }
      secrets = [parsed.token];
      return parsed;
    },

    save(data) {
      mkdirSync(config.configDir, { recursive: true, mode: 0o700 });
      const key = resolveKey(config, true) as Buffer;
      // Write-then-rename: a re-import from the MCP server may race with a
      // `familysearch login` in a terminal; readers never see a half-written file.
      const temp = `${config.sessionPath}.tmp`;
      writeFileSync(temp, encrypt(key, Buffer.from(JSON.stringify(data))), { mode: 0o600 });
      renameSync(temp, config.sessionPath);
      chmodSync(config.sessionPath, 0o600);
      secrets = [data.token];
    },

    clear() {
      if (existsSync(config.sessionPath)) unlinkSync(config.sessionPath);
      secrets = [];
    },

    peekSecrets: () => secrets,
  };
}

/** In-memory store for tests: same contract. */
export function createMemorySessionStore(
  initial: SessionData | null = null,
): SessionStore & { data: SessionData | null } {
  const store = {
    data: initial,
    paths: { sessionPath: "memory://session.enc", keyPath: "memory://session.key" },
    load: () => store.data,
    save(data: SessionData) {
      store.data = data;
    },
    clear() {
      store.data = null;
    },
    peekSecrets: () => (store.data ? [store.data.token] : []),
  };
  return store;
}
