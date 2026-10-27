import type { PlannedWrite, WriteResult } from "../core/ticket.js";
import { RECORDS_COLLECTION } from "./api.js";

// Request builders for every FamilySearch write. They only describe the
// request (a PlannedWrite); sending goes through the approval gate and
// `runWritePlan`. Shapes are the ones proven on the beta API, to be
// reconfirmed live (plan 2, task 9).

const GX = "http://gedcomx.org/";
const TREE = "/platform/tree";

/** An id that goes into a URL path: no `/`, `?`, `#`, `%` or dot segments, so a path can never resolve elsewhere. */
function seg(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || /^\.+$/.test(id)) {
    throw new Error(`Identificador inválido: "${id}". Use só letras, números, ponto, hífen e sublinhado.`);
  }
  return id;
}

export const personUri = (baseUrl: string, id: string) => `${baseUrl}${TREE}/persons/${seg(id)}`;

// ponytail: the common GEDCOM X fact types, by lower case so "birth" is Birth;
// anything else becomes a custom `data:,` type.
const KNOWN_FACTS = new Map(
  `Adoption AdultChristening Annulment Baptism BarMitzvah BatMitzvah Birth Blessing Burial Census
Christening Circumcision Confirmation Cremation Death Divorce DivorceFiling Education Emigration
Engagement Excommunication FirstCommunion Funeral Immigration Imprisonment LandTransaction Marriage
MarriageBanns MarriageContract MarriageLicense MilitaryAward MilitaryDischarge MilitaryDraftRegistration
MilitaryInduction MilitaryService Mission MoveFrom MoveTo Naturalization Nationality NobilityTitle
Occupation Ordination Probate Property Residence Retirement Stillbirth Will`
    .split(/\s+/)
    .map((type) => [type.toLowerCase(), type]),
);

export function factType(short: string): string {
  const known = KNOWN_FACTS.get(short.trim().toLowerCase());
  if (known) return `${GX}${known}`;
  if (short.startsWith("http://") || short.startsWith("https://") || short.startsWith("data:,")) return short;
  return `data:,${encodeURIComponent(short)}`;
}

export type FactInput = { type: string; date?: string; place?: string; value?: string };
export type NewPerson = {
  givenName: string;
  surname: string;
  gender: "male" | "female" | "unknown";
  living: boolean;
  facts: FactInput[];
};

const fact = (f: FactInput, id?: string) => ({
  ...(id ? { id } : {}),
  type: factType(f.type),
  ...(f.date ? { date: { original: f.date } } : {}),
  ...(f.place ? { place: { original: f.place } } : {}),
  ...(f.value ? { value: f.value } : {}),
});

const name = (givenName: string, surname: string, birth: boolean) => ({
  ...(birth ? { type: `${GX}BirthName`, preferred: true } : {}),
  nameForms: [
    {
      fullText: `${givenName} ${surname}`.trim(),
      parts: [
        { type: `${GX}Given`, value: givenName },
        { type: `${GX}Surname`, value: surname },
      ],
    },
  ],
});

const GENDER = { male: `${GX}Male`, female: `${GX}Female`, unknown: `${GX}Unknown` };
const ref = (baseUrl: string, id: string) => ({ resource: personUri(baseUrl, id), resourceId: seg(id) });
const label = (f: FactInput) => `${f.type}${f.date ? ` ${f.date}` : ""}${f.place ? ` em ${f.place}` : ""}`;

export const createPersonWrite = (p: NewPerson): PlannedWrite => ({
  method: "POST",
  path: `${TREE}/persons`,
  label: "create person",
  summary: `Criar a pessoa ${p.givenName} ${p.surname}`.trim(),
  body: {
    persons: [
      {
        gender: { type: GENDER[p.gender] },
        living: p.living,
        names: [name(p.givenName, p.surname, true)],
        ...(p.facts.length > 0 ? { facts: p.facts.map((f) => fact(f)) } : {}),
      },
    ],
  },
});

export function personUpdateWrite(
  rawId: string,
  change: {
    addFacts?: FactInput[];
    updateFacts?: Array<FactInput & { factId: string }>;
    gender?: "male" | "female";
    addName?: { givenName: string; surname: string };
  },
): PlannedWrite {
  const id = seg(rawId);
  const facts = [
    ...(change.addFacts ?? []).map((f) => fact(f)),
    ...(change.updateFacts ?? []).map((f) => fact(f, f.factId)),
  ];
  const parts = [
    ...(change.addFacts ?? []).map((f) => `adicionar ${label(f)}`),
    ...(change.updateFacts ?? []).map((f) => `alterar o fato ${f.factId} para ${label(f)}`),
    ...(change.gender ? [`mudar o gênero para ${change.gender === "male" ? "masculino" : "feminino"}`] : []),
    ...(change.addName ? [`adicionar o nome ${change.addName.givenName} ${change.addName.surname}`] : []),
  ];
  return {
    method: "POST",
    path: `${TREE}/persons/${id}`,
    label: "update person",
    summary: `Em ${id}: ${parts.join("; ")}`,
    body: {
      persons: [
        {
          id,
          ...(facts.length > 0 ? { facts } : {}),
          ...(change.addName ? { names: [name(change.addName.givenName, change.addName.surname, false)] } : {}),
          ...(change.gender ? { gender: { type: GENDER[change.gender] } } : {}),
        },
      ],
    },
  };
}

export const deleteConclusionWrite = (personId: string, conclusionId: string): PlannedWrite => ({
  method: "DELETE",
  path: `${TREE}/persons/${seg(personId)}/conclusions/${seg(conclusionId)}`,
  label: "delete conclusion",
  summary: `Remover o fato ${conclusionId} de ${personId}`,
});

export function linkParentsWrite(
  baseUrl: string,
  childId: string,
  parent1Id?: string,
  parent2Id?: string,
): PlannedWrite {
  if (!parent1Id && !parent2Id) throw new Error("Informe pelo menos um pai ou mãe para ligar ao filho.");
  const parents = [parent1Id, parent2Id].filter(Boolean).join(" e ");
  return {
    method: "POST",
    path: `${TREE}/relationships`,
    label: "link parents",
    summary: `Ligar ${childId} como filho(a) de ${parents}`,
    body: {
      childAndParentsRelationships: [
        {
          ...(parent1Id ? { parent1: ref(baseUrl, parent1Id) } : {}),
          ...(parent2Id ? { parent2: ref(baseUrl, parent2Id) } : {}),
          child: ref(baseUrl, childId),
        },
      ],
    },
  };
}

export const linkSpousesWrite = (
  baseUrl: string,
  person1Id: string,
  person2Id: string,
  marriage?: FactInput,
): PlannedWrite => ({
  method: "POST",
  path: `${TREE}/relationships`,
  label: "link spouses",
  summary: `Ligar ${person1Id} e ${person2Id} como casal${marriage ? ` (${label(marriage)})` : ""}`,
  body: {
    relationships: [
      {
        type: `${GX}Couple`,
        person1: ref(baseUrl, person1Id),
        person2: ref(baseUrl, person2Id),
        ...(marriage ? { facts: [fact(marriage)] } : {}),
      },
    ],
  },
});

const REL_PATH = { couple: "couple-relationships", parents: "child-and-parents-relationships" } as const;

export const deleteRelationshipWrite = (kind: "couple" | "parents", relationshipId: string): PlannedWrite => ({
  method: "DELETE",
  path: `${TREE}/${REL_PATH[kind]}/${seg(relationshipId)}`,
  label: "delete relationship",
  summary: `Remover o relacionamento ${relationshipId}`,
});

export const createSourceWrite = (source: { title: string; citation?: string; about?: string }): PlannedWrite => ({
  method: "POST",
  path: "/platform/sources/descriptions",
  label: "create source",
  summary: `Criar a fonte "${source.title}"`,
  body: {
    sourceDescriptions: [
      {
        ...(source.about ? { about: source.about } : {}),
        titles: [{ value: source.title }],
        ...(source.citation ? { citations: [{ value: source.citation }] } : {}),
      },
    ],
  },
});

/** Must follow `createSourceWrite`: its body reads the Location of the source just created. */
export const attachSourceWrite = (personId: string): PlannedWrite => ({
  method: "POST",
  path: `${TREE}/persons/${seg(personId)}`,
  label: "attach source",
  summary: `Anexar a fonte criada a ${personId}`,
  body: (prior: WriteResult[]) => {
    const location = [...prior].reverse().find((r) => r.location)?.location;
    if (!location) throw new Error("A fonte não devolveu o endereço (Location); não dá para anexá-la.");
    return { persons: [{ id: personId, sources: [{ description: location }] }] };
  },
});

const NOTE_TARGET = {
  person: { path: "persons", key: "persons" },
  couple: { path: "couple-relationships", key: "relationships" },
  parents: { path: "child-and-parents-relationships", key: "childAndParentsRelationships" },
} as const;

export function noteWrite(
  target: { kind: "person" | "couple" | "parents"; id: string },
  note: { subject: string; text: string },
): PlannedWrite {
  const { path, key } = NOTE_TARGET[target.kind];
  return {
    method: "POST",
    path: `${TREE}/${path}/${seg(target.id)}/notes`,
    label: "add note",
    summary: `Adicionar a nota "${note.subject}" em ${target.id}`,
    body: { [key]: [{ id: target.id, notes: [{ subject: note.subject, text: note.text }] }] },
  };
}

export const matchResolutionWrite = (
  personId: string,
  recordUrl: string,
  status: "accepted" | "rejected",
): PlannedWrite => ({
  method: "POST",
  path: `${TREE}/persons/${seg(personId)}/matches`,
  query: { status, collection: RECORDS_COLLECTION },
  label: "resolve match",
  summary: `${status === "accepted" ? "Aceitar" : "Rejeitar"} o registro ${recordUrl} para ${personId}`,
  body: { persons: [{ identifiers: { $: [recordUrl] } }] },
});

export const notAMatchWrite = (personId: string, otherId: string): PlannedWrite => ({
  method: "POST",
  path: `${TREE}/persons/${seg(personId)}/not-a-match`,
  label: "not a match",
  summary: `Marcar ${personId} e ${otherId} como pessoas diferentes`,
  body: { persons: [{ id: seg(otherId) }] },
});

export const mergeWrite = (
  survivorId: string,
  duplicateId: string,
  request: { resourcesToCopy: string[]; resourcesToDelete: string[] },
): PlannedWrite => ({
  method: "POST",
  path: `${TREE}/persons/${seg(survivorId)}/merges/${seg(duplicateId)}`,
  label: "merge persons",
  summary: `Mesclar ${duplicateId} em ${survivorId}`,
  body: {
    merges: [
      {
        resourcesToCopy: request.resourcesToCopy.map((resource) => ({ resource })),
        resourcesToDelete: request.resourcesToDelete.map((resource) => ({ resource })),
      },
    ],
  },
});

export const restoreWrite = (personId: string): PlannedWrite => ({
  method: "POST",
  path: `${TREE}/persons/${seg(personId)}/restore`,
  label: "restore person",
  summary: `Restaurar ${personId}`,
});
