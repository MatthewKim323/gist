import "server-only";
import { db } from "../db";
import { plainStage } from "../share/plain";

const PROVIDER_KINDS = ["stage_change", "case_update"];

export interface CaseUpdate {
  message: string;
  created_at: string;
}

/**
 * Plain-English case updates for one provider: share_notifications on this share, or on every live share
 * the office holds for the matter (the /provider portal). Newest first, de-duplicated, no strategy.
 */
export async function caseUpdates(opts: { shareId?: string; matterId?: number; providerContactId?: number }, limit = 8): Promise<CaseUpdate[]> {
  let ids: string[] = [];
  if (opts.shareId) ids = [opts.shareId];
  else if (opts.matterId && opts.providerContactId) {
    const { data } = await db().from("shares").select("id").eq("matter_id", opts.matterId)
      .eq("provider_contact_id", opts.providerContactId).is("revoked_at", null);
    ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  }
  if (!ids.length) return [];
  const { data } = await db().from("share_notifications").select("message,created_at,kind").in("share_id", ids)
    // Only provider-facing kinds; other rows (publish receipts and the like) are firm bookkeeping.
    .in("kind", PROVIDER_KINDS)
    .order("created_at", { ascending: false }).limit(limit * 3);
  const seen = new Set<string>();
  const out: CaseUpdate[] = [];
  for (const r of (data ?? []) as { message: string | null; created_at: string; kind: string | null }[]) {
    if (!r.message) continue;
    let message = r.message;
    const m = /^Case moved to\s*(.+)$/i.exec(message);
    if (m) {
      const ns = plainStage(m[1]);
      message = `Case moved to ${ns ? ns.label : m[1]}`;
    }
    const key = `${message}|${r.created_at.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ message, created_at: r.created_at });
    if (out.length >= limit) break;
  }
  return out;
}
