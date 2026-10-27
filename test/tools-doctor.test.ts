import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { elicitationHooks } from "../src/tools/doctor.js";
import { runTool } from "../src/tools/define.js";
import { toolByName } from "../src/tools/registry.js";
import {
  fakeClock,
  fixture,
  jsonResponse,
  memorySession,
  response,
  scriptedFetch,
  sessionFixture,
  silentLogger,
} from "./helpers.js";

type Layer = { layer: string; ok: boolean; detail: string };
type Report = { ok: boolean; layers: Layer[] };

function setup(opts: { session?: ReturnType<typeof memorySession>; env?: Record<string, string>; script?: Parameters<typeof scriptedFetch>[0] }) {
  const clock = fakeClock();
  const fetch = scriptedFetch(opts.script ?? []);
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: "/nonexistent/fs", ...opts.env }), {
    fetch,
    session: opts.session ?? memorySession(sessionFixture()),
    log: silentLogger(),
    now: clock.now,
    sleep: clock.sleep,
    reauth: async () => "nenhum navegador configurado",
  });
  const run = (name: string, args: Record<string, unknown> = {}) =>
    runTool(toolByName(name) as never, args, ctx) as Promise<Record<string, unknown>>;
  return { run, fetch };
}

const body = (name: string) => (fixture(name) as { body: unknown }).body;

describe("doctor", () => {
  test("no session: stops at session_file without touching the network", async () => {
    const { run, fetch } = setup({ session: memorySession(null) });
    const report = (await run("doctor")) as Report;
    expect(report.ok).toBe(false);
    expect(report.layers.map((layer) => layer.layer)).toEqual(["config", "session_file"]);
    expect(report.layers.at(-1)!.detail).toContain("familysearch login");
    expect(fetch.calls).toHaveLength(0);
  });

  test("a session from the other environment stops at token", async () => {
    const { run, fetch } = setup({ env: { FAMILYSEARCH_ENV: "beta" } });
    const report = (await run("doctor")) as Report;
    expect(report.layers.at(-1)).toMatchObject({ layer: "token", ok: false });
    expect(fetch.calls).toHaveLength(0);
  });

  test("a rejected token stops at api with the login hint", async () => {
    const { run } = setup({ script: [response({ status: 401 })] });
    const report = (await run("doctor")) as Report;
    expect(report.layers.at(-1)).toMatchObject({ layer: "api", ok: false });
    expect(report.layers.at(-1)!.detail).toContain("familysearch login");
  });

  test("a 403 from the edge stops at api, never 'accepted'", async () => {
    const { run } = setup({ script: [response({ status: 403 })] });
    const report = (await run("doctor")) as Report;
    expect(report.layers.at(-1)).toMatchObject({ layer: "api", ok: false });
    expect(report.layers.at(-1)!.detail).toContain("403");
  });

  test("healthy: every layer ok in at most 3 requests", async () => {
    const { run, fetch } = setup({
      script: [
        jsonResponse({ users: [{ id: "cis.user.AAAA-0000", personId: "AAAA-AAA" }] }),
        jsonResponse(body("person")),
        jsonResponse(body("tree-search")),
      ],
    });
    const report = (await run("doctor")) as Report;
    expect(report.ok).toBe(true);
    expect(report.layers.map((layer) => layer.layer)).toEqual([
      "config",
      "session_file",
      "token",
      "approval",
      "writes",
      "api",
      "tree_read",
      "search",
    ]);
    expect(fetch.calls).toHaveLength(3);
  });
});

describe("doctor approval layer", () => {
  test("reports the approver kind and warns about Elicitation hooks", async () => {
    const { run } = setup({ script: [response({ status: 401 })] });
    const report = (await run("doctor")) as Report;
    const layer = report.layers.find((l) => l.layer === "approval")!;
    expect(layer.ok).toBe(true);
    expect(layer.detail).toContain("nenhum: escritas desativadas");
    expect(report.layers.map((l) => l.layer).indexOf("approval")).toBeLessThan(
      report.layers.map((l) => l.layer).indexOf("api"),
    );

    const dir = mkdtempSync(join(tmpdir(), "fs-hooks-"));
    const write = (name: string, content: string) => (writeFileSync(join(dir, name), content), join(dir, name));
    const withHook = write("a.json", JSON.stringify({ hooks: { Elicitation: [] } }));
    const withResult = write("b.json", JSON.stringify({ hooks: { ElicitationResult: [] } }));
    const other = write("c.json", JSON.stringify({ hooks: { PreToolUse: [] } }));
    const broken = write("d.json", "{nope");
    expect(elicitationHooks([withHook, withResult, other, broken, join(dir, "missing.json")])).toEqual([
      withHook,
      withResult,
    ]);
  });
});

describe("raw_get", () => {
  test("reads an allowed path and returns parsed JSON", async () => {
    const { run, fetch } = setup({ script: [jsonResponse({ users: [] })] });
    const result = await run("raw_get", { path: "/platform/users/current" });
    expect(result).toMatchObject({ status: 200, truncated: false, body: { users: [] } });
    expect(fetch.calls[0]!.init.method).toBe("GET");
  });

  test("refuses anything outside /platform and the record search, before any request", async () => {
    const { run, fetch } = setup({});
    for (const path of [
      "/ident/cis-web/oauth2/v3/token",
      "/platform/../ident/x",
      "https://evil.example/platform/users/current",
      "/service/tree/tree-data/v8/person/X/card",
    ]) {
      await expect(run("raw_get", { path })).rejects.toThrow(/Recusando|fora do/);
    }
    expect(fetch.calls).toHaveLength(0);
  });

  test("a FamilySearch link is accepted and re-rooted", async () => {
    const { run, fetch } = setup({ script: [jsonResponse({})] });
    await run("raw_get", { path: "https://api.familysearch.org/platform/tree/persons/AAAA-AAA?flag=fsh" });
    expect(new URL(fetch.calls[0]!.url).pathname).toBe("/platform/tree/persons/AAAA-AAA");
  });

  test("truncates at max_bytes", async () => {
    const { run } = setup({ script: [jsonResponse({ blob: "x".repeat(5000) })] });
    const result = await run("raw_get", { path: "/platform/tree/persons/AAAA-AAA", max_bytes: 1024 });
    expect(result.truncated).toBe(true);
    expect(String(result.body).length).toBeLessThanOrEqual(1025);
  });
});
