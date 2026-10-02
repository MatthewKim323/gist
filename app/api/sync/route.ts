import { after, NextResponse } from "next/server";
import { db, must } from "@/lib/server/db";
import { discoverMatters, syncMatter } from "@/lib/server/sync";
import { startRun, finishRun } from "@/lib/server/pipeline/ctx";
import { isDemoMode, demoBody } from "@/lib/server/demo-mode";
import { latestCompletedRun } from "@/lib/server/demo/replay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET: matters known to gist (refreshes from Clio with ?refresh=1). */
export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh");
  if (refresh && !isDemoMode()) await discoverMatters();
  const rows = must(
    await db().from("matters").select("id, display_number, description, status, stage, practice_area, client_name, open_date, synced_at").order("id"),
    "matters list",
  );
  return NextResponse.json({ matters: rows });
}

/** POST {matterId?, full?}: start a sync run. Returns the run id at once; the timeline follows agent_tasks. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { matterId?: number | string; full?: boolean };
  let matterId = body.matterId ? Number(body.matterId) : null;
  if (isDemoMode()) {
    // No live sync: hand back the latest recorded run so the timeline still plays.
    const r = await latestCompletedRun(matterId);
    return NextResponse.json(demoBody(undefined, { runId: r?.runId ?? null, matterId: r?.matterId ?? matterId, replay: !!r }));
  }
  if (!matterId) {
    const matters = await discoverMatters();
    const pick = matters.find((m) => m.status === "Open" && /personal injury/i.test(m.practice_area ?? "")) ?? matters[0];
    if (!pick) return NextResponse.json({ error: "no matters in Clio" }, { status: 404 });
    matterId = pick.id;
  }
  const ctx = await startRun(matterId);
  after(async () => {
    try {
      const stats = await syncMatter(ctx, { full: !!body.full });
      await finishRun(ctx, "done", { sync: stats });
    } catch (e) {
      await finishRun(ctx, "failed", { error: String((e as Error).message) });
    }
  });
  return NextResponse.json({ runId: ctx.runId, matterId });
}
