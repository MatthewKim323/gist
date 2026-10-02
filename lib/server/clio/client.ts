import "server-only";
import pLimit from "p-limit";
import { db } from "../db";
import { env } from "../env";
import { assertNotDemo } from "../demo-mode";

/**
 * Read-only Clio v4 client.
 *
 * - GET only: any non-GET aimed at /api/ throws before a socket is opened. The only write-shaped call
 *   this module makes is POST /oauth/token (token refresh / code exchange), which changes nothing in Clio.
 * - One global limiter for the whole process: ~0.8 req/s token bucket (Clio allows 50/min), small
 *   concurrency, honors X-RateLimit-Remaining/Reset and Retry-After on 429.
 * - Tokens live in clio_tokens (id=1), seeded from env on first use, refreshed on 401.
 */

export type Params = Record<string, string | number | boolean | undefined | null | (string | number)[]>;

interface Tokens { access_token: string; refresh_token: string; expires_at: string | null }

const MIN_INTERVAL_MS = 1250; // 0.8 req/s, stays under 50/min with headroom
const concurrency = pLimit(3);
let nextSlot = 0;
let pausedUntil = 0;
let tokenCache: Tokens | null = null;
let refreshing: Promise<Tokens> | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function takeSlot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot, pausedUntil);
  nextSlot = at + MIN_INTERVAL_MS;
  if (at > now) await wait(at - now);
}

function apiUrl(path: string, params?: Params): URL {
  const url = path.startsWith("http") ? new URL(path) : new URL(`${env.clioBase()}/api/v4/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(`${k}[]`, String(x));
    else url.searchParams.set(k, String(v));
  }
  return url;
}

/** The read-only guarantee. Every request to Clio's API goes through here. */
function assertReadOnly(method: string, url: URL) {
  if (method.toUpperCase() !== "GET" && url.pathname.startsWith("/api/")) {
    throw new Error(`Clio client is read-only: refused ${method} ${url.pathname}`);
  }
}

// ---------------- tokens ----------------

export async function getTokens(): Promise<Tokens> {
  if (tokenCache) return tokenCache;
  const { data } = await db().from("clio_tokens").select("access_token, refresh_token, expires_at").eq("id", 1).maybeSingle();
  if (data) return (tokenCache = data as Tokens);
  const access = process.env.CLIO_ACCESS_TOKEN;
  const refresh = process.env.CLIO_REFRESH_TOKEN;
  if (!access || !refresh) throw new Error("Clio not connected: no clio_tokens row and no CLIO_ACCESS_TOKEN/CLIO_REFRESH_TOKEN");
  return saveTokens({ access_token: access, refresh_token: refresh, expires_in: null });
}

export async function saveTokens(t: { access_token: string; refresh_token?: string; expires_in?: number | null }): Promise<Tokens> {
  const prev = tokenCache;
  const row: Tokens & { id: number; updated_at: string } = {
    id: 1,
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? prev?.refresh_token ?? "",
    expires_at: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("clio_tokens").upsert(row);
  if (error) throw new Error(`saveTokens: ${error.message}`);
  tokenCache = { access_token: row.access_token, refresh_token: row.refresh_token, expires_at: row.expires_at };
  return tokenCache;
}

async function tokenRequest(body: Record<string, string>) {
  assertNotDemo("Clio auth");
  const res = await fetch(`${env.clioBase()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.clioClientId(), client_secret: env.clioClientSecret(), ...body }),
  });
  if (!res.ok) throw new Error(`Clio token ${body.grant_type} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function refreshTokens(): Promise<Tokens> {
  if (!refreshing) {
    refreshing = (async () => {
      const cur = await getTokens();
      const out = await tokenRequest({ grant_type: "refresh_token", refresh_token: cur.refresh_token });
      return saveTokens(out);
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** OAuth authorization code exchange (used by /api/clio/callback). */
export async function exchangeCode(code: string) {
  const out = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: env.clioRedirectUri() });
  return saveTokens(out);
}

export function authorizeUrl(state: string): string {
  assertNotDemo("Clio connect");
  const u = new URL(`${env.clioBase()}/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.clioClientId());
  u.searchParams.set("redirect_uri", env.clioRedirectUri());
  u.searchParams.set("state", state);
  return u.toString();
}

// ---------------- requests ----------------

export let requestCount = 0;

/** Raw GET against the Clio API with auth, rate limiting, refresh and retry. */
export async function clioFetch(path: string, params?: Params, init: { redirect?: RequestRedirect } = {}): Promise<Response> {
  assertNotDemo("live Clio access");
  const url = apiUrl(path, params);
  assertReadOnly("GET", url);
  return concurrency(async () => {
    let refreshed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await takeSlot();
      const tok = await getTokens();
      requestCount++;
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" },
        redirect: init.redirect ?? "follow",
      });
      const remaining = Number(res.headers.get("x-ratelimit-remaining"));
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      if (res.headers.has("x-ratelimit-remaining") && remaining <= 2 && reset) {
        pausedUntil = Math.max(pausedUntil, reset * 1000 + 250);
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        tokenCache = null;
        await refreshTokens();
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        const ms = ra > 0 ? ra * 1000 : Math.min(30_000, 1000 * 2 ** attempt);
        pausedUntil = Math.max(pausedUntil, Date.now() + ms);
        continue;
      }
      return res;
    }
    throw new Error(`Clio GET ${url.pathname} failed after retries`);
  });
}

export async function get<T = unknown>(path: string, params?: Params): Promise<T> {
  const res = await clioFetch(path, params);
  if (!res.ok) throw new Error(`Clio GET ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

interface ListPage<T> { data: T[]; meta?: { paging?: { next?: string }; records?: number } }

/** List every record, following meta.paging.next. limit=200 per page. */
export async function list<T = Record<string, unknown>>(path: string, params: Params = {}): Promise<T[]> {
  const out: T[] = [];
  let page = await get<ListPage<T>>(path, { limit: 200, ...params });
  out.push(...page.data);
  while (page.meta?.paging?.next) {
    page = await get<ListPage<T>>(page.meta.paging.next);
    out.push(...page.data);
  }
  return out;
}

/** Download a document version's bytes. Clio answers 303 with a presigned URL; that fetch carries no auth. */
export async function downloadDocument(documentId: number | string, versionId?: number | string): Promise<{ bytes: Buffer; contentType: string | null }> {
  const res = await clioFetch(`documents/${documentId}/download.json`, versionId ? { document_version_id: versionId } : undefined, { redirect: "manual" });
  let final: Response;
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error(`Clio download ${documentId}: redirect without location`);
    final = await fetch(loc); // presigned, no Authorization header
  } else {
    final = res;
  }
  if (!final.ok) throw new Error(`Clio download ${documentId}: ${final.status}`);
  return { bytes: Buffer.from(await final.arrayBuffer()), contentType: final.headers.get("content-type") };
}
