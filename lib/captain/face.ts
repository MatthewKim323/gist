/* The captain's face: white eyes with pupils that look where the head looks,
   a glint, cheeks, and a mouth that changes with the expression.
   Everything is placed in the eyes' own projected frames, so it turns with the head. */

export type Eye = { d: string; matrix: string; alpha: number; w: number; h: number };
export type Mouth = "smile" | "grin" | "laugh" | "o" | "big-o" | "flat" | "frown" | "wobble" | "smirk" | "tiny";

export const MOUTH_BY_EXPRESSION: Record<string, Mouth> = {
  neutre: "smile",
  attentif: "tiny",
  surpris: "big-o",
  excite: "laugh",
  heureux: "grin",
  hilare: "laugh",
  colere: "frown",
  triste: "frown",
  effraye: "wobble",
  mefiant: "flat",
  confus: "wobble",
  curieux: "o",
  fier: "smirk",
  timide: "tiny",
  blase: "flat",
  somnolent: "o",
};

const INK = "#11141d";
const r2 = (v: number) => Math.round(v * 100) / 100;
const parse = (m: string) => m.slice(7, -1).split(",").map(Number) as [number, number, number, number, number, number];

// mouth shapes in a frame where the distance between the eyes is 1, y pointing down the face
const MOUTHS: Record<Mouth, (ink: string) => string> = {
  smile: (k) => `<path d="M-.2 0Q0 .16 .2 0" fill="none" stroke="${k}" stroke-width=".07" stroke-linecap="round"></path>`,
  tiny: (k) => `<path d="M-.1 0Q0 .08 .1 0" fill="none" stroke="${k}" stroke-width=".065" stroke-linecap="round"></path>`,
  grin: (k) => `<path d="M-.24-.02Q0 .26 .24-.02Z" fill="${k}" stroke="${k}" stroke-width=".04" stroke-linejoin="round"></path>`,
  laugh: (k) =>
    `<path d="M-.26-.03Q0 .36 .26-.03Z" fill="${k}" stroke="${k}" stroke-width=".04" stroke-linejoin="round"></path><path d="M-.11 .14Q0 .07 .11 .14Q0 .2-.11 .14Z" fill="#f07a8a"></path>`,
  o: (k) => `<ellipse cx="0" cy=".05" rx=".07" ry=".085" fill="${k}"></ellipse>`,
  "big-o": (k) => `<ellipse cx="0" cy=".07" rx=".11" ry=".14" fill="${k}"></ellipse>`,
  flat: (k) => `<path d="M-.15 .04H.15" fill="none" stroke="${k}" stroke-width=".07" stroke-linecap="round"></path>`,
  frown: (k) => `<path d="M-.18 .1Q0-.05 .18 .1" fill="none" stroke="${k}" stroke-width=".07" stroke-linecap="round"></path>`,
  wobble: (k) => `<path d="M-.2 .06Q-.1-.02 0 .06T.2 .06" fill="none" stroke="${k}" stroke-width=".06" stroke-linecap="round"></path>`,
  smirk: (k) => `<path d="M-.16 .04Q.06 .1 .2-.04" fill="none" stroke="${k}" stroke-width=".07" stroke-linecap="round"></path>`,
};

export function faceMarkup(eyes: Eye[], o: { uid: string; mouth: Mouth; blush: boolean }) {
  let s = "";
  const pos: { x: number; y: number; a: number }[] = [];
  eyes.forEach((e, i) => {
    const [a, b, c, d, x, y] = parse(e.matrix);
    pos.push({ x, y, a: e.alpha });
    // pupils drift toward where the eye sits on the head (= where it looks)
    const len = Math.hypot(x, y) || 1;
    const look = Math.min(1, len / 70);
    const sx = (x / len) * look;
    const sy = (y / len) * look;
    const det = a * d - b * c || 1e-6;
    let lx = (d * sx - c * sy) / det;
    let ly = (-b * sx + a * sy) / det;
    const ll = Math.hypot(lx, ly) || 1;
    lx /= ll;
    ly /= ll;
    // round, soft eyes (wider than they are tall when squinting)
    const rx = Math.max(e.w / 2, e.h * 0.4);
    const ry = (e.h / 2) * 0.92;
    const pr = Math.min(rx, ry) * 0.62 + Math.max(rx, ry) * 0.08;
    const roomX = Math.max(0, rx - pr * 0.9);
    const roomY = Math.max(0, ry - pr * 0.9);
    const px = lx * roomX * look;
    const py = ly * roomY * look;
    const clip = `${o.uid}-eye${i}`;
    s +=
      `<g data-eye="" transform="${e.matrix}" opacity="${e.alpha}">` +
      `<clipPath id="${clip}"><ellipse rx="${r2(rx)}" ry="${r2(ry)}"></ellipse></clipPath>` +
      `<ellipse rx="${r2(rx)}" ry="${r2(ry)}" fill="#fff"></ellipse>` +
      `<g clip-path="url(#${clip})"><circle cx="${r2(px)}" cy="${r2(py)}" r="${r2(pr)}" fill="${INK}"></circle>` +
      `<circle cx="${r2(px - pr * 0.32)}" cy="${r2(py - pr * 0.36)}" r="${r2(pr * 0.3)}" fill="#fff"></circle></g>` +
      `</g>`;
  });
  if (pos.length === 2) {
    const [l, r] = pos[0].x <= pos[1].x ? pos : [pos[1], pos[0]];
    const ux = r.x - l.x;
    const uy = r.y - l.y;
    const D = Math.hypot(ux, uy);
    if (D > 4) {
      const alpha = r2(Math.min(l.a, r.a));
      const mx = (l.x + r.x) / 2 - (uy / D) * D * 0.62;
      const my = (l.y + r.y) / 2 + (ux / D) * D * 0.62;
      const m = `matrix(${r2(ux)},${r2(uy)},${r2(-uy)},${r2(ux)},${r2(mx)},${r2(my)})`;
      if (o.blush)
        s += [l, r]
          .map((p, i) => {
            const bx = p.x - (uy / D) * D * 0.36 + (i ? 1 : -1) * (ux / D) * D * 0.08;
            const by = p.y + (ux / D) * D * 0.36 + (i ? 1 : -1) * (uy / D) * D * 0.08;
            return `<ellipse cx="${r2(bx)}" cy="${r2(by)}" rx="${r2(D * 0.16)}" ry="${r2(D * 0.09)}" transform="rotate(${r2((Math.atan2(uy, ux) * 180) / Math.PI)} ${r2(bx)} ${r2(by)})" fill="#ff7d93" opacity="${r2(alpha * 0.38)}"></ellipse>`;
          })
          .join("");
      s += `<g transform="${m}" opacity="${alpha}">${MOUTHS[o.mouth](INK)}</g>`;
    }
  }
  return s;
}
