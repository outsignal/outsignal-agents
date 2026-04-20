import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const campaignId = 'cmneqixpv0001p8710bov1fga';
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      targetList: {
        include: {
          people: {
            include: { person: { select: { id: true, email: true, emailVerificationStatus: true } } },
          },
        },
      },
      deploys: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });

  if (!campaign) {
    console.log('GATE_CAMPAIGN_EXISTS=FAIL (not found)');
    return;
  }

  console.log('=== Campaign state ===');
  console.log('id:', campaign.id);
  console.log('name:', campaign.name);
  console.log('workspaceSlug:', campaign.workspaceSlug);
  console.log('status:', campaign.status);
  console.log('channels:', campaign.channels);
  console.log('emailBisonCampaignId:', campaign.emailBisonCampaignId);
  console.log('emailBisonSequenceId:', campaign.emailBisonSequenceId);
  console.log('deployedAt:', campaign.deployedAt);
  console.log('targetListId:', campaign.targetListId);
  console.log('contentApproved:', campaign.contentApproved);
  console.log('leadsApproved:', campaign.leadsApproved);

  // emailSequence steps
  const emailSeq = campaign.emailSequence ? JSON.parse(campaign.emailSequence) : [];
  console.log('emailSequence steps:', emailSeq.length);
  for (const s of emailSeq) {
    console.log(`  pos=${s.position} subj="${(s.subjectLine || '').slice(0, 60)}" delay=${s.delayDays}`);
  }

  // leads
  const peopleCount = campaign.targetList?.people.length ?? 0;
  const withEmail = campaign.targetList?.people.filter((p) => p.person.email).length ?? 0;
  const validEmails = campaign.targetList?.people.filter((p) => p.person.emailVerificationStatus === 'valid').length ?? 0;
  console.log('targetList people:', peopleCount);
  console.log('  with email:', withEmail);
  console.log('  verified valid:', validEmails);

  // Deploys
  console.log('=== Recent deploys (top 5) ===');
  for (const d of campaign.deploys) {
    console.log(`  ${d.id} status=${d.status} emailStatus=${d.emailStatus} ebId=${d.emailBisonCampaignId} createdAt=${d.createdAt.toISOString()} err=${d.error?.slice(0, 80) ?? 'null'}`);
  }

  // Any in-flight?
  const inflight = campaign.deploys.find((d) => d.status === 'pending' || d.status === 'running');
  console.log('inflight deploy?', inflight ? `YES id=${inflight.id} status=${inflight.status}` : 'NO');

  // Workspace status
  const ws = await prisma.workspace.findUnique({
    where: { slug: campaign.workspaceSlug },
    select: { slug: true, name: true, status: true, package: true },
  });
  console.log('=== Workspace ===');
  console.log(ws);

  // Senders for workspace, email or both channel, healthy, EB registered
  const senders = await prisma.sender.findMany({
    where: {
      workspaceSlug: campaign.workspaceSlug,
      channel: { in: ['email', 'both'] },
      status: { in: ['active', 'setup'] },
      emailBisonSenderId: { not: null },
    },
    select: {
      id: true, name: true, emailAddress: true, channel: true, status: true,
      healthStatus: true, emailBounceStatus: true, sessionStatus: true,
      emailBisonSenderId: true,
    },
  });
  console.log('=== Senders (email/both, EB-registered) ===');
  console.log('count:', senders.length);
  for (const s of senders) {
    console.log(`  ${s.id} ${s.emailAddress} ch=${s.channel} status=${s.status} health=${s.healthStatus} bounce=${s.emailBounceStatus} session=${s.sessionStatus} ebId=${s.emailBisonSenderId}`);
  }

  const healthy = senders.filter(
    (s) => s.healthStatus === 'healthy' && ['healthy', 'elevated'].includes(s.emailBounceStatus)
  );
  console.log('healthy senders usable:', healthy.length);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
