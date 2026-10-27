import { Type } from "@sinclair/typebox";
import { ImportBrowserSchema } from "../config.js";
import { LoginError } from "../core/errors.js";
import { importFromBrowser } from "../session/browser-import.js";
import { DEFAULT_LOGIN_TIMEOUT_MS, browserLogin } from "../session/login.js";
import { defineTool } from "./define.js";

// Login as an MCP tool as well as a CLI command. Production normally comes
// from the browser the user already uses (Dia); beta always goes through the
// dedicated Chrome profile, because both environments share one cookie and
// the everyday browser stays on production.

export const login = defineTool({
  name: "login",
  description:
    "Entra no FamilySearch e guarda a sessão cifrada (a senha nunca passa por aqui). Na produção, " +
    "importa a sessão do navegador já logado (from_browser, ou FAMILYSEARCH_IMPORT_BROWSER, ex.: dia); " +
    "sem navegador configurado, abre uma janela do Chrome e espera o login (até 15 minutos). " +
    "No beta, sempre abre a janela. Prefira o comando `familysearch login` quando o cliente MCP tiver timeout curto.",
  readOnly: false,
  input: Type.Object({
    from_browser: Type.Optional({
      ...ImportBrowserSchema,
      description: "Importa a sessão de um navegador já logado (só macOS, só produção)",
    }),
    fresh: Type.Optional(
      Type.Boolean({ description: "Apaga o perfil do navegador dedicado antes de abrir (login do zero)" }),
    ),
    timeout_seconds: Type.Optional(
      Type.Integer({
        minimum: 60,
        maximum: 900,
        description: `Tempo máximo esperando o login na janela (default ${DEFAULT_LOGIN_TIMEOUT_MS / 1000})`,
      }),
    ),
  }),
  run: async (args, ctx) => {
    if (ctx.config.env === "beta" && args.from_browser) {
      throw new LoginError(
        "No beta a sessão não vem do navegador do dia a dia: o FamilySearch usa um cookie só para produção e beta, " +
          "então entrar no beta pelo navegador desloga a produção. Rode `familysearch login` sem --from-browser " +
          "(abre uma janela do Chrome só para o beta).",
      );
    }
    const browser = ctx.config.env === "production" ? (args.from_browser ?? ctx.config.importBrowser) : undefined;
    const result = browser
      ? await importFromBrowser(ctx, { browser })
      : await browserLogin(ctx, {
          ...(args.timeout_seconds ? { timeoutMs: args.timeout_seconds * 1000 } : {}),
          ...(args.fresh ? { fresh: true } : {}),
        });
    ctx.http.resetSession();
    return result;
  },
});
