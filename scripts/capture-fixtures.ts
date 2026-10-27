#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import type { HttpRequest } from "../src/core/http.js";

// Captures the raw responses the fixtures are made from, into task/captures/
// (gitignored: raw captures never leave the machine). Then
// `bun run scripts/anonymize-fixture.ts` turns them into test/fixtures/.
//
// The subjects are PUBLIC figures, dead for over a century, on purpose: the
// fixtures must never carry the user's own family. Uses the saved session and
// the same paced http layer as the tools (one request at a time).

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "task", "captures");

const ATOM = "application/x-gedcomx-atom+json";
/** Abraham Lincoln (1809-1865). */
const PERSON = "LZJW-C31";
/** An old id FamilySearch merged into another person: answers 301. */
const MERGED = "LZJW-C61";
/** Another "Abraham Lincoln" born in Kentucky in 1809: the other half of a comparison. */
const OTHER = "G1CF-DLV";
/** A newspaper obituary of the same person, from the record search. */
const RECORD = "Q5SN-NK1T";

type Capture = { name: string; request: Omit<HttpRequest, "label"> };

const CAPTURES: Capture[] = [
  { name: "person", request: { method: "GET", path: `/platform/tree/persons/${PERSON}` } },
  { name: "person-merged", request: { method: "GET", path: `/platform/tree/persons/${MERGED}` } },
  { name: "families", request: { method: "GET", path: `/platform/tree/persons/${PERSON}/families` } },
  {
    name: "ancestry",
    request: { method: "GET", path: "/platform/tree/ancestry", query: { person: PERSON, generations: 3 } },
  },
  {
    name: "descendancy",
    request: { method: "GET", path: "/platform/tree/descendancy", query: { person: PERSON, generations: 2 } },
  },
  { name: "changes", request: { method: "GET", path: `/platform/tree/persons/${PERSON}/changes`, accept: ATOM } },
  { name: "sources", request: { method: "GET", path: `/platform/tree/persons/${PERSON}/sources` } },
  {
    name: "tree-search",
    request: {
      method: "GET",
      path: "/platform/tree/search",
      query: { "q.givenName": "Abraham", "q.surname": "Lincoln", "q.birthLikeDate": "1809", count: 3 },
      accept: ATOM,
    },
  },
  { name: "matches", request: { method: "GET", path: `/platform/tree/persons/${PERSON}/matches`, accept: ATOM } },
  {
    name: "record-search",
    request: {
      method: "GET",
      path: "/service/search/hr/v2/personas",
      query: { "q.givenName": "Abraham", "q.surname": "Lincoln", "q.birthLikeDate.from": "1809", count: 3 },
      accept: "application/json",
    },
  },
  { name: "person-b", request: { method: "GET", path: `/platform/tree/persons/${OTHER}` } },
  { name: "families-b", request: { method: "GET", path: `/platform/tree/persons/${OTHER}/families` } },
  { name: "sources-b", request: { method: "GET", path: `/platform/tree/persons/${OTHER}/sources` } },
  { name: "changes-b", request: { method: "GET", path: `/platform/tree/persons/${OTHER}/changes`, accept: ATOM } },
  { name: "merge-options", request: { method: "OPTIONS", path: `/platform/tree/persons/${PERSON}/merges/${OTHER}` } },
  {
    name: "merge-options-reverse",
    request: { method: "OPTIONS", path: `/platform/tree/persons/${OTHER}/merges/${PERSON}` },
  },
  { name: "merge-analysis", request: { method: "GET", path: `/platform/tree/persons/${PERSON}/merges/${OTHER}` } },
  { name: "record", request: { method: "GET", path: `/platform/records/personas/${RECORD}` } },
  {
    name: "places",
    request: { method: "GET", path: "/platform/places/search", query: { q: 'name:"Springfield"', count: 3 }, accept: ATOM },
  },
];

// `bun run scripts/capture-fixtures.ts record places` recaptures only those.
const only = new Set(process.argv.slice(2));
const ctx = createContext(loadConfig());
mkdirSync(OUT, { recursive: true });
for (const capture of CAPTURES.filter((item) => only.size === 0 || only.has(item.name))) {
  const response = await ctx.http.send({ ...capture.request, label: capture.name });
  const file = join(OUT, `${capture.name}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        status: response.status,
        location: response.headers.get("location"),
        allow: response.headers.get("allow"),
        warning: response.headers.get("warning"),
        body: response.body ? JSON.parse(response.body) : null,
      },
      null,
      2,
    ),
  );
  console.log(`${capture.name}: HTTP ${response.status} (${response.body.length} bytes)`);
}
