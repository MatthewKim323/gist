// Latest eval results (eval/results/latest.json), rendered as tables. Read at build time.
import type { Metadata } from "next";
import Link from "next/link";
import { loadEvalResults, fmtCell } from "@/lib/eval-results";
import { SuiteSection } from "./SuiteView";
import "@/app/styles/gist-share.css";
import "@/app/styles/gist-paper.css";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "gist OS evals", description: "Benchmark results for the gist OS case digest pipeline." };

export default function EvalsPage() {
  const r = loadEvalResults();
  return (
    <main data-router-view="notFound" data-body-class="dark gist-share-body" role="main" className="gs-root gpp-root">
      <article className="gpp-wrap">
        <nav className="gpp-nav">
          <Link href="/">gist.</Link>
          <span>
            <Link href="/whitepaper">White paper</Link>
          </span>
        </nav>
        <header className="gpp-head">
          <p className="gpp-kicker">Evaluation</p>
          <h1 className="gpp-title">gist OS benchmarks</h1>
          <p className="gpp-lede">
            Adaptations of published benchmarks run on one real matter. These are not official leaderboard numbers. Every value below comes
            from <code>eval/results/latest.json</code>, written by <code>scripts/eval.ts</code>.
          </p>
          {r && (
            <dl className="gpp-meta gpp-meta--row">
              <div><dt>Matter</dt><dd>{r.matter_label ?? (r.matter_id != null ? String(r.matter_id) : "n/a")}</dd></div>
              <div><dt>Generated</dt><dd>{r.generated_at ?? "n/a"}</dd></div>
              <div><dt>Total eval spend</dt><dd>{fmtCell(r.total_eval_cost_usd ?? null, "usd")}</dd></div>
              <div><dt>Suites</dt><dd>{r.suites.length}</dd></div>
            </dl>
          )}
        </header>
        {!r || r.suites.length === 0 ? (
          <p className="gpp-empty">No eval run committed yet.</p>
        ) : (
          <>
            <ol className="gpp-toc">
              {r.suites.map((s) => (
                <li key={s.id}><a href={`#${s.id}`}>{s.name}</a></li>
              ))}
            </ol>
            {r.suites.map((s) => <SuiteSection key={s.id} suite={s} />)}
          </>
        )}
      </article>
    </main>
  );
}
