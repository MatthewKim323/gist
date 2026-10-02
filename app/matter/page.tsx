// The case dashboard. Plain DOM above the (cleared) GL canvas; the home scene seam-wipes into it.
export default function MatterPage() {
  return (
    <main data-router-view="matter" role="main" className="matter">
      <div className="matter__inner">
        <p className="matter__eyebrow t-uppercase">Matter</p>
        <h1 className="matter__title t-serif t-italic">The case, digested.</h1>
        <p className="matter__lede">Connecting to Clio…</p>
      </div>
    </main>
  );
}
