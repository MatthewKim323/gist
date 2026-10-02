// Provider-share vocabulary shared by the server (view builder) and the client (composer + page).
// No server-only import on purpose: this file holds copy and defaults, never case data.
import type { ShareConfig, ShareSection } from "@/lib/types";

/** Coarse stage tracker a front desk can read at a glance. Litigation detail stays with the firm. */
export const PLAIN_STAGES: { phase: string; label: string; blurb: string }[] = [
  { phase: "Intake", label: "Getting started", blurb: "The firm is opening the case and collecting the basics." },
  { phase: "Treatment", label: "Patient in treatment", blurb: "Your patient is treating. The firm is tracking care and collecting records." },
  { phase: "Demand", label: "Preparing the claim", blurb: "The firm is assembling records and bills to present the claim." },
  { phase: "Negotiation", label: "Negotiating", blurb: "The claim is with the other side and being negotiated." },
  { phase: "Litigation", label: "Lawsuit in progress", blurb: "A lawsuit has been filed and the case is moving through the court process." },
  { phase: "Trial", label: "Trial", blurb: "The case is being prepared for or is in trial." },
  { phase: "Disbursement", label: "Resolving payments", blurb: "The case has resolved and payments are being processed." },
  { phase: "Closed", label: "Closed", blurb: "The case is closed." },
];

export function plainStage(stage: string | null | undefined) {
  if (!stage) return null;
  const s = stage.toLowerCase();
  const i = PLAIN_STAGES.findIndex((p) => s.includes(p.phase.toLowerCase()));
  if (i >= 0) return { index: i, ...PLAIN_STAGES[i] };
  if (/settle|disburs/.test(s)) return { index: 6, ...PLAIN_STAGES[6] };
  if (/discover|suit|court|motion/.test(s)) return { index: 4, ...PLAIN_STAGES[4] };
  if (/negot|offer/.test(s)) return { index: 3, ...PLAIN_STAGES[3] };
  if (/treat|medical/.test(s)) return { index: 1, ...PLAIN_STAGES[1] };
  return { index: 0, ...PLAIN_STAGES[0] };
}

export const SECTION_ORDER: ShareSection[] = [
  "status", "firm_needs", "coverage_tier", "records_bills", "attendance", "next_visits", "updates",
];

export const SECTION_LABELS: Record<ShareSection, { title: string; hint: string }> = {
  status: { title: "Case status", hint: "Heartbeat plus coarse stage in plain English" },
  firm_needs: { title: "What the firm needs", hint: "Missing items owed by this office, with due dates" },
  coverage_tier: { title: "Coverage", hint: "Whether coverage is confirmed. No dollars unless you choose exact" },
  records_bills: { title: "Records and bills", hint: "This office's own records and bills checklist" },
  attendance: { title: "Patient attendance", hint: "Visits kept vs scheduled, last 90 days" },
  next_visits: { title: "Upcoming visits", hint: "Next scheduled appointments at this office" },
  updates: { title: "Case updates", hint: "Provider-safe facts only. Off by default" },
};

export function defaultShareConfig(): ShareConfig {
  return {
    sections: {
      status: true, coverage_tier: true, firm_needs: true, records_bills: true,
      attendance: true, next_visits: true, updates: false,
    },
    coverage_detail: "tier",
    fact_overrides: {},
    redact_terms: [],
  };
}

/** Accepts anything from a request body and returns a well-formed config. */
export function normalizeConfig(input: unknown): ShareConfig {
  const d = defaultShareConfig();
  if (!input || typeof input !== "object") return d;
  const c = input as Partial<ShareConfig>;
  const sections = { ...d.sections };
  for (const k of Object.keys(sections) as ShareSection[]) {
    if (typeof c.sections?.[k] === "boolean") sections[k] = c.sections[k];
  }
  const coverage_detail = c.coverage_detail === "hidden" || c.coverage_detail === "exact" ? c.coverage_detail : "tier";
  const fact_overrides: Record<string, boolean> = {};
  if (c.fact_overrides && typeof c.fact_overrides === "object") {
    for (const [k, v] of Object.entries(c.fact_overrides)) if (typeof v === "boolean") fact_overrides[k] = v;
  }
  const redact_terms = Array.isArray(c.redact_terms)
    ? c.redact_terms.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 50)
    : [];
  return { sections, coverage_detail, fact_overrides, redact_terms };
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", ...opts });
}

export function daysAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}
