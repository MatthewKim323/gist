// Shared contracts between sync, the swarm, the API and the UI. Change with care: every module codes against these.

/** Stable reference to where a fact came from. 'note:123' | 'email:88' | 'call:9' | 'task:4' | 'calendar:7'
 *  | 'expense:3' | 'field:<name>' | 'doc:45#p17'. Every number or date on screen carries one. */
export type SourceRef = string;

export type SourceKind =
  | "note" | "email" | "call" | "task" | "calendar" | "expense"
  | "contact" | "relationship" | "field" | "document";

export interface SourceItem {
  id: SourceRef;           // '<kind>:<clio id>'
  matter_id: number;
  kind: SourceKind;
  clio_id: number;
  title: string | null;
  body_text: string | null;
  occurred_at: string | null;
  raw: unknown;
  content_hash: string;
  first_seen_at: string;
  content_changed_at: string;
  clio_url: string | null;
}

export type FactKind =
  | "event" | "injury" | "treatment" | "provider" | "coverage" | "liability" | "money"
  | "expense" | "deadline" | "client_contact" | "status_change" | "request" | "material"
  | "strategy" | "prior_injury" | "witness" | "other";

export type FactStatus = "pending" | "verified" | "rejected" | "needs_review";
export type Audience = "internal_only" | "provider_safe";

export interface Fact {
  id: string;
  matter_id: number;
  source_ref: SourceRef;
  kind: FactKind;
  event_key: string | null;   // e.g. 'accident.mechanism', 'prior_injury.left_ankle', 'material.police_report'
  summary: string;
  event_date: string | null;  // ISO date
  amount_usd: number | null;
  quote: string;
  quote_verified: boolean;
  quote_score: number | null;
  importance: number;         // 1..5
  audience: Audience;
  provider_contact_id: number | null;
  jev_support: "supports" | "contradicts" | "unsupported" | null;
  jev_confidence: number | null;
  status: FactStatus;
  reject_reason: string | null;
}

export interface Citation {
  source_ref: SourceRef;
  quote?: string;
  label?: string;             // human label, e.g. 'Email · May 7 2023 · Photographs of my paperwork'
}

/** A value shown on screen with its provenance. */
export interface Cited<T> {
  value: T;
  cites: Citation[];
}

// ---------------- phases + gates ----------------
export const PHASES = [
  "Intake", "Treatment", "Demand", "Negotiation", "Litigation", "Trial", "Disbursement", "Closed",
] as const;
export type Phase = (typeof PHASES)[number];

export type GateStatus = "have" | "partial" | "missing" | "conflicting";
export type Owner = "client" | "provider" | "defense" | "carrier" | "firm" | "court";

export interface GateItem {
  requirement_key: string;
  phase: Phase;
  label: string;
  status: GateStatus;
  owed_by: Owner | null;
  owed_by_contact_id: number | null;
  owed_by_name: string | null;
  due_date: string | null;
  days_outstanding: number | null;
  evidence: Citation[];
  note: string | null;
  confidence: number | null;
}

// ---------------- dashboard payload ----------------
export interface ActionItem {
  id: string;
  label: string;
  bucket: "overdue" | "upcoming" | "waiting";
  due_date: string | null;
  days: number | null;        // days overdue (positive) or until due
  owner: Owner | null;
  owner_name: string | null;
  cite: Citation;
}

export interface Contradiction {
  id: string;
  title: string;
  why_it_matters: string;
  severity: "low" | "medium" | "high";
  claims: { source_ref: SourceRef; says: string; quote: string; date: string | null; label?: string }[];
}

export interface ProviderLane {
  contact_id: number;
  name: string;
  role: string | null;        // from the relationship description
  first_visit: string | null;
  last_visit: string | null;
  visits: { date: string; cite: Citation }[];
  gaps: { from: string; to: string; days: number }[];
  last_heard_from: string | null;
  open_asks: number;
  /** provider charges recorded on the matter (expense entries for treatment), with their service window */
  billed?: Cited<number> | null;
  services_from?: string | null;
  services_to?: string | null;
}

export interface Digest {
  matter: {
    id: number;
    display_number: string;
    client_name: string;
    photo_url: string | null;
    incident_date: Cited<string> | null;
    days_since_incident: number | null;
    stage: Phase | string;
    stage_since: string | null;
    responsible_attorney: string | null;
    clio_url: string;
    /** statute of limitations: matter field + SOL task; days_remaining negative once passed */
    sol?: { date: Cited<string>; days_remaining: number; satisfied: boolean | null } | null;
    open_date?: string | null;
  };
  money: {
    case_value: Cited<number> | null;
    coverage_limit: Cited<number> | null;
    coverage_state: "known" | "conflicting" | "not_researched";
    coverage_notes: Cited<string>[];
    underwater: boolean;
    specials: Cited<number> | null;
    liens: Cited<number>[];
    firm_spend: Cited<number>;
    wage_loss?: Cited<number> | null;
    gap_usd?: number | null;             // case value minus per-person limit
    limit_pct_of_value?: number | null;  // limit as % of value
    coverage_lines?: { label: string; per_person: number | null; per_occurrence: number | null; raw: string }[];
    expense_count?: number;
  };
  story: { text: string; cites: Citation[] }[];
  phase: {
    current: Phase | string;
    next: Phase | string | null;
    time_in_stage_days: number | null;
    gates: GateItem[];
  };
  red_flags: Contradiction[];
  actions: ActionItem[];
  last_client_contact: Cited<string> | null;
  last_client_contact_detail?: { channel: string | null; days_ago: number | null; last_written_from_client: Cited<string> | null };
  since_last_opened: { at: string | null; items: { label: string; kind: string; cite: Citation }[] };
  injuries: { label: string; body_part: string | null; cites: Citation[] }[];
  providers: ProviderLane[];
  top_facts: Fact[];
  completeness: {
    entries_read: number; entries_total: number;
    pages_read: number; pages_total: number;
    pages_ocr: number;
    facts_verified: number; facts_rejected: number; facts_review: number;
  };
  cost: { cold_usd: number; last_run_usd: number; models: string[] };
  generated_at: string;
}

// ---------------- provider view ----------------
export type ShareSection =
  | "status" | "coverage_tier" | "firm_needs" | "records_bills" | "attendance" | "next_visits" | "updates";

export interface ShareConfig {
  sections: Record<ShareSection, boolean>;
  coverage_detail: "hidden" | "tier" | "exact";
  fact_overrides: Record<string, boolean>;
  redact_terms: string[];
}

export interface ProviderView {
  provider_name: string;
  firm_name: string | null;
  client_initials: string;
  stage: string | null;
  case_alive: { alive: boolean; last_activity: string | null } | null;
  coverage: { tier: string; detail: string | null } | null;
  firm_needs: { label: string; due_date: string | null; days_outstanding: number | null }[] | null;
  records_bills: { label: string; status: GateStatus }[] | null;
  attendance: { attended: number; scheduled: number; window_days: number } | null;
  next_visits: { date: string; label: string }[] | null;
  updates: { date: string; text: string }[] | null;
  redacted_sections: ShareSection[];
}

// ---------------- pipeline ----------------
export type AgentRole =
  | "sync" | "ocr" | "extract" | "verify" | "jev" | "embed" | "reconcile" | "gate" | "synth";

export type TaskStatus = "queued" | "running" | "done" | "cached" | "failed";

export interface AgentTask {
  id: number;
  run_id: string;
  role: AgentRole;
  shard_label: string | null;
  status: TaskStatus;
  worker: string | null;
  started_at: string | null;
  finished_at: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  facts_emitted: number;
  last_event: string | null;  // counts only, never case content (anon can read this table)
}
