import "server-only";
import { db, must } from "../db";
import { discoverMatters, syncMatter, type SyncStats } from "../sync/index";
import { runPipeline, createRun } from "../pipeline/run";
import type { RunCtx, TaskHandle } from "../pipeline/ctx";
import { assemble } from "../digest/index";
import type { Digest } from "@/lib/types";

/**
 * Autopilot tick. Read-only against Clio (sync is GET only).
 *
 * For every open matter the firm has already digested:
 *   1. snapshot what the lawyer last saw (stage, gate statuses, red flags, overdue actions)
 *   2. sync from Clio with a quiet in-memory ctx (no agent_runs row, so the dashboard's "latest run" stays real)
 *   3. nothing changed: refresh one no_change row. Changed: run the pipeline minus sync (cached stages cost $0),
 *      snapshot again and diff into autopilot_events. Stage moves also notify every active provider share.
 * A row lock on autopilot_state.ticking_since keeps concurrent ticks (cron + open tab) from doubling up.
 */

export type EventKind =
  | "stage_changed" | "new_items" | "gate_flipped" | "newly_overdue" | "new_red_flag" | "digest_refreshed" | "no_change" | "error";

export interface AutopilotEvent {
  id?: number;
  matter_id: number | null;
  kind: EventKind;
  title: string;
  detail: Record<string, unknown>;
  created_at?: string;
  run_id?: string | null;
}

export interface AutopilotState {
  id: number;
  enabled: boolean;
  interval_min: number;
  last_tick_at: string | null;
  next_tick_at: string | null;
  ticking_since: string | null;
  last_summary: Record<string, unknown> | null;
}

export type Simulate = "stage" | "all" | null;

interface Snapshot {
  stage: string | null;
  digestVersion: number | null;
  gates: Map<string, { label: string; status: string }>;
  flags: Set<string>;
  overdue: Map<string, { label: string; days: number | null }>;
}

const LOCK_STALE_MS = 10 * 60_000;

export async function getState(): Promise<AutopilotState> {
  const { data } = await db().from("autopilot_state").select("*").eq("id", 1).maybeSingle();
  if (data) return data as AutopilotState;
  must(await db().from("autopilot_state").upsert({ id: 1 }), "autopilot_state init");
  return { id: 1, enabled: true, interval_min: 15, last_tick_at: null, next_tick_at: null, ticking_since: null, last_summary: {} };
}

/** Sync without writing agent_tasks: the tick is a background check, not a run the lawyer asked to watch. */
function quietCtx(matterId: number): RunCtx {
  const handle: TaskHandle = { id: 0, cached() {}, usage() {}, facts() {}, async event() {} };
  return { runId: "autopilot", matterId, task: (_role, _label, fn) => fn(handle) };
}

function snapshotFrom(stage: string | null, version: number | null, d: Digest | null): Snapshot {
  const gates = new Map<string, { label: string; status: string }>();
  const flags = new Set<string>();
  const overdue = new Map<string, { label: string; days: number | null }>();
  for (const g of d?.phase?.gates ?? []) gates.set(g.requirement_key, { label: g.label, status: g.status });
  for (const f of d?.red_flags ?? []) flags.add(f.title);
  for (const a of d?.actions ?? []) if (a.bucket === "overdue") overdue.set(a.id, { label: a.label, days: a.days });
  return { stage, digestVersion: version, gates, flags, overdue };
}

async function latestDigest(matterId: number): Promise<{ version: number; json: Digest } | null> {
  const { data } = await db().from("digests").select("version,json").eq("matter_id", matterId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  return (data as { version: number; json: Digest } | null) ?? null;
}

const ITEM_LABELS: Record<string, [string, string]> = {
  communications: ["email or call", "emails and calls"],
  notes: ["note", "notes"],
  documents: ["document", "documents"],
  tasks: ["task", "tasks"],
  calendar_entries: ["calendar entry", "calendar entries"],
  expenses: ["expense", "expenses"],
  custom_fields: ["case field", "case fields"],
  relationships: ["contact", "contacts"],
};

function itemsPhrase(changed: Record<string, number>): string {
  return Object.entries(changed)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => { const l = ITEM_LABELS[k] ?? [k, k]; return `${n} new or updated ${n === 1 ? l[0] : l[1]}`; })
    .join(", ");
}

function isQuota(msg: string): boolean {
  return /quota|429|insufficient|rate limit|billing|api key|OPENAI_API_KEY/i.test(msg);
}

function diff(name: string, before: Snapshot, after: Snapshot): AutopilotEvent[] {
  const out: AutopilotEvent[] = [];
  const flips: { key: string; label: string; from: string; to: string }[] = [];
  for (const [key, a] of after.gates) {
    const b = before.gates.get(key);
    if (b && b.status !== a.status) flips.push({ key, label: a.label, from: b.status, to: a.status });
  }
  if (flips.length) {
    out.push({
      matter_id: null, kind: "gate_flipped",
      title: `${name}: ${flips.slice(0, 2).map((f) => `${f.label} ${f.from} → ${f.to}`).join("; ")}${flips.length > 2 ? ` (+${flips.length - 2} more)` : ""}`,
      detail: { flips },
    });
  }
  const overdue = [...after.overdue].filter(([id]) => !before.overdue.has(id)).map(([id, a]) => ({ id, ...a }));
  if (overdue.length) {
    out.push({
      matter_id: null, kind: "newly_overdue",
      title: `${name}: ${overdue.slice(0, 2).map((o) => `${o.label} now overdue${o.days != null ? ` ${o.days}d` : ""}`).join("; ")}${overdue.length > 2 ? ` (+${overdue.length - 2} more)` : ""}`,
      detail: { items: overdue },
    });
  }
  const flags = [...after.flags].filter((t) => !before.flags.has(t));
  if (flags.length) {
    out.push({
      matter_id: null, kind: "new_red_flag",
      title: `${name}: new red flag${flags.length === 1 ? "" : "s"}: ${flags.slice(0, 2).join("; ")}${flags.length > 2 ? ` (+${flags.length - 2} more)` : ""}`,
      detail: { titles: flags },
    });
  }
  return out;
}

/** Plain-English notice for every active share on the matter. Returns notified share ids. */
async function notifyShares(matterId: number, to: string, simulated: boolean): Promise<{ shareIds: string[]; notificationIds: number[] }> {
  const { data } = await db().from("shares").select("id,config,expires_at").eq("matter_id", matterId).is("revoked_at", null);
  const now = Date.now();
  const live = ((data ?? []) as { id: string; config: Record<string, unknown> | null; expires_at: string | null }[])
    .filter((s) => !s.expires_at || Date.parse(s.expires_at) > now);
  if (!live.length) return { shareIds: [], notificationIds: [] };
  const ins = await db().from("share_notifications")
    .insert(live.map((s) => ({ share_id: s.id, kind: "stage_change", message: `Case moved to ${to}` })))
    .select("id");
  // Remember the stage on the share so the share page's own lazy stage check does not post a duplicate.
  if (!simulated) {
    await Promise.all(live.map((s) => db().from("shares").update({ config: { ...(s.config ?? {}), _stage: to } }).eq("id", s.id)));
  }
  return { shareIds: live.map((s) => s.id), notificationIds: ((ins.data ?? []) as { id: number }[]).map((r) => r.id) };
}

async function liveRun(matterId: number): Promise<boolean> {
  const { data } = await db().from("agent_runs").select("id").eq("matter_id", matterId).eq("status", "running")
    .gte("started_at", new Date(Date.now() - 20 * 60_000).toISOString()).limit(1);
  return (data ?? []).length > 0;
}

/** Keep the feed clean: one rolling no_change row per matter, refreshed instead of repeated. */
async function noteNoChange(matterId: number, name: string) {
  const { data } = await db().from("autopilot_events").select("id,kind").eq("matter_id", matterId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const now = new Date().toISOString();
  if (data?.kind === "no_change") {
    await db().from("autopilot_events").update({ created_at: now, title: `${name}: no changes in Clio` }).eq("id", data.id);
  } else {
    await db().from("autopilot_events").insert({ matter_id: matterId, kind: "no_change", title: `${name}: no changes in Clio`, detail: {} });
  }
}

interface Watched { id: number; name: string; stage: string | null }

async function watchedMatters(): Promise<{ matters: Watched[]; discoverError: string | null }> {
  // Stage as the lawyer last saw it, read before discovery overwrites it.
  const prior = new Map<number, string | null>();
  {
    const { data } = await db().from("matters").select("id,stage");
    for (const r of (data ?? []) as { id: number; stage: string | null }[]) prior.set(Number(r.id), r.stage);
  }
  let discoverError: string | null = null;
  try {
    await discoverMatters();
  } catch (e) {
    discoverError = String((e as Error).message ?? e).slice(0, 200);
  }
  const { data } = await db().from("matters").select("id,status,client_name,display_number");
  const rows = (data ?? []) as { id: number; status: string | null; client_name: string | null; display_number: string | null }[];
  const digested = new Set<number>();
  if (rows.length) {
    const d = await db().from("digests").select("matter_id").in("matter_id", rows.map((r) => r.id));
    for (const r of (d.data ?? []) as { matter_id: number }[]) digested.add(Number(r.matter_id));
  }
  const matters = rows
    .filter((r) => (r.status ?? "Open") !== "Closed" && digested.has(Number(r.id)))
    .map((r) => ({
      id: Number(r.id),
      name: (r.client_name ?? "").split(/\s+/).filter(Boolean).pop() || r.display_number || `Matter ${r.id}`,
      stage: prior.has(Number(r.id)) ? prior.get(Number(r.id))! : null,
    }));
  return { matters, discoverError };
}

async function tickMatter(m: Watched, simulate: Simulate): Promise<AutopilotEvent[]> {
  const events: AutopilotEvent[] = [];
  const push = (e: Omit<AutopilotEvent, "matter_id">) => events.push({ ...e, matter_id: m.id });
  const sim = simulate ? { simulated: true } : {};

  if (await liveRun(m.id)) return [{ matter_id: m.id, kind: "no_change", title: `${m.name}: skipped, a run is already in progress`, detail: { skipped: "live_run" } }];

  const prev = await latestDigest(m.id);
  const before = snapshotFrom(m.stage, prev?.version ?? null, prev?.json ?? null);

  let stats: SyncStats;
  try {
    stats = await syncMatter(quietCtx(m.id));
  } catch (e) {
    return [{ matter_id: m.id, kind: "error", title: `${m.name}: could not read Clio`, detail: { error: String((e as Error).message ?? e).slice(0, 300) } }];
  }
  const { data: mrow } = await db().from("matters").select("stage").eq("id", m.id).maybeSingle();
  const stageNow = (mrow?.stage as string | null) ?? null;

  // Dev-only: pretend the lawyer last saw a different picture, without touching Clio or the digest.
  if (simulate) {
    const order = ["Intake", "Treatment", "Demand", "Negotiation", "Litigation", "Trial", "Disbursement", "Closed"];
    const i = order.indexOf(stageNow ?? "");
    before.stage = i > 0 ? order[i - 1] : "Intake";
    if (simulate === "all") {
      const g = [...before.gates.entries()].find(([, v]) => v.status !== "missing");
      if (g) before.gates.set(g[0], { ...g[1], status: "missing" });
      const f = [...before.flags][0];
      if (f) before.flags.delete(f);
      const o = [...before.overdue.keys()][0];
      if (o) before.overdue.delete(o);
      stats.changed = { ...stats.changed, communications: (stats.changed.communications ?? 0) + 2 };
    }
  }

  const itemCount = Object.values(stats.changed).reduce((s, n) => s + (n || 0), 0);
  const stageMoved = !!stageNow && !!before.stage && stageNow !== before.stage;
  if (!itemCount && !stageMoved) {
    await noteNoChange(m.id, m.name);
    return [];
  }

  let runId: string | null = null;
  let after: Snapshot;
  if (simulate) {
    after = snapshotFrom(stageNow, prev?.version ?? null, prev?.json ?? null);
  } else {
    let pipelineNote: string | null = null;
    let cost = 0;
    try {
      const ctx = await createRun(m.id);
      runId = ctx.runId;
      const out = await runPipeline(m.id, { ctx, skip: ["sync"] });
      const errs = (out.stats.errors ?? {}) as Record<string, string>;
      const msgs = Object.values(errs).join(" ");
      if (msgs) pipelineNote = isQuota(msgs) ? "digest pending (AI quota)" : `some stages failed: ${Object.keys(errs).join(", ")}`;
      cost = Number(out.stats.cost ?? 0);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      pipelineNote = isQuota(msg) ? "digest pending (AI quota)" : `pipeline failed: ${msg.slice(0, 160)}`;
    }
    const next = await latestDigest(m.id);
    if (next && next.version !== prev?.version) {
      after = snapshotFrom(stageNow, next.version, next.json);
      push({ kind: "digest_refreshed", title: `${m.name}: digest refreshed to v${next.version}${cost ? ` ($${cost.toFixed(3)})` : " ($0, cached)"}`, detail: { from: prev?.version ?? null, to: next.version, cost }, run_id: runId });
    } else {
      // No new digest (quota or unchanged inputs): the deterministic assembly still shows gates, flags and deadlines.
      const live = await assemble(m.id).then((r) => r.digest).catch(() => prev?.json ?? null);
      after = snapshotFrom(stageNow, prev?.version ?? null, live);
    }
    if (pipelineNote) push({ kind: "error", title: `${m.name}: ${pipelineNote}`, detail: { note: pipelineNote }, run_id: runId });
  }

  if (stageMoved) {
    const notified = await notifyShares(m.id, stageNow!, !!simulate);
    const n = notified.shareIds.length;
    push({
      kind: "stage_changed",
      title: `${m.name} moved ${before.stage} → ${stageNow}${n ? `, ${n} provider${n === 1 ? "" : "s"} notified` : ""}`,
      detail: { from: before.stage, to: stageNow, ...notified, ...sim },
      run_id: runId,
    });
  }
  if (itemCount) push({ kind: "new_items", title: `${m.name}: ${itemsPhrase(stats.changed)}`, detail: { changed: stats.changed, ...sim }, run_id: runId });
  for (const e of diff(m.name, before, after)) push({ ...e, detail: { ...e.detail, ...sim }, run_id: runId });
  return events;
}

export interface TickResult {
  ran: boolean;
  reason?: string;
  watched: number;
  events: AutopilotEvent[];
  ms: number;
}

/** One pass over every watched matter. Safe to call concurrently: a second caller gets ran=false. */
export async function autopilotTick(opts: { simulate?: Simulate; matterId?: number } = {}): Promise<TickResult> {
  const t0 = Date.now();
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  await getState();
  const lock = await db().from("autopilot_state").update({ ticking_since: nowIso }).eq("id", 1)
    .or(`ticking_since.is.null,ticking_since.lt.${staleIso}`).select("id,interval_min");
  if (lock.error) throw new Error(`autopilot lock: ${lock.error.message}`);
  if (!lock.data?.length) return { ran: false, reason: "a check is already running", watched: 0, events: [], ms: Date.now() - t0 };
  const interval = Number((lock.data[0] as { interval_min: number }).interval_min) || 15;

  const all: AutopilotEvent[] = [];
  let watched = 0;
  try {
    const { matters, discoverError } = await watchedMatters();
    const list = opts.matterId ? matters.filter((m) => m.id === opts.matterId) : matters;
    watched = list.length;
    if (discoverError) all.push({ matter_id: null, kind: "error", title: "Could not list matters from Clio", detail: { error: discoverError } });
    for (const m of list) {
      try {
        all.push(...(await tickMatter(m, opts.simulate ?? null)));
      } catch (e) {
        all.push({ matter_id: m.id, kind: "error", title: `${m.name}: check failed`, detail: { error: String((e as Error).message ?? e).slice(0, 300) } });
      }
    }
    const toWrite = all.filter((e) => !(e.kind === "no_change" && e.detail.skipped));
    if (toWrite.length) {
      const ins = await db().from("autopilot_events").insert(toWrite.map(({ matter_id, kind, title, detail, run_id }) => ({ matter_id, kind, title, detail, run_id: run_id ?? null }))).select("id,created_at");
      (ins.data ?? []).forEach((r, i) => { toWrite[i].id = r.id as number; toWrite[i].created_at = r.created_at as string; });
    }
  } finally {
    const done = new Date();
    await db().from("autopilot_state").update({
      ticking_since: null,
      last_tick_at: done.toISOString(),
      next_tick_at: new Date(done.getTime() + interval * 60_000).toISOString(),
      last_summary: { watched, events: all.length, ms: Date.now() - t0, simulated: !!opts.simulate },
    }).eq("id", 1);
  }
  return { ran: true, watched, events: all, ms: Date.now() - t0 };
}

/** Remove rows written by simulate runs (dev tests). */
export async function cleanupSimulated(): Promise<{ events: number; notifications: number }> {
  const { data } = await db().from("autopilot_events").select("id,detail").eq("detail->>simulated", "true");
  const rows = (data ?? []) as { id: number; detail: { notificationIds?: number[] } }[];
  const nids = rows.flatMap((r) => r.detail.notificationIds ?? []);
  if (nids.length) await db().from("share_notifications").delete().in("id", nids);
  if (rows.length) await db().from("autopilot_events").delete().in("id", rows.map((r) => r.id));
  return { events: rows.length, notifications: nids.length };
}

export async function recentEvents(limit = 30): Promise<AutopilotEvent[]> {
  const { data } = await db().from("autopilot_events").select("*").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as AutopilotEvent[];
}

export async function watchedCount(): Promise<number> {
  const { data } = await db().from("matters").select("id,status");
  const open = ((data ?? []) as { id: number; status: string | null }[]).filter((r) => (r.status ?? "Open") !== "Closed").map((r) => r.id);
  if (!open.length) return 0;
  const d = await db().from("digests").select("matter_id").in("matter_id", open);
  return new Set(((d.data ?? []) as { matter_id: number }[]).map((r) => r.matter_id)).size;
}

/** Due when enabled and next_tick_at has passed (or was never set). */
export function isDue(s: AutopilotState, now = Date.now()): boolean {
  if (!s.enabled) return false;
  if (!s.next_tick_at) return true;
  return Date.parse(s.next_tick_at) - 30_000 <= now;
}
