import "server-only";
import { db } from "../db";

/**
 * Public demo mode: the latest finished run for a matter (or for any matter when none is given), so the
 * timeline replays a real recorded run instead of starting a new one. Prefers a run that did real work
 * (cost > 0) over a fully cached rerun, which animates less.
 */
export async function latestCompletedRun(matterId?: number | null): Promise<{ runId: string; matterId: number } | null> {
  const base = () => {
    let q = db().from("agent_runs").select("id, matter_id").eq("status", "done");
    if (matterId) q = q.eq("matter_id", matterId);
    return q;
  };
  const rich = await base().gt("cost_usd", 0).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const row = rich.data ?? (await base().order("started_at", { ascending: false }).limit(1).maybeSingle()).data;
  return row ? { runId: row.id as string, matterId: Number(row.matter_id) } : null;
}
