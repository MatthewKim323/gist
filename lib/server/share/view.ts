import "server-only";
import { db } from "@/lib/server/db";
import type { GateStatus, ProviderView, ShareConfig, ShareSection } from "@/lib/types";
import { plainStage } from "./plain";
import { initialsOf, mentionsAny, nameTokens, redactText, type RedactContext } from "./redact";

// Server-side provider view. Everything is filtered here: hidden sections, other providers, value,
// strategy and internal-only facts never leave this module. The client only ever sees the result.

/** Fact kinds that never go to a provider, whatever the overrides say. */
const NEVER_KINDS = new Set([
  "strategy", "prior_injury", "money", "liability", "coverage", "expense", "witness", "client_contact",
]);

const PROVIDER_RE =
  /provider|treat|doctor|physician|therap|chiro|ortho|hospital|medical|clinic|\bpt\b|surg|radiolog|\bmri\b|imaging|neuro|pain|rehab|urgent care|emergency/i;
const NOT_PROVIDER_RE = /adverse|claims admin|lien|insur|carrier|adjuster|defen[cs]e|opposing|counsel|attorney|court|judge|witness|employer|medicaid|medicare/i;

export interface ProviderOption {
  contact_id: number;
  name: string;
  role: string | null;
}

/** One outgoing text the redaction gate must clear before it is shown. */
export interface Snippet {
  key: string;
  section: ShareSection;
  text: string;
}

export interface FactCandidate {
  id: string;
  summary: string;
  kind: string;
  date: string | null;
  audience: string;
  included: boolean;
  overridden: boolean;
}

export interface ProviderDraft {
  view: ProviderView;
  snippets: Snippet[];
  candidates: FactCandidate[];
  provider: ProviderOption;
  otherProviders: ProviderOption[];
}

type Row = Record<string, unknown>;
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DAY = 86_400_000;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function isoDay(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Providers on the matter, from Clio relationships classified by their description. */
export async function listProviders(matterId: number): Promise<ProviderOption[]> {
  const { data } = await db()
    .from("source_items")
    .select("id,title,body_text,raw")
    .eq("matter_id", matterId)
    .eq("kind", "relationship")
    .is("deleted_at", null);
  const all: ProviderOption[] = [];
  for (const r of (data ?? []) as Row[]) {
    const raw = (r.raw ?? {}) as Raw;
    const id = num(raw.contact?.id) ?? num(raw.contact_id);
    if (!id) continue;
    const name = str(raw.contact?.name) ?? str(raw.contact?.display_name) ?? str(r.title) ?? `Contact ${id}`;
    const role = str(raw.description) ?? str(r.body_text);
    all.push({ contact_id: id, name, role });
  }
  const providers = all.filter((p) => {
    const text = `${p.role ?? ""}`;
    return PROVIDER_RE.test(text) && !NOT_PROVIDER_RE.test(text);
  });
  const list = providers.length ? providers : all.filter((p) => !NOT_PROVIDER_RE.test(p.role ?? ""));
  const seen = new Set<number>();
  return list.filter((p) => (seen.has(p.contact_id) ? false : (seen.add(p.contact_id), true)));
}

async function providerName(matterId: number, contactId: number, providers: ProviderOption[]): Promise<ProviderOption> {
  const hit = providers.find((p) => p.contact_id === contactId);
  if (hit) return hit;
  const { data } = await db()
    .from("source_items")
    .select("title,raw")
    .eq("matter_id", matterId)
    .eq("id", `contact:${contactId}`)
    .maybeSingle();
  const raw = ((data as Row | null)?.raw ?? {}) as Raw;
  return {
    contact_id: contactId,
    name: str(raw.name) ?? str((data as Row | null)?.title) ?? "Your office",
    role: null,
  };
}

interface Sourced {
  id: string;
  kind: string;
  title: string | null;
  body: string | null;
  occurred_at: string | null;
  first_seen_at: string | null;
  raw: Raw;
}

function textOf(s: Sourced): string {
  const r = s.raw;
  return [s.title, s.body, str(r.name), str(r.summary), str(r.description), str(r.location)].filter(Boolean).join(" \n ");
}

function relatesTo(s: Sourced, contactId: number, mine: string[]): boolean {
  const r = s.raw;
  const ids: unknown[] = [
    r.contact?.id, r.assignee?.id,
    ...(Array.isArray(r.attendees) ? r.attendees.map((a: Raw) => a?.id) : []),
    ...(Array.isArray(r.contacts) ? r.contacts.map((a: Raw) => a?.id) : []),
  ];
  if (ids.some((v) => num(v) === contactId)) return true;
  return mentionsAny(textOf(s), mine);
}

function otherTokens(mine: string[], others: ProviderOption[]): string[] {
  const set = new Set(mine);
  return Array.from(new Set(others.flatMap((o) => nameTokens(o.name)).filter((t) => !set.has(t))));
}

function ciToken(t: string): string {
  return t
    .split("")
    .map((c) => (/[a-z]/i.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
}

/** Rewrites mentions of the receiving office ("Dr. X's office", "X Orthopaedic, P.C.") as "your office". */
export function selfToYourOffice(text: string, mine: string[]): string {
  let out = text;
  for (const t of mine) {
    const re = new RegExp(
      `(?:[Dd]r\\.?\\s+)?(?:[A-Z][\\w.&-]*\\s+){0,3}\\b${ciToken(t)}\\b(?:[\\s,]+(?:[A-Z][\\w.&-]*|of))*(?:'s)?(?:\\s+office)?`,
      "g",
    );
    out = out.replace(re, "your office");
  }
  return out.replace(/(?:your office[\s,]*){2,}/g, "your office ").replace(/\s{2,}/g, " ").trim();
}

function cleanTaskLabel(label: string, mine: string[]): string {
  let out = label.replace(/^\s*by\s+(?:the\s+)?(?:medical\s+)?provider\s*[:\-]?\s*/i, "");
  // "Your office: updated records" reads worse than "Updated records".
  out = selfToYourOffice(out, mine).replace(/^your office\s*[:\-,]?\s*/i, "");
  out = out.replace(/^[\s:,.\-]+|[\s:,.\-]+$/g, "").replace(/\s{2,}/g, " ");
  if (!out) return "Requested item";
  return out[0]!.toUpperCase() + out.slice(1);
}

function visitLabel(text: string): string {
  if (/surgery|arthroscop|procedure|operative/i.test(text)) return "Procedure";
  if (/\beval|consult|exam|assessment|follow[\s-]?up/i.test(text)) return "Follow-up visit";
  if (/\bmri\b|imaging|x-?ray|\bct\b|emg|ncv/i.test(text)) return "Testing appointment";
  return "Treatment visit";
}
const VISIT_RE = /treat|appoint|visit|session|therap|follow[\s-]?up|exam|consult|surgery|arthroscop|procedure|\bmri\b|imaging|eval|adjust|chiro/i;
const NOT_VISIT_RE = /^\s*call\b|\bcall (?:to|with)\b|\bphone\b|deposition|\bebt\b|conference|court|hearing|motion|mediation|meeting with (?:client|counsel)|\bime\b/i;

export async function buildProviderDraft(
  matterId: number,
  providerContactId: number,
  config: ShareConfig,
  now = Date.now(),
): Promise<ProviderDraft> {
  const sb = db();
  const [matterRes, providers, gatesRes, srcRes, factsRes, digestRes, docsRes] = await Promise.all([
    sb.from("matters").select("id,display_number,status,stage,stage_updated_at,client_name,raw").eq("id", matterId).maybeSingle(),
    listProviders(matterId),
    sb.from("gate_items").select("*").eq("matter_id", matterId),
    sb
      .from("source_items")
      .select("id,kind,title,body_text,occurred_at,first_seen_at,raw")
      .eq("matter_id", matterId)
      .in("kind", ["task", "calendar"])
      .is("deleted_at", null),
    sb
      .from("facts")
      .select("id,kind,summary,event_date,audience,provider_contact_id,status,importance,source_ref")
      .eq("matter_id", matterId)
      .eq("status", "verified")
      .is("superseded_at", null),
    sb.from("digests").select("json").eq("matter_id", matterId).order("version", { ascending: false }).limit(1),
    sb.from("documents").select("name,filename,received_at").eq("matter_id", matterId),
  ]);
  const matter = (matterRes.data ?? null) as Raw | null;
  if (!matter) throw new Error("matter not found");

  const provider = await providerName(matterId, providerContactId, providers);
  const others = providers.filter((p) => p.contact_id !== providerContactId);
  // Aliases in the relationship description, e.g. "(also <other practice name>)" or "(<doctor name>)".
  const aliases = Array.from((provider.role ?? "").matchAll(/\(([^)]+)\)/g)).map((m) => m[1]!.replace(/^also\s+/i, ""));
  const mine = Array.from(new Set([provider.name, ...aliases].flatMap((n) => nameTokens(n))));
  const theirs = otherTokens(mine, others);
  const rctx: RedactContext = {
    clientName: str(matter.client_name),
    clientInitials: initialsOf(str(matter.client_name)),
    terms: config.redact_terms,
  };
  const clean = (t: string) => redactText(t, rctx);
  const aboutOther = (t: string | null | undefined) => mentionsAny(t, theirs);

  const src: Sourced[] = ((srcRes.data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    title: str(r.title),
    body: str(r.body_text),
    occurred_at: str(r.occurred_at),
    first_seen_at: str(r.first_seen_at),
    raw: (r.raw ?? {}) as Raw,
  }));
  const gates = (gatesRes.data ?? []) as Raw[];
  const facts = (factsRes.data ?? []) as Raw[];
  const digest = ((digestRes.data ?? [])[0] as Raw | undefined)?.json as Raw | undefined;
  const snippets: Snippet[] = [];
  const redacted: ShareSection[] = [];
  const on = (s: ShareSection) => {
    if (!config.sections[s]) redacted.push(s);
    return config.sections[s];
  };

  // ---- status heartbeat ----
  let case_alive: ProviderView["case_alive"] = null;
  let stage: string | null = null;
  if (on("status")) {
    const { data: last } = await sb
      .from("source_items")
      .select("occurred_at")
      .eq("matter_id", matterId)
      .in("kind", ["note", "email", "call", "task", "calendar", "document", "expense"])
      .is("deleted_at", null)
      .lte("occurred_at", new Date(now).toISOString())
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const lastActivity = str((last?.[0] as Row | undefined)?.occurred_at) ?? str(matter.stage_updated_at);
    const closed = /closed/i.test(String(matter.status ?? "")) || /closed/i.test(String(matter.stage ?? ""));
    const quietDays = lastActivity ? (now - new Date(lastActivity).getTime()) / DAY : Infinity;
    case_alive = { alive: !closed && quietDays <= 120, last_activity: lastActivity };
    stage = plainStage(str(matter.stage))?.phase ?? null;
  }

  // ---- coverage tier ----
  let coverage: ProviderView["coverage"] = null;
  if (config.coverage_detail === "hidden" || !on("coverage_tier")) {
    if (config.sections.coverage_tier && !redacted.includes("coverage_tier")) redacted.push("coverage_tier");
  } else {
    const money = (digest?.money ?? {}) as Raw;
    const state = str(money.coverage_state);
    const coverageFacts = facts.filter((f) => f.kind === "coverage");
    let tier: string;
    if (state === "known" || (!state && coverageFacts.length)) tier = "Liability coverage confirmed";
    else if (state === "conflicting") tier = "Coverage is being confirmed";
    else tier = "Coverage not yet confirmed";
    let detail: string | null = null;
    if (config.coverage_detail === "exact") {
      const limit = num(money.coverage_limit?.value);
      if (limit) {
        detail = `Policy limit on file: ${limit.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
        snippets.push({ key: "coverage:detail", section: "coverage_tier", text: detail });
      }
    }
    coverage = { tier, detail };
  }

  // ---- firm needs (gate items owed by this office + provider-directed open tasks) ----
  const mineGates = gates.filter(
    (g) =>
      g.owed_by === "provider" &&
      (num(g.owed_by_contact_id) === providerContactId || (!g.owed_by_contact_id && mentionsAny(String(g.label ?? ""), mine))),
  );
  let firm_needs: ProviderView["firm_needs"] = null;
  if (on("firm_needs")) {
    const list: NonNullable<ProviderView["firm_needs"]> = [];
    const seen = new Set<string>();
    for (const g of mineGates) {
      if (g.status !== "missing" && g.status !== "partial") continue;
      const label = clean(selfToYourOffice(String(g.label ?? "Requested item"), mine));
      if (aboutOther(label) || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      const due = isoDay(g.due_date);
      const overdue = due ? Math.floor((now - new Date(`${due}T12:00:00Z`).getTime()) / DAY) : null;
      list.push({
        label: g.status === "partial" ? `${label} (partially received)` : label,
        due_date: due,
        days_outstanding: overdue !== null && overdue > 0 ? overdue : null,
      });
    }
    for (const t of src.filter((s) => s.kind === "task")) {
      const r = t.raw;
      const status = String(r.status ?? "").toLowerCase();
      if (status === "complete" || status === "completed" || r.completed_at) continue;
      const text = textOf(t);
      const directed =
        /\b(?:by|from)\s+(?:the\s+)?(?:medical\s+)?provider\b/i.test(text) ||
        /record|bill|report|narrative|ledger|letter|\bmmi\b|prognosis|form|lien|update|chart|imaging/i.test(text);
      if (!directed || !relatesTo(t, providerContactId, mine)) continue;
      const rawLabel = str(r.name) ?? t.title ?? "Requested item";
      const label = clean(cleanTaskLabel(rawLabel, mine));
      if (aboutOther(label) || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      const due = isoDay(r.due_at) ?? isoDay(t.occurred_at);
      const asked = str(r.created_at) ?? t.first_seen_at;
      const since = asked ? Math.floor((now - new Date(asked).getTime()) / DAY) : null;
      const overdue = due ? Math.floor((now - new Date(`${due}T12:00:00Z`).getTime()) / DAY) : null;
      const days = overdue !== null && overdue > 0 ? overdue : since !== null && since > 0 ? since : null;
      list.push({ label, due_date: due, days_outstanding: days });
    }
    list.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    firm_needs = list;
    list.forEach((n, i) => snippets.push({ key: `firm_needs:${i}`, section: "firm_needs", text: n.label }));
  }

  // ---- records + bills checklist for this office ----
  let records_bills: ProviderView["records_bills"] = null;
  if (on("records_bills")) {
    const list: NonNullable<ProviderView["records_bills"]> = [];
    for (const g of mineGates) {
      const label = clean(String(g.label ?? ""));
      if (!label || !/record|bill|report|narrative|ledger|statement|imaging|mri|x-?ray|note/i.test(`${label} ${g.requirement_key ?? ""}`)) continue;
      if (aboutOther(label)) continue;
      const status: GateStatus = g.status === "conflicting" ? "partial" : (g.status as GateStatus);
      list.push({ label, status });
    }
    if (!list.length) {
      // No gate rows yet: fall back to what the firm has on file under this provider's name.
      const docs = ((docsRes.data ?? []) as Raw[]).filter((d) => mentionsAny(`${d.name ?? ""} ${d.filename ?? ""}`, mine));
      const hasRecords = docs.some((d) => /record|report|note|chart|eval|mri|imaging|op\b|operative|discharge/i.test(`${d.name} ${d.filename}`));
      const hasBills = docs.some((d) => /bill|ledger|invoice|statement|hcfa|ub-?04|balance/i.test(`${d.name} ${d.filename}`));
      list.push({ label: "Medical records", status: hasRecords ? "have" : docs.length ? "partial" : "missing" });
      list.push({ label: "Itemized bills", status: hasBills ? "have" : "missing" });
    }
    records_bills = list;
    list.forEach((r, i) => snippets.push({ key: `records_bills:${i}`, section: "records_bills", text: r.label }));
  }

  // ---- attendance + next visits (calendar and treatment facts for this provider only) ----
  const cal = src.filter(
    (s) =>
      s.kind === "calendar" &&
      relatesTo(s, providerContactId, mine) &&
      !aboutOther(textOf(s)) &&
      VISIT_RE.test(textOf(s)) &&
      !NOT_VISIT_RE.test(s.title ?? str(s.raw.summary) ?? ""),
  );
  const calStart = (s: Sourced) => str(s.raw.start_at) ?? s.occurred_at;
  let attendance: ProviderView["attendance"] = null;
  if (on("attendance")) {
    const visitFacts = facts.filter((f) => f.kind === "treatment" && num(f.provider_contact_id) === providerContactId);
    const count = (windowDays: number) => {
      const from = now - windowDays * DAY;
      const scheduled = new Set<string>();
      const attended = new Set<string>();
      for (const c of cal) {
        const at = calStart(c);
        const t = at ? new Date(at).getTime() : NaN;
        if (!(t >= from && t <= now)) continue;
        const day = at!.slice(0, 10);
        scheduled.add(day);
        if (!/cancel|no[\s-]?show|missed|resched/i.test(textOf(c))) attended.add(day);
      }
      for (const f of visitFacts) {
        const d = isoDay(f.event_date);
        if (!d) continue;
        const t = new Date(`${d}T12:00:00Z`).getTime();
        if (t >= from && t <= now) {
          scheduled.add(d);
          attended.add(d);
        }
      }
      return { attended: attended.size, scheduled: scheduled.size, window_days: windowDays };
    };
    attendance = count(90);
    if (!attendance.scheduled) {
      const wide = count(365);
      if (wide.scheduled) attendance = wide;
    }
  }

  let next_visits: ProviderView["next_visits"] = null;
  if (on("next_visits")) {
    next_visits = cal
      .map((c) => ({ at: calStart(c), c }))
      .filter((x) => x.at && new Date(x.at).getTime() > now && !/cancel/i.test(textOf(x.c)))
      .sort((a, b) => a.at!.localeCompare(b.at!))
      .slice(0, 5)
      .map((x) => ({ date: x.at!, label: visitLabel(textOf(x.c)) }));
    next_visits.forEach((v, i) => snippets.push({ key: `next_visits:${i}`, section: "next_visits", text: v.label }));
  }

  // ---- updates: provider-safe facts, per-fact overrides ----
  const candidates: FactCandidate[] = facts
    .filter((f) => !NEVER_KINDS.has(String(f.kind)))
    .filter((f) => {
      const pid = num(f.provider_contact_id);
      return pid === null || pid === providerContactId;
    })
    .filter((f) => !aboutOther(String(f.summary ?? "")))
    .map((f) => {
      const id = String(f.id);
      const override = config.fact_overrides[id];
      const byDefault = f.audience === "provider_safe";
      return {
        id,
        summary: clean(String(f.summary ?? "")),
        kind: String(f.kind),
        date: isoDay(f.event_date),
        audience: String(f.audience ?? "internal_only"),
        included: override ?? byDefault,
        overridden: override !== undefined,
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  let updates: ProviderView["updates"] = null;
  if (on("updates")) {
    updates = candidates
      .filter((c) => c.included && c.summary)
      .slice(0, 12)
      .map((c) => ({ date: c.date ?? "", text: c.summary }));
    updates.forEach((u, i) => snippets.push({ key: `updates:${i}`, section: "updates", text: u.text }));
  }

  const view: ProviderView = {
    provider_name: provider.name,
    firm_name: process.env.GIST_FIRM_NAME ?? str((matter.raw as Raw | null)?.account?.name) ?? null,
    client_initials: rctx.clientInitials,
    stage,
    case_alive,
    coverage,
    firm_needs,
    records_bills,
    attendance,
    next_visits,
    updates,
    redacted_sections: redacted,
  };
  return { view, snippets, candidates, provider, otherProviders: others };
}

/** Drops snippets the gate blocked. Indices are resolved against the draft's arrays. */
export function applyBlocks(view: ProviderView, blocked: Set<string>): ProviderView {
  const keep = <T,>(arr: T[] | null, section: string) => (arr ? arr.filter((_, i) => !blocked.has(`${section}:${i}`)) : arr);
  return {
    ...view,
    coverage: view.coverage && blocked.has("coverage:detail") ? { ...view.coverage, detail: null } : view.coverage,
    firm_needs: keep(view.firm_needs, "firm_needs"),
    records_bills: keep(view.records_bills, "records_bills"),
    next_visits: keep(view.next_visits, "next_visits"),
    updates: keep(view.updates, "updates"),
  };
}
