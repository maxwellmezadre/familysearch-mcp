import type { Static, TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Ctx } from "../context.js";

// One TypeBox schema per tool is simultaneously the static argument type, the
// runtime validator, and the JSON Schema advertised to the MCP client. No Zod
// bridge, no duplicated shapes.

export type ToolDef<S extends TObject = TObject> = {
  name: string;
  description: string;
  /**
   * False for tools that persist something (session, cache, files) or write
   * to the FamilySearch account. Read-only mode filters by this flag BEFORE
   * registering: unavailable, not "checked at call time".
   */
  readOnly: boolean;
  input: S;
  run: (args: Static<S>, ctx: Ctx) => Promise<unknown> | unknown;
};

/**
 * Registers a tool. Erases the generic at the boundary so tools with different
 * schemas live in one `ToolDef[]`; `run` stays typed inside the definition.
 */
export function defineTool<S extends TObject>(tool: ToolDef<S>): ToolDef {
  return tool as unknown as ToolDef;
}

export class ToolInputError extends Error {
  constructor(
    public readonly tool: string,
    public readonly problems: string[],
  ) {
    super(`Argumentos inválidos para ${tool}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ToolInputError";
  }
}

export async function runTool(tool: ToolDef, rawArgs: unknown, ctx: Ctx): Promise<unknown> {
  if (!Value.Check(tool.input, rawArgs)) {
    const problems = [...Value.Errors(tool.input, rawArgs)].map(
      (error) => `${error.path || "/"}: ${error.message}`,
    );
    throw new ToolInputError(tool.name, problems);
  }
  return tool.run(rawArgs as Static<TObject>, ctx);
}

/** Drops `undefined` values so tool outputs and CLI args stay tidy. */
export function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
