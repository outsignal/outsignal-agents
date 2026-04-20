import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

async function main() {
  const campaignIds = [
    { slug: "lime-recruitment", ebId: 104, name: "Lime E1" },
    { slug: "lime-recruitment", ebId: 105, name: "Lime E2" },
    { slug: "lime-recruitment", ebId: 106, name: "Lime E3" },
    { slug: "lime-recruitment", ebId: 108, name: "Lime E5" },
    { slug: "lime-recruitment", ebId: 109, name: "Lime E4" },
  ];
  
  const ws = await prisma.workspace.findUnique({ where: { slug: "lime-recruitment" }, select: { apiToken: true } });
  if (!ws?.apiToken) { console.log("No Lime token"); process.exit(1); }
  const client = new EmailBisonClient(ws.apiToken);
  
  for (const c of campaignIds) {
    console.log(`\n=== ${c.name} (EB ${c.ebId}) ===`);
    try {
      const steps = await client.getSequenceSteps(c.ebId);
      for (const s of steps) {
        const anyStep = s as any;
        const delay = anyStep.delay_days ?? anyStep.wait_days ?? anyStep.delay ?? anyStep.days_after_previous ?? "?";
        console.log(`  step ${anyStep.position ?? anyStep.order ?? "?"}: delay=${delay} | subject="${(anyStep.subject ?? anyStep.email_subject ?? "").substring(0, 40)}"`);
      }
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
    }
  }
  
  // Also check 1210-solutions
  console.log("\n\n=== 1210 SOLUTIONS ===");
  const ws1210 = await prisma.workspace.findUnique({ where: { slug: "1210-solutions" }, select: { apiToken: true } });
  if (!ws1210?.apiToken) { console.log("No 1210 token"); process.exit(1); }
  const c1210 = new EmailBisonClient(ws1210.apiToken);
  const tw12Campaigns = await prisma.campaign.findMany({
    where: { workspaceSlug: "1210-solutions", status: "active", channels: { contains: "email" }, emailBisonCampaignId: { not: null } },
    select: { name: true, emailBisonCampaignId: true },
  });
  for (const cc of tw12Campaigns) {
    console.log(`\n=== ${cc.name} (EB ${cc.emailBisonCampaignId}) ===`);
    try {
      const steps = await c1210.getSequenceSteps(cc.emailBisonCampaignId!);
      for (const s of steps) {
        const anyStep = s as any;
        const delay = anyStep.delay_days ?? anyStep.wait_days ?? anyStep.delay ?? anyStep.days_after_previous ?? "?";
        console.log(`  step ${anyStep.position ?? anyStep.order ?? "?"}: delay=${delay} | subject="${(anyStep.subject ?? anyStep.email_subject ?? "").substring(0, 40)}"`);
      }
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
