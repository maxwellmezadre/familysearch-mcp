import type {
  ChangeEntry,
  Fact,
  Family,
  GenEvent,
  NumberedPerson,
  PersonDetail,
  PersonSummary,
  Place,
  RecordDetail,
  RecordHit,
  SearchHit,
} from "../domain/types.js";
import { printTable } from "./output.js";

// Human renderings for the CLI. `--json` bypasses all of this.

export const eventText = (event: GenEvent | null): string =>
  event ? [event.date?.original, event.place].filter(Boolean).join(", ") || "-" : "-";

const who = (person: PersonSummary | null): string =>
  person ? `${person.name ?? "(sem nome)"} [${person.id}]${person.lifespan ? ` ${person.lifespan}` : ""}` : "-";

export const formatSearch = (result: unknown): string => {
  const data = result as { total: number; people: SearchHit[] };
  const table = printTable(data.people, [
    ["ID", (row) => row.id],
    ["CONF", (row) => String(row.confidence ?? "-")],
    ["NOME", (row) => row.name ?? "-"],
    ["VIDA", (row) => row.lifespan ?? "-"],
    ["NASCIMENTO", (row) => eventText(row.birth).slice(0, 50)],
  ]);
  return `${table}\n\n${data.people.length} de ${data.total}`;
};

const factLine = (fact: Fact): string =>
  `  ${fact.type}: ${[fact.date?.original, fact.place, fact.value].filter(Boolean).join(", ") || "-"}`;

export const formatPerson = (result: unknown): string => {
  const person = result as PersonDetail & { url: string; sources?: Array<{ title: string | null }> };
  const lines = [
    `${person.name ?? "(sem nome)"} [${person.id}]${person.living ? " (viva)" : ""}`,
    `sexo: ${person.gender}   vida: ${person.lifespan ?? "-"}`,
    ...(person.names.length > 1 ? [`outros nomes: ${person.names.slice(1).join("; ")}`] : []),
    "fatos:",
    ...(person.facts.length > 0 ? person.facts.map(factLine) : ["  (nenhum)"]),
  ];
  if (person.sources) {
    lines.push(`fontes (${person.sources.length}):`, ...person.sources.map((source) => `  ${source.title ?? "-"}`));
  }
  lines.push(person.url);
  return lines.join("\n");
};

export const formatFamily = (result: unknown): string => {
  const family = result as Family & { person: PersonSummary };
  const lines = [who(family.person), "pais:"];
  if (family.parents.length === 0) lines.push("  (nenhum)");
  for (const parents of family.parents) lines.push(`  ${who(parents.parent1)}  +  ${who(parents.parent2)}`);
  lines.push("cônjuges e filhos:");
  if (family.spouses.length === 0) lines.push("  (nenhum)");
  for (const couple of family.spouses) {
    lines.push(`  ${who(couple.spouse)}${couple.marriage ? `  casamento: ${eventText(couple.marriage)}` : ""}`);
    for (const child of couple.children) lines.push(`    - ${who(child)}`);
  }
  return lines.join("\n");
};

export const formatPedigree = (result: unknown): string => {
  const data = result as { people: NumberedPerson[] };
  return printTable(data.people, [
    ["Nº", (row) => row.number],
    ["ID", (row) => row.id],
    ["NOME", (row) => row.name ?? "-"],
    ["VIDA", (row) => row.lifespan ?? "-"],
  ]);
};

export const formatChanges = (result: unknown): string => {
  const data = result as { changes: ChangeEntry[] };
  return printTable(data.changes, [
    ["QUANDO", (row) => row.at?.slice(0, 10) ?? "-"],
    ["QUEM", (row) => (row.who ?? "-").slice(0, 24)],
    ["O QUÊ", (row) => row.what],
  ]);
};

export const formatRecords = (result: unknown): string => {
  const data = result as { total: number; records: RecordHit[] };
  const table = printTable(data.records, [
    ["ID", (row) => row.id],
    ["CONF", (row) => String(row.confidence ?? "-")],
    ["NOME", (row) => (row.name ?? "-").slice(0, 30)],
    ["EVENTO", (row) => `${row.eventType ?? "-"}: ${eventText(row.event)}`.slice(0, 50)],
    ["COLEÇÃO", (row) => (row.collection ?? "-").slice(0, 50)],
  ]);
  return `${table}\n\n${data.records.length} de ${data.total}`;
};

export const formatRecord = (result: unknown): string => {
  const record = result as RecordDetail;
  const lines = [record.collection ?? "(coleção desconhecida)", record.url];
  if (record.imageUrl) lines.push(`imagem: ${record.imageUrl}`);
  for (const person of record.persons) {
    lines.push(`${person.principal ? "* " : "  "}${person.name ?? "(sem nome)"}`);
    for (const fact of person.facts) lines.push(`    ${fact.type}: ${eventText(fact)}`);
  }
  return lines.join("\n");
};

export const formatCandidates = (key: "candidates" | "hints") => (result: unknown): string => {
  const data = result as Record<string, Array<SearchHit | RecordHit>> & { note?: string };
  const rows = data[key] ?? [];
  if (rows.length === 0) return data.note ?? "(nenhuma)";
  return printTable(rows, [
    ["ID", (row) => row.id],
    ["CONF", (row) => String(row.confidence ?? "-")],
    ["NOME", (row) => row.name ?? "-"],
    ["LINK", (row) => ("url" in row ? String(row.url) : "-")],
  ]);
};

export const formatPlaces = (result: unknown): string =>
  printTable((result as { places: Place[] }).places, [
    ["ID", (row) => row.id],
    ["TIPO", (row) => row.type ?? "-"],
    ["NOME COMPLETO", (row) => row.fullName],
  ]);
