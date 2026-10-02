import "server-only";
// Server-side voice context loader, shared by /api/voice/context and /api/voice/token.
// firm: the latest saved digest. Firm sessions (or the no-session demo flow) only.
// provider: only the gated provider view, for the signed-in provider's own office or a valid share token.
import { getSession } from "@/lib/server/auth/session";
import { findOffice } from "@/lib/server/auth/offices";
import { db } from "@/lib/server/db";
import { getDigest } from "@/lib/server/digest";
import { cachedGatedView, lookupShare, type ShareRow } from "@/lib/server/share";
import { defaultShareConfig, normalizeConfig } from "@/lib/server/share/plain";
import { firmContext, providerContext, type VoiceContext } from "./brief";

export type Loaded = { ok: true; ctx: VoiceContext; matterId: number } | { ok: false; error: string; status: number };
const no = (error: string, status: number): Loaded => ({ ok: false, error, status });

async function latestShare(matterId: number, contactId: number): Promise<ShareRow | null> {
  const { data } = await db()
    .from("shares")
    .select("*")
    .eq("matter_id", matterId)
    .eq("provider_contact_id", contactId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const now = Date.now();
  return ((data ?? []) as ShareRow[]).find((s) => !s.expires_at || new Date(s.expires_at).getTime() > now) ?? null;
}

export async function loadVoiceContext(q: URLSearchParams): Promise<Loaded> {
  const mode = q.get("mode") === "provider" ? "provider" : "firm";
  const matterId = Number(q.get("matterId"));
  const token = q.get("token");
  const session = await getSession();

  if (mode === "firm") {
    if (session?.role === "provider") return no("Forbidden: provider accounts cannot access firm data", 403);
    if (!Number.isFinite(matterId) || matterId <= 0) return no("matterId required", 400);
    try {
      const { digest } = await getDigest(matterId, null);
      return { ok: true, ctx: firmContext(digest), matterId };
    } catch {
      return no("case not available", 404);
    }
  }

  if (token) {
    const found = await lookupShare(token);
    if (!found.ok) return no("link not valid", 404);
    const s = found.share;
    const gated = await cachedGatedView(Number(s.matter_id), Number(s.provider_contact_id), normalizeConfig(s.config), {
      memo: s.config._gate,
      timeoutMs: 2500,
    }).catch(() => null);
    return gated ? { ok: true, ctx: providerContext(gated.view), matterId: Number(s.matter_id) } : no("status unavailable", 503);
  }
  if (session?.role !== "provider") return no("Sign in as a provider or use a share link", 401);
  const contactId = Number(session.providerContactId);
  const office = await findOffice(contactId);
  const current = office?.cases.find((c) => c.matter_id === matterId);
  if (!current) return no("Forbidden: this case is not shared with your office", 403);
  const share = await latestShare(current.matter_id, contactId).catch(() => null);
  const config = share ? normalizeConfig(share.config) : defaultShareConfig();
  const gated = await cachedGatedView(current.matter_id, contactId, config, { memo: share?.config._gate, timeoutMs: 2500 }).catch(() => null);
  return gated ? { ok: true, ctx: providerContext(gated.view), matterId: current.matter_id } : no("status unavailable", 503);
}
