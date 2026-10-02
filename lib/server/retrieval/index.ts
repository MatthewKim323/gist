import "server-only";
import { createHash } from "node:crypto";
import { db, must } from "../db";
import { embed, costOf } from "../llm";
import { env } from "../env";
import type { RunCtx } from "../pipeline/ctx";

// Index stage: one chunk per source item, one per OCR'd doc page, one per verified fact.
// Only new or changed chunks are embedded (content_hash skip). Chunks whose source vanished are deleted.

export interface ChunkRow {
  matter_id: number;
  source_kind: string;      // note|email|call|task|calendar|expense|field|doc|fact
  source_id: string;
  page: number | null;
  part: number;
  event_date: string | null;
  audience: "firm" | "provider_ok";
  header: string;
  body: string;
  content_hash: string;
}

const PAGE = 1000;

/** Page through a Supabase select (default row cap is 1000). */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await build(from, from + PAGE - 1), what);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function names(v: unknown): string | null {
  if (!v) return null;
  const arr = Array.isArray(v) ? v : [v];
  const ns = arr
    .map((x) => (typeof x === "string" ? x : (x as Record<string, unknown>)?.name ?? (x as Record<string, unknown>)?.email ?? null))
    .filter(Boolean) as string[];
  return ns.length ? ns.join(", ") : null;
}

interface SourceItemRow {
  id: string; kind: string; clio_id: number; title: string | null; body_text: string | null;
  occurred_at: string | null; raw: Record<string, unknown> | null; deleted_at: string | null;
}

/** Contextual header so both BM25 and the embedding see who/when/what. */
export function itemHeader(it: SourceItemRow): string {
  const raw = (it.raw ?? {}) as Record<string, unknown>;
  const date = day(it.occurred_at) ?? "undated";
  const parts: string[] = [`${it.kind} ${date}`];
  if (it.kind === "email" || it.kind === "call") {
    const from = names(raw.senders ?? raw.sender ?? raw.from);
    const to = names(raw.receivers ?? raw.receiver ?? raw.to);
    if (from || to) parts.push(`from ${from ?? "?"} -> ${to ?? "?"}`);
  }
  const author = names(raw.author ?? raw.user ?? raw.assignee);
  if (author && it.kind !== "email") parts.push(`by ${author}`);
  const title = it.title?.trim();
  return `[${parts.join(" ")}${title ? ` | "${clip(title, 160)}"` : ""}]`;
}

export async function buildChunks(matterId: number): Promise<ChunkRow[]> {
  const items = await fetchAll<SourceItemRow>(
    (a, b) => db().from("source_items").select("id,kind,clio_id,title,body_text,occurred_at,raw,deleted_at")
      .eq("matter_id", matterId).is("deleted_at", null).order("id").range(a, b),
    "source_items",
  );
  const docs = await fetchAll<{ clio_id: number; name: string | null; filename: string | null; version_id: number | null; received_at: string | null }>(
    (a, b) => db().from("documents").select("clio_id,name,filename,version_id,received_at").eq("matter_id", matterId).order("clio_id").range(a, b),
    "documents",
  );
  const docById = new Map(docs.map((d) => [Number(d.clio_id), d]));
  const pages = docs.length
    ? await fetchAll<{ doc_id: number; version_id: number; page: number; text: string | null; page_type: string | null }>(
        (a, b) => db().from("doc_pages").select("doc_id,version_id,page,text,page_type")
          .in("doc_id", docs.map((d) => d.clio_id)).order("doc_id").order("page").range(a, b),
        "doc_pages",
      )
    : [];
  const facts = await fetchAll<{ id: string; source_ref: string; kind: string; event_key: string | null; summary: string; quote: string; event_date: string | null; audience: string }>(
    (a, b) => db().from("facts").select("id,source_ref,kind,event_key,summary,quote,event_date,audience")
      .eq("matter_id", matterId).eq("status", "verified").is("superseded_at", null).order("id").range(a, b),
    "facts",
  );

  const out: ChunkRow[] = [];
  const push = (c: Omit<ChunkRow, "content_hash" | "matter_id" | "part">) => {
    if (!c.body.trim()) return;
    out.push({ ...c, matter_id: matterId, part: 0, content_hash: sha(`${c.audience}\n${c.header}\n${c.body}`) });
  };

  for (const it of items) {
    if (it.kind === "document") continue; // the pages carry the content
    const body = (it.body_text ?? "").trim() || (it.title ?? "").trim();
    push({
      source_kind: it.kind, source_id: String(it.clio_id ?? it.id.split(":")[1]), page: null,
      event_date: day(it.occurred_at), audience: "firm", header: itemHeader(it), body: clip(body, 20000),
    });
  }

  // Keep only the latest version per doc.
  for (const p of pages) {
    const d = docById.get(Number(p.doc_id));
    if (d?.version_id && Number(d.version_id) !== Number(p.version_id)) continue;
    const name = d?.name ?? d?.filename ?? `doc ${p.doc_id}`;
    push({
      source_kind: "doc", source_id: String(p.doc_id), page: p.page, event_date: day(d?.received_at),
      audience: "firm", header: `[document "${clip(name, 160)}" p${p.page}${p.page_type ? ` | ${p.page_type}` : ""}]`,
      body: clip(p.text ?? "", 20000),
    });
  }

  for (const f of facts) {
    push({
      source_kind: "fact", source_id: f.id, page: null, event_date: day(f.event_date),
      audience: f.audience === "provider_safe" ? "provider_ok" : "firm",
      header: `[fact ${f.kind}${f.event_key ? ` ${f.event_key}` : ""} ${day(f.event_date) ?? ""} | from ${f.source_ref}]`.replace(/\s+\|/, " |"),
      body: `${f.summary}\n"${f.quote}"`,
    });
  }
  return out;
}

const keyOf = (c: { source_kind: string; source_id: string; page: number | null; part: number }) =>
  `${c.source_kind}|${c.source_id}|${c.page ?? ""}|${c.part}`;

export async function indexMatter(ctx: RunCtx): Promise<{ total: number; embedded: number; deleted: number; cost: number }> {
  const matterId = ctx.matterId;
  const want = await buildChunks(matterId);
  const haveRows = await fetchAll<{ id: number; source_kind: string; source_id: string; page: number | null; part: number; content_hash: string }>(
    (a, b) => db().from("chunks").select("id,source_kind,source_id,page,part,content_hash").eq("matter_id", matterId).order("id").range(a, b),
    "chunks",
  );
  const noEmb = new Set((await fetchAll<{ id: number }>(
    (a, b) => db().from("chunks").select("id").eq("matter_id", matterId).is("embedding", null).order("id").range(a, b),
    "chunks noemb",
  )).map((r) => r.id));
  const have = haveRows.map((h) => ({ ...h, has_emb: !noEmb.has(h.id) }));
  const haveByKey = new Map(have.map((h) => [keyOf(h), h]));
  const wantKeys = new Set(want.map(keyOf));

  const stale = have.filter((h) => !wantKeys.has(keyOf(h))).map((h) => h.id);
  const todo = want.filter((w) => {
    const h = haveByKey.get(keyOf(w));
    return !h || h.content_hash !== w.content_hash || !h.has_emb;
  });

  let cost = 0;
  const result = await ctx.task("embed", `${todo.length} chunks`, async (t) => {
    if (stale.length) {
      for (let i = 0; i < stale.length; i += 500) must(await db().from("chunks").delete().in("id", stale.slice(i, i + 500)), "chunks delete");
    }
    if (!todo.length) { t.cached(); await t.event(`${want.length} chunks, 0 new`); return; }
    const BATCH = 128;
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const texts = batch.map((c) => `${c.header}\n${c.body}`);
      const vecs = await embed(texts, { purpose: "embed", matterId, runId: ctx.runId });
      const tokens = Math.round(texts.reduce((s, x) => s + Math.min(x.length, 24000), 0) / 4);
      const c = costOf(env.embeddingModel(), tokens, 0);
      cost += c;
      t.usage({ input: tokens, cost: c });
      const rows = batch.map((c, j) => ({ ...c, embedding: vecs[j] }));
      const fresh = rows.filter((r) => !haveByKey.has(keyOf(r)));
      const changed = rows.filter((r) => haveByKey.has(keyOf(r)));
      if (fresh.length) must(await db().from("chunks").insert(fresh), "chunks insert");
      // Unique key has nullable page, so update by id instead of upsert.
      await Promise.all(changed.map(async (r) => {
        const id = haveByKey.get(keyOf(r))!.id;
        must(await db().from("chunks").update(r).eq("id", id), "chunks update");
      }));
      await t.event(`${Math.min(i + BATCH, todo.length)}/${todo.length} embedded`);
    }
  });
  void result;
  return { total: want.length, embedded: todo.length, deleted: stale.length, cost };
}
