import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";

const DOMAINS = [
  "laddergroup.io",
  "theladder.group",
  "theladdergroup.co",
  "laddergroup.co",
  "laddergroup.co.uk",
];

async function main() {
  console.log("=".repeat(80));
  console.log("Ladder Group DB prior-use check");
  console.log("=".repeat(80));

  // Workspace
  const ws = await prisma.workspace.findFirst({
    where: { slug: "ladder-group" },
    select: { slug: true, name: true, status: true, senderEmailDomains: true },
  });
  console.log("\n[Workspace]");
  console.log(JSON.stringify(ws, null, 2));

  // Senders for ladder-group workspace
  const senders = await prisma.sender.findMany({
    where: { workspaceSlug: "ladder-group" },
    select: {
      id: true,
      name: true,
      emailAddress: true,
      status: true,
      channel: true,
      healthStatus: true,
      emailBounceStatus: true,
      warmupDay: true,
      warmupStartedAt: true,
      lastActiveAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  console.log(`\n[Senders for ladder-group workspace] count=${senders.length}`);
  for (const s of senders) {
    const domain = s.emailAddress?.split("@")[1] ?? "null";
    console.log(
      `  ${s.emailAddress ?? "<no email>"} | domain=${domain} | status=${s.status} | channel=${s.channel} | health=${s.healthStatus} | bounce=${s.emailBounceStatus} | warmupDay=${s.warmupDay} | lastActive=${s.lastActiveAt?.toISOString().slice(0, 10) ?? "never"} | created=${s.createdAt.toISOString().slice(0, 10)}`,
    );
  }

  // Per-domain: count senders that ever used each domain (across all workspaces to be safe)
  console.log("\n[Senders by domain — across ALL workspaces]");
  for (const d of DOMAINS) {
    const count = await prisma.sender.count({
      where: { emailAddress: { endsWith: `@${d}` } },
    });
    console.log(`  ${d}: ${count} sender record(s)`);
  }

  // DomainHealth
  console.log("\n[DomainHealth records]");
  const dh = await prisma.domainHealth.findMany({
    where: { domain: { in: DOMAINS } },
    select: {
      domain: true,
      overallHealth: true,
      spfStatus: true,
      dkimStatus: true,
      dmarcStatus: true,
      dmarcPolicy: true,
      blacklistHits: true,
      blacklistSeverity: true,
      lastBlacklistCheck: true,
      lastDnsCheck: true,
      emailguardUuid: true,
      updatedAt: true,
    },
  });
  for (const r of dh) {
    console.log(
      `  ${r.domain}: health=${r.overallHealth} spf=${r.spfStatus} dkim=${r.dkimStatus} dmarc=${r.dmarcStatus}(${r.dmarcPolicy ?? "-"}) blHits=${r.blacklistHits ?? "-"} blSev=${r.blacklistSeverity ?? "-"} lastBlCheck=${r.lastBlacklistCheck?.toISOString().slice(0, 10) ?? "never"} lastDns=${r.lastDnsCheck?.toISOString().slice(0, 10) ?? "never"} ebUuid=${r.emailguardUuid ?? "none"}`,
    );
  }
  const missing = DOMAINS.filter((d) => !dh.find((x) => x.domain === d));
  if (missing.length) console.log(`  (no DomainHealth row for: ${missing.join(", ")})`);

  // BounceSnapshot
  console.log("\n[BounceSnapshot records — aggregate by senderDomain]");
  const bs = await prisma.bounceSnapshot.groupBy({
    by: ["senderDomain"],
    where: { senderDomain: { in: DOMAINS } },
    _count: { _all: true },
    _sum: { emailsSent: true, bounced: true, replied: true },
  });
  for (const r of bs) {
    const sent = r._sum.emailsSent ?? 0;
    const bounced = r._sum.bounced ?? 0;
    const replied = r._sum.replied ?? 0;
    const bouncePct = sent > 0 ? ((bounced / sent) * 100).toFixed(2) : "n/a";
    const replyPct = sent > 0 ? ((replied / sent) * 100).toFixed(2) : "n/a";
    console.log(
      `  ${r.senderDomain}: snapshots=${r._count._all} sent=${sent} bounced=${bounced} (${bouncePct}%) replied=${replied} (${replyPct}%)`,
    );
  }
  const missingBs = DOMAINS.filter((d) => !bs.find((x) => x.senderDomain === d));
  if (missingBs.length) console.log(`  (no BounceSnapshot for: ${missingBs.join(", ")})`);

  // SenderHealthEvent for ladder-group senders
  if (senders.length > 0) {
    const events = await prisma.senderHealthEvent.findMany({
      where: { senderId: { in: senders.map((s) => s.id) } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        senderId: true,
        status: true,
        reason: true,
        detail: true,
        bouncePct: true,
        createdAt: true,
      },
    });
    console.log(`\n[Recent SenderHealthEvents — last 20 of ${events.length}]`);
    for (const e of events) {
      console.log(
        `  ${e.createdAt.toISOString().slice(0, 10)} sender=${e.senderId} status=${e.status} reason=${e.reason} bouncePct=${e.bouncePct ?? "-"} | ${e.detail ?? ""}`,
      );
    }
  }

  // Campaigns
  const camps = await prisma.campaign.findMany({
    where: { workspaceSlug: "ladder-group" },
    select: {
      id: true,
      name: true,
      status: true,
      channels: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  console.log(`\n[Campaigns for ladder-group] count=${camps.length}`);
  for (const c of camps) {
    console.log(
      `  id=${c.id} name="${c.name}" status=${c.status} channels=${c.channels} created=${c.createdAt.toISOString().slice(0, 10)}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
