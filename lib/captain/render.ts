import { mixHex, NOTIF_COLOR } from "./engine";
import { hatMarkup, type HatId } from "./hats";
import type { HatPose } from "./hat3d";
import { faceMarkup, MOUTH_BY_EXPRESSION, type Eye } from "./face";

export const VIEW = 158;

type Dot = { x: number; y: number; r: number; d?: string; rot?: number; color?: string; depth?: number; opacity: number };
type Arc = { id: string; front: string; back: string; width: number; opacity: number; grad: { x1: number; y1: number; x2: number; y2: number; stops: string[] } };
export type Frame = {
  hat: HatPose;
  bodyPath: string;
  bodyAlpha: number;
  eyes: Eye[];
  dots: Dot[];
  dotsBehind: boolean;
  arcs: Arc[];
  notif: { x: number; y: number; r: number } | null;
  notch: { x: number; y: number; r: number } | null;
};

const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function dot(e: Dot, color: string, paper: string) {
  const fill = e.color ?? (e.depth === undefined ? color : mixHex(paper, color, e.depth));
  return e.d
    ? `<path fill="${fill}" opacity="${e.opacity}" d="${e.d}" transform="translate(${e.x} ${e.y}) rotate(${e.rot ?? 0}) scale(100)"></path>`
    : `<circle fill="${fill}" opacity="${e.opacity}" cx="${e.x}" cy="${e.y}" r="${e.r}"></circle>`;
}

/** Inner markup of the mascot svg for one frame. Same layer order as the live player. */
export function frameMarkup(f: Frame, o: { uid: string; color: string; paper: string; hat: HatId; expression?: string }) {
  const m = `bot-mask-${o.uid}`;
  const V = VIEW;
  let s = `<defs><mask id="${m}" maskUnits="userSpaceOnUse" x="${-V}" y="${-V}" width="${V * 2}" height="${V * 2}">`;
  s += `<path d="${f.bodyPath}" fill="#fff"></path>`;
  if (f.notch) s += `<circle cx="${f.notch.x}" cy="${f.notch.y}" r="${f.notch.r}" fill="#000"></circle>`;
  s += `</mask>`;
  for (const a of f.arcs) {
    s += `<linearGradient id="${o.uid}-${a.id}" gradientUnits="userSpaceOnUse" x1="${a.grad.x1}" y1="${a.grad.y1}" x2="${a.grad.x2}" y2="${a.grad.y2}">`;
    a.grad.stops.forEach((c, n) => (s += `<stop offset="${n / (a.grad.stops.length - 1)}" stop-color="${c}"></stop>`));
    s += `</linearGradient>`;
  }
  s += `</defs><g fill="none" stroke-linecap="round">`;
  for (const a of f.arcs) s += `<path d="${a.back}" stroke="url(#${o.uid}-${a.id})" stroke-width="${a.width}" opacity="${a.opacity}"></path>`;
  s += `</g>`;
  const dots = () => f.dots.map((d) => dot(d, o.color, o.paper)).join("");
  if (f.dotsBehind) s += `<g>${dots()}</g>`;
  s += `<g opacity="${f.bodyAlpha}"><path d="${f.bodyPath}" fill="${esc(o.paper)}"></path><g mask="url(#${m})"><rect x="${-V}" y="${-V}" width="${V * 2}" height="${V * 2}" fill="${esc(o.color)}"></rect></g></g>`;
  if (f.eyes.length) s += `<g opacity="${f.bodyAlpha}">${faceMarkup(f.eyes, { uid: o.uid, mouth: MOUTH_BY_EXPRESSION[o.expression ?? "neutre"] ?? "smile", blush: o.color !== "#e152b0" })}</g>`;
  if (o.hat !== "aucun" && f.hat.s > 0.04) s += hatMarkup(o.hat, f.hat, f.bodyAlpha);
  if (!f.dotsBehind) s += `<g>${dots()}</g>`;
  if (f.notif) s += `<circle cx="${f.notif.x}" cy="${f.notif.y}" r="${f.notif.r}" fill="${NOTIF_COLOR}"></circle>`;
  s += `<g fill="none" stroke-linecap="round">`;
  for (const a of f.arcs) s += `<path d="${a.front}" stroke="url(#${o.uid}-${a.id})" stroke-width="${a.width}" opacity="${a.opacity}"></path>`;
  s += `</g>`;
  return s;
}
