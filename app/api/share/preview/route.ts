import { NextResponse, type NextRequest } from "next/server";
import { buildGatedView, normalizeConfig } from "@/lib/server/share";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/share/preview {matterId, providerContactId, config}  ->  the exact ProviderView + gate findings + fact candidates. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const matterId = Number(body?.matterId);
  const providerContactId = Number(body?.providerContactId);
  if (!matterId || !providerContactId) return NextResponse.json({ error: "matterId and providerContactId required" }, { status: 400 });
  try {
    return NextResponse.json(await buildGatedView(matterId, providerContactId, normalizeConfig(body?.config)));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
