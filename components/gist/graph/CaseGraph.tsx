"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import "@/app/styles/gist-graph.css";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

// Interactive case knowledge graph. Force-directed SVG over /api/graph (deterministic, no model calls).

type NodeType = "client" | "party" | "document" | "source" | "topic" | "cluster" | "gate" | "contradiction";
interface GRef { source_ref: string; label: string; quote?: string }
interface GNode { id: string; type: NodeType; label: string; sub?: string | null; owner?: string | null; weight: number; status?: string | null; severity?: string | null; count?: number; refs: GRef[] }
interface GEdge { source: string; target: string; kind: string; label?: string | null }
interface GraphData { client: string; nodes: GNode[]; edges: GEdge[]; stats: Record<string, number | boolean> }

type SNode = GNode & SimulationNodeDatum;
type SLink = SimulationLinkDatum<SNode> & { kind: string; label?: string | null };

const TYPE_LABEL: Record<NodeType, string> = {
  client: "Client", party: "Party", document: "Document", source: "Source", topic: "Topic", cluster: "Event", gate: "Gate", contradiction: "Contradiction",
};
const OWNER_COLOR: Record<string, string> = { provider: "#8fb8ff", defense: "#f0a0c8", carrier: "#c7a6ff", court: "#b9c2d6", client: "#d6c29a", other: "#9aa7c2" };
function colorOf(n: GNode): string {
  switch (n.type) {
    case "client": return "#d6c29a";
    case "party": return OWNER_COLOR[n.owner ?? "other"] ?? OWNER_COLOR.other;
    case "document": return "#7fd1c7";
    case "source": return "#6f8fb0";
    case "topic": return "#9fd0ae";
    case "cluster": return "#6fae86";
    case "gate": return n.status === "conflicting" ? "#ee9585" : "#ffcf7a";
    case "contradiction": return "#ff7a7a";
  }
}
const radius = (n: GNode) => (n.type === "client" ? 22 : 4 + n.weight * 1.9);
function edgeColor(kind: string): string {
  if (kind === "claim") return "rgba(255,122,122,0.75)";
  if (kind === "owes") return "rgba(255,207,122,0.6)";
  if (kind === "evidence") return "rgba(255,207,122,0.35)";
  if (kind === "role") return "rgba(214,194,154,0.35)";
  return "rgba(232,235,244,0.12)";
}

const FILTERS: { key: string; label: string; types: NodeType[] }[] = [
  { key: "parties", label: "Parties", types: ["party"] },
  { key: "documents", label: "Documents", types: ["document", "source"] },
  { key: "events", label: "Events", types: ["topic", "cluster"] },
  { key: "contradictions", label: "Contradictions", types: ["contradiction"] },
  { key: "gates", label: "Gates", types: ["gate"] },
];

const idOf = (x: string | number | SNode | undefined) => (typeof x === "object" ? x.id : String(x));

export default function CaseGraph({ matterId }: { matterId: number | string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [, setTick] = useState(0);
  const [size, setSize] = useState({ w: 1100, h: 680 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SNode, SLink> | null>(null);
  const nodesRef = useRef<SNode[]>([]);
  const linksRef = useRef<SLink[]>([]);
  const dragRef = useRef<{ mode: "pan" | "node"; id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null); setErr(null);
    fetch(`/api/graph?matterId=${matterId}`).then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (!r.ok) setErr(j.error ?? `HTTP ${r.status}`); else setData(j);
    }).catch((e) => alive && setErr(String(e)));
    return () => { alive = false; };
  }, [matterId]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(320, e.contentRect.width), h: Math.max(420, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hiddenTypes = useMemo(() => new Set(FILTERS.filter((f) => off.has(f.key)).flatMap((f) => f.types)), [off]);

  // Build / rebuild the simulation when data or filters change.
  useEffect(() => {
    if (!data) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: SNode[] = data.nodes.filter((n) => !hiddenTypes.has(n.type)).map((n) => {
      const p = prev.get(n.id);
      const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 60;
      return { ...n, x: p?.x ?? Math.cos(a) * r, y: p?.y ?? Math.sin(a) * r, vx: p?.vx, vy: p?.vy };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const links: SLink[] = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, kind: e.kind, label: e.label }));
    const client = nodes.find((n) => n.type === "client");
    if (client) { client.fx = 0; client.fy = 0; }
    nodesRef.current = nodes; linksRef.current = links;
    simRef.current?.stop();
    const ring: Partial<Record<NodeType, number>> = { party: 170, topic: 150, contradiction: 230, gate: 250, cluster: 290, document: 360, source: 380 };
    const sim = forceSimulation<SNode, SLink>(nodes)
      .force("link", forceLink<SNode, SLink>(links).id((d) => d.id).distance((l) => (l.kind === "topic" ? 70 : l.kind === "role" ? 140 : l.kind === "supports" ? 110 : 90)).strength((l) => (l.kind === "supports" || l.kind === "about" ? 0.08 : 0.5)))
      .force("charge", forceManyBody<SNode>().strength((d) => -60 - radius(d) * 9))
      .force("collide", forceCollide<SNode>().radius((d) => radius(d) + 4).strength(0.9))
      .force("radial", forceRadial<SNode>((d) => ring[d.type] ?? 0, 0, 0).strength(0.12))
      .force("center", forceCenter(0, 0).strength(0.02))
      .alphaDecay(0.028)
      .velocityDecay(0.35);
    let raf = 0;
    sim.on("tick", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setTick((t) => t + 1); }); });
    simRef.current = sim;
    return () => { sim.stop(); cancelAnimationFrame(raf); };
  }, [data, hiddenTypes]);

  // Fit view to the canvas once on first data.
  useEffect(() => { setView({ x: size.w / 2, y: size.h / 2, k: Math.min(size.w, size.h) / 980 }); }, [data, size.w, size.h]);

  const nodes = nodesRef.current, links = linksRef.current;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const neighborhood = useMemo(() => {
    if (!sel) return null;
    const s = new Set([sel]);
    for (const l of links) { const a = idOf(l.source), b = idOf(l.target); if (a === sel) s.add(b); if (b === sel) s.add(a); }
    return s;
  }, [sel, links]);

  const toWorld = (cx: number, cy: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };

  const onWheel = (e: RWheelEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.max(0.25, Math.min(4, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k });
  };
  const onDown = (e: RPointerEvent, id?: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode: id ? "node" : "pan", id, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    if (id) { const n = byId.get(id); if (n && n.type !== "client") { n.fx = n.x; n.fy = n.y; } simRef.current?.alphaTarget(0.25).restart(); }
  };
  const onMove = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    if (d.mode === "pan") setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    else if (d.id) { const n = byId.get(d.id); if (n && n.type !== "client") { const w = toWorld(e.clientX, e.clientY); n.fx = w.x; n.fy = w.y; } }
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.mode === "node" && d.id) {
      const n = byId.get(d.id);
      if (n && n.type !== "client") { n.fx = null; n.fy = null; }
      simRef.current?.alphaTarget(0);
      if (!d.moved) setSel((s) => (s === d.id ? null : d.id!));
    } else if (!d.moved) setSel(null);
  };

  const openCite = (r: GRef) => window.dispatchEvent(new CustomEvent("gist:open-cite", { detail: { ref: r.source_ref, quote: r.quote, label: r.label } }));

  const selNode = sel ? byId.get(sel) : null;
  const hovNode = hover ? byId.get(hover.id) : null;
  const neighborsOf = (id: string) => links.filter((l) => idOf(l.source) === id || idOf(l.target) === id).map((l) => byId.get(idOf(l.source) === id ? idOf(l.target) : idOf(l.source))).filter(Boolean) as SNode[];
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of data?.nodes ?? []) c[n.type] = (c[n.type] ?? 0) + 1;
    return c;
  }, [data]);

  return (
    <div className="gg">
      <div className="gg-top">
        <div className="gg-title">
          <span className="gg-eyebrow">Knowledge graph</span>
          <span className="gg-sub">{data ? `${data.nodes.length} nodes · ${data.edges.length} links` : err ? "unavailable" : "mapping the case..."}</span>
        </div>
        <div className="gg-filters">
          {FILTERS.map((f) => {
            const n = f.types.reduce((s, t) => s + (typeCounts[t] ?? 0), 0);
            return (
              <button key={f.key} className={`gg-chip ${off.has(f.key) ? "is-off" : ""}`} onClick={() => setOff((s) => { const x = new Set(s); if (x.has(f.key)) x.delete(f.key); else x.add(f.key); return x; })}>
                <i style={{ background: colorOf({ type: f.types[0], status: "missing", owner: "provider" } as GNode) }} />{f.label}<em>{n}</em>
              </button>
            );
          })}
        </div>
      </div>

      <div className="gg-stage" ref={wrapRef} onWheel={onWheel} onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}>
        {err && <div className="gg-empty">Graph unavailable: {err}</div>}
        {!data && !err && <div className="gg-empty gg-pulse">Mapping parties, documents and events...</div>}
        <svg width={size.w} height={size.h} className="gg-svg">
          <defs>
            <radialGradient id="gg-glow"><stop offset="0%" stopColor="#d6c29a" stopOpacity="0.35" /><stop offset="100%" stopColor="#d6c29a" stopOpacity="0" /></radialGradient>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            <circle r={120} fill="url(#gg-glow)" />
            <g>
              {links.map((l, i) => {
                const a = l.source as SNode, b = l.target as SNode;
                if (a.x == null || b.x == null) return null;
                const lit = neighborhood ? neighborhood.has(a.id) && neighborhood.has(b.id) && (a.id === sel || b.id === sel) : false;
                const dim = neighborhood && !lit;
                const strong = l.kind === "claim" || l.kind === "owes";
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lit ? (strong ? edgeColor(l.kind) : "rgba(232,235,244,0.55)") : edgeColor(l.kind)} strokeWidth={(strong ? 1.6 : 1) / Math.sqrt(view.k)} strokeDasharray={l.kind === "evidence" ? "3 3" : undefined} opacity={dim ? 0.08 : 1} className="gg-edge" />;
              })}
            </g>
            <g>
              {nodes.map((n) => {
                if (n.x == null) return null;
                const r = radius(n), c = colorOf(n);
                const dim = neighborhood && !neighborhood.has(n.id);
                const showLabel = n.type === "client" || n.type === "topic" || n.type === "party" || n.type === "contradiction" || n.id === sel || n.id === hover?.id || (neighborhood?.has(n.id) ?? false) || view.k > 1.6;
                return (
                  <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.15 : 1} className="gg-node"
                    onPointerDown={(e) => onDown(e, n.id)}
                    onPointerEnter={(e) => setHover({ id: n.id, x: e.clientX, y: e.clientY })}
                    onPointerMove={(e) => setHover({ id: n.id, x: e.clientX, y: e.clientY })}
                    onPointerLeave={() => setHover(null)}>
                    {(n.type === "contradiction" || (n.type === "gate" && n.status === "missing")) && <circle r={r + 6} fill="none" stroke={c} strokeOpacity={0.35} className="gg-ring" />}
                    {n.id === sel && <circle r={r + 5} fill="none" stroke="#e8ebf4" strokeWidth={1.5} />}
                    {n.type === "document" ? <rect x={-r * 0.8} y={-r} width={r * 1.6} height={r * 2} rx={2.5} fill={c} fillOpacity={0.85} />
                      : n.type === "gate" ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} transform="rotate(45)" fill={c} fillOpacity={0.9} />
                      : n.type === "contradiction" ? <path d={`M0 ${-r * 1.15} L${r * 1.05} ${r * 0.75} L${-r * 1.05} ${r * 0.75} Z`} fill={c} />
                      : <circle r={r} fill={c} fillOpacity={n.type === "source" ? 0.6 : n.type === "cluster" ? 0.75 : 0.95} stroke={n.type === "client" ? "#fff6df" : "none"} strokeWidth={n.type === "client" ? 2 : 0} />}
                    {showLabel && (
                      <text y={r + 13} textAnchor="middle" className={`gg-label gg-label-${n.type}`} style={{ fontSize: `${(n.type === "client" ? 14 : n.type === "topic" ? 12 : 10.5) / Math.max(0.8, Math.sqrt(view.k))}px` }}>
                        {n.label.length > 34 ? `${n.label.slice(0, 32)}...` : n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {hovNode && !dragRef.current && (
          <div className="gg-tip" style={{ left: hover!.x - (wrapRef.current?.getBoundingClientRect().left ?? 0) + 14, top: hover!.y - (wrapRef.current?.getBoundingClientRect().top ?? 0) + 14 }}>
            <div className="gg-tip-type" style={{ color: colorOf(hovNode) }}>{TYPE_LABEL[hovNode.type]}{hovNode.severity ? ` · ${hovNode.severity}` : ""}{hovNode.status ? ` · ${hovNode.status}` : ""}</div>
            <div className="gg-tip-label">{hovNode.label}</div>
            {hovNode.sub && <div className="gg-tip-sub">{hovNode.sub.length > 140 ? `${hovNode.sub.slice(0, 137)}...` : hovNode.sub}</div>}
            <div className="gg-tip-meta">{neighborsOf(hovNode.id).length} links{hovNode.count ? ` · ${hovNode.count} ${hovNode.type === "document" ? "pages" : hovNode.type === "contradiction" ? "claims" : hovNode.type === "gate" ? "evidence" : "facts"}` : ""} · {hovNode.refs.length} sources</div>
          </div>
        )}

        <div className="gg-legend">
          {(["client", "party", "topic", "cluster", "document", "source", "contradiction", "gate"] as NodeType[]).map((t) => (
            <span key={t}><i className={`gg-sw gg-sw-${t}`} style={{ background: colorOf({ type: t, status: "missing", owner: "provider" } as GNode) }} />{TYPE_LABEL[t]}</span>
          ))}
          <span><i className="gg-line" style={{ background: "#ff7a7a" }} />conflict</span>
          <span><i className="gg-line" style={{ background: "#ffcf7a" }} />owed</span>
        </div>
        <div className="gg-hint">drag to pan · scroll to zoom · click a node</div>

        {selNode && (
          <aside className="gg-panel" onPointerDown={(e) => e.stopPropagation()}>
            <div className="gg-panel-head">
              <span className="gg-tip-type" style={{ color: colorOf(selNode) }}>{TYPE_LABEL[selNode.type]}{selNode.severity ? ` · ${selNode.severity}` : ""}{selNode.status ? ` · ${selNode.status}` : ""}</span>
              <button className="gg-x" onClick={() => setSel(null)} aria-label="Close">×</button>
            </div>
            <h3>{selNode.label}</h3>
            {selNode.sub && <p className="gg-panel-sub">{selNode.sub}</p>}
            {selNode.refs.length > 0 && (
              <>
                <div className="gg-panel-k">Sources</div>
                <ul className="gg-refs">
                  {selNode.refs.slice(0, 12).map((r, i) => (
                    <li key={i}>
                      <button className="gg-cite" onClick={() => openCite(r)}>{r.label}</button>
                      {r.quote && <q>{r.quote.length > 160 ? `${r.quote.slice(0, 157)}...` : r.quote}</q>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="gg-panel-k">Connected</div>
            <div className="gg-nb">
              {neighborsOf(selNode.id).slice(0, 18).map((n) => (
                <button key={n.id} className="gg-nb-chip" onClick={() => setSel(n.id)}><i style={{ background: colorOf(n) }} />{n.label.length > 30 ? `${n.label.slice(0, 28)}...` : n.label}</button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
