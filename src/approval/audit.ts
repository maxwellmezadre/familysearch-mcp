import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, FsEnv } from "../config.js";
import type { WriteResult } from "../core/ticket.js";
import type { WritePlan } from "./gate.js";

// Local record of every write attempt. Files are 0600 inside 0700 directories:
// they hold family data and never leave the machine.

export type AuditEntry = {
  at: string;
  env: FsEnv;
  tool: string;
  reason: string;
  headline: string;
  approved: boolean;
  answer: string;
  writes: WriteResult[];
  outcome: string;
  snapshot?: string;
};

function privateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700); // `mode` is ignored when the directory already exists
}

function privateFile(path: string, content: string, append = false): void {
  if (append) appendFileSync(path, content, { mode: 0o600 });
  else writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Filesystem-safe timestamp that still sorts chronologically. */
const stamp = (at: number) => new Date(at).toISOString().replace(/[:.]/g, "-");
const slug = (text: string) => text.replace(/[^A-Za-z0-9_-]+/g, "-");

export function appendAudit(config: Config, entry: AuditEntry): void {
  privateDir(config.auditDir);
  privateFile(join(config.auditDir, `writes.${config.env}.jsonl`), `${JSON.stringify(entry)}\n`, true);
}

/** Full markdown of what the user is about to approve; returns its path. */
export function writeDetails(config: Config, plan: WritePlan, at: number): string {
  const dir = join(config.auditDir, "approvals");
  privateDir(config.auditDir);
  privateDir(dir);
  const path = join(dir, `${stamp(at)}-${slug(plan.tool)}.md`);
  const lines = [
    `# ${plan.headline}`,
    "",
    `Ferramenta: ${plan.tool}`,
    `Motivo: ${plan.reason}`,
    "",
    "## Escritas",
    ...plan.writes.map((w) => `- ${w.summary} (${w.method} ${w.path})`),
    "",
    "## Detalhes",
    plan.details,
    "",
  ];
  privateFile(path, lines.join("\n"));
  return path;
}

/** Saves the data as it was before a merge; returns the path. */
export function saveSnapshot(config: Config, name: string, data: unknown, at: number): string {
  const dir = join(config.auditDir, "snapshots");
  privateDir(config.auditDir);
  privateDir(dir);
  const path = join(dir, `${stamp(at)}-${slug(name)}.json`);
  privateFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}
