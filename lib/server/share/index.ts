import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db, must } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import type { ProviderView, ShareConfig } from "@/lib/types";
import { runGate, type GateFinding } from "./gate";
import { normalizeConfig } from "./plain";
import { applyBlocks, buildProviderDraft, listProviders, type FactCandidate, type ProviderOption } from "./view";

export { listProviders, normalizeConfig };
export type { GateFinding, FactCandidate, ProviderOption };

export interface GatedView {
  view: ProviderView;
  findings: GateFinding[];
  candidates: FactCandidate[];
  gate: { checked: number; blocked: number; engine: string; ms: number };
}

/** Build the provider view, then run every outgoing snippet through the redaction gate. */
export async function buildGatedView(matterId: number, providerContactId: number, config: ShareConfig): Promise<GatedView> {
  const draft = await buildProviderDraft(matterId, providerContactId, config);
  const gate = await runGate({ matterId, providerName: draft.provider.name, snippets: draft.snippets });
  return {
    view: applyBlocks(draft.view, gate.blocked),
    findings: gate.findings,
    candidates: draft.candidates,
    gate: { checked: gate.checked, blocked: gate.blocked.size, engine: gate.engine, ms: gate.ms },
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${env.supabaseServiceKey().slice(-16)}:${ip}`).digest("hex").slice(0, 32);
}

export interface ShareRow {
  id: string;
  matter_id: number;
  provider_contact_id: number | null;
  provider_name: string | null;
  config: ShareConfig & { _stage?: string | null };
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export async function createShare(opts: {
  matterId: number;
  providerContactId: number;
  config: unknown;
  expiresInDays?: number;
  createdBy?: string | null;
}) {
  const config = normalizeConfig(opts.config);
  const providers = await listProviders(opts.matterId);
  const provider = providers.find((p) => p.contact_id === opts.providerContactId);
  // Gate once at publish so the attorney sees exactly what was held back from this link.
  const gated = await buildGatedView(opts.matterId, opts.providerContactId, config);
  const token = randomBytes(32).toString("base64url");
  const days = Math.min(Math.max(opts.expiresInDays ?? 30, 1), 365);
  const { data: matter } = await db().from("matters").select("stage").eq("id", opts.matterId).maybeSingle();
  const row = must(
    await db()
      .from("shares")
      .insert({
        matter_id: opts.matterId,
        provider_contact_id: opts.providerContactId,
        provider_name: provider?.name ?? gated.view.provider_name,
        token_hash: hashToken(token),
        config: { ...config, _stage: (matter as { stage?: string } | null)?.stage ?? null },
        created_by: opts.createdBy ?? null,
        expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      })
      .select("*")
      .single(),
    "insert share",
  ) as ShareRow;
  await db().from("share_notifications").insert({
    share_id: row.id,
    kind: "published",
    message: `Published with ${gated.gate.checked} snippets checked, ${gated.gate.blocked} held back`,
  });
  return { share: row, token, path: `/s/${token}`, findings: gated.findings, gate: gated.gate };
}

export async function revokeShare(id: string) {
  const row = must(
    await db().from("shares").update({ revoked_at: new Date().toISOString() }).eq("id", id).select("*").single(),
    "revoke share",
  ) as ShareRow;
  await db().from("share_notifications").insert({ share_id: id, kind: "revoked", message: "Link revoked by the firm" });
  return row;
}

export async function listShares(matterId: number) {
  const shares = must(
    await db().from("shares").select("*").eq("matter_id", matterId).order("created_at", { ascending: false }),
    "list shares",
  ) as ShareRow[];
  if (!shares.length) return [];
  const views = must(
    await db()
      .from("share_views")
      .select("share_id,viewed_at,user_agent")
      .in("share_id", shares.map((s) => s.id))
      .order("viewed_at", { ascending: false })
      .limit(500),
    "list views",
  ) as { share_id: string; viewed_at: string; user_agent: string | null }[];
  return shares.map((s) => {
    const mine = views.filter((v) => v.share_id === s.id);
    const now = Date.now();
    const state = s.revoked_at ? "revoked" : s.expires_at && new Date(s.expires_at).getTime() < now ? "expired" : "active";
    return {
      id: s.id,
      provider_contact_id: s.provider_contact_id,
      provider_name: s.provider_name,
      created_at: s.created_at,
      expires_at: s.expires_at,
      revoked_at: s.revoked_at,
      state,
      config: s.config,
      view_count: mine.length,
      last_viewed_at: mine[0]?.viewed_at ?? null,
      views: mine.slice(0, 10).map((v) => ({ viewed_at: v.viewed_at, device: deviceOf(v.user_agent) })),
    };
  });
}

export function deviceOf(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "Browser";
}

export type ShareLookup =
  | { ok: true; share: ShareRow }
  | { ok: false; reason: "not_found" | "revoked" | "expired"; share?: ShareRow };

export async function lookupShare(token: string): Promise<ShareLookup> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, reason: "not_found" };
  const { data } = await db().from("shares").select("*").eq("token_hash", hashToken(token)).maybeSingle();
  const share = data as ShareRow | null;
  if (!share) return { ok: false, reason: "not_found" };
  if (share.revoked_at) return { ok: false, reason: "revoked", share };
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired", share };
  return { ok: true, share };
}

export async function logView(share: ShareRow, ip: string | null, userAgent: string | null) {
  await db().from("share_views").insert({ share_id: share.id, ip_hash: hashIp(ip), user_agent: userAgent?.slice(0, 300) ?? null });
  // "Tell me when the case moves": note a stage change since publish.
  const { data: m } = await db().from("matters").select("stage,stage_updated_at").eq("id", share.matter_id).maybeSingle();
  const stage = (m as { stage?: string } | null)?.stage ?? null;
  if (stage && share.config._stage && stage !== share.config._stage) {
    await db().from("share_notifications").insert({ share_id: share.id, kind: "stage_change", message: `Case moved to ${stage}` });
    await db().from("shares").update({ config: { ...share.config, _stage: stage } }).eq("id", share.id);
  }
}

export async function stageNotice(share: ShareRow) {
  const { data } = await db()
    .from("share_notifications")
    .select("message,created_at")
    .eq("share_id", share.id)
    .eq("kind", "stage_change")
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as { message: string; created_at: string } | undefined) ?? null;
}
