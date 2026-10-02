import { STATES, STATE_BY_ID, STATE_ORDER, ease, clamp } from "./engine";
import { t } from "./i18n";

export type Block = { state: string; duration: number };
export type Cycle = { id: string; name: string; blocks: Block[] };
export type Look = { yaw: number; pitch: number; mix: number; spin: number; wander: number };

export const LOOK_RETURN = 1.1;
export const SETTINGS_FACES = ["surpris", "heureux", "hilare", "excite", "fier", "blase"];
export const INTRO_SPIN = 1.5;
export const introGaze = (e: number): Look => ({ yaw: 0, pitch: 0, mix: 0, spin: 360 * (1 - ease.easeInOutCubic(clamp(e / INTRO_SPIN))), wander: 1 });
export function followLook({ nx, ny, tour, pointer }: { nx: number; ny: number; tour: number; pointer: boolean }): Look {
  return { yaw: -26 + nx * 16, pitch: 10 - ny * 13, mix: tour, spin: 360 * (1 - tour), wander: +!pointer };
}

const MAX_MORPH = Math.max(...STATES.map((s: { morph: number }) => s.morph));
export const STEP = 0.1;
const DEFAULT_ID = "defaut";

const minDuration = (s: string) => Math.max(MAX_MORPH, STATE_BY_ID.get(s)?.minDuration ?? MAX_MORPH);
export function snapDuration(s: string, d: number) {
  const n = Math.round(d / STEP) * STEP;
  return Math.round(Math.min(10, Math.max(minDuration(s), n)) * 100) / 100;
}
export const block = (s: string): Block => ({ state: s, duration: snapDuration(s, STATE_BY_ID.get(s)?.duration ?? 2) });
export const defaultCycle = (): Cycle => ({ name: "", id: DEFAULT_ID, blocks: STATE_ORDER.map(block) });
export const total = (b: Block[]) => b.reduce((a, x) => a + x.duration, 0);
export function startOf(b: Block[], i: number) {
  let n = 0;
  for (let r = 0; r < i && r < b.length; r++) n += b[r].duration;
  return n;
}
export function locate(b: Block[], tm: number) {
  const n = total(b);
  if (!b.length || n <= 0) return { index: 0, elapsed: 0 };
  const r = tm >= 0 && tm < n ? tm : ((tm % n) + n) % n;
  let i = 0;
  for (let k = 0; k < b.length; k++) {
    const end = i + b[k].duration;
    if (r < end) return { index: k, elapsed: r - i };
    i = end;
  }
  return { index: b.length - 1, elapsed: 0 };
}
export const append = (b: Block[], s: string) => (b.length >= 200 ? b : [...b, block(s)]);
export function move(b: Block[], from: number, to: number) {
  const r = b.slice();
  const [x] = r.splice(from, 1);
  if (!x) return b;
  r.splice(Math.min(Math.max(to, 0), r.length), 0, x);
  return r;
}
export function uniqueName(name: string, cs: Cycle[]) {
  const s = new Set(cs.map((c) => c.name));
  if (!s.has(name)) return name;
  let n = 2;
  while (s.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}
export function newId(cs: Cycle[]) {
  const s = new Set(cs.map((c) => c.id));
  let n = 1;
  while (s.has(`c${n}`)) n++;
  return `c${n}`;
}
function parseBlock(e: unknown): Block | null {
  if (typeof e !== "object" || !e) return null;
  const { state, duration } = e as Block;
  return typeof state !== "string" || !STATE_ORDER.includes(state) || typeof duration !== "number" || !Number.isFinite(duration)
    ? null
    : { state, duration: snapDuration(state, duration) };
}
function parseCycle(e: unknown, seen: Cycle[]): Cycle | null {
  if (typeof e !== "object" || !e) return null;
  const { id, name, blocks } = e as Cycle;
  if (typeof id !== "string" || !id || typeof name !== "string" || !Array.isArray(blocks)) return null;
  const b = blocks.slice(0, 200).map(parseBlock).filter((x): x is Block => x !== null);
  return !b.length || seen.some((c) => c.id === id) ? null : { id, name, blocks: b };
}
export function parseCycles(raw: string | null): Cycle[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: Cycle[] = [];
  for (const e of v.slice(0, 50)) {
    const c = parseCycle(e, out);
    if (c) out.push(c);
  }
  return out;
}
export const cycleName = (c: Cycle) => c.name || t("cycles.defaultName");

export const INTRO_CYCLE: Block[] = [{ state: "idle", duration: snapDuration("idle", INTRO_SPIN + 0.3) }, block("idle")];
