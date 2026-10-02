/* The captain cap as a real 3D object.

   Geometry lives in hat space (y up, z toward the viewer when the cap faces front,
   origin = centre of the band's bottom edge, units sized for a round body of radius 100).
   Every frame it is rotated by the head pose, projected orthographically into the svg,
   lit (lambert + a little specular on the peak) and depth sorted (painter's algorithm),
   so the cap really turns, tips and shows its top or its underside.

   Physics: orientation and position chase their targets through damped springs, so the
   cap lags behind fast head moves, overshoots a little and settles (secondary motion). */

type V3 = [number, number, number];
export type HatPose = { x: number; y: number; s: number; yaw: number; pitch: number; roll: number };
export type HatTarget = { x: number; y: number; s: number; yaw: number; pitch: number; roll: number };

const D = Math.PI / 180;

/* ---------- physics ---------- */

const ROT = { k: 150, c: 11 }; // underdamped: visible overshoot, settles in ~0.6s
const POS = { k: 260, c: 17 };
const SUB = 1 / 240;

export class HatSim {
  private t = -1;
  private p: HatPose | null = null;
  private v = { x: 0, y: 0, yaw: 0, pitch: 0, roll: 0 };

  step(t: number, g: HatTarget): HatPose {
    const dt = t - this.t;
    this.t = t;
    if (!this.p || !(dt > 0) || dt > 0.25) {
      this.p = { ...g };
      this.v = { x: 0, y: 0, yaw: 0, pitch: 0, roll: 0 };
      return this.pose(g);
    }
    const p = this.p;
    const v = this.v;
    p.s = g.s;
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(SUB, left);
      left -= h;
      for (const k of ["yaw", "pitch", "roll"] as const) {
        v[k] += (ROT.k * (g[k] - p[k]) - ROT.c * v[k]) * h;
        p[k] += v[k] * h;
      }
      for (const k of ["x", "y"] as const) {
        v[k] += (POS.k * (g[k] - p[k]) - POS.c * v[k]) * h;
        p[k] += v[k] * h;
      }
    }
    return this.pose(g);
  }

  // inertia: when the cap trails the head it leans away from the motion
  private pose(g: HatTarget): HatPose {
    const p = this.p!;
    const s = Math.max(p.s, 0.05);
    const lagX = (p.x - g.x) / s;
    const lagY = (p.y - g.y) / s;
    return {
      x: p.x,
      y: p.y,
      s: p.s,
      yaw: p.yaw,
      pitch: p.pitch + clamp(lagY * 0.7, -12, 12),
      roll: p.roll + clamp(-lagX * 0.8, -16, 16),
    };
  }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Head pose (gaze) to cap orientation. The base pitch tips the crown toward the viewer. */
export function hatTarget(anchor: { x: number; y: number; s: number }, gaze: { yaw: number; pitch: number; roll: number }, lift = 0): HatTarget {
  // lift: 0 = seated, 1 = tipped up off the head (the "ahoy" salute)
  return {
    x: anchor.x + 10 * lift * anchor.s,
    y: anchor.y + (21 - 46 * lift) * anchor.s,
    s: anchor.s,
    yaw: gaze.yaw * 0.85,
    pitch: -18 + gaze.pitch * 0.3 - 14 * lift,
    roll: gaze.roll * 0.55 + 24 * lift,
  };
}

/* ---------- geometry ---------- */

const N = 40;
const SIZE = 1.06;
const BAND = { rx: 51, rz: 45, h: 19 };
const CROWN = { rx: 74, rz: 64 };
const crownY = (a: number) => 40 + 6 * Math.max(0, Math.sin(a)) ** 2; // the front of the top is raised
const PEAK = { from: 18 * D, to: 162 * D, rx: 70, rz: 76, drop: -9 };

type Face = { pts: V3[]; n: V3; c: V3; color: string; kind: "solid" | "peak"; cull: boolean };
type Deco =
  | { type: "seg"; at: V3; to: V3; normal: V3 }
  | { type: "mark"; at: V3; normal: V3; scale?: number; draw: (m: string) => string };

const ring = (rx: number, rz: number, y: number | ((a: number) => number), a: number): V3 => [Math.cos(a) * rx, typeof y === "number" ? y : y(a), Math.sin(a) * rz];

const WHITE = "#fbfbf9";
const NAVY = "#18213b";
const PEAK_C = "#1a1d26";
const UNDER = "#0b0c10";
const GOLD = "#e9b949";
const GOLD_D = "#a97a22";

// Newell's method: robust polygon normal
function newell(p: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([x, y, z]);
}
const centroid = (p: V3[]): V3 => p.reduce<V3>((a, v) => [a[0] + v[0] / p.length, a[1] + v[1] / p.length, a[2] + v[2] / p.length], [0, 0, 0]);

function face(pts: V3[], color: string, kind: Face["kind"], outward: (c: V3) => V3): Face {
  const c = centroid(pts);
  let n = newell(pts);
  if (dot(n, outward(c)) < 0) n = [-n[0], -n[1], -n[2]];
  return { pts, n, c, color, kind, cull: kind === "solid" };
}
const radial = (c: V3): V3 => [c[0], 0, c[2]];

function build(): { faces: Face[]; decos: Deco[] } {
  const faces: Face[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const b = ((i + 1) / N) * Math.PI * 2;
    faces.push(face([ring(BAND.rx, BAND.rz, 0, a), ring(BAND.rx, BAND.rz, 0, b), ring(BAND.rx, BAND.rz, BAND.h, b), ring(BAND.rx, BAND.rz, BAND.h, a)], NAVY, "solid", radial));
    faces.push(face([ring(BAND.rx, BAND.rz, BAND.h, a), ring(BAND.rx, BAND.rz, BAND.h, b), ring(CROWN.rx, CROWN.rz, crownY, b), ring(CROWN.rx, CROWN.rz, crownY, a)], WHITE, "solid", radial));
  }
  const top: V3[] = [];
  for (let i = 0; i < N; i++) top.push(ring(CROWN.rx, CROWN.rz, crownY, (i / N) * Math.PI * 2));
  faces.push(face(top, WHITE, "solid", () => [0, 1, 0]));
  const M = 18;
  const reach = (x: number) => 0.55 + 0.45 * Math.sin(x);
  const outer = (x: number): V3 => {
    const r = reach(x);
    return [Math.cos(x) * (BAND.rx + (PEAK.rx - BAND.rx) * r), PEAK.drop * r, Math.sin(x) * (BAND.rz + (PEAK.rz - BAND.rz) * r)];
  };
  for (let i = 0; i < M; i++) {
    const a = PEAK.from + ((PEAK.to - PEAK.from) * i) / M;
    const b = PEAK.from + ((PEAK.to - PEAK.from) * (i + 1)) / M;
    faces.push(face([ring(BAND.rx, BAND.rz, 1, a), outer(a), outer(b), ring(BAND.rx, BAND.rz, 1, b)], PEAK_C, "peak", () => [0, 1, 0]));
  }

  const decos: Deco[] = [];
  const K = 24;
  for (let i = 0; i < K; i++) {
    const a = 22 * D + (136 * D * i) / K;
    const b = 22 * D + (136 * D * (i + 1)) / K;
    const m = (a + b) / 2;
    decos.push({ type: "seg", at: ring(BAND.rx + 0.6, BAND.rz + 0.6, 4, a), to: ring(BAND.rx + 0.6, BAND.rz + 0.6, 4, b), normal: [Math.cos(m), 0, Math.sin(m)] });
  }
  for (const a of [22 * D, 158 * D])
    decos.push({ type: "mark", at: ring(BAND.rx + 1, BAND.rz + 1, 4, a), normal: [Math.cos(a), 0, Math.sin(a)], draw: (m) => `<circle r="3.6" fill="${GOLD}" stroke="${GOLD_D}" stroke-width=".8" transform="${m}"></circle>` });
  // anchor badge, sitting on the front slope of the crown
  const by = 30;
  const t = (by - BAND.h) / (crownY(Math.PI / 2) - BAND.h);
  decos.push({
    type: "mark",
    scale: 1.3,
    at: [0, by, BAND.rz + (CROWN.rz - BAND.rz) * t + 0.8],
    normal: norm([0, CROWN.rz - BAND.rz, crownY(Math.PI / 2) - BAND.h]),
    draw: (m) =>
      `<g transform="${m}" fill="none" stroke="${GOLD}" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M-6 9C-15 6-18-4-13-13M6 9C15 6 18-4 13-13" stroke-width="2.2"></path>` +
      `<path d="M-14 1l-4-2M-14-6l-4-1M14 1l4-2M14-6l4-1" stroke-width="1.8"></path>` +
      `<circle cx="0" cy="-16" r="3" stroke-width="2"></circle>` +
      `<path d="M0-13V8M-5.5-8H5.5M-8 1Q-6 9 0 9Q6 9 8 1" stroke-width="2.4"></path></g>`,
  });
  return { faces, decos };
}

/* ---------- projection + shading ---------- */

function rotation(yaw: number, pitch: number, roll: number) {
  const cy = Math.cos(yaw * D), sy = Math.sin(yaw * D);
  const cp = Math.cos(pitch * D), sp = Math.sin(pitch * D);
  const cr = Math.cos(roll * D), sr = Math.sin(roll * D);
  return (v: V3): V3 => {
    // yaw about up: front (+z) turns toward +x
    let x = v[0] * cy + v[2] * sy;
    const y0 = v[1];
    let z = -v[0] * sy + v[2] * cy;
    // pitch about x: front tips up for positive pitch
    const y = y0 * cp + z * sp;
    z = -y0 * sp + z * cp;
    // roll in the picture plane (svg angle sense: positive = clockwise on screen)
    const x2 = x * cr + y * sr;
    const y2 = -x * sr + y * cr;
    x = x2;
    return [x, y2, z];
  };
}

const LIGHT: V3 = norm([-0.45, 0.75, 0.62]);
function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function shade(hex: string, k: number, spec = 0) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number) => Math.max(0, Math.min(255, Math.round(c * k + 255 * spec)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => ch(c).toString(16).padStart(2, "0")).join("")}`;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

let MODEL: ReturnType<typeof build> | null = null;

export function hat3dMarkup(p: HatPose, alpha: number): string {
  if (p.s < 0.04 || alpha <= 0.01) return "";
  MODEL ??= build();
  const R = rotation(p.yaw, p.pitch, p.roll);
  const k = p.s * SIZE;
  const toSvg = (v: V3) => [p.x + v[0] * k, p.y - v[1] * k] as const;
  // layers: peak behind the crown, the shell (convex, so its front faces never overlap), trim on the shell, peak in front
  const items: { z: number; layer: number; svg: string }[] = [];

  for (const f of MODEL.faces) {
    const n = R(f.n);
    if (f.cull && n[2] <= 0) continue;
    let color: string;
    if (f.kind === "peak") {
      if (n[2] >= 0) {
        const lit = Math.max(0, dot(n, LIGHT));
        const h = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
        const sp = Math.pow(Math.max(0, dot(n, h)), 30) * 0.35;
        color = shade(f.color, 0.75 + 0.9 * lit, sp);
      } else color = UNDER;
    } else color = shade(f.color, (f.color === WHITE ? 0.84 : 0.74) + (f.color === WHITE ? 0.2 : 0.3) * Math.max(0, dot(n, LIGHT)));
    const w = f.pts.map(R);
    const d = w.map((v, i) => { const [x, y] = toSvg(v); return `${i ? "L" : "M"}${r2(x)} ${r2(y)}`; }).join("") + "Z";
    items.push({ z: R(f.c)[2], layer: f.kind === "peak" ? (R(f.c)[2] > 0 ? 3 : 0) : 1, svg: `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="${r2(0.6)}" stroke-linejoin="round"></path>` });
  }

  for (const d of MODEL.decos) {
    const n = R(d.normal);
    if (n[2] <= 0.04) continue;
    const fade = r2(Math.min(1, (n[2] - 0.04) / 0.2));
    const at = R(d.at);
    const [sx, sy] = toSvg(at);
    if (d.type === "seg") {
      const [qx, qy] = toSvg(R(d.to));
      items.push({ z: at[2], layer: 2, svg: `<path d="M${r2(sx)} ${r2(sy)}L${r2(qx)} ${r2(qy)}" stroke="${GOLD}" stroke-width="${r2(3.2 * k)}" stroke-linecap="round" opacity="${fade}"></path>` });
      continue;
    }
    // affine map of the surface's tangent frame, same trick the eyes use
    const nl = norm(d.normal);
    const tx = norm(cross([0, 1, 0], nl));
    const up = norm(cross(nl, tx));
    const ux = R(tx);
    const uy = R(up);
    const b = k * (d.scale ?? 1);
    const m = `matrix(${r2(ux[0] * b)},${r2(-ux[1] * b)},${r2(-uy[0] * b)},${r2(uy[1] * b)},${r2(sx)},${r2(sy)})`;
    items.push({ z: at[2] + 1, layer: 2, svg: `<g opacity="${fade}">${d.draw(m)}</g>` });
  }

  items.sort((a, b) => a.layer - b.layer || a.z - b.z);
  return `<g opacity="${alpha}">${items.map((i) => i.svg).join("")}</g>`;
}
