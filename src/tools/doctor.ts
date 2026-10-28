import { type Dirent, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { readPerson, searchTree } from "../familysearch/api.js";
import type { SessionData } from "../session/store.js";
import { defineTool } from "./define.js";
import { allTools } from "./registry.js";
import { PRODUCTION_PROVEN } from "./write-status.js";

// Layer-by-layer diagnosis. Each layer runs only when the one below it is
// healthy, so the first failure IS the answer: which layer broke, and what
// to do about it. At most 3 requests (api, tree_read, search).

export type DoctorLayer = { layer: string; ok: boolean; detail: string };

/**
 * Settings files that declare Elicitation/ElicitationResult hooks: those can
 * answer an approval question without the human. Unreadable files are skipped.
 */
export function elicitationHooks(paths: string[]): string[] {
  return paths.filter((path) => {
    try {
      const hooks = JSON.parse(readFileSync(path, "utf8"))?.hooks;
      return Boolean(hooks && (hooks.Elicitation || hooks.ElicitationResult));
    } catch {
      return false;
    }
  });
}

/** Claude Code's machine-wide settings on macOS; hooks there apply to every session. */
export const MANAGED_SETTINGS = "/Library/Application Support/ClaudeCode/managed-settings.json";

/**
 * Every `hooks/hooks.json` under the installed plugins. Bounded (depth and
 * directories read) so a huge tree cannot stall the doctor; `complete: false`
 * says the walk stopped early.
 */
export function pluginHookFiles(root: string, limits = { depth: 6, dirs: 5000 }): { files: string[]; complete: boolean } {
  const files: string[] = [];
  const queue: Array<[string, number]> = [[root, 0]];
  for (let read = 0; queue.length > 0; read += 1) {
    if (read >= limits.dirs) return { files, complete: false };
    const [dir, depth] = queue.shift() as [string, number];
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Symlinks are not followed (no loops), nor package or git internals.
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.name === "hooks") files.push(join(path, "hooks.json"));
      if (depth + 1 < limits.depth) queue.push([path, depth + 1]);
    }
  }
  return { files, complete: true };
}

/** Every file where Claude Code may declare hooks for this user and this folder. */
export function hookFiles(home: string, cwd: string): { files: string[]; complete: boolean } {
  const plugins = pluginHookFiles(join(home, ".claude", "plugins"));
  return {
    files: [
      join(home, ".claude", "settings.json"),
      join(cwd, ".claude", "settings.json"),
      join(cwd, ".claude", "settings.local.json"),
      MANAGED_SETTINGS,
      ...plugins.files,
    ],
    complete: plugins.complete,
  };
}

/** Not readOnly because they persist local files (session, cache, export), not because they write to the account. */
const LOCAL_WRITERS = new Set(["login", "sync", "export"]);

const APPROVER_LABEL = {
  elicitation: "elicitation (cliente MCP)",
  dialog: "diálogo do macOS (CLI)",
  auto: "ATENÇÃO: aprovação automática (FAMILYSEARCH_AUTO_APPROVE=1), toda escrita vai para a árvore sem pergunta",
  test: "teste",
} as const;

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
    // Informational: never stops the diagnosis, never touches the network.
    await step("approval", () => {
      // The config, not only the wired approver: the warning must show wherever the mode is on.
      const kind = ctx.config.autoApprove
        ? APPROVER_LABEL.auto
        : ctx.approver
          ? APPROVER_LABEL[ctx.approver.kind]
          : "nenhum: escritas desativadas";
      const scan = hookFiles(homedir(), process.cwd());
      const found = elicitationHooks(scan.files);
      const warning = found.length
        ? ` ATENÇÃO: hooks Elicitation/ElicitationResult em ${found.join(", ")} podem responder à pergunta sem você.`
        : "";
      const partial = scan.complete ? "" : " A busca nos plugins (~/.claude/plugins) parou no limite: confira os hooks à mão.";
      return `${kind}.${warning}${partial}`;
    });
    // Informational, no network: account writes still without a checked live run.
    await step("writes", () => {
      const unproven = allTools
        .filter((tool) => !tool.readOnly && !LOCAL_WRITERS.has(tool.name) && !PRODUCTION_PROVEN.has(tool.name))
        .map((tool) => tool.name);
      return unproven.length ? `ainda não provadas em produção: ${unproven.join(", ")}` : "todas as escritas já foram provadas em produção";
    });
    if (
      !(await step("api", async () => {
        const response = await ctx.http.send({ method: "GET", path: "/platform/users/current", label: "users/current" });
        if (response.status !== 200) {
          const warning = response.headers.get("warning");
          throw new Error(
            `O FamilySearch respondeu HTTP ${response.status} em users/current${warning ? `: ${warning}` : ""}. ` +
              "Um 403 costuma ser bloqueio anti-bot: abra o FamilySearch no navegador, espere alguns minutos e tente de novo.",
          );
        }
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
