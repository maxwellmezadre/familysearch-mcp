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
