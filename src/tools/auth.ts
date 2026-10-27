import { Type } from "@sinclair/typebox";
import { AuthError } from "../core/errors.js";
import type { FsUser } from "../familysearch/user.js";
import type { SessionData } from "../session/store.js";
import { compactObject, defineTool } from "./define.js";

// Session diagnostics. Free by default: it reads the local session file and
// says nothing that could not be derived from it. `verify: true` spends exactly
// one request (`users/current`, the cheapest authenticated endpoint).

export type AuthStatus = {
  loggedIn: boolean;
  env: string;
  sessionFile: string;
  source?: SessionData["source"];
  user?: FsUser;
  savedAt?: string;
  ageMinutes?: number;
  verified?: boolean;
  error?: string;
  hint?: string;
};

export const authStatus = defineTool({
  name: "auth_status",
  description:
    "Diz se há uma sessão do FamilySearch salva, em qual ambiente (produção ou beta), de onde veio " +
    "(Dia ou login no navegador), de quem é e há quanto tempo foi salva. Não usa a rede por padrão; " +
    "com verify=true gasta 1 requisição para confirmar que o FamilySearch ainda aceita a sessão. " +
    "Comece por aqui quando outra tool reclamar de sessão. Nunca mostra o token.",
  readOnly: true,
  input: Type.Object({
    verify: Type.Optional(
      Type.Boolean({ description: "Também faz 1 chamada ao FamilySearch para confirmar a sessão" }),
    ),
  }),
  run: async (args, ctx): Promise<AuthStatus> => {
    const base = { env: ctx.config.env, sessionFile: ctx.config.sessionPath };
    let data: SessionData | null;
    try {
      data = ctx.session.load();
    } catch (error) {
      return { ...base, loggedIn: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (data === null) {
      return {
        ...base,
        loggedIn: false,
        hint: "Nenhuma sessão salva. Rode `familysearch login` (importa a sessão do Dia ou abre o navegador).",
      };
    }

    const status: AuthStatus = {
      ...base,
      loggedIn: true,
      source: data.source,
      user: data.user,
      savedAt: new Date(data.savedAt).toISOString(),
      ageMinutes: Math.floor((ctx.now() - data.savedAt) / 60_000),
    };
    if (!args.verify) return status;

    try {
      await ctx.http.send({ method: "GET", path: "/platform/users/current", label: "users/current" });
      return { ...status, verified: true };
    } catch (error) {
      // An expired session is a *status*, not a crash: this tool exists to report it.
      if (error instanceof AuthError) {
        return compactObject({ ...status, loggedIn: false, verified: false, error: error.message });
      }
      throw error;
    }
  },
});
