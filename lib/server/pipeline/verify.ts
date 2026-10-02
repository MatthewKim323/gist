import type { FactKind, FactStatus, Audience } from "@/lib/types";

// Deterministic verifier. No model: a quote either sits in the cited source or it doesn't.
// Rejected facts are kept (status 'rejected' + reject_reason) so the UI can show them struck through.

export interface RawFact {
  kind: FactKind;
  event_key: string;
  summary: string;
  event_date: string | null;
  amount_usd: number | null;
  source_ref: string;
  quote: string;
  importance: number;
  audience: Audience;
  provider_name: string | null;
}

export interface SourceText {
  ref: string;
  text: string;
  /** ISO date of the item itself (email sent, note dated, page has none). */
  date: string | null;
}

export interface VerifiedFact extends RawFact {
  quote_verified: boolean;
  quote_score: number | null;
  char_start: number | null;
  status: FactStatus;
  reject_reason: string | null;
}

export const QUOTE_THRESHOLD = 0.85;

/** Normalize and keep a map from each normalized char back to its index in the original. */
export function normalizeWithMap(src: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i].normalize("NFKC").toLowerCase();
    for (const c of ch) {
      const isWord = /[\p{L}\p{N}]/u.test(c);
      if (isWord) {
        norm += c;
        map.push(i);
        lastSpace = false;
      } else if (!lastSpace) {
        norm += " ";
        map.push(i);
        lastSpace = true;
      }
    }
  }
  if (norm.endsWith(" ")) { norm = norm.slice(0, -1); map.pop(); }
  return { norm, map };
}

export function normalize(s: string): string {
  return normalizeWithMap(s).norm;
}

/** Best sliding-window token overlap of the quote against the source, 0..1, plus where it starts. */
export function tokenOverlap(quoteNorm: string, srcNorm: string): { score: number; tokenStart: number } {
  const q = quoteNorm.split(" ").filter(Boolean);
  const s = srcNorm.split(" ").filter(Boolean);
  if (!q.length || !s.length) return { score: 0, tokenStart: -1 };
  const need = new Map<string, number>();
  for (const t of q) need.set(t, (need.get(t) ?? 0) + 1);
  const n = q.length;
  const win = new Map<string, number>();
  let hit = 0;
  let best = 0;
  let bestStart = 0;
  const add = (t: string) => {
    const c = (win.get(t) ?? 0) + 1;
    win.set(t, c);
    if (c <= (need.get(t) ?? 0)) hit++;
  };
  const del = (t: string) => {
    const c = win.get(t) ?? 0;
    if (c <= (need.get(t) ?? 0)) hit--;
    win.set(t, c - 1);
  };
  for (let i = 0; i < s.length; i++) {
    add(s[i]);
    if (i >= n) del(s[i - n]);
    const start = Math.max(0, i - n + 1);
    if (hit > best) { best = hit; bestStart = start; }
  }
  return { score: best / n, tokenStart: bestStart };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Every way a date commonly appears in notes, emails and records, normalized like quotes are. */
function dateForms(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return [];
  const [y, mo, d] = [m[1], Number(m[2]), Number(m[3])];
  const yy = y.slice(2);
  const name = MONTHS[mo - 1];
  if (!name) return [];
  const short = name.slice(0, 3);
  const mm = String(mo).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const forms = [
    `${y} ${mm} ${dd}`,
    `${mo} ${d} ${y}`, `${mm} ${dd} ${y}`, `${mo} ${d} ${yy}`, `${mm} ${dd} ${yy}`,
    `${name} ${d} ${y}`, `${short} ${d} ${y}`, `${d} ${name} ${y}`, `${d} ${short} ${y}`,
    `${name} ${d}`, `${short} ${d}`, `${d} ${name}`,
    `${name} ${d}st`, `${name} ${d}nd`, `${name} ${d}rd`, `${name} ${d}th`,
  ];
  return forms.map(normalize);
}

function hasDate(textNorm: string, iso: string): boolean {
  const padded = ` ${textNorm} `;
  return dateForms(iso).some((f) => padded.includes(` ${f} `));
}

/** Month-and-year only facts ("in March 2024") count when the fact date is the 1st. */
function hasMonthYear(textNorm: string, iso: string): boolean {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return false;
  const name = MONTHS[Number(m[2]) - 1];
  if (!name) return false;
  const padded = ` ${textNorm} `;
  return [`${name} ${m[1]}`, `${name.slice(0, 3)} ${m[1]}`, `${Number(m[2])} ${m[1]}`].some((f) => padded.includes(` ${f} `));
}

function hasAmount(textNorm: string, amount: number): boolean {
  const whole = Math.round(amount);
  const cents = amount.toFixed(2);
  const forms = new Set<string>([
    String(whole), whole.toLocaleString("en-US"), cents, Number(cents).toLocaleString("en-US", { minimumFractionDigits: 2 }),
  ]);
  if (whole % 1000 === 0 && whole >= 1000) { forms.add(`${whole / 1000}k`); forms.add(`${whole / 1000} 000`); }
  if (whole % 1_000_000 === 0 && whole >= 1_000_000) forms.add(`${whole / 1_000_000} million`);
  const padded = ` ${textNorm} `;
  return [...forms].map(normalize).some((f) => f && padded.includes(` ${f} `));
}

export function verifyFacts(raw: RawFact[], sources: Map<string, SourceText>): VerifiedFact[] {
  const normCache = new Map<string, ReturnType<typeof normalizeWithMap>>();
  const srcNorm = (ref: string, text: string) => {
    let v = normCache.get(ref);
    if (!v) { v = normalizeWithMap(text); normCache.set(ref, v); }
    return v;
  };

  return raw.map((f): VerifiedFact => {
    const base = { ...f, quote_verified: false, quote_score: null, char_start: null } as VerifiedFact;
    const src = sources.get(f.source_ref);
    if (!src) return { ...base, status: "rejected", reject_reason: "source_ref not in shard" };
    const q = normalize(f.quote ?? "");
    if (q.length < 3) return { ...base, status: "rejected", reject_reason: "empty quote" };

    const { norm, map } = srcNorm(src.ref, src.text);
    let score = 0;
    let charStart: number | null = null;
    const exact = norm.indexOf(q);
    if (exact >= 0) {
      score = 1;
      charStart = map[exact] ?? null;
    } else {
      const ov = tokenOverlap(q, norm);
      score = ov.score;
      if (ov.tokenStart >= 0) {
        const starts = [...norm.matchAll(/\S+/g)].map((m) => m.index ?? 0);
        charStart = map[starts[ov.tokenStart] ?? 0] ?? null;
      }
    }
    score = Math.round(score * 1000) / 1000;
    if (score < QUOTE_THRESHOLD) {
      return { ...base, quote_score: score, char_start: charStart, status: "rejected", reject_reason: `quote not found in source (overlap ${score.toFixed(2)})` };
    }

    const out: VerifiedFact = { ...base, quote_verified: true, quote_score: score, char_start: charStart, status: "pending", reject_reason: null };

    // Dates and amounts are what lawyers act on, so they must be visible in the quote itself.
    // The item's own date (an email's sent date) also counts: "spoke with client today".
    if (f.event_date) {
      const sameAsItem = src.date && src.date.slice(0, 10) === f.event_date.slice(0, 10);
      if (!sameAsItem && !hasDate(q, f.event_date) && !hasMonthYear(q, f.event_date)) {
        out.status = "needs_review";
        out.reject_reason = "event_date not visible in quote";
      }
    }
    if (f.amount_usd != null && !hasAmount(q, f.amount_usd)) {
      out.status = "needs_review";
      out.reject_reason = out.reject_reason ? `${out.reject_reason}; amount not visible in quote` : "amount not visible in quote";
    }
    return out;
  });
}
