"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Citation } from "@/lib/types";
import { CiteChip, Cites } from "./cite";
import { fixtureAnswer } from "./fixture";

interface Answer {
  q: string;
  answer: string;
  cites: Citation[];
}

const SUGGEST = ["Any prior injuries?", "What coverage is behind this case?", "What is overdue right now?"];

function normalizeCites(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (typeof c === "string") return { source_ref: c };
      if (c && typeof c === "object" && typeof (c as Citation).source_ref === "string") return c as Citation;
      return null;
    })
    .filter((c): c is Citation => !!c);
}

const REF = /^[a-z_]+:\S+$/;

/** Renders answer text, turning inline [ref, ref] markers into numbered cite chips. */
function AnswerText({ text, cites }: { text: string; cites: Citation[] }) {
  const byRef = new Map(cites.map((c) => [c.source_ref, c]));
  const used = new Set<string>();
  const out: ReactNode[] = [];
  let last = 0;
  const clean = text.replace(/\*\*(.+?)\*\*/g, "$1");
  for (const m of clean.matchAll(/\s*\[([^\]]+)\]/g)) {
    const refs = m[1]!.split(/[,;]\s*/).map((x) => x.trim());
    if (!refs.length || !refs.every((r) => REF.test(r))) continue;
    out.push(clean.slice(last, m.index));
    out.push(
      <span key={m.index} className="gd-cites">
        {refs.map((r) => {
          used.add(r);
          return <CiteChip key={r} cite={byRef.get(r) ?? { source_ref: r }} />;
        })}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  out.push(clean.slice(last));
  const rest = cites.filter((c) => !used.has(c.source_ref));
  return (
    <p>
      {out}
      <Cites cites={rest} />
    </p>
  );
}

export default function AskPalette({ matterId, fixture }: { matterId: number | null; fixture: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      let a: Answer;
      if (fixture) {
        await new Promise((r) => setTimeout(r, 450));
        a = { q: text, ...fixtureAnswer(text) };
      } else {
        const r = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ matterId, q: text }),
        });
        if (!r.ok) throw new Error(`ask failed (${r.status})`);
        const j = (await r.json()) as Record<string, unknown>;
        a = {
          q: text,
          answer: String(j.answer_markdown ?? j.answer ?? j.text ?? ""),
          cites: normalizeCites(j.cites ?? j.citations ?? j.sources),
        };
      }
      setAnswers((prev) => [a, ...prev].slice(0, 6));
      setQ("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="gd-askbtn" onClick={() => setOpen(true)}>
        Ask the case
        <kbd>⌘K</kbd>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div className="gd-ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={() => setOpen(false)}>
            <motion.div
              className="gd-ask__box"
              role="dialog"
              aria-label="Ask the case"
              initial={{ y: -10, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: -6, scale: 0.99 }}
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
              onClick={(e) => e.stopPropagation()}
            >
              <form
                className="gd-ask__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(q);
                }}
              >
                <svg viewBox="0 0 16 16" width="15" height="15" className="gd-ask__icon"><circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" /></svg>
                <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about this case. Answers cite the file." />
                {busy ? <span className="gd-ask__spin" /> : <kbd>↵</kbd>}
              </form>
              <div className="gd-ask__body">
                {err ? <div className="gd-ask__err">{err}</div> : null}
                {!answers.length && !busy ? (
                  <div className="gd-ask__suggest">
                    {SUGGEST.map((s) => (
                      <button key={s} type="button" onClick={() => void ask(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}
                {answers.map((a, i) => (
                  <motion.div key={a.q + i} className="gd-ask__a" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                    <div className="gd-ask__q">{a.q}</div>
                    <AnswerText text={a.answer} cites={a.cites} />
                  </motion.div>
                ))}
              </div>
              <div className="gd-ask__foot">Hybrid search over every note, email and scanned page · Esc to close</div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
