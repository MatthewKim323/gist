import "server-only";
import { db } from "../db";
import { makeLabeler } from "../signals";
import { commParties } from "../signals/util";
import type { DocRow, ItemRow } from "../signals/load";

// Read one source for the MCP server. Same lookup as the dashboard's source drawer
// (app/api/matter/[id]/source/[ref]), returned as plain data. Read-only.

export interface SourceOut {
  ref: string;
  kind: string;
  label: string;
  title: string | null;
  date: string | null;
  body: string | null;
  page?: number;
  page_count?: number | null;
  from?: string[] | null;
  to?: string[] | null;
  clio_url?: string | null;
  /** set when a fact ref was opened: the fact, alongside its underlying source */
  fact?: { id: string; summary: string; quote: string; date: string | null };
}

/** Normalizes 'doc:45:p17' / 'doc:45~17' / 'document:45#p17' to 'doc:45#p17'. */
export function normalizeRef(raw: string): string {
  return raw.trim().replace(/^(doc|document):(\d+)(?::p|~)(\d+)$/, "$1:$2#p$3").replace(/^document:/, "doc:");
}

export async function readSource(matterId: number, rawRef: string, maxChars = 12000): Promise<SourceOut | null> {
  const ref = normalizeRef(rawRef);
  const clip = (s: string | null) => (s && s.length > maxChars ? `${s.slice(0, maxChars)}\n[truncated, ${s.length} chars total]` : s);

  const doc = ref.match(/^doc:(\d+)(?:#p(\d+))?$/);
  if (doc) {
    const docId = Number(doc[1]);
    const page = doc[2] ? Number(doc[2]) : 1;
    const d = await db().from("documents").select("clio_id,name,filename,folder,received_at,page_count,version_id,ocr_status")
      .eq("clio_id", docId).eq("matter_id", matterId).maybeSingle();
    if (!d.data) return null;
    const p = await db().from("doc_pages").select("text")
      .eq("doc_id", docId).eq("version_id", d.data.version_id ?? 0).eq("page", page).maybeSingle();
    const label = makeLabeler([], [d.data as DocRow])(`doc:${docId}#p${page}`);
    return {
      ref: `doc:${docId}#p${page}`, kind: "document", label, title: d.data.name ?? d.data.filename,
      date: d.data.received_at, page, page_count: d.data.page_count, body: clip(p.data?.text ?? null),
    };
  }

  if (ref.startsWith("fact:")) {
    // A fact ref opens the source it was extracted from, with the fact attached.
    const f = await db().from("facts").select("id,source_ref,summary,quote,event_date")
      .eq("id", ref.slice(5)).eq("matter_id", matterId).maybeSingle();
    if (!f.data || f.data.source_ref.startsWith("fact:")) return null;
    const under = await readSource(matterId, f.data.source_ref, maxChars);
    const fact = { id: f.data.id, summary: f.data.summary, quote: f.data.quote, date: f.data.event_date };
    return under ? { ...under, fact } : { ref, kind: "fact", label: `Fact from ${f.data.source_ref}`, title: f.data.summary, date: f.data.event_date, body: null, fact };
  }

  if (ref.startsWith("matter:")) {
    const m = await db().from("matters").select("display_number,description,status,stage,open_date,sol_date").eq("id", matterId).maybeSingle();
    if (!m.data) return null;
    return {
      ref, kind: "matter", label: "Clio matter", title: m.data.display_number, date: m.data.open_date,
      body: [`Description: ${m.data.description ?? ""}`, `Status: ${m.data.status ?? ""}`, `Stage: ${m.data.stage ?? ""}`,
        `Open date: ${m.data.open_date ?? ""}`, `Statute of limitations: ${m.data.sol_date ?? ""}`].join("\n"),
    };
  }

  const r = await db().from("source_items").select("*").eq("id", ref).eq("matter_id", matterId).is("deleted_at", null).maybeSingle();
  if (!r.data) return null;
  const it = r.data as ItemRow & { kind: string };
  let from: string[] | null = null;
  let to: string[] | null = null;
  if (it.kind === "email" || it.kind === "call") {
    const { senders, receivers } = commParties(it);
    from = senders.map((p) => p.name ?? p.type);
    to = receivers.map((p) => p.name ?? p.type);
  }
  return {
    ref, kind: it.kind, label: makeLabeler([it], [])(ref), title: it.title, date: it.occurred_at,
    body: clip(it.body_text), from, to, clio_url: it.clio_url,
  };
}
