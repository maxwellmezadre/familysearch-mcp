import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type WritePlan, requestApproval } from "../src/approval/gate.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { ApprovalRefusedError } from "../src/core/errors.js";
import type { PlannedWrite } from "../src/core/ticket.js";
import { fakeApprover } from "./approvers.js";

const yes = { approved: true, reason: "ok" };
const no = { approved: false, reason: "não" };

function setup(answers = [yes], withApprover = true) {
  const dir = mkdtempSync(join(tmpdir(), "fs-approval-"));
  const approver = fakeApprover(answers);
  const ctx = createContext(loadConfig({ FAMILYSEARCH_CONFIG_DIR: dir }), {
    ...(withApprover ? { approver } : {}),
    now: () => 1_757_000_000_000,
  });
  return { dir, approver, ctx };
}

function plan(writes: Array<Pick<PlannedWrite, "method" | "path">>, reason = "corrigir a data de batismo"): WritePlan {
  return {
    tool: "add_note",
    reason,
    headline: "Adicionar nota",
    details: "Detalhe completo da mudança",
    writes: writes.map((w, i) => ({ ...w, label: `w${i}`, summary: `faz ${i}` })),
  };
}

const note = { method: "POST", path: "/platform/tree/persons/AAAA-AAA/notes" } as const;

describe("requestApproval", () => {
  test("refuses without an approver, before asking or writing details", async () => {
    const { ctx, dir } = setup([yes], false);
    await expect(requestApproval(ctx, plan([note]))).rejects.toThrow(/não consegue perguntar ao usuário/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("refuses a reason shorter than 10 characters", async () => {
    const { ctx, approver } = setup();
    await expect(requestApproval(ctx, plan([note], "   curto   "))).rejects.toBeInstanceOf(
      ApprovalRefusedError,
    );
    expect(approver.prompts).toHaveLength(0);
  });

  test("writes the full details to auditDir/approvals and passes the path in the prompt", async () => {
    const { ctx, approver } = setup();
    await requestApproval(ctx, plan([note]));
    const prompt = approver.prompts[0];
    expect(prompt?.detailsPath?.startsWith(join(ctx.config.auditDir, "approvals"))).toBe(true);
    const md = readFileSync(prompt?.detailsPath as string, "utf8");
    expect(md).toContain("Adicionar nota");
    expect(md).toContain("corrigir a data de batismo");
    expect(md).toContain("faz 0");
    expect(md).toContain("POST /platform/tree/persons/AAAA-AAA/notes");
    expect(md).toContain("Detalhe completo da mudança");
  });

  test("cuts the headline to 2 lines and 200 characters", async () => {
    const { ctx, approver } = setup();
    await requestApproval(ctx, { ...plan([note]), headline: `a\nb\nc\n${"x".repeat(300)}` });
    const headline = approver.prompts[0]?.headline as string;
    expect(headline.split("\n").length).toBeLessThanOrEqual(2);
    expect(headline.length).toBeLessThanOrEqual(200);
  });

  test("a declined answer is audited and throws ApprovalRefusedError", async () => {
    const { ctx } = setup([no]);
    await expect(requestApproval(ctx, plan([note]))).rejects.toBeInstanceOf(ApprovalRefusedError);
    const line = readFileSync(join(ctx.config.auditDir, "writes.production.jsonl"), "utf8").trim();
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({ approved: false, tool: "add_note", answer: "não", env: "production" });
  });

  test("an approver that throws counts as a refusal", async () => {
    const { ctx, approver } = setup();
    approver.ask = async () => {
      throw new Error("diálogo fechado");
    };
    await expect(requestApproval(ctx, plan([note]))).rejects.toThrow(/diálogo fechado/);
    const entry = JSON.parse(readFileSync(join(ctx.config.auditDir, "writes.production.jsonl"), "utf8"));
    expect(entry.approved).toBe(false);
  });

  test("an approved answer returns a ticket covering exactly the planned writes", async () => {
    const { ctx } = setup();
    const ticket = await requestApproval(ctx, plan([note]));
    expect(ticket.remaining()).toBe(1);
    expect(ticket.take("POST", "/platform/tree/persons/AAAA-AAA/notes?x=1").label).toBeString();
    expect(() => ticket.take("POST", "/platform/tree/persons/AAAA-AAA/notes")).toThrow(/já usada/);
    expect(() => ticket.take("POST", "/platform/tree/persons/BBBB-BBB/merges/AAAA-AAA")).toThrow(
      /não aprovada/,
    );
  });

  test("audit and details files are 0600 inside a 0700 directory", async () => {
    const { ctx } = setup([no]);
    await requestApproval(ctx, plan([note])).catch(() => undefined);
    const mode = (path: string) => statSync(path).mode & 0o777;
    const approvals = join(ctx.config.auditDir, "approvals");
    expect(mode(ctx.config.auditDir)).toBe(0o700);
    expect(mode(approvals)).toBe(0o700);
    expect(mode(join(approvals, readdirSync(approvals)[0] as string))).toBe(0o600);
    expect(mode(join(ctx.config.auditDir, "writes.production.jsonl"))).toBe(0o600);
  });
});
