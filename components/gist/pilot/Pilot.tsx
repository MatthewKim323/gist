"use client";
// The pilot: the captain flies the run. It perches on the newest stage card (top outer corner, so it
// swings left and right as the cards alternate), scans it while that stage works, and reacts when the stage
// lands. All motion is physical: a spring with a touch of overshoot carries it, a short anticipation dip
// precedes every launch, the path arcs (lift scales with horizontal speed), the body banks into the turn and
// squashes along its velocity. Targets are measured from the DOM every frame, so it rides along with scroll.
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot } from "./Bot";
import { block } from "@/lib/captain/cycles";
import type { Look } from "@/lib/captain/cycles";
import { startScan } from "./scanFx";

type Mode = "waiting" | "flying" | "scanning" | "done" | "cached" | "failed" | "final";

const SIZE = 112;
// spring: slightly under-damped so arrivals settle with one small overshoot
const K = 46;
const DAMP = 0.78 * 2 * Math.sqrt(K);
const ANTICIPATE_MS = 140;

const FACE: Record<Mode, { expression: string; anim: string[] }> = {
  waiting: { expression: "curieux", anim: ["idle"] },
  flying: { expression: "attentif", anim: ["idle"] },
  scanning: { expression: "attentif", anim: ["idle"] },
  done: { expression: "heureux", anim: ["bob", "idle"] },
  cached: { expression: "fier", anim: ["swirl", "idle"] },
  failed: { expression: "triste", anim: ["idle"] },
  final: { expression: "hilare", anim: ["ahoy", "bob"] },
};

type Target = { x: number; y: number; card: HTMLElement | null; side: "left" | "right"; mode: Mode; role: string; key: string };

// while scanning, the face and the eyes act out what the stage is doing
const SCAN_FACE: Record<string, string> = {
  sync: "curieux",
  ocr: "attentif",
  extract: "excite",
  verify: "attentif",
  jev: "mefiant",
  embed: "curieux",
  reconcile: "confus",
  gate: "attentif",
  synth: "fier",
};
type Gaze = (t: number, toward: number) => Omit<Look, "mix" | "spin" | "wander">;
const saw = (t: number, period: number) => (t / period) % 1;
const SCAN_GAZE: Record<string, Gaze> = {
  // left to right along the resource list
  sync: (t, d) => ({ yaw: d * (12 + 22 * Math.sin(t * 1.4)), pitch: -12 }),
  // reading lines: sweep across, drop a line, snap back
  ocr: (t, d) => ({ yaw: d * (6 + 30 * saw(t, 0.9)), pitch: -6 - 4 * (Math.floor(t / 0.9) % 4) }),
  // darting between shards
  extract: (t, d) => ({ yaw: d * (18 + 18 * Math.sign(Math.sin(t * 5.3))), pitch: -12 + 6 * Math.sign(Math.sin(t * 3.1)) }),
  // nodding along as each quote checks out
  verify: (t, d) => ({ yaw: d * 22, pitch: -10 - 7 * Math.abs(Math.sin(t * 3.2)) }),
  // long, suspicious holds
  jev: (t, d) => ({ yaw: d * (20 + 10 * Math.sign(Math.sin(t * 1.1))), pitch: -12 }),
  // taking in the whole space
  embed: (t, d) => ({ yaw: d * (18 + 16 * Math.sin(t * 0.9)), pitch: -8 + 8 * Math.sin(t * 0.7) }),
  // one side, then the other
  reconcile: (t, d) => ({ yaw: d * 20 + 18 * Math.sign(Math.sin(t * 1.6)), pitch: -12 }),
  gate: (t, d) => ({ yaw: d * (10 + 28 * saw(t, 1.6)), pitch: -12 }),
  // following the caret as it writes
  synth: (t, d) => ({ yaw: d * (4 + 34 * saw(t, 0.75)), pitch: -8 }),
};

function readTarget(root: HTMLElement): Target | null {
  const nodes = root.querySelectorAll<HTMLElement>(".gp-node.is-on");
  const node = nodes[nodes.length - 1];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!node) {
    // before the first agent reports in: hover over the title
    const head = root.querySelector<HTMLElement>(".gp-title");
    if (!head) return null;
    const r = head.getBoundingClientRect();
    return { x: r.right + 24, y: r.top + r.height * 0.4, card: null, side: "right", mode: "waiting", role: "", key: "head" };
  }
  const card = node.querySelector<HTMLElement>(".gp-card");
  if (!card) return null;
  const r = card.getBoundingClientRect();
  // which side of the spine the card sits on (single column on narrow screens: always right)
  const side: "left" | "right" = r.left + r.width / 2 < vw / 2 && vw >= 1170 ? "left" : "right";
  // perch on the card's outer top corner, clear of the title
  const x = side === "right" ? r.right - SIZE * 0.12 : r.left + SIZE * 0.12;
  const y = r.top - SIZE * 0.36;
  const cls = node.className;
  const mode: Mode = cls.includes("gp-node--final")
    ? cls.includes("gp-node--failed")
      ? "failed"
      : "final"
    : cls.includes("gp-node--working")
      ? "scanning"
      : cls.includes("gp-node--cached")
        ? "cached"
        : cls.includes("gp-node--failed")
          ? "failed"
          : "done";
  return {
    x: Math.min(vw - SIZE * 0.6, Math.max(SIZE * 0.6, x)),
    y: Math.min(vh - SIZE * 0.6, Math.max(SIZE * 0.75, y)),
    card,
    side,
    mode,
    role: node.className.match(/gp-node--(\w+)/)?.[1] ?? "",
    key: node.className.match(/gp-node--(\w+)/)?.[1] + ":" + nodes.length,
  };
}

export default function Pilot({ rootRef }: { rootRef: React.RefObject<HTMLElement | null> }) {
  const el = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const beam = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("waiting");
  const [side, setSide] = useState<"left" | "right">("right");
  const modeRef = useRef<Mode>("waiting");
  const [role, setRole] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const p = { x: window.innerWidth / 2, y: -SIZE, vx: 0, vy: 0 };
    let goal = { x: p.x, y: p.y };
    let lastKey = "";
    let launchAt = 0;
    let dipX = 0;
    let scanned: HTMLElement | null = null;
    let stopScan: (() => void) | null = null;
    let settled = false;
    let raf = 0;
    let last = performance.now();

    const setR = (r: string) => setRole((x) => (x === r ? x : r));
    const setM = (m: Mode) => {
      if (modeRef.current === m) return;
      modeRef.current = m;
      setMode(m);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = readTarget(root);
      if (!t) return;

      if (t.key !== lastKey) {
        // new stage: anticipation (a small dip away from where it's about to go), then launch
        if (lastKey) {
          launchAt = now + ANTICIPATE_MS;
          dipX = Math.sign(p.x - t.x) * 14;
        }
        lastKey = t.key;
        settled = false;
        setSide(t.side);
      }
      if (now < launchAt) {
        goal = { x: p.x + dipX * 0.15, y: p.y + 6 * 0.15 };
      } else {
        goal = { x: t.x, y: t.y };
      }

      if (reduce) {
        p.x = goal.x;
        p.y = goal.y;
        p.vx = p.vy = 0;
      } else {
        const ax = K * (goal.x - p.x) - DAMP * p.vx;
        const ay = K * (goal.y - p.y) - DAMP * p.vy;
        p.vx += ax * dt;
        p.vy += ay * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      const speed = Math.hypot(p.vx, p.vy);
      const dist = Math.hypot(goal.x - p.x, goal.y - p.y);
      // hysteresis: once settled on a card, small drift (the page carry scrolling under it) doesn't count as
      // flying again; only a real hop does. Without this the scan state flips on and off twice a second.
      const travelling = now < launchAt || (settled ? dist > 90 : dist > 10 || speed > 40);
      settled = !travelling;
      setM(travelling ? "flying" : t.mode);

      // arc: lift while moving sideways fast; bank into the turn; stretch along the velocity
      const lift = -Math.min(46, Math.abs(p.vx) * 0.045);
      const bank = Math.max(-18, Math.min(18, p.vx * 0.012));
      const stretch = Math.min(0.14, speed / 9000);
      const ang = Math.atan2(p.vy, p.vx);
      if (el.current) el.current.style.transform = `translate3d(${p.x - SIZE / 2}px, ${p.y - SIZE / 2 + lift}px, 0)`;
      if (body.current)
        body.current.style.transform = `rotate(${ang}rad) scale(${1 + stretch}, ${1 - stretch * 0.8}) rotate(${-ang}rad) rotate(${bank}deg)`;

      // scan: beam from the pilot onto the card it is reading, sweep on the card itself
      const scanning = !travelling && t.mode === "scanning" && t.card;
      const want = scanning ? t.card : null;
      if (want !== scanned) {
        stopScan?.();
        stopScan = null;
        scanned?.removeAttribute("data-scan");
        scanned = want;
        if (want) {
          want.setAttribute("data-scan", "");
          if (!reduce) stopScan = startScan(want, t.role);
        }
      }
      setR(t.role);
      if (beam.current) {
        if (scanning && t.card) {
          const r = t.card.getBoundingClientRect();
          const cx = r.left + r.width / 2 - p.x;
          const cy = r.top + r.height * 0.55 - (p.y + lift);
          beam.current.style.opacity = "1";
          beam.current.style.width = `${Math.hypot(cx, cy)}px`;
          beam.current.style.transform = `rotate(${Math.atan2(cy, cx)}rad)`;
        } else beam.current.style.opacity = "0";
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      stopScan?.();
      scanned?.removeAttribute("data-scan");
    };
  }, [rootRef]);

  // eyes: toward the direction of travel, or down at the card while reading it
  const gaze = useMemo<((t: number) => Look) | null>(() => {
    if (mode === "flying") return null;
    const toward = side === "right" ? -1 : 1;
    if (mode === "scanning") {
      const g = SCAN_GAZE[role] ?? SCAN_GAZE.ocr;
      return (t: number) => ({ ...g(t, toward), mix: Math.min(1, t * 2.5), spin: 0, wander: 0 });
    }
    if (mode === "waiting")
      return (t: number) => ({ yaw: toward * 22 + Math.sin(t * 2.4) * 9, pitch: -14, mix: Math.min(1, t * 2), spin: 0, wander: 0 });
    return null;
  }, [mode, side, role]);

  const face = mode === "scanning" ? { ...FACE.scanning, expression: SCAN_FACE[role] ?? "attentif" } : FACE[mode];
  const animKey = face.anim.join(",");
  const cycle = useMemo(() => animKey.split(",").map(block), [animKey]);

  return (
    <div className="gp-pilot" ref={el} data-mode={mode} aria-hidden="true">
      <div className="gp-pilot__beam" ref={beam} />
      <div className="gp-pilot__body" ref={body}>
        <Bot
          size={SIZE}
          shape="cercle"
          color="creme"
          hat="capitaine"
          expression={face.expression}
          paper="#0d1422"
          cycle={cycle}
          state={cycle[0]?.state ?? "idle"}
          playing={cycle.length > 1}
          gaze={gaze}
        />
      </div>
    </div>
  );
}
