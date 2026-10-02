import "server-only";
import { db } from "../db";
import type { Fact } from "@/lib/types";

// One read of everything the deterministic signals need. Signals never call a model.

export interface MatterRow {
  id: number;
  display_number: string | null;
  description: string | null;
  status: string | null;
  stage: string | null;
  stage_updated_at: string | null;
  practice_area: string | null;
  client_contact_id: number | null;
  client_name: string | null;
  open_date: string | null;
  sol_date: string | null;
  photo_path: string | null;
  raw: Record<string, unknown> | null;
}

export interface ItemRow {
  id: string;
  matter_id: number;
  kind: string;
  clio_id: number;
  title: string | null;
  body_text: string | null;
  occurred_at: string | null;
  updated_at_clio: string | null;
  raw: Record<string, unknown> | null;
  first_seen_at: string | null;
  content_changed_at: string | null;
  clio_url: string | null;
}

export interface DocRow {
  clio_id: number;
  name: string | null;
  filename: string | null;
  folder: string | null;
  received_at: string | null;
  page_count: number | null;
  ocr_status: string | null;
  version_id: number | null;
}

export interface StageRow { id: number; name: string; ord: number | null; practice_area: string | null }

export interface MatterData {
  matter: MatterRow;
  items: ItemRow[];
  byKind: Record<string, ItemRow[]>;
  facts: Fact[];          // verified, not superseded
  allFactCounts: { verified: number; rejected: number; review: number };
  docs: DocRow[];
  stages: StageRow[];
  today: Date;
}

async function all<T>(q: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const res = await q();
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? [];
}

async function paged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await build(from, from + 999);
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    const rows = res.data ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function loadMatter(matterId: number): Promise<MatterData> {
  const d = db();
  const [mRes, items, facts, statusRows, docs, stages] = await Promise.all([
    d.from("matters").select("*").eq("id", matterId).maybeSingle(),
    paged<ItemRow>((a, b) => d.from("source_items")
      .select("id,matter_id,kind,clio_id,title,body_text,occurred_at,updated_at_clio,raw,first_seen_at,content_changed_at,clio_url")
      .eq("matter_id", matterId).is("deleted_at", null).order("id").range(a, b), "source_items"),
    paged<Fact>((a, b) => d.from("facts").select("*").eq("matter_id", matterId).eq("status", "verified")
      .is("superseded_at", null).order("id").range(a, b), "facts"),
    paged<{ status: string }>((a, b) => d.from("facts").select("status").eq("matter_id", matterId).is("superseded_at", null).order("id").range(a, b), "fact status"),
    all<DocRow>(() => d.from("documents").select("clio_id,name,filename,folder,received_at,page_count,ocr_status,version_id").eq("matter_id", matterId), "documents"),
    all<StageRow>(() => d.from("matter_stages").select("id,name,ord,practice_area").order("ord"), "matter_stages"),
  ]);
  if (mRes.error) throw new Error(`matter: ${mRes.error.message}`);
  if (!mRes.data) throw new Error(`matter ${matterId} not found`);
  const byKind: Record<string, ItemRow[]> = {};
  for (const it of items) (byKind[it.kind] ??= []).push(it);
  const counts = { verified: 0, rejected: 0, review: 0 };
  for (const r of statusRows) {
    if (r.status === "verified") counts.verified++;
    else if (r.status === "rejected") counts.rejected++;
    else if (r.status === "needs_review") counts.review++;
  }
  return { matter: mRes.data as MatterRow, items, byKind, facts, allFactCounts: counts, docs, stages, today: new Date() };
}
