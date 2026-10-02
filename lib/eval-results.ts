import { readFileSync } from "node:fs";
import path from "node:path";

// Loader for the committed eval results (written by scripts/eval.ts). Pages that use it are
// force-static, so the file is read at build time and baked into the HTML; no runtime file access.

export type Cell = string | number | null;
export interface EvalTable { title: string; columns: string[]; rows: Cell[][] }
export interface EvalSuite {
  id: string;
  name: string;
  origin: string;
  adaptation: string;
  n: number | string;
  metrics: Record<string, number | string | null>;
  tables?: EvalTable[];
  notes?: string[];
}
export interface EvalResults {
  generated_at: string | null;
  matter_id?: number;
  matter_label?: string;
  total_eval_cost_usd?: number;
  suites: EvalSuite[];
}

export function loadEvalResults(): EvalResults | null {
  try {
    const raw = readFileSync(path.join(process.cwd(), "eval", "results", "latest.json"), "utf8");
    const data = JSON.parse(raw) as EvalResults;
    if (!data || !Array.isArray(data.suites)) return null;
    return data;
  } catch {
    return null;
  }
}

export function readRepoFile(rel: string): string | null {
  try {
    return readFileSync(path.join(process.cwd(), rel), "utf8");
  } catch {
    return null;
  }
}

/** "context_recall_at_5" -> "context recall at 5" */
export function humanize(key: string): string {
  return key.replace(/_at_(\d+)/g, "@$1").replace(/_/g, " ").replace(/\busd\b/gi, "USD").replace(/\bpct\b/gi, "%");
}

export function fmtCell(v: Cell | undefined, key = ""): string {
  if (v == null) return "n/a";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return String(v);
  const k = key.toLowerCase();
  if (/usd|cost|\$/.test(k)) return `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`;
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return (Math.round(v * 1000) / 1000).toString();
}
