import { AuthError, MergedError, RateLimitError } from "../core/errors.js";
import type { Ctx } from "../context.js";
import {
  readAncestry,
  readFamilies,
  readRecordHints,
  readSources,
  readTreeMatches,
} from "../familysearch/api.js";
import type { GxPerson } from "../familysearch/gedcomx.js";
import { toPersonSummary, toSearchHits, toSources } from "../domain/normalize.js";
import type { PersonInput } from "./repo.js";

// Resumable fill of the cache. A chunk spends at most `maxRequests`: one for
// the pedigree (first run or --full), then four per person (families, sources,
// tree matches, record hints). Whatever was written stays when a chunk stops,
// so the next call continues where this one ended.

export type SyncOptions = { maxRequests?: number; generations?: number; full?: boolean };

export type SyncReport = {
  done: boolean;
  rootId: string;
  requests: number;
  personsInLineage: number;
  detailed: number;
  pending: number;
  merged: Array<{ from: string; to: string }>;
  note?: string;
};

const REQUESTS_PER_PERSON = 4;

/** "1" → 0, "2"/"3" → 1, "4".."7" → 2; a spouse ("5-S") sits in the generation of its number. */
export function ascendancyGeneration(number: string): number {
  const n = Number.parseInt(number, 10);
  return n >= 1 ? Math.floor(Math.log2(n)) : 0;
}

function namePart(person: GxPerson, type: string): string | null {
  const names = [...(person.names ?? [])].sort((a, b) => Number(b.preferred === true) - Number(a.preferred === true));
  const parts = (names[0]?.nameForms?.[0]?.parts ?? []).filter((part) => part.type?.endsWith(`/${type}`) && part.value);
  return parts.length > 0 ? parts.map((part) => part.value).join(" ") : null;
}

function toInput(person: GxPerson, ascendancy: string | null): PersonInput {
  const summary = toPersonSummary(person);
  return {
    id: summary.id,
    name: summary.name,
    given: namePart(person, "Given"),
    surname: namePart(person, "Surname"),
    gender: summary.gender,
    living: summary.living,
    lifespan: summary.lifespan,
    birthDate: summary.birth?.date?.original ?? null,
    birthFormal: summary.birth?.date?.formal ?? null,
    birthPlace: summary.birth?.place ?? null,
    deathDate: summary.death?.date?.original ?? null,
    deathFormal: summary.death?.date?.formal ?? null,
    deathPlace: summary.death?.place ?? null,
    ascendancy,
    generation: ascendancy === null ? null : ascendancyGeneration(ascendancy),
    raw: JSON.stringify(person),
  };
}

export async function runSyncChunk(ctx: Ctx, opts: SyncOptions = {}): Promise<SyncReport> {
  const maxRequests = opts.maxRequests ?? 60;
  const generations = opts.generations ?? 8;
  const rootId = ctx.session.load()?.user.personId ?? null;
  if (!rootId) throw new Error("Sua conta não tem uma pessoa ligada na árvore do FamilySearch.");

  const repo = ctx.cache();
  const report: SyncReport = {
    done: false,
    rootId,
    requests: 0,
    personsInLineage: 0,
    detailed: 0,
    pending: 0,
    merged: [],
  };
  // Counts the request before it goes out: a failed one was still spent.
  const spend = <T>(read: Promise<T> | (() => Promise<T>)): Promise<T> => {
    report.requests += 1;
    return typeof read === "function" ? read() : read;
  };

  if (opts.full || repo.getMeta("pedigree_at") === null) {
    const document = await spend(() => readAncestry(ctx.http, rootId, generations));
    repo.transaction(() => {
      if (opts.full) repo.resetDetails();
      repo.clearLineage();
      for (const person of document.persons ?? []) {
        const number = person.display?.ascendancyNumber;
        if (person.id && number) repo.upsertPerson(toInput(person, number));
      }
      repo.setMeta("root_id", rootId);
      repo.setMeta("generations", String(generations));
      repo.setMeta("pedigree_at", new Date(ctx.now()).toISOString());
    });
  }

  while (report.requests + REQUESTS_PER_PERSON <= maxRequests) {
    const id = repo.pendingDetails(1)[0];
    if (id === undefined) break;
    try {
      const families = await spend(() => readFamilies(ctx.http, id));
      const sources = await spend(() => readSources(ctx.http, id));
      const matches = await spend(() => readTreeMatches(ctx.http, id));
      const hints = await spend(() => readRecordHints(ctx.http, id));
      repo.transaction(() => {
        for (const person of families.persons ?? []) {
          if (person.id) repo.upsertPerson(toInput(person, null));
        }
        for (const couple of families.relationships ?? []) {
          if (couple.id && couple.type?.endsWith("/Couple")) {
            repo.upsertRelationship({
              id: couple.id,
              kind: "couple",
              person1: couple.person1?.resourceId ?? null,
              person2: couple.person2?.resourceId ?? null,
              child: null,
            });
          }
        }
        for (const link of families.childAndParentsRelationships ?? []) {
          if (link.id) {
            repo.upsertRelationship({
              id: link.id,
              kind: "parents",
              person1: link.parent1?.resourceId ?? null,
              person2: link.parent2?.resourceId ?? null,
              child: link.child?.resourceId ?? null,
            });
          }
        }
        // 204 (null) means none.
        repo.markDetails(id, {
          sources: toSources(sources).length,
          hints: hints ? toSearchHits(hints).length : 0,
          duplicates: matches ? toSearchHits(matches).length : 0,
        });
      });
      report.detailed += 1;
    } catch (error) {
      if (error instanceof AuthError || error instanceof RateLimitError) throw error;
      if (error instanceof MergedError && error.survivorId) {
        const old = repo.person(id);
        repo.transaction(() => {
          repo.markMerged(id, error.survivorId as string);
          // The survivor takes the place in the lineage, unless it already has one.
          if (old && repo.person(error.survivorId as string)?.ascendancy == null) {
            repo.upsertPerson({
              ...toInput({ id: error.survivorId as string }, old.ascendancy),
              generation: old.generation,
            });
          }
        });
        report.merged.push({ from: id, to: error.survivorId });
        continue;
      }
      report.note = `Parei em ${id}: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }
  }

  repo.setMeta("last_sync_at", new Date(ctx.now()).toISOString());
  const stats = repo.stats();
  report.personsInLineage = stats.lineage;
  report.pending = stats.pending;
  report.done = stats.pending === 0;
  return report;
}
