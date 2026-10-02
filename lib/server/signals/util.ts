import type { Citation, SourceRef } from "@/lib/types";
import type { DocRow, ItemRow } from "./load";

// ---------- dates (all day math in UTC calendar days) ----------
export function isoDay(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") {
    const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const t = new Date(d as string);
  return isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD in the firm's local zone (Clio dates are firm-local calendar days). */
export function todayIso(now: Date, tz = process.env.FIRM_TZ ?? "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function prettyDay(d: string | null | undefined): string | null {
  const day = isoDay(d);
  if (!day) return null;
  const [y, m, dd] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${dd}, ${y}`;
}

// ---------- money ----------
const MONEY_RE = /\$\s?([\d]{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|m|million|thousand)?\b/gi;

export function parseMoneyAll(text: string | null | undefined): number[] {
  if (!text) return [];
  const out: number[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    let v = Number(m[1].replace(/,/g, "")) + (m[2] ? Number(`0.${m[2]}`) : 0);
    const suf = (m[3] ?? "").toLowerCase();
    if (suf === "k" || suf === "thousand") v *= 1e3;
    if (suf === "m" || suf === "million") v *= 1e6;
    if (isFinite(v)) out.push(v);
  }
  return out;
}

/** Currency custom fields arrive as numbers or numeric strings; text fields carry "$x". */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const all = parseMoneyAll(s);
  return all.length ? all[0] : null;
}

// ---------- comms ----------
export interface Party { id: number | null; type: string; name: string | null }

function parties(v: unknown): Party[] {
  if (!Array.isArray(v)) return [];
  return v.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return {
      id: typeof o.id === "number" ? o.id : o.id != null ? Number(o.id) : null,
      type: String(o.type ?? ""),
      name: (o.name as string) ?? null,
    };
  });
}

export function commParties(it: ItemRow): { senders: Party[]; receivers: Party[]; type: string } {
  const r = (it.raw ?? {}) as Record<string, unknown>;
  return { senders: parties(r.senders), receivers: parties(r.receivers), type: String(r.type ?? it.kind) };
}

export const isUser = (p: Party) => /user/i.test(p.type);

// ---------- custom fields ----------
export function fieldValue(it: ItemRow): unknown {
  const r = (it.raw ?? {}) as Record<string, unknown>;
  if (r.value !== undefined) return r.value;
  return it.body_text;
}

export function findField(fields: ItemRow[], re: RegExp): ItemRow | null {
  return fields.find((f) => f.title && re.test(f.title)) ?? null;
}

// ---------- citation labels ----------
const KIND_LABEL: Record<string, string> = {
  note: "Note", email: "Email", call: "Call", task: "Task", calendar: "Calendar", expense: "Expense",
  contact: "Contact", relationship: "Relationship", field: "Clio field", document: "Doc",
};

export type Labeler = (ref: SourceRef) => string;

/** Human labels for refs: 'Email · May 7, 2023 · subject', 'Doc name p.12', 'Clio field · Policy Limits'. */
export function makeLabeler(items: ItemRow[], docs: DocRow[]): Labeler {
  const byId = new Map(items.map((i) => [i.id, i]));
  const docById = new Map(docs.map((d) => [String(d.clio_id), d]));
  return (ref) => {
    const m = ref.match(/^([a-z_]+):([^#]+)(?:#p(\d+))?$/);
    if (!m) return ref;
    const [, kind, id, page] = m;
    if (kind === "doc" || kind === "document" || page) {
      const doc = docById.get(id);
      const it = byId.get(`document:${id}`) ?? byId.get(ref.split("#")[0]);
      const name = doc?.name ?? doc?.filename ?? it?.title ?? `Document ${id}`;
      return page ? `${name} p.${page}` : name;
    }
    const it = byId.get(ref);
    if (!it) return `${KIND_LABEL[kind] ?? kind} ${id}`;
    if (it.kind === "field") return `Clio field · ${it.title ?? id}`;
    const parts = [KIND_LABEL[it.kind] ?? it.kind];
    const day = ["relationship", "contact"].includes(it.kind) ? null : prettyDay(it.occurred_at);
    if (day) parts.push(day);
    if (it.title) parts.push(it.title.length > 80 ? `${it.title.slice(0, 77)}...` : it.title);
    return parts.join(" · ");
  };
}

export function cite(label: Labeler, ref: SourceRef, quote?: string | null): Citation {
  return quote ? { source_ref: ref, label: label(ref), quote } : { source_ref: ref, label: label(ref) };
}
