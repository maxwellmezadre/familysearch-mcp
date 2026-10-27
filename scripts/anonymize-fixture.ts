#!/usr/bin/env bun
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Turns the raw captures in task/captures/ into the fixtures committed under
// test/fixtures/. The repository is public, so this is the only path by which
// a real response may become a test.
//
// Design rules:
//  - DETERMINISTIC (HMAC with task/anonymize.salt): the same id always maps to
//    the same fake id, so the joins between person, families, ancestry and
//    changes still hold and the parsers are tested on relations, not shapes.
//  - IDS: every FamilySearch id (4 chars, dash, 3 or 4 chars, at least one
//    letter) is remapped, keeping its shape. Lifespans ("1809-1865") have no
//    letter and are left alone.
//  - NAMES: every word of a person or contributor name is swapped for a word
//    from a fixed list, keeping capitalisation; free text written by users
//    (change messages, notes, citations) is replaced wholesale.
//  - LIVING PEOPLE: dates and places dropped (the captures use public figures
//    dead for over a century, but the rule holds for any future capture).
//  - SIZE: long feeds are cut, bulky evidence blocks dropped.
//  - LEAK GUARD: the script fails if an original id survives, or any value
//    listed in task/anonymize.secrets (one per line) shows up.

const ROOT = join(import.meta.dir, "..");
const CAPTURES = join(ROOT, "task", "captures");
const OUT = join(ROOT, "test", "fixtures");
const SALT_FILE = join(ROOT, "task", "anonymize.salt");
const SECRETS_FILE = join(ROOT, "task", "anonymize.secrets");

// Lookarounds, not \b: ids also appear glued to "_" ("#sd_person_XXXX-XXX").
const ID = /(?<![A-Z0-9])(?=[A-Z0-9]{0,3}[A-Z])[A-Z0-9]{4}-[A-Z0-9]{3,4}(?![A-Z0-9])/g;
const ID_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ0123456789";
const WORDS = [
  "Ana", "Bento", "Clara", "Davi", "Elisa", "Fausto", "Gilda", "Hugo", "Iara", "Joaquim",
  "Lia", "Mauro", "Nina", "Otávio", "Paula", "Rui", "Sara", "Teodoro", "Vera", "Zeca",
  "Almeida", "Barros", "Campos", "Dias", "Esteves", "Farias", "Gomes", "Henriques", "Lima", "Moraes",
];
/** Keys whose string value is user-written text: replaced wholesale. */
const FREE_TEXT: Record<string, string> = {
  changeMessage: "Motivo de teste.",
  reason: "Motivo de teste.",
  text: "Texto de teste.",
  subject: "Assunto de teste",
};
/** Keys dropped: bulky, irrelevant to the parsers, and (attribution) about contributors. */
const DROPPED = new Set(["evidence", "sortKey", "identifiers", "attribution", "fields"]);
/** Only these captures keep their sources and source descriptions (the parsers read them there). */
const KEEPS_SOURCES = new Set(["sources.json", "record-search.json", "record.json"]);
let dropSources = false;
/** Captures with no people in them: their `name` fields are place names, left alone. */
const NO_PEOPLE = new Set(["places.json"]);
let keepNames = false;
/** Feeds cut to this many entries. */
const MAX_ENTRIES = 12;

if (!existsSync(SALT_FILE)) writeFileSync(SALT_FILE, randomBytes(24).toString("hex"));
const salt = readFileSync(SALT_FILE, "utf8").trim();
const hmac = (value: string) => createHmac("sha256", salt).update(value).digest();

const ids = new Map<string, string>();
function fakeId(real: string): string {
  const cached = ids.get(real);
  if (cached) return cached;
  const digest = hmac(`id:${real}`);
  const [left, right] = real.split("-") as [string, string];
  const pick = (index: number) => ID_ALPHABET[digest[index]! % ID_ALPHABET.length];
  let fake = "";
  for (let i = 0; i < left.length; i += 1) fake += pick(i);
  fake += "-";
  for (let i = 0; i < right.length; i += 1) fake += pick(8 + i);
  // A letter guarantees the fake id is still recognised as an id by the parsers.
  if (!/[A-Z]/.test(fake)) fake = `B${fake.slice(1)}`;
  ids.set(real, fake);
  return fake;
}

function fakeWord(word: string): string {
  const replacement = WORDS[hmac(`word:${word.toLowerCase()}`)[0]! % WORDS.length]!;
  return word === word.toUpperCase() ? replacement.toUpperCase() : replacement;
}
/** Every word seen in a name, so the same words are also swapped in titles and citations. */
const nameWords = new Set<string>();
const fakeName = (name: string): string =>
  name.replace(/\p{L}[\p{L}'’.-]*/gu, (word) => {
    // Only capitalised, letters-only words: never "http" or a domain that ended up in a name field.
    if (/^\p{Lu}\p{L}{2,}$/u.test(word)) nameWords.add(word);
    return fakeWord(word);
  });

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isLiving(node: { [key: string]: Json }): boolean {
  return node.living === true;
}

function walk(node: Json, key = "", parent: { [key: string]: Json } | null = null): Json {
  if (Array.isArray(node)) {
    const items = key === "entries" ? node.slice(0, MAX_ENTRIES) : node;
    return items.map((item) => walk(item, key, parent));
  }
  if (node && typeof node === "object") {
    const out: { [key: string]: Json } = {};
    const living = isLiving(node);
    for (const [childKey, value] of Object.entries(node)) {
      if (DROPPED.has(childKey)) continue;
      if (dropSources && (childKey === "sourceDescriptions" || childKey === "sources")) continue;
      if (living && (childKey === "facts")) continue;
      if (living && childKey === "display" && value && typeof value === "object" && !Array.isArray(value)) {
        const { birthDate, birthPlace, deathDate, deathPlace, lifespan, ...rest } = value;
        out.display = walk(rest, childKey, node);
        continue;
      }
      out[childKey] = walk(value, childKey, node);
    }
    return out;
  }
  if (typeof node === "string") {
    if (key in FREE_TEXT) return FREE_TEXT[key]!;
    const isPart = key === "value" && parent !== null && typeof parent.type === "string" && /Given|Surname|Prefix|Suffix/.test(parent.type);
    // `name` also labels URIs (qualifiers, field types): those are not people.
    if (!keepNames && (key === "fullText" || key === "name" || isPart) && !node.includes("://")) {
      return fakeName(node);
    }
    return node;
  }
  return node;
}

function anonymize(raw: string): string {
  const capture = JSON.parse(raw) as { status: number; location: string | null; body: Json };
  const body = walk(capture.body);
  const result = { status: capture.status, location: capture.location, body };
  let text = JSON.stringify(result, null, 2).replace(ID, (match) => fakeId(match));
  // Second pass: ids also appear glued to a role prefix ("P1XXXX-XXX" in
  // relationship member ids), where the lookarounds cannot see them.
  for (const [real, fake] of ids) text = text.split(real).join(fake);
  for (const word of nameWords) {
    text = text.replace(new RegExp(`(?<!\\p{L})${RegExp.escape(word)}(?!\\p{L})`, "gu"), fakeWord(word));
  }
  return text;
}

mkdirSync(OUT, { recursive: true });
const secrets = existsSync(SECRETS_FILE)
  ? readFileSync(SECRETS_FILE, "utf8").split("\n").map((line) => line.trim()).filter(Boolean)
  : [];
let failed = false;
for (const file of readdirSync(CAPTURES).filter((name) => name.endsWith(".json")).sort()) {
  const raw = readFileSync(join(CAPTURES, file), "utf8");
  dropSources = !KEEPS_SOURCES.has(file);
  keepNames = NO_PEOPLE.has(file);
  const output = anonymize(raw);
  const leaked = [...new Set(raw.match(ID) ?? [])].filter((id) => output.includes(id));
  const secret = secrets.filter((value) => output.includes(value));
  if (leaked.length > 0 || secret.length > 0) {
    console.error(`${file}: vazou ${[...leaked, ...secret].join(", ")}`);
    failed = true;
    continue;
  }
  writeFileSync(join(OUT, file), `${output}\n`);
  console.log(`${file}: ${Math.round(output.length / 1024)} KB`);
}
if (failed) process.exit(1);
