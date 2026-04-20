import { prisma } from "@/lib/db";
const DOMAINS = ["laddergroup.io", "theladder.group", "theladdergroup.co", "laddergroup.co", "laddergroup.co.uk"];
(async () => {
  const dh = await prisma.domainHealth.findMany({
    where: { domain: { in: DOMAINS } },
    select: {
      domain: true, spfStatus: true, dkimStatus: true, dmarcStatus: true, mxStatus: true,
      overallHealth: true, lastDnsCheck: true, createdAt: true, mxHosts: true, dkimSelectors: true,
    },
  });
  console.log(`DomainHealth rows for Ladder domains: ${dh.length}`);
  for (const d of dh) {
    console.log(`\n${d.domain}`);
    console.log(`  overall=${d.overallHealth} spf=${d.spfStatus} dkim=${d.dkimStatus} dmarc=${d.dmarcStatus} mx=${d.mxStatus}`);
    console.log(`  mxHosts=${d.mxHosts} dkimSelectors=${d.dkimSelectors}`);
    console.log(`  lastDnsCheck=${d.lastDnsCheck?.toISOString?.() ?? '-'} created=${d.createdAt.toISOString().slice(0,10)}`);
  }
  await prisma.$disconnect();
})();
