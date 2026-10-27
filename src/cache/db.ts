import type { Database } from "bun:sqlite";
import { openDatabase } from "../core/sqlite.js";

// Local cache of the user's lineage. It exists because the pedigree plus the
// per-person counts cost hundreds of rate-limited requests, and every analysis
// (gaps, export) would otherwise repeat them. `raw` keeps the GEDCOM X person
// as received so later readers can reach fields the columns do not hold.

export const SCHEMA_VERSION = 1;

/** Ordered and append-only: a released migration is never edited. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS persons (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    given           TEXT,
    surname         TEXT,
    gender          TEXT NOT NULL,
    living          INTEGER NOT NULL,
    lifespan        TEXT,
    birth_date      TEXT,
    birth_formal    TEXT,
    birth_place     TEXT,
    death_date      TEXT,
    death_formal    TEXT,
    death_place     TEXT,
    ascendancy      TEXT,      -- only for who is in the lineage
    generation      INTEGER,   -- idem
    source_count    INTEGER,
    hint_count      INTEGER,
    duplicate_count INTEGER,
    details_at      TEXT,      -- set only when all four detail reads worked
    merged_into     TEXT,
    raw             TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS relationships (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('couple','parents')),
    person1    TEXT,
    person2    TEXT,
    child      TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

/** Applies every migration not yet applied. Idempotent. */
export function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | null;
  for (let version = row ? Number(row.value) : 0; version < MIGRATIONS.length; version += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version] as string);
      db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(version + 1));
    })();
  }
}

export function openCache(path: string): Database {
  const db = openDatabase(path);
  migrate(db);
  return db;
}
