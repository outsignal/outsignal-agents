/**
 * BL-061 follow-up — Deep check. The inventory showed:
 *  - originals AND duplicates have 0 leads in EB
 *  - all deploys are status='failed'
 *  - some deploys have no emailBisonCampaignId at all
 *  - the "originals" were themselves created at 12:17 UTC (same day)
 *
 * This script investigates:
 *  - all deploys in the window (including orphaned ones)
 *  - all EB campaigns per workspace (not just the ones we linked to)
 *  - sender-email counts and sequence-step counts per EB campaign
 *  - Campaign DB row status history (audit logs)
 */
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACES = ["lime-recruitment", "1210-solutions"] as const;
const WINDOW_START = new Date("2026-04-15T10:00:00Z");
const WINDOW_END = new Date("2026-04-15T14:00:00Z");

async function checkWorkspace(slug: string) {
  console.log(`\n=================== ${slug} ===================`);
  const ws = await prisma.workspace.findUnique({ where: { slug }, select: { apiToken: true } });
  if (!ws?.apiToken) { console.log("no apiToken"); return; }
  const client = new EmailBisonClient(ws.apiToken);

  // ALL deploys in the window
  const deploys = await prisma.campaignDeploy.findMany({
    where: { workspaceSlug: slug, createdAt: { gte: WINDOW_START, lte: WINDOW_END } },
    orderBy: { createdAt: "asc" },
    include: { campaign: { select: { id: true, name: true, status: true } } },
  });
  console.log(`\n-- ALL ${deploys.length} deploys in window --`);
  for (const d of deploys) {
    console.log(`  ${d.createdAt.toISOString()} deploy=${d.id} status=${d.status} ebId=${d.emailBisonCampaignId ?? "(none)"} campaign=${d.campaignName} dbStatus=${d.campaign?.status} error=${(d.error ?? "").slice(0, 80)}`);
  }

  // ALL EB campaigns
  const ebCampaigns = await client.getCampaigns();
  console.log(`\n-- ALL ${ebCampaigns.length} EB campaigns (any name) --`);
  // Sort by created_at
  const sorted = [...ebCampaigns].sort((a, b) => String((a as any).created_at ?? "").localeCompare(String((b as any).created_at ?? "")));
  for (const c of sorted) {
    const leads = await client.getCampaignLeads(c.id, 1, 1).catch(() => null);
    const senders = await client.getCampaignSenderEmails(c.id).catch(() => null);
    const steps = await client.getSequenceSteps(c.id).catch(() => null);
    console.log(`  ebId=${c.id} created=${(c as any).created_at} status=${(c as any).status} name=${JSON.stringify(c.name)} leads=${leads?.meta?.total ?? "?"} senders=${senders?.length ?? "?"} steps=${steps?.length ?? "?"}`);
  }

  // DB campaigns in the workspace with status=deployed
  const dbCampaigns = await prisma.campaign.findMany({
    where: { workspaceSlug: slug, status: "deployed" },
    select: { id: true, name: true, status: true, updatedAt: true, contentApproved: true, leadsApproved: true },
    orderBy: { updatedAt: "desc" },
  });
  console.log(`\n-- DB campaigns status=deployed: ${dbCampaigns.length} --`);
  for (const c of dbCampaigns) {
    console.log(`  ${c.id} ${c.updatedAt.toISOString()} name=${JSON.stringify(c.name)} contentApproved=${c.contentApproved} leadsApproved=${c.leadsApproved}`);
  }
}

async function main() {
  for (const slug of WORKSPACES) await checkWorkspace(slug);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
