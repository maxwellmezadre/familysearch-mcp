// The project's own vocabulary. Tools return these shapes, never raw GEDCOM X.

/**
 * Genealogical dates are rarely exact ("abt 1850", "1921", "March 1922").
 * The text as entered is kept, next to FamilySearch's standardized form
 * (`+1809-02-12`, `+1840`, `A+1850`) when there is one; neither is ever forced
 * into a Date.
 */
export type GenDate = { original: string; formal: string | null };
export type GenEvent = { date: GenDate | null; place: string | null };

export type Gender = "male" | "female" | "unknown";

export type PersonSummary = {
  id: string;
  name: string | null;
  gender: Gender;
  living: boolean;
  lifespan: string | null;
  birth: GenEvent | null;
  death: GenEvent | null;
};

export type Fact = {
  id: string | null;
  /** Short type: "Birth", "Residence", or the decoded label of a custom fact. */
  type: string;
  date: GenDate | null;
  place: string | null;
  value: string | null;
};

export type PersonDetail = PersonSummary & { names: string[]; facts: Fact[] };

export type Family = {
  parents: Array<{ relationshipId: string; parent1: PersonSummary | null; parent2: PersonSummary | null }>;
  spouses: Array<{
    relationshipId: string | null;
    spouse: PersonSummary | null;
    marriage: GenEvent | null;
    children: PersonSummary[];
  }>;
};

/** A person inside a pedigree: `number` is FamilySearch's ascendancy/descendancy number. */
export type NumberedPerson = PersonSummary & { number: string };

export type ChangeEntry = { id: string; at: string | null; who: string | null; what: string };

export type SearchHit = PersonSummary & { confidence: number | null; score: number | null };

export type SourceRef = { id: string; title: string | null; citation: string | null; url: string | null };
export type Note = { id: string; subject: string | null; text: string | null };
export type Memory = { id: string; title: string | null; url: string | null };

export type TreeQuery = {
  givenName?: string;
  surname?: string;
  gender?: "male" | "female";
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  fatherName?: string;
  motherName?: string;
  spouseName?: string;
  limit?: number;
};

/** A historical record (an indexed persona) from the record search. */
export type RecordHit = {
  id: string;
  name: string | null;
  collection: string | null;
  eventType: string | null;
  event: GenEvent | null;
  confidence: number | null;
  url: string;
};

export type RecordDetail = {
  id: string;
  collection: string | null;
  /** The person the record is about comes first (`principal`), then the others named in it. */
  persons: Array<PersonDetail & { principal: boolean }>;
  imageUrl: string | null;
  url: string;
};

export type Place = { id: string; name: string; fullName: string; type: string | null };

export type RecordQuery = {
  givenName?: string;
  surname?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  fatherName?: string;
  motherName?: string;
  spouseName?: string;
  collectionId?: string;
  limit?: number;
};

// ---- comparison and merge ----------------------------------------------------

export type MergeConstraint = "allowed" | "other-order-only" | "not-allowed";
/** FamilySearch's answer to "can X survive a merge with Y?", with its own reason when it says no. */
export type MergeCheck = { constraint: MergeConstraint; reason: string | null };

/** Resource URIs exactly as FamilySearch lists them: a merge request sends them back verbatim. */
export type MergeAnalysis = {
  survivorResources: string[];
  duplicateResources: string[];
  conflicts: Array<{ survivor: string; duplicate: string }>;
};

export type PersonBundle = {
  person: PersonDetail;
  family: Family;
  sourceCount: number;
  changeCount: number;
  lastChangeId: string | null;
};

export type Suggestion = { survivorId: string; duplicateId: string; why: string };

export type Comparison = {
  a: PersonBundle;
  b: PersonBundle;
  onlyA: Fact[];
  onlyB: Fact[];
  conflicts: Array<{ type: string; a: Fact; b: Fact }>;
  /** Signs that the two are NOT the same person. Each one is a reason to stop and look. */
  redFlags: string[];
  /** merge: FamilySearch can merge them; relink: one is living; blocked: FamilySearch refuses. */
  path: "merge" | "relink" | "blocked";
  pathReason: string;
  suggestion: Suggestion | null;
  analysis: MergeAnalysis | null;
  /** The last change of each person; a merge checks that nothing changed since the comparison. */
  fingerprint: string;
};
