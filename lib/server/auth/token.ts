// Session token: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
// Web Crypto only (no "server-only", no node:crypto) so proxy.ts and server code share one verifier.
//
// Honest note: this is demo-grade role selection, not authentication. There are no passwords; anyone can
// pick a role on /signin. What it does guarantee is that the role, once picked, is enforced on the server
// (proxy.ts + requireRole) and cannot be edited client-side without breaking the signature.

export type Role = "firm" | "provider";

export interface Session {
  role: Role;
  providerContactId?: number;
  /** profiles.id (migration 0005). Absent on sessions signed before profiles existed. */
  profileId?: string;
  name: string;
  iat: number;
}

export const SESSION_COOKIE = "gist_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function secret(): string {
  const s = process.env.GIST_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Missing GIST_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY");
  return s;
}

let keyPromise: Promise<CryptoKey> | null = null;
function key(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey("raw", enc.encode(`gist-session:${secret()}`), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  return keyPromise;
}

export async function signSession(s: Omit<Session, "iat">): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...s, iat: Math.floor(Date.now() / 1000) })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), unb64url(sig) as BufferSource, enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64url(body))) as Session;
    if (s.role !== "firm" && s.role !== "provider") return null;
    if (s.role === "provider" && !Number.isFinite(s.providerContactId)) return null;
    if (!s.iat || Date.now() / 1000 - s.iat > SESSION_MAX_AGE) return null;
    return s;
  } catch {
    return null;
  }
}
