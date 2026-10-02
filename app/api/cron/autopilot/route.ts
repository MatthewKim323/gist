import { NextResponse } from "next/server";
import { autopilotTick, getState, isDue } from "@/lib/server/autopilot/tick";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Vercel Cron entry. Checks the bearer secret when CRON_SECRET is set, then ticks if autopilot is on and due. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const state = await getState();
  if (!state.enabled) return NextResponse.json({ ran: false, reason: "autopilot is off" });
  if (!isDue(state)) return NextResponse.json({ ran: false, reason: "not due", next_tick_at: state.next_tick_at });
  try {
    const out = await autopilotTick();
    return NextResponse.json({ ran: out.ran, reason: out.reason, watched: out.watched, events: out.events.length, ms: out.ms });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
