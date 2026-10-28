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
  /**
   * When set, the user must give `expected` (e.g. the duplicate's id) to approve:
   * typed, or picked among `choices` where typing is not possible.
   */
  confirm: Confirm | null;
};

export type Confirm = { title: string; expected: string; choices?: string[] };

export type ApprovalAnswer = { approved: boolean; reason: string };

/**
 * Why the typed confirmation does not match, or null when it does. It proves
 * intent, not a secret: spaces and letter case do not matter.
 */
export function confirmMismatch(typed: unknown, expected: string): string | null {
  const text = String(typed ?? "").trim();
  if (text.toUpperCase() === expected.toUpperCase()) return null;
  return `texto de confirmação não confere: digitado ${JSON.stringify(text.slice(0, 40))}, esperado ${expected}`;
}

export type Approver = {
  kind: "elicitation" | "dialog" | "auto" | "test";
  ask(prompt: ApprovalPrompt): Promise<ApprovalAnswer>;
};

/**
 * Says yes to every plan without asking, confirmations included. Only when the
 * user turned on FAMILYSEARCH_AUTO_APPROVE (ADR-0012); the audit records it.
 */
export const autoApprover: Approver = {
  kind: "auto",
  ask: async () => ({ approved: true, reason: "aprovado automaticamente (FAMILYSEARCH_AUTO_APPROVE=1)" }),
};

export type WritePlan = {
  tool: string;
  reason: string;
  headline: string;
  details: string;
  writes: PlannedWrite[];
  confirm?: Confirm;
  /** People whose cached copy the writes make stale (DESIGN §11). */
  touches?: string[];
  /** A merge: once applied, the cache marks the duplicate as merged into the survivor. */
  merged?: { duplicate: string; survivor: string };
  /** Saved locally after the "yes" and before the first write; no snapshot, no write. */
  snapshot?: { name: string; data: unknown };
};

const MIN_REASON = 10;
const MAX_HEADLINE_LINES = 2;
const MAX_HEADLINE_CHARS = 200;

const cutHeadline = (headline: string) =>
  headline.split("\n").slice(0, MAX_HEADLINE_LINES).join("\n").slice(0, MAX_HEADLINE_CHARS);

/** The ticket for the approved writes, and the file with everything the user was shown. */
export type Approval = { ticket: WriteTicket; detailsPath: string; answer: string };

export async function requestApproval(ctx: Ctx, plan: WritePlan): Promise<Approval> {
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
      detailsPath,
    });
    throw new ApprovalRefusedError(plan.tool, answer.reason || "o usuário não aprovou.");
  }
  return { ticket: issueTicket(plan.writes, at), detailsPath, answer: answer.reason || "aprovado" };
}
