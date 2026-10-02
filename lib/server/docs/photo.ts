import "server-only";
import sharp from "sharp";
import { db, must } from "../db";
import type { RunCtx } from "../pipeline/ctx";
import { openPdf, renderPage, closePdf } from "./pdf";
import { download, upload } from "./storage";
import { faceBox, type FaceBox } from "./vision";

const ID_NAME = /licen[cs]e|\bid\b|identification|passport|\bdl\b|\bdmv\b/i;
const ID_TEXT = /driver'?s?\s+licen[cs]e|\bDOB\b|date of birth|passport|identification card|\bDMV\b/i;

interface Candidate { doc_id: number; page: number; storage_path: string; score: number }

/** Find the page most likely to be the client's identity document. Nothing is hardcoded: page_type, name and text signals. */
async function findIdPage(matterId: number): Promise<Candidate | null> {
  const docs = must(
    await db().from("documents").select("clio_id, name, filename, version_id, storage_path, page_count").eq("matter_id", matterId).not("storage_path", "is", null),
    "photo: docs",
  ) as { clio_id: number; name: string | null; filename: string | null; version_id: number | null; storage_path: string; page_count: number | null }[];
  if (!docs.length) return null;
  const pages = must(
    await db().from("doc_pages").select("doc_id, version_id, page, page_type, text, source").in("doc_id", docs.map((d) => d.clio_id)),
    "photo: pages",
  ) as { doc_id: number; version_id: number; page: number; page_type: string | null; text: string | null; source: string }[];

  const cands: Candidate[] = [];
  for (const d of docs) {
    const nameHit = ID_NAME.test(`${d.name ?? ""} ${d.filename ?? ""}`);
    const mine = pages.filter((p) => p.doc_id === d.clio_id && p.version_id === (d.version_id ?? 0));
    for (const p of mine) {
      let score = 0;
      if (p.page_type === "id") score += 5;
      if (nameHit) score += 3;
      if (p.text && ID_TEXT.test(p.text)) score += 2;
      if (p.source === "ocr") score += 1;        // photo IDs are scans
      if ((d.page_count ?? mine.length) <= 2) score += 1; // ID scans are short
      if (score >= 3) cands.push({ doc_id: d.clio_id, page: p.page, storage_path: d.storage_path, score });
    }
    if (nameHit && !mine.length) cands.push({ doc_id: d.clio_id, page: 1, storage_path: d.storage_path, score: 3 });
  }
  cands.sort((a, b) => b.score - a.score || a.page - b.page);
  return cands[0] ?? null;
}

function clampBox(b: FaceBox, pad: number) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const half = (Math.max(b.w, b.h) * (1 + pad)) / 2;
  const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half * 1.1);
  const x1 = Math.min(1, cx + half), y1 = Math.min(1, cy + half * 1.1);
  return { x0, y0, x1, y1 };
}

async function crop(img: Buffer, b: FaceBox, pad: number): Promise<Buffer> {
  const meta = await sharp(img).metadata();
  const W = meta.width!, H = meta.height!;
  const r = clampBox(b, pad);
  const left = Math.round(r.x0 * W), top = Math.round(r.y0 * H);
  const width = Math.max(8, Math.min(W - left, Math.round((r.x1 - r.x0) * W)));
  const height = Math.max(8, Math.min(H - top, Math.round((r.y1 - r.y0) * H)));
  return sharp(img).extract({ left, top, width, height }).toBuffer();
}

/**
 * Derive the client headshot from the ID scan at runtime: locate the face on the rendered page,
 * refine on a padded crop, then square-crop, upload to storage and set matters.photo_path.
 * Returns the storage path or null.
 */
export async function deriveClientPhoto(ctx: RunCtx, opts: { force?: boolean } = {}): Promise<string | null> {
  const outPath = `${ctx.matterId}/client-photo.jpg`;
  if (!opts.force) {
    const m = await db().from("matters").select("photo_path").eq("id", ctx.matterId).maybeSingle();
    if (m.data?.photo_path) return m.data.photo_path as string;
  }
  const cand = await findIdPage(ctx.matterId);
  if (!cand) return null;

  return ctx.task("ocr", `photo:doc:${cand.doc_id} p.${cand.page}`, async (t) => {
    const meta = { purpose: "client_photo", matterId: ctx.matterId, runId: ctx.runId };
    const pdf = await openPdf(await download(cand.storage_path));
    const page = await renderPage(pdf, cand.page, 2400, "png");
    await closePdf(pdf);

    const first = await faceBox(page, meta, "image/png");
    t.usage(first.usage);
    if (!first.data.found || first.data.w <= 0 || first.data.h <= 0) {
      await t.event("no face found");
      return null;
    }
    // Refine on a generous crop around the first guess: small faces on a full page are imprecise.
    const coarse = await crop(page, first.data, 1.6);
    const second = await faceBox(coarse, meta, "image/png");
    t.usage(second.usage);
    const final = second.data.found && second.data.w > 0 ? await crop(coarse, second.data, 0.5) : await crop(page, first.data, 0.5);

    const jpg = await sharp(final).resize(512, 512, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
    await upload(outPath, jpg, "image/jpeg");
    must(await db().from("matters").update({ photo_path: outPath }).eq("id", ctx.matterId).select("id"), "photo: set path");
    await t.event("client photo derived");
    return outPath;
  });
}
