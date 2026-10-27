import { DeletedError, HttpError, MergedError, NotFoundError, ParseError } from "../core/errors.js";
import type { Http, HttpRequest, HttpResponse } from "../core/http.js";
import { normalizeSearchDate } from "../domain/dates.js";
import type { MergeAnalysis, MergeCheck, RecordQuery, TreeQuery } from "../domain/types.js";
import type { GxDocument, GxFeed } from "./gedcomx.js";

// Every FamilySearch read, one small function each. Paths are the documented
// ones (developers.familysearch.org), hard-coded on purpose: resolving them
// through hypermedia links would cost an extra request per call and buys
// nothing while the documented paths hold. When one breaks, `doctor` and
// docs/REDISCOVERY.md say where.

export const ATOM = "application/x-gedcomx-atom+json";

/**
 * One request, mapped to the project's errors:
 *   200 → parsed JSON; 204 → null (the caller decides: empty list or not found);
 *   301 → MergedError (the id now redirects to the survivor);
 *   400 / 404 → NotFoundError (FamilySearch answers 400 to a malformed id);
 *   410 → DeletedError; anything else ≥ 400 → HttpError with FamilySearch's warning.
 */
const PERSON_ID = /^[A-Z0-9]{4}-[A-Z0-9]{3,4}$/;

/**
 * The surviving person in a 301 `Location`, whatever the sub-resource:
 * `/persons/{id}`, `/persons/{id}/families`, `ancestry?person={id}`...
 */
export function survivorFrom(location: string | null): string | null {
  if (!location) return null;
  const match =
    /\/persons\/([A-Z0-9]{4}-[A-Z0-9]{3,4})(?![A-Z0-9])/.exec(location) ??
    /[?&]person=([A-Z0-9]{4}-[A-Z0-9]{3,4})(?![A-Z0-9])/.exec(location);
  return match?.[1] ?? null;
}

/**
 * Maps FamilySearch's "this id is not a usable person" answers to the
 * project's errors. A 400/404 means "not found" only for a request about an
 * id (FamilySearch answers 400 to a malformed one); on a search it is the
 * API's own complaint and keeps its Warning text.
 */
function checkStatus(response: HttpResponse, about: string, label: string): void {
  if (response.status === 301) throw new MergedError(about, survivorFrom(response.headers.get("location")));
  if ((response.status === 400 || response.status === 404) && PERSON_ID.test(about)) {
    throw new NotFoundError(about);
  }
  if (response.status === 410) throw new DeletedError(about);
  if (response.status >= 400) {
    const warning = response.headers.get("warning");
    throw new HttpError(
      response.status,
      `O FamilySearch respondeu HTTP ${response.status} em ${label}${warning ? `: ${warning}` : "."}`,
    );
  }
}

export async function getJson<T>(http: Http, request: HttpRequest, subject?: string): Promise<T | null> {
  const response = await http.send(request);
  if (response.status === 204) return null;
  checkStatus(response, subject ?? request.label, request.label);
  if (response.body.trim() === "") return null;
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new ParseError(`O FamilySearch respondeu algo que não é JSON em ${request.label}.`);
  }
}

/** Like {@link getJson}, but an empty answer means the subject does not exist. */
async function getRequired<T>(http: Http, request: HttpRequest, subject: string): Promise<T> {
  const result = await getJson<T>(http, request, subject);
  if (result === null) throw new NotFoundError(subject);
  return result;
}

const person = (id: string) => `/platform/tree/persons/${encodeURIComponent(id)}`;

export const readPerson = (http: Http, id: string) =>
  getRequired<GxDocument>(http, { method: "GET", path: person(id), label: "person" }, id);

export const readFamilies = (http: Http, id: string) =>
  getRequired<GxDocument>(http, { method: "GET", path: `${person(id)}/families`, label: "families" }, id);

export const readAncestry = (http: Http, id: string, generations: number) =>
  getRequired<GxDocument>(
    http,
    { method: "GET", path: "/platform/tree/ancestry", query: { person: id, generations }, label: "ancestry" },
    id,
  );

export const readDescendancy = (http: Http, id: string, generations: number) =>
  getRequired<GxDocument>(
    http,
    { method: "GET", path: "/platform/tree/descendancy", query: { person: id, generations }, label: "descendancy" },
    id,
  );

export const readChanges = (http: Http, id: string) =>
  getRequired<GxFeed>(http, { method: "GET", path: `${person(id)}/changes`, accept: ATOM, label: "changes" }, id);

export const readSources = (http: Http, id: string) =>
  getJson<GxDocument>(http, { method: "GET", path: `${person(id)}/sources`, label: "sources" }, id);

export const readNotes = (http: Http, id: string) =>
  getJson<GxDocument>(http, { method: "GET", path: `${person(id)}/notes`, label: "notes" }, id);

export const readMemories = (http: Http, id: string) =>
  getJson<GxDocument>(http, { method: "GET", path: `${person(id)}/memories`, label: "memories" }, id);

/** Splits "Given Names Surname": the last word is the surname. */
function splitName(full: string | undefined): { given?: string; surname?: string } {
  const words = full?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return {};
  if (words.length === 1) return { surname: words[0] };
  return { given: words.slice(0, -1).join(" "), surname: words.at(-1) };
}

export function treeSearchParams(query: TreeQuery): Record<string, string | number | undefined> {
  const father = splitName(query.fatherName);
  const mother = splitName(query.motherName);
  const spouse = splitName(query.spouseName);
  return {
    "q.givenName": query.givenName,
    "q.surname": query.surname,
    "q.sex": query.gender === "male" ? "Male" : query.gender === "female" ? "Female" : undefined,
    "q.birthLikeDate": query.birthDate ? normalizeSearchDate(query.birthDate) : undefined,
    "q.birthLikePlace": query.birthPlace,
    "q.deathLikeDate": query.deathDate ? normalizeSearchDate(query.deathDate) : undefined,
    "q.deathLikePlace": query.deathPlace,
    "q.fatherGivenName": father.given,
    "q.fatherSurname": father.surname,
    "q.motherGivenName": mother.given,
    "q.motherSurname": mother.surname,
    "q.spouseGivenName": spouse.given,
    "q.spouseSurname": spouse.surname,
    count: query.limit ?? 10,
  };
}

export const searchTree = (http: Http, query: TreeQuery) =>
  getJson<GxFeed>(http, {
    method: "GET",
    path: "/platform/tree/search",
    query: treeSearchParams(query),
    accept: ATOM,
    label: "tree search",
  });

// ---- research ---------------------------------------------------------------

export const RECORDS_COLLECTION = "https://familysearch.org/platform/collections/records";

/** Possible duplicates of a person in the tree, as FamilySearch scores them. */
export const readTreeMatches = (http: Http, id: string) =>
  getJson<GxFeed>(http, { method: "GET", path: `${person(id)}/matches`, accept: ATOM, label: "matches" }, id);

/** Record hints: historical records FamilySearch thinks are about this person. */
export const readRecordHints = (http: Http, id: string) =>
  getJson<GxFeed>(
    http,
    {
      method: "GET",
      path: `${person(id)}/matches`,
      query: { collection: RECORDS_COLLECTION },
      accept: ATOM,
      label: "record hints",
    },
    id,
  );

/** Historical record search lives on the website's search service, not on /platform. */
export const searchRecords = (http: Http, query: RecordQuery) =>
  getJson<GxFeed>(http, {
    method: "GET",
    path: "/service/search/hr/v2/personas",
    query: {
      "q.givenName": query.givenName,
      "q.surname": query.surname,
      "q.birthLikeDate.from": query.birthDate ? normalizeSearchDate(query.birthDate) : undefined,
      "q.birthLikePlace": query.birthPlace,
      "q.deathLikeDate.from": query.deathDate ? normalizeSearchDate(query.deathDate) : undefined,
      "q.deathLikePlace": query.deathPlace,
      "f.collectionId": query.collectionId,
      count: query.limit ?? 10,
    },
    accept: "application/json",
    label: "record search",
  });

export const readRecordPersona = (http: Http, id: string) =>
  getRequired<GxDocument>(
    http,
    { method: "GET", path: `/platform/records/personas/${encodeURIComponent(id)}`, label: "record" },
    id,
  );

export const searchPlaces = (http: Http, name: string, limit: number) =>
  getJson<GxFeed>(http, {
    method: "GET",
    path: "/platform/places/search",
    query: { q: `name:"${name.replace(/"/g, "")}"`, count: limit },
    accept: ATOM,
    label: "place search",
  });

// ---- merge (read side) ------------------------------------------------------

const mergePath = (survivorId: string, duplicateId: string) =>
  `${person(survivorId)}/merges/${encodeURIComponent(duplicateId)}`;

/** The text inside FamilySearch's Warning header: `450 FamilySearch "Can merge, but must switch order"`. */
function warningText(warning: string | null): string | null {
  if (!warning) return null;
  const quoted = /"((?:[^"\\]|\\.)*)"/.exec(warning);
  return quoted?.[1] ?? warning;
}

/**
 * Can `survivorId` survive a merge with `duplicateId`? `OPTIONS` answers in
 * headers: `Allow` with POST means yes; a "switch order" warning (or a
 * `merge-mirror` link) means only the other way round; any other warning is a
 * refusal (restricted person, living person...) whose text is kept as the reason.
 */
export async function readMergeConstraint(http: Http, survivorId: string, duplicateId: string): Promise<MergeCheck> {
  const response = await http.send({ method: "OPTIONS", path: mergePath(survivorId, duplicateId), label: "merge options" });
  checkStatus(response, survivorId, "merge options");
  const allow = (response.headers.get("allow") ?? "").split(",").map((method) => method.trim().toUpperCase());
  const reason = warningText(response.headers.get("warning"));
  if (allow.includes("POST")) return { constraint: "allowed", reason: null };
  if (/switch order/i.test(reason ?? "") || /merge-mirror/.test(response.headers.get("link") ?? "")) {
    return { constraint: "other-order-only", reason };
  }
  return { constraint: "not-allowed", reason };
}

type GxMergeAnalysis = {
  mergeAnalyses?: Array<{
    survivorResources?: Array<{ resource?: string }>;
    duplicateResources?: Array<{ resource?: string }>;
    conflictingResources?: Array<{ survivorResource?: { resource?: string }; duplicateResource?: { resource?: string } }>;
  }>;
};

/** What a merge would keep, bring over and put in conflict. Null when FamilySearch will not analyse the pair. */
export async function readMergeAnalysis(http: Http, survivorId: string, duplicateId: string): Promise<MergeAnalysis | null> {
  const response = await http.send({ method: "GET", path: mergePath(survivorId, duplicateId), label: "merge analysis" });
  if (response.status !== 200 || response.body.trim() === "") return null;
  const analysis = (JSON.parse(response.body) as GxMergeAnalysis).mergeAnalyses?.[0];
  if (!analysis) return null;
  const resources = (list: Array<{ resource?: string }> | undefined) =>
    (list ?? []).map((item) => item.resource ?? "").filter(Boolean);
  return {
    survivorResources: resources(analysis.survivorResources),
    duplicateResources: resources(analysis.duplicateResources),
    conflicts: (analysis.conflictingResources ?? []).map((pair) => ({
      survivor: pair.survivorResource?.resource ?? "",
      duplicate: pair.duplicateResource?.resource ?? "",
    })),
  };
}
