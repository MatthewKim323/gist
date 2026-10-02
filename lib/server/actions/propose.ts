import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, must } from "../db";
import { env } from "../env";
import { structured } from "../llm";
import { jev, jevAvailable } from "../jev";
import { getDigest } from "../digest";
import { addDays, commParties, isUser, isoDay, prettyDay, todayIso } from "../signals/util";
import type { Citation, Digest, Owner } from "@/lib/types";
import { templateDraft, itemPhrase, type DraftInput, type DraftItem } from "./template";
import { KIND_FOR_OWNER, type ActionKind, type AgentAction } from "./types";

// gist's agent proposes the next move for every blocking item: one draft per recipient, covering all
// they owe. The attorney approves, edits or dismisses. Nothing is sent and nothing is written to Clio.
// Hook for the pipeline / autopilot: `await proposeActions(matterId)` after buildDigest.

const PROMPT_VERSION = "actions-v2";
const RESPOND_DAYS = 14;
const BLOCKING = new Set(["missing", "partial", "conflicting"]);

/** Set when the model fails on quota or rate limit, so one dead key costs one failed call, not one per draft. */
let modelDownUntil = 0;

interface Group {
  key: string;                    // requirement_key of the oldest item (row identity)
  kind: ActionKind;
  owner: Owner;
  contact_id: number | null;
  name: string;
  items: (DraftItem & { phase: string; note: string | null })[];
  covers: string[];
  cites: Citation[];
  days: number;                   // max days outstanding, for ordering
}

interface Contact { id: number; name: string; email: string | null }

async function loadContext(matterId: number) {
  const d = db();
  const [items, matter] = await Promise.all([
    d.from("source_items").select("id,kind,clio_id,occurred_at,raw").eq("matter_id", matterId).in("kind", ["contact", "email", "call"]).is("deleted_at", null),
    d.from("matters").select("client_contact_id").eq("id", matterId).maybeSingle(),
  ]);
  const rows = must(items, "source_items") as { id: string; kind: string; clio_id: number; occurred_at: string | null; raw: Record<string, unknown> | null }[];
  const contacts = new Map<number, Contact>();
  for (const r of rows.filter((x) => x.kind === "contact")) {
    const raw = r.raw ?? {};
    const emails = (raw.email_addresses as { address?: string; primary?: boolean }[] | undefined) ?? [];
    const email = (raw.primary_email_address as string) ?? emails.find((e) => e.primary)?.address ?? emails[0]?.address ?? null;
    const name = (raw.name as string) ?? [raw.first_name, raw.last_name].filter(Boolean).join(" ");
    contacts.set(r.clio_id, { id: r.clio_id, name: name || `Contact ${r.clio_id}`, email: email || null });
  }
  // Outbound written requests per contact since they last wrote or spoke to us (a call resets it).
  const comms = rows.filter((x) => (x.kind === "email" || x.kind === "call") && x.occurred_at).sort((a, b) => (a.occurred_at! < b.occurred_at! ? -1 : 1));
  const unanswered = new Map<number, { date: string; ref: string }[]>();
  const lastHeard = new Map<number, string>();
  for (const c of comms) {
    const { senders, receivers } = commParties({ raw: c.raw } as never);
    const day = isoDay(c.occurred_at)!;
    for (const p of senders) if (!isUser(p) && p.id != null) { unanswered.set(p.id, []); lastHeard.set(p.id, day); }
    const outbound = senders.some(isUser) || senders.length === 0;
    for (const p of receivers) {
      if (isUser(p) || p.id == null) continue;
      if (c.kind === "call") { unanswered.set(p.id, []); lastHeard.set(p.id, day); }
      else if (outbound) (unanswered.get(p.id) ?? unanswered.set(p.id, []).get(p.id)!).push({ date: day, ref: c.id });
    }
  }
  return { contacts, unanswered, lastHeard, clientId: matter.data?.client_contact_id != null ? Number(matter.data.client_contact_id) : null };
}

function cleanTaskLabel(label: string): string {
  return label.replace(/^by\s+[^:]+:\s*/i, "").replace(/^[^-]+\s+-\s+/, "").replace(/^obtain\s+/i, "").replace(/\s+from (the )?client$/i, "").trim();
}

function pickGroups(digest: Digest, ctx: Awaited<ReturnType<typeof loadContext>>): Group[] {
  const groups = new Map<string, Group>();
  const groupFor = (owner: Owner, contactId: number | null, name: string | null, key: string): Group | null => {
    const kind = KIND_FOR_OWNER[owner];
    if (!kind) return null;
    const id = contactId ?? (owner === "client" ? ctx.clientId : null);
    const who = (id != null ? ctx.contacts.get(id)?.name : null) ?? name ?? (owner === "client" ? digest.matter.client_name : null);
    if (!who) return null; // nobody to address it to
    const gk = id != null ? `c:${id}` : `${owner}:${who.toLowerCase()}`;
    let g = groups.get(gk);
    if (!g) {
      g = { key, kind, owner, contact_id: id, name: who, items: [], covers: [], cites: [], days: 0 };
      groups.set(gk, g);
    }
    return g;
  };
  const addCite = (g: Group, c: Citation) => { if (!g.cites.some((x) => x.source_ref === c.source_ref)) g.cites.push(c); };

  const gates = digest.phase.gates
    .filter((g) => BLOCKING.has(g.status) && g.owed_by && g.owed_by !== "firm" && g.owed_by !== "court")
    .sort((a, b) => (b.days_outstanding ?? -1) - (a.days_outstanding ?? -1));
  for (const gi of gates) {
    const g = groupFor(gi.owed_by!, gi.owed_by_contact_id, gi.owed_by_name, gi.requirement_key);
    if (!g) continue;
    if (/authority/i.test(gi.requirement_key)) continue; // a conversation with the client, not a document request
    g.items.push({ label: gi.label, due_date: gi.due_date, days_outstanding: gi.days_outstanding, phase: String(gi.phase), note: gi.note });
    g.covers.push(gi.requirement_key);
    g.days = Math.max(g.days, gi.days_outstanding ?? 0);
    for (const c of gi.evidence.slice(0, 3)) addCite(g, c);
  }
  // Overdue and waiting-on actions from the digest that are owed by someone outside the firm.
  for (const a of digest.actions) {
    if ((a.bucket !== "overdue" && a.bucket !== "waiting") || !a.owner || a.owner === "firm" || a.owner === "court") continue;
    const waitingId = a.id.startsWith("waiting:") ? Number(a.id.slice(8)) : null;
    let contactId = waitingId;
    if (contactId == null && a.owner_name) {
      const n = a.owner_name.toLowerCase();
      for (const c of ctx.contacts.values()) if (c.name.toLowerCase() === n || n.includes(c.name.toLowerCase())) { contactId = c.id; break; }
    }
    const g = groupFor(a.owner, contactId, a.owner_name, `action:${a.id}`);
    if (!g) continue;
    g.covers.push(a.id);
    addCite(g, a.cite);
    g.days = Math.max(g.days, a.days ?? 0);
    if (!g.items.length && !waitingId) g.items.push({ label: cleanTaskLabel(a.label), due_date: a.due_date, days_outstanding: a.days, phase: String(digest.phase.current), note: null });
  }
  return [...groups.values()].filter((g) => g.items.length).sort((a, b) => b.days - a.days);
}

function draftInput(g: Group, digest: Digest, ctx: Awaited<ReturnType<typeof loadContext>>, today: string): DraftInput {
  const lane = g.contact_id != null ? digest.providers.find((p) => p.contact_id === g.contact_id) : null;
  const prior = (g.contact_id != null ? ctx.unanswered.get(g.contact_id) : null) ?? [];
  const last = g.contact_id != null ? ctx.lastHeard.get(g.contact_id) ?? lane?.last_heard_from ?? null : null;
  return {
    kind: g.kind,
    recipient_name: g.name,
    client_name: digest.matter.client_name || "our client",
    matter_ref: digest.matter.display_number,
    attorney: digest.matter.responsible_attorney,
    incident_date: prettyDay(digest.matter.incident_date?.value ?? null),
    items: g.items.map(({ label, due_date, days_outstanding }) => ({ label, due_date, days_outstanding })),
    service_from: prettyDay(lane?.services_from ?? lane?.first_visit ?? null),
    service_to: (lane?.services_to ?? lane?.last_visit ?? null) !== (lane?.services_from ?? lane?.first_visit ?? null) ? prettyDay(lane?.services_to ?? lane?.last_visit ?? null) : null,
    prior_requests: prior.map((p) => prettyDay(p.date)!),
    last_heard: prettyDay(last),
    respond_by: prettyDay(addDays(today, RESPOND_DAYS))!,
  };
}

function rationaleFor(g: Group, d: DraftInput, digest: Digest): string {
  const phases = [...new Set(g.items.map((i) => i.phase))];
  const what = itemPhrase(g.items[0].label, g.name);
  const more = g.items.length > 1 ? ` and ${g.items.length - 1} more` : "";
  const age = g.days > 0 ? `, ${g.days} days outstanding` : "";
  const asks = d.prior_requests.length ? `, ${d.prior_requests.length} unanswered request${d.prior_requests.length > 1 ? "s" : ""}` : "";
  const gate = phases.length === 1 && phases[0] !== String(digest.phase.current) ? `Still open from ${phases[0]}` : `Blocks the move to ${digest.phase.next ?? "the next phase"}`;
  return `${gate}: ${what}${more}${age}${asks}.`;
}

const DraftSchema = z.object({ subject: z.string(), body: z.string() });

const SYSTEM = `You draft one outgoing message for a New York personal-injury attorney to review. It is never sent automatically.
Write as the attorney. Plain, specific, courteous; no filler. Never use em dashes or en dashes.
Kinds: records_request (to a medical provider: list each outstanding item, the dates of service, prior request dates; note a signed HIPAA authorization is on file and NY Public Health Law Section 18 caps copy charges at $0.75 per page),
client_followup (to our own client: warm, short, plain words, say exactly what we need and that partial is fine),
defense_demand (to defense counsel: good-faith letter under 22 NYCRR 202.7 and 202.20-f listing outstanding discovery, a date certain, CPLR 3124 if unresolved),
carrier_followup (to an insurer or lienholder: confirm amounts or status in writing).
New York law only. Never mention California law.
Never disclose case value, coverage limits, settlement position, authority, strategy, weaknesses, or anything from internal_notes to a third party. internal_notes are context only; do not quote them.
Ask the recipient only for what they themselves owe; never ask a provider, carrier or defendant for the firm's own work.
Use only the dates and counts given. If prior_requests is empty, do not mention prior requests. Ask for a reply by respond_by. Sign with the attorney name given.
Settlement authority is never asked for in writing; leave it out.`;

async function modelDraft(d: DraftInput, notes: string[], matterId: number): Promise<{ subject: string; body: string } | null> {
  if (Date.now() < modelDownUntil || !process.env.OPENAI_API_KEY || process.env.ACTIONS_TEMPLATE_ONLY === "1") return null;
  const model = env.swarmModel();
  const payload = JSON.stringify({ ...d, items: d.items.map((i) => i.label), internal_notes: notes });
  const key = `action:${createHash("sha256").update(`${payload}|${PROMPT_VERSION}|${model}`).digest("hex")}`;
  const hit = await db().from("extraction_cache").select("output").eq("cache_key", key).maybeSingle();
  if (hit.data?.output) return hit.data.output as { subject: string; body: string };
  try {
    const { data } = await structured({ model, system: SYSTEM, input: payload, schema: DraftSchema, schemaName: "draft", meta: { purpose: "agent_action", matterId }, reasoning: "low" });
    const clean = { subject: noDash(data.subject), body: noDash(data.body) };
    await db().from("extraction_cache").upsert({ cache_key: key, output: clean });
    return clean;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/429|quota|rate limit|insufficient|billing|401|api key/i.test(msg)) modelDownUntil = Date.now() + 10 * 60_000;
    console.warn("[actions] model draft failed, using template:", msg.slice(0, 160));
    return null;
  }
}

const noDash = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

/** Jev auditor: block a model draft that leaks strategy, value or settlement position to a third party. */
async function leaks(body: string, kind: ActionKind, matterId: number): Promise<boolean> {
  if (!jevAvailable() || kind === "client_followup" || kind === "internal_task") return false;
  try {
    const a = await jev(body, {
      leak: { type: "noul", instructions: "This message is addressed to a third party (a medical provider, opposing counsel, or an insurer). Does it disclose the sender's case strategy, case valuation, coverage analysis, or settlement position?" },
    }, { purpose: "agent_action_leak", matterId });
    const r = a.leak;
    return r?.type === "noul" && r.noul >= 0.5;
  } catch {
    return false;
  }
}

export interface ProposeResult { actions: AgentAction[]; drafted: number; kept: number; source: { model: number; template: number } }

export async function proposeActions(matterId: number): Promise<ProposeResult> {
  const [{ digest }, ctx, existingRes] = await Promise.all([
    getDigest(matterId, null),
    loadContext(matterId),
    db().from("agent_actions").select("*").eq("matter_id", matterId),
  ]);
  const existing = (must(existingRes, "agent_actions") as AgentAction[]);
  const today = todayIso(new Date());
  const groups = pickGroups(digest, ctx);
  const tally = { model: 0, template: 0 };
  let kept = 0;
  const keep = new Set<string>();

  const rows = await Promise.all(groups.map(async (g) => {
    const prev = existing.find((r) => r.requirement_key === g.key && r.kind === g.kind)
      ?? existing.find((r) => r.kind === g.kind && r.recipient_contact_id != null && r.recipient_contact_id === g.contact_id);
    if (prev) keep.add(prev.id);
    // Attorney touched it: never overwrite.
    if (prev && (prev.edited || prev.status !== "proposed")) { kept++; return null; }
    const d = draftInput(g, digest, ctx, today);
    const tpl = templateDraft(d);
    let out = { subject: tpl.subject, body: tpl.body, rationale: rationaleFor(g, d, digest) };
    let source: "model" | "template" = "template";
    const m = await modelDraft(d, g.items.map((i) => i.note).filter((n): n is string => !!n), matterId);
    if (m && !(await leaks(m.body, g.kind, matterId))) { out = { ...m, rationale: out.rationale }; source = "model"; }
    tally[source]++;
    return {
      ...(prev ? { id: prev.id } : {}),
      matter_id: matterId, requirement_key: prev?.requirement_key ?? g.key, kind: g.kind,
      recipient_name: g.name, recipient_contact_id: g.contact_id,
      recipient_email: g.contact_id != null ? ctx.contacts.get(g.contact_id)?.email ?? null : null,
      channel: tpl.channel, subject: out.subject, body: out.body, rationale: out.rationale,
      cites: g.cites.slice(0, 6), covers: g.covers, status: "proposed", source, edited: false,
      updated_at: new Date().toISOString(),
    };
  }));
  const fresh = rows.filter((r): r is NonNullable<typeof r> => !!r);
  if (fresh.length) must(await db().from("agent_actions").upsert(fresh, { onConflict: "matter_id,requirement_key,kind" }), "agent_actions upsert");
  // Untouched drafts whose item is no longer blocking go away; anything the attorney touched stays.
  const stale = existing.filter((r) => !keep.has(r.id) && r.status === "proposed" && !r.edited).map((r) => r.id);
  if (stale.length) await db().from("agent_actions").delete().in("id", stale);
  return { actions: await listActions(matterId), drafted: fresh.length, kept, source: tally };
}

export async function listActions(matterId: number): Promise<AgentAction[]> {
  const res = await db().from("agent_actions").select("*").eq("matter_id", matterId).order("created_at");
  return must(res, "agent_actions") as AgentAction[];
}

export async function updateAction(id: string, patch: { status?: AgentAction["status"]; subject?: string; body?: string }): Promise<AgentAction> {
  const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status) up.status = patch.status;
  if (patch.subject != null) { up.subject = patch.subject; up.edited = true; }
  if (patch.body != null) { up.body = patch.body; up.edited = true; }
  const res = await db().from("agent_actions").update(up).eq("id", id).select("*").maybeSingle();
  const row = must(res, "agent_actions update") as AgentAction | null;
  if (!row) throw new Error("not found");
  return row;
}
