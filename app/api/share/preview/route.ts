import { NextResponse, type NextRequest } from "next/server";
import { cachedGatedView, normalizeConfig } from "@/lib/server/share";
import { withFirmName } from "@/lib/server/share/firm";
import { getSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/share/preview {matterId, providerContactId, config}  ->  the exact ProviderView + gate findings + fact candidates. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const matterId = Number(body?.matterId);
  const providerContactId = Number(body?.providerContactId);
  if (!matterId || !providerContactId) return NextResponse.json({ error: "matterId and providerContactId required" }, { status: 400 });
  try {
    const out = await cachedGatedView(matterId, providerContactId, normalizeConfig(body?.config));
    // Preview with the signed-in attorney's firm name, exactly as the provider will see it once shared.
    return NextResponse.json({ ...out, view: await withFirmName(out.view, (await getSession())?.profileId ?? null) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
