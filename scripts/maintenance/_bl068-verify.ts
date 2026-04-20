/**
 * BL-068 verify — confirm all 4 LinkedIn campaigns rolled back cleanly.
 *
 * Expected final state:
 *   - 4 Campaigns: status='approved' (was 'deployed')
 *   - 4 CampaignDeploys: status='rolled_back' (was 'failed')
 *   - All Campaigns' emailBisonCampaignId still null
 */
import { prisma } from "@/lib/db";

const EXPECTED: Array<{ campaignId: string; deployId: string; name: string }> = [
  {
    campaignId: "cmneqa5r50003p8rk322w3vc6",
    deployId: "cmo00noqq001dp8j58oixz8jj",
    name: "1210 Solutions - LinkedIn - Industrial/Warehouse - April 2026",
  },
  {
    campaignId: "cmneq1z3i0001p8ef36c814py",
    deployId: "cmo00nm600017p8j5snmaqr6u",
    name: "1210 Solutions - LinkedIn - Green List Priority - April 2026",
  },
  {
    campaignId: "cmneqixvz0003p871m8sw9u7o",
    deployId: "cmo00nl6v0014p8j5noxagu1g",
    name: "1210 Solutions - LinkedIn - Facilities/Cleaning - April 2026",
  },
  {
    campaignId: "cmneq93i80001p8p78pcw4yg9",
    deployId: "cmo00njq90011p8j5kyha6eda",
    name: "1210 Solutions - LinkedIn - Construction - April 2026",
  },
];

async function main() {
  let allOk = true;
  console.log(`[bl-068-verify] checking ${EXPECTED.length} campaigns + deploys\n`);

  for (const e of EXPECTED) {
    const c = await prisma.campaign.findUnique({
      where: { id: e.campaignId },
      select: { status: true, emailBisonCampaignId: true },
    });
    const d = await prisma.campaignDeploy.findUnique({
      where: { id: e.deployId },
      select: { status: true, error: true, completedAt: true },
    });
    const okCampaign = c?.status === "approved" && c?.emailBisonCampaignId == null;
    const okDeploy = d?.status === "rolled_back";
    const ok = okCampaign && okDeploy;
    if (!ok) allOk = false;
    console.log(
      `  ${ok ? "OK" : "FAIL"}  ${e.campaignId}  campaign.status=${c?.status}  ebId=${c?.emailBisonCampaignId ?? "null"}  deploy.status=${d?.status}`,
    );
    if (!ok) {
      console.log(`    name: ${e.name}`);
      console.log(`    deploy.completedAt=${d?.completedAt?.toISOString() ?? "null"}`);
      console.log(`    deploy.error: ${(d?.error ?? "").slice(0, 120)}...`);
    }
  }

  console.log(`\nOverall: ${allOk ? "PASS" : "FAIL"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
