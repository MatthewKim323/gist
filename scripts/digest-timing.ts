// Time the dashboard read path. bun run job scripts/digest-timing.ts
import { db } from "@/lib/server/db";
import { getDigest, markViewed } from "@/lib/server/digest";

async function main() {
  const { data: ms } = await db().from("matters").select("id").limit(1);
  const id = Number(ms![0].id);
  await markViewed(id, "timing-probe", null);
  await db().from("matter_views").update({ last_opened_at: "2026-10-02T17:00:00Z" }).eq("viewer", "timing-probe");
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await getDigest(id, "timing-probe");
    console.log(`getDigest ${Date.now() - t0}ms v${r.version} since=${r.digest.since_last_opened.items.length} stage_days=${r.digest.phase.time_in_stage_days}`);
  }
  await db().from("matter_views").delete().eq("viewer", "timing-probe");
}
main().catch((e) => { console.error(e); process.exit(1); });
