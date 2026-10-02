import { NextResponse, type NextRequest } from "next/server";
import { createShare, listShares, revokeShare } from "@/lib/server/share";
import { getSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/** GET /api/share?matterId=  ->  shares for the matter with view counts and the recent view log. */
export async function GET(req: NextRequest) {
  const matterId = Number(req.nextUrl.searchParams.get("matterId"));
  if (!matterId) return bad("matterId required");
  try {
    return NextResponse.json({ shares: await listShares(matterId) });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}

/** POST /api/share {matterId, providerContactId, config, expiresInDays?}  ->  {url, path, share, findings}. The token is shown once. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const matterId = Number(body?.matterId);
  const providerContactId = Number(body?.providerContactId);
  if (!matterId || !providerContactId) return bad("matterId and providerContactId required");
  try {
    const out = await createShare({
      matterId,
      providerContactId,
      config: body?.config,
      expiresInDays: typeof body?.expiresInDays === "number" ? body.expiresInDays : undefined,
      // The sharing profile, so the provider sees this attorney's firm name.
      createdBy: (await getSession())?.profileId ?? (typeof body?.createdBy === "string" ? body.createdBy : null),
    });
    const origin = req.headers.get("x-forwarded-host")
      ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("x-forwarded-host")}`
      : req.nextUrl.origin;
    return NextResponse.json({
      url: `${origin}${out.path}`,
      path: out.path,
      share: { id: out.share.id, provider_name: out.share.provider_name, expires_at: out.share.expires_at },
      findings: out.findings,
      gate: out.gate,
    });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}

/** PATCH /api/share {id, action:'revoke'} */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return bad("id required");
  if ((body?.action ?? "revoke") !== "revoke") return bad("unsupported action");
  try {
    const row = await revokeShare(id);
    return NextResponse.json({ ok: true, id: row.id, revoked_at: row.revoked_at });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}
