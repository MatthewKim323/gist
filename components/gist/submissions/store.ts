"use client";

// One shared fetch of /api/submissions per matter, so the inbox panel and the gate-row badges agree.
import { useEffect, useSyncExternalStore } from "react";
import type { FirmSubmission, SubmissionStatus } from "./types";

type State = { rows: FirmSubmission[] | null };
const states = new Map<number, State>();
const subs = new Map<number, Set<() => void>>();
const EMPTY: State = { rows: null };

function emit(id: number) {
  subs.get(id)?.forEach((f) => f());
}

export async function refresh(matterId: number) {
  try {
    const r = await fetch(`/api/submissions?matterId=${matterId}`, { cache: "no-store" });
    const j = (r.ok ? await r.json() : { submissions: [] }) as { submissions?: FirmSubmission[] };
    states.set(matterId, { rows: j.submissions ?? [] });
  } catch {
    states.set(matterId, { rows: states.get(matterId)?.rows ?? [] });
  }
  emit(matterId);
}

export async function setStatus(matterId: number, id: string, status: SubmissionStatus) {
  const cur = states.get(matterId)?.rows ?? [];
  states.set(matterId, { rows: cur.map((s) => (s.id === id ? { ...s, status } : s)) });
  emit(matterId);
  await fetch("/api/submissions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, status }),
  }).catch(() => null);
  await refresh(matterId);
}

const pollers = new Map<number, { n: number; t: ReturnType<typeof setInterval> }>();

export function useSubmissions(matterId: number | null, enabled = true): FirmSubmission[] | null {
  const id = matterId ?? 0;
  const state = useSyncExternalStore(
    (cb) => {
      const set = subs.get(id) ?? new Set();
      set.add(cb);
      subs.set(id, set);
      return () => set.delete(cb);
    },
    () => states.get(id) ?? EMPTY,
    () => EMPTY,
  );
  useEffect(() => {
    if (!matterId || !enabled) return;
    const p = pollers.get(matterId);
    if (p) p.n++;
    else {
      void refresh(matterId);
      pollers.set(matterId, { n: 1, t: setInterval(() => void refresh(matterId), 20000) });
    }
    return () => {
      const q = pollers.get(matterId);
      if (!q) return;
      if (--q.n <= 0) {
        clearInterval(q.t);
        pollers.delete(matterId);
      }
    };
  }, [matterId, enabled]);
  return state.rows;
}
