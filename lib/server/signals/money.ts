import type { Cited, Fact } from "@/lib/types";
import type { ItemRow } from "./load";
import { cite, fieldValue, findField, parseMoney, parseMoneyAll, type Labeler } from "./util";

// Money is parsed from Clio custom fields by name pattern. Never estimated by a model.

export interface CoverageLine { label: string; per_person: number | null; per_occurrence: number | null; raw: string }

export interface MoneySignals {
  case_value: Cited<number> | null;
  coverage_limit: Cited<number> | null;       // per-person BI limit of the adverse liability policy
  coverage_lines: CoverageLine[];
  coverage_state: "known" | "conflicting" | "not_researched";
  coverage_notes: Cited<string>[];
  underwater: boolean;
  gap_usd: number | null;
  limit_pct_of_value: number | null;
  specials: Cited<number> | null;
  wage_loss: Cited<number> | null;
  liens: Cited<number>[];
  firm_spend: Cited<number>;
  expense_count: number;
}

const F = {
  value: /(estimated|projected|case)\s*(case\s*)?value|valuation/i,
  limits: /policy\s*limits?$|^limits$|coverage\s*limits?|bi\s*limits?/i,
  limitsConfirmed: /limits?.*(confirmed|verified)/i,
  specials: /(medical\s*)?specials|medical\s*(bills|expenses)/i,
  wage: /wage|lost\s*(income|earnings)/i,
  lien: /lien/i,
};

/** Split a limits text into lines; each "$a / $b" pair is per-person / per-occurrence. */
export function parseLimits(text: string): CoverageLine[] {
  const out: CoverageLine[] = [];
  for (const line of text.split(/\n|;/).map((l) => l.trim()).filter(Boolean)) {
    const nums = parseMoneyAll(line);
    if (!nums.length) continue;
    const label = (line.split(":")[0] ?? line).replace(/\$.*/, "").trim() || "Limit";
    const pair = /\$[\d,.]+\s*(k|m)?\s*\/\s*\$/i.test(line);
    out.push({ label, per_person: nums[0], per_occurrence: pair && nums.length > 1 ? nums[1] : null, raw: line });
  }
  return out;
}

/** The adverse BI line: labelled liability / bodily injury / defendant / tortfeasor, else the first pair. */
function adverseLine(lines: CoverageLine[]): CoverageLine | null {
  const own = /\b(um|uim|uninsured|underinsured|no[- ]?fault|pip|med\s*pay|own|client)\b/i;
  return lines.find((l) => /(liabilit|bodily|\bbi\b|defendant|adverse|tortfeasor|third)/i.test(l.label) && !own.test(l.label))
    ?? lines.find((l) => l.per_occurrence != null && !own.test(l.label))
    ?? null;
}

const COVERAGE_DOUBT = /self[- ]?insured|no (stated )?(limit|ceiling|cap)|unknown (limit|coverage)|(additional|another|second|excess|umbrella) (policy|carrier|coverage)|policy (number|no\.?)\s*[A-Z0-9]{5,}|lessor|rental/i;

export function moneySignals(fields: ItemRow[], expenses: ItemRow[], facts: Fact[], contradictionKeys: string[], label: Labeler): MoneySignals {
  const num = (re: RegExp): Cited<number> | null => {
    const f = fields.find((x) => x.title && re.test(x.title) && !/rationale|basis|notes?$|summary|explanation/i.test(x.title));
    if (!f) return null;
    const v = parseMoney(fieldValue(f));
    return v == null ? null : { value: v, cites: [cite(label, f.id)] };
  };

  const case_value = num(F.value);
  const specials = num(F.specials);
  const wage_loss = num(F.wage);

  // limits
  const limF = fields.find((f) => f.title && F.limits.test(f.title) && !F.limitsConfirmed.test(f.title)) ?? null;
  const limText = limF ? String(fieldValue(limF) ?? "") : "";
  const coverage_lines = parseLimits(limText);
  const adv = adverseLine(coverage_lines);
  const coverage_limit = adv?.per_person != null && limF
    ? { value: adv.per_person, cites: [cite(label, limF.id, adv.raw)] } : null;

  const confF = findField(fields, F.limitsConfirmed);
  const confirmedRaw = confF ? fieldValue(confF) : null;
  const confirmed = confirmedRaw === true || /^(true|yes|1|checked)$/i.test(String(confirmedRaw ?? ""));

  // coverage state: not researched unless limits are on file AND confirmed; conflicting if verified
  // coverage facts carry amounts the field does not, or say the limit is in doubt.
  const known = new Set(coverage_lines.flatMap((l) => [l.per_person, l.per_occurrence]).filter((v): v is number => v != null));
  const coverage_notes: Cited<string>[] = [];
  let conflict = contradictionKeys.some((k) => /^coverage|insur|policy|limit/i.test(k));
  for (const f of facts) {
    if (!(f.kind === "coverage" || (f.event_key ?? "").startsWith("coverage"))) continue;
    const amountOff = f.amount_usd != null && known.size > 0 && !known.has(Number(f.amount_usd));
    const doubt = COVERAGE_DOUBT.test(`${f.summary} ${f.quote}`);
    if (amountOff || doubt) {
      conflict = true;
      coverage_notes.push({ value: f.summary, cites: [cite(label, f.source_ref, f.quote)] });
    }
  }
  if (limF && limText && COVERAGE_DOUBT.test(limText)) coverage_notes.push({ value: limText, cites: [cite(label, limF.id)] });
  const carrierF = findField(fields, /carrier|insurer|insurance company/i);
  if (carrierF) {
    const t = String(fieldValue(carrierF) ?? "");
    if (COVERAGE_DOUBT.test(t)) { conflict = true; coverage_notes.push({ value: t, cites: [cite(label, carrierF.id)] }); }
  }
  const coverage_state: MoneySignals["coverage_state"] =
    !coverage_limit || !confirmed ? "not_researched" : conflict ? "conflicting" : "known";

  // liens: amounts in sentences that mention a lien
  const liens: Cited<number>[] = [];
  for (const f of fields.filter((x) => x.title && F.lien.test(x.title))) {
    const text = String(fieldValue(f) ?? "");
    for (const sentence of text.split(/(?<=[.;])\s+|\n/)) {
      if (!/lien/i.test(sentence)) continue;
      for (const v of parseMoneyAll(sentence)) liens.push({ value: v, cites: [cite(label, f.id, sentence.trim())] });
    }
  }

  // firm spend: case costs only. Provider treatment charges entered as expense entries are not firm spend.
  let spend = 0;
  const firmExpenses = expenses.filter((e) => !isTreatmentCharge(e));
  for (const e of firmExpenses) spend += expenseTotal(e);
  const firm_spend: Cited<number> = { value: Math.round(spend * 100) / 100, cites: firmExpenses.map((e) => cite(label, e.id)) };

  const v = case_value?.value ?? null;
  const lim = coverage_limit?.value ?? null;
  return {
    case_value, coverage_limit, coverage_lines, coverage_state, coverage_notes,
    underwater: v != null && lim != null && v > lim,
    gap_usd: v != null && lim != null ? v - lim : null,
    limit_pct_of_value: v && lim != null ? Math.round((lim / v) * 1000) / 10 : null,
    specials, wage_loss, liens, firm_spend, expense_count: firmExpenses.length,
  };
}

export function expenseTotal(e: ItemRow): number {
  const r = (e.raw ?? {}) as Record<string, unknown>;
  const total = r.total != null ? Number(r.total) : Number(r.quantity ?? 1) * Number(r.price ?? 0);
  return isFinite(total) ? total : 0;
}

/** Expense entries that record a provider's treatment charges rather than a cost the firm paid. */
export function isTreatmentCharge(e: ItemRow): boolean {
  const r = (e.raw ?? {}) as Record<string, unknown>;
  const text = `${r.note ?? e.title ?? ""} ${(r.expense_category as { name?: string } | undefined)?.name ?? ""}`;
  if (/\bnot (a )?(patient )?(treatment|medical) charges?\b/i.test(text)) return false;
  return /\b(medical|treatment|provider) (treatment )?charges?\b|\bmedical bills?\b/i.test(text);
}
