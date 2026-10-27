#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "../src/tools/registry.js";
import type { ToolDef } from "../src/tools/define.js";

// docs/TOOLS.md is generated from the registry so the reference can never drift
// from the schemas. Run it whenever a tool changes: `bun run docs:tools`.

type Schema = {
  type?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  pattern?: string;
};

function typeOf(schema: Schema): string {
  if (schema.anyOf) {
    const literals = schema.anyOf.filter((option) => option.const !== undefined);
    if (literals.length === schema.anyOf.length) {
      return literals.map((option) => `\`${String(option.const)}\``).join(" \\| ");
    }
    return schema.anyOf.map(typeOf).join(" \\| ");
  }
  const bounds: string[] = [];
  if (schema.minimum !== undefined) bounds.push(`≥ ${schema.minimum}`);
  if (schema.maximum !== undefined) bounds.push(`≤ ${schema.maximum}`);
  if (schema.minLength !== undefined) bounds.push(`min ${schema.minLength} chars`);
  if (schema.pattern) bounds.push(`\`${schema.pattern}\``);
  return `${schema.type ?? "any"}${bounds.length > 0 ? ` (${bounds.join(", ")})` : ""}`;
}

const escape = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

const kindOf = (tool: ToolDef): string =>
  tool.readOnly ? "leitura" : tool.destructive ? "escrita, destrutiva" : "escrita";

export function renderToolsDoc(tools: ToolDef[]): string {
  const lines: string[] = [
    "# Tools",
    "",
    "> Gerado por `bun run docs:tools` a partir de `src/tools/registry.ts`. Não edite à mão.",
    "",
    `O servidor expõe **${tools.length} tools**. Com \`FAMILYSEARCH_READ_ONLY=1\` as ` +
      `${tools.filter((tool) => !tool.readOnly).length} que escrevem algo (conta, sessão, cache, arquivo) ` +
      "não são registradas.",
    "",
    "| Tool | Tipo | O que faz |",
    "| --- | --- | --- |",
  ];
  for (const tool of tools) {
    lines.push(
      `| [\`${tool.name}\`](#${tool.name.replace(/_/g, "")}) | ${kindOf(tool)} | ${escape(tool.description.slice(0, 110))}… |`,
    );
  }

  for (const tool of tools) {
    const schema = JSON.parse(JSON.stringify(tool.input)) as Schema;
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    lines.push("", `## \`${tool.name}\``, "", tool.description, "");
    lines.push(`**Tipo:** ${kindOf(tool)}`, "");
    if (Object.keys(properties).length === 0) {
      lines.push("Sem parâmetros.");
      continue;
    }
    lines.push("| Parâmetro | Tipo | Obrigatório | Descrição |", "| --- | --- | --- | --- |");
    for (const [name, property] of Object.entries(properties)) {
      lines.push(
        `| \`${name}\` | ${typeOf(property)} | ${required.has(name) ? "sim" : "—"} | ${escape(property.description ?? "")} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  writeFileSync(join(import.meta.dir, "..", "docs", "TOOLS.md"), renderToolsDoc(allTools));
  console.error(`docs/TOOLS.md gerado (${allTools.length} tools).`);
}
