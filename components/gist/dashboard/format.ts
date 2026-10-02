// Display helpers for the dashboard. Pure formatting: every number comes computed from the API.

const DAY = 86_400_000;

export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // Date-only strings are calendar dates: pin them to local noon so they never shift a day.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "unknown";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtShort(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "?";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  const da = typeof a === "string" ? parseDate(a) : a;
  const db = typeof b === "string" ? parseDate(b) : b;
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / DAY);
}

export function ago(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "";
  const days = daysBetween(d);
  const abs = Math.abs(days);
  const fut = days < 0;
  let s: string;
  if (abs === 0) return "today";
  if (abs === 1) return fut ? "tomorrow" : "yesterday";
  if (abs < 30) s = `${abs}d`;
  else if (abs < 365) s = `${Math.round(abs / 30.4)}mo`;
  else s = `${Math.floor(abs / 365)}y`;
  return fut ? `in ${s}` : `${s} ago`;
}

/** "Apr 23, 2023 · 3y ago" */
export function fmtDateAgo(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  return `${fmtDate(iso)} · ${ago(iso)}`;
}

export function fmtUsd(n: number | null | undefined, opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  if (opts.compact && Math.abs(n) >= 1000) {
    const k = n / 1000;
    if (Math.abs(k) >= 1000) return `$${(k / 1000).toFixed(k % 1000 === 0 ? 0 : 2)}M`;
    return `$${k.toFixed(k % 1 === 0 ? 0 : 1)}k`;
  }
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** 'doc:45#p17' -> { kind: 'doc', id: '45', page: 17 } */
export function parseRef(ref: string): { kind: string; id: string; page: number | null } {
  const [kind, rest = ""] = ref.split(":");
  const [id, frag] = rest.split("#");
  const m = frag?.match(/^p(\d+)$/);
  return { kind: kind ?? "", id: id ?? "", page: m ? Number(m[1]) : null };
}

export function refKindLabel(ref: string): string {
  const { kind, page } = parseRef(ref);
  switch (kind) {
    case "doc":
    case "document":
      return page ? `Doc p.${page}` : "Doc";
    case "field":
      return "Clio field";
    default:
      return kind ? kind[0]!.toUpperCase() + kind.slice(1) : "Source";
  }
}
