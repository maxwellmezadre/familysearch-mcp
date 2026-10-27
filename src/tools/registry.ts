import type { Config } from "../config.js";
import { authStatus } from "./auth.js";
import { comparePersons } from "./compare.js";
import type { ToolDef } from "./define.js";
import { login } from "./login.js";
import { getHints, getPossibleDuplicates, getRecord, searchPlaces, searchRecords } from "./research.js";
import {
  getAncestors,
  getChangeHistory,
  getDescendants,
  getFamily,
  getPerson,
  searchPersons,
} from "./tree.js";

// Flat registry shared by the MCP server and the CLI: the two surfaces cannot
// drift, because they resolve tools from this same array. The order here is the
// order clients see: session and diagnosis, tree, research, analysis, escape hatch.
export const allTools: ToolDef[] = [
  // Session and diagnosis
  authStatus,
  login,
  // Family Tree
  searchPersons,
  getPerson,
  getFamily,
  getAncestors,
  getDescendants,
  getChangeHistory,
  // Research
  searchRecords,
  getRecord,
  getHints,
  getPossibleDuplicates,
  searchPlaces,
  // Analysis
  comparePersons,
];

/**
 * Read-only mode: the tools that persist something (session, cache, files) or
 * write to the account are simply not registered. A structural guarantee, not
 * a runtime check.
 */
export function activeTools(config: Pick<Config, "readOnly">): ToolDef[] {
  return config.readOnly ? allTools.filter((tool) => tool.readOnly) : allTools;
}

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}
