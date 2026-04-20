/**
 * BL-085 — delete EB 81, the pre-BL-085-fix orphan from the failed 422
 * canary run (deploy cmo1hnrmu, CampaignDeploy status=failed, no live
 * Campaign pointer). The CampaignDeploy audit row is preserved; only the
 * EB-side resource is removed.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { isNotFoundError } from "@/lib/emailbison/errors";

const WORKSPACE_SLUG = "1210-solutions";
const ORPHAN_EB_ID = 81;

async function main() {
  const prisma = new PrismaClient();
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    const ebClient = new EmailBisonClient(workspace.apiToken!);

    console.log(`Deleting EB ${ORPHAN_EB_ID}...`);
    await ebClient.deleteCampaign(ORPHAN_EB_ID);
    console.log(`Delete call succeeded.`);

    // Poll up to 15s for async deletion to complete.
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await ebClient.getCampaign(ORPHAN_EB_ID);
        console.log(`Still exists on attempt ${i + 1}/8...`);
      } catch (err) {
        if (isNotFoundError(err)) {
          console.log(`EB ${ORPHAN_EB_ID} confirmed deleted.`);

          const allEb = await ebClient.getCampaigns();
          console.log(`Final state: EB has ${allEb.length} campaign(s) in ${WORKSPACE_SLUG}.`);
          for (const c of allEb) {
            console.log(`  EB ${c.id} | status=${c.status} | name='${c.name}'`);
          }
          return;
        }
        throw err;
      }
    }
    console.warn(`EB ${ORPHAN_EB_ID} not confirmed deleted after 16s.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
