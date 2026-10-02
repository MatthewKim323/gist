// Per-stage scan choreography the pilot plays over the card it is reading. Each stage gets a gesture that
// says what that stage does (a document scanner for OCR, a lock-on reticle for the Jev audit, a caret that
// writes for synthesis...). Pure GSAP: one cycle is built from the card's live tiles, and the next cycle is
// rebuilt on completion so new tiles are picked up. startScan returns a stop function that cleans up.
import gsap from "gsap";

type Build = (card: HTMLElement, fx: HTMLElement, tiles: HTMLElement[]) => gsap.core.Timeline;

const GLOW = "0 0 14px rgba(141, 184, 255, 0.55)";

function el(parent: HTMLElement, cls: string, css: Partial<CSSStyleDeclaration> = {}) {
  const d = document.createElement("div");
  d.className = cls;
  Object.assign(d.style, css);
  parent.appendChild(d);
  return d;
}

/** tile box relative to the card */
function box(card: HTMLElement, t: HTMLElement) {
  const c = card.getBoundingClientRect();
  const r = t.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
}

function pick<T>(xs: T[], n: number) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** a quick lift + glow on a tile, reused by most gestures */
function touch(tl: gsap.core.Timeline, t: HTMLElement | HTMLElement[], at: number | string, stagger = 0) {
  tl.to(t, { y: -2, boxShadow: GLOW, filter: "brightness(1.35)", duration: 0.28, ease: "power3.out", stagger }, at).to(
    t,
    { y: 0, boxShadow: "0 0 0px rgba(141, 184, 255, 0)", filter: "brightness(1)", duration: 0.6, ease: "power2.inOut", stagger },
    typeof at === "number" ? at + 0.28 : ">-0.05",
  );
}

const BUILDS: Record<string, Build> = {
  // Reading Clio: the beam pulls each resource in turn, left to right
  sync(card, fx, tiles) {
    const tl = gsap.timeline();
    touch(tl, tiles, 0, 0.07);
    tl.to({}, { duration: 0.7 });
    return tl;
  },

  // OCR: a document scanner; the light bar passes top to bottom and lights the rows it crosses
  ocr(card, fx, tiles) {
    const h = card.clientHeight;
    const bar = el(fx, "gp-fx-bar", { left: "0", right: "0", top: "0", height: "2px" });
    const band = el(fx, "gp-fx-band", { left: "0", right: "0", top: "-60px", height: "60px" });
    const tl = gsap.timeline({ onComplete: () => (bar.remove(), band.remove()) });
    tl.fromTo([bar, band], { y: 0, opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power1.out" })
      .to([bar, band], { y: h, duration: 1.7, ease: "power2.inOut" }, 0)
      .to([bar, band], { opacity: 0, duration: 0.3 }, 1.5);
    const sorted = [...tiles].sort((a, b) => box(card, a).y - box(card, b).y);
    sorted.forEach((t) => {
      const y = box(card, t).y / h;
      touch(tl, t, 0.1 + 1.6 * Math.min(1, Math.max(0, y)) * 0.95);
    });
    tl.to({}, { duration: 0.5 });
    return tl;
  },

  // Extractor swarm: a focus frame hops between shards and plucks a fact out of each
  extract(card, fx, tiles) {
    const ring = el(fx, "gp-fx-ring");
    const tl = gsap.timeline({ onComplete: () => ring.remove() });
    const hops = pick(tiles, Math.min(5, tiles.length));
    hops.forEach((t, i) => {
      const b = box(card, t);
      const at = i * 0.62;
      if (i === 0) tl.set(ring, { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, opacity: 0, scale: 1.25 }, 0);
      tl.to(ring, { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, opacity: 1, scale: 1, duration: 0.5, ease: "power4.inOut" }, at);
      touch(tl, t, at + 0.38);
      const spark = el(fx, "gp-fx-plus");
      spark.textContent = "+1";
      tl.fromTo(
        spark,
        { x: b.x + b.w / 2 - 8, y: b.y - 2, opacity: 0 },
        { y: b.y - 26, opacity: 1, duration: 0.42, ease: "power3.out", onComplete: () => void gsap.to(spark, { opacity: 0, duration: 0.3, onComplete: () => spark.remove() }) },
        at + 0.42,
      );
    });
    tl.to(ring, { opacity: 0, scale: 0.9, duration: 0.35, ease: "power2.in" }, ">0.1");
    return tl;
  },

  // Verifier: a comb passes left to right and ticks every quote it can match
  verify(card, fx, tiles) {
    const w = card.clientWidth;
    const comb = el(fx, "gp-fx-comb", { top: "0", bottom: "0", left: "0", width: "2px" });
    const tl = gsap.timeline({ onComplete: () => comb.remove() });
    tl.fromTo(comb, { x: 0, opacity: 0 }, { opacity: 1, duration: 0.2 }).to(comb, { x: w, duration: 1.5, ease: "power2.inOut" }, 0);
    tl.to(comb, { opacity: 0, duration: 0.25 }, 1.35);
    tiles.forEach((t) => touch(tl, t, 0.05 + 1.45 * (box(card, t).x / w)));
    tl.to({}, { duration: 0.5 });
    return tl;
  },

  // Jev audit: a reticle closes in on one claim at a time and locks
  jev(card, fx, tiles) {
    const ret = el(fx, "gp-fx-reticle");
    for (const c of ["tl", "tr", "bl", "br"]) el(ret, `gp-fx-reticle__${c}`);
    const tl = gsap.timeline({ onComplete: () => ret.remove() });
    pick(tiles, Math.min(4, tiles.length)).forEach((t, i) => {
      const b = box(card, t);
      const at = i * 0.85;
      tl.set(ret, { x: b.x - 10, y: b.y - 10, width: b.w + 20, height: b.h + 20, opacity: 0 }, at)
        .to(ret, { x: b.x - 3, y: b.y - 3, width: b.w + 6, height: b.h + 6, opacity: 1, duration: 0.42, ease: "expo.out" }, at)
        .to(ret, { scale: 1.06, duration: 0.09, yoyo: true, repeat: 1, ease: "power1.inOut" }, at + 0.42);
      touch(tl, t, at + 0.44);
      tl.to(ret, { opacity: 0, duration: 0.22, ease: "power2.in" }, at + 0.7);
    });
    return tl;
  },

  // Indexing: a lattice of points blooms out from the centre, the shape of the vector index
  embed(card, fx) {
    const cols = 18;
    const rows = 6;
    const grid = el(fx, "gp-fx-grid", { gridTemplateColumns: `repeat(${cols}, 1fr)` });
    const dots = Array.from({ length: cols * rows }, () => el(grid, "gp-fx-dot"));
    const tl = gsap.timeline({ onComplete: () => grid.remove() });
    tl.fromTo(
      dots,
      { scale: 0, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.5, ease: "power3.out", stagger: { grid: [rows, cols], from: "center", amount: 0.9 } },
    ).to(dots, { scale: 0, opacity: 0, duration: 0.45, ease: "power2.in", stagger: { grid: [rows, cols], from: "edges", amount: 0.7 } }, ">0.35");
    return tl;
  },

  // Reconciler: two readings come in from either side and meet in the middle
  reconcile(card, fx, tiles) {
    const l = el(fx, "gp-fx-half", { left: "0", transformOrigin: "0 50%" });
    const r = el(fx, "gp-fx-half", { right: "0", transformOrigin: "100% 50%" });
    const flash = el(fx, "gp-fx-flash");
    const tl = gsap.timeline({ onComplete: () => (l.remove(), r.remove(), flash.remove()) });
    tl.fromTo([l, r], { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 1.05, ease: "power4.inOut" })
      .fromTo(flash, { opacity: 0, scaleX: 0.2 }, { opacity: 1, scaleX: 1, duration: 0.18, ease: "power2.out" }, ">-0.08")
      .to([l, r, flash], { opacity: 0, duration: 0.5, ease: "power2.out" }, ">");
    touch(tl, tiles, 1.0, 0.03);
    tl.to({}, { duration: 0.5 });
    return tl;
  },

  // Phase gates: each requirement is checked off and the gate fills
  gate(card, fx, tiles) {
    const rail = el(fx, "gp-fx-rail");
    const tl = gsap.timeline({ onComplete: () => rail.remove() });
    tl.fromTo(rail, { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 1.6, ease: "power4.inOut" });
    touch(tl, tiles, 0.15, Math.min(0.12, 1.3 / Math.max(1, tiles.length)));
    tl.to(rail, { opacity: 0, duration: 0.4 }, ">0.2");
    return tl;
  },

  // Synthesis: a caret writes the story line by line
  synth(card, fx) {
    const text = card.querySelector<HTMLElement>(".gp-card__explain");
    const c = card.getBoundingClientRect();
    const r = text?.getBoundingClientRect() ?? c;
    const lh = text ? parseFloat(getComputedStyle(text).lineHeight) || 20 : 20;
    const lines = Math.max(1, Math.round(r.height / lh));
    const caret = el(fx, "gp-fx-caret", { height: `${lh * 0.8}px` });
    const tl = gsap.timeline({ onComplete: () => caret.remove() });
    for (let i = 0; i < lines; i++) {
      const y = r.top - c.top + i * lh + lh * 0.1;
      const ink = el(fx, "gp-fx-ink", { top: `${y + lh * 0.82}px`, left: `${r.left - c.left}px`, width: `${r.width}px` });
      const w = i === lines - 1 ? r.width * 0.55 : r.width;
      tl.set(caret, { x: r.left - c.left, y, opacity: 1 }, i * 0.75)
        .to(caret, { x: r.left - c.left + w, duration: 0.7, ease: "power2.inOut" }, i * 0.75)
        .fromTo(ink, { scaleX: 0 }, { scaleX: w / r.width, duration: 0.7, ease: "power2.inOut" }, i * 0.75);
      tl.to(ink, { opacity: 0, duration: 0.6, onComplete: () => ink.remove() }, lines * 0.75 + 0.3);
    }
    tl.to(caret, { opacity: 0, duration: 0.2, yoyo: true, repeat: 3, ease: "steps(1)" }, lines * 0.75);
    return tl;
  },
};

export function startScan(card: HTMLElement, role: string): () => void {
  const build = BUILDS[role] ?? BUILDS.ocr;
  const fx = document.createElement("div");
  fx.className = "gp-fx";
  card.appendChild(fx);
  let tl: gsap.core.Timeline | null = null;
  let stopped = false;
  const tilesNow = () => [...card.querySelectorAll<HTMLElement>(".gp-tile")];
  const cycle = () => {
    if (stopped) return;
    tl = build(card, fx, tilesNow());
    const own = tl.eventCallback("onComplete");
    tl.eventCallback("onComplete", () => {
      own?.();
      cycle();
    });
  };
  cycle();
  return () => {
    stopped = true;
    tl?.kill();
    gsap.killTweensOf(fx.querySelectorAll("*"));
    const tiles = tilesNow();
    gsap.killTweensOf(tiles);
    gsap.to(fx, { opacity: 0, duration: 0.3, onComplete: () => fx.remove() });
    gsap.to(tiles, { y: 0, boxShadow: "0 0 0px rgba(141, 184, 255, 0)", filter: "brightness(1)", duration: 0.4, ease: "power2.out", clearProps: "transform,boxShadow,filter" });
  };
}

