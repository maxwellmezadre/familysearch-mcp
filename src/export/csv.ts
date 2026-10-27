import { personUrl } from "../domain/normalize.js";
import type { ExportPerson } from "./gedcom.js";

// RFC 4180 quoting: a field with a comma, quote or line break is wrapped in
// quotes and its quotes are doubled.
const field = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const HEADER = "id,name,gender,living,birth_date,birth_place,death_date,death_place,ascendancy,generation,url";

/** `baseUrl` is the configured environment's: a beta export links to beta. */
export function toCsv(people: ExportPerson[], baseUrl: string): string {
  const rows = people.map((p) =>
    [
      p.id,
      p.name,
      p.gender,
      p.living,
      p.birthDate,
      p.birthPlace,
      p.deathDate,
      p.deathPlace,
      p.ascendancy,
      p.generation,
      personUrl(baseUrl, p.id),
    ]
      .map(field)
      .join(","),
  );
  return `${[HEADER, ...rows].join("\n")}\n`;
}
