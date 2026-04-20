/**
 * BL-085 Fix F cleanup — delete EB 83, the orphan created by the stage-deploy
 * retry that SUCCEEDED through Step 3 (validating Fix A+B: 3 steps not 9)
 * but failed at Step 5 on a NEW bug (createSchedule now requires
 * save_as_template field in the v1.1 contract).
 *
 * Per hard rules: "If Fix F creates ANOTHER orphan (Step 4-8 fails mid-run),
 * delete it immediately as part of the run report. Do not leave lingering
 * orphans."
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { isNotFoundError } from "@/lib/emailbison/errors";

const WORKSPACE_SLUG = "1210-solutions";
const EB_ID = 83;

async function main() {
  const prisma = new PrismaClient();
  try {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    const ebClient = new EmailBisonClient(ws.apiToken!);

    console.log(`Deleting EB ${EB_ID}...`);
    await ebClient.deleteCampaign(EB_ID);
    console.log(`Delete call succeeded.`);

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await ebClient.getCampaign(EB_ID);
        console.log(`Attempt ${i + 1}/10: still exists...`);
      } catch (err) {
        if (isNotFoundError(err)) {
          console.log(`EB ${EB_ID} confirmed deleted.`);
          const all = await ebClient.getCampaigns();
          console.log(`Final state: EB has ${all.length} campaign(s) in ${WORKSPACE_SLUG}.`);
          return;
        }
        throw err;
      }
    }
    console.warn("Not confirmed deleted after 20s.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
