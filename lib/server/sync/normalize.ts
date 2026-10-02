import "server-only";
import { createHash } from "node:crypto";
import type { SourceKind } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Raw = Record<string, any>;

/** What a normalizer produces; sync turns it into a source_items row. */
export interface NormItem {
  kind: SourceKind;
  clio_id: number;
  title: string | null;
  body_text: string;
  occurred_at: string | null;
  updated_at_clio: string | null;
  raw: Raw;
}

export const sourceId = (kind: SourceKind, clioId: number | string) => `${kind}:${clioId}`;

export function contentHash(title: string | null, body: string): string {
  return createHash("sha256").update(`${title ?? ""}\n${body}`).digest("hex");
}

/** "Key: value" lines, dropping empties. Keeps body_text readable for the extraction swarm. */
function lines(pairs: [string, unknown][], tail?: string | null): string {
  const out = pairs
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  if (tail && tail.trim()) out.push("", tail.trim());
  return out.join("\n");
}

const names = (xs: any[] | null | undefined) => (xs ?? []).map((p) => p?.name ?? p?.identifier).filter(Boolean).join(", ");
const money = (n: unknown) => (n === null || n === undefined || n === "" ? null : `$${Number(n).toFixed(2)}`);

export function normNote(n: Raw): NormItem {
  return {
    kind: "note", clio_id: Number(n.id), title: n.subject ?? null,
    body_text: lines([["Note", n.subject], ["Date", n.date], ["Author", n.author?.name], ["About contact", n.contact?.name]], n.detail),
    occurred_at: n.date ?? n.created_at ?? null, updated_at_clio: n.updated_at ?? null, raw: n,
  };
}

export function normCommunication(c: Raw): NormItem {
  const kind: SourceKind = c.type === "PhoneCommunication" ? "call" : "email";
  return {
    kind, clio_id: Number(c.id), title: c.subject ?? null,
    body_text: lines([
      [kind === "call" ? "Phone call" : "Email", c.subject], ["Date", c.date ?? c.received_at],
      ["From", names(c.senders)], ["To", names(c.receivers)],
    ], c.body),
    occurred_at: c.received_at ?? c.date ?? c.created_at ?? null, updated_at_clio: c.updated_at ?? null, raw: c,
  };
}

export function normTask(t: Raw): NormItem {
  return {
    kind: "task", clio_id: Number(t.id), title: t.name ?? null,
    body_text: lines([
      ["Task", t.name], ["Status", t.status], ["Priority", t.priority], ["Due", t.due_at],
      ["Completed", t.completed_at], ["Statute of limitations task", t.statute_of_limitations ? "yes" : null],
      ["Assignee", t.assignee?.name], ["Assigned by", t.assigner?.name], ["Type", t.task_type?.name],
    ], t.description),
    occurred_at: t.due_at ?? t.created_at ?? null, updated_at_clio: t.updated_at ?? null, raw: t,
  };
}

export function normCalendar(e: Raw): NormItem {
  return {
    kind: "calendar", clio_id: parseInt(String(e.id), 10), title: e.summary ?? null,
    body_text: lines([
      ["Event", e.summary], ["Start", e.all_day ? (e.start_date ?? e.start_at) : e.start_at], ["End", e.all_day ? null : e.end_at],
      ["All day", e.all_day ? "yes" : null], ["Location", e.location], ["Attendees", names(e.attendees)],
      ["Event type", e.calendar_entry_event_type?.name],
    ], e.description),
    occurred_at: e.start_at ?? e.start_date ?? null, updated_at_clio: e.updated_at ?? null, raw: e,
  };
}

export function normExpense(a: Raw): NormItem {
  const firstLine = String(a.note ?? "").split("\n")[0].slice(0, 120);
  return {
    kind: "expense", clio_id: Number(a.id), title: firstLine || `Expense ${a.date ?? ""}`.trim(),
    body_text: lines([
      ["Expense", firstLine], ["Date", a.date], ["Amount", money(a.total)], ["Quantity", a.quantity], ["Unit price", money(a.price)],
      ["Category", a.expense_category?.name], ["Vendor", a.vendor?.name], ["Entered by", a.user?.name], ["Billed", a.billed ? "yes" : "no"],
    ], a.note),
    occurred_at: a.date ?? null, updated_at_clio: a.updated_at ?? null, raw: a,
  };
}

function contactLines(c: Raw | undefined): [string, unknown][] {
  if (!c) return [];
  const emails = (c.email_addresses ?? []).map((e: Raw) => (e.name ? `${e.address} (${e.name})` : e.address)).join(", ");
  const phones = (c.phone_numbers ?? []).map((p: Raw) => (p.name ? `${p.number} (${p.name})` : p.number)).join(", ");
  const addrs = (c.addresses ?? [])
    .map((a: Raw) => [a.street, a.city, a.province, a.postal_code].filter(Boolean).join(", "))
    .filter(Boolean).join(" | ");
  return [
    ["Type", c.type], ["Title", c.title], ["Company", c.company?.name], ["Date of birth", c.date_of_birth],
    ["Email", emails || c.primary_email_address], ["Phone", phones || c.primary_phone_number], ["Address", addrs],
  ];
}

export function normRelationship(r: Raw, contact: Raw | undefined): NormItem {
  const name = contact?.name ?? r.contact?.name ?? "Unknown contact";
  return {
    kind: "relationship", clio_id: Number(r.id), title: r.description ? `${name}: ${r.description}` : name,
    body_text: lines([["Contact", name], ["Role on matter", r.description], ...contactLines(contact)]),
    occurred_at: r.created_at ?? null, updated_at_clio: r.updated_at ?? null, raw: { ...r, contact_detail: contact ?? null },
  };
}

export function normContact(c: Raw, roles: string[]): NormItem {
  return {
    kind: "contact", clio_id: Number(c.id), title: c.name ?? null,
    body_text: lines([["Contact", c.name], ["Role on matter", roles.join("; ")], ...contactLines(c)]),
    occurred_at: null, updated_at_clio: c.updated_at ?? null, raw: { ...c, roles },
  };
}

export function normField(v: Raw): NormItem | null {
  const fieldId = v.custom_field?.id;
  if (!fieldId) return null;
  let value = v.value;
  if (v.field_type === "currency" && value !== null && value !== "") value = money(value);
  if (v.field_type === "picklist") value = v.picklist_option?.option ?? value;
  const body = value === null || value === undefined ? "" : String(value);
  return {
    kind: "field", clio_id: Number(fieldId), title: v.field_name ?? null, body_text: body,
    occurred_at: v.field_type === "date" && body ? body : null, updated_at_clio: v.updated_at ?? null, raw: v,
  };
}

export function normDocument(d: Raw): NormItem {
  const v = d.latest_document_version ?? {};
  return {
    kind: "document", clio_id: Number(d.id), title: d.name ?? d.filename ?? null,
    body_text: lines([
      ["Document", d.name], ["File", d.filename ?? v.filename], ["Folder", d.parent?.name], ["Category", d.document_category?.name],
      ["Received", d.received_at ?? v.received_at], ["Content type", d.content_type ?? v.content_type],
      ["Size bytes", d.size ?? v.size], ["Version", v.version_number],
    ]),
    occurred_at: d.received_at ?? d.created_at ?? null, updated_at_clio: d.updated_at ?? null, raw: d,
  };
}
