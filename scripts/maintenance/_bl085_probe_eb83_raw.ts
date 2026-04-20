/**
 * Raw probe of EB 83 — bypass client Zod to see the actual v1.1 response
 * shape and count steps. Using fetch directly is justified here ONLY because
 * the client's getSequenceSteps Zod schema is rejecting the live v1.1
 * response (which is exactly the BL-085 symptom we're investigating). This
 * is a DIAGNOSTIC script, NOT normal code path.
 */

import { PrismaClient } from "@prisma/client";

const WORKSPACE_SLUG = "1210-solutions";
const EB_ID = 83;

async function main() {
  const prisma = new PrismaClient();
  try {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });

    const res = await fetch(
      `https://app.outsignal.ai/api/campaigns/v1.1/${EB_ID}/sequence-steps`,
      {
        headers: {
          Authorization: `Bearer ${ws.apiToken}`,
          Accept: "application/json",
        },
      },
    );
    const text = await res.text();
    console.log(`status = ${res.status}`);
    console.log(`raw body (first 2000 chars):`);
    console.log(text.slice(0, 2000));

    try {
      const parsed = JSON.parse(text);
      const data = parsed?.data;
      if (data?.sequence_steps && Array.isArray(data.sequence_steps)) {
        console.log(`\nNESTED SHAPE — sequence_steps count: ${data.sequence_steps.length}`);
        console.log(`IDs: ${data.sequence_steps.map((s: Record<string, unknown>) => s.id).join(", ")}`);
        console.log(`Orders: ${data.sequence_steps.map((s: Record<string, unknown>) => s.order).join(", ")}`);
        console.log(`Subjects: ${data.sequence_steps.map((s: Record<string, unknown>) => s.email_subject).join(" | ")}`);
      } else if (Array.isArray(data)) {
        console.log(`\nFLAT SHAPE — data count: ${data.length}`);
      } else {
        console.log(`\nOTHER SHAPE — typeof data: ${typeof data}`);
      }
    } catch (e) {
      console.log(`JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
