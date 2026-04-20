/**
 * BL-085 probe — inspect EB campaign 82 (created by the failed Step 3 stage
 * retry) to understand why createSequenceSteps returned a 200 with unexpected
 * shape instead of the 422 we hit the first time. Probe is READ-ONLY.
 */
import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

async function main() {
  const prisma = new PrismaClient();
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "1210-solutions" },
    select: { apiToken: true },
  });
  const client = new EmailBisonClient(ws.apiToken!);

  console.log("=== EB 82 — getCampaign ===");
  try {
    const c = await client.getCampaign(82);
    console.log(JSON.stringify(c, null, 2).slice(0, 2000));
  } catch (e) {
    console.log("getCampaign error:", e instanceof Error ? e.message : String(e));
  }

  console.log("\n=== EB 82 — getSequenceSteps (v1.1) ===");
  try {
    const steps = await client.getSequenceSteps(82);
    console.log(`Total steps: ${steps.length}`);
    steps.forEach((s, i) => {
      console.log(`  [${i}] position=${s.position} subject='${s.subject}' body='${(s.body ?? '').slice(0, 60)}...' delay=${s.delay_days}`);
    });
  } catch (e) {
    console.log("getSequenceSteps error:", e instanceof Error ? e.message : String(e));
  }

  // Raw HTTP call bypassing zod parse so we can see the 200 response shape.
  console.log("\n=== EB 82 — RAW POST /campaigns/v1.1/82/sequence-steps (minimal probe) ===");
  console.log("(Not firing — creating steps would mutate EB state; only GET probed above.)");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
