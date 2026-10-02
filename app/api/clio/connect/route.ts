import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/server/clio/client";
import { DEMO_SYNC_MESSAGE, isDemoMode } from "@/lib/server/demo-mode";

export const dynamic = "force-dynamic";

/** Redirect to Clio's OAuth consent screen. The app's scopes are read-only. */
export async function GET(req: Request) {
  if (isDemoMode()) return NextResponse.redirect(new URL(`/cases?demo=1&clio_error=${encodeURIComponent(DEMO_SYNC_MESSAGE)}`, req.url));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("clio_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
