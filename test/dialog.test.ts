import { describe, expect, test } from "bun:test";
import type { ApprovalPrompt } from "../src/approval/gate.js";
import { createDialogApprover } from "../src/cli/dialog.js";

const prompt = (over: Partial<ApprovalPrompt> = {}): ApprovalPrompt => ({
  headline: "Mesclar A em B",
  details: "detalhes",
  detailsPath: "/tmp/x.md",
  confirm: null,
  ...over,
});

function runner(code: number, stdout: string) {
  const calls: string[][] = [];
  return { calls, run: async (args: string[]) => (calls.push(args), { code, stdout }) };
}

describe("dialog approver", () => {
  test("outside macOS it refuses without running osascript", async () => {
    const r = runner(0, "button returned:Aprovar");
    const answer = await createDialogApprover({ platform: "linux", run: r.run }).ask(prompt());
    expect(answer.approved).toBe(false);
    expect(answer.reason).toContain("macOS");
    expect(r.calls).toHaveLength(0);
  });

  test("Aprovar is approved, Cancelar (exit 1) is refused", async () => {
    const ok = runner(0, "button returned:Aprovar\n");
    expect((await createDialogApprover({ platform: "darwin", run: ok.run }).ask(prompt())).approved).toBe(true);
    expect(ok.calls[0]![0]).toBe("osascript");
    const script = ok.calls[0]!.join(" ");
    expect(script).toContain('{"Cancelar", "Aprovar"}');
    expect(script).toContain("caution");
    const no = runner(1, "");
    expect((await createDialogApprover({ platform: "darwin", run: no.run }).ask(prompt())).approved).toBe(false);
  });

  test("quotes and backslashes in the text are escaped for AppleScript", async () => {
    const r = runner(0, "button returned:Aprovar");
    await createDialogApprover({ platform: "darwin", run: r.run }).ask(prompt({ headline: 'diz "oi" e \\ fim' }));
    expect(r.calls[0]!.join(" ")).toContain('diz \\"oi\\" e \\\\ fim');
  });

  test("confirm compares the typed text", async () => {
    const confirm = { title: "Digite o id", expected: "BBBB-BBB" };
    const ask = (stdout: string) => {
      const r = runner(0, stdout);
      return createDialogApprover({ platform: "darwin", run: r.run }).ask(prompt({ confirm }));
    };
    expect((await ask("button returned:Aprovar, text returned:BBBB-BBB")).approved).toBe(true);
    const wrong = await ask("button returned:Aprovar, text returned:outro");
    expect(wrong.approved).toBe(false);
    expect(wrong.reason).toContain('digitado "outro"');
    expect(wrong.reason).toContain("BBBB-BBB");
  });

  test("confirm ignores letter case", async () => {
    const r = runner(0, "button returned:Aprovar, text returned:bbbb-bbb\n");
    const confirm = { title: "Digite o id", expected: "BBBB-BBB" };
    expect((await createDialogApprover({ platform: "darwin", run: r.run }).ask(prompt({ confirm }))).approved).toBe(true);
  });

  test("the dialog says what to type when a confirm is asked", async () => {
    const r = runner(1, "");
    const confirm = { title: "Digite o id da duplicata (BBBB-BBB) para confirmar", expected: "BBBB-BBB" };
    await createDialogApprover({ platform: "darwin", run: r.run }).ask(prompt({ confirm, details: "x".repeat(2000) }));
    expect(r.calls[0]!.join(" ")).toContain("Digite o id da duplicata (BBBB-BBB) para confirmar");
  });
});
