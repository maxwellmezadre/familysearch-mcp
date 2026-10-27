import { Command } from "commander";
import { loadConfig } from "../config.js";
import { createContext } from "../context.js";
import { invoke } from "./output.js";

// The CLI is a thin argv → tool-args mapper: one command per tool, every
// command accepts --json, and everything goes through the same registry and
// `runTool` as the MCP server, so the two surfaces cannot drift.

export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("familysearch")
    .description("Árvore da sua conta no FamilySearch: CLI + servidor MCP")
    .version(version);

  const command = (signature: string) =>
    program.command(signature).option("--json", "saída em JSON puro");

  // ---- session and diagnosis ----------------------------------------------

  command("status")
    .description("Mostra a sessão salva: ambiente, origem, usuário e idade")
    .option("--verify", "gasta 1 requisição para confirmar que o FamilySearch aceita a sessão")
    .action((options) =>
      invoke("auth_status", { verify: options.verify }, { json: options.json ?? false }),
    );

  command("login")
    .description("Importa a sessão do navegador (produção) ou abre o Chrome para entrar")
    .option("--from-browser <browser>", "dia, arc, chrome, chromium, brave ou edge (macOS, só produção)")
    .option("--fresh", "apaga o perfil do navegador dedicado antes de abrir")
    .option("--timeout <minutes>", "minutos esperando o login na janela (default 5)")
    .action((options) =>
      invoke(
        "login",
        {
          from_browser: options.fromBrowser?.toLowerCase(),
          fresh: options.fresh,
          timeout_seconds: options.timeout ? Number(options.timeout) * 60 : undefined,
        },
        { json: options.json ?? false },
      ),
    );

  // ---- server ---------------------------------------------------------------

  program
    .command("mcp")
    .description("Sobe o servidor MCP (stdio)")
    .action(async () => {
      const { startMcpServer } = await import("../mcp/server.js");
      await startMcpServer(createContext(loadConfig()), version);
    });

  await program.parseAsync(argv);
}
