import { type ApprovalAnswer, type ApprovalPrompt, type Approver, confirmMatches } from "../approval/gate.js";

// Approval for the CLI: a native macOS dialog. Cancel is the default button, so
// a stray Enter refuses.

export type DialogDeps = {
  platform?: string;
  run?: (args: string[]) => Promise<{ code: number; stdout: string }>;
};

const MAX_DETAILS = 900;

const no = (reason: string): ApprovalAnswer => ({ approved: false, reason });
const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

async function osascript(args: string[]) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout };
}

export function createDialogApprover(deps: DialogDeps = {}): Approver {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? osascript;
  return {
    kind: "dialog",
    async ask(prompt: ApprovalPrompt): Promise<ApprovalAnswer> {
      if (platform !== "darwin") return no("o CLI só pergunta no macOS");
      const text =
        `${prompt.headline}\n\n${prompt.details.slice(0, MAX_DETAILS)}` +
        `\n\nDetalhes: ${prompt.detailsPath ?? "(indisponível)"}` +
        (prompt.confirm ? `\n\n${prompt.confirm.title}:` : "");
      const script =
        `display dialog "${escape(text)}"` +
        (prompt.confirm ? ` default answer ""` : "") +
        ` with title "familysearch" with icon caution` +
        ` buttons {"Cancelar", "Aprovar"} default button "Cancelar" cancel button "Cancelar"`;
      try {
        const { code, stdout } = await run(["osascript", "-e", script]);
        if (code !== 0) return no("cancelado pelo usuário");
        if (!stdout.includes("button returned:Aprovar")) return no("recusado pelo usuário");
        if (prompt.confirm) {
          const typed = /text returned:(.*)$/m.exec(stdout)?.[1]?.trim();
          if (!confirmMatches(typed, prompt.confirm.expected)) return no("texto de confirmação não confere");
        }
        return { approved: true, reason: "aprovado pelo usuário" };
      } catch {
        return no("não foi possível abrir o diálogo do macOS");
      }
    },
  };
}
