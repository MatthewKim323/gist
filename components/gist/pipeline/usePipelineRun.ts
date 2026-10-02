"use client";
// Snapshot + realtime merge for one run. Subscribes first (buffering), then loads, so no row is missed
// between the fetch and the subscription. A reconcile poll covers dropped realtime events.
import { useEffect, useReducer, useRef } from "react";
import type { AgentTask } from "@/lib/types";
import { mergeTask, type AgentRun } from "./stages";
import { supabaseSource, type LiveState, type PipelineSource } from "./source";

interface State {
  run: AgentRun | null;
  tasks: Map<number, AgentTask>;
  live: LiveState;
  loaded: boolean;
  error: string | null;
  version: number;
}

type Action =
  | { type: "tasks"; tasks: AgentTask[] }
  | { type: "run"; run: AgentRun | null }
  | { type: "live"; live: LiveState }
  | { type: "loaded" }
  | { type: "error"; error: string }
  | { type: "reset" };

const initial = (): State => ({ run: null, tasks: new Map(), live: "connecting", loaded: false, error: null, version: 0 });

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "tasks": {
      const tasks = new Map(s.tasks);
      for (const t of a.tasks) tasks.set(t.id, mergeTask(tasks.get(t.id), t));
      return { ...s, tasks, version: s.version + 1 };
    }
    case "run": {
      if (!a.run) return s;
      // never roll a finished run back to running from a stale snapshot
      if (s.run && s.run.status !== "running" && a.run.status === "running") return s;
      return { ...s, run: a.run };
    }
    case "live":
      return { ...s, live: a.live };
    case "loaded":
      return { ...s, loaded: true, error: null };
    case "error":
      return { ...s, error: a.error };
    case "reset":
      return initial();
  }
}

export function usePipelineRun(runId: string | null, source: PipelineSource = supabaseSource) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const liveRef = useRef<LiveState>("connecting");
  const doneRef = useRef(false);

  useEffect(() => {
    if (!runId) return;
    dispatch({ type: "reset" });
    doneRef.current = false;
    let alive = true;

    // batch realtime bursts into one render per frame (a cached rerun flips dozens of rows at once)
    let pending: AgentTask[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!alive || !pending.length) return;
      const batch = pending;
      pending = [];
      dispatch({ type: "tasks", tasks: batch });
    };
    const unsub = source.subscribe(runId, {
      task: (t) => {
        pending.push(t);
        if (!raf) raf = requestAnimationFrame(flush);
      },
      run: (r) => {
        if (!alive) return;
        dispatch({ type: "run", run: r });
        if (r.status !== "running" && !doneRef.current) {
          doneRef.current = true;
          void load(); // one last snapshot so the receipt has every final row
        }
      },
      live: (l) => {
        liveRef.current = l;
        if (alive) dispatch({ type: "live", live: l });
      },
    });

    const load = async () => {
      try {
        const snap = await source.load(runId);
        if (!alive) return;
        dispatch({ type: "tasks", tasks: snap.tasks });
        dispatch({ type: "run", run: snap.run });
        dispatch({ type: "loaded" });
        if (snap.run && snap.run.status !== "running") doneRef.current = true;
      } catch (e) {
        if (alive) dispatch({ type: "error", error: (e as Error).message });
      }
    };
    void load();

    // reconcile: fast while realtime is down, slow while it's healthy, stop once the run is over
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!alive) return;
      if (!doneRef.current) void load();
      timer = setTimeout(tick, liveRef.current === "live" ? 6000 : 2000);
    };
    timer = setTimeout(tick, 2500);

    return () => {
      alive = false;
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      unsub();
    };
  }, [runId, source]);

  return state;
}
