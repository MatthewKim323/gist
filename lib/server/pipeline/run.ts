import "server-only";
import { db } from "../db";
import type { AgentRole } from "@/lib/types";
import { finishRun, makeCtx, startRun, type RunCtx } from "./ctx";

// Orchestrator. Stages are written by parallel owners; each is imported lazily so a stage that has not
// landed yet shows up as a skipped tile instead of breaking the run.

type StageFn = (ctx: RunCtx) => Promise<unknown>;

interface Stage {
  name: "sync" | "ocr" | "extract" | "index" | "reconcile" | "gates" | "synth";
  role: AgentRole;
  load: () => Promise<StageFn | undefined>;
}

/* eslint-disable @typescript-eslint/ban-ts-comment */
const STAGES: Stage[] = [
  // @ts-ignore stage module may not exist yet
  { name: "sync", role: "sync", load: async () => (await import("../sync/index")).syncMatter },
  // @ts-ignore stage module may not exist yet
  { name: "ocr", role: "ocr", load: async () => (await import("../docs/index")).ocrMatter },
  { name: "extract", role: "extract", load: async () => (await import("./extract")).extractMatter },
  // @ts-ignore stage module may not exist yet
  { name: "index", role: "embed", load: async () => (await import("../retrieval/index")).indexMatter },
  // @ts-ignore stage module may not exist yet
  { name: "reconcile", role: "reconcile", load: async () => (await import("../reconcile/index")).reconcileMatter },
  // @ts-ignore stage module may not exist yet
  { name: "gates", role: "gate", load: async () => (await import("../gates/index")).checkGates },
  // Digest has not landed yet: a literal import would fail the Next build. Swap to a literal import
  // ("../digest/index") once lib/server/digest/index.ts exists so it gets bundled on Vercel.
  { name: "synth", role: "synth", load: async () => (await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ `${process.cwd()}/lib/server/digest/index.ts`)).buildDigest },
];
/* eslint-enable @typescript-eslint/ban-ts-comment */

export type StageName = Stage["name"];

export interface RunOpts {
  /** Only run these stages (default: all). */
  only?: StageName[];
  skip?: StageName[];
  /** Reuse an already-created run (the API creates it to return the id immediately). */
  ctx?: RunCtx;
}

export async function countStats(matterId: number, runId: string) {
  const head = { count: "exact" as const, head: true };
  const factCount = (status: string) =>
    db().from("facts").select("id", head).eq("matter_id", matterId).is("superseded_at", null).eq("status", status).then((r) => r.count ?? 0);
  const [entries, docs, verified, rejected, review, pending, tasks] = await Promise.all([
    db().from("source_items").select("id", head).eq("matter_id", matterId).is("deleted_at", null),
    db().from("documents").select("clio_id,version_id").eq("matter_id", matterId),
    factCount("verified"), factCount("rejected"), factCount("needs_review"), factCount("pending"),
    db().from("agent_tasks").select("cost_usd").eq("run_id", runId),
  ]);
  let pages = 0;
  for (const d of docs.data ?? []) {
    if (d.version_id == null) continue;
    const r = await db().from("doc_pages").select("page", head).eq("doc_id", d.clio_id).eq("version_id", d.version_id);
    pages += r.count ?? 0;
  }
  return {
    entries: entries.count ?? 0,
    pages,
    facts_verified: verified,
    facts_rejected: rejected,
    facts_review: review + pending,
    cost: Math.round((tasks.data ?? []).reduce((s, t) => s + Number(t.cost_usd ?? 0), 0) * 10000) / 10000,
  };
}

export async function createRun(matterId: number): Promise<RunCtx> {
  return startRun(matterId);
}

export async function runPipeline(matterId: number, opts: RunOpts = {}): Promise<{ runId: string; stats: Record<string, unknown> }> {
  const ctx = opts.ctx ?? (await startRun(matterId));
  const errors: Record<string, string> = {};
  const stageResults: Record<string, unknown> = {};
  for (const stage of STAGES) {
    if (opts.only && !opts.only.includes(stage.name)) continue;
    if (opts.skip?.includes(stage.name)) continue;
    let fn: StageFn | undefined;
    try {
      fn = await stage.load();
    } catch {
      fn = undefined;
    }
    if (typeof fn !== "function") {
      await ctx.task(stage.role, `${stage.name} (skipped)`, async (t) => { t.cached(); await t.event("skipped: stage not available"); });
      stageResults[stage.name] = "skipped";
      continue;
    }
    try {
      stageResults[stage.name] = (await fn(ctx)) ?? "done";
    } catch (e) {
      errors[stage.name] = String((e as Error).message ?? e).slice(0, 300);
      console.error(`[pipeline] ${stage.name} failed:`, e);
      // Sync failing means we have nothing fresh to work on; everything else degrades gracefully.
      if (stage.name === "sync") {
        const stats = { ...(await countStats(matterId, ctx.runId)), errors };
        await finishRun(ctx, "failed", stats);
        return { runId: ctx.runId, stats };
      }
    }
  }
  const stats = { ...(await countStats(matterId, ctx.runId)), stages: summarize(stageResults), ...(Object.keys(errors).length ? { errors } : {}) };
  await finishRun(ctx, "done", stats);
  return { runId: ctx.runId, stats };
}

/** Keep only small scalar summaries in stats (it is anon-readable: no case content). */
function summarize(r: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v && typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "number" || typeof x === "boolean"));
    } else out[k] = v;
  }
  return out;
}

export { makeCtx };
