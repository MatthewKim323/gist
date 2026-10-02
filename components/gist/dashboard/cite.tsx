"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { Citation } from "@/lib/types";
import { refKindLabel } from "./format";

interface CiteCtx {
  matterId: number | null;
  fixture: boolean;
  numberOf: (ref: string) => number;
  open: (cite: Citation) => void;
  /** Opens the provider share sheet, optionally preselecting a provider (Clio contact id). */
  share: (providerId?: number | null) => void;
}

const Ctx = createContext<CiteCtx>({ matterId: null, fixture: false, numberOf: () => 0, open: () => {}, share: () => {} });
export const CiteProvider = Ctx.Provider;
export const useCites = () => useContext(Ctx);

/** Walks any payload and numbers every distinct source_ref in reading order. */
export function numberRefs(payload: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    if (typeof o.source_ref === "string" && !out.has(o.source_ref)) out.set(o.source_ref, out.size + 1);
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(payload);
  return out;
}

function HoverCard({ anchor, cite, n }: { anchor: HTMLElement; cite: Citation; n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = 300;
    const h = ref.current?.offsetHeight ?? 120;
    const below = r.top < h + 24;
    const x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
    setPos({ x, y: below ? r.bottom + 8 : r.top - h - 8, below });
  }, [anchor]);
  return createPortal(
    <motion.div
      ref={ref}
      className="gd-hovercard"
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      initial={{ opacity: 0, y: pos?.below ? -4 : 4 }}
      animate={{ opacity: pos ? 1 : 0, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="gd-hovercard__head">
        <span className="gd-cite gd-cite--static">{n || "·"}</span>
        <span>{cite.label ?? refKindLabel(cite.source_ref)}</span>
      </div>
      {cite.quote ? <blockquote className="gd-hovercard__quote">&ldquo;{cite.quote}&rdquo;</blockquote> : null}
      <div className="gd-hovercard__foot">Click to open the source</div>
    </motion.div>,
    document.body,
  );
}

/** Numbered citation chip. Hover shows label + quote, click opens the source drawer. */
export function CiteChip({ cite }: { cite: Citation }) {
  const { numberOf, open } = useCites();
  const n = numberOf(cite.source_ref);
  const [hover, setHover] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="gd-cite"
        aria-label={`Source ${n}: ${cite.label ?? cite.source_ref}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          setHover(false);
          open(cite);
        }}
      >
        {n || "·"}
      </button>
      <AnimatePresence>{hover && btn.current ? <HoverCard anchor={btn.current} cite={cite} n={n} /> : null}</AnimatePresence>
    </>
  );
}

export function Cites({ cites }: { cites: Citation[] | undefined }) {
  if (!cites?.length) return null;
  return (
    <span className="gd-cites">
      {cites.map((c, i) => (
        <CiteChip key={`${c.source_ref}-${i}`} cite={c} />
      ))}
    </span>
  );
}

/** A value that is itself clickable into its first source (numbers and dates). */
export function CitedValue({ cites, children, className }: { cites: Citation[] | undefined; children: ReactNode; className?: string }) {
  const { open } = useCites();
  const first = cites?.[0];
  if (!first) return <span className={className}>{children}</span>;
  return (
    <button type="button" className={`gd-citedval ${className ?? ""}`} onClick={() => open(first)} title={first.label ?? first.source_ref}>
      {children}
    </button>
  );
}
