import { describe, expect, test } from "bun:test";
import type { ApprovalPrompt } from "../src/approval/gate.js";
import { type ElicitingServer, createElicitationApprover } from "../src/mcp/elicit.js";

const prompt = (confirm: ApprovalPrompt["confirm"] = null): ApprovalPrompt => ({
  headline: "Mesclar A em B",
  details: "linha 1\nlinha 2",
  detailsPath: "/tmp/approvals/x.md",
  confirm,
});

function fakeServer(result: unknown | Error, form = true) {
  const calls: Array<{ params: any; options: any }> = [];
  const server = {
    getClientCapabilities: () => (form ? { elicitation: { form: {} } } : {}),
    elicitInput: async (params: any, options: any) => {
      calls.push({ params, options });
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as ElicitingServer;
  return { server, calls };
}

describe("elicitation approver", () => {
  test("a client without elicitation is refused without asking", async () => {
    const { server, calls } = fakeServer({ action: "accept", content: { approve: true } }, false);
    const answer = await createElicitationApprover(server).ask(prompt());
    expect(answer.approved).toBe(false);
    expect(answer.reason).toContain("elicitation");
    expect(calls).toHaveLength(0);
  });

  test("accept + approve true is approved", async () => {
    const { server, calls } = fakeServer({ action: "accept", content: { approve: true } });
    expect((await createElicitationApprover(server).ask(prompt())).approved).toBe(true);
    expect(calls[0]!.params.mode).toBe("form");
    expect(calls[0]!.params.requestedSchema.required).toEqual(["approve"]);
    expect(calls[0]!.options.timeout).toBe(600_000);
  });

  test("accept with approve false is a refusal", async () => {
    const { server } = fakeServer({ action: "accept", content: { approve: false } });
    expect((await createElicitationApprover(server).ask(prompt())).approved).toBe(false);
  });

  test("decline, cancel and a thrown timeout are refusals with a reason", async () => {
    for (const [result, text] of [
      [{ action: "decline" }, "recusado"],
      [{ action: "cancel" }, "cancelado"],
      [new Error("Request timed out"), "sem resposta em 10 minutos"],
    ] as const) {
      const { server } = fakeServer(result);
      const answer = await createElicitationApprover(server).ask(prompt());
      expect(answer.approved).toBe(false);
      expect(answer.reason).toContain(text);
    }
  });

  test("confirm must match exactly (trimmed)", async () => {
    const confirm = { title: "Digite o id", expected: "BBBB-BBB" };
    const ask = (typed: string) =>
      createElicitationApprover(
        fakeServer({ action: "accept", content: { approve: true, confirm: typed } }).server,
      ).ask(prompt(confirm));
    expect((await ask("  BBBB-BBB ")).approved).toBe(true);
    const wrong = await ask("CCCC-CCC");
    expect(wrong.approved).toBe(false);
    expect(wrong.reason).toContain("confirmação");
    const { server, calls } = fakeServer({ action: "accept", content: { approve: true, confirm: "BBBB-BBB" } });
    await createElicitationApprover(server).ask(prompt(confirm));
    expect(calls[0]!.params.requestedSchema.required).toEqual(["approve", "confirm"]);
  });

  test("the headline and the details path are in the first lines of the message", async () => {
    const { server, calls } = fakeServer({ action: "decline" });
    await createElicitationApprover(server).ask(prompt());
    const head = calls[0]!.params.message.split("\n").slice(0, 4);
    expect(head).toContain("Mesclar A em B");
    expect(head.join("\n")).toContain("/tmp/approvals/x.md");
  });

  test("only an explicit accept can approve", async () => {
    for (const result of [{ action: "maybe", content: { approve: true } }, { action: "accept" }]) {
      const { server } = fakeServer(result);
      expect((await createElicitationApprover(server).ask(prompt())).approved).toBe(false);
    }
  });
});
