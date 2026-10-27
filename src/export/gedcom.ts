import pkg from "../../package.json" with { type: "json" };
import type { CachedPerson, CachedRelationship } from "../cache/repo.js";

// GEDCOM 5.5.1 writer. Living people arrive already masked (see `toExportPerson`),
// so nothing here needs to know about privacy.

/** A cached person minus the raw GEDCOM X payload, masked when living. */
export type ExportPerson = Omit<CachedPerson, "raw">;

export type ExportData = {
  rootId: string;
  persons: ExportPerson[];
  relationships: CachedRelationship[];
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** FamilySearch formal date to a GEDCOM date; anything unparseable becomes a date phrase. */
export function gedcomDate(date: { original: string; formal: string | null } | null): string | null {
  if (!date) return null;
  const match = date.formal?.match(/^(A)?\+(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  const month = match?.[3] ? MONTHS[Number(match[3]) - 1] : undefined;
  if (!match || (match[3] && !month)) return `(${clean(date.original).replace(/\(/g, "[").replace(/\)/g, "]")})`;
  const text = [match[4] ? String(Number(match[4])) : null, month, String(Number(match[2]))].filter(Boolean).join(" ");
  return match[1] ? `ABT ${text}` : text;
}

/** Drops `raw`; with `mask`, a living person also loses name, dates and places (id and family links stay). */
export function toExportPerson(person: CachedPerson, mask: boolean): ExportPerson {
  const { raw: _raw, ...rest } = person;
  if (!mask || !person.living) return rest;
  return {
    ...rest,
    name: "Pessoa viva",
    given: "Pessoa",
    surname: "viva",
    lifespan: null,
    birthDate: null,
    birthFormal: null,
    birthPlace: null,
    deathDate: null,
    deathFormal: null,
    deathPlace: null,
  };
}

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

function nameLine(p: ExportPerson): string {
  let given = p.given;
  let surname = p.surname;
  if (!given && !surname) {
    // ponytail: no name parts cached, so the last word is the surname
    const words = clean(p.name ?? "").split(" ").filter(Boolean);
    surname = words.length > 1 ? (words.pop() as string) : null;
    given = words.join(" ");
  }
  const last = clean(surname ?? "");
  return `1 NAME ${[clean(given ?? ""), last && `/${last}/`].filter(Boolean).join(" ")}`;
}

function event(tag: string, date: string | null, formal: string | null, place: string | null): string[] {
  const d = gedcomDate(date ? { original: date, formal } : null);
  if (!d && !place) return [];
  return [`1 ${tag}`, ...(d ? [`2 DATE ${d}`] : []), ...(place ? [`2 PLAC ${clean(place)}`] : [])];
}

export function toGedcom(data: ExportData, at: Date): string {
  const index = new Map(data.persons.map((p, i) => [p.id, i + 1]));
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const ref = (id: string) => `@I${index.get(id)}@`;

  // One family per pair of parents; a couple without children still gets one.
  const families = new Map<string, { parents: string[]; children: string[] }>();
  const family = (ids: Array<string | null>) => {
    const parents = ids.filter((id): id is string => !!id && index.has(id));
    const key = [...parents].sort().join("|");
    if (!families.has(key)) families.set(key, { parents, children: [] });
    return families.get(key) as { parents: string[]; children: string[] };
  };
  for (const r of data.relationships) {
    if (r.kind === "couple") family([r.person1, r.person2]);
    else if (r.child && index.has(r.child)) family([r.person1, r.person2]).children.push(r.child);
  }
  const fams = [...families.values()].filter((f) => f.parents.length + f.children.length > 1 && f.parents.length > 0);

  const famOf = new Map<string, { spouse: number[]; child: number[] }>();
  const link = (id: string) => famOf.get(id) ?? famOf.set(id, { spouse: [], child: [] }).get(id)!;
  const famLines = fams.flatMap((f, i) => {
    const n = i + 1;
    // Husband is the male parent; with unknown genders the first parent is.
    const [a, b] = f.parents as [string, string | undefined];
    const swap = b && (byId.get(a)?.gender === "female" || byId.get(b)?.gender === "male");
    const [husb, wife] = swap ? [b, a] : [a, b];
    for (const id of f.parents) link(id).spouse.push(n);
    for (const id of f.children) link(id).child.push(n);
    return [
      `0 @F${n}@ FAM`,
      ...(husb ? [`1 HUSB ${ref(husb)}`] : []),
      ...(wife ? [`1 WIFE ${ref(wife)}`] : []),
      ...f.children.map((c) => `1 CHIL ${ref(c)}`),
    ];
  });

  const indiLines = data.persons.flatMap((p) => [
    `0 ${ref(p.id)} INDI`,
    nameLine(p),
    `1 SEX ${p.gender === "male" ? "M" : p.gender === "female" ? "F" : "U"}`,
    ...event("BIRT", p.birthDate, p.birthFormal, p.birthPlace),
    ...event("DEAT", p.deathDate, p.deathFormal, p.deathPlace),
    `1 _FSFTID ${p.id}`,
    ...(famOf.get(p.id)?.child ?? []).map((n) => `1 FAMC @F${n}@`),
    ...(famOf.get(p.id)?.spouse ?? []).map((n) => `1 FAMS @F${n}@`),
  ]);

  const day = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
  return `${[
    "0 HEAD",
    "1 SOUR familysearch-mcp",
    `2 VERS ${pkg.version}`,
    `1 DATE ${day}`,
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8",
    ...indiLines,
    ...famLines,
    "0 TRLR",
  ].join("\n")}\n`;
}
