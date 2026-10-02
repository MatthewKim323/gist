"use client";
// The loading experience on /matter: one vertical-timeline node per pipeline stage, revealed as each stage
// starts, with a live tile per agent_tasks row. Everything on screen is read from agent_runs / agent_tasks;
// nothing is estimated. When the run is done it shows a short "case digested" beat, then calls onComplete
// once (the engine session seam-wipes into the dashboard from there).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { VerticalTimeline, VerticalTimelineElement } from "react-vertical-timeline-component";
import "react-vertical-timeline-component/style.min.css";
import Lenis from "lenis";
import "@/app/styles/gist-pipeline.css";
import type { AgentRole, AgentTask } from "@/lib/types";
import DecryptedText from "./DecryptedText";
import Waves from "./Waves";
import Pilot from "@/components/gist/pilot/Pilot";
import ThoughtLine from "@/components/gist/thought/ThoughtLine";
import type { PipelineSource } from "./source";
import { usePipelineRun } from "./usePipelineRun";
import {
  deriveCounters,
  deriveStages,
  fmtDur,
  fmtInt,
  fmtUsd,
  isSkipped,
  type AgentRun,
  type RunCounters,
  type StageView,
} from "./stages";

export interface PipelineTimelineProps {
  runId: string;
  /** Fired exactly once, after the run is done and the "case digested" beat has played. */
  onComplete: () => void;
  /** Fired once if the run ends as failed. The timeline stays up showing what failed. */
  onFailed?: (run: AgentRun) => void;
  /** Data source. Defaults to Supabase (anon key + Realtime). The preview page passes a simulated one. */
  source?: PipelineSource;
  /** How long the "case digested" beat holds before onComplete (ms). */
  doneBeatMs?: number;
  /** Draw the moving line field behind the timeline. */
  waves?: boolean;
  className?: string;
}

const REVEAL_GAP_MS = 320;
const FIRST_REVEAL_MS = 700;
const DENSE_AT = 18;

export default function PipelineTimeline({
  runId,
  onComplete,
  onFailed,
  source,
  doneBeatMs = 2600,
  waves = true,
  className = "",
}: PipelineTimelineProps) {
  const state = usePipelineRun(runId, source);
  const { run } = state;
  const tasks = useMemo(() => [...state.tasks.values()], [state.tasks]);
  const stages = useMemo(() => deriveStages(tasks, run), [tasks, run]);
  const counters = useMemo(() => deriveCounters(stages, run), [stages, run]);
  const runOver = run?.status === "done" || run?.status === "failed";
  const allCached = counters.tasks > 0 && counters.cachedTasks === counters.tasks;

  // ---- presentation pacing: a floor on how long each stage holds the screen, so the pilot can perch,
  // scan and react on every stage even when a cached run lands all at once. It only paces the REVEAL of
  // real rows (tiles, counters, costs are always what agent_tasks says); on a cold run slower than the floor
  // it adds nothing. ?pace=<ms> or NEXT_PUBLIC_TIMELINE_MIN_STAGE_MS tunes it, 0 turns it off; Esc / Skip
  // jumps to the end.
  const [paceMs, setPaceMs] = useState(() => {
    const env = Number(process.env.NEXT_PUBLIC_TIMELINE_MIN_STAGE_MS);
    return Number.isFinite(env) && process.env.NEXT_PUBLIC_TIMELINE_MIN_STAGE_MS ? env : 6000;
  });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("pace");
    if (q !== null && Number.isFinite(Number(q))) setPaceMs(Math.max(0, Number(q)));
  }, []);
  const [skipped, setSkipped] = useState(false);
  const pace = skipped ? 0 : paceMs;
  const lastRevealAt = useRef(0);
  const [dwellRole, setDwellRole] = useState<AgentRole | null>(null);

  // ---- staggered reveal: a stage's node appears once it has a row, one at a time ----
  const [revealed, setRevealed] = useState<AgentRole[]>([]);
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = performance.now();
  }, [runId]);
  useEffect(() => setRevealed([]), [runId]);
  const pendingRoles = stages.map((s) => s.def.role).filter((r) => !revealed.includes(r));
  const nextRole = pendingRoles[0];
  useEffect(() => {
    if (!nextRole) return;
    const sinceMount = performance.now() - mountedAt.current;
    // faster cadence when a whole cached run lands at once, so the demo moment stays snappy
    const base = revealed.length === 0 ? Math.max(0, FIRST_REVEAL_MS - sinceMount) : allCached ? 180 : REVEAL_GAP_MS;
    const floor = revealed.length === 0 ? 0 : pace - (performance.now() - lastRevealAt.current);
    const t = setTimeout(() => {
      lastRevealAt.current = performance.now();
      setRevealed((r) => (r.includes(nextRole) ? r : [...r, nextRole]));
      setDwellRole(pace > 0 ? nextRole : null);
    }, Math.max(base, floor));
    return () => clearTimeout(t);
  }, [nextRole, revealed.length, allCached, pace]);
  // the newest stage holds the screen for its dwell; the pilot reads it during that time
  useEffect(() => {
    if (!dwellRole) return;
    const left = pace - (performance.now() - lastRevealAt.current);
    if (left <= 0) return setDwellRole(null);
    const t = setTimeout(() => setDwellRole(null), left);
    return () => clearTimeout(t);
  }, [dwellRole, pace]);
  const allRevealed = stages.length > 0 && pendingRoles.length === 0;

  // ---- case totals: counters show what the case IS (from the digest), not only what this run newly paid
  // for, so a cached reopen doesn't read as dead zeros. Each total switches in when the stage that produces
  // it is revealed; "spent" stays this run's real cost, the first cold digest cost sits beside it.
  const [caseTotals, setCaseTotals] = useState<CaseTotals | null>(null);
  const matterId = (run as { matter_id?: number } | null)?.matter_id;
  useEffect(() => {
    // the simulated source has no real case behind it; real and replayed runs do
    if (!matterId || (source && !("replayInfo" in source))) return;
    let live = true;
    fetch(`/api/matter/${matterId}/digest?peek=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const d = j && ("digest" in j ? j.digest : j);
        if (!live || !d?.completeness) return;
        const c = d.completeness;
        setCaseTotals({
          entries: c.entries_read,
          entriesTotal: c.entries_total,
          pages: c.pages_read,
          pagesTotal: c.pages_total,
          facts: c.facts_verified + c.facts_rejected + c.facts_review,
          rejected: c.facts_rejected,
          coldUsd: Number(d.cost?.cold_usd ?? 0),
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [matterId, source]);
  useEffect(() => {
    if (runOver && allRevealed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSkipped(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runOver, allRevealed]);

  // ---- completion beat ----
  const digested = run?.status === "done" && allRevealed && state.loaded && !dwellRole;
  const failed = run?.status === "failed";
  const [finalShown, setFinalShown] = useState(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const failedRef = useRef(onFailed);
  failedRef.current = onFailed;
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!digested) return;
    const t1 = setTimeout(() => setFinalShown(true), REVEAL_GAP_MS);
    if (firedRef.current === runId) return () => clearTimeout(t1);
    const t2 = setTimeout(() => {
      if (firedRef.current === runId) return;
      firedRef.current = runId;
      completeRef.current();
    }, REVEAL_GAP_MS + (skipped ? 700 : doneBeatMs));
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [digested, runId, doneBeatMs, skipped]);
  useEffect(() => {
    if (failed && run && allRevealed && firedRef.current !== runId) {
      firedRef.current = runId;
      failedRef.current?.(run);
    }
  }, [failed, run, allRevealed, runId]);
  useEffect(() => setFinalShown(false), [runId]);

  // ---- live clock for running stages (real elapsed time, stops when the run ends) ----
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (runOver) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [runOver]);

  // ---- line draw: the spine grows to the newest node ----
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserScroll = useRef(0);
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const tl = wrap.querySelector<HTMLElement>(".vertical-timeline");
    const icons = wrap.querySelectorAll<HTMLElement>(".gp-node.is-on .vertical-timeline-element-icon");
    if (!tl) return;
    const last = icons[icons.length - 1];
    if (!last) {
      wrap.style.setProperty("--gp-line", "0px");
      return;
    }
    const top = tl.getBoundingClientRect().top;
    const r = last.getBoundingClientRect();
    wrap.style.setProperty("--gp-line", `${Math.max(0, r.top - top + r.height / 2)}px`);
  }, []);
  const shownCount = revealed.length + (finalShown ? 1 : 0);
  useLayoutEffect(() => {
    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [shownCount, measure]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [measure]);

  // ---- follow the newest node unless the user is scrolling themselves ----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mark = () => (lastUserScroll.current = performance.now());
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("touchmove", mark, { passive: true });
    el.addEventListener("keydown", mark);
    return () => {
      el.removeEventListener("wheel", mark);
      el.removeEventListener("touchmove", mark);
      el.removeEventListener("keydown", mark);
    };
  }, []);
  // weighted scroll: Lenis smooths the wheel with inertia, and every new node carries the view down with a
  // slow-fast-slow curve whose length scales with the distance, so the page moves like one camera.
  const contentRef = useRef<HTMLDivElement>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const carryUntil = useRef(0);
  useEffect(() => {
    const wrapper = scrollRef.current;
    const content = contentRef.current;
    if (!wrapper || !content || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ wrapper, content, autoRaf: true, lerp: 0.075, wheelMultiplier: 0.9 });
    lenisRef.current = lenis;
    return () => {
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!shownCount) return;
    if (performance.now() - lastUserScroll.current < 5000) return;
    // wait for the card's rise to start so the carry and the reveal read as one move
    const t = setTimeout(() => {
      const sc = scrollRef.current;
      const nodes = wrapRef.current?.querySelectorAll<HTMLElement>(".gp-node.is-on");
      const last = nodes?.[nodes.length - 1];
      if (!sc || !last) return;
      const target = Math.max(0, last.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - sc.clientHeight * 0.32);
      const dist = Math.abs(target - sc.scrollTop);
      if (dist < 4) return;
      const lenis = lenisRef.current;
      if (!lenis) return sc.scrollTo({ top: target });
      // a node that lands mid-carry continues the move already in flight (no second slow start)
      const moving = performance.now() < carryUntil.current;
      const duration = Math.min(2.6, 1.15 + dist / 1100);
      carryUntil.current = performance.now() + duration * 1000;
      lenis.scrollTo(target, { duration, easing: moving ? settle : carry, lock: false });
    }, 160);
    return () => clearTimeout(t);
  }, [shownCount]);

  const status: "waiting" | "running" | "done" | "failed" = failed
    ? "failed"
    : digested
      ? "done"
      : stages.length
        ? "running"
        : "waiting";

  return (
    <div className={`gp ${className}`} ref={rootRef} data-status={status} data-cached={allCached ? "" : undefined}>
      {waves && <Waves />}
      <Pilot rootRef={rootRef} />
      <div className="gp-scroll" ref={scrollRef} tabIndex={-1}>
        <div className="gp-scroll__content" ref={contentRef}>
        <header className="gp-head">
          <div className="gp-kicker">
            <span className={`gp-live gp-live--${state.live}`} />
            <span>{liveLabel(state.live, runOver)}</span>
            <span className="gp-kicker__sep">/</span>
            {(source as { replayInfo?: { runId: string; recordedAt: string | null } | null } | undefined)?.replayInfo ? (
              <span>
                replay of run {runId.slice(0, 8)}
                {(() => {
                  const at = (source as unknown as { replayInfo: { recordedAt: string | null } }).replayInfo.recordedAt;
                  return at ? ` · recorded ${new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
                })()}
              </span>
            ) : (
              <span>run {runId.slice(0, 8)}</span>
            )}
          </div>
          <h1 className="gp-title">
            <DecryptedText text={status === "done" ? "case digested" : "digesting the case"} animateOn="mount" speed={42} />
          </h1>
          <p className="gp-sub">
            {allCached
              ? "Nothing changed since the last read, so every agent is answering from cache."
              : "Every agent, live. We read every page, we don't sample."}
          </p>
        </header>
        {pace > 0 && !digested && !failed && stages.length > 0 ? (
          <button type="button" className="gp-skip" onClick={() => setSkipped(true)}>
            Skip to the case <kbd>Esc</kbd>
          </button>
        ) : null}
        <div className="gp-counters-wrap">
          <Counters c={counters} cached={allCached} totals={caseTotals} revealed={revealed} stageCount={stages.length} done={digested} />
        </div>

        <div className="gp-tl" ref={wrapRef}>
          {stages.length === 0 && (
            <div className="gp-waiting">
              {state.error ? `Couldn't reach the run: ${state.error}` : run ? "Waiting for the first agent to report in" : "Connecting to the run"}
              <span className="gp-dots" />
            </div>
          )}
          <VerticalTimeline lineColor="transparent" animate>
            {stages.map((s, i) => (
              <StageNode
                key={s.def.role}
                stage={s}
                on={revealed.includes(s.def.role)}
                dwell={dwellRole === s.def.role}
                now={now}
                side={i % 2 === 0 ? "right" : "left"}
              />
            ))}
            {(finalShown || failed) && (
              <FinalNode c={counters} failed={failed} cached={allCached} on={finalShown || failed} side={stages.length % 2 === 0 ? "right" : "left"} />
            )}
          </VerticalTimeline>
        </div>
        </div>
      </div>
    </div>
  );
}

/** Quartic in-out: slow start, fast middle, slow settle. */
function carry(t: number) {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/** Quartic out: keeps the speed it inherits and only settles. */
function settle(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

function liveLabel(l: string, over: boolean) {
  if (over) return "run finished";
  if (l === "live") return "live";
  if (l === "polling") return "reconnecting, polling";
  return "connecting";
}

// ------------------------------------------------------------------------------------------------

interface CaseTotals {
  entries: number;
  entriesTotal: number;
  pages: number;
  pagesTotal: number;
  facts: number;
  rejected: number;
  coldUsd: number;
}

/** Eases a number toward its target (700ms, out-cubic). Display only; the target is always a real value. */
function useCountUp(target: number) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const next = a + (target - a) * (1 - Math.pow(1 - k, 3));
      from.current = next;
      setV(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

function Counters({
  c,
  cached,
  totals,
  revealed,
  stageCount,
  done,
}: {
  c: RunCounters;
  cached: boolean;
  totals: CaseTotals | null;
  revealed: AgentRole[];
  stageCount: number;
  done: boolean;
}) {
  const on = (r: AgentRole) => revealed.includes(r);
  const entries = useCountUp(Math.max(c.entries.n, totals && on("sync") ? totals.entries : 0));
  const pages = useCountUp(Math.max(c.pages.n, totals && on("ocr") ? totals.pages : 0));
  const facts = useCountUp(Math.max(c.factsEmitted, totals && on("extract") ? totals.facts : 0));
  const rejects = useCountUp(Math.max(c.rejected, totals && on("verify") ? totals.rejected : 0));
  const jev = useCountUp(c.jevChecks);
  // first cold digest of this case, filled in as the stages land; exact once the run is done
  const coldShown = totals ? (done || !stageCount ? totals.coldUsd : totals.coldUsd * (revealed.length / stageCount)) : 0;
  const cold = useCountUp(coldShown);
  const entriesOf = c.entries.of ?? totals?.entriesTotal ?? null;
  const pagesOf = c.pages.of ?? totals?.pagesTotal ?? null;
  const cells: { k: string; v: string; sub?: string; note?: string }[] = [
    { k: "entries read", v: fmtInt(Math.round(entries)), sub: entriesOf ? `of ${fmtInt(entriesOf)}` : undefined },
    { k: "pages read", v: fmtInt(Math.round(pages)), sub: pagesOf ? `of ${fmtInt(pagesOf)}` : undefined },
    { k: "facts extracted", v: fmtInt(Math.round(facts)) },
    { k: "verifier rejects", v: fmtInt(Math.round(rejects)) },
    { k: "jev checks", v: fmtInt(Math.round(jev)) },
    totals && totals.coldUsd > 0
      ? { k: "to digest this case", v: fmtUsd(cold), note: `this run ${fmtUsd(c.cost)}${cached ? ", cached" : ""}` }
      : { k: cached ? "spent, all cached" : "spent", v: fmtUsd(c.cost) },
  ];
  return (
    <div className="gp-counters" role="status" aria-live="polite">
      {cells.map((x) => (
        <div className="gp-counter" key={x.k}>
          <span className="gp-counter__v">
            {x.v}
            {x.sub && <em> {x.sub}</em>}
          </span>
          <span className="gp-counter__k">{x.k}</span>
          {x.note ? <span className="gp-counter__note">{x.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------

const STATE_LABEL: Record<StageView["state"], string> = { working: "working", done: "done", cached: "cached", failed: "failed", skipped: "skipped" };

const StageNode = memo(function StageNode({ stage, on, dwell, now, side }: { stage: StageView; on: boolean; dwell?: boolean; now: number; side: "left" | "right" }) {
  const { def, counts, tasks } = stage;
  const dense = tasks.length > DENSE_AT;
  const finished = counts.done + counts.cached + counts.failed;
  const elapsed =
    stage.startedAt == null ? null : (stage.finishedAt ?? (stage.state === "working" ? now : stage.startedAt)) - stage.startedAt;
  const date =
    stage.state === "skipped"
      ? "not wired yet"
      : stage.state === "cached"
      ? "from cache"
      : elapsed == null
        ? ""
        : stage.state === "working"
          ? `running ${fmtDur(elapsed)}`
          : fmtDur(elapsed);
  const running = tasks.filter((t) => t.status === "running").slice(0, 3);
  const meta: string[] = [`${finished}/${tasks.length} finished`];
  if (counts.running) meta.push(`${counts.running} running`);
  if (counts.cached && counts.cached !== tasks.length) meta.push(`${counts.cached} cached`);
  if (counts.failed) meta.push(`${counts.failed} failed`);
  if (stage.facts) meta.push(`${fmtInt(stage.facts)} facts`);
  meta.push(fmtUsd(stage.cost));

  return (
    <VerticalTimelineElement
      className={`gp-node gp-node--${def.role} gp-node--${stage.state} ${on ? "is-on" : "is-off"}${dwell ? " is-dwell" : ""}`}
      visible={on}
      position={side}
      date={
        <span className="gp-date__stack">
          <span className="gp-date__time">{date}</span>
          {on && <StageThought stage={stage} elapsedMs={elapsed} />}
        </span> as unknown as string /* the library types date as string but renders any node */
      }
      dateClassName="gp-date"
      icon={<StageIcon index={stage.index} state={stage.state} />}
      iconClassName={`gp-icon gp-icon--${stage.state}`}
      textClassName="gp-card"
      intersectionObserverProps={{ triggerOnce: true, skip: true }}
    >
      <div className="gp-card__top">
        <span className="gp-card__idx">{String(stage.index).padStart(2, "0")}</span>
        <h3 className="gp-card__title">{on ? <DecryptedText text={def.title} speed={38} /> : def.title}</h3>
        <span className={`gp-pill gp-pill--${stage.state}`}>{STATE_LABEL[stage.state]}</span>
      </div>
      <p className="gp-card__explain">{def.explain}</p>
      <div className={`gp-tiles ${dense ? "gp-tiles--dense" : ""}`}>
        {tasks.map((t) => (
          <Tile key={t.id} t={t} dense={dense} />
        ))}
      </div>
      <div className="gp-card__meta">
        <span>{meta.join(" · ")}</span>
        {dense && running.length > 0 && (
          <span className="gp-card__now">now: {running.map((t) => t.shard_label ?? `#${t.id}`).join(", ")}</span>
        )}
      </div>
    </VerticalTimelineElement>
  );
});

// What each stage is doing, said as a person would, for the thought line beside its card.
const THINK: Record<string, [working: string, done: string]> = {
  sync: ["Reading Clio", "Read Clio in"],
  ocr: ["Reading the scans", "Read the scans in"],
  extract: ["Pulling facts with quotes", "Pulled facts in"],
  verify: ["Checking every quote", "Checked quotes in"],
  jev: ["Auditing the claims", "Audited claims in"],
  embed: ["Indexing the case", "Indexed in"],
  reconcile: ["Cross-checking sources", "Cross-checked in"],
  gate: ["Checking the phase gates", "Checked gates in"],
  synth: ["Writing the story", "Wrote the story in"],
};

/** The agent's thought line: the latest task events of this stage, newest last (counts only, from the rows). */
function StageThought({ stage, elapsedMs }: { stage: StageView; elapsedMs: number | null }) {
  const [working, done] = THINK[stage.def.role] ?? [stage.def.title, "Done in"];
  // ThoughtLine ticks every step but the last, so the trace is the last finished tasks (really done) and,
  // while the stage works, one running task as the live last line.
  const steps = useMemo(() => {
    const line = (t: AgentTask) => [t.shard_label ?? `task ${t.id}`, t.last_event ?? t.status].join(" · ");
    const finished = stage.tasks
      .filter((t) => t.finished_at && (t.status === "done" || t.status === "cached" || t.status === "failed") && !isSkipped(t))
      .sort((a, b) => Date.parse(a.finished_at!) - Date.parse(b.finished_at!))
      .slice(-3)
      .map(line);
    const live = stage.state === "working" ? stage.tasks.find((t) => t.status === "running") : undefined;
    return live ? [...finished, line(live)] : finished;
  }, [stage.tasks, stage.state]);
  if (stage.state === "skipped") return null;
  return (
    <ThoughtLine
      className="gp-thought"
      label={stage.state === "cached" ? "Answering from cache" : `${working}…`}
      doneLabel={stage.state === "cached" ? "From cache in" : stage.state === "failed" ? "Stopped after" : done}
      working={stage.state === "working"}
      elapsed={elapsedMs == null ? undefined : elapsedMs / 1000}
      steps={steps}
      glyph="sparkle"
      fontSize={13}
      color="rgba(228, 231, 241, 0.86)"
      collapseOnSettle
    />
  );
}

function tileTitle(t: AgentTask) {
  const bits = [t.shard_label ?? `task ${t.id}`, t.status];
  if (t.facts_emitted) bits.push(`${t.facts_emitted} facts`);
  if (t.tokens_in || t.tokens_out) bits.push(`${fmtInt(t.tokens_in + t.tokens_out)} tokens`);
  bits.push(fmtUsd(t.cost_usd));
  if (t.last_event) bits.push(t.last_event);
  return bits.join(" · ");
}

const Tile = memo(function Tile({ t, dense }: { t: AgentTask; dense: boolean }) {
  const skipped = isSkipped(t);
  const tail = skipped
    ? null
    : t.status === "cached" ? "$0" : t.status === "failed" ? "failed" : t.status === "done" && t.facts_emitted ? `+${t.facts_emitted}` : null;
  return (
    <span className={`gp-tile gp-tile--${skipped ? "skipped" : t.status}`} title={tileTitle(t)}>
      {!dense && (
        <>
          <span className="gp-tile__label">{t.shard_label ?? `task ${t.id}`}</span>
          {tail && <span className="gp-tile__tail">{tail}</span>}
        </>
      )}
    </span>
  );
});

// The node mark from evolve's timeline: one spark, turned 147deg further at every stage so no two nodes
// sit the same way. It spins while its stage is working and settles when the stage lands.
const SPARK =
  "M7.105,19.29l5.113-2.869l0.086-0.249l-0.086-0.139h-0.249l-0.855-0.053l-2.921-0.079l-2.534-0.105l-2.455-0.132l-0.618-0.132L2.008,14.77l0.06-0.381l0.519-0.349l0.744,0.065l1.644,0.112l2.467,0.17l1.79,0.105l2.651,0.275h0.421l0.06-0.17l-0.144-0.105l-0.112-0.105l-2.553-1.73l-2.764-1.828L5.343,9.776L4.561,9.243l-0.395-0.5l-0.17-1.091l0.711-0.783l0.955,0.065l0.244,0.065l0.967,0.744l2.065,1.598l2.697,1.986l0.395,0.328l0.158-0.112l0.019-0.079l-0.177-0.297l-1.467-2.651L8.997,5.82L8.3,4.702l-0.184-0.67c-0.065-0.275-0.112-0.507-0.112-0.79l0.809-1.098L9.26,2l1.079,0.144l0.454,0.395l0.67,1.534l1.086,2.414l1.684,3.283l0.493,0.974l0.263,0.902l0.098,0.275h0.17v-0.158l0.139-1.849l0.256-2.27l0.249-2.921l0.086-0.823l0.407-0.986l0.809-0.533l0.632,0.302l0.519,0.744l-0.072,0.481l-0.309,2.007L17.37,9.057l-0.395,2.106h0.23l0.263-0.263l1.065-1.414l1.79-2.237l0.79-0.888l0.921-0.981l0.591-0.467h1.118l0.823,1.223l-0.368,1.263l-1.151,1.46l-0.955,1.237l-1.369,1.842l-0.854,1.474l0.079,0.118l0.204-0.019l3.092-0.658l1.67-0.302l1.993-0.342l0.902,0.421l0.098,0.428l-0.354,0.876L25.42,14.46l-2.5,0.5l-3.723,0.881l-0.046,0.033l0.053,0.065l1.677,0.158l0.718,0.039h1.756l3.271,0.244l0.854,0.565l0.512,0.691l-0.086,0.526l-1.316,0.67l-1.776-0.421l-4.144-0.986l-1.421-0.354h-0.197v0.118l1.184,1.158l2.17,1.96l2.718,2.527l0.139,0.625l-0.349,0.493l-0.368-0.053l-2.388-1.797l-0.921-0.809l-2.086-1.756h-0.139v0.184l0.481,0.704l2.539,3.816l0.132,1.17l-0.184,0.381l-0.658,0.23l-0.723-0.132l-1.486-2.086l-1.534-2.349l-1.237-2.106l-0.151,0.086l-0.73,7.862l-0.342,0.402L14.329,28l-0.658-0.5l-0.349-0.809l0.349-1.598l0.421-2.086l0.342-1.658l0.309-2.06l0.184-0.684l-0.012-0.046l-0.151,0.019l-1.553,2.132l-2.362,3.192l-1.869,2l-0.447,0.177l-0.776-0.402l0.072-0.718l0.433-0.639l2.586-3.29l1.56-2.039l1.007-1.177l-0.007-0.17h-0.06l-6.869,4.46l-1.223,0.158l-0.526-0.493l0.065-0.809l0.249-0.263l2.065-1.421l-0.007,0.007L7.105,19.29z";

function Spark({ index }: { index: number }) {
  return (
    <svg
      className="gp-spark"
      viewBox="0 0 30 30"
      aria-hidden="true"
      style={{ "--gp-rot": `${(index * 147) % 360}deg` } as React.CSSProperties}
    >
      <path d={SPARK} />
    </svg>
  );
}

function StageIcon({ index }: { index: number; state: StageView["state"] }) {
  return (
    <span className="gp-icon__inner">
      <Spark index={index} />
    </span>
  );
}

function FinalNode({ c, failed, cached, on, side }: { c: RunCounters; failed: boolean; cached: boolean; on: boolean; side: "left" | "right" }) {
  const parts = [
    c.entries.of ? `${fmtInt(c.entries.n)}/${fmtInt(c.entries.of)} entries` : `${fmtInt(c.entries.n)} entries`,
    c.pages.of ? `${fmtInt(c.pages.n)}/${fmtInt(c.pages.of)} pages` : `${fmtInt(c.pages.n)} pages`,
    `${c.verified == null ? "0" : fmtInt(c.verified)} verified`,
    `${fmtInt(c.rejected)} rejected`,
    fmtUsd(c.cost),
  ];
  return (
    <VerticalTimelineElement
      className={`gp-node gp-node--final ${failed ? "gp-node--failed" : ""} ${on ? "is-on" : "is-off"}`}
      visible={on}
      position={side}
      date={cached ? "reopened for $0" : ""}
      dateClassName="gp-date"
      icon={
        <span className="gp-icon__inner">
          <Spark index={0} />
        </span>
      }
      iconClassName={`gp-icon gp-icon--final ${failed ? "gp-icon--failed" : ""}`}
      textClassName="gp-card gp-card--final"
      intersectionObserverProps={{ triggerOnce: true, skip: true }}
    >
      <h3 className="gp-final__title">
        <DecryptedText text={failed ? "run stopped" : "case digested"} speed={55} animateOn="mount" />
      </h3>
      <p className="gp-card__explain">
        {failed
          ? `${c.failedTasks} agent${c.failedTasks === 1 ? "" : "s"} failed. Everything that finished is saved and cached.`
          : cached
            ? "Same file as last time. Every fact came back from cache."
            : "Every fact you are about to see is quoted, sourced and checked."}
      </p>
      <div className="gp-receipt">{parts.join(" · ")}</div>
    </VerticalTimelineElement>
  );
}
