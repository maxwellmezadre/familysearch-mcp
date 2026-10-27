import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { renderToolsDoc } from "../scripts/gen-tools-doc.js";
import { defineTool } from "../src/tools/define.js";

const reader = defineTool({
  name: "get_thing",
  description: "Lê uma coisa.",
  readOnly: true,
  input: Type.Object({
    id: Type.String({ description: "Identificador | da coisa" }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Quantas" })),
  }),
  run: () => ({}),
});
const eraser = defineTool({
  name: "erase_thing",
  description: "Apaga uma coisa.",
  readOnly: false,
  destructive: true,
  input: Type.Object({}),
  run: () => ({}),
});
const writer = defineTool({
  name: "save_thing",
  description: "Grava uma coisa.",
  readOnly: false,
  input: Type.Object({}),
  run: () => ({}),
});

describe("renderToolsDoc", () => {
  const doc = renderToolsDoc([reader, eraser, writer]);

  test("starts with the generated-file header and the tool count", () => {
    expect(doc).toStartWith("# Tools\n");
    expect(doc).toContain("Gerado por `bun run docs:tools`");
    expect(doc).toContain("**3 tools**");
  });

  test("marks read, write and destructive tools", () => {
    expect(doc).toContain("## `get_thing`");
    expect(doc).toMatch(/## `get_thing`[\s\S]*?leitura/);
    expect(doc).toMatch(/## `erase_thing`[\s\S]*?escrita, destrutiva/);
    expect(doc).toMatch(/## `save_thing`[\s\S]*?\*\*Tipo:\*\* escrita\n/);
  });

  test("renders the parameter table, escaping pipes and showing bounds", () => {
    expect(doc).toContain("| Parâmetro | Tipo | Obrigatório | Descrição |");
    expect(doc).toContain("| `id` | string | sim | Identificador \\| da coisa |");
    expect(doc).toContain("| `limit` | integer (≥ 1, ≤ 5) | — | Quantas |");
  });

  test("says so when a tool has no parameters", () => {
    expect(doc).toContain("Sem parâmetros.");
  });
});
