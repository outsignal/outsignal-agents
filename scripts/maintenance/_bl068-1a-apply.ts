import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const IDS = [
  'cmnpwzv9e010np8itsf3f35oy',
  'cmnpwzwi5011sp8itj20w1foq',
  'cmnpwzxmg012gp8itxv4dvmyb',
  'cmnpwzym5014op8it2cpupfwx',
  'cmnpx037s01dcp8itzzilfdfb',
  'cmnq5nivc0001p8534g0k4wr6',
  'cmneq92p20000p8p7dhqn8g42',
  'cmneqixpv0001p8710bov1fga',
  'cmneq1sdj0001p8cg97lb9rhd',
  'cmneqhwo50001p843r5hmsul3',
  'cmneqa5180001p8rkwyrrlkg8',
];

async function main() {
  // Snapshot BEFORE for each row
  const before = await prisma.campaign.findMany({
    where: { id: { in: IDS } },
    select: { id: true, deployedAt: true, status: true, contentApproved: true, leadsApproved: true },
  });
  const beforeMap = new Map(before.map((r) => [r.id, r]));

  if (before.length !== IDS.length) {
    throw new Error(`Expected ${IDS.length} rows, found ${before.length}`);
  }
  for (const r of before) {
    if (r.status !== 'approved' || r.deployedAt === null) {
      throw new Error(`Guard failed for ${r.id}: status=${r.status} deployedAt=${r.deployedAt}`);
    }
  }

  const ops: any[] = [];
  for (const id of IDS) {
    const snap = beforeMap.get(id)!;
    ops.push(
      prisma.campaign.update({
        where: { id },
        data: { deployedAt: null },
      })
    );
    ops.push(
      prisma.auditLog.create({
        data: {
          action: 'campaign.deployedat.cleared',
          entityType: 'Campaign',
          entityId: id,
          adminEmail: 'ops@outsignal.ai',
          metadata: {
            reason: 'BL-068-adjacent cleanup from ad3105de rollback side-effect',
            phase: 'Phase 1a amendment',
            relatedCommit: 'ad3105de',
            priorDeployedAt: snap.deployedAt?.toISOString() ?? null,
            priorStatus: snap.status,
            priorContentApproved: snap.contentApproved,
            priorLeadsApproved: snap.leadsApproved,
          },
        },
      })
    );
  }

  const results = await prisma.$transaction(ops);
  console.log(`Transaction applied: ${results.length} ops (${IDS.length} updates + ${IDS.length} audit logs)`);

  // Post-verify
  const after = await prisma.campaign.findMany({
    where: { id: { in: IDS } },
    select: { id: true, deployedAt: true, status: true, contentApproved: true, leadsApproved: true },
  });
  for (const r of after) {
    if (r.deployedAt !== null || r.status !== 'approved' || r.contentApproved !== true || r.leadsApproved !== true) {
      throw new Error(`Post-verify failed for ${r.id}: ${JSON.stringify(r)}`);
    }
  }

  // Collateral check: 0 rows with deployedAt IS NOT NULL AND status=approved in Lime/1210
  const stragglers = await prisma.campaign.findMany({
    where: {
      deployedAt: { not: null },
      status: 'approved',
      workspace: { slug: { in: ['lime-recruitment', '1210-solutions'] } },
    },
    select: { id: true, deployedAt: true },
  });
  console.log(`Stragglers after cleanup (expected 0): ${stragglers.length}`);
  if (stragglers.length > 0) {
    console.log(JSON.stringify(stragglers, null, 2));
    throw new Error('Stragglers remain');
  }

  console.log('Phase 1a complete: 11 rows cleared, 11 audit logs written, 0 stragglers.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
