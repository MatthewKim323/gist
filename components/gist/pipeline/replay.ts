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

export function createReplaySource(targetMs = 35_000): ReplaySource {
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
      const starts = tasks.map((t) => ms(t.started_at));
      const ends = tasks.map((t, i) => (Number.isFinite(ms(t.finished_at)) ? ms(t.finished_at) : starts[i]));
      const t0 = Math.min(...starts.filter(Number.isFinite));
      const t1 = Math.max(...ends.filter(Number.isFinite));
      const span = t1 - t0;
      // a fully cached run has near-zero recorded durations; then keep the recorded ORDER and spread it evenly
      const byOrder = !Number.isFinite(span) || span < 3000;
      const at = (i: number, end: boolean) => {
        if (byOrder) return ((i + (end ? 0.7 : 0)) / Math.max(1, tasks.length)) * targetMs;
        const v = end ? ends[i] : starts[i];
        return Number.isFinite(v) ? ((v - t0) / span) * targetMs : (i / tasks.length) * targetMs;
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
