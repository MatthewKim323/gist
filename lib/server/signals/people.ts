import type { ActionItem, Cited, Citation, Owner, ProviderLane } from "@/lib/types";
import type { ItemRow, MatterData } from "./load";
import { addDays, cite, commParties, daysBetween, isUser, isoDay, type Labeler } from "./util";

// People-side signals: contacts and their roles, overdue / upcoming / waiting-on, last client contact,
// per-contact silence, provider lanes. All deterministic over Clio fields.

export interface ContactInfo { id: number; name: string; role: string | null; owner: Owner | null; relationshipRef: string | null }

const PROVIDER_RE = /treating|provider|hospital|physician|doctor|surgeon|chiropract|therap|orthop|radiolog|imaging|clinic|medical center|neurolog|physiatr/i;
const ADVERSE_RE = /adverse|defendant|defen[cs]e|opposing|tortfeasor/i;
const CARRIER_RE = /carrier|insur|claims|adjust|administrator|tpa\b/i;

export function roleOwner(desc: string | null): Owner | null {
  if (!desc) return null;
  if (ADVERSE_RE.test(desc) && !CARRIER_RE.test(desc)) return "defense";
  if (CARRIER_RE.test(desc)) return "carrier";
  if (PROVIDER_RE.test(desc)) return "provider";
  if (/court|judge|clerk/i.test(desc)) return "court";
  return null;
}

export function contactMap(data: MatterData): Map<number, ContactInfo> {
  const map = new Map<number, ContactInfo>();
  for (const c of data.byKind.contact ?? []) {
    const r = (c.raw ?? {}) as Record<string, unknown>;
    const name = (r.name as string) ?? c.title ?? [r.first_name, r.last_name].filter(Boolean).join(" ");
    map.set(c.clio_id, { id: c.clio_id, name: name || `Contact ${c.clio_id}`, role: null, owner: null, relationshipRef: null });
  }
  for (const rel of data.byKind.relationship ?? []) {
    const r = (rel.raw ?? {}) as Record<string, unknown>;
    const contact = (r.contact ?? {}) as Record<string, unknown>;
    const id = Number(contact.id);
    if (!isFinite(id)) continue;
    const desc = (r.description as string) ?? rel.body_text ?? rel.title ?? null;
    const prev = map.get(id);
    map.set(id, {
      id, name: (contact.name as string) ?? prev?.name ?? `Contact ${id}`,
      role: desc, owner: roleOwner(desc), relationshipRef: rel.id,
    });
  }
  const cid = data.matter.client_contact_id;
  if (cid != null) {
    const prev = map.get(Number(cid));
    map.set(Number(cid), { id: Number(cid), name: prev?.name ?? data.matter.client_name ?? "Client", role: "Client", owner: "client", relationshipRef: prev?.relationshipRef ?? null });
  }
  return map;
}

// ---------- tasks ----------
function taskOwner(name: string, desc: string, contacts: Map<number, ContactInfo>): { owner: Owner; owner_name: string | null; contact_id: number | null } {
  const m = name.match(/^by\s+([^:]+):\s*(.+?)(?:\s+-\s+|$)/i);
  const nameHit = (who: string) => {
    const w = who.toLowerCase();
    for (const c of contacts.values()) {
      const n = c.name.toLowerCase();
      if (n && (w.includes(n) || n.includes(w))) return c;
    }
    return null;
  };
  if (m) {
    const party = m[1].toLowerCase();
    const who = m[2].trim();
    const c = nameHit(who);
    const owner: Owner = /provider|medical|doctor|hospital/.test(party) ? "provider" : /client/.test(party) ? "client"
      : /defen|opposing/.test(party) ? "defense" : /carrier|insur|adjust/.test(party) ? "carrier" : /court/.test(party) ? "court" : c?.owner ?? "firm";
    return { owner, owner_name: c?.name ?? who, contact_id: c?.id ?? null };
  }
  const t = `${name} ${desc}`;
  if (/\bfrom (the )?client\b|client to (send|provide|sign|return)|\bby client\b/i.test(t)) return { owner: "client", owner_name: null, contact_id: null };
  if (/\bfrom (the )?(defen[cs]e|defendants?|opposing counsel)\b/i.test(t)) return { owner: "defense", owner_name: null, contact_id: null };
  if (/\bfrom (the )?(carrier|insurer|adjuster)\b/i.test(t)) return { owner: "carrier", owner_name: null, contact_id: null };
  return { owner: "firm", owner_name: null, contact_id: null };
}

const taskDone = (r: Record<string, unknown>) => /complete|done|closed/i.test(String(r.status ?? "")) || r.completed_at != null && r.completed_at !== "";

export interface CommStat {
  contact_id: number;
  name: string;
  owner: Owner | null;
  last_inbound: string | null;
  last_inbound_ref: string | null;
  unanswered: { date: string; ref: string }[];  // outbound since last inbound/call, oldest first
  total: number;
}

/** Per-contact silence. A call counts as a two-way touch (Clio phone direction is unreliable). */
export function commStats(data: MatterData, contacts: Map<number, ContactInfo>): Map<number, CommStat> {
  const comms = [...(data.byKind.email ?? []), ...(data.byKind.call ?? [])]
    .filter((c) => c.occurred_at)
    .sort((a, b) => (a.occurred_at! < b.occurred_at! ? -1 : 1));
  const stats = new Map<number, CommStat>();
  const get = (id: number) => {
    let s = stats.get(id);
    if (!s) {
      const c = contacts.get(id);
      s = { contact_id: id, name: c?.name ?? `Contact ${id}`, owner: c?.owner ?? null, last_inbound: null, last_inbound_ref: null, unanswered: [], total: 0 };
      stats.set(id, s);
    }
    return s;
  };
  for (const c of comms) {
    const { senders, receivers } = commParties(c);
    const day = isoDay(c.occurred_at)!;
    const isCall = c.kind === "call";
    for (const p of senders) {
      if (isUser(p) || p.id == null) continue;
      const s = get(p.id); s.total++; s.last_inbound = day; s.last_inbound_ref = c.id; s.unanswered = [];
    }
    const outbound = senders.some(isUser) || senders.length === 0;
    for (const p of receivers) {
      if (isUser(p) || p.id == null) continue;
      const s = get(p.id); s.total++;
      if (isCall) { s.last_inbound = day; s.last_inbound_ref = c.id; s.unanswered = []; }
      else if (outbound) s.unanswered.push({ date: day, ref: c.id });
    }
  }
  return stats;
}

export interface ActionSignals {
  actions: ActionItem[];
  sol: { date: Cited<string>; days_remaining: number; satisfied: boolean | null } | null;
}

export function actionSignals(data: MatterData, today: string, contacts: Map<number, ContactInfo>, stats: Map<number, CommStat>, label: Labeler, horizonDays = 21): ActionSignals {
  const actions: ActionItem[] = [];
  const horizon = addDays(today, horizonDays);
  let sol: ActionSignals["sol"] = null;

  for (const t of data.byKind.task ?? []) {
    const r = (t.raw ?? {}) as Record<string, unknown>;
    const name = t.title ?? (r.name as string) ?? "Task";
    const due = isoDay((r.due_at as string) ?? t.occurred_at);
    const done = taskDone(r);
    if (r.statute_of_limitations === true && due) {
      sol = { date: { value: due, cites: [cite(label, t.id)] }, days_remaining: daysBetween(today, due), satisfied: done };
    }
    if (done || !due) continue;
    const o = taskOwner(name, String(r.description ?? t.body_text ?? ""), contacts);
    const base = { id: t.id, label: name, due_date: due, owner: o.owner, owner_name: o.owner_name, cite: cite(label, t.id) };
    if (due < today) actions.push({ ...base, bucket: "overdue", days: daysBetween(due, today) });
    else if (due <= horizon) actions.push({ ...base, bucket: "upcoming", days: daysBetween(today, due) });
    else if (o.owner !== "firm") actions.push({ ...base, bucket: "waiting", days: daysBetween(today, due) });
  }

  for (const c of data.byKind.calendar ?? []) {
    const r = (c.raw ?? {}) as Record<string, unknown>;
    const day = isoDay((r.start_at as string) ?? c.occurred_at);
    if (!day || day < today || day > horizon) continue;
    const text = `${c.title ?? ""} ${r.description ?? ""}`;
    const who = [...contacts.values()].find((k) => k.owner && k.owner !== "client" && nameTokens(k).some((tok) => text.toLowerCase().includes(tok)));
    actions.push({
      id: c.id, label: c.title ?? (r.summary as string) ?? "Calendar entry", bucket: "upcoming", due_date: day,
      days: daysBetween(today, day), owner: /client/i.test(text) ? "client" : who?.owner ?? "firm", owner_name: who?.name ?? null, cite: cite(label, c.id),
    });
  }

  // comms-derived waiting-on: outbound asks with no reply since
  for (const s of stats.values()) {
    if (!s.unanswered.length) continue;
    const first = s.unanswered[0];
    const last = s.unanswered[s.unanswered.length - 1];
    const n = s.unanswered.length;
    actions.push({
      id: `waiting:${s.contact_id}`,
      label: `${s.name}: ${n} unanswered request${n > 1 ? "s" : ""} since ${first.date}${s.last_inbound ? `, last heard ${s.last_inbound}` : ", never replied"}`,
      bucket: "waiting", due_date: null, days: daysBetween(first.date, today),
      owner: s.owner ?? (s.contact_id === Number(data.matter.client_contact_id) ? "client" : null), owner_name: s.name,
      cite: cite(label, last.ref),
    });
  }

  const order = { overdue: 0, upcoming: 1, waiting: 2 } as const;
  actions.sort((a, b) => order[a.bucket] - order[b.bucket]
    || (a.bucket === "overdue" ? (b.days ?? 0) - (a.days ?? 0) : a.bucket === "waiting" ? (b.days ?? 0) - (a.days ?? 0) : (a.days ?? 0) - (b.days ?? 0)));
  return { actions, sol };
}

export function lastClientContact(data: MatterData, label: Labeler, today: string): { contact: Cited<string> | null; channel: string | null; days: number | null; last_written_from_client: Cited<string> | null } {
  const cid = data.matter.client_contact_id != null ? Number(data.matter.client_contact_id) : null;
  if (cid == null) return { contact: null, channel: null, days: null, last_written_from_client: null };
  let best: ItemRow | null = null;
  let written: ItemRow | null = null;
  for (const c of [...(data.byKind.email ?? []), ...(data.byKind.call ?? [])]) {
    if (!c.occurred_at) continue;
    const { senders, receivers } = commParties(c);
    const fromClient = senders.some((p) => p.id === cid);
    if (!fromClient && !receivers.some((p) => p.id === cid)) continue;
    if (!best || c.occurred_at > best.occurred_at!) best = c;
    if (fromClient && c.kind === "email" && (!written || c.occurred_at > written.occurred_at!)) written = c;
  }
  return {
    contact: best ? { value: isoDay(best.occurred_at)!, cites: [cite(label, best.id)] } : null,
    channel: best?.kind ?? null,
    days: best ? daysBetween(isoDay(best.occurred_at)!, today) : null,
    last_written_from_client: written ? { value: isoDay(written.occurred_at)!, cites: [cite(label, written.id)] } : null,
  };
}

// ---------- providers ----------
const GENERIC = new Set(["services", "service", "offices", "office", "surgical", "physical", "therapy", "orthopaedic", "orthopedic", "medical",
  "center", "centre", "hospital", "group", "associates", "clinic", "health", "pllc", "llc", "inc", "the", "and", "of", "new", "york", "dr", "md",
  "p.c.", "pc", "d.c.", "dc", "chiropractic", "radiology", "imaging", "care", "practice", "partners", "treating", "provider"]);

export function nameTokens(c: ContactInfo): string[] {
  const src = `${c.name} ${(c.role ?? "").match(/\(([^)]+)\)/)?.[1] ?? ""}`;
  return [...new Set(src.split(/[^A-Za-z'-]+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !GENERIC.has(w)))];
}

export function providerLanes(data: MatterData, contacts: Map<number, ContactInfo>, stats: Map<number, CommStat>, actions: ActionItem[], label: Labeler, today: string): ProviderLane[] {
  const lanes: ProviderLane[] = [];
  for (const c of contacts.values()) {
    if (c.owner !== "provider") continue;
    const toks = nameTokens(c);
    const visits = new Map<string, Citation>();
    // calendar entries that name the provider, on or before today, are visits
    for (const e of data.byKind.calendar ?? []) {
      const r = (e.raw ?? {}) as Record<string, unknown>;
      const day = isoDay((r.start_at as string) ?? e.occurred_at);
      const text = `${e.title ?? ""} ${r.description ?? ""}`.toLowerCase();
      if (!day || day > today || !toks.some((t) => text.includes(t))) continue;
      if (/\bcall\b|chaser|request|follow[- ]up call/i.test(text) && !/visit|session|appointment|consult|surgery|arthroscopy|exam/i.test(text)) continue;
      if (!visits.has(day)) visits.set(day, cite(label, e.id));
    }
    // verified treatment facts tied to the provider
    for (const f of data.facts) {
      if (!f.event_date || f.event_date > today) continue;
      const tied = f.provider_contact_id === c.id || (f.kind === "treatment" && toks.some((t) => `${f.summary}`.toLowerCase().includes(t)));
      if (tied && (f.kind === "treatment" || f.kind === "provider" || f.kind === "injury")) {
        if (!visits.has(f.event_date)) visits.set(f.event_date, cite(label, f.source_ref, f.quote));
      }
    }
    const dates = [...visits.keys()].sort();
    const gaps: ProviderLane["gaps"] = [];
    for (let i = 1; i < dates.length; i++) {
      const d = daysBetween(dates[i - 1], dates[i]);
      if (d > 30) gaps.push({ from: dates[i - 1], to: dates[i], days: d });
    }
    const s = stats.get(c.id);
    const openTasks = actions.filter((a) => a.owner === "provider" && a.owner_name && (a.owner_name === c.name || toks.some((t) => a.owner_name!.toLowerCase().includes(t))) && a.id.startsWith("task:")).length;
    lanes.push({
      contact_id: c.id, name: c.name, role: c.role,
      first_visit: dates[0] ?? null, last_visit: dates[dates.length - 1] ?? null,
      visits: dates.map((d) => ({ date: d, cite: visits.get(d)! })), gaps,
      last_heard_from: s?.last_inbound ?? null,
      open_asks: (s?.unanswered.length ?? 0) + openTasks,
    });
  }
  return lanes.sort((a, b) => (b.last_visit ?? "").localeCompare(a.last_visit ?? ""));
}
