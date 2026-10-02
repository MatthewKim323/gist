"use client";
// Dashboard charts (bklit, visx under the hood). Every value comes straight off the digest; nothing is
// estimated here. Colors are bklit's CSS variables, mapped to the night palette in gist-dashboard.css.
import { BarChart } from "@/components/bklit/charts/bar-chart";
import { Bar } from "@/components/bklit/charts/bar";
import { BarYAxis } from "@/components/bklit/charts/bar-y-axis";
import { Grid } from "@/components/bklit/charts/grid";
import { ChartTooltip } from "@/components/bklit/charts/tooltip";
import { FunnelChart } from "@/components/bklit/charts/funnel-chart";
import type { Digest } from "@/lib/types";
import { fmtUsd } from "./format";

/** Case value against what can actually pay it: coverage, liens and what the firm has spent. */
export function MoneyBars({ d }: { d: Digest }) {
  const m = d.money;
  const liens = m.liens.reduce((s, l) => s + (l.value ?? 0), 0);
  const rows = [
    { name: "Case value", value: m.case_value?.value ?? null },
    { name: "Coverage", value: m.coverage_limit?.value ?? null },
    { name: "Specials", value: m.specials?.value ?? null },
    { name: "Wage loss", value: m.wage_loss?.value ?? null },
    { name: "Liens", value: liens || null },
    { name: "Firm spend", value: m.firm_spend?.value ?? null },
  ].filter((r): r is { name: string; value: number } => r.value != null && r.value > 0);
  if (rows.length < 2) return null;
  return (
    <section className="gd-panel gd-chart">
      <div className="gd-chart__head">
        <h2 className="gd-chart__title">Value against coverage</h2>
        <span className="gd-chart__sub">{m.underwater ? "Underwater: value runs past the per-person limit" : "From the money facts above"}</span>
      </div>
      <BarChart data={rows} xDataKey="name" orientation="horizontal" aspectRatio="2.6 / 1" margin={{ top: 8, right: 24, bottom: 8, left: 180 }}>
        <Grid horizontal={false} vertical />
        <Bar dataKey="value" fill="var(--chart-line-primary)" lineCap={6} />
        <BarYAxis showAllLabels />
        <ChartTooltip rows={(p) => [{ color: "var(--chart-line-primary)", label: String(p.name), value: fmtUsd(Number(p.value)) }]} />
      </BarChart>
    </section>
  );
}

/** What happened to every fact the swarm proposed: quote matched in the source, then verified onto the screen. */
export function FactsFunnel({ d }: { d: Digest }) {
  const c = d.completeness;
  const proposed = c.facts_verified + c.facts_rejected + c.facts_review;
  if (!proposed) return null;
  const data = [
    { label: "Facts proposed", value: proposed },
    { label: "Quote found in source", value: c.facts_verified + c.facts_review },
    { label: "Verified, on screen", value: c.facts_verified },
  ];
  return (
    <section className="gd-panel gd-chart">
      <div className="gd-chart__head">
        <h2 className="gd-chart__title">From the file to the screen</h2>
        <span className="gd-chart__sub">
          {c.facts_rejected.toLocaleString()} thrown out by the verifier · {c.facts_review.toLocaleString()} sent to attorney review
        </span>
      </div>
      <div className="gd-chart__funnel">
        <FunnelChart
          data={data}
          color="#6f93d6"
          layers={3}
          gap={6}
          showPercentage
          showValues
          showLabels
          formatValue={(v) => v.toLocaleString()}
          style={{ aspectRatio: "auto", width: "100%", height: "100%" }}
        />
      </div>
    </section>
  );
}
