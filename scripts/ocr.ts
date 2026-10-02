// Run the docs stage (OCR + client photo) for the first matter that has stored documents.
// bun run job scripts/ocr.ts [--force] [--photo]
import { db } from "../lib/server/db";
import { startRun, finishRun } from "../lib/server/pipeline/ctx";
import { ocrMatter, deriveClientPhoto } from "../lib/server/docs";

async function main() {
  const force = process.argv.includes("--force");
  const photoOnly = process.argv.includes("--photo");
  const first = await db().from("documents").select("matter_id").not("storage_path", "is", null).limit(1).maybeSingle();
  if (!first.data) throw new Error("no stored documents yet (run sync first)");
  const matterId = Number(first.data.matter_id);
  const ctx = await startRun(matterId);
  const t0 = Date.now();
  try {
    const stats = photoOnly
      ? { photo: await deriveClientPhoto(ctx, { force: true }) }
      : await ocrMatter(ctx, { force });
    await finishRun(ctx, "done", { stage: "ocr", ...stats });
    const calls = await db().from("llm_calls").select("cost_usd, purpose").eq("run_id", ctx.runId);
    const cost = (calls.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const docs = await db().from("documents").select("clio_id, name, page_count, text_layer_pages, ocr_status").eq("matter_id", matterId).order("page_count", { ascending: false });
    console.table(docs.data);
    console.log({ matterId, runId: ctx.runId, secs: Math.round((Date.now() - t0) / 1000), calls: calls.data?.length ?? 0, cost_usd: Number(cost.toFixed(4)), ...stats });
  } catch (e) {
    await finishRun(ctx, "failed", { stage: "ocr", error: (e as Error).message });
    throw e;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
