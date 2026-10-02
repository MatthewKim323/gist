"use client";
// Dev-only controls around PipelineTimeline for /pipeline-preview. Real mode when given a runId,
// otherwise a simulated run (labelled as such on screen).
import { useMemo, useState } from "react";
import PipelineTimeline from "./PipelineTimeline";
import { createMockSource } from "./mock";

type Mode = "cold" | "cached" | "fail";

export default function PipelinePreview({ runId }: { runId: string | null }) {
  const [mode, setMode] = useState<Mode>("cold");
  const [speed, setSpeed] = useState(1);
  const [take, setTake] = useState(0);
  const [completed, setCompleted] = useState<string | null>(null);

  const sim = useMemo(
    () => (runId ? null : createMockSource({ mode: mode === "fail" ? "cold" : mode, failOne: mode === "fail", speed, seed: 7 + take })),
    // take forces a fresh replay
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runId, mode, speed, take],
  );

  const replay = (m: Mode) => {
    setCompleted(null);
    setMode(m);
    setTake((t) => t + 1);
  };

  return (
    <>
      <div className="gp-preview-bg" />
      {runId ? (
        <PipelineTimeline runId={runId} onComplete={() => setCompleted(runId)} />
      ) : (
        sim && <PipelineTimeline key={sim.runId} runId={sim.runId} source={sim} onComplete={() => setCompleted(sim.runId)} />
      )}
      <div className="gp-preview-bar">
        <strong>{runId ? "real run" : "simulated run · dev only"}</strong>
        {!runId && (
          <>
            <button onClick={() => replay("cold")} data-on={mode === "cold" || undefined}>cold</button>
            <button onClick={() => replay("cached")} data-on={mode === "cached" || undefined}>cached rerun</button>
            <button onClick={() => replay("fail")} data-on={mode === "fail" || undefined}>one failure</button>
            <span className="gp-preview-sep" />
            {[1, 2, 4].map((s) => (
              <button key={s} onClick={() => { setSpeed(s); setCompleted(null); setTake((t) => t + 1); }} data-on={speed === s || undefined}>
                {s}x
              </button>
            ))}
          </>
        )}
        {completed && <span className="gp-preview-done">onComplete fired</span>}
      </div>
    </>
  );
}
