// A WriteTicket is the proof that the user approved exactly these writes. The
// HTTP layer takes one entry per request, so a write that was not in the
// approved plan (or runs twice) cannot reach FamilySearch.

export type WriteMethod = "POST" | "DELETE";

export type WriteResult = {
  label: string;
  status: number | null;
  entityId: string | null;
  location: string | null;
};

export type PlannedWrite = {
  method: WriteMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  /** A function gets the results of the writes already made (e.g. a created id). */
  body?: unknown | ((prior: WriteResult[]) => unknown);
  label: string;
  /** What this write does, in pt-BR, for the approval details. */
  summary: string;
};

const MINT = Symbol("ticket");

const stripQuery = (path: string) => path.split("?")[0] as string;

export class WriteTicket {
  readonly id = crypto.randomUUID();
  readonly #entries: Array<{ write: PlannedWrite; used: boolean }>;

  constructor(mint: symbol, writes: PlannedWrite[]) {
    if (mint !== MINT) throw new Error("WriteTicket só pode ser criado por issueTicket");
    this.#entries = writes.map((write) => ({ write, used: false }));
  }

  /** Returns the planned write for this request and consumes it. */
  take(method: WriteMethod, path: string): PlannedWrite {
    const bare = stripQuery(path);
    const matches = this.#entries.filter((e) => e.write.method === method && stripQuery(e.write.path) === bare);
    const entry = matches.find((e) => !e.used);
    if (!entry) {
      throw new Error(
        matches.length > 0
          ? `Escrita já usada: ${method} ${bare}. O ticket vale uma vez por escrita aprovada.`
          : `Escrita não aprovada: ${method} ${bare} não está no plano que o usuário aprovou.`,
      );
    }
    entry.used = true;
    return entry.write;
  }

  remaining(): number {
    return this.#entries.filter((e) => !e.used).length;
  }
}

/** The only factory. Only `src/approval/gate.ts` may call it (test/architecture.test.ts). */
export function issueTicket(writes: PlannedWrite[], _now: number): WriteTicket {
  return new WriteTicket(MINT, writes);
}
