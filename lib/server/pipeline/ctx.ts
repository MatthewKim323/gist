import "server-only";
import { db } from "../db";
import type { AgentRole } from "@/lib/types";

/**
 * Every pipeline stage reports through a RunCtx so each unit of work shows up as an agent_tasks row.
 * The pipeline timeline UI subscribes to agent_tasks over Supabase Realtime, so whatever a stage does
 * here is what the user watches. last_event must stay content-free (counts, labels): anon can read it.
 */
export interface RunCtx {
  runId: string;
  matterId: number;
  /** Track one unit of work. Returns fn's result; marks the row done/cached/failed. */
  task<T>(role: AgentRole, label: string, fn: (t: TaskHandle) => Promise<T>): Promise<T>;
}

export interface TaskHandle {
  id: number;
  /** Mark this task as served from cache (no model call). */
  cached(): void;
  /** Add usage from a model call made inside this task. */
  usage(u: { input?: number; output?: number; cost?: number }): void;
  facts(n: number): void;
  event(text: string): Promise<void>;
}

export async function startRun(matterId: number): Promise<RunCtx> {
  const { data, error } = await db().from("agent_runs").insert({ matter_id: matterId }).select("id").single();
  if (error) throw new Error(`startRun: ${error.message}`);
  return makeCtx(data.id as string, matterId);
}

export function makeCtx(runId: string, matterId: number): RunCtx {
  return {
    runId,
    matterId,
    async task(role, label, fn) {
      const ins = await db()
        .from("agent_tasks")
        .insert({ run_id: runId, role, shard_label: label, status: "running", started_at: new Date().toISOString(), worker: `${role}-${Math.random().toString(36).slice(2, 6)}` })
        .select("id")
        .single();
      if (ins.error) throw new Error(`task insert: ${ins.error.message}`);
      const id = ins.data.id as number;
      let wasCached = false;
      const acc = { input: 0, output: 0, cost: 0, facts: 0 };
      const handle: TaskHandle = {
        id,
        cached: () => { wasCached = true; },
        usage: (u) => { acc.input += u.input ?? 0; acc.output += u.output ?? 0; acc.cost += u.cost ?? 0; },
        facts: (n) => { acc.facts += n; },
        event: async (text) => { await db().from("agent_tasks").update({ last_event: text.slice(0, 200) }).eq("id", id); },
      };
      try {
        const out = await fn(handle);
        await db().from("agent_tasks").update({
          status: wasCached ? "cached" : "done", finished_at: new Date().toISOString(),
          tokens_in: acc.input, tokens_out: acc.output, cost_usd: acc.cost, facts_emitted: acc.facts,
        }).eq("id", id);
        return out;
      } catch (e) {
        await db().from("agent_tasks").update({
          status: "failed", finished_at: new Date().toISOString(), last_event: String((e as Error).message).slice(0, 200),
        }).eq("id", id);
        throw e;
      }
    },
  };
}

export async function finishRun(ctx: RunCtx, status: "done" | "failed", stats: Record<string, unknown> = {}) {
  const { data } = await db().from("agent_tasks").select("cost_usd").eq("run_id", ctx.runId);
  const cost = (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  await db().from("agent_runs").update({ status, finished_at: new Date().toISOString(), cost_usd: cost, stats }).eq("id", ctx.runId);
}
