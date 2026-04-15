/**
 * BL-061 follow-up — final verification. Confirms EB + DB state post-cleanup.
 */
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const DELETED_EB_IDS: Record<string, number[]> = {
  "lime-recruitment": [56, 57, 58, 59, 60, 62, 64, 66, 67, 70, 71, 73],
  "1210-solutions":   [61, 63, 65, 68, 69, 72, 74, 75, 76, 77],
};
const FLIPPED_CAMPAIGN_IDS = [
  "cmnpwzv9e010np8itsf3f35oy", "cmnpwzwi5011sp8itj20w1foq", "cmnpwzxmg012gp8itxv4dvmyb",
  "cmnpwzym5014op8it2cpupfwx", "cmnpx037s01dcp8itzzilfdfb", "cmnq5nivc0001p8534g0k4wr6",
  "cmneq92p20000p8p7dhqn8g42", "cmneqixpv0001p8710bov1fga", "cmneq1sdj0001p8cg97lb9rhd",
  "cmneqhwo50001p843r5hmsul3", "cmneqa5180001p8rkwyrrlkg8",
];
const FLIPPED_DEPLOY_IDS = [
  "cmo00n0h20001p8j5huj8cjup", "cmo00n2hr0004p8j5b3l4yx5g", "cmo00n3so0007p8j5on092jqa",
  "cmo00n5ev000ap8j5ofavaq62", "cmo00n7wz000dp8j5pnig94cg", "cmo00na6f000gp8j55m9xry36",
  "cmo00nbyq000mp8j5j54fg5vf", "cmo00nd6g000pp8j53qk6h1ky", "cmo00ng33000sp8j5kxklfkro",
  "cmo00ngzf000vp8j5pjg625n9", "cmo00nhva000yp8j5nbxqegm7",
];

async function main() {
  // EB side
  for (const [slug, ebIds] of Object.entries(DELETED_EB_IDS)) {
    const ws = await prisma.workspace.findUnique({ where: { slug }, select: { apiToken: true } });
    if (!ws?.apiToken) continue;
    const client = new EmailBisonClient(ws.apiToken);
    const live = await client.getCampaigns();
    const liveIds = new Set(live.map((c) => c.id));
    const stillVisible: number[] = [];
    const gone: number[] = [];
    for (const id of ebIds) {
      if (liveIds.has(id)) stillVisible.push(id);
      else gone.push(id);
    }
    console.log(`\n[${slug}] post-delete state:`);
    console.log(`  total EB campaigns now: ${live.length}`);
    console.log(`  deleted EB ids GONE:   ${gone.length}/${ebIds.length} (${gone.join(", ")})`);
    console.log(`  deleted EB ids QUEUED: ${stillVisible.length}/${ebIds.length} (${stillVisible.join(", ")})`);
  }

  // DB: campaigns
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: FLIPPED_CAMPAIGN_IDS } },
    select: { id: true, name: true, status: true, contentApproved: true, leadsApproved: true },
  });
  console.log(`\n[DB] Campaign status after flip (${campaigns.length}/${FLIPPED_CAMPAIGN_IDS.length}):`);
  for (const c of campaigns) {
    const ok = c.status === "approved";
    console.log(`  ${ok ? "OK" : "FAIL"} ${c.id} status=${c.status} contentApproved=${c.contentApproved} leadsApproved=${c.leadsApproved} "${c.name}"`);
  }

  // DB: deploys
  const deploys = await prisma.campaignDeploy.findMany({
    where: { id: { in: FLIPPED_DEPLOY_IDS } },
    select: { id: true, status: true, error: true, completedAt: true },
  });
  console.log(`\n[DB] CampaignDeploy status after flip (${deploys.length}/${FLIPPED_DEPLOY_IDS.length}):`);
  for (const d of deploys) {
    const ok = d.status === "rolled_back";
    console.log(`  ${ok ? "OK" : "FAIL"} ${d.id} status=${d.status} completedAt=${d.completedAt?.toISOString()}`);
  }

  // Sanity: any OTHER table reference the deleted EB ids?
  const allDeletedEb = Object.values(DELETED_EB_IDS).flat();
  const orphanDeploys = await prisma.campaignDeploy.findMany({
    where: { emailBisonCampaignId: { in: allDeletedEb } },
    select: { id: true, status: true, emailBisonCampaignId: true },
  });
  console.log(`\n[DB] CampaignDeploy rows still pointing at deleted EB ids: ${orphanDeploys.length}`);
  for (const d of orphanDeploys) console.log(`  ${d.id} status=${d.status} ebId=${d.emailBisonCampaignId}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
