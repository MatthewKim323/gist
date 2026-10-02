// Radar thresholds. Every signal reads one of these, so a firm can tune the radar without touching logic.
export const RADAR = {
  /** statute of limitations: medium inside this many days, high inside sol_high_days (or passed) */
  sol_watch_days: 90,
  sol_high_days: 30,
  /** days since the last real client contact before the case reads as silent; high past client_silent_high_days */
  client_silent_days: 30,
  client_silent_high_days: 60,
  /** provider asks: high once the worst ask has been outstanding this long */
  provider_ask_high_days: 90,
  /** phase stalled: time in stage, or a thin current-phase gate */
  stage_stall_days: 180,
  gate_min_pct: 0.25,
  gate_min_missing: 3,
  /** treatment gap: a stretch with no visit to any provider longer than this */
  treatment_gap_days: 30,
  /** only gaps that ended inside this window count (older gaps are history, not a to-do) */
  treatment_gap_lookback_days: 365,
} as const;
