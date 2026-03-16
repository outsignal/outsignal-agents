import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export const dynamic = "force-dynamic";

interface StepStat {
  step: number;
  channel: "email" | "linkedin";
  sent: number;
  replied: number;
  interestedCount: number;
  objectionCount: number;
}

interface CampaignSnapshot {
  campaignName: string;
  stepStats?: StepStat[];
}

interface EmailStep {
  position: number;
  subjectLine?: string;
}

interface LinkedinStep {
  position: number;
  type?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: campaignId } = await params;

  // Get the latest snapshot for this campaign
  const latestMetric = await prisma.cachedMetrics.findFirst({
    where: {
      metricType: "campaign_snapshot",
      metricKey: campaignId,
    },
    orderBy: { date: "desc" },
  });

  // Get the campaign record for sequence labels
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      name: true,
      emailSequence: true,
      linkedinSequence: true,
    },
  });

  if (!latestMetric && !campaign) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  const campaignName =
    campaign?.name ||
    (latestMetric
      ? (JSON.parse(latestMetric.data) as CampaignSnapshot).campaignName
      : "Unknown");

  // Parse email/linkedin sequences for step labels
  let emailSteps: EmailStep[] = [];
  let linkedinSteps: LinkedinStep[] = [];
  try {
    if (campaign?.emailSequence) {
      emailSteps = JSON.parse(campaign.emailSequence) as EmailStep[];
    }
  } catch {
    // ignore parse errors
  }
  try {
    if (campaign?.linkedinSequence) {
      linkedinSteps = JSON.parse(campaign.linkedinSequence) as LinkedinStep[];
    }
  } catch {
    // ignore parse errors
  }

  // Get stepStats from snapshot if available
  let stepStats: StepStat[] = [];
  if (latestMetric) {
    const snapshot = JSON.parse(latestMetric.data) as CampaignSnapshot;
    stepStats = snapshot.stepStats || [];
  }

  // If no stepStats from snapshot, fall back to Reply table
  if (stepStats.length === 0) {
    const replyStats = await prisma.reply.groupBy({
      by: ["sequenceStep"],
      where: { campaignId },
      _count: { id: true },
    });

    // Also get intent distribution per step
    const intentCounts = await prisma.reply.groupBy({
      by: ["sequenceStep", "intent"],
      where: {
        campaignId,
        intent: { not: null },
      },
      _count: { id: true },
    });

    // Build a map of step -> intent -> count
    const intentMap = new Map<number, Map<string, number>>();
    for (const row of intentCounts) {
      const step = row.sequenceStep ?? 0;
      if (!intentMap.has(step)) intentMap.set(step, new Map());
      intentMap.get(step)!.set(row.intent!, row._count.id);
    }

    for (const row of replyStats) {
      const step = row.sequenceStep ?? 0;
      const intents = intentMap.get(step) || new Map<string, number>();
      const interestedCount =
        (intents.get("interested") || 0) +
        (intents.get("meeting_booked") || 0);
      const objectionCount = intents.get("objection") || 0;

      stepStats.push({
        step,
        channel: "email",
        sent: 0, // Unknown from Reply table alone
        replied: row._count.id,
        interestedCount,
        objectionCount,
      });
    }
  }

  // Get intent distribution per step from Reply table (always fresh)
  const intentRows = await prisma.reply.groupBy({
    by: ["sequenceStep", "intent"],
    where: {
      campaignId,
      intent: { not: null },
    },
    _count: { id: true },
  });

  const intentDistMap = new Map<number, Record<string, number>>();
  for (const row of intentRows) {
    const step = row.sequenceStep ?? 0;
    if (!intentDistMap.has(step)) intentDistMap.set(step, {});
    intentDistMap.get(step)![row.intent!] = row._count.id;
  }

  // Build response steps
  const steps = stepStats
    .sort((a, b) => a.step - b.step)
    .map((stat) => {
      // Find label from sequence
      let label = `Step ${stat.step}`;
      if (stat.channel === "email") {
        const emailStep = emailSteps.find(
          (s) => s.position === stat.step
        );
        if (emailStep?.subjectLine) {
          label = emailStep.subjectLine;
        }
      } else if (stat.channel === "linkedin") {
        const liStep = linkedinSteps.find(
          (s) => s.position === stat.step
        );
        if (liStep?.type) {
          label = `LinkedIn: ${liStep.type}`;
        }
      }

      const replyRate =
        stat.sent > 0
          ? Math.round((stat.replied / stat.sent) * 10000) / 100
          : 0;

      return {
        step: stat.step,
        channel: stat.channel,
        label,
        sent: stat.sent,
        replied: stat.replied,
        replyRate,
        interestedCount: stat.interestedCount,
        objectionCount: stat.objectionCount,
        intentDistribution: intentDistMap.get(stat.step) || {},
      };
    });

  return NextResponse.json({
    campaignId,
    campaignName,
    steps,
  });
}
