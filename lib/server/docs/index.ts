import "server-only";
import pLimit from "p-limit";
import { db, must } from "../db";
import type { RunCtx } from "../pipeline/ctx";
import { openPdf, pageText, needsOcr, renderPage, closePdf } from "./pdf";
import { download } from "./storage";
import { ocrImage } from "./vision";
import { deriveClientPhoto } from "./photo";

export { deriveClientPhoto } from "./photo";

const SLICE = 10;          // pages per timeline task for big docs
const OCR_CONCURRENCY = 8; // vision calls in flight across the whole matter

interface DocRow {
  clio_id: number;
  matter_id: number;
  name: string | null;
  version_id: number | null;
  storage_path: string | null;
  page_count: number | null;
  ocr_status: string | null;
}

export interface OcrStats {
  docs: number;
  pages: number;
  textLayerPages: number;
  ocrPages: number;
  cachedPages: number;
  failedPages: number;
  photo: string | null;
}

/**
 * Stage 2: make every page of every stored document readable. Text-layer pages are stored as-is;
 * image-only or junk-text pages are rendered and transcribed by the vision model. doc_pages is keyed
 * by (doc, version, page), so a page is transcribed once ever. Then derives the client photo.
 */
export async function ocrMatter(ctx: RunCtx, opts: { force?: boolean } = {}): Promise<OcrStats> {
  const docs = must(
    await db().from("documents")
      .select("clio_id, matter_id, name, version_id, storage_path, page_count, ocr_status")
      .eq("matter_id", ctx.matterId)
      .not("storage_path", "is", null)
      .order("size", { ascending: true }),
    "ocr: list documents",
  ) as DocRow[];

  const limit = pLimit(OCR_CONCURRENCY);
  const stats: OcrStats = { docs: docs.length, pages: 0, textLayerPages: 0, ocrPages: 0, cachedPages: 0, failedPages: 0, photo: null };

  // Docs run concurrently; the shared limiter caps vision calls. Small docs first so the timeline moves.
  await Promise.all(docs.map((d) => ocrDoc(ctx, d, limit, stats, !!opts.force).catch(async (e) => {
    await db().from("documents").update({ ocr_status: "failed", updated_at: new Date().toISOString() }).eq("clio_id", d.clio_id);
    console.error(`ocr doc ${d.clio_id}: ${(e as Error).message}`);
  })));

  try {
    stats.photo = await deriveClientPhoto(ctx);
  } catch (e) {
    console.error(`client photo: ${(e as Error).message}`);
  }
  return stats;
}

async function ocrDoc(ctx: RunCtx, d: DocRow, limit: ReturnType<typeof pLimit>, stats: OcrStats, force: boolean) {
  const version = d.version_id ?? 0;
  const existing = must(
    await db().from("doc_pages").select("page, source").eq("doc_id", d.clio_id).eq("version_id", version),
    "ocr: existing pages",
  ) as { page: number; source: string }[];
  const have = new Set(existing.map((p) => p.page));

  // Fully cached: one cached task so the timeline still shows the doc.
  if (!force && d.ocr_status === "done" && d.page_count && have.size >= d.page_count) {
    await ctx.task("ocr", `doc:${d.clio_id} p.1-${d.page_count}`, async (t) => {
      t.cached();
      await t.event(`${d.page_count} pages cached`);
    });
    stats.pages += d.page_count;
    stats.cachedPages += d.page_count;
    return;
  }

  await db().from("documents").update({ ocr_status: "running", updated_at: new Date().toISOString() }).eq("clio_id", d.clio_id);
  const bytes = await download(d.storage_path!);
  const pdf = await openPdf(bytes);
  const n = pdf.numPages;

  const slices: [number, number][] = [];
  for (let a = 1; a <= n; a += SLICE) slices.push([a, Math.min(n, a + SLICE - 1)]);

  let textLayer = 0, failed = 0;
  await Promise.all(slices.map(([a, b]) =>
    ctx.task("ocr", `doc:${d.clio_id} p.${a}-${b}`, async (t) => {
      let ocr = 0, cached = 0, text = 0;
      const rows: Record<string, unknown>[] = [];
      const jobs: Promise<void>[] = [];
      for (let p = a; p <= b; p++) {
        if (!force && have.has(p)) {
          cached++;
          if (existing.find((e) => e.page === p)?.source === "text_layer") text++;
          continue;
        }
        const raw = await pageText(pdf, p);
        if (!needsOcr(raw)) {
          text++;
          rows.push({ doc_id: d.clio_id, version_id: version, page: p, text: raw, source: "text_layer", ocr_model: null, page_type: null, has_diagnosis: false, confidence: 1 });
          continue;
        }
        jobs.push(limit(async () => {
          try {
            const img = await renderPage(pdf, p);
            const r = await ocrImage(img, { purpose: "ocr", matterId: ctx.matterId, runId: ctx.runId }, `${p} of ${n}${d.name ? `, document "${d.name}"` : ""}`);
            t.usage({ input: r.usage.input, output: r.usage.output, cost: r.usage.cost });
            ocr++;
            rows.push({ doc_id: d.clio_id, version_id: version, page: p, text: r.data.text, source: "ocr", ocr_model: r.model, page_type: r.data.page_type, has_diagnosis: r.data.has_diagnosis, confidence: r.data.confidence });
            if (ocr % 3 === 0) await t.event(`${ocr} pages transcribed`);
          } catch (e) {
            failed++;
            console.error(`ocr doc ${d.clio_id} p${p}: ${(e as Error).message}`);
          }
        }));
      }
      await Promise.all(jobs);
      if (rows.length) must(await db().from("doc_pages").upsert(rows, { onConflict: "doc_id,version_id,page" }), "ocr: upsert pages");
      if (cached === b - a + 1) t.cached();
      textLayer += text;
      stats.pages += b - a + 1;
      stats.textLayerPages += text;
      stats.ocrPages += ocr;
      stats.cachedPages += cached;
      await t.event(`${b - a + 1} pages, ${ocr} ocr${cached ? `, ${cached} cached` : ""}`);
    }),
  ));
  stats.failedPages += failed;
  await closePdf(pdf);

  await db().from("documents").update({
    page_count: n,
    text_layer_pages: textLayer,
    ocr_status: failed ? "failed" : "done",
    updated_at: new Date().toISOString(),
  }).eq("clio_id", d.clio_id);
}
