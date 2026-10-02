"use client";

// One shared fetch of /api/moves per matter, so the Overview panel and Ask gist cards agree.
import { useEffect, useSyncExternalStore } from "react";
import type { MoveStatus, MovesResult } from "@/lib/server/moves/types";

type State = { data: MovesResult | null; error: string | null };
const EMPTY: State = { data: null, error: null };
const states = new Map<number, State>();
const subs = new Map<number, Set<() => void>>();
const get = (id: number) => states.get(id) ?? EMPTY;
function set(id: number, patch: Partial<State>) {
  states.set(id, { ...get(id), ...patch });
  subs.get(id)?.forEach((f) => f());
}

export async function refreshMoves(matterId: number) {
  try {
    const r = await fetch(`/api/moves?matterId=${matterId}`, { cache: "no-store" });
    const j = (await r.json()) as MovesResult & { error?: string };
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    set(matterId, { data: j, error: null });
  } catch (e) {
    set(matterId, { error: (e as Error).message });
  }
}

/** Optimistic status change; the server is the source of truth on the next refresh. */
export async function setMove(matterId: number, key: string, status: MoveStatus, note?: string) {
  const d = get(matterId).data;
  if (d) {
    const moves = d.moves.map((m) => (m.id === key ? { ...m, status, note: note ?? m.note } : m));
    set(matterId, { data: { ...d, moves } });
  }
  await fetch("/api/moves", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ matterId, key, status, note }),
  }).catch(() => null);
  window.dispatchEvent(new CustomEvent("gist:moves-changed", { detail: { matterId } }));
}

export function useMoves(matterId: number): State {
  const state = useSyncExternalStore(
    (cb) => {
      const s = subs.get(matterId) ?? new Set();
      s.add(cb);
      subs.set(matterId, s);
      return () => s.delete(cb);
    },
    () => get(matterId),
    () => EMPTY,
  );
  useEffect(() => {
    if (!states.has(matterId)) {
      states.set(matterId, EMPTY);
      void refreshMoves(matterId);
    }
  }, [matterId]);
  return state;
}
