import { NextResponse } from "next/server";
import { similar } from "@/lib/server/retrieval/similar";

export const runtime = "nodejs";

// GET /api/similar?chunkId=12 | ?ref=email:88&matterId=1 [&k=6]
export async function GET(req: Request) {
  const u = new URL(req.url);
  const chunkId = u.searchParams.get("chunkId");
  const ref = u.searchParams.get("ref");
  const matterId = u.searchParams.get("matterId");
  const k = Math.min(Number(u.searchParams.get("k") ?? 6) || 6, 25);
  if (!chunkId && !ref) return NextResponse.json({ error: "chunkId or ref required" }, { status: 400 });
  try {
    const hits = await similar({ chunkId: chunkId ? Number(chunkId) : undefined, ref: ref ?? undefined, matterId: matterId ? Number(matterId) : undefined, k });
    return NextResponse.json({ hits });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
