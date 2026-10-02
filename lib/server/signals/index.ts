import "server-only";
import { db } from "../db";
import { PHASES, type ActionItem, type Cited, type Citation, type Digest, type ProviderLane } from "@/lib/types";
import { loadMatter, type ItemRow, type MatterData } from "./load";
import { moneySignals, type MoneySignals } from "./money";
import { actionSignals, commStats, contactMap, lastClientContact, providerLanes, type CommStat, type ContactInfo } from "./people";
import { cite, daysBetween, fieldValue, isoDay, makeLabeler, todayIso, type Labeler } from "./util";

export { loadMatter } from "./load";
export type { MatterData } from "./load";
export { makeLabeler, todayIso, prettyDay, isoDay, daysBetween } from "./util";
export type { Labeler } from "./util";
export { contactMap, nameTokens } from "./people";
export type { ContactInfo, CommStat } from "./people";

export interface Signals {
  today: string;
  label: Labeler;
  contacts: Map<number, ContactInfo>;
  comm: Map<number, CommStat>;
  incident_date: Cited<string> | null;
  incident_from_field: boolean;
  days_since_incident: number | null;
  stage: string;
  stage_since: string | null;
  time_in_stage_days: number | null;
  next_stage: string | null;
  sol: { date: Cited<string>; days_remaining: number; satisfied: boolean | null } | null;
  money: MoneySignals;
  actions: ActionItem[];
  last_client_contact: Cited<string> | null;
  last_client_contact_channel: string | null;
  last_client_contact_days: number | null;
  last_written_from_client: Cited<string> | null;
  providers: ProviderLane[];
  completeness: Digest["completeness"];
}

export function stageOrder(data: MatterData): string[] {
  const names = data.stages.filter((s) => !data.matter.practice_area || !s.practice_area || s.practice_area === data.matter.practice_area)
    .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0)).map((s) => s.name);
  return names.length ? names : [...PHASES];
}

export async function computeSignals(matterId: number, preloaded?: MatterData): Promise<Signals & { data: MatterData }> {
  const data = preloaded ?? (await loadMatter(matterId));
  const today = todayIso(data.today);
  const label = makeLabeler(data.items, data.docs);
  const fields = data.byKind.field ?? [];

  // incident date: custom field, else matter open date
  const dateF = fields.find((f) => f.title && /date of (incident|loss|accident|injury)|incident date|accident date|\bdoi\b|\bdol\b/i.test(f.title));
  const dateV = dateF ? isoDay(String(fieldValue(dateF) ?? "")) : null;
  const incident_date: Cited<string> | null = dateV && dateF
    ? { value: dateV, cites: [cite(label, dateF.id)] }
    : data.matter.open_date ? { value: isoDay(data.matter.open_date)!, cites: [{ source_ref: `matter:${matterId}`, label: "Clio matter · open date" }] } : null;

  const order = stageOrder(data);
  const stage = data.matter.stage ?? "Intake";
  const idx = order.findIndex((s) => s.toLowerCase() === stage.toLowerCase());
  const stage_since = isoDay(data.matter.stage_updated_at);

  const { data: cx } = await db().from("contradictions").select("event_key,title").eq("matter_id", matterId);
  const contradictionKeys = (cx ?? []).map((c) => `${c.event_key ?? ""} ${c.title ?? ""}`);
  const money = moneySignals(fields, data.byKind.expense ?? [], data.facts, contradictionKeys, label);

  const contacts = contactMap(data);
  const comm = commStats(data, contacts);
  const { actions, sol: solTask } = actionSignals(data, today, contacts, comm, label);
  let sol = solTask;
  if (data.matter.sol_date) {
    const d = isoDay(data.matter.sol_date)!;
    const cites: Citation[] = [{ source_ref: `matter:${matterId}`, label: "Clio matter · statute of limitations" }, ...(solTask?.date.cites ?? [])];
    sol = { date: { value: d, cites }, days_remaining: daysBetween(today, d), satisfied: solTask?.satisfied ?? null };
  }
  const lcc = lastClientContact(data, label, today);
  const providers = providerLanes(data, contacts, comm, actions, label, today);

  // completeness
  const readable = data.items.filter((i) => !["contact", "relationship", "field"].includes(i.kind));
  const [pages, ocrPages, chunkRows] = await Promise.all([
    db().from("doc_pages").select("doc_id", { count: "exact", head: true }).in("doc_id", data.docs.map((d) => d.clio_id).concat([-1])),
    db().from("doc_pages").select("doc_id", { count: "exact", head: true }).in("doc_id", data.docs.map((d) => d.clio_id).concat([-1])).eq("source", "ocr"),
    db().from("chunks").select("source_kind,source_id").eq("matter_id", matterId).neq("source_kind", "doc_page").neq("source_kind", "fact").limit(5000),
  ]);
  const indexed = new Set((chunkRows.data ?? []).map((c) => `${c.source_kind}:${c.source_id}`));
  const factRefs = new Set(data.facts.map((f) => f.source_ref.split("#")[0]));
  const entries_read = data.allFactCounts.verified + data.allFactCounts.rejected + data.allFactCounts.review > 0 && indexed.size === 0
    ? readable.length
    : readable.filter((i) => indexed.has(i.id) || indexed.has(`${i.kind}:${i.clio_id}`) || factRefs.has(i.id)).length;

  return {
    data, today, label, contacts, comm,
    incident_date, incident_from_field: !!(dateV && dateF),
    days_since_incident: incident_date ? daysBetween(incident_date.value, today) : null,
    stage, stage_since,
    time_in_stage_days: stage_since && daysBetween(stage_since, today) >= 1 ? daysBetween(stage_since, today) : null,
    next_stage: idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null,
    sol, money, actions,
    last_client_contact: lcc.contact, last_client_contact_channel: lcc.channel, last_client_contact_days: lcc.days,
    last_written_from_client: lcc.last_written_from_client,
    providers,
    completeness: {
      entries_read, entries_total: readable.length,
      pages_read: pages.count ?? 0, pages_total: data.docs.reduce((s, d) => s + (d.page_count ?? 0), 0),
      pages_ocr: ocrPages.count ?? 0,
      facts_verified: data.allFactCounts.verified, facts_rejected: data.allFactCounts.rejected, facts_review: data.allFactCounts.review,
    },
  };
}

/** Items new or changed since the viewer last opened the matter. Two small queries; no full matter load. */
export async function sinceLastOpened(matterId: number, viewer: string | null): Promise<Digest["since_last_opened"]> {
  if (!viewer) return { at: null, items: [] };
  const { data: v } = await db().from("matter_views").select("last_opened_at").eq("viewer", viewer).eq("matter_id", matterId).maybeSingle();
  const at = (v?.last_opened_at as string | null) ?? null;
  if (!at) return { at: null, items: [] };
  const { data: rows } = await db().from("source_items")
    .select("id,matter_id,kind,clio_id,title,occurred_at,first_seen_at,content_changed_at")
    .eq("matter_id", matterId).is("deleted_at", null)
    .or(`first_seen_at.gt."${at}",content_changed_at.gt."${at}"`)
    .order("content_changed_at", { ascending: false }).limit(50);
  const items = (rows ?? []) as ItemRow[];
  const label = makeLabeler(items, []);
  return {
    at,
    items: items.map((i) => ({
      label: `${i.first_seen_at && i.first_seen_at > at ? "New" : "Updated"}: ${i.title ?? i.kind}`,
      kind: i.kind, cite: cite(label, i.id),
    })),
  };
}

export async function markViewed(matterId: number, viewer: string, digestVersion: number | null) {
  await db().from("matter_views").upsert({ viewer, matter_id: matterId, last_opened_at: new Date().toISOString(), digest_version_seen: digestVersion },
    { onConflict: "viewer,matter_id" });
}
