// Role enforcement. A signed-in provider is fenced off from every firm surface: pages redirect to
// /provider, APIs answer 403. Firm sessions (and no session at all, so the judge/demo flow keeps
// working without sign-in) reach everything. /, /signin and /s/<token> links are always public.
// Demo-grade: roles are picked, not authenticated (see lib/server/auth/token.ts), but they are
// verified here on every request from a signed cookie, never trusted from the client.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/server/auth/token";

const FIRM_PAGES = [/^\/matter(\/|$)/, /^\/cases(\/|$)/, /^\/s\/compose(\/|$)/, /^\/pipeline-preview(\/|$)/];
const FIRM_APIS = [
  /^\/api\/matter(\/|$)/,
  /^\/api\/ask(\/|$)/,
  /^\/api\/similar(\/|$)/,
  /^\/api\/pipeline(\/|$)/,
  /^\/api\/sync(\/|$)/,
  /^\/api\/docs(\/|$)/,
  /^\/api\/clio(\/|$)/,
  /^\/api\/cases(\/|$)/,
  // The share composer (create, preview any config, revoke) is firm-only.
  /^\/api\/share(\/|$)/,
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session?.role !== "provider") return NextResponse.next();

  // Providers may only POST a response (the route checks the office is on the matter); the inbox is firm-only.
  if (/^\/api\/submissions(\/|$)/.test(pathname) && req.method !== "POST")
    return NextResponse.json({ error: "Forbidden: provider accounts cannot access firm data" }, { status: 403 });
  if (FIRM_APIS.some((re) => re.test(pathname)))
    return NextResponse.json({ error: "Forbidden: provider accounts cannot access firm data" }, { status: 403 });
  if (FIRM_PAGES.some((re) => re.test(pathname))) return NextResponse.redirect(new URL("/provider", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/matter/:path*", "/cases/:path*", "/s/compose/:path*", "/pipeline-preview/:path*", "/api/:path*"],
};
