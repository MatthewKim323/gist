"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { seamWipe } from "@/lib/engine/seam";
import Dashboard from "@/components/gist/dashboard/Dashboard";
import PipelineTimeline from "@/components/gist/pipeline/PipelineTimeline";
import { createMockSource } from "@/components/gist/pipeline/mock";

type Phase = "boot" | "pipeline" | "digest";

/**
 * /matter              -> starts a pipeline run on the first synced matter, plays the live timeline, then
 *                         seam-wipes to the dashboard (a rerun over unchanged data is the cached $0 pass)
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
    if (p.get("sim") === "1") {
      setSim(true);
      setPhase("pipeline");
    } else if (run) {
      setRunId(run);
      setPhase("pipeline");
    } else if (p.get("view") === "digest" || p.get("fixture") === "1") {
      setPhase("digest");
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
  const toDigest = () => void seamWipe(() => flushSync(() => setPhase("digest")));

  if (phase === "boot") return null;
  if (phase === "pipeline") {
    if (source) return <PipelineTimeline key={source.runId} runId={source.runId} source={source} onComplete={toDigest} />;
    // a failed run still lands on the dashboard: it shows the last good digest and the gaps
    if (runId) return <PipelineTimeline runId={runId} onComplete={toDigest} onFailed={toDigest} />;
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
