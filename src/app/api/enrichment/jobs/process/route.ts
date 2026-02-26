/**
 * POST /api/enrichment/jobs/process
 *
 * Picks up the next pending enrichment job and processes one chunk.
 * Call repeatedly (via Vercel Cron or manual trigger) until all jobs are complete.
 *
 * Response:
 *   - 200 { jobId, processed, total, done, status } — chunk processed
 *   - 200 { message: "no pending jobs" } — nothing to do
 *   - 500 { error: string } — processing failed
 */
import { NextResponse } from "next/server";
import { processNextChunk } from "@/lib/enrichment/queue";

export async function POST() {
  try {
    const result = await processNextChunk();

    if (!result) {
      return NextResponse.json({ message: "no pending jobs" });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Job processing error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job processing failed" },
      { status: 500 },
    );
  }
}
