// The voice agent's prompt and tool answers for one call. Access rules live in lib/voice/server.ts;
// providers can never get firm mode (also fenced in proxy.ts).
import { NextResponse, type NextRequest } from "next/server";
import { loadVoiceContext } from "@/lib/voice/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await loadVoiceContext(req.nextUrl.searchParams);
  const headers = { "cache-control": "no-store" };
  return r.ok ? NextResponse.json(r.ctx, { headers }) : NextResponse.json({ error: r.error }, { status: r.status, headers });
}
