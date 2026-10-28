import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.js";

// loadConfig takes `env` as a parameter so tests never touch process.env.
const base = { FAMILYSEARCH_CONFIG_DIR: "/tmp/fs-test" };

describe("loadConfig defaults", () => {
  test("production by default, with per-environment session file and browser profile", () => {
    const config = loadConfig({});
    expect(config.env).toBe("production");
    expect(config.baseUrl).toBe("https://www.familysearch.org");
    expect(config.sessionPath.endsWith("session.production.enc")).toBe(true);
    expect(config.browserProfileDir.endsWith("browser-profile-production")).toBe(true);
    expect(config.minIntervalMs).toBe(400);
    expect(config.importBrowser).toBeUndefined();
  });

  test("derives every path from the config dir", () => {
    const config = loadConfig(base);
    expect(config.configDir).toBe("/tmp/fs-test");
    expect(config.sessionPath).toBe("/tmp/fs-test/session.production.enc");
    expect(config.keyPath).toBe("/tmp/fs-test/session.key");
    expect(config.dbPath).toBe("/tmp/fs-test/cache.production.db");
    expect(config.browserProfileDir).toBe("/tmp/fs-test/browser-profile-production");
  });

  test("falls back to ~/.config/familysearch-mcp and ~/Downloads/familysearch-export", () => {
    const config = loadConfig({});
    expect(config.configDir).toBe(join(homedir(), ".config", "familysearch-mcp"));
    expect(config.exportDir).toBe(join(homedir(), "Downloads", "familysearch-export"));
  });

  test("expands a leading ~/ (MCP configs are JSON, not shell)", () => {
    const config = loadConfig({ FAMILYSEARCH_CONFIG_DIR: "~/fs", FAMILYSEARCH_EXPORT_DIR: "~/out" });
    expect(config.configDir).toBe(join(homedir(), "fs"));
    expect(config.exportDir).toBe(join(homedir(), "out"));
  });

  test("keeps the conservative pacing defaults", () => {
    const config = loadConfig(base);
    expect(config.minIntervalMs).toBe(400);
    expect(config.jitterMs).toBe(200);
    expect(config.httpTimeoutMs).toBe(30_000);
    expect(config.readOnly).toBe(false);
    expect(config.browserChannel).toBe("chrome");
  });
});

describe("write pacing and audit", () => {
  test("write interval defaults to 2000 and refuses less than 1000", () => {
    expect(loadConfig(base).writeIntervalMs).toBe(2000);
    expect(loadConfig({ ...base, FAMILYSEARCH_WRITE_INTERVAL_MS: "1500" }).writeIntervalMs).toBe(1500);
    expect(() => loadConfig({ ...base, FAMILYSEARCH_WRITE_INTERVAL_MS: "999" })).toThrow(ConfigError);
  });

  test("auditDir lives under the config dir", () => {
    expect(loadConfig(base).auditDir).toBe("/tmp/fs-test/audit");
  });
});

describe("environments", () => {
  test("beta switches host, session file and browser profile", () => {
    const config = loadConfig({ ...base, FAMILYSEARCH_ENV: "beta" });
    expect(config.env).toBe("beta");
    expect(config.baseUrl).toBe("https://beta.familysearch.org");
    expect(config.sessionPath).toBe("/tmp/fs-test/session.beta.enc");
    expect(config.browserProfileDir).toBe("/tmp/fs-test/browser-profile-beta");
  });

  test("the session key is shared by both environments", () => {
    expect(loadConfig({ ...base, FAMILYSEARCH_ENV: "beta" }).keyPath).toBe(
      loadConfig(base).keyPath,
    );
  });
});

describe("loadConfig validation", () => {
  test("dia is an import browser, case-insensitive", () => {
    expect(loadConfig({ ...base, FAMILYSEARCH_IMPORT_BROWSER: "Dia" }).importBrowser).toBe("dia");
  });

  test("accepts every documented boolean spelling", () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(loadConfig({ ...base, FAMILYSEARCH_READ_ONLY: value }).readOnly).toBe(true);
    }
    for (const value of ["0", "false", "no", "off"]) {
      expect(loadConfig({ ...base, FAMILYSEARCH_READ_ONLY: value }).readOnly).toBe(false);
    }
  });

  test("auto-approve is off unless FAMILYSEARCH_AUTO_APPROVE turns it on", () => {
    expect(loadConfig(base).autoApprove).toBe(false);
    expect(loadConfig({ ...base, FAMILYSEARCH_AUTO_APPROVE: "1" }).autoApprove).toBe(true);
  });

  test("rejects a non-boolean instead of defaulting silently", () => {
    expect(() => loadConfig({ ...base, FAMILYSEARCH_READ_ONLY: "maybe" })).toThrow(ConfigError);
  });

  test("rejects a session key that is not 32 bytes of base64", () => {
    expect(() => loadConfig({ ...base, FAMILYSEARCH_SESSION_KEY: "dG9vIHNob3J0" })).toThrow(
      /32 bytes/,
    );
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(loadConfig({ ...base, FAMILYSEARCH_SESSION_KEY: key }).sessionKey).toBe(key);
  });

  test("rejects an unknown browser channel", () => {
    expect(() => loadConfig({ ...base, FAMILYSEARCH_BROWSER_CHANNEL: "safari" })).toThrow(
      /chrome\|chromium\|msedge/,
    );
  });

  test("reports every problem at once so the user fixes them in one go", () => {
    try {
      loadConfig({
        ...base,
        FAMILYSEARCH_ENV: "staging",
        FAMILYSEARCH_MIN_INTERVAL_MS: "-1",
        FAMILYSEARCH_IMPORT_BROWSER: "safari",
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const { problems } = error as ConfigError;
      expect(problems).toHaveLength(3);
      expect(problems.join("\n")).toMatch(/FAMILYSEARCH_ENV[\s\S]*FAMILYSEARCH_MIN_INTERVAL_MS/);
    }
  });
});
