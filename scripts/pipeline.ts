// Run the pipeline locally: bun run job scripts/pipeline.ts [matterId] [--only extract,index] [--skip sync] [--no-docs]
import { db } from "@/lib/server/db";
import { runPipeline, type StageName } from "@/lib/server/pipeline/run";
import { startRun, finishRun } from "@/lib/server/pipeline/ctx";
import { extractMatter } from "@/lib/server/pipeline/extract";
import { countStats } from "@/lib/server/pipeline/run";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  let matterId = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)));
  if (!matterId) {
    const r = await db().from("matters").select("id").order("synced_at", { ascending: false }).limit(1).maybeSingle();
    if (!r.data) {
      const s = await db().from("source_items").select("matter_id").limit(1).maybeSingle();
      matterId = Number(s.data?.matter_id);
    } else matterId = Number(r.data.id);
  }
  if (!matterId) throw new Error("no matter found; pass a matter id");
  const t0 = Date.now();
  if (process.argv.includes("--no-docs")) {
    // Extraction over Clio items only (no doc pages), used while OCR is still running.
    const ctx = await startRun(matterId);
    const stats = await extractMatter(ctx, { includeDocs: false });
    await finishRun(ctx, "done", { ...(await countStats(matterId, ctx.runId)), extract: stats });
    console.log(JSON.stringify({ runId: ctx.runId, extract: stats, secs: (Date.now() - t0) / 1000 }, null, 2));
    return;
  }
  const only = flag("only")?.split(",") as StageName[] | undefined;
  const skip = flag("skip")?.split(",") as StageName[] | undefined;
  const res = await runPipeline(matterId, { only, skip });
  console.log(JSON.stringify({ ...res, secs: (Date.now() - t0) / 1000 }, null, 2));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
