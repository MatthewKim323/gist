import "server-only";
import path from "node:path";
import { createRequire } from "node:module";

// pdfjs (legacy build runs in Node) + @napi-rs/canvas for rendering. The wasm dir is needed for
// CCITT/JBIG2 fax scans, which are common in medical record bundles.
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;

let pdfjsP: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  if (!pdfjsP) pdfjsP = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsP;
}

function wasmDir(): string {
  const req = createRequire(path.join(process.cwd(), "package.json"));
  return path.join(path.dirname(req.resolve("pdfjs-dist/package.json")), "wasm") + path.sep;
}

export type Pdf = PDFDocumentProxy;

export async function openPdf(bytes: Uint8Array): Promise<Pdf> {
  const lib = await pdfjs();
  return lib.getDocument({
    data: bytes.slice(), // pdfjs transfers the buffer; keep the caller's copy intact
    wasmUrl: wasmDir(),
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
}

/** Text layer of one page (1-based), lines joined by newlines. */
export async function pageText(pdf: Pdf, n: number): Promise<string> {
  const page = await pdf.getPage(n);
  const tc = await page.getTextContent();
  let out = "";
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    out += it.str;
    if (it.hasEOL) out += "\n";
    else if (it.str && !out.endsWith(" ")) out += " ";
  }
  page.cleanup();
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Court e-filing stamps are machine text overlaid on scans; they don't make a page readable.
const STAMP = /^(FILED:|INDEX NO\.|NYSCEF DOC\. NO\.|RECEIVED NYSCEF|\d+ of \d+$|Page \d+ of \d+$)/i;

/**
 * How much real, readable text a text layer holds. Counts characters in word-like tokens
 * (letters, a vowel, length >= 2) after dropping e-filing stamp lines. Junk OCR from bad scanners
 * fails the ratio check even when it is long.
 */
export function usableText(text: string): { chars: number; ratio: number } {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !STAMP.test(l));
  const tokens = lines.join(" ").split(/\s+/).filter(Boolean);
  if (!tokens.length) return { chars: 0, ratio: 0 };
  let good = 0, chars = 0;
  for (const t of tokens) {
    const w = t.replace(/^[^\w]+|[^\w]+$/g, "");
    if (/^\d[\d,./:$%-]*$/.test(w) || (/^[A-Za-z][A-Za-z'-]*$/.test(w) && (w.length === 1 ? /^[aAI]$/.test(w) : /[aeiouyAEIOUY]/.test(w)))) {
      good++;
      chars += w.length;
    }
  }
  return { chars, ratio: good / tokens.length };
}

export function needsOcr(text: string): boolean {
  const u = usableText(text);
  return u.chars < 60 || u.ratio < 0.5;
}

/** Render a page to JPEG with the long side near `longSide` px. */
export async function renderPage(pdf: Pdf, n: number, longSide = 1600, format: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, longSide / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
  page.cleanup();
  return format === "png" ? canvas.encode("png") : canvas.encode("jpeg", 82);
}

export async function closePdf(pdf: Pdf): Promise<void> {
  try { await pdf.loadingTask.destroy(); } catch { /* already closed */ }
}
