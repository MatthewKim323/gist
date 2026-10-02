import { NextResponse } from "next/server";
import { ask } from "@/lib/server/retrieval/ask";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { matterId?: number | string; q?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const matterId = Number(body.matterId);
  const q = String(body.q ?? "").trim();
  if (!Number.isFinite(matterId) || !q) return NextResponse.json({ error: "matterId and q required" }, { status: 400 });
  if (q.length > 1000) return NextResponse.json({ error: "question too long" }, { status: 400 });
  try {
    const r = await ask(matterId, q);
    return NextResponse.json({
      answer_markdown: r.answer_markdown,
      cites: r.cites,
      hits: r.hits.map((h) => ({ id: h.id, cite: h.cite, header: h.header, snippet: h.body.slice(0, 300), score: h.score })),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
