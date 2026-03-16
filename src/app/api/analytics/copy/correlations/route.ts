import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import type { CampaignSnapshot } from "@/lib/analytics/snapshot";
import type { BodyElements } from "@/lib/analytics/body-elements";

export const dynamic = "force-dynamic";

const ELEMENT_FIELDS: Array<{
  key: keyof BodyElements;
  element: string;
  displayName: string;
}> = [
  { key: "hasCtaType", element: "cta_type", displayName: "CTA" },
  {
    key: "hasProblemStatement",
    element: "problem_statement",
    displayName: "Problem Statement",
  },
  {
    key: "hasValueProposition",
    element: "value_proposition",
    displayName: "Value Proposition",
  },
  { key: "hasCaseStudy", element: "case_study", displayName: "Case Study" },
  {
    key: "hasSocialProof",
    element: "social_proof",
    displayName: "Social Proof",
  },
  {
    key: "hasPersonalization",
    element: "personalization",
    displayName: "Personalization",
  },
];

interface StepWithElements {
  campaignId: string;
  workspace: string;
  step: number;
  elements: BodyElements;
  stepReplied: number;
  emailsSent: number;
  vertical: string | null;
}

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const workspace = searchParams.get("workspace") || undefined;
  const vertical = searchParams.get("vertical") || undefined;

  // 1. Fetch body_elements rows
  const bodyElementsWhere: Record<string, unknown> = {
    metricType: "body_elements",
  };
  if (workspace) bodyElementsWhere.workspace = workspace;

  const bodyElementsRows = await prisma.cachedMetrics.findMany({
    where: bodyElementsWhere,
  });

  // 2. Fetch latest campaign_snapshot rows
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

  // 3. Load workspace verticals
  const workspaces = await prisma.workspace.findMany({
    select: { slug: true, vertical: true },
  });
  const workspaceVerticals = new Map<string, string | null>(
    workspaces.map((ws) => [ws.slug, ws.vertical])
  );

  // 4. Build StepWithElements list
  const stepsWithElements: StepWithElements[] = [];

  for (const row of bodyElementsRows) {
    // Parse metricKey: "{campaignId}:step:{position}"
    const parts = row.metricKey.split(":step:");
    if (parts.length !== 2) continue;
    const campaignId = parts[0];
    const stepPosition = parseInt(parts[1], 10);
    if (isNaN(stepPosition)) continue;

    const snapshot = latestSnapshots.get(campaignId);
    if (!snapshot) continue;

    // Minimum 10 sends
    if ((snapshot.data.emailsSent || 0) < 10) continue;

    const wsVertical = workspaceVerticals.get(snapshot.workspace) || null;

    // Vertical filter
    if (vertical && wsVertical !== vertical) continue;

    // Get step reply count from stepStats
    let stepReplied = 0;
    if (snapshot.data.stepStats) {
      const stepStat = snapshot.data.stepStats.find(
        (ss) => ss.step === stepPosition
      );
      if (stepStat) stepReplied = stepStat.replied;
    }

    let elements: BodyElements;
    try {
      const parsed = JSON.parse(row.data);
      elements = {
        hasCtaType: Boolean(parsed.hasCtaType),
        ctaSubtype: parsed.ctaSubtype || null,
        hasProblemStatement: Boolean(parsed.hasProblemStatement),
        hasValueProposition: Boolean(parsed.hasValueProposition),
        hasCaseStudy: Boolean(parsed.hasCaseStudy),
        hasSocialProof: Boolean(parsed.hasSocialProof),
        hasPersonalization: Boolean(parsed.hasPersonalization),
      };
    } catch {
      continue;
    }

    stepsWithElements.push({
      campaignId,
      workspace: snapshot.workspace,
      step: stepPosition,
      elements,
      stepReplied,
      emailsSent: snapshot.data.emailsSent || 0,
      vertical: wsVertical,
    });
  }

  // 5. Compute correlations for each element
  const correlations = ELEMENT_FIELDS.map(({ key, element, displayName }) => {
    // Global: all steps
    const globalWith = stepsWithElements.filter((s) => s.elements[key]);
    const globalWithout = stepsWithElements.filter((s) => !s.elements[key]);

    const globalMultiplier = computeMultiplier(globalWith, globalWithout);

    // Vertical-specific
    let verticalMultiplier: number | null = null;
    let verticalSampleWith = 0;
    let verticalSampleWithout = 0;
    let verticalName: string | null = vertical || null;

    if (vertical) {
      const vertWith = globalWith.filter((s) => s.vertical === vertical);
      const vertWithout = globalWithout.filter((s) => s.vertical === vertical);
      verticalMultiplier = computeMultiplier(vertWith, vertWithout);
      verticalSampleWith = vertWith.length;
      verticalSampleWithout = vertWithout.length;
    }

    return {
      element,
      displayName,
      globalMultiplier,
      globalSampleWith: globalWith.length,
      globalSampleWithout: globalWithout.length,
      verticalMultiplier,
      verticalSampleWith,
      verticalSampleWithout,
      verticalName,
      lowConfidence:
        globalWith.length + globalWithout.length < 20,
    };
  });

  // 6. CTA subtype breakdown
  const ctaSteps = stepsWithElements.filter((s) => s.elements.hasCtaType);
  const subtypeGroups = new Map<
    string,
    { totalWeightedRate: number; totalSends: number; count: number }
  >();

  for (const step of ctaSteps) {
    const subtype = step.elements.ctaSubtype || "unknown";
    const existing = subtypeGroups.get(subtype);
    const rate =
      step.emailsSent > 0 ? (step.stepReplied / step.emailsSent) * 100 : 0;
    if (existing) {
      existing.totalWeightedRate += rate * step.emailsSent;
      existing.totalSends += step.emailsSent;
      existing.count += 1;
    } else {
      subtypeGroups.set(subtype, {
        totalWeightedRate: rate * step.emailsSent,
        totalSends: step.emailsSent,
        count: 1,
      });
    }
  }

  const ctaSubtypes = Array.from(subtypeGroups.entries()).map(
    ([subtype, data]) => ({
      subtype,
      avgReplyRate:
        data.totalSends > 0
          ? Math.round((data.totalWeightedRate / data.totalSends) * 100) / 100
          : 0,
      sampleSize: data.count,
    })
  );

  return NextResponse.json({
    correlations,
    ctaSubtypes,
    totalStepsAnalyzed: stepsWithElements.length,
    filters: {
      workspace: workspace || null,
      vertical: vertical || null,
    },
  });
}

/**
 * Compute weighted reply rate multiplier: with-element / without-element.
 * Returns null if either bucket is empty (division by zero guard).
 */
function computeMultiplier(
  withSteps: StepWithElements[],
  withoutSteps: StepWithElements[]
): number | null {
  if (withSteps.length === 0 || withoutSteps.length === 0) return null;

  let withWeightedRate = 0;
  let withTotalSends = 0;
  for (const s of withSteps) {
    const rate = s.emailsSent > 0 ? (s.stepReplied / s.emailsSent) * 100 : 0;
    withWeightedRate += rate * s.emailsSent;
    withTotalSends += s.emailsSent;
  }

  let withoutWeightedRate = 0;
  let withoutTotalSends = 0;
  for (const s of withoutSteps) {
    const rate = s.emailsSent > 0 ? (s.stepReplied / s.emailsSent) * 100 : 0;
    withoutWeightedRate += rate * s.emailsSent;
    withoutTotalSends += s.emailsSent;
  }

  const avgWith =
    withTotalSends > 0 ? withWeightedRate / withTotalSends : 0;
  const avgWithout =
    withoutTotalSends > 0 ? withoutWeightedRate / withoutTotalSends : 0;

  if (avgWithout === 0) return null;

  return Math.round((avgWith / avgWithout) * 100) / 100;
}
