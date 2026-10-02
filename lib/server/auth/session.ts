import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession, type Role, type Session } from "./token";

export type { Role, Session };
export { SESSION_COOKIE };

/** The signed-in role, or null. Signature and age are checked on every call. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/** Server components: send anyone without the role to /signin. */
export async function requireRole(role: Role): Promise<Session> {
  const s = await getSession();
  if (!s || s.role !== role) redirect(`/signin?next=${role === "provider" ? "/provider" : "/matter"}`);
  return s;
}

export async function setSession(s: Omit<Session, "iat">) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
