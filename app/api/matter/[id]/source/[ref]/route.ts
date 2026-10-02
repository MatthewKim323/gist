import { db } from "@/lib/server/db";
import { makeLabeler } from "@/lib/server/signals";
import { commParties } from "@/lib/server/signals/util";
import type { DocRow, ItemRow } from "@/lib/server/signals/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One source for the drawer. ref is a SourceRef, url-encoded: 'email:88', 'field:123', 'doc:45#p17'
 * (also accepts 'doc:45:p17' / 'doc:45~17' since '#' is awkward in paths).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; ref: string }> }) {
  const { id, ref: rawRef } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const ref = decodeURIComponent(rawRef).replace(/^(doc|document):(\d+)(?::p|~)(\d+)$/, "$1:$2#p$3");
  const matterId = Number(id);

  const doc = ref.match(/^(?:doc|document):(\d+)(?:#p(\d+))?$/);
  if (doc) {
    const docId = Number(doc[1]);
    const page = doc[2] ? Number(doc[2]) : 1;
    const d = await db().from("documents").select("clio_id,name,filename,folder,received_at,page_count,version_id,ocr_status")
      .eq("clio_id", docId).eq("matter_id", matterId).maybeSingle();
    if (!d.data) return Response.json({ error: "not found" }, { status: 404 });
    const p = await db().from("doc_pages").select("text,source,page_type,confidence")
      .eq("doc_id", docId).eq("version_id", d.data.version_id ?? 0).eq("page", page).maybeSingle();
    const it = await db().from("source_items").select("clio_url").eq("id", `document:${docId}`).maybeSingle();
    const label = makeLabeler([], [d.data as DocRow])(doc[2] ? `doc:${docId}#p${page}` : `doc:${docId}`);
    return Response.json({
      ref, kind: "document", label, title: d.data.name ?? d.data.filename, date: d.data.received_at,
      folder: d.data.folder, page, page_count: d.data.page_count,
      body: p.data?.text ?? null, page_source: p.data?.source ?? null, page_type: p.data?.page_type ?? null,
      file_url: `/api/docs/${docId}#page=${page}`, page_url: `/api/docs/${docId}/page/${page}`,
      clio_url: it.data?.clio_url ?? null, from: null, to: null,
    });
  }

  if (ref.startsWith("fact:")) {
    const f = await db().from("facts").select("*").eq("id", ref.slice(5)).eq("matter_id", matterId).maybeSingle();
    if (!f.data) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ ref, kind: "fact", fact: f.data, source_ref: f.data.source_ref });
  }

  if (ref.startsWith("matter:")) {
    const m = await db().from("matters").select("id,display_number,description,status,stage,open_date,sol_date").eq("id", matterId).maybeSingle();
    if (!m.data) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      ref, kind: "matter", label: "Clio matter", title: m.data.display_number, date: m.data.open_date,
      body: [`Description: ${m.data.description ?? ""}`, `Status: ${m.data.status ?? ""}`, `Stage: ${m.data.stage ?? ""}`,
        `Open date: ${m.data.open_date ?? ""}`, `Statute of limitations: ${m.data.sol_date ?? ""}`].join("\n"),
      clio_url: null, from: null, to: null,
    });
  }

  const r = await db().from("source_items").select("*").eq("id", ref).eq("matter_id", matterId).is("deleted_at", null).maybeSingle();
  if (!r.data) return Response.json({ error: "not found" }, { status: 404 });
  const it = r.data as ItemRow & { kind: string };
  const label = makeLabeler([it], [])(ref);
  let from: string[] | null = null;
  let to: string[] | null = null;
  if (it.kind === "email" || it.kind === "call") {
    const { senders, receivers } = commParties(it);
    from = senders.map((p) => p.name ?? p.type);
    to = receivers.map((p) => p.name ?? p.type);
  }
  return Response.json({
    ref, kind: it.kind, label, title: it.title, date: it.occurred_at, body: it.body_text,
    from, to, clio_url: it.clio_url,
  });
}
