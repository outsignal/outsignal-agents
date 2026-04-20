/**
 * Read-only: list senders per campaign for lime-recruitment, filter to 5 target inboxes.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const TARGETS = [
  "l.m@limerecuk.co.uk",
  "marshalllucy@limerecuk.co.uk",
  "marshall.lucy@limerecuk.co.uk",
  "lucy.marsh@limerecuk.co.uk",
  "lucy.l@limerecuk.co.uk",
];

async function main() {
  const ws = await prisma.workspace.findUnique({
    where: { slug: "lime-recruitment" },
    select: { id: true, slug: true, apiToken: true },
  });
  if (!ws) throw new Error("workspace not found");
  const client = new EmailBisonClient(ws.apiToken);

  const campaigns = await client.getCampaigns();
  console.log(`Found ${campaigns.length} campaigns`);

  type Hit = { inbox: string; campaignId: number; campaignName: string; status: string };
  const hits: Hit[] = [];

  for (const c of campaigns) {
    try {
      const senders = await client.getCampaignSenderEmails(c.id);
      for (const s of senders) {
        const email = (s as any).email?.toLowerCase?.() ?? "";
        if (TARGETS.includes(email)) {
          hits.push({ inbox: email, campaignId: c.id, campaignName: c.name, status: (c as any).status });
        }
      }
    } catch (e: any) {
      console.error(`campaign ${c.id} ${c.name} failed: ${e.message}`);
    }
  }

  console.log(JSON.stringify({ campaigns: campaigns.map(c => ({ id: c.id, name: c.name, status: (c as any).status })), hits }, null, 2));

  // Per-inbox summary
  const byInbox: Record<string, Hit[]> = {};
  for (const t of TARGETS) byInbox[t] = [];
  for (const h of hits) byInbox[h.inbox].push(h);
  console.log("\n=== PER-INBOX SUMMARY ===");
  for (const t of TARGETS) {
    const list = byInbox[t];
    if (list.length === 0) {
      console.log(`${t}: NO CAMPAIGN ATTACHMENTS`);
    } else {
      for (const h of list) {
        console.log(`${t}: campaign=${h.campaignId} "${h.campaignName}" status=${h.status}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
