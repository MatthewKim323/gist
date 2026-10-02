import "server-only";
import { z } from "zod";
import { structured, type CallMeta, type Usage } from "../llm";
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
