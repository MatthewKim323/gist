import "server-only";
import { db } from "../db";

/**
 * Demo cases are synthetic matters seeded by scripts/seed-demo.ts. They exist only in Supabase
 * (matters.is_demo = true), so nothing keyed by their id may ever call Clio.
 *
 * Their ids sit in a reserved range far above real Clio ids (positive, so every /^\d+$/ route and
 * 'doc:<id>#p<n>' cite parser keeps working). is_demo is the source of truth; the range is a backstop.
 */
export const DEMO_ID_MIN = 990_000_000_000;

export const inDemoRange = (id: number) => Number(id) >= DEMO_ID_MIN;

/** True when this matter is a demo case. Checks the flag, falls back to the reserved id range. */
export async function isDemoMatter(matterId: number): Promise<boolean> {
  if (inDemoRange(matterId)) return true;
  const { data } = await db().from("matters").select("is_demo").eq("id", matterId).maybeSingle();
  return !!(data as { is_demo?: boolean } | null)?.is_demo;
}

/** Ids of every demo matter. */
export async function demoMatterIds(): Promise<Set<number>> {
  const { data } = await db().from("matters").select("id").eq("is_demo", true);
  return new Set(((data ?? []) as { id: number }[]).map((r) => Number(r.id)));
}
