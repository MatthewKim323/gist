import type { SourceRef } from "@/lib/types";

/** What the source drawer renders. Built from GET /api/matter/[id]/source/[ref] (or the dev fixture). */
export interface SourcePayload {
  ref: SourceRef;
  kind: string;
  title: string | null;
  body_text: string | null;
  occurred_at: string | null;
  clio_url: string | null;
  /** Present for 'doc:<id>#p<n>' refs. */
  doc?: {
    id: number | string;
    name: string | null;
    page: number | null;
    pages_total: number | null;
    /** OCR transcript of that page. */
    page_text: string | null;
    /** PDF url; defaults to /api/docs/<id>. null in fixture mode. */
    pdf_url: string | null;
  };
}
