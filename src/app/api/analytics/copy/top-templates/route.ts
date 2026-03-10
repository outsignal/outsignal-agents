import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import type { CampaignSnapshot } from "@/lib/analytics/snapshot";
import type { BodyElements } from "@/lib/analytics/body-elements";

export const dynamic = "force-dynamic";

interface EmailSequenceStep {
  position: number;
  subjectLine?: string;
  subjectVariantB?: string;
  body?: string;
  delayDays?: number;
  notes?: string;
}

export async function GET(request: NextRequest) {
  await requireAdminAuth();

  const { searchParams } = request.nextUrl;
  const workspace = searchParams.get("workspace") || undefined;
  const vertical = searchParams.get("vertical") || undefined;
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1),
    50
  );

  // 1. Fetch latest campaign_snapshot rows
  const snapshotWhere: Record<string, unknown> = {
    metricType: "campaign_snapshot",
  };
  if (workspace) snapshotWhere.workspace = workspace;

  const snapshotRows = await prisma.cachedMetrics.findMany({
    where: snapshotWhere,
    orderBy: { date: "desc" },
  });

  const latestSnapshots = new Map<
    string,
    { workspace: string; data: CampaignSnapshot }
  >();
  for (const row of snapshotRows) {
    if (!latestSnapshots.has(row.metricKey)) {
      try {
        const parsed = JSON.parse(row.data) as CampaignSnapshot;
        latestSnapshots.set(row.metricKey, {
          workspace: row.workspace,
          data: parsed,
        });
      } catch {
        // Skip malformed
      }
    }
  }

  // 2. Fetch body_elements rows
  const bodyElementsWhere: Record<string, unknown> = {
    metricType: "body_elements",
  };
  if (workspace) bodyElementsWhere.workspace = workspace;

  const bodyElementsRows = await prisma.cachedMetrics.findMany({
    where: bodyElementsWhere,
  });

  // Index body elements by metricKey
  const bodyElementsMap = new Map<string, BodyElements>();
  for (const row of bodyElementsRows) {
    try {
      const parsed = JSON.parse(row.data);
      bodyElementsMap.set(row.metricKey, {
        hasCtaType: Boolean(parsed.hasCtaType),
        ctaSubtype: parsed.ctaSubtype || null,
        hasProblemStatement: Boolean(parsed.hasProblemStatement),
        hasValueProposition: Boolean(parsed.hasValueProposition),
        hasCaseStudy: Boolean(parsed.hasCaseStudy),
        hasSocialProof: Boolean(parsed.hasSocialProof),
        hasPersonalization: Boolean(parsed.hasPersonalization),
      });
    } catch {
      // Skip malformed
    }
  }

  // 3. Load workspace verticals for filtering
  const workspaces = await prisma.workspace.findMany({
    select: { slug: true, vertical: true },
  });
  const workspaceVerticals = new Map<string, string | null>(
    workspaces.map((ws) => [ws.slug, ws.vertical])
  );

  // 4. Load campaign records for emailSequence content
  const campaignIds = Array.from(latestSnapshots.keys());
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: campaignIds } },
    select: {
      id: true,
      emailSequence: true,
      workspaceSlug: true,
    },
  });
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  // 5. Build scored templates
  interface TemplateEntry {
    campaignId: string;
    campaignName: string;
    workspaceSlug: string;
    step: number;
    subjectLine: string;
    body: string;
    elements: BodyElements;
    replyRate: number;
    interestedRate: number;
    compositeScore: number;
    totalSends: number;
    copyStrategy: string | null;
  }

  const templates: TemplateEntry[] = [];

  for (const [campaignId, { workspace: ws, data }] of latestSnapshots) {
    // Minimum 10 sends
    if ((data.emailsSent || 0) < 10) continue;

    // Vertical filter
    if (vertical) {
      const wsVertical = workspaceVerticals.get(ws);
      if (wsVertical !== vertical) continue;
    }

    const campaign = campaignMap.get(campaignId);
    if (!campaign?.emailSequence) continue;

    let steps: EmailSequenceStep[];
    try {
      steps = JSON.parse(campaign.emailSequence) as EmailSequenceStep[];
    } catch {
      continue;
    }

    for (const step of steps) {
      if (!step.body) continue;

      const elemKey = `${campaignId}:step:${step.position}`;
      const elements = bodyElementsMap.get(elemKey);
      if (!elements) continue;

      // Composite score: (interestedRate * 0.6) + (replyRate * 0.4)
      const compositeScore =
        Math.round(
          ((data.interestedRate || 0) * 0.6 + (data.replyRate || 0) * 0.4) *
            100
        ) / 100;

      templates.push({
        campaignId,
        campaignName: data.campaignName,
        workspaceSlug: ws,
        step: step.position,
        subjectLine: step.subjectLine || "",
        body: step.body,
        elements,
        replyRate: data.replyRate || 0,
        interestedRate: data.interestedRate || 0,
        compositeScore,
        totalSends: data.emailsSent || 0,
        copyStrategy: data.copyStrategy || null,
      });
    }
  }

  // 6. Sort by composite score descending, take top N
  templates.sort((a, b) => b.compositeScore - a.compositeScore);
  const topTemplates = templates.slice(0, limit);

  return NextResponse.json({
    templates: topTemplates,
    total: topTemplates.length,
    filters: {
      workspace: workspace || null,
      vertical: vertical || null,
    },
  });
}
