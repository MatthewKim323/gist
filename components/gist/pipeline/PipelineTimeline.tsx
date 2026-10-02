"use client";
// The loading experience on /matter: one vertical-timeline node per pipeline stage, revealed as each stage
// starts, with a live tile per agent_tasks row. Everything on screen is read from agent_runs / agent_tasks;
// nothing is estimated. When the run is done it shows a short "case digested" beat, then calls onComplete
// once (the engine session seam-wipes into the dashboard from there).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { VerticalTimeline, VerticalTimelineElement } from "react-vertical-timeline-component";
import "react-vertical-timeline-component/style.min.css";
import "@/app/styles/gist-pipeline.css";
import type { AgentRole, AgentTask } from "@/lib/types";
import DecryptedText from "./DecryptedText";
import Waves from "./Waves";
import type { PipelineSource } from "./source";
import { usePipelineRun } from "./usePipelineRun";
import {
  deriveCounters,
  deriveStages,
  fmtDur,
  fmtInt,
  fmtUsd,
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
    const gap = revealed.length === 0 ? Math.max(0, FIRST_REVEAL_MS - sinceMount) : allCached ? 180 : REVEAL_GAP_MS;
    const t = setTimeout(() => setRevealed((r) => (r.includes(nextRole) ? r : [...r, nextRole])), gap);
    return () => clearTimeout(t);
  }, [nextRole, revealed.length, allCached]);
  const allRevealed = stages.length > 0 && pendingRoles.length === 0;

  // ---- completion beat ----
  const digested = run?.status === "done" && allRevealed && state.loaded;
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
    }, REVEAL_GAP_MS + doneBeatMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [digested, runId, doneBeatMs]);
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
  useEffect(() => {
    if (!shownCount) return;
    if (performance.now() - lastUserScroll.current < 5000) return;
    const t = setTimeout(() => {
      const sc = scrollRef.current;
      const nodes = wrapRef.current?.querySelectorAll<HTMLElement>(".gp-node.is-on");
      const last = nodes?.[nodes.length - 1];
      if (!sc || !last) return;
      const target = last.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - sc.clientHeight * 0.32;
      sc.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }, 120);
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
    <div className={`gp ${className}`} data-status={status} data-cached={allCached ? "" : undefined}>
      {waves && <Waves />}
      <div className="gp-scroll" ref={scrollRef} tabIndex={-1}>
        <header className="gp-head">
          <div className="gp-kicker">
            <span className={`gp-live gp-live--${state.live}`} />
            <span>{liveLabel(state.live, runOver)}</span>
            <span className="gp-kicker__sep">/</span>
            <span>run {runId.slice(0, 8)}</span>
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
        <div className="gp-counters-wrap">
          <Counters c={counters} cached={allCached} />
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
  );
}

function liveLabel(l: string, over: boolean) {
  if (over) return "run finished";
  if (l === "live") return "live";
  if (l === "polling") return "reconnecting, polling";
  return "connecting";
}

// ------------------------------------------------------------------------------------------------

function Counters({ c, cached }: { c: RunCounters; cached: boolean }) {
  const cells: { k: string; v: string; sub?: string }[] = [
    { k: "entries read", v: fmtInt(c.entries.n), sub: c.entries.of ? `of ${fmtInt(c.entries.of)}` : undefined },
    { k: "pages read", v: fmtInt(c.pages.n), sub: c.pages.of ? `of ${fmtInt(c.pages.of)}` : undefined },
    { k: "facts emitted", v: fmtInt(c.factsEmitted) },
    { k: "rejected by verifier", v: fmtInt(c.rejected) },
    { k: "jev checks", v: fmtInt(c.jevChecks) },
    { k: cached ? "spent, all cached" : "spent", v: fmtUsd(c.cost) },
  ];
  return (
    <div className="gp-counters" role="status" aria-live="polite">
      {cells.map((x) => (
        <div className="gp-counter" key={x.k}>
          <span className="gp-counter__v" key={x.v}>
            {x.v}
            {x.sub && <em> {x.sub}</em>}
          </span>
          <span className="gp-counter__k">{x.k}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------

const STATE_LABEL: Record<StageView["state"], string> = { working: "working", done: "done", cached: "cached", failed: "failed" };

const StageNode = memo(function StageNode({ stage, on, now, side }: { stage: StageView; on: boolean; now: number; side: "left" | "right" }) {
  const { def, counts, tasks } = stage;
  const dense = tasks.length > DENSE_AT;
  const finished = counts.done + counts.cached + counts.failed;
  const elapsed =
    stage.startedAt == null ? null : (stage.finishedAt ?? (stage.state === "working" ? now : stage.startedAt)) - stage.startedAt;
  const date =
    stage.state === "cached"
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
      className={`gp-node gp-node--${def.role} gp-node--${stage.state} ${on ? "is-on" : "is-off"}`}
      visible={on}
      position={side}
      date={date}
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

function tileTitle(t: AgentTask) {
  const bits = [t.shard_label ?? `task ${t.id}`, t.status];
  if (t.facts_emitted) bits.push(`${t.facts_emitted} facts`);
  if (t.tokens_in || t.tokens_out) bits.push(`${fmtInt(t.tokens_in + t.tokens_out)} tokens`);
  bits.push(fmtUsd(t.cost_usd));
  if (t.last_event) bits.push(t.last_event);
  return bits.join(" · ");
}

const Tile = memo(function Tile({ t, dense }: { t: AgentTask; dense: boolean }) {
  const tail =
    t.status === "cached" ? "$0" : t.status === "failed" ? "failed" : t.status === "done" && t.facts_emitted ? `+${t.facts_emitted}` : null;
  return (
    <span className={`gp-tile gp-tile--${t.status}`} title={tileTitle(t)}>
      {!dense && (
        <>
          <span className="gp-tile__label">{t.shard_label ?? `task ${t.id}`}</span>
          {tail && <span className="gp-tile__tail">{tail}</span>}
        </>
      )}
    </span>
  );
});

function StageIcon({ index, state }: { index: number; state: StageView["state"] }) {
  return (
    <span className="gp-icon__inner">
      <svg className="gp-icon__ring" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="18" />
      </svg>
      <span className="gp-icon__num">
        {state === "done" || state === "cached" ? <Check /> : state === "failed" ? "!" : index}
      </span>
    </span>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
          <span className="gp-icon__num">{failed ? "!" : <Check />}</span>
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
