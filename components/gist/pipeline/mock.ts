"use client";
// DEV ONLY. A simulated pipeline run for /pipeline-preview so the timeline can be built before the swarm
// backend lands. Generic shard labels and made-up counts; no case data. Never used by the real /matter flow.
import type { AgentRole, AgentTask, TaskStatus } from "@/lib/types";
import type { AgentRun } from "./stages";
import type { PipelineHandlers, PipelineSource } from "./source";

export interface MockOptions {
  /** "cold" reads everything; "cached" replays the same run where every shard is a cache hit. */
  mode?: "cold" | "cached";
  /** >1 is faster. */
  speed?: number;
  /** make one OCR slice fail, to see the failed tile */
  failOne?: boolean;
  seed?: number;
}

interface Spec {
  role: AgentRole;
  labels: string[];
  concurrency: number;
  dur: [number, number];
  cost: [number, number];
  /** start once this fraction of the previous stage has finished (lets stages overlap like the real swarm) */
  after: number;
  queueAll?: boolean;
  facts?: [number, number];
  event?: (i: number, rnd: () => number) => string;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const range = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

function plan(): Spec[] {
  const scans = ["A", "B", "C"];
  const scanPages = [180, 140, 64];
  const ocrLabels = scans.flatMap((d, k) => range(Math.ceil(scanPages[k] / 10), (i) => `scan ${d} p${i * 10 + 1}-${Math.min(scanPages[k], i * 10 + 10)}`));
  return [
    {
      role: "sync",
      labels: ["notes", "emails", "calls", "tasks", "calendar", "documents"],
      concurrency: 3,
      dur: [500, 1300],
      cost: [0, 0],
      after: 0,
      event: (i) => `${[118, 96, 14, 41, 27, 16][i]} entries`,
    },
    {
      role: "ocr",
      labels: ocrLabels,
      concurrency: 8,
      dur: [700, 1900],
      cost: [0.03, 0.07],
      after: 1,
      queueAll: true,
      event: (i) => {
        const m = /p(\d+)-(\d+)/.exec(ocrLabels[i])!;
        const n = Number(m[2]) - Number(m[1]) + 1;
        return `${n}/${n} pages`;
      },
    },
    {
      role: "extract",
      labels: [
        ...range(12, (i) => `notes ${i * 10 + 1}-${i * 10 + 10}`),
        ...range(7, (i) => `emails ${i * 15 + 1}-${i * 15 + 15}`),
        "tasks + calendar",
        "expenses + fields",
        ...range(4, (i) => `doc ${i + 1}`),
        ...ocrLabels,
      ],
      concurrency: 10,
      dur: [600, 1700],
      cost: [0.008, 0.03],
      after: 0.6,
      queueAll: true,
      facts: [1, 9],
    },
    {
      role: "verify",
      labels: range(6, (i) => `batch ${i + 1}`),
      concurrency: 3,
      dur: [400, 900],
      cost: [0, 0],
      after: 0.85,
      event: (_, r) => `${38 + Math.floor(r() * 14)} verified · ${Math.floor(r() * 4)} rejected`,
    },
    {
      role: "jev",
      labels: range(6, (i) => `claims ${i * 40 + 1}-${i * 40 + 40}`),
      concurrency: 3,
      dur: [500, 1100],
      cost: [0.004, 0.01],
      after: 0.5,
      event: (_, r) => `${34 + Math.floor(r() * 6)} checks`,
    },
    {
      role: "embed",
      labels: ["facts", "scan pages", "notes", "emails"],
      concurrency: 4,
      dur: [600, 1200],
      cost: [0.004, 0.012],
      after: 1,
    },
    {
      role: "reconcile",
      labels: range(5, (i) => `cluster ${i + 1}`),
      concurrency: 3,
      dur: [600, 1300],
      cost: [0.006, 0.015],
      after: 1,
    },
    {
      role: "gate",
      labels: ["records", "bills", "liability", "coverage"],
      concurrency: 4,
      dur: [500, 1000],
      cost: [0.003, 0.008],
      after: 1,
    },
    {
      role: "synth",
      labels: ["story", "top 10"],
      concurrency: 2,
      dur: [1400, 2400],
      cost: [0.06, 0.12],
      after: 1,
    },
  ];
}

export function createMockSource(opts: MockOptions = {}): PipelineSource & { runId: string } {
  const mode = opts.mode ?? "cold";
  const speed = opts.speed ?? 1;
  const rnd = rng(opts.seed ?? 7);
  const runId = `sim-${mode}-${Math.random().toString(36).slice(2, 10)}`;
  const tasks = new Map<number, AgentTask>();
  let run: AgentRun = {
    id: runId,
    matter_id: null,
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    cost_usd: 0,
    stats: { simulated: true },
  };
  const subs = new Set<PipelineHandlers>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let started = false;
  let nextId = 1;

  const wait = (ms: number) =>
    new Promise<void>((r) => {
      const t = setTimeout(() => {
        timers.delete(t);
        r();
      }, ms / speed);
      timers.add(t);
    });
  const emitTask = (t: AgentTask) => {
    tasks.set(t.id, t);
    for (const s of subs) s.task({ ...t });
  };
  const emitRun = () => {
    for (const s of subs) s.run({ ...run });
  };
  const between = ([a, b]: [number, number]) => a + (b - a) * rnd();

  const specs = plan();
  const progress = new Map<AgentRole, { done: number; total: number }>(specs.map((s) => [s.role, { done: 0, total: s.labels.length }]));
  const stageDone = new Map<AgentRole, Promise<void>>();

  async function runStage(spec: Spec, idx: number) {
    const prev = specs[idx - 1];
    if (prev) {
      const p = progress.get(prev.role)!;
      while (p.done < Math.ceil(p.total * spec.after)) await wait(80);
    }
    const cached = mode === "cached";
    const rows: AgentTask[] = spec.labels.map((label) => ({
      id: nextId++,
      run_id: runId,
      role: spec.role,
      shard_label: label,
      status: "queued" as TaskStatus,
      worker: null,
      started_at: null,
      finished_at: null,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      facts_emitted: 0,
      last_event: null,
    }));
    if (spec.queueAll && !cached) rows.forEach(emitTask);
    let cursor = 0;
    const worker = async (w: number) => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        const start = { ...row, status: "running" as TaskStatus, worker: `${spec.role}-${w}`, started_at: new Date().toISOString() };
        if (!cached) emitTask(start);
        await wait(cached ? 40 + rnd() * 140 : between(spec.dur));
        const facts = spec.facts ? Math.round(between(spec.facts)) : 0;
        const tokens = cached ? 0 : Math.round(800 + rnd() * 4000);
        emitTask({
          ...start,
          status: cached ? "cached" : "done",
          finished_at: new Date().toISOString(),
          tokens_in: tokens,
          tokens_out: Math.round(tokens * 0.2),
          cost_usd: cached ? 0 : Number(between(spec.cost).toFixed(4)),
          facts_emitted: facts,
          last_event: spec.event ? spec.event(spec.labels.indexOf(row.shard_label!), rnd) : null,
        });
        progress.get(spec.role)!.done++;
      }
    };
    await Promise.all(range(Math.min(spec.concurrency * (cached ? 3 : 1), rows.length), (w) => String(w)).map((w) => worker(Number(w))));
    // a stage never settles before the one ahead of it
    if (prev) await stageDone.get(prev.role);
  }

  async function simulate() {
    if (opts.failOne && mode === "cold") {
      // flag one OCR slice as failed at the end of OCR
      void (async () => {
        await wait(5200);
        const victim = [...tasks.values()].find((t) => t.role === "ocr" && t.status === "done");
        if (victim) emitTask({ ...victim, status: "failed", last_event: "page render timeout" });
      })();
    }
    for (let i = 0; i < specs.length; i++) {
      // every stage starts watching at once; each waits on the previous stage's progress, so they overlap
      stageDone.set(specs[i].role, runStage(specs[i], i));
    }
    await Promise.all(stageDone.values());
    const all = [...tasks.values()];
    const verified = all.filter((t) => t.role === "verify").reduce((s, t) => s + Number(/(\d+) verified/.exec(t.last_event ?? "")?.[1] ?? 0), 0);
    const rejected = all.filter((t) => t.role === "verify").reduce((s, t) => s + Number(/(\d+) rejected/.exec(t.last_event ?? "")?.[1] ?? 0), 0);
    await wait(400);
    run = {
      ...run,
      status: "done",
      finished_at: new Date().toISOString(),
      cost_usd: Number(all.reduce((s, t) => s + t.cost_usd, 0).toFixed(4)),
      stats: {
        simulated: true,
        entries_read: 312,
        entries_total: 312,
        pages_read: 384,
        pages_total: 384,
        facts_verified: verified,
        facts_rejected: rejected,
      },
    };
    emitRun();
  }

  const kick = () => {
    if (started) return;
    started = true;
    void simulate();
  };

  return {
    runId,
    async load() {
      kick();
      return { run: { ...run }, tasks: [...tasks.values()].map((t) => ({ ...t })) };
    },
    subscribe(_id, h) {
      subs.add(h);
      queueMicrotask(() => h.live?.("live"));
      return () => {
        subs.delete(h);
        if (subs.size === 0) {
          // stop the simulation when nobody is watching (StrictMode remounts resubscribe right away)
          setTimeout(() => {
            if (subs.size === 0) {
              for (const t of timers) clearTimeout(t);
              timers.clear();
            }
          }, 50);
        }
      };
    },
  };
}
