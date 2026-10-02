// Print deterministic signals for every matter (no model calls). bun run job scripts/signals.ts
import { db } from "@/lib/server/db";
import { computeSignals } from "@/lib/server/signals";

async function main() {
  const { data: ms } = await db().from("matters").select("id");
  for (const m of ms ?? []) {
    const s = await computeSignals(Number(m.id));
    const { data, label, contacts, comm, ...rest } = s;
    void data; void label;
    console.log(JSON.stringify({ ...rest, contacts: [...contacts.values()], comm: [...comm.values()] }, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
