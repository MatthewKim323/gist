// The white paper (docs/whitepaper/gist-os.md) rendered with live result blocks from eval/results/latest.json.
// Read at build time; `<!-- eval:ID -->` markers in the markdown become that suite's tables.
import type { Metadata } from "next";
import Link from "next/link";
import { loadEvalResults, readRepoFile } from "@/lib/eval-results";
import { SuiteTables } from "@/app/evals/SuiteView";
import { parse, type Block } from "./md";
import "@/app/styles/gist-share.css";
import "@/app/styles/gist-paper.css";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "gist OS: technical report",
  description: "gist OS: verified case digests for personal-injury firms. System design, method and evaluation.",
};

export default function WhitepaperPage() {
  const md = readRepoFile("docs/whitepaper/gist-os.md");
  const results = loadEvalResults();
  const byId = new Map((results?.suites ?? []).map((s) => [s.id, s]));
  const blocks = md ? parse(md) : [];

  const render = (b: Block, k: number) => {
    switch (b.t) {
      case "h": {
        const Tag = (`h${Math.min(4, b.level)}`) as "h1" | "h2" | "h3" | "h4";
        return <Tag key={k} id={b.id} className={b.level === 1 ? "gpp-title" : undefined} dangerouslySetInnerHTML={{ __html: b.html }} />;
      }
      case "p": return <p key={k} dangerouslySetInnerHTML={{ __html: b.html }} />;
      case "ul": return <ul key={k}>{b.items.map((x, j) => <li key={j} dangerouslySetInnerHTML={{ __html: x }} />)}</ul>;
      case "ol": return <ol key={k}>{b.items.map((x, j) => <li key={j} dangerouslySetInnerHTML={{ __html: x }} />)}</ol>;
      case "code": return <pre key={k} className="gpp-pre"><code>{b.text}</code></pre>;
      case "quote": return <blockquote key={k} dangerouslySetInnerHTML={{ __html: b.html }} />;
      case "hr": return <hr key={k} />;
      case "table":
        return (
          <div key={k} className="gpp-scroll">
            <table className="gpp-table">
              <thead><tr>{b.head.map((h, j) => <th key={j} dangerouslySetInnerHTML={{ __html: h }} />)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, x) => <td key={x} dangerouslySetInnerHTML={{ __html: c }} />)}</tr>)}</tbody>
            </table>
          </div>
        );
      case "eval": {
        const s = byId.get(b.id);
        if (!s) return <p key={k} className="gpp-missing">Results for <code>{b.id}</code>: not run in this build.</p>;
        return (
          <div key={k} className="gpp-results">
            <div className="gpp-results__head">
              <span>{s.name}</span>
              <span>N = {String(s.n)} · <Link href={`/evals#${s.id}`}>details</Link></span>
            </div>
            <SuiteTables suite={s} />
          </div>
        );
      }
    }
  };

  return (
    <main data-router-view="notFound" data-body-class="dark gist-share-body" role="main" className="gs-root gpp-root">
      <article className="gpp-wrap gpp-paper">
        <nav className="gpp-nav">
          <Link href="/">gist.</Link>
          <span>
            <Link href="/evals">Eval results</Link>
          </span>
        </nav>
        {md ? blocks.map(render) : <p className="gpp-empty">docs/whitepaper/gist-os.md is missing from this build.</p>}
        {results?.generated_at && (
          <p className="gpp-foot">Results generated {results.generated_at} from eval/results/latest.json.</p>
        )}
      </article>
    </main>
  );
}
