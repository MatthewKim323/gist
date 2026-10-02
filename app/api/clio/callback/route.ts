import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/server/clio/client";
import { DEMO_SYNC_MESSAGE, isDemoMode } from "@/lib/server/demo-mode";

export const dynamic = "force-dynamic";

/** OAuth callback: exchange the code and store tokens in clio_tokens. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("clio_oauth_state")?.value;
  // Every outcome lands back on the firm workspace, which shows the result.
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/cases?${q}`, req.url));
    res.cookies.delete("clio_oauth_state");
    return res;
  };
  if (isDemoMode()) return back(`demo=1&clio_error=${encodeURIComponent(DEMO_SYNC_MESSAGE)}`);
  const err = url.searchParams.get("error");
  if (err) return back(`clio_error=${encodeURIComponent(err)}`);
  if (!code) return back("clio_error=missing_code");
  if (expected && state !== expected) return back("clio_error=state_mismatch");
  try {
    await exchangeCode(code);
  } catch (e) {
    return back(`clio_error=${encodeURIComponent((e as Error).message.slice(0, 120))}`);
  }
  const res = NextResponse.redirect(new URL("/cases?connected=1", req.url));
  res.cookies.delete("clio_oauth_state");
  return res;
}
