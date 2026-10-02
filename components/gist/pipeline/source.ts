"use client";
// Where the timeline gets its rows. The real source reads agent_runs / agent_tasks with the anon key
// (RLS lets anon read pipeline progress only) and listens on Supabase Realtime filtered by run_id.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentTask } from "@/lib/types";
import { normalizeRun, normalizeTask, type AgentRun } from "./stages";

export type LiveState = "connecting" | "live" | "polling";

export interface PipelineHandlers {
  task(t: AgentTask): void;
  run(r: AgentRun): void;
  live?(s: LiveState): void;
}

export interface PipelineSource {
  /** Snapshot of the run and every task row so far. */
  load(runId: string): Promise<{ run: AgentRun | null; tasks: AgentTask[] }>;
  /** Push updates as they happen. Returns an unsubscribe. */
  subscribe(runId: string, h: PipelineHandlers): () => void;
}

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("PipelineTimeline: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 40 } },
  });
  return client;
}

export const supabaseSource: PipelineSource = {
  async load(runId) {
    const [runRes, taskRes] = await Promise.all([
      sb().from("agent_runs").select("*").eq("id", runId).maybeSingle(),
      sb().from("agent_tasks").select("*").eq("run_id", runId).order("id", { ascending: true }).limit(5000),
    ]);
    if (taskRes.error) throw new Error(taskRes.error.message);
    return {
      run: runRes.data ? normalizeRun(runRes.data) : null,
      tasks: (taskRes.data ?? []).map(normalizeTask),
    };
  },
  subscribe(runId, h) {
    h.live?.("connecting");
    const ch = sb()
      .channel(`gist-run-${runId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_tasks", filter: `run_id=eq.${runId}` },
        (p) => {
          if (p.new && Object.keys(p.new).length) h.task(normalizeTask(p.new as Record<string, unknown>));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_runs", filter: `id=eq.${runId}` },
        (p) => {
          if (p.new && Object.keys(p.new).length) h.run(normalizeRun(p.new as Record<string, unknown>));
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") h.live?.("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") h.live?.("polling");
      });
    return () => {
      void sb().removeChannel(ch);
    };
  },
};
