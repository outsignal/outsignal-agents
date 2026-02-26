/**
 * POST /api/enrichment/jobs/process
 *
 * Picks up the next pending (or resume-eligible paused) enrichment job and
 * processes one chunk by calling the appropriate waterfall orchestrator.
 * Call repeatedly (via Vercel Cron or manual trigger) until all jobs are complete.
 *
 * Response:
 *   - 200 { jobId, processed, total, done, status } — chunk processed
 *   - 200 { message: "no pending jobs" } — nothing to do
 *   - 500 { error: string } — processing failed
 */
import { NextResponse } from "next/server";
import { processNextChunk } from "@/lib/enrichment/queue";
import { enrichEmail, enrichCompany, createCircuitBreaker } from "@/lib/enrichment/waterfall";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    // Fresh circuit breaker per invocation — resets between batch runs
    const breaker = createCircuitBreaker();

    const result = await processNextChunk(async (entityId, job) => {
      if (job.entityType === "person") {
        const person = await prisma.person.findUniqueOrThrow({ where: { id: entityId } });
        await enrichEmail(
          entityId,
          {
            linkedinUrl: person.linkedinUrl ?? undefined,
            firstName: person.firstName ?? undefined,
            lastName: person.lastName ?? undefined,
            companyName: person.company ?? undefined,
            companyDomain: person.companyDomain ?? undefined,
          },
          breaker,
          job.workspaceSlug ?? undefined,
        );
      } else if (job.entityType === "company") {
        // entityId is the company DB id — look up domain for enrichCompany
        const company = await prisma.company.findUniqueOrThrow({ where: { id: entityId } });
        await enrichCompany(company.domain, breaker, job.workspaceSlug ?? undefined);
      }
    });

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
