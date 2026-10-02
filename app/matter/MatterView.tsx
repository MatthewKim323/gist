"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { seamWipe } from "@/lib/engine/seam";
import Dashboard from "@/components/gist/dashboard/Dashboard";
import PipelineTimeline from "@/components/gist/pipeline/PipelineTimeline";
import { createMockSource } from "@/components/gist/pipeline/mock";
import { createReplaySource } from "@/components/gist/pipeline/replay";
import CasePicker, { type Picked } from "@/components/gist/cases/CasePicker";

type Phase = "boot" | "pick" | "pipeline" | "digest";

/**
 * /matter              -> case picker: choose a case to ingest, then the timeline plays and seam-wipes to the
 *                         dashboard (?start=1 keeps the old behaviour: first synced matter, straight into a run)
 * /matter?run=<id>     -> watch that run, then the dashboard (the start flow rewrites the url to this, so a
 *                         refresh keeps watching instead of starting another run)
 * /matter?view=digest  -> straight to the dashboard
 * /matter?sim=1        -> simulated timeline (dev), then the dashboard
 * /matter?fixture=1    -> dashboard over the invented dev fixture
 */
export default function MatterView() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [runId, setRunId] = useState<string | null>(null);
  const [matterId, setMatterId] = useState<number | undefined>(undefined);
  const [sim, setSim] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const run = p.get("run");
    const replay = p.get("replay");
    if (replay) {
      // ?replay=<runId> or ?replay=best: play a recorded run back (recording / demo)
      (replay === "best"
        ? fetch("/api/pipeline/replay", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: { runId?: string; matterId?: number } | null) => j)
        : Promise.resolve({ runId: replay, matterId: undefined as number | undefined })
      )
        .then((j) => {
          if (!j?.runId) return setPhase("digest");
          setMatterId(j.matterId);
          setRunId(j.runId);
          setPhase("pipeline");
        })
        .catch(() => setPhase("digest"));
    } else if (p.get("sim") === "1") {
      setSim(true);
      setPhase("pipeline");
    } else if (run) {
      setRunId(run);
      setPhase("pipeline");
    } else if (p.get("view") === "digest" || p.get("fixture") === "1") {
      setPhase("digest");
    } else if (p.get("start") !== "1") {
      setPhase("pick");
    } else {
      let cancelled = false;
      startRun()
        .then((started) => {
          if (cancelled) return;
          if (!started) return setPhase("digest");
          setMatterId(started.matterId);
          setRunId(started.runId);
          const url = new URL(window.location.href);
          url.searchParams.set("run", started.runId);
          window.history.replaceState(window.history.state, "", url);
          setPhase("pipeline");
        })
        .catch((e) => {
          console.error("[matter] could not start a run", e);
          if (!cancelled) setPhase("digest");
        });
      return () => {
        cancelled = true;
      };
    }
  }, []);

  const source = useMemo(() => (sim ? createMockSource({ mode: "cold", speed: 1, seed: 7 }) : undefined), [sim]);
  // real runs go through the replay source: a run still in flight streams live, a finished one (a stale ?run=,
  // demo mode, ?replay=) plays its recorded rows back instead of opening already green
  const replaySource = useMemo(() => (runId ? createReplaySource() : undefined), [runId]);
  const toDigest = () => void seamWipe(() => flushSync(() => setPhase("digest")));

  if (phase === "boot") return null;
  if (phase === "pick") {
    return (
      <CasePicker
        onPicked={({ matterId: id, runId: rid }: Picked) => {
          const url = new URL(window.location.href);
          url.searchParams.set("run", rid);
          url.searchParams.set("id", String(id));
          window.history.replaceState(window.history.state, "", url);
          void seamWipe(() =>
            flushSync(() => {
              setMatterId(id);
              setRunId(rid);
              setPhase("pipeline");
            }),
          );
        }}
      />
    );
  }
  if (phase === "pipeline") {
    if (source) return <PipelineTimeline key={source.runId} runId={source.runId} source={source} onComplete={toDigest} />;
    // a failed run still lands on the dashboard: it shows the last good digest and the gaps
    if (runId) return <PipelineTimeline key={runId} runId={runId} source={replaySource} onComplete={toDigest} onFailed={toDigest} />;
  }
  return <Dashboard matterId={matterId} />;
}

/** First synced matter (never a hardcoded id), then POST /api/pipeline. Null when nothing is synced yet. */
async function startRun(): Promise<{ matterId: number; runId: string } | null> {
  const list = (await fetch("/api/matter", { cache: "no-store" }).then((r) => r.json())) as { matters?: { id: number }[] };
  const first = list.matters?.[0];
  if (!first) return null;
  const res = await fetch("/api/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ matterId: first.id }),
  });
  if (!res.ok) throw new Error(`pipeline ${res.status}`);
  const { runId } = (await res.json()) as { runId: string };
  return { matterId: first.id, runId };
}
