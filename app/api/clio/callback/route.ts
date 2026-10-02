import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/server/clio/client";

export const dynamic = "force-dynamic";

/** OAuth callback: exchange the code and store tokens in clio_tokens. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("clio_oauth_state")?.value;
  if (url.searchParams.get("error")) return NextResponse.json({ error: url.searchParams.get("error") }, { status: 400 });
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });
  if (expected && state !== expected) return NextResponse.json({ error: "state mismatch" }, { status: 400 });
  await exchangeCode(code);
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete("clio_oauth_state");
  return res;
}
