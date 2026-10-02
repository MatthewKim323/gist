import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { getState, recentEvents, watchedCount } from "@/lib/server/autopilot/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: autopilot state, how many cases it watches, and the last 30 events. Firm only (proxy.ts). */
export async function GET() {
  const [state, events, watching] = await Promise.all([getState(), recentEvents(30), watchedCount()]);
  return NextResponse.json({ state, events, watching, cron: !!process.env.VERCEL, dev: process.env.NODE_ENV !== "production" });
}

/** PATCH {enabled?, interval_min?}: turn autopilot on or off, or change how often it checks. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean; interval_min?: number };
  await getState();
  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.interval_min != null) {
    const n = Math.round(Number(body.interval_min));
    if (!Number.isFinite(n) || n < 1 || n > 1440) return NextResponse.json({ error: "interval_min must be 1 to 1440" }, { status: 400 });
    patch.interval_min = n;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  if (patch.enabled === true || patch.interval_min) {
    const s = await getState();
    const base = s.last_tick_at ? Date.parse(s.last_tick_at) : Date.now();
    patch.next_tick_at = new Date(base + Number(patch.interval_min ?? s.interval_min) * 60_000).toISOString();
  }
  const { error } = await db().from("autopilot_state").update(patch).eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ state: await getState() });
}
