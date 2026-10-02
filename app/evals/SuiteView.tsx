import { fmtCell, humanize, type EvalSuite } from "@/lib/eval-results";

// One benchmark suite from eval/results/latest.json, rendered generically: metric tiles, tables, notes.
// Shared by /evals and the results blocks inside /whitepaper.

export function SuiteTables({ suite }: { suite: EvalSuite }) {
  const metrics = Object.entries(suite.metrics ?? {});
  return (
    <>
      {metrics.length > 0 && (
        <div className="gpp-tiles">
          {metrics.map(([k, v]) => (
            <div className="gpp-tile" key={k}>
              <div className="gpp-tile__v">{fmtCell(v, k)}</div>
              <div className="gpp-tile__k">{humanize(k)}</div>
            </div>
          ))}
        </div>
      )}
      {(suite.tables ?? []).map((t, i) => (
        <div className="gpp-tablewrap" key={i}>
          <div className="gpp-table__title">{t.title}</div>
          <div className="gpp-scroll">
            <table className="gpp-table">
              <thead>
                <tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {t.rows.map((r, j) => (
                  <tr key={j}>{r.map((c, x) => <td key={x}>{fmtCell(c, t.columns[x] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {(suite.notes ?? []).length > 0 && (
        <ul className="gpp-notes">
          {suite.notes!.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </>
  );
}

export function SuiteSection({ suite }: { suite: EvalSuite }) {
  return (
    <section className="gpp-suite" id={suite.id}>
      <h2 className="gpp-suite__name">{suite.name}</h2>
      <dl className="gpp-meta">
        <div><dt>Modeled on</dt><dd>{suite.origin}</dd></div>
        <div><dt>Our adaptation</dt><dd>{suite.adaptation}</dd></div>
        <div><dt>N</dt><dd>{String(suite.n)}</dd></div>
      </dl>
      <SuiteTables suite={suite} />
    </section>
  );
}
