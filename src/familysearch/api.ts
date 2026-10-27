import { DeletedError, HttpError, MergedError, NotFoundError, ParseError } from "../core/errors.js";
import type { Http, HttpRequest } from "../core/http.js";
import { normalizeSearchDate } from "../domain/dates.js";
import type { TreeQuery } from "../domain/types.js";
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
export async function getJson<T>(http: Http, request: HttpRequest, subject?: string): Promise<T | null> {
  const response = await http.send(request);
  const about = subject ?? request.label;
  if (response.status === 204) return null;
  if (response.status === 301) {
    const survivor = response.headers.get("location")?.split("?")[0]?.split("/").pop() ?? "?";
    throw new MergedError(about, survivor);
  }
  if (response.status === 400 || response.status === 404) throw new NotFoundError(about);
  if (response.status === 410) throw new DeletedError(about);
  if (response.status >= 400) {
    const warning = response.headers.get("warning");
    throw new HttpError(
      response.status,
      `O FamilySearch respondeu HTTP ${response.status} em ${request.label}${warning ? `: ${warning}` : "."}`,
    );
  }
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
