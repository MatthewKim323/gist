// Ask gist's agent to draft the next move for every blocking item. Drafts only: never sent, never written to Clio.
import { proposeActions } from "@/lib/server/actions";
import { demoBody, isDemoMode } from "@/lib/server/demo-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { matterId?: number | string } | null;
  const id = Number(b?.matterId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "matterId required" }, { status: 400 });
  if (isDemoMode()) return Response.json(demoBody("Demo mode: drafting new follow-ups is off on the public demo. The drafts below are from the recorded run."));
  try {
    return Response.json(await proposeActions(id));
  } catch (e) {
    const msg = String((e as Error).message);
    return Response.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 500 });
  }
}
