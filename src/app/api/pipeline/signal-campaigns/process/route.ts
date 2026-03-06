/**
 * POST /api/pipeline/signal-campaigns/process
 *
 * Trigger endpoint for the Railway signal worker to call after each
 * signal polling cycle. Runs processSignalCampaigns() and returns a
 * summary of campaigns processed, leads added, and signals matched.
 *
 * Auth: x-pipeline-secret header checked against PIPELINE_INTERNAL_SECRET
 * env var using timing-safe comparison.
 */

import { NextResponse } from "next/server";
import { processSignalCampaigns } from "@/lib/pipeline/signal-campaigns";
import crypto from "crypto";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// Route segment config — set max execution time for Vercel Pro.
// With a daily cap of 20 leads per campaign and per-lead ICP scoring,
// processing time scales linearly. This gives headroom for multiple campaigns.
export const maxDuration = 60; // seconds
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Validate the x-pipeline-secret header using timing-safe comparison.
 * Returns false if PIPELINE_INTERNAL_SECRET is not configured (rejects all requests).
 */
function validatePipelineSecret(request: Request): boolean {
  const secret = process.env.PIPELINE_INTERNAL_SECRET;
  if (!secret) {
    console.warn(
      "[Pipeline API] PIPELINE_INTERNAL_SECRET not set — rejecting all requests",
    );
    return false;
  }

  const provided = request.headers.get("x-pipeline-secret") ?? "";

  // Reject early if lengths differ — timingSafeEqual requires equal-length buffers
  if (provided.length !== secret.length) return false;

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Authenticate
  if (!validatePipelineSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Run pipeline
    console.log("[Pipeline API] Signal campaign processing triggered");
    const result = await processSignalCampaigns();

    console.log(
      `[Pipeline API] Complete — campaigns: ${result.campaignsProcessed}, ` +
        `leads added: ${result.totalLeadsAdded}, signals matched: ${result.totalSignalsMatched}`,
    );

    return NextResponse.json({
      status: "complete",
      ...result,
    });
  } catch (error) {
    console.error("[Pipeline API] Fatal error:", error);
    return NextResponse.json(
      { error: "Pipeline processing failed" },
      { status: 500 },
    );
  }
}
