import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Tickets are the proof of user approval; only the gate may mint one. The type
// system cannot enforce that, so this test does.
test("issueTicket is imported only by src/approval/gate.ts", () => {
  const root = join(import.meta.dir, "..", "src");
  const offenders: string[] = [];
  for (const file of new Bun.Glob("**/*.ts").scanSync(root)) {
    if (file === "approval/gate.ts" || file === "core/ticket.ts") continue;
    if (readFileSync(join(root, file), "utf8").includes("issueTicket")) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

// Every write goes through runWritePlan: approval, audit, read-back, cache. A
// second caller of Http.write would be a write path the rest never sees.
test("Http.write is called only by src/approval/run.ts", () => {
  const root = join(import.meta.dir, "..", "src");
  const offenders: string[] = [];
  for (const file of new Bun.Glob("**/*.ts").scanSync(root)) {
    if (file === "approval/run.ts" || file === "core/http.ts") continue;
    if (/\bhttp\s*\.\s*write\b|\bwrite\s*\}\s*=\s*[\w.]*http\b/.test(readFileSync(join(root, file), "utf8"))) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
