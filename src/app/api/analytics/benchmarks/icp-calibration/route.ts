import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export const dynamic = "force-dynamic";

interface BucketRow {
  bucket: string;
  total_people: bigint;
  reply_count: bigint;
  interested_count: bigint;
}

const BUCKET_LABELS = ["0-20", "21-40", "41-60", "61-80", "81-100"];

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const workspace = searchParams.get("workspace") || null;
  const isGlobal = searchParams.get("global") === "true";

  // Build parameterized workspace filter fragment
  const wsCondition =
    workspace && !isGlobal
      ? Prisma.sql`AND lw."workspace" = ${workspace}`
      : Prisma.empty;

  const bucketRows = await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    WITH scored_people AS (
      SELECT
        lw."leadId" AS person_id,
        lw."workspace",
        lw."icpScore",
        l."email"
      FROM "LeadWorkspace" lw
      JOIN "Lead" l ON l."id" = lw."leadId"
      WHERE lw."icpScore" IS NOT NULL
      ${wsCondition}
    ),
    people_with_replies AS (
      SELECT
        sp.person_id,
        sp."icpScore",
        COUNT(DISTINCT r."id") AS reply_count,
        COUNT(DISTINCT CASE WHEN r."intent" IN ('interested', 'meeting_booked') THEN r."id" END) AS interested_count
      FROM scored_people sp
      LEFT JOIN "Reply" r ON r."senderEmail" = sp."email" AND r."workspaceSlug" = sp."workspace"
      GROUP BY sp.person_id, sp."icpScore"
    )
    SELECT
      CASE
        WHEN "icpScore" BETWEEN 0 AND 20 THEN '0-20'
        WHEN "icpScore" BETWEEN 21 AND 40 THEN '21-40'
        WHEN "icpScore" BETWEEN 41 AND 60 THEN '41-60'
        WHEN "icpScore" BETWEEN 61 AND 80 THEN '61-80'
        WHEN "icpScore" BETWEEN 81 AND 100 THEN '81-100'
      END AS bucket,
      COUNT(*) AS total_people,
      SUM(reply_count) AS reply_count,
      SUM(interested_count) AS interested_count
    FROM people_with_replies
    GROUP BY bucket
    ORDER BY bucket
  `);

  // Convert bigints and compute rates
  const buckets = BUCKET_LABELS.map((label) => {
    const row = bucketRows.find((r) => r.bucket === label);
    const totalPeople = row ? Number(row.total_people) : 0;
    const replyCount = row ? Number(row.reply_count) : 0;
    const interestedCount = row ? Number(row.interested_count) : 0;
    return {
      bucket: label,
      totalPeople,
      replyRate:
        totalPeople > 0
          ? Math.round((replyCount / totalPeople) * 10000) / 100
          : 0,
      interestedRate:
        totalPeople > 0
          ? Math.round((interestedCount / totalPeople) * 10000) / 100
          : 0,
    };
  });

  const totalPeople = buckets.reduce((sum, b) => sum + b.totalPeople, 0);

  // Empty state check
  if (totalPeople < 50) {
    return NextResponse.json({
      buckets: [],
      recommendation: null,
      totalPeople,
      workspace,
      isGlobal: !workspace || isGlobal,
      message: `Not enough ICP data (need 50+, currently ${totalPeople})`,
    });
  }

  // Compute threshold recommendation
  let recommendation: {
    currentThreshold: number;
    recommendedThreshold: number;
    evidence: string;
    confidence: "high" | "medium" | "low";
    sampleSize: number;
  } | null = null;

  // Find current threshold from workspace signal campaigns
  let currentThreshold = 70; // default
  if (workspace && !isGlobal) {
    const signalCampaigns = await prisma.campaign.findMany({
      where: { workspaceSlug: workspace, type: "signal" },
      select: { icpScoreThreshold: true },
    });
    if (signalCampaigns.length > 0) {
      // Use most common threshold
      const thresholdCounts = new Map<number, number>();
      for (const c of signalCampaigns) {
        const t = c.icpScoreThreshold;
        thresholdCounts.set(t, (thresholdCounts.get(t) || 0) + 1);
      }
      let maxCount = 0;
      for (const [t, count] of thresholdCounts) {
        if (count > maxCount) {
          maxCount = count;
          currentThreshold = t;
        }
      }
    }
  }

  // Walk buckets from highest to lowest to find recommended threshold
  // Find peak interestedRate bucket
  const nonEmptyBuckets = buckets.filter((b) => b.totalPeople > 0);
  if (nonEmptyBuckets.length > 0) {
    const peakRate = Math.max(...nonEmptyBuckets.map((b) => b.interestedRate));

    if (peakRate > 0) {
      const dropoffThreshold = peakRate * 0.5;

      // Walk from highest bucket downward
      let recommendedBucketIdx = 0;
      for (let i = BUCKET_LABELS.length - 1; i >= 0; i--) {
        const bucket = buckets[i];
        if (
          bucket.totalPeople > 0 &&
          bucket.interestedRate >= dropoffThreshold
        ) {
          recommendedBucketIdx = i;
          break;
        }
      }

      // The bottom of the "good" bucket is the recommended threshold
      const bucketStarts = [0, 21, 41, 61, 81];
      const recommendedThreshold = bucketStarts[recommendedBucketIdx];

      // Compute rates above/below for evidence
      const aboveBuckets = buckets.filter(
        (_, i) => i >= recommendedBucketIdx
      );
      const belowBuckets = buckets.filter(
        (_, i) => i < recommendedBucketIdx
      );

      const abovePeople = aboveBuckets.reduce(
        (s, b) => s + b.totalPeople,
        0
      );
      const belowPeople = belowBuckets.reduce(
        (s, b) => s + b.totalPeople,
        0
      );

      const aboveInterestedTotal = aboveBuckets.reduce(
        (s, b) => s + (b.interestedRate * b.totalPeople) / 100,
        0
      );
      const belowInterestedTotal = belowBuckets.reduce(
        (s, b) => s + (b.interestedRate * b.totalPeople) / 100,
        0
      );

      const aboveRate =
        abovePeople > 0
          ? Math.round((aboveInterestedTotal / abovePeople) * 10000) / 100
          : 0;
      const belowRate =
        belowPeople > 0
          ? Math.round((belowInterestedTotal / belowPeople) * 10000) / 100
          : 0;

      // Confidence based on sample size
      const confidence: "high" | "medium" | "low" =
        totalPeople >= 200 ? "high" : totalPeople >= 100 ? "medium" : "low";

      const direction =
        recommendedThreshold > currentThreshold
          ? "raising"
          : recommendedThreshold < currentThreshold
            ? "lowering"
            : "keeping";

      const evidence =
        direction === "keeping"
          ? `Current threshold of ${currentThreshold} is optimal. People scoring ${recommendedThreshold}+ have ${aboveRate}% interested rate vs ${belowRate}% for lower buckets (based on ${totalPeople} scored leads).`
          : `Data suggests ${direction} threshold from ${currentThreshold} to ${recommendedThreshold}. People scoring ${recommendedThreshold}+ have ${aboveRate}% interested rate vs ${belowRate}% for lower buckets (based on ${totalPeople} scored leads).`;

      recommendation = {
        currentThreshold,
        recommendedThreshold,
        evidence,
        confidence,
        sampleSize: totalPeople,
      };
    }
  }

  return NextResponse.json({
    buckets,
    recommendation,
    totalPeople,
    workspace,
    isGlobal: !workspace || isGlobal,
  });
}
