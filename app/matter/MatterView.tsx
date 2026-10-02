"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { seamWipe } from "@/lib/engine/seam";
import Dashboard from "@/components/gist/dashboard/Dashboard";
import PipelineTimeline from "@/components/gist/pipeline/PipelineTimeline";
import { createMockSource } from "@/components/gist/pipeline/mock";

type Phase = "boot" | "pipeline" | "digest";

/**
 * /matter            -> dashboard
 * /matter?run=<id>   -> live pipeline timeline for that run, then seam-wipe to the dashboard
 * /matter?sim=1      -> simulated timeline (dev), then the dashboard
 * /matter?fixture=1  -> dashboard over the invented dev fixture
 */
export default function MatterView() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [runId, setRunId] = useState<string | null>(null);
  const [sim, setSim] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const run = p.get("run");
    const simulate = p.get("sim") === "1";
    setRunId(run);
    setSim(simulate);
    setPhase(run || simulate ? "pipeline" : "digest");
  }, []);

  const source = useMemo(() => (sim ? createMockSource({ mode: "cold", speed: 1, seed: 7 }) : undefined), [sim]);
  const toDigest = () => void seamWipe(() => flushSync(() => setPhase("digest")));

  if (phase === "boot") return null;
  if (phase === "pipeline") {
    if (source) return <PipelineTimeline key={source.runId} runId={source.runId} source={source} onComplete={toDigest} />;
    if (runId) return <PipelineTimeline runId={runId} onComplete={toDigest} />;
  }
  return <Dashboard />;
}
