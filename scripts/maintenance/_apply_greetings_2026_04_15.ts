/**
 * One-off: apply greeting prepends to 7 steps across 4 campaigns (2026-04-15).
 * Preserves the exact stored shape of each emailSequence step — only mutates
 * body/bodyHtml/bodyText text. Routes through saveCampaignSequences so BL-053
 * contentApproved-reset + audit logs fire.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { saveCampaignSequences } from "@/lib/campaigns/operations";

type LimeStep = {
  position: number;
  subjectLine: string;
  subjectVariantB?: string;
  bodyHtml: string;
  bodyText: string;
  delayDays: number;
  notes?: string;
};

type TenStep = {
  stepNumber: number;
  channel: string;
  type: string;
  subject: string;
  subjectB?: string;
  body: string;
  delayDays: number;
  notes?: string;
};

const LIME_E2 = "cmnpwzwi5011sp8itj20w1foq";
const LIME_E5 = "cmnpx037s01dcp8itzzilfdfb";
const TEN_IND = "cmneqa5180001p8rkwyrrlkg8";
const TEN_FAC = "cmneqixpv0001p8710bov1fga";

async function loadEmailSequence(id: string): Promise<unknown[]> {
  const c = await prisma.campaign.findUniqueOrThrow({
    where: { id },
    select: { emailSequence: true },
  });
  if (!c.emailSequence) throw new Error(`campaign ${id} has no emailSequence`);
  const raw =
    typeof c.emailSequence === "string"
      ? JSON.parse(c.emailSequence)
      : c.emailSequence;
  if (!Array.isArray(raw)) throw new Error(`emailSequence for ${id} not an array`);
  return raw;
}

async function applyLimeE2() {
  const seq = (await loadEmailSequence(LIME_E2)) as LimeStep[];
  // Step 2 (position 1): replace "Quick one, {FIRSTNAME}." with "Hi {FIRSTNAME},"
  const s2 = seq.find((s) => s.position === 1);
  if (!s2) throw new Error("Lime E2 step position=1 missing");
  s2.bodyHtml = s2.bodyHtml.replace(
    "<p>Quick one, {FIRSTNAME}.</p>",
    "<p>Hi {FIRSTNAME},</p>",
  );
  s2.bodyText = s2.bodyText.replace(
    /^Quick one, \{FIRSTNAME\}\.\n\n/,
    "Hi {FIRSTNAME},\n\n",
  );

  // Step 3 (position 2): prepend greeting, drop inline {FIRSTNAME}, , capitalise O
  const s3 = seq.find((s) => s.position === 2);
  if (!s3) throw new Error("Lime E2 step position=2 missing");
  // bodyHtml currently starts: <p>{FIRSTNAME}, one thing that comes up a lot...
  s3.bodyHtml = s3.bodyHtml.replace(
    "<p>{FIRSTNAME}, one thing",
    "<p>Hi {FIRSTNAME},</p><p>One thing",
  );
  s3.bodyText = s3.bodyText.replace(
    /^\{FIRSTNAME\}, one thing/,
    "Hi {FIRSTNAME},\n\nOne thing",
  );

  await saveCampaignSequences(LIME_E2, { emailSequence: seq });
  return seq;
}

async function applyLimeE5() {
  const seq = (await loadEmailSequence(LIME_E5)) as Array<{
    position: number;
    subjectLine: string;
    subjectVariantB?: string;
    body: string;
    delayDays: number;
    notes?: string;
  }>;
  // Step 3 (position 2): drop {FIRSTNAME}, prefix, capitalise spintax options, prepend greeting
  const s3 = seq.find((s) => s.position === 2);
  if (!s3) throw new Error("Lime E5 step position=2 missing");
  // Transform only if it still starts with the original pattern
  const expected =
    "{FIRSTNAME}, {running short is a safety risk and an overtime bill|being down two people means safety issues and overtime costs}.";
  if (!s3.body.startsWith(expected)) {
    throw new Error(
      `Lime E5 step3 body does not start with expected prefix:\n${s3.body.slice(0, 200)}`,
    );
  }
  const newPrefix =
    "Hi {FIRSTNAME},\n\n{Running short is a safety risk and an overtime bill|Being down two people means safety issues and overtime costs}.";
  s3.body = newPrefix + s3.body.slice(expected.length);

  await saveCampaignSequences(LIME_E5, { emailSequence: seq });
  return seq;
}

async function applyTenIndustrial() {
  const seq = (await loadEmailSequence(TEN_IND)) as TenStep[];
  const s2 = seq.find((s) => s.stepNumber === 2);
  if (!s2) throw new Error("1210 Ind step 2 missing");
  // body verbatim, just prepend greeting
  if (s2.body.startsWith("Hi {FIRSTNAME},")) {
    console.log("1210 Ind S2 already prepended, skipping");
  } else {
    s2.body = "Hi {FIRSTNAME},\n\n" + s2.body;
  }

  const s3 = seq.find((s) => s.stepNumber === 3);
  if (!s3) throw new Error("1210 Ind step 3 missing");
  if (s3.body.startsWith("Hi {FIRSTNAME},")) {
    console.log("1210 Ind S3 already prepended, skipping");
  } else {
    s3.body = "Hi {FIRSTNAME},\n\n" + s3.body;
  }

  await saveCampaignSequences(TEN_IND, { emailSequence: seq });
  return seq;
}

async function applyTenFacilities() {
  const seq = (await loadEmailSequence(TEN_FAC)) as TenStep[];
  const s2 = seq.find((s) => s.stepNumber === 2);
  if (!s2) throw new Error("1210 Fac step 2 missing");
  // body verbatim, just prepend greeting
  if (s2.body.startsWith("Hi {FIRSTNAME},")) {
    console.log("1210 Fac S2 already prepended, skipping");
  } else {
    s2.body = "Hi {FIRSTNAME},\n\n" + s2.body;
  }

  // Step 3 — Option B: drop "{FIRSTNAME}, " inline token, prepend greeting.
  const s3 = seq.find((s) => s.stepNumber === 3);
  if (!s3) throw new Error("1210 Fac step 3 missing");
  const expected = "{FIRSTNAME}, appreciate your time is tight.";
  if (s3.body.startsWith("Hi {FIRSTNAME},")) {
    console.log("1210 Fac S3 already prepended, skipping");
  } else if (!s3.body.startsWith(expected)) {
    throw new Error(
      `1210 Fac step3 body unexpected:\n${s3.body.slice(0, 200)}`,
    );
  } else {
    const newPrefix = "Hi {FIRSTNAME},\n\nAppreciate your time is tight.";
    s3.body = newPrefix + s3.body.slice(expected.length);
  }

  await saveCampaignSequences(TEN_FAC, { emailSequence: seq });
  return seq;
}

async function verify(id: string, label: string) {
  const c = await prisma.campaign.findUniqueOrThrow({
    where: { id },
    select: { status: true, emailSequence: true, contentApproved: true, name: true },
  });
  const seq = JSON.parse(c.emailSequence as unknown as string) as Array<
    Record<string, unknown>
  >;
  console.log(`\n=== ${label} (${c.name}) ===`);
  console.log(`status: ${c.status}  contentApproved: ${c.contentApproved}`);
  for (const step of seq) {
    const pos = step.position ?? step.stepNumber;
    const body =
      (step.body as string) ||
      (step.bodyText as string) ||
      "";
    console.log(
      `  step ${pos}: first line = ${JSON.stringify(body.split("\n")[0])}`,
    );
  }
}

async function main() {
  console.log("Applying edits...\n");
  await applyLimeE2();
  console.log("✓ Lime E2 saved");
  await applyLimeE5();
  console.log("✓ Lime E5 saved");
  await applyTenIndustrial();
  console.log("✓ 1210 Industrial saved");
  await applyTenFacilities();
  console.log("✓ 1210 Facilities saved");

  console.log("\n--- Verification ---");
  await verify(LIME_E2, "Lime E2");
  await verify(LIME_E5, "Lime E5");
  await verify(TEN_IND, "1210 Industrial");
  await verify(TEN_FAC, "1210 Facilities");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
