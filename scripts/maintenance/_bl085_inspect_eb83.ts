/**
 * BL-085 Fix F post-mortem — inspect EB 83 (created during the stage-deploy
 * retry that reached Step 3 OK but failed at Step 5 on a NEW bug:
 *   Step 5 createSchedule requires save_as_template field (EB contract change).
 *
 * Goals:
 *   (a) CONFIRM Fix A + B worked: EB 83 should have EXACTLY 3 sequence
 *       steps (not 9). This validates that the withRetry amplifier is
 *       neutralized and the tolerant parse path didn't re-POST.
 *   (b) INSPECT for cleanup: report leads/schedule/senders state so the
 *       PM knows what to delete.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "1210-solutions";
const EB_ID = 83;

async function main() {
  const prisma = new PrismaClient();
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    const ebClient = new EmailBisonClient(workspace.apiToken!);

    const campaign = await ebClient.getCampaign(EB_ID);
    const steps = await ebClient.getSequenceSteps(EB_ID);
    const schedule = await ebClient.getSchedule(EB_ID).catch((e) => `ERROR: ${e instanceof Error ? e.message : String(e)}`);
    const leadsPage = await ebClient.getCampaignLeads(EB_ID, 1, 1).catch((e) => ({ meta: { total: `ERROR: ${e instanceof Error ? e.message : String(e)}` } }));

    console.log("===== EB 83 POST-MORTEM =====");
    console.log(`campaign.id = ${campaign.id}`);
    console.log(`campaign.status = ${campaign.status}`);
    console.log(`campaign.name = ${campaign.name}`);
    console.log(`sequenceStepsCount = ${steps.length}`);
    console.log("sequenceSteps (id | position | subject):");
    for (const s of steps) {
      console.log(`  ${s.id} | pos=${s.position} | subj='${s.subject}'`);
    }
    console.log(`schedule = ${typeof schedule === 'string' ? schedule : (schedule == null ? 'null' : JSON.stringify(schedule))}`);
    console.log(`leads.total = ${leadsPage?.meta?.total ?? '(unknown)'}`);

    // Senders inside the campaign object
    const ebcAny = campaign as Record<string, unknown>;
    console.log(`sender_emails count = ${Array.isArray(ebcAny.sender_emails) ? (ebcAny.sender_emails as unknown[]).length : 'n/a'}`);

    console.log("===== END =====");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
