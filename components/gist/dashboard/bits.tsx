"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import type { GateStatus, Owner } from "@/lib/types";

/** Number that counts up from zero on mount. Renders the final value on the server and without motion. */
export function CountUp({ value, format, duration = 1.1 }: { value: number; format: (n: number) => string; duration?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const node = el.current;
    if (!node || reduce) return;
    const c = animate(0, value, { duration, delay: 0.25, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => (node.textContent = format(v)) });
    return () => {
      c.stop();
      node.textContent = format(value);
    };
  }, [value, format, duration, reduce]);
  return <span ref={el} className="gd-num">{format(value)}</span>;
}

export function Panel({ id, title, kicker, children, className, aside }: { id?: string; title: string; kicker?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <motion.section
      id={id}
      className={`gd-panel ${className ?? ""}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
     
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="gd-panel__head">
        <h2 className="gd-panel__title">{title}</h2>
        {kicker ? <span className="gd-panel__kicker">{kicker}</span> : null}
        {aside ? <span className="gd-panel__aside">{aside}</span> : null}
      </header>
      {children}
    </motion.section>
  );
}

const OWNER_LABEL: Record<Owner, string> = {
  client: "Client",
  provider: "Provider",
  defense: "Defense",
  carrier: "Carrier",
  firm: "Firm",
  court: "Court",
};

export function OwnerChip({ owner, name }: { owner: Owner | null; name?: string | null }) {
  if (!owner) return null;
  return (
    <span className={`gd-owner gd-owner--${owner}`} title={name ?? undefined}>
      <span className="gd-owner__dot" />
      {OWNER_LABEL[owner]}
      {name && owner !== "firm" && owner !== "client" ? <span className="gd-owner__name">{name}</span> : null}
    </span>
  );
}

export function StatusIcon({ status }: { status: GateStatus }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-label": status } as const;
  switch (status) {
    case "have":
      return (
        <svg {...common} className="gd-st gd-st--have">
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
          <path d="M4.6 8.2l2.2 2.2 4.6-4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "partial":
      return (
        <svg {...common} className="gd-st gd-st--partial">
          <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 1.7a6.3 6.3 0 0 1 0 12.6z" fill="currentColor" />
        </svg>
      );
    case "missing":
      return (
        <svg {...common} className="gd-st gd-st--missing">
          <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2" />
        </svg>
      );
    case "conflicting":
      return (
        <svg {...common} className="gd-st gd-st--conflicting">
          <path d="M8 1.6l6.6 12H1.4z" fill="currentColor" opacity="0.18" />
          <path d="M8 1.6l6.6 12H1.4z M8 6v3.6 M8 11.2v.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      );
  }
}
