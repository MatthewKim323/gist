import "server-only";
import { z } from "zod";
import sharp from "sharp";
import { structured, openai, logCall, costOf, type CallMeta, type Usage } from "../llm";
import { env } from "../env";

export const PAGE_TYPES = ["medical_record", "bill", "police_report", "pleading", "correspondence", "id", "other"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

const OcrSchema = z.object({
  text: z.string(),
  page_type: z.enum(PAGE_TYPES),
  has_diagnosis: z.boolean(),
  confidence: z.number(),
});
export type OcrResult = z.infer<typeof OcrSchema>;

const OCR_SYSTEM = `You transcribe one scanned page from a legal case file.
Return:
- text: a verbatim transcription of every legible word on the page, in reading order. Keep line breaks, headings, dates, numbers, codes (ICD/CPT), names and table rows exactly as printed. Render tables as one row per line with " | " between cells. Mark unreadable spans as [illegible]. Mark handwriting as [handwritten: ...]. Do not summarize, correct, or add anything that is not on the page.
- page_type: medical_record (clinical notes, imaging, ER, PT, operative, discharge), bill (invoices, ledgers, HCFA/UB forms, statements of charges), police_report, pleading (court filings, summons, complaint, motions, subpoenas), correspondence (letters, emails, faxes cover sheets), id (driver license, passport, insurance card, any identity document), other.
- has_diagnosis: true when the page states a diagnosis, impression, assessment, or ICD code.
- confidence: 0..1, how sure you are the transcription is complete and accurate.`;

export function jpegUrl(buf: Buffer, mime = "image/jpeg"): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function ocrImage(img: Buffer, meta: CallMeta, hint?: string): Promise<{ data: OcrResult; usage: Usage; model: string }> {
  try {
    return await ocrStructured(img, meta, hint);
  } catch {
    // Most often the provider's recitation filter tripping on court boilerplate. Fall back to strips.
    return ocrStrips(img, meta, hint);
  }
}

async function ocrStructured(img: Buffer, meta: CallMeta, hint?: string) {
  const model = env.swarmModel();
  const { data, usage } = await structured({
    model,
    system: OCR_SYSTEM,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: hint ? `Page: ${hint}` : "Transcribe this page." },
        { type: "input_image", image_url: jpegUrl(img), detail: "high" },
      ],
    }],
    schema: OcrSchema,
    schemaName: "page_ocr",
    meta,
    reasoning: "low",
  });
  return { data: { ...data, confidence: Math.max(0, Math.min(1, data.confidence)) }, usage, model };
}

const ClassifySchema = OcrSchema.pick({ page_type: true, has_diagnosis: true });

/** Transcribe in overlapping horizontal strips as plain text, keeping partial output, then classify separately. */
async function ocrStrips(img: Buffer, meta: CallMeta, hint?: string, parts = 4) {
  const model = env.swarmModel();
  const m = await sharp(img).metadata();
  const W = m.width!, H = m.height!, h = Math.ceil(H / parts), overlap = Math.round(H * 0.02);
  const total: Usage = { input: 0, output: 0, cached: 0, cost: 0, latencyMs: 0 };
  let partial = false;
  const texts = await Promise.all(Array.from({ length: parts }, async (_, i) => {
    const top = Math.max(0, i * h - overlap);
    const height = Math.min(H - top, h + 2 * overlap);
    const strip = await sharp(img).extract({ left: 0, top, width: W, height }).jpeg({ quality: 85 }).toBuffer();
    const t0 = Date.now();
    const res = await openai().responses.create({
      model,
      reasoning: { effort: "low" },
      instructions: "Transcribe every legible word in this image strip verbatim, in reading order, keeping line breaks. Output only the transcription.",
      input: [{ role: "user", content: [{ type: "input_image", image_url: jpegUrl(strip), detail: "high" }] }],
    });
    const u = res.usage;
    const usage: Usage = { input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0, cost: 0, latencyMs: Date.now() - t0 };
    usage.cost = costOf(model, usage.input, usage.output, usage.cached);
    await logCall(model, "openai", { ...meta, purpose: `${meta.purpose}_strip` }, usage);
    total.input += usage.input; total.output += usage.output; total.cached += usage.cached; total.cost += usage.cost;
    if (res.status !== "completed") partial = true;
    return (res.output_text ?? "").trim();
  }));
  const cls = await structured({
    model,
    system: "Classify this scanned case-file page. page_type: medical_record, bill, police_report, pleading (court filings, summons, complaint, subpoenas), correspondence, id (identity documents), other. has_diagnosis: true when it states a diagnosis, impression or ICD code.",
    input: [{ role: "user", content: [
      { type: "input_text", text: hint ? `Page: ${hint}` : "Classify." },
      { type: "input_image", image_url: jpegUrl(img), detail: "low" },
    ] }],
    schema: ClassifySchema,
    schemaName: "page_class",
    meta,
  });
  total.input += cls.usage.input; total.output += cls.usage.output; total.cost += cls.usage.cost;
  const text = texts.filter(Boolean).join("\n") + (partial ? "\n[transcription incomplete: provider filter truncated part of this page]" : "");
  return { data: { text, page_type: cls.data.page_type, has_diagnosis: cls.data.has_diagnosis, confidence: partial ? 0.6 : 0.85 }, usage: total, model };
}

const FaceSchema = z.object({
  found: z.boolean(),
  // normalized 0..1 relative to the image, top-left origin
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
});
export type FaceBox = z.infer<typeof FaceSchema>;

export async function faceBox(img: Buffer, meta: CallMeta, mime = "image/jpeg"): Promise<{ data: FaceBox; usage: Usage }> {
  return structured({
    system: `Locate the portrait photo of the person on this identity document (or the most prominent human face if it is not an ID).
Return a tight bounding box around the head and face (include hair and chin), normalized to the image: x,y = top-left corner, w,h = size, all in 0..1.
If there is no human face, return found=false and zeros.`,
    input: [{ role: "user", content: [{ type: "input_image", image_url: jpegUrl(img, mime), detail: "high" }] }],
    schema: FaceSchema,
    schemaName: "face_box",
    meta,
  });
}
