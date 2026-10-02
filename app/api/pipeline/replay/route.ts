// GET ?matterId= -> the best recorded run to replay (latest finished, preferring one that did real work).
import { NextResponse } from "next/server";
import { latestCompletedRun } from "@/lib/server/demo/replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const m = new URL(req.url).searchParams.get("matterId");
  const r = await latestCompletedRun(m ? Number(m) : null);
  if (!r) return NextResponse.json({ error: "no recorded run" }, { status: 404 });
  return NextResponse.json(r);
}
