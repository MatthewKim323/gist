import { cookies } from "next/headers";
import { getDigest, markViewed, rebuildDigest } from "@/lib/server/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VIEWER_COOKIE = "gist_viewer";

async function viewerOf(req: Request): Promise<{ viewer: string; fresh: boolean }> {
  const q = new URL(req.url).searchParams.get("viewer");
  if (q && /^[\w.@-]{1,80}$/.test(q)) return { viewer: q, fresh: false };
  const c = (await cookies()).get(VIEWER_COOKIE)?.value;
  if (c && /^[\w.@-]{1,80}$/.test(c)) return { viewer: c, fresh: false };
  return { viewer: crypto.randomUUID(), fresh: true };
}

/** Latest digest. since_last_opened is computed for this viewer, then the view is recorded. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const { viewer, fresh } = await viewerOf(req);
  const peek = new URL(req.url).searchParams.get("peek") === "1";
  try {
    const { digest, version, live } = await getDigest(Number(id), viewer);
    if (!peek) await markViewed(Number(id), viewer, version);
    const res = Response.json({ version, live, digest });
    if (fresh) res.headers.append("Set-Cookie", `${VIEWER_COOKIE}=${viewer}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
    return res;
  } catch (e) {
    const msg = String((e as Error).message);
    return Response.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 500 });
  }
}

/** Rebuild the digest from current pipeline outputs (story call is skipped if inputs are unchanged). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    const { digest, version } = await rebuildDigest(Number(id));
    return Response.json({ version, live: false, digest });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
