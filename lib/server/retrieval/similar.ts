import "server-only";
import { db } from "../db";
import { labelRefs } from "./ask";

export interface SimilarHit { id: number; cite: string; label: string; snippet: string; sim: number }

/** Nearest chunks to a chunk (by id) or to a source ref ('email:88', 'doc:45#p17', 'fact:<uuid>'). */
export async function similar(opts: { chunkId?: number; ref?: string; matterId?: number; k?: number }): Promise<SimilarHit[]> {
  let id = opts.chunkId;
  let matterId = opts.matterId;
  if (!id && opts.ref) {
    let q = db().from("chunks").select("id,matter_id").eq("cite", opts.ref).limit(1);
    if (matterId) q = q.eq("matter_id", matterId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) return [];
    id = Number(data[0].id);
    matterId = Number(data[0].matter_id);
  }
  if (!id) return [];
  const { data, error } = await db().rpc("similar_chunks", { p_id: id, k: opts.k ?? 6 });
  if (error) throw new Error(`similar_chunks: ${error.message}`);
  const rows = (data ?? []) as { id: number; cite: string; body: string; sim: number }[];
  if (!matterId) {
    const m = await db().from("chunks").select("matter_id").eq("id", id).single();
    matterId = Number(m.data?.matter_id);
  }
  const labels = await labelRefs(matterId, rows.map((r) => r.cite));
  return rows.map((r) => ({ id: Number(r.id), cite: r.cite, label: labels[r.cite] ?? r.cite, snippet: String(r.body).slice(0, 300), sim: Number(r.sim) }));
}
