"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Citation, Digest } from "@/lib/types";
import SourceDrawer from "@/components/gist/source/SourceDrawer";
import { CiteProvider, numberRefs } from "./cite";
import { FIXTURE_DIGEST, FIXTURE_REJECTED } from "./fixture";
import Header from "./Header";
import PhaseSpine from "./PhaseSpine";
import Money from "./Money";
import { RedFlags, Story } from "./Narrative";
import Actions from "./Actions";
import { Completeness, Injuries, ProviderLanes, SinceRail } from "./Detail";
import AskPalette from "./AskPalette";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; digest: Digest; fixture: boolean };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} on ${url}`);
  return (await r.json()) as T;
}

/** Picks a matter id from GET /api/matter, tolerant of `[...]`, `{ matters: [...] }` or `{ items: [...] }`. */
async function firstMatterId(): Promise<number> {
  const j = await getJson<unknown>("/api/matter");
  const list = Array.isArray(j) ? j : ((j as { matters?: unknown[]; items?: unknown[] }).matters ?? (j as { items?: unknown[] }).items ?? []);
  const m = list[0] as { id?: number; matter_id?: number } | undefined;
  const id = m?.id ?? m?.matter_id;
  if (id == null) throw new Error("No matters synced yet");
  return id;
}

function Loading() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="gd-wrap gd-loading">
      <div className="gd-kicker">Opening the file{t > 2 ? ` · ${t}s` : ""}</div>
      <div className="gd-skel gd-skel--title" />
      <div className="gd-skel gd-skel--bar" />
      <div className="gd-skel gd-skel--block" />
    </div>
  );
}

const NAV = [
  ["phase", "Phase"],
  ["money", "Money"],
  ["story", "Story"],
  ["flags", "Red flags"],
  ["actions", "Action"],
  ["providers", "Treatment"],
  ["receipt", "Receipt"],
] as const;

export default function Dashboard({ matterId: givenId, fixture: givenFixture }: { matterId?: number; fixture?: boolean }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [cite, setCite] = useState<Citation | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams(window.location.search);
    const fixture = givenFixture ?? params.get("fixture") === "1";
    if (fixture) {
      setLoad({ state: "ready", digest: FIXTURE_DIGEST, fixture: true });
      return;
    }
    (async () => {
      try {
        const qid = params.get("id");
        const id = givenId ?? (qid ? Number(qid) : await firstMatterId());
        // Show the last digest from this tab instantly while the fresh one loads (session only).
        const key = `gist:digest:${id}`;
        try {
          const cached = sessionStorage.getItem(key);
          if (cached && live) setLoad({ state: "ready", digest: JSON.parse(cached) as Digest, fixture: false });
        } catch {}
        const raw = await getJson<Digest | { digest: Digest }>(`/api/matter/${id}/digest`);
        const digest = "digest" in raw ? raw.digest : raw;
        if (live) setLoad({ state: "ready", digest, fixture: false });
        try {
          sessionStorage.setItem(key, JSON.stringify(digest));
        } catch {}
      } catch (e) {
        if (live) setLoad((prev) => (prev.state === "ready" ? prev : { state: "error", message: (e as Error).message }));
      }
    })();
    return () => {
      live = false;
    };
  }, [givenId, givenFixture]);

  const digest = load.state === "ready" ? load.digest : null;
  const fixture = load.state === "ready" && load.fixture;
  const refNums = useMemo(() => numberRefs(digest), [digest]);
  const extra = useRef(new Map<string, number>());
  const numberOf = useCallback(
    (ref: string) => {
      const n = refNums.get(ref) ?? extra.current.get(ref);
      if (n) return n;
      const next = refNums.size + extra.current.size + 1;
      extra.current.set(ref, next);
      return next;
    },
    [refNums],
  );
  const close = useCallback(() => setCite(null), []);
  const ctx = useMemo(() => ({ matterId: digest?.matter.id ?? null, fixture, numberOf, open: setCite }), [digest, fixture, numberOf]);

  const rejected = useMemo(() => {
    if (!digest) return [];
    const fromFacts = digest.top_facts.filter((f) => f.status === "rejected").map((f) => ({ summary: f.summary, reason: f.reject_reason ?? "Rejected" }));
    return fromFacts.length ? fromFacts : fixture ? FIXTURE_REJECTED : [];
  }, [digest, fixture]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    const sc = scroller.current;
    if (el && sc) sc.scrollTo({ top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 72, behavior: "smooth" });
  };

  return (
    <div className="gd-root" ref={scroller} data-lenis-prevent>
      {load.state === "loading" ? (
        <Loading />
      ) : null}
      {load.state === "error" ? (
        <div className="gd-wrap gd-errorbox">
          <div className="gd-kicker">Digest unavailable</div>
          <p>{load.message}</p>
        </div>
      ) : null}
      {digest ? (
        <CiteProvider value={ctx}>
          <div className="gd-wrap">
            <Header d={digest} fixture={fixture} />
            <nav className="gd-nav" aria-label="Sections">
              <div className="gd-nav__links">
                {NAV.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => jump(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <AskPalette matterId={digest.matter.id} fixture={fixture} />
            </nav>
            <div className="gd-layout">
              <div className="gd-main">
                <PhaseSpine d={digest} />
                <div className="gd-duo">
                  <Money d={digest} />
                  <Story d={digest} />
                </div>
                <RedFlags d={digest} />
                <Actions d={digest} />
                <ProviderLanes d={digest} />
                <Completeness d={digest} rejected={rejected} />
              </div>
              <div className="gd-rail">
                <SinceRail d={digest} />
                <Injuries d={digest} />
              </div>
            </div>
            <footer className="gd-foot">Drafted for attorney review · Reads Clio, writes nothing · Every figure links to its source</footer>
          </div>
          <SourceDrawer cite={cite} matterId={digest.matter.id} fixture={fixture} onClose={close} />
        </CiteProvider>
      ) : null}
    </div>
  );
}
