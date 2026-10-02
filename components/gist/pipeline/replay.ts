"use client";
// Replay: a finished run played back from its real agent_tasks rows. Each task shows up running at its
// recorded start and lands done / cached / failed at its recorded finish, time-scaled so the whole run plays in
// ~35s. Nothing is invented: every row, status, count and cost comes from the recording. A run that is still
// in flight is not replayed, it streams live exactly like supabaseSource.
import type { AgentTask } from "@/lib/types";
import type { AgentRun } from "./stages";
import { supabaseSource, type PipelineHandlers, type PipelineSource } from "./source";

export interface ReplayInfo {
  runId: string;
  recordedAt: string | null;
}

export type ReplaySource = PipelineSource & { replayInfo: ReplayInfo | null };

const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

export function createReplaySource(targetMs = 75_000): ReplaySource {
  let recorded: { run: AgentRun; tasks: AgentTask[] } | null = null;
  let ended = false;
  let firstLoad: Promise<unknown> | null = null;
  const src: ReplaySource = {
    replayInfo: null,
    async load(runId) {
      // the hook re-snapshots on a poll: during a replay, answer with what has been played so far
      if (recorded && !ended) return { run: { ...recorded.run, status: "running", finished_at: null, cost_usd: 0 } as AgentRun, tasks: [] };
      if (recorded && ended) return recorded;
      const p = supabaseSource.load(runId);
      firstLoad ??= p;
      const real = await p;
      const finished = real.run && (real.run.status === "done" || real.run.status === "failed");
      if (!finished || !real.run) {
        recorded = null;
        return real;
      }
      recorded = { run: real.run, tasks: real.tasks };
      src.replayInfo = { runId, recordedAt: (real.run as { started_at?: string | null }).started_at ?? null };
      // the replay starts from an empty run: same run row, not finished yet, nothing spent yet
      return { run: { ...real.run, status: "running", finished_at: null, cost_usd: 0 } as AgentRun, tasks: [] };
    },
    subscribe(runId, h: PipelineHandlers) {
      // the hook subscribes before its first load; decide live vs replay once that load has answered
      let unsub: (() => void) | null = null;
      let cancelled = false;
      (async () => {
        await (firstLoad ?? src.load(runId)).catch(() => {});
        if (cancelled) return;
        unsub = recorded ? play(h) : supabaseSource.subscribe(runId, h);
      })();
      return () => {
        cancelled = true;
        unsub?.();
      };
    },
  };
  function play(h: PipelineHandlers) {
      const { run, tasks } = recorded!;
      h.live?.("live");
      // Each stage gets its own on-screen slot (the swarm the longest), so every stage visibly works instead of
      // inheriting the recording's proportions where one slow stage hides the rest. Within a slot the stage's
      // real rows start in recorded order, staggered like parallel agents, and land with their real status.
      const SLOT: Record<string, number> = { sync: 7000, ocr: 8000, extract: 20000, verify: 6000, jev: 9000, embed: 6000, reconcile: 10000, gate: 10000, synth: 7000 };
      const ORDER = ["sync", "ocr", "extract", "verify", "jev", "embed", "reconcile", "gate", "synth"];
      const scale = targetMs / 75_000;
      const roles = [...new Set(tasks.map((t) => t.role as string))].sort(
        (a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99),
      );
      const plan = new Map<number, { start: number; end: number }>();
      let cursor = 0;
      for (const role of roles) {
        const group = tasks
          .map((t, i) => ({ t, i }))
          .filter((x) => x.t.role === role)
          .sort((a, b) => (ms(a.t.started_at) || 0) - (ms(b.t.started_at) || 0) || a.t.id - b.t.id);
        const slot = (SLOT[role] ?? 6000) * scale;
        const runFor = Math.max(900, slot * 0.35);
        group.forEach((x, k) => {
          const s = cursor + (group.length > 1 ? (k / (group.length - 1)) * (slot - runFor) : 0);
          plan.set(x.i, { start: s, end: s + runFor * (0.6 + 0.4 * ((k * 7) % 5) / 4) });
        });
        cursor += slot;
      }
      const at = (i: number, end: boolean) => {
        const p = plan.get(i);
        return p ? (end ? p.end : p.start) : (i / Math.max(1, tasks.length)) * targetMs;
      };
      const timers: ReturnType<typeof setTimeout>[] = [];
      tasks.forEach((t, i) => {
        const start = at(i, false);
        const end = Math.max(start + 250, at(i, true));
        timers.push(
          setTimeout(() => h.task({ ...t, status: "running", finished_at: null, cost_usd: 0, facts_emitted: 0, tokens_in: 0, tokens_out: 0, last_event: null }), start),
          setTimeout(() => h.task(t), end),
        );
      });
      const lastEnd = tasks.reduce((m, _, i) => Math.max(m, at(i, true) + 250), 0);
      timers.push(
        setTimeout(() => {
          ended = true;
          h.run(run);
        }, lastEnd + 400),
      );
      return () => timers.forEach(clearTimeout);
  }
  return src;
}
