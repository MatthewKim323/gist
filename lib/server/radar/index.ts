import "server-only";
// Firm-wide radar: every case with a saved digest, scanned for what needs a lawyer's attention.
// Deterministic only: reads the latest saved digest per matter (already computed and cited), no model calls.
import { db } from "@/lib/server/db";
import type { Digest } from "@/lib/types";
import { RADAR } from "./config";

export type RadarSeverity = "high" | "medium" | "low";
export type RadarKind =
  | "policy_limits" | "sol" | "client_silent" | "provider_asks" | "phase_stalled"
  | "red_flags" | "treatment_gap" | "coverage";

export interface RadarSignal {
  id: string;
  matter_id: number;
  client: string;
  display_number: string | null;
  kind: RadarKind;
  severity: RadarSeverity;
  headline: string;
  detail: string;
  /** the number the sort uses as a tiebreak inside a severity (days late, days silent, dollars over) */
  days: number | null;
  cite: { source_ref: string; label: string } | null;
  href: string;
}

export interface RadarResult {
  signals: RadarSignal[];
  counts: Record<RadarKind, number>;
  cases_scanned: number;
  cases_total: number;
  generated_at: string;
}

const DAY = 86_400_000;
const RANK: Record<RadarSeverity, number> = { high: 0, medium: 1, low: 2 };

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
function daysBetween(a: string | number, b: string | number): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY);
}
function fmtDate(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}
function firstCite(c: { cites?: { source_ref: string; label?: string }[] } | null | undefined, fallback: string) {
  const x = c?.cites?.[0];
  return x ? { source_ref: x.source_ref, label: x.label ?? fallback } : null;
}

/** Signals for one digest. `now` is injectable so the numbers are testable. */
export function signalsFor(d: Digest, now: number = Date.now()): RadarSignal[] {
  const m = d.matter;
  const out: RadarSignal[] = [];
  const base = `/matter?view=digest&id=${m.id}`;
  const today = new Date(now).toISOString().slice(0, 10);
  // Digest day counts were true when it was generated; age them to today.
  const drift = Math.max(0, daysBetween(d.generated_at, now));
  const push = (s: Omit<RadarSignal, "id" | "matter_id" | "client" | "display_number">) =>
    out.push({ id: `${m.id}:${s.kind}`, matter_id: m.id, client: m.client_name, display_number: m.display_number ?? null, ...s });

  // 1. Specials or value over the per-person limit: a policy-limits demand candidate.
  const lim = d.money.coverage_limit?.value ?? null;
  const spec = d.money.specials?.value ?? null;
  const val = d.money.case_value?.value ?? null;
  if (lim != null && lim > 0) {
    if (spec != null && spec > lim) {
      push({
        kind: "policy_limits", severity: "high", days: spec - lim,
        headline: `Specials ${usd(spec)} exceed the ${usd(lim)} limit: policy-limits demand candidate`,
        detail: `Medical specials alone are ${usd(spec - lim)} over the per-person limit${val != null ? `, against a ${usd(val)} case value` : ""}. Tender the limit or document why not.`,
        cite: firstCite(d.money.specials, "Medical specials"), href: `${base}#money`,
      });
    } else if (val != null && val > lim) {
      push({
        kind: "policy_limits", severity: "medium", days: val - lim,
        headline: `Value ${usd(val)} is ${(val / lim).toFixed(1)}x the ${usd(lim)} limit: policy-limits demand candidate`,
        detail: `The case is underwater by ${usd(val - lim)}${spec != null ? `; specials are ${usd(spec)} so far` : ""}. Check excess and UM/UIM before demanding.`,
        cite: firstCite(d.money.coverage_limit, "Policy limits"), href: `${base}#money`,
      });
    }
  }

  // 2. Statute of limitations closing, and not satisfied. A satisfied SOL shows nothing.
  const sol = m.sol;
  if (sol && sol.satisfied !== true && sol.date?.value) {
    const left = daysBetween(today, sol.date.value);
    if (left <= RADAR.sol_watch_days) {
      const passed = left < 0;
      push({
        kind: "sol", severity: left <= RADAR.sol_high_days ? "high" : "medium", days: -left,
        headline: passed
          ? `SOL passed ${plural(-left, "day")} ago with no filing on record`
          : `SOL in ${plural(left, "day")} (${fmtDate(sol.date.value)}), not yet satisfied`,
        detail: passed ? "Confirm the complaint was filed and mark the limitations task done, or escalate now." : "File or confirm a tolling agreement before the date.",
        cite: firstCite(sol.date, "Statute of limitations"), href: `${base}#phase`,
      });
    }
  }

  // 3. Client silent: last real client contact (call, meeting, email from the client).
  const lcc = d.last_client_contact?.value;
  if (lcc) {
    const silent = daysBetween(lcc, today);
    if (silent > RADAR.client_silent_days) {
      push({
        kind: "client_silent", severity: silent > RADAR.client_silent_high_days ? "high" : "medium", days: silent,
        headline: `Client silent ${plural(silent, "day")}`,
        detail: `Last real contact ${fmtDate(lcc)}${d.last_client_contact_detail?.channel ? ` by ${d.last_client_contact_detail.channel}` : ""}. Check in before the file goes cold.`,
        cite: firstCite(d.last_client_contact, "Last client contact"), href: `${base}#overview`,
      });
    }
  } else {
    push({
      kind: "client_silent", severity: "medium", days: null,
      headline: "No client contact on record",
      detail: "gist found no call, meeting or email with the client in the file.",
      cite: null, href: base,
    });
  }

  // 4. Provider asks overdue or unanswered.
  const asks = d.actions.filter((a) => a.owner === "provider" && (a.bucket === "overdue" || a.bucket === "waiting"));
  if (asks.length) {
    const worst = asks.reduce((w, a) => ((a.days ?? 0) > (w.days ?? 0) ? a : w), asks[0]!);
    const worstDays = (worst.days ?? 0) + drift;
    const owners = new Set(asks.map((a) => a.owner_name).filter(Boolean));
    push({
      kind: "provider_asks", severity: worstDays > RADAR.provider_ask_high_days ? "high" : "medium", days: worstDays,
      headline: `${plural(asks.length, "provider ask")} outstanding, worst ${plural(worstDays, "day")}`,
      detail: `Longest wait: ${worst.owner_name ?? "a provider"}${owners.size > 1 ? ` (and ${plural(owners.size - 1, "other office")})` : ""}. Records and bills gate the demand.`,
      cite: worst.cite ? { source_ref: worst.cite.source_ref, label: worst.cite.label ?? worst.label } : null,
      href: `${base}#actions`,
    });
  }

  // 5. Phase stalled: long time in stage, or a thin current-phase gate.
  const tis = d.phase.time_in_stage_days;
  const cur = d.phase.gates.filter((g) => g.phase === d.phase.current);
  const have = cur.filter((g) => g.status === "have").length;
  const missing = cur.filter((g) => g.status === "missing").length;
  if (tis != null && tis + drift > RADAR.stage_stall_days) {
    push({
      kind: "phase_stalled", severity: "medium", days: tis + drift,
      headline: `${plural(tis + drift, "day")} in ${d.phase.current}`,
      detail: `${have}/${cur.length} ${d.phase.current} gate items in hand${missing ? `, ${missing} missing` : ""}. Move it or note why it waits.`,
      cite: null, href: `${base}#phase`,
    });
  } else if (cur.length && have / cur.length < RADAR.gate_min_pct && missing >= RADAR.gate_min_missing) {
    push({
      kind: "phase_stalled", severity: "medium", days: missing,
      headline: `${d.phase.current} gate ${Math.round((100 * have) / cur.length)}% complete, ${missing} items missing`,
      detail: `Only ${have} of ${cur.length} ${d.phase.current} requirements are in hand. ${d.phase.next ? `Nothing moves to ${d.phase.next} until they are.` : ""}`.trim(),
      cite: null, href: `${base}#phase`,
    });
  }

  // 6. High-severity contradictions: impeachment risk before deposition.
  const hi = d.red_flags.filter((f) => f.severity === "high");
  if (hi.length) {
    const c = hi[0]!.claims[0];
    push({
      kind: "red_flags", severity: "high", days: hi.length,
      headline: `${plural(hi.length, "high-severity red flag")}: impeachment risk`,
      detail: `${hi[0]!.title}. Prep the client before any deposition.`,
      cite: c ? { source_ref: c.source_ref, label: c.label ?? c.says } : null, href: `${base}#flags`,
    });
  }

  // 7. Treatment gap, across all providers merged (a gap with one office covered by another is no gap).
  const visits = d.providers
    .flatMap((p) => p.visits.map((v) => ({ date: v.date.slice(0, 10), cite: v.cite, who: p.name })))
    .filter((v) => v.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (visits.length) {
    const last = visits[visits.length - 1]!;
    const open = daysBetween(last.date, today);
    let gap: { from: string; to: string; days: number; open: boolean; cite: typeof last.cite } | null = null;
    if (open > RADAR.treatment_gap_days) gap = { from: last.date, to: today, days: open, open: true, cite: last.cite };
    for (let i = 1; i < visits.length; i++) {
      const g = daysBetween(visits[i - 1]!.date, visits[i]!.date);
      if (g > RADAR.treatment_gap_days && daysBetween(visits[i]!.date, today) <= RADAR.treatment_gap_lookback_days && (!gap || (!gap.open && g > gap.days)))
        gap = { from: visits[i - 1]!.date, to: visits[i]!.date, days: g, open: false, cite: visits[i]!.cite };
    }
    if (gap) {
      push({
        kind: "treatment_gap", severity: gap.open ? "medium" : "low", days: gap.days,
        headline: gap.open ? `No treatment in ${plural(gap.days, "day")}` : `${gap.days}-day treatment gap`,
        detail: gap.open
          ? `Last visit ${fmtDate(gap.from)}. Defense reads a gap as recovery; confirm the plan or document why.`
          : `No visit to any provider from ${fmtDate(gap.from)} to ${fmtDate(gap.to)}. Get the reason on record before defense finds it.`,
        cite: gap.cite ? { source_ref: gap.cite.source_ref, label: gap.cite.label ?? "Visit" } : null,
        href: `${base}#treatment`,
      });
    }
  }

  // 8. Coverage conflicting or never researched.
  if (d.money.coverage_state !== "known") {
    const conflicting = d.money.coverage_state === "conflicting";
    push({
      kind: "coverage", severity: conflicting ? "medium" : "low", days: null,
      headline: conflicting ? "Coverage sources conflict" : "Coverage not researched",
      detail: conflicting
        ? `The file gives more than one answer on limits${lim != null ? ` (working figure ${usd(lim)} per person)` : ""}. Confirm with the carrier before valuing the demand.`
        : "No policy limits in the file. Send the carrier a limits request.",
      cite: firstCite(d.money.coverage_limit, "Policy limits") ?? firstCite(d.money.coverage_notes[0], "Coverage note"),
      href: `${base}#money`,
    });
  }

  return out;
}

export function sortSignals(s: RadarSignal[]): RadarSignal[] {
  return s.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.days ?? -1) - (a.days ?? -1) || a.client.localeCompare(b.client));
}

/** Every matter's latest digest, scanned. Matters without a digest are counted but have nothing to say yet. */
export async function radar(now: number = Date.now()): Promise<RadarResult> {
  const { data: matters, error } = await db().from("matters").select("id, display_number, client_name");
  if (error) throw new Error(`radar matters: ${error.message}`);
  const list = matters ?? [];
  const digests = await Promise.all(
    list.map(async (m) => {
      const { data } = await db().from("digests").select("json").eq("matter_id", m.id).order("version", { ascending: false }).limit(1).maybeSingle();
      return (data?.json as Digest | undefined) ?? null;
    }),
  );
  const signals: RadarSignal[] = [];
  let scanned = 0;
  for (const d of digests) {
    if (!d?.matter) continue;
    scanned++;
    try {
      signals.push(...signalsFor(d, now));
    } catch (e) {
      console.warn("[radar] skipped matter", d.matter.id, (e as Error).message);
    }
  }
  const counts = { policy_limits: 0, sol: 0, client_silent: 0, provider_asks: 0, phase_stalled: 0, red_flags: 0, treatment_gap: 0, coverage: 0 } as Record<RadarKind, number>;
  for (const s of signals) counts[s.kind]++;
  return { signals: sortSignals(signals), counts, cases_scanned: scanned, cases_total: list.length, generated_at: new Date(now).toISOString() };
}
