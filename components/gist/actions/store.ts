"use client";

// One shared fetch of /api/actions per matter, so the drafts panel and the gate-row chips agree.
import { useEffect, useSyncExternalStore } from "react";
import type { AgentAction } from "@/lib/server/actions/types";

type State = { rows: AgentAction[] | null; busy: boolean; error: string | null };
const EMPTY: State = { rows: null, busy: false, error: null };
const states = new Map<number, State>();
const subs = new Map<number, Set<() => void>>();

const get = (id: number) => states.get(id) ?? EMPTY;
function set(id: number, patch: Partial<State>) {
  states.set(id, { ...get(id), ...patch });
  subs.get(id)?.forEach((f) => f());
}

export async function refresh(matterId: number) {
  try {
    const r = await fetch(`/api/actions?matterId=${matterId}`, { cache: "no-store" });
    const j = (r.ok ? await r.json() : { actions: [] }) as { actions?: AgentAction[] };
    set(matterId, { rows: j.actions ?? [] });
  } catch {
    set(matterId, { rows: get(matterId).rows ?? [] });
  }
}

export async function propose(matterId: number) {
  set(matterId, { busy: true, error: null });
  try {
    const r = await fetch("/api/actions/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterId }),
    });
    const j = (await r.json()) as { actions?: AgentAction[]; error?: string };
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    set(matterId, { rows: j.actions ?? [], busy: false });
  } catch (e) {
    set(matterId, { busy: false, error: (e as Error).message });
  }
}

export async function patch(matterId: number, id: string, p: Partial<Pick<AgentAction, "status" | "subject" | "body">>) {
  const rows = get(matterId).rows ?? [];
  set(matterId, { rows: rows.map((r) => (r.id === id ? { ...r, ...p, edited: r.edited || p.body != null || p.subject != null } : r)) });
  await fetch("/api/actions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...p }),
  }).catch(() => null);
}

export function useActions(matterId: number | null): State {
  const id = matterId ?? 0;
  const state = useSyncExternalStore(
    (cb) => {
      const s = subs.get(id) ?? new Set();
      s.add(cb);
      subs.set(id, s);
      return () => s.delete(cb);
    },
    () => get(id),
    () => EMPTY,
  );
  useEffect(() => {
    if (matterId && !states.has(matterId)) {
      states.set(matterId, EMPTY);
      void refresh(matterId);
    }
  }, [matterId]);
  return state;
}

/** Scrolls the dashboard to a draft card and flashes it. */
export function focusDraft(id: string) {
  const el = document.getElementById(`draft-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("is-flash");
  void el.offsetWidth;
  el.classList.add("is-flash");
}
