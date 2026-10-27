import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { createContext } from "../../src/context.js";
import { runTool } from "../../src/tools/define.js";
import { toolByName } from "../../src/tools/registry.js";

// Gated tests against the REAL account (production), reads only. They check the
// one assumption fixtures cannot: that the saved session is accepted and the
// responses still parse. They cost a handful of requests and never run in CI.

const config = (() => {
  try {
    return loadConfig();
  } catch {
    return null;
  }
})();

const enabled =
  process.env.FAMILYSEARCH_LIVE === "1" &&
  config !== null &&
  config.env === "production" &&
  existsSync(config.sessionPath);
const gated = enabled ? describe : describe.skip;

if (!enabled) {
  console.error(
    "integração ao vivo pulada: precisa de FAMILYSEARCH_LIVE=1 e de uma sessão de produção salva (`familysearch login`)",
  );
}

gated("live account", () => {
  const call = async (name: string, args: unknown) => {
    const tool = toolByName(name);
    if (!tool) throw new Error(`tool ${name} não existe`);
    const ctx = createContext(loadConfig());
    try {
      return await runTool(tool, args, ctx);
    } finally {
      ctx.dispose();
    }
  };

  test("the session is accepted", async () => {
    const status = (await call("auth_status", { verify: true })) as { loggedIn: boolean; verified?: boolean };
    expect(status.loggedIn).toBe(true);
    expect(status.verified).toBe(true);
  }, 30_000);

  test("doctor reports every layer ok", async () => {
    const report = (await call("doctor", {})) as { ok: boolean };
    expect(report.ok).toBe(true);
  }, 60_000);

  test("the user's own person is readable", async () => {
    const status = (await call("auth_status", {})) as { user?: { personId: string | null } };
    const personId = status.user?.personId;
    expect(personId).toBeTruthy();
    const person = (await call("get_person", { person_id: personId })) as { id: string };
    expect(person.id).toBe(personId as string);
  }, 30_000);

  test("a common surname search returns people", async () => {
    const result = (await call("search_persons", { surname: "Silva", limit: 5 })) as { people: unknown[] };
    expect(result.people.length).toBeGreaterThan(0);
  }, 30_000);

  test("place search finds Rio de Janeiro", async () => {
    const result = (await call("search_places", { name: "Rio de Janeiro" })) as { places: unknown[] };
    expect(result.places.length).toBeGreaterThan(0);
  }, 30_000);
});
