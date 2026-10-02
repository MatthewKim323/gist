import { db } from "@/lib/server/db";
import { DOCS_BUCKET } from "@/lib/server/docs/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams a stored document PDF for the source drawer. The client appends #page=N. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new Response("bad id", { status: 400 });
  const doc = await db().from("documents").select("name, filename, storage_path, content_type").eq("clio_id", id).maybeSingle();
  if (doc.error || !doc.data?.storage_path) return new Response("not found", { status: 404 });
  const file = await db().storage.from(DOCS_BUCKET).download(doc.data.storage_path);
  if (file.error || !file.data) return new Response("not found", { status: 404 });
  const name = String(doc.data.filename ?? doc.data.name ?? `doc-${id}.pdf`).replace(/[^\w.\- ]+/g, "_");
  return new Response(file.data.stream(), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(file.data.size),
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
