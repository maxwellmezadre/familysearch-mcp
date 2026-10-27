import { Type } from "@sinclair/typebox";
import { readPerson, searchTree } from "../familysearch/api.js";
import type { SessionData } from "../session/store.js";
import { defineTool } from "./define.js";

// Layer-by-layer diagnosis. Each layer runs only when the one below it is
// healthy, so the first failure IS the answer: which layer broke, and what
// to do about it. At most 3 requests (api, tree_read, search).

export type DoctorLayer = { layer: string; ok: boolean; detail: string };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const doctor = defineTool({
  name: "doctor",
  description:
    "Diagnóstico camada a camada: configuração, arquivo de sessão, token (ambiente certo), API " +
    "(users/current), leitura da árvore e busca. Para na primeira camada que falha e diz o que fazer. Use " +
    "quando qualquer outra tool falhar de um jeito inesperado. Até 3 requisições.",
  readOnly: true,
  input: Type.Object({}),
  run: async (_args, ctx) => {
    const layers: DoctorLayer[] = [];
    const report = () => ({ ok: layers.every((layer) => layer.ok), layers });
    const step = async (layer: string, check: () => Promise<string> | string): Promise<boolean> => {
      try {
        layers.push({ layer, ok: true, detail: await check() });
        return true;
      } catch (error) {
        layers.push({ layer, ok: false, detail: message(error) });
        return false;
      }
    };

    // A holder, not a `let`: TypeScript does not see assignments made inside the step closures.
    const state: { session: SessionData | null } = { session: null };
    await step("config", () => `${ctx.config.env} (${ctx.config.baseUrl}), sessão em ${ctx.config.sessionPath}`);
    if (
      !(await step("session_file", () => {
        const session = ctx.session.load();
        state.session = session;
        if (session === null) {
          throw new Error("Nenhuma sessão salva. Rode `familysearch login` (importa a sessão do Dia ou abre o navegador).");
        }
        return `salva em ${new Date(session.savedAt).toISOString()} (${session.source})`;
      }))
    ) {
      return report();
    }
    const saved = state.session as SessionData;
    if (
      !(await step("token", () => {
        if (saved.env !== ctx.config.env) {
          throw new Error(
            `A sessão salva é do ${saved.env}, mas FAMILYSEARCH_ENV é ${ctx.config.env}. Rode \`familysearch login\` neste ambiente.`,
          );
        }
        return `${saved.user.displayName}, sessão de ${Math.floor((ctx.now() - saved.savedAt) / 60_000)} min`;
      }))
    ) {
      return report();
    }
    if (
      !(await step("api", async () => {
        await ctx.http.send({ method: "GET", path: "/platform/users/current", label: "users/current" });
        return "o FamilySearch aceitou a sessão";
      }))
    ) {
      return report();
    }
    if (
      !(await step("tree_read", async () => {
        const personId = saved.user.personId;
        if (!personId) return "pulado: a conta não tem pessoa ligada na árvore";
        const document = await readPerson(ctx.http, personId);
        if (!document.persons?.length) throw new Error("A leitura de pessoa veio sem pessoas: o formato mudou.");
        return `leu ${personId}`;
      }))
    ) {
      return report();
    }
    await step("search", async () => {
      const feed = await searchTree(ctx.http, { surname: "Silva", limit: 1 });
      if (!feed?.entries?.length) throw new Error("A busca na árvore não devolveu nada para 'Silva': o formato mudou.");
      return "a busca na árvore responde";
    });
    return report();
  },
});
