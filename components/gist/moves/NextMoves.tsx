"use client";

// The hero "Next moves" panel: ranked, executable moves that get this case to its next phase.
// Mount: <NextMoves matterId={id} /> at the top of the Overview tab.
import "@/app/styles/gist-moves.css";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import MoveCard from "./MoveCard";
import { refreshMoves, useMoves } from "./store";

export { default as MoveCard } from "./MoveCard";
export { useMoves, refreshMoves } from "./store";

const lastName = (s: string) => s.replace(/,.*$/, "").trim().split(/\s+/).pop() ?? s;

export default function NextMoves({ matterId, compact }: { matterId: number; compact?: boolean }) {
  const { data, error } = useMoves(matterId);
  const [hold, setHold] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  // drafts approved elsewhere (Agent drafts tab, Ask gist) or shares created elsewhere move the list
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ matterId?: number }>).detail?.matterId;
      if (id == null || id === matterId) void refreshMoves(matterId);
    };
    window.addEventListener("gist:moves-changed", on);
    window.addEventListener("focus", on);
    return () => { window.removeEventListener("gist:moves-changed", on); window.removeEventListener("focus", on); };
  }, [matterId]);

  const onDone = (id: string) => {
    setHold((h) => new Set(h).add(id));
    setTimeout(() => setHold((h) => { const n = new Set(h); n.delete(id); return n; }), 1800);
  };

  if (error && !data) return <section className="gmv"><p className="gmv-empty">Could not load next moves: {error}</p></section>;
  if (!data) return <section className="gmv gmv--loading" aria-busy><div className="gmv-skel" /><div className="gmv-skel" /><div className="gmv-skel" /></section>;

  const active = (s: string) => s === "todo" || s === "in_progress";
  const list = data.moves.filter((m) => active(m.status) || hold.has(m.id));
  const shown = compact ? list.slice(0, 3) : list;
  const closed = data.moves.filter((m) => !active(m.status) && !hold.has(m.id));
  const openCount = data.moves.filter((m) => active(m.status)).length;
  const pct = data.gates_total ? Math.round((data.gates_have / data.gates_total) * 100) : 0;
  const target = data.next_phase ?? "the next phase";

  return (
    <section className={`gmv${compact ? " gmv--compact" : ""}`} aria-label="Next moves">
      <header className="gmv-head">
        <div className="gmv-kicker">Next moves</div>
        <h3 className="gmv-headline">
          {openCount ? `${openCount} move${openCount === 1 ? "" : "s"} to get ${lastName(data.client)} to ${target}` : `Nothing blocking ${lastName(data.client)} right now`}
          {data.gates_total ? <span className="gmv-headline__sub"> · {data.gates_have} of {data.gates_total} in hand</span> : null}
        </h3>
        <div className="gmv-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <motion.span className="gmv-bar__fill" initial={false} animate={{ width: `${Math.max(pct, 2)}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
        </div>
      </header>
      <div className="gmv-list">
        <AnimatePresence initial={false}>
          {shown.map((m, i) => (
            <motion.div key={m.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
              <MoveCard matterId={matterId} move={m} n={i + 1} onDone={onDone} compact={compact} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {closed.length ? (
        <div className="gmv-foot">
          <button type="button" className="gmv-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            {showDone ? "Hide completed" : `Show completed (${closed.length})`}
          </button>
          {showDone ? (
            <div className="gmv-list gmv-list--done">
              {closed.map((m) => <MoveCard key={m.id} matterId={matterId} move={m} compact />)}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
