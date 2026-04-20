import { prisma } from "@/lib/db";

const DOMAINS = ["laddergroup.io", "theladder.group", "theladdergroup.co", "laddergroup.co", "laddergroup.co.uk"];

async function main() {
  // 1. Workspace
  const ws = await prisma.workspace.findUnique({ where: { slug: "ladder-group" } });
  console.log(`Workspace: ${ws?.name} (${ws?.slug}), created=${ws?.createdAt.toISOString().slice(0,10)}, package=${ws?.package}`);

  // 2. Senders for any of these domains (in case workspaceSlug differs)
  const senders = await prisma.sender.findMany({
    where: {
      OR: DOMAINS.map((d) => ({ emailAddress: { contains: `@${d}` } })),
    },
    select: { id: true, workspaceSlug: true, emailAddress: true, status: true, channel: true, createdAt: true },
  });
  console.log(`\nSenders matching any Ladder domain: ${senders.length}`);
  for (const s of senders) console.log(`  ${s.emailAddress} | ws=${s.workspaceSlug} status=${s.status} chan=${s.channel}`);

  // 3. InboxStatusSnapshot
  const snap = await prisma.inboxStatusSnapshot.findUnique({ where: { workspaceSlug: "ladder-group" } });
  if (snap) {
    console.log(`\nInboxStatusSnapshot checkedAt=${snap.checkedAt.toISOString()}`);
    try {
      const statuses = JSON.parse(snap.statuses);
      console.log(`  statuses: ${JSON.stringify(statuses, null, 2)}`);
      console.log(`  disconnected: ${snap.disconnectedEmails}`);
    } catch {
      console.log(`  raw: ${snap.statuses}`);
    }
  } else {
    console.log(`\nInboxStatusSnapshot: NONE`);
  }

  // 4. DomainHealth
  const dh = await prisma.domainHealth.findMany({
    where: { domain: { in: DOMAINS } },
    select: { domain: true, workspaceSlug: true, spfValid: true, dkimValid: true, dmarcValid: true, lastCheckedAt: true },
  }).catch((e) => { console.log(`DomainHealth query err: ${e.message}`); return []; });
  console.log(`\nDomainHealth rows: ${dh.length}`);
  for (const d of dh) console.log(`  ${d.domain} ws=${d.workspaceSlug} spf=${d.spfValid} dkim=${d.dkimValid} dmarc=${d.dmarcValid} checkedAt=${d.lastCheckedAt?.toISOString?.() ?? '-'}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
