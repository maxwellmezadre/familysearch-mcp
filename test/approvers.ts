import type { ApprovalAnswer, ApprovalPrompt, Approver } from "../src/approval/gate.js";

// Test-only approvers. They live under test/ so no production path can import one.

/** Returns the given answers in order and records every prompt it was shown. */
export function fakeApprover(answers: ApprovalAnswer[]): Approver & { prompts: ApprovalPrompt[] } {
  const queue = [...answers];
  const prompts: ApprovalPrompt[] = [];
  return {
    kind: "test",
    prompts,
    async ask(prompt) {
      prompts.push(prompt);
      const next = queue.shift();
      if (!next) throw new Error("fakeApprover: no answer left");
      return next;
    },
  };
}

/** Approves every prompt, with no cap (cleanup after a failed run may need many). */
export const autoApprove = (): Approver & { prompts: ApprovalPrompt[] } => {
  const prompts: ApprovalPrompt[] = [];
  return {
    kind: "test",
    prompts,
    async ask(prompt) {
      prompts.push(prompt);
      return { approved: true, reason: "ok" };
    },
  };
};
