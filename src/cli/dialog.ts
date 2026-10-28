import { type ApprovalAnswer, type ApprovalPrompt, type Approver, confirmMismatch } from "../approval/gate.js";

// Approval for the CLI: a native macOS dialog. Cancel is the default button, so
// a stray Enter refuses. macOS does not hand the keyboard to a dialog opened by
// a background process, so a confirm with choices is a pick from a list (mouse only).

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
      const confirm = prompt.confirm;
      const choices = confirm?.choices ?? null;
      const text =
        `${prompt.headline}\n\n${prompt.details.slice(0, MAX_DETAILS)}` +
        `\n\nDetalhes: ${prompt.detailsPath ?? "(indisponível)"}` +
        (confirm ? `\n\n${confirm.title}${choices ? ": escolha na lista depois de Aprovar." : ":"}` : "");
      const script =
        `display dialog "${escape(text)}"` +
        (confirm && !choices ? ` default answer ""` : "") +
        ` with title "familysearch" with icon caution` +
        ` buttons {"Cancelar", "Aprovar"} default button "Cancelar" cancel button "Cancelar"`;
      const pick = choices
        ? `choose from list {${choices.map((choice) => `"${escape(choice)}"`).join(", ")}} with title "familysearch"` +
          ` with prompt "${escape(confirm?.title ?? "")}" OK button name "Confirmar" cancel button name "Cancelar"`
        : null;
      try {
        const { code, stdout } = await run(["osascript", "-e", script, ...(pick ? ["-e", pick] : [])]);
        if (code !== 0) return no("cancelado pelo usuário");
        // With a list, osascript prints the pick ("false" when cancelled), not the dialog's buttons.
        if (!pick && !stdout.includes("button returned:Aprovar")) return no("recusado pelo usuário");
        if (pick && stdout.trim() === "false") return no("cancelado pelo usuário");
        if (confirm) {
          const given = pick ? stdout.trim() : /text returned:(.*)$/m.exec(stdout)?.[1]?.trim();
          const mismatch = confirmMismatch(given, confirm.expected);
          if (mismatch) return no(mismatch);
        }
        return { approved: true, reason: "aprovado pelo usuário" };
      } catch {
        return no("não foi possível abrir o diálogo do macOS");
      }
    },
  };
}
