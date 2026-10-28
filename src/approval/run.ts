import { existsSync } from "node:fs";
import type { Ctx } from "../context.js";
import { ApprovalRefusedError, WriteUncertainError } from "../core/errors.js";
import type { WriteResult } from "../core/ticket.js";
import { appendAudit, saveSnapshot } from "./audit.js";
import { type WritePlan, requestApproval } from "./gate.js";

// Turns a WritePlan into: approval -> writes in order -> read-back -> audit.
// Nothing here repeats a write: a failure stops the run and says what happened.

export type ReadBack = { ok: boolean; checks: Array<{ what: string; ok: boolean; detail: string }> };

export type WriteOutcome = {
  status: "preview" | "refused" | "applied" | "partial" | "uncertain";
  tool: string;
  headline: string;
  detailsPath: string | null;
  writes: WriteResult[];
  readBack: ReadBack | null;
  message: string;
  /** Where the data was saved before the writes, when the plan asked for a snapshot. */
  snapshot?: string;
};

/**
 * A write the caller must see as failed: nothing was applied, only part of it,
 * or nobody knows. The MCP server answers isError and the CLI exits 1, both
 * with the whole outcome as the text.
 */
export const isFailedWrite = (result: unknown): boolean =>
  typeof result === "object" && result !== null && ["refused", "partial", "uncertain"].includes((result as { status?: unknown }).status as string);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * DESIGN §11: the people a write touched go back to the next sync. Only a cache
 * that already exists is changed (a write never creates one), and a failure here
 * never hides what happened on FamilySearch.
 */
function invalidateCache(ctx: Ctx, plan: WritePlan, status: WriteOutcome["status"]): void {
  if (!plan.touches?.length || !existsSync(ctx.config.dbPath)) return;
  try {
    const repo = ctx.cache();
    repo.transaction(() => {
      repo.invalidate(plan.touches ?? []);
      // Only a 2xx merge is known to have happened; otherwise sync finds out by the 301.
      if (plan.merged && status === "applied") repo.markMerged(plan.merged.duplicate, plan.merged.survivor);
    });
  } catch (error) {
    ctx.log.warn(`Não consegui marcar no cache as pessoas alteradas (${errorText(error)}); rode sync --full.`);
  }
}

export async function runWritePlan(
  ctx: Ctx,
  plan: WritePlan,
  opts: { preview?: boolean; readBack: (results: WriteResult[]) => Promise<ReadBack> },
): Promise<WriteOutcome> {
  const base = { tool: plan.tool, headline: plan.headline, detailsPath: null, writes: [], readBack: null };

  if (opts.preview) {
    return {
      ...base,
      status: "preview",
      message: `Pré-visualização, nada foi enviado:\n${plan.writes.map((w) => `- ${w.summary}`).join("\n")}`,
    };
  }

  let approval: Awaited<ReturnType<typeof requestApproval>>;
  try {
    approval = await requestApproval(ctx, plan); // audits its own refusals
  } catch (error) {
    if (error instanceof ApprovalRefusedError) return { ...base, status: "refused", message: error.message };
    throw error;
  }
  const { ticket, detailsPath, answer } = approval;

  const results: WriteResult[] = [];
  let status: WriteOutcome["status"] = "applied";
  let message = "";
  let snapshot: string | undefined;
  if (plan.snapshot) {
    try {
      snapshot = saveSnapshot(ctx.config, plan.snapshot.name, plan.snapshot.data, ctx.now());
    } catch (error) {
      status = "refused";
      message = `Nada foi enviado: não consegui salvar o snapshot local (${errorText(error)}).`;
    }
  }
  for (const write of status === "applied" ? plan.writes : []) {
    try {
      const body = typeof write.body === "function" ? write.body(results) : write.body;
      const res = await ctx.http.write(
        {
          method: write.method,
          path: write.path,
          ...(write.query ? { query: write.query } : {}),
          ...(body !== undefined ? { body } : {}),
          reason: plan.reason,
          label: write.label,
        },
        ticket,
      );
      results.push({
        label: write.label,
        status: res.status,
        entityId: res.headers.get("x-entity-id"),
        location: res.headers.get("location"),
      });
      if (res.status < 200 || res.status >= 300) {
        const warning = res.headers.get("warning");
        message = `O FamilySearch recusou "${write.summary}" (HTTP ${res.status})${warning ? `: ${warning}` : ""}.`;
        status = "partial";
        break;
      }
    } catch (error) {
      results.push({ label: write.label, status: null, entityId: null, location: null });
      status = error instanceof WriteUncertainError ? "uncertain" : "partial";
      message = errorText(error);
      break;
    }
  }

  if (status !== "applied") {
    const applied = results.filter((r) => r.status !== null && r.status >= 200 && r.status < 300).length;
    // Nothing applied and a clear refusal: it is a refusal, not a partial run.
    if (status === "partial" && applied === 0) status = "refused";
    message += status === "partial" ? ` ${applied} de ${plan.writes.length} escritas foram aplicadas; nada foi refeito.` : "";
  }

  if (status !== "refused") invalidateCache(ctx, plan, status);

  let readBack: ReadBack | null = null;
  if (status === "applied") {
    try {
      readBack = await opts.readBack(results);
    } catch (error) {
      readBack = { ok: false, checks: [{ what: "releitura", ok: false, detail: errorText(error) }] };
    }
    message = readBack.ok
      ? "Aplicado e conferido na releitura."
      : `Aplicado, mas a releitura não bateu: ${readBack.checks.filter((c) => !c.ok).map((c) => `${c.what} (${c.detail})`).join("; ")}. Nada foi refeito.`;
  }

  appendAudit(ctx.config, {
    at: new Date(ctx.now()).toISOString(),
    env: ctx.config.env,
    tool: plan.tool,
    reason: plan.reason,
    headline: plan.headline,
    approved: true,
    answer,
    writes: results,
    outcome: status,
    detailsPath,
    ...(snapshot ? { snapshot } : {}),
  });

  return { ...base, detailsPath, status, writes: results, readBack, message, ...(snapshot ? { snapshot } : {}) };
}
