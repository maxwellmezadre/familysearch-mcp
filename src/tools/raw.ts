import { Type } from "@sinclair/typebox";
import { toPath } from "../core/http.js";
import { defineTool } from "./define.js";

// Escape hatch for rediscovery when FamilySearch changes something (see
// docs/REDISCOVERY.md). It rides the same pacing and session as every other
// call, and it is fenced: GET only (the http layer refuses anything else),
// and only the documented API and the record search service.

/** The documented API and the record search; never login, never the website's internal services. */
export const ALLOWED_PATH = /^\/(platform\/|service\/search\/)/;
export const MAX_RAW_BYTES = 64 * 1024;

export const rawGet = defineTool({
  name: "raw_get",
  description:
    "Faz um GET direto na API do FamilySearch (mesma sessão, mesmo ritmo), para redescobrir um endpoint quando " +
    "o formato muda. Só caminhos /platform/... e /service/search/..., ou links do FamilySearch que apontem para " +
    "eles; qualquer outro caminho é recusado, e o método é sempre GET. Use com parcimônia. 1 requisição.",
  readOnly: true,
  input: Type.Object({
    path: Type.String({ minLength: 2, description: "Ex.: /platform/tree/persons/KWCB-XXX/parents" }),
    accept: Type.Optional(
      Type.String({ description: "Accept (default application/x-fs-v1+json; buscas usam application/x-gedcomx-atom+json)" }),
    ),
    max_bytes: Type.Optional(
      Type.Integer({ minimum: 1024, maximum: MAX_RAW_BYTES, description: `Corta a resposta neste tamanho (default ${MAX_RAW_BYTES})` }),
    ),
  }),
  run: async (args, ctx) => {
    const relative = toPath(args.path.trim());
    // Resolve dot segments before checking, so "/platform/../ident" cannot slip through.
    const resolved = new URL(relative, ctx.config.baseUrl);
    if (!ALLOWED_PATH.test(resolved.pathname)) {
      throw new Error(`Caminho fora do permitido: "${resolved.pathname}". Só /platform/... e /service/search/...`);
    }
    const response = await ctx.http.send({
      method: "GET",
      path: resolved.pathname + resolved.search,
      ...(args.accept ? { accept: args.accept } : {}),
      label: "raw_get",
    });
    const limit = args.max_bytes ?? MAX_RAW_BYTES;
    const truncated = response.body.length > limit;
    let body: unknown = truncated ? `${response.body.slice(0, limit)}…` : response.body;
    if (!truncated && response.body.trim() !== "") {
      try {
        body = JSON.parse(response.body);
      } catch {
        // Not JSON: return the text as it came.
      }
    }
    return {
      status: response.status,
      location: response.headers.get("location"),
      warning: response.headers.get("warning"),
      truncated,
      bytes: response.body.length,
      body,
    };
  },
});
