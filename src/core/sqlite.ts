import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Opens (and creates) a database. The CLI and the MCP server share the file,
 * so WAL and a busy timeout are not optional. The file is 0600 and its folder
 * 0700: it holds a family tree.
 */
export function openDatabase(path: string): Database {
  if (path === ":memory:") return new Database(":memory:");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Whatever the user's umask is, this file is not readable by others.
  const previous = process.umask(0o077);
  let db: Database;
  try {
    db = new Database(path, { create: true });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  } finally {
    process.umask(previous);
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
  }
  return db;
}
