import "server-only";
import { db } from "../db";

/**
 * Public demo mode: the latest finished run for a matter (or for any matter when none is given), so the
 * timeline replays a real recorded run instead of starting a new one. Prefers a run that did real work
 * (cost > 0) over a fully cached rerun, which animates less.
 */
export async function latestCompletedRun(matterId?: number | null): Promise<{ runId: string; matterId: number } | null> {
  // Pick the run where the agents did the most real (non-cached) work: that's the one worth replaying.
  let q = db().from("agent_runs").select("id, matter_id").eq("status", "done").order("started_at", { ascending: false }).limit(40);
  if (matterId) q = q.eq("matter_id", matterId);
  const runs = (await q).data ?? [];
  if (!runs.length) return null;
  const ids = runs.map((r) => r.id as string);
  const work = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 10) {
    const { data } = await db().from("agent_tasks").select("run_id").in("run_id", ids.slice(i, i + 10)).eq("status", "done").limit(5000);
    for (const t of data ?? []) work.set(t.run_id as string, (work.get(t.run_id as string) ?? 0) + 1);
  }
  const best = [...runs].sort((a, b) => (work.get(b.id as string) ?? 0) - (work.get(a.id as string) ?? 0))[0];
  return { runId: best.id as string, matterId: Number(best.matter_id) };
}
