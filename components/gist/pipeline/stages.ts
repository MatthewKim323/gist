// Pure derivation: agent_tasks rows -> per-stage view models + run-wide counters.
// Everything here is computed from what the rows say. Nothing is estimated or interpolated.
import type { AgentRole, AgentTask, TaskStatus } from "@/lib/types";

export interface AgentRun {
  id: string;
  matter_id: number | null;
  status: "running" | "done" | "failed" | string;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number;
  stats: Record<string, unknown> | null;
}

export interface StageDef {
  role: AgentRole;
  title: string;
  explain: string;
}

/** Canonical pipeline order. A stage only renders once it has at least one task row. */
export const STAGES: StageDef[] = [
  { role: "sync", title: "Reading Clio", explain: "Pulls every note, email, task and document from Clio (read only) and fingerprints each one, so next time we only reread what changed." },
  { role: "ocr", title: "OCR agents", explain: "Turns scanned pages into text, page by page, so the injuries buried deep in a 200-page scan become readable and searchable." },
  { role: "extract", title: "Extractor swarm", explain: "Each agent reads one slice of the file and pulls out facts, each with the exact quote, the source and the page it came from." },
  { role: "verify", title: "Verifier", explain: "Checks that every quote really appears in its source. Anything it can't find in the original is thrown out." },
  { role: "jev", title: "Jev audit", explain: "A calibrated judge asks whether each source actually supports its claim. Shaky ones go to your review tray instead of the screen." },
  { role: "embed", title: "Indexing", explain: "Embeds facts and pages so you can search the whole case and pull up related entries in a click." },
  { role: "reconcile", title: "Reconciler", explain: "Groups facts about the same event across sources, merges duplicates and flags where the sources disagree." },
  { role: "gate", title: "Phase gates", explain: "Checks what the case needs to reach its next phase: what the firm has, what is partial, what is missing and who owes it." },
  { role: "synth", title: "Synthesis", explain: "Writes the 90-second story and picks the ten things that matter, using verified facts only." },
];

const ORDER = new Map(STAGES.map((s, i) => [s.role, i]));

export type StageState = "working" | "done" | "cached" | "failed" | "skipped";

/** The runner writes a cached "<stage> (skipped)" row when a stage module is not available. */
export const isSkipped = (t: AgentTask) => (t.status === "cached" || t.status === "done") && /^skipped\b/i.test(t.last_event ?? "");

export interface StageView {
  def: StageDef;
  index: number;
  tasks: AgentTask[];
  counts: Record<TaskStatus, number>;
  state: StageState;
  facts: number;
  cost: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** summed `N key` counts parsed from each task's last_event */
  events: Record<string, { n: number; of: number }>;
}

export interface RunCounters {
  entries: { n: number; of: number | null };
  pages: { n: number; of: number | null };
  factsEmitted: number;
  verified: number | null;
  rejected: number;
  jevChecks: number;
  cost: number;
  tasks: number;
  cachedTasks: number;
  terminalTasks: number;
  failedTasks: number;
}

const STATUS_RANK: Record<TaskStatus, number> = { queued: 0, running: 1, done: 2, cached: 2, failed: 2 };
export const isTerminal = (s: TaskStatus) => STATUS_RANK[s] === 2;

/** Merge an incoming row over an existing one without letting a stale snapshot roll a task backwards. */
export function mergeTask(prev: AgentTask | undefined, next: AgentTask): AgentTask {
  if (!prev) return next;
  if (STATUS_RANK[next.status] < STATUS_RANK[prev.status]) return prev;
  return next;
}

export function normalizeTask(r: Record<string, unknown>): AgentTask {
  return {
    id: Number(r.id),
    run_id: String(r.run_id),
    role: String(r.role) as AgentRole,
    shard_label: (r.shard_label as string | null) ?? null,
    status: (String(r.status ?? "queued") as TaskStatus),
    worker: (r.worker as string | null) ?? null,
    started_at: (r.started_at as string | null) ?? null,
    finished_at: (r.finished_at as string | null) ?? null,
    tokens_in: Number(r.tokens_in ?? 0),
    tokens_out: Number(r.tokens_out ?? 0),
    cost_usd: Number(r.cost_usd ?? 0),
    facts_emitted: Number(r.facts_emitted ?? 0),
    last_event: (r.last_event as string | null) ?? null,
  };
}

export function normalizeRun(r: Record<string, unknown>): AgentRun {
  return {
    id: String(r.id),
    matter_id: r.matter_id == null ? null : Number(r.matter_id),
    status: String(r.status ?? "running"),
    started_at: (r.started_at as string | null) ?? null,
    finished_at: (r.finished_at as string | null) ?? null,
    cost_usd: Number(r.cost_usd ?? 0),
    stats: (r.stats as Record<string, unknown> | null) ?? null,
  };
}

function normKey(w: string): string {
  let k = w.toLowerCase();
  if (k.endsWith("ies")) k = k.slice(0, -3) + "y";
  else if (k.endsWith("s") && !k.endsWith("ss")) k = k.slice(0, -1);
  const alias: Record<string, string> = { item: "entry", reject: "rejected", verify: "verified", pg: "page", jev: "check", verifie: "verified" };
  return alias[k] ?? k;
}

/**
 * Parse the content-free counters a stage writes into last_event. Accepted shapes (mix freely):
 *   "12/40 pages", "8 facts", "3 rejected", "pages 12/40", "rejected=3", "jev checks: 25"
 */
export function parseEvent(text: string | null): Record<string, { n: number; of: number }> {
  const out: Record<string, { n: number; of: number }> = {};
  if (!text) return out;
  const put = (key: string, n: string, of?: string) => {
    const k = normKey(key);
    if (!k || out[k]) return;
    out[k] = { n: Number(n), of: of ? Number(of) : 0 };
  };
  for (const m of text.matchAll(/([a-z_]+)\s*[:=]\s*(\d+)(?:\s*\/\s*(\d+))?/gi)) put(m[1], m[2], m[3]);
  for (const m of text.matchAll(/(\d+)(?:\s*\/\s*(\d+))?\s+([a-z_]+)/gi)) put(m[3], m[1], m[2]);
  return out;
}

const ts = (s: string | null) => (s ? Date.parse(s) : NaN);

export function deriveStages(tasks: AgentTask[], run: AgentRun | null): StageView[] {
  const byRole = new Map<AgentRole, AgentTask[]>();
  for (const t of tasks) {
    if (!ORDER.has(t.role)) continue;
    const arr = byRole.get(t.role) ?? [];
    arr.push(t);
    byRole.set(t.role, arr);
  }
  const present = STAGES.filter((s) => byRole.has(s.role));
  const runOver = run?.status === "done" || run?.status === "failed";
  return present.map((def, i) => {
    const list = (byRole.get(def.role) ?? []).slice().sort((a, b) => a.id - b.id);
    const counts: Record<TaskStatus, number> = { queued: 0, running: 0, done: 0, cached: 0, failed: 0 };
    let facts = 0, cost = 0, start = Infinity, end = -Infinity;
    const events: StageView["events"] = {};
    for (const t of list) {
      counts[t.status]++;
      const parsed = parseEvent(t.last_event);
      // cached shards report their carried-over facts in last_event ("12 facts unchanged") instead of facts_emitted
      facts += Math.max(t.facts_emitted, parsed.fact?.n ?? 0);
      cost += t.cost_usd;
      const s = ts(t.started_at), f = ts(t.finished_at);
      if (!Number.isNaN(s)) start = Math.min(start, s);
      if (!Number.isNaN(f)) end = Math.max(end, f);
      for (const [k, v] of Object.entries(parsed)) {
        const e = (events[k] ??= { n: 0, of: 0 });
        e.n += v.n;
        e.of += v.of;
      }
    }
    const open = counts.queued + counts.running;
    // A stage is settled when nothing in it is open and either a later stage has started or the run ended.
    const laterStarted = present.slice(i + 1).length > 0;
    let state: StageState = "working";
    if (open === 0 && (laterStarted || runOver)) {
      if (counts.failed > 0 && counts.failed === list.length) state = "failed";
      else if (list.every(isSkipped)) state = "skipped";
      else if (counts.cached === list.length) state = "cached";
      else state = "done";
    }
    return {
      def,
      index: ORDER.get(def.role)! + 1,
      tasks: list,
      counts,
      state,
      facts,
      cost,
      startedAt: Number.isFinite(start) ? start : null,
      finishedAt: open === 0 && Number.isFinite(end) ? end : null,
      events,
    };
  });
}

function statNum(stats: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = stats?.[key];
  return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
}

export function deriveCounters(stages: StageView[], run: AgentRun | null): RunCounters {
  const get = (role: AgentRole) => stages.find((s) => s.def.role === role);
  const ev = (role: AgentRole, key: string) => get(role)?.events[key];
  const stats = run?.stats ?? null;
  const all = stages.flatMap((s) => s.tasks);

  const sumEv = (key: string) =>
    stages.reduce((a, s) => ({ n: a.n + (s.events[key]?.n ?? 0), of: a.of + (s.events[key]?.of ?? 0) }), { n: 0, of: 0 });
  const entriesEv = ev("sync", "entry");
  const pagesEv = ev("ocr", "page");
  const taskCost = all.reduce((s, t) => s + t.cost_usd, 0);
  const jevStage = get("jev");

  return {
    entries: {
      n: statNum(stats, "entries_read") ?? statNum(stats, "entries") ?? entriesEv?.n ?? 0,
      // a denominator is only shown when it is authoritative (run stats), never a partial sum of finished shards
      of: statNum(stats, "entries_total") ?? statNum(stats, "entries"),
    },
    pages: {
      n: statNum(stats, "pages_read") ?? statNum(stats, "pages") ?? pagesEv?.n ?? 0,
      of: statNum(stats, "pages_total") ?? statNum(stats, "pages"),
    },
    factsEmitted: get("extract")?.facts ?? 0,
    verified: statNum(stats, "facts_verified") ?? ev("verify", "verified")?.n ?? null,
    // the quote verifier runs inside the extractor shards ("8 facts, 2 rejected") and/or as its own verify stage
    rejected: statNum(stats, "facts_rejected") ?? sumEv("rejected").n,
    jevChecks:
      statNum(stats, "jev_checks") ??
      (ev("jev", "supported")?.of || null) ??
      ev("jev", "check")?.n ??
      (jevStage ? jevStage.counts.done + jevStage.counts.cached : 0),
    cost: run && (run.status === "done" || run.status === "failed") && run.cost_usd > 0 ? run.cost_usd : taskCost,
    tasks: all.length,
    cachedTasks: all.filter((t) => t.status === "cached" || isSkipped(t)).length,
    terminalTasks: all.filter((t) => isTerminal(t.status)).length,
    failedTasks: all.filter((t) => t.status === "failed").length,
  };
}

export const fmtUsd = (n: number) => (n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
export const fmtInt = (n: number) => n.toLocaleString("en-US");
export function fmtDur(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}
