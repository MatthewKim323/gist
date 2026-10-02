// Seed the synthetic demo cases (demo/*.json) into Supabase and digest them with the real pipeline.
//
//   bun run job scripts/seed-demo.ts            seed (idempotent) and run the pipeline on each demo case
//   bun run job scripts/seed-demo.ts --no-run   seed rows only
//   bun run job scripts/seed-demo.ts --reset    delete every demo row (is_demo matters only) and stop
//   bun run job scripts/seed-demo.ts --reset --seed   wipe, then seed and run again
//
// Demo cases never touch Clio: they live only in Supabase (matters.is_demo = true), sync no-ops for them,
// and autopilot skips them. Fixture rows go through the same normalizers as Clio data, so source_items
// look exactly like synced items, then the pipeline runs every stage except sync and OCR.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { db, must } from "@/lib/server/db";
import { runPipeline } from "@/lib/server/pipeline/run";
import { DEMO_ID_MIN } from "@/lib/server/demo";
import {
  type NormItem, type Raw, sourceId, contentHash,
  normNote, normCommunication, normTask, normCalendar, normExpense, normRelationship, normContact, normField, normDocument,
} from "@/lib/server/sync/normalize";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fx = Record<string, any>;

const DAY = 86_400_000;
const today = new Date();
today.setHours(12, 0, 0, 0);

const at = (offset: number) => new Date(today.getTime() + offset * DAY);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const longDay = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
/** Local wall-clock time with the machine's UTC offset, like Clio returns (e.g. 2026-10-02T09:00:00-07:00). */
function isoTime(d: Date, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  const off = -x.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const om = String(Math.abs(off) % 60).padStart(2, "0");
  return `${isoDay(x)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${sign}${oh}:${om}`;
}

/** '@-30' -> ISO day, '@+7T10:00' -> ISO datetime. Prose: '{{-30}}' -> long date, '{{iso:-30}}' -> ISO day. */
function resolve(v: unknown): unknown {
  if (typeof v === "string") {
    const m = /^@([+-]\d+)(?:T(\d{2}:\d{2}))?$/.exec(v);
    if (m) return m[2] ? isoTime(at(Number(m[1])), m[2]) : isoDay(at(Number(m[1])));
    return v
      .replace(/\{\{iso:([+-]?\d+)\}\}/g, (_, n) => isoDay(at(Number(n))))
      .replace(/\{\{([+-]?\d+)\}\}/g, (_, n) => longDay(at(Number(n))));
  }
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
  return v;
}

const matterIdFor = (slot: number) => DEMO_ID_MIN + slot;
/** Every Clio-shaped id inside a demo case: unique per slot, far above real Clio ids. */
const idFor = (slot: number, n: number) => DEMO_ID_MIN + slot * 100_000 + n;
const ts = (day: string) => (day.includes("T") ? day : `${day}T12:00:00Z`);

function loadFixtures(): Fx[] {
  const dir = join(process.cwd(), "demo");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => resolve(JSON.parse(readFileSync(join(dir, f), "utf8"))) as Fx);
}

/** Turn one fixture into the Clio-shaped raw records sync would have fetched, then normalize them the same way. */
function build(fx: Fx) {
  const s = fx.slot as number;
  const id = (n: number) => idFor(s, n);
  const attorney = { id: id(99_000), name: fx.attorney };
  const paralegal = { id: id(99_001), name: "Ines Marlow" };
  const user = (name: string) => (name === paralegal.name ? paralegal : attorney);

  const contacts = new Map<number, Raw>();
  for (const c of fx.contacts) {
    const [street, city, province, postal_code] = String(c.address ?? "").split(",").map((x: string) => x.trim());
    contacts.set(c.id, {
      id: id(c.id), name: c.name, type: c.type, first_name: null, last_name: null, title: c.title ?? null,
      date_of_birth: c.dob ?? null, is_client: c.id === fx.client_id, updated_at: ts(fx.open_date),
      company: null,
      email_addresses: c.email ? [{ address: c.email, name: "Work", primary: true }] : [],
      phone_numbers: c.phone ? [{ number: c.phone, name: "Mobile", primary: true }] : [],
      addresses: c.address ? [{ street, city, province, postal_code, country: "US", name: "Work" }] : [],
    });
  }
  const byName = new Map([...contacts.values()].map((c) => [c.name as string, c]));
  const party = (name: string) => {
    const c = byName.get(name);
    if (c) return { id: c.id, name, type: "Contact" };
    const u = user(name);
    return { id: u.id, name: u.name, type: "User" };
  };
  const client = contacts.get(fx.client_id)!;

  const items: NormItem[] = [];
  for (const n of fx.notes ?? []) {
    items.push(normNote({ id: id(n.id), subject: n.subject, detail: n.detail, date: n.date, created_at: ts(n.date), updated_at: ts(n.date), author: user(n.author ?? fx.attorney) }));
  }
  const comm = (c: Fx, type: string) => normCommunication({
    id: id(c.id + (type === "PhoneCommunication" ? 50_000 : 0)), subject: c.subject, body: c.body, type, date: c.date, received_at: ts(c.date),
    created_at: ts(c.date), updated_at: ts(c.date), senders: [party(c.from)], receivers: [party(c.to)], user: attorney,
  });
  for (const e of fx.emails ?? []) items.push(comm(e, "EmailCommunication"));
  for (const c of fx.calls ?? []) items.push(comm(c, "PhoneCommunication"));
  for (const t of fx.tasks ?? []) {
    items.push(normTask({
      id: id(t.id), name: t.name, description: t.description, status: t.status, priority: t.priority ?? "Normal",
      due_at: t.due, completed_at: t.completed ? ts(t.completed) : null, statute_of_limitations: false,
      created_at: ts(fx.open_date), updated_at: ts(t.completed ?? fx.open_date), assignee: attorney, assigner: attorney, task_type: null,
    }));
  }
  for (const e of fx.calendar ?? []) {
    items.push(normCalendar({
      id: id(e.id), summary: e.summary, description: e.description ?? "", location: e.location ?? null,
      start_at: e.start, end_at: e.end ?? null, all_day: false, created_at: ts(fx.open_date), updated_at: ts(fx.open_date),
      matter: { id: matterIdFor(s) }, attendees: [], calendar_entry_event_type: null,
    }));
  }
  for (const x of fx.expenses ?? []) {
    items.push(normExpense({
      id: id(x.id), type: "ExpenseEntry", date: x.date, quantity: 1, price: x.total, total: x.total, note: x.note, billed: false,
      created_at: ts(x.date), updated_at: ts(x.date), expense_category: x.category ? { id: id(98_000), name: x.category } : null,
      vendor: null, user: paralegal, matter: { id: matterIdFor(s) },
    }));
  }
  for (const f of fx.fields ?? []) {
    const it = normField({ id: id(f.id), field_name: f.name, field_type: f.type, value: f.value, updated_at: ts(fx.open_date), custom_field: { id: id(f.id) } });
    if (it) items.push(it);
  }
  // relationships (every non-client contact) + contact rows, with the role text the people signals read
  const roles = new Map<number, string[]>([[fx.client_id, ["Client"]]]);
  for (const c of fx.contacts) {
    if (c.id === fx.client_id) continue;
    roles.set(c.id, [c.role]);
    items.push(normRelationship({ id: id(c.id + 1_000), description: c.role, created_at: ts(fx.open_date), updated_at: ts(fx.open_date), contact: { id: id(c.id), name: c.name, type: c.type } }, contacts.get(c.id)));
  }
  for (const c of fx.contacts) items.push(normContact(contacts.get(c.id)!, roles.get(c.id) ?? []));

  const docs: { raw: Raw; pages: { text: string; page_type: string }[] }[] = (fx.documents ?? []).map((d: Fx) => {
    const raw = {
      id: id(d.id + 5_000), name: d.name, filename: d.filename, size: null, content_type: "application/pdf",
      received_at: ts(d.received), created_at: ts(d.received), updated_at: ts(d.received), parent: { id: id(97_000), name: d.folder },
      document_category: null,
      latest_document_version: { id: id(d.id + 6_000), filename: d.filename, content_type: "application/pdf", version_number: 1, received_at: ts(d.received), fully_uploaded: true },
    };
    items.push(normDocument(raw));
    return { raw, pages: d.pages as { text: string; page_type: string }[] };
  });

  const incident = (fx.fields ?? []).find((f: Fx) => f.name === "Date of Incident")?.value as string | undefined;
  const sol = incident ? isoDay(new Date(new Date(`${incident}T12:00:00`).setFullYear(new Date(`${incident}T12:00:00`).getFullYear() + 3))) : null;
  const matterRaw = {
    id: matterIdFor(s), display_number: fx.display_number, description: fx.description, status: fx.status, open_date: fx.open_date,
    matter_stage_updated_at: ts(fx.stage_since), practice_area: { id: 1, name: fx.practice_area }, matter_stage: { name: fx.stage },
    client: { id: client.id, name: client.name, type: "Person" }, responsible_attorney: attorney,
    statute_of_limitations: sol ? { due_at: sol, status: "pending" } : null, demo: true,
  };
  const matter = {
    id: matterIdFor(s), display_number: fx.display_number, description: fx.description, status: fx.status, stage: fx.stage,
    stage_updated_at: ts(fx.stage_since), practice_area: fx.practice_area, client_contact_id: client.id, client_name: client.name,
    open_date: fx.open_date, sol_date: sol, raw: matterRaw, synced_at: new Date().toISOString(), is_demo: true,
  };
  return { matter, items, docs };
}

async function seedOne(fx: Fx) {
  const { matter, items, docs } = build(fx);
  const mid = matter.id;
  must(await db().from("matters").upsert(matter), "demo matter upsert");

  const live = new Set(items.map((i) => sourceId(i.kind, i.clio_id)));
  const prev = must(await db().from("source_items").select("id,content_hash").eq("matter_id", mid), "demo items read") as { id: string; content_hash: string }[];
  const prevHash = new Map(prev.map((r) => [r.id, r.content_hash]));
  const now = new Date().toISOString();
  const rows = items.map((it) => {
    const sid = sourceId(it.kind, it.clio_id);
    const hash = contentHash(it.title, it.body_text);
    const row: Record<string, unknown> = {
      id: sid, matter_id: mid, kind: it.kind, clio_id: it.clio_id, title: it.title, body_text: it.body_text,
      occurred_at: it.occurred_at, updated_at_clio: it.updated_at_clio, raw: it.raw, content_hash: hash, deleted_at: null,
      clio_url: null, // demo items have no Clio record to open
      content_changed_at: prevHash.get(sid) === hash ? undefined : now,
    };
    if (row.content_changed_at === undefined) delete row.content_changed_at;
    return row;
  });
  const withTs = rows.filter((r) => "content_changed_at" in r);
  const without = rows.filter((r) => !("content_changed_at" in r));
  for (const b of [withTs, without]) if (b.length) must(await db().from("source_items").upsert(b), "demo items upsert");
  const gone = prev.map((r) => r.id).filter((x) => !live.has(x));
  if (gone.length) must(await db().from("source_items").update({ deleted_at: now }).in("id", gone), "demo items tombstone");

  for (const d of docs) {
    const v = d.raw.latest_document_version;
    must(await db().from("documents").upsert({
      clio_id: d.raw.id, matter_id: mid, name: d.raw.name, filename: d.raw.filename, folder: d.raw.parent.name,
      content_type: "text/plain", size: d.pages.reduce((n, p) => n + p.text.length, 0), version_id: v.id, received_at: d.raw.received_at,
      storage_path: null, page_count: d.pages.length, text_layer_pages: d.pages.length, ocr_status: "done", updated_at: now,
    }), "demo document upsert");
    must(await db().from("doc_pages").upsert(d.pages.map((p, i) => ({
      doc_id: d.raw.id, version_id: v.id, page: i + 1, text: p.text, source: "text_layer", ocr_model: null,
      page_type: p.page_type, has_diagnosis: /diagnos|impression/i.test(p.text), confidence: 1,
    }))), "demo doc_pages upsert");
  }
  console.log(`[seed-demo] ${matter.display_number} (${mid}): ${items.length} items, ${docs.length} documents`);
  return mid;
}

/** Delete every row that belongs to a demo matter. Only touches matters with is_demo = true. */
async function reset() {
  const ids = (must(await db().from("matters").select("id").eq("is_demo", true), "demo ids") as { id: number }[]).map((r) => Number(r.id));
  if (!ids.length) { console.log("[seed-demo] no demo matters to remove"); return; }
  const docIds = (must(await db().from("documents").select("clio_id").in("matter_id", ids), "demo docs") as { clio_id: number }[]).map((r) => Number(r.clio_id));
  if (docIds.length) must(await db().from("doc_pages").delete().in("doc_id", docIds), "doc_pages delete");
  for (const t of ["facts", "chunks", "gate_items", "contradictions", "digests", "agent_actions", "agent_runs", "llm_calls",
    "source_items", "documents", "sync_state", "matter_views", "autopilot_events", "provider_submissions", "shares"]) {
    const r = await db().from(t).delete().in("matter_id", ids);
    if (r.error) console.warn(`[seed-demo] ${t}: ${r.error.message}`);
  }
  must(await db().from("matters").delete().in("id", ids).eq("is_demo", true), "demo matters delete");
  console.log(`[seed-demo] removed ${ids.length} demo matters: ${ids.join(", ")}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--reset")) {
    await reset();
    if (!args.includes("--seed")) return;
  }
  const fixtures = loadFixtures();
  const only = args.find((a) => /^\d+$/.test(a));
  const ids: number[] = [];
  for (const fx of fixtures) {
    if (only && String(fx.slot) !== only && String(matterIdFor(fx.slot)) !== only) continue;
    ids.push(await seedOne(fx));
  }
  if (args.includes("--no-run")) return;
  // A seed that was killed mid-run leaves its run 'running'; close it so the UI does not wait on it.
  if (ids.length) {
    await db().from("agent_runs").update({ status: "failed", finished_at: new Date().toISOString() })
      .in("matter_id", ids).eq("status", "running");
  }
  for (const id of ids) {
    const t0 = Date.now();
    const res = await runPipeline(id, { skip: ["sync", "ocr"] });
    console.log(`[seed-demo] pipeline ${id}: ${JSON.stringify(res.stats)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
