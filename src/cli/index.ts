import { Command } from "commander";
import { loadConfig } from "../config.js";
import { createContext } from "../context.js";
import { formatChanges, formatFamily, formatPedigree, formatPerson, formatSearch } from "./format.js";
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

  // ---- family tree ----------------------------------------------------------

  command("search")
    .description("Busca pessoas na árvore (nome, datas, lugares, parentes)")
    .option("--given <name>", "prenome(s)")
    .option("--surname <name>", "sobrenome")
    .option("--gender <gender>", "male ou female")
    .option("--birth <date>", "data ou ano de nascimento")
    .option("--birth-place <place>", "lugar de nascimento")
    .option("--death <date>", "data ou ano de falecimento")
    .option("--death-place <place>", "lugar de falecimento")
    .option("--father <name>", "nome completo do pai")
    .option("--mother <name>", "nome completo da mãe")
    .option("--spouse <name>", "nome completo do cônjuge")
    .option("--limit <n>", "máximo de resultados (default 10)")
    .action((options) =>
      invoke(
        "search_persons",
        {
          given_name: options.given,
          surname: options.surname,
          gender: options.gender,
          birth_date: options.birth,
          birth_place: options.birthPlace,
          death_date: options.death,
          death_place: options.deathPlace,
          father_name: options.father,
          mother_name: options.mother,
          spouse_name: options.spouse,
          limit: options.limit ? Number(options.limit) : undefined,
        },
        { json: options.json ?? false, format: formatSearch },
      ),
    );

  command("person <id>")
    .description("Mostra uma pessoa: nomes, fatos e link")
    .option("--sources", "inclui as fontes")
    .option("--notes", "inclui as notas")
    .option("--memories", "inclui as memórias")
    .action((id: string, options) => {
      const include = ["sources", "notes", "memories"].filter((item) => options[item]);
      return invoke(
        "get_person",
        { person_id: id, include: include.length > 0 ? include : undefined },
        { json: options.json ?? false, format: formatPerson },
      );
    });

  command("family <id>")
    .description("Pais, cônjuges e filhos de uma pessoa")
    .action((id: string, options) =>
      invoke("get_family", { person_id: id }, { json: options.json ?? false, format: formatFamily }),
    );

  command("ancestors <id>")
    .description("Ancestrais com o número de ascendência")
    .option("--generations <n>", "1 a 8 (default 4)")
    .action((id: string, options) =>
      invoke(
        "get_ancestors",
        { person_id: id, generations: options.generations ? Number(options.generations) : undefined },
        { json: options.json ?? false, format: formatPedigree },
      ),
    );

  command("descendants <id>")
    .description("Descendentes com o número de descendência")
    .option("--generations <n>", "1 a 4 (default 2)")
    .action((id: string, options) =>
      invoke(
        "get_descendants",
        { person_id: id, generations: options.generations ? Number(options.generations) : undefined },
        { json: options.json ?? false, format: formatPedigree },
      ),
    );

  command("changes <id>")
    .description("Histórico de alterações de uma pessoa")
    .option("--limit <n>", "máximo de alterações (default 20)")
    .action((id: string, options) =>
      invoke(
        "get_change_history",
        { person_id: id, limit: options.limit ? Number(options.limit) : undefined },
        { json: options.json ?? false, format: formatChanges },
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
