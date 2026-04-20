/**
 * BL-068 EB probe — check if any LinkedIn-named campaigns exist in EB for 1210.
 *
 * The precheck showed all 4 stuck campaigns have emailBisonCampaignId=null —
 * meaning the schema error fired before any EB API call. This script confirms
 * that by listing ALL EB campaigns for the 1210 workspace and filtering by
 * name/date. Expected result: no LinkedIn artifacts from today (2026-04-15).
 */
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

async function main() {
  const ws = await prisma.workspace.findUnique({
    where: { slug: "1210-solutions" },
    select: { apiToken: true },
  });
  if (!ws?.apiToken) throw new Error("no apiToken for 1210-solutions");

  const client = new EmailBisonClient(ws.apiToken);
  const all = await client.getCampaigns();

  console.log(`[bl-068-eb-probe] 1210-solutions total EB campaigns: ${all.length}`);

  const today = "2026-04-15";
  const linkedinish = all.filter((c) => {
    const name = (c.name ?? "").toLowerCase();
    const created = (c.created_at ?? "").slice(0, 10);
    return name.includes("linkedin") || created === today;
  });

  if (linkedinish.length === 0) {
    console.log(`[bl-068-eb-probe] No EB campaigns match linkedin-name OR created=${today}. NONE FOUND.`);
    return;
  }

  console.log(`[bl-068-eb-probe] ${linkedinish.length} EB campaigns match linkedin-name OR created=${today}:\n`);
  for (const c of linkedinish) {
    console.log(
      `  id=${c.id}  name="${c.name}"  type=${c.type}  status=${c.status}  leads=${c.total_leads}  created=${c.created_at}`,
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
