import { isFailedWrite } from "../approval/run.js";
import { loadConfig } from "../config.js";
import { type Ctx, createContext } from "../context.js";
import type { ToolDef } from "../tools/define.js";
import { compactObject, runTool } from "../tools/define.js";
import { createDialogApprover } from "./dialog.js";
import { activeTools, allTools } from "../tools/registry.js";

// The plumbing every CLI command shares: resolve the tool from the same
// registry the MCP server uses, run it through the same `runTool`, print JSON
// or a human rendering. Commands themselves live in index.ts.

export function resolveTool(readOnly: boolean, name: string): ToolDef {
  const tool = activeTools({ readOnly }).find((candidate) => candidate.name === name);
  if (tool) return tool;
  const exists = allTools.some((candidate) => candidate.name === name);
  throw new Error(
    exists ? `Comando indisponível em modo somente leitura: ${name}` : `Tool não encontrada: ${name}`,
  );
}

const value = (input: unknown): string =>
  input === null || input === undefined
    ? ""
    : typeof input === "object"
      ? JSON.stringify(input)
      : String(input);

export function formatHuman(result: unknown): string {
  if (result === null || typeof result !== "object") return String(result);
  if (Array.isArray(result)) return result.map(value).join("\n");
  return Object.entries(result)
    .map(([key, item]) => `${key}: ${value(item)}`)
    .join("\n");
}

/** Fixed-width table, no dependency. Columns are [header, accessor]. */
export function printTable<T>(rows: T[], columns: Array<[string, (row: T) => string]>): string {
  if (rows.length === 0) return "(nenhum resultado)";
  const header = columns.map(([name]) => name);
  const body = rows.map((row) => columns.map(([, get]) => get(row)));
  const widths = header.map((name, index) =>
    Math.max(name.length, ...body.map((cells) => (cells[index] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...body.map(line)].join("\n");
}

export async function withContext<T>(fn: (ctx: Ctx) => Promise<T> | T): Promise<T> {
  const ctx = createContext(loadConfig());
  ctx.approver = createDialogApprover();
  try {
    return await fn(ctx);
  } finally {
    ctx.dispose();
  }
}

export async function write(text: string): Promise<void> {
  // Await the write: a large result piped to a slow reader is truncated when
  // the process exits before stdout drains.
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${text}\n`, (error) => (error ? reject(error) : resolve()));
  });
}

export type InvokeOptions = { json: boolean; format?: (result: unknown) => string };

export async function invoke(
  toolName: string,
  args: Record<string, unknown>,
  options: InvokeOptions,
): Promise<void> {
  try {
    await withContext(async (ctx) => {
      const tool = resolveTool(ctx.config.readOnly, toolName);
      const result = await runTool(tool, compactObject(args), ctx);
      await write(
        options.json ? JSON.stringify(result, null, 2) : (options.format ?? formatHuman)(result),
      );
      if (isFailedWrite(result)) process.exitCode = 1;
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
