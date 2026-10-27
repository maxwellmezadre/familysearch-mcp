import type {
  GxDocument,
  GxEntry,
  GxFact,
  GxFeed,
  GxNote,
  GxPerson,
  GxRef,
  GxSourceDescription,
} from "../familysearch/gedcomx.js";
import type {
  ChangeEntry,
  Fact,
  Family,
  Gender,
  GenDate,
  GenEvent,
  Memory,
  Note,
  NumberedPerson,
  PersonDetail,
  PersonSummary,
  SearchHit,
  SourceRef,
} from "./types.js";

// GEDCOM X → the project's vocabulary. The only module that knows FamilySearch
// field names (besides the wire types). Every reader tolerates a missing
// field: a person with no names, no facts or no display block still comes out
// as a valid PersonSummary.

/** "http://gedcomx.org/Birth" → "Birth"; "data:,Address+of+Cemetery" → "Address of Cemetery". */
export function shortType(type: string | undefined): string {
  if (!type) return "Unknown";
  if (type.startsWith("data:,")) {
    const label = type.slice("data:,".length).replace(/\+/g, " ");
    try {
      return decodeURIComponent(label);
    } catch {
      return label;
    }
  }
  return type.slice(type.lastIndexOf("/") + 1) || type;
}

function toGender(value: string | undefined): Gender {
  const short = shortType(value).toLowerCase();
  return short === "male" ? "male" : short === "female" ? "female" : "unknown";
}

function toDate(date: GxFact["date"]): GenDate | null {
  const original = date?.original ?? date?.normalized?.[0]?.value;
  return original ? { original, formal: date?.formal ?? null } : null;
}

function placeOf(fact: GxFact): string | null {
  return fact.place?.normalized?.[0]?.value ?? fact.place?.original ?? null;
}

export function toFact(fact: GxFact): Fact {
  return {
    id: fact.id ?? null,
    type: shortType(fact.type),
    date: toDate(fact.date),
    place: placeOf(fact),
    value: fact.value ? fact.value : null,
  };
}

/** The fact first (it has the standardized date), the display block as fallback. */
function eventOf(person: GxPerson, type: "Birth" | "Death"): GenEvent | null {
  const facts = (person.facts ?? []).filter((fact) => shortType(fact.type) === type);
  const fact = facts.find((candidate) => candidate.primary) ?? facts[0];
  if (fact) {
    const event = { date: toDate(fact.date), place: placeOf(fact) };
    if (event.date || event.place) return event;
  }
  const display = person.display ?? {};
  const date = type === "Birth" ? display.birthDate : display.deathDate;
  const place = type === "Birth" ? display.birthPlace : display.deathPlace;
  return date || place ? { date: date ? { original: date, formal: null } : null, place: place ?? null } : null;
}

function allNames(person: GxPerson): string[] {
  const preferred = [...(person.names ?? [])].sort(
    (a, b) => Number(b.preferred === true) - Number(a.preferred === true),
  );
  const names = preferred.flatMap((name) => (name.nameForms ?? []).map((form) => form.fullText ?? ""));
  return [...new Set(names.filter((name) => name.trim() !== ""))];
}

export function toPersonSummary(person: GxPerson): PersonSummary {
  return {
    id: person.id ?? "",
    name: person.display?.name ?? allNames(person)[0] ?? null,
    gender: toGender(person.display?.gender ?? person.gender?.type),
    living: person.living === true,
    lifespan: person.display?.lifespan ?? null,
    birth: eventOf(person, "Birth"),
    death: eventOf(person, "Death"),
  };
}

export function toPersonDetail(person: GxPerson): PersonDetail {
  return { ...toPersonSummary(person), names: allNames(person), facts: (person.facts ?? []).map(toFact) };
}

const idOf = (ref: GxRef | undefined): string | null => ref?.resourceId ?? null;

/** Parents, spouses and children of `focusId`, from a `/families` document. */
export function toFamily(document: GxDocument, focusId: string): Family {
  const people = new Map<string, PersonSummary>();
  for (const person of document.persons ?? []) {
    if (person.id) people.set(person.id, toPersonSummary(person));
  }
  const summary = (id: string | null): PersonSummary | null =>
    id === null ? null : (people.get(id) ?? toPersonSummary({ id }));

  const links = document.childAndParentsRelationships ?? [];
  const parents = links
    .filter((link) => idOf(link.child) === focusId && link.id)
    .map((link) => ({
      relationshipId: link.id as string,
      parent1: summary(idOf(link.parent1)),
      parent2: summary(idOf(link.parent2)),
    }));

  const asParent = links.filter(
    (link) => idOf(link.parent1) === focusId || idOf(link.parent2) === focusId,
  );
  const otherParent = (link: (typeof links)[number]): string | null =>
    idOf(link.parent1) === focusId ? idOf(link.parent2) : idOf(link.parent1);
  const childrenWith = (spouseId: string | null): PersonSummary[] =>
    asParent
      .filter((link) => otherParent(link) === spouseId)
      .map((link) => summary(idOf(link.child)))
      .filter((child): child is PersonSummary => child !== null);

  const couples = (document.relationships ?? []).filter(
    (relationship) =>
      shortType(relationship.type) === "Couple" &&
      (idOf(relationship.person1) === focusId || idOf(relationship.person2) === focusId),
  );
  const spouses: Family["spouses"] = couples.map((couple) => {
    const spouseId =
      idOf(couple.person1) === focusId ? idOf(couple.person2) : idOf(couple.person1);
    const marriageFact = (couple.facts ?? []).find((fact) => shortType(fact.type) === "Marriage");
    return {
      relationshipId: couple.id ?? null,
      spouse: summary(spouseId),
      marriage: marriageFact ? { date: toDate(marriageFact.date), place: placeOf(marriageFact) } : null,
      children: childrenWith(spouseId),
    };
  });
  // Children recorded with no other parent, or with a parent who is not a spouse.
  const covered = new Set(couples.map((couple) =>
    idOf(couple.person1) === focusId ? idOf(couple.person2) : idOf(couple.person1),
  ));
  const others = [...new Set(asParent.map(otherParent))].filter((id) => !covered.has(id));
  for (const id of others) {
    spouses.push({ relationshipId: null, spouse: summary(id), marriage: null, children: childrenWith(id) });
  }
  return { parents, spouses };
}

/** Ancestry or descendancy: every person with FamilySearch's position number. */
export function toNumbered(
  document: GxDocument,
  key: "ascendancyNumber" | "descendancyNumber",
): NumberedPerson[] {
  return (document.persons ?? []).map((person) => ({
    number: person.display?.[key] ?? "?",
    ...toPersonSummary(person),
  }));
}

export function toChanges(feed: GxFeed): ChangeEntry[] {
  return (feed.entries ?? []).map((entry) => ({
    id: entry.id ?? "",
    at: typeof entry.updated === "number" ? new Date(entry.updated).toISOString() : null,
    who: entry.contributors?.[0]?.name ?? null,
    what: entry.title ?? "",
  }));
}

function principalOf(entry: GxEntry): GxPerson | undefined {
  const persons = entry.content?.gedcomx?.persons ?? [];
  return persons.find((person) => person.id === entry.id) ?? persons.find((person) => person.principal) ?? persons[0];
}

export function toSearchHits(feed: GxFeed): SearchHit[] {
  return (feed.entries ?? []).flatMap((entry) => {
    const person = principalOf(entry);
    if (!person) return [];
    return [
      {
        ...toPersonSummary({ ...person, id: person.id ?? entry.id }),
        confidence: entry.confidence ?? null,
        score: entry.score ?? null,
      },
    ];
  });
}

export function toSources(document: GxDocument | null): SourceRef[] {
  return (document?.sourceDescriptions ?? []).map((source: GxSourceDescription) => ({
    id: source.id ?? "",
    title: source.titles?.[0]?.value ?? null,
    citation: source.citations?.[0]?.value ?? null,
    url: source.about ?? null,
  }));
}

export function toNotes(document: GxDocument | null): Note[] {
  return (document?.persons?.[0]?.notes ?? []).map((note: GxNote) => ({
    id: note.id ?? "",
    subject: note.subject ?? null,
    text: note.text ?? null,
  }));
}

export function toMemories(document: GxDocument | null): Memory[] {
  return (document?.sourceDescriptions ?? []).map((memory) => ({
    id: memory.id ?? "",
    title: memory.titles?.[0]?.value ?? null,
    url: memory.about ?? null,
  }));
}
