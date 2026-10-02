// Case knowledge graph for the dashboard. Deterministic, no model calls. Firm-only (proxy.ts 403s providers).
import { NextResponse } from "next/server";
import { buildCaseGraph } from "@/lib/server/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("matterId"));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "matterId required" }, { status: 400 });
  try {
    return NextResponse.json(await buildCaseGraph(id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
