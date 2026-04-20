/**
 * BL-068 pre-check — identify stuck 1210 LinkedIn campaigns.
 *
 * Scope: Campaign where workspace.slug='1210-solutions' AND channel linkedin-ish
 * AND status='deployed'. Expected count: 4 (Healthcare LinkedIn succeeded, not in set).
 */
import { prisma } from "@/lib/db";

async function main() {
  const all = await prisma.campaign.findMany({
    where: {
      workspaceSlug: "1210-solutions",
      status: "deployed",
    },
    select: {
      id: true,
      name: true,
      channels: true,
      status: true,
      updatedAt: true,
      linkedinSequence: true,
      emailBisonCampaignId: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // channels is a JSON-encoded string like `["linkedin"]` or `["email","linkedin"]`
  const campaigns = all.filter((c) => {
    try {
      const arr = JSON.parse(c.channels ?? "[]");
      return Array.isArray(arr) && arr.includes("linkedin");
    } catch {
      return false;
    }
  });

  console.log(`[bl-068-precheck] Found ${campaigns.length} 1210-solutions deployed campaigns with linkedin channel (from ${all.length} total deployed)\n`);

  for (const c of campaigns) {
    const deploys = await prisma.campaignDeploy.findMany({
      where: { campaignId: c.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        linkedinStatus: true,
        linkedinError: true,
        emailStatus: true,
        emailError: true,
        createdAt: true,
        completedAt: true,
      },
    });

    console.log(`─── Campaign ${c.id}`);
    console.log(`  name:    ${c.name}`);
    console.log(`  channels: ${JSON.stringify(c.channels)}`);
    console.log(`  status:  ${c.status}`);
    console.log(`  ebId:    ${c.emailBisonCampaignId ?? "(none)"}`);
    console.log(`  linkedinSequence length: ${Array.isArray(c.linkedinSequence) ? (c.linkedinSequence as unknown[]).length : "n/a"}`);
    console.log(`  Deploys: ${deploys.length}`);
    for (const d of deploys) {
      console.log(`    - ${d.id}  status=${d.status}  liStatus=${d.linkedinStatus}  emailStatus=${d.emailStatus}  created=${d.createdAt.toISOString()}`);
      if (d.linkedinError) console.log(`      liError: ${d.linkedinError}`);
      if (d.emailError) console.log(`      emailError: ${d.emailError}`);
    }
    console.log("");
  }

  console.log(`SUMMARY: ${campaigns.length} campaigns found. Expected: 4.`);
  if (campaigns.length !== 4) {
    console.log(`[STOP] count mismatch — do not proceed until investigated.`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
