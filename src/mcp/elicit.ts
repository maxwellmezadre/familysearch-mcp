import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ApprovalAnswer, ApprovalPrompt, Approver } from "../approval/gate.js";

// Approval through MCP elicitation: the client shows a form and the human
// answers. The server only declares the question; nothing here can answer it.

export const ELICIT_TIMEOUT_MS = 600_000;

export type ElicitingServer = Pick<Server, "elicitInput" | "getClientCapabilities">;

const no = (reason: string): ApprovalAnswer => ({ approved: false, reason });

export function createElicitationApprover(server: ElicitingServer): Approver {
  return {
    kind: "elicitation",
    async ask(prompt: ApprovalPrompt): Promise<ApprovalAnswer> {
      // Checked at ask time: the client only declares capabilities after `initialize`.
      if (!server.getClientCapabilities()?.elicitation?.form) {
        return no("o cliente MCP não suporta perguntas ao usuário (elicitation)");
      }
      // Essentials first: clients such as Claude Code cut long messages.
      const message = [
        prompt.headline,
        "",
        `Detalhes completos: ${prompt.detailsPath ?? "(indisponível)"}`,
        prompt.details,
      ].join("\n");
      const properties: Record<string, unknown> = {
        approve: { type: "boolean", title: "Aprovar esta alteração no FamilySearch?" },
      };
      const required = ["approve"];
      if (prompt.confirm) {
        properties.confirm = { type: "string", title: prompt.confirm.title };
        required.push("confirm");
      }
      try {
        const result = await server.elicitInput(
          { mode: "form", message, requestedSchema: { type: "object", properties, required } as never },
          { timeout: ELICIT_TIMEOUT_MS },
        );
        if (result.action === "decline") return no("recusado pelo usuário");
        if (result.action !== "accept") return no("cancelado pelo usuário");
        const content = result.content ?? {};
        if (content.approve !== true) return no("recusado pelo usuário");
        if (prompt.confirm && String(content.confirm ?? "").trim() !== prompt.confirm.expected) {
          return no("texto de confirmação não confere");
        }
        return { approved: true, reason: "aprovado pelo usuário" };
      } catch {
        // Timeout, closed transport, client error: never an approval.
        return no("sem resposta em 10 minutos (ou o cliente falhou ao perguntar)");
      }
    },
  };
}
