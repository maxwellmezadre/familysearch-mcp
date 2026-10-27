import type { Database } from "bun:sqlite";

// Typed access to the cache. Rows are snake_case in SQL and camelCase here.

export type CachedPerson = {
  id: string;
  name: string | null;
  given: string | null;
  surname: string | null;
  gender: string;
  living: boolean;
  lifespan: string | null;
  birthDate: string | null;
  birthFormal: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  deathFormal: string | null;
  deathPlace: string | null;
  ascendancy: string | null;
  generation: number | null;
  sourceCount: number | null;
  hintCount: number | null;
  duplicateCount: number | null;
  detailsAt: string | null;
  mergedInto: string | null;
  /** The GEDCOM X person as received, JSON. */
  raw: string;
  updatedAt: string;
};

/** What a caller supplies; the detail counts and merge state are managed by the repo. */
export type PersonInput = Omit<
  CachedPerson,
  "sourceCount" | "hintCount" | "duplicateCount" | "detailsAt" | "mergedInto" | "updatedAt"
>;

export type CachedRelationship = {
  id: string;
  kind: "couple" | "parents";
  person1: string | null;
  person2: string | null;
  child: string | null;
  updatedAt: string;
};

export type CacheStats = {
  persons: number;
  lineage: number;
  pending: number;
  relationships: number;
  rootId: string | null;
  lastSyncAt: string | null;
};

type Row = Record<string, unknown>;

const toPerson = (r: Row): CachedPerson => ({
  id: r.id as string,
  name: r.name as string | null,
  given: r.given as string | null,
  surname: r.surname as string | null,
  gender: r.gender as string,
  living: r.living === 1,
  lifespan: r.lifespan as string | null,
  birthDate: r.birth_date as string | null,
  birthFormal: r.birth_formal as string | null,
  birthPlace: r.birth_place as string | null,
  deathDate: r.death_date as string | null,
  deathFormal: r.death_formal as string | null,
  deathPlace: r.death_place as string | null,
  ascendancy: r.ascendancy as string | null,
  generation: r.generation as number | null,
  sourceCount: r.source_count as number | null,
  hintCount: r.hint_count as number | null,
  duplicateCount: r.duplicate_count as number | null,
  detailsAt: r.details_at as string | null,
  mergedInto: r.merged_into as string | null,
  raw: r.raw as string,
  updatedAt: r.updated_at as string,
});

const IN_LINEAGE = "ascendancy IS NOT NULL AND merged_into IS NULL";
// Closest generation first; "1-S" (a spouse) sorts with its number.
const LINEAGE_ORDER = "generation, CAST(ascendancy AS INTEGER), ascendancy";

export function createCacheRepo(db: Database, now: () => number) {
  const stamp = () => new Date(now()).toISOString();
  const count = (sql: string): number => (db.query(sql).get() as { n: number }).n;

  const getMeta = (key: string): string | null =>
    (db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null)?.value ?? null;

  return {
    /** Inserts or refreshes a person; detail counts, merge state and a known ascendancy survive. */
    upsertPerson(p: PersonInput): void {
      db.query(
        `INSERT INTO persons (id, name, given, surname, gender, living, lifespan, birth_date, birth_formal,
           birth_place, death_date, death_formal, death_place, ascendancy, generation, raw, updated_at)
         VALUES ($id, $name, $given, $surname, $gender, $living, $lifespan, $birthDate, $birthFormal,
           $birthPlace, $deathDate, $deathFormal, $deathPlace, $ascendancy, $generation, $raw, $updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, given = excluded.given, surname = excluded.surname, gender = excluded.gender,
           living = excluded.living, lifespan = excluded.lifespan, birth_date = excluded.birth_date,
           birth_formal = excluded.birth_formal, birth_place = excluded.birth_place,
           death_date = excluded.death_date, death_formal = excluded.death_formal,
           death_place = excluded.death_place, raw = excluded.raw, updated_at = excluded.updated_at,
           ascendancy = COALESCE(excluded.ascendancy, persons.ascendancy),
           generation = COALESCE(excluded.generation, persons.generation)`,
      ).run({
        $id: p.id,
        $name: p.name,
        $given: p.given,
        $surname: p.surname,
        $gender: p.gender,
        $living: p.living ? 1 : 0,
        $lifespan: p.lifespan,
        $birthDate: p.birthDate,
        $birthFormal: p.birthFormal,
        $birthPlace: p.birthPlace,
        $deathDate: p.deathDate,
        $deathFormal: p.deathFormal,
        $deathPlace: p.deathPlace,
        $ascendancy: p.ascendancy,
        $generation: p.generation,
        $raw: p.raw,
        $updatedAt: stamp(),
      });
    },

    upsertRelationship(r: Omit<CachedRelationship, "updatedAt"> & { updatedAt?: string }): void {
      db.query(
        `INSERT INTO relationships (id, kind, person1, person2, child, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, person1 = excluded.person1,
           person2 = excluded.person2, child = excluded.child, updated_at = excluded.updated_at`,
      ).run(r.id, r.kind, r.person1, r.person2, r.child, stamp());
    },

    markDetails(id: string, counts: { sources: number; hints: number; duplicates: number }): void {
      db.query(
        "UPDATE persons SET source_count = ?, hint_count = ?, duplicate_count = ?, details_at = ? WHERE id = ?",
      ).run(counts.sources, counts.hints, counts.duplicates, stamp(), id);
    },

    markMerged(id: string, survivorId: string): void {
      db.query("UPDATE persons SET merged_into = ? WHERE id = ?").run(survivorId, id);
    },

    /** Forgets which persons were detailed (sync --full). */
    resetDetails(): void {
      db.exec("UPDATE persons SET details_at = NULL");
    },

    /** Forgets who is in the lineage, before a fresh pedigree is written. */
    clearLineage(): void {
      db.exec("UPDATE persons SET ascendancy = NULL, generation = NULL");
    },

    pendingDetails(limit: number): string[] {
      const rows = db
        .query(`SELECT id FROM persons WHERE ${IN_LINEAGE} AND details_at IS NULL ORDER BY ${LINEAGE_ORDER}, id LIMIT ?`)
        .all(limit) as Array<{ id: string }>;
      return rows.map((row) => row.id);
    },

    lineage(): CachedPerson[] {
      return (db.query(`SELECT * FROM persons WHERE ${IN_LINEAGE} ORDER BY ${LINEAGE_ORDER}, id`).all() as Row[]).map(toPerson);
    },

    allPersons(): CachedPerson[] {
      return (db.query("SELECT * FROM persons ORDER BY id").all() as Row[]).map(toPerson);
    },

    relationships(): CachedRelationship[] {
      return (db.query("SELECT * FROM relationships ORDER BY id").all() as Row[]).map((r) => ({
        id: r.id as string,
        kind: r.kind as "couple" | "parents",
        person1: r.person1 as string | null,
        person2: r.person2 as string | null,
        child: r.child as string | null,
        updatedAt: r.updated_at as string,
      }));
    },

    person(id: string): CachedPerson | null {
      const row = db.query("SELECT * FROM persons WHERE id = ?").get(id) as Row | null;
      return row ? toPerson(row) : null;
    },

    getMeta,

    setMeta(key: string, value: string): void {
      db.query("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
    },

    /** Runs `fn` atomically: a person's rows land all together or not at all. */
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    stats(): CacheStats {
      return {
        persons: count("SELECT COUNT(*) AS n FROM persons"),
        lineage: count(`SELECT COUNT(*) AS n FROM persons WHERE ${IN_LINEAGE}`),
        pending: count(`SELECT COUNT(*) AS n FROM persons WHERE ${IN_LINEAGE} AND details_at IS NULL`),
        relationships: count("SELECT COUNT(*) AS n FROM relationships"),
        rootId: getMeta("root_id"),
        lastSyncAt: getMeta("last_sync_at"),
      };
    },
  };
}

export type CacheRepo = ReturnType<typeof createCacheRepo>;
