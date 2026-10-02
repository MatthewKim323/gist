import "server-only";
import pLimit from "p-limit";
import { db, must } from "../db";
import { env } from "../env";
import { isDemoMatter } from "../demo";
import { list, get, downloadDocument, type Params } from "../clio/client";
import type { RunCtx, TaskHandle } from "../pipeline/ctx";
import type { SourceKind } from "@/lib/types";
import {
  type NormItem, type Raw, sourceId, contentHash,
  normNote, normCommunication, normTask, normCalendar, normExpense,
  normRelationship, normContact, normField, normDocument,
} from "./normalize";

/**
 * Clio -> Supabase sync. Read-only against Clio.
 *
 * Change detection: every source_items row carries sha256(title + body_text). content_changed_at only moves
 * when that hash moves, so downstream stages (extraction cache, digest) can skip unchanged items.
 * Cursored resources (notes, comms, tasks, calendar, expenses, documents) fetch with updated_since after the
 * first run, then do a cheap id-only scan to tombstone deletions. Small resources (relationships, contacts,
 * custom fields, stages) are re-read in full each run; the hash check keeps them from counting as changed.
 */

const MATTER_FIELDS = [
  "id", "display_number", "description", "status", "open_date", "close_date", "pending_date", "created_at", "updated_at",
  "matter_stage_updated_at", "last_activity_date", "location", "client_reference",
  "practice_area{id,name}", "matter_stage{id,name,order}", "client{id,name,type}",
  "responsible_attorney{id,name,email}", "originating_attorney{id,name}", "responsible_staff{id,name}",
  "statute_of_limitations{id,name,due_at,status}",
  "custom_field_values{id,field_name,field_type,value,updated_at,custom_field,picklist_option}",
].join(",");

const DISCOVER_FIELDS = "id,display_number,description,status,open_date,matter_stage_updated_at,practice_area{id,name},matter_stage{id,name},client{id,name},statute_of_limitations{due_at}";

const CONTACT_FIELDS = [
  "id", "name", "type", "first_name", "last_name", "title", "date_of_birth", "is_client", "updated_at",
  "primary_email_address", "primary_phone_number", "company{id,name}",
  "email_addresses{address,name,primary}", "phone_numbers{number,name,primary}",
  "addresses{street,city,province,postal_code,country,name}",
].join(",");

interface CursorSpec {
  resource: string;
  path: string;
  params: (matterId: number) => Params;
  fields: string;
  kinds: SourceKind[];
  normalize: (r: Raw) => NormItem;
}

const CURSORED: CursorSpec[] = [
  {
    resource: "notes", kinds: ["note"], path: "notes.json", normalize: normNote,
    params: (m) => ({ matter_id: m, type: "Matter" }),
    fields: "id,subject,detail,date,created_at,updated_at,author{id,name},contact{id,name}",
  },
  {
    resource: "communications", kinds: ["email", "call"], path: "communications.json", normalize: normCommunication,
    params: (m) => ({ matter_id: m }),
    fields: "id,subject,body,type,date,received_at,created_at,updated_at,senders{id,name,type,identifier},receivers{id,name,type,identifier},user{id,name}",
  },
  {
    resource: "tasks", kinds: ["task"], path: "tasks.json", normalize: normTask,
    params: (m) => ({ matter_id: m }),
    fields: "id,name,description,status,priority,due_at,completed_at,statute_of_limitations,created_at,updated_at,assignee{id,name,type},assigner{id,name},task_type{id,name}",
  },
  {
    resource: "calendar_entries", kinds: ["calendar"], path: "calendar_entries.json", normalize: normCalendar,
    params: (m) => ({ matter_id: m }),
    fields: "id,summary,description,location,start_at,start_date,end_at,end_date,all_day,created_at,updated_at,matter{id},attendees{id,name,type},calendar_entry_event_type{id,name}",
  },
  {
    resource: "expenses", kinds: ["expense"], path: "activities.json", normalize: normExpense,
    params: (m) => ({ matter_id: m, type: "ExpenseEntry" }),
    fields: "id,type,date,quantity,price,total,note,billed,created_at,updated_at,expense_category{id,name},vendor{id,name},user{id,name},matter{id}",
  },
  {
    resource: "documents", kinds: ["document"], path: "documents.json", normalize: normDocument,
    params: (m) => ({ matter_id: m }),
    fields: "id,name,filename,size,content_type,received_at,created_at,updated_at,parent{id,name},document_category{id,name},latest_document_version{id,size,filename,content_type,version_number,received_at,fully_uploaded}",
  },
];

const clioMatterUrl = (id: number) => `${env.clioBase()}/nc/#/matters/${id}`;

// ---------------- source_items upsert ----------------

/** Upsert normalized items. Returns how many were new or changed. Unchanged rows are left alone. */
async function upsertItems(matterId: number, items: NormItem[]): Promise<number> {
  if (!items.length) return 0;
  const ids = items.map((i) => sourceId(i.kind, i.clio_id));
  const existing = new Map<string, { content_hash: string; deleted_at: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const rows = must(await db().from("source_items").select("id, content_hash, deleted_at").in("id", ids.slice(i, i + 200)), "source_items read");
    for (const r of rows as { id: string; content_hash: string; deleted_at: string | null }[]) existing.set(r.id, r);
  }
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let changed = 0;
  for (const it of items) {
    const id = sourceId(it.kind, it.clio_id);
    const hash = contentHash(it.title, it.body_text);
    const prev = existing.get(id);
    const isChanged = !prev || prev.content_hash !== hash;
    if (!isChanged && !prev?.deleted_at) continue;
    if (isChanged) changed++;
    const row: Record<string, unknown> = {
      id, matter_id: matterId, kind: it.kind, clio_id: it.clio_id, title: it.title, body_text: it.body_text,
      occurred_at: it.occurred_at, updated_at_clio: it.updated_at_clio, raw: it.raw, content_hash: hash,
      deleted_at: null, clio_url: it.kind === "contact" ? `${env.clioBase()}/nc/#/contacts/${it.clio_id}` : clioMatterUrl(matterId),
    };
    if (isChanged) row.content_changed_at = now;
    rows.push(row);
  }
  // Rows differ in shape (content_changed_at only when changed), so write in two homogeneous batches.
  const withTs = rows.filter((r) => "content_changed_at" in r);
  const without = rows.filter((r) => !("content_changed_at" in r));
  for (const batch of [withTs, without]) {
    for (let i = 0; i < batch.length; i += 100) {
      must(await db().from("source_items").upsert(batch.slice(i, i + 100)), "source_items upsert");
    }
  }
  return changed;
}

/** Mark rows of these kinds whose clio ids are no longer present as deleted. Returns count tombstoned. */
async function tombstone(matterId: number, kinds: SourceKind[], liveIds: Set<string>): Promise<number> {
  const rows = must(
    await db().from("source_items").select("id").eq("matter_id", matterId).in("kind", kinds).is("deleted_at", null),
    "source_items live read",
  ) as { id: string }[];
  const gone = rows.map((r) => r.id).filter((id) => !liveIds.has(id));
  if (gone.length) {
    must(await db().from("source_items").update({ deleted_at: new Date().toISOString() }).in("id", gone), "tombstone");
  }
  return gone.length;
}

// ---------------- sync_state ----------------

async function getCursor(matterId: number, resource: string): Promise<string | null> {
  const { data } = await db().from("sync_state").select("cursor_updated_at").eq("matter_id", matterId).eq("resource", resource).maybeSingle();
  return (data?.cursor_updated_at as string | null) ?? null;
}

async function setState(matterId: number, resource: string, cursor: string | null, count: number) {
  must(await db().from("sync_state").upsert({
    matter_id: matterId, resource, cursor_updated_at: cursor, last_full_scan_at: new Date().toISOString(), item_count: count,
  }), "sync_state upsert");
}

const maxTs = (a: string | null, b: string | null | undefined) => (!b ? a : !a || new Date(b) > new Date(a) ? b : a);

// ---------------- matters ----------------

function matterRow(m: Raw, withRaw: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: m.id, display_number: m.display_number ?? null, description: m.description ?? null, status: m.status ?? null,
    stage: m.matter_stage?.name ?? null, stage_updated_at: m.matter_stage_updated_at ?? null,
    practice_area: m.practice_area?.name ?? null, client_contact_id: m.client?.id ?? null, client_name: m.client?.name ?? null,
    open_date: m.open_date ?? null, sol_date: m.statute_of_limitations?.due_at?.slice(0, 10) ?? null,
  };
  if (withRaw) { row.raw = m; row.synced_at = new Date().toISOString(); }
  return row;
}

/** List every matter in Clio and upsert the matters table. The app picks matters from here. */
export async function discoverMatters(): Promise<{ id: number; display_number: string | null; description: string | null; status: string | null; practice_area: string | null; stage: string | null; client_name: string | null }[]> {
  const ms = await list<Raw>("matters.json", { fields: DISCOVER_FIELDS, order: "id(asc)" });
  const rows = ms.map((m) => matterRow(m, false));
  if (rows.length) must(await db().from("matters").upsert(rows), "matters upsert");
  return rows.map((r) => ({
    id: r.id as number, display_number: r.display_number as string | null, description: r.description as string | null,
    status: r.status as string | null, practice_area: r.practice_area as string | null, stage: r.stage as string | null,
    client_name: r.client_name as string | null,
  }));
}

// ---------------- per-resource syncs ----------------

async function syncCursored(matterId: number, spec: CursorSpec, t: TaskHandle, full: boolean): Promise<{ items: Raw[]; changed: number }> {
  const cursor = full ? null : await getCursor(matterId, spec.resource);
  const base = spec.params(matterId);
  const raws = await list<Raw>(spec.path, { ...base, fields: spec.fields, order: "id(asc)", ...(cursor ? { updated_since: cursor } : {}) });
  const items = raws.map(spec.normalize);
  const changed = await upsertItems(matterId, items);

  // Live id set: from the full fetch, or a cheap id-only scan on incremental runs.
  let live: Set<string>;
  let liveCount: number;
  if (cursor) {
    const scanFields = spec.resource === "communications" ? "id,type" : "id";
    const ids = await list<Raw>(spec.path, { ...base, fields: scanFields, order: "id(asc)" });
    live = new Set(ids.map((r) => { const p = spec.normalize(r); return sourceId(p.kind, p.clio_id); }));
    liveCount = ids.length;
  } else {
    live = new Set(items.map((i) => sourceId(i.kind, i.clio_id)));
    liveCount = items.length;
  }
  const deleted = await tombstone(matterId, spec.kinds, live);

  let newCursor = cursor;
  for (const r of raws) newCursor = maxTs(newCursor, r.updated_at);
  await setState(matterId, spec.resource, newCursor, liveCount);
  await t.event(`${liveCount} entries, ${changed} changed${deleted ? `, ${deleted} deleted` : ""}${cursor ? " (incremental)" : ""}`);
  return { items: raws, changed };
}

async function syncMatterRow(matterId: number): Promise<Raw> {
  const res = await get<{ data: Raw }>(`matters/${matterId}.json`, { fields: MATTER_FIELDS });
  const m = res.data;
  must(await db().from("matters").upsert(matterRow(m, true)), "matter upsert");
  return m;
}

async function syncStages(): Promise<number> {
  const [stages, areas] = await Promise.all([
    list<Raw>("matter_stages.json", { fields: "id,name,order,practice_area_id" }),
    list<Raw>("practice_areas.json", { fields: "id,name" }),
  ]);
  const areaName = new Map(areas.map((a) => [a.id, a.name as string]));
  const rows = stages.map((s) => ({ id: s.id, name: s.name, ord: s.order ?? null, practice_area: areaName.get(s.practice_area_id) ?? null }));
  if (rows.length) must(await db().from("matter_stages").upsert(rows), "matter_stages upsert");
  return rows.length;
}

async function syncFields(matterId: number, matter: Raw, t: TaskHandle): Promise<number> {
  const items = ((matter.custom_field_values ?? []) as Raw[]).map(normField).filter((x): x is NormItem => !!x);
  const changed = await upsertItems(matterId, items);
  const deleted = await tombstone(matterId, ["field"], new Set(items.map((i) => sourceId(i.kind, i.clio_id))));
  await setState(matterId, "custom_fields", null, items.length);
  await t.event(`${items.length} entries, ${changed} changed${deleted ? `, ${deleted} deleted` : ""}`);
  return changed;
}

async function fetchContacts(ids: number[]): Promise<Map<number, Raw>> {
  const out = new Map<number, Raw>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const rows = await list<Raw>("contacts.json", { ids: chunk, fields: CONTACT_FIELDS });
    for (const c of rows) out.set(Number(c.id), c);
  }
  return out;
}

async function syncPeople(matterId: number, matter: Raw, t: TaskHandle): Promise<number> {
  const rels = await list<Raw>("relationships.json", {
    matter_id: matterId, order: "id(asc)",
    fields: "id,description,created_at,updated_at,contact{id,name,type}",
  });
  const clientId = matter.client?.id ? Number(matter.client.id) : null;
  const contactIds = [...new Set([...(clientId ? [clientId] : []), ...rels.map((r) => Number(r.contact?.id)).filter(Boolean)])];
  const contacts = await fetchContacts(contactIds);

  const roles = new Map<number, string[]>();
  if (clientId) roles.set(clientId, ["Client"]);
  for (const r of rels) {
    const cid = Number(r.contact?.id);
    if (!cid) continue;
    roles.set(cid, [...(roles.get(cid) ?? []), r.description || "Related contact"]);
  }
  const relItems = rels.map((r) => normRelationship(r, contacts.get(Number(r.contact?.id))));
  const contactItems = contactIds.map((id) => contacts.get(id)).filter((c): c is Raw => !!c).map((c) => normContact(c, roles.get(Number(c.id)) ?? []));

  const changed = (await upsertItems(matterId, relItems)) + (await upsertItems(matterId, contactItems));
  const live = new Set([...relItems, ...contactItems].map((i) => sourceId(i.kind, i.clio_id)));
  const deleted = await tombstone(matterId, ["relationship", "contact"], live);
  await setState(matterId, "relationships", null, rels.length);
  await setState(matterId, "contacts", null, contactItems.length);
  await t.event(`${rels.length + contactItems.length} entries (${rels.length} relationships, ${contactItems.length} contacts), ${changed} changed${deleted ? `, ${deleted} deleted` : ""}`);
  return changed;
}

// ---------------- documents + storage ----------------

const BUCKET = "docs";

function storagePathFor(matterId: number, docId: number, versionId: number, filename: string | null, contentType: string | null) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(filename ?? "")?.[1]?.toLowerCase() ?? (contentType === "application/pdf" ? "pdf" : "bin");
  return `${matterId}/${docId}-${versionId}.${ext}`;
}

/** Upsert documents rows for fetched docs. A new version resets storage + OCR state. */
async function upsertDocuments(matterId: number, docs: Raw[]) {
  if (!docs.length) return;
  const ids = docs.map((d) => Number(d.id));
  const prev = new Map(
    (must(await db().from("documents").select("clio_id, version_id").in("clio_id", ids), "documents read") as { clio_id: number; version_id: number | null }[])
      .map((r) => [Number(r.clio_id), r.version_id === null ? null : Number(r.version_id)]),
  );
  const rows = docs.map((d) => {
    const v = d.latest_document_version ?? {};
    const versionId = v.id ? Number(v.id) : null;
    const row: Record<string, unknown> = {
      clio_id: Number(d.id), matter_id: matterId, name: d.name ?? null, filename: d.filename ?? v.filename ?? null,
      folder: d.parent?.name ?? null, content_type: d.content_type ?? v.content_type ?? null, size: d.size ?? v.size ?? null,
      version_id: versionId, received_at: d.received_at ?? v.received_at ?? null, updated_at: new Date().toISOString(),
    };
    if (!prev.has(Number(d.id)) || prev.get(Number(d.id)) !== versionId) {
      row.storage_path = null;
      row.ocr_status = "pending";
    }
    return row;
  });
  // Split by shape so PostgREST upsert keeps column sets consistent.
  const reset = rows.filter((r) => "storage_path" in r);
  const keep = rows.filter((r) => !("storage_path" in r));
  for (const batch of [reset, keep]) if (batch.length) must(await db().from("documents").upsert(batch), "documents upsert");
}

/** Download every document of the matter that has no stored copy of its latest version. */
async function downloadMissing(matterId: number, t: TaskHandle): Promise<{ downloaded: number; bytes: number; failed: number }> {
  const pending = must(
    await db().from("documents").select("clio_id, version_id, filename, content_type").eq("matter_id", matterId).is("storage_path", null),
    "documents pending",
  ) as { clio_id: number; version_id: number | null; filename: string | null; content_type: string | null }[];
  const limit = pLimit(3);
  let downloaded = 0, bytes = 0, failed = 0;
  await Promise.all(pending.map((d) => limit(async () => {
    if (!d.version_id) return;
    try {
      const file = await downloadDocument(d.clio_id, d.version_id);
      const contentType = d.content_type ?? file.contentType ?? "application/octet-stream";
      const path = storagePathFor(matterId, Number(d.clio_id), Number(d.version_id), d.filename, contentType);
      const up = await db().storage.from(BUCKET).upload(path, file.bytes, { contentType, upsert: true });
      if (up.error) throw new Error(up.error.message);
      must(await db().from("documents").update({ storage_path: path, size: file.bytes.length, content_type: contentType }).eq("clio_id", d.clio_id), "documents storage update");
      downloaded++;
      bytes += file.bytes.length;
      await t.event(`downloaded ${downloaded}/${pending.length} (${(bytes / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      failed++;
      console.error(`[sync] download ${d.clio_id} failed: ${(e as Error).message}`);
    }
  })));
  return { downloaded, bytes, failed };
}

// ---------------- entry point ----------------

export interface SyncStats {
  matterId: number;
  changed: Record<string, number>;
  downloaded: number;
  failedDownloads: number;
}

/** Sync one matter from Clio into Supabase. Pass full=true to ignore cursors and re-read everything. */
export async function syncMatter(ctx: RunCtx, opts: { full?: boolean } = {}): Promise<SyncStats> {
  const matterId = ctx.matterId;
  const full = !!opts.full;
  const changed: Record<string, number> = {};

  // Demo cases live only in Supabase. Never ask Clio about them.
  if (await isDemoMatter(matterId)) {
    await ctx.task("sync", "matter", async (t) => { t.cached(); await t.event("demo case: Supabase only, no Clio sync"); });
    return { matterId, changed, downloaded: 0, failedDownloads: 0 };
  }

  const matter = await ctx.task("sync", "matter", async (t) => {
    const [m, stages] = await Promise.all([syncMatterRow(matterId), syncStages()]);
    await t.event(`${m.display_number ?? m.id}, stage ${m.matter_stage?.name ?? "unknown"}, ${stages} stages`);
    return m;
  });

  await Promise.all([
    ctx.task("sync", "custom_fields", async (t) => { changed.custom_fields = await syncFields(matterId, matter, t); }),
    ctx.task("sync", "relationships", async (t) => { changed.relationships = await syncPeople(matterId, matter, t); }),
    ...CURSORED.map((spec) =>
      ctx.task("sync", spec.resource, async (t) => {
        const out = await syncCursored(matterId, spec, t, full);
        changed[spec.resource] = out.changed;
        if (spec.resource === "documents") await upsertDocuments(matterId, out.items);
      }),
    ),
  ]);

  const dl = await ctx.task("sync", "documents:download", async (t) => {
    const r = await downloadMissing(matterId, t);
    if (!r.downloaded && !r.failed) { t.cached(); await t.event("all document versions already stored"); }
    else await t.event(`${r.downloaded} downloaded (${(r.bytes / 1e6).toFixed(1)} MB)${r.failed ? `, ${r.failed} failed` : ""}`);
    return r;
  });

  return { matterId, changed, downloaded: dl.downloaded, failedDownloads: dl.failed };
}
