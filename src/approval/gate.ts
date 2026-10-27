import type { Ctx } from "../context.js";
import { ApprovalRefusedError } from "../core/errors.js";
import { type PlannedWrite, type WriteTicket, issueTicket } from "../core/ticket.js";
import { appendAudit, reasonLine, writeDetails } from "./audit.js";

// Every write asks the user first, one question per tool call. The answer
// becomes a single-use ticket; without an Approver nothing is written.

export type ApprovalPrompt = {
  headline: string;
  details: string;
  /** Markdown file with the full plan, for when the headline is not enough. */
  detailsPath: string | null;
  /** When set, the user must type `expected` (e.g. the duplicate's id) to approve. */
  confirm: { title: string; expected: string } | null;
};

export type ApprovalAnswer = { approved: boolean; reason: string };

export type Approver = {
  kind: "elicitation" | "dialog" | "test";
  ask(prompt: ApprovalPrompt): Promise<ApprovalAnswer>;
};

export type WritePlan = {
  tool: string;
  reason: string;
  headline: string;
  details: string;
  writes: PlannedWrite[];
  confirm?: { title: string; expected: string };
  /** People whose cached copy the writes make stale (DESIGN §11). */
  touches?: string[];
  /** A merge: once applied, the cache marks the duplicate as merged into the survivor. */
  merged?: { duplicate: string; survivor: string };
};

const MIN_REASON = 10;
const MAX_HEADLINE_LINES = 2;
const MAX_HEADLINE_CHARS = 200;

const cutHeadline = (headline: string) =>
  headline.split("\n").slice(0, MAX_HEADLINE_LINES).join("\n").slice(0, MAX_HEADLINE_CHARS);

export async function requestApproval(ctx: Ctx, plan: WritePlan): Promise<WriteTicket> {
  if (plan.reason.trim().length < MIN_REASON) {
    throw new ApprovalRefusedError(
      plan.tool,
      `informe o motivo da alteração (pelo menos ${MIN_REASON} caracteres).`,
    );
  }
  const approver = ctx.approver;
  if (!approver) {
    throw new ApprovalRefusedError(
      plan.tool,
      "este cliente não consegue perguntar ao usuário; nenhuma escrita é feita sem aprovação.",
    );
  }

  const at = ctx.now();
  const headline = cutHeadline(plan.headline);
  const detailsPath = writeDetails(ctx.config, plan, at);

  let answer: ApprovalAnswer;
  try {
    answer = await approver.ask({
      headline,
      details: `${reasonLine(plan.reason)}\n\n${plan.details}`,
      detailsPath,
      confirm: plan.confirm ?? null,
    });
  } catch (error) {
    // A broken prompt is never an approval.
    answer = { approved: false, reason: error instanceof Error ? error.message : String(error) };
  }

  if (!answer.approved) {
    appendAudit(ctx.config, {
      at: new Date(at).toISOString(),
      env: ctx.config.env,
      tool: plan.tool,
      reason: plan.reason,
      headline,
      approved: false,
      answer: answer.reason,
      writes: [],
      outcome: "refused",
    });
    throw new ApprovalRefusedError(plan.tool, answer.reason || "o usuário não aprovou.");
  }
  return issueTicket(plan.writes, at);
}
