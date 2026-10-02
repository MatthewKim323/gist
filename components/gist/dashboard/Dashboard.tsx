"use client";

import Button from "@/components/gist/ui/Button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShareSheet } from "@/components/gist/share";
import type { Citation, Digest } from "@/lib/types";
import SourceDrawer from "@/components/gist/source/SourceDrawer";
import { CiteProvider, numberRefs, useCites } from "./cite";
import { FIXTURE_DIGEST, FIXTURE_REJECTED } from "./fixture";
import Header from "./Header";
import PhaseSpine from "./PhaseSpine";
import Money from "./Money";
import { RedFlags, Story } from "./Narrative";
import Actions from "./Actions";
import { Completeness, Injuries, ProviderLanes, SinceRail } from "./Detail";
import AskPalette from "./AskPalette";
import ShareLog from "./ShareLog";
import SubmissionsInbox from "@/components/gist/submissions/Inbox";
import AgentDrafts from "@/components/gist/actions/AgentDrafts";
import { FactsFunnel, MoneyBars } from "./Charts";
import Brief from "./Brief";
import NextMoves from "@/components/gist/moves/NextMoves";
import { AnimatePresence, motion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Bone01Icon,
  DashboardSquare01Icon,
  FileEditIcon,
  InboxDownloadIcon,
  Invoice01Icon,
  MoneyBag02Icon,
  Route02Icon,
  Share08Icon,
  Stethoscope02Icon,
  Task01Icon,
  Link04Icon,
  Layers01Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { fmtUsd, initials } from "./format";
import SessionChip from "@/components/gist/auth/SessionChip";
import { AssistantDock } from "@/components/gist/assistant/AssistantDock";

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

// The sidebar: one tab per part of the case, grouped the way an attorney walks a file.
type TabId =
  | "overview"
  | "phase"
  | "money"
  | "flags"
  | "actions"
  | "drafts"
  | "treatment"
  | "injuries"
  | "inbox"
  | "shares"
  | "receipt";
type IconT = typeof DashboardSquare01Icon;
const TABS: { group: string; items: { id: TabId; label: string; icon: IconT }[] }[] = [
  {
    group: "Case",
    items: [
      { id: "overview", label: "Overview", icon: DashboardSquare01Icon },
      { id: "phase", label: "Phase & gates", icon: Route02Icon },
      { id: "money", label: "Money", icon: MoneyBag02Icon },
      { id: "flags", label: "Red flags", icon: Alert02Icon },
    ],
  },
  {
    group: "Work",
    items: [
      { id: "actions", label: "Next actions", icon: Task01Icon },
      { id: "drafts", label: "Agent drafts", icon: FileEditIcon },
      { id: "treatment", label: "Treatment", icon: Stethoscope02Icon },
      { id: "injuries", label: "Injuries", icon: Bone01Icon },
    ],
  },
  {
    group: "Providers",
    items: [
      { id: "inbox", label: "From providers", icon: InboxDownloadIcon },
      { id: "shares", label: "Shares", icon: Share08Icon },
    ],
  },
  { group: "Audit", items: [{ id: "receipt", label: "Receipt", icon: Invoice01Icon }] },
];
const ALL_TABS = TABS.flatMap((g) => g.items);
const isTab = (x: string): x is TabId => ALL_TABS.some((t) => t.id === x);

export default function Dashboard({ matterId: givenId, fixture: givenFixture }: { matterId?: number; fixture?: boolean }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [cite, setCite] = useState<Citation | null>(null);
  const [share, setShare] = useState<{ providerId?: number } | null>(null);
  const [shareKey, setShareKey] = useState(0);
  const openShare = useCallback((providerId?: number | null) => {
    setCite(null);
    setShare({ providerId: providerId ?? undefined });
    setShareKey((k) => k + 1);
  }, []);
  const closeShare = useCallback(() => setShare(null), []);
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
  const ctx = useMemo(() => ({ matterId: digest?.matter.id ?? null, fixture, numberOf, open: setCite, share: openShare }), [digest, fixture, numberOf, openShare]);

  const rejected = useMemo(() => {
    if (!digest) return [];
    const fromFacts = digest.top_facts.filter((f) => f.status === "rejected").map((f) => ({ summary: f.summary, reason: f.reject_reason ?? "Rejected" }));
    return fromFacts.length ? fromFacts : fixture ? FIXTURE_REJECTED : [];
  }, [digest, fixture]);

  // tab lives in the hash so a refresh or a shared link reopens the same section
  const [tab, setTab] = useState<TabId>("overview");
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (isTab(h)) setTab(h);
  }, []);
  const go = useCallback((id: TabId) => {
    setTab(id);
    window.history.replaceState(window.history.state, "", `#${id}`);
    scroller.current?.scrollTo({ top: 0 });
  }, []);
  // panels can ask for another tab (a "Draft ready" chip on a gate row opens Drafts, then focuses the draft)
  useEffect(() => {
    const on = (e: Event) => {
      const { tab: want, then } = (e as CustomEvent<{ tab: string; then?: () => void }>).detail ?? {};
      if (!want || !isTab(want)) return;
      go(want);
      if (then) setTimeout(then, 450);
    };
    window.addEventListener("gist:open-tab", on);
    return () => window.removeEventListener("gist:open-tab", on);
  }, [go]);
  // anything outside the cite context (the Ask gist dock) can open the source drawer by ref
  useEffect(() => {
    const on = (e: Event) => {
      const { ref, quote, label } = (e as CustomEvent<{ ref?: string; quote?: string; label?: string }>).detail ?? {};
      if (ref) setCite({ source_ref: ref, quote, label });
    };
    window.addEventListener("gist:open-cite", on);
    return () => window.removeEventListener("gist:open-cite", on);
  }, []);

  return (
    <div className="gd-root gd-app" data-lenis-prevent>
      {load.state === "loading" ? <Loading /> : null}
      {load.state === "error" ? (
        <div className="gd-wrap gd-errorbox">
          <div className="gd-kicker">Digest unavailable</div>
          <p>{load.message}</p>
          <a
            className="gd-side__link"
            style={{ display: "inline-flex", marginTop: 16, padding: "0 16px" }}
            href="/cases"
            onClick={(e) => {
              e.preventDefault();
              window.location.assign("/cases");
            }}
          >
            Back to all cases
          </a>
        </div>
      ) : null}
      {digest ? (
        <CiteProvider value={ctx}>
          <Sidebar d={digest} fixture={fixture} tab={tab} go={go} />
          <div className="gd-body" ref={scroller}>
            <div className="gd-top">
              <div className="gd-crumbs">
                <span>Cases</span>
                <span className="gd-crumbs__sep">/</span>
                <span>{digest.matter.display_number}</span>
                <span className="gd-crumbs__sep">/</span>
                <span className="gd-crumbs__here">{ALL_TABS.find((t) => t.id === tab)?.label}</span>
              </div>
              <div className="gd-top__actions">
                <AskPalette matterId={digest.matter.id} fixture={fixture} />
              </div>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.main
                key={tab}
                className={`gd-view gd-view--${tab}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <Panel tab={tab} d={digest} fixture={fixture} rejected={rejected} />
              </motion.main>
            </AnimatePresence>
            <footer className="gd-foot">Drafted for attorney review · Reads Clio, writes nothing · Every figure links to its source</footer>
          </div>
          <SourceDrawer cite={cite} matterId={digest.matter.id} fixture={fixture} onClose={close} />
          {fixture ? null : <AssistantDock matterId={digest.matter.id} tab={tab} caseName={digest.matter.client_name} />}
          {share && !fixture
            ? createPortal(
                <ShareSheet key={shareKey} matterId={digest.matter.id} open onClose={closeShare} initialProviderId={share.providerId} />,
                document.body,
              )
            : null}
        </CiteProvider>
      ) : null}
    </div>
  );
}

function Panel({ tab, d, fixture, rejected }: { tab: TabId; d: Digest; fixture: boolean; rejected: { summary: string; reason: string }[] }) {
  switch (tab) {
    case "overview":
      return (
        <>
          <Header d={d} fixture={fixture} />
          <NextMoves matterId={d.matter.id} compact />
          <Brief d={d} />
        </>
      );
    case "phase":
      return <PhaseSpine d={d} />;
    case "money":
      return (
        <>
          <Money d={d} />
          <MoneyBars d={d} />
        </>
      );
    case "flags":
      return <RedFlags d={d} />;
    case "actions":
      return <Actions d={d} />;
    case "drafts":
      return <AgentDrafts matterId={d.matter.id} digest={d} fixture={fixture} />;
    case "treatment":
      return <ProviderLanes d={d} />;
    case "injuries":
      return <Injuries d={d} />;
    case "inbox":
      return <SubmissionsInbox matterId={d.matter.id} fixture={fixture} />;
    case "shares":
      return <ShareLog matterId={d.matter.id} fixture={fixture} />;
    case "receipt":
      return (
        <>
          <FactsFunnel d={d} />
          <Completeness d={d} rejected={rejected} />
        </>
      );
  }
}

function Sidebar({ d, fixture, tab, go }: { d: Digest; fixture: boolean; tab: TabId; go: (id: TabId) => void }) {
  const m = d.matter;
  const { share } = useCites();
  const [photoOk, setPhotoOk] = useState(true);
  const photo = fixture ? null : m.photo_url;
  return (
    <aside className="gd-side">
      <a
        className="gd-side__brand"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          window.location.assign("/");
        }}
      >
        gistOS.
      </a>
      <CaseSwitcher d={d} photo={photo && photoOk ? photo : null} onPhotoError={() => setPhotoOk(false)} />
      <nav className="gd-side__nav" aria-label="Case sections">
        {TABS.map((g) => (
          <div className="gd-side__group" key={g.group}>
            <div className="gd-side__label">{g.group}</div>
            {g.items.map((t) => (
              <button
                key={t.id}
                type="button"
                className="gd-side__item"
                data-active={tab === t.id ? "" : undefined}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => go(t.id)}
              >
                {tab === t.id ? <motion.span layoutId="gd-side-active" className="gd-side__active" transition={{ type: "spring", stiffness: 520, damping: 42 }} /> : null}
                <HugeiconsIcon icon={t.icon} size={16} strokeWidth={1.6} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="gd-side__foot">
        {fixture ? null : (
          <button type="button" className="gd-side__cta" onClick={() => share()}>
            Share with provider
          </button>
        )}
        <div className="gd-side__icons">
          {m.clio_url ? (
            <a className="gd-side__icon" href={m.clio_url} target="_blank" rel="noreferrer" title="Open in Clio">
              <HugeiconsIcon icon={Link04Icon} size={17} strokeWidth={1.85} />
            </a>
          ) : null}
          <a
            className="gd-side__icon"
            href="/cases"
            title="All cases"
            onClick={(e) => {
              e.preventDefault();
              window.location.assign("/cases");
            }}
          >
            <HugeiconsIcon icon={Layers01Icon} size={17} strokeWidth={1.85} />
          </a>
          <span className="gd-side__icon gd-side__icon--cost" title={d.cost.models.join(" · ")}>
            {fmtUsd(d.cost.last_run_usd, { cents: true })}
          </span>
          <SessionChip className="gd-side__profile" />
        </div>
        <div className="gd-side__ro">
          {fmtUsd(d.cost.cold_usd, { cents: true })} to digest · reads Clio, writes nothing
        </div>
      </div>
    </aside>
  );
}

type CaseRow = { id: number; display_number: string; client_name: string | null; stage: string | null; is_demo?: boolean };

/** Top of the sidebar: the open case, and a menu of the firm's other cases (GET /api/cases). */
function CaseSwitcher({ d, photo, onPhotoError }: { d: Digest; photo: string | null; onPhotoError: () => void }) {
  const m = d.matter;
  const [open, setOpen] = useState(false);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || cases) return;
    fetch("/api/cases", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { matters?: CaseRow[] } | null) => setCases(j?.matters ?? []))
      .catch(() => setCases([]));
  }, [open, cases]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const goTo = (url: string) => window.location.assign(url);
  return (
    <div className="gd-switch" ref={box}>
      <button type="button" className="gd-side__matter" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <div className="gd-side__avatar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo ? <img src={photo} alt={m.client_name} onError={onPhotoError} /> : <span>{initials(m.client_name)}</span>}
        </div>
        <div className="gd-side__who">
          <div className="gd-side__name">{m.client_name}</div>
          <div className="gd-side__sub">
            {m.display_number} · <span className="gd-side__stage">{m.stage}</span>
          </div>
        </div>
        <HugeiconsIcon icon={UnfoldMoreIcon} size={15} strokeWidth={1.8} className="gd-switch__chev" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="gd-switch__menu"
            role="menu"
            initial={{ opacity: 0, y: -5, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.135, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="gd-switch__label">Your cases</div>
            {cases === null ? <div className="gd-switch__empty">Loading…</div> : null}
            {cases?.map((c) => {
              const here = c.id === m.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  className="gd-switch__item"
                  data-active={here ? "" : undefined}
                  onClick={() => (here ? setOpen(false) : goTo(`/matter?view=digest&id=${c.id}${window.location.hash}`))}
                >
                  <span className="gd-switch__name">
                    {c.client_name ?? c.display_number}
                    {c.is_demo ? <span className="gd-switch__demo">Demo</span> : null}
                  </span>
                  <span className="gd-switch__meta">
                    {c.display_number}
                    {c.stage ? ` · ${c.stage}` : ""}
                  </span>
                  {here ? <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} className="gd-switch__tick" /> : null}
                </button>
              );
            })}
            <div className="gd-switch__sep" />
            <button type="button" role="menuitem" className="gd-switch__item gd-switch__all" onClick={() => goTo("/cases")}>
              <span className="gd-switch__name">All cases</span>
              <span className="gd-switch__meta">Connect Clio, sync and digest</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
