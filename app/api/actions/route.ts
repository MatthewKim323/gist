// Agent drafts for a matter. Firm sessions (or no session) only: proxy.ts answers 403 to providers.
// Drafts live in gist only. Nothing here sends anything or writes to Clio.
import { listActions, updateAction } from "@/lib/server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["proposed", "approved", "dismissed", "sent_manually"]);

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("matterId");
  if (!id || !/^\d+$/.test(id)) return Response.json({ error: "matterId required" }, { status: 400 });
  try {
    return Response.json({ actions: await listActions(Number(id)) });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: string; status?: string; subject?: string; body?: string } | null;
  if (!b?.id || !/^[0-9a-f-]{36}$/i.test(b.id)) return Response.json({ error: "id required" }, { status: 400 });
  if (b.status && !STATUSES.has(b.status)) return Response.json({ error: "bad status" }, { status: 400 });
  if ((b.subject != null && typeof b.subject !== "string") || (b.body != null && typeof b.body !== "string"))
    return Response.json({ error: "bad text" }, { status: 400 });
  try {
    const action = await updateAction(b.id, {
      status: b.status as never,
      subject: b.subject?.slice(0, 500),
      body: b.body?.slice(0, 20_000),
    });
    return Response.json({ action });
  } catch (e) {
    const msg = String((e as Error).message);
    return Response.json({ error: msg }, { status: msg === "not found" ? 404 : 500 });
  }
}
