/**
 * BL-093 (2026-04-16) — derive the per-campaign sender allocation map for
 * 1210-solutions from live DB. Used to verify (and correct) the hardcoded
 * `CAMPAIGN_SENDER_ALLOCATION` map in `src/lib/channels/email-adapter.ts`.
 *
 * Filter mirrors the email-adapter Step 6 query exactly:
 *   workspaceSlug = 1210-solutions
 *   channel in [email, both]
 *   healthStatus in [healthy, warning]
 *   emailBisonSenderId != null
 *   orderBy emailBisonSenderId asc
 *
 * Bucket assignment: idx % 5 (Construction=0, Green=1, Healthcare=2,
 * Industrial=3, Facilities=4).
 *
 * Read-only — does not mutate any rows.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // --- 1. healthy email senders, EB-ID-asc ---
  const senders = await prisma.sender.findMany({
    where: {
      workspace: { slug: "1210-solutions" },
      channel: { in: ["email", "both"] },
      healthStatus: { in: ["healthy", "warning"] },
      emailBisonSenderId: { not: null },
    },
    select: {
      emailBisonSenderId: true,
    },
    orderBy: { emailBisonSenderId: "asc" },
  });

  const ids = senders
    .map((s) => s.emailBisonSenderId!)
    .filter((id) => id != null);

  console.log("== sender pool ==");
  console.log("count:", ids.length);
  console.log("ids:", JSON.stringify(ids));

  // --- 2. round-robin buckets ---
  const buckets: number[][] = [[], [], [], [], []];
  ids.forEach((id, idx) => buckets[idx % 5].push(id));

  console.log("\n== buckets (idx % 5) ==");
  buckets.forEach((bucket, i) => {
    console.log(
      `bucket ${i} (count=${bucket.length}): ${JSON.stringify(bucket)}`,
    );
  });

  // --- 3. 1210 email campaigns (channels is a JSON STRING column) ---
  const campaigns = await prisma.campaign.findMany({
    where: {
      workspace: { slug: "1210-solutions" },
      channels: { contains: "email" },
    },
    select: {
      id: true,
      name: true,
      status: true,
      emailBisonCampaignId: true,
      channels: true,
    },
    orderBy: { name: "asc" },
  });

  console.log("\n== 1210 email campaigns ==");
  for (const c of campaigns) {
    console.log(
      `${c.id}  status=${c.status}  ebId=${c.emailBisonCampaignId}  channels=${c.channels}  name='${c.name}'`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
