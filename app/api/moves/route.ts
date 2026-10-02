// Next moves for a matter. Firm sessions (or no session) only: proxy.ts answers 403 to providers.
import { nextMoves, setMoveStatus } from "@/lib/server/moves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["todo", "in_progress", "done", "dismissed"]);

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("matterId");
  if (!id || !/^\d+$/.test(id)) return Response.json({ error: "matterId required" }, { status: 400 });
  try {
    return Response.json(await nextMoves(Number(id)));
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => null)) as { matterId?: number | string; key?: string; status?: string; note?: string } | null;
  const id = Number(b?.matterId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "matterId required" }, { status: 400 });
  if (!b?.key || typeof b.key !== "string" || b.key.length > 120) return Response.json({ error: "key required" }, { status: 400 });
  if (!b.status || !STATUSES.has(b.status)) return Response.json({ error: "bad status" }, { status: 400 });
  try {
    const row = await setMoveStatus(id, b.key, b.status as never, typeof b.note === "string" ? b.note.slice(0, 200) : null);
    return Response.json({ move: row });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
