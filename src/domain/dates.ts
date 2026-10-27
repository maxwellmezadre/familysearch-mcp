// FamilySearch's search answers HTTP 400 to anything but a bare year or an ISO
// date ("Failure in upstream call"). A written-out or approximate date becomes
// its year; a range or a decade drops the parameter, because sending one year
// would NARROW the search instead of widening it.

const RANGE =
  /(?<!\p{L})(between|bet|after|aft|before|bef|from|to|until|since|entre|depois|após|apos|antes|desde|até|ate)(?!\p{L})/iu;
const DECADE = /\d{3}0'?s(?!\p{L})/iu;

function isValidIso(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeSearchDate(input: string): string | undefined {
  const text = input.trim();
  if (text === "") return undefined;
  if (/^\d{4}$/.test(text)) return text;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return isValidIso(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? text : undefined;
  if (RANGE.test(text) || DECADE.test(text)) return undefined;
  const years = text.match(/(?<!\d)\d{4}(?!\d)/g) ?? [];
  return years.length === 1 ? years[0] : undefined;
}
