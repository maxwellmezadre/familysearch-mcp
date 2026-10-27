import { describe, expect, test } from "bun:test";
import { toCsv } from "../src/export/csv.js";
import { type ExportPerson, gedcomDate, toGedcom } from "../src/export/gedcom.js";
import pkg from "../package.json" with { type: "json" };

const person = (id: string, over: Partial<ExportPerson> = {}): ExportPerson => ({
  id,
  name: "Giulia Rossi",
  given: "Giulia",
  surname: "Rossi",
  gender: "female",
  living: false,
  lifespan: null,
  birthDate: "5 November 1937",
  birthFormal: "+1937-11-05",
  birthPlace: "Torino, Italia",
  deathDate: null,
  deathFormal: null,
  deathPlace: null,
  ascendancy: "1",
  generation: 0,
  sourceCount: null,
  hintCount: null,
  duplicateCount: null,
  detailsAt: null,
  mergedInto: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});
const AT = new Date("2026-10-27T12:00:00Z");

describe("gedcomDate", () => {
  test("every form", () => {
    expect(gedcomDate({ original: "x", formal: "+1937-11-05" })).toBe("5 NOV 1937");
    expect(gedcomDate({ original: "x", formal: "+1938-11" })).toBe("NOV 1938");
    expect(gedcomDate({ original: "x", formal: "+1937" })).toBe("1937");
    expect(gedcomDate({ original: "x", formal: "A+1850" })).toBe("ABT 1850");
    expect(gedcomDate({ original: "circa 1850", formal: null })).toBe("(circa 1850)");
    expect(gedcomDate(null)).toBeNull();
  });
});

describe("toGedcom", () => {
  test("header, trailer, accents and other alphabets", () => {
    const out = toGedcom(
      {
        rootId: "AAAA-AA1",
        persons: [person("AAAA-AA1", { given: "José", surname: "Müller" }), person("AAAA-AA2", { name: "ジュゼッペ", given: null, surname: null, gender: "male" })],
        relationships: [],
      },
      AT,
    );
    const lines = out.split("\n");
    expect(lines.slice(0, 8)).toEqual([
      "0 HEAD",
      "1 SOUR familysearch-mcp",
      `2 VERS ${pkg.version}`,
      "1 DATE 27 OCT 2026",
      "1 GEDC",
      "2 VERS 5.5.1",
      "2 FORM LINEAGE-LINKED",
      "1 CHAR UTF-8",
    ]);
    expect(lines.slice(-2)).toEqual(["0 TRLR", ""]);
    expect(out).toContain("1 NAME José /Müller/");
    expect(out).toContain("1 NAME ジュゼッペ\n");
    expect(out).toContain("1 BIRT\n2 DATE 5 NOV 1937\n2 PLAC Torino, Italia");
    expect(out).toContain("1 _FSFTID AAAA-AA1");
  });

  test("a newline in a date phrase cannot inject a record", () => {
    const out = toGedcom(
      { rootId: "A", persons: [person("A", { birthDate: "1937\n0 @I9@ INDI (x)", birthFormal: null })], relationships: [] },
      AT,
    );
    expect(out.split("\n").filter((l) => l.startsWith("2 DATE"))).toEqual(["2 DATE (1937 0 @I9@ INDI [x])"]);
    expect(out).not.toContain("@I9@ INDI\n");
    expect(out.match(/INDI/g)?.length).toBe(2);
  });

  test("without name parts the last word is the surname", () => {
    const out = toGedcom({ rootId: "A", persons: [person("A", { given: null, surname: null, name: "Maria da Silva" })], relationships: [] }, AT);
    expect(out).toContain("1 NAME Maria da /Silva/");
  });

  test("family with two parents and children, and a childless couple", () => {
    const persons = [
      person("P1", { gender: "female" }),
      person("P2", { gender: "male" }),
      person("C1"),
      person("C2"),
      person("S1", { gender: "male" }),
    ];
    const rel = (id: string, kind: "couple" | "parents", p1: string | null, p2: string | null, child: string | null) => ({
      id, kind, person1: p1, person2: p2, child, updatedAt: "",
    });
    const out = toGedcom(
      {
        rootId: "C1",
        persons,
        relationships: [
          rel("r1", "parents", "P1", "P2", "C1"),
          rel("r2", "parents", "P1", "P2", "C2"),
          rel("r3", "couple", "C1", "S1", null),
        ],
      },
      AT,
    );
    expect(out).toContain("0 @F1@ FAM\n1 HUSB @I2@\n1 WIFE @I1@\n1 CHIL @I3@\n1 CHIL @I4@");
    expect(out).toContain("0 @F2@ FAM");
    expect(out).toMatch(/0 @I3@ INDI[\s\S]*1 FAMC @F1@\n1 FAMS @F2@/);
  });
});

describe("toCsv", () => {
  test("header and RFC 4180 quoting", () => {
    const csv = toCsv([person("A", { name: 'Rossi, Giulia "Gigi"' })], "https://www.familysearch.org");
    const [header, row] = csv.split("\n");
    expect(header).toBe("id,name,gender,living,birth_date,birth_place,death_date,death_place,ascendancy,generation,url");
    expect(row).toStartWith('A,"Rossi, Giulia ""Gigi""",female,false,5 November 1937,"Torino, Italia",,,1,0,https://');
  });

  test("the link points at the configured environment", () => {
    const [, row] = toCsv([person("A")], "https://beta.familysearch.org").split("\n");
    expect(row).toEndWith(",https://beta.familysearch.org/tree/person/details/A");
  });
});
