import { fixtureSource } from "@/components/gist/dashboard/fixture";
import type { SourcePayload } from "./types";

function docParts(ref: string): { id: string; page: number | null } | null {
  const m = ref.match(/^doc(?:ument)?:([^#]+)(?:#p(\d+))?$/);
  return m ? { id: m[1]!, page: m[2] ? Number(m[2]) : null } : null;
}

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const ct = r.headers.get("content-type") ?? "";
  return ct.includes("json") ? r.json() : { text: await r.text() };
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Loads a source item for the drawer. Tolerant of the exact API shape (SourceItem or SourcePayload). */
export async function loadSource(ref: string, matterId: number | null, fixture: boolean): Promise<SourcePayload> {
  if (fixture) {
    const f = fixtureSource(ref);
    if (!f) throw new Error("Not in fixture");
    return f;
  }
  const doc = docParts(ref);
  let base: Record<string, unknown> = {};
  if (matterId != null) {
    try {
      base = (await json(`/api/matter/${matterId}/source/${encodeURIComponent(ref)}`)) as Record<string, unknown>;
      if (base && typeof base === "object" && "item" in base && base.item && typeof base.item === "object") {
        base = { ...(base.item as Record<string, unknown>), ...base };
      }
    } catch {
      if (!doc) throw new Error("Source unavailable");
    }
  }
  const out: SourcePayload = {
    ref,
    kind: str(base.kind) ?? (doc ? "document" : ref.split(":")[0] ?? "source"),
    title: str(base.title),
    body_text: str(base.body_text) ?? str(base.text),
    occurred_at: str(base.occurred_at),
    clio_url: str(base.clio_url),
  };
  if (doc) {
    const given = (base.doc ?? {}) as Record<string, unknown>;
    let pageText = str(given.page_text) ?? str(base.page_text);
    const page = (typeof given.page === "number" ? given.page : null) ?? doc.page ?? 1;
    if (!pageText) {
      try {
        const p = (await json(`/api/docs/${doc.id}/page/${page}`)) as Record<string, unknown>;
        pageText = str(p.text) ?? str(p.ocr_text) ?? str(p.page_text);
      } catch {
        pageText = null;
      }
    }
    out.doc = {
      id: doc.id,
      name: str(given.name) ?? str(base.name) ?? out.title,
      page,
      pages_total: typeof given.pages_total === "number" ? given.pages_total : null,
      page_text: pageText,
      pdf_url: str(given.pdf_url) ?? `/api/docs/${doc.id}`,
    };
  }
  return out;
}
