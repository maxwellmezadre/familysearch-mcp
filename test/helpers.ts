import type { Logger } from "../src/core/logger.js";

// Test doubles for every seam the production code injects. Nothing global is
// patched: the fakes are plain objects typed like the real collaborators.

export function silentLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (message: string) => lines.push(`[${level}] ${message}`);
  return {
    lines,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
}
