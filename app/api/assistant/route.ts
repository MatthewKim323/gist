import { cookies } from "next/headers";
import { getSession } from "@/lib/server/auth/session";
import { latestThread, runTurn, type AssistantEvent } from "@/lib/server/assistant/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** Whose memory: the signed-in profile, else a stable per-role key so the no-sign-in demo still remembers. */
async function owner(): Promise<string> {
  const s = await getSession();
  if (s?.profileId) return s.profileId;
  return `role:${s?.role ?? "firm"}`;
}

/** Ask gist. Body {matterId, message, tab?, threadId?}. Streams NDJSON AssistantEvents. */
export async function POST(req: Request) {
  let body: { matterId?: number | string; message?: string; tab?: string | null; threadId?: string | null };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const matterId = Number(body.matterId);
  const message = String(body.message ?? "").trim();
  if (!Number.isFinite(matterId) || matterId <= 0 || !message) return Response.json({ error: "matterId and message required" }, { status: 400 });
  if (message.length > 2000) return Response.json({ error: "message too long" }, { status: 400 });
  const tab = typeof body.tab === "string" && /^[a-z]{2,20}$/.test(body.tab) ? body.tab : null;
  const threadId = typeof body.threadId === "string" && /^[0-9a-f-]{36}$/i.test(body.threadId) ? body.threadId : null;
  const profileId = await owner();
  const v = (await cookies()).get("gist_viewer")?.value;
  const viewer = v && /^[\w.@-]{1,80}$/.test(v) ? v : null;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: AssistantEvent) => { try { ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* client gone */ } };
      try {
        await runTurn({ matterId, profileId, viewer, message, tab, threadId }, emit);
      } catch (e) {
        emit({ type: "error", message: String((e as Error).message).slice(0, 300) });
      } finally {
        try { ctrl.close(); } catch { /* closed */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/** GET ?matterId= : the latest thread for this user on this case. */
export async function GET(req: Request) {
  const matterId = Number(new URL(req.url).searchParams.get("matterId"));
  if (!Number.isFinite(matterId) || matterId <= 0) return Response.json({ error: "matterId required" }, { status: 400 });
  try {
    return Response.json({ thread: await latestThread(await owner(), matterId) });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
