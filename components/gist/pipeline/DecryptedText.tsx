"use client";
// Scramble-then-resolve text. Ported from philip-chen6/evolve (React Bits DecryptedText), trimmed to the
// modes we use: plays once when it scrolls into view (or on mount), and replays whenever `text` changes.
import { useEffect, useRef, useState } from "react";

const DEFAULT_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789/#*+<>";

export interface DecryptedTextProps {
  text: string;
  /** ms per frame */
  speed?: number;
  /** frames of pure scramble before letters start locking in (non-sequential mode) */
  maxIterations?: number;
  /** lock letters in one by one from the start */
  sequential?: boolean;
  characters?: string;
  className?: string;
  encryptedClassName?: string;
  animateOn?: "view" | "mount";
}

export default function DecryptedText({
  text,
  speed = 45,
  maxIterations = 12,
  sequential = true,
  characters = DEFAULT_CHARS,
  className,
  encryptedClassName = "gp-enc",
  animateOn = "view",
}: DecryptedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [start, setStart] = useState(animateOn === "mount");
  const [shown, setShown] = useState(text);
  const [revealed, setRevealed] = useState<number>(text.length);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (animateOn !== "view" || start) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setStart(true), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [animateOn, start]);

  useEffect(() => {
    if (!start) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      setRevealed(text.length);
      return;
    }
    const pool = characters.split("");
    const scramble = (locked: number) =>
      text
        .split("")
        .map((c, i) => (c === " " || i < locked ? c : pool[Math.floor(Math.random() * pool.length)]))
        .join("");
    let frame = 0;
    setBusy(true);
    setRevealed(0);
    setShown(scramble(0));
    const id = setInterval(() => {
      frame++;
      const locked = sequential ? Math.max(0, frame - 2) : frame >= maxIterations ? text.length : 0;
      if (locked >= text.length) {
        clearInterval(id);
        setShown(text);
        setRevealed(text.length);
        setBusy(false);
        return;
      }
      setRevealed(locked);
      setShown(scramble(locked));
    }, speed);
    return () => clearInterval(id);
  }, [start, text, speed, maxIterations, sequential, characters]);

  return (
    <span ref={ref} className={className} style={{ display: "inline-block", whiteSpace: "pre-wrap" }}>
      <span className="gp-sr">{text}</span>
      <span aria-hidden="true">
        {shown.split("").map((c, i) => (
          <span key={i} className={busy && i >= revealed && c !== " " ? encryptedClassName : undefined}>
            {c}
          </span>
        ))}
      </span>
    </span>
  );
}
