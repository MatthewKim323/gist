import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/db";
import { createRun, runPipeline, type StageName } from "@/lib/server/pipeline/run";

export const runtime = "nodejs";
export const maxDuration = 800;

/** POST {matterId, only?, skip?} starts a run in the background and returns its id right away. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { matterId?: number | string; only?: StageName[]; skip?: StageName[] };
  const matterId = Number(body.matterId);
  if (!Number.isFinite(matterId) || matterId <= 0) return NextResponse.json({ error: "matterId required" }, { status: 400 });
  const ctx = await createRun(matterId);
  after(async () => {
    try {
      await runPipeline(matterId, { ctx, only: body.only, skip: body.skip });
    } catch (e) {
      console.error("[pipeline] run failed", e);
    }
  });
  return NextResponse.json({ runId: ctx.runId });
}

/** GET ?runId= returns the run and its tasks; GET ?matterId= returns the latest run for a matter. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  let runId = url.searchParams.get("runId");
  const matterId = url.searchParams.get("matterId");
  if (!runId && matterId) {
    const r = await db().from("agent_runs").select("id").eq("matter_id", Number(matterId)).order("started_at", { ascending: false }).limit(1).maybeSingle();
    runId = (r.data?.id as string | undefined) ?? null;
  }
  if (!runId) return NextResponse.json({ error: "runId or matterId required" }, { status: 400 });
  const [run, tasks] = await Promise.all([
    db().from("agent_runs").select("*").eq("id", runId).maybeSingle(),
    db().from("agent_tasks").select("*").eq("run_id", runId).order("id"),
  ]);
  if (!run.data) return NextResponse.json({ error: "run not found" }, { status: 404 });
  return NextResponse.json({ run: run.data, tasks: tasks.data ?? [] });
}
