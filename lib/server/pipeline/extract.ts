import "server-only";
import { createHash } from "node:crypto";
import pLimit from "p-limit";
import { db, must } from "../db";
import { env } from "../env";
import { structured } from "../llm";
import type { RunCtx } from "./ctx";
import { PROMPT_VERSION, SYSTEM_PROMPT, ShardOutput, type ShardOutputT } from "./prompt";
import { verifyFacts, type RawFact, type SourceText, type VerifiedFact } from "./verify";
import { auditFacts, type AuditInput } from "./audit";

// Extractor swarm: slice the matter into shards, one model call per shard (cached by content hash),
// deterministic quote verification, then a Jev audit of the surviving facts.

export interface Shard {
  label: string;
  sources: SourceText[];
  /** Rendered prompt input, also the cache key material. */
  content: string;
}

interface ItemRow {
  id: string; kind: string; title: string | null; body_text: string | null; occurred_at: string | null; raw: unknown;
}

const SHARD_SIZE: Record<string, number> = { note: 10, comms: 15, misc: 25, parties: 30 };
const MAX_SHARD_CHARS = 60_000;
const PAGES_PER_SLICE = 10;

function sha(s: string) { return createHash("sha256").update(s).digest("hex"); }
function esc(s: string) { return s.replace(/"/g, "'").replace(/[\r\n]+/g, " ").slice(0, 200); }

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await q(from, from + 999), what);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** Text the verifier checks quotes against: title line + body, same as what the model sees. */
function itemText(r: ItemRow): string {
  return [r.title?.trim(), r.body_text?.trim()].filter(Boolean).join("\n");
}

function participants(raw: unknown): string | null {
  const r = raw as Record<string, unknown> | null;
  if (!r) return null;
  const name = (x: unknown) => (x && typeof x === "object" && "name" in x ? String((x as { name: unknown }).name) : null);
  const from = name(r.sender) ?? name(r.from) ?? name(r.author);
  const to = name(r.receiver) ?? name(r.to);
  return [from && `from="${esc(from)}"`, to && `to="${esc(to)}"`].filter(Boolean).join(" ") || null;
}

function renderItem(r: ItemRow): string {
  const attrs = [`ref="${r.id}"`, `kind="${r.kind}"`];
  if (r.occurred_at) attrs.push(`date="${r.occurred_at.slice(0, 10)}"`);
  const p = participants(r.raw);
  if (p) attrs.push(p);
  return `<source ${attrs.join(" ")}>\n${itemText(r)}\n</source>`;
}

function chunk<T>(xs: T[], n: number, size: (x: T) => number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const x of xs) {
    const s = size(x);
    if (cur.length && (cur.length >= n || chars + s > MAX_SHARD_CHARS)) { out.push(cur); cur = []; chars = 0; }
    cur.push(x);
    chars += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function buildShards(matterId: number, opts: { includeDocs?: boolean } = {}): Promise<Shard[]> {
  const items = await pageAll<ItemRow>(
    (a, b) => db().from("source_items").select("id,kind,title,body_text,occurred_at,raw")
      .eq("matter_id", matterId).is("deleted_at", null).neq("kind", "document")
      .order("occurred_at", { ascending: true, nullsFirst: true }).order("id").range(a, b),
    "source_items",
  );
  const groups: Record<string, ItemRow[]> = { note: [], comms: [], misc: [], parties: [] };
  for (const r of items) {
    if (!itemText(r)) continue;
    const g = r.kind === "note" ? "note"
      : r.kind === "email" || r.kind === "call" ? "comms"
      : r.kind === "contact" || r.kind === "relationship" ? "parties"
      : "misc";
    groups[g].push(r);
  }
  const shards: Shard[] = [];
  for (const [g, rows] of Object.entries(groups)) {
    const parts = chunk(rows, SHARD_SIZE[g], (r) => itemText(r).length + 120);
    parts.forEach((part, i) => {
      const label = `${g === "comms" ? "emails+calls" : g === "misc" ? "tasks+calendar+fields" : g === "note" ? "notes" : "contacts"} ${i + 1}/${parts.length}`;
      shards.push({
        label,
        sources: part.map((r) => ({ ref: r.id, text: itemText(r), date: r.occurred_at })),
        content: part.map(renderItem).join("\n\n"),
      });
    });
  }

  if (opts.includeDocs !== false) {
    const docs = await pageAll<{ clio_id: number; name: string | null; folder: string | null; version_id: number | null; received_at: string | null }>(
      (a, b) => db().from("documents").select("clio_id,name,folder,version_id,received_at").eq("matter_id", matterId).order("clio_id").range(a, b),
      "documents",
    );
    for (const d of docs) {
      if (d.version_id == null) continue;
      const pages = await pageAll<{ page: number; text: string | null; page_type: string | null }>(
        (a, b) => db().from("doc_pages").select("page,text,page_type").eq("doc_id", d.clio_id).eq("version_id", d.version_id!).order("page").range(a, b),
        "doc_pages",
      );
      const live = pages.filter((p) => p.text && p.text.trim().length > 20);
      for (let i = 0; i < live.length; i += PAGES_PER_SLICE) {
        const slice = live.slice(i, i + PAGES_PER_SLICE);
        const sources = slice.map((p) => ({ ref: `doc:${d.clio_id}#p${p.page}`, text: p.text!.trim(), date: null }));
        const docAttrs = `document="${esc(d.name ?? String(d.clio_id))}"${d.folder ? ` folder="${esc(d.folder)}"` : ""}${d.received_at ? ` received="${d.received_at.slice(0, 10)}"` : ""}`;
        shards.push({
          label: `${(d.name ?? `doc ${d.clio_id}`).slice(0, 40)} p${slice[0].page}-${slice[slice.length - 1].page}`,
          sources,
          content: slice.map((p, j) => `<source ref="${sources[j].ref}" kind="document_page" ${docAttrs} page="${p.page}"${p.page_type ? ` page_type="${p.page_type}"` : ""}>\n${sources[j].text}\n</source>`).join("\n\n"),
        });
      }
    }
  }
  return shards;
}

function cacheKey(content: string, model: string) {
  return `${sha(content)}:${PROMPT_VERSION}:${model}`;
}

async function callWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      const code = (e as { code?: string }).code;
      if (code === "insufficient_quota" || code === "credit_balance_exhausted") throw e;
      if ((status === 429 || (status ?? 0) >= 500) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 500));
        continue;
      }
      throw e;
    }
  }
}

/** Map provider names to Clio contact ids using synced contacts, so provider views can filter facts. */
async function providerIndex(matterId: number): Promise<(name: string | null) => number | null> {
  const rows = must(await db().from("source_items").select("clio_id,title").eq("matter_id", matterId).eq("kind", "contact").is("deleted_at", null), "contacts");
  const list = (rows as { clio_id: number; title: string | null }[])
    .filter((r) => r.title && r.title.trim().length > 3)
    .map((r) => ({ id: r.clio_id, n: r.title!.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() }));
  return (name) => {
    if (!name) return null;
    const n = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!n) return null;
    const hit = list.find((c) => c.n === n) ?? list.find((c) => c.n.includes(n) || n.includes(c.n));
    return hit?.id ?? null;
  };
}

export interface ExtractStats {
  shards: number; cached: number; failed: number; facts_new: number; facts_kept: number;
  verified: number; rejected: number; review: number; cost: number;
}

export async function extractMatter(ctx: RunCtx, opts: { includeDocs?: boolean; concurrency?: number } = {}): Promise<ExtractStats> {
  const model = env.swarmModel();
  const shards = await buildShards(ctx.matterId, opts);
  const providerId = await providerIndex(ctx.matterId);
  const limit = pLimit(opts.concurrency ?? Number(process.env.SWARM_CONCURRENCY ?? 8));
  const stats: ExtractStats = { shards: shards.length, cached: 0, failed: 0, facts_new: 0, facts_kept: 0, verified: 0, rejected: 0, review: 0, cost: 0 };
  const liveKeys = new Set<string>();
  const toAudit: AuditInput[] = [];
  let lastError = "";

  await Promise.all(shards.map((shard) => limit(async () => {
    const key = cacheKey(shard.content, model);
    liveKeys.add(key);
    // One failed shard must not sink the run: its task tile shows failed, the rest carry on.
    try { await ctx.task("extract", shard.label, async (t) => {
      // Facts for this exact shard content already exist: nothing to do, and they keep their audit status.
      const existing = await db().from("facts").select("id", { count: "exact", head: true })
        .eq("matter_id", ctx.matterId).eq("extraction_key", key).is("superseded_at", null);
      if ((existing.count ?? 0) > 0) {
        t.cached();
        t.facts(existing.count ?? 0);
        stats.cached++;
        stats.facts_kept += existing.count ?? 0;
        await t.event(`${existing.count} facts unchanged`);
        return;
      }

      let out: ShardOutputT;
      const hit = await db().from("extraction_cache").select("output").eq("cache_key", key).maybeSingle();
      if (hit.data?.output) {
        out = hit.data.output as ShardOutputT;
        t.cached();
        stats.cached++;
      } else {
        const res = await callWithBackoff(() => structured({
          model,
          system: SYSTEM_PROMPT,
          input: `Case file slice (${shard.sources.length} items):\n\n${shard.content}`,
          schema: ShardOutput,
          schemaName: "shard_facts",
          meta: { purpose: `extract:${shard.label}`, matterId: ctx.matterId, runId: ctx.runId },
          reasoning: "low",
        }));
        out = res.data;
        t.usage({ input: res.usage.input, output: res.usage.output, cost: res.usage.cost });
        stats.cost += res.usage.cost;
        await db().from("extraction_cache").upsert({ cache_key: key, output: out });
      }

      const srcMap = new Map(shard.sources.map((s) => [s.ref, s]));
      const verified = verifyFacts(out.facts as RawFact[], srcMap);
      const rows = verified.map((f) => toRow(ctx.matterId, key, f, providerId(f.provider_name)));

      // Supersede earlier facts from these sources (their content changed, so the shard hash did).
      const refs = shard.sources.map((s) => s.ref);
      for (let i = 0; i < refs.length; i += 200) {
        await db().from("facts").update({ superseded_at: new Date().toISOString() })
          .eq("matter_id", ctx.matterId).in("source_ref", refs.slice(i, i + 200)).neq("extraction_key", key).is("superseded_at", null);
      }
      if (rows.length) {
        const ins = must(await db().from("facts").insert(rows).select("id,source_ref,summary,quote,status"), "facts insert") as
          { id: string; source_ref: string; summary: string; quote: string; status: string }[];
        for (const r of ins) {
          if (r.status === "rejected") continue;
          const src = srcMap.get(r.source_ref);
          if (src) toAudit.push({ id: r.id, source_ref: r.source_ref, claim: r.summary, quote: r.quote, status: r.status as "pending" | "needs_review", sourceText: src.text });
        }
      }
      const rej = verified.filter((f) => f.status === "rejected").length;
      stats.facts_new += rows.length;
      t.facts(rows.length);
      await t.event(`${rows.length} facts, ${rej} rejected`);
    }); } catch (e) {
      stats.failed++;
      lastError = String((e as Error).message ?? e);
    }
  })));
  if (stats.failed === shards.length && shards.length) throw new Error(`all ${shards.length} extract shards failed: ${lastError.slice(0, 200)}`);

  // Anything not produced by a current shard (deleted items, resharding) is stale.
  const active = await pageAll<{ id: string; extraction_key: string }>(
    (a, b) => db().from("facts").select("id,extraction_key").eq("matter_id", ctx.matterId).is("superseded_at", null).range(a, b),
    "facts active",
  );
  const stale = active.filter((f) => !liveKeys.has(f.extraction_key)).map((f) => f.id);
  if (opts.includeDocs !== false) {
    for (let i = 0; i < stale.length; i += 200) {
      await db().from("facts").update({ superseded_at: new Date().toISOString() }).in("id", stale.slice(i, i + 200));
    }
  }

  stats.cost += await auditFacts(ctx, toAudit);

  const final = await pageAll<{ status: string }>(
    (a, b) => db().from("facts").select("status").eq("matter_id", ctx.matterId).is("superseded_at", null).range(a, b),
    "facts final",
  );
  for (const f of final) {
    if (f.status === "verified") stats.verified++;
    else if (f.status === "rejected") stats.rejected++;
    else stats.review++;
  }
  return stats;
}

function toRow(matterId: number, key: string, f: VerifiedFact, providerContactId: number | null) {
  const iso = f.event_date && /^\d{4}-\d{2}-\d{2}$/.test(f.event_date) ? f.event_date : null;
  return {
    matter_id: matterId,
    source_ref: f.source_ref,
    kind: f.kind,
    event_key: f.event_key?.trim().toLowerCase() || null,
    summary: f.summary,
    event_date: iso,
    amount_usd: f.amount_usd,
    quote: (f.quote ?? "").slice(0, 600),
    quote_verified: f.quote_verified,
    quote_score: f.quote_score,
    char_start: f.char_start,
    importance: Math.min(5, Math.max(1, Math.round(f.importance || 3))),
    audience: f.audience,
    provider_contact_id: providerContactId,
    status: f.status,
    reject_reason: f.reject_reason,
    extraction_key: key,
  };
}
