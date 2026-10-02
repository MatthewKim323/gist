import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Transcript of one page for the source drawer's OCR view: { text, source, page_type }. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; page: string }> }) {
  const { id, page } = await params;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(page)) return Response.json({ error: "bad request" }, { status: 400 });
  const doc = await db().from("documents").select("version_id, page_count").eq("clio_id", id).maybeSingle();
  if (doc.error || !doc.data) return Response.json({ error: "not found" }, { status: 404 });
  const row = await db().from("doc_pages")
    .select("text, source, page_type, has_diagnosis, confidence")
    .eq("doc_id", id).eq("version_id", doc.data.version_id ?? 0).eq("page", Number(page))
    .maybeSingle();
  if (row.error || !row.data) return Response.json({ error: "page not processed" }, { status: 404 });
  return Response.json({ ...row.data, page: Number(page), page_count: doc.data.page_count });
}
