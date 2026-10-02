// Ask gist's agent to draft the next move for every blocking item. Drafts only: never sent, never written to Clio.
import { proposeActions } from "@/lib/server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { matterId?: number | string } | null;
  const id = Number(b?.matterId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "matterId required" }, { status: 400 });
  try {
    return Response.json(await proposeActions(id));
  } catch (e) {
    const msg = String((e as Error).message);
    return Response.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 500 });
  }
}
