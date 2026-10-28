import { homedir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// TypeBox is the single source of truth for the config. Every value comes from
// the environment (12-factor, `FAMILYSEARCH_` prefix); no `.env` files are read.
// The schema describes the *parsed* object (booleans, ints, absolute paths),
// not the raw strings.

/**
 * FamilySearch runs two isolated systems: the real shared tree and a beta copy
 * with its own accounts. A session token is valid on exactly one of them, so
 * every per-session file is per environment.
 */
export const FS_ENVS = ["production", "beta"] as const;
export type FsEnv = (typeof FS_ENVS)[number];

export const BASE_URLS: Record<FsEnv, string> = {
  production: "https://www.familysearch.org",
  beta: "https://beta.familysearch.org",
};

export const BROWSER_CHANNELS = ["chrome", "chromium", "msedge"] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];

/** Chromium-based browsers whose cookie store can be imported (macOS). */
export const IMPORT_BROWSERS = ["dia", "arc", "chrome", "chromium", "brave", "edge"] as const;
export type ImportBrowser = (typeof IMPORT_BROWSERS)[number];

export const SESSION_KEY_BYTES = 32;

export const FsEnvSchema = Type.Union([Type.Literal("production"), Type.Literal("beta")]);
export const ImportBrowserSchema = Type.Union([
  Type.Literal("dia"),
  Type.Literal("arc"),
  Type.Literal("chrome"),
  Type.Literal("chromium"),
  Type.Literal("brave"),
  Type.Literal("edge"),
]);

export const ConfigSchema = Type.Object({
  /** Everything the tool persists lives under this directory. */
  configDir: Type.String({ minLength: 1 }),
  env: FsEnvSchema,
  /** Derived from `env`; every request goes to this origin and nowhere else. */
  baseUrl: Type.String({ minLength: 1 }),
  sessionPath: Type.String({ minLength: 1 }),
  /** One key for both environments: it only protects files at rest. */
  keyPath: Type.String({ minLength: 1 }),
  dbPath: Type.String({ minLength: 1 }),
  browserProfileDir: Type.String({ minLength: 1 }),
  /** The only directory `export` may write to. */
  exportDir: Type.String({ minLength: 1 }),
  /** Base64 of 32 bytes. When absent the key file under configDir is used/created. */
  sessionKey: Type.Optional(Type.String({ minLength: 1 })),
  readOnly: Type.Boolean(),
  /** Approves every write without asking (FAMILYSEARCH_AUTO_APPROVE, ADR-0012). */
  autoApprove: Type.Boolean(),
  logFile: Type.Optional(Type.String({ minLength: 1 })),
  browserChannel: Type.Union([
    Type.Literal("chrome"),
    Type.Literal("chromium"),
    Type.Literal("msedge"),
  ]),
  /** When set, `login` imports the session from this browser instead of opening a window. */
  importBrowser: Type.Optional(ImportBrowserSchema),
  /** Minimum gap between two FamilySearch requests (plus random jitter). */
  minIntervalMs: Type.Integer({ minimum: 0 }),
  jitterMs: Type.Integer({ minimum: 0 }),
  httpTimeoutMs: Type.Integer({ minimum: 1000 }),
  /** Minimum gap between two writes: the tree is shared, writes go slowly on purpose. */
  writeIntervalMs: Type.Integer({ minimum: 1000 }),
  /** Write log, approval details and merge snapshots. Never leaves the machine. */
  auditDir: Type.String({ minLength: 1 }),
});

export type Config = Static<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Configuração inválida do familysearch-mcp:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function readOptional(env: Env, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw ? raw : undefined;
}

/** MCP client configs are JSON, not shell: `~/` has to be expanded by hand. */
function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function readBool(problems: string[], env: Env, key: string, fallback: boolean): boolean {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  problems.push(`${key} deve ser boolean (1/0, true/false, yes/no, on/off), veio "${raw}"`);
  return fallback;
}

function readInt(problems: string[], env: Env, key: string, fallback: number, min: number): number {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    problems.push(`${key} deve ser inteiro >= ${min}, veio "${raw}"`);
    return fallback;
  }
  return parsed;
}

function readEnum<T extends string>(
  problems: string[],
  env: Env,
  key: string,
  allowed: readonly T[],
  fallback: T | undefined,
): T | undefined {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if ((allowed as readonly string[]).includes(value)) return value as T;
  problems.push(`${key} deve ser ${allowed.join("|")}, veio "${raw}"`);
  return fallback;
}

function readSessionKey(problems: string[], env: Env): string | undefined {
  const raw = readOptional(env, "FAMILYSEARCH_SESSION_KEY");
  if (raw === undefined) return undefined;
  if (Buffer.from(raw, "base64").length !== SESSION_KEY_BYTES) {
    problems.push(
      `FAMILYSEARCH_SESSION_KEY deve ser base64 de ${SESSION_KEY_BYTES} bytes (gere com: openssl rand -base64 32)`,
    );
    return undefined;
  }
  return raw;
}

/**
 * Loads and validates the config from the environment (fail-fast). Every
 * problem is collected so the user fixes all of them in one go. Nothing is
 * required: a missing session fails at call time with an actionable
 * `AuthError`, not at boot.
 */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const configDir = expandHome(
    readOptional(env, "FAMILYSEARCH_CONFIG_DIR") ?? join(homedir(), ".config", "familysearch-mcp"),
  );
  const fsEnv = readEnum(problems, env, "FAMILYSEARCH_ENV", FS_ENVS, "production") as FsEnv;

  const config: Config = {
    configDir,
    env: fsEnv,
    baseUrl: BASE_URLS[fsEnv],
    sessionPath: join(configDir, `session.${fsEnv}.enc`),
    keyPath: join(configDir, "session.key"),
    dbPath: join(configDir, `cache.${fsEnv}.db`),
    browserProfileDir: join(configDir, `browser-profile-${fsEnv}`),
    exportDir: expandHome(
      readOptional(env, "FAMILYSEARCH_EXPORT_DIR") ??
        join(homedir(), "Downloads", "familysearch-export"),
    ),
    sessionKey: readSessionKey(problems, env),
    readOnly: readBool(problems, env, "FAMILYSEARCH_READ_ONLY", false),
    autoApprove: readBool(problems, env, "FAMILYSEARCH_AUTO_APPROVE", false),
    logFile: readOptional(env, "FAMILYSEARCH_LOG_FILE"),
    browserChannel: readEnum(
      problems,
      env,
      "FAMILYSEARCH_BROWSER_CHANNEL",
      BROWSER_CHANNELS,
      "chrome",
    ) as BrowserChannel,
    importBrowser: readEnum(problems, env, "FAMILYSEARCH_IMPORT_BROWSER", IMPORT_BROWSERS, undefined),
    minIntervalMs: readInt(problems, env, "FAMILYSEARCH_MIN_INTERVAL_MS", 400, 0),
    jitterMs: readInt(problems, env, "FAMILYSEARCH_JITTER_MS", 200, 0),
    httpTimeoutMs: readInt(problems, env, "FAMILYSEARCH_HTTP_TIMEOUT_MS", 30_000, 1000),
    writeIntervalMs: readInt(problems, env, "FAMILYSEARCH_WRITE_INTERVAL_MS", 2000, 1000),
    auditDir: join(configDir, "audit"),
  };

  // Safety net: the parsed object must match the schema (catches any drift
  // between the readers above and the declared shape).
  if (!Value.Check(ConfigSchema, config)) {
    for (const error of Value.Errors(ConfigSchema, config)) {
      problems.push(`${error.path || "/"}: ${error.message}`);
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
