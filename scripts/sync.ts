/**
 * Sync one matter from Clio into Supabase.
 *   bun run job scripts/sync.ts            -> first open Personal Injury matter
 *   bun run job scripts/sync.ts <matterId> -> that matter
 *   add --full to ignore updated_since cursors
 */
import { discoverMatters, syncMatter } from "@/lib/server/sync";
import { startRun, finishRun } from "@/lib/server/pipeline/ctx";
import { requestCount } from "@/lib/server/clio/client";
import { db } from "@/lib/server/db";

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes("--full");
  const argId = args.find((a) => /^\d+$/.test(a));
  const t0 = Date.now();

  const matters = await discoverMatters();
  console.log(`[sync] ${matters.length} matters in Clio`);
  const pick = argId
    ? matters.find((m) => String(m.id) === argId)
    : matters.find((m) => m.status === "Open" && /personal injury/i.test(m.practice_area ?? "")) ?? matters[0];
  if (!pick) throw new Error("no matter to sync");
  console.log(`[sync] matter ${pick.id} ${pick.display_number ?? ""} (${pick.practice_area}, ${pick.stage})`);

  const ctx = await startRun(pick.id);
  try {
    const stats = await syncMatter(ctx, { full });
    await finishRun(ctx, "done", { sync: stats });
    console.log("[sync] changed:", stats.changed, "downloaded:", stats.downloaded, "failed downloads:", stats.failedDownloads);
  } catch (e) {
    await finishRun(ctx, "failed", { error: String((e as Error).message) });
    throw e;
  }

  const { data } = await db().from("source_items").select("kind, deleted_at").eq("matter_id", pick.id);
  const counts: Record<string, number> = {};
  for (const r of data ?? []) if (!r.deleted_at) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const docs = await db().from("documents").select("clio_id, storage_path").eq("matter_id", pick.id);
  console.log("[sync] source_items:", counts);
  console.log(`[sync] documents: ${docs.data?.length ?? 0}, stored: ${(docs.data ?? []).filter((d) => d.storage_path).length}`);
  console.log(`[sync] ${requestCount} Clio requests, ${((Date.now() - t0) / 1000).toFixed(1)}s, run ${ctx.runId}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
