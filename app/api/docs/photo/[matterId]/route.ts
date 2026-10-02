import { db } from "@/lib/server/db";
import { DOCS_BUCKET } from "@/lib/server/docs/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client headshot derived from the ID scan (see lib/server/docs/photo.ts). */
export async function GET(_req: Request, { params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  if (!/^\d+$/.test(matterId)) return new Response("bad id", { status: 400 });
  const m = await db().from("matters").select("photo_path").eq("id", matterId).maybeSingle();
  if (m.error || !m.data?.photo_path) return new Response("no photo", { status: 404 });
  const file = await db().storage.from(DOCS_BUCKET).download(m.data.photo_path);
  if (file.error || !file.data) return new Response("no photo", { status: 404 });
  return new Response(file.data.stream(), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
