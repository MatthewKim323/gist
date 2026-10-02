import { NextResponse } from "next/server";
import { demoBody, isDemoMode } from "@/lib/server/demo-mode";
import { autopilotTick, cleanupSimulated, getState, isDue, type Simulate } from "@/lib/server/autopilot/tick";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST: check Clio now and return what moved. Firm or no session (proxy.ts blocks providers).
 * ?ifDue=1 only runs when the schedule says a check is due (the open /cases tab uses this in dev).
 * Dev only: ?simulate=stage|all fakes a stale snapshot to exercise the diff, ?simulate=cleanup removes those rows.
 */
export async function POST(req: Request) {
  if (isDemoMode()) return NextResponse.json(demoBody(undefined, { ran: false, reason: "demo", events: [] }));
  const url = new URL(req.url);
  const sim = url.searchParams.get("simulate");
  const devSim = process.env.NODE_ENV !== "production" || process.env.AUTOPILOT_DEV === "1";
  if (sim && !devSim) return NextResponse.json({ error: "simulate is dev only" }, { status: 400 });
  if (sim === "cleanup") return NextResponse.json({ cleaned: await cleanupSimulated() });
  if (url.searchParams.get("ifDue") === "1" && !isDue(await getState())) return NextResponse.json({ ran: false, reason: "not due" });
  const simulate: Simulate = sim === "stage" || sim === "all" ? sim : null;
  const matterId = url.searchParams.get("matterId");
  try {
    const out = await autopilotTick({ simulate, matterId: matterId ? Number(matterId) : undefined });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
