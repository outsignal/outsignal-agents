/**
 * Narrow structural fix to 1210 Healthcare Email campaign (2026-04-15).
 * - Step 1: untouched
 * - Step 2: subjectLine -> "", prepend "Hi {FIRSTNAME},\n\n" to body
 * - Step 3: body prepend only, subjectLine untouched
 * Preserves exact stored shape; routes through saveCampaignSequences so
 * BL-053 contentApproved reset + AuditLog fire.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { saveCampaignSequences } from "@/lib/campaigns/operations";

const HC_EMAIL = "cmneqhwo50001p843r5hmsul3";

type Step = {
  position: number;
  subjectLine: string;
  subjectVariantB?: string;
  body: string;
  delayDays: number;
  notes?: string;
};

async function loadSequence(id: string): Promise<Step[]> {
  const c = await prisma.campaign.findUniqueOrThrow({
    where: { id },
    select: { emailSequence: true },
  });
  if (!c.emailSequence) throw new Error(`campaign ${id} has no emailSequence`);
  const raw =
    typeof c.emailSequence === "string"
      ? JSON.parse(c.emailSequence as unknown as string)
      : c.emailSequence;
  if (!Array.isArray(raw))
    throw new Error(`emailSequence for ${id} not an array`);
  return raw as Step[];
}

async function main() {
  // Snapshot pre-save state
  const preSeq = await loadSequence(HC_EMAIL);
  const preByPos = new Map(preSeq.map((s) => [s.position, s]));
  const preS1 = preByPos.get(1);
  const preS2 = preByPos.get(2);
  const preS3 = preByPos.get(3);
  if (!preS1 || !preS2 || !preS3)
    throw new Error("Missing one of positions 1/2/3");

  // Deep-clone step 1 for later diff-check (reference-safe)
  const preS1Snapshot = JSON.parse(JSON.stringify(preS1));

  // --- Step 2 edits ---
  if (preS2.body.startsWith("Hi {FIRSTNAME},")) {
    console.log("Step 2 body already prepended — skipping body edit");
  } else if (!preS2.body.startsWith("Most healthcare agencies miss this.")) {
    throw new Error(
      `Step 2 body does not start with expected opener. First 120: ${preS2.body.slice(0, 120)}`,
    );
  } else {
    preS2.body = "Hi {FIRSTNAME},\n\n" + preS2.body;
  }
  // Subject -> empty string (threads under step 1)
  preS2.subjectLine = "";

  // --- Step 3 edits ---
  if (preS3.body.startsWith("Hi {FIRSTNAME},")) {
    console.log("Step 3 body already prepended — skipping");
  } else if (
    !preS3.body.startsWith("Last note. The agencies we work with")
  ) {
    throw new Error(
      `Step 3 body does not start with expected opener. First 120: ${preS3.body.slice(0, 120)}`,
    );
  } else {
    preS3.body = "Hi {FIRSTNAME},\n\n" + preS3.body;
  }
  // subjectLine left verbatim

  // Step 1 must be untouched — assert reference blob is byte-equal to snapshot
  if (JSON.stringify(preS1) !== JSON.stringify(preS1Snapshot)) {
    throw new Error("Step 1 was mutated — aborting");
  }

  // Save — preSeq array carries positions 1,2,3 with the mutations above
  await saveCampaignSequences(HC_EMAIL, { emailSequence: preSeq });
  console.log("✓ saved");

  // --- Verify ---
  const c = await prisma.campaign.findUniqueOrThrow({
    where: { id: HC_EMAIL },
    select: {
      name: true,
      status: true,
      contentApproved: true,
      emailSequence: true,
    },
  });
  const post = JSON.parse(c.emailSequence as unknown as string) as Step[];
  const postByPos = new Map(post.map((s) => [s.position, s]));
  const postS1 = postByPos.get(1)!;
  const postS2 = postByPos.get(2)!;
  const postS3 = postByPos.get(3)!;

  const s1Unchanged =
    JSON.stringify(postS1) === JSON.stringify(preS1Snapshot);

  console.log("\n=== VERIFY ===");
  console.log(`campaign: ${c.name}`);
  console.log(`status: ${c.status}  contentApproved: ${c.contentApproved}`);
  console.log(`step 1 unchanged vs pre-save: ${s1Unchanged}`);
  console.log(
    `step 2 subjectLine: ${JSON.stringify(postS2.subjectLine)}  (expect "")`,
  );
  console.log(`step 2 body line1: ${JSON.stringify(postS2.body.split("\n")[0])}`);
  console.log(
    `step 3 subjectLine: ${JSON.stringify(postS3.subjectLine)}  (unchanged)`,
  );
  console.log(`step 3 body line1: ${JSON.stringify(postS3.body.split("\n")[0])}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
