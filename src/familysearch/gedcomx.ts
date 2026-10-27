// The slice of the GEDCOM X wire format this project reads, as FamilySearch
// serves it (`application/x-fs-v1+json` documents and
// `application/x-gedcomx-atom+json` feeds). Everything optional: the parsers
// in src/domain/normalize.ts are the only code that knows these field names,
// and they never assume a field is there.

export type GxRef = { resource?: string; resourceId?: string };

export type GxDate = { original?: string; formal?: string; normalized?: Array<{ value?: string }> };
export type GxPlace = { original?: string; normalized?: Array<{ value?: string }> };

export type GxFact = {
  id?: string;
  type?: string;
  date?: GxDate;
  place?: GxPlace;
  value?: string;
  primary?: boolean;
};

export type GxName = {
  type?: string;
  preferred?: boolean;
  nameForms?: Array<{ fullText?: string; parts?: Array<{ type?: string; value?: string }> }>;
};

export type GxDisplay = {
  name?: string;
  gender?: string;
  lifespan?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  ascendancyNumber?: string;
  descendancyNumber?: string;
};

export type GxPerson = {
  id?: string;
  living?: boolean;
  gender?: { type?: string };
  names?: GxName[];
  facts?: GxFact[];
  display?: GxDisplay;
  principal?: boolean;
};

export type GxRelationship = {
  id?: string;
  type?: string;
  person1?: GxRef;
  person2?: GxRef;
  facts?: GxFact[];
};

export type GxChildAndParents = {
  id?: string;
  parent1?: GxRef;
  parent2?: GxRef;
  child?: GxRef;
};

export type GxSourceDescription = {
  id?: string;
  about?: string;
  titles?: Array<{ value?: string }>;
  citations?: Array<{ value?: string }>;
};

export type GxNote = { id?: string; subject?: string; text?: string };

export type GxDocument = {
  persons?: Array<GxPerson & { notes?: GxNote[] }>;
  relationships?: GxRelationship[];
  childAndParentsRelationships?: GxChildAndParents[];
  sourceDescriptions?: GxSourceDescription[];
};

export type GxEntry = {
  id?: string;
  title?: string;
  updated?: number;
  score?: number;
  confidence?: number;
  contributors?: Array<{ name?: string }>;
  content?: { gedcomx?: GxDocument };
};

export type GxFeed = { results?: number; entries?: GxEntry[] };
