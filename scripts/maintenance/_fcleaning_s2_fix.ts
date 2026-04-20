import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { saveCampaignSequences } from "@/lib/campaigns/operations";

const CAMPAIGN_ID = "cmneqixpv0001p8710bov1fga";

const OLD_S2_OPENING =
  "Hi {FIRSTNAME},\n\n{FIRSTNAME}, winning a new cleaning contract is brilliant until you realise";
const NEW_S2_OPENING =
  "Hi {FIRSTNAME},\n\nWinning a new cleaning contract is brilliant until you realise";

async function main() {
  const current = await prisma.campaign.findUniqueOrThrow({
    where: { id: CAMPAIGN_ID },
    select: { emailSequence: true, name: true, status: true },
  });

  if (!current.emailSequence) throw new Error("No emailSequence on campaign");
  const steps = JSON.parse(current.emailSequence) as Array<Record<string, unknown>>;

  const s2 = steps.find((s) => s.stepNumber === 2);
  if (!s2) throw new Error("Step 2 not found");

  const oldBody = String(s2.body ?? "");
  if (!oldBody.startsWith(OLD_S2_OPENING)) {
    throw new Error(
      `Step 2 body does not start with expected opening. First 120 chars: ${oldBody.slice(0, 120)}`,
    );
  }

  const newBody = NEW_S2_OPENING + oldBody.slice(OLD_S2_OPENING.length);

  // Build new sequence preserving EVERY other field and key ordering verbatim.
  const nextSteps = steps.map((s) =>
    s.stepNumber === 2 ? { ...s, body: newBody } : s,
  );

  console.log("Campaign:", current.name, "| status:", current.status);
  console.log("\n--- S2 body BEFORE (first 3 lines) ---");
  console.log(oldBody.split("\n").slice(0, 3).join("\n"));
  console.log("\n--- S2 body AFTER (first 3 lines) ---");
  console.log(newBody.split("\n").slice(0, 3).join("\n"));

  // Diff check: only the body of step 2 should differ; key ordering preserved.
  const originalKeys = Object.keys(steps[1]);
  const newKeys = Object.keys(nextSteps[1]);
  if (JSON.stringify(originalKeys) !== JSON.stringify(newKeys)) {
    throw new Error(
      `Key order changed! before=${JSON.stringify(originalKeys)} after=${JSON.stringify(newKeys)}`,
    );
  }

  // Persist via the official operation path (handles audit/approval guards).
  const updated = await saveCampaignSequences(CAMPAIGN_ID, {
    emailSequence: nextSteps,
  });

  console.log("\nSaved. contentApproved:", updated.contentApproved, "| status:", updated.status);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
