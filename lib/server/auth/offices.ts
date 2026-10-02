import "server-only";
import { db } from "@/lib/server/db";
import { listProviders } from "@/lib/server/share";

export interface OfficeCase {
  matter_id: number;
  display_number: string | null;
  role: string | null;
}
export interface Office {
  contact_id: number;
  name: string;
  cases: OfficeCase[];
}

/** Every treating-provider office across the synced matters, with the cases each one is on. */
export async function listOffices(): Promise<Office[]> {
  const { data } = await db().from("matters").select("id,display_number").order("id");
  const matters = (data ?? []) as { id: number; display_number: string | null }[];
  const per = await Promise.all(matters.map(async (m) => ({ m, providers: await listProviders(Number(m.id)).catch(() => []) })));
  const map = new Map<number, Office>();
  for (const { m, providers } of per) {
    for (const p of providers) {
      const o = map.get(p.contact_id) ?? { contact_id: p.contact_id, name: p.name, cases: [] };
      o.cases.push({ matter_id: Number(m.id), display_number: m.display_number, role: p.role });
      map.set(p.contact_id, o);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function findOffice(contactId: number): Promise<Office | null> {
  return (await listOffices()).find((o) => o.contact_id === contactId) ?? null;
}
