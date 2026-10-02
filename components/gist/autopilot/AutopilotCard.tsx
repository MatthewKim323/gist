"use client";

// Autopilot on /cases: gist watches Clio on a schedule and re-digests only the cases that moved.
// Shows state, a toggle, "Check Clio now", and the activity feed. When there is no Vercel Cron (local dev),
// this open tab acts as the scheduler and calls the tick when it is due, and says so.

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import Button from "@/components/gist/ui/Button";
import "@/app/styles/gist-autopilot.css";

type Kind = "stage_changed" | "new_items" | "gate_flipped" | "newly_overdue" | "new_red_flag" | "digest_refreshed" | "no_change" | "error";

interface Ev {
  id: number;
  matter_id: number | null;
  kind: Kind;
  title: string;
  created_at: string;
}

interface State {
  enabled: boolean;
  interval_min: number;
  last_tick_at: string | null;
  next_tick_at: string | null;
  ticking_since: string | null;
}

interface Payload {
  state: State;
  events: Ev[];
  watching: number;
  cron: boolean;
  dev: boolean;
}

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function until(iso: string | null, now: number): string {
  if (!iso) return "soon";
  const s = (Date.parse(iso) - now) / 1000;
  if (s <= 30) return "now";
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  return `in ${Math.round(s / 3600)}h`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return today ? t : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${t}`;
}

const KIND_LABEL: Record<Kind, string> = {
  stage_changed: "Stage",
  new_items: "New in Clio",
  gate_flipped: "Gate",
  newly_overdue: "Overdue",
  new_red_flag: "Red flag",
  digest_refreshed: "Digest",
  no_change: "Checked",
  error: "Needs attention",
};

function open(href: string) {
  return (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    window.location.assign(href);
  };
}

export default function AutopilotCard({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/autopilot", { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as Payload & { error?: string };
    if (!r.ok) throw new Error(j.error ?? `autopilot ${r.status}`);
    setData(j);
    setErr(null);
    return j;
  }, []);

  const tick = useCallback(
    async (ifDue: boolean) => {
      if (busy.current) return;
      busy.current = true;
      if (!ifDue) {
        setChecking(true);
        setMsg(null);
      }
      try {
        const r = await fetch(`/api/autopilot/tick${ifDue ? "?ifDue=1" : ""}`, { method: "POST" });
        const j = (await r.json().catch(() => ({}))) as { ran?: boolean; reason?: string; events?: Ev[]; watched?: number; error?: string };
        if (!r.ok) throw new Error(j.error ?? `tick ${r.status}`);
        if (!ifDue) {
          const moved = (j.events ?? []).filter((e) => e.kind !== "no_change").length;
          setMsg(
            !j.ran
              ? `Skipped: ${j.reason ?? "already running"}`
              : moved
                ? `${moved} update${moved === 1 ? "" : "s"} across ${j.watched} case${j.watched === 1 ? "" : "s"}`
                : `No changes in Clio across ${j.watched} case${j.watched === 1 ? "" : "s"}`,
          );
        }
        if (j.ran && (j.events ?? []).some((e) => e.kind !== "no_change")) onChanged?.();
        await load();
      } catch (e) {
        if (!ifDue) setMsg((e as Error).message);
      } finally {
        busy.current = false;
        setChecking(false);
      }
    },
    [load, onChanged],
  );

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
    const poll = window.setInterval(() => {
      setNow(Date.now());
      load().catch(() => null);
    }, 30_000);
    const clockId = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clockId);
    };
  }, [load]);

  // Local scheduler: without Vercel Cron, this tab triggers the tick whenever it is due.
  const localScheduler = !!data && !data.cron;
  useEffect(() => {
    if (!localScheduler || !data?.state.enabled) return;
    const due = !data.state.next_tick_at || Date.parse(data.state.next_tick_at) - 30_000 <= now;
    if (due && !data.state.ticking_since) void tick(true);
  }, [localScheduler, data, now, tick]);

  const toggle = async () => {
    if (!data) return;
    const r = await fetch("/api/autopilot", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !data.state.enabled }),
    });
    if (r.ok) await load();
  };

  if (err) {
    return (
      <section className="gc-card gap-card">
        <div className="gc-eyebrow">Autopilot</div>
        <p className="gc-muted">Autopilot is unavailable: {err}</p>
      </section>
    );
  }
  if (!data) return <section className="gc-card gap-card gc-skel" aria-busy>Loading autopilot</section>;

  const s = data.state;
  const running = !!s.ticking_since || checking;
  const events = data.events;

  return (
    <section className="gc-card gap-card" aria-label="Autopilot">
      <div className="gap-head">
        <div className="gap-id">
          <span className={`gap-dot${s.enabled ? " is-on" : ""}${running ? " is-busy" : ""}`} aria-hidden />
          <div>
            <div className="gc-eyebrow">Autopilot</div>
            <div className="gap-status">
              <strong>{s.enabled ? "On" : "Off"}</strong>
              <span className="gap-sep" />
              watching {data.watching} case{data.watching === 1 ? "" : "s"}
              <span className="gap-sep" />
              {running ? "checking Clio now" : `last check ${ago(s.last_tick_at, now)}`}
              {s.enabled && !running ? (
                <>
                  <span className="gap-sep" />
                  next {until(s.next_tick_at, now)}
                </>
              ) : null}
            </div>
            <div className="gc-faint gap-sub">
              Every {s.interval_min} minutes gist reads Clio (read-only) and re-digests only the cases that moved. Unchanged cases cost $0.
            </div>
          </div>
        </div>
        <div className="gap-actions">
          <button
            type="button"
            role="switch"
            aria-checked={s.enabled}
            className={`gap-switch${s.enabled ? " is-on" : ""}`}
            onClick={() => void toggle()}
            title={s.enabled ? "Turn autopilot off" : "Turn autopilot on"}
          >
            <span aria-hidden />
            <em>{s.enabled ? "On" : "Off"}</em>
          </button>
          <Button onClick={() => void tick(false)} disabled={running} size="sm">
            {running ? "Checking" : "Check Clio now"}
          </Button>
        </div>
      </div>

      {msg && <p className="gap-msg" role="status">{msg}</p>}

      {localScheduler && (
        <p className="gap-local">
          Local scheduler: no Vercel Cron here, so this open tab runs the check when it is due.
        </p>
      )}

      <ol className="gap-feed" aria-label="Autopilot activity">
        {events.length === 0 && <li className="gap-empty">No activity yet. The first check runs on the schedule, or now.</li>}
        {events.map((e) => {
          const href = e.matter_id ? `/matter?view=digest&id=${e.matter_id}` : null;
          const body = (
            <>
              <span className="gap-time">{clock(e.created_at)}</span>
              <span className={`gap-kind gap-kind--${e.kind}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
              <span className="gap-title">{e.title}</span>
            </>
          );
          return (
            <li key={e.id} className={`gap-ev${e.kind === "no_change" ? " is-quiet" : ""}`}>
              {href ? (
                <a href={href} onClick={open(href)} className="gap-ev__link">
                  {body}
                </a>
              ) : (
                <div className="gap-ev__link">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
