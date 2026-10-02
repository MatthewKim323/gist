import "server-only";
// Next moves: one ranked list of executable cards that move a case to its next phase.
// Code only, no model calls. Unifies gate items, agent drafts, provider uploads, shares, red flags and radar.
import { db } from "../db";
import { getDigest } from "../digest";
import { listActions, type AgentAction } from "../actions";
import { signalsFor } from "../radar";
import type { Citation, Digest, GateItem, Owner } from "@/lib/types";
import type { Move, MoveAction, MoveStatus, MovesResult } from "./types";

export type { Move, MoveAction, MoveStatus, MovesResult } from "./types";

const CAP = 8;
const OPEN_GATE = (g: GateItem) => g.status !== "have";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const firstName = (s: string) => s.replace(/,.*$/, "").trim().split(/\s+/)[0] ?? s;
const shortName = (s: string) => s.replace(/\s*\(.*\)$/, "").replace(/,? (LLC|PLLC|PC|P\.C\.|Inc\.?|LLP)$/i, "").trim();

function cites(gs: GateItem[]): Citation[] {
  const out: Citation[] = [];
  for (const g of gs) for (const c of g.evidence ?? []) if (c?.source_ref && !out.some((x) => x.source_ref === c.source_ref)) out.push(c);
  return out.slice(0, 3);
}

function unblocks(n: number, total: number, next: string | null): string | null {
  if (!n || !total) return null;
  return `unblocks ${n} of ${total}${next ? ` for ${next}` : ""}`;
}

function lower1(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** The draft that answers these gate items, if any (newest non-dismissed first). */
function draftFor(drafts: AgentAction[], keys: string[], kind: AgentAction["kind"], contactId?: number | null): AgentAction | null {
  const hit = drafts.filter((a) => a.kind === kind && a.status !== "dismissed"
    && (keys.includes(a.requirement_key) || (a.covers ?? []).some((k) => keys.includes(k))
      || (contactId != null && Number(a.recipient_contact_id) === contactId)));
  hit.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return hit[0] ?? null;
}

function draftAction(d: AgentAction | null, keys: string[], who: string): MoveAction {
  return { kind: "open_draft", label: d ? `Review the draft to ${who}` : `Draft it for ${who}`, payload: { actionId: d?.id ?? null, requirementKeys: keys } };
}

const DRAFT_DONE = (d: AgentAction | null) => d && (d.status === "approved" || d.status === "sent_manually")
  ? (d.status === "approved" ? "Draft approved" : "Sent manually") : null;

interface Raw extends Omit<Move, "status" | "note" | "auto" | "priority"> { rank: number; autoNote: string | null }

function build(d: Digest, drafts: AgentAction[], subs: SubLite[], shares: ShareLite[]): Raw[] {
  const gates = d.phase.gates ?? [];
  const total = gates.length;
  const next = d.phase.next ? String(d.phase.next) : null;
  const open = gates.filter(OPEN_GATE);
  const out: Raw[] = [];
  const laneByContact = new Map(d.providers.map((p) => [p.contact_id, p]));

  // 1. provider-owed blockers, one per provider
  const byProvider = new Map<number, GateItem[]>();
  for (const g of open) if (g.owed_by === "provider" && g.owed_by_contact_id != null) {
    const a = byProvider.get(g.owed_by_contact_id) ?? [];
    a.push(g);
    byProvider.set(g.owed_by_contact_id, a);
  }
  const provOrder = [...byProvider.entries()].sort((a, b) => Math.max(0, ...b[1].map((g) => g.days_outstanding ?? 0)) - Math.max(0, ...a[1].map((g) => g.days_outstanding ?? 0)) || b[1].length - a[1].length);
  provOrder.forEach(([cid, gs], idx) => {
    const lane = laneByContact.get(cid);
    const name = shortName(gs[0].owed_by_name ?? lane?.name ?? "the provider");
    const keys = gs.map((g) => g.requirement_key);
    const draft = draftFor(drafts, keys, "records_request", cid);
    const days = Math.max(0, ...gs.map((g) => g.days_outstanding ?? 0));
    const asks = lane?.open_asks ?? 0;
    const why = [days ? `${days} days outstanding` : `${plural(gs.length, "item")} missing`, asks ? `${plural(asks, "unanswered request")}` : null]
      .filter(Boolean).join(", ");
    out.push({
      id: `records:${cid}`, rank: (idx < 2 ? 100 : 650) + idx,
      title: `Chase ${name}'s ${gs.some((g) => /bill/i.test(g.label)) && gs.every((g) => /bill/i.test(g.label)) ? "bills" : "records"}`,
      why, unblocks: unblocks(gs.length, total, next), party: name, owner: "provider",
      cites: cites(gs), primary: draftAction(draft, keys, name),
      secondary: [{ kind: "open_share", label: `Share status with ${name}`, payload: { providerId: cid } }, { kind: "mark_done", label: "Mark done", payload: {} }],
      autoNote: DRAFT_DONE(draft),
    });
  });

  // 2. client, 3. defense, 4. carrier
  const party: [Owner, AgentAction["kind"], number][] = [["client", "client_followup", 200], ["defense", "defense_demand", 300], ["carrier", "carrier_followup", 350]];
  for (const [owner, kind, rank] of party) {
    const gs = open.filter((g) => g.owed_by === owner);
    if (!gs.length) continue;
    const keys = gs.map((g) => g.requirement_key);
    const draft = draftFor(drafts, keys, kind);
    const rawName = gs.find((g) => g.owed_by_name)?.owed_by_name ?? (owner === "client" ? d.matter.client_name : null);
    const who = owner === "client" ? firstName(rawName ?? "the client") : shortName(rawName ?? `${owner} counsel`);
    const what = gs.length === 1 ? lower1(gs[0].label.replace(/\.$/, "")) : `${gs.length} missing items`;
    const title = owner === "client" ? `Get ${what} from ${who}`
      : owner === "defense" ? `Press ${who} for ${what}` : `Follow up with ${who} on ${what}`;
    const days = Math.max(0, ...gs.map((g) => g.days_outstanding ?? 0));
    const clientDays = owner === "client" ? d.last_client_contact_detail?.days_ago ?? null : null;
    const why = [days ? `${days} days outstanding` : null, clientDays != null ? `last client contact ${clientDays} days ago` : null,
      gs.length > 1 ? gs.slice(0, 2).map((g) => lower1(g.label)).join(", ") + (gs.length > 2 ? ` +${gs.length - 2}` : "") : null]
      .filter(Boolean).join(", ") || `${plural(gs.length, "item")} owed`;
    out.push({
      id: `${owner}:followup`, rank: rank - (draft ? 10 : 0),
      title, why, unblocks: unblocks(gs.length, total, next), party: who, owner,
      cites: cites(gs), primary: draftAction(draft, keys, who),
      secondary: [{ kind: "open_tab", label: "See the checklist", payload: { tab: "phase" } }, { kind: "mark_done", label: "Mark done", payload: {} }],
      autoNote: DRAFT_DONE(draft),
    });
  }

  // 5. provider uploads waiting for review
  for (const s of subs) {
    if (s.status === "dismissed") continue;
    const name = shortName(s.provider_name ?? "Provider");
    out.push({
      id: `review:${s.id}`, rank: s.status === "pending" ? 50 : 500,
      title: `Review ${name}'s upload`,
      why: `${s.item_label ?? s.kind}${s.file_name ? `, ${s.file_name}` : ""}, sent ${s.created_at.slice(0, 10)}`,
      unblocks: s.gate_requirement_key ? unblocks(1, total, next) : null, party: name, owner: "provider", cites: [],
      primary: { kind: "review_upload", label: "Accept into the file", payload: { submissionId: s.id, url: s.url } },
      secondary: [{ kind: "open_tab", label: "Open the inbox", payload: { tab: "inbox" } }],
      autoNote: s.status === "accepted" ? "Upload accepted into the file" : null,
    });
  }

  // 6. share case status with the providers we are waiting on (they cannot help without visibility)
  const active = new Set(shares.filter((s) => s.state === "active").map((s) => s.provider_contact_id));
  const shareTargets = [...provOrder.map(([cid]) => cid), ...d.providers.map((p) => p.contact_id)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 2);
  for (const cid of shareTargets) {
    const lane = laneByContact.get(cid);
    const name = shortName(lane?.name ?? byProvider.get(cid)?.[0]?.owed_by_name ?? "provider");
    const owes = byProvider.get(cid)?.length ?? 0;
    out.push({
      id: `share:${cid}`, rank: 250 + shareTargets.indexOf(cid) * 300,
      title: `Share case status with ${name}`,
      why: owes ? `they owe ${plural(owes, "item")} and have no live link` : `${lane?.visits.length ?? 0} visits on file, no live status link`,
      unblocks: null, party: name, owner: "provider", cites: [],
      primary: { kind: "open_share", label: `Share with ${name}`, payload: { providerId: cid } },
      secondary: [{ kind: "mark_done", label: "Mark done", payload: {} }],
      autoNote: active.has(cid) ? `Share link live for ${name}` : null,
    });
  }

  // 7. red flags before depositions, 8. policy limits, 9. SOL (all from the cited radar)
  const sig = signalsFor(d);
  const hi = d.red_flags.filter((f) => f.severity === "high");
  if (hi.length) out.push({
    id: "flags:depo", rank: 420,
    title: `Prep the ${plural(hi.length, "high red flag")} before depositions`,
    why: hi.slice(0, 2).map((f) => f.title).join("; "),
    unblocks: null, party: "Firm", owner: "firm",
    cites: hi.flatMap((f) => f.claims.slice(0, 1).map((c) => ({ source_ref: c.source_ref, quote: c.quote, label: c.label }))).slice(0, 3),
    primary: { kind: "open_tab", label: "Open red flags", payload: { tab: "flags" } },
    secondary: [{ kind: "mark_done", label: "Mark prepped", payload: {} }], autoNote: null,
  });
  const pl = sig.find((s) => s.kind === "policy_limits");
  if (pl) {
    const lim = d.money.coverage_limit?.value, spec = d.money.specials?.value;
    out.push({
      id: "demand:limits", rank: pl.severity === "high" ? 380 : 470,
      title: spec != null && lim != null && spec > lim ? "Policy-limits demand: specials exceed the limit" : "Policy-limits demand: value exceeds the limit",
      why: spec != null && lim != null ? `specials ${usd(spec)} vs ${usd(lim)} limit` : pl.detail,
      unblocks: null, party: "Carrier", owner: "carrier", cites: pl.cite ? [pl.cite] : [],
      primary: { kind: "open_tab", label: "Open the money", payload: { tab: "money" } },
      secondary: [{ kind: "mark_done", label: "Mark demand sent", payload: {} }], autoNote: null,
    });
  }
  const sol = sig.find((s) => s.kind === "sol");
  if (sol) out.push({
    id: "sol:calendar", rank: sol.severity === "high" ? 10 : 480,
    title: "Lock the statute of limitations", why: sol.headline,
    unblocks: null, party: "Firm", owner: "firm", cites: sol.cite ? [sol.cite] : [],
    primary: { kind: "open_tab", label: "Open phase & gates", payload: { tab: "phase" } },
    secondary: [{ kind: "mark_done", label: "Mark calendared", payload: {} }], autoNote: null,
  });
  return out;
}

interface SubLite { id: string; provider_name: string | null; item_label: string | null; kind: string; file_name: string | null; status: string; created_at: string; gate_requirement_key: string | null; url: string | null }
interface ShareLite { provider_contact_id: number | null; state: string }

async function loadSubs(matterId: number): Promise<SubLite[]> {
  const r = await db().from("provider_submissions").select("id,provider_name,item_label,kind,file_name,status,created_at,gate_requirement_key").eq("matter_id", matterId).order("created_at", { ascending: false }).limit(20);
  return ((r.data ?? []) as Omit<SubLite, "url">[]).map((x) => ({ ...x, url: null }));
}
async function loadShares(matterId: number): Promise<ShareLite[]> {
  const r = await db().from("shares").select("provider_contact_id,revoked_at,expires_at").eq("matter_id", matterId);
  const now = Date.now();
  return ((r.data ?? []) as { provider_contact_id: number | null; revoked_at: string | null; expires_at: string | null }[]).map((s) => ({
    provider_contact_id: s.provider_contact_id == null ? null : Number(s.provider_contact_id),
    state: s.revoked_at ? "revoked" : s.expires_at && new Date(s.expires_at).getTime() < now ? "expired" : "active",
  }));
}

export async function nextMoves(matterId: number, digest?: Digest): Promise<MovesResult> {
  const [d, drafts, subs, shares, rows] = await Promise.all([
    digest ? Promise.resolve(digest) : getDigest(matterId, null).then((x) => x.digest),
    listActions(matterId).catch(() => [] as AgentAction[]),
    loadSubs(matterId).catch(() => [] as SubLite[]),
    loadShares(matterId).catch(() => [] as ShareLite[]),
    db().from("case_moves").select("move_key,status,note").eq("matter_id", matterId).then((r) => (r.data ?? []) as { move_key: string; status: MoveStatus; note: string | null }[]),
  ]);
  const saved = new Map(rows.map((r) => [r.move_key, r]));
  const raw = build(d, drafts, subs, shares).sort((a, b) => a.rank - b.rank);
  const moves: Move[] = raw.map(({ rank, autoNote, ...m }, i) => {
    const s = saved.get(m.id);
    const auto = !!autoNote;
    const status: MoveStatus = auto ? "done" : s?.status ?? "todo";
    return { ...m, priority: i + 1, status, note: s?.note ?? autoNote ?? null, auto };
  });
  const live = moves.filter((m) => m.status === "todo" || m.status === "in_progress").slice(0, CAP);
  const closed = moves.filter((m) => m.status === "done" || m.status === "dismissed");
  live.forEach((m, i) => { m.priority = i + 1; });
  closed.forEach((m) => { m.priority = 0; });
  const gates = d.phase.gates ?? [];
  return {
    matterId, client: d.matter.client_name, current_phase: String(d.phase.current), next_phase: d.phase.next ? String(d.phase.next) : null,
    gates_have: gates.filter((g) => g.status === "have").length, gates_total: gates.length,
    moves: [...live, ...closed], open: live.length, done: closed.filter((m) => m.status === "done").length,
  };
}

export async function setMoveStatus(matterId: number, key: string, status: MoveStatus, note?: string | null) {
  const r = await db().from("case_moves").upsert(
    { matter_id: matterId, move_key: key, status, note: note ?? null, updated_at: new Date().toISOString() },
    { onConflict: "matter_id,move_key" },
  ).select("*").single();
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
