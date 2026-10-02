import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matters synced from Clio, with the latest digest version if one exists. */
export async function GET() {
  const [m, d] = await Promise.all([
    db().from("matters").select("id,display_number,description,status,stage,stage_updated_at,client_name,open_date,sol_date,photo_path,synced_at,is_demo").order("id"),
    db().from("digests").select("matter_id,version,created_at").order("version", { ascending: false }),
  ]);
  if (m.error) return Response.json({ error: m.error.message }, { status: 500 });
  const latest = new Map<number, { version: number; created_at: string }>();
  for (const r of d.data ?? []) if (!latest.has(Number(r.matter_id))) latest.set(Number(r.matter_id), { version: r.version, created_at: r.created_at });
  return Response.json({
    matters: (m.data ?? []).map(({ photo_path, ...x }) => ({
      ...x,
      photo_url: photo_path ? `/api/docs/photo/${x.id}` : null,
      digest: latest.get(Number(x.id)) ?? null,
    })),
  });
}
